import { describe, expect, it } from 'vitest';
import type { Hand } from '../../score/types.js';
import {
  candidateSplits,
  MAX_HAND_SPAN,
  MAX_NOTES_PER_HAND,
  separateHands,
  splitViolation,
} from './handSeparation.js';
import type { QuantizedNote } from './quantize.js';

/** One note per [onset at 480 per quarter, midi], at 120 quarter notes per minute. */
function notes(spec: ReadonlyArray<readonly [number, number]>): QuantizedNote[] {
  return spec.map(([onset, midi], i) => ({
    onset,
    offset: onset + 240,
    onsetSec: onset / 960,
    midi,
    velocity: 80,
    channel: 0,
    track: 0,
    sources: [i],
  }));
}
const agree = (got: Hand[], want: Hand[]) => got.filter((h, i) => h === want[i]).length;
const switches = (hands: Hand[]) => hands.slice(1).filter((h, i) => h !== hands[i]).length;

describe('split constraints', () => {
  it('scores extra notes and over-wide hands', () => {
    expect(MAX_HAND_SPAN).toBe(17);
    expect(splitViolation([60, 62, 64, 65, 67, 69], 0)).toBe(100);
    expect(splitViolation([60, 62, 64, 65, 67, 69], 3)).toBe(0);
    expect(splitViolation([36, 60], 0)).toBe(7);
  });
  it('keeps only playable splits when there are any', () => {
    expect(candidateSplits([60, 62, 64, 65, 67, 69])).toEqual([1, 2, 3, 4, 5]);
    expect(candidateSplits([36, 60])).toEqual([1]);
    expect(candidateSplits([60])).toEqual([0, 1]);
  });
  it('falls back to the least-violating splits when none is playable', () => {
    expect(candidateSplits([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71])).toEqual([5, 6, 7]);
  });
});

describe('separateHands', () => {
  it('separates a melody from a low accompaniment played at the same time', () => {
    const melody = [72, 74, 76, 77, 79, 77, 76, 74, 72, 74, 76, 77];
    const spec: Array<[number, number]> = [];
    const truth: Hand[] = [];
    melody.forEach((m, i) => {
      spec.push([i * 240, m]);
      truth.push('R');
      if (i % 2 === 0) {
        spec.push([i * 240, 36], [i * 240, 43]);
        truth.push('L', 'L');
      }
    });
    expect(separateHands(notes(spec))).toEqual(truth);
  });
  it('keeps a single melody in the middle register in one hand instead of trading it between the hands', () => {
    const line = [60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65, 67, 65, 64, 62];
    const melody = [...line, ...line, ...line];
    const hands = separateHands(notes(melody.map((m, i) => [i * 240, m] as const)));
    expect(hands.filter((h) => h === 'R').length).toBeGreaterThanOrEqual(44);
    expect(switches(hands)).toBeLessThanOrEqual(2);
  });
  it('keeps two lines that converge to a whole tone and part again in their own hands', () => {
    const left = [48, 50, 52, 54, 56, 58, 60, 62, 60, 58, 56, 54, 52];
    const right = [76, 74, 72, 70, 68, 66, 64, 66, 68, 70, 72, 74, 76];
    const spec: Array<[number, number]> = [];
    const truth: Hand[] = [];
    left.forEach((l, k) => {
      spec.push([2 * k * 240, l], [(2 * k + 1) * 240, right[k]!]);
      truth.push('L', 'R');
    });
    expect(agree(separateHands(notes(spec)), truth)).toBeGreaterThanOrEqual(24);
  });
  it('never gives one hand more than five notes when a playable split exists', () => {
    const spec: Array<[number, number]> = [];
    for (let m = 6; m <= 10; m++)
      for (let j = 0; j < m; j++) spec.push([(m - 6) * 480, 48 + 3 * j]);
    const qn = notes(spec);
    const hands = separateHands(qn);
    for (let onset = 0; onset <= 4 * 480; onset += 480) {
      for (const hand of ['L', 'R'] as const) {
        const pitches = qn
          .filter((n, i) => n.onset === onset && hands[i] === hand)
          .map((n) => n.midi);
        expect(pitches.length).toBeLessThanOrEqual(MAX_NOTES_PER_HAND);
        if (pitches.length > 0)
          expect(Math.max(...pitches) - Math.min(...pitches)).toBeLessThanOrEqual(MAX_HAND_SPAN);
      }
    }
  });
  it('still answers when no split of a slice is playable', () => {
    const qn = notes([...Array(12).keys()].map((k) => [0, 60 + k] as const));
    const hands = separateHands(qn);
    expect(hands).toHaveLength(12);
    expect(hands.filter((h) => h === 'L').length).toBeGreaterThanOrEqual(5);
    expect(hands.filter((h) => h === 'R').length).toBeGreaterThanOrEqual(5);
  });
  it('applies a fixed split point without running the DP', () => {
    const qn = notes([
      [0, 59],
      [0, 60],
      [240, 72],
      [240, 40],
    ]);
    expect(separateHands(qn, { splitMidi: 60 })).toEqual(['L', 'R', 'R', 'L']);
  });
  it('is deterministic and does not depend on the input order', () => {
    const spec: Array<[number, number]> = [];
    for (let i = 0; i < 100; i++)
      spec.push([i * 240, 66 + ((i * 7) % 12)], [i * 240, 38 + ((i * 5) % 10)]);
    const forward = separateHands(notes(spec));
    expect(separateHands(notes(spec))).toEqual(forward);
    expect(separateHands([...notes(spec)].reverse())).toEqual([...forward].reverse());
  });
  it('separates 6000 notes in well under two seconds', () => {
    const spec: Array<[number, number]> = [];
    for (let i = 0; i < 4000; i++) {
      spec.push([i * 120, 60 + ((i * 7) % 19)]);
      if (i % 2 === 0) spec.push([i * 120, 36 + ((i * 5) % 17)]);
    }
    const t0 = performance.now();
    expect(separateHands(notes(spec))).toHaveLength(6000);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
