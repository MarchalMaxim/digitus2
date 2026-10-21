import type { Score } from '@digitus2/engine';
import { measureEndSec, measureStartSec } from './beats.js';

/** Whole-bar loop bounds in score seconds; null for a missing, reversed or empty range. */
export function loopSeconds(
  score: Score,
  loop: { from: number; to: number } | null,
): { from: number; to: number } | null {
  if (!loop || score.measures.length === 0) return null;
  const last = score.measures.length - 1;
  const a = Math.min(Math.max(0, Math.trunc(loop.from)), last);
  const b = Math.min(Math.max(0, Math.trunc(loop.to)), last);
  if (a > b) return null;
  const from = measureStartSec(score, a);
  const to = measureEndSec(score, b);
  return to > from ? { from, to } : null;
}
