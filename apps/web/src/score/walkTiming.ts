// Pure: the timing of the waiting walk (issue 192). Types only, apart from the steps of
// playAlong.ts (already in the static bundle). The reader's own pulse is the clock: each gap
// between onsets is compared with the written gap, at the reader's tempo, so a steady latency cancels.
import type { Hand } from '@digitus2/engine';
import type { Performance } from '../audio/performance.js';
import { ALONG_EPS, alongPlanNotes, holdSec, type AlongStep, type StepTime } from './playAlong.js';
import type { TimingMark } from './render/timingMarks.js';

// The windows, all provisional until the owner's sessions set them (issue 192).
/** The tolerance never goes below this, in real milliseconds. */
export const TOLERANCE_FLOOR_MS = 120;
/** The tolerance in felt beats at the reader's own tempo. */
export const TOLERANCE_BEATS = 0.25;
/** The tolerance as a share of the written gap at the reader's tempo (long notes spread more). */
export const TOLERANCE_GAP = 0.15;
/** A gap up to one beat is a pause past this many times the expected one plus the floor. */
export const PAUSE_RATIO = 2;
/** The pause test's floor, in real milliseconds. */
export const PAUSE_FLOOR_MS = 300;
/** For longer gaps the pause margin stops growing at this many felt beats (plus the floor). */
export const PAUSE_BEATS = 1;
/** The reader's tempo at a gap is the median of the timed gaps at most this many links away. */
export const TEMPO_WINDOW = 8;
/** A stretch of fewer onsets than this, joined without a break, judges nothing. */
export const MIN_FIT_ONSETS = 4;
/** A gap with fewer timed gaps than this in its tempo window is not judged. */
export const MIN_TEMPO_GAPS = 3;
/** Rings kept per judged bar: the note furthest past its tolerance. */
export const MAX_RINGS_PER_BAR = 1;
/** A logged note-on this close to a run start (arrival times) is the press that started it. */
export const PRESS_MATCH_MS = 20;
/** The explanation leaves at this many bars judged after it appeared. */
export const EXPLAIN_BARS = 2;

/** What the judge needs of a step. */
export interface PlanStep {
  /** The step's onset in performance seconds (AlongStep.perfSec). */
  perfSec: number;
  /** The felt beat at the step, in performance seconds (StepNotes.beatSec). */
  beatSec: number;
  /** The performance bar holding the onset: the pass index into `perf.starts`. */
  bar: number;
  /** How long the walk holds the red on it before moving on, in performance seconds (`holdSec` with no loop). */
  holdSec: number;
}

/** A step of the walk as its timing sees it, aligned with `alongPlan`'s steps. */
export interface WalkPlanStep extends PlanStep {
  /** The written bar of `bar` (`perf.written[bar]`): the key of the rings. */
  writtenBar: number;
  /** The pitches the step asks for (AlongStep.pitches). */
  pitches: readonly number[];
  /** The written ids (SVG ids) of the step's non-grace notes in the hands played, unique, in score order. */
  ids: readonly string[];
}

export interface WalkPlan {
  steps: WalkPlanStep[];
  /** `alongPlan`'s steps and times, for the holds the test hook reports. */
  along: AlongStep[];
  times: StepTime[];
}

/** One passed step, timed: `ms` is the onset in performance.now() milliseconds. */
export interface Onset {
  index: number;
  ms: number;
  /** Onsets of different chains are never compared. */
  chain: number;
}

export type Verdict = 'onTime' | 'early' | 'late';

export interface Judged {
  index: number;
  verdict: Verdict;
  /** The gap into the note minus the written gap at the reader's tempo, in real ms (negative early). */
  offsetMs: number;
  /** The same in performance seconds at the reader's tempo (for the ring's displacement). */
  offsetSec: number;
  tolMs: number;
}

/** A note-on as the timing logs it. */
export interface NotePress {
  midi: number;
  /** performance.now() in the timing's listener. */
  arrivalMs: number;
  /** NoteMessage.atMs, else arrivalMs. */
  atMs: number;
}

/** The written id of a performance note id: a repeat's hearing carries `@pass`, the SVG does not. */
export function writtenNoteId(perf: Performance, id: string): string {
  return perf.identity ? id : id.replace(/@\d+$/, '');
}

/**
 * The steps of the hands played as the timing sees them: `alongPlanNotes`' steps, each with its
 * felt beat, its hold, its performance bar and its written bar and ids (the rings' keys).
 */
export function walkTimingPlan(perf: Performance, mutedHands: readonly Hand[]): WalkPlan {
  const { steps, times, notes } = alongPlanNotes(perf, mutedHands);
  /** The last pass starting at or before `sec` (binary search on perf.starts), at least 0. */
  const barAt = (sec: number): number => {
    let lo = 0;
    let hi = perf.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (perf.starts[mid]! <= sec + ALONG_EPS) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, lo - 1);
  };
  return {
    along: steps,
    times,
    steps: steps.map((step, i) => {
      const bar = barAt(step.perfSec);
      return {
        perfSec: step.perfSec,
        beatSec: notes[i]!.beatSec,
        bar,
        holdSec: holdSec(steps, times, i, null),
        writtenBar: perf.written[bar] ?? bar,
        pitches: step.pitches,
        ids: [...new Set(notes[i]!.ids.map((id) => writtenNoteId(perf, id)))],
      };
    }),
  };
}

/**
 * The event time of the press that started a step's run (`sinceMs`, the latest press among its
 * pitches, in the walk's arrival time): the latest logged note-on of one of `pitches` that is not
 * a later press, its `atMs` when its arrival matches `sinceMs` within `PRESS_MATCH_MS`. The
 * arrival time stands in when the log does not have that press (pruned, or before the timing
 * listened).
 */
export function resolveOnset(
  sinceMs: number,
  pitches: readonly number[],
  log: readonly NotePress[],
): number {
  for (let i = log.length - 1; i >= 0; i--) {
    const press = log[i]!;
    if (press.arrivalMs > sinceMs + PRESS_MATCH_MS) continue; // a later press, spent for a later step
    if (!pitches.includes(press.midi)) continue;
    return press.arrivalMs >= sinceMs - PRESS_MATCH_MS ? press.atMs : sinceMs;
  }
  return sinceMs;
}

function median(xs: readonly number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Judges the bar of the last onset, `B`, when the walk leaves it (call it before appending any
 * onset of the next bar). Each note of B's visit is judged by the gap that leads into it against
 * the written gap at the reader's own tempo (the median ratio of real to written gaps within
 * `TEMPO_WINDOW` gaps), so any speed is fine and a steady latency cancels. A hesitation (a gap
 * longer than the rhythm asks by the pause margin), a break of the chain and a jump end a
 * stretch; a gap the red does not wait out (a rest after the note) joins the stretch but is
 * neither judged nor counted in the tempo. A stretch of fewer than `MIN_FIT_ONSETS` onsets judges
 * nothing, a gap with fewer than `MIN_TEMPO_GAPS` timed gaps around it is not judged, and the
 * first gap of a stretch is never rung. A gap that only puts back the one before it is on time.
 */
export function judgeBar(steps: readonly PlanStep[], onsets: readonly Onset[]): Judged[] {
  const n = onsets.length;
  if (n === 0) return [];
  const stepAt = (k: number): PlanStep => steps[onsets[k]!.index]!;
  const bar = stepAt(n - 1).bar;

  // The visit: the longest suffix whose steps are in B with strictly increasing indices.
  let visit = n - 1;
  while (
    visit > 0 &&
    stepAt(visit - 1).bar === bar &&
    onsets[visit - 1]!.index < onsets[visit]!.index
  ) {
    visit--;
  }

  // Links: link k joins onsets k-1 and k (k = 1 .. n-1).
  const real = new Array<number>(n).fill(0); // real ms
  const written = new Array<number>(n).fill(0); // performance seconds
  const base = new Array<boolean>(n).fill(false);
  const timed = new Array<boolean>(n).fill(false);
  const rho = new Array<number>(n).fill(0); // ms per performance second
  const link = new Array<boolean>(n).fill(false);
  for (let k = 1; k < n; k++) {
    const a = onsets[k - 1]!;
    const b = onsets[k]!;
    real[k] = b.ms - a.ms;
    written[k] = stepAt(k).perfSec - stepAt(k - 1).perfSec;
    base[k] =
      a.chain === b.chain && b.index === a.index + 1 && written[k]! > ALONG_EPS && real[k]! > 0;
    // A gap the red does not wait out (a rest after the note): not judged, not in the tempo.
    timed[k] = base[k]! && written[k]! <= stepAt(k - 1).holdSec + ALONG_EPS;
    if (timed[k]) rho[k] = real[k]! / written[k]!;
    link[k] = base[k]!;
  }

  // Pauses, from the timed links only.
  for (let k = 1; k < n; k++) {
    if (!timed[k]) continue;
    let lo = k;
    while (lo - 1 >= 1 && base[lo - 1]) lo--; // the base run holding k
    let hi = k;
    while (hi + 1 <= n - 1 && base[hi + 1]) hi++;
    const near: number[] = [];
    for (let l = Math.max(lo, k - TEMPO_WINDOW); l <= Math.min(hi, k + TEMPO_WINDOW); l++) {
      if (l !== k && timed[l]) near.push(rho[l]!);
    }
    if (near.length === 0) continue;
    const tempo = median(near);
    const expected = tempo * written[k]!;
    const margin = Math.min((PAUSE_RATIO - 1) * expected, PAUSE_BEATS * tempo * stepAt(k).beatSec);
    if (real[k]! - expected > PAUSE_FLOOR_MS + margin) link[k] = false;
  }

  // Segments: maximal stretches of onsets joined by `link`. Judge the visit's onsets per segment.
  const out: Judged[] = [];
  let j = visit;
  while (j <= n - 1) {
    let s = j; // segment start
    while (s > 0 && link[s]) s--;
    let e = j; // segment end (<= n - 1)
    while (e + 1 <= n - 1 && link[e + 1]) e++;
    const firstInVisit = Math.max(visit, s);
    if (e - s + 1 >= MIN_FIT_ONSETS) {
      let prev: { d: number; undone: boolean } | null = null;
      for (let k = s + 1; k <= e; k++) {
        if (!timed[k]) {
          prev = null;
          continue;
        }
        const ratios: number[] = [];
        for (let l = Math.max(s + 1, k - TEMPO_WINDOW); l <= Math.min(e, k + TEMPO_WINDOW); l++) {
          if (timed[l]) ratios.push(rho[l]!);
        }
        if (ratios.length < MIN_TEMPO_GAPS) {
          prev = null;
          continue;
        }
        const tempo = median(ratios); // ms per performance second
        const d = real[k]! - tempo * written[k]!;
        const tolMs = Math.max(
          TOLERANCE_FLOOR_MS,
          TOLERANCE_BEATS * tempo * stepAt(k).beatSec,
          TOLERANCE_GAP * tempo * written[k]!,
        );
        let verdict: Verdict = d < -tolMs ? 'early' : d > tolMs ? 'late' : 'onTime';
        // The undo rule: this gap only puts back the previous one (the note moved, then the
        // pulse resumed), so it is not rung.
        const undone: boolean =
          verdict !== 'onTime' &&
          prev !== null &&
          !prev.undone &&
          Math.sign(prev.d) !== Math.sign(d) &&
          Math.abs(prev.d + d) <= tolMs;
        if (undone) verdict = 'onTime';
        if (k >= Math.max(firstInVisit, s + 2)) {
          out.push({ index: onsets[k]!.index, verdict, offsetMs: d, offsetSec: d / tempo, tolMs });
        }
        prev = { d, undone };
      }
    }
    j = e + 1;
  }
  return out;
}

/**
 * The rings of one judged bar: of its early and late notes the one furthest past its tolerance
 * (`MAX_RINGS_PER_BAR`), with the neighbours in plan order that place the ring on the sheet.
 */
export function marksOf(steps: readonly WalkPlanStep[], judged: readonly Judged[]): TimingMark[] {
  const off = (j: Judged): j is Judged & { verdict: 'early' | 'late' } => j.verdict !== 'onTime';
  const past = (j: Judged): number => Math.abs(j.offsetMs) / j.tolMs;
  return judged
    .filter(off)
    .sort((a, b) => past(b) - past(a) || a.index - b.index)
    .slice(0, MAX_RINGS_PER_BAR)
    .sort((a, b) => a.index - b.index)
    .map((j): TimingMark => {
      const step = steps[j.index]!;
      const before = steps[j.index - 1];
      const after = steps[j.index + 1];
      return {
        ids: step.ids,
        verdict: j.verdict,
        offsetSec: j.offsetSec,
        prev: before ? { ids: before.ids, dSec: step.perfSec - before.perfSec } : null,
        next: after ? { ids: after.ids, dSec: after.perfSec - step.perfSec } : null,
      };
    });
}
