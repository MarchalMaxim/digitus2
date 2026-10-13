import { describe, expect, it } from 'vitest';
import type { Finger } from '../score/types.js';
import { HAND_PROFILES, PARNCUTT_TABLES, resolveProfile, scaleTables, span } from './spans.js';

const F: Finger[] = [1, 2, 3, 4, 5];

describe('Parncutt span tables', () => {
  it('reproduces Table 1 for the 1-2 and 2-3 pairs', () => {
    expect([
      span(PARNCUTT_TABLES, 'minPrac', 1, 2),
      span(PARNCUTT_TABLES, 'minComf', 1, 2),
      span(PARNCUTT_TABLES, 'minRel', 1, 2),
      span(PARNCUTT_TABLES, 'maxRel', 1, 2),
      span(PARNCUTT_TABLES, 'maxComf', 1, 2),
      span(PARNCUTT_TABLES, 'maxPrac', 1, 2),
    ]).toEqual([-5, -3, 1, 5, 8, 10]);
    expect([
      span(PARNCUTT_TABLES, 'minPrac', 2, 3),
      span(PARNCUTT_TABLES, 'minComf', 2, 3),
      span(PARNCUTT_TABLES, 'minRel', 2, 3),
      span(PARNCUTT_TABLES, 'maxRel', 2, 3),
      span(PARNCUTT_TABLES, 'maxComf', 2, 3),
      span(PARNCUTT_TABLES, 'maxPrac', 2, 3),
    ]).toEqual([1, 1, 1, 2, 3, 5]);
  });
  it('reverses pairs by negating and swapping min and max', () => {
    expect(span(PARNCUTT_TABLES, 'maxPrac', 2, 1)).toBe(5);
    expect(span(PARNCUTT_TABLES, 'minPrac', 2, 1)).toBe(-10);
    expect(span(PARNCUTT_TABLES, 'maxComf', 4, 1)).toBe(1);
    expect(span(PARNCUTT_TABLES, 'minComf', 4, 1)).toBe(-12);
  });
  it('satisfies the published relations between columns for every ascending pair', () => {
    for (const f of F)
      for (const g of F) {
        if (f >= g) continue;
        const t = PARNCUTT_TABLES;
        expect(span(t, 'maxComf', f, g)).toBe(span(t, 'maxPrac', f, g) - 2);
        if (f === 1) {
          expect(span(t, 'minComf', f, g)).toBe(span(t, 'minPrac', f, g) + 2);
          expect(span(t, 'maxRel', f, g)).toBe(span(t, 'maxComf', f, g) - 3);
          expect(span(t, 'minRel', f, g)).toBe(2 * (g - f) - 1);
        } else {
          expect(span(t, 'minComf', f, g)).toBe(span(t, 'minPrac', f, g));
          expect(span(t, 'maxRel', f, g)).toBe(2 * (g - f));
          expect(span(t, 'minRel', f, g)).toBe(2 * (g - f) - 1);
        }
      }
  });
  it('has a zero diagonal', () => {
    for (const f of F) expect(span(PARNCUTT_TABLES, 'maxComf', f, f)).toBe(0);
  });
  it('scales tables and resolves profiles', () => {
    const s = scaleTables(PARNCUTT_TABLES, 0.9);
    expect(span(s, 'maxPrac', 1, 5)).toBe(14);
    expect(span(s, 'minPrac', 1, 2)).toBe(-5);
    expect(resolveProfile(undefined).id).toBe('large');
    expect(resolveProfile('child').scale).toBe(0.7);
    expect(span(HAND_PROFILES.child.tables, 'maxPrac', 1, 5)).toBe(11);
    expect(resolveProfile(HAND_PROFILES.small)).toBe(HAND_PROFILES.small);
  });
});
