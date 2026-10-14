import { HAND_PROFILES, span } from '../../fingering/spans.js';
import type { Hand } from '../../score/types.js';
import {
  HAND_MOTION,
  HAND_PATTERNS,
  moveIndex,
  positionIndex,
  spanIndex,
  type HandMotionParams,
  type HandPattern,
} from './motion.js';
import type { QuantizedNote } from './quantize.js';

export const MAX_NOTES_PER_HAND = 5;
export const SPAN_TOLERANCE = 2;
/** maxPrac(1, 5) of the 'large' profile plus SPAN_TOLERANCE: 17 semitones. */
export const MAX_HAND_SPAN = span(HAND_PROFILES.large.tables, 'maxPrac', 1, 5) + SPAN_TOLERANCE;
export const BEAM_WIDTH = 64;
export const VIOLATION_PER_EXTRA_NOTE = 100;

export interface SeparateOptions {
  /** User override: midi < splitMidi goes to the left hand, the rest to the right; no DP. */
  splitMidi?: number;
  /** Default HAND_MOTION. */
  params?: HandMotionParams;
}

interface HandShape {
  centre: number;
  top: number;
  bottom: number;
  span: number;
}
interface Candidate {
  split: number;
  pattern: HandPattern;
  left: HandShape | null;
  right: HandShape | null;
}
interface State {
  cost: number;
  l: number | null;
  r: number | null;
  lTop: number | null;
  rBottom: number | null;
  lastL: number;
  lastR: number;
  pattern: HandPattern;
  prev: number;
  split: number;
}

/**
 * How far a split of one slice is from playable: VIOLATION_PER_EXTRA_NOTE per note beyond
 * MAX_NOTES_PER_HAND plus the semitones beyond MAX_HAND_SPAN, summed over both hands.
 * `pitches` ascending; the lowest `split` go to the left hand.
 */
export function splitViolation(pitches: readonly number[], split: number): number {
  const part = (xs: readonly number[]) =>
    xs.length === 0
      ? 0
      : Math.max(0, xs.length - MAX_NOTES_PER_HAND) * VIOLATION_PER_EXTRA_NOTE +
        Math.max(0, xs[xs.length - 1]! - xs[0]! - MAX_HAND_SPAN);
  return part(pitches.slice(0, split)) + part(pitches.slice(split));
}

/** The splits 0..m of an ascending slice with the least violation (all playable ones, if any). */
export function candidateSplits(pitches: readonly number[]): number[] {
  const all = Array.from({ length: pitches.length + 1 }, (_, s) => ({
    s,
    v: splitViolation(pitches, s),
  }));
  const best = Math.min(...all.map((a) => a.v));
  return all.filter((a) => a.v === best).map((a) => a.s);
}

function shapeOf(pitches: readonly number[]): HandShape | null {
  if (pitches.length === 0) return null;
  const bottom = pitches[0]!;
  const top = pitches[pitches.length - 1]!;
  return { centre: (bottom + top) / 2, top, bottom, span: top - bottom };
}

function candidate(pitches: readonly number[], split: number): Candidate {
  const m = pitches.length;
  return {
    split,
    pattern: split === m ? 'L' : split === 0 ? 'R' : 'LR',
    left: shapeOf(pitches.slice(0, split)),
    right: shapeOf(pitches.slice(split)),
  };
}

/** One transition of the DP; every table term is -log p (positive), in nats. */
function step(P: HandMotionParams, st: State, c: Candidate, t: number): State {
  let cost = st.cost - Math.log(P.pattern[st.pattern][c.pattern]);
  let l = st.l;
  let r = st.r;
  let lTop = st.lTop;
  let rBottom = st.rBottom;
  let lastL = st.lastL;
  let lastR = st.lastR;
  if (c.left) {
    cost -= Math.log(
      l === null
        ? P.positionLeft[positionIndex(c.left.centre)]!
        : P.moveLeft[moveIndex(c.left.centre - l)]!,
    );
    cost -= Math.log(P.spanLeft[spanIndex(c.left.span)]!);
    l = c.left.centre;
    lTop = c.left.top;
    lastL = t;
  } else if (t - lastL > P.idleSec) cost += P.nu;
  if (c.right) {
    cost -= Math.log(
      r === null
        ? P.positionRight[positionIndex(c.right.centre)]!
        : P.moveRight[moveIndex(c.right.centre - r)]!,
    );
    cost -= Math.log(P.spanRight[spanIndex(c.right.span)]!);
    r = c.right.centre;
    rBottom = c.right.bottom;
    lastR = t;
  } else if (t - lastR > P.idleSec) cost += P.nu;
  if (lTop !== null && rBottom !== null && lTop > rBottom) cost += P.mu;
  return { cost, l, r, lTop, rBottom, lastL, lastR, pattern: c.pattern, prev: -1, split: c.split };
}

const orNull = (x: number | null) => (x === null ? -1 : x);
/** Total order on states: cost, then the state fields, then the predecessor (deterministic). */
function compareStates(a: State, b: State): number {
  return (
    a.cost - b.cost ||
    orNull(a.l) - orNull(b.l) ||
    orNull(a.r) - orNull(b.r) ||
    orNull(a.lTop) - orNull(b.lTop) ||
    orNull(a.rBottom) - orNull(b.rBottom) ||
    HAND_PATTERNS.indexOf(a.pattern) - HAND_PATTERNS.indexOf(b.pattern) ||
    a.prev - b.prev ||
    a.split - b.split
  );
}

/**
 * Assigns each note to a hand (result aligned with `notes`). Slices are the distinct onsets; a
 * slice's notes are sorted by pitch and a split sends the lowest ones to the left hand. A beam of
 * BEAM_WIDTH states over (left centre, right centre, left top, right bottom, pattern) minimises
 * the learned pattern, movement, first-position and span costs plus the crossing penalty mu and
 * the idle penalty nu (plan decision 1; literature section 6.7). With `splitMidi` the DP is skipped.
 */
export function separateHands(notes: readonly QuantizedNote[], opts: SeparateOptions = {}): Hand[] {
  if (opts.splitMidi !== undefined) {
    const split = opts.splitMidi;
    return notes.map((n) => (n.midi < split ? 'L' : 'R'));
  }
  const P = opts.params ?? HAND_MOTION;
  const hands: Hand[] = notes.map(() => 'R');
  if (notes.length === 0) return hands;
  const order = notes
    .map((_, i) => i)
    .sort((a, b) => notes[a]!.onset - notes[b]!.onset || notes[a]!.midi - notes[b]!.midi || a - b);
  const slices: number[][] = [];
  for (const i of order) {
    const last = slices[slices.length - 1];
    if (last && notes[last[0]!]!.onset === notes[i]!.onset) last.push(i);
    else slices.push([i]);
  }
  const t0 = notes[slices[0]![0]!]!.onsetSec;
  let beam: State[] = [
    {
      cost: 0,
      l: null,
      r: null,
      lTop: null,
      rBottom: null,
      lastL: t0,
      lastR: t0,
      pattern: 'LR',
      prev: -1,
      split: -1,
    },
  ];
  const history: State[][] = [];
  for (const slice of slices) {
    const pitches = slice.map((i) => notes[i]!.midi);
    const t = notes[slice[0]!]!.onsetSec;
    const candidates = candidateSplits(pitches).map((s) => candidate(pitches, s));
    const next = new Map<string, State>();
    beam.forEach((st, index) => {
      for (const c of candidates) {
        const s = step(P, st, c, t);
        s.prev = index;
        const key = `${s.l}|${s.r}|${s.lTop}|${s.rBottom}|${s.pattern}`;
        const old = next.get(key);
        if (!old || compareStates(s, old) < 0) next.set(key, s);
      }
    });
    beam = [...next.values()].sort(compareStates).slice(0, BEAM_WIDTH);
    history.push(beam);
  }
  let k = 0;
  for (let si = slices.length - 1; si >= 0; si--) {
    const st = history[si]![k]!;
    slices[si]!.forEach((noteIndex, j) => {
      hands[noteIndex] = j < st.split ? 'L' : 'R';
    });
    k = st.prev;
  }
  return hands;
}
