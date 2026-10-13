import { describe, expect, it } from 'vitest';
import { decode } from './viterbi.js';
import type { DecodeProblem } from './viterbi.js';

// Deterministic pseudo-random costs (LCG) so the brute-force comparison is reproducible.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Costs are integers in 0..scale. The planned tests use scale 10; scale 2 makes tied optima common.
function randomProblem(n: number, seed: number, infRate = 0, scale = 10): DecodeProblem {
  const rnd = lcg(seed);
  const u = Array.from({ length: n }, () =>
    Array.from({ length: 5 }, () => (rnd() < infRate ? Infinity : Math.round(rnd() * scale))),
  );
  const p = Array.from({ length: n }, () =>
    Array.from({ length: 25 }, () => Math.round(rnd() * scale)),
  );
  const t = Array.from({ length: n }, () =>
    Array.from({ length: 125 }, () => Math.round(rnd() * scale)),
  );
  return {
    n,
    unary: (i, f) => u[i]![f]!,
    pair: (i, g, f) => p[i]![g * 5 + f]!,
    triple: (i, h, g, f) => t[i]![h * 25 + g * 5 + f]!,
  };
}

// Enumerates paths in lexicographic order and keeps the first strict improvement, so among tied
// optima it returns the lexicographically smallest path (lowest finger on the earliest note).
function bruteForce(p: DecodeProblem): {
  cost: number;
  fingers: number[];
  marginals: number[][];
  optima: number;
} {
  const n = p.n;
  const marginals = Array.from({ length: n }, () => Array.from({ length: 5 }, () => Infinity));
  let best = Infinity;
  let bestPath: number[] = [];
  let optima = 0;
  const path: number[] = [];
  const walk = (i: number, acc: number): void => {
    if (i === n) {
      for (let k = 0; k < n; k++) marginals[k]![path[k]!] = Math.min(marginals[k]![path[k]!]!, acc);
      if (acc < best) {
        best = acc;
        bestPath = [...path];
        optima = 1;
      } else if (acc === best) {
        optima++;
      }
      return;
    }
    for (let f = 0; f < 5; f++) {
      let c = p.unary(i, f);
      if (i >= 1) c += p.pair(i, path[i - 1]!, f);
      if (i >= 2) c += p.triple(i, path[i - 2]!, path[i - 1]!, f);
      path.push(f);
      walk(i + 1, acc + c);
      path.pop();
    }
  };
  walk(0, 0);
  return { cost: best, fingers: bestPath, marginals, optima };
}

describe('decode', () => {
  it('matches brute force on random problems, including marginals', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const p = randomProblem(6, seed);
      const d = decode(p);
      const b = bruteForce(p);
      expect(d.cost).toBe(b.cost);
      expect(d.fingers).toEqual(b.fingers);
      expect(d.marginals).toEqual(b.marginals);
    }
  });
  it('respects infinite unary costs and reports an infinite cost when nothing is feasible', () => {
    const p = randomProblem(5, 7, 0.3);
    const d = decode(p);
    const b = bruteForce(p);
    expect(d.cost).toBe(b.cost);
    if (Number.isFinite(b.cost)) expect(d.fingers).toEqual(b.fingers);
    const none: DecodeProblem = {
      n: 3,
      unary: (i, f) => (i === 1 ? Infinity : f),
      pair: () => 0,
      triple: () => 0,
    };
    const r = decode(none);
    expect(r.cost).toBe(Infinity);
    expect(r.fingers).toHaveLength(3);
  });
  it('handles n = 0, 1 and 2', () => {
    expect(decode({ n: 0, unary: () => 0, pair: () => 0, triple: () => 0 })).toEqual({
      fingers: [],
      cost: 0,
      marginals: [],
    });
    const one = decode({
      n: 1,
      unary: (_i, f) => [3, 1, 2, 5, 4][f]!,
      pair: () => 0,
      triple: () => 0,
    });
    expect(one.fingers).toEqual([1]);
    expect(one.cost).toBe(1);
    expect(one.marginals).toEqual([[3, 1, 2, 5, 4]]);
    const two = decode({
      n: 2,
      unary: () => 0,
      pair: (_i, g, f) => (g === 2 && f === 4 ? 0 : 1),
      triple: () => 0,
    });
    expect(two.fingers).toEqual([2, 4]);
    expect(two.cost).toBe(0);
  });
  it('breaks ties by the lowest finger index', () => {
    const r = decode({ n: 3, unary: () => 0, pair: () => 0, triple: () => 0 });
    expect(r.fingers).toEqual([0, 0, 0]);
  });
  it('gives a tie to the lowest finger on the earliest note', () => {
    // Exactly two optimal paths, 0 1 0 and 1 0 0 (cost 0); every other path costs at least 1.
    // A back-trace from the lowest final state (0, 0) would return 1 0 0.
    const r = decode({
      n: 3,
      unary: () => 0,
      pair: () => 0,
      triple: (_i, h, g, f) =>
        (h === 0 && g === 1 && f === 0) || (h === 1 && g === 0 && f === 0) ? 0 : 1,
    });
    expect(r.fingers).toEqual([0, 1, 0]);
    expect(r.cost).toBe(0);
  });
  it('matches brute force on tie-heavy problems, path included', () => {
    // Costs in 0..2 make tied optima the norm, so the path comparison pins the tie-break rule
    // instead of relying on a unique optimum.
    let tiedOptima = 0;
    for (let seed = 1; seed <= 60; seed++) {
      for (const infRate of [0, 0.25]) {
        const p = randomProblem(5, seed, infRate, 2);
        const d = decode(p);
        const b = bruteForce(p);
        expect(d.cost).toBe(b.cost);
        expect(d.marginals).toEqual(b.marginals);
        expect(d.fingers).toHaveLength(5);
        for (const f of d.fingers) expect([0, 1, 2, 3, 4]).toContain(f);
        if (Number.isFinite(b.cost)) expect(d.fingers).toEqual(b.fingers);
        if (Number.isFinite(b.cost) && b.optima > 1) tiedOptima++;
      }
    }
    expect(tiedOptima).toBeGreaterThan(60);
  });
  it('is fast: 2000 notes in well under 500 ms', () => {
    const p = randomProblem(2000, 11);
    const t0 = performance.now();
    decode(p);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
