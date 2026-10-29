import type { Note } from './notes.js';

/**
 * Rhythm and key from the notes (issue 237). The pulse is found from the onsets alone: of the
 * quarter-note periods from 0.33 to 1.2 s, the one whose grid of eighths (or, at a cost,
 * sixteenths) the onsets sit closest to, with three leanings for the cases the onsets cannot tell apart (a grid twice as fine, or a
 * third as coarse, fits a plain melody just as well): 60 to 140 beats a minute, the usual 100,
 * and gaps of one, two, four or eight steps over three, six or odd ones. Onsets and lengths snap to
 * that grid, or to sixteenths where those fit clearly better.
 * The key is Krumhansl and Schmuckler's: the pitch classes weighted by length, correlated with the
 * profiles of the 24 keys (Krumhansl, "Cognitive Foundations of Musical Pitch", Oxford 1990).
 */

/** Sixteenths in a quarter note: the unit of every time in a `Rhythm`. */
export const DIVISIONS = 4;
export const DEFAULT_BPM = 100;

export interface Placed {
  midi: number;
  /** In sixteenths from the first note. */
  start: number;
  length: number;
}

export interface Key {
  /** Sharps (positive) or flats (negative) of the key signature. */
  fifths: number;
  mode: 'major' | 'minor';
}

export interface Rhythm {
  bpm: number;
  notes: Placed[];
  key: Key;
}

const PERIODS = { from: 0.33, to: 1.2, step: 0.005 };
/** Beats a minute the pulse is expected in: a quarter of 0.43 to 1 s. */
const SLOW_S = 1;
const FAST_S = 0.43;
const OUT_OF_RANGE = 0.5;
const PULL_TO_USUAL = 0.03;
/** The error of an onset is weighed against this many seconds, about a grid step. */
const ERROR_SCALE_S = 0.25;
const COMPLEXITY = 0.1;
/** A pulse twice as fast as the melody's own calls its commonest gap more than a beat: a half note. */
const BEAT_IS_ONE = 0.05;
/** Sixteenths cost this much, so they are used only where eighths leave the onsets clearly off their lines. */
const SIXTEENTHS = 0.08;
/** How hard a gap of n steps is to read: a power of two is plain, a dotted one (3, 6, 12) half hard. */
const hardness = (steps: number, finer: boolean) =>
  [1, 2, 4, 8, 16].includes(steps)
    ? 0
    : [3, 6, 12].includes(steps) && (finer || steps !== 12)
      ? 0.5
      : 1;
const USUAL_S = 0.6;
/** A silence this long, in grid steps, is a rest rather than the breath between two notes. */
const REST_STEPS = 0.75;

interface Fit {
  /** Mean distance of an onset from its grid line, in seconds. */
  error: number;
  /** Each onset's grid line, counted from the first onset's. */
  slots: number[];
}

/** The onsets on a grid of `step` seconds, with the grid's phase the one that suits them best. */
function fit(onsets: readonly number[], step: number): Fit {
  let sin = 0;
  let cos = 0;
  for (const o of onsets) {
    sin += Math.sin((2 * Math.PI * o) / step);
    cos += Math.cos((2 * Math.PI * o) / step);
  }
  const phase = Math.atan2(sin, cos) / (2 * Math.PI);
  const lines = onsets.map((o) => Math.round(o / step - phase));
  // Two onsets on one line (a run faster than the grid) are moved apart, the later one later, and
  // the move counts as the distance it is.
  for (let i = 1; i < lines.length; i++) lines[i] = Math.max(lines[i]!, lines[i - 1]! + 1);
  let error = 0;
  onsets.forEach((o, i) => (error += Math.abs(o / step - phase - lines[i]!)));
  return { error: (error / onsets.length) * step, slots: lines.map((l) => l - lines[0]!) };
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1]!;
};

export function quantise(notes: readonly Note[]): Rhythm {
  if (!notes.length) return { bpm: DEFAULT_BPM, notes: [], key: { fifths: 0, mode: 'major' } };
  const origin = notes[0]!.start;
  const onsets = notes.map((n) => n.start - origin);

  // Every period on both grids; the one whose cost is least is the pulse and the grid.
  let period = USUAL_S;
  let fine = false;
  let cost = Infinity;
  for (let p = PERIODS.from; p <= PERIODS.to + 1e-9; p += PERIODS.step) {
    for (const finer of [false, true]) {
      const beat = finer ? 4 : 2;
      const { error, slots } = fit(onsets, p / beat);
      const gaps = slots.slice(1).map((slot, i) => slot - slots[i]!);
      const hard = gaps.reduce((sum, gap) => sum + hardness(gap, finer), 0);
      const c =
        error / ERROR_SCALE_S +
        (p < FAST_S || p > SLOW_S ? OUT_OF_RANGE : 0) +
        PULL_TO_USUAL * Math.abs(Math.log2(p / USUAL_S)) +
        (finer ? SIXTEENTHS : 0) +
        (gaps.length
          ? COMPLEXITY * (hard / gaps.length) +
            BEAT_IS_ONE * Math.max(0, Math.log2(median(gaps) / beat))
          : 0);
      if (c < cost - 1e-9) {
        cost = c;
        period = p;
        fine = finer;
      }
    }
  }
  const step = fine ? period / 4 : period / 2;
  const { slots } = fit(onsets, step);
  const unit = fine ? 1 : 2;

  const placed = notes.map((note, i): Placed => {
    const next = notes[i + 1];
    let length: number;
    if (next) {
      const slot = slots[i + 1]! - slots[i]!;
      const silence = (next.start - note.end) / step;
      const rest = silence >= REST_STEPS ? Math.min(slot - 1, Math.round(silence)) : 0;
      length = slot - rest;
    } else length = Math.max(1, Math.round((note.end - note.start) / step));
    return { midi: note.midi, start: slots[i]! * unit, length: length * unit };
  });
  return { bpm: Math.round(60 / period), notes: placed, key: keyOf(placed) };
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlation(a: readonly number[], b: readonly number[]): number {
  const mean = (x: readonly number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(a);
  const mb = mean(b);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i]! - ma) * (b[i]! - mb);
    aa += (a[i]! - ma) ** 2;
    bb += (b[i]! - mb) ** 2;
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

/** The sharps or flats of the major key on a tonic, nearest to none (F sharp is six sharps). */
const fifthsOfMajor = (tonic: number) => {
  const f = (7 * tonic) % 12;
  return f > 6 ? f - 12 : f;
};

/** The pitch classes a key's scale holds, from its tonic: the minor has the raised seventh too. */
const SCALE = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10, 11],
};
/** How much a key is marked down for the share of the melody (by length) that is outside its scale. */
const OUTSIDE = 1;
/** And for each sharp or flat in its signature, so a tie goes to the simpler key. */
const SIGNATURE = 0.01;

export function keyOf(notes: readonly Pick<Placed, 'midi' | 'length'>[]): Key {
  const weights = new Array<number>(12).fill(0);
  for (const n of notes) weights[((n.midi % 12) + 12) % 12]! += n.length;
  const total = weights.reduce((sum, w) => sum + w, 0);
  let best: Key = { fifths: 0, mode: 'major' };
  let top = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      const profile = mode === 'major' ? MAJOR : MINOR;
      const inside = new Set(SCALE[mode].map((step) => (tonic + step) % 12));
      const outside = weights.reduce((sum, w, pc) => sum + (inside.has(pc) ? 0 : w), 0);
      const fifths = fifthsOfMajor(mode === 'major' ? tonic : (tonic + 3) % 12);
      const c =
        correlation(
          weights,
          weights.map((_, pc) => profile[(pc - tonic + 12) % 12]!),
        ) -
        (total ? (OUTSIDE * outside) / total : 0) -
        SIGNATURE * Math.abs(fifths);
      if (c > top + 1e-9) {
        top = c;
        best = { fifths, mode };
      }
    }
  }
  return notes.length ? best : { fifths: 0, mode: 'major' };
}
