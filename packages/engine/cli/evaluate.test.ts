import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateDirs, formatReport } from './evaluate.js';

const H = '//Version: PianoFingering_v170101\n';
const notes = (f: string[]) =>
  H + f.map((x, i) => `${i}\t${i * 0.5}\t${i * 0.5 + 0.5}\tC4\t80\t80\t0\t${x}`).join('\n') + '\n';

describe('evaluateDirs', () => {
  it('matches predictions to gold files by piece id and averages', () => {
    const root = mkdtempSync(join(tmpdir(), 'digitus2-eval-'));
    const gold = join(root, 'gold', 'FingeringFiles');
    const pred = join(root, 'pred');
    mkdirSync(gold, { recursive: true });
    mkdirSync(pred, { recursive: true });
    writeFileSync(join(gold, '001-1_fingering.txt'), notes(['1', '2', '3', '4']));
    writeFileSync(join(gold, '001-2_fingering.txt'), notes(['1', '2', '3', '5']));
    writeFileSync(join(gold, '002-1_fingering.txt'), notes(['1', '2']));
    writeFileSync(join(pred, '001_pred.txt'), notes(['1', '2', '3', '5']));
    writeFileSync(join(pred, '2.txt'), notes(['1', '1']));
    writeFileSync(join(pred, '003.txt'), notes(['1']));
    const report = evaluateDirs(pred, join(root, 'gold'));
    expect(report.pieces.map((p) => p.id)).toEqual(['1', '2']);
    expect(report.pieces[0]!.goldFiles).toHaveLength(2);
    expect(report.pieces[0]!.metrics.high).toBe(1);
    expect(report.pieces[0]!.metrics.gen).toBeCloseTo(0.875);
    expect(report.pieces[1]!.metrics.gen).toBe(0.5);
    expect(report.mean.gen).toBeCloseTo((0.875 + 0.5) / 2);
    expect(report.noteWeighted.gen).toBeCloseTo((0.875 * 4 + 0.5 * 2) / 6);
    expect(report.skipped).toEqual([{ file: '003.txt', reason: 'no gold file' }]);
  });
  it('skips a piece whose gold fingers no note and leaves it out of the mean (M3 Task 9)', () => {
    // research/fingering_eval/evaluate.py: "no annotated gold notes" (finger 0 = unfingered).
    const root = mkdtempSync(join(tmpdir(), 'digitus2-eval-'));
    const gold = join(root, 'gold');
    const pred = join(root, 'pred');
    mkdirSync(gold, { recursive: true });
    mkdirSync(pred, { recursive: true });
    writeFileSync(join(gold, '001-1_fingering.txt'), notes(['1', '2', '3', '4']));
    writeFileSync(join(gold, '002-1_fingering.txt'), notes(['0', '0', '0']));
    writeFileSync(join(pred, '001.txt'), notes(['1', '2', '1', '4']));
    writeFileSync(join(pred, '002.txt'), notes(['1', '2', '3']));
    const report = evaluateDirs(pred, gold);
    expect(report.pieces.map((p) => p.id)).toEqual(['1']);
    expect(report.skipped).toEqual([{ file: '002.txt', reason: 'no annotated gold notes' }]);
    expect(report.mean.gen).toBeCloseTo(0.75, 12);
    expect(report.noteWeighted.gen).toBeCloseTo(0.75, 12);
    expect(formatReport(report)).toMatch(/^skipped: 002\.txt \(no annotated gold notes\)$/m);
  });
});
