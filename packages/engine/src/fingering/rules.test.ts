import { describe, expect, it } from 'vitest';
import type { Finger } from '../score/types.js';
import { isBlack } from './geometry.js';
import {
  PARNCUTT_WEIGHTS,
  makeContext,
  pairTerms,
  tripleTerms,
  unaryTerms,
  weightedSum,
} from './rules.js';
import type { NoteView, RuleId, Term } from './rules.js';
import { HAND_PROFILES } from './spans.js';

const ctx = makeContext(HAND_PROFILES.large);
const note = (pitch: number, slice: number, extra: Partial<NoteView> = {}): NoteView => ({
  pitch,
  black: isBlack(pitch),
  onsetSec: slice * 0.5,
  offsetSec: slice * 0.5 + 0.5,
  slice,
  restBefore: false,
  ioi: 0.5,
  ...extra,
});
const pts = (terms: Term[], rule: string) =>
  terms.filter((t) => t.rule === rule).reduce((s, t) => s + t.points, 0);
const parncuttOnly = (terms: Term[]) => terms.filter((t) => t.rule !== 'handPositionShift');
// Parncutt Table 2 tabulates rules 1 to 3 only (stretch, small span, large span).
const table2Only = (terms: Term[]) =>
  terms.filter((t) => t.rule === 'stretch' || t.rule === 'smallSpan' || t.rule === 'largeSpan');

describe('pair terms', () => {
  it('reproduces Parncutt Table 2: five semitones down with 1-2 costs 10 (stretch 4 + small span 6)', () => {
    const t = pairTerms(ctx, note(65, 0), 1, note(60, 1), 2);
    expect(pts(t, 'stretch')).toBe(2);
    expect(pts(t, 'smallSpan')).toBe(6);
    expect(weightedSum(ctx, table2Only(t))).toBe(10);
    // Finger 2 crosses over the thumb, white to white: rule 12 adds 1 on top of the Table 2 cost.
    expect(pts(t, 'thumbPassing')).toBe(1);
    expect(weightedSum(ctx, parncuttOnly(t))).toBe(11);
    expect(pts(t, 'handPositionShift')).toBe(4);
  });
  it('uses theta = 2 for non-thumb pairs', () => {
    const t = pairTerms(ctx, note(60, 0), 2, note(67, 1), 5); // 7 semitones with 2-5: maxRel 6 -> over 1, theta 2
    expect(pts(t, 'largeSpan')).toBe(2);
    expect(weightedSum(ctx, parncuttOnly(t))).toBe(2);
  });
  it('charges the thumb-passing rule for crossings only', () => {
    expect(pts(pairTerms(ctx, note(64, 0), 3, note(65, 1), 1), 'thumbPassing')).toBe(1); // 3 to thumb ascending, white to white
    expect(pts(pairTerms(ctx, note(64, 0), 3, note(66, 1), 1), 'thumbPassing')).toBe(3); // white non-thumb below, black thumb above
    expect(pts(pairTerms(ctx, note(60, 0), 1, note(62, 1), 2), 'thumbPassing')).toBe(0); // no crossing
  });
  it('treats same finger on a different key as a hop, with no span terms', () => {
    const noShift = (t: Term[]) => t.filter((x) => x.rule !== 'handPositionShift');
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(62, 1, { ioi: 0.1 }), 2))).toEqual([
      { rule: 'hop', points: 2 },
    ]);
    // M2 review fix: a hop within a perfect fourth (hopStepMax 5) costs the full 2 points at any
    // IOI; only a slow, wider leap is the cheap 0.5 (planned: 0.5 for every slow hop, which made
    // 1 2 2 1 1 2 3 4 cheaper than the textbook C major scale).
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(62, 1, { ioi: 0.5 }), 2))).toEqual([
      { rule: 'hop', points: 2 },
    ]);
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(65, 1, { ioi: 0.5 }), 2))).toEqual([
      { rule: 'hop', points: 2 },
    ]);
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(66, 1, { ioi: 0.5 }), 2))).toEqual([
      { rule: 'hop', points: 0.5 },
    ]);
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(66, 1, { ioi: 0.1 }), 2))).toEqual([
      { rule: 'hop', points: 2 },
    ]);
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(62, 1, { restBefore: true }), 2))).toEqual(
      [],
    );
  });
  it('handles repeated keys', () => {
    const noShift = (t: Term[]) => t.filter((x) => x.rule !== 'handPositionShift');
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(60, 1, { ioi: 0.1 }), 2))).toEqual([
      { rule: 'repeatedNoteSameFinger', points: 2 },
    ]);
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(60, 1, { ioi: 0.5 }), 2))).toEqual([]);
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(60, 1, { ioi: 0.5 }), 3))).toEqual([
      { rule: 'repeatedNoteFingerChange', points: 1 },
    ]);
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(60, 1, { ioi: 0.1 }), 3))).toEqual([]);
    expect(
      pts(pairTerms(ctx, note(60, 0), 2, note(60, 1, { ioi: 0.5 }), 3), 'handPositionShift'),
    ).toBe(1);
  });
  it('doubles span terms inside a chord', () => {
    const t = pairTerms(ctx, note(60, 0), 1, note(72, 0), 5); // octave with 1-5: maxRel 10 -> large 2 (theta 1), maxComf 13 -> 0
    expect(t.filter((x) => x.rule !== 'handPositionShift')).toEqual([
      { rule: 'chordLargeSpan', points: 2 },
    ]);
    expect(pts(t, 'handPositionShift')).toBe(3); // 1 on C4 anchors at 35, 5 on C5 at 42 - 4 = 38
    expect(weightedSum(ctx, t)).toBe(7);
  });
  it('charges hand-position shifts so that 1-3-5 beats 1-2-4 on a triad', () => {
    const c = note(60, 0),
      e = note(64, 0),
      g = note(67, 0);
    const cost = (fs: Finger[]) =>
      weightedSum(ctx, pairTerms(ctx, c, fs[0]!, e, fs[1]!)) +
      weightedSum(ctx, pairTerms(ctx, e, fs[1]!, g, fs[2]!));
    expect(
      pts([...pairTerms(ctx, c, 1, e, 3), ...pairTerms(ctx, e, 3, g, 5)], 'handPositionShift'),
    ).toBe(0);
    expect(
      pts([...pairTerms(ctx, c, 1, e, 2), ...pairTerms(ctx, e, 2, g, 4)], 'handPositionShift'),
    ).toBe(1);
    expect(cost([1, 3, 5])).toBeLessThan(cost([1, 2, 4]));
    expect(pts(pairTerms(ctx, note(60, 0), 1, note(65, 1), 1), 'handPositionShift')).toBe(3); // thumb hop C to F shifts the hand 3 columns
    expect(
      pts(
        pairTerms(ctx, note(60, 0), 1, note(65, 1, { restBefore: true }), 1),
        'handPositionShift',
      ),
    ).toBe(1.5);
  });
  it('charges three-to-four and four-on-black', () => {
    expect(pts(pairTerms(ctx, note(60, 0), 3, note(62, 1), 4), 'threeToFour')).toBe(1);
    expect(pts(pairTerms(ctx, note(60, 0), 3, note(61, 1), 4), 'fourOnBlack')).toBe(1);
    expect(pts(pairTerms(ctx, note(61, 0), 4, note(60, 1), 3), 'fourOnBlack')).toBe(1);
    expect(pts(pairTerms(ctx, note(61, 0), 3, note(62, 1), 4), 'fourOnBlack')).toBe(0);
  });
});

describe('unary terms', () => {
  it('weak fingers, thumb on black, five on black', () => {
    expect(unaryTerms(ctx, note(60, 1), 4, note(59, 0), note(62, 2))).toEqual([
      { rule: 'weakFinger', points: 1 },
    ]);
    expect(unaryTerms(ctx, note(60, 1), 5, undefined, undefined)).toEqual([
      { rule: 'weakFifth', points: 1 },
    ]);
    expect(unaryTerms(ctx, note(61, 1), 1, note(60, 0), note(62, 2))).toEqual([
      { rule: 'thumbOnBlack', points: 5 },
    ]);
    expect(unaryTerms(ctx, note(61, 1), 1, note(63, 0), undefined)).toEqual([
      { rule: 'thumbOnBlack', points: 1 },
    ]);
    expect(unaryTerms(ctx, note(61, 1), 5, note(60, 0), note(63, 2))).toEqual([
      { rule: 'weakFifth', points: 1 },
      { rule: 'fiveOnBlack', points: 2 },
    ]);
  });
});

describe('triple terms', () => {
  it('reproduces the Parncutt worked example A4 C4 A4 E5 fingered 4 1 2 5 with total 15', () => {
    const n = [note(69, 0), note(60, 1), note(69, 2), note(76, 3)];
    const f: Finger[] = [4, 1, 2, 5];
    let total = 0;
    for (let k = 0; k < 4; k++)
      total += weightedSum(ctx, unaryTerms(ctx, n[k]!, f[k]!, n[k - 1], n[k + 1]));
    for (let k = 1; k < 4; k++)
      total += weightedSum(ctx, parncuttOnly(pairTerms(ctx, n[k - 1]!, f[k - 1]!, n[k]!, f[k]!)));
    const t1 = tripleTerms(ctx, n[0]!, 4, n[1]!, 1, n[2]!, 2);
    const t2 = tripleTerms(ctx, n[1]!, 1, n[2]!, 2, n[3]!, 5);
    expect(pts(t1, 'positionChangeCount')).toBe(1);
    expect(pts(t1, 'positionChangeSize')).toBe(0);
    expect(pts(t2, 'positionChangeCount')).toBe(1);
    expect(pts(t2, 'positionChangeSize')).toBe(3);
    total += weightedSum(ctx, t1) + weightedSum(ctx, t2);
    expect(total).toBe(15);
  });
  it('counts a full change of 2 when the thumb is in the middle and the span is impractical', () => {
    const t = tripleTerms(ctx, note(60, 0), 2, note(64, 1), 1, note(79, 2), 5); // 19 semitones 2->5, thumb between
    expect(pts(t, 'positionChangeCount')).toBe(2);
  });
  it('charges three-four-five and the same-finger pivot', () => {
    expect(
      pts(tripleTerms(ctx, note(60, 0), 3, note(62, 1), 4, note(64, 2), 5), 'threeFourFive'),
    ).toBe(1);
    expect(
      pts(tripleTerms(ctx, note(60, 0), 2, note(64, 1), 3, note(67, 2), 2), 'sameFingerPivot'),
    ).toBe(1);
  });
  it('emits nothing when the three notes are not in three different slices', () => {
    expect(tripleTerms(ctx, note(60, 0), 1, note(64, 0), 3, note(67, 1), 5)).toEqual([]);
  });
});

describe('weights', () => {
  it('loads the Parncutt defaults and lets a rule be switched off', () => {
    expect(PARNCUTT_WEIGHTS.stretch).toBe(2);
    const off = makeContext(HAND_PROFILES.large, { smallSpan: 0, handPositionShift: 0 });
    // stretch 2 points x weight 2, plus thumbPassing 1 x 1 (finger 2 crosses over the thumb)
    expect(weightedSum(off, pairTerms(off, note(65, 0), 1, note(60, 1), 2))).toBe(5);
    const offToo = makeContext(HAND_PROFILES.large, {
      smallSpan: 0,
      handPositionShift: 0,
      thumbPassing: 0,
    });
    expect(weightedSum(offToo, pairTerms(offToo, note(65, 0), 1, note(60, 1), 2))).toBe(4);
  });
  it('gives every rule a finite weight in the JSON parameter file', () => {
    const every: Record<RuleId, true> = {
      weakFinger: true,
      weakFifth: true,
      thumbOnBlack: true,
      fiveOnBlack: true,
      stretch: true,
      smallSpan: true,
      largeSpan: true,
      beyondPractical: true,
      threeToFour: true,
      fourOnBlack: true,
      thumbPassing: true,
      hop: true,
      repeatedNoteSameFinger: true,
      repeatedNoteFingerChange: true,
      chordStretch: true,
      chordSmallSpan: true,
      chordLargeSpan: true,
      chordBeyondPractical: true,
      handPositionShift: true,
      positionChangeCount: true,
      positionChangeSize: true,
      threeFourFive: true,
      sameFingerPivot: true,
      template: true,
    };
    expect(Object.keys(PARNCUTT_WEIGHTS).sort()).toEqual(Object.keys(every).sort());
    for (const w of Object.values(PARNCUTT_WEIGHTS)) expect(Number.isFinite(w)).toBe(true);
  });
});
