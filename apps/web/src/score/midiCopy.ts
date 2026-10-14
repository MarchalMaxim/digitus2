/**
 * The words the score view shows for a MIDI import: the quantization grid, the share of notes
 * the grid moved, the notes per hand, and the keys of the Hand split control.
 */
import type { GridKind, MidiInfo } from '@digitus2/engine';

/** The keys the Hand split control offers: C2 to C6. */
export const SPLIT_KEYS: readonly number[] = Array.from({ length: 49 }, (_, i) => 36 + i);
export const SPLIT_HELP = 'Keys from the chosen note upward go to the right hand.';
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** 60 -> 'C4', 61 -> 'C#4'. */
export function noteName(midi: number): string {
  return `${NAMES[midi % 12]!}${Math.floor(midi / 12) - 1}`;
}

/** 32nd notes when any beat used them, "with triplets" when any beat used triplets. */
export function gridPhrase(grids: Record<GridKind, number>): string {
  const base = grids['32nd'] > 0 ? 'a 32nd-note grid' : 'a 16th-note grid';
  return grids['16th-triplet'] > 0 ? `${base} with triplets` : base;
}

export function importLine(info: MidiInfo): string {
  return `Imported from MIDI: notes quantized to ${gridPhrase(info.grids)}; ${Math.round(info.quantizedMovedShare * 100)} % moved more than a 64th note`;
}

export function handCountLine(right: number, left: number): string {
  const notes = (n: number) => `${n} note${n === 1 ? '' : 's'}`;
  return `Right hand: ${notes(right)} · left hand: ${notes(left)}`;
}
