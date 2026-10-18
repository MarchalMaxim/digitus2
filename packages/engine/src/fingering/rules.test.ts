import { describe, expect, it } from 'vitest';
import type { Finger } from '../score/types.js';
import { isBlack } from './geometry.js';
import {
  PARNCUTT_WEIGHTS,
  RULE_IDS,
  chordSpanTerms,
  isPenaltyRule,
  isReleased,
  makeContext,
  pairTerms,
  tripleTerms,
  unaryTerms,
  weightedSum,
} from './rules.js';
import type { IndicatorRuleId, NoteView, RuleId, Term } from './rules.js';
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
/** The M3 indicator and timing features (M3 Task 1; weight 0 in the Parncutt set). */
const M3_NAMED = ['latticeStep', 'levelChange', 'stretchFast', 'shiftFast', 'repeatFast'];
const isM3Feature = (rule: string): boolean => /^(on|tr|ch):/.test(rule) || M3_NAMED.includes(rule);
/** The M2 rule terms of a list: the exact term lists below pin the M2 terms, not the M3 features. */
const m2Only = (terms: Term[]) => terms.filter((t) => !isM3Feature(t.rule));
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
    const noShift = (t: Term[]) => m2Only(t).filter((x) => x.rule !== 'handPositionShift');
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
    const noShift = (t: Term[]) => m2Only(t).filter((x) => x.rule !== 'handPositionShift');
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
    expect(m2Only(t).filter((x) => x.rule !== 'handPositionShift')).toEqual([
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
  it('a leap after a rest is not a stretch: beyondPractical absent when restBefore', () => {
    // M2 hardening: C4 to C5 (12 semitones) with 1-2 is 2 beyond the practical span (10).
    const legato = pairTerms(ctx, note(60, 0), 1, note(72, 1), 2);
    expect(pts(legato, 'beyondPractical')).toBe(2);
    const afterRest = pairTerms(ctx, note(60, 0), 1, note(72, 1, { restBefore: true }), 2);
    expect(pts(afterRest, 'beyondPractical')).toBe(0);
    // The other span terms stay: the hand still moves.
    expect(pts(afterRest, 'stretch')).toBe(pts(legato, 'stretch'));
    expect(pts(afterRest, 'largeSpan')).toBe(pts(legato, 'largeSpan'));
    // A key released before the next onset (staccato, no rest for the hand as a whole) counts too.
    const released = note(60, 0, { offsetSec: 0.3 });
    expect(isReleased(released, note(72, 1))).toBe(true);
    expect(isReleased(note(60, 0), note(72, 1))).toBe(false);
    expect(pts(pairTerms(ctx, released, 1, note(72, 1), 2), 'beyondPractical')).toBe(0);
    // So does a held key beyond any hand's reach (C4 to G#5, 20 semitones > maxPrac(1, 5) = 15),
    // which the solver treats as released (reach.ts).
    const far = pairTerms(ctx, note(60, 0), 1, note(80, 1), 5);
    expect(pts(far, 'beyondPractical')).toBe(0);
    expect(pts(far, 'stretch')).toBe(7);
  });
  it('a thumb crossing over a fourth pays no beyondPractical', () => {
    // 3 to 1 up a fourth (G4 to C5, thumb under): maxPrac(3, 1) is 4 semitones.
    const under = pairTerms(ctx, note(67, 0), 3, note(72, 1), 1);
    expect(pts(under, 'beyondPractical')).toBe(0);
    expect(pts(under, 'thumbPassing')).toBe(1);
    // 1 to 3 down a fourth (C5 to G4, finger 3 over the thumb) and 4 to 1 up a fourth.
    expect(pts(pairTerms(ctx, note(72, 0), 1, note(67, 1), 3), 'beyondPractical')).toBe(0);
    expect(pts(pairTerms(ctx, note(64, 0), 4, note(69, 1), 1), 'beyondPractical')).toBe(0);
    // A crossing wider than a fourth, a leap without a crossing, or the thumb passing under the
    // fifth finger (not a scale crossing; maxPrac(5, 1) is 1) still pays.
    expect(pts(pairTerms(ctx, note(66, 0), 3, note(72, 1), 1), 'beyondPractical')).toBe(2);
    expect(pts(pairTerms(ctx, note(60, 0), 2, note(72, 1), 3), 'beyondPractical')).toBe(7);
    expect(pts(pairTerms(ctx, note(72, 0), 5, note(76, 1), 1), 'beyondPractical')).toBe(3);
  });
});

describe('chord span terms', () => {
  it('tripleTerms prices the outer pair of a chord (notes two apart in one slice)', () => {
    const c4 = note(60, 0);
    const e4 = note(64, 0);
    const c5 = note(72, 0);
    // C4 to C5 with 1-5: maxRel 10, so 2 large-span points (theta 1); no position shift term.
    expect(chordSpanTerms(ctx, c4, 1, c5, 5)).toEqual([{ rule: 'chordLargeSpan', points: 2 }]);
    expect(tripleTerms(ctx, c4, 1, e4, 2, c5, 5)).toEqual(chordSpanTerms(ctx, c4, 1, c5, 5));
    // With 1-3 the octave is at the practical limit (12): stretch 2, large span 5.
    expect(tripleTerms(ctx, c4, 1, e4, 2, c5, 3)).toEqual([
      { rule: 'chordStretch', points: 2 },
      { rule: 'chordLargeSpan', points: 5 },
    ]);
    // Same chord terms as pairTerms gives a chord pair, without handPositionShift.
    expect(chordSpanTerms(ctx, c4, 1, c5, 3)).toEqual(
      m2Only(pairTerms(ctx, c4, 1, c5, 3)).filter((t) => t.rule !== 'handPositionShift'),
    );
  });
  it('charges doubledFinger for two chord notes on one finger: 1 for the thumb on adjacent white keys, else 2', () => {
    // M2 hardening re-review: the price of a slice of more than five notes, which must double a
    // finger, is a named weighted rule (weight 50), not a constant inside the solver.
    expect(pts(pairTerms(ctx, note(60, 0), 1, note(62, 0), 1), 'doubledFinger')).toBe(1);
    expect(pts(pairTerms(ctx, note(60, 0), 1, note(64, 0), 1), 'doubledFinger')).toBe(2); // a third
    expect(pts(pairTerms(ctx, note(61, 0), 1, note(63, 0), 1), 'doubledFinger')).toBe(2); // black
    expect(pts(pairTerms(ctx, note(60, 0), 2, note(62, 0), 2), 'doubledFinger')).toBe(2);
    expect(pts(pairTerms(ctx, note(60, 0), 1, note(62, 0), 2), 'doubledFinger')).toBe(0);
    expect(pts(pairTerms(ctx, note(60, 0), 2, note(62, 1), 2), 'doubledFinger')).toBe(0); // a hop
    // Only neighbouring chord notes carry it; the outer pair of a triple does not double count.
    expect(
      pts(tripleTerms(ctx, note(60, 0), 1, note(61, 0), 1, note(62, 0), 1), 'doubledFinger'),
    ).toBe(0);
    expect(isPenaltyRule('doubledFinger')).toBe(true);
    expect(PARNCUTT_WEIGHTS.doubledFinger).toBeGreaterThan(0);
  });
});

describe('unary terms', () => {
  it('weak fingers, thumb on black, five on black', () => {
    expect(m2Only(unaryTerms(ctx, note(60, 1), 4, note(59, 0), note(62, 2)))).toEqual([
      { rule: 'weakFinger', points: 1 },
    ]);
    expect(m2Only(unaryTerms(ctx, note(60, 1), 5, undefined, undefined))).toEqual([
      { rule: 'weakFifth', points: 1 },
    ]);
    expect(m2Only(unaryTerms(ctx, note(61, 1), 1, note(60, 0), note(62, 2)))).toEqual([
      { rule: 'thumbOnBlack', points: 5 },
    ]);
    expect(m2Only(unaryTerms(ctx, note(61, 1), 1, note(63, 0), undefined))).toEqual([
      { rule: 'thumbOnBlack', points: 1 },
    ]);
    expect(m2Only(unaryTerms(ctx, note(61, 1), 5, note(60, 0), note(63, 2)))).toEqual([
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
    // M3 Task 1: the named rules (M2's and the five M3 features) are listed here so the compiler
    // checks the list against RuleId; the 70 indicator ids are enumerated independently below.
    const every: Record<Exclude<RuleId, IndicatorRuleId>, true> = {
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
      doubledFinger: true,
      handPositionShift: true,
      positionChangeCount: true,
      positionChangeSize: true,
      threeFourFive: true,
      sameFingerPivot: true,
      template: true,
      latticeStep: true,
      levelChange: true,
      stretchFast: true,
      shiftFast: true,
      repeatFast: true,
    };
    const indicators: string[] = [];
    for (let f = 1; f <= 5; f++)
      for (const c of ['black', 'white']) indicators.push(`on:${f}:${c}`);
    for (let g = 1; g <= 5; g++)
      for (let f = 1; f <= 5; f++) {
        for (const d of ['up', 'down']) indicators.push(`tr:${g}${f}:${d}`);
        if (g < f) indicators.push(`ch:${g}${f}`);
      }
    expect(indicators).toHaveLength(70);
    expect(Object.keys(PARNCUTT_WEIGHTS).sort()).toEqual(
      [...Object.keys(every), ...indicators].sort(),
    );
    for (const w of Object.values(PARNCUTT_WEIGHTS)) expect(Number.isFinite(w)).toBe(true);
  });
});

describe('indicator and timing features', () => {
  const ctx = makeContext(HAND_PROFILES.large);
  const note = (pitch: number, slice: number, ioi = 0.5, restBefore = false): NoteView => ({
    pitch,
    black: isBlack(pitch),
    onsetSec: slice * ioi,
    offsetSec: slice * ioi + ioi,
    slice,
    restBefore,
    ioi,
  });
  const points = (terms: Term[], rule: string) =>
    terms.filter((t) => t.rule === rule).reduce((s, t) => s + t.points, 0);

  it('unary indicators fire for the finger and key colour', () => {
    const t = unaryTerms(ctx, note(61, 0), 2, undefined, undefined);
    expect(points(t, 'on:2:black')).toBe(1);
    expect(points(t, 'on:2:white')).toBe(0);
    expect(points(unaryTerms(ctx, note(60, 0), 5, undefined, undefined), 'on:5:white')).toBe(1);
  });
  it('transition indicators fire by direction and never on repeated keys or inside a slice', () => {
    expect(points(pairTerms(ctx, note(60, 0), 1, note(64, 1), 3), 'tr:13:up')).toBe(1);
    expect(points(pairTerms(ctx, note(64, 0), 3, note(60, 1), 1), 'tr:31:down')).toBe(1);
    expect(points(pairTerms(ctx, note(60, 0), 1, note(60, 1), 1), 'tr:11:up')).toBe(0);
    expect(points(pairTerms(ctx, note(60, 0), 1, note(64, 0), 3), 'tr:13:up')).toBe(0);
    expect(points(pairTerms(ctx, note(60, 0), 1, note(64, 0), 3), 'ch:13')).toBe(1);
  });
  it('lattice and level features', () => {
    // C4 (x14 column c) to E4 with 1-3: one white key per finger -> latticeStep 0; with 1-2 -> 1
    expect(points(pairTerms(ctx, note(60, 0), 1, note(64, 1), 3), 'latticeStep')).toBe(0);
    expect(points(pairTerms(ctx, note(60, 0), 1, note(64, 1), 2), 'latticeStep')).toBe(1);
    expect(points(pairTerms(ctx, note(60, 0), 1, note(61, 1), 2), 'levelChange')).toBe(1);
    expect(points(pairTerms(ctx, note(60, 0), 1, note(62, 1), 2), 'levelChange')).toBe(0);
  });
  it('timing features scale with the inter-onset interval', () => {
    const slow = pairTerms(ctx, note(60, 0), 1, note(72, 1, 1.0), 2);
    const fast = pairTerms(ctx, note(60, 0), 1, note(72, 1, 0.1), 2);
    expect(points(slow, 'stretchFast')).toBe(0);
    expect(points(fast, 'stretchFast')).toBe(points(fast, 'stretch'));
    expect(points(fast, 'shiftFast')).toBeCloseTo(points(fast, 'handPositionShift') * 1, 9);
    expect(points(slow, 'shiftFast')).toBeCloseTo(points(slow, 'handPositionShift') * 0.25, 9);
    expect(points(pairTerms(ctx, note(60, 0), 1, note(60, 1, 0.1), 2), 'repeatFast')).toBe(1);
    expect(points(pairTerms(ctx, note(60, 0), 1, note(60, 1, 0.5), 2), 'repeatFast')).toBe(0);
    // Exactly at the limit the repetition is no longer fast.
    for (const f of [1, 2] as const)
      expect(
        points(pairTerms(ctx, note(60, 0), 1, note(60, 1, ctx.repeatFastSec), f), 'repeatFast'),
      ).toBe(0);
  });
});

// Additional tests (beyond the plan's Step 1): the corrections from the learning prototype
// (plan section "Corrections", item 2) and the properties the Parncutt-unchanged claim rests on.
describe('indicator and timing features: prototype corrections and invariants', () => {
  const ctx = makeContext(HAND_PROFILES.large);
  const at = (pitch: number, slice: number, extra: Partial<NoteView> = {}): NoteView =>
    note(pitch, slice, extra);

  it('a hop (same finger, another key) fires its transition indicator, lattice and level terms', () => {
    const t = pairTerms(ctx, at(60, 0), 2, at(62, 1, { ioi: 0.1 }), 2);
    expect(pts(t, 'tr:22:up')).toBe(1);
    expect(pts(t, 'hop')).toBe(2);
    expect(pts(t, 'latticeStep')).toBe(1); // one white key with no finger step
    expect(pts(pairTerms(ctx, at(63, 0), 3, at(60, 1), 3), 'tr:33:down')).toBe(1);
    expect(pts(pairTerms(ctx, at(63, 0), 3, at(60, 1), 3), 'levelChange')).toBe(1);
    // stretchFast follows stretch, which a hop does not have.
    expect(pts(t, 'stretchFast')).toBe(0);
  });
  it('repeatFast fires on a fast repeated key with any fingers, and nothing else of M3 there', () => {
    for (const [g, f] of [
      [2, 2],
      [2, 3],
    ] as const) {
      const t = pairTerms(ctx, at(60, 0), g, at(60, 1, { ioi: 0.1 }), f);
      expect(pts(t, 'repeatFast')).toBe(1);
      expect(t.filter((x) => /^(tr|ch):/.test(x.rule) || x.rule === 'latticeStep')).toEqual([]);
    }
  });
  it('shiftFast is a different-slice term only, and follows the halved shift after a rest', () => {
    // Inside a chord the hand-position shift is charged, shiftFast is not.
    const chord = pairTerms(ctx, at(60, 0), 1, at(72, 0), 2);
    expect(pts(chord, 'handPositionShift')).toBeGreaterThan(0);
    expect(pts(chord, 'shiftFast')).toBe(0);
    const rest = pairTerms(ctx, at(60, 0), 1, at(72, 1, { ioi: 0.1, restBefore: true }), 2);
    expect(pts(rest, 'shiftFast')).toBeCloseTo(pts(rest, 'handPositionShift'), 12);
    // A repeated key and a hop shift the hand too, so they carry shiftFast.
    // 1 to 3 on one key: anchors 35 and 33, a shift of 2, times 0.25 / 0.5.
    expect(pts(pairTerms(ctx, at(60, 0), 1, at(60, 1, { ioi: 0.5 }), 3), 'shiftFast')).toBe(1);
    // Below 10 ms the factor saturates at 1.
    expect(pts(pairTerms(ctx, at(60, 0), 1, at(72, 1, { ioi: 0 }), 2), 'shiftFast')).toBe(
      pts(pairTerms(ctx, at(60, 0), 1, at(72, 1, { ioi: 0 }), 2), 'handPositionShift'),
    );
  });
  it('chord pair indicators fire for g < f only (a doubled or crossed chord pair has none)', () => {
    expect(pts(pairTerms(ctx, at(60, 0), 2, at(64, 0), 4), 'ch:24')).toBe(1);
    for (const [g, f] of [
      [2, 2],
      [4, 2],
    ] as const)
      expect(
        pairTerms(ctx, at(60, 0), g, at(64, 0), f).filter((x) => x.rule.startsWith('ch:')),
      ).toEqual([]);
    // The outer pair of a three-note chord (tripleTerms) gets no indicator.
    expect(
      tripleTerms(ctx, at(60, 0), 1, at(64, 0), 3, at(67, 0), 5).filter((x) => isM3Feature(x.rule)),
    ).toEqual([]);
  });
  it('emits only ids of RULE_IDS, never a zero term, and adds exactly 0 to every Parncutt sum', () => {
    const ids = new Set<string>(RULE_IDS);
    const pitches = [55, 59, 60, 61, 62, 64, 66, 67, 70, 72, 76, 79];
    const views: NoteView[] = [];
    for (const [k, p] of pitches.entries())
      for (const ioi of [0, 0.05, 0.15, 0.2, 0.3, 1])
        for (const restBefore of [false, true])
          views.push(at(p, 1 + (k % 2), { ioi, restBefore, onsetSec: 1, offsetSec: 1 + ioi }));
    const a = at(60, 1, { onsetSec: 0.5, offsetSec: 1 });
    const check = (terms: Term[]): void => {
      for (const t of terms) {
        expect(ids.has(t.rule)).toBe(true);
        expect(Number.isFinite(t.points) && t.points !== 0).toBe(true);
      }
      expect(weightedSum(ctx, terms)).toBe(weightedSum(ctx, m2Only(terms)));
    };
    let seen = 0;
    for (const b of views)
      for (let g = 1; g <= 5; g++)
        for (let f = 1; f <= 5; f++) {
          const pair = pairTerms(ctx, a, g as Finger, b, f as Finger);
          check(pair);
          check(unaryTerms(ctx, b, f as Finger, a, undefined));
          check(tripleTerms(ctx, at(57, 0), 3, a, g as Finger, b, f as Finger));
          seen += pair.filter((t) => isM3Feature(t.rule)).length;
        }
    expect(seen).toBeGreaterThan(0);
  });
  it('lists RULE_IDS sorted and unique, and marks the physical penalty rules', () => {
    expect([...RULE_IDS]).toEqual([...RULE_IDS].sort());
    expect(new Set(RULE_IDS).size).toBe(RULE_IDS.length);
    expect(RULE_IDS).toHaveLength(25 + 5 + 70);
    expect(RULE_IDS.filter((id) => isPenaltyRule(id)).sort()).toEqual(
      [
        'stretch',
        'smallSpan',
        'largeSpan',
        'beyondPractical',
        'chordStretch',
        'chordSmallSpan',
        'chordLargeSpan',
        'chordBeyondPractical',
        'doubledFinger',
        'hop',
        'repeatedNoteSameFinger',
        'handPositionShift',
        'positionChangeSize',
        'stretchFast',
        'shiftFast',
      ].sort(),
    );
    // Correction 7: the learned weight of repeatedNoteFingerChange is negative; not a penalty.
    expect(isPenaltyRule('repeatedNoteFingerChange')).toBe(false);
    expect(isPenaltyRule('on:1:black')).toBe(false);
    expect(isPenaltyRule('repeatFast')).toBe(false);
  });
  it('makeContext fills every id a partial weight set leaves out with the Parncutt value', () => {
    const c = makeContext(HAND_PROFILES.large, { 'tr:13:up': 0.5 });
    expect(c.weights['tr:13:up']).toBe(0.5);
    expect(c.weights.stretch).toBe(PARNCUTT_WEIGHTS.stretch);
    expect(Object.keys(c.weights).sort()).toEqual([...RULE_IDS]);
    const t = pairTerms(c, at(60, 0), 1, at(64, 1), 3);
    expect(weightedSum(c, t)).toBe(weightedSum(ctx, t) + 0.5);
  });
});
