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
  it('keeps the order it is given', () => {
    expect(searchPieces([rondo, furElise], 'r')).toEqual([rondo, furElise]);
  });
});

// Issue #116: the curated titles leave catalogue numbers out, and a letter written against a
// number ("K545") was one word, so "k545", "BWV 846" and "op 36" found nothing.
describe('catalogue numbers', () => {
  const facile = {
    slug: 'mozart-sonata-k545-mvt1',
    title: "Piano Sonata in C major ('Sonata facile'), 1st movement (Allegro)",
    composer: 'Wolfgang Amadeus Mozart',
    collection: 'Sonatas and sonatinas',
  };
  const prelude = {
    slug: 'bach-prelude-c-major-bwv-846',
    title: 'Prelude in C major (Well-Tempered Clavier, Book I, No. 1)',
    composer: 'Johann Sebastian Bach',
    collection: 'Keyboard works',
  };
  const sonatina = {
    slug: 'clementi-sonatina-op36-no1-mvt1',
    title: 'Sonatina in C major, 1st movement (Spiritoso)',
    composer: 'Muzio Clementi',
    collection: 'Sonatas and sonatinas',
  };
  const mutopia = {
    slug: 'bulk-schumannr-o68-schumann-op68-04-choral-schumann-op68-04-choral-ly',
    title: 'Album pour la jeunesse - 4.Un choral',
    composer: 'Robert Schumann',
    collection: 'Mutopia',
  };
  const archive = {
    slug: 'pdmx-sonatina-in-g-c2397698',
    title: 'Sonatina in G',
    composer: 'Thomas Attwood',
    collection: 'Classical piano from the MuseScore archive',
  };
  const titled = {
    title: 'Theme from the sonata K.331',
    composer: 'W. A. Mozart',
    collection: 'Classical piano from the MuseScore archive',
  };

  it('finds a piece by the catalogue number in its slug, however it is written', () => {
    for (const q of ['k545', 'K545', 'K.545', 'K 545', 'k. 545', 'mozart k545'])
      expect(matchesQuery(facile, q), q).toBe(true);
    for (const q of ['bwv 846', 'BWV846', 'bwv-846'])
      expect(matchesQuery(prelude, q), q).toBe(true);
    for (const q of ['op 36', 'Op. 36 No. 1', 'op36 no1', 'clementi op 36'])
      expect(matchesQuery(sonatina, q), q).toBe(true);
    // Mutopia's bulk slugs write an opus as `o68`.
    expect(matchesQuery(mutopia, 'op 68')).toBe(true);
  });
  it('finds a number written against its letter in a title too', () => {
    expect(matchesQuery(titled, 'k331')).toBe(true);
    expect(matchesQuery(titled, 'K. 331')).toBe(true);
  });
  it('takes no other words from the slug, so an archive hash matches nothing', () => {
    expect(matchesQuery(archive, 'c2397698')).toBe(false);
    expect(matchesQuery(archive, '2397698')).toBe(false);
    expect(matchesQuery(archive, 'pdmx')).toBe(false);
    expect(matchesQuery(facile, 'mvt')).toBe(false);
    expect(matchesQuery(facile, 'k 546')).toBe(false);
    expect(matchesQuery(sonatina, 'op 37')).toBe(false);
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
