import { describe, expect, it } from 'vitest';
import { GENRES } from './levels.js';
import { libraryPieces, loadPieceDetails } from './manifest.js';
import {
  arrivalLevel,
  countText,
  dropTrailingParenthesis,
  genrePills,
  libraryLayout,
  shortTitle,
  startLabel,
  startTarget,
  type Group,
  type LibraryLayout,
  type Row,
} from './model.js';
import { syntheticLibrary } from './testing/syntheticLibrary.js';
import catalog from '../../../../content/tools/catalog.json';

const allPieces = libraryPieces();

// The 253 curated pieces: the layout pins below describe them. The MuseScore archive pieces (collection
// ids pdmx-*, 2026-10-16) are checked in their own block at the end.
const pieces = allPieces.filter((p) => !p.collectionId.startsWith('pdmx-'));

const level = (n: 1 | 2 | 3 | 4 | 5 | 6) => {
  const layout = libraryLayout(pieces, { level: n, query: '' });
  if (layout.kind !== 'level') throw new Error(layout.kind);
  return layout;
};
const headings = (groups: Group[]) => groups.map((g) => [g.heading, g.rows.length]);
const rowsOf = (layout: LibraryLayout): Row[] =>
  layout.kind === 'level'
    ? layout.groups.flatMap((g) => g.rows)
    : layout.sections.flatMap((s) => s.groups.flatMap((g) => g.rows));

describe('the expanded library at 253 pieces (spec sections 5, 6, 7)', () => {
  it('shows one level at a time, First steps first', () => {
    const layout = libraryLayout(pieces, { level: null, query: '' });
    expect(layout.kind).toBe('level');
    if (layout.kind !== 'level') return;
    expect(layout.levels).toEqual([1, 2, 3, 4, 5, 6]);
    expect(layout.level).toBe(1);
    expect(layout.count).toBe(24);
    expect(layout.groups[0]!.rows[0]).toMatchObject({
      slug: 'twinkle-twinkle-little-star',
      title: 'Twinkle, Twinkle, Little Star',
      composerLine: null,
      label: 'Open Twinkle, Twinkle, Little Star by Traditional',
      duration: '0:29',
    });
  });
  it('groups each level under its collections, small ones in "Other pieces" last', () => {
    expect(headings(level(1).groups)).toEqual([
      ["Children's songs", 15],
      ['Songs before 1929', 4],
      ['Other pieces', 5],
    ]);
    expect(headings(level(2).groups)).toEqual([
      ['Folk songs', 9],
      ['Christmas carols and songs', 7],
      ['Hymns and spirituals', 4],
      ['National anthems', 3],
      ['Songs before 1929', 3],
      ['Classical themes, simplified', 4],
      ['Notebook for Anna Magdalena Bach (1725)', 4],
      ['Schumann, Album for the Young, Op. 68', 4],
      ['Other pieces', 6],
    ]);
    expect(headings(level(3).groups)).toEqual([
      ['Notebook for Anna Magdalena Bach (1725)', 7],
      ['Bach, Little Preludes', 3],
      ['Minuets, dances and rondos', 3],
      ['Swedish folk dances (Traditioner af Swenska Folk-Dansar, 1814)', 24],
      ['Burgmüller, 25 Easy and Progressive Studies, Op. 100', 15],
      ['Schumann, Album for the Young, Op. 68', 6],
      ['Sonatinas and sonatas', 5],
      ['Romantic character pieces', 13],
      ['Other pieces', 7],
    ]);
    expect(headings(level(4).groups)).toEqual([
      ['Bach, Little Preludes', 5],
      ['Schumann, Album for the Young, Op. 68', 3],
      ['Sonatinas and sonatas', 7],
      ['Bach, Inventions, BWV 772–786', 8],
      ['Chopin, Preludes, Op. 28', 3],
      ['Romantic character pieces', 4],
      ['Other pieces', 7],
    ]);
    expect(headings(level(5).groups)).toEqual([
      ['Sonatinas and sonatas', 3],
      ['Bach, Inventions, BWV 772–786', 4],
      ['Romantic character pieces', 3],
      ['Ragtime', 3],
      ['Other pieces', 2],
    ]);
  });
  it('groups Advanced pieces under their collections', () => {
    expect(headings(level(6).groups)).toEqual([
      ['Bach, The Well-Tempered Clavier', 4],
      ['Romantic character pieces', 8],
      ['Beethoven', 3],
      ['Bach keyboard works', 21],
      ['Baroque keyboard works', 4],
      ['Classical keyboard works', 5],
      ['Other pieces', 5],
    ]);
  });
  it('shortens exactly these 13 titles under their own heading (reviewed once; spec section 5)', () => {
    const shortened = Object.fromEntries(
      ([1, 2, 3, 4, 5, 6] as const)
        .flatMap((n) => rowsOf(level(n)))
        .filter((r) => r.title !== pieces.find((p) => p.slug === r.slug)!.title)
        .map((r) => [r.slug, r.title]),
    );
    expect(shortened).toEqual({
      'pachelbel-canon-in-d': 'Canon in D',
      'schumann-op68-no1-melody': 'Melody (No. 1)',
      'schumann-op68-no3-humming-song': 'Humming Song (No. 3)',
      'schumann-op68-no5-little-piece': 'Little Piece (No. 5)',
      'schumann-op68-no2-soldiers-march': "Soldiers' March (No. 2)",
      'schumann-op68-no8-wild-rider': 'The Wild Rider (No. 8)',
      'schumann-op68-no6-poor-orphan': 'Poor Orphan (No. 6)',
      'schumann-op68-no9-little-folk-song': 'Little Folk Song (No. 9)',
      'schumann-op68-no10-the-happy-farmer': 'The Happy Farmer (No. 10)',
      'schumann-op68-no14-little-study': 'Little Study (No. 14)',
      'schumann-op68-no16-first-loss': 'First Loss (No. 16)',
      'schumann-op68-no12-knecht-ruprecht': 'Knecht Ruprecht (No. 12)',
      'schumann-op68-no25-echoes-from-the-theatre': 'Echoes from the Theatre (No. 25)',
    });
  });
  it('drops the composer line only under a heading that names the one composer, and for Traditional and Anonymous', () => {
    const rows = ([1, 2, 3, 4, 5, 6] as const).flatMap((n) => rowsOf(level(n)));
    const bySlug = new Map(pieces.map((p) => [p.slug, p]));
    const hiddenNamed = rows.filter(
      (r) =>
        r.composerLine === null && !/^(Traditional|Anonymous)\b/.test(bySlug.get(r.slug)!.composer),
    );
    expect(hiddenNamed).toHaveLength(79);
    expect(new Set(hiddenNamed.map((r) => bySlug.get(r.slug)!.collectionId))).toEqual(
      new Set([
        'schumann-op68',
        'bach-little-preludes',
        'burgmuller-op100',
        'bach-inventions',
        'chopin-op28',
        'bach-wtc',
        'beethoven-originals',
        'bach-keyboard',
      ]),
    );
    const sonatinas = level(3).groups.find((g) => g.heading === 'Sonatinas and sonatas')!;
    expect(sonatinas.rows.map((r) => r.composerLine)).toEqual([
      'Muzio Clementi',
      'Johann Anton André',
      'Muzio Clementi',
      'Muzio Clementi',
      'Friedrich Kuhlau',
    ]);
    expect(rows.find((r) => r.slug === 'joy-to-the-world')?.composerLine).toBe('Lowell Mason');
  });
  it('searches every level; colliding titles keep their composer, "Anonymous" included', () => {
    const minuet = libraryLayout(pieces, { level: 4, query: 'minuet' });
    expect(minuet.kind).toBe('search');
    if (minuet.kind !== 'search') return;
    expect(minuet.count).toBe(14);
    expect(minuet.sections.map((s) => s.level)).toEqual([2, 3, 4]);
    expect(minuet.sections[1]!.groups[0]!.rows.map((r) => [r.title, r.composerLine])).toEqual([
      ['Minuet in F major', 'Anonymous'],
      ['Minuet in G major', 'Anonymous'],
      ['Minuet in A minor', null],
      ['Minuet in C minor', null],
      ['Minuet in D major', 'George Frideric Handel'],
      ['Rondo in C major', 'Johann Baptist Wanhal'],
      ['Minuet in C major', 'Ignaz Pleyel'],
      ['Siciliano in A minor', 'August Eberhard Müller'],
    ]);
    const fur = libraryLayout(pieces, { level: null, query: 'fur elise' });
    expect(rowsOf(fur).map((r) => r.title)).toEqual(['Für Elise (Bagatelle in A minor)']);
    const burg = libraryLayout(pieces, { level: null, query: 'burgmuller' });
    expect(burg.kind === 'search' && burg.sections.map((s) => [s.level, s.count])).toEqual([
      [2, 1],
      [3, 15],
      [4, 2],
    ]);
    expect(burg.kind === 'search' && headings(burg.sections[1]!.groups)).toEqual([
      ['Burgmüller, 25 Easy and Progressive Studies, Op. 100', 15],
    ]);
  });
  it('treats spaces as no search and punctuation as an empty result', () => {
    expect(libraryLayout(pieces, { level: 2, query: '   ' })).toMatchObject({
      kind: 'level',
      level: 2,
    });
    expect(libraryLayout(pieces, { level: 2, query: 'fur elize' })).toMatchObject({
      kind: 'search',
      count: 0,
      sections: [],
    });
    expect(libraryLayout(pieces, { level: 2, query: '!!' })).toMatchObject({
      kind: 'search',
      count: 0,
    });
  });
  it('starts with Twinkle, or continues with the last piece played while it is still in the library', () => {
    expect(startLabel(startTarget(pieces, null))).toBe('Start with Twinkle, Twinkle, Little Star');
    expect(startLabel(startTarget(pieces, 'beethoven-fur-elise-woo-59'))).toBe(
      'Continue with Für Elise',
    );
    expect(startLabel(startTarget(pieces, 'no-such-piece'))).toBe(
      'Start with Twinkle, Twinkle, Little Star',
    );
    expect(dropTrailingParenthesis('Ode to Joy (simplified)')).toBe('Ode to Joy');
    expect(dropTrailingParenthesis('Arabesque')).toBe('Arabesque');
  });
  it("opens on the level chosen in this visit, else the last piece's level, else the lowest", () => {
    expect(arrivalLevel(pieces, null, null)).toBe(1);
    expect(arrivalLevel(pieces, null, 'bach-minuet-g-major-bwv-anh-114')).toBe(2);
    expect(arrivalLevel(pieces, 3, 'bach-minuet-g-major-bwv-anh-114')).toBe(3);
    expect(arrivalLevel(pieces, 6, null)).toBe(6);
    expect(arrivalLevel(pieces, null, 'no-such-piece')).toBe(1);
  });
  it('shows genres only in Moderate, the only level above 60 pieces', () => {
    expect(genrePills(pieces.filter((p) => p.level === 3))).toEqual([
      'songs',
      'baroque',
      'classical',
      'romantic',
    ]);
    for (const n of [1, 2, 4, 5, 6])
      expect(genrePills(pieces.filter((p) => p.level === n))).toEqual([]);
    expect([1, 2, 3, 4, 5, 6].map((n) => pieces.filter((p) => p.level === n).length)).toEqual([
      24, 44, 83, 37, 15, 50,
    ]);
  });
  it('writes counts as words', () => {
    expect([countText(1), countText(24)]).toEqual(['1 piece', '24 pieces']);
  });
});

describe('the library with the MuseScore archive (2026-10-16)', () => {
  const archive = allPieces.filter((p) => p.collectionId.startsWith('pdmx-'));
  it('holds the archive pieces in three collections, each with a known genre', () => {
    expect(archive.length).toBeGreaterThanOrEqual(1000);
    expect(new Set(archive.map((p) => p.collectionId))).toEqual(
      new Set(['pdmx-classical', 'pdmx-folk', 'pdmx-advanced']),
    );
    // the advanced collection is the archive's level 6, and only that
    for (const p of archive) expect(p.collectionId === 'pdmx-advanced', p.slug).toBe(p.level === 6);
    const ids = new Set(GENRES.map((g) => g.id));
    for (const p of archive) expect(ids.has(p.genre), p.slug).toBe(true);
  });
  it('counts every level, and the levels add up to the whole library', () => {
    const counts = [1, 2, 3, 4, 5, 6].map((n) => allPieces.filter((p) => p.level === n).length);
    expect(counts.reduce((sum, c) => sum + c, 0)).toBe(allPieces.length);
    expect(counts.every((c) => c > 0)).toBe(true);
  });
});

describe('the core 30 (a library of 40 pieces or fewer)', () => {
  it('shows every level, each flat', async () => {
    const core = [...(await loadPieceDetails()).values()].filter(
      (p) => p.benchmarkSet === 'core30',
    );
    const layout = libraryLayout(core, { level: 3, query: 'minuet' });
    expect(layout.kind).toBe('all'); // no search under 100 pieces: the query is ignored
    if (layout.kind !== 'all') return;
    expect(layout.sections.map((s) => s.level)).toEqual([1, 2, 3, 4, 5]);
    expect(layout.sections.reduce((n, s) => n + s.count, 0)).toBe(30);
    for (const s of layout.sections) expect(s.groups.map((g) => g.heading)).toEqual([null]);
  });
});

describe('a synthetic library of 1,000 pieces (L2)', () => {
  const big = syntheticLibrary();
  it('has six levels, a genre row in every level, and folds every level', () => {
    expect(big).toHaveLength(1000);
    const layout = libraryLayout(big, { level: null, query: '' });
    expect(layout.kind === 'level' && layout.levels).toEqual([1, 2, 3, 4, 5, 6]);
    for (const n of [1, 2, 3, 4, 5, 6] as const) {
      const inLevel = big.filter((p) => p.level === n);
      expect(genrePills(inLevel).length, `level ${n}`).toBeGreaterThanOrEqual(2);
      expect(inLevel.length).toBeGreaterThan(60);
    }
  });
});

describe('genre pills (spec 6.1)', () => {
  const entry = (i: number, genre: (typeof GENRES)[number]['id']) => ({
    slug: `p${i}`,
    title: `P${i}`,
    composer: 'C',
    level: 2 as const,
    collection: 'X',
    collectionId: 'x',
    genre,
    approxDurationSec: 30,
  });
  it('needs more than 60 pieces, and two genres of at least 3', () => {
    const sixty = Array.from({ length: 60 }, (_, i) => entry(i, i < 30 ? 'songs' : 'baroque'));
    expect(genrePills(sixty)).toEqual([]);
    const many = [...sixty, entry(60, 'baroque')];
    expect(genrePills(many)).toEqual(['songs', 'baroque']);
    const lopsided = Array.from({ length: 61 }, (_, i) => entry(i, i < 59 ? 'songs' : 'ragtime'));
    expect(genrePills(lopsided)).toEqual([]); // ragtime has 2 (< GENRE_MIN): one genre left
  });
});

describe('the catalog and the app agree', () => {
  it('names the same genres in the same order', () => {
    expect((catalog as { genres: { id: string }[] }).genres.map((g) => g.id)).toEqual(
      GENRES.map((g) => g.id),
    );
  });
});

describe('shortTitle', () => {
  it('drops a parenthesis whose first part the heading already says', () => {
    expect(
      shortTitle('Melody (Album for the Young, No. 1)', 'Schumann, Album for the Young, Op. 68'),
    ).toBe('Melody (No. 1)');
    expect(shortTitle('Canon in D (simplified)', 'Classical themes, simplified')).toBe(
      'Canon in D',
    );
    expect(
      shortTitle('Progrès (Progress)', 'Burgmüller, 25 Easy and Progressive Studies, Op. 100'),
    ).toBe('Progrès (Progress)');
    expect(shortTitle('Arabesque', 'Anything')).toBe('Arabesque');
  });
});
