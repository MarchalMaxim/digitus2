import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from './read.js';

const dir = fileURLToPath(new URL('../../../../../content/scores/', import.meta.url));
const files = existsSync(dir)
  ? readdirSync(dir).filter((f) => /\.(musicxml|xml|mxl)$/i.test(f))
  : [];

// One test per file: the smoke test stays on every score, also those outside the benchmark set,
// and a growing library must not run into vitest's per-test timeout (L1 plan, decision 12).
describe.skipIf(files.length === 0)('content library smoke test', () => {
  it.each(files)('parses %s', (f) => {
    const { score } = parseMusicXml(readFileSync(join(dir, f)));
    expect(score.notes.length).toBeGreaterThan(0);
    expect(score.notes.some((n) => n.hand === 'L')).toBe(true);
    expect(score.notes.some((n) => n.hand === 'R')).toBe(true);
  });
});
