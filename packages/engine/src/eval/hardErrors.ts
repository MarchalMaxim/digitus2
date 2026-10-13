import type { FingerSeq } from './metrics.js';

/**
 * Hard errors (verification spec section 1, goals table): notes where at least two ground truths
 * exist and all of them give the same finger, yet the prediction differs. `rate` is
 * hardErrors / unanimous, 0 when no note is unanimous. A note that any ground truth leaves
 * unassigned is never unanimous.
 */
export function hardErrors(
  pred: FingerSeq,
  golds: FingerSeq[],
): { unanimous: number; hardErrors: number; rate: number } {
  let unanimous = 0;
  let errors = 0;
  if (golds.length >= 2) {
    for (let i = 0; i < pred.length; i++) {
      const first = golds[0]![i];
      if (first === undefined) continue;
      if (!golds.every((g) => g[i] === first)) continue;
      unanimous++;
      if (pred[i] !== first) errors++;
    }
  }
  return { unanimous, hardErrors: errors, rate: unanimous === 0 ? 0 : errors / unanimous };
}
