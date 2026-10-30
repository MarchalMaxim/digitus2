import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en/index.js';
import { handCountLine, noteName, SPLIT_KEYS } from './midiCopy.js';

describe('MIDI copy', () => {
  it('names all twelve pitch classes with sharps', () => {
    expect(Array.from({ length: 12 }, (_, i) => noteName(60 + i))).toEqual([
      'C4',
      'C#4',
      'D4',
      'D#4',
      'E4',
      'F4',
      'F#4',
      'G4',
      'G#4',
      'A4',
      'A#4',
      'B4',
    ]);
  });
  it('counts notes per hand', () => {
    expect(handCountLine(42, 22)).toBe('Right hand: 42 notes · left hand: 22 notes');
    expect(handCountLine(1, 0)).toBe('Right hand: 1 note · left hand: 0 notes');
  });
  it('offers the keys from C2 to C6 by name and explains the split', () => {
    expect(SPLIT_KEYS).toHaveLength(49);
    expect(SPLIT_KEYS.slice(0, 3).map((m) => noteName(m))).toEqual(['C2', 'C#2', 'D2']);
    expect(noteName(60)).toBe('C4');
    expect(noteName(SPLIT_KEYS[SPLIT_KEYS.length - 1]!)).toBe('C6');
    expect(en.score.midi.splitHelp).toBe('Keys from the chosen note upward go to the right hand.');
  });
});
