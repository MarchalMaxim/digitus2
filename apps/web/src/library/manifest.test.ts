import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import manifestJson from '../../../../content/manifest.json';
import { GENRES } from './levels.js';
import {
  attribution,
  decodeLibraryIndex,
  formatDuration,
  isShareAlike,
  LEVEL_NAMES,
  libraryPieces,
  type LibraryIndexFile,
  type LibraryPiece,
  licenseLabel,
  loadPiece,
  loadPieceDetails,
  pieceBySlug,
  readScoreFile,
  requiresCredit,
  scoreUrl,
} from './manifest.js';
import { startTarget } from './model.js';

/** The library list (test/setup.ts sets it). */
const pieces = libraryPieces();

/** The piece a first visit starts with (the red button, model.ts), as a full library piece. */
const firstPiece = async () => (await loadPiece(startTarget(pieces, null).piece.slug))!;

/** Every piece's full entry (content/manifest.json), in manifest order. */
const allDetails = async (): Promise<LibraryPiece[]> => [...(await loadPieceDetails()).values()];

describe('manifest', () => {
  it('lists every manifest piece across six levels, sorted by level, with unique slugs', () => {
    expect(pieces).toHaveLength((manifestJson as unknown[]).length);
    expect(new Set(pieces.map((p) => p.slug)).size).toBe(pieces.length);
    expect(new Set(pieces.map((p) => p.level))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect(pieces.map((p) => p.level)).toEqual(
      [...pieces.map((p) => p.level)].sort((a, b) => a - b),
    );
    expect(LEVEL_NAMES).toEqual({
      1: 'First steps',
      2: 'Easy',
      3: 'Moderate',
      4: 'Intermediate',
      5: 'Challenging',
      6: 'Advanced',
    });
  });
  it('keeps the 30 pieces of the first library as the benchmark set and gives every piece a collection', async () => {
    const details = await allDetails();
    expect(details.filter((p) => p.benchmarkSet === 'core30')).toHaveLength(30);
    for (const p of pieces) {
      expect(p.collection.length, p.slug).toBeGreaterThan(0);
      expect(p.collectionId, p.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
  it('gives every piece a known genre', () => {
    const ids = new Set(GENRES.map((g) => g.id));
    for (const p of pieces) expect(ids.has(p.genre), p.slug).toBe(true);
  });
  it('starts a first visit with the first level-1 piece', async () => {
    expect((await firstPiece()).slug).toBe('twinkle-twinkle-little-star');
  });
  it('the library index matches the manifest, piece for piece', async () => {
    const details = await allDetails();
    expect(pieces.map((p) => p.slug)).toEqual(details.map((p) => p.slug));
    for (const [i, p] of pieces.entries()) {
      expect(p.title, p.slug).toBe(details[i]!.title);
      expect(p.level, p.slug).toBe(details[i]!.level);
    }
  });
  it('decodes the compact library index to the eight list fields of every manifest piece', async () => {
    const details = await allDetails();
    for (const [i, p] of pieces.entries()) {
      const d = details[i]!;
      expect(p, p.slug).toEqual({
        slug: d.slug,
        title: d.title,
        composer: d.composer,
        level: d.level,
        collection: d.collection,
        collectionId: d.collectionId,
        genre: d.genre,
        approxDurationSec: d.approxDurationSec,
      });
    }
  });
  it('decodes a columnar index: collections once, archive slugs rebuilt from the title, genre overrides', () => {
    const file: LibraryIndexFile = {
      v: 2,
      collections: [
        ['hymns', 'Hymns and spirituals', 'carols'],
        ['pdmx-songs', 'Songs from the MuseScore archive', 'songs'],
      ],
      pieces: {
        slug: ['amazing-grace', '-0f933bca', '-00000001', '-00000002'],
        title: [
          'Amazing Grace',
          'Someone You Loved',
          'A very long title that goes on and on and on, past forty characters',
          '!?',
        ],
        composer: ['Traditional', 'Lewis Capaldi', 'Unknown', 'Unknown'],
        level: [1, 3, 4, 4],
        collection: [0, 1, 1, 1],
        duration: [58, 132, 90, 12],
      },
      genres: { '3': 'modern' },
    };
    const entries = decodeLibraryIndex(file);
    expect(entries.map((e) => e.slug)).toEqual([
      'amazing-grace',
      'pdmx-someone-you-loved-0f933bca',
      'pdmx-a-very-long-title-that-goes-on-and-on-an-00000001',
      'pdmx-untitled-00000002',
    ]);
    expect(entries[1]).toEqual({
      slug: 'pdmx-someone-you-loved-0f933bca',
      title: 'Someone You Loved',
      composer: 'Lewis Capaldi',
      level: 3,
      collection: 'Songs from the MuseScore archive',
      collectionId: 'pdmx-songs',
      genre: 'songs',
      approxDurationSec: 132,
    });
    expect(entries.map((e) => e.genre)).toEqual(['carols', 'songs', 'songs', 'modern']);
    expect(() => decodeLibraryIndex({ ...file, v: 1 })).toThrow(/version/);
  });
  it('finds a piece by its slug in the index and its full entry on demand', async () => {
    expect(pieceBySlug('twinkle-twinkle-little-star')?.title).toBe('Twinkle, Twinkle, Little Star');
    expect(pieceBySlug('no-such-piece')).toBeUndefined();
    expect(await loadPiece('no-such-piece')).toBeUndefined();
  });
  it('resolves a score path to a URL', async () => {
    const piece = (await loadPiece('twinkle-twinkle-little-star'))!;
    const url = await scoreUrl(piece.files.score);
    expect(url).toMatch(/twinkle-twinkle-little-star/);
  });
  it('reads an archive score whichever way the server answers: gzip bytes are decompressed, bytes it already decoded pass through', async () => {
    // The Vite servers send a .gz file with Content-Encoding: gzip, so the browser hands over plain
    // XML; a server that does not send that header hands over the gzip bytes.
    const xml = '<?xml version="1.0"?><score-partwise version="3.1"/>';
    const slug = pieces.find((p) => p.collectionId.startsWith('pdmx-'))!.slug;
    const path = `scores/${slug}.musicxml.gz`;
    const read = async (bytes: Uint8Array) =>
      new TextDecoder().decode(await readScoreFile(path, async () => bytes));
    expect(await read(new Uint8Array(gzipSync(Buffer.from(xml))))).toBe(xml);
    expect(await read(new TextEncoder().encode(xml))).toBe(xml);
  });
  it('credits every CC BY and CC BY-SA engraving with its typesetter and licence', async () => {
    for (const p of (await allDetails()).filter(requiresCredit)) {
      const a = attribution(p);
      expect(a.text).toContain(p.source.typesetter);
      expect(a.text).toContain(licenseLabel(p.source.license));
      expect(a.url).toBe(p.source.licenseUrl);
    }
  });
  it('calls only public-domain engravings public domain', async () => {
    const k2 = (await loadPiece('mozart-minuet-f-major-k2'))!;
    const byOnly = {
      ...k2,
      source: {
        ...k2.source,
        license: 'CC-BY-2.5',
        licenseUrl: 'https://creativecommons.org/licenses/by/2.5/',
      },
    };
    expect(attribution(k2).text).toMatch(/public domain$/);
    expect(attribution(byOnly).text).toBe(
      `Engraving by ${k2.source.typesetter} for the Mutopia Project, CC BY 2.5`,
    );
    expect(attribution(byOnly).url).toBe('https://creativecommons.org/licenses/by/2.5/');
  });
  it('still marks the five share-alike engravings of the first library', async () => {
    expect(
      (await allDetails())
        .filter((p) => isShareAlike(p) && p.benchmarkSet === 'core30')
        .map((p) => p.slug)
        .sort(),
    ).toEqual([
      'bach-invention-no1-bwv-772',
      'beethoven-moonlight-sonata-mvt1',
      'mozart-sonata-k545-mvt1',
      'schumann-op68-no1-melody',
      'schumann-op68-no8-wild-rider',
    ]);
  });
  it('formats durations and licence ids', async () => {
    expect(formatDuration(29)).toBe('0:29');
    expect(formatDuration(132.3)).toBe('2:12');
    expect(licenseLabel('CC-BY-SA-2.5')).toBe('CC BY-SA 2.5');
    expect(licenseLabel('CC0-1.0')).toBe('CC0 1.0');
    expect(attribution(await firstPiece()).text).toBe('digitus2 arrangement, CC0 (public domain)');
  });
});
