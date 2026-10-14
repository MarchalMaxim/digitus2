import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Pieces in the built-in library (content/manifest.json), so the flows follow its growth. */
export const LIBRARY_COUNT = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../../content/manifest.json', import.meta.url)),
      'utf8',
    ),
  ) as unknown[]
).length;
