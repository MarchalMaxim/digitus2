import { handEvents } from '../score/build.js';
import type { Finger, Hand, Note, Score } from '../score/types.js';
import { isBlack, mirrorPitch, x14 } from './geometry.js';
import type { NoteView } from './rules.js';

export interface SeqNote extends NoteView {
  index: number;
  noteId: string;
  midi: number;
  isGrace: boolean;
}

export interface HandSequence {
  hand: Hand;
  notes: SeqNote[];
  sliceCount: number;
}

export const GRACE_IOI_SEC = 0.05;
const EPS = 1e-3;

export function buildHandSequence(score: Score, hand: Hand): HandSequence {
  const view = (n: Note): number => (hand === 'L' ? mirrorPitch(n.midi) : n.midi);
  const notes: SeqNote[] = [];
  let slice = 0;
  let prevOnset: number | undefined;
  let prevWasGrace = false;
  let maxOffset = Number.NEGATIVE_INFINITY;
  for (const ev of handEvents(score, hand)) {
    const groups: Array<{ notes: Note[]; grace: boolean }> = [];
    const graces = ev.notes.filter((n) => n.isGrace);
    const mains = ev.notes.filter((n) => !n.isGrace);
    if (graces.length > 0) groups.push({ notes: graces, grace: true });
    if (mains.length > 0) groups.push({ notes: mains, grace: false });
    for (const group of groups) {
      const ordered = [...group.notes].sort(
        // Ids compare by code unit, not localeCompare, whose order depends on the runtime's locale.
        (a, b) => view(a) - view(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
      const onset = ordered[0]!.onsetSec;
      let ioi = 0;
      if (prevOnset !== undefined)
        ioi = prevWasGrace ? GRACE_IOI_SEC : Math.max(0, onset - prevOnset);
      const restBefore = notes.length > 0 && maxOffset < onset - EPS;
      for (const n of ordered) {
        notes.push({
          index: notes.length,
          noteId: n.id,
          midi: n.midi,
          pitch: view(n),
          black: isBlack(n.midi),
          onsetSec: n.onsetSec,
          offsetSec: n.offsetSec,
          slice,
          restBefore,
          ioi,
          isGrace: n.isGrace,
        });
      }
      for (const n of ordered) maxOffset = Math.max(maxOffset, n.offsetSec);
      prevOnset = onset;
      prevWasGrace = group.grace;
      slice++;
    }
  }
  return { hand, notes, sliceCount: slice };
}

/**
 * Widest passage, in white keys (x14 / 2, so a black key counts half way), that one five-finger
 * position plays without a crossing: five neighbouring white keys under the five fingers.
 */
export const FIVE_FINGER_SPAN = 4;
/** Most distinct keys one five-finger position plays without a crossing: one key per finger. */
export const FIVE_FINGER_KEYS = 5;
/** Notes of the run read on each side of a pair by `pairWindows`. */
export const POSITION_WINDOW = 2;

/**
 * A thumb crossing from finger g to finger f over interval `i` (semitones, mirrored for the left
 * hand): the thumb passes under a finger, or a finger over the thumb. The same test as the
 * thumbPassing rule (`pairTerms`) and lint L10.
 */
export function isThumbCrossing(g: Finger, f: Finger, i: number): boolean {
  return (g === 1 || f === 1) && (f - g) * i < 0;
}

/**
 * A finger crossing from finger g to finger f over interval `i` (semitones, mirrored for the left
 * hand): the later finger plays on the far side of the earlier one. A thumb crossing
 * (`isThumbCrossing`) or one finger over another (lint L06); a repeated finger crosses nothing.
 */
export function isCrossing(g: Finger, f: Finger, i: number): boolean {
  return (f - g) * i < 0;
}

/**
 * The passage around each pair of neighbouring notes of a hand's sequence (M3 Task 8: lint L15
 * and the beginner level's crossing cost). A run is a maximal stretch of single-note slices with
 * no rest before any note but its first: a chord or a rest ends it. For note k whose predecessor
 * k - 1 is in the same run, the entry is the extent in white keys (x14 / 2) of the window of the
 * run around the pair: POSITION_WINDOW notes before k - 1 to POSITION_WINDOW notes after k, moved
 * inside the run near its ends so that it keeps its six notes, or the whole run when the run is
 * shorter; +Infinity when the window has more than FIVE_FINGER_KEYS distinct keys, which no
 * position holds with one key per finger. Undefined when k - 1 and k are not neighbours in one
 * run. A thumb crossing between k - 1 and k is inside one five-finger position when the extent is
 * at most FIVE_FINGER_SPAN: one position plays the window without it. A scale's crossing is not
 * (six neighbouring scale notes span at least four and a half white keys, at the end of a run
 * too), nor is a chromatic scale's (six neighbouring keys span only two and a half to three white
 * keys, but they are six keys), nor one that carries a passage beyond a position (Happy Birthday's
 * D5 B4 G4 F#4 E4 C5). `notes` are in sequence order: all of a hand's notes, or the fingered ones
 * lint sees. The left hand's mirror keeps white-key distances and distinct keys.
 */
export function pairWindows(
  notes: ReadonlyArray<Pick<NoteView, 'pitch' | 'slice' | 'restBefore'>>,
): Array<number | undefined> {
  const size = new Map<number, number>();
  for (const n of notes) size.set(n.slice, (size.get(n.slice) ?? 0) + 1);
  // run[k]: the run of note k (-1 for a chord note); first and last note of each run.
  const run: number[] = [];
  const first: number[] = [];
  const last: number[] = [];
  notes.forEach((n, k) => {
    const single = size.get(n.slice) === 1;
    const prev = notes[k - 1];
    if (single && (prev === undefined || size.get(prev.slice) !== 1 || n.restBefore)) first.push(k);
    run.push(single ? first.length - 1 : -1);
    if (single) last[first.length - 1] = k;
  });
  return notes.map((_, k) => {
    const r = run[k]!;
    if (k === 0 || r < 0 || run[k - 1] !== r) return undefined;
    let lo = k - 1 - POSITION_WINDOW;
    let hi = k + POSITION_WINDOW;
    if (lo < first[r]!) [lo, hi] = [first[r]!, hi + first[r]! - lo];
    if (hi > last[r]!) [lo, hi] = [Math.max(first[r]!, lo - (hi - last[r]!)), last[r]!];
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    const keys = new Set<number>();
    for (let j = lo; j <= hi; j++) {
      const p = notes[j]!.pitch;
      keys.add(p);
      const x = x14(p);
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
    return keys.size > FIVE_FINGER_KEYS ? Number.POSITIVE_INFINITY : (max - min) / 2;
  });
}
