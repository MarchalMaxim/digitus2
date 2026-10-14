import { describe, expect, it } from 'vitest';
import {
  gridPhrase,
  handCountLine,
  importLine,
  noteName,
  SPLIT_HELP,
  SPLIT_KEYS,
} from './midiCopy.js';

describe('MIDI copy', () => {
  it('names the grid the import used', () => {
    expect(gridPhrase({ '16th': 3, '16th-triplet': 0, '32nd': 0 })).toBe('a 16th-note grid');
    expect(gridPhrase({ '16th': 3, '16th-triplet': 1, '32nd': 0 })).toBe(
      'a 16th-note grid with triplets',
    );
    expect(gridPhrase({ '16th': 3, '16th-triplet': 0, '32nd': 2 })).toBe('a 32nd-note grid');
    expect(gridPhrase({ '16th': 0, '16th-triplet': 1, '32nd': 2 })).toBe(
      'a 32nd-note grid with triplets',
    );
  });
  it('writes the import line with a rounded percentage', () => {
    expect(
      importLine({
        quantizedMovedShare: 0.034,
        grids: { '16th': 8, '16th-triplet': 0, '32nd': 0 },
        splitMidi: null,
        warnings: [],
      }),
    ).toBe(
      'Imported from MIDI: notes quantized to a 16th-note grid; 3 % moved more than a 64th note',
    );
  });
  it('counts notes per hand', () => {
    expect(handCountLine(42, 22)).toBe('Right hand: 42 notes · left hand: 22 notes');
    expect(handCountLine(1, 0)).toBe('Right hand: 1 note · left hand: 0 notes');
  });
  it('offers the keys from C2 to C6 by name and explains the split', () => {
    expect(SPLIT_KEYS).toHaveLength(49);
    expect(SPLIT_KEYS.slice(0, 3).map(noteName)).toEqual(['C2', 'C#2', 'D2']);
    expect(noteName(60)).toBe('C4');
    expect(noteName(SPLIT_KEYS[SPLIT_KEYS.length - 1]!)).toBe('C6');
    expect(SPLIT_HELP).toBe('Keys from the chosen note upward go to the right hand.');
  });
});
