import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { hardErrors } from '../src/eval/hardErrors.js';
import { benchmarkEntries, CORE_BENCHMARK_SET } from '../src/library/benchmarkSet.js';
import { alignScores, fingerSeq, metricsForScores } from '../src/eval/align.js';
import { formatPigPitch } from '../src/score/pitch.js';
import {
  loadWeightSet,
  RECOMMENDED_WEIGHT_SET,
  validateWeightSet,
  WEIGHT_SETS,
} from '../src/fingering/params/weightSets.js';
import type { WeightSetFile, WeightSetId } from '../src/fingering/params/weightSets.js';
import { RULE_IDS } from '../src/fingering/rules.js';
import type { RuleId, RuleWeights } from '../src/fingering/rules.js';
import type { Finger } from '../src/score/types.js';
import {
  barPositions,
  findRepeats,
  pairConsistency,
  repeatConsistency,
  repeatPairs,
} from '../src/fingering/repeats.js';
import { buildHandSequence } from '../src/fingering/sequence.js';
import { solveFingering } from '../src/fingering/solve.js';
import type { NoteExplanation, SolveOptions } from '../src/fingering/solve.js';
import { parseMusicXml } from '../src/io/musicxml/read.js';
import type { HandProfileId } from '../src/fingering/spans.js';
import { parsePig } from '../src/io/pig/read.js';
import { pairedBootstrap } from '../src/learn/bootstrap.js';
import { calibrate, confidenceSample } from '../src/learn/calibration.js';
import type { CalibrationReport, ConfidenceSample } from '../src/learn/calibration.js';
import { lintFingering } from '../src/lint/index.js';
import { ENGINE_VERSION } from '../src/version.js';

export interface BenchOptions {
  gold: string;
  split: string;
  splitName?: string;
  /**
   * `test` (default) or `train`: that subset of the split. `validation` (M3 Task 7): the pieces of
   * the validation list (`validation`), each of which must be in the split's train subset and not
   * in its test subset, so a validation run never decodes a test piece. A validation run is never
   * gated (`floor` is refused: the floors are test-split numbers) and its milestone scorecard is
   * `latest-validation.json`, never `latest.json`.
   */
  subset?: BenchSubset;
  /** The validation list (`{ "pieces": [...] }`); default `pig_validation.json` next to `split`. */
  validation?: string;
  floor?: string;
  out?: string;
  label?: string;
  profile?: HandProfileId;
  ablate?: boolean;
  limit?: number;
  /**
   * A weight-set id (`parncutt`, `learned-open`) or the path of a weight-set file
   * (`research/weights/pig/weights-learned-pig.json`); default `RECOMMENDED_WEIGHT_SET`.
   */
  weights?: WeightSetId | string;
  /**
   * Per-piece baseline results to compare with (`research/baselines/results_per_piece_test.csv`):
   * a paired bootstrap of the per-piece M_gen differences against each baseline of `against`.
   */
  compare?: string;
  /** Baseline ids of the `compare` CSV; default `DEFAULT_AGAINST` (FHMM3, FingerFlow learned). */
  against?: string[];
  /**
   * Default true: a gold note that an annotation leaves without a finger (PIG finger 0, the
   * Mutopia parts) is unknown and left out of every metric. false: a piece whose gold has such a
   * note is skipped with the count, so nothing is masked silently.
   */
  mask?: boolean;
  /**
   * The milestone scorecard a labelled full run replaces and the CLI prints its deltas against.
   * Default by corpus (`corpusOf`): `latest.json` next to the runs directory for PIG and for
   * splits that name no corpus, `latest-<corpus>.json` for any other (`latest-mutopia.json`).
   */
  latest?: string;
  /**
   * Also write the scorecard to this file (`pnpm verify`: the gitignored
   * `benchmarks/runs/verify-pig.json` and `verify-mutopia.json`). Such a run is never a milestone
   * run: it leaves the milestone scorecard (`latest`) alone, labelled or not.
   */
  scorecard?: string;
  /**
   * A library manifest (`content/manifest.json`): every score it lists is solved with the run's
   * weight set and profile and its identical passages are checked (`Scorecard.library`; M3 Task 7,
   * H4). Score paths are relative to the manifest's directory.
   */
  library?: string;
}
/** Repeat consistency on the library (`BenchOptions.library`). */
export interface LibraryReport {
  manifest: string;
  pieces: number;
  /**
   * Pairs of identical passages (`repeatPairs`, per hand): every two copies of a passage of at
   * least four events with the same keys, durations and rhythm, whatever the consistency pass
   * grouped. The measure of "repeats are fingered alike".
   */
  pairs: number;
  /** Pairs whose two copies take the same fingers. */
  alike: number;
  /** alike / pairs (1 without pairs). */
  consistency: number;
  /** Repeated passages as a reader counts them (`findRepeats`, per hand; secondary). */
  groups: number;
  /** Groups whose copies all take the same fingers. */
  consistent: number;
}
export interface PieceResult {
  id: string;
  /** Notes scored: the notes every annotation fingers (all notes unless gold notes are masked). */
  notes: number;
  /** Notes of the score, all fingered by the engine (the lint and timing denominators). */
  scoreNotes: number;
  annotators: number;
  gen: number;
  high: number;
  soft: number;
  rec: number;
  hardErrorRate: number;
  lintErrors: number;
  lintWarnings: number;
  ms: number;
}
/** A paired bootstrap of this run against one baseline (`delta` = ours minus theirs, percent). */
export interface Comparison {
  baseline: string;
  metric: 'gen';
  delta: number;
  ci95: [number, number];
  pieces: number;
}
export interface Scorecard {
  version: 1;
  engineVersion: string;
  gitSha: string;
  label: string;
  timestamp: string;
  /** `corpus`: the first word of the split file's `dataset` field, lower case ('' when none). */
  split: { file: string; name: string; subset: string; corpus: string };
  profile: string;
  /** sha256 (16 hex digits) of the weights the run used, in `RULE_IDS` order. */
  weightsHash: string;
  /** The weight set: its id, `weightsHash`, its confidence temperature, its file if read from one. */
  weightSet: { id: string; hash: string; temperature: number; file?: string };
  macro: { gen: number; high: number; soft: number; rec: number; hardErrorRate: number };
  noteWeighted: { gen: number; high: number; soft: number; rec: number };
  lint: { errorsPer1000: number; warningsPer1000: number };
  timing: { totalMs: number; msPerPiece: number; msPer1000Notes: number };
  comparisons?: Comparison[];
  /**
   * Calibration of the per-note confidence at the weight set's temperature over the scored notes
   * (M3 Task 6; verification spec 3.8), per annotator (M3 Task 9): the engine's finger is as
   * correct as the share of the note's annotators who use it, so the measure does not depend on
   * how many annotators a piece has. Every run of `runBench` sets it.
   */
  calibration?: CalibrationReport & { correct: typeof CALIBRATION_CORRECT };
  /** Repeat consistency on the library, when the run was given one (`BenchOptions.library`). */
  library?: LibraryReport;
  pieces: PieceResult[];
  skipped: Array<{ id: string; reason: string }>;
}
/** What counts as a correct finger in `Scorecard.calibration` (M3 Task 9: soft labels). */
export const CALIBRATION_CORRECT =
  "per annotator: the share of the note's annotators who use the engine's finger";
/** Floors of a corpus other than PIG (`mutopia`): a null metric is not gated yet. */
export interface CorpusFloor {
  goldDir?: string;
  /** The split file whose runs this block gates (`floorSection`). */
  split?: string;
  subset?: string;
  gen?: number | null;
  high?: number | null;
  soft?: number | null;
  rec?: number | null;
}
export interface FloorFile {
  /** The weight set the floors were measured with; a gated run with another set is a breach. */
  weightSet?: string;
  /** sha256 (16 hex digits) of that set's weights (`Scorecard.weightSet.hash`); a mismatch is a breach. */
  weightSetHash?: string;
  /** The split file of the PIG floors (`engine`, `lint`, `calibration`). */
  split?: string;
  /** PIG floors (the `engine` block gates PIG runs and splits that name no corpus). */
  engine: null | Record<string, number>;
  /** Most lint errors per 1000 notes the engine's own output may have (verification spec 2.4). */
  lint?: { errorsPer1000Max?: number };
  /** Largest calibration ECE of a PIG run (verification spec goals, "Mean what we say"). */
  calibration?: { eceMax?: number };
  /** The Mutopia oracle (M3 Task 5): gold directory, split, subset and its floors. */
  mutopia?: CorpusFloor;
}
/** The floors that apply to one run (`floorSection`). */
export interface FloorSection {
  /** `engine` for the PIG block, else the block's key (`mutopia`). */
  name: string;
  metrics: Partial<Record<Metric, number>>;
  lintMax?: number;
  eceMax?: number;
  /** Something in the section gates the run. */
  gated: boolean;
  /** The floor file has a block for the run's split (it may still set no metric). */
  found: boolean;
}
export interface AblationRow {
  rule: RuleId;
  gen: number;
  high: number;
  soft: number;
  rec: number;
}

const METRICS = ['gen', 'high', 'soft', 'rec'] as const;
type Metric = (typeof METRICS)[number];

/** Baseline ids of `research/baselines/results_per_piece_test.csv` (docs/research/baselines.md). */
export const FHMM3_ID = 'nakamura_fhmm3'; // "Nakamura FHMM3 (C++)", 65.0 on the test split
export const FINGERFLOW_ID = 'fingerflow_learned'; // "FingerFlow, weights learned on 031-150", 68.6
export const DEFAULT_AGAINST: readonly string[] = Object.freeze([FHMM3_ID, FINGERFLOW_ID]);
/** Bootstrap settings of every comparison (the plan's defaults; the report also drew 10,000). */
const BOOTSTRAP = { resamples: 10000, seed: 1 } as const;

/** Corpora whose runs use `latest.json` and the `engine` floors: PIG, and unnamed splits. */
const PRIMARY_CORPORA: ReadonlySet<string> = new Set(['', 'pig']);

function gitSha(): string {
  try {
    return execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function goldDir(gold: string): string {
  return existsSync(join(gold, 'FingeringFiles')) ? join(gold, 'FingeringFiles') : gold;
}

function readSplit(
  file: string,
  name: string | undefined,
  subset: string,
): { name: string; pieces: string[]; corpus: string } {
  const json = JSON.parse(readFileSync(file, 'utf8')) as {
    dataset?: unknown;
    default_split?: string;
    splits: Record<string, Record<string, { pieces: string[] }>>;
  };
  const n = name ?? json.default_split ?? Object.keys(json.splits)[0]!;
  const part = json.splits[n]?.[subset];
  if (!part) throw new Error(`split ${n}/${subset} not found in ${file}`);
  return { name: n, pieces: part.pieces, corpus: corpusOf(json.dataset) };
}

export type BenchSubset = 'test' | 'train' | 'validation';
export const BENCH_SUBSETS: readonly BenchSubset[] = ['test', 'train', 'validation'];

/** The validation list of a run: `opts.validation`, else `pig_validation.json` next to the split. */
export function validationPath(opts: Pick<BenchOptions, 'split' | 'validation'>): string {
  return opts.validation ?? join(dirname(opts.split), 'pig_validation.json');
}

/**
 * The pieces a run scores: the split's subset, or for `validation` the validation list (sorted),
 * every piece of which must be a train piece of the split and none a test piece.
 */
function readSubset(opts: BenchOptions): { name: string; pieces: string[]; corpus: string } {
  const subset = opts.subset ?? 'test';
  if (subset !== 'validation') return readSplit(opts.split, opts.splitName, subset);
  const train = readSplit(opts.split, opts.splitName, 'train');
  const test = new Set(readSplit(opts.split, opts.splitName, 'test').pieces);
  const file = validationPath(opts);
  const json = JSON.parse(readFileSync(file, 'utf8')) as { pieces?: unknown };
  if (!Array.isArray(json.pieces) || !json.pieces.every((p) => typeof p === 'string'))
    throw new Error(`${file}: expected a "pieces" array of piece ids`);
  const trainSet = new Set(train.pieces);
  const pieces = [...(json.pieces as string[])].sort();
  for (const id of pieces)
    if (test.has(id) || !trainSet.has(id))
      throw new Error(
        `validation piece ${id} in ${file} is not a train piece of ${opts.split} (${test.has(id) ? 'it is a test piece' : 'not in the train subset'})`,
      );
  return { name: train.name, pieces, corpus: train.corpus };
}

/**
 * The corpus a split file describes: the first word of its `dataset` field in lower case
 * (`PIG Dataset v1.2 ...` → `pig`, `Mutopia editorial fingerings ...` → `mutopia`); '' when the
 * field is absent (a synthetic split). It picks the run's milestone file, and its floor block only
 * when no block of the floor file names the split file (`floorSection`).
 */
function corpusOf(dataset: unknown): string {
  const m = typeof dataset === 'string' ? /^[A-Za-z]+/.exec(dataset.trim()) : null;
  return m ? m[0].toLowerCase() : '';
}

/** The scorecard and ablation file directory: the parent of the runs directory. */
export function benchRoot(out = 'benchmarks/runs'): string {
  return dirname(out);
}

/**
 * The milestone scorecard of a run (`BenchOptions.latest`, else by the split's corpus; a
 * validation run gets `-validation` in the name, so it never replaces a test-split scorecard).
 */
export function latestPath(opts: BenchOptions): string {
  if (opts.latest) return opts.latest;
  const { corpus } = readSubset(opts);
  const base = PRIMARY_CORPORA.has(corpus) ? 'latest' : `latest-${corpus}`;
  const name = opts.subset === 'validation' ? `${base}-validation.json` : `${base}.json`;
  return join(benchRoot(opts.out), name);
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Two paths name the same file (resolved against the working directory, as `pnpm verify` runs). */
function sameFile(a: string, b: string): boolean {
  return relative(resolve(a), resolve(b)) === '';
}

/** The PIG section: the `engine` block, the lint gate and the calibration gate. */
function engineSection(floor: FloorFile): FloorSection {
  const metrics: Partial<Record<Metric, number>> = {};
  if (floor.engine) for (const k of METRICS) metrics[k] = floor.engine[k]!;
  const lintMax = floor.lint?.errorsPer1000Max;
  const eceMax = floor.calibration?.eceMax;
  const gated = Boolean(floor.engine) || lintMax !== undefined || eceMax !== undefined;
  return {
    name: 'engine',
    metrics,
    ...(lintMax !== undefined ? { lintMax } : {}),
    ...(eceMax !== undefined ? { eceMax } : {}),
    gated,
    found: gated,
  };
}

/** Another corpus's block (`mutopia`): its numeric metrics gate, a null metric does not. */
function corpusSection(name: string, block: unknown): FloorSection {
  const metrics: Partial<Record<Metric, number>> = {};
  if (isRecord(block))
    for (const k of METRICS) {
      const v = block[k];
      if (typeof v === 'number' && Number.isFinite(v)) metrics[k] = v;
    }
  return { name, metrics, gated: Object.keys(metrics).length > 0, found: isRecord(block) };
}

/**
 * The floors a run is held to, chosen by the run's split file (M3 Task 9): the block other than
 * `engine` whose `split` is that file (`mutopia`), else the PIG section (`engine`, the lint and
 * calibration gates) when floor.json's own `split` is that file. Only when no block names the
 * file does the corpus word of the split's free-text `dataset` field decide (`corpusOf`: PIG and
 * unnamed splits get the PIG section, another word the block of that name). `found` is false when
 * the floor file has no block for the run; `gated` when nothing in the block applies.
 */
export function floorSection(
  floor: FloorFile,
  run: { file: string; corpus: string },
): FloorSection {
  for (const [name, block] of Object.entries(floor))
    if (
      name !== 'engine' &&
      isRecord(block) &&
      typeof block.split === 'string' &&
      sameFile(block.split, run.file)
    )
      return corpusSection(name, block);
  if (typeof floor.split === 'string' && sameFile(floor.split, run.file))
    return engineSection(floor);
  if (PRIMARY_CORPORA.has(run.corpus)) return engineSection(floor);
  return corpusSection(run.corpus, (floor as unknown as Record<string, unknown>)[run.corpus]);
}

/**
 * A weight set by id (`WEIGHT_SETS`) or from a weight-set file (checked by `validateWeightSet`);
 * default `RECOMMENDED_WEIGHT_SET`. Throws on a value that is neither.
 */
export function resolveWeightSet(spec?: string): { set: WeightSetFile; file?: string } {
  const id = spec ?? RECOMMENDED_WEIGHT_SET;
  if (Object.hasOwn(WEIGHT_SETS, id)) return { set: loadWeightSet(id as WeightSetId) };
  if (existsSync(id))
    return { set: validateWeightSet(JSON.parse(readFileSync(id, 'utf8')), id), file: id };
  throw new Error(
    `--weights ${id}: neither a weight set id (${Object.keys(WEIGHT_SETS).join(', ')}) nor a weight-set file`,
  );
}

/** sha256 (16 hex digits) of the weights in `RULE_IDS` order. */
function hashWeights(w: RuleWeights): string {
  const sorted: Record<string, number> = {};
  for (const id of RULE_IDS) sorted[id] = w[id];
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
}

/**
 * Rows of a plain CSV file (a header line, comma-separated fields, no quoting: the baselines
 * CSV has none, and a quote is an error rather than a silently split field) as objects keyed by
 * the header.
 */
export function parseCsv(file: string): Array<Record<string, string>> {
  const text = readFileSync(file, 'utf8');
  if (text.includes('"')) throw new Error(`${file}: quoted CSV fields are not supported`);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error(`${file}: empty CSV`);
  const header = lines[0]!.split(',').map((h) => h.trim());
  return lines.slice(1).map((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    if (cells.length !== header.length)
      throw new Error(
        `${file}: line ${i + 2} has ${cells.length} fields, the header ${header.length}`,
      );
    return Object.fromEntries(header.map((h, k) => [h, cells[k]!]));
  });
}

/**
 * Per-piece M_gen in percent (`official_m_gen` × 100) of each baseline of `against`, by piece id,
 * checked against the pieces the run is asked for: a baseline id the CSV lacks, a piece listed
 * twice, a value outside [0, 1], a requested piece without a row, or a row for a piece the run
 * does not score stops the comparison (M3 Review Focus 5: pairs are never dropped silently).
 */
function baselineTable(
  file: string,
  against: readonly string[],
  ids: readonly string[],
): Map<string, Map<string, number>> {
  const rows = parseCsv(file);
  const wanted = new Set(ids);
  const table = new Map<string, Map<string, number>>(against.map((b) => [b, new Map()]));
  for (const r of rows) {
    const byPiece = table.get(r.baseline ?? '');
    if (!byPiece) continue;
    const { piece, official_m_gen: raw } = r;
    if (piece === undefined || raw === undefined)
      throw new Error(`compare: ${file} needs the columns baseline, piece and official_m_gen`);
    const v = Number(raw);
    if (raw === '' || !(Number.isFinite(v) && v >= 0 && v <= 1))
      throw new Error(
        `compare: ${file}: ${r.baseline} piece ${piece} official_m_gen ${raw} is not in [0, 1]`,
      );
    if (byPiece.has(piece))
      throw new Error(`compare: ${file} lists piece ${piece} of ${r.baseline} twice`);
    byPiece.set(piece, 100 * v);
  }
  for (const [b, byPiece] of table) {
    if (byPiece.size === 0) throw new Error(`compare: baseline ${b} has no rows in ${file}`);
    for (const id of ids)
      if (!byPiece.has(id))
        throw new Error(`compare: baseline ${b} is missing piece ${id} in ${file}`);
    for (const piece of [...byPiece.keys()].sort())
      if (!wanted.has(piece))
        throw new Error(
          `compare: the run is missing piece ${piece} that baseline ${b} has in ${file} (a --limit or another split?)`,
        );
  }
  return table;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The two largest weighted terms of a note's explanation, or "no cost" when every term is 0. */
function topTerms(ex: NoteExplanation | undefined): string {
  const terms = (ex?.terms ?? [])
    .filter((t) => t.weighted !== 0)
    .sort((x, y) => Math.abs(y.weighted) - Math.abs(x.weighted))
    .slice(0, 2)
    .map((t) => `${t.rule} ${t.weighted.toFixed(1)}`);
  return terms.length > 0 ? terms.join(', ') : 'no cost';
}

/**
 * Why the engine did not choose finger `f` for a note it gave `ours`: the cost gap of `f` against
 * `ours` (`relativeGap`), or the earlier note that still holds `f`, or pinned.
 */
function whyNot(
  pinned: boolean,
  ex: NoteExplanation | undefined,
  f: Finger,
  ours: Finger | undefined,
): string {
  if (pinned) return 'pinned';
  const gap = relativeGap(ex, f, ours);
  const cost = gap === undefined ? '' : Number.isFinite(gap) ? signed1(gap) : 'impossible';
  const holder = ex?.heldBy?.find((h) => h.finger === f);
  if (holder) return `held note ${holder.noteId}${cost ? ` (${cost})` : ''}`;
  return cost || '?';
}

/** A signed number with one decimal (`+3.6`, `-0.5`, `+0.0`). */
const signed1 = (x: number): string => (x >= 0 ? '+' : '') + x.toFixed(1);

/**
 * The cost gap of finger `f` (`gap`, by default its `NoteExplanation.gaps` entry, which is measured
 * against the cheapest finger) minus the gap of the engine's finger `ours`: what `f` costs against
 * the finger the engine chose. The gaps come from the decode before the consistency pass, so the
 * engine's own gap is 0 unless the pass moved the note, and then the result is negative for a
 * finger that costs less on its own. When `ours` has no finite gap the raw gap is returned.
 */
function relativeGap(
  ex: NoteExplanation | undefined,
  f: Finger,
  ours: Finger | undefined,
  gap: number | undefined = ex?.gaps?.[f - 1],
): number | undefined {
  const base = ours === undefined ? undefined : ex?.gaps?.[ours - 1];
  if (gap === undefined || base === undefined || !Number.isFinite(base)) return gap;
  return gap - base;
}

/** How `scorePiece` solves and scores: the hand profile, the weight set and its overrides. */
export interface ScoreOptions {
  profile: HandProfileId;
  weightSet: WeightSetFile;
  /** Weights that replace the set's, id by id (ablation). */
  overrides?: Partial<Record<RuleId, number>>;
  /** See `BenchOptions.mask` (default true). */
  mask?: boolean;
}

/**
 * Scores one piece: the first gold file's notes are the score, every gold file of the piece
 * (`<id>-<k>_fingering.txt`, in name order) is a ground truth. Returns `skipped` with the reason
 * when the piece has no gold file, its gold files disagree on the note count, no note is fingered
 * by every annotation, or (masking off) some gold note has no finger; and a Markdown error gallery
 * when the engine differs from any annotator on any scored note.
 */
export function scorePiece(
  id: string,
  dir: string,
  opts: ScoreOptions,
): {
  result?: PieceResult;
  skipped?: string;
  gallery?: string;
  /** Calibration samples of the scored notes (`confidenceSample`), with every result. */
  samples?: ConfidenceSample[];
} {
  const pattern = new RegExp(`^${escapeRegExp(id)}-\\d+_fingering\\.txt$`);
  const files = readdirSync(dir)
    .filter((f) => pattern.test(f))
    .sort();
  if (files.length === 0) return { skipped: 'no gold files' };
  const golds = files.map((f) => parsePig(readFileSync(join(dir, f), 'utf8')));
  const n = golds[0]!.score.notes.length;
  const bad = golds.find((g) => g.score.notes.length !== n);
  if (bad) return { skipped: `annotation note counts differ (${n} vs ${bad.score.notes.length})` };
  const score = golds[0]!.score;
  const goldSeqs = golds.map((g) => {
    const pairs = alignScores(g.score, score);
    const map = new Map(pairs.map(([gid, sid]) => [sid, gid]));
    return score.notes.map((note) => g.assignment[map.get(note.id)!]?.finger);
  });
  // A note any annotation leaves without a finger is unknown: masked out of every metric (as
  // `metricsForScores` does) and of the gallery, or, with masking off, the piece is not scored.
  const unknown = score.notes.map((_, i) => goldSeqs.some((g) => g[i] === undefined));
  const masked = unknown.filter(Boolean).length;
  if (masked > 0 && opts.mask === false)
    return { skipped: `${masked} gold notes without a finger (masking is off)` };
  if (masked === n) return { skipped: 'no note is fingered by every annotation' };
  const t0 = performance.now();
  const { assignment, explanations } = solveFingering(score, {
    profile: opts.profile,
    weightSet: opts.weightSet,
    ...(opts.overrides ? { weights: opts.overrides } : {}),
  });
  const ms = performance.now() - t0;
  const pred = { score, assignment };
  const m = metricsForScores(pred, golds);
  const predSeq = fingerSeq(score, assignment);
  // Calibration samples (M3 Task 6): each scored note's cost gaps, engine finger and annotator
  // fingers; `confidenceSample` masks the same notes as the metrics.
  const samples = score.notes.flatMap((note, i) => {
    const s = confidenceSample(
      explanations[note.id]?.gaps,
      predSeq[i],
      goldSeqs.map((g) => g[i]),
    );
    return s ? [s] : [];
  });
  const he = hardErrors(predSeq, goldSeqs);
  const lint = lintFingering(score, assignment, { profile: opts.profile });
  const result: PieceResult = {
    id,
    notes: m.notes,
    scoreNotes: n,
    annotators: golds.length,
    gen: 100 * m.gen,
    high: 100 * m.high,
    soft: 100 * m.soft,
    rec: 100 * m.rec,
    hardErrorRate: 100 * he.rate,
    lintErrors: lint.errors,
    lintWarnings: lint.warnings,
    ms,
  };
  // Gallery rows: every scored note where the engine differs from at least one annotator, hard
  // errors (all annotators agree and the engine differs) first, then in note order. A row says
  // where the note is (bar when the score has bars, onset, and the two notes of the same hand on
  // each side with their engine fingers), why the engine chose its finger (confidence, the top
  // weighted terms or "no cost", the runner-up fingers) and why each annotator finger lost (its
  // cost gap, the held note that keeps it, "pinned" or "impossible").
  const handIndex = new Map<string, number[]>();
  score.notes.forEach((note, i) => {
    const list = handIndex.get(note.hand) ?? [];
    list.push(i);
    handIndex.set(note.hand, list);
  });
  const posInHand = new Map<number, number>();
  for (const list of handIndex.values()) list.forEach((i, k) => posInHand.set(i, k));
  const rows: Array<{ hard: boolean; text: string }> = [];
  score.notes.forEach((note, i) => {
    if (unknown[i]) return;
    const ours = predSeq[i];
    const theirs = goldSeqs.map((g) => g[i]);
    if (theirs.every((f) => f === ours)) return;
    const hard =
      theirs.length >= 2 &&
      theirs.every((f) => f !== undefined && f === theirs[0]) &&
      theirs[0] !== ours;
    const a = assignment[note.id];
    const ex = explanations[note.id];
    const bar = score.measures.length > 0 ? String(note.measureIndex + 1) : '-';
    const same = handIndex.get(note.hand)!;
    const k = posInHand.get(i)!;
    const context = same
      .slice(Math.max(0, k - 2), k + 3)
      .map((j) =>
        j === i
          ? `[${formatPigPitch(note.spelling)}]`
          : `${formatPigPitch(score.notes[j]!.spelling)}:${predSeq[j] ?? '-'}`,
      )
      .join(' ');
    const alternatives =
      (a?.alternatives ?? [])
        .map((x) => `${x.finger} ${signed1(relativeGap(ex, x.finger, ours, x.cost)!)}`)
        .join(', ') || '-';
    const why = [...new Set(theirs)]
      .filter((f): f is Finger => f !== undefined && f !== ours)
      .map((f) => `${f}: ${whyNot(a?.pinned === true, ex, f, ours)}`)
      .join('; ');
    rows.push({
      hard,
      text: `| ${i} | ${bar} | ${note.onsetSec.toFixed(2)} | ${note.hand} | ${formatPigPitch(note.spelling)} | ${context} | ${ours ?? '-'} (${Math.round(100 * (a?.confidence ?? 0))}%) ${topTerms(ex)} | ${alternatives} | ${theirs.map((f) => f ?? '-').join(' ')} | ${why} | ${hard ? 'hard' : ''} |`,
    });
  });
  const maskedNote =
    masked > 0
      ? [
          '',
          `${masked} of ${n} notes have no finger in some annotation; they are left out of the metrics and of this table.`,
        ]
      : [];
  const gallery =
    rows.length === 0
      ? undefined
      : [
          `# Piece ${id}`,
          '',
          `gen ${result.gen.toFixed(2)} high ${result.high.toFixed(2)} soft ${result.soft.toFixed(2)} rec ${result.rec.toFixed(2)} hard-error ${result.hardErrorRate.toFixed(2)} notes ${result.notes} annotators ${golds.length}`,
          ...maskedNote,
          '',
          'Context: two notes of the same hand on each side as pitch:engine finger, the note itself in brackets. Runner-up and why not: the cost gap of that finger against the engine finger (min-sum marginals of the decode before the consistency pass, so negative where the pass gave the note a finger that costs more on its own, to finger a repeated passage alike), or the id of the earlier note that still holds that finger (held note), or pinned.',
          '',
          '| # | bar | onset s | hand | pitch | context | engine (confidence) top terms | runner-up | annotators | why not | hard |',
          '|---|---|---|---|---|---|---|---|---|---|---|',
          ...rows.sort((x, y) => Number(y.hard) - Number(x.hard)).map((r) => r.text),
        ].join('\n') + '\n';
  return gallery ? { result, gallery, samples } : { result, samples };
}

export function runBench(opts: BenchOptions): {
  scorecard: Scorecard;
  floorBreaches: string[];
  galleryDir: string;
} {
  const subset = opts.subset ?? 'test';
  if (subset === 'validation' && opts.floor)
    throw new Error(
      '--floor gates the test split: a --subset validation run is reported, never gated',
    );
  const split = readSubset(opts);
  const profile = opts.profile ?? 'large';
  const label = (opts.label ?? 'bench') + (opts.limit ? `-limit${opts.limit}` : '');
  const dir = goldDir(opts.gold);
  const out = opts.out ?? 'benchmarks/runs';
  const { set, file: setFile } = resolveWeightSet(opts.weights);
  const ids = split.pieces.slice(0, opts.limit ?? split.pieces.length);
  if (opts.against && !opts.compare) throw new Error('--against needs --compare');
  const against = opts.against ?? DEFAULT_AGAINST;
  // Read and pair the baselines before the run, so a bad CSV stops it early.
  const table = opts.compare ? baselineTable(opts.compare, against, ids) : undefined;
  const galleryDir = join(benchRoot(out), 'errors', label);
  mkdirSync(out, { recursive: true });
  mkdirSync(galleryDir, { recursive: true });
  const pieces: PieceResult[] = [];
  const skipped: Scorecard['skipped'] = [];
  const samples: ConfidenceSample[] = [];
  const t0 = performance.now();
  for (const id of ids) {
    const r = scorePiece(id, dir, { profile, weightSet: set, mask: opts.mask ?? true });
    for (const s of r.samples ?? []) samples.push(s);
    if (r.result) pieces.push(r.result);
    else skipped.push({ id, reason: r.skipped ?? 'unknown' });
    const page = join(galleryDir, `${id}.md`);
    // A page left over from an earlier run under the same label would describe errors that are gone.
    if (r.gallery) writeFileSync(page, r.gallery);
    else rmSync(page, { force: true });
  }
  const totalMs = performance.now() - t0;
  const mean = (k: keyof PieceResult) =>
    pieces.length ? pieces.reduce((s, p) => s + (p[k] as number), 0) / pieces.length : 0;
  const notes = pieces.reduce((s, p) => s + p.notes, 0);
  const scoreNotes = pieces.reduce((s, p) => s + p.scoreNotes, 0);
  const weighted = (k: keyof PieceResult) =>
    notes ? pieces.reduce((s, p) => s + (p[k] as number) * p.notes, 0) / notes : 0;
  const per1000 = (k: 'lintErrors' | 'lintWarnings' | 'ms') =>
    scoreNotes ? (1000 * pieces.reduce((s, p) => s + p[k], 0)) / scoreNotes : 0;
  const hash = hashWeights(set.weights);
  let comparisons: Comparison[] | undefined;
  if (table) {
    // Every piece was paired before the run; a piece the run then skipped has no score to pair.
    const first = skipped[0];
    if (first)
      throw new Error(
        `compare: the run is missing piece ${first.id} that the baselines have (skipped: ${first.reason})`,
      );
    const ours = [...pieces].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    comparisons = against.map((baseline) => {
      const theirs = table.get(baseline)!;
      const r = pairedBootstrap(
        ours.map((p) => p.gen),
        ours.map((p) => theirs.get(p.id)!),
        BOOTSTRAP,
      );
      return { baseline, metric: 'gen', delta: r.delta, ci95: r.ci95, pieces: r.n };
    });
  }
  const scorecard: Scorecard = {
    version: 1,
    engineVersion: ENGINE_VERSION,
    gitSha: gitSha(),
    label,
    timestamp: new Date().toISOString(),
    split: { file: opts.split, name: split.name, subset, corpus: split.corpus },
    profile,
    weightsHash: hash,
    weightSet: {
      id: set.id,
      hash,
      temperature: set.confidenceTemperature,
      ...(setFile ? { file: setFile } : {}),
    },
    macro: {
      gen: mean('gen'),
      high: mean('high'),
      soft: mean('soft'),
      rec: mean('rec'),
      hardErrorRate: mean('hardErrorRate'),
    },
    noteWeighted: {
      gen: weighted('gen'),
      high: weighted('high'),
      soft: weighted('soft'),
      rec: weighted('rec'),
    },
    lint: { errorsPer1000: per1000('lintErrors'), warningsPer1000: per1000('lintWarnings') },
    timing: {
      totalMs,
      msPerPiece: pieces.length ? totalMs / pieces.length : 0,
      msPer1000Notes: per1000('ms'),
    },
    ...(comparisons ? { comparisons } : {}),
    calibration: { ...calibrate(samples, set.confidenceTemperature), correct: CALIBRATION_CORRECT },
    ...(opts.library ? { library: libraryRepeats(opts.library, { profile, weightSet: set }) } : {}),
    pieces,
    skipped,
  };
  writeFileSync(
    join(out, `${scorecard.gitSha.slice(0, 7)}-${label}.json`),
    JSON.stringify(scorecard, null, 2),
  );
  if (opts.scorecard) {
    mkdirSync(dirname(opts.scorecard), { recursive: true });
    writeFileSync(opts.scorecard, JSON.stringify(scorecard, null, 2));
  }
  // Only a labelled full run (a milestone) replaces the milestone scorecard (latest.json for PIG,
  // latest-<corpus>.json for another corpus), which later runs print their deltas against; the
  // runs of `pnpm verify` (`--scorecard benchmarks/runs/verify-*.json`) leave it alone.
  if (!opts.limit && opts.label !== undefined && !opts.scorecard)
    writeFileSync(latestPath(opts), JSON.stringify(scorecard, null, 2));
  const floorBreaches: string[] = [];
  if (opts.floor && existsSync(opts.floor)) {
    const floor = JSON.parse(readFileSync(opts.floor, 'utf8')) as FloorFile;
    const section = floorSection(floor, { file: opts.split, corpus: split.corpus });
    // An explicit floor file that has a block for this split but no number in it gates nothing:
    // a gate that cannot fail is a configuration error, not a pass.
    if (section.found && !section.gated)
      floorBreaches.push(
        `${opts.floor}: the ${section.name} block for split ${opts.split} sets no metric (every floor in it is null)`,
      );
    // Floors are measured per weight set (plan correction 9): gating another set against them
    // would pass or fail for the wrong reason, and so would gating changed weights under the
    // set's old name (floor.json records the weights' hash next to the set).
    if (section.gated && floor.weightSet !== undefined && floor.weightSet !== set.id)
      floorBreaches.push(
        `weight set ${set.id} is not the floor's ${floor.weightSet} (pass --weights ${floor.weightSet})`,
      );
    else if (section.gated && floor.weightSetHash !== undefined && floor.weightSetHash !== hash)
      floorBreaches.push(
        `weight set ${set.id} hash ${hash} is not the floor's ${floor.weightSetHash} (the weights changed since the floors were measured: re-measure them and record the new hash)`,
      );
    for (const k of METRICS) {
      const f = section.metrics[k];
      if (f !== undefined && scorecard.macro[k] < f - 0.005)
        floorBreaches.push(`${k} ${scorecard.macro[k].toFixed(2)} below floor ${f.toFixed(2)}`);
    }
    const lintMax = section.lintMax;
    if (lintMax !== undefined && scorecard.lint.errorsPer1000 > lintMax + 0.005)
      floorBreaches.push(
        `lint errors/1000 ${scorecard.lint.errorsPer1000.toFixed(2)} above floor ${lintMax.toFixed(2)}`,
      );
    const eceMax = section.eceMax;
    const ece = scorecard.calibration?.ece;
    if (eceMax !== undefined && ece !== undefined && ece > eceMax + 0.00005)
      floorBreaches.push(`calibration ECE ${ece.toFixed(4)} above floor ${eceMax.toFixed(4)}`);
    // A gated run must score every piece it was asked for: dropping pieces changes the average
    // and can look like progress (M2 Review Focus 5).
    if (Object.keys(section.metrics).length > 0 && skipped.length > 0)
      floorBreaches.push(
        `${skipped.length} of ${ids.length} pieces skipped: ${skipped.map((x) => `${x.id} (${x.reason})`).join(', ')}`,
      );
  }
  return { scorecard, floorBreaches, galleryDir };
}

/**
 * Solves every score of a library manifest and counts its pairs of identical passages fingered
 * alike (`repeatPairs` and `pairConsistency` per hand), and its repeated passages as a reader
 * counts them (`findRepeats` and `repeatConsistency`).
 */
export function libraryRepeats(
  manifest: string,
  solveOpts: SolveOptions,
  set: string = CORE_BENCHMARK_SET,
): LibraryReport {
  const entries = benchmarkEntries(
    JSON.parse(readFileSync(manifest, 'utf8')) as Array<{
      slug: string;
      files: { score: string };
      benchmarkSet?: string | null;
    }>,
    set,
  );
  let pairs = 0;
  let alike = 0;
  let groups = 0;
  let consistent = 0;
  for (const e of entries) {
    const { score } = parseMusicXml(readFileSync(resolve(dirname(manifest), e.files.score)));
    const { assignment } = solveFingering(score, solveOpts);
    for (const hand of ['R', 'L'] as const) {
      const seq = buildHandSequence(score, hand);
      const fingers = seq.notes.map((n) => assignment[n.noteId]!.finger);
      const positions = barPositions(score, seq);
      const p = pairConsistency(repeatPairs(seq, { positions }), fingers);
      pairs += p.pairs;
      alike += p.alike;
      const g = repeatConsistency(findRepeats(seq, { positions }), fingers);
      groups += g.groups;
      consistent += g.consistent;
    }
  }
  return {
    manifest,
    pieces: entries.length,
    pairs,
    alike,
    consistency: pairs ? alike / pairs : 1,
    groups,
    consistent,
  };
}

/** A signed number with two decimals (`+3.62`, `-0.48`). */
const signed = (x: number): string => (x >= 0 ? '+' : '') + x.toFixed(2);

/**
 * The scorecard as text. Deltas are against `previous` only when it was solved with the same
 * weights (`weightSet.hash`): against another set they would mix a weight change into the
 * comparison, so they print `-` and a line names the previous run and its set.
 */
export function formatScorecard(card: Scorecard, previous?: Scorecard, floor?: FloorFile): string {
  const set = card.weightSet;
  const lines = [
    `bench ${card.label} @ ${card.gitSha.slice(0, 7)} engine ${card.engineVersion} profile ${card.profile} split ${card.split.name}/${card.split.subset}: ${card.pieces.length} pieces, ${card.skipped.length} skipped`,
    `weightSet ${set.id} hash ${set.hash} temperature ${set.temperature}${set.file ? ` file ${set.file}` : ''}`,
  ];
  // A scorecard written before M3 Task 5 has no weightSet block, only weightsHash (if that).
  const before = previous as
    (Omit<Scorecard, 'weightSet'> & { weightSet?: Scorecard['weightSet'] }) | undefined;
  const beforeHash = before?.weightSet?.hash ?? before?.weightsHash;
  const comparable = before !== undefined && beforeHash === set.hash;
  if (before)
    lines.push(
      comparable
        ? `deltas against ${before.label} (weight set ${before.weightSet?.id ?? set.id})`
        : `no deltas: the previous scorecard ${before.label} used weight set ${before.weightSet?.id ?? 'unknown'} hash ${beforeHash ?? 'unknown'}`,
    );
  const section = floor ? floorSection(floor, card.split) : undefined;
  lines.push('metric   macro   delta   note-weighted   floor');
  for (const k of METRICS) {
    const d =
      previous && comparable
        ? (card.macro[k] - previous.macro[k]).toFixed(2).padStart(7)
        : '      -';
    const f = section?.metrics[k]?.toFixed(2) ?? 'none';
    lines.push(
      `${k.padEnd(8)} ${card.macro[k].toFixed(2).padStart(6)} ${d}   ${card.noteWeighted[k].toFixed(2).padStart(13)}   ${f}`,
    );
  }
  const lintMax = section?.lintMax;
  lines.push(
    `hard-error rate ${card.macro.hardErrorRate.toFixed(2)}   lint errors/1000 ${card.lint.errorsPer1000.toFixed(2)}${lintMax === undefined ? '' : ` (max ${lintMax.toFixed(2)})`}   warnings/1000 ${card.lint.warningsPer1000.toFixed(2)}   ms/1000 notes ${card.timing.msPer1000Notes.toFixed(1)}`,
  );
  const scored = card.pieces.reduce((s, p) => s + p.notes, 0);
  const all = card.pieces.reduce((s, p) => s + p.scoreNotes, 0);
  if (scored < all)
    lines.push(`masked gold: ${scored} of ${all} notes scored (the rest lack a gold finger)`);
  const cal = card.calibration;
  const eceMax = section?.eceMax;
  if (cal)
    lines.push(
      `calibration ECE ${cal.ece.toFixed(4)} at temperature ${cal.temperature} over ${cal.samples} notes (correct: ${cal.correct})${eceMax === undefined ? '' : ` (max ${eceMax.toFixed(4)})`}`,
    );
  const lib = card.library;
  if (lib)
    lines.push(
      `library repeat consistency ${lib.alike} of ${lib.pairs} pairs of identical passages fingered alike (${(100 * lib.consistency).toFixed(1)}%) over ${lib.pieces} pieces; repeated passages alike ${lib.consistent} of ${lib.groups}`,
    );
  for (const c of card.comparisons ?? [])
    lines.push(
      `Δ${c.metric} vs ${c.baseline}: ${signed(c.delta)} [${signed(c.ci95[0])}, ${signed(c.ci95[1])}] over ${c.pieces} pieces`,
    );
  for (const s of card.skipped) lines.push(`skipped ${s.id}: ${s.reason}`);
  return lines.join('\n');
}

/**
 * Re-runs the subset once with the weight set as is, then once per rule with a non-zero weight in
 * that set with that weight set to 0, and returns the macro deltas (ablated minus base, percent
 * points), most harmful removal first.
 */
export function runAblation(opts: BenchOptions): AblationRow[] {
  const split = readSubset(opts);
  const dir = goldDir(opts.gold);
  const profile = opts.profile ?? 'large';
  const { set } = resolveWeightSet(opts.weights);
  const mask = opts.mask ?? true;
  const ids = split.pieces.slice(0, opts.limit ?? split.pieces.length);
  const run = (overrides?: Partial<Record<RuleId, number>>) => {
    const rs = ids
      .map(
        (id) =>
          scorePiece(id, dir, {
            profile,
            weightSet: set,
            mask,
            ...(overrides ? { overrides } : {}),
          }).result,
      )
      .filter((r): r is PieceResult => r !== undefined);
    const mean = (k: 'gen' | 'high' | 'soft' | 'rec') =>
      rs.length ? rs.reduce((s, p) => s + p[k], 0) / rs.length : 0;
    return { gen: mean('gen'), high: mean('high'), soft: mean('soft'), rec: mean('rec') };
  };
  const base = run();
  const rows: AblationRow[] = [];
  for (const rule of RULE_IDS) {
    if (set.weights[rule] === 0) continue;
    const r = run({ [rule]: 0 });
    rows.push({
      rule,
      gen: r.gen - base.gen,
      high: r.high - base.high,
      soft: r.soft - base.soft,
      rec: r.rec - base.rec,
    });
  }
  return rows.sort((a, b) => a.gen - b.gen);
}

export function formatAblation(rows: AblationRow[]): string {
  const lines = ['ablation (weight set to 0; delta in percent points against the weight set)'];
  lines.push('rule                        gen    high    soft     rec');
  const f = (x: number) => x.toFixed(2).padStart(7);
  for (const r of rows)
    lines.push(`${r.rule.padEnd(24)} ${f(r.gen)} ${f(r.high)} ${f(r.soft)} ${f(r.rec)}`);
  return lines.join('\n');
}
