import { PIANO_MAX, PIANO_MIN } from './pitch.js';
import type { Hand, HandEvent, Note, Score, TempoEvent } from './types.js';

export { performanceOrder } from './form.js';

const DEFAULT_QPM = 120;

/**
 * The velocity a note without one of its own plays at (no dynamics mark before it, no MIDI
 * source): the accompaniment slightly softer than the melody. A hairpin before the first mark
 * starts from it.
 */
export const UNMARKED_VELOCITY: Record<Hand, number> = { R: 96, L: 88 };

/**
 * The seconds at a tick through `tempoMap` (events in any order; 120 qpm before the first mark and
 * when there is none), as a function of the tick. The map is sorted once and the state after each
 * event (seconds, cursor and qpm) is kept, so a tick costs a binary search and one step of
 * arithmetic: the converter to make once for a score and ask many times.
 */
export function tickSeconds(tempoMap: TempoEvent[], divisions: number): (tick: number) => number {
  const map =
    tempoMap.length > 0
      ? [...tempoMap].sort((a, b) => a.tick - b.tick)
      : [{ tick: 0, qpm: DEFAULT_QPM }];
  // Entry i is the state after the first i events: what a walk that stops there holds.
  const seconds = new Float64Array(map.length + 1);
  const cursor = new Float64Array(map.length + 1);
  const qpm = new Float64Array(map.length + 1);
  qpm[0] = map[0]!.tick <= 0 ? map[0]!.qpm : DEFAULT_QPM;
  map.forEach((ev, i) => {
    seconds[i + 1] = seconds[i]!;
    cursor[i + 1] = cursor[i]!;
    if (ev.tick > cursor[i]!) {
      seconds[i + 1] = seconds[i]! + ((ev.tick - cursor[i]!) / divisions) * (60 / qpm[i]!);
      cursor[i + 1] = ev.tick;
    }
    qpm[i + 1] = ev.qpm;
  });
  return (tick) => {
    // The events before the tick: the first whose tick is >= it ends the walk.
    let lo = 0;
    let hi = map.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (map[mid]!.tick < tick) lo = mid + 1;
      else hi = mid;
    }
    return seconds[lo]! + ((tick - cursor[lo]!) / divisions) * (60 / qpm[lo]!);
  };
}

/** Seconds at `tick` through `tempoMap`; for many ticks of one map, make a `tickSeconds` once. */
export function ticksToSeconds(tempoMap: TempoEvent[], divisions: number, tick: number): number {
  return tickSeconds(tempoMap, divisions)(tick);
}

export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort(
    (a, b) =>
      a.onsetTick - b.onsetTick ||
      handRank(a.hand) - handRank(b.hand) ||
      a.midi - b.midi ||
      // By code unit, not localeCompare, whose order depends on the runtime's locale.
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function handRank(h: Hand): number {
  return h === 'R' ? 0 : 1;
}

export function assignChordIds(notes: Note[]): void {
  for (const n of notes) n.chordId = `${n.hand}@${n.onsetTick}`;
}

export function handEvents(score: Score, hand: Hand): HandEvent[] {
  const events: HandEvent[] = [];
  let current: HandEvent | undefined;
  for (const n of score.notes) {
    if (n.hand !== hand) continue;
    if (!current || current.onsetTick !== n.onsetTick) {
      current = { onsetTick: n.onsetTick, notes: [] };
      events.push(current);
    }
    current.notes.push(n);
  }
  for (const e of events) e.notes.sort((a, b) => a.midi - b.midi);
  return events;
}

export function finalizeScore(partial: Omit<Score, 'notes'> & { notes: Note[] }): Score {
  const notes = sortNotes(partial.notes);
  assignChordIds(notes);
  const secAt = tickSeconds(partial.tempoMap, partial.divisions);
  for (const n of notes) {
    n.onsetSec = secAt(n.onsetTick);
    n.offsetSec = secAt(n.offsetTick);
  }
  return { ...partial, notes };
}

export function validateScore(score: Score): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  if (!(score.divisions > 0)) problems.push(`divisions must be positive, got ${score.divisions}`);
  for (const n of score.notes) {
    if (seen.has(n.id)) problems.push(`duplicate note id ${n.id}`);
    seen.add(n.id);
    if (!Number.isInteger(n.midi)) problems.push(`note ${n.id}: midi ${n.midi} is not an integer`);
    else if (n.midi < PIANO_MIN || n.midi > PIANO_MAX)
      problems.push(`note ${n.id}: midi ${n.midi} outside piano range`);
    if (!n.isGrace && n.offsetTick < n.onsetTick)
      problems.push(`note ${n.id}: offset ${n.offsetTick} before onset ${n.onsetTick}`);
  }
  return problems;
}
