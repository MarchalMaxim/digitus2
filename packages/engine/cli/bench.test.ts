import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBench } from './bench.js';

const H = '//Version: PianoFingering_v170101\n';
const scale = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const file = (fingers: number[]) =>
  H +
  scale
    .map((p, i) => `${i}\t${i * 0.5}\t${(i + 1) * 0.5}\t${p}\t80\t80\t0\t${fingers[i]}`)
    .join('\n') +
  '\n';

describe('runBench', () => {
  it('scores every piece in the split or reports it as skipped, writes a scorecard and galleries, and checks floors', () => {
    const root = mkdtempSync(join(tmpdir(), 'digitus2-bench-'));
    const gold = join(root, 'gold', 'FingeringFiles');
    mkdirSync(gold, { recursive: true });
    writeFileSync(join(gold, '001-1_fingering.txt'), file([1, 2, 3, 1, 2, 3, 4, 5]));
    writeFileSync(join(gold, '001-2_fingering.txt'), file([1, 2, 3, 1, 2, 3, 4, 5]));
    writeFileSync(join(gold, '002-1_fingering.txt'), file([1, 2, 3, 4, 1, 2, 3, 4]));
    writeFileSync(
      join(gold, '003-1_fingering.txt'),
      file([1, 2, 3, 4, 1, 2, 3, 4]).replace(/\n7\t.*\n$/, '\n'),
    ); // 7 notes
    writeFileSync(join(gold, '003-2_fingering.txt'), file([1, 2, 3, 4, 1, 2, 3, 4])); // 8 notes: mismatch -> skipped
    const split = join(root, 'split.json');
    writeFileSync(
      split,
      JSON.stringify({
        default_split: 'toy',
        splits: { toy: { test: { pieces: ['001', '002', '003', '004'] } } },
      }),
    );
    const floor = join(root, 'floor.json');
    writeFileSync(floor, JSON.stringify({ engine: { gen: 99, high: 0, soft: 0, rec: 0 } }));
    const out = join(root, 'runs');
    const { scorecard, floorBreaches, galleryDir } = runBench({
      gold: join(root, 'gold'),
      split,
      floor,
      out,
      label: 'toy',
      profile: 'large',
    });
    expect(scorecard.pieces.map((p) => p.id)).toEqual(['001', '002']);
    expect(scorecard.skipped.map((s) => s.id).sort()).toEqual(['003', '004']);
    expect(scorecard.pieces[0]!.gen).toBe(100);
    expect(scorecard.pieces[0]!.annotators).toBe(2);
    expect(scorecard.macro.gen).toBeCloseTo((100 + scorecard.pieces[1]!.gen) / 2);
    expect(floorBreaches.some((b) => b.includes('gen'))).toBe(true);
    // A gated run that skips pieces is a breach in itself (Review Focus 5).
    expect(floorBreaches).toContainEqual(expect.stringMatching(/^2 of 4 pieces skipped: 003 \(/));
    expect(existsSync(join(out, `${scorecard.gitSha.slice(0, 7)}-toy.json`))).toBe(true);
    expect(existsSync(join(galleryDir, '002.md'))).toBe(true);
    const page = readFileSync(join(galleryDir, '002.md'), 'utf8');
    expect(page).toMatch(/\| *# *\|/);
    // The F4 row (engine 1, annotator 4): its neighbours, and the cost gap of the annotator finger.
    const f4 = page.split('\n').find((l) => l.includes('[F4]'))!;
    expect(f4).toContain('| D4:2 E4:3 [F4] G4:2 A4:3 |');
    expect(f4).toMatch(/\| 4: \+\d+\.\d \|/);
    expect(scorecard.timing.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('gates the lint floor, and only a labelled run replaces latest.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'digitus2-bench-'));
    const gold = join(root, 'gold');
    mkdirSync(gold, { recursive: true });
    writeFileSync(join(gold, '001-1_fingering.txt'), file([1, 2, 3, 1, 2, 3, 4, 5]));
    // Six simultaneous notes in one hand: an L04 lint error no fingering can avoid.
    const chord = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4'];
    writeFileSync(
      join(gold, '002-1_fingering.txt'),
      H +
        chord.map((p, i) => `${i}\t0\t1\t${p}\t80\t80\t0\t${Math.min(i + 1, 5)}`).join('\n') +
        '\n',
    );
    const split = join(root, 'split.json');
    writeFileSync(
      split,
      JSON.stringify({
        default_split: 'toy',
        splits: { toy: { test: { pieces: ['001', '002'] } } },
      }),
    );
    const floorFile = (lint: number) => {
      const f = join(root, `floor-${lint}.json`);
      writeFileSync(
        f,
        JSON.stringify({
          engine: { gen: 0, high: 0, soft: 0, rec: 0 },
          lint: { errorsPer1000Max: lint },
        }),
      );
      return f;
    };
    const out = join(root, 'runs');
    const strict = runBench({ gold, split, floor: floorFile(0), out });
    expect(strict.scorecard.lint.errorsPer1000).toBeGreaterThan(0);
    expect(strict.floorBreaches).toEqual([
      expect.stringMatching(/^lint errors\/1000 \d+\.\d\d above floor 0\.00$/),
    ]);
    expect(existsSync(join(root, 'latest.json'))).toBe(false); // no --label: not a milestone run
    const loose = runBench({ gold, split, floor: floorFile(1000), out, label: 'm' });
    expect(loose.floorBreaches).toEqual([]);
    expect(loose.scorecard.skipped).toEqual([]);
    expect(JSON.parse(readFileSync(join(root, 'latest.json'), 'utf8')).label).toBe('m');
  });
});
