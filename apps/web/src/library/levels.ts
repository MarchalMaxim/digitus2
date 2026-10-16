/**
 * The library's grades, levels, shelves and lengths: the names the page shows
 * (library shelves spec, sections 3, 4 and 9). Plain TypeScript with no Vite imports, so the
 * Playwright helpers import it too.
 */

/** The manifest's `level` field: how hard the content tools graded a piece, 1 to 6. Data only. */
export type Grade = 1 | 2 | 3 | 4 | 5 | 6;

export const GRADES: readonly Grade[] = [1, 2, 3, 4, 5, 6];

export function isGrade(value: unknown): value is Grade {
  return typeof value === 'number' && (GRADES as readonly number[]).includes(value);
}

/** What the reader sees as the level: four, mapped from the six grades (spec section 3). */
export type Tier = 'easy' | 'medium' | 'harder' | 'challenging';

/** The tiers, easiest first. */
export const TIERS: readonly Tier[] = ['easy', 'medium', 'harder', 'challenging'];

/** One name per tier, everywhere: pill, search section heading, announcement, side panel. */
export const TIER_NAMES: Record<Tier, string> = {
  easy: 'Easy',
  medium: 'Medium',
  harder: 'Harder',
  challenging: 'Challenging',
};

/** Grades 1 and 2 are Easy, 3 is Medium, 4 is Harder, 5 and 6 are Challenging. */
export function tierOf(grade: Grade): Tier {
  return grade <= 2 ? 'easy' : grade === 3 ? 'medium' : grade === 4 ? 'harder' : 'challenging';
}

/**
 * A stored level read as a tier: a tier id, or a grade 1 to 6 saved by a build that had six
 * level pills. Anything else is null.
 */
export function toTier(value: unknown): Tier | null {
  if (isGrade(value)) return tierOf(value);
  return TIERS.find((t) => t === value) ?? null;
}

/** The catalog's genre ids (content/tools/catalog.json `genres`), in the catalog's order. */
export type GenreId =
  'songs' | 'carols' | 'baroque' | 'classical' | 'romantic' | 'ragtime' | 'modern' | 'folk';

export const GENRES: readonly { id: GenreId }[] = [
  { id: 'songs' },
  { id: 'carols' },
  { id: 'baroque' },
  { id: 'classical' },
  { id: 'romantic' },
  { id: 'ragtime' },
  { id: 'modern' },
  { id: 'folk' },
];

export type ShelfId = 'songs' | 'classical' | 'folk' | 'baroque' | 'romantic' | 'jazz';

export interface Shelf {
  id: ShelfId;
  name: string;
  /** The gray line under the name. */
  line: string;
  /** What the `All {n} …` button counts: "songs", "classical pieces". */
  noun: string;
}

/** The six shelves in display order: the well-known tunes first, the beginner's usual way in. */
export const SHELVES: readonly Shelf[] = [
  {
    id: 'songs',
    name: 'Songs',
    line: "Well-known tunes from children's songs to film and games.",
    noun: 'songs',
  },
  {
    id: 'classical',
    name: 'Classical',
    line: 'Mozart, Clementi, Czerny and the studies pianists grow up on.',
    noun: 'classical pieces',
  },
  {
    id: 'folk',
    name: 'Folk and carols',
    line: 'Folk tunes, dances, carols and hymns.',
    noun: 'folk tunes and carols',
  },
  {
    id: 'baroque',
    name: 'Baroque',
    line: 'Bach, Handel, Scarlatti and others, 1600 to 1750.',
    noun: 'baroque pieces',
  },
  {
    id: 'romantic',
    name: 'Romantic',
    line: 'Schumann, Chopin, Tchaikovsky and others, 1820 to 1900.',
    noun: 'romantic pieces',
  },
  {
    id: 'jazz',
    name: 'Jazz, ragtime and modern',
    line: "Joplin's rags and music written since 1900.",
    noun: 'jazz, ragtime and modern pieces',
  },
];

const SHELF_OF_GENRE: Record<GenreId, ShelfId> = {
  songs: 'songs',
  classical: 'classical',
  folk: 'folk',
  carols: 'folk',
  baroque: 'baroque',
  romantic: 'romantic',
  ragtime: 'jazz',
  modern: 'jazz',
};

/** The shelf a catalog genre sits on (spec section 4). */
export function shelfOfGenre(genre: GenreId): ShelfId {
  return SHELF_OF_GENRE[genre];
}

export function shelfById(id: ShelfId): Shelf {
  return SHELVES.find((s) => s.id === id)!;
}

export function isShelfId(value: unknown): value is ShelfId {
  return SHELVES.some((s) => s.id === value);
}

export type LengthId = 'any' | 'short' | 'medium' | 'long';

export interface Length {
  id: LengthId;
  label: string;
  /** The range in seconds: `from` up to but not including `to`. */
  from: number;
  to: number;
}

/** The length pills (spec 4.3), `Any length` first. */
export const LENGTHS: readonly Length[] = [
  { id: 'any', label: 'Any length', from: 0, to: Infinity },
  { id: 'short', label: 'Under 1 min', from: 0, to: 60 },
  { id: 'medium', label: '1 to 3 min', from: 60, to: 180 },
  { id: 'long', label: 'Over 3 min', from: 180, to: Infinity },
];
