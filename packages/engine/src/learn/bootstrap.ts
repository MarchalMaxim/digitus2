import { Lcg } from './lcg.js';

export interface PairedBootstrapResult {
  /** mean(a - b) over the pairs. */
  delta: number;
  /** 2.5 and 97.5 percentiles of the resampled means of a - b (linear interpolation). */
  ci95: [number, number];
  /** Number of pairs. */
  n: number;
}

/**
 * Paired bootstrap of the mean difference of two per-piece series (M3 Task 5): `a[i]` and `b[i]`
 * are two systems' scores on the same piece i. Draws `resamples` piece sets of size n with
 * replacement (indices from the seeded `Lcg`, so the result is reproducible to the bit), takes the
 * mean of a - b on each, and returns the percentile interval, as `research/learn/scoring.py`
 * `paired_bootstrap` and the baselines report do (numpy's default linear percentile; numpy draws
 * other indices, so the intervals agree in distribution, not to the digit).
 *
 * The caller pairs the series (by piece id); this function only checks that they have the same
 * length. Defaults: 10000 resamples, seed 1.
 */
export function pairedBootstrap(
  a: readonly number[],
  b: readonly number[],
  opts: { resamples?: number; seed?: number } = {},
): PairedBootstrapResult {
  if (a.length !== b.length)
    throw new Error(`paired series must have equal length (${a.length} vs ${b.length})`);
  const n = a.length;
  if (n === 0) throw new Error('paired bootstrap needs at least one pair');
  const resamples = opts.resamples ?? 10000;
  if (!Number.isInteger(resamples) || resamples < 1)
    throw new Error(`resamples must be a positive integer, got ${resamples}`);
  const d = a.map((x, i) => x - b[i]!);
  if (!d.every(Number.isFinite)) throw new Error('paired bootstrap needs finite values');
  const delta = d.reduce((s, x) => s + x, 0) / n;
  const rng = new Lcg(opts.seed ?? 1);
  const means = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += d[rng.int(n)]!;
    means[r] = s / n;
  }
  means.sort();
  return { delta, ci95: [percentile(means, 2.5), percentile(means, 97.5)], n };
}

/** The q-th percentile (0..100) of sorted values, interpolating linearly (numpy's default). */
function percentile(sorted: Float64Array, q: number): number {
  const pos = (q / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo]! + (pos - lo) * (sorted[hi]! - sorted[lo]!);
}
