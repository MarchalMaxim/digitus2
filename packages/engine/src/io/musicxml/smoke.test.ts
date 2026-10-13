import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from './read.js';

const dir = fileURLToPath(new URL('../../../../../content/scores/', import.meta.url));
const files = existsSync(dir)
  ? readdirSync(dir).filter((f) => /\.(musicxml|xml|mxl)$/i.test(f))
  : [];

describe('content library smoke test', () => {
  it.skipIf(files.length === 0)('parses every built-in score', () => {
    for (const f of files) {
      const { score } = parseMusicXml(readFileSync(join(dir, f)));
      expect(score.notes.length, f).toBeGreaterThan(0);
      expect(
        score.notes.some((n) => n.hand === 'L'),
        f,
      ).toBe(true);
      expect(
        score.notes.some((n) => n.hand === 'R'),
        f,
      ).toBe(true);
    }
  });
});
