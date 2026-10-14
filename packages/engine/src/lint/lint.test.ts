import { describe, expect, it } from 'vitest';
import { parsePig } from '../io/pig/read.js';
import { lintFingering } from './index.js';

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
