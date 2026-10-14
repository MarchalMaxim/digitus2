import type { Alter, Spelling, Step } from '../../score/pitch.js';

export const KK_MAJOR: readonly number[] = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
export const KK_MINOR: readonly number[] = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
const LINE_OF_FIFTHS: readonly Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const STEP_SEMITONE: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_NAMES = [
  'C-flat',
  'G-flat',
  'D-flat',
  'A-flat',
  'E-flat',
  'B-flat',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F-sharp',
  'C-sharp',
];
const MINOR_NAMES = [
  'A-flat',
  'E-flat',
  'B-flat',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F-sharp',
  'C-sharp',
  'G-sharp',
  'D-sharp',
  'A-sharp',
];

export interface KeyEstimate {
  /** Pitch class 0..11. */
  tonic: number;
  mode: 'major' | 'minor';
  /** Key signature: sharps > 0, flats < 0. */
  fifths: number;
  correlation: number;
}

const pitchClass = (m: number) => ((m % 12) + 12) % 12;

/** The key signature of a tonic; a minor key uses its relative major. */
export function keyFifths(tonic: number, mode: 'major' | 'minor'): number {
  return MAJOR_FIFTHS[pitchClass(mode === 'minor' ? tonic + 3 : tonic)]!;
}

function pearson(x: readonly number[], y: readonly number[]): number {
  const mean = (v: readonly number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

/**
 * Krumhansl-Schmuckler: correlate the duration-weighted pitch-class histogram with the 24 rotated
 * Krumhansl-Kessler profiles (Pearson) and keep the first best in the order tonic 0..11, major
 * before minor. No notes gives C major.
 */
export function estimateKey(notes: ReadonlyArray<{ midi: number; duration: number }>): KeyEstimate {
  const weights = new Array<number>(12).fill(0);
  for (const n of notes) weights[pitchClass(n.midi)] = weights[pitchClass(n.midi)]! + n.duration;
  let best: KeyEstimate | undefined;
  for (let tonic = 0; tonic < 12; tonic++)
    for (const mode of ['major', 'minor'] as const) {
      const profile = mode === 'major' ? KK_MAJOR : KK_MINOR;
      const r = pearson(
        weights,
        weights.map((_, p) => profile[pitchClass(p - tonic)]!),
      );
      if (!best || r > best.correlation)
        best = { tonic, mode, fifths: keyFifths(tonic, mode), correlation: r };
    }
  return best!;
}

/**
 * Spells a MIDI pitch in a key. Pitch classes sit on the line of fifths (C = 0, G = 1, F = -1);
 * a key with f fifths owns f - 1 .. f + 5, plus f + 6 and f + 8 (raised sixth and seventh) in
 * minor. A candidate inside that set wins; otherwise the nearest one, ties going to the sharp side
 * when f >= 0 and to the flat side otherwise.
 */
export function spellMidi(
  midi: number,
  key: { fifths: number; mode?: 'major' | 'minor' },
): Spelling {
  const f = key.fifths;
  const lo = f - 1;
  const hi = f + 5;
  const q0 = (7 * pitchClass(midi)) % 12;
  const candidates = [q0 - 12, q0, q0 + 12].filter((q) => q >= -15 && q <= 19);
  const inKey = (q: number) =>
    (q >= lo && q <= hi) || (key.mode === 'minor' && (q === f + 6 || q === f + 8));
  const distance = (q: number) => (q < lo ? lo - q : q > hi ? q - hi : 0);
  const q =
    candidates.find(inKey) ??
    [...candidates].sort((a, b) => distance(a) - distance(b) || (f >= 0 ? b - a : a - b))[0]!;
  const step = LINE_OF_FIFTHS[(((q + 1) % 7) + 7) % 7]!;
  const alter = Math.floor((q + 1) / 7);
  return { step, alter: alter as Alter, octave: (midi - alter - STEP_SEMITONE[step]) / 12 - 1 };
}

/** 'E-flat major', 'F-sharp minor'; a signature beyond seven accidentals is named by its count. */
export function keyName(key: { fifths: number; mode?: 'major' | 'minor' }): string {
  const minor = key.mode === 'minor';
  const name = (minor ? MINOR_NAMES : MAJOR_NAMES)[key.fifths + 7];
  return name ? `${name} ${minor ? 'minor' : 'major'}` : `${key.fifths} fifths`;
}
