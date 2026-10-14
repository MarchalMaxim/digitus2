/**
 * Seeded linear congruential generator (the one of the M2 viterbi test: s = s * 1664525 +
 * 1013904223 mod 2^32, Numerical Recipes constants). The trainer draws every shuffle from it, so
 * training with the same seed is reproducible to the byte; nothing in `learn/` calls Math.random.
 */
export class Lcg {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** The next value in [0, 1). */
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 2 ** 32;
  }

  /** An integer in [0, n) for a positive integer n. */
  int(n: number): number {
    if (!Number.isInteger(n) || n <= 0) throw new RangeError(`Lcg.int needs a positive integer`);
    return Math.floor(this.next() * n);
  }

  /** Shuffles `a` in place (Fisher-Yates, from the last element down) and returns it. */
  shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const x = a[i]!;
      a[i] = a[j]!;
      a[j] = x;
    }
    return a;
  }
}
