import { handEvents } from '../score/build.js';
import type { Hand, Note, Score } from '../score/types.js';
import { isBlack, mirrorPitch } from './geometry.js';
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
