import { describe, expect, it } from 'vitest';
import { forEachHold, heldPairs, HOLD_EPS, outOfReach } from '../fingering/reach.js';
import { HAND_PROFILES } from '../fingering/spans.js';
import { parsePig } from '../io/pig/read.js';
import { lintFingering } from './index.js';
import { LINT_RULES } from './rules.js';

// M2 hardening Task 2: the L03 active loop checks every held pair, not only consecutive notes,
// and a notated hold no hand can span (the solver's `outOfReach`) is a warning, not a law.
const H = '//Version: PianoFingering_v170101\n';
type Row = [number, number, string, number, number | string]; // onset, offset, pitch, channel, finger
const pig = (rows: Row[]) =>
  H +
  rows
    .map(([on, off, p, ch, f], i) => `${i}\t${on}\t${off}\t${p}\t80\t80\t${ch}\t${f}`)
    .join('\n') +
  '\n';
const lint = (rows: Row[], opts = {}) => {
  const { score, assignment } = parsePig(pig(rows));
  return lintFingering(score, assignment, opts);
};
const BEYOND_REACH = 'notated hold beyond reach: pedal or release';

describe('held pairs (L03 active loop)', () => {
  it('a bass held under a chord two octaves up gives 0 errors and one L07 warning', () => {
    // Left hand (Moonlight, Satie): C2 held for a bar on 5, C4 E4 G4 on the second beat on 5 3 1.
    // No hand spans C2 to C4 (24 semitones, maxPrac(1, 5) = 15), so the solver treats the bass as
    // released and gives the chord its natural 5 3 1; lint must agree: no L03 for the reused 5,
    // no L05 for the held pairs, one warning on the hold.
    const left = lint([
      [0, 1.5, 'C2', 1, -5],
      [0.5, 1.5, 'C4', 1, -5],
      [0.5, 1.5, 'E4', 1, -3],
      [0.5, 1.5, 'G4', 1, -1],
    ]);
    expect(left.errors).toBe(0);
    expect(left.issues.map((i) => [i.rule, i.severity, i.message])).toEqual([
      ['L07', 'warning', BEYOND_REACH],
    ]);
    expect(left.issues[0]!.noteIds[0]).toBe('0'); // the held bass
    expect(left.issues[0]!.hand).toBe('L');
    // Right hand mirror: C3 held on 1 under C5 E5 G5 on 1 3 5.
    const right = lint([
      [0, 1.5, 'C3', 0, 1],
      [0.5, 1.5, 'C5', 0, 1],
      [0.5, 1.5, 'E5', 0, 3],
      [0.5, 1.5, 'G5', 0, 5],
    ]);
    expect(right.errors).toBe(0);
    expect(right.issues.map((i) => [i.rule, i.severity, i.message])).toEqual([
      ['L07', 'warning', BEYOND_REACH],
    ]);
  });
  it('a hold beyond reach is reported once per held note, under a moving melody too', () => {
    const r = lint([
      [0, 2, 'C2', 1, -5],
      [0.5, 1, 'C4', 1, -1],
      [1, 1.5, 'D4', 1, -1],
      [1.5, 2, 'E4', 1, -1],
    ]);
    expect(r.errors).toBe(0);
    expect(r.issues.filter((i) => i.message === BEYOND_REACH)).toHaveLength(1);
  });
  it('a held note within reach with an impossible span is an L05 error', () => {
    // C4 is held on 2 while E4 (3) passes and B4 comes in on 4: B4 is not C4's neighbour in the
    // sequence, but both keys are down at once, 11 semitones with 2-4 (maxPrac 7).
    const r = lint([
      [0, 3, 'C4', 0, 2],
      [1, 1.5, 'E4', 0, 3],
      [2, 2.5, 'B4', 0, 4],
    ]);
    const l05 = r.issues.filter((i) => i.rule === 'L05');
    expect(l05.map((i) => [i.severity, i.noteIds])).toEqual([['error', ['0', '2']]]);
    expect(r.issues.some((i) => i.message === BEYOND_REACH)).toBe(false);
    // The left hand reads the same shape in the mirrored view: B3 held on 2, G3 passes on 3, C3
    // comes in on 4, 11 semitones below the held key (the left hand's 2-4 reaches 7 downwards).
    const mirrored = lint([
      [0, 3, 'B3', 1, -2],
      [1, 1.5, 'G3', 1, -3],
      [2, 2.5, 'C3', 1, -4],
    ]);
    expect(mirrored.issues.filter((i) => i.rule === 'L05').map((i) => i.noteIds)).toEqual([
      ['0', '2'],
    ]);
  });
  it('a consecutive held pair beyond practical is one L05, not two', () => {
    // C4 held on 1 under D#5 on 4: 15 semitones, maxPrac(1, 4) = 14, within reach (15).
    const r = lint([
      [0, 1.5, 'C4', 0, 1],
      [1, 2, 'D#5', 0, 4],
    ]);
    expect(r.counts.L05).toBe(1);
    expect(r.errors).toBe(1);
  });
  it('the same finger on a held key within reach is still L03', () => {
    const r = lint([
      [0, 2, 'C4', 0, 1],
      [1, 1.5, 'G4', 0, 1],
    ]);
    expect(r.counts.L03).toBe(1);
    expect(r.counts.L07 ?? 0).toBe(0);
  });
  it('a substituted held key is checked against the finger that can hold it', () => {
    // C4 struck with 2 and taken over by 1 (PIG "2_1"): when B4 comes in on 2, the thumb holds
    // C4, and 11 semitones with 1-2 is beyond maxPrac(1, 2) = 10.
    const out = lint([
      [0, 3, 'C4', 0, '2_1'],
      [1, 1.5, 'E4', 0, 3],
      [2, 2.5, 'B4', 0, 2],
    ]);
    expect(out.issues.filter((i) => i.rule === 'L05').map((i) => i.noteIds)).toEqual([['0', '2']]);
    expect(out.counts.L03 ?? 0).toBe(0);
    // A4 (9 semitones) is within 1-2, so the hold is legal although 2-2 would be a reuse.
    const ok = lint([
      [0, 3, 'C4', 0, '2_1'],
      [1, 1.5, 'E4', 0, 3],
      [2, 2.5, 'A4', 0, 2],
    ]);
    expect(ok.errors).toBe(0);
  });
  it('agrees with the solver: outOfReach is the boundary between L05 and the L07 warning', () => {
    const t = HAND_PROFILES.large.tables;
    expect(outOfReach(t, 60, 75)).toBe(false); // 15 semitones: within reach
    expect(outOfReach(t, 60, 76)).toBe(true);
    // C4 held on 1, E5 on 5: 16 semitones is beyond any hand, so a warning; D#5 (15) on 5 is legal.
    const far = lint([
      [0, 1.5, 'C4', 0, 1],
      [1, 2, 'E5', 0, 5],
    ]);
    expect(far.errors).toBe(0);
    expect(far.issues.map((i) => i.message)).toEqual([BEYOND_REACH]);
    expect(
      lint([
        [0, 1.5, 'C4', 0, 1],
        [1, 2, 'D#5', 0, 5],
      ]).errors,
    ).toBe(0);
    // A smaller hand reaches less: the small profile's 1-5 span is 12 semitones, so D5 over a
    // held C4 (14) is beyond its reach and within the large hand's.
    expect(HAND_PROFILES.small.tables.maxPrac[0]![4]).toBe(12);
    const d5: Row[] = [
      [0, 1.5, 'C4', 0, 1],
      [1, 2, 'D5', 0, 5],
    ];
    expect(lint(d5, { profile: 'small' }).issues.map((i) => i.message)).toEqual([BEYOND_REACH]);
    expect(lint(d5).issues.some((i) => i.message === BEYOND_REACH)).toBe(false);
  });
  it('a hold released beyond reach stays released for the rest of its notated length', () => {
    // C4 is notated 0-3 s on 1; E5 on 5 at 1 s is 16 semitones away, so the hold is a pedal or a
    // release (one L07). B4 on 2 at 2 s must not then be an L05 against the released C4 (11
    // semitones with 1-2), and G4 on 1 at 2 s must not be an L03 for the thumb's "held" key.
    const released = (third: Row): void => {
      const r = lint([[0, 3, 'C4', 0, 1], [1, 1.5, 'E5', 0, 5], third]);
      expect(r.errors).toBe(0);
      expect(r.issues.filter((i) => i.rule === 'L07').map((i) => [i.message, i.noteIds])).toEqual([
        [BEYOND_REACH, ['0', '1']],
      ]);
    };
    released([2, 2.5, 'B4', 0, 2]);
    released([2, 2.5, 'G4', 0, 1]);
    // The left hand reads the same in the mirrored view: C4 held on 1, G#2 on 5 (16 below), then
    // C#3 on 2 (11 below the released C4).
    const left = lint([
      [0, 3, 'C4', 1, -1],
      [1, 1.5, 'G#2', 1, -5],
      [2, 2.5, 'C#3', 1, -2],
    ]);
    expect(left.errors).toBe(0);
    expect(left.issues.filter((i) => i.message === BEYOND_REACH)).toHaveLength(1);
  });
  it('a chord releases a hold beyond the reach of any of its notes before its notes are checked', () => {
    // C4 held on 1 under the chord B4 E5 on 2 5: E5 is beyond reach, so the hand lets C4 go to
    // take the chord, and B4 (11 semitones with 1-2) is not a held pair, whatever the sequence
    // order of the chord's notes. The warning names the held note and the chord note out of reach.
    const r = lint([
      [0, 3, 'C4', 0, 1],
      [1, 2, 'B4', 0, 2],
      [1, 2, 'E5', 0, 5],
    ]);
    expect(r.errors).toBe(0);
    expect(r.issues.map((i) => [i.rule, i.message, i.noteIds])).toEqual([
      ['L07', BEYOND_REACH, ['0', '2']],
    ]);
    const left = lint([
      [0, 3, 'C4', 1, -1],
      [1, 2, 'C#3', 1, -2],
      [1, 2, 'G#2', 1, -5],
    ]);
    expect(left.errors).toBe(0);
    expect(left.issues.map((i) => [i.rule, i.message, i.noteIds])).toEqual([
      ['L07', BEYOND_REACH, ['0', '2']],
    ]);
  });
  it('documents the warning in the rule table', () => {
    expect(LINT_RULES.L07.law).toBe(false);
    expect(LINT_RULES.L07.title).toMatch(/hold beyond reach/);
  });
});

describe('forEachHold (reach.ts), the hold walk lint and solver share', () => {
  // M2 hardening re-review: lint released a hold for good, per slice, while the solver re-tested
  // reach for every (held, new) pair, so a released key could block a finger again in the solver.
  const t = HAND_PROFILES.large.tables;
  const note = (pitch: number, slice: number, onsetSec: number, offsetSec: number) => ({
    pitch,
    slice,
    onsetSec,
    offsetSec,
  });
  const walk = (notes: ReturnType<typeof note>[]) => {
    const held: number[][] = [];
    const released: number[][] = [];
    forEachHold(
      notes,
      t,
      (m, i) => held.push([m, i]),
      (m, far) => released.push([m, far]),
    );
    return { held, released };
  };
  it('visits held pairs at any distance, skips a repeated key and releases a hold once, for good', () => {
    const r = walk([
      note(60, 0, 0, 3), // C4 held 0-3 s
      note(64, 1, 1, 1.5), // E4: held pair (0, 1)
      note(60, 2, 1.5, 1.8), // C4 again: a key is not held under its own repetition
      note(76, 3, 2, 2.2), // E5, 16 semitones from C4: the hold is released here
      note(67, 4, 2.5, 2.8), // G4, 7 from C4: no longer held
    ]);
    expect(r.held).toEqual([[0, 1]]);
    expect(r.released).toEqual([[0, 3]]);
    expect(heldPairs([note(60, 0, 0, 3), note(64, 1, 1, 1.5)], t)).toEqual([[], [0]]);
  });
  it('decides a release per slice, before any of the slice notes is visited', () => {
    // C4 held under the chord B4 E5: E5 is beyond reach, so B4 is no held pair either, whichever
    // order the chord's notes come in; the release names the first chord note out of reach.
    const r = walk([note(60, 0, 0, 3), note(71, 1, 1, 2), note(76, 1, 1, 2)]);
    expect(r.held).toEqual([]);
    expect(r.released).toEqual([[0, 2]]);
  });
  it('takes the hold tolerance: a legato overlap within it is no hold (M3 Task 7, H1)', () => {
    const legato = [note(60, 0, 0, 0.53), note(62, 1, 0.5, 1)]; // C4 overlaps D4 by 30 ms
    expect(HOLD_EPS).toBe(1e-3);
    expect(heldPairs(legato, t)).toEqual([[], [0]]);
    expect(heldPairs(legato, t, HOLD_EPS)).toEqual([[], [0]]);
    expect(heldPairs(legato, t, 0.05)).toEqual([[], []]);
    // 100 ms is a held key at either tolerance.
    expect(heldPairs([note(60, 0, 0, 0.6), note(62, 1, 0.5, 1)], t, 0.05)).toEqual([[], [0]]);
    const seen: number[][] = [];
    forEachHold(legato, t, (m, i) => seen.push([m, i]), undefined, 0.05);
    expect(seen).toEqual([]);
  });
  it('lint takes the same tolerance (holdEpsSec): a 30 ms overlap on one finger is L03 only below it', () => {
    const rows: Row[] = [
      [0, 0.53, 'C4', 0, 2],
      [0.5, 1, 'D4', 0, 2],
    ];
    expect(lint(rows).counts.L03).toBe(1);
    expect(lint(rows, { holdEpsSec: 0.05 }).counts.L03 ?? 0).toBe(0);
    expect(lint(rows, { holdEpsSec: 0.05 }).errors).toBe(0);
  });
});
