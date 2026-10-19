import { describe, expect, it } from 'vitest';
import { EASED, CEILING, progressAt, secondsLeft } from './progress.js';

describe('the scan bar', () => {
  const expected = 35_000;
  it('starts empty and eases to about 90 percent over the expected time', () => {
    expect(progressAt(0, expected)).toBe(0);
    expect(progressAt(-500, expected)).toBe(0);
    expect(progressAt(expected, expected)).toBeCloseTo(EASED);
    // Ease-out: the first half covers three quarters of the way.
    expect(progressAt(expected / 2, expected)).toBeCloseTo(EASED * 0.75);
  });
  it('only ever moves forward', () => {
    let last = 0;
    for (let ms = 0; ms <= expected * 6; ms += 250) {
      const value = progressAt(ms, expected);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });
  it('creeps on past the expected time and never fills before the answer', () => {
    expect(progressAt(expected * 1.5, expected)).toBeGreaterThan(EASED);
    // Ten times the expected photo time is past the client's 200 s ceiling.
    expect(progressAt(expected * 10, expected)).toBeLessThan(CEILING);
    expect(CEILING).toBeLessThan(1);
  });
  it('says the seconds left in steps of five, and nothing once the expected time is past', () => {
    expect(secondsLeft(0, expected)).toBe(35);
    expect(secondsLeft(1_000, expected)).toBe(35);
    expect(secondsLeft(5_000, expected)).toBe(30);
    expect(secondsLeft(5_001, expected)).toBe(30);
    expect(secondsLeft(33_000, expected)).toBe(5);
    expect(secondsLeft(expected, expected)).toBeNull();
    expect(secondsLeft(-2_000, expected)).toBe(35);
  });
});
