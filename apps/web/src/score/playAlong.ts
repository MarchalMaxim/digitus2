// Pure: types only, apart from the engine's ornament view (already in the static bundle).
import { ornamentAttacks } from '@digitus2/engine/ornaments';
import type { Hand, Note } from '@digitus2/engine';
import type { Performance } from '../audio/performance.js';

/** Two times closer than this are the same instant (the cursor's own slack). */
export const ALONG_EPS = 1e-9;

/** One step to play (issue 182): where it starts in the performance, and the pitches it needs. */
export interface AlongStep {
  /** The step's onset in performance seconds. */
  perfSec: number;
  /** Distinct and ascending. */
  pitches: readonly number[];
}

/**
 * The pitch a note asks the reader for: the one the cued keyboard shows at the note's onset, so
 * an upper-start trill asks for the upper neighbour.
 */
function requiredPitch(n: Note): number {
  const first = ornamentAttacks(n)[0];
  return first && Math.abs(first.onsetSec - n.onsetSec) <= ALONG_EPS ? first.midi : n.midi;
}

/**
 * What there is to play: one step per onset tick of the performance score (the bars in the order
 * heard), for the hands played. Its pitches are those of the notes starting at that tick: a note
 * held from earlier is not asked for again, a unison is one pitch, a grace note is never asked
 * for, and a tied note is asked for once, at its start. A tick with nothing to press is no step.
 */
export function alongSteps(perf: Performance, mutedHands: readonly Hand[]): AlongStep[] {
  const byTick = new Map<number, { perfSec: number; pitches: Set<number> }>();
  for (const n of perf.score.notes) {
    if (n.isGrace || mutedHands.includes(n.hand)) continue;
    let step = byTick.get(n.onsetTick);
    if (!step) {
      step = { perfSec: n.onsetSec, pitches: new Set() };
      byTick.set(n.onsetTick, step);
    } else if (n.onsetSec < step.perfSec) {
      step.perfSec = n.onsetSec;
    }
    step.pitches.add(requiredPitch(n));
  }
  return [...byTick.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, step]) => ({
      perfSec: step.perfSec,
      pitches: [...step.pitches].sort((a, b) => a - b),
    }));
}

/** A loop stretch in performance seconds, `to` exclusive. */
export interface PerfRange {
  from: number;
  to: number;
}

/** The first step for which `from` holds (steps ascending, `from` monotone), else `steps.length`. */
function firstWhere(steps: readonly AlongStep[], from: (perfSec: number) => boolean): number {
  let lo = 0;
  let hi = steps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (from(steps[mid]!.perfSec)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** The first step at or after `sec`, `steps.length` when there is none. */
function firstAtOrAfter(steps: readonly AlongStep[], sec: number): number {
  return firstWhere(steps, (perfSec) => perfSec >= sec);
}

/** Whether a position lies in the loop's stretch. */
function inLoop(loop: PerfRange, perfSec: number): boolean {
  return perfSec >= loop.from - ALONG_EPS && perfSec < loop.to - ALONG_EPS;
}

/** The first and last step of the loop's stretch, as indices into `steps`; null when it holds none. */
function loopSpan(
  steps: readonly AlongStep[],
  loop: PerfRange,
): { first: number; last: number } | null {
  const first = firstAtOrAfter(steps, loop.from - ALONG_EPS);
  const last = firstAtOrAfter(steps, loop.to - ALONG_EPS) - 1;
  return last >= first ? { first, last } : null;
}

/**
 * The step the red waits on for a stopped position, -1 when there is none.
 * - 'next': the first step at or after `perfSec - ALONG_EPS`.
 * - 'marked': the last step at or before `perfSec + ALONG_EPS`, else the first.
 * Within `loop` (the steps with `from - EPS <= perfSec < to - EPS`): a position outside it gives
 * the loop's first step; past its last step, its first step. Without a loop, past the last step
 * ('next' finds none) gives step 0. -1 when the loop holds no step, or there are no steps.
 * The index is into `steps`, not into the loop's share of them.
 */
export function anchorStep(
  steps: readonly AlongStep[],
  perfSec: number,
  loop: PerfRange | null,
  mode: 'next' | 'marked',
): number {
  if (steps.length === 0) return -1;
  let first = 0;
  let last = steps.length - 1;
  if (loop) {
    const span = loopSpan(steps, loop);
    if (!span) return -1;
    if (!inLoop(loop, perfSec)) return span.first;
    first = span.first;
    last = span.last;
  }
  if (mode === 'next') {
    const i = firstAtOrAfter(steps, perfSec - ALONG_EPS);
    return i > last ? first : Math.max(i, first);
  }
  const i = firstWhere(steps, (sec) => sec > perfSec + ALONG_EPS) - 1;
  return Math.min(Math.max(i, first), last);
}

/** The keys held on the piano now, each with whether its press is still fresh (unused). */
export type Keys = ReadonlyMap<number, boolean>;
export const NO_KEYS: Keys = new Map<number, boolean>();

/** A key goes down: held, and fresh. */
export function pressKey(keys: Keys, midi: number): Keys {
  if (keys.get(midi) === true) return keys;
  const next = new Map(keys);
  next.set(midi, true);
  return next;
}

/** A key comes up. */
export function releaseKey(keys: Keys, midi: number): Keys {
  if (!keys.has(midi)) return keys;
  const next = new Map(keys);
  next.delete(midi);
  return next;
}

/** Every held key no longer fresh (an external move). */
export function spendAll(keys: Keys): Keys {
  let fresh = false;
  for (const isFresh of keys.values()) fresh ||= isFresh;
  if (!fresh) return keys;
  return new Map([...keys.keys()].map((midi) => [midi, false] as const));
}

export type AlongMove = { kind: 'stay' } | { kind: 'cue'; index: number } | { kind: 'finish' };

/**
 * From step `index`: while the current step's pitches are all held and fresh, mark them used and
 * go to the next step (inside `loop`, after its last step back to its first; without a loop,
 * after the last step: finish, and stop). At most `steps.length` passes. `passed` counts them,
 * and `last` is the index of the last step passed (-1 when none): the step the other hand's
 * accompaniment counts from (issue 184). A step that does not pass leaves the keys as they are,
 * so a chord can be played apart.
 */
export function advance(
  steps: readonly AlongStep[],
  index: number,
  keys: Keys,
  loop: PerfRange | null,
): { keys: Keys; move: AlongMove; passed: number; last: number } {
  const stay = { keys, move: { kind: 'stay' } as AlongMove, passed: 0, last: -1 };
  if (index < 0 || index >= steps.length) return stay;
  const span = loop ? loopSpan(steps, loop) : null;
  let at = index;
  let passed = 0;
  let last = -1;
  let held = keys;
  while (passed < steps.length) {
    const step = steps[at]!;
    if (!step.pitches.every((midi) => held.get(midi) === true)) break;
    const used = new Map(held);
    for (const midi of step.pitches) used.set(midi, false);
    held = used;
    passed++;
    last = at;
    if (span) at = at >= span.last ? span.first : at + 1;
    else if (at + 1 < steps.length) at++;
    else return { keys: held, move: { kind: 'finish' }, passed, last };
  }
  if (passed === 0) return stay;
  return { keys: held, move: { kind: 'cue', index: at }, passed, last };
}
