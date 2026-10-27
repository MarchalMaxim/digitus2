import { readFileSync, writeFileSync } from 'node:fs';
import { countEditorDigits, MANIFEST_PATH, readManifest } from './libraryPieces.js';

/**
 * Writes `editorDigits` into content/manifest.json for every entry with an editorial fingering
 * (issue 94): the digits the source edition prints on the plain score, counted by
 * `src/readability/editorDigits.ts` as the reduction's gate counts them. The app reads the number
 * from the manifest because the `.fingered` file loads lazily. The field goes right after
 * `hasEditorialFingering`; nothing else in the file changes, so the script can run again.
 *
 *   pnpm --filter @digitus2/engine exec tsx cli/editorDigits.ts
 */
const text = readFileSync(MANIFEST_PATH, 'utf8');
const entries = readManifest();
const editorial = entries.filter((e) => e.hasEditorialFingering);

// The file is edited as text: its numbers are written the way the content tools write them
// (`92.0`), so a JSON round trip would rewrite lines that have nothing to do with this field.
const FLAG = / {4}"hasEditorialFingering": true,(\r?\n)/g;
const bare = text.replace(/ {4}"editorDigits": \d+,\r?\n/g, '');
let next = 0;
const out = bare.replace(FLAG, (line, eol: string) => {
  const entry = editorial[next++]!;
  const count = countEditorDigits(entry);
  if (count === null) throw new Error(`${entry.slug} has an editorial fingering but no file`);
  if (count.unmatched > 0)
    console.warn(`${entry.slug}: ${count.unmatched} editorial digits sit on no note of the score`);
  return `${line}    "editorDigits": ${count.digits},${eol}`;
});
if (next !== editorial.length)
  throw new Error(`${next} editorial lines in the text, ${editorial.length} entries`);
const check = JSON.parse(out) as Array<{ slug: string; editorDigits?: number }>;
if (check.length !== entries.length) throw new Error('the entry count changed');
writeFileSync(MANIFEST_PATH, out);
console.log(`editorDigits written for ${next} pieces`);
