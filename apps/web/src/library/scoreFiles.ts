/**
 * Every score file of the library as a lazy asset URL, keyed by its path from this file. One entry
 * per piece, so it grows with the library: manifest.ts loads this module only when a score opens
 * (a separate chunk), keeping it out of the start-up bundle.
 */
export const scoreFiles = import.meta.glob('../../../../content/scores/*.musicxml*', {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;
