import { describe, expect, it } from 'vitest';
import { OneEuro, PointsFilter } from './smoothing.js';

/** A repeatable tremble of about ±3 px, as registration noise on a still phone. */
const tremble = (index: number) => 3 * Math.sin(index * 2.3) * Math.cos(index * 0.7);

describe('issue 147: One Euro smoothing of the tracked dots', () => {
  it('stills the tremble of a phone held still', () => {
    const filter = new OneEuro();
    const raw: number[] = [];
    const smooth: number[] = [];
    for (let index = 0; index < 60; index++) {
      const value = 100 + tremble(index);
      raw.push(value);
      smooth.push(filter.filter(value, index * 100));
    }
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(spread(smooth.slice(20))).toBeLessThan(spread(raw.slice(20)) * 0.4);
  });
  it('follows a quick move with little lag', () => {
    const filter = new OneEuro();
    let value = 0;
    // 100 ms updates, the dot moving 300 px a second for a second.
    for (let index = 0; index <= 10; index++) value = filter.filter(index * 30, index * 100);
    expect(300 - value).toBeLessThan(45);
  });
  it('ignores a repeated instant and starts afresh for a different set of points', () => {
    const filter = new PointsFilter();
    expect(filter.filter([{ x: 10, y: 20 }], 0)).toEqual([{ x: 10, y: 20 }]);
    expect(filter.filter([{ x: 50, y: 60 }], 0)).toEqual([{ x: 10, y: 20 }]);
    const two = filter.filter(
      [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      100,
    );
    expect(two).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });
});
