import { describe, expect, it } from 'vitest';
import type { Assignment, Score } from '../score/types.js';
import { inferFingering } from './player.js';
import {
  DENSITY_TARGET,
  digitBudget,
  greedyReduction,
  reduceDetailed,
  reduceFingering,
} from './reduce.js';
import type { PrintReason, ReduceOptions } from './reduce.js';
import { idsOf, pieceOf, randomPiece } from './testPieces.js';
import type { Spec } from './testPieces.js';

/* Ported from research/readability/tests/test_reduce.py, with the reasons of issue 94. */

const seq = (pitches: number[], fingers: number[]): Spec[] =>
  pitches.map((p, i) => [p, fingers[i]!]);
const SCALE = [60, 62, 64, 65, 67, 69, 71, 72];

/** The reasons by rank in the hand's sequence. */
function reasonsByRank(
  ids: string[],
  reasons: Record<string, PrintReason>,
): Record<number, PrintReason> {
  return Object.fromEntries(ids.flatMap((id, k) => (reasons[id] ? [[k, reasons[id]!]] : [])));
}

/** The reduction without the budget: what the greedy pass prints. */
const open = (score: Score, full: Assignment, opts?: ReduceOptions) =>
  reduceDetailed(score, full, opts, Number.POSITIVE_INFINITY);

describe('the greedy pass on hand-made passages', () => {
  it('a C position needs only the first digit', () => {
    const { score, full } = pieceOf(
      seq([60, 62, 64, 65, 67, 65, 64, 62, 60], [1, 2, 3, 4, 5, 4, 3, 2, 1]),
    );
    const r = open(score, full);
    expect(reasonsByRank(idsOf(score, 'R'), r.reasons)).toEqual({ 0: 'first' });
    expect(r.necessary).toBe(1);
    expect(r.reconstruction).toBe(100);
  });

  it('prints the first note and the thumb crossing of a scale up and down', () => {
    const up = pieceOf(seq(SCALE, [1, 2, 3, 1, 2, 3, 4, 5]));
    const a = open(up.score, up.full);
    expect(reasonsByRank(idsOf(up.score, 'R'), a.reasons)).toEqual({ 0: 'first', 3: 'step' });
    expect(a).toMatchObject({ notes: 8, necessary: 2, reconstruction: 100 });
    const down = pieceOf(seq([...SCALE].reverse(), [5, 4, 3, 2, 1, 3, 2, 1]));
    const d = open(down.score, down.full);
    expect(Object.keys(reasonsByRank(idsOf(down.score, 'R'), d.reasons))).toEqual(['0', '5']);
  });

  it('prints where the reader would guess another finger or none, and nowhere else', () => {
    const cases: Array<[number[], number[], Record<number, PrintReason>]> = [
      [[60, 74], [1, 5], { 0: 'first', 1: 'none' }], // a leap out of the position: R3 gives up
      [[60, 62, 64, 67], [1, 2, 3, 2], { 0: 'first', 3: 'position' }], // a position choice made differently
      [[60, 60], [1, 2], { 0: 'first', 1: 'repeat' }], // a finger change on a repeated key
    ];
    for (const [pitches, fingers, expected] of cases) {
      const { score, full } = pieceOf(seq(pitches, fingers));
      expect(
        reasonsByRank(idsOf(score, 'R'), open(score, full).reasons),
        pitches.join(' '),
      ).toEqual(expected);
    }
  });

  it('a rest is not a trigger: the reader keeps the position across it', () => {
    // C4 then E4 two seconds later.
    const { score, full } = pieceOf(
      [
        [60, 1],
        [64, 3],
      ],
      [],
      2,
    );
    expect([...open(score, full).printed]).toEqual([idsOf(score, 'R')[0]!]);
  });

  it('prints one digit per chord, on the thumb side, and more only where chord fill fails', () => {
    const twice = pieceOf([
      [
        [60, 64, 67],
        [1, 3, 5],
      ],
      [
        [60, 64, 67],
        [1, 3, 5],
      ],
    ]);
    const t = open(twice.score, twice.full);
    expect(reasonsByRank(idsOf(twice.score, 'R'), t.reasons)).toEqual({ 0: 'first' });

    const moved = pieceOf([
      [67, 5],
      [
        [62, 65, 69],
        [1, 3, 5],
      ],
    ]);
    expect(reasonsByRank(idsOf(moved.score, 'R'), open(moved.score, moved.full).reasons)).toEqual({
      0: 'first',
      1: 'position',
    });

    const fchord = pieceOf([
      [
        [60, 65, 69],
        [1, 2, 4],
      ],
    ]);
    expect(
      reasonsByRank(idsOf(fchord.score, 'R'), open(fchord.score, fchord.full).reasons),
    ).toEqual({
      0: 'first',
      1: 'chord',
    });

    const left = pieceOf(
      [],
      [
        [
          [48, 52, 55],
          [5, 3, 1],
        ],
      ],
    );
    expect(reasonsByRank(idsOf(left.score, 'L'), open(left.score, left.full).reasons)).toEqual({
      0: 'first',
    });
  });

  it('prints pinned and low-confidence notes, pinned before first, and counts them apart', () => {
    const { score, full } = pieceOf(seq(SCALE, [1, 2, 3, 1, 2, 3, 4, 5]));
    const r = idsOf(score, 'R');
    const edited: Assignment = {
      ...full,
      [r[0]!]: { ...full[r[0]!]!, pinned: true, source: 'user' },
      [r[1]!]: { ...full[r[1]!]!, pinned: true, source: 'user' },
      [r[2]!]: { ...full[r[2]!]!, confidence: 0.5 },
      [r[4]!]: { ...full[r[4]!]!, confidence: 0.7 },
    };
    const a = greedyReduction(score, edited, { confidenceFloor: 0.6 });
    expect(reasonsByRank(r, a.reasons)).toEqual({
      0: 'pinned',
      1: 'pinned',
      2: 'lowConfidence',
      3: 'step',
    });
    expect(a.printed.size).toBe(4);
    // The trigger is off by default, and with it on the full pass still prints the digit.
    expect(greedyReduction(score, edited).printed.size).toBe(3);
    expect(reduceDetailed(score, edited, { confidenceFloor: 0.6 }, Infinity).necessary).toBe(4);
    expect(greedyReduction(score, edited, { confidenceFloor: 0.8 }).reasons[r[4]!]).toBe(
      'lowConfidence',
    );
  });

  it('takes a repeated passage from memory', () => {
    const { score, full } = pieceOf(
      seq([64, 65, 67, 69, 72, 64, 65, 67, 69], [1, 2, 3, 4, 3, 1, 2, 3, 4]),
    );
    const r = idsOf(score, 'R');
    const red = greedyReduction(score, full);
    expect(reasonsByRank(r, red.reasons)).toEqual({ 0: 'first', 4: 'position' });
    // Without the memory the E after the C5 has to be printed.
    const plain = greedyReduction(score, full, { memory: false });
    expect(plain.printed.size).toBeGreaterThan(red.printed.size);
  });

  it('a repeat fingered differently gets a digit where it differs and is read normally after it', () => {
    const { score, full } = pieceOf(
      seq([64, 65, 67, 69, 72, 64, 65, 67, 69], [1, 2, 3, 4, 3, 2, 3, 4, 5]),
    );
    const r = idsOf(score, 'R');
    const red = greedyReduction(score, full);
    expect(reasonsByRank(r, red.reasons)).toEqual({ 0: 'first', 4: 'position', 5: 'memory' });
  });

  it('is deterministic and ignores notes without a finger', () => {
    const { score, full } = pieceOf(seq(SCALE, [1, 2, 3, 1, 2, 3, 4, 5]));
    const a = open(score, full);
    const b = open(score, full);
    expect([...a.printed].sort()).toEqual([...b.printed].sort());
    expect(a.reasons).toEqual(b.reasons);
    const r = idsOf(score, 'R');
    const partial: Assignment = Object.fromEntries(
      Object.entries(full).filter(([id]) => id !== r[6]),
    );
    const c = open(score, partial);
    expect(c.notes).toBe(7);
    expect(c.printed.has(r[6]!)).toBe(false);
    expect(c.reconstruction).toBe(100);
  });

  it('every printed digit is necessary: dropping any one loses a note', () => {
    const { score, full } = pieceOf(
      seq(
        [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60],
        [1, 2, 3, 1, 2, 3, 4, 5, 4, 3, 2, 1, 3, 2, 1],
      ),
    );
    const { printed } = greedyReduction(score, full);
    for (const id of printed) {
      const rest: Assignment = Object.fromEntries(
        [...printed].filter((x) => x !== id).map((x) => [x, full[x]!]),
      );
      const read = inferFingering(score, rest).assignment;
      expect(
        score.notes.every((n) => read[n.id]?.finger === full[n.id]!.finger),
        `digit ${id} is redundant`,
      ).toBe(false);
    }
  });
});

describe('the unbudgeted pass reconstructs everything, on random pieces', () => {
  it('100 percent, with and without the memory, for any fingering however absurd', () => {
    const wrong: string[] = [];
    for (let seed = 1; seed <= 120; seed++) {
      const { score, full } = randomPiece(seed);
      for (const memory of [true, false]) {
        const { printed, reasons } = greedyReduction(score, full, { memory });
        const subset: Assignment = Object.fromEntries([...printed].map((id) => [id, full[id]!]));
        const read = inferFingering(score, subset, { memory });
        for (const n of score.notes)
          if (read.assignment[n.id]?.finger !== full[n.id]!.finger)
            wrong.push(`seed ${seed} memory ${memory}: ${n.id}`);
        for (const id of printed) if (!reasons[id]) wrong.push(`seed ${seed}: no reason for ${id}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('the budget', () => {
  it('has a row per level and 25 percent for an unknown one', () => {
    expect(DENSITY_TARGET).toEqual({ 1: 20, 2: 20, 3: 25, 4: 30, 5: 30, 6: 30 });
    expect(digitBudget(100, 1)).toBe(20);
    expect(digitBudget(100, 2)).toBe(20);
    expect(digitBudget(100, 3)).toBe(25);
    expect(digitBudget(100, 4)).toBe(30);
    expect(digitBudget(100, 6)).toBe(30);
    expect(digitBudget(100)).toBe(25);
    expect(digitBudget(100, 9)).toBe(25);
    expect(digitBudget(100, 4, 12)).toBe(12);
    expect(digitBudget(100, 4, 80)).toBe(30);
  });

  it('is never exceeded, the editor cap is respected, and locked digits stay', () => {
    const over: string[] = [];
    for (let seed = 1; seed <= 80; seed++) {
      const { score, full } = randomPiece(seed);
      for (const level of [1, 3, 5]) {
        const r = reduceDetailed(score, full, { level });
        const locked = score.notes.length === 0 ? 0 : 2; // the first note of each hand
        if (r.printed.size > Math.max(r.budget, locked)) over.push(`seed ${seed} level ${level}`);
        if (r.printed.size > r.necessary) over.push(`seed ${seed}: more than necessary`);
        if (r.necessary > r.budget && r.printed.size > Math.max(r.budget, locked))
          over.push(`seed ${seed}: ${r.printed.size} > ${r.budget}`);
        expect(r.reconstruction).toBeGreaterThanOrEqual(0);
        expect(r.reconstruction).toBeLessThanOrEqual(100);
        const capped = reduceDetailed(score, full, { level, editorDigits: 5 });
        if (capped.printed.size > Math.max(5, locked)) over.push(`seed ${seed}: cap`);
      }
    }
    expect(over).toEqual([]);
  });

  it('a budget below the pinned and first digits yields those digits (digitBudget)', () => {
    expect(digitBudget(100, 3, 0, 4)).toBe(4);
    expect(digitBudget(100, 3, 50, 2)).toBe(25);
  });

  it('keeps pinned and first digits however small the budget', () => {
    const { score, full } = randomPiece(11);
    const r = idsOf(score, 'R');
    const l = idsOf(score, 'L');
    const edited: Assignment = {
      ...full,
      [r[5]!]: { ...full[r[5]!]!, pinned: true, source: 'user' },
      [l[9]!]: { ...full[l[9]!]!, pinned: true, source: 'user' },
    };
    const res = reduceFingering(score, edited, { editorDigits: 0 });
    expect(res.printed).toEqual(new Set([r[0]!, l[0]!, r[5]!, l[9]!]));
    expect(res.reasons[r[5]!]).toBe('pinned');
    expect(res.reasons[r[0]!]).toBe('first');
  });

  it('each removal lowers the reconstruction by exactly its loss (local loss = global drop)', () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const { score, full } = randomPiece(seed);
      const n = score.notes.length;
      const all = reduceDetailed(score, full, {}, Number.POSITIVE_INFINITY);
      const start = all.necessary;
      if (all.trackedCorrect !== n)
        bad.push(`seed ${seed}: the full pass tracks ${all.trackedCorrect} of ${n}`);
      // Whatever the budget, the global reconstruction (the reader run over the printed set)
      // drops by exactly the sum of the losses the heap computed locally.
      for (const budget of [
        Math.floor(start * 0.8),
        Math.floor(start * 0.5),
        Math.floor(start * 0.2),
        0,
      ]) {
        const run = reduceDetailed(score, full, {}, budget);
        const lost = run.losses.reduce((x, y) => x + y, 0);
        const expected = (100 * (n - lost)) / n;
        if (Math.abs(run.reconstruction - expected) > 1e-9)
          bad.push(`seed ${seed} budget ${budget}: ${run.reconstruction} != ${expected}`);
        if (run.trackedCorrect !== n - lost) bad.push(`seed ${seed} budget ${budget}: tracked`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps no digit that changes no reading, except pinned and first, even under the budget', () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const { score, full } = randomPiece(seed);
      const necessary = reduceDetailed(score, full, {}, Number.POSITIVE_INFINITY).necessary;
      for (const budget of [Number.POSITIVE_INFINITY, Math.floor(necessary / 2), 0]) {
        const r = reduceDetailed(score, full, {}, budget);
        for (const id of r.printed) {
          if (r.reasons[id] === 'first' || r.reasons[id] === 'pinned') continue;
          const rest: Assignment = Object.fromEntries(
            [...r.printed].filter((x) => x !== id).map((x) => [x, full[x]!]),
          );
          const read = inferFingering(score, rest).assignment;
          if (score.notes.every((n) => read[n.id]?.finger === full[n.id]!.finger))
            bad.push(`seed ${seed} budget ${budget}: ${id} is redundant`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('removes a redundant digit before a needed one (a low-confidence digit the reader gets anyway)', () => {
    const { score, full } = pieceOf(seq(SCALE, [1, 2, 3, 1, 2, 3, 4, 5]));
    const r = idsOf(score, 'R');
    const edited: Assignment = { ...full, [r[2]!]: { ...full[r[2]!]!, confidence: 0.3 } };
    const res = reduceFingering(score, edited, { editorDigits: 2, confidenceFloor: 0.6 });
    expect(res.necessary).toBe(3);
    expect(res.printed).toEqual(new Set([r[0]!, r[3]!]));
    expect(res.reconstruction).toBe(100);
  });
});
