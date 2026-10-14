import { pairTerms, tripleTerms, unaryTerms } from '../fingering/rules.js';
import type { RuleContext, RuleId, RuleWeights, Term } from '../fingering/rules.js';
import type { HandSequence } from '../fingering/sequence.js';
import { templateBonus } from '../fingering/solve.js';
import type { TemplateMatch } from '../fingering/templates.js';
import type { Finger } from '../score/types.js';

/**
 * Points per rule summed along one hand's fingering path: Φ in `cost = w · Φ`. Keys are the
 * rule ids of the context's weights (`featureIds`), in sorted order.
 */
export type FeatureVector = Record<RuleId, number>;

/** The rule ids of the context's weight set, sorted by code unit (Array.prototype.sort). */
export function featureIds(ctx: RuleContext): RuleId[] {
  return (Object.keys(ctx.weights) as RuleId[]).sort();
}

/** A vector with every feature id of the context at 0, keys in `featureIds` order. */
export function zeroVector(ctx: RuleContext): FeatureVector {
  const v = {} as FeatureVector;
  for (const id of featureIds(ctx)) v[id] = 0;
  return v;
}

/**
 * The feature vector of fingering `fingers` (one finger per note of `seq`), counted exactly as
 * `solveHand` charges that path, so that `dot(ctx.weights, pathFeatures(...))` is the decoded cost
 * of a path that pays no penalty:
 *
 * - every note: `unaryTerms` with its sequence neighbours, plus the template term (`-points`,
 *   `templateBonus`) when the note takes the finger of the template match covering it; pass the
 *   same `templates` the decode got (`solveFingering` uses `matchTemplates` unless templates are
 *   off; `solveHand` defaults to none);
 * - every consecutive pair (i - 1, i), inside a slice or across slices: `pairTerms`;
 * - every consecutive triple (i - 2, i - 1, i): `tripleTerms`, except one finger on two notes two
 *   apart in a slice of at most five notes, where the solver charges the chord-order penalty alone
 *   (+Infinity in a hard decode, SOFT_PENALTY in a soft one) and no terms.
 *
 * Penalties are not weighted terms and are left out: pins, forbidden and kept fingers, the
 * held-note law (whose HELD_PENALTY the solver adds on top of the pair or triple terms), the chord
 * order and the chord law. A path that pays any of them costs `w · Φ` plus those penalties.
 */
export function pathFeatures(
  seq: HandSequence,
  ctx: RuleContext,
  fingers: readonly Finger[],
  templates: TemplateMatch[] = [],
): FeatureVector {
  const v = seq.notes;
  if (fingers.length !== v.length)
    throw new Error(`pathFeatures: ${fingers.length} fingers for ${v.length} notes`);
  const phi = zeroVector(ctx);
  const add = (terms: Term[]): void => {
    // A rule missing from the weights still gets its own key, so dot() reports it.
    for (const t of terms) phi[t.rule] = (phi[t.rule] ?? 0) + t.points;
  };
  const sliceSize = new Map<number, number>();
  for (const n of v) sliceSize.set(n.slice, (sliceSize.get(n.slice) ?? 0) + 1);
  const bonus = templateBonus(seq, ctx, templates);
  for (let i = 0; i < v.length; i++) {
    const n = v[i]!;
    const f = fingers[i]!;
    add(unaryTerms(ctx, n, f, v[i - 1], v[i + 1]));
    const tb = bonus[i];
    if (tb?.finger === f) add([{ rule: 'template', points: -tb.points }]);
    if (i >= 1) add(pairTerms(ctx, v[i - 1]!, fingers[i - 1]!, n, f));
    if (i >= 2) {
      const a = v[i - 2]!;
      const h = fingers[i - 2]!;
      if (a.slice === n.slice && h === f && sliceSize.get(n.slice)! <= 5) continue;
      add(tripleTerms(ctx, a, h, v[i - 1]!, fingers[i - 1]!, n, f));
    }
  }
  return phi;
}

/**
 * `Σ weights[id] × phi[id]` over the vector's ids. A nonzero feature without a weight throws: a
 * feature id the weight set does not name would otherwise be silently ignored.
 */
export function dot(weights: RuleWeights, phi: FeatureVector): number {
  let s = 0;
  for (const id of Object.keys(phi) as RuleId[]) {
    const x = phi[id];
    if (x === 0) continue;
    const w: number | undefined = weights[id];
    if (w === undefined) throw new Error(`dot: feature ${id} has no weight`);
    s += w * x;
  }
  return s;
}

/** `into += scale × v`, in place, over the ids of `v`. */
export function addScaled(into: FeatureVector, v: FeatureVector, scale: number): void {
  for (const id of Object.keys(v) as RuleId[]) {
    const cur: number | undefined = into[id];
    into[id] = (cur ?? 0) + scale * v[id];
  }
}

/** `a - b` over the ids of both (an id missing from one counts as 0 there). */
export function subtract(a: FeatureVector, b: FeatureVector): FeatureVector {
  const out = { ...a };
  for (const id of Object.keys(b) as RuleId[]) {
    const cur: number | undefined = out[id];
    out[id] = (cur ?? 0) - b[id];
  }
  return out;
}

/** `Σ v[id]²`. */
export function squaredNorm(v: FeatureVector): number {
  let s = 0;
  for (const id of Object.keys(v) as RuleId[]) s += v[id] * v[id];
  return s;
}
