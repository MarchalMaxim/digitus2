import type { Assignment, Finger, Hand, Score } from '../score/types.js';
import {
  buildHandModel,
  inferFingering,
  INITIAL_PLAYER_STATE,
  readEvents,
  sameState,
} from './player.js';
import type { EventReading, HandModel, PlayerState, ReaderRule } from './player.js';

/**
 * The edition's digits (issue 94): the fewest digits a reader of `player.ts` needs to recover the
 * engine's fingering, cut to a budget by dropping the digit whose loss costs the fewest notes.
 *
 * 1. A greedy forward pass (research/readability/reduce.py): per hand, event by event, print the
 *    pinned notes and the first note of the hand (and, when a confidence floor is given, the notes
 *    the engine is unsure of; off by default, see `DEFAULT_CONFIDENCE_FLOOR`), then read the
 *    event and print the first unprinted note (thumb side first) whose reading differs from the
 *    engine's finger or is none, until every note of the event reads right. What this prints is
 *    `necessary`; it recovers the whole fingering.
 * 2. The budget is the density target of the piece's level, capped by the digits the editor prints
 *    on it when that is known, and never below the pinned and first digits.
 * 3. While the set is over the budget (and then for as long as a digit changes no reading at all),
 *    the digit whose removal makes the fewest notes read wrong goes first. The tier reruns of the first plan cascade (a suppressed digit leaves a wrong or
 *    empty `prev`, so a rerun can print more than the full pass); a removal's loss is local
 *    instead: the state after a printed event does not depend on what came before, so only the
 *    stretch up to the next printed event changes, and the copies that recall it by repeat memory.
 */

export type PrintReason =
  | 'pinned'
  | 'first'
  | 'none'
  | 'position'
  | 'chord'
  | 'step'
  | 'repeat'
  | 'memory'
  | 'lowConfidence';

export interface ReduceOptions {
  /** Library level 1..6; absent or unknown: the level-3 row. */
  level?: number;
  /** Digits the editor prints on this piece, when known: the cap. */
  editorDigits?: number;
  /** Notes below this confidence are always printed (default 0: off, see `DEFAULT_CONFIDENCE_FLOOR`). */
  confidenceFloor?: number;
}

export interface ReduceResult {
  /** Note ids printed at rest. */
  printed: Set<string>;
  /** Why each printed note is printed: the rule that failed without it, or pinned, first, low confidence. */
  reasons: Record<string, PrintReason>;
  /** Notes with a finger. */
  notes: number;
  budget: number;
  /** What the unbudgeted greedy pass prints. */
  necessary: number;
  /** The same without the low-confidence digits: the study's figure. */
  necessaryWithoutLowConfidence: number;
  /** Percent of notes the reader gets right from `printed`. */
  reconstruction: number;
}

/** Digits to print, in percent of notes, by library level (docs/research/readability.md 7.3). */
export const DENSITY_TARGET: Record<number, number> = { 1: 20, 2: 20, 3: 25, 4: 30, 5: 30, 6: 30 };
/**
 * Notes below this confidence are always printed. 0 leaves the trigger off, the default: the
 * engine's confidence is not calibrated for this use. It is below 0.6 on most notes of core30
 * (issue 94: the greedy pass with a 0.6 floor printed 70 to 90 percent of the notes, 56 of
 * Twinkle's 64 where 4 digits suffice), so the trigger prints digits the reader already infers.
 */
export const DEFAULT_CONFIDENCE_FLOOR = 0;

/**
 * The budget of a piece: the level's target, capped by the editor's digit count, never below the
 * `locked` (pinned and first) digits.
 */
export function digitBudget(
  notes: number,
  level?: number,
  editorDigits?: number,
  locked = 0,
): number {
  const target = DENSITY_TARGET[level ?? 3] ?? DENSITY_TARGET[3]!;
  const budget = Math.min(
    Math.round((target * notes) / 100),
    editorDigits ?? Number.POSITIVE_INFINITY,
  );
  return Math.max(budget, locked);
}

/** Weaker reasons go first when removals tie. */
const REASON_RANK: Record<PrintReason, number> = {
  lowConfidence: 0,
  memory: 1,
  repeat: 1,
  step: 2,
  chord: 2,
  position: 3,
  none: 4,
  pinned: 5,
  first: 5,
};

function failedRule(rule: ReaderRule): PrintReason {
  switch (rule) {
    case 'R1':
      return 'repeat';
    case 'R2':
      return 'step';
    case 'R3':
    case 'R4ref':
      return 'position';
    case 'R4':
      return 'chord';
    case 'R5':
      return 'memory';
    default:
      return 'none';
  }
}

/** Per event: what the reader got and how many notes it got right. */
interface Cached {
  fingers: ReadonlyArray<Finger | null>;
  correct: number;
  /** The reader's state after the event: a re-read can resume from it. */
  state: PlayerState;
}

interface HandState {
  hand: Hand;
  m: HandModel;
  /** The engine's finger of each note of the hand's sequence. */
  truth: Finger[];
  /** Printed (1) or not (0), per note of the sequence. */
  flag: Uint8Array;
  reason: PrintReason[];
  /** Pinned or first: never removed. */
  locked: Uint8Array;
  /** Printed notes per event. */
  cnt: Int32Array;
  cache: Cached[];
  /** Events with a printed note, ascending. */
  printedEvents: number[];
}

interface Greedy {
  hands: HandState[];
  scored: Score;
}

function makeHand(m: HandModel, full: Assignment): HandState {
  const hand = m.hand;
  const n = m.notes.length;
  return {
    hand,
    m,
    truth: m.notes.map((x) => full[x.noteId]!.finger),
    flag: new Uint8Array(n),
    reason: new Array<PrintReason>(n).fill('none'),
    locked: new Uint8Array(n),
    cnt: new Int32Array(m.events),
    cache: new Array<Cached>(m.events),
    printedEvents: [],
  };
}

/** The first printed event at or after `event`, not counting `skip`; Infinity when none. */
function firstPrintedFrom(h: HandState, event: number, skip: number): number {
  let i = lowerBound(h.printedEvents, event);
  if (h.printedEvents[i] === skip) i++;
  return h.printedEvents[i] ?? Number.POSITIVE_INFINITY;
}

const digitOf =
  (h: HandState) =>
  (k: number): Finger | undefined =>
    h.flag[k] ? h.truth[k] : undefined;

const correctCount = (h: HandState, e: number, fingers: ReadonlyArray<Finger | null>): number => {
  let c = 0;
  for (let i = 0; i < fingers.length; i++) if (fingers[i] === h.truth[h.m.first[e]! + i]) c++;
  return c;
};

function greedyHand(h: HandState, full: Assignment, floor: number | null): void {
  const { m } = h;
  let state: PlayerState = INITIAL_PLAYER_STATE;
  const resolved: Array<ReadonlyArray<Finger | null>> = [];
  const ctx = {
    digit: digitOf(h),
    resolved: (e: number) => resolved[e],
    firstDigitFrom: (e: number) => firstPrintedFrom(h, e, -1),
  };
  for (let e = 0; e < m.events; e++) {
    const base = m.first[e]!;
    for (let i = 0; i < m.size[e]!; i++) {
      const a = full[m.notes[base + i]!.noteId]!;
      const why: PrintReason | null = a.pinned
        ? 'pinned'
        : e === 0 && i === 0
          ? 'first'
          : floor !== null && a.confidence !== undefined && a.confidence < floor
            ? 'lowConfidence'
            : null;
      if (why) {
        h.flag[base + i] = 1;
        h.reason[base + i] = why;
        if (why === 'pinned' || why === 'first') h.locked[base + i] = 1;
      }
    }
    let reading!: EventReading;
    for (;;) {
      readEvents(
        m,
        e,
        e + 1,
        ctx,
        (_e, r) => {
          reading = r;
        },
        state,
      );
      let miss = -1;
      for (let i = 0; i < m.size[e]!; i++)
        if (!h.flag[base + i] && reading.fingers[i] !== h.truth[base + i]) {
          miss = i;
          break;
        }
      if (miss < 0) break;
      h.flag[base + miss] = 1;
      h.reason[base + miss] = failedRule(reading.rules[miss]!);
    }
    for (let i = 0; i < m.size[e]!; i++) h.cnt[e]! += h.flag[base + i]!;
    if (h.cnt[e]! > 0) h.printedEvents.push(e);
    resolved[e] = reading.fingers;
    h.cache[e] = {
      fingers: reading.fingers,
      correct: correctCount(h, e, reading.fingers),
      state: reading.state,
    };
    state = reading.state;
  }
}

function scoredOf(score: Score, full: Assignment): Score {
  return { ...score, notes: score.notes.filter((n) => full[n.id] !== undefined) };
}

/** The greedy pass over hand models already built (`models`), or built here. */
function greedyPass(
  scored: Score,
  full: Assignment,
  floor: number | null,
  memory: boolean,
  models?: HandModel[],
): Greedy {
  const ms = models ?? (['R', 'L'] as const).map((hand) => buildHandModel(scored, hand, memory));
  const hands = ms.map((m) => makeHand(m, full));
  for (const h of hands) greedyHand(h, full, floor);
  return { hands, scored };
}

const printedCount = (g: Greedy): number =>
  g.hands.reduce((s, h) => s + h.flag.reduce((a, b) => a + b, 0), 0);

/**
 * The unbudgeted greedy pass alone: the digits a reader needs to recover every finger. With
 * `lowConfidence: false` the engine's doubtful notes are not printed on that ground; with
 * `memory: false` the reader has no repeat memory (the study's reduction).
 */
export function greedyReduction(
  score: Score,
  full: Assignment,
  opts: { lowConfidence?: boolean; memory?: boolean; confidenceFloor?: number } = {},
): { printed: Set<string>; reasons: Record<string, PrintReason> } {
  const floor =
    opts.lowConfidence === false ? null : (opts.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR);
  const g = greedyPass(scoredOf(score, full), full, floor, opts.memory ?? true);
  return collect(g);
}

function collect(g: Greedy): { printed: Set<string>; reasons: Record<string, PrintReason> } {
  const printed = new Set<string>();
  const reasons: Record<string, PrintReason> = {};
  for (const h of g.hands)
    h.m.notes.forEach((n, k) => {
      if (!h.flag[k]) return;
      printed.add(n.noteId);
      reasons[n.noteId] = h.reason[k]!;
    });
  return { printed, reasons };
}

// ---------------------------------------------------------------------------------------------
// Removal by least loss
// ---------------------------------------------------------------------------------------------

const lowerBound = (arr: number[], x: number): number => {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const upperBound = (arr: number[], x: number): number => {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** The last printed event at or before e, not counting `skip` (event 0 always prints). */
function startOf(h: HandState, e: number, skip: number): number {
  let i = upperBound(h.printedEvents, e) - 1;
  while (i > 0 && h.printedEvents[i] === skip) i--;
  return h.printedEvents[i]!;
}

/** The first printed event after e, not counting `skip`, or the event count. */
function endAfter(h: HandState, e: number, skip: number): number {
  let i = upperBound(h.printedEvents, e);
  while (i < h.printedEvents.length && h.printedEvents[i] === skip) i++;
  return i < h.printedEvents.length ? h.printedEvents[i]! : h.m.events;
}

const sameFingers = (a: ReadonlyArray<Finger | null>, b: ReadonlyArray<Finger | null>): boolean =>
  a.length === b.length && a.every((f, i) => f === b[i]);

interface Removal {
  /** Notes that read right now and would not without the digit. */
  loss: number;
  overlay: Map<number, Cached>;
  /** The stretches read again: [start, end) in events. */
  stretches: Array<[number, number]>;
  /** Events whose reading differs from the cached one. */
  changed: number[];
  /** The digit was the last of its event. */
  lost: boolean;
}

/**
 * The effect of removing the printed note x, read again from the event of the digit up to where
 * the readings are the same as before. The state after an event is cached, so a re-read resumes
 * from the event before the first one that changes. It runs to the next printed event (the state
 * after a printed event does not depend on what came before) or stops sooner, where an event reads
 * the same and leaves the reader in the same state; it cannot stop sooner when the digit was the
 * last of its event, because then the copies that were cut off by it recall again. A changed
 * reading dirties the events that recall it (`dependents`), which are read again the same way,
 * in event order. Nothing is changed: `applyRemoval` makes the removal stay, as long as nothing
 * else changed since.
 */
function removal(h: HandState, x: number): Removal {
  const { m } = h;
  const ex = m.notes[x]!.slice;
  h.flag[x] = 0;
  h.cnt[ex]!--;
  const lost = h.cnt[ex] === 0;
  const skip = lost ? ex : -1;
  const overlay = new Map<number, Cached>();
  const stretches: Array<[number, number]> = [];
  const changed: number[] = [];
  const pending = new Set<number>([ex]);
  const ctx = {
    digit: digitOf(h),
    resolved: (e: number) => (overlay.get(e) ?? h.cache[e])?.fingers,
    firstDigitFrom: (e: number) => firstPrintedFrom(h, e, skip),
  };
  let covered = -1;
  while (pending.size > 0) {
    const f = Math.min(...pending);
    pending.delete(f);
    if (f <= covered) continue;
    const end = endAfter(h, f, skip);
    stretches.push([startOf(h, f, skip), end]);
    const first = f === ex && lost;
    const before = f === 0 ? INITIAL_PLAYER_STATE : (overlay.get(f - 1) ?? h.cache[f - 1]!).state;
    readEvents(
      m,
      f,
      end,
      ctx,
      (e, r) => {
        const old = h.cache[e]!;
        overlay.set(e, {
          fingers: r.fingers,
          correct: correctCount(h, e, r.fingers),
          state: r.state,
        });
        covered = e;
        const differs = !sameFingers(old.fingers, r.fingers);
        if (differs) {
          changed.push(e);
          for (const d of m.dependents[e]!) pending.add(d);
        }
        return !first && !differs && sameState(old.state, r.state);
      },
      before,
    );
  }
  let loss = 0;
  for (const [e, c] of overlay) loss += h.cache[e]!.correct - c.correct;
  h.flag[x] = 1;
  h.cnt[ex]!++;
  return { loss, overlay, stretches, changed, lost };
}

/** Removes the printed note x for good, with the readings `removal` computed for it. */
function applyRemoval(h: HandState, x: number, r: Removal): void {
  const ex = h.m.notes[x]!.slice;
  h.flag[x] = 0;
  h.cnt[ex]!--;
  for (const [e, c] of r.overlay) h.cache[e] = c;
  if (r.lost) h.printedEvents.splice(lowerBound(h.printedEvents, ex), 1);
}

interface Entry {
  loss: number;
  rank: number;
  /** Order of the note in the piece (onset, then hand): later goes first on a tie. */
  pos: number;
  hand: number;
  note: number;
  ver: number;
}

const before = (a: Entry, b: Entry): boolean =>
  a.loss !== b.loss
    ? a.loss < b.loss
    : a.rank !== b.rank
      ? a.rank < b.rank
      : a.pos !== b.pos
        ? a.pos > b.pos
        : a.hand !== b.hand
          ? a.hand < b.hand
          : a.note < b.note;

class Heap {
  private a: Entry[] = [];
  get size(): number {
    return this.a.length;
  }
  push(x: Entry): void {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(a[i]!, a[p]!)) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }
  pop(): Entry | undefined {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < a.length && before(a[l]!, a[s]!)) s = l;
        if (r < a.length && before(a[r]!, a[s]!)) s = r;
        if (s === i) break;
        [a[i], a[s]] = [a[s]!, a[i]!];
        i = s;
      }
    }
    return top;
  }
}

export interface ReduceDetail extends ReduceResult {
  /** Notes the incremental bookkeeping counts as read right: must equal `reconstruction`. */
  trackedCorrect: number;
  /** Each removal's loss, in order (a test checks it against the global reconstruction). */
  losses: number[];
}

/**
 * `reduceFingering` with its bookkeeping, for the tests that check the heap against the reader;
 * `budgetOverride` replaces the budget (Infinity: the unbudgeted pass). With `verify` (the default)
 * `reconstruction` is measured by running the reader over the printed set, independently of the
 * heap's bookkeeping; without it the bookkeeping's count is used, which saves a full read.
 */
export function reduceDetailed(
  score: Score,
  full: Assignment,
  opts: ReduceOptions = {},
  budgetOverride?: number,
  verify = true,
): ReduceDetail {
  const floor = opts.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR;
  const scored = scoredOf(score, full);
  const models = (['R', 'L'] as const).map((hand) => buildHandModel(scored, hand));
  const g = greedyPass(scored, full, floor, true, models);
  const necessary = printedCount(g);
  const necessaryWithoutLowConfidence =
    floor > 0 ? printedCount(greedyPass(scored, full, null, true, models)) : necessary;
  const notes = scored.notes.length;
  const lockedCount = g.hands.reduce((s, h) => s + h.locked.reduce((a, b) => a + b, 0), 0);
  const budget = budgetOverride ?? digitBudget(notes, opts.level, opts.editorDigits, lockedCount);
  const losses: number[] = [];

  let count = necessary;
  const ver = g.hands.map((h) => new Int32Array(h.m.notes.length));
  const pos = g.hands.map((h) => new Int32Array(h.m.notes.length));
  const order: Array<[number, number, number]> = [];
  g.hands.forEach((h, hi) =>
    h.m.notes.forEach((n, k) => {
      if (h.flag[k]) order.push([n.onsetSec, hi, k]);
    }),
  );
  order.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  order.forEach(([, hi, k], i) => (pos[hi]![k] = i));

  const heap = new Heap();
  const offer = (hi: number, k: number): void => {
    const h = g.hands[hi]!;
    if (!h.flag[k] || h.locked[k]) return;
    const v = ++ver[hi]![k]!;
    heap.push({
      loss: removal(h, k).loss,
      rank: REASON_RANK[h.reason[k]!],
      pos: pos[hi]![k]!,
      hand: hi,
      note: k,
      ver: v,
    });
  };
  g.hands.forEach((h, hi) => h.m.notes.forEach((_, k) => offer(hi, k)));

  while (heap.size > 0) {
    const top = heap.pop()!;
    const h = g.hands[top.hand]!;
    if (top.ver !== ver[top.hand]![top.note] || !h.flag[top.note]) continue;
    const r = removal(h, top.note);
    if (r.loss !== top.loss) {
      heap.push({ ...top, loss: r.loss });
      continue;
    }
    // Within the budget only a digit that changes no reading still goes.
    if (count <= budget && r.loss > 0) break;
    applyRemoval(h, top.note, r);
    losses.push(r.loss);
    count--;
    ver[top.hand]![top.note]!++;
    // A loss depends on the digit's own stretch, the one before it (they merge when the digit
    // goes), and the copies that recall the stretch. So the digits to value again are those at the
    // start and end of every stretch that was read again (the merged one, and the copies that
    // recall an event whose reading changed), and those at the start and end of the stretch each
    // changed event recalls. A loss can fall as well as rise, so this is exact, not a bound.
    const near = new Set<number>([h.m.notes[top.note]!.slice]);
    for (const [s, end] of r.stretches) {
      near.add(s);
      near.add(end);
    }
    for (const e of r.changed) {
      const src = h.m.src[e]!;
      if (src < 0) continue;
      const st = startOf(h, src, -1);
      near.add(st);
      near.add(endAfter(h, st, -1));
    }
    for (const e of near) {
      if (e >= h.m.events) continue;
      for (let i = 0; i < h.m.size[e]!; i++) offer(top.hand, h.m.first[e]! + i);
    }
  }

  const { printed, reasons } = collect(g);
  const tracked = g.hands.reduce((s, h) => s + h.cache.reduce((a, c) => a + c.correct, 0), 0);
  let right = tracked;
  if (verify) {
    const subset: Assignment = {};
    for (const id of printed) subset[id] = full[id]!;
    const inferred = inferFingering(scored, subset).assignment;
    right = 0;
    for (const n of scored.notes) if (inferred[n.id]?.finger === full[n.id]!.finger) right++;
  }
  return {
    printed,
    reasons,
    notes,
    budget,
    necessary,
    necessaryWithoutLowConfidence,
    reconstruction: notes === 0 ? 100 : (100 * right) / notes,
    trackedCorrect: tracked,
    losses,
  };
}

/**
 * The digits to print at rest, out of the engine's complete fingering `full`. Notes without an
 * entry in `full` are left out of the score before reading.
 */
export function reduceFingering(
  score: Score,
  full: Assignment,
  opts: ReduceOptions = {},
): ReduceResult {
  const detail = reduceDetailed(score, full, opts, undefined, false);
  return {
    printed: detail.printed,
    reasons: detail.reasons,
    notes: detail.notes,
    budget: detail.budget,
    necessary: detail.necessary,
    necessaryWithoutLowConfidence: detail.necessaryWithoutLowConfidence,
    reconstruction: detail.reconstruction,
  };
}
