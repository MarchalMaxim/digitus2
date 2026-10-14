import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { RECOMMENDED_WEIGHT_SET } from '../src/fingering/params/weightSets.js';
import { LEVELS } from '../src/fingering/solve.js';
import { HAND_PROFILES } from '../src/fingering/spans.js';
import type { HandProfileId } from '../src/fingering/spans.js';
import {
  BENCH_SUBSETS,
  benchRoot,
  DEFAULT_AGAINST,
  floorSection,
  formatAblation,
  formatScorecard,
  latestPath,
  runAblation,
  runBench,
} from './bench.js';
import type { BenchOptions, FloorFile, Scorecard } from './bench.js';
import { evaluateDirs, formatReport } from './evaluate.js';
import { formatHandsScorecard, runEvalHands } from './evalhands.js';
import { fingerFile } from './finger.js';
import type { FingerOptions } from './finger.js';
import { describeScore, loadScore } from './inspect.js';
import { importFile } from './import.js';
import { DEFAULT_SEED, LEARN_CONFIGS, runLearn } from './learn.js';
import type { LearnOptions } from './learn.js';
import { formatLint, lintFile } from './lint.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const processIo: CliIo = {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
};

const USAGE = `digitus2 <command>

  inspect <file>                        summarize a MusicXML (.musicxml/.xml/.mxl) or PIG (.txt) file
  eval --pred <path> --gold <path>      score PIG predictions against PIG ground truth [--json]
  finger <file> [--out p] [--format pig|musicxml] [--profile child|small|medium|large] [--hand R|L|both] [--editorial] [--level beginner|expert]
        [--weights parncutt|learned-open|<file.json>]   (--weights defaults to ${RECOMMENDED_WEIGHT_SET})
  lint <file> [--fingering pig.txt] [--beginner] [--json]
  bench --gold <dir> --split <json> [--split-name n] [--subset test|train|validation] [--validation f.json] [--floor f.json] [--out dir] [--label l] [--profile p] [--ablate] [--limit n]
        [--weights parncutt|learned-open|<file.json>] [--compare results_per_piece_test.csv [--against id,id]] [--no-mask] [--latest f.json] [--scorecard f.json] [--library manifest.json]
                                        (a --label run without --limit or --scorecard is a milestone run: it also replaces latest.json, or
                                        latest-<corpus>.json for a corpus other than PIG, or --latest; --scorecard writes the scorecard
                                        to that file instead; --floor picks the block whose split is --split; --weights defaults to
                                        ${RECOMMENDED_WEIGHT_SET}; --compare pairs per-piece M_gen with each --against baseline,
                                        default ${DEFAULT_AGAINST.join(', ')}; --no-mask skips gold with unfingered notes;
                                        --subset validation scores the train pieces listed in --validation, default
                                        pig_validation.json next to --split, writes latest-validation.json and takes no --floor;
                                        --library solves every score of a library manifest and reports how many pairs of
                                        identical passages, and how many repeated passages, are fingered alike)
  import <file.mid> [--out f.musicxml] [--split <midi 21..108>] [--title t]
  learn --config pig|open [--epochs 12] [--seeds 3] [--seed ${DEFAULT_SEED}] [--C 0.2] [--rho 1] [--out f.json] [--log f.json] [--date iso] [--no-validation] [--profile p]
                                        (pig: research only, written under research/weights/pig; open: the shipped weights-learned-open.json)
  evalhands [--gold <dir> --split <json> [--split-name n] [--subset test|train]] [--library manifest.json] [--params hand-motion.json] [--out f.json] [--label l] [--floor floor.json] [--json]
`;

/** Thrown for a bad option value; reported with the usage text and exit code 2. */
class UsageError extends Error {}

function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[]) {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value))
    throw new UsageError(`--${name} must be one of ${allowed.join(', ')}`);
  return value as T;
}

const PROFILES = Object.keys(HAND_PROFILES) as HandProfileId[];

/**
 * Runs one CLI command and returns its exit code: 0 on success, 1 when the command fails (the
 * error message is printed as one `digitus2: ...` line, no stack trace) or finds a problem (a lint
 * error, a benchmark floor breach), 2 on a usage error.
 */
export function main(argv: string[], io: CliIo = processIo): number {
  try {
    return dispatch(argv, io);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof UsageError) {
      io.stderr(`digitus2: ${message}\n${USAGE}`);
      return 2;
    }
    io.stderr(`digitus2: ${message}\n`);
    return 1;
  }
}

function dispatch(argv: string[], io: CliIo): number {
  const [command, ...rest] = argv;
  if (command === 'inspect') {
    const file = rest[0];
    if (!file) {
      io.stderr(USAGE);
      return 2;
    }
    io.stdout(describeScore(loadScore(file)) + '\n');
    return 0;
  }
  if (command === 'eval') {
    const { values } = parseArgs({
      args: rest,
      options: { pred: { type: 'string' }, gold: { type: 'string' }, json: { type: 'boolean' } },
    });
    if (!values.pred || !values.gold) {
      io.stderr(USAGE);
      return 2;
    }
    const report = evaluateDirs(values.pred, values.gold);
    io.stdout((values.json ? JSON.stringify(report, null, 2) : formatReport(report)) + '\n');
    return 0;
  }
  if (command === 'finger') return finger(rest, io);
  if (command === 'lint') return lint(rest, io);
  if (command === 'bench') return bench(rest, io);
  if (command === 'import') return importMidiFile(rest, io);
  if (command === 'evalhands') return evalHands(rest, io);
  if (command === 'learn') return learn(rest, io);
  io.stderr(USAGE);
  return 2;
}

function finger(args: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      format: { type: 'string' },
      profile: { type: 'string' },
      hand: { type: 'string' },
      editorial: { type: 'boolean' },
      level: { type: 'string' },
      weights: { type: 'string' },
    },
  });
  const file = positionals[0];
  if (!file || positionals.length > 1) throw new UsageError('finger takes exactly one file');
  const format = oneOf('format', values.format, ['pig', 'musicxml'] as const);
  const profile = oneOf('profile', values.profile, PROFILES);
  const hand = oneOf('hand', values.hand, ['R', 'L', 'both'] as const);
  const level = oneOf('level', values.level, LEVELS);
  const opts: FingerOptions = {
    file,
    ...(values.out ? { out: values.out } : {}),
    ...(format ? { format } : {}),
    ...(profile ? { profile } : {}),
    ...(hand ? { hand } : {}),
    ...(level ? { level } : {}),
    ...(values.weights ? { weights: values.weights } : {}),
    editorial: values.editorial ?? false,
  };
  const text = fingerFile(opts);
  if (!values.out) io.stdout(text);
  return 0;
}

function lint(args: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      fingering: { type: 'string' },
      beginner: { type: 'boolean' },
      json: { type: 'boolean' },
    },
  });
  const file = positionals[0];
  if (!file || positionals.length > 1) throw new UsageError('lint takes exactly one file');
  const report = lintFile(file, values.fingering, values.beginner ?? false);
  io.stdout((values.json ? JSON.stringify(report, null, 2) : formatLint(report)) + '\n');
  return report.errors > 0 ? 1 : 0;
}

function bench(args: string[], io: CliIo): number {
  const { values } = parseArgs({
    args,
    options: {
      gold: { type: 'string' },
      split: { type: 'string' },
      'split-name': { type: 'string' },
      subset: { type: 'string' },
      floor: { type: 'string' },
      out: { type: 'string' },
      label: { type: 'string' },
      profile: { type: 'string' },
      ablate: { type: 'boolean' },
      limit: { type: 'string' },
      weights: { type: 'string' },
      compare: { type: 'string' },
      against: { type: 'string' },
      'no-mask': { type: 'boolean' },
      latest: { type: 'string' },
      scorecard: { type: 'string' },
      validation: { type: 'string' },
      library: { type: 'string' },
    },
  });
  if (!values.gold || !values.split) throw new UsageError('bench needs --gold and --split');
  if (values.against !== undefined && !values.compare)
    throw new UsageError('--against needs --compare');
  const against = values.against?.split(',').map((id) => id.trim());
  if (against?.some((id) => id === ''))
    throw new UsageError('--against must be a comma-separated list of baseline ids');
  const subset = oneOf('subset', values.subset, BENCH_SUBSETS);
  if (subset === 'validation' && values.floor)
    throw new UsageError('--floor gates the test split; a --subset validation run takes none');
  if (values.validation !== undefined && subset !== 'validation')
    throw new UsageError('--validation needs --subset validation');
  const profile = oneOf('profile', values.profile, PROFILES);
  let limit: number | undefined;
  if (values.limit !== undefined) {
    limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1)
      throw new UsageError('--limit must be a positive integer');
  }
  const opts: BenchOptions = {
    gold: values.gold,
    split: values.split,
    ...(values['split-name'] ? { splitName: values['split-name'] } : {}),
    ...(subset ? { subset } : {}),
    ...(values.floor ? { floor: values.floor } : {}),
    ...(values.out ? { out: values.out } : {}),
    ...(values.label ? { label: values.label } : {}),
    ...(profile ? { profile } : {}),
    ...(values.ablate ? { ablate: true } : {}),
    ...(limit ? { limit } : {}),
    ...(values.weights ? { weights: values.weights } : {}),
    ...(values.compare ? { compare: values.compare } : {}),
    ...(against ? { against } : {}),
    ...(values['no-mask'] ? { mask: false } : {}),
    ...(values.latest ? { latest: values.latest } : {}),
    ...(values.scorecard ? { scorecard: values.scorecard } : {}),
    ...(values.validation ? { validation: values.validation } : {}),
    ...(values.library ? { library: values.library } : {}),
  };
  const root = benchRoot(opts.out);
  // Read before the run: an explicitly named floor file that is missing is an error, not a pass,
  // and the previous scorecard is the one the deltas compare against.
  const floor = opts.floor
    ? (JSON.parse(readFileSync(opts.floor, 'utf8')) as FloorFile)
    : undefined;
  const latest = latestPath(opts);
  const previous = existsSync(latest)
    ? (JSON.parse(readFileSync(latest, 'utf8')) as Scorecard)
    : undefined;
  const { scorecard, floorBreaches, galleryDir } = runBench(opts);
  io.stdout(formatScorecard(scorecard, previous, floor) + '\n');
  io.stdout(`error gallery: ${galleryDir}\n`);
  // A floor file with no block for the split gates nothing; one whose block sets no metric is a
  // breach (runBench).
  if (floor && !floorSection(floor, scorecard.split).gated) io.stdout('no floor set\n');
  if (opts.ablate) {
    const rows = runAblation(opts);
    io.stdout(formatAblation(rows) + '\n');
    writeFileSync(join(root, `ablation-${scorecard.label}.json`), JSON.stringify(rows, null, 2));
  }
  for (const b of floorBreaches) io.stderr(`floor breach: ${b}\n`);
  return floorBreaches.length > 0 ? 1 : 0;
}

function importMidiFile(args: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { out: { type: 'string' }, split: { type: 'string' }, title: { type: 'string' } },
  });
  const file = positionals[0];
  if (!file || positionals.length > 1) throw new UsageError('import takes exactly one file');
  const split = values.split === undefined ? undefined : Number(values.split);
  if (split !== undefined && !(Number.isInteger(split) && split >= 21 && split <= 108))
    throw new UsageError('--split must be a MIDI note number from 21 to 108');
  const r = importFile({
    file,
    ...(values.out ? { out: values.out } : {}),
    ...(split !== undefined ? { split } : {}),
    ...(values.title ? { title: values.title } : {}),
  });
  const report = [r.summary, ...r.warnings.map((w) => `warning: ${w}`)].join('\n') + '\n';
  if (values.out) io.stdout(report);
  else {
    io.stdout(r.xml);
    io.stderr(report);
  }
  return 0;
}

function evalHands(args: string[], io: CliIo): number {
  const { values } = parseArgs({
    args,
    options: {
      gold: { type: 'string' },
      split: { type: 'string' },
      'split-name': { type: 'string' },
      subset: { type: 'string' },
      library: { type: 'string' },
      params: { type: 'string' },
      out: { type: 'string' },
      label: { type: 'string' },
      floor: { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  if (!values.library && !(values.gold && values.split))
    throw new UsageError('evalhands needs --library, or --gold and --split');
  const subset = oneOf('subset', values.subset, ['test', 'train'] as const);
  // As in bench: an explicitly named floor file that is missing is an error, not a pass.
  if (values.floor && !existsSync(values.floor))
    throw new Error(`floor file not found: ${values.floor}`);
  const { scorecard, floorBreaches } = runEvalHands({
    ...(values.gold ? { gold: values.gold } : {}),
    ...(values.split ? { split: values.split } : {}),
    ...(values['split-name'] ? { splitName: values['split-name'] } : {}),
    ...(subset ? { subset } : {}),
    ...(values.library ? { library: values.library } : {}),
    ...(values.params ? { params: values.params } : {}),
    ...(values.out ? { out: values.out } : {}),
    ...(values.label ? { label: values.label } : {}),
    ...(values.floor ? { floor: values.floor } : {}),
  });
  io.stdout(
    (values.json ? JSON.stringify(scorecard, null, 2) : formatHandsScorecard(scorecard)) + '\n',
  );
  for (const b of floorBreaches) io.stderr(`floor breach: ${b}\n`);
  return floorBreaches.length > 0 ? 1 : 0;
}

/** A numeric option: undefined when absent, a usage error when it is not a number that `ok` accepts. */
function numberOption(
  name: string,
  value: string | undefined,
  ok: (x: number) => boolean,
  what: string,
) {
  if (value === undefined) return undefined;
  const x = Number(value);
  if (value.trim() === '' || !Number.isFinite(x) || !ok(x))
    throw new UsageError(`--${name} must be ${what}`);
  return x;
}

function learn(args: string[], io: CliIo): number {
  const { values } = parseArgs({
    args,
    options: {
      config: { type: 'string' },
      epochs: { type: 'string' },
      seeds: { type: 'string' },
      seed: { type: 'string' },
      C: { type: 'string' },
      rho: { type: 'string' },
      out: { type: 'string' },
      log: { type: 'string' },
      date: { type: 'string' },
      'no-validation': { type: 'boolean' },
      profile: { type: 'string' },
    },
  });
  if (!values.config) throw new UsageError('learn needs --config pig|open');
  const config = oneOf('config', values.config, LEARN_CONFIGS)!;
  const positiveInt = (x: number) => Number.isInteger(x) && x >= 1;
  const epochs = numberOption('epochs', values.epochs, positiveInt, 'a positive integer');
  const seeds = numberOption('seeds', values.seeds, positiveInt, 'a positive integer');
  const seed = numberOption(
    'seed',
    values.seed,
    (x) => Number.isInteger(x) && x >= 0 && x < 2 ** 32,
    'an integer from 0 to 2^32 - 1',
  );
  const C = numberOption('C', values.C, (x) => x > 0, 'a positive number');
  const rho = numberOption('rho', values.rho, (x) => x >= 0, 'a number >= 0');
  const profile = oneOf('profile', values.profile, PROFILES);
  if (values.date !== undefined && Number.isNaN(Date.parse(values.date)))
    throw new UsageError('--date must be an ISO 8601 date');
  const opts: LearnOptions = {
    config,
    ...(epochs !== undefined ? { epochs } : {}),
    ...(seeds !== undefined ? { seeds } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(C !== undefined ? { C } : {}),
    ...(rho !== undefined ? { rho } : {}),
    ...(values.out ? { out: values.out } : {}),
    ...(values.log ? { log: values.log } : {}),
    ...(values.date ? { date: values.date } : {}),
    ...(values['no-validation'] ? { validation: false } : {}),
    ...(profile ? { profile } : {}),
    print: (line) => io.stdout(line + '\n'),
  };
  const t0 = performance.now();
  runLearn(opts);
  io.stdout(`learn ${config}: ${((performance.now() - t0) / 1000).toFixed(1)} s\n`);
  return 0;
}
