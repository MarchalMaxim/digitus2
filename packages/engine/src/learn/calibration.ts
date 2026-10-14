/**
 * Calibrated confidence (M3 Task 6; verification spec 3.8). The solver's per-note confidence is a
 * softmax over the negative min-sum marginal costs of the five fingers at a temperature T
 * (`solveFingering`, `confidenceTemperature` of the weight set). T is fitted by maximum likelihood
 * on held-out notes (the PIG validation pieces) and the fit is judged by the expected calibration
 * error (ECE) of the chosen finger.
 *
 * Correctness is per annotator (soft labels, M3 Task 9): a note's target is the share of its
 * annotators who use each finger, the likelihood is the cross-entropy against that share, and the
 * accuracy of an ECE bucket is the mean share of annotators who use the chosen finger. On a note
 * with one annotator this is "the chosen finger matches the annotator"; unlike "matches at least
 * one annotator" (Task 6), it does not depend on how many annotators a piece has: the PIG
 * validation pieces have 1.2 per piece and the test pieces 5, and the any-annotator temperature
 * fitted on validation (ECE 0.063 learned-open, 0.047 learned-pig) scored 0.243 and 0.197 on test.
 * Pure: no DOM or Node APIs.
 */

import { solveFingering } from '../fingering/solve.js';
import type { SolveOptions } from '../fingering/solve.js';
import type { TrainingPiece } from './data.js';

/**
 * One scored note. `margins[f]` is the marginal cost of finger f + 1 minus the note's smallest one
 * (+Infinity for a finger no complete path can give: `NoteExplanation.gaps`); `chosen` is the
 * index (finger - 1) of the solver's finger; `correct[f]` says finger f + 1 matches at least one
 * annotator; `target[f]` is the share of the note's annotators who use finger f + 1 (the soft
 * label, summing to 1). Without `target` the correct fingers share the note evenly, so a one-hot
 * `correct` is a note with one annotator.
 */
export interface ConfidenceSample {
  margins: number[];
  chosen: number;
  correct: boolean[];
  target?: number[];
}

export interface CalibrationBucket {
  /** Confidence range [lo, hi) of the bucket; the last one includes 1. */
  lo: number;
  hi: number;
  count: number;
  /** Mean confidence of the bucket's notes (0 for an empty bucket). */
  confidence: number;
  /**
   * Mean correctness of the bucket's notes (0 for an empty bucket): for `calibrate`, the mean
   * share of annotators who use the chosen finger.
   */
  accuracy: number;
}

/** The soft label of a sample: `target`, or the correct fingers sharing the note evenly. */
export function targetOf(s: ConfidenceSample): number[] {
  if (s.target) return s.target;
  const k = s.correct.filter(Boolean).length;
  return s.correct.map((c) => (c ? 1 / k : 0));
}

export interface CalibrationReport {
  /** Expected calibration error of the chosen finger's confidence (a fraction, 0..1). */
  ece: number;
  /** The temperature the confidences were computed at. */
  temperature: number;
  /** Notes scored (masked notes are not samples). */
  samples: number;
  /** `negativeLogLikelihood` of the samples at `temperature`. */
  nll: number;
  buckets: CalibrationBucket[];
}

function checkTemperature(t: number): void {
  if (!(t > 0) || !Number.isFinite(t))
    throw new RangeError(`temperature must be a positive finite number, got ${t}`);
}

/** Smallest finite value of `xs`, +Infinity when there is none. */
function finiteMin(xs: readonly number[]): number {
  let min = Infinity;
  for (const x of xs) if (Number.isFinite(x) && x < min) min = x;
  return min;
}

/**
 * log Σ exp(-m / T) over the finite margins, computed from the smallest of them so that large
 * margins do not underflow; -Infinity when no margin is finite.
 */
function logSumExpNeg(margins: readonly number[], t: number): number {
  const min = finiteMin(margins);
  if (min === Infinity) return -Infinity;
  let s = 0;
  for (const m of margins) if (Number.isFinite(m)) s += Math.exp(-(m - min) / t);
  return -min / t + Math.log(s);
}

/**
 * Probability of finger index `f` (finger - 1) under the softmax of the negative margins at
 * temperature `t`: exp(-m_f / T) / Σ exp(-m_g / T) over the finite margins (the solver's formula).
 * 0 for a finger whose margin is not finite, or when no margin is.
 */
export function confidenceOf(margins: number[], f: number, temperature: number): number {
  checkTemperature(temperature);
  const mf = margins[f];
  if (mf === undefined || !Number.isFinite(mf)) return 0;
  const best = finiteMin(margins);
  let z = 0;
  for (const m of margins) if (Number.isFinite(m)) z += Math.exp(-(m - best) / temperature);
  return Math.exp(-(mf - best) / temperature) / z;
}

/**
 * Margins at or above this are broken hard rules, not costs: the solver charges 1000 per broken
 * rule in a soft or held-note decode (`SOFT_PENALTY`, `HELD_PENALTY` in `solve.ts`), while its rule
 * costs stay small (measured on the PIG validation notes, M3 Task 6: no annotator finger has a
 * margin between 50 and 500 under either learned set, and the fitted temperature is the same for
 * any cut from 100 to 500). A softmax gives such a finger less than e^-25 at every temperature of
 * the search range, so no temperature can make it likely.
 */
export const PENALTY_MARGIN = 500;

export interface LikelihoodOptions {
  /**
   * An annotator finger whose margin is at least this is left out of the likelihood (default
   * `PENALTY_MARGIN`; `Infinity` counts every finite margin). Expert fingers that break a
   * solver hard rule (legato overlaps, learning prototype section 7) would otherwise dominate the
   * sum with about 1000 / T nats each and drag the fitted temperature to the top of its range.
   */
  penaltyMargin?: number;
}

/**
 * The cross-entropy of the samples' soft labels against the solver's softmax at temperature `t`:
 * −Σ over the samples of Σ_f target_f × log p_f (log-space, so it stays finite where p
 * underflows), p being the softmax over every finite margin (`confidenceOf`). Per annotator: each
 * annotator of a note is a sample of weight 1 / (annotators of the note). An annotator finger
 * counts only when its margin is finite and below `penaltyMargin`; the other annotators of the
 * note keep their share (an annotator whose finger breaks a hard rule is left out, as a note with
 * one such annotator is). A sample left with no annotator finger is skipped: its likelihood is
 * (about) 0 at every temperature, so it carries no information about T.
 */
export function negativeLogLikelihood(
  samples: ConfidenceSample[],
  temperature: number,
  opts: LikelihoodOptions = {},
): number {
  checkTemperature(temperature);
  const cut = opts.penaltyMargin ?? PENALTY_MARGIN;
  let nll = 0;
  for (const s of samples) {
    const target = targetOf(s);
    let weight = 0;
    let weightedMargin = 0;
    s.margins.forEach((m, f) => {
      const w = target[f] ?? 0;
      if (w > 0 && Number.isFinite(m) && m < cut) {
        weight += w;
        weightedMargin += w * m;
      }
    });
    if (weight === 0) continue;
    // −Σ w_f log p_f = Σ w_f m_f / T + (Σ w_f) log Σ_g exp(−m_g / T)
    nll += weightedMargin / temperature + weight * logSumExpNeg(s.margins, temperature);
  }
  return nll;
}

const GOLDEN = (Math.sqrt(5) - 1) / 2;

/**
 * The temperature that minimises `negativeLogLikelihood` (with `opts.penaltyMargin`): golden-section
 * search on log T over [log lo, log hi] (default [log 0.2, log 20], 60 iterations, which narrows
 * the bracket to about 1e-12 of its width). The result is clamped to [lo, hi]. Deterministic.
 */
export function fitTemperature(
  samples: ConfidenceSample[],
  opts: { lo?: number; hi?: number; iterations?: number } & LikelihoodOptions = {},
): number {
  const lo = opts.lo ?? 0.2;
  const hi = opts.hi ?? 20;
  const iterations = opts.iterations ?? 60;
  checkTemperature(lo);
  checkTemperature(hi);
  if (!(lo < hi)) throw new RangeError(`fitTemperature needs lo < hi, got ${lo} and ${hi}`);
  if (!Number.isInteger(iterations) || iterations < 1)
    throw new RangeError('fitTemperature needs a positive number of iterations');
  const likelihood: LikelihoodOptions =
    opts.penaltyMargin === undefined ? {} : { penaltyMargin: opts.penaltyMargin };
  const f = (x: number): number => negativeLogLikelihood(samples, Math.exp(x), likelihood);
  let a = Math.log(lo);
  let b = Math.log(hi);
  let c = b - GOLDEN * (b - a);
  let d = a + GOLDEN * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let k = 0; k < iterations; k++) {
    if (fc <= fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - GOLDEN * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + GOLDEN * (b - a);
      fd = f(d);
    }
  }
  return Math.min(hi, Math.max(lo, Math.exp((a + b) / 2)));
}

/**
 * Expected calibration error over `bins` equal-width confidence buckets: Σ_b (n_b / N) ×
 * |accuracy_b − confidence_b|, accuracy_b being the mean correctness of the bucket's notes. A
 * note's correctness is a boolean (1 or 0) or a share in [0, 1] (per annotator: the share of
 * annotators who use the chosen finger). A confidence of exactly 1 falls in the last bucket. Every
 * bucket is returned (an empty one with count 0), so reliability diagrams line up across runs.
 */
export function expectedCalibrationError(
  conf: number[],
  correct: ReadonlyArray<boolean | number>,
  bins = 10,
): { ece: number; buckets: CalibrationBucket[] } {
  if (conf.length !== correct.length)
    throw new RangeError(
      `length mismatch: ${conf.length} confidences vs ${correct.length} outcomes`,
    );
  if (!Number.isInteger(bins) || bins < 1)
    throw new RangeError('expectedCalibrationError needs a positive integer number of bins');
  const sumConf = new Array<number>(bins).fill(0);
  const hits = new Array<number>(bins).fill(0);
  const count = new Array<number>(bins).fill(0);
  conf.forEach((c, i) => {
    if (!(c >= 0 && c <= 1)) throw new RangeError(`confidence ${c} outside [0, 1]`);
    const ok = correct[i];
    const hit = typeof ok === 'boolean' ? Number(ok) : ok!;
    if (!(hit >= 0 && hit <= 1)) throw new RangeError(`correct ${String(ok)} outside [0, 1]`);
    const b = Math.min(bins - 1, Math.floor(c * bins));
    sumConf[b]! += c;
    hits[b]! += hit;
    count[b]!++;
  });
  const n = conf.length;
  let ece = 0;
  const buckets: CalibrationBucket[] = [];
  for (let b = 0; b < bins; b++) {
    const k = count[b]!;
    const confidence = k > 0 ? sumConf[b]! / k : 0;
    const accuracy = k > 0 ? hits[b]! / k : 0;
    if (k > 0) ece += (k / n) * Math.abs(accuracy - confidence);
    buckets.push({ lo: b / bins, hi: (b + 1) / bins, count: k, confidence, accuracy });
  }
  return { ece, buckets };
}

/**
 * The calibration sample of one note, from the solver's cost gaps (`NoteExplanation.gaps`, index
 * finger - 1), its finger, and each annotation's finger for the note: `correct` marks every
 * annotator finger, `target` is the share of the annotations that use each finger. Undefined (the
 * note is not scored) when there are no gaps or no finger, or when any annotation leaves the note
 * unfingered (`0` or missing): the same mask as the official metrics (`pigMetrics`), so a
 * partially fingered Mutopia note never counts as wrong.
 */
export function confidenceSample(
  gaps: readonly number[] | undefined,
  chosen: number | undefined,
  golds: ReadonlyArray<number | undefined>,
): ConfidenceSample | undefined {
  if (!gaps || gaps.length !== 5 || chosen === undefined || chosen < 1 || chosen > 5)
    return undefined;
  if (golds.length === 0) return undefined;
  for (const g of golds) if (g === undefined || g < 1 || g > 5) return undefined;
  const fingers = [1, 2, 3, 4, 5];
  return {
    margins: [...gaps],
    chosen: chosen - 1,
    correct: fingers.map((f) => golds.includes(f)),
    target: fingers.map((f) => golds.filter((g) => g === f).length / golds.length),
  };
}

/**
 * Calibration samples of annotated pieces: `solveFingering` with `opts` (the full solve the app
 * runs, chord and held-note loops included) gives each note's cost gaps and finger, and every note
 * all annotations finger is a sample whose target is the annotators' shares (`confidenceSample`).
 * The gaps do not depend on the temperature, so one solve serves every T.
 */
export function confidenceSamples(
  pieces: ReadonlyArray<Pick<TrainingPiece, 'score' | 'annotations'>>,
  opts: SolveOptions = {},
): ConfidenceSample[] {
  const samples: ConfidenceSample[] = [];
  for (const p of pieces) {
    const { assignment, explanations } = solveFingering(p.score, opts);
    for (const n of p.score.notes) {
      const s = confidenceSample(
        explanations[n.id]?.gaps,
        assignment[n.id]?.finger,
        p.annotations.map((a) => a[n.id]?.finger),
      );
      if (s) samples.push(s);
    }
  }
  return samples;
}

/**
 * ECE, reliability buckets and NLL of the chosen fingers' confidences at `temperature`, per
 * annotator: a chosen finger is as correct as the share of the note's annotators who use it
 * (`targetOf`), so a bucket's accuracy is the mean annotator agreement of its chosen fingers.
 */
export function calibrate(
  samples: ConfidenceSample[],
  temperature: number,
  bins = 10,
): CalibrationReport {
  const conf = samples.map((s) => confidenceOf(s.margins, s.chosen, temperature));
  const { ece, buckets } = expectedCalibrationError(
    conf,
    samples.map((s) => targetOf(s)[s.chosen] ?? 0),
    bins,
  );
  return {
    ece,
    temperature,
    samples: samples.length,
    nll: negativeLogLikelihood(samples, temperature),
    buckets,
  };
}
