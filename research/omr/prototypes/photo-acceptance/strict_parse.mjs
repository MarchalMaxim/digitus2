import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// Build the unchanged engine first: pnpm --filter @digitus2/engine build.
const { parseMusicXml } = await import(
  pathToFileURL(resolve('packages/engine/dist/src/index.js')).href
);
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: strict_parse.mjs RAW.musicxml OUTPUT.json');
const result = { recognitionExecuted: false, method: 'unchanged-engine-preserveNotation', input };
try {
  const parsed = parseMusicXml(new Uint8Array(await readFile(input)), { preserveNotation: true });
  result.parsed = true;
  result.notes = parsed.score.notes.length;
  result.measures = parsed.score.measures.length;
  result.warnings = parsed.warnings;
} catch (error) {
  result.parsed = false;
  result.error = String(error);
}
await writeFile(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
