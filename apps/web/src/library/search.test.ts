import { describe, expect, it } from 'vitest';
import { foldText, matchesQuery, searchPieces, words } from './search.js';

const furElise = {
  title: 'Für Elise (Bagatelle in A minor)',
  composer: 'Ludwig van Beethoven',
  collection: 'Romantic character pieces',
};
const rondo = {
  title: 'Rondo in C major',
  composer: 'Johann Baptist Wanhal',
  collection: 'Minuets, dances and rondos',
};

describe('search (spec 6.3)', () => {
  it('folds case and accents', () => {
    expect(foldText('Für Élise')).toBe('fur elise');
    expect(words("Children's songs, Op. 68")).toEqual(['children', 's', 'songs', 'op', '68']);
  });
  it('matches every query word as the start of a word of the title, composer or collection, in any order', () => {
    expect(matchesQuery(furElise, 'fur elise')).toBe(true);
    expect(matchesQuery(furElise, 'FÜR eli')).toBe(true);
    expect(matchesQuery(furElise, 'elise beethoven')).toBe(true);
    expect(matchesQuery(furElise, 'lise')).toBe(false);
    expect(matchesQuery(furElise, 'fur elize')).toBe(false);
    expect(matchesQuery(rondo, 'minuet')).toBe(true);
  });
  it('matches nothing for empty or punctuation-only text', () => {
    expect(matchesQuery(furElise, '')).toBe(false);
    expect(matchesQuery(furElise, '  ')).toBe(false);
    expect(matchesQuery(furElise, '!!')).toBe(false);
  });
  it('keeps the order it is given', () => {
    expect(searchPieces([rondo, furElise], 'r')).toEqual([rondo, furElise]);
  });
});
