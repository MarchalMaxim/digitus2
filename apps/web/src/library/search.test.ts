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
  it("matches a piece by the name of its shelf (shelves spec 4.4): 'baroque', 'jazz', 'carols'", () => {
    const prelude = { title: 'Prelude', composer: 'J. S. Bach', collection: 'Keyboard works' };
    expect(matchesQuery(prelude, 'baroque')).toBe(false); // no genre given: the words are the piece's own
    expect(matchesQuery({ ...prelude, genre: 'baroque' }, 'baroque')).toBe(true);
    expect(matchesQuery({ ...prelude, genre: 'baroque' }, 'bach baroq')).toBe(true);
    expect(matchesQuery({ ...prelude, genre: 'ragtime' }, 'jazz')).toBe(true);
    expect(matchesQuery({ ...prelude, genre: 'ragtime' }, 'ragtime')).toBe(true);
    expect(matchesQuery({ ...prelude, genre: 'modern' }, 'modern')).toBe(true);
    expect(matchesQuery({ ...prelude, genre: 'carols' }, 'folk')).toBe(true);
    expect(matchesQuery({ ...prelude, genre: 'carols' }, 'carol')).toBe(true);
    expect(matchesQuery({ ...prelude, genre: 'folk' }, 'carols')).toBe(true);
    expect(matchesQuery({ ...prelude, genre: 'songs' }, 'baroque')).toBe(false);
  });
  it('does not match a piece by the joining "and" of a shelf name', () => {
    expect(
      matchesQuery({ title: 'Tune', composer: 'X', collection: 'Y', genre: 'folk' }, 'and'),
    ).toBe(false);
  });
  it('keeps the order it is given', () => {
    expect(searchPieces([rondo, furElise], 'r')).toEqual([rondo, furElise]);
  });
});

describe('shelf names in the language on screen', () => {
  const piece = { ...furElise, genre: 'romantic' as const };
  it('find the shelf in that language and still in English', () => {
    const dutch = (id: string) => (id === 'romantic' ? 'Romantiek' : id);
    expect(matchesQuery(piece, 'romantiek')).toBe(false);
    expect(matchesQuery(piece, 'romantiek', dutch)).toBe(true);
    expect(matchesQuery(piece, 'romantic', dutch)).toBe(true);
  });
  it('never search by the joining word of a shelf name', () => {
    const folk = { ...rondo, collection: 'Dances', genre: 'folk' as const };
    expect(matchesQuery(folk, 'and')).toBe(false);
    expect(matchesQuery(folk, 'carols')).toBe(true);
    expect(matchesQuery(folk, 'et', () => 'Folklore et chants de Noël')).toBe(false);
  });
});
