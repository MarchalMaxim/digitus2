import { describe, expect, it } from 'vitest';
import { Lcg } from './lcg.js';

const draw = (r: Lcg, k: number): number[] => Array.from({ length: k }, () => r.next());

describe('Lcg', () => {
  it('is the LCG of the M2 viterbi test (s = s * 1664525 + 1013904223 mod 2^32, next = s / 2^32)', () => {
    expect(new Lcg(1).next()).toBe(((1664525 + 1013904223) >>> 0) / 2 ** 32);
    expect(new Lcg(0).next()).toBe(1013904223 / 2 ** 32);
    let s = 12345;
    const want = Array.from({ length: 5 }, () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    });
    expect(draw(new Lcg(12345), 5)).toEqual(want);
  });
  it('the same seed gives the same sequence, another seed another one', () => {
    expect(draw(new Lcg(42), 100)).toEqual(draw(new Lcg(42), 100));
    expect(draw(new Lcg(42), 100)).not.toEqual(draw(new Lcg(43), 100));
  });
  it('next() stays in [0, 1)', () => {
    const r = new Lcg(7);
    for (const x of draw(r, 10000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
  it('int(n) is an integer in [0, n) and reaches both ends', () => {
    const r = new Lcg(3);
    for (const n of [1, 2, 7, 1000]) {
      const seen = new Set<number>();
      for (let k = 0; k < 5000; k++) {
        const x = r.int(n);
        expect(Number.isInteger(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(n);
        seen.add(x);
      }
      if (n <= 7) expect(seen.size).toBe(n);
      else {
        expect(seen.has(0) || seen.has(1)).toBe(true);
        expect(seen.has(n - 1) || seen.has(n - 2)).toBe(true);
      }
    }
    expect(() => r.int(0)).toThrow(RangeError);
    expect(() => r.int(2.5)).toThrow(RangeError);
  });
  it('shuffle is an in-place permutation and differs between seeds 1 and 2 on 20 elements', () => {
    const base = Array.from({ length: 20 }, (_, k) => k);
    const a = [...base];
    const out = new Lcg(1).shuffle(a);
    expect(out).toBe(a);
    expect([...a].sort((x, y) => x - y)).toEqual(base);
    const b = new Lcg(2).shuffle([...base]);
    expect([...b].sort((x, y) => x - y)).toEqual(base);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(base);
    expect(new Lcg(1).shuffle([...base])).toEqual(a);
    expect(new Lcg(5).shuffle([])).toEqual([]);
    expect(new Lcg(5).shuffle(['x'])).toEqual(['x']);
  });
});
