import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { RECOMMENDED_WEIGHT_SET } from '../fingering/params/weightSets.js';
import { solveFingering } from '../fingering/solve.js';
import { benchmarkEntries } from '../library/benchmarkSet.js';
import type { Assignment } from '../score/types.js';
import { editorDigits } from './editorDigits.js';
import { readFingeredXml, readManifest, readPlainScore } from '../../cli/libraryPieces.js';
import { inferFingering } from './player.js';
import { reduceFingering } from './reduce.js';

/*
 * The edition's digits on the 30 core pieces (issue 94): each piece is solved as the app solves it
 * (medium hand, the recommended weight set; the app passes no level, so the solver's default) and
 * reduced with its manifest level and, for the 8 pieces with an editorial fingering, the editor's
 * digit count. The cap and the target make "printed at most the editor's" and "density within the
 * level's ceiling" true by construction, so they are guards. The quality gate is the floors:
 *  - the share of the engine's fingers a reader recovers from the printed digits, per level group
 *    and on the 8 editorial pieces, against benchmarks/floor.json `readability`.
 * The editor comparison as a reader (our printed digits reconstruct the engine's fingering at least
 * as well as the engine's own fingers printed at the editor's places) is a reported guard, not the
 * quality gate: it compares two placements of digits, and the table prints both numbers.
 */

const floorFile = fileURLToPath(new URL('../../../../benchmarks/floor.json', import.meta.url));
interface ReadabilityFloor {
  reconstruction: { levels12: number; level3: number; levels45: number; editorial: number };
}
const floor = (JSON.parse(readFileSync(floorFile, 'utf8')) as { readability?: ReadabilityFloor })
  .readability;

/** Level ceilings of the density gate, percent of notes (verification spec goals table). */
const DENSITY_CEILING: Record<number, number> = { 1: 30, 2: 30, 3: 35, 4: 40, 5: 40, 6: 40 };

interface Row {
  slug: string;
  level: number;
  notes: number;
  editor: number | null;
  unmatched: number;
  necessary: number;
  necessaryNoConf: number;
  budget: number;
  printed: number;
  density: number;
  reconstruction: number;
  editorAsReader: number | null;
}

const macro = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (x: number): string => x.toFixed(1);

describe('the edition on the core pieces', () => {
  const rows: Row[] = [];

  beforeAll(() => {
    for (const entry of benchmarkEntries(readManifest())) {
      const score = readPlainScore(entry);
      const { assignment: full } = solveFingering(score, {
        profile: 'medium',
        weightSet: RECOMMENDED_WEIGHT_SET,
      });
      const xml = entry.hasEditorialFingering ? readFingeredXml(entry) : null;
      const editor = xml === null ? null : editorDigits(score, xml);
      const r = reduceFingering(score, full, {
        level: entry.level,
        ...(editor ? { editorDigits: editor.digits } : {}),
      });
      let editorAsReader: number | null = null;
      if (editor) {
        const at: Assignment = Object.fromEntries(
          Object.keys(editor.assignment).map((id) => [id, full[id]!]),
        );
        const read = inferFingering(score, at).assignment;
        const scored = score.notes.filter((n) => full[n.id] !== undefined);
        const right = scored.filter((n) => read[n.id]?.finger === full[n.id]!.finger).length;
        editorAsReader = (100 * right) / scored.length;
      }
      rows.push({
        slug: entry.slug,
        level: entry.level,
        notes: r.notes,
        editor: editor?.digits ?? null,
        unmatched: editor?.unmatched ?? 0,
        necessary: r.necessary,
        necessaryNoConf: r.necessaryWithoutLowConfidence,
        budget: r.budget,
        printed: r.printed.size,
        density: (100 * r.printed.size) / r.notes,
        reconstruction: r.reconstruction,
        editorAsReader,
      });
    }
    const line = (r: Row): string =>
      [
        r.slug.slice(0, 34).padEnd(34),
        r.level,
        String(r.notes).padStart(5),
        String(r.editor ?? '-').padStart(4),
        String(r.necessary).padStart(5),
        String(r.necessaryNoConf).padStart(5),
        String(r.budget).padStart(5),
        String(r.printed).padStart(5),
        round1(r.density).padStart(5),
        round1(r.reconstruction).padStart(6),
        r.editorAsReader === null ? '     -' : round1(r.editorAsReader).padStart(6),
        r.unmatched ? ` unmatched ${r.unmatched}` : '',
      ].join(' ');
    console.log(
      [
        'slug'.padEnd(34) + ' lv notes edit  nec  necNC budget print dens% recon% edRdr%',
        ...rows.map(line),
      ].join('\n'),
    );
  });

  it('prints at most what the editor prints and stays inside the level ceiling', () => {
    expect(rows.length).toBe(30);
    for (const r of rows) {
      if (r.editor !== null) expect(r.printed, r.slug).toBeLessThanOrEqual(r.editor);
      expect(r.density, r.slug).toBeLessThanOrEqual(DENSITY_CEILING[r.level]!);
      expect(r.printed, r.slug).toBeGreaterThan(0);
    }
    expect(rows.filter((r) => r.editor !== null).length).toBe(8);
    expect(rows.filter((r) => r.unmatched > 0).map((r) => r.slug)).toEqual([]);
  });

  it('reconstructs the engine fingering above the floors, per level group and on the editorial pieces', () => {
    const group = (pick: (r: Row) => boolean): number =>
      macro(rows.filter(pick).map((r) => r.reconstruction));
    console.log(
      `macro reconstruction: levels12 ${group((r) => r.level <= 2)} level3 ${group((r) => r.level === 3)} levels45 ${group((r) => r.level >= 4)} editorial ${group((r) => r.editor !== null)}`,
    );
    expect(floor, 'benchmarks/floor.json has no readability block').toBeDefined();
    const f = floor!.reconstruction;
    expect(group((r) => r.level <= 2)).toBeGreaterThanOrEqual(f.levels12);
    expect(group((r) => r.level === 3)).toBeGreaterThanOrEqual(f.level3);
    expect(group((r) => r.level >= 4)).toBeGreaterThanOrEqual(f.levels45);
    expect(group((r) => r.editor !== null)).toBeGreaterThanOrEqual(f.editorial);
  });

  it('reads our digits at least as well as the editor’s places (the editor comparison as a reader)', () => {
    const worse = rows
      .filter((r) => r.editorAsReader !== null && r.reconstruction < r.editorAsReader)
      .map(
        (r) => `${r.slug}: ours ${round1(r.reconstruction)} < editor ${round1(r.editorAsReader!)}`,
      );
    expect(worse).toEqual([]);
  });
});
