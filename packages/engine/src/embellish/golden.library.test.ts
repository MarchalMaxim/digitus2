// The port against the light reference on the library: for every level 1 and 2 piece, the refusal
// and every inserted note ([bar, beat, midi, rule]) equal those of
// research/embellish/light_reference.py, recorded in fixtures/embellish-light-golden.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readLibraryScore } from '../../cli/libraryScore.js';
import { embellishMusicXml } from './embellish.js';

const repo = new URL('../../../../', import.meta.url);
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, repo)), 'utf8');

type Row = { slug: string; refusal: string | null; inserted: [string, string, number, string][] };

describe('the light embellisher on the library', () => {
  it('matches the light reference on every level 1 and 2 piece', () => {
    const golden = JSON.parse(read('packages/engine/fixtures/embellish-light-golden.json')) as {
      pieces: Row[];
    };
    const manifest = JSON.parse(read('content/manifest.json')) as Array<{
      slug: string;
      files: { score: string };
    }>;
    const scoreOf = new Map(manifest.map((p) => [p.slug, p.files.score]));
    const mismatches: string[] = [];
    let refused = 0;
    const byRule: Record<string, number> = {};
    for (const row of golden.pieces) {
      const file = scoreOf.get(row.slug);
      if (file === undefined) {
        mismatches.push(`${row.slug}: not in the manifest`);
        continue;
      }
      const path = fileURLToPath(new URL(`content/${file}`, repo));
      const res = embellishMusicXml(readLibraryScore(path));
      const inserted = res.inserted.map((i) => [i.bar, i.beat, i.midi, i.rule]);
      if (res.refusal !== row.refusal)
        mismatches.push(`${row.slug}: refusal ${res.refusal} != ${row.refusal}`);
      const k = inserted.findIndex((x, j) => JSON.stringify(x) !== JSON.stringify(row.inserted[j]));
      if (k >= 0 || inserted.length !== row.inserted.length)
        mismatches.push(
          `${row.slug}: ${inserted.length} != ${row.inserted.length} inserted; first difference at ` +
            `${k}: ${JSON.stringify(inserted[k])} != ${JSON.stringify(row.inserted[k])}`,
        );
      if (res.refusal !== null) refused += 1;
      for (const i of res.inserted) byRule[i.rule] = (byRule[i.rule] ?? 0) + 1;
    }
    expect(mismatches).toEqual([]);
    expect(golden.pieces).toHaveLength(268);
    expect(refused).toBe(9);
    expect(byRule).toEqual({ passing: 1059, 'neighbour-repeated': 473 });
  });
});
