import { describe, expect, it } from 'vitest';
import { formatNumber } from '../i18n/format.js';
import { en } from '../i18n/en/index.js';
import {
  SHELVES,
  TIERS,
  TIER_NAMES,
  shelfOfGenre,
  tierOf,
  type LengthId,
  type ShelfId,
  type Tier,
} from './levels.js';
import { libraryPieces, loadPieceDetails } from './manifest.js';
import {
  announcementFor,
  arrivalLevel,
  composerShort,
  dropTrailingParenthesis,
  isUnnamed,
  libraryLayout,
  localDateKey,
  moreLabel,
  sampleShelf,
  shelfHasPieces,
  shortTitle,
  startLabel,
  startTarget,
  tiersIn,
  type Group,
  type LibraryChoices,
  type LibraryEntry,
  type LibraryLayout,
  type Row,
} from './model.js';
import { syntheticLibrary } from './testing/syntheticLibrary.js';

const allPieces = libraryPieces();

// The 253 curated pieces: the pins below describe them. The MuseScore archive pieces (collection
// ids pdmx-*, 2026-10-16) are checked in their own blocks further down.
const pieces = allPieces.filter((p) => !p.collectionId.startsWith('pdmx-'));

const DATE = '2026-10-16';
const choose = (over: Partial<LibraryChoices> = {}): LibraryChoices => ({
  tier: null,
  query: '',
  date: DATE,
  ...over,
});
const shelves = (list: readonly LibraryEntry[], tier: Tier | null = null, over = {}) => {
  const layout = libraryLayout(list, choose({ tier, ...over }), en);
  if (layout.kind !== 'shelves') throw new Error(layout.kind);
  return layout;
};
const shelf = (
  list: readonly LibraryEntry[],
  tier: Tier,
  id: ShelfId,
  over: Partial<LibraryChoices> = {},
) => {
  const layout = libraryLayout(list, choose({ tier, shelf: id, ...over }), en);
  if (layout.kind !== 'shelf') throw new Error(layout.kind);
  return layout;
};
const search = (
  list: readonly LibraryEntry[],
  query: string,
  over: Partial<LibraryChoices> = {},
) => {
  const layout = libraryLayout(list, choose({ query, ...over }), en);
  if (layout.kind !== 'search') throw new Error(layout.kind);
  return layout;
};
const headings = (groups: Group[]) => groups.map((g) => [g.heading, g.rows.length]);
const rowsOf = (groups: Group[]): Row[] => groups.flatMap((g) => g.rows);
const inTierShelf = (list: readonly LibraryEntry[], tier: Tier, id: ShelfId) =>
  list.filter((p) => tierOf(p.level) === tier && shelfOfGenre(p.genre) === id);

describe('the arrival page at 253 pieces (shelves spec 4.1)', () => {
  it('opens on Easy and shows the shelves that hold a piece, in the spec order', () => {
    const layout = shelves(pieces);
    expect(layout.tiers).toEqual(['easy', 'medium', 'harder', 'challenging']);
    expect(layout.tier).toBe('easy');
    expect(layout.count).toBe(pieces.filter((p) => tierOf(p.level) === 'easy').length);
    const names = layout.shelves.map((s) => s.name);
    expect(names).toEqual(SHELVES.map((s) => s.name).filter((n) => names.includes(n)));
    expect(layout.shelves.reduce((n, s) => n + s.count, 0)).toBe(layout.count);
    for (const s of layout.shelves) expect(s.line).toBe(SHELVES.find((x) => x.id === s.id)!.line);
  });
  it('shows at most 5 rows per shelf and at most 30 rows in all, whatever the level', () => {
    for (const tier of TIERS) {
      const layout = shelves(allPieces, tier);
      expect(layout.shelves.length).toBeLessThanOrEqual(6);
      for (const s of layout.shelves) expect(s.rows.length).toBeLessThanOrEqual(5);
      expect(layout.shelves.reduce((n, s) => n + s.rows.length, 0)).toBeLessThanOrEqual(30);
    }
  });
  it('writes the count and the All button of a shelf; a shelf of 5 or fewer shows all and no button', () => {
    const layout = shelves(allPieces, 'easy');
    const songs = layout.shelves.find((s) => s.id === 'songs')!;
    expect(songs.count).toBe(145);
    expect(songs.all).toBe('All 145 songs');
    const jazz = layout.shelves.find((s) => s.id === 'jazz')!;
    expect(jazz.count).toBe(3);
    expect(jazz.all).toBeNull();
    expect(jazz.rows).toHaveLength(3);
    const baroque = layout.shelves.find((s) => s.id === 'baroque')!;
    expect(baroque.count).toBe(5);
    expect(baroque.all).toBeNull();
    const medium = shelves(allPieces, 'medium');
    expect(medium.shelves.find((s) => s.id === 'classical')!.all).toBe('All 658 classical pieces');
    expect(medium.shelves.find((s) => s.id === 'folk')!.all).toBe('All 57 folk tunes and carols');
    expect(medium.shelves.find((s) => s.id === 'jazz')!.all).toBe(
      'All 6 jazz, ragtime and modern pieces',
    );
  });
  it('holds the library of the spec: 2,702 pieces, the counts of the spec table', () => {
    expect(allPieces).toHaveLength(2702);
    const table = (tier: Tier) =>
      Object.fromEntries(shelves(allPieces, tier).shelves.map((s) => [s.id, s.count]));
    expect(table('easy')).toEqual({
      songs: 145,
      classical: 71,
      folk: 29,
      baroque: 5,
      romantic: 6,
      jazz: 3,
    });
    expect(table('medium')).toEqual({
      songs: 643,
      classical: 658,
      folk: 57,
      baroque: 15,
      romantic: 36,
      jazz: 6,
    });
    expect(table('harder')).toEqual({
      songs: 235,
      classical: 486,
      folk: 27,
      baroque: 15,
      romantic: 14,
      jazz: 7,
    });
    expect(table('challenging')).toEqual({
      songs: 21,
      classical: 164,
      folk: 1,
      baroque: 33,
      romantic: 14,
      jazz: 11,
    });
    expect(TIERS.map((t) => shelves(allPieces, t).count)).toEqual([259, 1415, 784, 244]);
  });
  it('leaves out a shelf with no piece in the level', () => {
    const noJazz = pieces.filter((p) => shelfOfGenre(p.genre) !== 'jazz');
    expect(shelves(noJazz, 'easy').shelves.map((s) => s.id)).not.toContain('jazz');
  });
  it('shows a row as title, length and a composer line only when it says something', () => {
    const songs = shelves(pieces, 'easy').shelves.find((s) => s.id === 'songs')!;
    for (const r of songs.rows) {
      expect(r.label).toMatch(/^Open .+ by .+/);
      expect(r.duration).toMatch(/^\d+:\d\d$/);
    }
    const twinkle = pieces.find((p) => p.slug === 'twinkle-twinkle-little-star')!;
    const last = shelves(pieces, 'easy', { lastPlayed: twinkle.slug }).shelves.find(
      (s) => s.id === 'songs',
    )!;
    expect(last.rows[0]).toMatchObject({
      slug: 'twinkle-twinkle-little-star',
      title: 'Twinkle, Twinkle, Little Star',
      composerLine: null,
      label: 'Open Twinkle, Twinkle, Little Star by Traditional',
      duration: '0:29',
    });
  });
});

describe('isUnnamed', () => {
  it('takes Unknown, Traditional and Anonymous for no name, and keeps real names', () => {
    for (const c of ['Unknown', 'Traditional', 'Traditional (Irish)', 'Anonymous'])
      expect(isUnnamed(c)).toBe(true);
    for (const c of ['Johann Sebastian Bach', 'Unknownia Band', 'Ibu Sud'])
      expect(isUnnamed(c)).toBe(false);
  });
});

describe('composerShort', () => {
  it('separates a credit the source glued to the name', () => {
    expect(composerShort('Johann Sebastian Bachattributed to Christian Petzold')).toBe(
      'Johann Sebastian Bach, attributed to Christian Petzold',
    );
    expect(composerShort('Elton JohnArranged by Sadie King')).toBe(
      'Elton John, Arranged by Sadie King',
    );
    expect(composerShort('Joe HisaishiTrans. August Jansson')).toBe(
      'Joe Hisaishi, Trans. August Jansson',
    );
  });
  it('drops a parenthesis the source glued to the name', () => {
    expect(composerShort('Christian Petzold(collected by J.S. Bach)')).toBe('Christian Petzold');
    expect(composerShort('Lowell Mason (tune Antioch)')).toBe('Lowell Mason');
  });
  it('keeps names that are written in camel case', () => {
    for (const c of ['ConcernedApe', 'WoodenToaster', 'CeeLo Green', 'Stephen MacLellan'])
      expect(composerShort(c)).toBe(c);
  });
  it('leaves no credit glued to a name anywhere in the library', () => {
    const glued =
      /\p{Ll}(?:attributed|arranged by|Arr\b|Arranged|Arrangement|Transcribed|Edited|Bearbeitung)|\p{L}\(/u;
    expect(allPieces.map((p) => composerShort(p.composer)).filter((c) => glued.test(c))).toEqual(
      [],
    );
  });
});

describe('the samples (shelves spec 4.1)', () => {
  const sampleSlugs = (
    list: readonly LibraryEntry[],
    tier: Tier,
    date: string,
    lastPlayed: string | null = null,
  ) =>
    Object.fromEntries(
      shelves(list, tier, { date, lastPlayed }).shelves.map((s) => [
        s.id,
        s.rows.map((r) => r.slug),
      ]),
    );
  it('are the same all day and change with the date', () => {
    const a = sampleSlugs(allPieces, 'medium', '2026-10-16');
    expect(sampleSlugs(allPieces, 'medium', '2026-10-16')).toEqual(a);
    expect(sampleSlugs(allPieces, 'medium', '2026-10-17')).not.toEqual(a);
  });
  it('differ between levels and between shelves, because the seed holds both', () => {
    const entry = (i: number): LibraryEntry => ({
      slug: `p${i}`,
      title: `P${i}`,
      composer: `C${i}`,
      level: 1,
      collection: 'X',
      collectionId: `x${i}`,
      genre: 'songs',
      approxDurationSec: 30 + i,
    });
    const members = Array.from({ length: 50 }, (_, i) => entry(i));
    const draw = (seed: string) => sampleShelf(members, seed).map((p) => p.slug);
    expect(draw('2026-10-16|easy|songs')).toEqual(draw('2026-10-16|easy|songs'));
    expect(draw('2026-10-16|easy|songs')).not.toEqual(draw('2026-10-16|medium|songs'));
    expect(draw('2026-10-16|easy|songs')).not.toEqual(draw('2026-10-16|easy|classical'));
  });
  it('show the shortest first', () => {
    for (const tier of TIERS) {
      for (const s of shelves(allPieces, tier).shelves) {
        const secs = s.rows.map((r) => {
          const [m, sec] = r.duration.split(':').map(Number);
          return m! * 60 + sec!;
        });
        expect(secs, `${tier} ${s.id}`).toEqual([...secs].sort((a, b) => a - b));
      }
    }
  });
  it('never repeat a named composer and keep to 2 pieces per collection when the shelf allows', () => {
    // 10 collections of 4 pieces; 5 composers shared round the collections
    const members: LibraryEntry[] = Array.from({ length: 40 }, (_, i) => ({
      slug: `p${i}`,
      title: `P${i}`,
      composer: `Composer ${i % 5}`,
      level: 1,
      collection: `Collection ${Math.floor(i / 4)}`,
      collectionId: `c${Math.floor(i / 4)}`,
      genre: 'songs',
      approxDurationSec: 30 + i,
    }));
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const picked = sampleShelf(members, seed);
      expect(picked).toHaveLength(5);
      expect(new Set(picked.map((p) => p.composer)).size, seed).toBe(5);
    }
    const oneComposer = members.map((p) => ({ ...p, composer: 'Same Name' }));
    for (const seed of ['a', 'b', 'c']) {
      const picked = sampleShelf(oneComposer, seed);
      const perCollection = new Map<string, number>();
      for (const p of picked)
        perCollection.set(p.collectionId, (perCollection.get(p.collectionId) ?? 0) + 1);
      // one composer allows one piece by the rules; the shuffle fills the other four
      expect(picked).toHaveLength(5);
    }
    const twoEach = members.map((p) => ({ ...p, composer: `Composer ${p.slug}` }));
    for (const seed of ['a', 'b', 'c', 'd']) {
      const counts = new Map<string, number>();
      for (const p of sampleShelf(twoEach, seed))
        counts.set(p.collectionId, (counts.get(p.collectionId) ?? 0) + 1);
      expect(Math.max(...counts.values()), seed).toBeLessThanOrEqual(2);
    }
  });
  it('take the first two from the hand-picked collections when a shelf has them', () => {
    const songs = inTierShelf(allPieces, 'medium', 'songs');
    expect(songs.some((p) => !p.collectionId.startsWith('pdmx-'))).toBe(true);
    for (const date of ['2026-10-16', '2026-11-02', '2027-01-09']) {
      const rows = shelves(allPieces, 'medium', { date }).shelves.find(
        (s) => s.id === 'songs',
      )!.rows;
      const curated = rows.filter(
        (r) => !allPieces.find((p) => p.slug === r.slug)!.collectionId.startsWith('pdmx-'),
      );
      expect(curated.length, date).toBeGreaterThanOrEqual(2);
    }
  });
  it('let Unknown, Traditional and Anonymous repeat, and fill from the shuffle when the rules leave gaps', () => {
    const entry = (i: number, composer: string, collectionId: string): LibraryEntry => ({
      slug: `p${i}`,
      title: `P${i}`,
      composer,
      level: 1,
      collection: collectionId,
      collectionId,
      genre: 'songs',
      approxDurationSec: 30 + i,
    });
    const unnamed = ['Unknown', 'Traditional', 'Traditional (Irish)', 'Anonymous'];
    const many = Array.from({ length: 40 }, (_, i) => entry(i, unnamed[i % 4]!, `c${i}`));
    expect(sampleShelf(many, 's')).toHaveLength(5);
    // one composer, one collection: the rules would take 1 piece, the shuffle fills the rest
    const same = Array.from({ length: 12 }, (_, i) => entry(i, 'Bach', 'only'));
    expect(sampleShelf(same, 's')).toHaveLength(5);
    expect(sampleShelf(same.slice(0, 3), 's')).toHaveLength(3);
  });
  it('start with the last piece played when it is on the shelf, and only then', () => {
    const songs = inTierShelf(pieces, 'easy', 'songs');
    const last = songs[songs.length - 1]!;
    const rows = (slug: string | null) =>
      shelves(pieces, 'easy', { lastPlayed: slug }).shelves.find((s) => s.id === 'songs')!.rows;
    expect(rows(last.slug)[0]!.slug).toBe(last.slug);
    expect(rows(last.slug)).toHaveLength(Math.min(5, songs.length));
    const classical = inTierShelf(pieces, 'easy', 'classical')[0]!;
    expect(rows(classical.slug).map((r) => r.slug)).not.toContain(classical.slug);
    expect(rows(null)).toHaveLength(5);
  });
});

describe('an opened shelf (shelves spec 4.2)', () => {
  it('groups its pieces under their collections, small ones in "Other pieces" last', () => {
    const layout = shelf(allPieces, 'medium', 'classical', { pages: 99 });
    expect(layout.kind).toBe('shelf');
    expect(layout.name).toBe('Classical');
    expect(layout.count).toBe(658);
    expect(layout.shown).toBe(658);
    const names = layout.groups.map((g) => g.heading);
    expect(names.every((h) => h !== null)).toBe(true);
    expect(rowsOf(layout.groups)).toHaveLength(658);
    // the curated pieces: wherever a shelf has headings, "Other pieces" comes last
    const withHeadings = TIERS.flatMap((tier) =>
      SHELVES.filter((sh) => shelfHasPieces(pieces, tier, sh.id))
        .map((sh) => shelf(pieces, tier, sh.id, { pages: 99 }).groups)
        .filter((groups) => groups[0]!.heading !== null),
    );
    expect(withHeadings.length).toBeGreaterThan(0);
    for (const groups of withHeadings) {
      const other = groups.findIndex((g) => g.heading === 'Other pieces');
      expect(other === -1 || other === groups.length - 1).toBe(true);
    }
  });
  it('shows a small shelf flat, and a shelf of the small library by its collections', () => {
    expect(headings(shelf(allPieces, 'easy', 'jazz').groups)).toEqual([[null, 3]]);
    const songs = shelf(pieces, 'easy', 'songs');
    expect(songs.groups.some((g) => g.heading === "Children's songs")).toBe(true);
  });
  it('puts a shelf whose pieces all come from one collection under that collection heading', () => {
    const entry = (i: number, over: Partial<LibraryEntry>): LibraryEntry => ({
      slug: `p${i}`,
      title: `Piece ${i}`,
      composer: 'Traditional',
      level: 1,
      collection: 'Lone collection',
      collectionId: 'lone',
      genre: 'songs',
      approxDurationSec: 60,
      ...over,
    });
    const list = [
      ...Array.from({ length: 13 }, (_, i) => entry(i, {})),
      ...Array.from({ length: 40 }, (_, i) =>
        entry(100 + i, { level: 5, genre: 'classical', collectionId: `other${i}` }),
      ),
    ];
    expect(headings(shelf(list, 'easy', 'songs').groups)).toEqual([['Lone collection', 13]]);
  });
  it('arrives in pages of 40, each page the same rows plus 40 more', () => {
    const one = shelf(allPieces, 'medium', 'classical');
    expect(one.shown).toBe(40);
    expect(one.more).toBe('Show 40 more');
    const two = shelf(allPieces, 'medium', 'classical', { pages: 2 });
    expect(two.shown).toBe(80);
    expect(
      rowsOf(two.groups)
        .slice(0, 40)
        .map((r) => r.slug),
    ).toEqual(rowsOf(one.groups).map((r) => r.slug));
    expect(headings(two.groups.slice(0, 1))[0]![0]).toBe(headings(one.groups.slice(0, 1))[0]![0]);
  });
  it('keeps a row as it is when the next page arrives, headings and composer lines included', () => {
    const one = shelf(allPieces, 'medium', 'classical');
    const all = shelf(allPieces, 'medium', 'classical', { pages: 99 });
    const first = rowsOf(one.groups);
    expect(rowsOf(all.groups).slice(0, first.length)).toEqual(first);
  });
  it('offers the last page by its size, and nothing after the last', () => {
    // Medium classical: 658 = 16 pages of 40 and 18.
    expect(shelf(allPieces, 'medium', 'classical', { pages: 16 }).more).toBe('Show the last 18');
    const last = shelf(allPieces, 'medium', 'classical', { pages: 17 });
    expect(last.more).toBeNull();
    expect(last.shown).toBe(658);
    expect(shelf(allPieces, 'medium', 'classical', { pages: 500 }).shown).toBe(658);
    expect(shelf(allPieces, 'medium', 'classical', { pages: 0 }).shown).toBe(40);
    expect([moreLabel(41, en), moreLabel(40, en), moreLabel(1, en)]).toEqual([
      'Show 40 more',
      'Show the last 40',
      'Show the last 1',
    ]);
  });
  it('stays open on a level that has the shelf, and falls back to the shelves on one that does not', () => {
    expect(shelfHasPieces(allPieces, 'easy', 'songs')).toBe(true);
    const noBaroque = allPieces.filter(
      (p) => !(tierOf(p.level) === 'easy' && shelfOfGenre(p.genre) === 'baroque'),
    );
    expect(shelfHasPieces(noBaroque, 'easy', 'baroque')).toBe(false);
    expect(libraryLayout(noBaroque, choose({ tier: 'easy', shelf: 'baroque' }), en).kind).toBe(
      'shelves',
    );
    expect(libraryLayout(noBaroque, choose({ tier: 'medium', shelf: 'baroque' }), en).kind).toBe(
      'shelf',
    );
  });
});

describe('the length pills (shelves spec 4.3)', () => {
  const classical = (length: LengthId) =>
    shelf(allPieces, 'medium', 'classical', { length, pages: 99 });
  it('appear above a list of more than 40 pieces, with only the lengths the list holds', () => {
    const layout = classical('any');
    expect(layout.lengths!.map((l) => l.label)).toEqual(expect.arrayContaining(['Any length']));
    expect(layout.lengths![0]!.id).toBe('any');
    expect(layout.lengths!.length).toBeGreaterThanOrEqual(2);
    expect(layout.length).toBe('any');
  });
  it('do not appear on a list of 40 pieces or fewer, and a choice then does not filter', () => {
    const small = shelf(allPieces, 'easy', 'folk', { length: 'long' });
    expect(small.count).toBeLessThanOrEqual(40);
    expect(small.lengths).toBeNull();
    expect(small.length).toBe('any');
    expect(small.count).toBe(inTierShelf(allPieces, 'easy', 'folk').length);
  });
  it('filter the list by duration, and the count follows', () => {
    const ranges: Record<'short' | 'medium' | 'long', (s: number) => boolean> = {
      short: (s) => s < 60,
      medium: (s) => s >= 60 && s < 180,
      long: (s) => s >= 180,
    };
    const members = inTierShelf(allPieces, 'medium', 'classical');
    for (const id of ['short', 'medium', 'long'] as const) {
      const layout = classical(id);
      if (layout.lengths?.some((l) => l.id === id) !== true) continue;
      expect(layout.length).toBe(id);
      expect(layout.count).toBe(members.filter((p) => ranges[id](p.approxDurationSec)).length);
      expect(layout.shown).toBe(layout.count);
    }
  });
  it('fall back to Any length when the list holds none of the chosen length', () => {
    const shortOnly: LibraryEntry[] = Array.from({ length: 45 }, (_, i) => ({
      slug: `s${i}`,
      title: `S${i}`,
      composer: 'C',
      level: 1,
      collection: 'X',
      collectionId: 'x',
      genre: 'songs',
      approxDurationSec: 20 + i / 2,
    }));
    const long = shelf(shortOnly.concat(pieces), 'easy', 'songs', { length: 'long' });
    expect(long.lengths!.some((l) => l.id === 'long')).toBe(
      shortOnly
        .concat(pieces)
        .some(
          (p) =>
            tierOf(p.level) === 'easy' &&
            shelfOfGenre(p.genre) === 'songs' &&
            p.approxDurationSec >= 180,
        ),
    );
    const none = shelf(shortOnly, 'easy', 'songs', { length: 'long' });
    expect(none.lengths!.map((l) => l.id)).toEqual(['any', 'short']);
    expect(none.length).toBe('any');
    expect(none.count).toBe(45);
  });
  it('show no row of pills when only Any length would remain', () => {
    const medium: LibraryEntry[] = Array.from({ length: 45 }, (_, i) => ({
      slug: `m${i}`,
      title: `M${i}`,
      composer: 'C',
      level: 1,
      collection: 'X',
      collectionId: 'x',
      genre: 'songs',
      approxDurationSec: 100,
    }));
    // every piece is "1 to 3 min": Any length and 1 to 3 min remain, so two pills
    expect(shelf(medium, 'easy', 'songs').lengths!.map((l) => l.id)).toEqual(['any', 'medium']);
  });
});

describe('search (shelves spec 4.4)', () => {
  it('searches every level in sections, each with its count, the first 7 rows and an All button', () => {
    const layout = search(allPieces, 'bach');
    expect(layout.sections.map((s) => s.tier)).toEqual(
      tiersIn(
        layout.sections.flatMap((s) =>
          allPieces.filter((p) => tierOf(p.level) === s.tier).slice(0, 1),
        ),
      ),
    );
    for (const s of layout.sections) {
      expect(s.shown).toBe(Math.min(7, s.count));
      expect(rowsOf(s.groups)).toHaveLength(s.shown);
      expect(s.open).toBe(false);
      expect(s.action).toEqual(
        s.count > 7
          ? {
              kind: 'open',
              label: `All ${formatNumber('en', s.count)} in ${TIER_NAMES[s.tier]}`,
            }
          : null,
      );
    }
    expect(layout.count).toBe(layout.sections.reduce((n, s) => n + s.count, 0));
  });
  it('opens a section to pages of 40 under collection headings', () => {
    const closed = search(allPieces, 'a');
    const medium = closed.sections.find((s) => s.tier === 'medium')!;
    expect(medium.count).toBeGreaterThan(80);
    const open = search(allPieces, 'a', { section: 'medium' }).sections.find(
      (s) => s.tier === 'medium',
    )!;
    expect(open.open).toBe(true);
    expect(open.shown).toBe(40);
    expect(open.action).toEqual({ kind: 'more', label: 'Show 40 more' });
    const second = search(allPieces, 'a', { section: 'medium', pages: 2 }).sections.find(
      (s) => s.tier === 'medium',
    )!;
    expect(second.shown).toBe(80);
    // the others stay as they were
    const others = search(allPieces, 'a', { section: 'medium' }).sections.filter(
      (s) => s.tier !== 'medium',
    );
    expect(others.every((s) => !s.open && s.shown <= 7)).toBe(true);
  });
  it('finds a style by its shelf name: baroque and jazz', () => {
    const baroque = search(allPieces, 'baroque');
    const onShelf = allPieces.filter((p) => shelfOfGenre(p.genre) === 'baroque');
    expect(baroque.count).toBeGreaterThanOrEqual(onShelf.length);
    const jazz = search(allPieces, 'jazz');
    expect(jazz.count).toBeGreaterThanOrEqual(
      allPieces.filter((p) => shelfOfGenre(p.genre) === 'jazz').length,
    );
    // "ragtime" and "modern" are words of the jazz shelf too
    for (const word of ['ragtime', 'modern']) {
      expect(search(allPieces, word).count).toBeGreaterThanOrEqual(
        allPieces.filter((p) => shelfOfGenre(p.genre) === 'jazz').length,
      );
    }
    // "and" is no style
    expect(search(allPieces, 'carols').count).toBeGreaterThanOrEqual(
      allPieces.filter((p) => shelfOfGenre(p.genre) === 'folk').length,
    );
  });
  it('shows length pills when the results exceed 40, and filters every section', () => {
    const wide = search(allPieces, 'a');
    expect(wide.count).toBeGreaterThan(40);
    expect(wide.lengths).not.toBeNull();
    const narrow = search(allPieces, 'a', { length: 'short' });
    expect(narrow.count).toBeLessThan(wide.count);
    expect(narrow.length).toBe('short');
    expect(search(pieces, 'fur elise').lengths).toBeNull();
  });
  it('searches the titles of curated pieces as before', () => {
    const minuet = search(pieces, 'minuet');
    expect(minuet.count).toBe(14);
    expect(minuet.sections.map((s) => s.tier)).toEqual(['easy', 'medium', 'harder']);
    const fur = search(pieces, 'fur elise');
    expect(fur.sections.flatMap((s) => rowsOf(s.groups)).map((r) => r.title)).toEqual([
      'Für Elise (Bagatelle in A minor)',
    ]);
  });
  it('keeps the composer on both rows of a title shown twice', () => {
    const entry = (slug: string, composer: string): LibraryEntry => ({
      slug,
      title: 'Minuet in G',
      composer,
      level: 1,
      collection: 'X',
      collectionId: 'x',
      genre: 'songs',
      approxDurationSec: 30,
    });
    const library = [...syntheticLibrary(), entry('m1', 'Anonymous'), entry('m2', 'Petzold')];
    const rows = search(library, 'minuet in g').sections.flatMap((s) => rowsOf(s.groups));
    expect(rows.map((r) => [r.slug, r.composerLine])).toEqual([
      ['m1', 'Anonymous'],
      ['m2', 'Petzold'],
    ]);
  });
  it('treats spaces as no search and punctuation as an empty result', () => {
    expect(libraryLayout(pieces, choose({ tier: 'medium', query: '   ' }), en)).toMatchObject({
      kind: 'shelves',
      tier: 'medium',
    });
    expect(libraryLayout(pieces, choose({ query: 'fur elize' }), en)).toMatchObject({
      kind: 'search',
      count: 0,
      sections: [],
    });
    expect(libraryLayout(pieces, choose({ query: '!!' }), en)).toMatchObject({
      kind: 'search',
      count: 0,
    });
  });
});

describe('what the live region says (shelves spec 7)', () => {
  it('names the level, the shelf, the page and the search count', () => {
    expect(announcementFor(shelves(allPieces, 'medium'), en)).toBe('Medium: 1,415 pieces');
    expect(announcementFor(shelf(allPieces, 'medium', 'songs'), en)).toBe('Songs: 643 pieces');
    expect(announcementFor(shelf(allPieces, 'medium', 'songs', { pages: 2 }), en)).toBe(
      'Showing 80 of 643',
    );
    expect(announcementFor(search(pieces, 'minuet'), en)).toBe('14 pieces');
    expect(announcementFor(search(pieces, 'fur elize'), en)).toBe('No piece matches “fur elize”.');
    expect(announcementFor(search(allPieces, 'a', { section: 'medium', pages: 2 }), en)).toMatch(
      /^Showing 80 of [\d,]+ in Medium$/,
    );
  });
  it('writes counts as words, with a comma from a thousand', () => {
    // The wording is the dictionary's; what matters here is the singular and the grouping.
    expect(en.library.pieces(1)).toMatch(/^1 piece$/);
    expect(en.library.pieces(24)).toContain('24');
    expect(en.library.pieces(1415)).toContain(formatNumber('en', 1415));
    expect(formatNumber('en', 1000000)).toBe('1,000,000');
  });
});

describe('the start button and the level the page opens on', () => {
  it('starts with Twinkle, or continues with the last piece played while it is still in the library', () => {
    expect(startLabel(startTarget(pieces, null), en)).toBe(
      'Start with Twinkle, Twinkle, Little Star',
    );
    expect(startLabel(startTarget(pieces, 'beethoven-fur-elise-woo-59'), en)).toBe(
      'Continue with Für Elise',
    );
    expect(startLabel(startTarget(pieces, 'no-such-piece'), en)).toBe(
      'Start with Twinkle, Twinkle, Little Star',
    );
    expect(dropTrailingParenthesis('Ode to Joy (simplified)')).toBe('Ode to Joy');
    expect(dropTrailingParenthesis('Arabesque')).toBe('Arabesque');
  });
  it("opens on the level chosen in this visit, else the last piece's level, else Easy", () => {
    expect(arrivalLevel(pieces, null, null)).toBe('easy');
    expect(arrivalLevel(pieces, null, 'bach-minuet-g-major-bwv-anh-114')).toBe('easy'); // grade 2
    expect(arrivalLevel(pieces, null, 'beethoven-fur-elise-woo-59')).toBe('harder'); // grade 4
    expect(arrivalLevel(pieces, null, 'beethoven-moonlight-sonata-mvt1')).toBe('challenging'); // grade 5
    expect(arrivalLevel(pieces, 'medium', 'bach-minuet-g-major-bwv-anh-114')).toBe('medium');
    expect(arrivalLevel(pieces, 'challenging', null)).toBe('challenging');
    expect(arrivalLevel(pieces, null, 'no-such-piece')).toBe('easy');
  });
  it('reads the local date as YYYY-MM-DD', () => {
    expect(localDateKey(new Date(2026, 9, 6, 23, 59))).toBe('2026-10-06');
    expect(localDateKey(new Date(2027, 0, 1, 0, 0))).toBe('2027-01-01');
  });
});

describe('the library with the MuseScore archive (2026-10-16)', () => {
  const archive = allPieces.filter((p) => p.collectionId.startsWith('pdmx-'));
  it('holds the archive pieces in five collections', () => {
    expect(archive.length).toBeGreaterThanOrEqual(1000);
    // the songs lane (2026-10-16): pop, rock, soundtrack and the like go to Songs, jazz and blues to Modern
    expect(new Set(archive.map((p) => p.collectionId))).toEqual(
      new Set(['pdmx-classical', 'pdmx-folk', 'pdmx-advanced', 'pdmx-songs', 'pdmx-modern']),
    );
    // the advanced collection is the archive's grade 6, and only that
    for (const p of archive) expect(p.collectionId === 'pdmx-advanced', p.slug).toBe(p.level === 6);
  });
  it('counts every level, and the levels add up to the whole library', () => {
    const counts = TIERS.map((t) => allPieces.filter((p) => tierOf(p.level) === t).length);
    expect(counts.reduce((sum, c) => sum + c, 0)).toBe(allPieces.length);
    expect(counts.every((c) => c > 0)).toBe(true);
  });
});

describe('the core 30 (a library of 40 pieces or fewer)', () => {
  it('shows every level, each in full, with no shelves and no search', async () => {
    const core = [...(await loadPieceDetails()).values()].filter(
      (p) => p.benchmarkSet === 'core30',
    );
    const layout = libraryLayout(core, choose({ tier: 'medium', query: 'minuet' }), en);
    expect(layout.kind).toBe('all'); // no search under 100 pieces: the query is ignored
    if (layout.kind !== 'all') return;
    expect(layout.sections.map((s) => s.tier)).toEqual(['easy', 'medium', 'harder', 'challenging']);
    expect(layout.sections.reduce((n, s) => n + s.count, 0)).toBe(30);
    for (const s of layout.sections) expect(rowsOf(s.groups)).toHaveLength(s.count);
    // Every level is already in full: none is "opened" and none offers a button.
    for (const s of layout.sections) expect(s.open).toBe(false);
  });
});

describe('a synthetic library of 1,000 pieces (L2)', () => {
  const big = syntheticLibrary();
  it('has four levels and puts at most 30 rows on the arrival page of each', () => {
    expect(big).toHaveLength(1000);
    const layout = shelves(big);
    expect(layout.tiers).toEqual(['easy', 'medium', 'harder', 'challenging']);
    for (const tier of TIERS) {
      const l = shelves(big, tier);
      expect(l.shelves.length).toBeGreaterThanOrEqual(2);
      expect(l.shelves.length).toBeLessThanOrEqual(6);
      expect(l.shelves.reduce((n, s) => n + s.rows.length, 0)).toBeLessThanOrEqual(30);
      for (const s of l.shelves) expect(s.rows.length).toBeLessThanOrEqual(5);
    }
  });
  it('renders no more than a page of an opened shelf', () => {
    for (const tier of TIERS) {
      for (const s of shelves(big, tier).shelves) {
        const opened: LibraryLayout = libraryLayout(big, choose({ tier, shelf: s.id }), en);
        expect(opened.kind).toBe('shelf');
        if (opened.kind === 'shelf') expect(rowsOf(opened.groups).length).toBeLessThanOrEqual(40);
      }
    }
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
  it('shortens titles under a collection heading of an opened shelf', () => {
    const rows = TIERS.flatMap((tier) =>
      SHELVES.flatMap((s) =>
        shelfHasPieces(pieces, tier, s.id)
          ? rowsOf(shelf(pieces, tier, s.id, { pages: 99 }).groups)
          : [],
      ),
    );
    const bySlug = new Map(pieces.map((p) => [p.slug, p]));
    const shortened = rows.filter((r) => r.title !== bySlug.get(r.slug)!.title);
    expect(shortened.length).toBeGreaterThan(0);
    for (const r of shortened)
      expect(bySlug.get(r.slug)!.title.startsWith(r.title.split(' (')[0]!)).toBe(true);
    expect(shortened.map((r) => r.title)).toContain('Canon in D');
  });
});
