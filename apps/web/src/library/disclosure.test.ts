import { describe, expect, it } from 'vitest';
import {
  HEADINGS_ABOVE,
  LENGTH_ABOVE,
  OTHER_BELOW,
  PAGE_SIZE,
  PILLS_ABOVE,
  SAMPLES,
  SEARCH_FROM,
  SECTION_ROWS,
  showsHeadings,
  showsLengths,
  showsPills,
  showsSearch,
} from './disclosure.js';

describe('the disclosure thresholds (spec 6.1, shelves spec 2 to 4)', () => {
  it('has the numbers the specs give', () => {
    expect([
      PILLS_ABOVE,
      SEARCH_FROM,
      HEADINGS_ABOVE,
      OTHER_BELOW,
      SAMPLES,
      PAGE_SIZE,
      SECTION_ROWS,
      LENGTH_ABOVE,
    ]).toEqual([40, 100, 12, 3, 5, 40, 7, 40]);
  });
  it('shows the level pills above 40 pieces', () => {
    expect(showsPills(40)).toBe(false);
    expect(showsPills(41)).toBe(true);
  });
  it('shows the search field from 100 pieces', () => {
    expect(showsSearch(99)).toBe(false);
    expect(showsSearch(100)).toBe(true);
  });
  it('groups a list section under collection headings above 12 pieces', () => {
    expect(showsHeadings(12)).toBe(false);
    expect(showsHeadings(13)).toBe(true);
  });
  it('shows the length pills when the list holds more than 40 pieces', () => {
    expect(showsLengths(40)).toBe(false);
    expect(showsLengths(41)).toBe(true);
  });
});
