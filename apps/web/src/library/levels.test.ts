import { describe, expect, it } from 'vitest';
import catalog from '../../../../content/tools/catalog.json';
import {
  GENRES,
  GRADES,
  LENGTHS,
  SHELVES,
  TIERS,
  TIER_NAMES,
  shelfOfGenre,
  tierOf,
  toTier,
} from './levels.js';

describe('the four levels (shelves spec 3)', () => {
  it('maps grades 1 and 2 to Easy, 3 to Medium, 4 to Harder and 5 and 6 to Challenging', () => {
    expect(GRADES.map(tierOf)).toEqual([
      'easy',
      'easy',
      'medium',
      'harder',
      'challenging',
      'challenging',
    ]);
  });
  it('names each tier once, with the copy of the spec', () => {
    expect(TIERS.map((t) => TIER_NAMES[t])).toEqual(['Easy', 'Medium', 'Harder', 'Challenging']);
  });
  it('reads a stored level: a tier id, or a grade from a build with six pills', () => {
    expect(toTier('medium')).toBe('medium');
    expect([1, 2, 3, 4, 5, 6].map(toTier)).toEqual([
      'easy',
      'easy',
      'medium',
      'harder',
      'challenging',
      'challenging',
    ]);
    expect(TIERS.map(toTier)).toEqual([...TIERS]);
    for (const junk of [0, 7, 2.5, 'hard', null, undefined, {}]) expect(toTier(junk)).toBeNull();
  });
});

describe('the six shelves (shelves spec 4)', () => {
  it('are in the spec order, well-known tunes first', () => {
    expect(SHELVES.map((s) => s.name)).toEqual([
      'Songs',
      'Classical',
      'Folk and carols',
      'Baroque',
      'Romantic',
      'Jazz, ragtime and modern',
    ]);
  });
  it('hold every catalog genre exactly once', () => {
    const genres = (catalog as { genres: { id: string }[] }).genres.map((g) => g.id);
    expect(GENRES.map((g) => g.id)).toEqual(genres);
    const shelved = GENRES.map((g) => shelfOfGenre(g.id));
    expect(new Set(shelved)).toEqual(new Set(SHELVES.map((s) => s.id)));
    expect(shelfOfGenre('carols')).toBe('folk');
    expect(shelfOfGenre('ragtime')).toBe('jazz');
    expect(shelfOfGenre('modern')).toBe('jazz');
  });
  it('say what they hold in one line, and name what the button counts', () => {
    expect(SHELVES.map((s) => s.noun)).toEqual([
      'songs',
      'classical pieces',
      'folk tunes and carols',
      'baroque pieces',
      'romantic pieces',
      'jazz, ragtime and modern pieces',
    ]);
    for (const s of SHELVES) expect(s.line).toMatch(/\.$/);
  });
});

describe('the length pills (shelves spec 4.3)', () => {
  it('are Any length, Under 1 min, 1 to 3 min and Over 3 min, in seconds', () => {
    expect(LENGTHS.map((l) => l.label)).toEqual([
      'Any length',
      'Under 1 min',
      '1 to 3 min',
      'Over 3 min',
    ]);
    expect(LENGTHS.slice(1).map((l) => [l.from, l.to])).toEqual([
      [0, 60],
      [60, 180],
      [180, Infinity],
    ]);
  });
});
