import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { benchmarkEntries, CORE_BENCHMARK_SET } from './benchmarkSet.js';

const CORE30 = [
  'amazing-grace',
  'bach-invention-no1-bwv-772',
  'bach-minuet-g-major-bwv-anh-114',
  'bach-minuet-g-minor-bwv-anh-115',
  'bach-prelude-c-major-bwv-846',
  'beethoven-fur-elise-woo-59',
  'beethoven-moonlight-sonata-mvt1',
  'burgmuller-op100-no1-la-candeur',
  'burgmuller-op100-no2-arabesque',
  'burgmuller-op100-no3-pastorale',
  'burgmuller-op100-no5-innocence',
  'chopin-prelude-op28-no4',
  'chopin-prelude-op28-no7',
  'chopin-waltz-op69-no2',
  'clementi-sonatina-op36-no1-mvt1',
  'frere-jacques',
  'greensleeves',
  'happy-birthday',
  'jingle-bells',
  'joplin-the-entertainer',
  'mary-had-a-little-lamb',
  'mozart-minuet-f-major-k2',
  'mozart-sonata-k545-mvt1',
  'ode-to-joy',
  'pachelbel-canon-in-d',
  'satie-gymnopedie-no1',
  'scarborough-fair',
  'schumann-op68-no1-melody',
  'schumann-op68-no8-wild-rider',
  'twinkle-twinkle-little-star',
];
const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../content/manifest.json', import.meta.url)),
    'utf8',
  ),
) as Array<{ slug: string; benchmarkSet?: string | null }>;
const tagged = [
  { slug: 'a', benchmarkSet: 'core30' },
  { slug: 'b', benchmarkSet: null },
  { slug: 'c' },
];

describe('benchmarkEntries', () => {
  it('keeps exactly the 30 pieces of the first library from the built-in manifest', () => {
    expect(CORE_BENCHMARK_SET).toBe('core30');
    expect(
      benchmarkEntries(manifest)
        .map((e) => e.slug)
        .sort(),
    ).toEqual(CORE30);
  });
  it('treats a missing benchmarkSet like null and keeps manifest order', () => {
    expect(benchmarkEntries(tagged).map((e) => e.slug)).toEqual(['a']);
  });
  it('returns every piece for "all" and for a manifest without benchmark sets', () => {
    expect(benchmarkEntries(tagged, 'all').map((e) => e.slug)).toEqual(['a', 'b', 'c']);
    expect(benchmarkEntries([{ slug: 'x' }, { slug: 'y' }]).map((e) => e.slug)).toEqual(['x', 'y']);
  });
  it('refuses a set that no piece belongs to', () => {
    expect(() => benchmarkEntries(tagged, 'core31')).toThrow(/core31/);
  });
});
