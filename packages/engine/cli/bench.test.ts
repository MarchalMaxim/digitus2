import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadWeightSet,
  RECOMMENDED_WEIGHT_SET,
  WEIGHT_SETS,
} from '../src/fingering/params/weightSets.js';
import { pairedBootstrap } from '../src/learn/bootstrap.js';
import {
  CALIBRATION_CORRECT,
  DEFAULT_AGAINST,
  FHMM3_ID,
  FINGERFLOW_ID,
  formatScorecard,
  parseCsv,
  runBench,
  scorePiece,
} from './bench.js';
import { repoRoot } from './corpora.js';
import { main } from './run.js';
import type { CliIo } from './run.js';

const H = '//Version: PianoFingering_v170101\n';
const scale = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const file = (fingers: number[]) =>
  H +
  scale
    .map((p, i) => `${i}\t${i * 0.5}\t${(i + 1) * 0.5}\t${p}\t80\t80\t0\t${fingers[i]}`)
    .join('\n') +
  '\n';

// The CSV is tracked; resolve it from the repository root (vitest runs in packages/engine).
const baselinesCsv = join(repoRoot(), 'research', 'baselines', 'results_per_piece_test.csv');
const haveBaselines = existsSync(baselinesCsv);

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
    expect(scorecard.pieces[0]!.soft).toBe(100); // every note matches: a percentage, not a fraction
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

  it('prices a finger in the gallery against the engine finger, also where the consistency pass moved the note', () => {
    // C4 C5 C4 A4 twice (solve.test.ts, consistent repeats): on its own the last A4 takes 4, and
    // the pass gives it 5 so that both copies are fingered alike. Against the engine's 5, the
    // annotator's 4 costs less: its gap is negative (it read +0.0, measured against the cheapest).
    const root = mkdtempSync(join(tmpdir(), 'digitus2-bench-'));
    const pitches = ['C4', 'F4', 'C4', 'C5', 'C4', 'A4', 'F4', 'E4', 'C4', 'C5', 'C4', 'A4'];
    const gold = [1, 4, 1, 5, 1, 4, 3, 2, 1, 5, 1, 4];
    writeFileSync(
      join(root, '001-1_fingering.txt'),
      H +
        pitches
          .map((p, i) => `${i}\t${i * 0.5}\t${(i + 1) * 0.5}\t${p}\t80\t80\t0\t${gold[i]}`)
          .join('\n') +
        '\n',
    );
    const { gallery } = scorePiece('001', root, {
      profile: 'large',
      weightSet: loadWeightSet('parncutt'),
    });
    const row = gallery!.split('\n').find((l) => l.startsWith('| 11 |'))!;
    expect(row).toMatch(/\| 5 \(\d+%\)/);
    // Runner-up 4 and the why-not gap of the annotator's 4, both negative against the engine's 5.
    expect(row).toMatch(/\| 4 -\d+\.\d(, \d [+-]\d+\.\d)? \| 4 \| 4: -\d+\.\d \|/);
    expect(gallery).toContain('negative where the pass gave the note a finger');
  });

  it('writes a zero cost gap with a plus sign, as +0.0', () => {
    // Four C4 in a row: the engine takes 1 and fingers 2 and 3 cost exactly the same as it does.
    const root = mkdtempSync(join(tmpdir(), 'digitus2-bench-'));
    const notes = (fingers: number[]) =>
      H +
      fingers.map((f, i) => `${i}\t${i * 0.5}\t${(i + 1) * 0.5}\tC4\t80\t80\t0\t${f}`).join('\n') +
      '\n';
    writeFileSync(join(root, '001-1_fingering.txt'), notes([2, 1, 1, 1]));
    const { gallery } = scorePiece('001', root, {
      profile: 'large',
      weightSet: loadWeightSet('parncutt'),
    });
    const row = gallery!.split('\n').find((l) => l.startsWith('| 0 |'))!;
    expect(row).toContain('| 2: +0.0 |');
  });

  it('puts a note all annotators agree on against the engine first, as a hard error', () => {
    const root = mkdtempSync(join(tmpdir(), 'digitus2-bench-'));
    // The engine fingers the scale 1 2 3 1 2 3 4 5. The annotators differ from each other at E4
    // (note 2) and agree on 2 against the engine's 4 at B4 (note 6).
    writeFileSync(join(root, '001-1_fingering.txt'), file([1, 2, 4, 1, 2, 3, 2, 5]));
    writeFileSync(join(root, '001-2_fingering.txt'), file([1, 2, 5, 1, 2, 3, 2, 5]));
    const { result, gallery } = scorePiece('001', root, {
      profile: 'large',
      weightSet: loadWeightSet('parncutt'),
    });
    const rows = gallery!.split('\n').filter((l) => /^\| \d+ \|/.test(l));
    expect(rows.map((r) => r.split(' | ')[0])).toEqual(['| 6', '| 2']); // hard first, not in note order
    expect(rows[0]).toMatch(/\| hard \|$/);
    expect(rows[1]).not.toMatch(/hard/);
    expect(result.hardErrorRate).toBeGreaterThan(0);
  });

  it("does not call a lone annotator's difference a hard error", () => {
    const root = mkdtempSync(join(tmpdir(), 'digitus2-bench-'));
    writeFileSync(join(root, '001-1_fingering.txt'), file([1, 2, 3, 1, 2, 3, 2, 5]));
    const { result, gallery } = scorePiece('001', root, {
      profile: 'large',
      weightSet: loadWeightSet('parncutt'),
    });
    const rows = gallery!.split('\n').filter((l) => /^\| \d+ \|/.test(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toMatch(/\| hard \|$/);
    expect(result.hardErrorRate).toBe(0);
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

  it('pairs by piece id, fails on a missing piece, and reports a comparison', () => {
    const { root, gold, split } = toySet();
    const out = join(root, 'runs');
    const csv = join(root, 'results.csv');
    const header = 'baseline,piece,n_notes,official_m_gen\n';
    const rows = (lines: string[]) => writeFileSync(csv, header + lines.join('\n') + '\n');
    const bench = (against: string[]) =>
      runBench({ gold, split, out, compare: csv, against, weights: 'parncutt' });
    // Rows in reverse piece order, another baseline interleaved.
    rows(['b1,002,8,0.5', 'b2,002,8,0.25', 'b1,001,8,0.5', 'b2,001,8,0.25']);
    const { scorecard } = bench(['b1']);
    expect(scorecard.pieces).toHaveLength(2);
    expect(scorecard.comparisons).toHaveLength(1);
    const c = scorecard.comparisons![0]!;
    expect(c).toMatchObject({ baseline: 'b1', metric: 'gen', pieces: scorecard.pieces.length });
    expect(c.delta).toBeCloseTo(scorecard.macro.gen - 50, 9);
    expect(c.ci95[0]).toBeLessThanOrEqual(c.delta);
    expect(c.ci95[1]).toBeGreaterThanOrEqual(c.delta);
    // A baseline exactly 10 points below each piece gives every pair the same difference, so the
    // interval has zero width; pairing by row order (reversed here) would widen it. The two pieces
    // must differ for this to tell the pairings apart.
    const [p1, p2] = scorecard.pieces as [
      (typeof scorecard.pieces)[0],
      (typeof scorecard.pieces)[0],
    ];
    expect(Math.abs(p1.gen - p2.gen)).toBeGreaterThan(10);
    rows([
      `b3,002,8,${(p2.gen - 10) / 100}`,
      'b1,002,8,0.5',
      `b3,001,8,${(p1.gen - 10) / 100}`,
      'b1,001,8,0.5',
    ]);
    const paired = bench(['b3', 'b1']).scorecard.comparisons!;
    expect(paired.map((x) => x.baseline)).toEqual(['b3', 'b1']);
    expect(paired[0]!.delta).toBeCloseTo(10, 6);
    expect(paired[0]!.ci95[0]).toBeCloseTo(10, 6);
    expect(paired[0]!.ci95[1]).toBeCloseTo(10, 6);
    // A scored piece without a baseline row stops the comparison; it is never dropped.
    rows(['b1,002,8,0.5', 'b2,001,8,0.25']);
    expect(() => bench(['b1'])).toThrow(/missing piece 001/);
    // The reverse: the baseline has a piece the run did not score.
    rows(['b1,001,8,0.5', 'b1,002,8,0.5', 'b1,003,8,0.5']);
    expect(() => bench(['b1'])).toThrow(/missing piece 003/);
    // A baseline id the CSV does not have, and a piece listed twice.
    expect(() => bench(['nope'])).toThrow(/nope/);
    rows(['b1,001,8,0.5', 'b1,002,8,0.5', 'b1,002,8,0.4']);
    expect(() => bench(['b1'])).toThrow(/twice/);
  });

  it('masks unfingered gold notes (Mutopia-style) and records the weight set', () => {
    const root = mkdtempSync(join(tmpdir(), 'digitus2-bench-'));
    const gold = join(root, 'gold');
    mkdirSync(gold, { recursive: true });
    // Mutopia naming (annotation 0); every other note unfingered, B4 fingered 5 (the engine: 4).
    writeFileSync(join(gold, 'MP0001_s00_p0-0_fingering.txt'), file([1, 0, 3, 0, 2, 0, 5, 0]));
    const split = join(root, 'split.json');
    writeFileSync(
      split,
      JSON.stringify({
        default_split: 'toy',
        splits: { toy: { test: { pieces: ['MP0001_s00_p0'] } } },
      }),
    );
    const out = join(root, 'runs');
    const { scorecard, galleryDir } = runBench({
      gold,
      split,
      out,
      weights: 'parncutt',
      label: 'mask',
    });
    const p = scorecard.pieces[0]!;
    expect(p.notes).toBe(4); // the fingered count
    expect(p.scoreNotes).toBe(8); // the engine fingers every note
    expect(p.gen).toBe(75); // C4 1, E4 3, G4 2 match; B4 4 against 5
    expect(scorecard.noteWeighted.gen).toBe(75);
    expect(scorecard.weightSet).toEqual({
      id: 'parncutt',
      hash: expect.stringMatching(/^[0-9a-f]{16}$/),
      temperature: WEIGHT_SETS.parncutt.confidenceTemperature,
    });
    expect(scorecard.weightsHash).toBe(scorecard.weightSet.hash);
    // The gallery lists the fingered note the engine misses, never an unfingered note.
    const page = readFileSync(join(galleryDir, 'MP0001_s00_p0.md'), 'utf8');
    const rows = page.split('\n').filter((l) => /^\| \d+ \|/.test(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('| B4 |');
    // Masking off: a partially fingered gold is skipped with the reason, never scored silently.
    const strict = runBench({ gold, split, out, weights: 'parncutt', mask: false });
    expect(strict.scorecard.pieces).toEqual([]);
    expect(strict.scorecard.skipped).toEqual([
      { id: 'MP0001_s00_p0', reason: expect.stringMatching(/^4 gold notes without a finger/) },
    ]);
    // The default set is the recommended one; a weight-set file is read and named by its id.
    expect(runBench({ gold, split, out }).scorecard.weightSet.id).toBe(RECOMMENDED_WEIGHT_SET);
    const custom = join(root, 'custom.json');
    writeFileSync(custom, JSON.stringify({ ...WEIGHT_SETS.parncutt, id: 'custom' }));
    const fromFile = runBench({ gold, split, out, weights: custom }).scorecard;
    expect(fromFile.weightSet.id).toBe('custom');
    expect(fromFile.weightSet.hash).toBe(scorecard.weightSet.hash);
    expect(fromFile.pieces[0]!.gen).toBe(75);
    expect(() => runBench({ gold, split, out, weights: 'no-such-set' })).toThrow(/no-such-set/);
  });

  it('keeps a Mutopia run out of latest.json and the PIG floors, and gates the floor weight set', () => {
    const root = mkdtempSync(join(tmpdir(), 'digitus2-bench-'));
    const gold = join(root, 'gold');
    mkdirSync(gold, { recursive: true });
    writeFileSync(join(gold, 'MP0001_s00_p0-0_fingering.txt'), file([1, 0, 3, 0, 2, 0, 5, 0]));
    const split = join(root, 'mutopia_split.json');
    writeFileSync(
      split,
      JSON.stringify({
        dataset: 'Mutopia editorial fingerings (toy)',
        default_split: 'piece70_30',
        splits: { piece70_30: { test: { pieces: ['MP0001_s00_p0'] } } },
      }),
    );
    const floor = join(root, 'floor.json');
    writeFileSync(
      floor,
      JSON.stringify({
        weightSet: 'parncutt',
        engine: { gen: 99, high: 99, soft: 99, rec: 99 },
        lint: { errorsPer1000Max: 0 },
        mutopia: { goldDir: gold, split, subset: 'test', gen: 80 },
      }),
    );
    const out = join(root, 'runs');
    const r = runBench({ gold, split, out, floor, weights: 'parncutt', label: 'mutopia-toy' });
    expect(r.scorecard.split.corpus).toBe('mutopia');
    // Only the mutopia block gates: the PIG engine floors and the lint gate do not apply.
    expect(r.floorBreaches).toEqual(['gen 75.00 below floor 80.00']);
    expect(existsSync(join(root, 'latest-mutopia.json'))).toBe(true);
    expect(existsSync(join(root, 'latest.json'))).toBe(false);
    // A floor measured with another weight set never gates silently.
    const other = runBench({ gold, split, out, floor, weights: 'learned-open' });
    expect(other.floorBreaches).toContainEqual(
      expect.stringMatching(/^weight set learned-open is not the floor's parncutt/),
    );
    // An explicit latest file wins over the corpus default.
    const mine = join(root, 'mine.json');
    runBench({ gold, split, out, weights: 'parncutt', label: 'x', latest: mine });
    expect(JSON.parse(readFileSync(mine, 'utf8')).label).toBe('x');
  });

  it('--subset validation scores the validation list next to the split, never a test piece, and keeps latest.json and the floors', () => {
    const root = mkdtempSync(join(tmpdir(), 'digitus2-bench-'));
    const gold = join(root, 'gold');
    mkdirSync(gold, { recursive: true });
    for (const id of ['001', '002', '003'])
      writeFileSync(join(gold, `${id}-1_fingering.txt`), file([1, 2, 3, 1, 2, 3, 4, 5]));
    const split = join(root, 'pig_official.json');
    writeFileSync(
      split,
      JSON.stringify({
        dataset: 'PIG Dataset v1.2 (toy)',
        default_split: 'toy',
        splits: { toy: { test: { pieces: ['001'] }, train: { pieces: ['002', '003'] } } },
      }),
    );
    writeFileSync(join(root, 'pig_validation.json'), JSON.stringify({ pieces: ['003'] }));
    const out = join(root, 'runs');
    const r = runBench({ gold, split, subset: 'validation', out, label: 'val' });
    expect(r.scorecard.pieces.map((p) => p.id)).toEqual(['003']);
    expect(r.scorecard.split).toMatchObject({ name: 'toy', subset: 'validation', corpus: 'pig' });
    // A validation run is never the PIG milestone scorecard.
    expect(existsSync(join(root, 'latest.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(root, 'latest-validation.json'), 'utf8')).label).toBe(
      'val',
    );
    expect(existsSync(join(root, 'errors', 'val'))).toBe(true);
    // The floors are test-split numbers: gating a validation run against them is refused.
    const floor = join(root, 'floor.json');
    writeFileSync(floor, JSON.stringify({ engine: { gen: 0, high: 0, soft: 0, rec: 0 } }));
    expect(() => runBench({ gold, split, subset: 'validation', out, floor })).toThrow(
      /--floor .*validation/,
    );
    // A validation list that names a test piece (or a piece outside the train subset) is an error,
    // so a validation run can never decode the test split.
    const bad = join(root, 'bad_validation.json');
    writeFileSync(bad, JSON.stringify({ pieces: ['001', '003'] }));
    expect(() => runBench({ gold, split, subset: 'validation', validation: bad, out })).toThrow(
      /001 .*not a train piece/,
    );
    // The CLI accepts --subset validation (and --validation <file>).
    const io: CliIo = { stdout: () => {}, stderr: () => {} };
    const args = ['bench', '--gold', gold, '--split', split, '--out', out];
    expect(main([...args, '--subset', 'validation'], io)).toBe(0);
    expect(main([...args, '--subset', 'validation', '--validation', bad], io)).toBe(1);
    expect(main([...args, '--subset', 'validation', '--floor', floor], io)).toBe(2);
  });

  // Solves the 30 library pieces twice (about 2.5 s on a quiet machine): a longer timeout.
  it('--library reports repeat consistency on the library pieces (M3 Task 7, H4)', () => {
    const root = mkdtempSync(join(tmpdir(), 'digitus2-bench-'));
    const gold = join(root, 'gold');
    mkdirSync(gold, { recursive: true });
    writeFileSync(join(gold, '001-1_fingering.txt'), file([1, 2, 3, 1, 2, 3, 4, 5]));
    const split = join(root, 'split.json');
    writeFileSync(
      split,
      JSON.stringify({ default_split: 'toy', splits: { toy: { test: { pieces: ['001'] } } } }),
    );
    const library = join(repoRoot(), 'content', 'manifest.json');
    const out = join(root, 'runs');
    const { scorecard } = runBench({ gold, split, out, library, weights: 'learned-open' });
    const lib = scorecard.library!;
    expect(lib.manifest).toBe(library);
    expect(lib.pieces).toBe(30);
    // The measure: every pair of identical passages at the same place in the bar (`repeatPairs`),
    // whatever the pass grouped. Measured 2026-10-14 (learned-open, profile large): 520 of 520
    // pairs alike with the consistency pass, 270 without.
    expect(lib.pairs).toBeGreaterThan(400);
    expect(lib.alike).toBeLessThanOrEqual(lib.pairs);
    expect(lib.consistency).toBeCloseTo(lib.alike / lib.pairs, 12);
    expect(lib.consistency).toBeGreaterThanOrEqual(0.98);
    // The secondary count: repeated passages as a reader counts them (`findRepeats`).
    expect(lib.groups).toBeGreaterThan(100);
    expect(lib.consistent).toBeLessThanOrEqual(lib.groups);
    expect(lib.consistent / lib.groups).toBeGreaterThanOrEqual(0.98);
    expect(formatScorecard(scorecard)).toMatch(
      /^library repeat consistency \d+ of \d+ pairs of identical passages fingered alike \(\d+\.\d%\) over 30 pieces; repeated passages alike \d+ of \d+$/m,
    );
    // Without --library the scorecard has no library block.
    expect(runBench({ gold, split, out }).scorecard.library).toBeUndefined();
    // The CLI takes --library.
    const lines: string[] = [];
    const io: CliIo = { stdout: (t) => void lines.push(t), stderr: () => {} };
    expect(
      main(['bench', '--gold', gold, '--split', split, '--out', out, '--library', library], io),
    ).toBe(0);
    expect(lines.join('')).toMatch(/library repeat consistency/);
  }, 20_000);

  it('bench --weights --compare --against prints the weight set and the comparison lines', () => {
    const { root, gold, split } = toySet();
    const csv = join(root, 'results.csv');
    writeFileSync(
      csv,
      'baseline,piece,n_notes,official_m_gen\nb1,001,8,0.5\nb1,002,8,0.5\nb2,001,8,1\nb2,002,8,1\n',
    );
    const out: string[] = [];
    const io: CliIo = { stdout: (t) => out.push(t), stderr: (t) => out.push(t) };
    const args = ['bench', '--gold', gold, '--split', split, '--out', join(root, 'runs')];
    const code = main(
      [...args, '--weights', 'parncutt', '--compare', csv, '--against', 'b1,b2'],
      io,
    );
    expect(code).toBe(0);
    const text = out.join('');
    expect(text).toMatch(/^weightSet parncutt hash [0-9a-f]{16} temperature 2$/m);
    // Pieces 001 and 002 score 100 and 37.5: against 50 the differences are +50 and -12.5, against
    // 100 they are 0 and -62.5, and each resampled mean is one of three values.
    expect(text).toMatch(/^Δgen vs b1: \+18\.75 \[-12\.50, \+50\.00\] over 2 pieces$/m);
    expect(text).toMatch(/^Δgen vs b2: -31\.25 \[-62\.50, \+0\.00\] over 2 pieces$/m);
    // --against without --compare is a usage error.
    expect(main([...args, '--against', 'b1'], { stdout: () => {}, stderr: () => {} })).toBe(2);
  });

  it('defaults --against to the FHMM3 and FingerFlow-learned ids of the baselines CSV', () => {
    expect(DEFAULT_AGAINST).toEqual([FHMM3_ID, FINGERFLOW_ID]);
    expect(FHMM3_ID).not.toBe(FINGERFLOW_ID);
  });

  it.skipIf(!haveBaselines)('names baselines that the baselines CSV has rows for', () => {
    const ids = new Set(parseCsv(baselinesCsv).map((r) => r.baseline));
    expect(ids.has(FHMM3_ID)).toBe(true);
    expect(ids.has(FINGERFLOW_ID)).toBe(true);
  });

  it.skipIf(!haveBaselines)(
    'reproduces the baselines report: FingerFlow-learned minus FHMM3 = +3.6 [+1.1, +6.3]',
    () => {
      const rows = parseCsv(baselinesCsv);
      const byPiece = (x: Record<string, string>, y: Record<string, string>) =>
        x.piece!.localeCompare(y.piece!);
      const ff = rows
        .filter((r) => r.baseline === FINGERFLOW_ID)
        .sort(byPiece)
        .map((r) => Number(r.official_m_gen) * 100);
      const hm = rows
        .filter((r) => r.baseline === FHMM3_ID)
        .sort(byPiece)
        .map((r) => Number(r.official_m_gen) * 100);
      expect(ff).toHaveLength(30);
      expect(hm).toHaveLength(30);
      const r = pairedBootstrap(ff, hm, { resamples: 10000, seed: 1 });
      expect(r.delta).toBeCloseTo(3.6, 0);
      expect(r.ci95[0]).toBeGreaterThan(0.5);
      expect(r.ci95[1]).toBeLessThan(7);
    },
  );
});

describe('bench floors, calibration and scorecards (M3 Task 9)', () => {
  it('calibrates every scored note per annotator and prints the calibration row', () => {
    const root = mkdtempSync(join(tmpdir(), 'digitus2-bench-'));
    const gold = join(root, 'gold');
    mkdirSync(gold, { recursive: true });
    // Two annotators who disagree on the last five notes, and a one-annotator piece.
    writeFileSync(join(gold, '001-1_fingering.txt'), file([1, 2, 3, 1, 2, 3, 4, 5]));
    writeFileSync(join(gold, '001-2_fingering.txt'), file([1, 2, 3, 4, 1, 2, 3, 4]));
    writeFileSync(join(gold, '002-1_fingering.txt'), file([1, 2, 3, 4, 1, 2, 3, 4]));
    const split = join(root, 'split.json');
    writeFileSync(
      split,
      JSON.stringify({
        default_split: 'toy',
        splits: { toy: { test: { pieces: ['001', '002'] } } },
      }),
    );
    const { scorecard } = runBench({ gold, split, out: join(root, 'runs') });
    const cal = scorecard.calibration!;
    expect(cal.samples).toBe(scorecard.pieces.reduce((s, p) => s + p.notes, 0));
    expect(cal.correct).toBe(CALIBRATION_CORRECT);
    expect(CALIBRATION_CORRECT).toMatch(/^per annotator/);
    // Per annotator, the notes' mean accuracy is each annotator's match rate pooled over the notes
    // (note-weighted M_gen, exactly here: the toy gold has no finger substitutions), not the share
    // of notes that match some annotator (soft).
    const mean = cal.buckets.reduce((s, b) => s + b.count * b.accuracy, 0) / cal.samples;
    expect(mean).toBeCloseTo(scorecard.noteWeighted.gen / 100, 9);
    expect(mean).toBeLessThan(scorecard.noteWeighted.soft / 100);
    expect(formatScorecard(scorecard)).toMatch(
      /^calibration ECE \d\.\d{4} at temperature [\d.]+ over 16 notes \(correct: per annotator/m,
    );
  });

  it('picks the floor block by the split file and falls back to the dataset word', () => {
    const root = mkdtempSync(join(tmpdir(), 'digitus2-bench-'));
    const gold = join(root, 'gold');
    mkdirSync(gold, { recursive: true });
    writeFileSync(join(gold, 'MP0001_s00_p0-0_fingering.txt'), file([1, 0, 3, 0, 2, 0, 5, 0]));
    const splitFile = (name: string, dataset: string) => {
      const f = join(root, name);
      writeFileSync(
        f,
        JSON.stringify({
          dataset,
          default_split: 'toy',
          splits: { toy: { test: { pieces: ['MP0001_s00_p0'] } } },
        }),
      );
      return f;
    };
    const a = splitFile('a.json', 'PIG Dataset v1.2 (a mislabelled toy)');
    const b = splitFile('b.json', 'Mutopia editorial fingerings (toy)');
    const c = splitFile('c.json', 'Mutopia editorial fingerings (toy)');
    const floor = join(root, 'floor.json');
    writeFileSync(
      floor,
      JSON.stringify({
        weightSet: 'parncutt',
        split: b,
        engine: { gen: 99, high: 0, soft: 0, rec: 0 },
        mutopia: { goldDir: gold, split: a, subset: 'test', gen: 80 },
      }),
    );
    const out = join(root, 'runs');
    const gate = (split: string) =>
      runBench({ gold, split, out, floor, weights: 'parncutt' }).floorBreaches;
    // a: the dataset word says pig, but the mutopia block names this split file.
    expect(gate(a)).toEqual(['gen 75.00 below floor 80.00']);
    // b: the dataset word says mutopia, but floor.json's own split (the engine block) is this one.
    expect(gate(b)).toEqual(['gen 75.00 below floor 99.00']);
    // c: no block names this split; the dataset word picks the mutopia block.
    expect(gate(c)).toEqual(['gen 75.00 below floor 80.00']);
  });

  it('an explicit --floor whose block for the split sets no metric exits 1', () => {
    const { root, gold, split } = toySet();
    const floor = join(root, 'floor.json');
    writeFileSync(floor, JSON.stringify({ mutopia: { split, subset: 'test', gen: null } }));
    const err: string[] = [];
    const io: CliIo = { stdout: () => {}, stderr: (t) => void err.push(t) };
    const args = ['bench', '--gold', gold, '--split', split, '--out', join(root, 'runs')];
    expect(main([...args, '--floor', floor], io)).toBe(1);
    expect(err.join('')).toMatch(/floor breach: .*mutopia block .*split.* no metric/);
    // A floor file with no block for the split says so and passes (nothing to gate).
    const none = join(root, 'none.json');
    writeFileSync(none, JSON.stringify({ engine: null }));
    const out: string[] = [];
    expect(
      main([...args, '--floor', none], { stdout: (t) => void out.push(t), stderr: () => {} }),
    ).toBe(0);
    expect(out.join('')).toContain('no floor set');
  });

  it('gates the weight-set hash recorded next to the weight set', () => {
    const { root, gold, split } = toySet();
    const out = join(root, 'runs');
    const floorWith = (weightSetHash: string) => {
      const f = join(root, `floor-${weightSetHash}.json`);
      writeFileSync(
        f,
        JSON.stringify({
          weightSet: 'parncutt',
          weightSetHash,
          engine: { gen: 0, high: 0, soft: 0, rec: 0 },
        }),
      );
      return f;
    };
    const run = (floor: string) => runBench({ gold, split, out, floor, weights: 'parncutt' });
    const stale = run(floorWith('0123456789abcdef'));
    expect(stale.floorBreaches).toEqual([
      expect.stringMatching(
        /^weight set parncutt hash [0-9a-f]{16} is not the floor's 0123456789abcdef/,
      ),
    ]);
    expect(run(floorWith(stale.scorecard.weightSet.hash)).floorBreaches).toEqual([]);
  });

  it('gates the calibration ECE of a PIG run at calibration.eceMax', () => {
    const { root, gold, split } = toySet();
    const out = join(root, 'runs');
    const floorWith = (eceMax: number) => {
      const f = join(root, `floor-${eceMax}.json`);
      writeFileSync(
        f,
        JSON.stringify({ engine: { gen: 0, high: 0, soft: 0, rec: 0 }, calibration: { eceMax } }),
      );
      return f;
    };
    const strict = runBench({ gold, split, out, floor: floorWith(0) });
    expect(strict.scorecard.calibration!.ece).toBeGreaterThan(0);
    expect(strict.floorBreaches).toEqual([
      expect.stringMatching(/^calibration ECE \d\.\d{4} above floor 0\.0000$/),
    ]);
    expect(
      formatScorecard(strict.scorecard, undefined, JSON.parse(readFileSync(floorWith(0), 'utf8'))),
    ).toMatch(/^calibration ECE .* \(max 0\.0000\)/m);
    expect(runBench({ gold, split, out, floor: floorWith(1) }).floorBreaches).toEqual([]);
  });

  it('prints no deltas against a previous scorecard of other weights, and names the previous run', () => {
    const { root, gold, split } = toySet();
    const out = join(root, 'runs');
    const parncutt = runBench({ gold, split, out, weights: 'parncutt', label: 'p' }).scorecard;
    const open = runBench({ gold, split, out, weights: 'learned-open', label: 'o' }).scorecard;
    expect(open.weightSet.hash).not.toBe(parncutt.weightSet.hash);
    const other = formatScorecard(open, parncutt);
    for (const k of ['gen', 'high', 'soft', 'rec'])
      expect(other).toMatch(new RegExp(`^${k} +\\d+\\.\\d\\d +- +`, 'm'));
    expect(other).toMatch(
      new RegExp(
        `^no deltas: the previous scorecard p used weight set parncutt hash ${parncutt.weightSet.hash}$`,
        'm',
      ),
    );
    const same = formatScorecard(parncutt, parncutt);
    expect(same).toMatch(/^gen +\d+\.\d\d +0\.00 +/m);
    expect(same).toMatch(/^deltas against p \(weight set parncutt\)$/m);
  });

  it('--scorecard writes the scorecard to that file and never replaces latest.json', () => {
    const { root, gold, split } = toySet();
    const out = join(root, 'runs');
    const target = join(out, 'verify-pig.json');
    runBench({ gold, split, out, label: 'verify-pig', scorecard: target });
    expect(JSON.parse(readFileSync(target, 'utf8')).label).toBe('verify-pig');
    expect(existsSync(join(root, 'latest.json'))).toBe(false);
    // The CLI passes it through.
    const cli = join(out, 'verify-cli.json');
    const io: CliIo = { stdout: () => {}, stderr: () => {} };
    expect(
      main(
        [
          'bench',
          '--gold',
          gold,
          '--split',
          split,
          '--out',
          out,
          '--label',
          'v',
          '--scorecard',
          cli,
        ],
        io,
      ),
    ).toBe(0);
    expect(JSON.parse(readFileSync(cli, 'utf8')).label).toBe('v');
    expect(existsSync(join(root, 'latest.json'))).toBe(false);
  });
});

/** A two-piece gold set: 001 matches the engine's C major fingering (two annotators), 002 not. */
function toySet(): { root: string; gold: string; split: string } {
  const root = mkdtempSync(join(tmpdir(), 'digitus2-bench-'));
  const gold = join(root, 'gold');
  mkdirSync(gold, { recursive: true });
  writeFileSync(join(gold, '001-1_fingering.txt'), file([1, 2, 3, 1, 2, 3, 4, 5]));
  writeFileSync(join(gold, '001-2_fingering.txt'), file([1, 2, 3, 1, 2, 3, 4, 5]));
  writeFileSync(join(gold, '002-1_fingering.txt'), file([1, 2, 3, 4, 1, 2, 3, 4]));
  const split = join(root, 'split.json');
  writeFileSync(
    split,
    JSON.stringify({ default_split: 'toy', splits: { toy: { test: { pieces: ['001', '002'] } } } }),
  );
  return { root, gold, split };
}
