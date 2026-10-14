import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARNCUTT_WEIGHTS, RULE_IDS } from '../src/fingering/rules.js';
import { validateWeightSet } from '../src/fingering/params/weightSets.js';
import { confidenceSamples, fitTemperature } from '../src/learn/calibration.js';
import { defaultCorpusRoots, loadCorpora, repoRoot } from './corpora.js';
import { runLearn } from './learn.js';
import { main } from './run.js';

const roots = defaultCorpusRoots();
const have =
  existsSync(join(roots.pig, 'FingeringFiles')) &&
  existsSync(join(roots.beringer, 'FingeringFiles')) &&
  existsSync(join(roots.mutopia, 'FingeringFiles')) &&
  existsSync(roots.mutopiaSplit) &&
  existsSync(roots.pigValidation);

const silent = { stdout: () => undefined, stderr: () => undefined };

describe('learn guards (no data needed)', () => {
  it('refuses to write PIG-fitted weights into the engine or the app', () => {
    for (const out of [
      join(repoRoot(), 'packages', 'engine', 'src', 'fingering', 'params', 'weights-pig.json'),
      join(repoRoot(), 'apps', 'web', 'public', 'weights-pig.json'),
    ])
      expect(() => runLearn({ config: 'pig', out })).toThrow(/PIG/);
  });
  it('rejects a bad configuration or option as a usage error', () => {
    expect(main(['learn'], silent)).toBe(2);
    expect(main(['learn', '--config', 'all'], silent)).toBe(2);
    expect(main(['learn', '--config', 'open', '--epochs', '0'], silent)).toBe(2);
    expect(main(['learn', '--config', 'open', '--seeds', 'x'], silent)).toBe(2);
    expect(main(['learn', '--config', 'open', '--C', '0'], silent)).toBe(2);
  });
});

/**
 * Lets the vitest worker answer its runner between long synchronous steps: a worker that blocks
 * its event loop for about a minute (two training runs and a validation solve, slower still while
 * `pnpm test` runs the app's suite beside it) has its pending RPC time out ("Timeout calling
 * onTaskUpdate"), an unhandled error that fails the run although every test passed.
 */
const yieldToRunner = () => new Promise<void>((done) => setTimeout(done, 0));

describe.skipIf(!have)('learn', () => {
  it('open: two runs with the same options write byte-identical, valid weight files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'digitus2-learn-'));
    const files = [join(dir, 'a.json'), join(dir, 'b.json')];
    const results: Array<ReturnType<typeof runLearn>> = [];
    for (const out of files) {
      results.push(
        runLearn({ config: 'open', epochs: 1, seeds: 1, out, date: '2026-01-01T00:00:00Z' }),
      );
      await yieldToRunner();
    }
    const [a, b] = files.map((f) => readFileSync(f, 'utf8'));
    expect(a).toBe(b);
    const file = validateWeightSet(JSON.parse(a!));
    expect(file).toEqual(results[0]!.file);
    expect(file.id).toBe('learned-open');
    expect(file.provenance.config).toBe('open');
    expect(file.provenance.date).toBe('2026-01-01T00:00:00Z');
    expect(file.provenance.license).toMatch(/^shippable/);
    expect(Object.keys(file.weights)).toEqual([...RULE_IDS]);
    expect(file.weights.template).toBe(PARNCUTT_WEIGHTS.template);
    const corpora = file.provenance.corpora.map((c) => c.corpus);
    expect(corpora).toEqual(['textbook', 'beringer', 'mutopia']);
    for (const c of file.provenance.corpora) expect(c.files).toBeGreaterThan(0);
    expect(file.provenance.validation!.notes).toBeGreaterThan(0);
    // The confidence temperature is the one fitted on the PIG validation notes (per annotator), as
    // recorded in the provenance (M3 Task 9 wiring check).
    const validation = loadCorpora({ pigValidation: true }).pieces;
    const samples = confidenceSamples(validation, { profile: 'large', weights: file.weights });
    await yieldToRunner();
    expect(samples.length).toBeGreaterThan(0);
    expect(file.confidenceTemperature).toBe(Math.round(fitTemperature(samples) * 1e6) / 1e6);
    expect(file.confidenceTemperature).toBe(results[0]!.calibration!.temperature);
    const cal = file.provenance.options.calibration as { samples: number; method: string };
    expect(cal.samples).toBeGreaterThan(0);
    expect(cal.samples).toBe(samples.length);
    expect(cal.method).toMatch(/share of .*annotators/);
    expect((file.provenance.split.validation as { use: string }).use).toBe(
      'epoch and seed selection and the confidenceTemperature fit; never trained on',
    );
    expect(results[0]!.log).toHaveLength(1);
    // The training log is written next to an explicit --out.
    expect(existsSync(join(dir, 'training-log.json'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  }, 300_000);
  it('pig: one run per seed, the median seed on validation is written, as a research set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'digitus2-learn-pig-'));
    try {
      const out = join(dir, 'pig.json');
      const r = runLearn({ config: 'pig', epochs: 1, seeds: 3, out, date: '2026-01-01T00:00:00Z' });
      const file = validateWeightSet(JSON.parse(readFileSync(out, 'utf8')));
      expect(file.id).toBe('learned-pig');
      expect(file.provenance.license).toMatch(/^research only/);
      expect(file.provenance.corpora.map((c) => c.corpus)).toEqual(['pig']);
      expect(r.seeds.map((s) => s.seed)).toEqual([20261013, 20261014, 20261015]);
      const vals = r.seeds.map((s) => s.validation!);
      const median = [...vals].sort((a, b) => a - b)[1]!;
      const chosen = r.seeds.find((s) => s.seed === file.provenance.seed)!;
      expect(chosen.validation).toBe(median);
      expect(file.provenance.validation!.noteAccuracy).toBeCloseTo(median, 5);
      expect(Object.keys(file.provenance.validation!.seeds!.values)).toHaveLength(3);
      expect(file.weights.template).toBe(PARNCUTT_WEIGHTS.template);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
