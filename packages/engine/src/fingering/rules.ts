import type { Finger } from '../score/types.js';
import { x14 } from './geometry.js';
import weightsJson from './params/weights-parncutt.json' with { type: 'json' };
import { HOLD_EPS, outOfReach } from './reach.js';
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
  | 'chordBeyondPractical'
  | 'doubledFinger' // pair, within a slice
  | 'handPositionShift' // pair, every case (five-finger-position model)
  | 'positionChangeCount'
  | 'positionChangeSize'
  | 'threeFourFive'
  | 'sameFingerPivot' // triple
  | 'template' // Task 8 (unary bonus)
  // M3 features (weight 0 in the Parncutt set; the learned sets give them weights):
  | 'latticeStep'
  | 'levelChange' // pair, melodic, not a repeated key
  | 'stretchFast' // pair, melodic, two fingers
  | 'shiftFast' // pair, across slices
  | 'repeatFast' // pair, repeated key
  | IndicatorRuleId;

type Digit = 1 | 2 | 3 | 4 | 5;
/** Two fingers rising with pitch inside a chord (the chord order): g < f. */
type ChordPair = '12' | '13' | '14' | '15' | '23' | '24' | '25' | '34' | '35' | '45';
/**
 * The M3 indicator features (1 point each): `on:<f>:<colour>` (finger f on a black or white key,
 * unary), `tr:<g><f>:<up|down>` (finger g then f on two notes of different slices, the second
 * higher or lower in mirrored pitch; g = f is a hop), `ch:<g><f>` (neighbouring notes of a slice
 * on fingers g < f).
 */
export type IndicatorRuleId =
  `on:${Digit}:${'black' | 'white'}` | `tr:${Digit}${Digit}:${'up' | 'down'}` | `ch:${ChordPair}`;
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
  /**
   * Widest thumb crossing (semitones) by finger 2, 3 or 4 that pays no beyondPractical: passing
   * the thumb under (or a finger over it) up to a perfect fourth is the standard scale and arpeggio
   * motion, although Parncutt's practical spans for the crossed pairs (3-1: 4, 4-1: 3) are narrower.
   */
  thumbCrossingMax: number;
  /**
   * Points of the template term (times the `template` weight) on a note of a chromatic run that
   * takes the textbook finger; 1 on a scale or arpeggio run. The ergonomic rules price the standard
   * chromatic fingering (3 on black keys, the thumb on white) as a position change at every pivot,
   * so a scale-sized bonus never wins: 6 is the smallest integer at which all 48 chromatic oracle
   * entries come out exact (5.5 gives none), and 8 leaves a margin.
   */
  chromaticTemplatePoints: number;
  repeatFastSec: number;
  /**
   * The hold tolerance of the solver's held-note law (`reach.ts` `forEachHold`): a key whose
   * notated offset is at most this many seconds after a later onset is released, not held under
   * that note. Default `HOLD_EPS` (1 ms). M3 Task 7 H1 tried 50 ms (a legato overlap) and was not
   * kept (docs/experiments.md); the parameter stays for experiments.
   */
  holdEpsSec: number;
}

export const PARNCUTT_WEIGHTS: RuleWeights = (weightsJson as { weights: RuleWeights }).weights;

/** The named rules; a `Record` so the compiler checks the list against `RuleId`. */
const NAMED_RULES: Record<Exclude<RuleId, IndicatorRuleId>, true> = {
  weakFinger: true,
  weakFifth: true,
  thumbOnBlack: true,
  fiveOnBlack: true,
  stretch: true,
  smallSpan: true,
  largeSpan: true,
  beyondPractical: true,
  threeToFour: true,
  fourOnBlack: true,
  thumbPassing: true,
  hop: true,
  repeatedNoteSameFinger: true,
  repeatedNoteFingerChange: true,
  chordStretch: true,
  chordSmallSpan: true,
  chordLargeSpan: true,
  chordBeyondPractical: true,
  doubledFinger: true,
  handPositionShift: true,
  positionChangeCount: true,
  positionChangeSize: true,
  threeFourFive: true,
  sameFingerPivot: true,
  template: true,
  latticeStep: true,
  levelChange: true,
  stretchFast: true,
  shiftFast: true,
  repeatFast: true,
};

// The indicator ids, built once so the term functions look them up instead of building strings in
// the decoder's inner loop. Indexed by finger - 1.
const DIGITS: readonly Digit[] = [1, 2, 3, 4, 5];
/** ON_IDS[f - 1]: `[on:<f>:black, on:<f>:white]`. */
const ON_IDS = DIGITS.map((f) => [`on:${f}:black`, `on:${f}:white`] as const);
/** TR_IDS[g - 1][f - 1]: `[tr:<g><f>:up, tr:<g><f>:down]`. */
const TR_IDS = DIGITS.map((g) =>
  DIGITS.map((f) => [`tr:${g}${f}:up`, `tr:${g}${f}:down`] as const),
);
/** CH_IDS[g - 1][f - 1]: `ch:<g><f>` for g < f, undefined otherwise. */
const CH_IDS = DIGITS.map((g) =>
  DIGITS.map((f) => (g < f ? (`ch:${g}${f}` as `ch:${ChordPair}`) : undefined)),
);

/** Every rule id, sorted by code unit (the order of `featureIds` and of `Array.prototype.sort`). */
export const RULE_IDS: readonly RuleId[] = Object.freeze(
  [
    ...(Object.keys(NAMED_RULES) as RuleId[]),
    ...ON_IDS.flat(),
    ...TR_IDS.flat(2),
    ...CH_IDS.flat().filter((id) => id !== undefined),
  ].sort(),
);

/**
 * The physical rule terms whose weights must stay non-negative during learning (a negative weight
 * would reward the strain the term measures). doubledFinger (the M2 hardening's price of each
 * finger a slice of more than five notes must double) is one of them; repeatedNoteFingerChange is
 * not (its learned weight is negative, learning-prototype.md section 6).
 */
const PENALTY_RULES: ReadonlySet<string> = new Set<RuleId>([
  'stretch',
  'smallSpan',
  'largeSpan',
  'beyondPractical',
  'chordStretch',
  'chordSmallSpan',
  'chordLargeSpan',
  'chordBeyondPractical',
  'doubledFinger',
  'hop',
  'repeatedNoteSameFinger',
  'handPositionShift',
  'positionChangeSize',
  'stretchFast',
  'shiftFast',
]);

/**
 * True for a physical penalty rule (its learned weight is projected to be non-negative); false for
 * the indicators, `template` and the count-style rules.
 */
export function isPenaltyRule(id: string): boolean {
  return PENALTY_RULES.has(id);
}

/** Solver settings that are not weights (`makeContext`). */
export interface ContextSettings {
  /** `RuleContext.holdEpsSec` (default `HOLD_EPS`). */
  holdEpsSec?: number;
}

/** A partial weight set is completed with the Parncutt value of every id it leaves out. */
export function makeContext(
  profile: HandProfile,
  weights: Partial<RuleWeights> = {},
  settings: ContextSettings = {},
): RuleContext {
  return {
    tables: profile.tables,
    weights: { ...PARNCUTT_WEIGHTS, ...weights },
    hopFastSec: 0.25,
    hopStepMax: 5,
    thumbCrossingMax: 5,
    chromaticTemplatePoints: 8,
    repeatFastSec: 0.18,
    holdEpsSec: settings.holdEpsSec ?? HOLD_EPS,
  };
}

/** Seconds a key must be up before the next onset to count as released (as in the sequence). */
const RELEASE_EPS = 1e-3;

/**
 * True when note `a` was released before note `b` starts (`a.offsetSec <= b.onsetSec - 1 ms`):
 * the hand is free to move, so a leap from `a` to `b` is a shift, not a stretch over both keys.
 */
export function isReleased(a: NoteView, b: NoteView): boolean {
  return a.offsetSec <= b.onsetSec - RELEASE_EPS;
}

const over = (v: number, max: number): number => Math.max(0, v - max);
const under = (v: number, min: number): number => Math.max(0, min - v);
/** A missing neighbour counts as not white. */
const white = (n: NoteView | undefined): boolean => n !== undefined && !n.black;

function push(terms: Term[], rule: RuleId, points: number): void {
  if (points !== 0) terms.push({ rule, points });
}

/**
 * Unary terms (Parncutt rules 6, 10, 11) and the key-colour indicator `on:<f>:<colour>`. `prev`
 * and `next` are the sequence neighbours.
 */
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
  push(terms, ON_IDS[f - 1]![n.black ? 0 : 1], 1);
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
 * Balliauw's chord span terms (rule 14: Parncutt rules 1 to 3 and the beyond-practical rule, as
 * chordStretch, chordSmallSpan, chordLargeSpan, chordBeyondPractical) for two notes of one slice,
 * `a` below `b` in (mirrored) pitch, played by fingers g and f. pairTerms charges them for
 * neighbouring chord notes and tripleTerms for notes two apart, so every pair of a chord of up to
 * three notes, and every pair at most two apart in a larger one, is priced (product spec 7.1).
 */
export function chordSpanTerms(
  ctx: RuleContext,
  a: NoteView,
  g: Finger,
  b: NoteView,
  f: Finger,
): Term[] {
  const terms: Term[] = [];
  const s = spanPoints(ctx, b.pitch - a.pitch, g, f);
  push(terms, 'chordStretch', s.stretch);
  push(terms, 'chordSmallSpan', s.small);
  push(terms, 'chordLargeSpan', s.large);
  push(terms, 'chordBeyondPractical', s.beyond);
  return terms;
}

/** IOI (s) at and below which a hand-position shift counts in full in `shiftFast`. */
const SHIFT_FAST_SEC = 0.25;
/** Floor on the IOI in `shiftFast`, so a zero IOI (a grace note) gives a finite factor. */
const MIN_IOI_SEC = 0.01;

/**
 * Pair terms for note `a` played by finger `g` followed by note `b` played by finger `f`
 * (a before b in sequence order). Chord pairs (same slice) get Balliauw's doubled span terms, and
 * `doubledFinger` when they share a finger (1 point for the thumb on two adjacent white keys, the
 * one double lint L01 accepts, 2 otherwise: the price a slice of more than five notes pays for
 * each finger it must double; in a slice of at most five notes the chord law forbids a double, so
 * the term only adds to that penalty); melodic pairs get Parncutt rules 1-3, 8, 9, 12, the soft
 * beyond-practical rule, or the hop and repeated-note terms; every pair gets the hand-position
 * shift. The melodic beyond-practical rule
 * is skipped when the hand is free to move (a rest before `b`, `a` released before `b`, or `a`
 * out of any hand's reach of `b`) and on a thumb crossing by finger 2, 3 or 4 of at most
 * `thumbCrossingMax` semitones.
 *
 * The M3 features (weight 0 in the Parncutt set) ride along: `ch:<g><f>` on a chord pair with
 * g < f; on a melodic pair of two keys (a hop included) the transition indicator
 * `tr:<g><f>:<up|down>`, `latticeStep` (how far the pair is from one white key per finger:
 * |dx - (f - g)| with dx the x14 distance in white keys) and `levelChange` (one key black, the
 * other white); `stretchFast` (the stretch points when `b.ioi < hopFastSec`); `repeatFast` on a
 * repeated key faster than `repeatFastSec`, whatever the fingers; and on every pair across slices
 * `shiftFast`, the hand-position shift times min(1, 0.25 s / IOI) (relocation at speed).
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
  const points = b.restBefore ? shift / 2 : shift;
  push(terms, 'handPositionShift', points);
  if (a.slice !== b.slice)
    push(terms, 'shiftFast', points * Math.min(1, SHIFT_FAST_SEC / Math.max(b.ioi, MIN_IOI_SEC)));
  return terms;
}

function pairTermsWithoutPosition(
  ctx: RuleContext,
  a: NoteView,
  g: Finger,
  b: NoteView,
  f: Finger,
): Term[] {
  const i = b.pitch - a.pitch;
  if (a.slice === b.slice) {
    const chord = chordSpanTerms(ctx, a, g, b, f);
    if (g === f) push(chord, 'doubledFinger', g === 1 && !a.black && !b.black && i <= 2 ? 1 : 2);
    const ch = CH_IDS[g - 1]![f - 1];
    if (ch !== undefined) push(chord, ch, 1);
    return chord;
  }
  const terms: Term[] = [];
  if (i === 0) {
    if (g === f && b.ioi < ctx.repeatFastSec) push(terms, 'repeatedNoteSameFinger', 2);
    if (g !== f && b.ioi >= ctx.repeatFastSec) push(terms, 'repeatedNoteFingerChange', 1);
    if (b.ioi < ctx.repeatFastSec) push(terms, 'repeatFast', 1);
    return terms;
  }
  push(terms, TR_IDS[g - 1]![f - 1]![i > 0 ? 0 : 1], 1);
  push(terms, 'latticeStep', Math.abs((x14(b.pitch) - x14(a.pitch)) / 2 - (f - g)));
  push(terms, 'levelChange', a.black !== b.black ? 1 : 0);
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
  // A thumb crossing: the thumb passes under a finger, or a finger over the thumb. Fingers 2 to 4
  // cross the thumb in scales and arpeggios; the fifth finger does not (maxPrac(5, 1) is 1).
  const crossing = (g === 1 || f === 1) && (f - g) * i < 0;
  const shortCrossing = crossing && g !== 5 && f !== 5 && Math.abs(i) <= ctx.thumbCrossingMax;
  // Beyond the practical span is a stretch over both keys only while the hand holds `a`; after a
  // rest or a release it is a hand shift, which stretch and the relaxed-span terms already price.
  // A hold beyond any hand's reach (`outOfReach`) is a release too, as in the solver's held notes.
  const handFree = b.restBefore || isReleased(a, b) || outOfReach(ctx.tables, a.pitch, b.pitch);
  push(terms, 'stretch', s.stretch);
  push(terms, 'smallSpan', s.small);
  push(terms, 'largeSpan', s.large);
  if (!handFree && !shortCrossing) push(terms, 'beyondPractical', s.beyond);
  if (b.ioi < ctx.hopFastSec) push(terms, 'stretchFast', s.stretch);
  if (g === 3 && f === 4) push(terms, 'threeToFour', 1);
  if ((g === 3 && f === 4) || (g === 4 && f === 3)) {
    const noteOf3 = g === 3 ? a : b;
    const noteOf4 = g === 4 ? a : b;
    if (!noteOf3.black && noteOf4.black) push(terms, 'fourOnBlack', 1);
  }
  if (crossing) {
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
 * Triple terms for fingers h, g, f on notes a, b, c (consecutive in sequence order). Three notes
 * of one slice get the chord span terms of the outer pair a-c (`chordSpanTerms`, M2 hardening:
 * without them a chord's outer pair had no cost at all). Three notes in three different slices get
 * Parncutt rules 4, 5, 7 and Balliauw's same-finger pivot. Any other mix gets nothing.
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
  if (a.slice === b.slice && b.slice === c.slice) return chordSpanTerms(ctx, a, h, c, f);
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
