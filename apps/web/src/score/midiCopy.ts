/**
 * The words the score view shows for a MIDI import: the quantization grid, the share of notes
 * the grid moved, the notes per hand, and the keys of the Hand split control. Each takes the
 * texts to write in (default: the language on screen).
 */
import type { GridKind, MidiInfo } from '@digitus2/engine';
import { messages } from '../i18n/i18n.js';
import type { Messages } from '../i18n/messages.js';

/** The keys the Hand split control offers: C2 to C6. */
export const SPLIT_KEYS: readonly number[] = Array.from({ length: 49 }, (_, i) => 36 + i);

/** The index of each pitch class in the seven natural notes (C D E F G A B), sharps below. */
const NATURAL_OF = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const SHARPS = new Set([1, 3, 6, 8, 10]);

/** 60 -> 'C4', 61 -> 'C#4' ('Do4', 'Do#4' where the notes are called that). */
export function noteName(midi: number, t: Messages = messages()): string {
  const pc = ((midi % 12) + 12) % 12;
  return `${t.score.noteLetters[NATURAL_OF[pc]!]!}${SHARPS.has(pc) ? '#' : ''}${Math.floor(midi / 12) - 1}`;
}

/** 32nd notes when any beat used them, "with triplets" when any beat used triplets. */
export function gridPhrase(grids: Record<GridKind, number>, t: Messages = messages()): string {
  const g = t.score.midi.grids;
  const triplets = grids['16th-triplet'] > 0;
  if (grids['32nd'] > 0) return triplets ? g.thirtySecondTriplets : g.thirtySecond;
  return triplets ? g.sixteenthTriplets : g.sixteenth;
}

export function importLine(info: MidiInfo, t: Messages = messages()): string {
  return t.score.midi.importLine(
    gridPhrase(info.grids, t),
    Math.round(info.quantizedMovedShare * 100),
  );
}

export function handCountLine(right: number, left: number, t: Messages = messages()): string {
  return t.score.midi.handCounts(right, left);
}
