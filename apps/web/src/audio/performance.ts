import type { Note, Score } from '@digitus2/engine';
import { measureEndSec } from './beats.js';

/** Time between the notes of a rolled chord, in score seconds. */
export const ROLL_STEP_SEC = 0.04;
/** The whole roll lasts at most this fraction of the chord's shortest note. */
export const ROLL_MAX_FRACTION = 0.25;
/** Two times closer than this are the same instant. */
const EPS = 1e-9;

/** The end of the piece in score seconds: the last bar's end, or a note that runs past it. */
export function scoreEndSec(score: Score): number {
  const lastMeasure = score.measures.length - 1;
  // A loop, not Math.max(...notes): spreading a very large score would overflow the stack.
  let endSec = lastMeasure >= 0 ? measureEndSec(score, lastMeasure) : 0;
  for (const n of score.notes) if (n.offsetSec > endSec) endSec = n.offsetSec;
  return endSec;
}

/** A note the performance layer may reshape: not a grace note and not an ornament. */
function isPlain(n: Note): boolean {
  return !n.isGrace && !n.ornament;
}

/**
 * How late each note of a rolled chord (`<arpeggiate>`) starts, in score seconds, by note id. A
 * chord rolls from its lowest note up, or from its highest down with `direction="down"`. A
 * numbered arpeggio rolls across every staff that marks it. Notes that are not delayed are absent.
 */
export function rollDelays(score: Score): Map<string, number> {
  const groups = new Map<string, Note[]>();
  for (const n of score.notes) {
    if (!n.arpeggio || !isPlain(n)) continue;
    const key = n.arpeggio.number !== undefined ? `${n.onsetTick}#${n.arpeggio.number}` : n.chordId;
    const group = groups.get(key);
    if (group) group.push(n);
    else groups.set(key, [n]);
  }
  const delays = new Map<string, number>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sign = group[0]!.arpeggio!.direction === 'down' ? -1 : 1;
    group.sort((a, b) => sign * (a.midi - b.midi));
    let shortest = Infinity;
    for (const n of group) shortest = Math.min(shortest, n.offsetSec - n.onsetSec);
    const step = Math.min(ROLL_STEP_SEC, (ROLL_MAX_FRACTION * shortest) / (group.length - 1));
    group.forEach((n, i) => delays.set(n.id, i * step));
  }
  return delays;
}

/**
 * Where each note is held to by the damper pedal, in score seconds, by note id. A note whose
 * written end falls while the pedal is down rings until the pedal lifts, changes or is pressed
 * again, or until the
 * same key is struck again, whichever comes first. A pedal never lifted holds to the end of the
 * piece. The pedal belongs to the whole score, both hands. Notes it does not extend are absent.
 */
export function pedalStops(score: Score): Map<string, number> {
  const held = new Map<string, number>();
  const marks = score.pedals;
  if (!marks || marks.length === 0) return held;
  const down: { from: number; to: number }[] = [];
  let open: number | undefined;
  const close = (sec: number): void => {
    if (open !== undefined && sec > open + EPS) down.push({ from: open, to: sec });
    open = undefined;
  };
  for (const mark of marks) {
    if (mark.type === 'up') close(mark.sec);
    else {
      // A press while the pedal is down is a re-pedal (a fresh "Ped." with no "*" before it).
      close(mark.sec);
      open = mark.sec;
    }
  }
  close(scoreEndSec(score));
  if (down.length === 0) return held;

  const strikes = new Map<number, number[]>();
  for (const n of score.notes) {
    if (n.isGrace) continue;
    const list = strikes.get(n.midi);
    if (list) list.push(n.onsetSec);
    else strikes.set(n.midi, [n.onsetSec]);
  }
  for (const list of strikes.values()) list.sort((a, b) => a - b);

  for (const n of score.notes) {
    if (!isPlain(n)) continue;
    // The last stretch that began before the note's end; the note is held when it is still down.
    let lo = 0;
    let hi = down.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (down[mid]!.from < n.offsetSec - EPS) lo = mid + 1;
      else hi = mid;
    }
    const stretch = down[lo - 1];
    if (!stretch || n.offsetSec >= stretch.to - EPS) continue;
    const again = strikes.get(n.midi)!;
    let a = 0;
    let b = again.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (again[mid]! <= n.onsetSec + EPS) a = mid + 1;
      else b = mid;
    }
    const stop = Math.min(stretch.to, again[a] ?? Infinity);
    if (stop > n.offsetSec + EPS) held.set(n.id, stop);
  }
  return held;
}
