import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { WEIGHT_SET_SCHEMA, validateWeightSet } from '../src/fingering/params/weightSets.js';
import type { WeightSetFile } from '../src/fingering/params/weightSets.js';
import { PARNCUTT_WEIGHTS, RULE_IDS } from '../src/fingering/rules.js';
import type { RuleId, RuleWeights } from '../src/fingering/rules.js';
import { HAND_PROFILES } from '../src/fingering/spans.js';
import type { HandProfileId } from '../src/fingering/spans.js';
import {
  calibrate,
  confidenceSamples,
  fitTemperature,
  PENALTY_MARGIN,
  targetOf,
} from '../src/learn/calibration.js';
import type { CalibrationReport } from '../src/learn/calibration.js';
import { toHandExamples } from '../src/learn/data.js';
import type { HandExample, TrainingPiece } from '../src/learn/data.js';
import { evaluateExamples, train } from '../src/learn/perceptron.js';
import type { EpochInfo, TrainResult } from '../src/learn/perceptron.js';
import { ENGINE_VERSION } from '../src/version.js';
import { defaultCorpusRoots, loadCorpora, readPigValidation, repoRoot } from './corpora.js';
import type { CorpusSelection } from './corpora.js';

/**
 * `digitus2 learn` (M3 Task 4): fits a weight set with the averaged passive-aggressive trainer
 * (`src/learn/perceptron.ts`) and writes it with its provenance.
 *
 * - `pig`: PIG train minus the 20 validation pieces (the learning prototype measured adding the
 *   textbook and Beringer at -2.4 on PIG validation). A research set: PIG is licensed for
 *   non-profit academic use, so it is written under `research/weights/` and never into
 *   `packages/` or `apps/` (this module refuses).
 * - `open`: the textbook oracle, Beringer and the Mutopia train half; the shippable set
 *   (`weights-learned-open.json`).
 *
 * Both select the epoch (and the seed) on the PIG validation pieces, which are never trained on.
 * Settings follow the binding corrections of the M3 plan (section "Corrections from the learning
 * prototype"): C 0.2, rho 1, 12 epochs, averaging, penalty projection, `template` frozen at the
 * Parncutt value, every example weight 1, and `--seeds n` runs (default 3) of which the run with
 * the median validation M_gen is written. Deterministic apart from `provenance.date`.
 *
 * The written set's `confidenceTemperature` (Task 6) is fitted on the same PIG validation pieces:
 * `solveFingering` with the written weights, then the temperature that maximises the likelihood of
 * the annotators' fingers per annotator (soft labels: each note's share of annotators who use each
 * finger; M3 Task 9), where an annotator finger the solver prices at a hard-rule penalty does not
 * count (`src/learn/calibration.ts`, `PENALTY_MARGIN`). Without validation it stays at the default
 * 2.
 */

export type LearnConfig = 'pig' | 'open';
export const LEARN_CONFIGS: readonly LearnConfig[] = ['pig', 'open'];

export interface LearnOptions {
  config: LearnConfig;
  /** Passes over the training examples per seed (default 12). */
  epochs?: number;
  /** PA-I aggressiveness cap (default 0.2). */
  C?: number;
  /** Hamming loss per wrong note (default 1). */
  rho?: number;
  /** First seed; the runs use seed, seed + 1, ... (default 20261013). */
  seed?: number;
  /** Training runs, one per seed (default 3); the median run on validation is written. */
  seeds?: number;
  /** Weight file; default by configuration (see the module comment). */
  out?: string;
  /** Training log; default `training-log.json` next to `out`, or `research/weights/<config>/`. */
  log?: string;
  /** Provenance date (ISO 8601); default now. */
  date?: string;
  /** Select the epoch and the seed on the PIG validation pieces (default true). */
  validation?: boolean;
  /** Hand spans used during training (default large, as the bench). */
  profile?: HandProfileId;
  /** Progress lines (one per epoch and a summary); default silent. */
  print?: (line: string) => void;
}

/** One epoch of a run as the training log keeps it (the averaged weights are left out). */
export type EpochLogEntry = Omit<EpochInfo, 'averagedWeights'>;

export interface SeedRun {
  seed: number;
  bestEpoch: number;
  /** Validation M_gen of the best epoch (null without validation). */
  validation: number | null;
  /** Training M_gen of the best epoch. */
  train: number;
  epochs: EpochLogEntry[];
}

export interface LearnResult {
  file: WeightSetFile;
  /** The epochs of the written run. */
  log: EpochInfo[];
  seeds: SeedRun[];
  out: string;
  logPath: string;
  /** Calibration on the validation notes at the fitted temperature (absent without validation). */
  calibration?: CalibrationReport;
}

export const DEFAULT_SEED = 20261013;
const DEFAULTS = { epochs: 12, C: 0.2, rho: 1, seeds: 3, profile: 'large' } as const;
/** Not learned (learning-prototype.md section 6): the prototype saw it fall to 0.4, below the textbook gate. */
const FROZEN: RuleId[] = ['template'];

export const LEARN_LICENSES: Record<LearnConfig, string> = {
  pig: 'research only: fitted on PIG (non-profit academic use)',
  open: 'shippable: textbook oracle (cited public sources), Beringer and Dunhill 1900 via pydactyl (MIT), Mutopia engravings (public domain, CC BY, CC BY-SA)',
};
const SET_IDS: Record<LearnConfig, string> = { pig: 'learned-pig', open: 'learned-open' };
const TRAINING: Record<LearnConfig, CorpusSelection> = {
  pig: { pigTrain: true },
  open: { textbook: true, beringer: true, mutopiaTrain: true },
};

/** `x` as a path relative to the repository root with `/` separators (provenance, messages). */
function repoPath(x: string, root = repoRoot()): string {
  const rel = relative(root, resolve(x));
  return rel.startsWith('..') || isAbsolute(rel) ? resolve(x) : rel.split(sep).join('/');
}

function defaultOut(config: LearnConfig, root: string): string {
  return config === 'pig'
    ? join(root, 'research', 'weights', 'pig', 'weights-learned-pig.json')
    : join(root, 'packages', 'engine', 'src', 'fingering', 'params', 'weights-learned-open.json');
}

/** PIG-fitted weights must not land where they could ship: under `packages/` or `apps/`. */
function refuseShippedPig(config: LearnConfig, paths: string[], root: string): void {
  if (config !== 'pig') return;
  for (const p of paths) {
    const top = repoPath(p, root).split('/')[0];
    if (top === 'packages' || top === 'apps')
      throw new Error(
        `refusing to write PIG-fitted weights to ${repoPath(p, root)}: PIG is licensed for non-profit academic use; write under research/weights/`,
      );
  }
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6 + 0;
const pct = (x: number | null): string => (x === null ? '-' : (100 * x).toFixed(2));

function meanSd(xs: number[]): { mean: number; sd: number } {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  // Sample standard deviation (n - 1); 0 for one run.
  const sd =
    xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1)) : 0;
  return { mean, sd };
}

function sortedWeights(w: RuleWeights): RuleWeights {
  const out = {} as RuleWeights;
  for (const id of RULE_IDS) out[id] = w[id];
  return out;
}

function seedRun(seed: number, r: TrainResult): SeedRun {
  const best = r.epochs[r.bestEpoch - 1] ?? r.epochs[r.epochs.length - 1];
  return {
    seed,
    bestEpoch: r.bestEpoch,
    validation: best?.validationAccuracy ?? null,
    train: best?.trainAccuracy ?? 0,
    epochs: r.epochs.map(({ averagedWeights: _w, ...e }) => e),
  };
}

/** The solver's temperature when no validation data is available to fit one (M2's value). */
export const DEFAULT_TEMPERATURE = 2;

/**
 * Trains the configuration once per seed, writes the run with the median validation M_gen (the
 * median of the final training M_gen without validation; ties go to the lower seed) as a weight
 * set with provenance, and writes the training log of every run next to it.
 */
export function runLearn(opts: LearnOptions): LearnResult {
  const root = repoRoot();
  const config = opts.config;
  if (!LEARN_CONFIGS.includes(config)) throw new Error(`unknown learn config ${String(config)}`);
  const out = resolve(opts.out ?? defaultOut(config, root));
  const logPath = resolve(
    opts.log ??
      (opts.out
        ? join(dirname(out), 'training-log.json')
        : join(root, 'research', 'weights', config, 'training-log.json')),
  );
  refuseShippedPig(config, [out, logPath], root);
  const epochs = opts.epochs ?? DEFAULTS.epochs;
  const C = opts.C ?? DEFAULTS.C;
  const rho = opts.rho ?? DEFAULTS.rho;
  const firstSeed = opts.seed ?? DEFAULT_SEED;
  const seedCount = opts.seeds ?? DEFAULTS.seeds;
  const profileId = opts.profile ?? DEFAULTS.profile;
  const profile = HAND_PROFILES[profileId];
  const useValidation = opts.validation ?? true;
  const date = opts.date ?? new Date().toISOString();
  const print = opts.print ?? (() => undefined);
  if (!Number.isInteger(epochs) || epochs < 1) throw new Error('epochs must be a positive integer');
  if (!Number.isInteger(seedCount) || seedCount < 1)
    throw new Error('seeds must be a positive integer');

  const training = loadCorpora(TRAINING[config]);
  const examples: HandExample[] = training.pieces.flatMap((p) => toHandExamples(p));
  const roots = defaultCorpusRoots(root);
  const validationPieces = useValidation ? readPigValidation(roots.pigValidation) : [];
  const validationSet: TrainingPiece[] = useValidation
    ? loadCorpora({ pigValidation: true }).pieces
    : [];
  const validation: HandExample[] = validationSet.flatMap((p) => toHandExamples(p));
  print(
    `learn ${config}: ${training.pieces.length} pieces, ${examples.length} hand examples; validation ${validation.length} hand examples; ${seedCount} seed(s) x ${epochs} epoch(s)`,
  );

  const seeds = Array.from({ length: seedCount }, (_, k) => firstSeed + k);
  const results = seeds.map((seed) =>
    train(examples, {
      profile,
      init: PARNCUTT_WEIGHTS,
      epochs,
      C,
      rho,
      seed,
      ...(useValidation ? { validation } : {}),
      projectPenalties: true,
      frozen: FROZEN,
      onEpoch: (e) =>
        print(
          `seed ${seed} epoch ${e.epoch}: ${e.updates} updates, ${e.infeasibleTargets} infeasible targets, ${e.skipped} skipped, train ${pct(e.trainAccuracy)}, validation ${pct(e.validationAccuracy)}`,
        ),
    }),
  );
  const runs = results.map((r, k) => seedRun(seeds[k]!, r));
  const score = (r: SeedRun): number =>
    useValidation ? (r.validation ?? 0) : (r.epochs[r.epochs.length - 1]?.trainAccuracy ?? 0);
  const ranked = runs.map((r, k) => ({ k, s: score(r) })).sort((a, b) => a.s - b.s || a.k - b.k);
  const pick = ranked[Math.floor((ranked.length - 1) / 2)]!.k;
  const chosen = runs[pick]!;
  const result = results[pick]!;

  let validationBlock: WeightSetFile['provenance']['validation'] = null;
  if (useValidation) {
    const v = evaluateExamples(validation, result.weights, profile);
    const values: Record<string, number> = {};
    runs.forEach((r) => (values[String(r.seed)] = round6(r.validation ?? 0)));
    const { mean, sd } = meanSd(runs.map((r) => r.validation ?? 0));
    validationBlock = {
      noteAccuracy: round6(v.gen),
      soft: round6(v.soft),
      notes: v.notes,
      seeds: { values, mean: round6(mean), sd: round6(sd) },
    };
  }

  // The confidence temperature of the written weights, fitted on the validation notes.
  let temperature = DEFAULT_TEMPERATURE;
  let calibration: CalibrationReport | undefined;
  let eceAtDefault: number | undefined;
  let calibrationOption: unknown = `none (no validation data): temperature ${DEFAULT_TEMPERATURE}`;
  if (useValidation) {
    const samples = confidenceSamples(validationSet, {
      profile: profileId,
      weights: result.weights,
    });
    if (samples.length === 0) throw new Error('no validation notes to fit the temperature on');
    temperature = round6(fitTemperature(samples));
    calibration = calibrate(samples, temperature);
    eceAtDefault = calibrate(samples, DEFAULT_TEMPERATURE).ece;
    calibrationOption = {
      method:
        "confidenceTemperature fitted on the PIG validation notes, per annotator: solveFingering with these weights, golden-section search on log T in [0.2, 20] minimising the cross-entropy against each note's share of annotators who use each finger, an annotator finger priced at a hard-rule penalty not counting; ece is per annotator (a bucket's accuracy is the mean share of annotators who use the chosen finger)",
      penaltyMargin: PENALTY_MARGIN,
      samples: samples.length,
      // Notes whose every annotator finger is impossible or penalised: not used by the fit.
      skipped: samples.filter(
        (s) => !targetOf(s).some((w, f) => w > 0 && s.margins[f]! < PENALTY_MARGIN),
      ).length,
      ece: round6(calibration.ece),
      nll: round6(calibration.nll),
      eceAtDefaultTemperature: round6(eceAtDefault),
    };
  }

  const split: Record<string, unknown> = {};
  if (config === 'pig')
    split.train = {
      corpus: 'pig',
      file: repoPath(roots.pigSplit, root),
      name: 'nakamura2020',
      subset: 'train',
      excluding: 'the validation pieces',
    };
  else
    split.mutopia = {
      file: repoPath(roots.mutopiaSplit, root),
      name: 'piece70_30',
      subset: 'train',
    };
  if (useValidation)
    split.validation = {
      corpus: 'pig',
      file: repoPath(roots.pigValidation, root),
      pieces: validationPieces.join(' '),
      use: 'epoch and seed selection and the confidenceTemperature fit; never trained on',
    };

  const file: WeightSetFile = {
    schema: WEIGHT_SET_SCHEMA,
    id: SET_IDS[config],
    weights: sortedWeights(result.weights),
    confidenceTemperature: temperature,
    provenance: {
      date,
      engineVersion: ENGINE_VERSION,
      config,
      corpora: training.sources.map((s) => ({
        corpus: s.corpus,
        ...(s.subset !== undefined ? { subset: s.subset } : {}),
        files: s.files,
        sha256: s.sha256,
      })),
      split,
      seed: chosen.seed,
      epochs,
      bestEpoch: chosen.bestEpoch,
      validation: validationBlock,
      options: {
        trainer: 'averaged passive-aggressive (PA-I) structured perceptron, Hamming-augmented',
        C,
        rho,
        profile: profileId,
        init: 'parncutt',
        frozen: FROZEN.join(' '),
        projectPenalties: true,
        sampleWeights: 'none (every example 1)',
        seeds: seeds.join(' '),
        selection: useValidation
          ? 'best validation epoch per seed, median seed'
          : 'last epoch per seed, median seed by training score',
        examples: examples.length,
        validationExamples: validation.length,
        calibration: calibrationOption,
      },
      license: LEARN_LICENSES[config],
    },
  };
  validateWeightSet(file, `learn ${config}`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(
    logPath,
    JSON.stringify(
      {
        config,
        date,
        weights: repoPath(out, root),
        examples: examples.length,
        validationExamples: validation.length,
        chosenSeed: chosen.seed,
        runs,
      },
      null,
      2,
    ) + '\n',
  );

  for (const r of runs)
    print(
      `seed ${r.seed}: best epoch ${r.bestEpoch}, train ${pct(r.train)}, validation ${pct(r.validation)}`,
    );
  if (validationBlock?.seeds)
    print(
      `validation gen ${pct(validationBlock.seeds.mean)} +- ${pct(validationBlock.seeds.sd)} over ${runs.length} seed(s); wrote seed ${chosen.seed} (median), best epoch ${chosen.bestEpoch}`,
    );
  if (calibration)
    print(
      `confidence temperature ${temperature} fitted on ${calibration.samples} validation notes: ECE ${calibration.ece.toFixed(4)} (${(eceAtDefault ?? 0).toFixed(4)} at the default ${DEFAULT_TEMPERATURE})`,
    );
  print(`wrote ${repoPath(out, root)} and ${repoPath(logPath, root)}`);
  return {
    file,
    log: result.epochs,
    seeds: runs,
    out,
    logPath,
    ...(calibration ? { calibration } : {}),
  };
}
