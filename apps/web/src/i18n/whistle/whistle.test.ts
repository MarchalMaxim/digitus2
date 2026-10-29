import { describe, expect, it } from 'vitest';
import { LOCALES } from '../locales.js';
import { WHISTLE_TEXTS } from './index.js';

describe('the whistle texts (issue 237)', () => {
  it('speak every language the app speaks, each with every text', () => {
    expect(Object.keys(WHISTLE_TEXTS).sort()).toEqual([...LOCALES].sort());
    const keys = Object.keys(WHISTLE_TEXTS.en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(WHISTLE_TEXTS[locale]).sort()).toEqual(keys);
      for (const key of keys)
        expect(WHISTLE_TEXTS[locale][key as keyof typeof WHISTLE_TEXTS.en].trim()).not.toBe('');
    }
  });

  it('are translated, not copied: no other language repeats the English line', () => {
    for (const locale of LOCALES.filter((l) => l !== 'en'))
      for (const key of ['start', 'hint', 'denied', 'noNotes'] as const)
        expect(WHISTLE_TEXTS[locale][key]).not.toBe(WHISTLE_TEXTS.en[key]);
  });

  it('never hedge the feature', () => {
    const hedges = /experimental|may not|can fail|not accurate|not reliable|unreliable|beta/i;
    for (const locale of LOCALES)
      for (const text of Object.values(WHISTLE_TEXTS[locale])) expect(text).not.toMatch(hedges);
  });
});
