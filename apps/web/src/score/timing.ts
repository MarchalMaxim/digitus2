// Pure: the timing judge after a run of Play (issue 192). Types only, apart from the steps of
// `playAlong.ts` (already in the static bundle). Every time here is in performance seconds on one
// run axis (`passOffsets`), so a tempo change mid-run moves nothing; milliseconds appear only where
// a tolerance or an offset is reported, `ms = perfSec * 1000 / factor`.
import type { Hand } from '@digitus2/engine';
import type { Performance } from '../audio/performance.js';
import type { PassSpan } from '../audio/timeline.js';
import { ALONG_EPS, alongPlanNotes } from './playAlong.js';

// The windows, all provisional until the owner's sessions set them (issue 192).
/** Below roughly 100 ms a beginner cannot act on the difference. */
export const TOLERANCE_FLOOR_MS = 120;
/** "Clearly early or late": off by more than the smallest subdivision a beginner counts. */
export const TOLERANCE_BEATS = 0.25;
/** The bias search looks a beat either side of each hearing for the reader's steady offset. */
export const BIAS_SEARCH_BEATS = 1;
/** The bias search reaches at least this far, so a Bluetooth and reaction lag is found fast. */
export const BIAS_SEARCH_MIN_MS = 500;
/** Centred on the bias, a press further than this from any hearing of its pitch is no note's. */
export const MATCH_WINDOW_BEATS = 0.75;
/** The match window is never narrower, so the floor tolerance and jitter fit at fast tempos. */
export const MATCH_WINDOW_MIN_MS = 250;
/** A unit's verdict comes from its last few counted hearings: one slip in three is forgiven. */
export const JUDGE_LAST_HEARINGS = 3;
/** Below this share of matched hearings, the reader listened (to a hand, or to the run). */
export const MIN_PLAYED_SHARE = 0.4;
/** Fewer matched hearings than this give no bias and judge nothing. */
export const MIN_MATCHED = 4;
/** So many consecutive unmatched hearings spanning a full bar are listening, not missing. */
export const LISTEN_MIN_STEPS = 4;
/** Without a count-in the first `max(beat, this)` of a pass judges no lateness: reaction time. */
export const REACTION_MIN_MS = 500;
/** The run-axis gap after a pass a seek cut: no press is matched across it. */
export const SEEK_GAP_SEC = 3600;

export interface Neighbour {
  /** Written note ids of the neighbouring onset in the same hand. */
  ids: readonly string[];
  /** Onset distance in performance seconds (positive). */
  dSec: number;
}

/** A step's notes in one hand (one staff): the judged unit (issue 192). */
export interface StepPart {
  hand: Hand;
  /** Required pitches of this hand, distinct and ascending. */
  pitches: readonly number[];
  /** Written note ids (the SVG ids). */
  ids: readonly string[];
  /** The written part: sorted unique ids joined by a space. */
  key: string;
  prev: Neighbour | null;
  next: Neighbour | null;
}

export interface TimingStep {
  perfSec: number;
  /** Required pitches of every part, distinct and ascending (AlongStep.pitches). */
  pitches: readonly number[];
  beatSec: number;
  barSec: number;
  parts: readonly StepPart[];
}

/** A note-on mapped live to the timeline. */
export interface TimedPress {
  pass: number;
  perfSec: number;
  midi: number;
  /** The factor of its HeardAt: its offset converts to ms with it. */
  factor: number;
}

export type Verdict = 'onTime' | 'early' | 'late' | 'missed';

export interface UnitVerdict {
  key: string;
  hand: Hand;
  ids: readonly string[];
  verdict: Verdict;
  /** Median offset after the bias, in ms; null when missed. */
  offsetMs: number | null;
  /** The same in performance seconds (for the ring's displacement); null when missed. */
  offsetSec: number | null;
  tolMs: number;
  /** How many counted hearings the verdict was taken from (at most JUDGE_LAST_HEARINGS). */
  hearings: number;
  prev: Neighbour | null;
  next: Neighbour | null;
}

export interface RunJudgement {
  /** One per judged unit, in the order of their first counted hearing. */
  verdicts: UnitVerdict[];
  onTime: number;
  total: number;
  /** The median signed offset subtracted, in ms (end factor). */
  biasMs: number;
  /** Matched / counted part-hearings. */
  playedShare: number;
}

export interface RunInput {
  steps: readonly TimingStep[];
  passes: readonly PassSpan[];
  presses: readonly TimedPress[];
  /** The Practice tempo factor at the end of the run: real seconds = performance seconds / factor. */
  factor: number;
}

/** The written id of a performance note id: a repeat's hearing carries `@pass`, the SVG does not. */
export function writtenNoteId(perf: Performance, id: string): string {
  return perf.identity ? id : id.replace(/@\d+$/, '');
}

/**
 * The steps of the hands played as the judge sees them: `alongPlanNotes`' steps, each part with
 * its written ids, its key and its neighbours in the same hand (the rings' local time scale).
 */
export function timingSteps(perf: Performance, mutedHands: readonly Hand[]): TimingStep[] {
  const { steps, notes } = alongPlanNotes(perf, mutedHands);
  const out: TimingStep[] = steps.map((step, i) => ({
    perfSec: step.perfSec,
    pitches: step.pitches,
    beatSec: notes[i]!.beatSec,
    barSec: notes[i]!.barSec,
    parts: notes[i]!.parts.map((part): StepPart => {
      const ids = part.ids.map((id) => writtenNoteId(perf, id));
      const key = [...new Set(ids)].sort().join(' ');
      return { hand: part.hand, pitches: part.pitches, ids, key, prev: null, next: null };
    }),
  }));
  const last = new Map<Hand, { perfSec: number; part: StepPart }>();
  for (const step of out) {
    for (const part of step.parts) {
      const before = last.get(part.hand);
      if (before) {
        const dSec = step.perfSec - before.perfSec;
        part.prev = { ids: before.part.ids, dSec };
        before.part.next = { ids: part.ids, dSec };
      }
      last.set(part.hand, { perfSec: step.perfSec, part });
    }
  }
  return out;
}

/** Where a pass ends in its own seconds: an open pass runs on when it is the last. */
function endOf(passes: readonly PassSpan[], i: number): number {
  const p = passes[i]!;
  return p.toSec ?? (i === passes.length - 1 ? Infinity : p.fromSec);
}

/**
 * Whether each pass is continued (R6): it wrapped, or the next pass starts where it ended (a
 * resync). Only a pass that heard something continues that way: one a seek emptied in its
 * count-in, start delay or lead ends where it began, and a seek to that same second starts the
 * music cold (the count-in cut short), so the reaction rule must apply to it.
 */
function continuedEnds(passes: readonly PassSpan[]): boolean[] {
  return passes.map((p, i) => {
    const next = passes[i + 1];
    return (
      p.wrapped ||
      (!!next &&
        p.toSec !== null &&
        p.toSec - p.fromSec > ALONG_EPS &&
        Math.abs(next.fromSec - p.toSec) <= ALONG_EPS)
    );
  });
}

/**
 * The axis offset of each pass (R6): one monotone axis in performance seconds, the passes joined
 * end to start where they continue, and `SEEK_GAP_SEC` apart where a seek or the stop cut one.
 */
export function passOffsets(passes: readonly PassSpan[]): number[] {
  const continued = continuedEnds(passes);
  const offsets: number[] = [];
  let at = 0;
  passes.forEach((p, i) => {
    offsets.push(at);
    at += endOf(passes, i) - p.fromSec + (continued[i] ? 0 : SEEK_GAP_SEC);
  });
  return offsets;
}

/** One occurrence of a step in the run. */
interface Hearing {
  step: TimingStep;
  /** Its pass, as an index into `RunInput.passes`. */
  pass: number;
  /** Its onset on the run axis. */
  axis: number;
  /** The half-width of its match window (R4.4). */
  w: number;
}

/** A press on the run axis. */
interface AxisPress {
  midi: number;
  axis: number;
  factor: number;
}

/** The run laid out on its axis. */
interface Run {
  passes: readonly PassSpan[];
  continued: boolean[];
  /** Each pass's end on the run axis. */
  ends: number[];
  /** In run order. */
  hearings: Hearing[];
  presses: AxisPress[];
  /** Per pitch, the hearings that ask for it, in run order (indices into `hearings`). */
  byPitch: Map<number, number[]>;
  factor: number;
}

/** The first step at or after `sec` (steps ascending), `steps.length` when there is none. */
function firstStepFrom(steps: readonly TimingStep[], sec: number): number {
  let lo = 0;
  let hi = steps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid]!.perfSec >= sec) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * The hearings and presses on the run axis (R4.2, R6). A pass hears the steps from its start to
 * its end; a press whose pass is not in the log is dropped.
 */
function hearings(input: RunInput): Run {
  const { steps, passes, factor } = input;
  const offsets = passOffsets(passes);
  const ends = passes.map((p, i) => offsets[i]! + endOf(passes, i) - p.fromSec);
  const heard: Hearing[] = [];
  passes.forEach((p, i) => {
    const to = endOf(passes, i) - ALONG_EPS;
    for (let k = firstStepFrom(steps, p.fromSec - ALONG_EPS); k < steps.length; k++) {
      const step = steps[k]!;
      if (step.perfSec >= to) break;
      const w = Math.max(MATCH_WINDOW_BEATS * step.beatSec, (MATCH_WINDOW_MIN_MS / 1000) * factor);
      heard.push({ step, pass: i, axis: offsets[i]! + step.perfSec - p.fromSec, w });
    }
  });
  const passIndex = new Map(passes.map((p, i) => [p.pass, i]));
  const presses: AxisPress[] = [];
  for (const press of input.presses) {
    const i = passIndex.get(press.pass);
    if (i === undefined) continue;
    const axis = offsets[i]! + press.perfSec - passes[i]!.fromSec;
    presses.push({ midi: press.midi, axis, factor: press.factor });
  }
  const byPitch = new Map<number, number[]>();
  heard.forEach((h, i) => {
    for (const midi of h.step.pitches) {
      const list = byPitch.get(midi);
      if (list) list.push(i);
      else byPitch.set(midi, [i]);
    }
  });
  return {
    passes,
    continued: continuedEnds(passes),
    ends,
    hearings: heard,
    presses,
    byPitch,
    factor,
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The hearing among `list` (one pitch's, in run order) whose window holds `x`: the windows are
 * centred at `axis + shift`, cut at the midpoints between neighbouring centres, so they never
 * overlap, and reach `half` of their hearing at most. An index into `run.hearings`, or -1.
 */
function windowOf(
  run: Run,
  list: readonly number[],
  x: number,
  shift: number,
  half: (h: Hearing) => number,
): number {
  const centre = (k: number): number => run.hearings[list[k]!]!.axis + shift;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (centre(mid) > x) hi = mid;
    else lo = mid + 1;
  }
  // `lo` is the first centre past `x`; the nearer of it and the one before holds `x`.
  let k = lo;
  if (lo === list.length || (lo > 0 && x - centre(lo - 1) < centre(lo) - x)) k = lo - 1;
  if (k < 0) return -1;
  const h = run.hearings[list[k]!]!;
  return Math.abs(x - centre(k)) <= half(h) ? list[k]! : -1;
}

/** The coarse pass (R4.3): the reader's steady offset, in performance seconds. */
function biasOf(run: Run): number {
  const half = (h: Hearing): number =>
    Math.max(BIAS_SEARCH_BEATS * h.step.beatSec, (BIAS_SEARCH_MIN_MS / 1000) * run.factor);
  const offsets: number[] = [];
  for (const p of run.presses) {
    const list = run.byPitch.get(p.midi);
    const i = list ? windowOf(run, list, p.axis, 0, half) : -1;
    if (i >= 0) offsets.push(p.axis - run.hearings[i]!.axis);
  }
  return offsets.length >= MIN_MATCHED ? median(offsets) : 0;
}

/** The coarse bias in performance seconds (R4.3); exported for tests. */
export function estimateBias(input: RunInput): number {
  return biasOf(hearings(input));
}

/** A pitch of a hearing, matched: its offset after the bias. */
interface PitchMatch {
  offsetSec: number;
  /** With the press's own factor (A16). */
  offsetMs: number;
}

interface Matching {
  /** Per hearing, its matched pitches. */
  matched: Map<number, PitchMatch>[];
  /** The presses in no window of their pitch (wrong notes, stray extras), by axis. */
  unmatched: AxisPress[];
}

/**
 * Matching (R4.4), one pass per press: a press belongs to the window of its pitch's hearing
 * nearest `press - bias`, if within that hearing's `w`; in each window the press nearest the
 * centre is matched and any other is an extra.
 */
function matchPitches(run: Run, bias: number): Matching {
  const matched = run.hearings.map(() => new Map<number, PitchMatch>());
  const unmatched: AxisPress[] = [];
  for (const p of run.presses) {
    const list = run.byPitch.get(p.midi);
    const i = list ? windowOf(run, list, p.axis, bias, (h) => h.w) : -1;
    if (i < 0) {
      unmatched.push(p);
      continue;
    }
    const offsetSec = p.axis - run.hearings[i]!.axis - bias;
    const best = matched[i]!.get(p.midi);
    if (best && Math.abs(best.offsetSec) <= Math.abs(offsetSec)) continue;
    matched[i]!.set(p.midi, { offsetSec, offsetMs: (offsetSec * 1000) / p.factor });
  }
  unmatched.sort((a, b) => a.axis - b.axis);
  return { matched, unmatched };
}

/** A part within a hearing; offsets null when none of its pitches matched (missed). */
interface PartHearing {
  /** Index into `run.hearings`. */
  hearing: number;
  part: StepPart;
  offsetSec: number | null;
  offsetMs: number | null;
}

/** Every part of every hearing, in run order, matched on the median of its matched pitches. */
function partHearings(run: Run, matching: Matching): PartHearing[] {
  const out: PartHearing[] = [];
  run.hearings.forEach((h, i) => {
    const matched = matching.matched[i]!;
    for (const part of h.step.parts) {
      const hits = part.pitches.flatMap((midi) => matched.get(midi) ?? []);
      out.push({
        hearing: i,
        part,
        offsetSec: hits.length > 0 ? median(hits.map((m) => m.offsetSec)) : null,
        offsetMs: hits.length > 0 ? median(hits.map((m) => m.offsetMs)) : null,
      });
    }
  });
  return out;
}

/** The tolerance of a step's unit in ms (R4.6), at the run's end factor. */
function toleranceMs(step: TimingStep, factor: number): number {
  return Math.max(TOLERANCE_FLOOR_MS, (TOLERANCE_BEATS * step.beatSec * 1000) / factor);
}

function verdictAt(offsetMs: number, tolMs: number): Verdict {
  if (offsetMs < -tolMs) return 'early';
  if (offsetMs > tolMs) return 'late';
  return 'onTime';
}

/**
 * The played span (R4.5.2): per stretch of continued passes, the hearings from its first to its
 * last matched one, less the runs of unmatched hearings long enough to be listening.
 */
function playedSpan(run: Run, heard: readonly boolean[]): boolean[] {
  const { hearings: all, continued } = run;
  const stretchOf: number[] = [];
  run.passes.forEach((_, i) =>
    stretchOf.push(i === 0 ? 0 : stretchOf[i - 1]! + (continued[i - 1] ? 0 : 1)),
  );
  const out = all.map(() => false);
  let start = 0;
  while (start < all.length) {
    let end = start;
    const stretch = stretchOf[all[start]!.pass];
    while (end < all.length && stretchOf[all[end]!.pass] === stretch) end++;
    let first = start;
    while (first < end && !heard[first]) first++;
    let last = end - 1;
    while (last >= first && !heard[last]) last--;
    for (let i = first; i <= last;) {
      if (heard[i]) {
        out[i++] = true;
        continue;
      }
      let next = i;
      while (!heard[next]) next++;
      const listening =
        next - i >= LISTEN_MIN_STEPS &&
        all[next]!.axis - all[i]!.axis >= all[i]!.step.barSec - ALONG_EPS;
      for (; i < next; i++) out[i] = !listening;
    }
    start = end;
  }
  return out;
}

/** Whether the reaction rule (R4.5.3) covers a hearing: the first beat of a pass begun cold. */
function reacting(run: Run, h: Hearing): boolean {
  const p = run.passes[h.pass]!;
  if (p.countedIn || (h.pass > 0 && run.continued[h.pass - 1])) return false;
  return (
    h.step.perfSec < p.fromSec + Math.max(h.step.beatSec, (REACTION_MIN_MS / 1000) * run.factor)
  );
}

/** Whether an unmatched press of another pitch lies in the hearing's uncut window (R4.5.4). */
function wrongKeyOnBeat(matching: Matching, h: Hearing, part: StepPart, bias: number): boolean {
  const { unmatched } = matching;
  const from = h.axis + bias - h.w;
  let lo = 0;
  let hi = unmatched.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (unmatched[mid]!.axis >= from) hi = mid;
    else lo = mid + 1;
  }
  for (let i = lo; i < unmatched.length && unmatched[i]!.axis <= h.axis + bias + h.w; i++) {
    if (!part.pitches.includes(unmatched[i]!.midi)) return true;
  }
  return false;
}

/**
 * Which part-hearings count (R4.5), in its order: the cut guard, the played span, the reaction
 * rule, a wrong key on the beat, then a hand listened to.
 */
function counted(
  run: Run,
  matching: Matching,
  parts: readonly PartHearing[],
  bias: number,
): boolean[] {
  const { hearings: all, continued, ends, factor } = run;
  const clear = all.map(
    (h) => continued[h.pass] || h.axis + Math.max(0, bias) + h.w <= ends[h.pass]!,
  );
  const played = playedSpan(
    run,
    all.map((_, i) => matching.matched[i]!.size > 0),
  );
  const keep = parts.map((ph) => {
    const h = all[ph.hearing]!;
    if (!clear[ph.hearing] || !played[ph.hearing]) return false;
    if (
      reacting(run, h) &&
      (ph.offsetMs === null || verdictAt(ph.offsetMs, toleranceMs(h.step, factor)) === 'late')
    ) {
      return false;
    }
    return ph.offsetMs !== null || !wrongKeyOnBeat(matching, h, ph.part, bias);
  });
  for (const hand of ['L', 'R'] as const) {
    let total = 0;
    let hits = 0;
    parts.forEach((ph, i) => {
      if (!keep[i] || ph.part.hand !== hand) return;
      total++;
      if (ph.offsetMs !== null) hits++;
    });
    if (total > 0 && hits / total < MIN_PLAYED_SHARE) {
      parts.forEach((ph, i) => {
        if (ph.part.hand === hand) keep[i] = false;
      });
    }
  }
  return keep;
}

/** A unit's verdict (R4.7) from its counted part-hearings in run order. */
function verdictOf(
  list: readonly PartHearing[],
  tolMs: number,
): Pick<UnitVerdict, 'verdict' | 'offsetMs' | 'offsetSec' | 'hearings'> {
  const last = list.slice(-JUDGE_LAST_HEARINGS);
  const hits = last.filter((ph) => ph.offsetMs !== null);
  if ((last.length - hits.length) * 2 > last.length) {
    return { verdict: 'missed', offsetMs: null, offsetSec: null, hearings: last.length };
  }
  const offsetMs = median(hits.map((ph) => ph.offsetMs!));
  return {
    verdict: verdictAt(offsetMs, tolMs),
    offsetMs,
    offsetSec: median(hits.map((ph) => ph.offsetSec!)),
    hearings: last.length,
  };
}

/**
 * How the timing went (R4): per judged unit (a written part, one hand) on time, early, late or
 * missed, once a steady lag is taken away and what the reader only listened to is left out. Null
 * when the reader barely played.
 */
export function judgeRun(input: RunInput): RunJudgement | null {
  const run = hearings(input);
  const bias = biasOf(run);
  const matching = matchPitches(run, bias);
  const parts = partHearings(run, matching);
  const keep = counted(run, matching, parts, bias);
  const kept = parts.filter((_, i) => keep[i]);
  const hits = kept.filter((ph) => ph.offsetMs !== null).length;
  if (kept.length === 0 || hits < MIN_MATCHED || hits / kept.length < MIN_PLAYED_SHARE) return null;
  const units = new Map<string, PartHearing[]>();
  for (const ph of kept) {
    const list = units.get(ph.part.key);
    if (list) list.push(ph);
    else units.set(ph.part.key, [ph]);
  }
  const verdicts = [...units.values()].map((list): UnitVerdict => {
    const { part, hearing } = list[list.length - 1]!;
    const tolMs = toleranceMs(run.hearings[hearing]!.step, run.factor);
    return {
      key: part.key,
      hand: part.hand,
      ids: part.ids,
      ...verdictOf(list, tolMs),
      tolMs,
      prev: part.prev,
      next: part.next,
    };
  });
  return {
    verdicts,
    onTime: verdicts.filter((v) => v.verdict === 'onTime').length,
    total: verdicts.length,
    biasMs: (bias * 1000) / input.factor,
    playedShare: hits / kept.length,
  };
}
