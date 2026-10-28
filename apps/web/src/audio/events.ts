import type { Hand, Score } from '@digitus2/engine';
import { ornamentAttacks } from '@digitus2/engine/ornaments';
import { noteVelocity } from './instrument.js';
import { pedalStops, rollDelays } from './performance.js';

/**
 * The note list the transport plays and the accompaniment of the play-along sounds (issue 184):
 * graces, rolls, ornaments, pedal and velocity, so the other hand sounds exactly as it does in
 * Play. Static and small: it imports nothing from transport.ts, which keeps the lazy transport
 * chunk out of the entry chunk.
 */

/** Graces sharing a principal sound this long before it (one step each), and for this long. */
export const GRACE_LEAD_SEC = 0.05;
export const GRACE_DURATION_SEC = 0.1;
export const MIN_DURATION_SEC = 0.05;

/** A note ready to schedule: `sec` is the score time it sounds at (graces already moved earlier, rolls later). */
export interface PlayEvent {
  sec: number;
  /** The note's onset, where the cursor marks it (a grace note's is its principal's). */
  onset: number;
  duration: number;
  midi: number;
  hand: Hand;
  velocity: number;
  /** The source ornament segment limits a tempo transition; tied principal tails are ordinary holds. */
  ornamentEnd?: number;
}

/** The score's notes as the transport sounds them: sorted by `sec`, simultaneous notes in score order. */
export function playEvents(score: Score): PlayEvent[] {
  // Graces sharing a principal are spread before it in document order, 50 ms apart.
  const graceGroups = new Map<string, typeof score.notes>();
  for (const n of score.notes) {
    if (!n.isGrace) continue;
    const key = `${n.hand}:${n.onsetTick}`;
    const group = graceGroups.get(key);
    if (group) group.push(n);
    else graceGroups.set(key, [n]);
  }
  const graceSec = new Map<string, number>();
  for (const group of graceGroups.values()) {
    group.sort((a, b) => (a.sourceIndices[0] ?? 0) - (b.sourceIndices[0] ?? 0));
    group.forEach((n, k) => {
      graceSec.set(n.id, Math.max(0, n.onsetSec - GRACE_LEAD_SEC * (group.length - k)));
    });
  }
  // A rolled chord starts late and a pedalled note rings on; the written onset stays for the cursor.
  const roll = rollDelays(score);
  const held = pedalStops(score);
  const events = score.notes.flatMap((n) =>
    ornamentAttacks(n).map((attack, index, attacks) => {
      const plain = !n.isGrace && !n.ornament;
      const sec = graceSec.get(n.id) ?? attack.onsetSec + (plain ? (roll.get(n.id) ?? 0) : 0);
      return {
        sec,
        onset: attack.onsetSec,
        duration: n.isGrace
          ? GRACE_DURATION_SEC
          : n.ornament
            ? attack.offsetSec - attack.onsetSec
            : Math.max(MIN_DURATION_SEC, (held.get(n.id) ?? n.offsetSec) - sec),
        midi: attack.midi,
        hand: n.hand,
        velocity: noteVelocity(n),
        ...(n.ornament && (index + 1 < attacks.length || attack.midi !== n.midi)
          ? { ornamentEnd: Math.min(attack.offsetSec, n.ornament.endSec) }
          : {}),
      };
    }),
  );
  return events.sort((a, b) => a.sec - b.sec); // stable: simultaneous notes keep score order
}

const cache = new WeakMap<Score, PlayEvent[]>();

/** `playEvents`, kept per score (a score is never edited): the same array for the same score. */
export function playEventsFor(score: Score): PlayEvent[] {
  let events = cache.get(score);
  if (!events) {
    events = playEvents(score);
    cache.set(score, events);
  }
  return events;
}
