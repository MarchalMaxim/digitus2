import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Pieces in the built-in library (content/manifest.json), so the flows follow its growth. */
const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../content/manifest.json', import.meta.url)),
    'utf8',
  ),
) as Array<{ source?: { license?: string } }>;

export const LIBRARY_COUNT = manifest.length;

/** Engravings that owe a credit: share-alike (CC BY-SA) and attribution-only (CC BY), as the About page counts them. */
export const LICENSE_COUNTS = {
  shareAlike: manifest.filter((p) => (p.source?.license ?? '').startsWith('CC-BY-SA')).length,
  attributionOnly: manifest.filter((p) => /^CC-BY-\d/.test(p.source?.license ?? '')).length,
};
