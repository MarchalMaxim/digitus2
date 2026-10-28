import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findProblems } from './corrections.js';
import { parseScanXml, readScanScore } from './notes.js';

// Research, not a gate (issue 130): of the notes homr misread on the confidence benchmark's truth
// pages (research/omr/confidence.mjs), how many sit in a bar that Places to check flags? Only
// those could get a suggestion derived from the rules. Runs when the benchmark's scorecard is
// there (it is git-ignored) and writes its figures beside it; elsewhere it skips.
const CARD = join(process.cwd(), '../../research/omr/results/confidence/latest.json');
interface NoteRow {
  page: string;
  variant: string;
  ordinal?: number;
  pitchRight: boolean;
  lengthRight?: boolean;
  substitution?: boolean;
}
interface PageRow {
  page: string;
  variant: string;
  output?: string;
}
const card = existsSync(CARD)
  ? (JSON.parse(readFileSync(CARD, 'utf8')) as { noteRows: NoteRow[]; pageRows: PageRow[] })
  : undefined;
const usable = !!card?.noteRows.some((n) => n.ordinal !== undefined);

describe.skipIf(!usable)('places to check against homr misreadings (research)', () => {
  it('counts the misread notes in a flagged bar', () => {
    const wrong = card!.noteRows.filter((n) => !n.pitchRight || n.lengthRight === false);
    const byPage = new Map<string, NoteRow[]>();
    for (const n of wrong) {
      const key = `${n.page}:${n.variant}`;
      byPage.set(key, [...(byPage.get(key) ?? []), n]);
    }
    const kinds: Record<'substitution' | 'length' | 'other', { flagged: number; of: number }> = {
      substitution: { flagged: 0, of: 0 },
      length: { flagged: 0, of: 0 },
      other: { flagged: 0, of: 0 },
    };
    for (const [key, rows] of byPage) {
      const row = card!.pageRows.find((p) => `${p.page}:${p.variant}` === key);
      if (!row?.output || !existsSync(row.output)) continue;
      const xml = readFileSync(row.output, 'utf8').replace(
        "<?xml version='1.0' encoding='utf-8'?>",
        '<?xml version="1.0" encoding="utf-8"?>',
      );
      const score = readScanScore(parseScanXml(xml));
      const flagged = new Set(
        findProblems(score).map(
          (p) => `${p.part}|${p.kind === 'bar-timing' || p.kind === 'form' ? p.bar : p.measure}`,
        ),
      );
      for (const n of rows) {
        const note = score.notes.find((x) => x.ordinal === n.ordinal);
        const kind = n.substitution ? 'substitution' : n.lengthRight === false ? 'length' : 'other';
        kinds[kind].of++;
        if (note && flagged.has(`${note.part}|${note.measure}`)) kinds[kind].flagged++;
      }
    }
    const total = Object.values(kinds).reduce(
      (a, k) => ({ flagged: a.flagged + k.flagged, of: a.of + k.of }),
      { flagged: 0, of: 0 },
    );
    const figures = { flaggedOfWrong: total, byKind: kinds };
    console.log(JSON.stringify(figures));
    writeFileSync(CARD.replace('latest.json', 'coverage.json'), JSON.stringify(figures, null, 1));
    expect(total.of).toBeGreaterThan(0);
  });
});
