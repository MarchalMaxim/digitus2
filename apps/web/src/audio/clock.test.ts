import { describe, expect, it } from 'vitest';
import { audibleTime } from './clock.js';

describe('audibleTime', () => {
  it('uses getOutputTimestamp when available and falls back to currentTime', () => {
    const ctx = {
      currentTime: 10.0,
      getOutputTimestamp: () => ({ contextTime: 9.95, performanceTime: 1000 }),
    };
    expect(audibleTime(ctx, 1020)).toBeCloseTo(9.97, 5);
    expect(audibleTime({ currentTime: 10.0 }, 1020)).toBe(10.0);
    expect(audibleTime({ currentTime: 10.0, getOutputTimestamp: () => ({}) }, 1020)).toBe(10.0);
  });
  it("ignores Chromium's zero timestamp before output starts", () => {
    const ctx = {
      currentTime: 0.2,
      getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }),
    };
    // Extrapolated, this would be 5 s (the time since page load), far past what was rendered.
    expect(audibleTime(ctx, 5000)).toBe(0.2);
  });
  it('never runs ahead of currentTime when a stale timestamp is extrapolated', () => {
    const ctx = {
      currentTime: 10.0, // a suspended context: currentTime stopped, the wall clock did not
      getOutputTimestamp: () => ({ contextTime: 9.95, performanceTime: 1000 }),
    };
    expect(audibleTime(ctx, 3000)).toBe(10.0);
  });
});
