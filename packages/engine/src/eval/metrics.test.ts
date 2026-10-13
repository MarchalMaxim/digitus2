import { describe, expect, it } from 'vitest';
import { parsePig } from '../io/pig/read.js';
import type { Hand } from '../score/types.js';
import { metricsForScores } from './align.js';
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
    expect(() => pigMetrics([1], [[1]], undefined, undefined, { pred: [1, 2] })).toThrow(/length/);
    expect(() => pigMetrics([1], [[1]], undefined, undefined, { golds: [[1], [2]] })).toThrow(
      /length/,
    );
  });
});

describe('substitutions follow the official evaluator', () => {
  // Expected values computed with research/fingering_eval/metrics.py, mode "official": M_gen
  // compares the whole PIG finger field ("3_1" differs from "3"), the other three rates compare
  // the key-press finger only.
  const golds: FingerSeq[] = [
    [3, 2, 4],
    [3, 2, 5],
  ];
  it('counts a substitution as part of the finger in gen only', () => {
    // Gold A is "3_1 2 4": "3" misses it at note 0 in gen; high, soft and rec still see a 3.
    const m = pigMetrics([3, 2, 4], golds, undefined, undefined, {
      golds: [[1, undefined, undefined], undefined],
    });
    expect(m.gen).toBeCloseTo(2 / 3, 12);
    expect(m.high).toBe(1);
    expect(m.soft).toBe(1);
    expect(m.rec).toBe(1);
    // "3_1 2 4" matches A everywhere and B ("3 2 5") only at note 1.
    const both = pigMetrics([3, 2, 4], golds, undefined, undefined, {
      pred: [1, undefined, undefined],
      golds: [[1, undefined, undefined], undefined],
    });
    expect(both.gen).toBeCloseTo(2 / 3, 12);
    expect(both.high).toBe(1);
    // Without substitution data every field is a plain finger ("press" mode): (3/3 + 2/3) / 2.
    expect(pigMetrics([3, 2, 4], golds).gen).toBeCloseTo(5 / 6, 12);
  });
  it('compares left-hand substitutions finger by finger', () => {
    const hands: Hand[] = ['L', 'L'];
    // "-3_-1 -2" against "-3_-1 -2" (all hits) and "-3 -1" (no hit): gen 1/2.
    const m = pigMetrics(
      [3, 2],
      [
        [3, 2],
        [3, 1],
      ],
      hands,
      undefined,
      { pred: [1, undefined], golds: [[1, undefined], undefined] },
    );
    expect(m.gen).toBe(0.5);
    expect(m.high).toBe(1);
    expect(m.rec).toBe(1);
    // "-3_-1" and "-3_-2" are different fields.
    const other = pigMetrics([3, 2], [[3, 2]], hands, undefined, {
      pred: [1, undefined],
      golds: [[2, undefined]],
    });
    expect(other.gen).toBe(0.5);
    expect(other.soft).toBe(1);
  });
  it('reads substitutions from PIG files in metricsForScores', () => {
    const pig = (f: [string, string, string]) =>
      parsePig(
        [
          '//Version: PianoFingering_v170101',
          `0\t0\t0.5\tC4\t80\t80\t0\t${f[0]}`,
          `1\t0.5\t1\tD4\t80\t80\t0\t${f[1]}`,
          `2\t0\t1\tC3\t80\t80\t1\t${f[2]}`,
          '',
        ].join('\n'),
      );
    // Gold A "1 2_1 -5_-1" shares only note 0 with the prediction "1 2 -5"; gold B all three.
    const m = metricsForScores(pig(['1', '2', '-5']), [
      pig(['1', '2_1', '-5_-1']),
      pig(['1', '2', '-5']),
    ]);
    expect(m.gen).toBeCloseTo(2 / 3, 12);
    expect(m.high).toBe(1);
    expect(m.soft).toBe(1);
    expect(m.rec).toBe(1);
  });
});
