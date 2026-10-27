import { barPositions, repeatPairs } from '../fingering/repeats.js';
import { buildHandSequence } from '../fingering/sequence.js';
import type { SeqNote } from '../fingering/sequence.js';
import type { Assignment, Finger, Hand, Score } from '../score/types.js';

/**
 * The forward reader of the readability study (docs/research/readability.md 5.1 and 7.1; port of
 * research/readability/player_model.py) with the repeat memory R5 of issue 94. It is the
 * operational meaning of "a printed digit is redundant": a digit is redundant when the reader gets
 * the engine's finger without it. The reduction (`reduce.ts`) measures with the very same
 * functions, so "what a reader sees" and "what the reduction assumed" cannot diverge.
 *
 * Events are the slices of `buildHandSequence`: the notes of one hand with the same onset, thumb
 * side first (a grace note is its own slice). Pitches in the rules are real MIDI numbers and
 * `s = +1` for the right hand, `-1` for the left, where rising pitch moves toward the thumb.
 */

export type ReaderRule = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R4ref' | 'R5' | 'none';

/** A note whose finger the reader knows: a real MIDI pitch and its finger. */
export interface Pitched {
  pitch: number;
  finger: Finger;
}

/**
 * What the reader carries between events. `ref` is the seen notes of the last event that had a
 * seen digit (the position anchor), `prev` the notes of the previous event whose finger is
 * known. Inferred fingers update `prev`, never `ref`.
 */
export interface PlayerState {
  ref: readonly Pitched[] | null;
  prev: readonly Pitched[] | null;
}
export const INITIAL_PLAYER_STATE: PlayerState = { ref: null, prev: null };

const samePitched = (a: readonly Pitched[] | null, b: readonly Pitched[] | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.length === b.length &&
    a.every((x, i) => x.pitch === b[i]!.pitch && x.finger === b[i]!.finger));

/** Two states that make the reader read every later event alike. */
export const sameState = (a: PlayerState, b: PlayerState): boolean =>
  samePitched(a.ref, b.ref) && samePitched(a.prev, b.prev);

/** A seen note: printed (R0) or recalled from a repeat (R5). */
export interface Seen {
  finger: Finger;
  rule: 'R0' | 'R5';
}

export interface EventReading {
  /** Per note of the event, thumb side first; null where the reader needs a digit. */
  fingers: Array<Finger | null>;
  rules: ReaderRule[];
  /** The state after the event. */
  state: PlayerState;
}

/** `round_half_away_from_zero((b - a) / 2)`: semitones as scale steps. */
export function steps(a: number, b: number): number {
  const d = b - a;
  const m = Math.floor((Math.abs(d) + 1) / 2);
  return d >= 0 ? m : -m;
}

export function handSign(hand: Hand): 1 | -1 {
  return hand === 'R' ? 1 : -1;
}

/** The pair nearest to `pitch`; a tie goes to the lower pitch (the study's convention). */
export function nearest(pairs: readonly Pitched[], pitch: number): Pitched {
  let best = pairs[0]!;
  for (const p of pairs) {
    const d = Math.abs(p.pitch - pitch);
    const bd = Math.abs(best.pitch - pitch);
    if (d < bd || (d === bd && p.pitch < best.pitch)) best = p;
  }
  return best;
}

function asFinger(f: number): Finger | null {
  return Number.isInteger(f) && f >= 1 && f <= 5 ? (f as Finger) : null;
}

function readSingle(q: number, v: Seen | undefined, s: 1 | -1, state: PlayerState): EventReading {
  if (v) {
    const me = [{ pitch: q, finger: v.finger }];
    return { fingers: [v.finger], rules: [v.rule], state: { ref: me, prev: me } };
  }
  let f: Finger | null = null;
  let rule: ReaderRule = 'none';
  if (state.prev) {
    const p = nearest(state.prev, q);
    const d = q - p.pitch;
    if (d === 0) {
      f = p.finger;
      rule = 'R1';
    } else if (Math.abs(d) <= 2) {
      const g = asFinger(p.finger + s * Math.sign(d));
      if (g) {
        f = g;
        rule = 'R2';
      }
    }
  }
  if (f === null && state.ref) {
    const r = nearest(state.ref, q);
    const g = asFinger(r.finger + s * steps(r.pitch, q));
    if (g) {
      f = g;
      rule = 'R3';
    }
  }
  return {
    fingers: [f],
    rules: [rule],
    state: { ref: state.ref, prev: f === null ? null : [{ pitch: q, finger: f }] },
  };
}

function readChord(
  midis: readonly number[],
  seen: ReadonlyMap<number, Seen>,
  s: 1 | -1,
  state: PlayerState,
): EventReading {
  const vis: Pitched[] = [];
  seen.forEach((v, i) => vis.push({ pitch: midis[i]!, finger: v.finger }));
  const fingers: Array<Finger | null> = [];
  const rules: ReaderRule[] = [];
  midis.forEach((q, i) => {
    const v = seen.get(i);
    if (v) {
      fingers.push(v.finger);
      rules.push(v.rule);
      return;
    }
    const from = vis.length > 0 ? nearest(vis, q) : state.ref ? nearest(state.ref, q) : null;
    const g = from ? asFinger(from.finger + s * steps(from.pitch, q)) : null;
    fingers.push(g);
    rules.push(g === null ? 'none' : vis.length > 0 ? 'R4' : 'R4ref');
  });
  // Two notes of a chord cannot share a finger: the reader gives up on an inferred note that does.
  const count = new Map<Finger, number>();
  for (const f of fingers) if (f !== null) count.set(f, (count.get(f) ?? 0) + 1);
  fingers.forEach((f, i) => {
    if (f !== null && !seen.has(i) && count.get(f)! > 1) {
      fingers[i] = null;
      rules[i] = 'none';
    }
  });
  const known: Pitched[] = [];
  midis.forEach((q, i) => {
    const f = fingers[i];
    if (f) known.push({ pitch: q, finger: f });
  });
  return {
    fingers,
    rules,
    state: { ref: vis.length > 0 ? vis : state.ref, prev: known.length > 0 ? known : null },
  };
}

/**
 * Reads one event: `midis` in sequence order (thumb side first), `seen` mapping the rank in the
 * event to the printed or remembered finger.
 */
export function readEvent(
  midis: readonly number[],
  seen: ReadonlyMap<number, Seen>,
  s: 1 | -1,
  state: PlayerState,
): EventReading {
  return midis.length === 1
    ? readSingle(midis[0]!, seen.get(0), s, state)
    : readChord(midis, seen, s, state);
}

/**
 * One hand prepared for reading: its events, and for R5 the source event of every event that
 * lies in a later copy of an identical passage (`repeatPairs`, bar-position aware).
 */
export interface HandModel {
  hand: Hand;
  s: 1 | -1;
  notes: readonly SeqNote[];
  /** Number of events (slices). */
  events: number;
  /** Index in `notes` of the first note of each event. */
  first: number[];
  size: number[];
  /** The source event whose resolved fingers event e recalls, or -1. */
  src: Int32Array;
  /** The copy (index into `copyStart`) event e belongs to as a later copy, or -1. */
  copy: Int32Array;
  copyStart: number[];
  /** Events that recall event e (inverse of `src`). */
  dependents: number[][];
}

/**
 * `memory: false` leaves out the repeat memory (the comparison with the study's reduction, which
 * has none on the reading side).
 */
export function buildHandModel(score: Score, hand: Hand, memory = true): HandModel {
  const seq = buildHandSequence(score, hand);
  const notes = seq.notes;
  const first: number[] = [];
  const size: number[] = [];
  for (let k = 0; k < notes.length; k++) {
    if (k === 0 || notes[k]!.slice !== notes[k - 1]!.slice) {
      first.push(k);
      size.push(0);
    }
    size[size.length - 1]!++;
  }
  const events = first.length;
  const src = new Int32Array(events).fill(-1);
  const copy = new Int32Array(events).fill(-1);
  const copyStart: number[] = [];
  const dependents: number[][] = Array.from({ length: events }, () => []);
  if (memory && events > 0) {
    const pairs = repeatPairs(seq, { positions: barPositions(score, seq) })
      // The earliest source wins where copies overlap.
      .sort((x, y) => x.a - y.a || x.b - y.b);
    for (const p of pairs) {
      const ea = notes[p.a]!.slice;
      const eb = notes[p.b]!.slice;
      let id = -1;
      for (let k = 0; k < p.events; k++) {
        if (copy[eb + k]! >= 0) continue;
        if (size[ea + k] !== size[eb + k]) continue;
        if (id < 0) {
          id = copyStart.length;
          copyStart.push(eb);
        }
        copy[eb + k] = id;
        src[eb + k] = ea + k;
        dependents[ea + k]!.push(eb + k);
      }
    }
  }
  return {
    hand,
    s: handSign(hand),
    notes,
    events,
    first,
    size,
    src,
    copy,
    copyStart,
    dependents,
  };
}

/**
 * The context of reading events in order: which printed digits are seen, which resolved fingers
 * of earlier events the memory may recall, and which copies a printed digit has already ended the
 * memory for.
 */
export interface ReadContext {
  /** The printed finger of a note of the hand (index in `HandModel.notes`), if any. */
  digit(noteIndex: number): Finger | undefined;
  /** The fingers the reader resolved for an earlier event. */
  resolved(event: number): ReadonlyArray<Finger | null> | undefined;
  /**
   * The first event at or after `event` that carries a printed digit (Infinity when none). A caller
   * that keeps its printed events sorted passes it, so the memory asks in O(log n) whether a copy
   * has already had a digit; without it `readEvents` scans the copy.
   */
  firstDigitFrom?(event: number): number;
}

/**
 * Reads events `from` to `to - 1` in order from a fresh state and calls `visit` with each
 * reading. A fresh state is exact at `from` when that event carries a printed digit (the state
 * after a printed event does not depend on what came before) or is the first of the hand; a
 * caller that reads event by event passes the state after the previous event as `initial`.
 * `visit` returns true to stop reading.
 *
 * R5: while no event of a later copy has carried a printed digit, an unprinted note takes the
 * finger the reader resolved for the same note of the source event and counts as seen. From the
 * first printed digit in the copy to its end R0 to R4 apply. `resolved` is asked for events
 * before the one being read only; the caller keeps it up to date from `visit`.
 */
export function readEvents(
  m: HandModel,
  from: number,
  to: number,
  ctx: ReadContext,
  visit: (event: number, reading: EventReading) => boolean | void,
  initial: PlayerState = INITIAL_PLAYER_STATE,
): void {
  // Without `firstDigitFrom`: per copy, the next event not yet scanned for a printed digit, and
  // whether one was found.
  let scanned: Map<number, { next: number; broken: boolean }> | undefined;
  const hasDigit = (e: number): boolean => {
    for (let k = 0; k < m.size[e]!; k++) if (ctx.digit(m.first[e]! + k) !== undefined) return true;
    return false;
  };
  const broken = (c: number, e: number): boolean => {
    if (ctx.firstDigitFrom) return ctx.firstDigitFrom(m.copyStart[c]!) < e;
    scanned ??= new Map();
    let st = scanned.get(c);
    if (!st) {
      st = { next: m.copyStart[c]!, broken: false };
      scanned.set(c, st);
    }
    while (!st.broken && st.next < e) st.broken = hasDigit(st.next++);
    return st.broken;
  };
  // The fingers recalled for an unprinted event of a later copy, or undefined.
  const recalled = (e: number): ReadonlyArray<Finger | null> | undefined => {
    const c = m.copy[e]!;
    if (c < 0 || broken(c, e)) return undefined;
    const r = ctx.resolved(m.src[e]!);
    return r && r.length === m.size[e] ? r : undefined;
  };
  let state = initial;
  for (let e = from; e < to; e++) {
    const base = m.first[e]!;
    const size = m.size[e]!;
    let reading: EventReading;
    if (size === 1) {
      const f = ctx.digit(base);
      let v: Seen | undefined;
      if (f !== undefined) v = { finger: f, rule: 'R0' };
      else {
        const r = recalled(e)?.[0];
        if (r) v = { finger: r, rule: 'R5' };
      }
      reading = readSingle(m.notes[base]!.midi, v, m.s, state);
    } else {
      const seen = new Map<number, Seen>();
      let printed = false;
      for (let k = 0; k < size; k++) {
        const f = ctx.digit(base + k);
        if (f !== undefined) {
          seen.set(k, { finger: f, rule: 'R0' });
          printed = true;
        }
      }
      if (!printed)
        recalled(e)?.forEach((f, k) => {
          if (f !== null) seen.set(k, { finger: f, rule: 'R5' });
        });
      reading = readChord(
        Array.from({ length: size }, (_, k) => m.notes[base + k]!.midi),
        seen,
        m.s,
        state,
      );
    }
    state = reading.state;
    if (visit(e, reading) === true) return;
  }
}

export interface HandReading {
  fingers: Array<Finger | null>;
  rules: ReaderRule[];
}

/** Reads a whole hand: per note of the hand's sequence, the finger the reader gets and the rule. */
export function readHand(
  m: HandModel,
  digit: (noteIndex: number) => Finger | undefined,
): HandReading {
  const per: Array<ReadonlyArray<Finger | null>> = [];
  const out: HandReading = { fingers: [], rules: [] };
  readEvents(m, 0, m.events, { digit, resolved: (e) => per[e] }, (e, r) => {
    per[e] = r.fingers;
    out.fingers.push(...r.fingers);
    out.rules.push(...r.rules);
  });
  return out;
}

export interface InferResult {
  /** Printed entries as given; inferred ones as `{ finger, source: 'engine' }`. */
  assignment: Assignment;
  inferred: Set<string>;
  /** Notes the reader cannot infer (absent from `assignment`). */
  unresolved: Set<string>;
  /** The rule that gave each note its finger. */
  rules: Map<string, ReaderRule>;
}

/**
 * What a reader sees: the finger of every note of the score, from the printed digits alone (only
 * the notes of `printed` carry one). Both hands; a note with no entry in `printed` that the
 * reader cannot read is `unresolved`.
 */
export function inferFingering(
  score: Score,
  printed: Assignment,
  opts: { memory?: boolean } = {},
): InferResult {
  const assignment: Assignment = {};
  const inferred = new Set<string>();
  const unresolved = new Set<string>();
  const rules = new Map<string, ReaderRule>();
  for (const hand of ['R', 'L'] as const) {
    const m = buildHandModel(score, hand, opts.memory ?? true);
    const reading = readHand(m, (k) => printed[m.notes[k]!.noteId]?.finger);
    m.notes.forEach((n, k) => {
      const p = printed[n.noteId];
      const f = reading.fingers[k]!;
      rules.set(n.noteId, reading.rules[k]!);
      if (p) assignment[n.noteId] = p;
      else if (f === null) unresolved.add(n.noteId);
      else {
        assignment[n.noteId] = { finger: f, source: 'engine' };
        inferred.add(n.noteId);
      }
    });
  }
  return { assignment, inferred, unresolved, rules };
}
