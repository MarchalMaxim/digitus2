import { describe, expect, it } from 'vitest';
import type { Assignment, Finger } from '../score/types.js';
import { inferFingering, steps } from './player.js';
import { idsOf, lcg, pieceOf, randomPiece } from './testPieces.js';
import type { Spec } from './testPieces.js';

/*
 * Ported from research/readability/tests/test_player_model.py, the rules model only. Left out on
 * purpose, because the engine has no counterpart: the copy_previous and rules_plus_textbook
 * models, the column_steps variant (the study measured it worse), the leave-one-out and hide-20
 * scoring helpers (the reduction's heap does its own local reading). The Python reader's repeat
 * memory lives in reduce.py; here it is part of the reader (R5), tested below.
 */

const seq = (pitches: number[], fingers: number[]): Spec[] =>
  pitches.map((p, i) => [p, fingers[i]!]);

/** The printed digits: the given ranks of a hand's note ids. */
function printedOf(full: Assignment, ids: string[], ranks: number[]): Assignment {
  return Object.fromEntries(ranks.map((k) => [ids[k]!, full[ids[k]!]!]));
}

const fingersOf = (ids: string[], a: Assignment): Array<Finger | undefined> =>
  ids.map((id) => a[id]?.finger);
const rulesOf = (ids: string[], r: Map<string, string>): string[] => ids.map((id) => r.get(id)!);

describe('steps', () => {
  it('rounds half away from zero', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((d) => steps(60, 60 + d))).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);
    expect([0, 1, 2, 3, 4].map((d) => steps(60, 60 - d))).toEqual([0, -1, -1, -2, -2]);
  });
});

describe('the reader, rules R0 to R4', () => {
  it('C position stepwise from the first digit', () => {
    const { score, full } = pieceOf(seq([60, 62, 64, 65, 67], [1, 2, 3, 4, 5]));
    const ids = idsOf(score, 'R');
    const r = inferFingering(score, printedOf(full, ids, [0]));
    expect(fingersOf(ids, r.assignment)).toEqual([1, 2, 3, 4, 5]);
    expect(rulesOf(ids, r.rules)).toEqual(['R0', 'R2', 'R2', 'R2', 'R2']);
    expect(r.inferred.size).toBe(4);
    expect(r.unresolved.size).toBe(0);
  });

  it('a skip within the position uses R3', () => {
    const { score, full } = pieceOf(seq([60, 64, 67], [1, 3, 5]));
    const ids = idsOf(score, 'R');
    const r = inferFingering(score, printedOf(full, ids, [0]));
    expect(fingersOf(ids, r.assignment)).toEqual([1, 3, 5]);
    expect(rulesOf(ids, r.rules)).toEqual(['R0', 'R3', 'R3']);
  });

  it('repeated keys keep the finger (R1)', () => {
    const { score, full } = pieceOf(seq([64, 64, 65, 65], [3, 3, 4, 4]));
    const ids = idsOf(score, 'R');
    const r = inferFingering(score, printedOf(full, ids, [0]));
    expect(fingersOf(ids, r.assignment)).toEqual([3, 3, 4, 4]);
    expect(rulesOf(ids, r.rules)).toEqual(['R0', 'R1', 'R2', 'R1']);
  });

  it('stepwise motion beyond the position is not inferable', () => {
    const { score, full } = pieceOf(seq([60, 62, 64, 65, 67, 69], [1, 2, 3, 4, 5, 1]));
    const ids = idsOf(score, 'R');
    const r = inferFingering(score, printedOf(full, ids, [0]));
    expect(fingersOf(ids, r.assignment)).toEqual([1, 2, 3, 4, 5, undefined]);
    expect(r.unresolved).toEqual(new Set([ids[5]!]));
    expect(r.rules.get(ids[5]!)).toBe('none');
  });

  it('the left hand mirrors the right', () => {
    const lh = pieceOf([], seq([48, 50, 52, 53, 55], [5, 4, 3, 2, 1]));
    const lids = idsOf(lh.score, 'L');
    expect(
      fingersOf(lids, inferFingering(lh.score, printedOf(lh.full, lids, [0])).assignment),
    ).toEqual([5, 4, 3, 2, 1]);
    const skip = pieceOf([], seq([48, 52, 55], [5, 3, 1]));
    const sids = idsOf(skip.score, 'L');
    expect(
      fingersOf(sids, inferFingering(skip.score, printedOf(skip.full, sids, [0])).assignment),
    ).toEqual([5, 3, 1]);
  });

  it('a left-hand sequence reads like the mirrored right-hand one (random, tie-free)', () => {
    // Mirroring the pitches (120 - x) leaves every reading equal, so the same melody read as a
    // right hand and as a mirrored left hand gives the same fingers. Single notes only: a tie
    // between two equally near chord notes goes to the lower pitch, which the mirror turns into
    // the higher one (the study's convention; it is the one asymmetry).
    const rnd = lcg(7);
    for (let trial = 0; trial < 40; trial++) {
      let p = 64;
      const pitches: number[] = [];
      const fingers: number[] = [];
      for (let i = 0; i < 12; i++) {
        p += Math.floor(rnd() * 9) - 4;
        pitches.push(p);
        fingers.push(1 + Math.floor(rnd() * 5));
      }
      const right = pieceOf(seq(pitches, fingers));
      const left = pieceOf(
        [],
        seq(
          pitches.map((x) => 120 - x),
          fingers,
        ),
      );
      const rids = idsOf(right.score, 'R');
      const lids = idsOf(left.score, 'L');
      const ranks = [0, 3, 7];
      const a = inferFingering(right.score, printedOf(right.full, rids, ranks));
      const b = inferFingering(left.score, printedOf(left.full, lids, ranks));
      expect(fingersOf(lids, b.assignment)).toEqual(fingersOf(rids, a.assignment));
    }
  });

  it('black keys', () => {
    const d = pieceOf(seq([62, 64, 66, 67, 69], [1, 2, 3, 4, 5]));
    const ids = idsOf(d.score, 'R');
    expect(fingersOf(ids, inferFingering(d.score, printedOf(d.full, ids, [0])).assignment)).toEqual(
      [1, 2, 3, 4, 5],
    );
    const eb = pieceOf(seq([60, 62, 63, 65, 67], [1, 2, 3, 4, 5]));
    const eids = idsOf(eb.score, 'R');
    expect(
      fingersOf(eids, inferFingering(eb.score, printedOf(eb.full, eids, [0])).assignment),
    ).toEqual([1, 2, 3, 4, 5]);
    // C Eb G by R3: the minor third is two steps, as the third of the white keys is.
    const ceg = pieceOf(seq([60, 63, 67], [1, 3, 5]));
    const cids = idsOf(ceg.score, 'R');
    expect(
      fingersOf(cids, inferFingering(ceg.score, printedOf(ceg.full, cids, [0])).assignment),
    ).toEqual([1, 3, 5]);
  });

  it('chord fill: one digit on the thumb side, in both hands, and from any seen note', () => {
    const rh = pieceOf([
      [
        [60, 64, 67],
        [1, 3, 5],
      ],
    ]);
    const rids = idsOf(rh.score, 'R');
    const a = inferFingering(rh.score, printedOf(rh.full, rids, [0]));
    expect(fingersOf(rids, a.assignment)).toEqual([1, 3, 5]);
    expect(rulesOf(rids, a.rules)).toEqual(['R0', 'R4', 'R4']);
    const top = inferFingering(rh.score, printedOf(rh.full, rids, [2]));
    expect(fingersOf(rids, top.assignment)).toEqual([1, 3, 5]);
    const lh = pieceOf(
      [],
      [
        [
          [48, 52, 55],
          [5, 3, 1],
        ],
      ],
    );
    const lids = idsOf(lh.score, 'L'); // G3 first: the left thumb side
    expect(lids.length).toBe(3);
    expect(
      fingersOf(lids, inferFingering(lh.score, printedOf(lh.full, lids, [0])).assignment),
    ).toEqual([1, 3, 5]);
  });

  it('a chord placed from ref, doubled fingers and the range', () => {
    const fromRef = pieceOf([
      [60, 1],
      [
        [62, 65],
        [2, 4],
      ],
    ]);
    const ids = idsOf(fromRef.score, 'R');
    const r = inferFingering(fromRef.score, printedOf(fromRef.full, ids, [0]));
    expect(fingersOf(ids, r.assignment)).toEqual([1, 2, 4]);
    expect(rulesOf(ids, r.rules).slice(1)).toEqual(['R4ref', 'R4ref']);
    const dup = pieceOf([
      [60, 1],
      [
        [61, 62],
        [2, 3],
      ],
    ]); // both map to finger 2
    const dids = idsOf(dup.score, 'R');
    expect(
      fingersOf(dids, inferFingering(dup.score, printedOf(dup.full, dids, [0])).assignment).slice(
        1,
      ),
    ).toEqual([undefined, undefined]);
    const octave = pieceOf([
      [60, 1],
      [
        [60, 72],
        [1, 5],
      ],
    ]); // the top note leaves 1..5
    const oids = idsOf(octave.score, 'R');
    expect(
      fingersOf(
        oids,
        inferFingering(octave.score, printedOf(octave.full, oids, [0])).assignment,
      ).slice(1),
    ).toEqual([1, undefined]);
  });

  it('inferred fingers propagate but do not move ref', () => {
    // The leap to F is placed from ref C (1 + 3 = 4), not from the inferred D (3 + 2 = 5).
    const { score, full } = pieceOf(seq([60, 61, 62, 65], [1, 2, 3, 4]));
    const ids = idsOf(score, 'R');
    const r = inferFingering(score, printedOf(full, ids, [0]));
    expect(fingersOf(ids, r.assignment)).toEqual([1, 2, 3, 4]);
    expect(rulesOf(ids, r.rules)).toEqual(['R0', 'R2', 'R2', 'R3']);
  });

  it('nothing is read before the first seen digit', () => {
    const { score, full } = pieceOf(seq([60, 62, 64], [1, 2, 3]));
    const ids = idsOf(score, 'R');
    const r = inferFingering(score, printedOf(full, ids, [2]));
    expect(fingersOf(ids, r.assignment)).toEqual([undefined, undefined, 3]);
  });

  it('printed entries are kept as given and the other hand is read on its own', () => {
    const { score } = pieceOf(seq([60, 62, 64], [1, 2, 3]), seq([48], [5]));
    const ids = idsOf(score, 'R');
    const printed: Assignment = {
      [ids[0]!]: { finger: 1, source: 'engine' },
      [ids[1]!]: { finger: 4, source: 'user', pinned: true },
    };
    const r = inferFingering(score, printed);
    expect(r.assignment[ids[1]!]).toEqual({ finger: 4, source: 'user', pinned: true });
    expect(r.assignment[ids[2]!]!.finger).toBe(5);
    expect(r.inferred.has(ids[2]!)).toBe(true);
    expect(r.unresolved).toEqual(new Set(idsOf(score, 'L')));
  });
});

describe('the reader, R5 repeat memory', () => {
  const pitches = [64, 65, 67, 69, 72, 64, 65, 67, 69]; // E F G A C5, then E F G A again

  it('recalls a repeated passage after the position moved', () => {
    const { score, full } = pieceOf(seq(pitches, [1, 2, 3, 4, 3, 1, 2, 3, 4]));
    const ids = idsOf(score, 'R');
    const r = inferFingering(score, printedOf(full, ids, [0, 4]));
    expect(fingersOf(ids, r.assignment)).toEqual([1, 2, 3, 4, 3, 1, 2, 3, 4]);
    expect(rulesOf(ids, r.rules).slice(5)).toEqual(['R5', 'R5', 'R5', 'R5']);
    // Without the memory the reader cannot place the first E: R3 from the printed C5 leaves 1..5.
    const plain = inferFingering(score, printedOf(full, ids, [0, 4]), { memory: false });
    expect(plain.rules.get(ids[5]!)).not.toBe('R5');
  });

  it('a printed digit inside the copy ends the memory for the rest of it', () => {
    const { score, full } = pieceOf(seq(pitches, [1, 2, 3, 4, 3, 2, 3, 4, 5]));
    const ids = idsOf(score, 'R');
    const r = inferFingering(score, printedOf(full, ids, [0, 4, 5]));
    expect(fingersOf(ids, r.assignment)).toEqual([1, 2, 3, 4, 3, 2, 3, 4, 5]);
    expect(rulesOf(ids, r.rules).slice(6)).toEqual(['R2', 'R2', 'R2']);
  });

  it('does not recall a passage that is not identical', () => {
    const shifted = pieceOf(seq([64, 65, 67, 69, 72, 64, 65, 67, 70], [1, 2, 3, 4, 3, 1, 2, 3, 4]));
    const ids = idsOf(shifted.score, 'R');
    const r = inferFingering(shifted.score, printedOf(shifted.full, ids, [0, 4]));
    expect(rulesOf(ids, r.rules)).not.toContain('R5');
  });
});

describe('the reader on random pieces', () => {
  it('reads every printed digit as printed and never a finger outside 1..5', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { score, full } = randomPiece(seed);
      const some: Assignment = Object.fromEntries(
        Object.entries(full).filter((_, i) => i % 3 === 0),
      );
      const r = inferFingering(score, some);
      for (const [id, a] of Object.entries(some)) expect(r.assignment[id]?.finger).toBe(a.finger);
      for (const a of Object.values(r.assignment)) expect([1, 2, 3, 4, 5]).toContain(a.finger);
      expect(r.inferred.size + r.unresolved.size + Object.keys(some).length).toBe(
        score.notes.length,
      );
    }
  });
});
