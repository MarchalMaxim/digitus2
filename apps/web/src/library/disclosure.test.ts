import { describe, expect, it } from 'vitest';
import {
  FOLD_ABOVE,
  GENRES_ABOVE,
  GENRE_MIN,
  HEADINGS_ABOVE,
  OTHER_BELOW,
  PILLS_ABOVE,
  SEARCH_FROM,
  folds,
  showsHeadings,
  showsPills,
  showsSearch,
} from './disclosure.js';

describe('the disclosure thresholds (spec 6.1)', () => {
  it('has the numbers the spec gives', () => {
    expect([
      PILLS_ABOVE,
      SEARCH_FROM,
      HEADINGS_ABOVE,
      OTHER_BELOW,
      GENRES_ABOVE,
      GENRE_MIN,
      FOLD_ABOVE,
    ]).toEqual([40, 100, 12, 3, 60, 3, 60]);
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
  it('folds collections above 60 pieces in view (L2)', () => {
    expect(folds(60)).toBe(false);
    expect(folds(61)).toBe(true);
  });
});
