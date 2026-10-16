/**
 * The library's levels and genres: the names and lines the page shows (spec sections 4.1, 4.2).
 * Plain TypeScript with no Vite imports, so the Playwright helpers import it too.
 */
export type Level = 1 | 2 | 3 | 4 | 5 | 6;

export const LEVELS: readonly Level[] = [1, 2, 3, 4, 5, 6];

/** One name per level, everywhere: pill, heading, search result heading, side panel. */
export const LEVEL_NAMES: Record<Level, string> = {
  1: 'First steps',
  2: 'Easy',
  3: 'Moderate',
  4: 'Intermediate',
  5: 'Challenging',
  6: 'Advanced',
};

/** What the chosen level asks of the hands: the gray line under the pills. */
export const LEVEL_LINES: Record<Level, string> = {
  1: 'Each hand stays in one place.',
  2: 'The hands begin to move.',
  3: 'More notes and wider reaches.',
  4: 'Faster runs and reaches of an octave.',
  5: 'Fast passages, leaps and full chords.',
  6: 'Concert pieces for a complete technique.',
};

export type GenreId =
  'songs' | 'carols' | 'baroque' | 'classical' | 'romantic' | 'ragtime' | 'modern' | 'folk';

export interface Genre {
  id: GenreId;
  label: string;
  line: string;
}

/** The genres in display order; the ids equal content/tools/catalog.json's `genres`. */
export const GENRES: readonly Genre[] = [
  { id: 'songs', label: 'Songs', line: 'Well-known tunes, arranged for the piano.' },
  { id: 'carols', label: 'Carols and hymns', line: 'Christmas carols, hymns and spirituals.' },
  { id: 'baroque', label: 'Baroque', line: 'Bach, Handel and others, 1600–1750.' },
  { id: 'classical', label: 'Classical', line: 'Mozart, Clementi and others, 1750–1820.' },
  { id: 'romantic', label: 'Romantic', line: 'Schumann, Chopin and others, 1820–1900.' },
  { id: 'ragtime', label: 'Ragtime', line: 'Scott Joplin and others, around 1900.' },
  { id: 'modern', label: 'Modern', line: 'Music written since 1900.' },
  { id: 'folk', label: 'Folk and traditional', line: 'Folk tunes and dances, mostly traditional.' },
];

export function isLevel(value: unknown): value is Level {
  return typeof value === 'number' && (LEVELS as readonly number[]).includes(value);
}
