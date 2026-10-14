import { span } from './spans.js';
import type { SpanTables } from './spans.js';

/**
 * True when no hand of this profile can hold `heldPitch` while it plays `newPitch`: the interval
 * exceeds the widest practical span, `maxPrac(1, 5)` (15 semitones for the large profile). Such a
 * notated hold is a pedal or a release, not a key held under the finger, so the solver treats the
 * held note as released (its finger is free) and lint reports it as a warning, not a law.
 *
 * Pitches may be raw midi or mirrored (`124 - midi` for the left hand): only the size of the
 * interval matters, and the mirror keeps it.
 */
export function outOfReach(tables: SpanTables, heldPitch: number, newPitch: number): boolean {
  return Math.abs(newPitch - heldPitch) > span(tables, 'maxPrac', 1, 5);
}

/**
 * Seconds a key must outlast a later onset to count as held at it (as in the sequence): the default
 * hold tolerance. A caller may pass a larger one (M3 Task 7 H1, tried at 50 ms and not kept): a key
 * released within it of the next onset is a legato overlap, not a key held under the next note.
 */
export const HOLD_EPS = 1e-3;

/** What the hold walk reads of a note: (mirrored) pitch, slice and notated onset and offset. */
export interface HoldView {
  pitch: number;
  slice: number;
  onsetSec: number;
  offsetSec: number;
}

/**
 * The held keys of one hand, decided once for the solver and lint alike. Walks `notes` in sequence
 * order (onsets never decrease along a hand's sequence) and keeps the notes whose key is still
 * down: note m holds its key at note i's onset when m comes earlier, in another slice, and its
 * notated offset is more than the hold tolerance `eps` (default HOLD_EPS) after that onset. For
 * every such pair, in order of i and then of m:
 *
 * - a hold that no hand can span together with some note of i's slice (`outOfReach`) is a pedal or
 *   a release: `release(m, far)` is called once, `far` being the first note of the slice out of
 *   reach, and m stays released for the rest of its notated length. The release is decided per
 *   slice, before any of the slice's notes is visited, so a chord with one note beyond the hold's
 *   reach releases it for all of its notes, in whatever order the sequence lists them;
 * - a pair on one pitch is skipped: a key cannot be held under its own repetition;
 * - every other pair is a held pair, `held(m, i)`: both keys are down at once, so the two notes
 *   need two fingers that span their interval (lint L03 and L05; the solver's held-note law).
 */
export function forEachHold(
  notes: readonly HoldView[],
  tables: SpanTables,
  held: (m: number, i: number) => void,
  release?: (m: number, far: number) => void,
  eps: number = HOLD_EPS,
): void {
  const sliceNotes = new Map<number, number[]>();
  notes.forEach((n, k) => {
    const list = sliceNotes.get(n.slice) ?? [];
    list.push(k);
    sliceNotes.set(n.slice, list);
  });
  let active: number[] = [];
  const released = new Set<number>();
  for (let i = 0; i < notes.length; i++) {
    const cur = notes[i]!;
    active = active.filter((m) => notes[m]!.offsetSec > cur.onsetSec + eps && !released.has(m));
    for (const m of active) {
      const h = notes[m]!;
      if (h.slice === cur.slice) continue;
      const far = sliceNotes
        .get(cur.slice)!
        .find((y) => outOfReach(tables, h.pitch, notes[y]!.pitch));
      if (far !== undefined) {
        released.add(m);
        release?.(m, far);
        continue;
      }
      if (h.pitch !== cur.pitch) held(m, i);
    }
    active.push(i);
  }
}

/**
 * The held pairs of `notes` (`forEachHold` with the hold tolerance `eps`): for each note, the
 * earlier notes it sounds with.
 */
export function heldPairs(
  notes: readonly HoldView[],
  tables: SpanTables,
  eps: number = HOLD_EPS,
): number[][] {
  const out: number[][] = notes.map(() => []);
  forEachHold(notes, tables, (m, i) => out[i]!.push(m), undefined, eps);
  return out;
}
