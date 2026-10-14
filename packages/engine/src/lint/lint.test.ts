import { describe, expect, it } from 'vitest';
import { pairWindows } from '../fingering/sequence.js';
import { parsePig } from '../io/pig/read.js';
import { lintFingering, positionChanges, wideStretches } from './index.js';

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
const rules = (rows: Row[], opts = {}) =>
  lint(rows, opts)
    .issues.map((i) => i.rule)
    .sort();

describe('lint laws', () => {
  it('L01 same finger in a chord, with the adjacent-white-thumb exception', () => {
    expect(
      rules([
        [0, 1, 'C4', 0, 2],
        [0, 1, 'E4', 0, 2],
      ]),
    ).toContain('L01');
    const r = lint([
      [0, 1, 'C4', 0, 1],
      [0, 1, 'D4', 0, 1],
    ]);
    expect(r.issues.find((i) => i.rule === 'L01')!.severity).toBe('info');
  });
  it('L02 crossed chord fingers', () => {
    expect(
      rules([
        [0, 1, 'C4', 0, 3],
        [0, 1, 'E4', 0, 2],
      ]),
    ).toContain('L02');
    expect(
      rules([
        [0, 1, 'C3', 1, -3],
        [0, 1, 'E3', 1, -5],
      ]),
    ).toContain('L02'); // left hand: lower note needs the higher finger number
    expect(
      rules([
        [0, 1, 'C3', 1, -5],
        [0, 1, 'E3', 1, -3],
      ]),
    ).not.toContain('L02');
  });
  it('L03 finger reused while holding a key', () => {
    expect(
      rules([
        [0, 2, 'C4', 0, 1],
        [1, 1.5, 'G4', 0, 1],
      ]),
    ).toContain('L03');
    expect(
      rules([
        [0, 2, 'C4', 0, '1_2'],
        [1, 1.5, 'G4', 0, 1],
      ]),
    ).not.toContain('L03');
    expect(
      rules([
        [0, 1, 'C4', 0, 1],
        [1, 1.5, 'G4', 0, 1],
      ]),
    ).not.toContain('L03');
  });
  it('L04 more than five notes in one hand at once', () => {
    expect(
      rules([
        [0, 1, 'C4', 0, 1],
        [0, 1, 'D4', 0, 2],
        [0, 1, 'E4', 0, 3],
        [0, 1, 'F4', 0, 4],
        [0, 1, 'G4', 0, 5],
        [0, 1, 'A4', 0, 5],
      ]),
    ).toContain('L04');
  });
  it('L05 span beyond the practical maximum', () => {
    // M2 review: between consecutive notes L05 is a law only while the earlier key still sounds
    // (planned: always). C4 is held to 1.5 s here, so both keys are down at once.
    expect(
      rules([
        [0, 1.5, 'C4', 0, 1],
        [1, 2, 'D#5', 0, 4],
      ]),
    ).toContain('L05'); // 15 semitones with 1-4, maxPrac 14
    // M2 hardening Task 2: 16 semitones (C4 to E5 with 1-5, maxPrac 15) is beyond any hand's reach
    // (`outOfReach`, the solver's test), so the notated hold is a pedal or a release: a warning.
    const beyondReach = lint([
      [0, 1.5, 'C4', 0, 1],
      [1, 2, 'E5', 0, 5],
    ]);
    expect(beyondReach.issues.map((i) => [i.rule, i.severity])).toEqual([['L07', 'warning']]);
    expect(beyondReach.errors).toBe(0);
    expect(
      rules([
        [0, 1.5, 'C4', 0, 1],
        [1, 2, 'D5', 0, 5],
      ]),
    ).not.toContain('L05'); // 14 semitones with 1-5 is within practical
    // Released first, the same leap is a hand shift: an L07 warning, not a law.
    const shift = lint([
      [0, 1, 'C4', 0, 1],
      [1, 2, 'E5', 0, 5],
    ]);
    expect(shift.issues.map((i) => [i.rule, i.severity])).toEqual([['L07', 'warning']]);
    expect(shift.errors).toBe(0);
    expect(
      rules([
        [0, 1, 'C4', 0, 2],
        [0, 1, 'C5', 0, 3],
      ]),
    ).toContain('L05'); // octave with 2-3 inside a chord
  });
});

describe('lint preferences', () => {
  it('L06 non-thumb crossing is a warning, an error for beginners', () => {
    const rows: Row[] = [
      [0, 0.5, 'E4', 0, 3],
      [0.5, 1, 'D4', 0, 4],
    ];
    expect(lint(rows).issues.find((i) => i.rule === 'L06')!.severity).toBe('warning');
    expect(lint(rows, { beginner: true }).issues.find((i) => i.rule === 'L06')!.severity).toBe(
      'error',
    );
    expect(
      rules([
        [0, 0.5, 'E4', 0, 3],
        [0.5, 1, 'F4', 0, 1],
      ]),
    ).not.toContain('L06');
  });
  it('L07 uncomfortable span', () => {
    expect(
      rules([
        [0, 0.5, 'C4', 0, 1],
        [0.5, 1, 'A4', 0, 2],
      ]),
    ).toContain('L07'); // 9 semitones 1-2, maxComf 8
  });
  it('L08, L09, L10 black-key rules', () => {
    expect(
      rules([
        [0, 0.5, 'C4', 0, 2],
        [0.5, 1, 'C#4', 0, 1],
        [1, 1.5, 'D4', 0, 2],
      ]),
    ).toContain('L08');
    expect(
      rules([
        [0, 0.5, 'C4', 0, 4],
        [0.5, 1, 'D#4', 0, 5],
      ]),
    ).toContain('L09');
    expect(
      rules([
        [0, 0.5, 'E4', 0, 3],
        [0.5, 1, 'F#4', 0, 1],
      ]),
    ).toContain('L10');
    expect(
      rules([
        [0, 0.5, 'E4', 0, 3],
        [0.5, 1, 'F4', 0, 1],
      ]),
    ).not.toContain('L10');
  });
  it('L11, L12, L13 same-finger and repeated-key rules', () => {
    expect(
      rules([
        [0, 0.1, 'C4', 0, 2],
        [0.1, 0.2, 'D4', 0, 2],
      ]),
    ).toContain('L11');
    expect(
      rules([
        [0, 0.5, 'C4', 0, 2],
        [0.5, 1, 'D4', 0, 2],
      ]),
    ).not.toContain('L11');
    expect(
      rules([
        [0, 0.1, 'C4', 0, 2],
        [0.1, 0.2, 'C4', 0, 2],
      ]),
    ).toContain('L12');
    expect(
      rules([
        [0, 0.5, 'C4', 0, 2],
        [0.5, 1, 'C4', 0, 3],
      ]),
    ).toContain('L13');
  });
  it('L14 agility', () => {
    expect(
      rules([
        [0, 0.5, 'C4', 0, 3],
        [0.5, 1, 'D4', 0, 4],
      ]),
    ).toContain('L14');
    expect(
      rules([
        [0, 0.5, 'C4', 0, 4],
        [0.5, 1, 'D4', 0, 5],
        [1, 1.5, 'E4', 0, 3],
      ]),
    ).toContain('L14');
    expect(
      rules([
        [0, 0.5, 'C4', 0, 4],
        [0.5, 1, 'C#4', 0, 3],
      ]),
    ).not.toContain('L14');
    expect(
      rules([
        [0, 0.5, 'C4', 0, 3],
        [0.5, 1, 'C#4', 0, 4],
      ]),
    ).toContain('L14');
  });
});

describe('L15 thumb crossing inside one five-finger position (beginner)', () => {
  // A legato melody at quarter = 120 (0.5 s a note); channel 1 is the left hand.
  const melody = (pitches: string[], fingers: number[], ch = 0): Row[] =>
    pitches.map((p, i) => [i * 0.5, i * 0.5 + 0.5, p, ch, ch === 0 ? fingers[i]! : -fingers[i]!]);
  // Twinkle bars 3 and 4 as the UI review of 2026-10-14 read them: F4 2 2, E4 1 1, D4 2 2, C4 1.
  const twinkle = (fingers: number[]) =>
    melody(['F4', 'F4', 'E4', 'E4', 'D4', 'D4', 'C4'], fingers);
  it('flags finger 2 over the thumb in Twinkle, a warning for beginners only', () => {
    const r = lint(twinkle([2, 2, 1, 1, 2, 2, 1]), { beginner: true });
    const l15 = r.issues.filter((i) => i.rule === 'L15');
    expect(l15.map((i) => i.noteIds)).toEqual([['3', '4']]);
    expect(l15[0]!.severity).toBe('warning');
    expect(rules(twinkle([2, 2, 1, 1, 2, 2, 1]))).not.toContain('L15');
    // In C position (4 4 3 3 2 2 1) nothing crosses.
    expect(rules(twinkle([4, 4, 3, 3, 2, 2, 1]), { beginner: true })).not.toContain('L15');
  });
  it('flags the thumb passing under inside a position, in either hand', () => {
    // C D E D C with 1 2 1 2 1: the thumb passes under 2 on the way up and 2 crosses over it on
    // the way down, inside a third.
    const r = lint(melody(['C4', 'D4', 'E4', 'D4', 'C4'], [1, 2, 1, 2, 1]), { beginner: true });
    expect(r.counts.L15).toBe(2);
    // The left hand, mirrored: C3 B2 A2 B2 C3 with 1 2 1 2 1.
    const l = lint(melody(['C3', 'B2', 'A2', 'B2', 'C3'], [1, 2, 1, 2, 1], 1), { beginner: true });
    expect(l.counts.L15).toBe(2);
    expect(l.issues.find((i) => i.rule === 'L15')!.hand).toBe('L');
  });
  it('does not flag the crossings of scales, which carry the hand beyond a position', () => {
    const up = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
    expect(rules(melody(up, [1, 2, 3, 1, 2, 3, 4, 5]), { beginner: true })).not.toContain('L15');
    const down = [...up].reverse();
    expect(rules(melody(down, [5, 4, 3, 2, 1, 3, 2, 1]), { beginner: true })).not.toContain('L15');
    // Bb major down to its last note: near the end of the run the window keeps six notes.
    const bb = ['Bb4', 'A4', 'G4', 'F4', 'Eb4', 'D4', 'C4', 'Bb3'];
    expect(rules(melody(bb, [4, 3, 2, 1, 3, 2, 1, 2]), { beginner: true })).not.toContain('L15');
    // Happy Birthday's D5 B4 G4 F#4 E4 C5 with 5 3 1 2 1 5 leaves the position (a seventh).
    const hb = ['D5', 'B4', 'G4', 'F#4', 'E4', 'C5'];
    expect(rules(melody(hb, [5, 3, 1, 2, 1, 5]), { beginner: true })).not.toContain('L15');
  });
  it('L24 shows a beginner every crossing that moves the hand, as an info', () => {
    // Happy Birthday bars 5-6: the UI review keeps 2 over the thumb from G4 to F#4 and would point
    // it out to a level 2 student.
    const hb = melody(['D5', 'B4', 'G4', 'F#4', 'E4', 'C5'], [5, 3, 1, 2, 1, 5]);
    const r = lint(hb, { beginner: true });
    expect(r.issues.filter((i) => i.rule === 'L24')).toEqual([
      expect.objectContaining({ severity: 'info', hand: 'R', noteIds: ['2', '3'] }),
    ]);
    expect(rules(hb)).not.toContain('L24');
    // A scale's crossing (3 to 1 from E4 to F4), and the left hand's.
    const up = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
    expect(lint(melody(up, [1, 2, 3, 1, 2, 3, 4, 5]), { beginner: true }).counts.L24).toBe(1);
    const lh = ['C3', 'B2', 'A2', 'G2', 'F2', 'E2', 'D2', 'C2'];
    expect(lint(melody(lh, [1, 2, 3, 1, 2, 3, 4, 5], 1), { beginner: true }).counts.L24).toBe(1);
    // A crossing inside one position is L15, not L24; no crossing, neither.
    const twinkle = melody(['F4', 'F4', 'E4', 'E4', 'D4', 'D4', 'C4'], [2, 2, 1, 1, 2, 2, 1]);
    expect(lint(twinkle, { beginner: true }).counts).toMatchObject({ L15: 1 });
    expect(rules(twinkle, { beginner: true })).not.toContain('L24');
    const fivePosition = rules(melody(up.slice(0, 5), [1, 2, 3, 4, 5]), { beginner: true });
    expect(fivePosition.filter((id) => id === 'L15' || id === 'L24')).toEqual([]);
  });
  it('does not flag the crossings of a chromatic run: more than five keys are not one position', () => {
    // C4 to G4 chromatic with the textbook 1 3 1 3 1 2 3 1 spans three white keys, but a
    // five-finger position holds one key per finger.
    const up = ['C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4'];
    expect(rules(melody(up, [1, 3, 1, 3, 1, 2, 3, 1]), { beginner: true })).not.toContain('L15');
    const down = [...up].reverse();
    expect(rules(melody(down, [1, 3, 2, 1, 3, 1, 3, 1]), { beginner: true })).not.toContain('L15');
    // pairWindows: a window of six distinct keys is no position; five keys in two white keys are.
    const run = up.map((_, k) => ({ pitch: 60 + k, slice: k, restBefore: false }));
    expect(pairWindows(run).slice(1)).toEqual(Array(7).fill(Number.POSITIVE_INFINITY));
    expect(pairWindows(run.slice(0, 5)).slice(1)).toEqual([2, 2, 2, 2]);
    // Repeated keys count once: C C# C C# C C# is two keys.
    const trill = [60, 61, 60, 61, 60, 61].map((pitch, k) => ({
      pitch,
      slice: k,
      restBefore: false,
    }));
    expect(pairWindows(trill)[1]).toBe(0.5);
  });
  it('a rest or a chord ends the passage', () => {
    // G4 E4 D4 with 3 1 2, then a rest and a leap: the run G4 E4 D4 fits a position.
    const rows: Row[] = [
      [0, 0.5, 'G4', 0, 3],
      [0.5, 1, 'E4', 0, 1],
      [1, 1.5, 'D4', 0, 2],
      [2, 2.5, 'A5', 0, 5],
    ];
    expect(lint(rows, { beginner: true }).counts.L15).toBe(1);
    // A chord between the two notes: no pair of single notes, no L15.
    const chord: Row[] = [
      [0, 0.5, 'E4', 0, 1],
      [0.5, 1, 'C4', 0, 1],
      [0.5, 1, 'G4', 0, 4],
      [1, 1.5, 'D4', 0, 2],
    ];
    expect(rules(chord, { beginner: true })).not.toContain('L15');
  });
});

describe('positionChanges and wideStretches', () => {
  it('counts a position change where the implied five-finger anchor moves a white key or more', () => {
    const { score, assignment } = parsePig(
      pig([
        [0, 0.5, 'C4', 0, 1],
        [0.5, 1, 'D4', 0, 2],
        [1, 1.5, 'F#4', 0, 3], // 3 on F#: the anchor moves a key and a half, a change
        [1.5, 2, 'G4', 0, 4], // half a key back: the same position
        [2, 2.5, 'A4', 0, 1], // the thumb moves up: a change
        [2.5, 3, 'A4', 0, 1],
      ]),
    );
    expect(positionChanges(score, assignment)).toBe(2);
    // D E F# G A under 1 2 3 4 5 is one position, whatever the black key does to the anchor.
    const d = parsePig(
      pig(
        ['D4', 'E4', 'F#4', 'G4', 'A4'].map((p, i): Row => [i * 0.5, i * 0.5 + 0.5, p, 0, i + 1]),
      ),
    );
    expect(positionChanges(d.score, d.assignment)).toBe(0);
    // Chord notes are one event: C E G with 1 2 5, then with 1 3 5, then with 1 3 5 again.
    const chords = parsePig(
      pig([
        [0, 1, 'C4', 0, 1],
        [0, 1, 'E4', 0, 2],
        [0, 1, 'G4', 0, 5],
        [1, 2, 'C4', 0, 1],
        [1, 2, 'E4', 0, 3],
        [1, 2, 'G4', 0, 5],
      ]),
    );
    expect(positionChanges(chords.score, chords.assignment)).toBe(0);
  });
  it('a wide stretch is a key held more than an octave from a later note, or a legato reach', () => {
    // C4 held under D5: 14 semitones, within the large hand's reach (15 with 1-5).
    const held = parsePig(
      pig([
        [0, 2, 'C4', 0, 1],
        [1, 2, 'D5', 0, 5],
      ]),
    );
    expect(wideStretches(held.score, held.assignment).map((s) => s.kind)).toEqual(['held']);
    // A legato leap of a ninth from 1 to 5 is a reach; released before it, a shift.
    const reach = parsePig(
      pig([
        [0, 1, 'C4', 0, 1],
        [1, 2, 'D5', 0, 5],
      ]),
    );
    expect(wideStretches(reach.score, reach.assignment)).toEqual([
      { kind: 'reach', hand: 'R', noteIds: ['0', '1'], semitones: 14 },
    ]);
    const shift = parsePig(
      pig([
        [0, 0.9, 'C4', 0, 1],
        [1, 2, 'D5', 0, 5],
      ]),
    );
    expect(wideStretches(shift.score, shift.assignment)).toEqual([]);
    // The same finger, or two fingers that cannot span the leap, move the hand: no reach.
    for (const g of [1, 2]) {
      const moved = parsePig(
        pig([
          [0, 1, 'C4', 0, g],
          [1, 2, 'D5', 0, g === 1 ? 1 : 5],
        ]),
      );
      expect(wideStretches(moved.score, moved.assignment)).toEqual([]);
    }
    // An octave is not wider than an octave; a hold beyond any hand's reach is a pedal.
    const octave = parsePig(
      pig([
        [0, 2, 'C4', 0, 1],
        [1, 2, 'C5', 0, 5],
      ]),
    );
    expect(wideStretches(octave.score, octave.assignment)).toEqual([]);
    const pedal = parsePig(
      pig([
        [0, 2, 'C4', 0, 1],
        [1, 2, 'E5', 0, 5],
      ]),
    );
    expect(wideStretches(pedal.score, pedal.assignment)).toEqual([]);
  });
});

describe('report', () => {
  it('counts by rule and severity and ignores unfingered notes', () => {
    const r = lint([
      [0, 1, 'C4', 0, 2],
      [0, 1, 'E4', 0, 2],
      [1, 2, 'G4', 0, 0],
    ]);
    expect(r.notes).toBe(3);
    expect(r.counts.L01).toBe(1);
    expect(r.errors).toBeGreaterThanOrEqual(1);
    expect(r.issues.every((i) => !i.noteIds.includes('2'))).toBe(true);
  });
  it('is clean on a textbook scale', () => {
    const scale: Row[] = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'].map((p, i) => [
      i * 0.5,
      i * 0.5 + 0.5,
      p,
      0,
      [1, 2, 3, 1, 2, 3, 4, 5][i]!,
    ]);
    const r = lint(scale);
    expect(r.errors).toBe(0);
    // Two agility warnings: 3 to 4 at A-B, and the 3-4-5 run on A-B-C. Both are preferences, not laws.
    expect(r.issues.filter((i) => i.severity === 'warning').map((i) => i.rule)).toEqual([
      'L14',
      'L14',
    ]);
  });
});
