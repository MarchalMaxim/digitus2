import type { Finger } from '../score/types.js';
import { x14 } from './geometry.js';
import weightsJson from './params/weights-parncutt.json' with { type: 'json' };
import { span } from './spans.js';
import type { HandProfile, SpanTables } from './spans.js';

/**
 * One note as the rule terms see it. `pitch` is already mirrored for the left hand
 * (`124 - midi`); `ioi` is the seconds since the previous slice's onset (0 inside a slice).
 */
export interface NoteView {
  pitch: number;
  black: boolean;
  onsetSec: number;
  offsetSec: number;
  slice: number;
  restBefore: boolean;
  ioi: number;
}

export type RuleId =
  | 'weakFinger'
  | 'weakFifth'
  | 'thumbOnBlack'
  | 'fiveOnBlack' // unary
  | 'stretch'
  | 'smallSpan'
  | 'largeSpan'
  | 'beyondPractical'
  | 'threeToFour'
  | 'fourOnBlack'
  | 'thumbPassing'
  | 'hop'
  | 'repeatedNoteSameFinger'
  | 'repeatedNoteFingerChange' // pair, melodic
  | 'chordStretch'
  | 'chordSmallSpan'
  | 'chordLargeSpan'
  | 'chordBeyondPractical' // pair, within a slice
  | 'handPositionShift' // pair, every case (five-finger-position model)
  | 'positionChangeCount'
  | 'positionChangeSize'
  | 'threeFourFive'
  | 'sameFingerPivot' // triple
  | 'template'; // Task 8 (unary bonus)
export type RuleWeights = Record<RuleId, number>;
export interface Term {
  rule: RuleId;
  points: number;
}
export interface RuleContext {
  tables: SpanTables;
  weights: RuleWeights;
  hopFastSec: number;
  /** Widest interval (semitones) at which a same-finger hop costs the fast-hop points at any IOI. */
  hopStepMax: number;
  repeatFastSec: number;
}

export const PARNCUTT_WEIGHTS: RuleWeights = (weightsJson as { weights: RuleWeights }).weights;

export function makeContext(profile: HandProfile, weights: Partial<RuleWeights> = {}): RuleContext {
  return {
    tables: profile.tables,
    weights: { ...PARNCUTT_WEIGHTS, ...weights },
    hopFastSec: 0.25,
    hopStepMax: 5,
    repeatFastSec: 0.18,
  };
}

const over = (v: number, max: number): number => Math.max(0, v - max);
const under = (v: number, min: number): number => Math.max(0, min - v);
/** A missing neighbour counts as not white. */
const white = (n: NoteView | undefined): boolean => n !== undefined && !n.black;

function push(terms: Term[], rule: RuleId, points: number): void {
  if (points !== 0) terms.push({ rule, points });
}

/** Unary terms (Parncutt rules 6, 10, 11). `prev` and `next` are the sequence neighbours. */
export function unaryTerms(
  ctx: RuleContext,
  n: NoteView,
  f: Finger,
  prev: NoteView | undefined,
  next: NoteView | undefined,
): Term[] {
  const terms: Term[] = [];
  if (f === 4) push(terms, 'weakFinger', 1);
  if (f === 5) push(terms, 'weakFifth', 1);
  if (f === 1 && n.black)
    push(terms, 'thumbOnBlack', 1 + (white(prev) ? 2 : 0) + (white(next) ? 2 : 0));
  if (f === 5 && n.black) push(terms, 'fiveOnBlack', (white(prev) ? 2 : 0) + (white(next) ? 2 : 0));
  return terms;
}

/** Parncutt rules 1 to 3 plus Balliauw's soft beyond-practical rule for interval `i` played g -> f. */
function spanPoints(
  ctx: RuleContext,
  i: number,
  g: Finger,
  f: Finger,
): { stretch: number; small: number; large: number; beyond: number } {
  const t = ctx.tables;
  const theta = g === 1 || f === 1 ? 1 : 2;
  return {
    stretch: over(i, span(t, 'maxComf', g, f)) + under(i, span(t, 'minComf', g, f)),
    small: theta * under(i, span(t, 'minRel', g, f)),
    large: theta * over(i, span(t, 'maxRel', g, f)),
    beyond: over(i, span(t, 'maxPrac', g, f)) + under(i, span(t, 'minPrac', g, f)),
  };
}

/** Implied five-finger-position anchor in white-key units (literature 6.6 item 1). */
function anchor(n: NoteView, f: Finger): number {
  return x14(n.pitch) / 2 - (f - 1);
}

/**
 * Pair terms for note `a` played by finger `g` followed by note `b` played by finger `f`
 * (a before b in sequence order). Chord pairs (same slice) get Balliauw's doubled span terms;
 * melodic pairs get Parncutt rules 1-3, 8, 9, 12, the soft beyond-practical rule, or the hop and
 * repeated-note terms; every pair gets the hand-position shift.
 */
export function pairTerms(
  ctx: RuleContext,
  a: NoteView,
  g: Finger,
  b: NoteView,
  f: Finger,
): Term[] {
  const terms = pairTermsWithoutPosition(ctx, a, g, b, f);
  const shift = Math.abs(anchor(b, f) - anchor(a, g));
  push(terms, 'handPositionShift', b.restBefore ? shift / 2 : shift);
  return terms;
}

function pairTermsWithoutPosition(
  ctx: RuleContext,
  a: NoteView,
  g: Finger,
  b: NoteView,
  f: Finger,
): Term[] {
  const terms: Term[] = [];
  const i = b.pitch - a.pitch;
  if (a.slice === b.slice) {
    const s = spanPoints(ctx, i, g, f);
    push(terms, 'chordStretch', s.stretch);
    push(terms, 'chordSmallSpan', s.small);
    push(terms, 'chordLargeSpan', s.large);
    push(terms, 'chordBeyondPractical', s.beyond);
    return terms;
  }
  if (i === 0) {
    if (g === f && b.ioi < ctx.repeatFastSec) push(terms, 'repeatedNoteSameFinger', 2);
    if (g !== f && b.ioi >= ctx.repeatFastSec) push(terms, 'repeatedNoteFingerChange', 1);
    return terms;
  }
  if (g === f) {
    // A hop within a fourth costs as much at any tempo: another finger or a thumb crossing reaches
    // the key, so the hop only breaks the legato (it must cost more than a thumb crossing, or
    // scales come out 1 2 2 1 1 2 3 4 and arpeggios 5 3 1 1 3 2 1). Only a slow, wider leap is a
    // cheap hand shift.
    const step = Math.abs(i) <= ctx.hopStepMax;
    if (!b.restBefore) push(terms, 'hop', b.ioi < ctx.hopFastSec || step ? 2 : 0.5);
    return terms;
  }
  const s = spanPoints(ctx, i, g, f);
  push(terms, 'stretch', s.stretch);
  push(terms, 'smallSpan', s.small);
  push(terms, 'largeSpan', s.large);
  push(terms, 'beyondPractical', s.beyond);
  if (g === 3 && f === 4) push(terms, 'threeToFour', 1);
  if ((g === 3 && f === 4) || (g === 4 && f === 3)) {
    const noteOf3 = g === 3 ? a : b;
    const noteOf4 = g === 4 ? a : b;
    if (!noteOf3.black && noteOf4.black) push(terms, 'fourOnBlack', 1);
  }
  if ((g === 1 || f === 1) && (f - g) * i < 0) {
    const lower = i < 0 ? b : a;
    const upper = i < 0 ? a : b;
    const lowerFinger = i < 0 ? f : g;
    const upperFinger = i < 0 ? g : f;
    if (lower.black === upper.black) push(terms, 'thumbPassing', 1);
    else if (!lower.black && lowerFinger !== 1 && upper.black && upperFinger === 1)
      push(terms, 'thumbPassing', 3);
  }
  return terms;
}

/**
 * Triple terms (Parncutt rules 4, 5, 7 and Balliauw's same-finger pivot) for fingers h, g, f on
 * notes a, b, c. Only emitted when the three notes are in three different slices.
 */
export function tripleTerms(
  ctx: RuleContext,
  a: NoteView,
  h: Finger,
  b: NoteView,
  g: Finger,
  c: NoteView,
  f: Finger,
): Term[] {
  const terms: Term[] = [];
  if (a.slice === b.slice || b.slice === c.slice || a.slice === c.slice) return terms;
  const t = ctx.tables;
  const i13 = c.pitch - a.pitch;
  const between = b.pitch > Math.min(a.pitch, c.pitch) && b.pitch < Math.max(a.pitch, c.pitch);
  if (c.pitch === a.pitch) {
    if (h !== f) push(terms, 'positionChangeCount', 1);
  } else {
    const maxC = span(t, 'maxComf', h, f);
    const minC = span(t, 'minComf', h, f);
    if (i13 > maxC || i13 < minC) {
      const outsidePrac = i13 > span(t, 'maxPrac', h, f) || i13 < span(t, 'minPrac', h, f);
      push(terms, 'positionChangeCount', g === 1 && between && outsidePrac ? 2 : 1);
      push(terms, 'positionChangeSize', over(i13, maxC) + under(i13, minC));
    }
  }
  // {h,g,f} = {3,4,5}: the only set of three distinct fingers summing to 12 with minimum 3.
  if (new Set([h, g, f]).size === 3 && h + g + f === 12 && Math.min(h, g, f) === 3)
    push(terms, 'threeFourFive', 1);
  if (h === f && a.pitch !== c.pitch && between) push(terms, 'sameFingerPivot', 1);
  return terms;
}

export function weightedSum(ctx: RuleContext, terms: Term[]): number {
  let s = 0;
  for (const t of terms) s += t.points * ctx.weights[t.rule];
  return s;
}
