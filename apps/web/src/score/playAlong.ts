// Pure: types only, apart from the engine's ornament view, its tick-to-second conversion and the
// beat length (all already in the static bundle).
import { ornamentAttacks } from '@digitus2/engine/ornaments';
import { ticksToSeconds } from '@digitus2/engine/score-build';
import type { Hand, Note, TimeSigEvent } from '@digitus2/engine';
import { beatTicksAt } from '../audio/beats.js';
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

/** A release after this fraction of a step's hold passes the step at the release (issue 185). */
export const HOLD_TOLERANCE = 0.8;

/** The times of one step (issue 185), aligned with `alongSteps`' steps. Performance seconds. */
export interface StepTime {
  /** The shortest non-grace note of the hands played starting at the step's tick. */
  shortestSec: number;
  /** The longest note at each of the step's pitches, aligned with `AlongStep.pitches`. */
  lengthSec: readonly number[];
  /** Each of those notes' length in beats of the time signature in force. */
  beats: readonly number[];
}

/** What the walk's timing needs of one step (issue 192), aligned with `alongPlan`'s steps. */
export interface StepNotes {
  /**
   * Performance ids of the non-grace notes starting at the step's tick in the hands played, the
   * left hand's first, each hand's in score order.
   */
  ids: readonly string[];
  /**
   * The felt beat at the step in performance seconds (tempo map and time signature): three of
   * the time signature's beats when it counts more than three of an eighth or shorter, a multiple
   * of three (6/8, 9/8, 12/8, 12/16), else the time signature's beat.
   */
  beatSec: number;
  /** The felt beat is three of the time signature's beats (6/8, 9/8, 12/8, 12/16), not its own. */
  compound: boolean;
}

const HANDS: readonly Hand[] = ['L', 'R'];

/**
 * The steps and their times: `steps` is exactly `alongSteps(perf, mutedHands)`, built in the
 * same pass; `times[i]` belongs to `steps[i]`. A step is one per onset tick of the performance
 * score (the bars in the order heard), for the hands played. Its pitches are those of the notes
 * starting at that tick: a note held from earlier is not asked for again, a unison is one pitch,
 * a grace note is never asked for, and a tied note is asked for once, at its start. A tick with
 * nothing to press is no step. Lengths are those of the performance, so a note running past a
 * repeat's end counts up to that end.
 */
export function alongPlan(
  perf: Performance,
  mutedHands: readonly Hand[],
): { steps: AlongStep[]; times: StepTime[] } {
  const { steps, times } = alongPlanNotes(perf, mutedHands);
  return { steps, times };
}

/**
 * `alongPlan`, and for each step its note ids and its felt beat: what the walk's timing needs
 * (issue 192). `steps` and `times` are exactly `alongPlan`'s; `notes[i]` belongs to `steps[i]`.
 */
export function alongPlanNotes(
  perf: Performance,
  mutedHands: readonly Hand[],
): { steps: AlongStep[]; times: StepTime[]; notes: StepNotes[] } {
  interface Tick {
    perfSec: number;
    shortestSec: number;
    /** By required pitch: the longest note, in seconds and in ticks. */
    pitches: Map<number, { lengthSec: number; ticks: number }>;
    /** By hand: its notes' ids in score order. */
    hands: Map<Hand, string[]>;
  }
  const byTick = new Map<number, Tick>();
  for (const n of perf.score.notes) {
    if (n.isGrace || mutedHands.includes(n.hand)) continue;
    const lengthSec = n.offsetSec - n.onsetSec;
    let tick = byTick.get(n.onsetTick);
    if (!tick) {
      tick = { perfSec: n.onsetSec, shortestSec: lengthSec, pitches: new Map(), hands: new Map() };
      byTick.set(n.onsetTick, tick);
    } else {
      if (n.onsetSec < tick.perfSec) tick.perfSec = n.onsetSec;
      if (lengthSec < tick.shortestSec) tick.shortestSec = lengthSec;
    }
    const midi = requiredPitch(n);
    const longest = tick.pitches.get(midi);
    if (!longest || lengthSec > longest.lengthSec) {
      tick.pitches.set(midi, { lengthSec, ticks: n.offsetTick - n.onsetTick });
    }
    const ids = tick.hands.get(n.hand);
    if (ids) ids.push(n.id);
    else tick.hands.set(n.hand, [n.id]);
  }
  const { tempoMap, divisions } = perf.score;
  const secAt = (tick: number): number => ticksToSeconds(tempoMap, divisions, tick);
  const signatures = [...perf.score.timeSignatures].sort((a, b) => a.tick - b.tick);
  /**
   * Whether the felt beat at `tick` is three of the time signature's beats, as in 6/8, 9/8, 12/8
   * and 6/16 (an eighth or shorter beat, a multiple of three of them, more than three).
   */
  const compoundAt = (tick: number): boolean => {
    let sig: TimeSigEvent | undefined;
    for (const s of signatures) {
      if (s.tick <= tick) sig = s;
      else break;
    }
    return !!sig && sig.beatType >= 8 && sig.beats % 3 === 0 && sig.beats > 3;
  };
  /** The felt beat at `tick` in ticks: three beats of `beatTicks` in a compound meter, else the beat. */
  const feltTicksAt = (tick: number, beatTicks: number): number =>
    compoundAt(tick) ? 3 * beatTicks : beatTicks;
  const steps: AlongStep[] = [];
  const times: StepTime[] = [];
  const notes: StepNotes[] = [];
  for (const [onsetTick, tick] of [...byTick.entries()].sort((a, b) => a[0] - b[0])) {
    const pitches = [...tick.pitches.keys()].sort((a, b) => a - b);
    const beatTicks = beatTicksAt(perf.score, onsetTick);
    steps.push({ perfSec: tick.perfSec, pitches });
    times.push({
      shortestSec: tick.shortestSec,
      lengthSec: pitches.map((midi) => tick.pitches.get(midi)!.lengthSec),
      beats: pitches.map((midi) => (beatTicks > 0 ? tick.pitches.get(midi)!.ticks / beatTicks : 0)),
    });
    notes.push({
      ids: HANDS.flatMap((hand) => tick.hands.get(hand) ?? []),
      beatSec: secAt(onsetTick + feltTicksAt(onsetTick, beatTicks)) - secAt(onsetTick),
      compound: compoundAt(onsetTick),
    });
  }
  return { steps, times, notes };
}

/** What there is to play: the steps of `alongPlan`. */
export function alongSteps(perf: Performance, mutedHands: readonly Hand[]): AlongStep[] {
  return alongPlan(perf, mutedHands).steps;
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
export function loopSpan(
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

/**
 * The step's hold in performance seconds (issue 185): the gap to the next step, never longer than
 * the step's shortest note, so a rest after a note is not waited out. The piece's last step has no
 * gap and holds its shortest note; the last step of `loop` has the time the note sounds before
 * Play would loop back, `loop.to - perfSec`. Never below 0, and 0 for an index outside the steps.
 */
export function holdSec(
  steps: readonly AlongStep[],
  times: readonly StepTime[],
  index: number,
  loop: PerfRange | null,
): number {
  const step = steps[index];
  const time = times[index];
  if (!step || !time) return 0;
  const span = loop ? loopSpan(steps, loop) : null;
  let gap = Infinity;
  if (loop && span && index === span.last) gap = loop.to - step.perfSec;
  else if (index + 1 < steps.length) gap = steps[index + 1]!.perfSec - step.perfSec;
  return Math.max(0, Math.min(gap, time.shortestSec));
}

/** The step after `index` in walk order: the loop's span's first after its last, -1 after the end. */
function nextStep(
  steps: readonly AlongStep[],
  index: number,
  span: { first: number; last: number } | null,
): number {
  if (span) return index >= span.last ? span.first : index + 1;
  return index + 1 < steps.length ? index + 1 : -1;
}

/**
 * The step after `index` in walk order: inside `loop` the loop's first after its last step; -1
 * after the piece's last, and for an index outside the steps.
 */
export function stepAfter(
  steps: readonly AlongStep[],
  index: number,
  loop: PerfRange | null,
): number {
  if (index < 0 || index >= steps.length) return -1;
  return nextStep(steps, index, loop ? loopSpan(steps, loop) : null);
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

/** The press time (performance.now ms) of each key held now (issue 185). */
export type Presses = ReadonlyMap<number, number>;
export const NO_PRESSES: Presses = new Map<number, number>();

/** A key goes down at `atMs`; a second press takes the newer time. */
export function pressAt(presses: Presses, midi: number, atMs: number): Presses {
  if (presses.get(midi) === atMs) return presses;
  const next = new Map(presses);
  next.set(midi, atMs);
  return next;
}

/** A key comes up: its press time goes. */
export function liftAt(presses: Presses, midi: number): Presses {
  if (!presses.has(midi)) return presses;
  const next = new Map(presses);
  next.delete(midi);
  return next;
}

/**
 * When the step starts running: every pitch held and fresh, counted from the latest press among
 * them; null while it does not run. Issue 184's accompaniment starts here. A key with no press
 * time counts as held since forever, which makes the untimed rule the timed one with no presses.
 */
export function runSince(step: AlongStep, keys: Keys, presses: Presses): number | null {
  let since = -Infinity;
  for (const midi of step.pitches) {
    if (keys.get(midi) !== true) return null;
    since = Math.max(since, presses.get(midi) ?? -Infinity);
  }
  return since;
}

export type AlongMove = { kind: 'stay' } | { kind: 'cue'; index: number } | { kind: 'finish' };

/** A step the walk passed (issue 192): its index and when its run started (performance.now ms). */
export interface PassedRun {
  index: number;
  sinceMs: number;
}

/** What the pass loop leaves behind (`walk`). */
interface Walked {
  keys: Keys;
  presses: Presses;
  move: AlongMove;
  passed: number;
  /** The indices of the steps passed, in the order passed. */
  passedSteps: number[];
  /** The same steps, each with the start of the run that passed it (`runSince`). */
  passedRuns: PassedRun[];
  /** The last of `passedSteps`, -1 when none passed. */
  last: number;
  early: boolean;
  at: number;
}

/** A running step passes once it has been held for this long, less the float sum's slack. */
const HOLD_SLACK_MS = 1e-6;

/**
 * The pass loop of `advance` and `settle`. From step `index`: while the step runs (its pitches
 * all held and fresh) and has been held for its time at `nowMs` (`holdMsAt`), mark its pitches
 * used and go to the next step (inside `loop`, after its last step back to its first; without a
 * loop, after the last step: finish, and stop). At most `steps.length` passes.
 *
 * `releasing`, a key coming up now, is judged against the step the red would wait on had the
 * timer fired on time: the first step of the chain whose pitches include it. A release after
 * `HOLD_TOLERANCE` of that step's hold passes it before the key goes (the key is then spent, so no
 * later step is judged with it); an earlier one is `early` and ends the chain there, also after
 * earlier passes. The key is removed from `keys` and `presses` in the result.
 */
function walk(
  steps: readonly AlongStep[],
  index: number,
  keys: Keys,
  presses: Presses,
  loop: PerfRange | null,
  nowMs: number,
  holdMsAt: (index: number) => number,
  releasing: number | undefined,
): Walked {
  const done = (
    held: Keys,
    move: AlongMove,
    passed: number,
    early: boolean,
    at: number,
  ): Walked => ({
    keys: releasing === undefined ? held : releaseKey(held, releasing),
    presses: releasing === undefined ? presses : liftAt(presses, releasing),
    move,
    passed,
    passedSteps,
    passedRuns,
    last: passedSteps.length > 0 ? passedSteps[passedSteps.length - 1]! : -1,
    early,
    at,
  });
  const passedSteps: number[] = [];
  const passedRuns: PassedRun[] = [];
  if (index < 0 || index >= steps.length) return done(keys, { kind: 'stay' }, 0, false, index);
  const span = loop ? loopSpan(steps, loop) : null;
  let at = index;
  let passed = 0;
  let early = false;
  let held = keys;
  while (passed < steps.length) {
    const step = steps[at]!;
    const since = runSince(step, held, presses);
    if (since === null) break;
    const letGo = releasing !== undefined && step.pitches.includes(releasing);
    const due = holdMsAt(at) * (letGo ? HOLD_TOLERANCE : 1);
    if (!(nowMs - since >= due - HOLD_SLACK_MS)) {
      early = letGo;
      break;
    }
    const used = new Map(held);
    for (const midi of step.pitches) used.set(midi, false);
    held = used;
    passed++;
    passedSteps.push(at);
    passedRuns.push({ index: at, sinceMs: since });
    const next = nextStep(steps, at, span);
    if (next < 0) return done(held, { kind: 'finish' }, passed, false, -1);
    at = next;
  }
  if (passed === 0) return done(keys, { kind: 'stay' }, 0, early, index);
  return done(held, { kind: 'cue', index: at }, passed, early, at);
}

/**
 * The untimed rule. From step `index`: while the current step's pitches are all held and fresh,
 * mark them used and go to the next step (inside `loop`, after its last step back to its first;
 * without a loop, after the last step: finish, and stop). At most `steps.length` passes. `passed`
 * counts them, and `last` is the index of the last step passed (-1 when none). A step that does
 * not pass leaves the keys as they are, so a chord can be played apart.
 */
export function advance(
  steps: readonly AlongStep[],
  index: number,
  keys: Keys,
  loop: PerfRange | null,
): { keys: Keys; move: AlongMove; passed: number; last: number } {
  const walked = walk(steps, index, keys, NO_PRESSES, loop, Infinity, () => 0, undefined);
  return { keys: walked.keys, move: walked.move, passed: walked.passed, last: walked.last };
}

export interface SettleInput {
  steps: readonly AlongStep[];
  times: readonly StepTime[];
  index: number;
  keys: Keys;
  presses: Presses;
  loop: PerfRange | null;
  nowMs: number;
  /** The tempo factor: real seconds = performance seconds / factor. */
  factor: number;
  /** A key coming up now: judged against the running step before it is removed. */
  releasing?: number;
}

export interface Settled {
  keys: Keys;
  presses: Presses;
  move: AlongMove;
  passed: number;
  /** The indices of the steps passed, in the order passed (the steps of the chain). */
  passedSteps: number[];
  /**
   * The steps passed, in the order passed, each with the start of the run that passed it (issue
   * 192): a step pressed before the red reached it counts from its own press, a chord from its
   * last key. `passedRuns.map((r) => r.index)` equals `passedSteps`.
   */
  passedRuns: PassedRun[];
  /** The last of `passedSteps`, -1 when none passed. */
  last: number;
  /**
   * A release of the running step's pitch before HOLD_TOLERANCE of its hold; also after passes,
   * when the step the chain ends on is the one released from.
   */
  early: boolean;
  /** The step the red is on after the settle (the cue's index; `index` when it stays; -1 on finish). */
  at: number;
  /** When the step at `at` is due (runSince + hold), null when it does not run. */
  wakeAtMs: number | null;
  /** The step at `at` running: its index and since when, else null. */
  run: { index: number; sinceMs: number } | null;
}

/**
 * The timed rule (issue 185). A running step passes once it has been held for its hold, the
 * `holdSec` converted to real milliseconds at the tempo `factor`; a release of one of its pitches
 * after `HOLD_TOLERANCE` of that passes it at the release, an earlier one sets `early` and leaves
 * the red and the other keys. After a pass, the next step is checked at the same `nowMs` against
 * its own run, so a chain covers exactly the steps whose time is up. `advance` is this rule with
 * no hold. `releasing` is removed from `keys` and `presses` in the result.
 */
export function settle(input: SettleInput): Settled {
  const { steps, times, loop, factor } = input;
  const holdMsAt = (index: number): number => (holdSec(steps, times, index, loop) * 1000) / factor;
  const walked = walk(
    steps,
    input.index,
    input.keys,
    input.presses,
    loop,
    input.nowMs,
    holdMsAt,
    input.releasing,
  );
  const step = steps[walked.at];
  const since = step ? runSince(step, walked.keys, walked.presses) : null;
  return {
    ...walked,
    wakeAtMs: since === null ? null : since + holdMsAt(walked.at),
    run: since === null ? null : { index: walked.at, sinceMs: since },
  };
}
