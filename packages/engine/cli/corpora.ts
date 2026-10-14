import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTextbookEntries, scoreFromTextbookEntry } from '../src/eval/textbook.js';
import { parsePig } from '../src/io/pig/read.js';
import { annotationOn } from '../src/learn/data.js';
import type { CorpusName, TrainingPiece } from '../src/learn/data.js';
import type { Assignment, Finger } from '../src/score/types.js';

/**
 * Training and evaluation corpora for the learner (M3 Task 2), read from the gitignored data under
 * `research/data` (see `research/data/README.md`) and the tracked textbook oracle:
 *
 * - PIG: `pig/FingeringFiles/<id>-<k>_fingering.txt`; train = the `nakamura2020` train pieces of
 *   `splits/pig_official.json` minus the 20 validation pieces of `splits/pig_validation.json`
 *   (written by `research/scripts/make_pig_validation.py`, read here, never recomputed). The test
 *   pieces (001 to 030) are never read.
 * - textbook: `benchmarks/textbook/{scales,arpeggios,chromatic}.json`, one piece per entry; the
 *   primary fingering and every alternative are separate annotations. An entry the normalizer
 *   cannot read (`normalizeTextbookEntries` warnings) is an error, never dropped silently.
 * - Beringer: `beringer_fingering/FingeringFiles/<Name>-<k>_fingering.txt` (k = 1 main, 2+
 *   alternatives), without the piece whose manifest source is the C-sharp minor broken chords
 *   (its fingering line is a copy of C minor's; datasets report section 5).
 * - Mutopia: `mutopia_fingering/FingeringFiles/<part>-0_fingering.txt`, `status == "ok"` parts of
 *   `manifest.json` in the requested half of `splits/mutopia_split.json` (split by Mutopia piece,
 *   seed 20261013); finger 0 = no fingering printed (unknown).
 *
 * Every annotation of a piece is aligned to the first one by note line (`annotationOn`). Pieces come
 * in a fixed order (PIG train, PIG validation, textbook, Beringer, Mutopia train, Mutopia test; ids
 * sorted within each) so that seeded training is reproducible.
 */

export interface CorpusSelection {
  pigTrain?: boolean;
  pigValidation?: boolean;
  textbook?: boolean;
  beringer?: boolean;
  mutopiaTrain?: boolean;
  mutopiaTest?: boolean;
}

export interface CorpusRoots {
  /** PIG dataset directory (its `FingeringFiles/` holds the annotations). */
  pig: string;
  /** `pig_official.json` (`splits.nakamura2020.{train,test}.pieces`). */
  pigSplit: string;
  /** `pig_validation.json` (`pieces`: the 20 validation ids). */
  pigValidation: string;
  /** Directory of the textbook oracle JSON files. */
  textbook: string;
  /** Beringer corpus directory (`FingeringFiles/`, `manifest.csv`). */
  beringer: string;
  /** Mutopia corpus directory (`FingeringFiles/`, `manifest.json`). */
  mutopia: string;
  /** `mutopia_split.json` (`splits.piece70_30.{train,test}.pieces`). */
  mutopiaSplit: string;
}

export interface CorpusSource {
  corpus: CorpusName;
  /** `train`, `validation` or `test` for the split corpora; absent for textbook and Beringer. */
  subset?: string;
  /** Number of files read (data files plus the split or manifest files that select them). */
  files: number;
  /**
   * sha256 over the sorted `path:size` lines of those files, paths relative to the repository
   * root with `/` separators: provenance of what was read, not a content hash.
   */
  sha256: string;
}

export const TEXTBOOK_FILES = ['scales.json', 'arpeggios.json', 'chromatic.json'] as const;
export const BERINGER_EXCLUDED_SOURCE = 'broken_chords/csharp_minor.abcd';
const PIG_SPLIT_NAME = 'nakamura2020';
const MUTOPIA_SPLIT_NAME = 'piece70_30';
const DATA_README = 'research/data/README.md';
const LICENSES = {
  pig: 'PIG Dataset v1.2: non-profit academic use only (research weights, never shipped)',
  textbook: 'digitus2 textbook oracle (MIT)',
  beringer: 'fingerings public domain (Beringer and Dunhill 1900); transcription MIT (pydactyl)',
} as const;

/** The repository root: the nearest ancestor of this module with `pnpm-workspace.yaml`. */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
}

export function defaultCorpusRoots(root = repoRoot()): CorpusRoots {
  const data = join(root, 'research', 'data');
  return {
    pig: join(data, 'pig'),
    pigSplit: join(data, 'splits', 'pig_official.json'),
    pigValidation: join(data, 'splits', 'pig_validation.json'),
    textbook: join(root, 'benchmarks', 'textbook'),
    beringer: join(data, 'beringer_fingering'),
    mutopia: join(data, 'mutopia_fingering'),
    mutopiaSplit: join(data, 'splits', 'mutopia_split.json'),
  };
}

function missing(what: string, path: string): Error {
  return new Error(
    `${what} not found: ${path} (gitignored data; see ${DATA_README} to download and build it)`,
  );
}

function need(what: string, path: string): string {
  if (!existsSync(path)) throw missing(what, path);
  return path;
}

function readJson<T>(what: string, path: string): T {
  return JSON.parse(readFileSync(need(what, path), 'utf8')) as T;
}

/** `<root>/FingeringFiles` when it exists, else `root` itself (as `bench --gold` accepts both). */
function fingeringDir(what: string, root: string): string {
  need(what, root);
  const dir = join(root, 'FingeringFiles');
  return existsSync(dir) ? dir : root;
}

/** Fingering files of a directory grouped by piece: id -> file names sorted by annotation number. */
function fingeringFiles(dir: string): Map<string, string[]> {
  const byPiece = new Map<string, Array<{ k: number; name: string }>>();
  for (const name of readdirSync(dir)) {
    const m = /^(.+)-(\d+)_fingering\.txt$/.exec(name);
    if (!m) continue;
    const list = byPiece.get(m[1]!) ?? [];
    list.push({ k: Number(m[2]), name });
    byPiece.set(m[1]!, list);
  }
  const out = new Map<string, string[]>();
  for (const [id, list] of byPiece)
    out.set(
      id,
      list.sort((a, b) => a.k - b.k).map((f) => f.name),
    );
  return out;
}

/** One piece from its annotation files (the first file's notes are the score). */
function pieceFromFiles(
  corpus: CorpusName,
  id: string,
  dir: string,
  names: string[],
  used: string[],
  license?: string,
): TrainingPiece {
  const parsed = names.map((name) => {
    const path = join(dir, name);
    used.push(path);
    return { name, ...parsePig(readFileSync(path, 'utf8'), { source: name }) };
  });
  const base = parsed[0]!;
  const annotations: Assignment[] = [
    base.assignment,
    ...parsed.slice(1).map((p) => annotationOn(base.score, p, `${corpus} ${p.name}`)),
  ];
  const piece: TrainingPiece = { corpus, id, score: base.score, annotations };
  if (license !== undefined) piece.license = license;
  return piece;
}

function sourceOf(
  corpus: CorpusName,
  subset: string | undefined,
  used: string[],
  root: string,
): CorpusSource {
  const lines = [...new Set(used)]
    .map((p) => `${relative(root, resolve(p)).split(sep).join('/')}:${statSync(p).size}`)
    .sort();
  const sha256 = createHash('sha256').update(lines.join('\n')).digest('hex');
  const s: CorpusSource = { corpus, files: lines.length, sha256 };
  if (subset !== undefined) s.subset = subset;
  return s;
}

interface SplitFile {
  default_split?: string;
  splits: Record<string, Record<string, { pieces: string[] } | undefined> | undefined>;
}

function splitPieces(file: string, what: string, name: string, subset: string): string[] {
  const json = readJson<SplitFile>(what, file);
  const part = json.splits[name]?.[subset];
  if (!part) throw new Error(`${what}: split ${name}/${subset} not found in ${file}`);
  return [...part.pieces];
}

/** The 20 PIG validation pieces, read from `pig_validation.json` (sorted). */
export function readPigValidation(file: string): string[] {
  const json = readJson<{ pieces?: unknown }>('PIG validation list', file);
  if (!Array.isArray(json.pieces) || !json.pieces.every((p) => typeof p === 'string'))
    throw new Error(`${file}: expected a "pieces" array of piece ids`);
  return [...(json.pieces as string[])].sort();
}

/**
 * The fixed PIG validation pieces (research/data/splits/pig_validation.json: 20 train pieces drawn
 * with `random.Random(20261013)` by research/scripts/make_pig_validation.py), sorted. Empty only
 * when the file is absent; `loadCorpora` reads the file itself and throws in that case.
 */
export const PIG_VALIDATION_PIECES: readonly string[] = (() => {
  const file = defaultCorpusRoots().pigValidation;
  return existsSync(file) ? readPigValidation(file) : [];
})();

function loadPig(
  roots: CorpusRoots,
  subset: 'train' | 'validation',
  root: string,
): { pieces: TrainingPiece[]; source: CorpusSource } {
  const train = splitPieces(roots.pigSplit, 'PIG split', PIG_SPLIT_NAME, 'train');
  const test = new Set(splitPieces(roots.pigSplit, 'PIG split', PIG_SPLIT_NAME, 'test'));
  const validation = readPigValidation(roots.pigValidation);
  const trainSet = new Set(train);
  for (const id of validation) {
    if (test.has(id) || !trainSet.has(id))
      throw new Error(`PIG validation piece ${id} is not a train piece (${roots.pigValidation})`);
  }
  const valSet = new Set(validation);
  const wanted = (subset === 'validation' ? validation : train.filter((id) => !valSet.has(id)))
    .filter((id) => !test.has(id))
    .sort();
  const dir = fingeringDir('PIG dataset', roots.pig);
  const files = fingeringFiles(dir);
  const used = [roots.pigSplit, roots.pigValidation];
  const pieces = wanted.map((id) => {
    const names = files.get(id);
    if (!names) throw missing(`PIG piece ${id}`, join(dir, `${id}-1_fingering.txt`));
    return pieceFromFiles('pig', id, dir, names, used, LICENSES.pig);
  });
  return { pieces, source: sourceOf('pig', subset, used, root) };
}

function loadTextbook(
  roots: CorpusRoots,
  root: string,
): { pieces: TrainingPiece[]; source: CorpusSource } {
  need('textbook oracle', roots.textbook);
  const used: string[] = [];
  const pieces: TrainingPiece[] = [];
  for (const name of TEXTBOOK_FILES) {
    const path = join(roots.textbook, name);
    used.push(path);
    // An entry the normalizer skips would leave the training data without a word; the oracle is
    // curated and tracked, so a skipped entry is an error to fix, not a warning to read past.
    const { entries, warnings } = normalizeTextbookEntries(readJson('textbook oracle file', path));
    if (warnings.length > 0)
      throw new Error(
        `textbook oracle ${path}: ${warnings.length} entr${warnings.length === 1 ? 'y' : 'ies'} could not be read: ${warnings.join('; ')}`,
      );
    for (const e of entries) {
      const score = scoreFromTextbookEntry(e);
      const fingerings = [e.fingers, ...(e.alternatives ?? []).map((a) => a.fingers)];
      const annotations = fingerings.map((fs) => {
        const a: Assignment = {};
        score.notes.forEach((n, i) => {
          const f = fs[i];
          if (f === 0) return;
          if (!Number.isInteger(f) || f! < 1 || f! > 5)
            throw new Error(`textbook ${e.id}: finger ${String(f)} at note ${i}`);
          a[n.id] = { finger: f as Finger, source: 'editorial' };
        });
        return a;
      });
      pieces.push({ corpus: 'textbook', id: e.id, score, annotations, license: LICENSES.textbook });
    }
  }
  pieces.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { pieces, source: sourceOf('textbook', undefined, used, root) };
}

/** Minimal CSV reader for the corpus manifests (double-quoted fields, no embedded newlines). */
function parseCsv(text: string): Array<Record<string, string>> {
  const content = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // drop a byte-order mark
  const rows = content
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((line) => {
      const cells: string[] = [];
      let cur = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i]!;
        if (quoted) {
          if (c === '"' && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else if (c === '"') quoted = false;
          else cur += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') {
          cells.push(cur);
          cur = '';
        } else cur += c;
      }
      cells.push(cur);
      return cells;
    });
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])));
}

function loadBeringer(
  roots: CorpusRoots,
  root: string,
): { pieces: TrainingPiece[]; source: CorpusSource } {
  const dir = fingeringDir('Beringer corpus', roots.beringer);
  const manifest = join(roots.beringer, 'manifest.csv');
  const rows = parseCsv(readFileSync(need('Beringer manifest', manifest), 'utf8'));
  const excluded = new Set(
    rows.filter((r) => r.source === BERINGER_EXCLUDED_SOURCE).map((r) => r.piece_id!),
  );
  if (excluded.size === 0)
    throw new Error(`${manifest}: no piece with source ${BERINGER_EXCLUDED_SOURCE} to exclude`);
  const used = [manifest];
  const files = fingeringFiles(dir);
  const pieces = [...files.keys()]
    .filter((id) => !excluded.has(id))
    .sort()
    .map((id) => pieceFromFiles('beringer', id, dir, files.get(id)!, used, LICENSES.beringer));
  return { pieces, source: sourceOf('beringer', undefined, used, root) };
}

interface MutopiaManifestRow {
  piece_id: string;
  mutopia_id: string;
  status: string;
  license?: string;
}

function loadMutopia(
  roots: CorpusRoots,
  subset: 'train' | 'test',
  root: string,
): { pieces: TrainingPiece[]; source: CorpusSource } {
  const dir = fingeringDir('Mutopia corpus', roots.mutopia);
  const manifestPath = join(roots.mutopia, 'manifest.json');
  const manifest = readJson<MutopiaManifestRow[]>('Mutopia manifest', manifestPath);
  const meta = new Map(manifest.map((m) => [m.piece_id, m]));
  const wanted = splitPieces(roots.mutopiaSplit, 'Mutopia split', MUTOPIA_SPLIT_NAME, subset)
    .filter((id) => meta.get(id)?.status === 'ok')
    .sort();
  const files = fingeringFiles(dir);
  const used = [manifestPath, roots.mutopiaSplit];
  const pieces = wanted.map((id) => {
    const names = files.get(id);
    if (!names) throw missing(`Mutopia part ${id}`, join(dir, `${id}-0_fingering.txt`));
    const license = meta.get(id)!.license;
    if (!license) throw new Error(`${manifestPath}: part ${id} has no licence`);
    return pieceFromFiles('mutopia', id, dir, names, used, license);
  });
  return { pieces, source: sourceOf('mutopia', subset, used, root) };
}

/**
 * The selected corpora as training pieces, with one provenance entry per selected corpus. Missing
 * data throws with the path and a pointer to `research/data/README.md`.
 */
export function loadCorpora(
  sel: CorpusSelection,
  roots: Partial<CorpusRoots> = {},
): { pieces: TrainingPiece[]; sources: CorpusSource[] } {
  const root = repoRoot();
  const r: CorpusRoots = { ...defaultCorpusRoots(root), ...roots };
  const parts: Array<{ pieces: TrainingPiece[]; source: CorpusSource }> = [];
  if (sel.pigTrain) parts.push(loadPig(r, 'train', root));
  if (sel.pigValidation) parts.push(loadPig(r, 'validation', root));
  if (sel.textbook) parts.push(loadTextbook(r, root));
  if (sel.beringer) parts.push(loadBeringer(r, root));
  if (sel.mutopiaTrain) parts.push(loadMutopia(r, 'train', root));
  if (sel.mutopiaTest) parts.push(loadMutopia(r, 'test', root));
  return { pieces: parts.flatMap((p) => p.pieces), sources: parts.map((p) => p.source) };
}
