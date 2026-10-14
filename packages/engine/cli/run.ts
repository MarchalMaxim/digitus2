import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { HAND_PROFILES } from '../src/fingering/spans.js';
import type { HandProfileId } from '../src/fingering/spans.js';
import { benchRoot, formatAblation, formatScorecard, runAblation, runBench } from './bench.js';
import type { BenchOptions, FloorFile, Scorecard } from './bench.js';
import { evaluateDirs, formatReport } from './evaluate.js';
import { formatHandsScorecard, runEvalHands } from './evalhands.js';
import { fingerFile } from './finger.js';
import type { FingerOptions } from './finger.js';
import { describeScore, loadScore } from './inspect.js';
import { importFile } from './import.js';
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
  finger <file> [--out p] [--format pig|musicxml] [--profile child|small|medium|large] [--hand R|L|both] [--editorial]
  lint <file> [--fingering pig.txt] [--beginner] [--json]
  bench --gold <dir> --split <json> [--split-name n] [--subset test|train] [--floor f.json] [--out dir] [--label l] [--profile p] [--ablate] [--limit n]
                                        (a --label run without --limit is a milestone run: it also replaces latest.json)
  import <file.mid> [--out f.musicxml] [--split <midi 21..108>] [--title t]
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
    },
  });
  const file = positionals[0];
  if (!file || positionals.length > 1) throw new UsageError('finger takes exactly one file');
  const format = oneOf('format', values.format, ['pig', 'musicxml'] as const);
  const profile = oneOf('profile', values.profile, PROFILES);
  const hand = oneOf('hand', values.hand, ['R', 'L', 'both'] as const);
  const opts: FingerOptions = {
    file,
    ...(values.out ? { out: values.out } : {}),
    ...(format ? { format } : {}),
    ...(profile ? { profile } : {}),
    ...(hand ? { hand } : {}),
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
    },
  });
  if (!values.gold || !values.split) throw new UsageError('bench needs --gold and --split');
  const subset = oneOf('subset', values.subset, ['test', 'train'] as const);
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
  };
  const root = benchRoot(opts.out);
  // Read before the run: an explicitly named floor file that is missing is an error, not a pass,
  // and the previous scorecard is the one the deltas compare against.
  const floor = opts.floor
    ? (JSON.parse(readFileSync(opts.floor, 'utf8')) as FloorFile)
    : undefined;
  const latestPath = join(root, 'latest.json');
  const previous = existsSync(latestPath)
    ? (JSON.parse(readFileSync(latestPath, 'utf8')) as Scorecard)
    : undefined;
  const { scorecard, floorBreaches, galleryDir } = runBench(opts);
  io.stdout(formatScorecard(scorecard, previous, floor) + '\n');
  io.stdout(`error gallery: ${galleryDir}\n`);
  if (floor && !floor.engine) io.stdout('no floor set\n');
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
