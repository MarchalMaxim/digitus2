// Pure: types and the play-along's own constants only (the engine's Hand is a type).
import type { Hand } from '@digitus2/engine';
import type { PlayEvent } from '../audio/events.js';
import type { AccNote } from '../audio/instrument.js';
import { ALONG_EPS, type AlongMove, type AlongStep, type PerfRange } from './playAlong.js';

/**
 * The other hand's accompaniment for the play-along (issue 184): from the last step the walk passed
 * and its move after it, which stretches of the performance digitus plays, and then which notes of
 * the other hand fall in them, as offsets in performance seconds after the pass. Nothing here
 * plays: `Accompanist` hands the notes to the instrument.
 */

/** A stretch of the performance digitus plays, and where it starts after the pass. */
export interface Stretch {
  from: number;
  to: number;
  /**
   * Performance seconds after the moment the stretch is handed over at which `from` sounds (0 or
   * more).
   */
  offset: number;
}

/**
 * The stretches to play from the step `last`, the last step the walk passed (issue 204: at the
 * press, or at a hop's landing for a press made under it), and the move the walk makes after it
 * (`stepAfter`: `cue j`, or `finish` after the piece's last step; -1 when `last` names no step).
 * Digitus plays from that step to the next step of the walk, then waits:
 * - `cue j`: from `steps[last]` to `steps[j]`; when the move wraps a loop (`j` is not after
 *   `last`) from `steps[last]` to the loop's end, and nothing of the loop's opening is played;
 * - `finish`: from `steps[last]` to `endSec`, the piece's tail;
 * - `stay`, or no step: none.
 * Every stretch starts at the pass (offset 0). A stretch with no length is no stretch.
 */
export function accompanimentStretches(
  steps: readonly AlongStep[],
  last: number,
  move: AlongMove,
  loop: PerfRange | null,
  endSec: number,
): Stretch[] {
  const from = steps[last]?.perfSec;
  if (last < 0 || from === undefined || move.kind === 'stay') return [];
  let to: number | undefined;
  if (move.kind === 'finish') to = endSec;
  else if (move.index > last) to = steps[move.index]?.perfSec;
  else to = loop?.to;
  if (to === undefined || !(to > from)) return [];
  return [{ from, to, offset: 0 }];
}

/** The events at (`midi`, `onset`) of the hands the reader plays, by pitch. */
type Unisons = Map<number, number[]>;

function isUnison(unisons: Unisons, e: PlayEvent): boolean {
  return unisons.get(e.midi)?.some((onset) => Math.abs(onset - e.onset) <= ALONG_EPS) ?? false;
}

/**
 * The notes of `hands` to play in `stretches`, as notes after the pass, ascending by offset:
 * - **Which:** the events (the transport's note list) whose onset lies in a stretch, half-open
 *   (`from - EPS <= onset < to - EPS`), so a note at the next step belongs to the next stretch.
 *   The onset decides the stretch and `sec` the time: a grace note sounds before its principal
 *   and a rolled note after it, and a grace of the principal that opens the stretch sounds with
 *   it, at the pass.
 * - **Offset:** `stretch.offset + (sec - stretch.from)`, never before the pass.
 * - **Duration:** the event's own, so a note rings its length (pedal included) past the end of
 *   the stretch. Inside `loop` it is clipped at the loop's end, as the transport clips it, and a
 *   note that would only sound at or after that end is left out: the transport never schedules it.
 * - **Unisons:** a note of `hands` with the pitch and onset of an event of a hand the reader plays
 *   (the other hand) is left out: that pitch comes from the reader's piano at that moment.
 */
export function accompanimentNotes(
  events: readonly PlayEvent[],
  hands: readonly Hand[],
  stretches: readonly Stretch[],
  loop: PerfRange | null,
): AccNote[] {
  if (hands.length === 0 || stretches.length === 0) return [];
  const placed: { e: PlayEvent; stretch: Stretch }[] = [];
  const unisons: Unisons = new Map();
  for (const e of events) {
    const stretch = stretches.find(
      (s) => e.onset >= s.from - ALONG_EPS && e.onset < s.to - ALONG_EPS,
    );
    if (!stretch) continue;
    if (hands.includes(e.hand)) placed.push({ e, stretch });
    else {
      const onsets = unisons.get(e.midi);
      if (onsets) onsets.push(e.onset);
      else unisons.set(e.midi, [e.onset]);
    }
  }
  const notes: AccNote[] = [];
  for (const { e, stretch } of placed) {
    if (isUnison(unisons, e)) continue;
    const durationSec = loop ? Math.min(e.duration, loop.to - e.sec) : e.duration;
    if (loop && !(durationSec > ALONG_EPS)) continue;
    notes.push({
      offsetSec: Math.max(0, stretch.offset + (e.sec - stretch.from)),
      durationSec,
      midi: e.midi,
      velocity: e.velocity,
      hand: e.hand,
    });
  }
  return notes.sort((a, b) => a.offsetSec - b.offsetSec); // stable: simultaneous notes keep their order
}
