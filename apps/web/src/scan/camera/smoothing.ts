/**
 * The One Euro filter (Casiez, Roussel and Vogel, CHI 2012,
 * https://gery.casiez.net/1euro/): a low-pass filter whose cutoff rises with speed. Held still,
 * the tracked dots stop trembling with registration noise; moved quickly, they follow with
 * little lag (issue 147). Time is in milliseconds, positions in any one unit.
 */
import type { Point } from './vision.js';

export interface EuroOptions {
  /** Cutoff at rest, in Hz: lower is steadier and slower. */
  minCutoff: number;
  /** How much the cutoff rises per unit of speed (units per second). */
  beta: number;
  /** Cutoff for the speed estimate itself, in Hz. */
  derivativeCutoff: number;
}

/** Tuned for dots in a 360 px tracking frame updated 5 to 15 times a second. */
export const DOT_SMOOTHING: EuroOptions = { minCutoff: 1.2, beta: 0.02, derivativeCutoff: 1 };

const alpha = (cutoff: number, seconds: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / seconds);
};

export class OneEuro {
  private value: number | undefined;
  private speed = 0;
  private time = 0;
  constructor(private readonly options: EuroOptions = DOT_SMOOTHING) {}

  filter(value: number, now: number): number {
    if (this.value === undefined || !(now > this.time)) {
      // The first value, or the same instant again: nothing to smooth against.
      if (this.value === undefined) this.value = value;
      this.time = now;
      return this.value;
    }
    const seconds = (now - this.time) / 1000;
    const { minCutoff, beta, derivativeCutoff } = this.options;
    const speed = (value - this.value) / seconds;
    this.speed += alpha(derivativeCutoff, seconds) * (speed - this.speed);
    const cutoff = minCutoff + beta * Math.abs(this.speed);
    this.value += alpha(cutoff, seconds) * (value - this.value);
    this.time = now;
    return this.value;
  }
}

/** One filter per coordinate of each of a set of points; a different count starts afresh. */
export class PointsFilter {
  private filters: OneEuro[][] = [];
  constructor(private readonly options: EuroOptions = DOT_SMOOTHING) {}

  filter(points: readonly Point[], now: number): Point[] {
    if (this.filters.length !== points.length)
      this.filters = points.map(() => [new OneEuro(this.options), new OneEuro(this.options)]);
    return points.map((point, index) => ({
      x: this.filters[index]![0]!.filter(point.x, now),
      y: this.filters[index]![1]!.filter(point.y, now),
    }));
  }
  reset() {
    this.filters = [];
  }
}
