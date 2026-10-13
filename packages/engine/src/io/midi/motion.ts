import type { Hand, Score } from '../../score/types.js';
import handMotionJson from './params/hand-motion.json' with { type: 'json' };

export const MOVE_RANGE = 24;
export const SPAN_CAP = 24;
export const POSITION_MIN = 21;
export const POSITION_MAX = 108;
export type HandPattern = 'L' | 'R' | 'LR';
export const HAND_PATTERNS: readonly HandPattern[] = ['L', 'R', 'LR'];

export interface HandMotionTables {
  moveLeft: number[];
  moveRight: number[];
  spanLeft: number[];
  spanRight: number[];
  positionLeft: number[];
  positionRight: number[];
  pattern: Record<HandPattern, Record<HandPattern, number>>;
}
export type HandMotionCounts = HandMotionTables;
export interface HandMotionParams extends HandMotionTables {
  mu: number;
  nu: number;
  idleSec: number;
}

const TABLE_SIZES = {
  moveLeft: 2 * MOVE_RANGE + 1,
  moveRight: 2 * MOVE_RANGE + 1,
  spanLeft: SPAN_CAP + 1,
  spanRight: SPAN_CAP + 1,
  positionLeft: POSITION_MAX - POSITION_MIN + 1,
  positionRight: POSITION_MAX - POSITION_MIN + 1,
} as const;
type TableName = keyof typeof TABLE_SIZES;
const TABLE_NAMES = Object.keys(TABLE_SIZES) as TableName[];

function fail(field: string, why: string): never {
  throw new Error(`invalid hand-motion parameters: ${field} ${why}`);
}

function distribution(value: unknown, field: string, size: number): number[] {
  if (!Array.isArray(value) || value.length !== size) fail(field, `must have ${size} entries`);
  const xs = value as unknown[];
  if (!xs.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0))
    fail(field, 'must hold positive numbers');
  const total = (xs as number[]).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 1e-6) fail(field, `must sum to 1 (got ${total})`);
  return [...(xs as number[])];
}

export function loadHandMotion(raw: unknown): HandMotionParams {
  if (typeof raw !== 'object' || raw === null) fail('file', 'must be an object');
  const r = raw as Record<string, unknown>;
  const tables = {} as Record<TableName, number[]>;
  for (const name of TABLE_NAMES) tables[name] = distribution(r[name], name, TABLE_SIZES[name]);
  const p = r.pattern as Record<string, unknown> | undefined;
  if (typeof p !== 'object' || p === null) fail('pattern', 'must be an object');
  const pattern = {} as Record<HandPattern, Record<HandPattern, number>>;
  for (const a of HAND_PATTERNS) {
    const row = (p as Record<string, unknown>)[a] as Record<string, unknown> | undefined;
    if (typeof row !== 'object' || row === null) fail(`pattern.${a}`, 'must be an object');
    const values = distribution(
      HAND_PATTERNS.map((b) => (row as Record<string, unknown>)[b]),
      `pattern.${a}`,
      HAND_PATTERNS.length,
    );
    pattern[a] = { L: values[0]!, R: values[1]!, LR: values[2]! };
  }
  const number = (field: 'mu' | 'nu' | 'idleSec', min: number, strict: boolean) => {
    const v = r[field];
    if (typeof v !== 'number' || !Number.isFinite(v) || (strict ? v <= min : v < min))
      fail(field, strict ? `must be greater than ${min}` : `must be at least ${min}`);
    return v;
  };
  return {
    ...tables,
    pattern,
    mu: number('mu', 0, false),
    nu: number('nu', 0, false),
    idleSec: number('idleSec', 0, true),
  };
}

export const HAND_MOTION: HandMotionParams = loadHandMotion(handMotionJson);

export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}
export function chordCentre(pitches: readonly number[]): number {
  return (Math.min(...pitches) + Math.max(...pitches)) / 2;
}
export function moveIndex(delta: number): number {
  return Math.max(-MOVE_RANGE, Math.min(MOVE_RANGE, roundHalfUp(delta))) + MOVE_RANGE;
}
export function spanIndex(span: number): number {
  return Math.min(span, SPAN_CAP);
}
export function positionIndex(centre: number): number {
  return Math.max(POSITION_MIN, Math.min(POSITION_MAX, roundHalfUp(centre))) - POSITION_MIN;
}

export function emptyCounts(): HandMotionCounts {
  const tables = {} as Record<TableName, number[]>;
  for (const name of TABLE_NAMES) tables[name] = new Array<number>(TABLE_SIZES[name]).fill(0);
  return {
    ...tables,
    pattern: { L: { L: 0, R: 0, LR: 0 }, R: { L: 0, R: 0, LR: 0 }, LR: { L: 0, R: 0, LR: 0 } },
  };
}

export function addCounts(into: HandMotionCounts, from: HandMotionCounts): void {
  for (const name of TABLE_NAMES) into[name] = into[name].map((x, i) => x + (from[name][i] ?? 0));
  for (const a of HAND_PATTERNS)
    for (const b of HAND_PATTERNS) into.pattern[a][b] += from.pattern[a][b];
}

function bump(table: number[], index: number): void {
  table[index] = (table[index] ?? 0) + 1;
}

export function motionCounts(
  notes: ReadonlyArray<{ onset: number; midi: number; hand: Hand }>,
): HandMotionCounts {
  const counts = emptyCounts();
  const byOnset = new Map<number, Array<{ midi: number; hand: Hand }>>();
  for (const n of notes) {
    const list = byOnset.get(n.onset);
    if (list) list.push(n);
    else byOnset.set(n.onset, [n]);
  }
  const previous: Record<Hand, number | undefined> = { L: undefined, R: undefined };
  let previousPattern: HandPattern = 'LR';
  for (const onset of [...byOnset.keys()].sort((a, b) => a - b)) {
    const slice = byOnset.get(onset)!;
    const left = slice.filter((n) => n.hand === 'L').map((n) => n.midi);
    const right = slice.filter((n) => n.hand === 'R').map((n) => n.midi);
    const pattern: HandPattern = left.length && right.length ? 'LR' : left.length ? 'L' : 'R';
    counts.pattern[previousPattern][pattern]++;
    previousPattern = pattern;
    for (const [hand, pitches] of [
      ['L', left],
      ['R', right],
    ] as const) {
      if (pitches.length === 0) continue;
      const centre = chordCentre(pitches);
      bump(
        hand === 'L' ? counts.spanLeft : counts.spanRight,
        spanIndex(Math.max(...pitches) - Math.min(...pitches)),
      );
      bump(hand === 'L' ? counts.positionLeft : counts.positionRight, positionIndex(centre));
      const before = previous[hand];
      if (before !== undefined)
        bump(hand === 'L' ? counts.moveLeft : counts.moveRight, moveIndex(centre - before));
      previous[hand] = centre;
    }
  }
  return counts;
}

export function scoreMotionCounts(score: Score): HandMotionCounts {
  return motionCounts(score.notes.map((n) => ({ onset: n.onsetTick, midi: n.midi, hand: n.hand })));
}
