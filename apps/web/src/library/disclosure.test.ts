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
  it('keeps the rule of 7 and orders the thresholds as the specs do', () => {
    // No list a reader sees at a glance is longer than 7 rows.
    expect(SAMPLES).toBeLessThanOrEqual(7);
    expect(SECTION_ROWS).toBeLessThanOrEqual(7);
    // Pills come before search, headings only inside a list that already fits a page.
    expect(PILLS_ABOVE).toBeLessThan(SEARCH_FROM);
    expect(HEADINGS_ABOVE).toBeLessThan(PAGE_SIZE);
    expect(OTHER_BELOW).toBeGreaterThan(1);
    expect(PAGE_SIZE).toBeGreaterThan(SECTION_ROWS);
    // The length pills follow the same size as the level pills: a list too long to scan.
    expect(LENGTH_ABOVE).toBe(PILLS_ABOVE);
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
