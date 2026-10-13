import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hardErrors } from '../src/eval/hardErrors.js';
import { alignScores, fingerSeq, metricsForScores } from '../src/eval/align.js';
import { formatPigPitch } from '../src/score/pitch.js';
import { PARNCUTT_WEIGHTS } from '../src/fingering/rules.js';
import type { RuleId } from '../src/fingering/rules.js';
import type { Finger } from '../src/score/types.js';
import { solveFingering } from '../src/fingering/solve.js';
import type { NoteExplanation } from '../src/fingering/solve.js';
import type { HandProfileId } from '../src/fingering/spans.js';
import { parsePig } from '../src/io/pig/read.js';
import { lintFingering } from '../src/lint/index.js';
import { ENGINE_VERSION } from '../src/version.js';

export interface BenchOptions {
  gold: string;
  split: string;
  splitName?: string;
  subset?: 'test' | 'train';
  floor?: string;
  out?: string;
  label?: string;
  profile?: HandProfileId;
  ablate?: boolean;
  limit?: number;
}
export interface PieceResult {
  id: string;
  notes: number;
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
export interface Scorecard {
  version: 1;
  engineVersion: string;
  gitSha: string;
  label: string;
  timestamp: string;
  split: { file: string; name: string; subset: string };
  profile: string;
  weightsHash: string;
  macro: { gen: number; high: number; soft: number; rec: number; hardErrorRate: number };
  noteWeighted: { gen: number; high: number; soft: number; rec: number };
  lint: { errorsPer1000: number; warningsPer1000: number };
  timing: { totalMs: number; msPerPiece: number; msPer1000Notes: number };
  pieces: PieceResult[];
  skipped: Array<{ id: string; reason: string }>;
}
export interface FloorFile {
  engine: null | Record<string, number>;
  /** Most lint errors per 1000 notes the engine's own output may have (verification spec 2.4). */
  lint?: { errorsPer1000Max?: number };
}
export interface AblationRow {
  rule: RuleId;
  gen: number;
  high: number;
  soft: number;
  rec: number;
}

const METRICS = ['gen', 'high', 'soft', 'rec'] as const;

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
): { name: string; pieces: string[] } {
  const json = JSON.parse(readFileSync(file, 'utf8')) as {
    default_split?: string;
    splits: Record<string, Record<string, { pieces: string[] }>>;
  };
  const n = name ?? json.default_split ?? Object.keys(json.splits)[0]!;
  const part = json.splits[n]?.[subset];
  if (!part) throw new Error(`split ${n}/${subset} not found in ${file}`);
  return { name: n, pieces: part.pieces };
}

/** The scorecard and ablation file directory: the parent of the runs directory. */
export function benchRoot(out = 'benchmarks/runs'): string {
  return dirname(out);
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

/** Why the engine did not choose finger `f` for a note. */
function whyNot(pinned: boolean, ex: NoteExplanation | undefined, f: Finger): string {
  if (pinned) return 'pinned';
  const gap = ex?.gaps?.[f - 1];
  const cost = gap === undefined ? '' : Number.isFinite(gap) ? `+${gap.toFixed(1)}` : 'impossible';
  const holder = ex?.heldBy?.find((h) => h.finger === f);
  if (holder) return `held note ${holder.noteId}${cost ? ` (${cost})` : ''}`;
  return cost || '?';
}

/**
 * Scores one piece: the first gold file's notes are the score, every gold file of the piece
 * (`<id>-<k>_fingering.txt`, in name order) is a ground truth. Returns `skipped` with the reason
 * when the piece has no gold file or its gold files disagree on the note count, and a Markdown
 * error gallery when the engine differs from any annotator on any note.
 */
export function scorePiece(
  id: string,
  dir: string,
  profile: HandProfileId,
  weights?: Partial<Record<RuleId, number>>,
): { result?: PieceResult; skipped?: string; gallery?: string } {
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
  const t0 = performance.now();
  const { assignment, explanations } = solveFingering(
    score,
    weights ? { profile, weights } : { profile },
  );
  const ms = performance.now() - t0;
  const pred = { score, assignment };
  const m = metricsForScores(pred, golds);
  const predSeq = fingerSeq(score, assignment);
  const goldSeqs = golds.map((g) => {
    const pairs = alignScores(g.score, score);
    const map = new Map(pairs.map(([gid, sid]) => [sid, gid]));
    return score.notes.map((note) => g.assignment[map.get(note.id)!]?.finger);
  });
  const he = hardErrors(predSeq, goldSeqs);
  const lint = lintFingering(score, assignment, { profile });
  const result: PieceResult = {
    id,
    notes: n,
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
  // Gallery rows: every note where the engine differs from at least one annotator, hard errors
  // (all annotators agree and the engine differs) first, then in note order. A row says where the
  // note is (bar when the score has bars, onset, and the two notes of the same hand on each side
  // with their engine fingers), why the engine chose its finger (confidence, the top weighted
  // terms or "no cost", the runner-up fingers) and why each annotator finger lost (its cost gap,
  // the held note that keeps it, "pinned" or "impossible").
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
      (a?.alternatives ?? []).map((x) => `${x.finger} +${x.cost.toFixed(1)}`).join(', ') || '-';
    const why = [...new Set(theirs)]
      .filter((f): f is Finger => f !== undefined && f !== ours)
      .map((f) => `${f}: ${whyNot(a?.pinned === true, ex, f)}`)
      .join('; ');
    rows.push({
      hard,
      text: `| ${i} | ${bar} | ${note.onsetSec.toFixed(2)} | ${note.hand} | ${formatPigPitch(note.spelling)} | ${context} | ${ours ?? '-'} (${Math.round(100 * (a?.confidence ?? 0))}%) ${topTerms(ex)} | ${alternatives} | ${theirs.map((f) => f ?? '-').join(' ')} | ${why} | ${hard ? 'hard' : ''} |`,
    });
  });
  const gallery =
    rows.length === 0
      ? undefined
      : [
          `# Piece ${id}`,
          '',
          `gen ${result.gen.toFixed(2)} high ${result.high.toFixed(2)} soft ${result.soft.toFixed(2)} rec ${result.rec.toFixed(2)} hard-error ${result.hardErrorRate.toFixed(2)} notes ${n} annotators ${golds.length}`,
          '',
          'Context: two notes of the same hand on each side as pitch:engine finger, the note itself in brackets. Why not: the cost gap of the annotator finger against the engine finger (min-sum marginals), or the id of the earlier note that still holds that finger (held note), or pinned.',
          '',
          '| # | bar | onset s | hand | pitch | context | engine (confidence) top terms | runner-up | annotators | why not | hard |',
          '|---|---|---|---|---|---|---|---|---|---|---|',
          ...rows.sort((x, y) => Number(y.hard) - Number(x.hard)).map((r) => r.text),
        ].join('\n') + '\n';
  return gallery ? { result, gallery } : { result };
}

export function runBench(opts: BenchOptions): {
  scorecard: Scorecard;
  floorBreaches: string[];
  galleryDir: string;
} {
  const subset = opts.subset ?? 'test';
  const split = readSplit(opts.split, opts.splitName, subset);
  const profile = opts.profile ?? 'large';
  const label = (opts.label ?? 'bench') + (opts.limit ? `-limit${opts.limit}` : '');
  const dir = goldDir(opts.gold);
  const out = opts.out ?? 'benchmarks/runs';
  const galleryDir = join(benchRoot(out), 'errors', label);
  mkdirSync(out, { recursive: true });
  mkdirSync(galleryDir, { recursive: true });
  const pieces: PieceResult[] = [];
  const skipped: Scorecard['skipped'] = [];
  const t0 = performance.now();
  const ids = split.pieces.slice(0, opts.limit ?? split.pieces.length);
  for (const id of ids) {
    const r = scorePiece(id, dir, profile);
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
  const weighted = (k: keyof PieceResult) =>
    notes ? pieces.reduce((s, p) => s + (p[k] as number) * p.notes, 0) / notes : 0;
  const scorecard: Scorecard = {
    version: 1,
    engineVersion: ENGINE_VERSION,
    gitSha: gitSha(),
    label,
    timestamp: new Date().toISOString(),
    split: { file: opts.split, name: split.name, subset },
    profile,
    weightsHash: createHash('sha256')
      .update(JSON.stringify(PARNCUTT_WEIGHTS))
      .digest('hex')
      .slice(0, 16),
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
    lint: {
      errorsPer1000: notes ? (1000 * pieces.reduce((s, p) => s + p.lintErrors, 0)) / notes : 0,
      warningsPer1000: notes ? (1000 * pieces.reduce((s, p) => s + p.lintWarnings, 0)) / notes : 0,
    },
    timing: {
      totalMs,
      msPerPiece: pieces.length ? totalMs / pieces.length : 0,
      msPer1000Notes: notes ? (1000 * pieces.reduce((s, p) => s + p.ms, 0)) / notes : 0,
    },
    pieces,
    skipped,
  };
  writeFileSync(
    join(out, `${scorecard.gitSha.slice(0, 7)}-${label}.json`),
    JSON.stringify(scorecard, null, 2),
  );
  // Only a labelled full run (a milestone) replaces latest.json, the tracked scorecard that later
  // runs print their deltas against; the unlabelled runs of `pnpm verify` leave it alone.
  if (!opts.limit && opts.label !== undefined)
    writeFileSync(join(benchRoot(out), 'latest.json'), JSON.stringify(scorecard, null, 2));
  const floorBreaches: string[] = [];
  if (opts.floor && existsSync(opts.floor)) {
    const floor = JSON.parse(readFileSync(opts.floor, 'utf8')) as FloorFile;
    if (floor.engine)
      for (const k of METRICS)
        if (scorecard.macro[k] < floor.engine[k]! - 0.005)
          floorBreaches.push(
            `${k} ${scorecard.macro[k].toFixed(2)} below floor ${floor.engine[k]!.toFixed(2)}`,
          );
    const lintMax = floor.lint?.errorsPer1000Max;
    if (lintMax !== undefined && scorecard.lint.errorsPer1000 > lintMax + 0.005)
      floorBreaches.push(
        `lint errors/1000 ${scorecard.lint.errorsPer1000.toFixed(2)} above floor ${lintMax.toFixed(2)}`,
      );
    // A gated run must score every piece it was asked for: dropping pieces changes the average
    // and can look like progress (M2 Review Focus 5).
    if (floor.engine && skipped.length > 0)
      floorBreaches.push(
        `${skipped.length} of ${ids.length} pieces skipped: ${skipped.map((x) => `${x.id} (${x.reason})`).join(', ')}`,
      );
  }
  return { scorecard, floorBreaches, galleryDir };
}

export function formatScorecard(card: Scorecard, previous?: Scorecard, floor?: FloorFile): string {
  const lines = [
    `bench ${card.label} @ ${card.gitSha.slice(0, 7)} engine ${card.engineVersion} profile ${card.profile} split ${card.split.name}/${card.split.subset}: ${card.pieces.length} pieces, ${card.skipped.length} skipped`,
  ];
  lines.push('metric   macro   delta   note-weighted   floor');
  for (const k of METRICS) {
    const d = previous ? (card.macro[k] - previous.macro[k]).toFixed(2).padStart(7) : '      -';
    const f = floor?.engine ? floor.engine[k]!.toFixed(2) : 'none';
    lines.push(
      `${k.padEnd(8)} ${card.macro[k].toFixed(2).padStart(6)} ${d}   ${card.noteWeighted[k].toFixed(2).padStart(13)}   ${f}`,
    );
  }
  const lintMax = floor?.lint?.errorsPer1000Max;
  lines.push(
    `hard-error rate ${card.macro.hardErrorRate.toFixed(2)}   lint errors/1000 ${card.lint.errorsPer1000.toFixed(2)}${lintMax === undefined ? '' : ` (max ${lintMax.toFixed(2)})`}   warnings/1000 ${card.lint.warningsPer1000.toFixed(2)}   ms/1000 notes ${card.timing.msPer1000Notes.toFixed(1)}`,
  );
  for (const s of card.skipped) lines.push(`skipped ${s.id}: ${s.reason}`);
  return lines.join('\n');
}

/**
 * Re-runs the subset once with every rule weight as is, then once per non-zero rule with that
 * weight set to 0, and returns the macro deltas (ablated minus base, percent points), most
 * harmful removal first.
 */
export function runAblation(opts: BenchOptions): AblationRow[] {
  const subset = opts.subset ?? 'test';
  const split = readSplit(opts.split, opts.splitName, subset);
  const dir = goldDir(opts.gold);
  const profile = opts.profile ?? 'large';
  const ids = split.pieces.slice(0, opts.limit ?? split.pieces.length);
  const run = (weights?: Partial<Record<RuleId, number>>) => {
    const rs = ids
      .map((id) => scorePiece(id, dir, profile, weights).result)
      .filter((r): r is PieceResult => r !== undefined);
    const mean = (k: 'gen' | 'high' | 'soft' | 'rec') =>
      rs.length ? rs.reduce((s, p) => s + p[k], 0) / rs.length : 0;
    return { gen: mean('gen'), high: mean('high'), soft: mean('soft'), rec: mean('rec') };
  };
  const base = run();
  const rows: AblationRow[] = [];
  for (const rule of Object.keys(PARNCUTT_WEIGHTS) as RuleId[]) {
    if (PARNCUTT_WEIGHTS[rule] === 0) continue;
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
  const lines = ['ablation (weight set to 0; delta in percent points against all rules)'];
  lines.push('rule                        gen    high    soft     rec');
  const f = (x: number) => x.toFixed(2).padStart(7);
  for (const r of rows)
    lines.push(`${r.rule.padEnd(24)} ${f(r.gen)} ${f(r.high)} ${f(r.soft)} ${f(r.rec)}`);
  return lines.join('\n');
}
