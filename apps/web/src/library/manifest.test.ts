import { describe, expect, it } from 'vitest';
import {
  attribution,
  formatDuration,
  isShareAlike,
  LEVEL_NAMES,
  licenseLabel,
  pieceBySlug,
  pieces,
  recommendedPiece,
  scoreUrl,
} from './manifest.js';

describe('manifest', () => {
  it('has 30 pieces across five levels, sorted by level', () => {
    expect(pieces).toHaveLength(30);
    expect(new Set(pieces.map((p) => p.level))).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(pieces.map((p) => p.level)).toEqual(
      [...pieces.map((p) => p.level)].sort((a, b) => a - b),
    );
    expect(Object.keys(LEVEL_NAMES)).toHaveLength(5);
  });
  it('recommends the first level-1 piece', () => {
    expect(recommendedPiece().slug).toBe('twinkle-twinkle-little-star');
  });
  it('resolves a score path to a URL', async () => {
    const url = await scoreUrl(pieceBySlug('twinkle-twinkle-little-star')!.files.score);
    expect(url).toMatch(/twinkle-twinkle-little-star/);
  });
  it('marks exactly the five share-alike engravings and credits their typesetters', () => {
    const sa = pieces.filter(isShareAlike);
    expect(sa.map((p) => p.slug).sort()).toEqual([
      'bach-invention-no1-bwv-772',
      'beethoven-moonlight-sonata-mvt1',
      'mozart-sonata-k545-mvt1',
      'schumann-op68-no1-melody',
      'schumann-op68-no8-wild-rider',
    ]);
    for (const p of sa) {
      const a = attribution(p);
      expect(a.text).toContain(p.source.typesetter);
      expect(a.text).toContain('CC BY-SA');
      expect(a.url).toBe(p.source.licenseUrl);
    }
  });
  it('formats durations and licence ids', () => {
    expect(formatDuration(29)).toBe('0:29');
    expect(formatDuration(132.3)).toBe('2:12');
    expect(licenseLabel('CC-BY-SA-2.5')).toBe('CC BY-SA 2.5');
    expect(licenseLabel('CC0-1.0')).toBe('CC0 1.0');
    expect(attribution(recommendedPiece()).text).toBe('digitus2 arrangement, CC0 (public domain)');
  });
});
