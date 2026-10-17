import { pigMetrics } from '../eval/metrics.js';
import { isPenaltyRule, makeContext, RULE_IDS } from '../fingering/rules.js';
import type { ContextSettings, RuleContext, RuleId, RuleWeights } from '../fingering/rules.js';
import type { HandSequence } from '../fingering/sequence.js';
import { solveHand } from '../fingering/solve.js';
import type { HandConstraints } from '../fingering/solve.js';
import type { HandProfile } from '../fingering/spans.js';
import { detectRuns, matchTemplates, TEXTBOOK_TEMPLATES } from '../fingering/templates.js';
import type { TemplateMatch } from '../fingering/templates.js';
import type { Finger } from '../score/types.js';
import type { GoldFinger, HandExample } from './data.js';
import { dot, featureIds, pathFeatures, subtract } from './features.js';
import type { FeatureVector } from './features.js';
import { Lcg } from './lcg.js';

/**
 * The M3 trainer: an averaged passive-aggressive (PA-I) structured perceptron over the solver's own
 * cost, `cost(path) = w · Φ(path)` (`pathFeatures`), with Hamming loss-augmented decoding through
 * `solveHand` (its `unaryExtra` hook) and latent targets for pieces with several annotators or with
 * unfingered notes. Settings and corrections: `docs/research/learning-prototype.md`, section 6
 * (settings adopted by the engine).
 */

export interface TrainOptions {
  /** Spans used during training (large for PIG). */
  profile: HandProfile;
  /** Starting point, usually PARNCUTT_WEIGHTS; ids it leaves out start at the Parncutt value. */
  init: Partial<RuleWeights>;
  /** Passes over the examples (default 12). */
  epochs?: number;
  /** PA-I aggressiveness cap (default 0.2, the prototype's sweep). */
  C?: number;
  /** Hamming loss per wrongly fingered note, and the augmentation's bonus per wrong finger (default 1). */
  rho?: number;
  /** Seed of the per-epoch shuffle (`Lcg`). */
  seed: number;
  /** When given, the epoch whose averaged weights score the best validation `gen` wins. */
  validation?: HandExample[];
  /** Penalty rules (`isPenaltyRule`) clamped at >= 0 after every update (default true). */
  projectPenalties?: boolean;
  /**
   * Ids whose weight stays at its initial value: the update leaves them out (their component of
   * Φ(y+) − Φ(ŷ) is dropped from the step and its norm, not from the loss). Task 4 freezes
   * `template` at the Parncutt value (learning-prototype.md section 6).
   */
  frozen?: RuleId[];
  /**
   * Hold tolerance of the held-note law in every decode (`RuleContext.holdEpsSec`, default 1 ms;
   * M3 Task 7 H1 tried 50 ms and did not keep it).
   */
  holdEpsSec?: number;
  onEpoch?: (info: EpochInfo) => void;
}

export interface EpochInfo {
  epoch: number;
  /** Examples whose margin loss was positive, so the weights moved. */
  updates: number;
  /** Examples left out because they are malformed or their decode threw (never thrown on). */
  skipped: number;
  /**
   * Examples whose target path breaks a hard rule of the solver (it pays a chord or held-note
   * penalty in the pinned soft decode). They are trained on anyway (learning-prototype.md section 6).
   */
  infeasibleTargets: number;
  /** Mean margin loss over the updates (0 without updates). */
  meanLoss: number;
  /** Share of the fingered target notes the most violating path fingers otherwise. */
  hammingRate: number;
  /** `gen` of the averaged weights on the training examples. */
  trainAccuracy: number;
  /** `gen` of the averaged weights on the validation examples, null without them. */
  validationAccuracy: number | null;
  /** The running average of the weights after this epoch, rounded to 6 decimals. */
  averagedWeights: RuleWeights;
}

export interface TrainResult {
  /** The averaged weights of the best epoch (`bestEpoch`), rounded to 6 decimals, keys sorted. */
  weights: RuleWeights;
  /** 1-based; the best validation epoch, or the last one without validation (0 with no epoch). */
  bestEpoch: number;
  epochs: EpochInfo[];
  features: RuleId[];
}

export interface ExampleEvaluation {
  /** Official M_gen: per note, the mean over the annotations of a match, averaged over notes. */
  gen: number;
  /** Share of notes whose finger matches at least one annotation. */
  soft: number;
  /** Notes scored: notes every annotation fingers (unfingered gold is masked, as in `pigMetrics`). */
  notes: number;
}

const DEFAULTS = { epochs: 12, C: 0.2, rho: 1, projectPenalties: true } as const;
/** A target whose decoded cost exceeds w · Φ by this much pays a penalty (the solver's are 1000). */
const PENALTY_PAID = 500;
/** Loss below this is floating-point noise around 0 (identical paths). */
const LOSS_EPS = 1e-12;

/** The textbook template matches `solveFingering` gives this hand (its default). */
function templatesFor(seq: HandSequence): TemplateMatch[] {
  return matchTemplates(seq, detectRuns(seq), TEXTBOOK_TEMPLATES[seq.hand]);
}

/**
 * The decode `solveFingering` starts from: a hard decode with the hand's templates, and a soft one
 * when no finite path exists.
 */
function decodeHand(
  seq: HandSequence,
  ctx: RuleContext,
  templates: TemplateMatch[],
  extra?: (i: number, f: Finger) => number,
): { fingers: Finger[]; cost: number } {
  const c: HandConstraints = { pinned: new Map(), forbidden: new Map(), soft: false };
  if (extra) c.unaryExtra = extra;
  let r = solveHand(seq, ctx, c, templates);
  if (!Number.isFinite(r.cost)) r = solveHand(seq, ctx, { ...c, soft: true }, templates);
  return r;
}

/** Throws unless every annotation has one gold finger (or 0) per note of the sequence. */
function checkExample(ex: HandExample): void {
  const n = ex.seq.notes.length;
  if (ex.golds.length === 0) throw new Error(`${ex.id}: no annotation`);
  if (!Number.isFinite(ex.weight) || ex.weight < 0)
    throw new Error(`${ex.id}: sample weight ${String(ex.weight)}`);
  for (const g of ex.golds) {
    if (g.length !== n) throw new Error(`${ex.id}: ${g.length} gold fingers for ${n} notes`);
    for (const f of g)
      if (!(f === 0 || f === 1 || f === 2 || f === 3 || f === 4 || f === 5))
        throw new Error(`${ex.id}: gold finger ${String(f)}`);
  }
}

/** Fingered notes of `gold` on which `fingers` agrees with it. */
function agreement(fingers: readonly Finger[], gold: readonly GoldFinger[]): number {
  let a = 0;
  for (let i = 0; i < gold.length; i++) if (gold[i] !== 0 && fingers[i] === gold[i]) a++;
  return a;
}

/** Sums of the per-example metrics before they are pooled (`gen` and `soft` times `notes`). */
interface Tally {
  gen: number;
  soft: number;
  notes: number;
}

function evaluateWith(
  examples: HandExample[],
  ctx: RuleContext,
  templates: (ex: HandExample, k: number) => TemplateMatch[],
  tolerant: boolean,
): ExampleEvaluation {
  const t: Tally = { gen: 0, soft: 0, notes: 0 };
  examples.forEach((ex, k) => {
    try {
      checkExample(ex);
      const pred = decodeHand(ex.seq, ctx, templates(ex, k)).fingers;
      const m = pigMetrics(pred, ex.golds);
      t.gen += m.gen * m.notes;
      t.soft += m.soft * m.notes;
      t.notes += m.notes;
    } catch (e) {
      if (!tolerant) throw e;
    }
  });
  return t.notes === 0
    ? { gen: 0, soft: 0, notes: 0 }
    : { gen: t.gen / t.notes, soft: t.soft / t.notes, notes: t.notes };
}

/**
 * Decodes each example as `solveFingering` starts to (`solveHand` with the hand's textbook
 * templates and no constraints, a soft decode when the hard one has no finite path) and scores the
 * fingers against its annotations with the official metrics (`pigMetrics`): `gen` and `soft`
 * pooled over the examples, weighted by their scored notes. A note some annotation leaves
 * unfingered is masked out, as in the bench. Throws on a malformed example.
 */
export function evaluateExamples(
  examples: HandExample[],
  weights: Partial<RuleWeights>,
  profile: HandProfile,
  settings: ContextSettings = {},
): ExampleEvaluation {
  const ctx = makeContext(profile, weights, settings);
  return evaluateWith(examples, ctx, (ex) => templatesFor(ex.seq), false);
}

/** `Math.round` to 6 decimals, with -0 turned into 0. */
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6 + 0;

/**
 * Trains the weights on hand examples. Per epoch, over the examples in a seeded shuffled order,
 * with `w` the current weights:
 *
 * 1. Target annotation k*: the one whose fingered notes agree most with the current plain decode
 *    (ties: the lowest k; with one annotation, that one).
 * 2. Target path y+: the gold of k* where it fingers a note and the model's best fingers elsewhere
 *    (a decode with every fingered note pinned, `soft` so an impossible pin still yields a path).
 *    A target that breaks a hard rule is kept (`infeasibleTargets`; learning-prototype.md section 6).
 * 3. Most violating path ŷ: the hard decode with `-rho` on every wrong finger of a fingered note
 *    (`unaryExtra`; an unfingered note gets nothing).
 * 4. `loss = w · Φ(y+) − w · Φ(ŷ) + rho × hamming`, hamming over the fingered notes only.
 * 5. When `loss > 0`: `d = Φ(y+) − Φ(ŷ)` without the frozen ids, `τ = min(C, loss / |d|²) ×
 *    weight`, `w ← w − τ d`, then penalty rules clamped at 0 when `projectPenalties`.
 * 6. The running sum of `w` after every example gives the averaged weights.
 *
 * Every decode passes the hand's textbook template matches, as `solveFingering` does, and Φ counts
 * the template term the same way (`pathFeatures`), so `w · Φ` is the cost the decoder minimises.
 * After each epoch the averaged weights (rounded to 6 decimals) are scored with `evaluateExamples`
 * on the training and validation examples; the result is the best validation epoch's averaged
 * weights, or the last epoch's without validation. Deterministic: the only randomness is `Lcg`.
 */
export function train(examples: HandExample[], opts: TrainOptions): TrainResult {
  const epochs = opts.epochs ?? DEFAULTS.epochs;
  const C = opts.C ?? DEFAULTS.C;
  const rho = opts.rho ?? DEFAULTS.rho;
  const project = opts.projectPenalties ?? DEFAULTS.projectPenalties;
  // ctx.weights is the current weight vector w, updated in place (makeContext copies `init` and
  // derives nothing from it, so the decoder reads the new weights on its next call).
  const settings: ContextSettings =
    opts.holdEpsSec !== undefined ? { holdEpsSec: opts.holdEpsSec } : {};
  const ctx = makeContext(opts.profile, opts.init, settings);
  const w = ctx.weights;
  const ids = featureIds(ctx);
  const frozen = new Set<RuleId>(opts.frozen ?? []);
  const learned = ids.filter((id) => !frozen.has(id));
  const penalties = learned.filter((id) => isPenaltyRule(id));

  const valid = examples.map((ex) => {
    try {
      checkExample(ex);
      return true;
    } catch {
      return false;
    }
  });
  const templates = examples.map((ex, k) => (valid[k] ? templatesFor(ex.seq) : []));
  const validation = opts.validation ?? [];
  const validationTemplates = validation.map((ex) => templatesFor(ex.seq));
  // A fully fingered target is its gold whatever the weights: decode it once (to learn whether it
  // pays a penalty) and keep it, by example and annotation.
  const fixedTargets = new Map<string, { fingers: Finger[]; infeasible: boolean }>();

  const wSum = Object.fromEntries(ids.map((id) => [id, 0])) as RuleWeights;
  let steps = 0;
  const averaged = (): RuleWeights => {
    const out = {} as RuleWeights;
    for (const id of ids) out[id] = round6(steps === 0 ? w[id] : wSum[id] / steps);
    return out;
  };

  const rng = new Lcg(opts.seed);
  const order = examples.map((_, k) => k);
  const infos: EpochInfo[] = [];
  let best: { epoch: number; score: number; weights: RuleWeights } | undefined;

  for (let epoch = 1; epoch <= epochs; epoch++) {
    rng.shuffle(order);
    let updates = 0;
    let skipped = 0;
    let infeasibleTargets = 0;
    let lossSum = 0;
    let hammingSum = 0;
    let fingeredSum = 0;
    for (const k of order) {
      const ex = examples[k]!;
      if (!valid[k]) {
        skipped++;
        continue;
      }
      try {
        const seq = ex.seq;
        const tm = templates[k]!;
        const n = seq.notes.length;
        // 1. The target annotation.
        let kStar = 0;
        if (ex.golds.length > 1) {
          const plain = decodeHand(seq, ctx, tm).fingers;
          let bestAgreement = -1;
          ex.golds.forEach((g, a) => {
            const agree = agreement(plain, g);
            if (agree > bestAgreement) {
              bestAgreement = agree;
              kStar = a;
            }
          });
        }
        const gold = ex.golds[kStar]!;
        let fingered = 0;
        for (const f of gold) if (f !== 0) fingered++;
        if (fingered > 0) {
          // 2. The target path.
          let yPlus: Finger[];
          let infeasible: boolean;
          const cached = fixedTargets.get(`${k}:${kStar}`);
          if (cached) {
            ({ fingers: yPlus, infeasible } = cached);
          } else {
            const pinned = new Map<number, Finger>();
            gold.forEach((f, i) => {
              if (f !== 0) pinned.set(i, f);
            });
            const t = solveHand(seq, ctx, { pinned, forbidden: new Map(), soft: true }, tm);
            yPlus = t.fingers;
            infeasible = t.cost - dot(w, pathFeatures(seq, ctx, yPlus, tm)) > PENALTY_PAID;
            if (fingered === n) fixedTargets.set(`${k}:${kStar}`, { fingers: yPlus, infeasible });
          }
          if (infeasible) infeasibleTargets++;
          // 3. The most violating path.
          const extra =
            rho !== 0
              ? (i: number, f: Finger): number => (gold[i] !== 0 && f !== gold[i] ? -rho : 0)
              : undefined;
          const yHat = decodeHand(seq, ctx, tm, extra).fingers;
          let hamming = 0;
          for (let i = 0; i < n; i++) if (gold[i] !== 0 && yHat[i] !== gold[i]) hamming++;
          hammingSum += hamming;
          fingeredSum += fingered;
          // 4. The margin loss and 5. the update.
          const d: FeatureVector = subtract(
            pathFeatures(seq, ctx, yPlus, tm),
            pathFeatures(seq, ctx, yHat, tm),
          );
          const loss = dot(w, d) + rho * hamming;
          if (loss > LOSS_EPS) {
            let norm = 0;
            for (const id of learned) norm += d[id] * d[id];
            if (norm > 0) {
              const tau = Math.min(C, loss / norm) * ex.weight;
              for (const id of learned) w[id] -= tau * d[id];
              if (project) for (const id of penalties) if (w[id] < 0) w[id] = 0;
              updates++;
              lossSum += loss;
            }
          }
        }
      } catch {
        // Nothing above writes w before the update, which cannot throw, so w is unchanged.
        skipped++;
        continue;
      }
      // 6. Averaging: the weights after every example trained on.
      for (const id of ids) wSum[id] += w[id];
      steps++;
    }
    const avg = averaged();
    const avgCtx = makeContext(opts.profile, avg, settings);
    const trainAccuracy = evaluateWith(examples, avgCtx, (_, k) => templates[k]!, true).gen;
    const validationAccuracy =
      validation.length > 0
        ? evaluateWith(validation, avgCtx, (_, k) => validationTemplates[k]!, true).gen
        : null;
    const info: EpochInfo = {
      epoch,
      updates,
      skipped,
      infeasibleTargets,
      meanLoss: updates > 0 ? lossSum / updates : 0,
      hammingRate: fingeredSum > 0 ? hammingSum / fingeredSum : 0,
      trainAccuracy,
      validationAccuracy,
      averagedWeights: avg,
    };
    infos.push(info);
    opts.onEpoch?.(info);
    const score = validationAccuracy ?? epoch;
    if (best === undefined || score > best.score) best = { epoch, score, weights: avg };
  }
  return {
    weights: best?.weights ?? averaged(),
    bestEpoch: best?.epoch ?? 0,
    epochs: infos,
    features: [...RULE_IDS],
  };
}
