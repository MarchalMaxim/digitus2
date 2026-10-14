import type { Hand, Note, Score } from '@digitus2/engine';

/** The notes of both hands that start at one instant: what the playback cursor lights at once. */
export interface OnsetGroup {
  tick: number;
  /** Score seconds at the onset (the notes' own `onsetSec`, the time the transport plays them). */
  sec: number;
  /** The next group's `sec`; for the last group, when its longest note ends. */
  endSec: number;
  noteIds: string[];
  notes: Note[];
}

/** Both hands merged, one group per distinct onset tick, sorted by tick. Notes keep score order. */
export function buildOnsetGroups(score: Score): OnsetGroup[] {
  const byTick = new Map<number, Note[]>();
  for (const n of score.notes) {
    const group = byTick.get(n.onsetTick);
    if (group) group.push(n);
    else byTick.set(n.onsetTick, [n]);
  }
  const groups: OnsetGroup[] = [...byTick.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tick, notes]) => ({
      tick,
      sec: notes[0]!.onsetSec,
      endSec: 0,
      noteIds: notes.map((n) => n.id),
      notes,
    }));
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    const next = groups[i + 1];
    if (next) {
      g.endSec = next.sec;
    } else {
      let end = g.sec;
      for (const n of g.notes) if (n.offsetSec > end) end = n.offsetSec;
      g.endSec = end;
    }
  }
  return groups;
}

/** The last group that starts at or before `sec` (binary search); -1 before the first group. */
export function groupIndexAt(groups: readonly { sec: number }[], sec: number): number {
  let lo = 0;
  let hi = groups.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (groups[mid]!.sec <= sec) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * Whether any group has a note in a hand that is not muted. Without one there is nothing to hear
 * and nothing for the cursor to mark (a one-hand piece with the other hand selected), so the
 * score view does not let it play.
 */
export function hasNotesFor(groups: readonly OnsetGroup[], mutedHands: readonly Hand[]): boolean {
  return groups.some((g) => g.notes.some((n) => !mutedHands.includes(n.hand)));
}
