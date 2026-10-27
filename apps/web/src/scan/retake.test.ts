import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Correction } from './corrections.js';
import { joinScanPages } from './join.js';
import { parseScanXml, readScanScore, tieTarget, type ScanNote } from './notes.js';
import { carryCorrections, carryOver } from './retake.js';
import { correct, tryCorrection } from './ScanEditor.js';

// happy-dom cannot parse a single-quoted XML declaration, which homr writes.
const owner = (n: number) =>
  readFileSync(join(process.cwd(), `fixtures/scan/owner-page-${n}.musicxml`), 'utf8').replace(
    "<?xml version='1.0' encoding='utf-8'?>",
    '<?xml version="1.0" encoding="utf-8"?>',
  );
const read = (xml: string) => readScanScore(parseScanXml(xml));
const pitched = (notes: readonly ScanNote[], page: number) =>
  notes.filter((n) => n.page === page && !n.rest && !n.chord && n.step);
// Not the bar number: bars are numbered through the batch, so a retaken page of another length
// renumbers the bars after it.
const describeNote = (n: ScanNote | undefined) =>
  n && `${n.page}:${n.imgpos?.x},${n.imgpos?.y}:${n.step}${n.alter}${n.octave}`;

describe('one page photographed again (issue 130)', () => {
  const before = joinScanPages([owner(1), owner(2), owner(3)]);
  // Page 2 is read again from another photograph: here the first page's recognition, which has a
  // different number of notes, so every later ordinal moves.
  const after = joinScanPages([owner(1), owner(1), owner(3)]);
  const old = read(before);
  const fresh = read(after);
  const first = pitched(old.notes, 0)[3]!;
  const middle = pitched(old.notes, 1)[2]!;
  const last = pitched(old.notes, 2)[5]!;
  const lastBar = old.bars.find((b) => b.part === last.part && b.index === last.measure)!;
  const corrections: Correction[] = [
    { kind: 'pitch', note: first.ordinal, step: 'D', alter: 0, octave: first.octave },
    { kind: 'pitch', note: middle.ordinal, step: 'E', alter: 0, octave: middle.octave },
    { kind: 'hand', note: last.ordinal, staff: last.staff === 1 ? 2 : 1 },
    { kind: 'meter', bar: lastBar.index, beats: 3, beatType: 4 },
  ];

  it('needs the remapping: the page lengths differ, so the later ordinals move', () => {
    expect(fresh.notes.length).not.toBe(old.notes.length);
    expect(describeNote(fresh.notes.find((n) => n.ordinal === last.ordinal))).not.toBe(
      describeNote(last),
    );
  });

  it("keeps the other pages' corrections on the same notes and drops the retaken page's", () => {
    const carried = carryCorrections(old, fresh, corrections, 1);
    expect(carried.map((c) => c.kind)).toEqual(['pitch', 'hand', 'meter']);
    const noteOf = (c: Correction) =>
      'note' in c ? fresh.notes.find((n) => n.ordinal === c.note) : undefined;
    expect(describeNote(noteOf(carried[0]!))).toBe(describeNote(first));
    expect(describeNote(noteOf(carried[1]!))).toBe(describeNote(last));
    const bar = carried[2] as Extract<Correction, { kind: 'meter' }>;
    const barNotes = fresh.notes.filter((n) => n.part === 0 && n.measure === bar.bar);
    expect(barNotes.some((n) => describeNote(n) === describeNote(last))).toBe(true);
  });

  it('replays on the new recognition', () => {
    const carried = carryCorrections(old, fresh, corrections, 1);
    const result = correct(after, carried);
    expect(result?.applied).toBe(carried.length);
  });

  it('keeps everything when the retaken page reads the same', () => {
    expect(carryCorrections(old, read(before), corrections, 1)).toEqual(
      corrections.filter((c) => !('note' in c) || c.note !== middle.ordinal),
    );
  });

  it('drops a correction whose note no longer matches', () => {
    const shifted = read(joinScanPages([owner(2), owner(1), owner(3)]));
    // Page 1 itself changed here, so its note is not the same note any more.
    const carried = carryCorrections(old, shifted, corrections, 1);
    expect(carried.some((c) => 'note' in c && c.note === first.ordinal)).toBe(false);
  });

  it('drops the corrections of a page whose parts and staves are laid out another way', () => {
    const repaired = {
      ...fresh,
      notes: fresh.notes.map((n) => (n.page === 0 ? { ...n, staves: 1 } : n)),
    };
    const carried = carryCorrections(old, repaired, corrections, 1);
    // The pitch on the first page goes; the other pages' hand and meter stay.
    expect(carried.map((c) => c.kind)).toEqual(['hand', 'meter']);
  });
});

describe('a correction that no longer applies after a page is photographed again (issue 130)', () => {
  // A tie from the last note of page 1 into the first note of page 2 exists in this join only.
  const before = joinScanPages([owner(3), owner(1), owner(3)]);
  const after = joinScanPages([owner(3), owner(2), owner(3)]);
  const old = read(before);
  const tied = old.notes.find(
    (n) =>
      n.page === 0 &&
      !n.chord &&
      n.midi !== undefined &&
      !n.tieStart &&
      !n.tieStop &&
      tieTarget(old, n)?.page === 1,
  )!;
  const later = pitched(old.notes, 2)[4]!;
  const corrections: Correction[] = [
    { kind: 'tie', note: tied.ordinal, tied: true },
    { kind: 'pitch', note: later.ordinal, step: 'D', alter: 0, octave: later.octave },
  ];

  it('is a tie that the old recognition accepts and the new one refuses', () => {
    expect(tryCorrection(before, [], corrections[0]!)).toBeNull();
    expect(tryCorrection(after, [], corrections[0]!)).not.toBeNull();
  });

  it('is dropped alone: the correction after it on the third page survives', () => {
    const carried = carryOver(before, after, corrections, 1);
    expect(carried.map((c) => c.kind)).toEqual(['pitch']);
    expect(correct(after, carried)?.applied).toBe(1);
    // Carried without the replay, the refused tie would cut off everything after it.
    const naive = carryCorrections(old, read(after), corrections, 1);
    expect(naive).toHaveLength(2);
    expect(correct(after, naive)?.applied).toBe(0);
  });

  it('carries the corrections of every page photographed again so far', () => {
    const both = carryOver(
      before,
      joinScanPages([owner(3), owner(2), owner(2)]),
      corrections,
      [1, 2],
    );
    expect(both).toEqual([]);
  });
});
