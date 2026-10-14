import type { Finger, Score } from '../score/types.js';
import type { HandSequence, SeqNote } from './sequence.js';

/**
 * Repeated passages of one hand (M3 Task 7, H4; literature 6.6 item 3, the rule of regularity):
 * the copies of a passage are fingered alike, so a beginner learns one fingering per passage.
 */

/** Fewest events (slices) a passage needs to count as repeated (binding addition 13a). */
export const MIN_REPEAT_EVENTS = 4;

export interface RepeatGroup {
  /** Sequence index of the first note of each copy, ascending. */
  starts: number[];
  /** Notes per copy. */
  length: number;
  /** Events (slices) per copy. */
  events: number;
}

/** How passages are matched (`findRepeats`, `identicalPassages`, `repeatPairs`). */
export interface RepeatOptions {
  /** Fewest events (slices) per copy; default MIN_REPEAT_EVENTS. */
  minEvents?: number;
  /**
   * Each sequence note's place in its bar (`barPositions`). When given, two copies match only
   * where their events sit at the same places in the bar: a passage that recurs on another beat
   * is a coincidence of the melody, not a repeat (Twinkle's F F E E fills bar 3 and recurs from
   * beat 3 of bar 5 into bar 6). Absent, or undefined for a note (a score without bars, such as a
   * PIG file), every place matches.
   */
  positions?: ReadonlyArray<number | undefined>;
}

/**
 * Each note's place in its bar, in ticks from the bar's start, for `RepeatOptions.positions`. A
 * first bar shorter than the second (a pickup) counts from its end, so a pickup's notes sit where
 * they would in a full bar. Undefined for every note of a score without bars.
 */
export function barPositions(score: Score, seq: HandSequence): Array<number | undefined> {
  const bars = score.measures;
  if (bars.length === 0) return seq.notes.map(() => undefined);
  const pickup =
    bars.length > 1 && bars[0]!.lengthTicks < bars[1]!.lengthTicks
      ? bars[1]!.lengthTicks - bars[0]!.lengthTicks
      : 0;
  const byId = new Map(score.notes.map((n) => [n.id, n]));
  return seq.notes.map((v) => {
    const n = byId.get(v.noteId);
    const bar = n === undefined ? undefined : bars[n.measureIndex];
    if (n === undefined || bar === undefined) return undefined;
    return n.onsetTick - bar.startTick + (n.measureIndex === 0 ? pickup : 0);
  });
}

/** Two copies of an identical passage (`repeatPairs`). */
export interface RepeatPair {
  /** Sequence index of the first note of the earlier copy. */
  a: number;
  /** Sequence index of the first note of the later copy. */
  b: number;
  /** Notes per copy. */
  length: number;
  /** Events (slices) per copy. */
  events: number;
}

/** Milliseconds, so notated times that differ by rounding noise compare equal. */
const ms = (sec: number): number => Math.round(sec * 1000);

/**
 * Two copies match when every event has the same notes (the same keys, with the same notated
 * durations) at the same place in the bar (when `positions` are known) and every event after the
 * first follows the one before it the same way (inter-onset interval, rest or not). Only identical
 * passages match: a transposed copy (a sequence) does not, because inside scales and arpeggios the
 * transposed fragments take different textbook fingers.
 */
function eventKeys(
  v: SeqNote[],
  positions: RepeatOptions['positions'],
): { starts: number[]; shape: number[]; move: number[] } {
  const starts: number[] = [];
  for (let k = 0; k < v.length; k++) if (k === 0 || v[k]!.slice !== v[k - 1]!.slice) starts.push(k);
  const ids = new Map<string, number>();
  const id = (s: string): number => {
    let x = ids.get(s);
    if (x === undefined) ids.set(s, (x = ids.size));
    return x;
  };
  const shape: number[] = [];
  const move: number[] = [];
  starts.forEach((s, e) => {
    const end = e + 1 < starts.length ? starts[e + 1]! : v.length;
    const notes = v.slice(s, end);
    const lo = notes[0]!;
    const at = positions?.[s];
    const keys = notes.map((n) => `${n.pitch}:${ms(n.offsetSec - n.onsetSec)}`).join(',');
    shape.push(id(at === undefined ? keys : `${keys}@${at}`));
    const prev = e > 0 ? v[starts[e - 1]!]! : undefined;
    move.push(
      prev === undefined ? -1 : id(`${ms(lo.onsetSec - prev.onsetSec)}|${lo.restBefore ? 1 : 0}`),
    );
  });
  return { starts, shape, move };
}

interface Matches {
  /** Sequence index of each event's first note. */
  starts: number[];
  shape: number[];
  move: number[];
  /**
   * The maximal matching runs of at least `minEvents` events: for a distance d between two events,
   * events e + k and e + d + k match (`eventKeys`) for k < len, and the run cannot be extended at
   * either end.
   */
  runs: Array<{ e: number; d: number; len: number }>;
}

/** Every maximal run of matching events of a hand (`Matches.runs`). O(events²). */
function matchingRuns(
  v: SeqNote[],
  minEvents: number,
  positions: RepeatOptions['positions'],
): Matches {
  const { starts, shape, move } = eventKeys(v, positions);
  const E = starts.length;
  const runs: Matches['runs'] = [];
  for (let d = 1; d < E; d++) {
    let e = 0;
    while (e + d < E) {
      if (shape[e] !== shape[e + d]) {
        e++;
        continue;
      }
      let len = 1;
      while (
        e + len + d < E &&
        shape[e + len] === shape[e + len + d] &&
        move[e + len] === move[e + len + d]
      )
        len++;
      if (len >= minEvents) runs.push({ e, d, len });
      e += len;
    }
  }
  return { starts, shape, move, runs };
}

/**
 * The copies each maximal run gives (event indices `at`, `len` events each). A run shorter than its
 * distance d gives two copies of its length; a run of d events or more is a passage repeated back
 * to back, which gives every period of d events up to the run's end as a copy (four bars played
 * four times are four copies, not two copies of two bars), when d is at least `minEvents`.
 */
function copiesOf(m: Matches, minEvents: number): Array<{ at: number[]; len: number }> {
  const out: Array<{ at: number[]; len: number }> = [];
  for (const { e, d, len } of m.runs) {
    if (len >= d) {
      if (d >= minEvents)
        out.push({
          at: Array.from({ length: Math.floor(len / d) + 1 }, (_, j) => e + j * d),
          len: d,
        });
    } else out.push({ at: [e, e + d], len });
  }
  return out;
}

/** The identity of a passage: its events and the moves between them. */
const passageKey = (m: Matches, at: number, len: number): string =>
  `${len}:${m.shape.slice(at, at + len).join(',')}/${m.move.slice(at + 1, at + len).join(',')}`;

/** By the events they make consistent (copies − 1 times length), then longest, then first. */
const byGain = (a: { at: number[]; len: number }, b: { at: number[]; len: number }): number =>
  (b.at.length - 1) * b.len - (a.at.length - 1) * a.len ||
  b.len - a.len ||
  a.at[0]! - b.at[0]! ||
  a.at[1]! - b.at[1]!;

/** Event copies as sequence-index groups (notes per copy from the first copy). */
function toGroups(
  m: Matches,
  n: number,
  groups: Array<{ at: number[]; len: number }>,
): RepeatGroup[] {
  const E = m.starts.length;
  return groups.map((g) => {
    const at = [...g.at].sort((a, b) => a - b);
    const first = m.starts[at[0]!]!;
    const end = at[0]! + g.len < E ? m.starts[at[0]! + g.len]! : n;
    return { starts: at.map((e) => m.starts[e]!), length: end - first, events: g.len };
  });
}

/**
 * The repeated passages of a hand as a reader counts them: copies of at least `minEvents` events
 * that match (`eventKeys`) and do not overlap. The copies of every maximal run (`copiesOf`) are
 * taken by the events they make consistent, then longest first, and a run's copies join the group
 * of its passage when they are free or already in that group, so no event belongs to two groups.
 * A passage that also occurs inside a longer group's copy is therefore not a group of its own: this
 * grouping is for reporting (`repeatConsistency`); the consistency pass uses every copy
 * (`identicalPassages`) and the measure of the goal is `repeatPairs`. Deterministic; O(events²).
 */
export function findRepeats(seq: HandSequence, opts: RepeatOptions = {}): RepeatGroup[] {
  const minEvents = opts.minEvents ?? MIN_REPEAT_EVENTS;
  const m = matchingRuns(seq.notes, minEvents, opts.positions);
  const E = m.starts.length;
  const cands = copiesOf(m, minEvents).sort(byGain);
  const owner = new Int32Array(E).fill(-1);
  const groups: Array<{ len: number; at: number[] }> = [];
  const byKey = new Map<string, number>();
  const free = (x: number, len: number): boolean => {
    for (let e = x; e < x + len; e++) if (owner[e] !== -1) return false;
    return true;
  };
  for (const { at, len } of cands) {
    const key = passageKey(m, at[0]!, len);
    const g = byKey.get(key);
    const members = at.filter((x) => g !== undefined && groups[g]!.at.includes(x));
    const fresh = at.filter((x) => free(x, len));
    if (members.length + fresh.length < 2 || fresh.length === 0) continue;
    let gi = g;
    if (gi === undefined) {
      gi = groups.length;
      groups.push({ len, at: [] });
      byKey.set(key, gi);
    }
    for (const x of fresh) {
      groups[gi]!.at.push(x);
      for (let e = x; e < x + len; e++) owner[e] = gi;
    }
  }
  return toGroups(
    m,
    seq.notes.length,
    groups.filter((g) => g.at.length >= 2),
  ).sort((a, b) => a.starts[0]! - b.starts[0]!);
}

/**
 * Every repeated passage of a hand with all of its copies, for the consistency pass: the copies of
 * every maximal run (`copiesOf`), joined by passage (the same events and moves), with no ownership,
 * so the copies of two passages may overlap and a passage that recurs inside a longer repeated
 * passage keeps every copy (Ode to Joy's bars 1-3 recur in bars 5-8 and 13-16, which repeat as a
 * whole). Ordered by the events they make consistent (copies − 1 times length), then longest,
 * then first. Deterministic; O(events²).
 */
export function identicalPassages(seq: HandSequence, opts: RepeatOptions = {}): RepeatGroup[] {
  const minEvents = opts.minEvents ?? MIN_REPEAT_EVENTS;
  const m = matchingRuns(seq.notes, minEvents, opts.positions);
  const byKey = new Map<string, { at: Set<number>; len: number }>();
  for (const { at, len } of copiesOf(m, minEvents)) {
    const key = passageKey(m, at[0]!, len);
    const g = byKey.get(key) ?? { at: new Set<number>(), len };
    for (const x of at) g.at.add(x);
    byKey.set(key, g);
  }
  const groups = [...byKey.values()]
    .map((g) => ({ at: [...g.at].sort((a, b) => a - b), len: g.len }))
    .sort(byGain);
  return toGroups(m, seq.notes.length, groups);
}

/**
 * Every pair of identical passages of a hand, the measure of "repeats fingered alike" that does not
 * depend on any grouping: for each maximal run of matching events (`eventKeys`: the same keys and
 * durations per event, the same inter-onset interval and rest between events), the two copies'
 * non-overlapping part (the first min(run, distance) events of each), when it has at least
 * `minEvents` events. A passage that occurs three times gives three pairs; a passage repeated four
 * times back to back gives a pair per distance.
 */
export function repeatPairs(seq: HandSequence, opts: RepeatOptions = {}): RepeatPair[] {
  const v = seq.notes;
  const minEvents = opts.minEvents ?? MIN_REPEAT_EVENTS;
  const m = matchingRuns(v, minEvents, opts.positions);
  const E = m.starts.length;
  const out: RepeatPair[] = [];
  for (const { e, d, len } of m.runs) {
    const k = Math.min(len, d);
    if (k < minEvents) continue;
    const a = m.starts[e]!;
    const end = e + k < E ? m.starts[e + k]! : v.length;
    out.push({ a, b: m.starts[e + d]!, length: end - a, events: k });
  }
  return out;
}

/** Pairs of identical passages (`repeatPairs`) whose two copies take the same fingers. */
export function pairConsistency(
  pairs: RepeatPair[],
  fingers: readonly Finger[],
): { pairs: number; alike: number } {
  let alike = 0;
  for (const p of pairs) {
    let same = true;
    for (let k = 0; k < p.length && same; k++) same = fingers[p.a + k] === fingers[p.b + k];
    if (same) alike++;
  }
  return { pairs: pairs.length, alike };
}

/** Repeat groups whose copies all take the same fingers, out of all groups (`findRepeats`). */
export function repeatConsistency(
  groups: RepeatGroup[],
  fingers: readonly Finger[],
): { groups: number; consistent: number } {
  let consistent = 0;
  for (const g of groups) {
    const first = fingers.slice(g.starts[0]!, g.starts[0]! + g.length).join('');
    if (g.starts.every((s) => fingers.slice(s, s + g.length).join('') === first)) consistent++;
  }
  return { groups: groups.length, consistent };
}
