// The level heuristic: the port of content/tools/level.py's `score` and `propose`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../io/musicxml/read.js';
import { LEVEL_CUTS, levelFeatures, levelScore, proposeLevel, round3 } from './level.js';
import type { LevelFeatures } from './level.js';
import { fixtureScore } from './testing/score.js';

const repo = new URL('../../../../', import.meta.url);

describe('the level heuristic', () => {
  it('proposes 1 plus the number of cuts strictly below the score', () => {
    expect(LEVEL_CUTS).toEqual([1.76, 4.09, 9.11, 12.68]);
    expect(proposeLevel(0)).toBe(1);
    expect(proposeLevel(1.76)).toBe(1);
    expect(proposeLevel(1.761)).toBe(2);
    expect(proposeLevel(4.09)).toBe(2);
    expect(proposeLevel(9.12)).toBe(4);
    expect(proposeLevel(12.68)).toBe(4);
    expect(proposeLevel(12.69)).toBe(5);
  });

  it('round3 rounds to three decimals', () => {
    expect(round3(1.20742)).toBe(1.207);
    expect(round3(2.0004)).toBe(2);
  });

  it('scores the features recorded for twinkle-twinkle-little-star', () => {
    const verification = JSON.parse(
      readFileSync(fileURLToPath(new URL('content/verification.json', repo)), 'utf8'),
    ) as Record<string, { levelProposal: { features: LevelFeatures; score: number } }>;
    const rec = verification['twinkle-twinkle-little-star']!.levelProposal;
    expect(round3(levelScore(rec.features))).toBe(rec.score);
  });

  it('weighs each feature as level.py does, with the caps', () => {
    const zero: LevelFeatures = {
      nps: 0,
      shifts: 0,
      span: 0,
      chord: 0,
      fifths: 0,
      accidentals: 0,
      seconds: 0,
      leaps: 0,
    };
    expect(levelScore(zero)).toBe(0);
    expect(levelScore({ ...zero, nps: 20 })).toBeCloseTo(0.35 * 12, 12);
    expect(levelScore({ ...zero, span: 5 })).toBe(0);
    expect(levelScore({ ...zero, span: 9 })).toBeCloseTo(0.24, 12);
    expect(levelScore({ ...zero, seconds: 600 })).toBeCloseTo(1.2, 12);
    expect(levelScore({ ...zero, chord: 0.5, fifths: 2, accidentals: 10, leaps: 4 })).toBeCloseTo(
      1 + 0.5 + 0.5 + 0.2,
      12,
    );
  });

  it('computes the features of a small two-hand score', () => {
    // Bar 1: C4 E4 G4 C5 (a shift at C5, beyond the 7-semitone window), bar 2: a C4-E4 chord and an
    // F#4. Left hand: C3 then C2, a leap of an octave (not more than 12: no leap).
    const xml = fixtureScore(
      [
        [
          ['C4', 1],
          ['E4', 1],
          ['G4', 1],
          ['C5', 1],
        ],
        [
          [['C4', 'E4'], 2],
          ['F#4', 2],
        ],
      ],
      { lh: [[['C3', 4]], [['C2', 4]]], fifths: 0 },
    );
    const { score } = parseMusicXml(xml);
    const f = levelFeatures(score, 120);
    // 8 quarters at 120 qpm: 4 seconds; 9 notes struck.
    expect(f.seconds).toBe(4);
    expect(f.nps).toBe(9 / 4);
    expect(f.span).toBe(4);
    expect(f.fifths).toBe(0);
    expect(f.accidentals).toBe((100 * 1) / 9);
    // Right hand: 6 slices, one chord; left hand: 2 slices.
    expect(f.chord).toBe(1 / 6);
    // Right: C4 E4 G4 (window 60-67), C5 shifts, C4-E4 shifts back (72 to 60), F#4 stays: 2 of 6.
    // Left: C3, C2 shifts (12 > 7): 1 of 2.
    expect(f.shifts).toBe(((100 * 2) / 6 + (100 * 1) / 2) / 2);
    // Right centres 60 64 67 72 62 66: none more than 12 apart; left 48 36: exactly 12, not more.
    expect(f.leaps).toBe(0);
  });

  it('reads the key from the first key signature, as the absolute fifths', () => {
    const xml = fixtureScore(
      [
        [
          ['Bb4', 2],
          ['A4', 2],
        ],
        [['F4', 4]],
      ],
      { lh: [[['F3', 4]], [['Eb3', 4]]], fifths: -1 },
    );
    const f = levelFeatures(parseMusicXml(xml).score, 60);
    expect(f.fifths).toBe(1);
    // F major: Eb is outside the scale, Bb is inside; floor modulo for the tonic (7 * -1) % 12 = 5.
    expect(f.accidentals).toBe((100 * 1) / 5);
  });

  it('a one-staff score is all right hand', () => {
    const xml = fixtureScore(
      [
        [
          ['C4', 2],
          ['C5', 2],
        ],
        [['C4', 4]],
      ],
      { staves: 1 },
    );
    const f = levelFeatures(parseMusicXml(xml).score, 60);
    expect(f.leaps).toBe((100 * 0) / 3);
    expect(f.shifts).toBe((100 * 2) / 3);
  });
});
