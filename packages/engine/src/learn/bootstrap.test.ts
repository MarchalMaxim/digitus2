import { describe, expect, it } from 'vitest';
import { pairedBootstrap } from './bootstrap.js';

describe('pairedBootstrap', () => {
  it('is deterministic and centred on the mean difference', () => {
    const a = [70, 65, 80, 60, 75, 68, 72, 66, 74, 69];
    const b = a.map((v, i) => v - (i % 2 ? 1 : 3));
    const r1 = pairedBootstrap(a, b, { seed: 3 });
    const r2 = pairedBootstrap(a, b, { seed: 3 });
    expect(r1).toEqual(r2);
    expect(r1.delta).toBeCloseTo(2, 9);
    expect(r1.ci95[0]).toBeLessThan(2);
    expect(r1.ci95[1]).toBeGreaterThan(2);
    expect(r1.ci95[0]).toBeGreaterThan(1);
    expect(r1.n).toBe(10);
  });
  it('rejects unequal lengths', () => {
    expect(() => pairedBootstrap([1, 2], [1])).toThrow();
  });
  it('pairs by position: equal differences give a zero-width interval, another seed another draw', () => {
    // Every pair differs by exactly 4, so every resample has mean 4 whatever it draws.
    const a = [10, 20, 30, 40, 50];
    const r = pairedBootstrap(
      a,
      a.map((v) => v - 4),
      { resamples: 500 },
    );
    expect(r).toEqual({ delta: 4, ci95: [4, 4], n: 5 });
    const b = a.map((v, i) => v - [0, 5, 1, 9, 2][i]!);
    const s1 = pairedBootstrap(a, b, { seed: 1, resamples: 200 });
    const s2 = pairedBootstrap(a, b, { seed: 2, resamples: 200 });
    expect(s1.delta).toBe(s2.delta);
    expect(s1.ci95).not.toEqual(s2.ci95);
  });
  it('rejects empty series and a resample count that is not a positive integer', () => {
    expect(() => pairedBootstrap([], [])).toThrow();
    expect(() => pairedBootstrap([1], [1], { resamples: 0 })).toThrow();
  });
});
