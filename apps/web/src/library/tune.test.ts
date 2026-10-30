import { describe, expect, it } from 'vitest';
import { PITCHES, tuneFor } from './tune.js';

describe('the tune of a deal (issue 228)', () => {
  it('starts on the rising and falling figure of the first deal', () => {
    expect(tuneFor(0)).toEqual([17, 15, 13, 15]);
  });
  it('is the same tune for the same deal', () => {
    for (const deal of [1, 2, 7, 40]) expect(tuneFor(deal)).toEqual(tuneFor(deal));
  });
  it('differs from the tune before it, for a long run of presses', () => {
    for (let deal = 1; deal <= 200; deal++)
      expect(tuneFor(deal), `deal ${deal}`).not.toEqual(tuneFor(deal - 1));
  });
  it('stays on the staff, four notes, lines and spaces only', () => {
    for (let deal = 0; deal <= 200; deal++) {
      const tune = tuneFor(deal);
      expect(tune).toHaveLength(4);
      for (const y of tune) expect(PITCHES).toContain(y);
    }
    expect(PITCHES).toEqual([5, 7, 9, 11, 13, 15, 17, 19, 21]);
  });
  it('moves by steps of up to three places, a singable contour', () => {
    for (let deal = 1; deal <= 200; deal++) {
      const at = tuneFor(deal).map((y) => PITCHES.indexOf(y));
      expect(at[0]).toBeGreaterThanOrEqual(2);
      expect(at[0]).toBeLessThanOrEqual(6);
      for (let i = 1; i < at.length; i++)
        expect(Math.abs(at[i]! - at[i - 1]!)).toBeLessThanOrEqual(3);
    }
  });
});
