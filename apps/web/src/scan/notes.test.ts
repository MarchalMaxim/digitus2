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

describe('the clef a note is printed under (issue 226)', () => {
  const note = (staff: number, step = 'C', octave = 4) =>
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>4</duration><voice>1</voice><staff>${staff}</staff></note>`;
  const score = (...bars: string[]) =>
    `<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">${bars
      .map((b, i) => `<measure number="${i + 1}">${b}</measure>`)
      .join('')}</part></score-partwise>`;
  const clefs = (xml: string) => read(xml).notes.map((n) => n.clef);

  it('is the diatonic number of the staff bottom line: E4 for G2, G2 for F4, F3 for C3', () => {
    const xml = score(
      `<attributes><divisions>4</divisions><staves>3</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef><clef number="3"><sign>C</sign><line>3</line></clef></attributes>${note(1)}${note(2)}${note(3)}`,
    );
    expect(clefs(xml)).toEqual([30, 18, 24]);
  });

  it('reads a treble clef when the staff has none', () => {
    expect(clefs(score(`<attributes><divisions>4</divisions></attributes>${note(1)}`))).toEqual([
      30,
    ]);
  });

  it('carries a clef across bars, and a change applies to the notes after it', () => {
    const xml = score(
      `<attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>${note(1)}<attributes><clef><sign>F</sign><line>4</line></clef></attributes>${note(1)}`,
      note(1),
    );
    expect(clefs(xml)).toEqual([30, 18, 18]);
  });

  it('shifts an octave for a clef that sounds higher or lower', () => {
    const xml = score(
      `<attributes><divisions>4</divisions><staves>2</staves><clef number="1"><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef><clef number="2"><sign>F</sign><line>4</line><clef-octave-change>1</clef-octave-change></clef></attributes>${note(1)}${note(2)}`,
    );
    expect(clefs(xml)).toEqual([23, 25]);
  });
});
