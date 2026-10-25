// Pure: the halo of the waiting walk (issue 204). Types and arithmetic only.
import {
  ALONG_EPS,
  stepAfter,
  stepGapSec,
  type AlongStep,
  type PerfRange,
  type StepNotes,
} from './playAlong.js';
import { RED_HEAD_SCALE } from './render/timingMarks.js';

/** A halo shorter than this in real time is not drawn: the pulse carries it. */
export const HALO_MIN_MS = 400;

/** The halo's radius when it appears, in notehead widths (about two and a half staff spaces). */
export const HALO_FROM = 2.1;

/** The radius it closes in on, in notehead widths: just outside the marked notehead. */
export const HALO_TO = RED_HEAD_SCALE / 2 + 0.15;

/** One halo: the step it rings, when it started, how long it lasts. */
export interface Halo {
  /** The cued step's index into the steps: the step after the one passed, in walk order. */
  index: number;
  /** performance.now() ms of the pass that started it. */
  startMs: number;
  /** Its whole length in real ms: the gap at the Practice tempo. */
  ms: number;
  /** The gap in felt beats of the step passed; above 1 (reduced motion steps by it). */
  beats: number;
}

export interface HaloInput {
  steps: readonly AlongStep[];
  /** `alongPlanNotes`' notes, aligned with `steps`; only `beatSec` is read. */
  notes: readonly Pick<StepNotes, 'beatSec'>[];
  /** The last step passed. */
  last: number;
  loop: PerfRange | null;
  /** The tempo factor: real seconds = performance seconds / factor. */
  factor: number;
  /** performance.now() ms of the pass. */
  nowMs: number;
}

/**
 * The halo a pass starts, or null when it shows none: the gap from `last` to the next step in walk
 * order (`stepGapSec`) must be longer than the felt beat at `last` by more than ALONG_EPS, and last
 * at least HALO_MIN_MS at the tempo. Null too for an index outside the steps, the piece's last
 * step, a beat or a factor that is not above 0.
 */
export function haloFor(input: HaloInput): Halo | null {
  const { steps, notes, last, loop, factor, nowMs } = input;
  if (!(factor > 0)) return null;
  const gap = stepGapSec(steps, last, loop);
  if (gap === null) return null;
  const beat = notes[last]?.beatSec;
  if (beat === undefined || !(beat > 0)) return null;
  const ms = (gap * 1000) / factor;
  if (!(gap > beat + ALONG_EPS) || ms < HALO_MIN_MS) return null;
  const index = stepAfter(steps, last, loop);
  if (index < 0) return null;
  return { index, startMs: nowMs, ms, beats: gap / beat };
}

/**
 * How far into its gap the halo is at `nowMs`, 0 to below 1; null from its end on, and for a halo
 * of no length. A clock before the start counts as 0. Under reduced motion it steps a felt beat at a
 * time: floor(f * beats + 1e-9) / beats.
 */
export function haloProgress(halo: Halo, nowMs: number, reduced: boolean): number | null {
  if (!(halo.ms > 0)) return null;
  const f = Math.max(0, (nowMs - halo.startMs) / halo.ms);
  if (f >= 1) return null;
  if (!reduced) return f;
  return Math.floor(f * halo.beats + 1e-9) / halo.beats;
}

/** The radius at `progress` for a notehead `w` wide: linear from HALO_FROM to HALO_TO widths. */
export function haloRadius(w: number, progress: number): number {
  return w * (HALO_FROM + (HALO_TO - HALO_FROM) * progress);
}
