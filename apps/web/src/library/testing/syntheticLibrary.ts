import { GRADES, type GenreId, type Grade } from '../levels.js';
import type { LibraryEntry } from '../model.js';

/**
 * A deterministic library shaped like L2 (1,000 pieces, grades 1 to 6, collections of 1 to 24
 * pieces), for tests of the rules at scale. Not imported by the app.
 */
export function syntheticLibrary(): LibraryEntry[] {
  const sizes: Record<Grade, number> = { 1: 120, 2: 230, 3: 240, 4: 180, 5: 130, 6: 100 };
  const pattern = [24, 12, 8, 5, 3, 2, 1];
  const genres: Record<Grade, GenreId[]> = {
    1: ['songs', 'carols'],
    2: ['songs', 'carols', 'baroque', 'romantic'],
    3: ['baroque', 'classical', 'romantic'],
    4: ['baroque', 'classical', 'romantic', 'modern'],
    5: ['baroque', 'classical', 'romantic', 'ragtime'],
    6: ['baroque', 'classical', 'romantic', 'modern'],
  };
  const out: LibraryEntry[] = [];
  let c = 0;
  for (const level of GRADES) {
    let left = sizes[level];
    for (let i = 0; left > 0; i++, c++) {
      const n = Math.min(left, pattern[i % pattern.length]!);
      const genre = genres[level][i % genres[level].length]!;
      for (let k = 0; k < n; k++) {
        out.push({
          slug: `c${c}-p${k}`,
          title: `Piece ${c}.${k + 1}`,
          composer: `Composer ${c % 40}`,
          level,
          collection: `Collection ${c}`,
          collectionId: `c${c}`,
          genre,
          approxDurationSec: 30 + ((c * 7 + k * 13) % 240),
        });
      }
      left -= n;
    }
  }
  return out;
}
