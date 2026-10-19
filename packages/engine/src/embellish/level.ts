// The level heuristic of content/tools/level.py (`features`, `score`, `propose`, `CUTS`) over the
// engine's `Score`. The floating-point expressions follow level.py's evaluation order, so the score
// rounds to the same three decimals as the recorded `levelProposal`.
//
// Hands as in level.py: staff 1 is the right hand and every other staff the left; a score whose
// notes are all on staff 1 is all right hand. Grace notes are not struck, and the engine reader has
// already merged tied notes into one strike each.
import type { Score } from '../score/types.js';
import { mod } from './frac.js';

export interface LevelFeatures {
  /** Sounding notes per second at the tempo, both hands. */
  nps: number;
  /** Position shifts per 100 onsets (a window of at most 7 semitones), mean of the two hands. */
  shifts: number;
  /** Widest slice struck by one hand, in semitones. */
  span: number;
  /** Share of a hand's onsets that strike two or more keys, the larger hand. */
  chord: number;
  /** Sharps or flats in the first key signature. */
  fifths: number;
  /** Percent of notes outside the major scale of the first key signature. */
  accidentals: number;
  /** Written length (no repeats) at the tempo. */
  seconds: number;
  /** Per 100 onsets, consecutive slice centres more than an octave apart, the larger hand. */
  leaps: number;
}

export const LEVEL_CUTS: readonly number[] = [1.76, 4.09, 9.11, 12.68];

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const WINDOW = 7;

/** `max` of a non-empty list, without spreading it into arguments. */
const maxOf = (xs: readonly number[]) => xs.reduce((m, x) => (x > m ? x : m));
const minOf = (xs: readonly number[]) => xs.reduce((m, x) => (x < m ? x : m));

/** level.py's `features` of a score at `tempoQpm` quarters per minute. */
export function levelFeatures(score: Score, tempoQpm: number): LevelFeatures {
  const fifths = score.keySignatures[0]?.fifths ?? 0;
  const tonic = mod(7 * fifths, 12);
  const scale = new Set(MAJOR.map((d) => mod(tonic + d, 12)));
  const totalTicks = score.measures.reduce((s, m) => s + m.lengthTicks, 0);
  const seconds = ((totalTicks / score.divisions) * 60) / tempoQpm;
  const oneStaff = score.notes.every((n) => n.staff <= 1);
  const hands = new Map<'R' | 'L', Map<number, number[]>>();
  for (const n of score.notes) {
    if (n.isGrace) continue;
    const hand = oneStaff || n.staff === 1 ? 'R' : 'L';
    let slices = hands.get(hand);
    if (!slices) hands.set(hand, (slices = new Map()));
    const slice = slices.get(n.onsetTick);
    if (slice) slice.push(n.midi);
    else slices.set(n.onsetTick, [n.midi]);
  }
  let notes = 0;
  let outside = 0;
  const shifts: number[] = [];
  const spans: number[] = [];
  const chords: number[] = [];
  const leaps: number[] = [];
  for (const slices of hands.values()) {
    const onsets = [...slices.keys()].sort((x, y) => x - y);
    const values = [...slices.values()];
    spans.push(maxOf(values.map((v) => maxOf(v) - minOf(v))));
    chords.push(values.filter((v) => new Set(v).size > 1).length / onsets.length);
    let lo: number | undefined;
    let hi = 0;
    let prev: number | undefined;
    let sh = 0;
    let lp = 0;
    for (const o of onsets) {
      const v = slices.get(o)!;
      const a = minOf(v);
      const b = maxOf(v);
      if (lo === undefined) {
        lo = a;
        hi = b;
      } else if (Math.max(hi, b) - Math.min(lo, a) > WINDOW) {
        sh += 1;
        lo = a;
        hi = b;
      } else {
        lo = Math.min(lo, a);
        hi = Math.max(hi, b);
      }
      const centre = (a + b) / 2;
      if (prev !== undefined && Math.abs(centre - prev) > 12) lp += 1;
      prev = centre;
    }
    shifts.push((100 * sh) / onsets.length);
    leaps.push((100 * lp) / onsets.length);
    for (const v of values) {
      notes += v.length;
      outside += v.filter((p) => !scale.has(mod(p, 12))).length;
    }
  }
  return {
    nps: notes / seconds,
    shifts: shifts.reduce((s, x) => s + x, 0) / shifts.length,
    span: maxOf(spans),
    chord: maxOf(chords),
    fifths: Math.abs(fifths),
    accidentals: (100 * outside) / notes,
    seconds,
    leaps: maxOf(leaps),
  };
}

/** level.py's `score`: the weighted sum, with nps capped at 12 and the length at four minutes. */
export function levelScore(f: LevelFeatures): number {
  return (
    0.35 * Math.min(f.nps, 12) +
    0.06 * f.shifts +
    0.12 * Math.max(0, f.span - 7) +
    2.0 * f.chord +
    0.25 * f.fifths +
    0.05 * f.accidentals +
    (0.3 * Math.min(f.seconds, 240)) / 60 +
    0.05 * f.leaps
  );
}

/** 1 + the number of cuts below `score`, for the score rounded to 3 decimals as level.py records it. */
export function proposeLevel(score: number): number {
  return 1 + LEVEL_CUTS.filter((c) => score > c).length;
}

/** Math.round(x * 1000) / 1000: the score as level.py records it. */
export function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
