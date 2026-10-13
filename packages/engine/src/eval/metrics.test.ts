import { describe, expect, it } from 'vitest';
import { matchRate, pigMetrics } from './metrics.js';
import type { FingerSeq } from './metrics.js';

describe('matchRate', () => {
  it('counts equal fingers over all notes', () => {
    expect(matchRate([1, 2, 3, 4], [1, 2, 3, 5])).toBe(0.75);
    expect(matchRate([1, undefined], [1, 2])).toBe(0.5);
    expect(matchRate([], [])).toBe(0);
  });
});

describe('pigMetrics', () => {
  const A: FingerSeq = [1, 2, 3, 4, 5];
  const B: FingerSeq = [1, 2, 3, 5, 5];
  it('is perfect when the prediction equals one annotator', () => {
    const m = pigMetrics([1, 2, 3, 5, 5], [A, B]);
    expect(m.high).toBe(1);
    expect(m.gen).toBeCloseTo(0.9);
    expect(m.soft).toBe(1);
    expect(m.rec).toBe(1);
    expect(m.notes).toBe(5);
    expect(m.annotators).toBe(2);
  });
  it('soft exceeds rec when pairs are not from one annotator', () => {
    const m = pigMetrics(
      [1, 1],
      [
        [1, 2],
        [2, 1],
      ],
    );
    expect(m.soft).toBe(1);
    expect(m.rec).toBe(0.5);
    expect(m.gen).toBe(0.5);
    expect(m.high).toBe(0.5);
  });
  it('allows switching where annotators agree', () => {
    // A and B agree on note 1 (finger 2), so A at notes 0-1 and B at notes 2-3 is a legal recombination.
    // It has no mismatch but pays C_rec = 1 for the switch (Nakamura et al. 2020, Appendix A), which
    // ties with staying on B (one mismatch at note 0): rec = (4 - 1) / 4.
    const m = pigMetrics(
      [1, 2, 4, 5],
      [
        [1, 2, 3, 3],
        [5, 2, 4, 5],
      ],
    );
    expect(m.rec).toBe(0.75);
    expect(m.high).toBe(0.75);
    // Here a single switch (A agrees with B on note 2) saves two mismatches over either annotator.
    const longer = pigMetrics(
      [1, 1, 2, 4, 5],
      [
        [1, 1, 2, 3, 3],
        [5, 5, 2, 4, 5],
      ],
    );
    expect(longer.high).toBe(0.6);
    expect(longer.rec).toBe(0.8);
  });
  it('forbids switching where annotators disagree', () => {
    // Switching from A to B at note 2 would need A and B to agree on note 1; they do not.
    const m = pigMetrics(
      [1, 2, 4, 5],
      [
        [1, 2, 3, 3],
        [5, 3, 4, 5],
      ],
    );
    expect(m.rec).toBe(0.5);
  });
  it('recombines per hand when hands are given', () => {
    // Right-hand notes at indices 0 and 2, left-hand at 1 and 3.
    const golds: FingerSeq[] = [
      [1, 5, 2, 4],
      [3, 1, 2, 2],
    ];
    const hands = ['R', 'L', 'R', 'L'] as const;
    const m = pigMetrics([1, 1, 2, 2], golds, [...hands]);
    // R sequence: pred [1,2]; A gives [1,2] -> both match. L sequence: pred [1,2]; B gives [1,2] -> both match.
    expect(m.rec).toBe(1);
    // The highest match rate also picks the closest annotator per hand, as the official tool does.
    expect(m.high).toBe(1);
    const joint = pigMetrics([1, 1, 2, 2], golds);
    expect(joint.rec).toBeLessThan(1);
    expect(joint.high).toBe(0.75);
  });
  it('treats a ground-truth finger on the other hand as a different finger', () => {
    // Like the official tool, which compares signed PIG fingers: R2 and L2 (-2) differ.
    const hands = ['R', 'R', 'R', 'R'] as const;
    const m = pigMetrics(
      [1, 2, 4, 5],
      [
        [1, 2, 3, 3],
        [5, 2, 4, 5],
      ],
      [...hands],
      [
        ['R', 'R', 'R', 'R'],
        ['R', 'L', 'R', 'R'],
      ],
    );
    // B's note 1 is a mismatch, and A and B no longer agree on note 1, so no switch is allowed there.
    expect(m.gen).toBe((0.5 + 0.5) / 2);
    expect(m.soft).toBe(1);
    expect(m.rec).toBe(0.5);
    expect(
      pigMetrics(
        [1, 2, 4, 5],
        [
          [1, 2, 3, 3],
          [5, 2, 4, 5],
        ],
        [...hands],
      ).rec,
    ).toBe(0.75);
  });
  it('treats unassigned ground truth as a mismatch', () => {
    const m = pigMetrics([1, 2], [[1, undefined]]);
    expect(m.gen).toBe(0.5);
    expect(m.soft).toBe(0.5);
  });
  it('rejects length mismatches', () => {
    expect(() => pigMetrics([1], [[1, 2]])).toThrow(/length/);
  });
});
