// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  HALO_FROM,
  HALO_MIN_MS,
  HALO_TO,
  haloFor,
  haloProgress,
  haloRadius,
  type Halo,
} from './halo.js';
import type { AlongStep, PerfRange } from './playAlong.js';
import { RED_HEAD_SCALE } from './render/timingMarks.js';

/** Steps at the given performance seconds, each one pitch. */
const at = (...secs: number[]): AlongStep[] =>
  secs.map((perfSec, i) => ({ perfSec, pitches: [60 + i] }));

const input = (
  secs: number[],
  beatSec: number,
  last: number,
  o: { loop?: PerfRange | null; factor?: number } = {},
) => ({
  steps: at(...secs),
  notes: secs.map(() => ({ beatSec })),
  last,
  loop: o.loop ?? null,
  factor: o.factor ?? 1,
  nowMs: 1000,
});

describe('haloFor', () => {
  it('gives a quarter in 4/4 none', () => {
    expect(haloFor(input([0, 0.5, 1], 0.5, 0))).toBeNull();
  });

  it('rings the next step after a half note', () => {
    expect(haloFor(input([0, 1, 1.5], 0.5, 0))).toEqual({
      index: 1,
      startMs: 1000,
      ms: 1000,
      beats: 2,
    });
  });

  it('rings after a dotted quarter in 4/4', () => {
    const h = haloFor(input([0, 0.75, 1.25], 0.5, 0));
    expect(h?.ms).toBeCloseTo(750, 9);
    expect(h?.beats).toBeCloseTo(1.5, 9);
  });

  it('rings after a dotted half in 3/4', () => {
    expect(haloFor(input([0, 1.5, 2], 0.5, 0))?.beats).toBeCloseTo(3, 9);
  });

  it('gives a 6/8 dotted quarter, one felt beat, none', () => {
    expect(haloFor(input([0, 0.75, 1.5], 0.75, 0))).toBeNull();
  });

  it('rings after a 6/8 dotted half', () => {
    expect(haloFor(input([0, 1.5, 2.25], 0.75, 0))?.beats).toBeCloseTo(2, 9);
  });

  it('rings after a whole note', () => {
    expect(haloFor(input([0, 2, 2.5], 0.5, 0))?.beats).toBeCloseTo(4, 9);
  });

  it('counts a quarter and a quarter rest as the gap', () => {
    expect(haloFor(input([0, 1], 0.5, 0))?.ms).toBeCloseTo(1000, 9);
  });

  it('counts a chain from its last step', () => {
    const h = haloFor(input([0, 0.5, 1, 2], 0.5, 2));
    expect(h?.index).toBe(3);
    expect(h?.ms).toBeCloseTo(1000, 9);
  });

  it("runs the loop's last step to the loop's end and wraps", () => {
    const h = haloFor(input([0, 0.5, 1], 0.5, 2, { loop: { from: 0, to: 2 } }));
    expect(h?.index).toBe(0);
    expect(h?.ms).toBeCloseTo(1000, 9);
  });

  it("gives none when the loop's last step is a beat from the end", () => {
    expect(haloFor(input([0, 0.5, 1], 0.5, 2, { loop: { from: 0, to: 1.5 } }))).toBeNull();
  });

  it("gives none after the piece's last step", () => {
    expect(haloFor(input([0, 0.5, 1], 0.5, 2))).toBeNull();
  });

  it('scales with the tempo', () => {
    const fast = haloFor(input([0, 1, 1.5], 0.5, 0, { factor: 1.5 }));
    expect(fast?.ms).toBeCloseTo(666.67, 2);
    const slow = haloFor(input([0, 1, 1.5], 0.5, 0, { factor: 0.5 }));
    expect(slow?.ms).toBeCloseTo(2000, 9);
  });

  it('has a floor at a fast tempo', () => {
    expect(HALO_MIN_MS).toBe(400);
    expect(haloFor(input([0, 0.5, 1], 0.25, 0, { factor: 1.5 }))).toBeNull();
    expect(haloFor(input([0, 0.5, 1], 0.25, 0, { factor: 1 }))?.ms).toBeCloseTo(500, 9);
  });

  it('counts a gap within ALONG_EPS of the beat as the beat', () => {
    expect(haloFor(input([0, 0.5 + 1e-12, 1], 0.5, 0))).toBeNull();
  });

  it('rings nothing for an index outside the steps, a beat of 0 or a factor of 0', () => {
    expect(haloFor(input([0, 1, 1.5], 0.5, -1))).toBeNull();
    expect(haloFor(input([0, 1, 1.5], 0.5, 9))).toBeNull();
    expect(haloFor(input([0, 1, 1.5], 0, 0))).toBeNull();
    expect(haloFor(input([0, 1, 1.5], 0.5, 0, { factor: 0 }))).toBeNull();
  });
});

describe('haloProgress', () => {
  const half: Halo = { index: 1, startMs: 1000, ms: 1000, beats: 2 };

  it('is linear', () => {
    expect(haloProgress(half, 1000, false)).toBe(0);
    expect(haloProgress(half, 1250, false)).toBe(0.25);
    expect(haloProgress(half, 1500, false)).toBe(0.5);
    expect(haloProgress(half, 1999, false)).toBeCloseTo(0.999, 9);
  });

  it('is gone at its end and after', () => {
    expect(haloProgress(half, 2000, false)).toBeNull();
    expect(haloProgress(half, 5000, false)).toBeNull();
  });

  it('counts a clock before the start as 0', () => {
    expect(haloProgress(half, 900, false)).toBe(0);
  });

  it('steps once per felt beat under reduced motion', () => {
    expect(haloProgress(half, 1000, true)).toBe(0);
    expect(haloProgress(half, 1499, true)).toBe(0);
    expect(haloProgress(half, 1500, true)).toBe(0.5);
    expect(haloProgress(half, 1999, true)).toBe(0.5);
    expect(haloProgress(half, 2000, true)).toBeNull();
  });

  it('steps a dotted quarter by its 1.5 beats', () => {
    const dotted: Halo = { index: 1, startMs: 1000, ms: 750, beats: 1.5 };
    expect(haloProgress(dotted, 1499, true)).toBe(0);
    expect(haloProgress(dotted, 1500, true)).toBeCloseTo(2 / 3, 12);
    expect(haloProgress(dotted, 1749, true)).toBeCloseTo(2 / 3, 12);
    expect(haloProgress(dotted, 1750, true)).toBeNull();
  });

  it('steps a whole note in four', () => {
    const whole: Halo = { index: 1, startMs: 1000, ms: 2000, beats: 4 };
    expect(haloProgress(whole, 1000, true)).toBe(0);
    expect(haloProgress(whole, 1500, true)).toBe(0.25);
    expect(haloProgress(whole, 2000, true)).toBe(0.5);
    expect(haloProgress(whole, 2500, true)).toBe(0.75);
  });

  it('loses no step to float slack', () => {
    const three: Halo = { index: 1, startMs: 1000, ms: 300, beats: 3 };
    expect(haloProgress(three, 1100, true)).toBeCloseTo(1 / 3, 12);
  });

  it('is null for a halo of no length', () => {
    expect(haloProgress({ index: 1, startMs: 1000, ms: 0, beats: 2 }, 1000, false)).toBeNull();
  });
});

describe('haloRadius', () => {
  it('starts at HALO_FROM widths', () => {
    expect(haloRadius(10, 0)).toBeCloseTo(21, 9);
  });

  it('is linear', () => {
    expect(haloRadius(10, 0.5)).toBeCloseTo((21 + 8.5) / 2, 9);
  });

  it('closes in on HALO_TO widths', () => {
    expect(haloRadius(10, 1)).toBeCloseTo(8.5, 9);
  });

  it('clears the marked notehead', () => {
    expect(HALO_FROM).toBe(2.1);
    expect(HALO_TO).toBeGreaterThan(RED_HEAD_SCALE / 2);
  });
});
