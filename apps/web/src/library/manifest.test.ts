import { describe, expect, it } from 'vitest';
import manifestJson from '../../../../content/manifest.json';
import { GENRES } from './levels.js';
import {
  attribution,
  formatDuration,
  isShareAlike,
  LEVEL_NAMES,
  licenseLabel,
  pieceBySlug,
  pieces,
  requiresCredit,
  scoreUrl,
} from './manifest.js';
import { startTarget } from './model.js';

/** The piece a first visit starts with (the red button, model.ts), as a library piece. */
const firstPiece = () => pieceBySlug(startTarget(pieces, null).piece.slug)!;

describe('manifest', () => {
  it('lists every manifest piece across five levels, sorted by level, with unique slugs', () => {
    expect(pieces).toHaveLength((manifestJson as unknown[]).length);
    expect(new Set(pieces.map((p) => p.slug)).size).toBe(pieces.length);
    expect(new Set(pieces.map((p) => p.level))).toEqual(new Set([1, 2, 3, 4, 5]));
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
  it('keeps the 30 pieces of the first library as the benchmark set and gives every piece a collection', () => {
    expect(pieces.filter((p) => p.benchmarkSet === 'core30')).toHaveLength(30);
    for (const p of pieces) {
      expect(p.collection.length, p.slug).toBeGreaterThan(0);
      expect(p.collectionId, p.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
  it('gives every piece a known genre', () => {
    const ids = new Set(GENRES.map((g) => g.id));
    for (const p of pieces) expect(ids.has(p.genre), p.slug).toBe(true);
  });
  it('starts a first visit with the first level-1 piece', () => {
    expect(firstPiece().slug).toBe('twinkle-twinkle-little-star');
  });
  it('resolves a score path to a URL', async () => {
    const url = await scoreUrl(pieceBySlug('twinkle-twinkle-little-star')!.files.score);
    expect(url).toMatch(/twinkle-twinkle-little-star/);
  });
  it('credits every CC BY and CC BY-SA engraving with its typesetter and licence', () => {
    for (const p of pieces.filter(requiresCredit)) {
      const a = attribution(p);
      expect(a.text).toContain(p.source.typesetter);
      expect(a.text).toContain(licenseLabel(p.source.license));
      expect(a.url).toBe(p.source.licenseUrl);
    }
  });
  it('calls only public-domain engravings public domain', () => {
    const k2 = pieceBySlug('mozart-minuet-f-major-k2')!;
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
  it('still marks the five share-alike engravings of the first library', () => {
    expect(
      pieces
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
  it('formats durations and licence ids', () => {
    expect(formatDuration(29)).toBe('0:29');
    expect(formatDuration(132.3)).toBe('2:12');
    expect(licenseLabel('CC-BY-SA-2.5')).toBe('CC BY-SA 2.5');
    expect(licenseLabel('CC0-1.0')).toBe('CC0 1.0');
    expect(attribution(firstPiece()).text).toBe('digitus2 arrangement, CC0 (public domain)');
  });
});
