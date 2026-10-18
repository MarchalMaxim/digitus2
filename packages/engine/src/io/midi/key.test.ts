import { describe, expect, it } from 'vitest';
import { formatPigPitch } from '../../score/pitch.js';
import { estimateKey, keyFifths, keyName, spellMidi } from './key.js';

const notes = (spec: Array<[number, number]>) =>
  spec.map(([midi, duration]) => ({ midi, duration }));
const spell = (midi: number, fifths: number, mode?: 'major' | 'minor') =>
  formatPigPitch(spellMidi(midi, mode ? { fifths, mode } : { fifths }));

describe('estimateKey', () => {
  it('finds C major', () => {
    const k = estimateKey(
      notes([
        [60, 4],
        [64, 2],
        [67, 2],
        [48, 4],
        [55, 2],
        [65, 1],
        [62, 1],
        [59, 1],
        [69, 1],
        [72, 2],
      ]),
    );
    expect(k).toMatchObject({ tonic: 0, mode: 'major', fifths: 0 });
  });
  it('finds A minor', () => {
    const k = estimateKey(
      notes([
        [57, 4],
        [60, 2],
        [64, 2],
        [45, 4],
        [56, 1],
        [59, 1],
        [62, 1],
        [65, 1],
        [69, 2],
      ]),
    );
    expect(k).toMatchObject({ tonic: 9, mode: 'minor', fifths: 0 });
  });
  it('finds E-flat major', () => {
    const k = estimateKey(
      notes([
        [63, 4],
        [67, 2],
        [70, 2],
        [51, 4],
        [68, 1],
        [65, 1],
        [62, 1],
        [60, 1],
        [75, 2],
      ]),
    );
    expect(k).toMatchObject({ tonic: 3, mode: 'major', fifths: -3 });
  });
  it('falls back to C major without notes', () => {
    expect(estimateKey([])).toMatchObject({ tonic: 0, mode: 'major', fifths: 0 });
  });
  it('maps tonics to key signatures', () => {
    expect(keyFifths(7, 'major')).toBe(1);
    expect(keyFifths(1, 'major')).toBe(-5);
    expect(keyFifths(4, 'minor')).toBe(1);
    expect(keyFifths(0, 'minor')).toBe(-3);
    // Every major tonic against its key signature: sharps up the circle of fifths, flats down.
    const majors = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]; // C Db D Eb E F F# G Ab A Bb B
    majors.forEach((fifths, tonic) => expect(keyFifths(tonic, 'major')).toBe(fifths));
  });
});

describe('spellMidi and keyName', () => {
  it('spells chromatic notes in C major toward the key, ties going to sharps', () => {
    expect([61, 63, 66, 68, 70].map((m) => spell(m, 0))).toEqual([
      'C#4',
      'Eb4',
      'F#4',
      'G#4',
      'Bb4',
    ]);
  });
  it('raises the sixth and seventh degrees in minor keys', () => {
    expect(spell(68, 0, 'minor')).toBe('G#4');
    expect(spell(61, -1, 'minor')).toBe('C#4');
    expect(spell(66, -2, 'minor')).toBe('F#4');
    expect(spell(64, -2, 'minor')).toBe('E4');
  });
  it('uses the letters of flat and sharp keys, including B-sharp, E-sharp and C-flat', () => {
    expect([63, 68, 70, 66].map((m) => spell(m, -3))).toEqual(['Eb4', 'Ab4', 'Bb4', 'Gb4']);
    expect(spell(60, 7)).toBe('B#3');
    expect(spell(65, 6)).toBe('E#4');
    expect(spell(71, -6)).toBe('Cb5');
  });
  it('names keys', () => {
    expect(keyName({ fifths: 0, mode: 'major' })).toBe('C major');
    expect(keyName({ fifths: 0, mode: 'minor' })).toBe('A minor');
    expect(keyName({ fifths: -3 })).toBe('E-flat major');
    expect(keyName({ fifths: 3, mode: 'minor' })).toBe('F-sharp minor');
  });
});
