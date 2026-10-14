import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../io/musicxml/read.js';
import { parsePig } from '../io/pig/read.js';
import {
  duplicateScore,
  mirrorScore,
  perturbLastNote,
  runMetamorphic,
  transposeScore,
} from './metamorphic.js';

const H = '//Version: PianoFingering_v170101\n';
const melody = (pitches: string[], ch: number) =>
  H +
  pitches.map((p, i) => `${i}\t${i * 0.5}\t${(i + 1) * 0.5}\t${p}\t80\t80\t${ch}\t0`).join('\n') +
  '\n';
const fixture = readFileSync(
  fileURLToPath(new URL('../../fixtures/two-staff.musicxml', import.meta.url)),
  'utf8',
);
const scoresDir = fileURLToPath(new URL('../../../../content/scores/', import.meta.url));
// The six library pieces of the M2 run, pinned: the library grows (L1) and directory order is
// not sorted on Linux.
const METAMORPHIC_PIECES = [
  'amazing-grace',
  'bach-invention-no1-bwv-772',
  'bach-minuet-g-major-bwv-anh-114',
  'bach-minuet-g-minor-bwv-anh-115',
  'bach-prelude-c-major-bwv-846',
  'beethoven-fur-elise-woo-59',
];
const library = existsSync(scoresDir) ? METAMORPHIC_PIECES.map((s) => `${s}.musicxml`) : [];

describe('transforms', () => {
  it('transposes, mirrors, duplicates and perturbs', () => {
    const { score } = parsePig(melody(['C4', 'E4', 'G4'], 0) + '3\t0\t1\tC3\t80\t80\t1\t0\n');
    expect(transposeScore(score, 12).notes.map((n) => n.midi)).toEqual(
      score.notes.map((n) => n.midi + 12),
    );
    // Compared note by note through the id: the mirrored score is re-sorted into canonical order
    // (onset, right hand first, pitch), so the left-hand C3 now sorts after the right-hand note.
    const m = mirrorScore(score);
    const mirrored = new Map(m.notes.map((n) => [n.id, n]));
    expect(m.notes).toHaveLength(score.notes.length);
    expect(score.notes.map((n) => [mirrored.get(n.id)?.midi, mirrored.get(n.id)?.hand])).toEqual(
      score.notes.map((n) => [124 - n.midi, n.hand === 'R' ? 'L' : 'R']),
    );
    const d = duplicateScore(score);
    expect(d.notes).toHaveLength(score.notes.length * 2);
    expect(Math.min(...d.notes.slice(score.notes.length).map((n) => n.onsetTick))).toBeGreaterThan(
      Math.max(...score.notes.map((n) => n.offsetTick)),
    );
    const p = perturbLastNote(score);
    const last = [...score.notes].sort((a, b) => b.onsetTick - a.onsetTick)[0]!;
    expect(p.notes.find((n) => n.id === last.id)!.midi).toBe(last.midi + 2);
  });
  it('leaves the input untouched and keeps exact seconds, shifting the copy as a whole', () => {
    // 0.3337 s is not a whole number of PIG ticks (1/960 s): finalizeScore alone would round it.
    const text = H + `0\t0\t0.3337\tC4\t80\t80\t0\t0\n1\t0.3337\t0.9\tD4\t80\t80\t0\t0\n`;
    const { score } = parsePig(text);
    const before = structuredClone(score);
    const t = transposeScore(score, 12);
    mirrorScore(score);
    perturbLastNote(score);
    const d = duplicateScore(score);
    runMetamorphic(score);
    expect(score).toEqual(before);
    expect(t.notes.map((n) => [n.onsetSec, n.offsetSec])).toEqual([
      [0, 0.3337],
      [0.3337, 0.9],
    ]);
    const ioi = (ns: typeof d.notes) => ns[1]!.onsetSec - ns[0]!.onsetSec;
    expect(ioi(d.notes.slice(2))).toBeCloseTo(ioi(d.notes.slice(0, 2)), 12);
  });
});

describe('runMetamorphic', () => {
  it('passes on a scale in both hands', () => {
    const { score } = parsePig(
      melody(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'], 0) +
        ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4']
          .map((p, i) => `${i + 8}\t${i * 0.5}\t${(i + 1) * 0.5}\t${p}\t80\t80\t1\t0`)
          .join('\n') +
        '\n',
    );
    const r = runMetamorphic(score);
    expect(r.checks.map((c) => c.id)).toEqual(['DET', 'MR1', 'MR2', 'MR10', 'MR6', 'MR7', 'MR8']);
    expect(r.checks.filter((c) => !c.passed)).toEqual([]);
    // Locality leaves out only the right-hand run through the moved C5; the left hand is compared.
    const mr7 = (x: typeof r) => x.checks.find((c) => c.id === 'MR7')!.details;
    expect(mr7(r)).toMatch(/^4 notes in the first half .* \(4 left out/);
    expect(mr7(runMetamorphic(score, { templates: false }))).toMatch(/^8 notes .* \(0 left out/);
  });
  it('skips the octave check on a piece that spans the whole keyboard and honours thresholds', () => {
    const { score } = parsePig(melody(['A0', 'C4', 'C8'], 0));
    const r = runMetamorphic(score, { thresholds: { MR6: 0.5 } });
    const mr1 = r.checks.find((c) => c.id === 'MR1')!;
    expect(mr1.details).toMatch(/^skipped/);
    expect(mr1.passed).toBe(true);
    expect(r.checks.find((c) => c.id === 'MR6')!.threshold).toBe(0.5);
    expect(r.checks.find((c) => c.id === 'MR7')!.threshold).toBe(0.98);
  });
  it('passes on the two-staff fixture', () => {
    const { score } = parseMusicXml(fixture);
    const r = runMetamorphic(score);
    expect(r.checks.filter((c) => !c.passed).map((c) => `${c.id}:${c.details}`)).toEqual([]);
  });
  it.skipIf(library.length === 0)(
    'passes on built-in library pieces',
    () => {
      for (const f of library) {
        const { score } = parseMusicXml(readFileSync(join(scoresDir, f)));
        const r = runMetamorphic(score);
        expect(r.checks.filter((c) => !c.passed).map((c) => `${f} ${c.id}: ${c.details}`)).toEqual(
          [],
        );
      }
      // About ten solves per piece; with the consistency pass (M3 Task 7) about 3 s alone and more in
      // the parallel suite, past vitest's default 5 s.
    },
    20_000,
  );
});
