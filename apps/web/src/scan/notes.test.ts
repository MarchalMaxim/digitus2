import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { joinScanPages } from './join.js';
import { parseScanXml, readScanScore, type ScanNote } from './notes.js';
import { correct } from './ScanEditor.js';
import type { Correction } from './corrections.js';

// happy-dom cannot parse a single-quoted XML declaration, which homr writes.
const owner = (n: number) =>
  readFileSync(join(process.cwd(), `fixtures/scan/owner-page-${n}.musicxml`), 'utf8').replace(
    "<?xml version='1.0' encoding='utf-8'?>",
    '<?xml version="1.0" encoding="utf-8"?>',
  );
const read = (xml: string) => readScanScore(parseScanXml(xml));
const at = (n: ScanNote) => `${n.imgpos?.x},${n.imgpos?.y}`;
const positions = (notes: readonly ScanNote[], page: number) =>
  notes
    .filter((n) => n.page === page)
    .map(at)
    .sort();

describe('where homr saw each note (issue 161)', () => {
  it('reads every note position of a page', () => {
    const score = read(owner(1));
    expect(score.pages).toBe(1);
    expect(score.notes).toHaveLength(284);
    expect(score.notes.every((n) => n.imgpos && n.page === 0)).toBe(true);
    expect(score.notes[0]!.imgpos).toEqual({ x: 190, y: 56 });
    expect(score.notes[1]!.imgpos).toEqual({ x: 187, y: 237 });
  });

  it('keeps each note on the page it was read from after the pages are joined', () => {
    const pages = [1, 2, 3].map(owner);
    const joined = read(joinScanPages(pages));
    expect(joined.pages).toBe(3);
    const alone = pages.map(read);
    expect(alone.map((s) => s.notes.length)).toEqual([284, 253, 66]);
    for (const k of [0, 1, 2]) {
      expect(joined.notes.filter((n) => n.page === k)).toHaveLength(alone[k]!.notes.length);
      // Page 3 is split into two parts and merged, so its notes come in another order.
      expect(positions(joined.notes, k)).toEqual(positions(alone[k]!.notes, 0));
    }
  });

  it('has no position for a note without a comment or with an unreadable one', () => {
    const xml = owner(1)
      .replace('<!-- imgpos: 190, 56 -->', '')
      .replace('<!-- imgpos: 187, 237 -->', '<!-- imgpos: a, b -->');
    const score = read(xml);
    expect(score.notes[0]!.imgpos).toBeUndefined();
    expect(score.notes[1]!.imgpos).toBeUndefined();
    expect(score.notes[2]!.imgpos).toBeDefined();
  });

  it('survives every kind of correction', () => {
    const raw = owner(1);
    const before = read(raw).notes;
    const pitched = before.find((n) => !n.rest && n.midi !== undefined)!;
    const rest = before.find((n) => n.rest && !n.chord)!;
    const lower = before.find((n) => !n.rest && n.staff === 1 && n.staves === 2)!;
    const corrections: Exclude<Correction, { kind: 'meter' }>[] = [
      { kind: 'pitch', note: pitched.ordinal, step: 'C', alter: 0, octave: 4 },
      { kind: 'duration', note: pitched.ordinal, type: 'half', dots: 0 },
      { kind: 'hand', note: lower.ordinal, staff: 2 },
      { kind: 'pitch', note: rest.ordinal, step: 'E', alter: 0, octave: 4 },
    ];
    for (const c of corrections) {
      const target = before.find((n) => n.ordinal === c.note)!;
      const after = correct(raw, [c])!.score.notes.find((n) => n.ordinal === c.note)!;
      expect(after, c.kind).toBeDefined();
      expect(after.imgpos, c.kind).toEqual(target.imgpos);
      expect(after.page, c.kind).toBe(target.page);
      expect(after.imgpos).toBeDefined();
    }
  });
});
