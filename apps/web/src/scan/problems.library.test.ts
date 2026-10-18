import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { findProblems } from './corrections.js';
import { parseScanXml, readScanScore } from './notes.js';

// Vitest runs from apps/web.
const content = join(process.cwd(), '../../content');
interface Entry {
  slug: string;
  benchmarkSet?: string | null;
  files: { score: string };
}
const manifest = JSON.parse(readFileSync(join(content, 'manifest.json'), 'utf8')) as Entry[];
// A missing field means core30; later pieces carry null.
const core30 = manifest.filter((entry) => (entry.benchmarkSet === undefined ? 'core30' : entry.benchmarkSet) === 'core30');

function read(entry: Entry): string {
  const bytes = readFileSync(join(content, entry.files.score));
  return (bytes[0] === 0x1f ? gunzipSync(bytes) : bytes).toString('utf8');
}

/**
 * The places-to-check rules must stay quiet on correct notation: the library's engravings are the
 * ground truth the scanning corpus is scored against, so every flag on them would be a false alarm.
 */
describe('places to check on correct scores', () => {
  it('finds nothing in the core 30 library pieces', () => {
    const flagged = core30
      .map((entry) => ({ slug: entry.slug, problems: findProblems(readScanScore(parseScanXml(read(entry)))) }))
      .filter((row) => row.problems.length);
    expect(flagged).toEqual([]);
  });
});
