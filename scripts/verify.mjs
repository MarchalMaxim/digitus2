#!/usr/bin/env node
// digitus2 verification loop: one command that says whether the project is healthy.
//
//   pnpm verify            run every step, independent steps at the same time (issue 134)
//   pnpm verify --serial   run the steps one after another, their output on the console
//   pnpm verify --changed  while iterating (issue 148): typecheck, lint and format, plus only the
//                          steps the diff against origin/main touches (scripts/verify-changed.mjs);
//                          says what it ran and what it skipped. The full run stays the gate
//                          before the pull request.
//   pnpm verify unit       run only the named steps (hygiene, design, typecheck, lint, unit, build,
//                          omr (requires build), omr:service, omr:acceptance (requires build), bundle, e2e,
//                          e2e:loop (requires build), benchmark, benchmark:mutopia, hands, embellish)
//
// Steps run as a graph (scripts/verify-graph.mjs): a step starts once the steps it needs have
// passed, and the heavy ones (unit, omr:acceptance, e2e) never overlap. Each step's output goes to
// benchmarks/runs/verify-logs/<step>.log; the console shows each start and end, the summary, and
// the end of the log of every step that failed.
//
// Exit code is non-zero if any step fails. The bundle step (after build) fails when the library
// page's initial JavaScript and CSS exceed 150 KB gzip or Verovio is statically imported
// (scripts/check-bundle-size.mjs). The benchmark step compares the engine's PIG
// test-split scores, solved with the weight set named by `weightSet` in benchmarks/floor.json,
// with the floors there (agreement, lint errors, calibration ECE, and the set's weights hash) and
// fails on a regression, and reports the repeat consistency of that set on the library
// (content/manifest.json); it is skipped (and says so) while the engine has no `bench` command or
// the dataset is absent. It also runs benchmark:mutopia (also named on its own): the held-out
// Mutopia test half (floor.json `mutopia`) with the same weight set, gated once `mutopia.gen` is a
// number and reported with "no floor set" while it is null; skipped without the Mutopia data. The
// hands step scores MIDI hand separation (`digitus2 evalhands`) on the PIG test split and the
// library and fails when the PIG macro accuracy drops below hands.accuracyMin in
// benchmarks/floor.json; while that is null it only reports. The embellish step runs the light
// embellishment gate (`digitus2 embellish --library`) on the library's level 1 and 2 pieces and fails
// when fewer pieces are offered than embellish.offeredMin in benchmarks/floor.json or an offered piece
// fails its check, lint or level; it needs no dataset, only the build.
//
// verify never rewrites a tracked file (M3 Task 9): its scorecards go to the gitignored
// benchmarks/runs/verify-pig.json, verify-mutopia.json, verify-hands.json and verify-embellish.json. The tracked
// benchmarks/latest.json, latest-mutopia.json and latest-hands.json are milestone scorecards,
// written only by labelled runs (`bench --label m3-open ...`; `evalhands --label m6-hands --out
// benchmarks/latest-hands.json`); see docs/verification-loop.md.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGraph } from './verify-graph.mjs';
import { changedFiles, goldMissing, planChanged } from './verify-changed.mjs';

const argv = process.argv.slice(2);
const serial = argv.includes('--serial');
const changed = argv.includes('--changed');
const only = new Set(argv.filter((a) => !a.startsWith('--')));
if (changed && only.size > 0) {
  console.error('--changed picks the steps itself; run it without step names');
  process.exit(2);
}
// The files this branch changed since it left origin/main; on a git failure the run is the full one.
const diff = changed ? changedFiles() : null;
if (diff && 'error' in diff) console.log(`--changed: ${diff.error}; running every step`);
const changedList = diff && 'files' in diff ? diff.files : null;
// `benchmark` runs the PIG gate and the Mutopia oracle; `benchmark:mutopia` the latter alone.
if (only.has('benchmark')) only.add('benchmark:mutopia');
const want = (name) => only.size === 0 || only.has(name);

const LIBRARY_MANIFEST = 'content/manifest.json';
// Gitignored scorecards of the verify runs (.gitignore: benchmarks/runs/).
const RUNS = 'benchmarks/runs';
const LOGS = `${RUNS}/verify-logs`;
const CLI = 'packages/engine/dist/cli/main.js';
const FLOOR = 'benchmarks/floor.json';
const floor = () => (existsSync(FLOOR) ? JSON.parse(readFileSync(FLOOR, 'utf8')) : null);
/** The built engine CLI's usage text (it prints usage without a command), or null when not built. */
function cliUsage() {
  if (!existsSync(CLI)) return null;
  const r = spawnSync('node', [CLI], { encoding: 'utf8', shell: true });
  return `${r.stdout}${r.stderr}`;
}
const has = (command) => new RegExp(`\\b${command}\\b`).test(cliUsage() ?? '');
// The weight set the floors were measured with; bench refuses to gate another set against them.
const weights = (f) => (f?.weightSet ? ['--weights', f.weightSet] : []);
const cmd = (c, args, note, env) => ({ cmd: c, args, ...(note && { note }), ...(env && { env }) });

// Each step checks its preconditions in prepare(), which runs only once its dependencies are done:
// the engine CLI the benchmark steps need exists only after the build.
/** @type {import('./verify-graph.mjs').Step[]} */
const steps = [
  { name: 'hygiene', prepare: () => cmd('node', ['scripts/check-repo-size.mjs']) },
  { name: 'design', prepare: () => cmd('node', ['scripts/check-colors.mjs']) },
  { name: 'typecheck', prepare: () => cmd('pnpm', ['typecheck']) },
  { name: 'lint', prepare: () => cmd('pnpm', ['lint']) },
  // Only under --changed (the full run leaves the format check to CI): prettier on the changed files.
  ...(changedList
    ? [
        {
          name: 'format',
          prepare: () => {
            const files = changedList.filter((f) => existsSync(f));
            return files.length
              ? cmd('pnpm', ['exec', 'prettier', '--check', '--ignore-unknown', ...files])
              : { skip: 'no changed file to format' };
          },
        },
      ]
    : []),
  // Heavy: vitest takes every core, and its 5 s timeout drops a test on a crowded machine. Heavy
  // steps keep apart from each other; the single-process steps after the build still run beside
  // them, and `--serial` is the fallback when a timing test fails under that load.
  {
    name: 'unit',
    heavy: true,
    prepare: () => {
      // --changed: the web tests related to the changed web files, and the script tests when
      // scripts/verify* changed; a shared change (selection.unit null) runs the whole suite.
      if (!selection?.unit) return cmd('pnpm', ['test']);
      const { web, scripts } = selection.unit;
      const tests = ['node', '--test', 'scripts/verify-graph.test.mjs'];
      if (web.length === 0) return cmd(tests[0], tests.slice(1));
      const related = [
        '--filter',
        '@digitus2/web',
        'exec',
        'vitest',
        'related',
        '--run',
        '--passWithNoTests',
        ...web,
      ];
      return cmd('pnpm', scripts ? [...related, '&&', ...tests] : related);
    },
  },
  { name: 'build', prepare: () => cmd('pnpm', ['build']) },
  // Research OMR runner tests use the freshly built parser/evaluator, as external recognizers do.
  { name: 'omr', deps: ['build'], prepare: () => cmd('pnpm', ['test:omr']) },
  // The scan service and the loopback worker's Python tests; SKIP where Python or pytest is missing.
  {
    name: 'omr:service',
    prepare: () =>
      spawnSync('python', ['-c', '"import pytest"'], { stdio: 'ignore', shell: true }).status !== 0
        ? { skip: 'python with pytest not found' }
        : cmd('python', [
            '-m',
            'pytest',
            'research/omr/service',
            'research/omr/prototypes/local-worker',
            'research/omr/prototypes/photo-recovery/test_staff_coverage.py',
            '-q',
          ]),
  },
  // The scanning acceptance gate: the loopback worker's recognisers on the library corpus, against
  // research/omr/acceptance/floor.json. Without the recognisers (docs/scanning.md) it is skipped.
  // Heavy: the recognisers use the cores.
  {
    name: 'omr:acceptance',
    deps: ['build'],
    heavy: true,
    prepare: () => {
      const check = spawnSync('node', ['research/omr/acceptance.mjs', '--check'], {
        encoding: 'utf8',
        shell: true,
      });
      if (check.status === 3)
        return { skip: `recognisers missing: ${check.stdout.trim() || 'see docs/scanning.md'}` };
      return cmd('node', ['research/omr/acceptance.mjs']);
    },
  },
  {
    name: 'bundle',
    deps: ['build'],
    prepare: () => cmd('node', ['scripts/check-bundle-size.mjs']),
  },
  // Heavy: the playback specs sample frames in real time. After the build step the specs run on its
  // output; `vite build` again would rewrite apps/web/dist while the bundle step reads it.
  {
    name: 'e2e',
    deps: ['build'],
    heavy: true,
    prepare: () => {
      if (!existsSync('apps/web/playwright.config.ts'))
        return { skip: 'no apps/web/playwright.config.ts yet' };
      // --changed names the specs the diff maps to (build is in the run, so they use its output).
      if (selection?.specs)
        return cmd('pnpm', [
          '--filter',
          '@digitus2/web',
          'exec',
          'playwright',
          'test',
          ...selection.specs,
        ]);
      return want('build')
        ? cmd('pnpm', ['--filter', '@digitus2/web', 'exec', 'playwright', 'test'])
        : cmd('pnpm', ['--filter', '@digitus2/web', 'e2e']);
    },
  },
  // The camera loop (docs/scanning.md, The loop on the PC): the camera over a real page photo,
  // local homr on the page it made, then the review and the score view. Heavy and apart from e2e:
  // homr's threads slow every other spec's timing. SKIP, not a pass, without a prepared homr.
  {
    name: 'e2e:loop',
    deps: ['build'],
    heavy: true,
    prepare: () => {
      const homr = process.env.DIGITUS2_OMR_HOMR || 'research/omr/results/photo-options/toolchain';
      if (!existsSync(`${homr}/venv`))
        return { skip: `homr not prepared (${homr}; set DIGITUS2_OMR_HOMR)` };
      return cmd(
        'pnpm',
        ['--filter', '@digitus2/web', 'exec', 'playwright', 'test', '--project=loop'],
        undefined,
        { DIGITUS2_E2E_LOOP: '1' },
      );
    },
  },
  {
    name: 'benchmark',
    deps: ['build'],
    prepare: () => {
      const f = floor();
      if (!f) return { skip: 'no benchmarks/floor.json' };
      if (!has('bench')) return { skip: 'engine CLI has no bench command yet' };
      if (goldMissing(f.goldDir)) return { skip: `dataset missing: ${f.goldDir}/FingeringFiles` };
      return cmd('node', [
        CLI,
        'bench',
        '--gold',
        f.goldDir,
        '--split',
        f.split,
        '--label',
        'verify-pig',
        '--scorecard',
        `${RUNS}/verify-pig.json`,
        ...weights(f),
        ...(f.engine === null ? [] : ['--floor', FLOOR]),
        // Repeat consistency on the library (M3 Task 7, H4): reported, not gated.
        ...(existsSync(LIBRARY_MANIFEST) ? ['--library', LIBRARY_MANIFEST] : []),
      ]);
    },
  },
  // The held-out Mutopia oracle (M3 Task 5): scored with the floor's weight set, gated once
  // mutopia.gen is set; deltas against the milestone benchmarks/latest-mutopia.json.
  {
    name: 'benchmark:mutopia',
    deps: ['build'],
    prepare: () => {
      const f = floor();
      const m = f?.mutopia;
      if (!f) return { skip: 'no benchmarks/floor.json' };
      if (!m) return { skip: 'no mutopia block in benchmarks/floor.json' };
      if (!has('bench')) return { skip: 'engine CLI has no bench command yet' };
      // The manifests in the gold directory are tracked; only FingeringFiles/ is the data.
      if (goldMissing(m.goldDir) || !existsSync(m.split))
        return {
          skip: `dataset missing: ${goldMissing(m.goldDir) ? `${m.goldDir}/FingeringFiles` : m.split}`,
        };
      const gated = typeof m.gen === 'number';
      return cmd(
        'node',
        [
          CLI,
          'bench',
          '--gold',
          m.goldDir,
          '--split',
          m.split,
          '--subset',
          m.subset ?? 'test',
          '--label',
          'verify-mutopia',
          '--scorecard',
          `${RUNS}/verify-mutopia.json`,
          ...weights(f),
          ...(gated ? ['--floor', FLOOR] : []),
        ],
        gated ? undefined : 'no floor set',
      );
    },
  },
  {
    name: 'hands',
    deps: ['build'],
    prepare: () => {
      const f = floor();
      if (!f?.hands) return { skip: 'no hands block in benchmarks/floor.json' };
      if (!has('evalhands')) return { skip: 'engine CLI has no evalhands command yet' };
      if (goldMissing(f.goldDir)) return { skip: `dataset missing: ${f.goldDir}/FingeringFiles` };
      const args = [
        CLI,
        'evalhands',
        '--gold',
        f.goldDir,
        '--split',
        f.split,
        '--subset',
        'test',
        '--library',
        'content/manifest.json',
        '--out',
        `${RUNS}/verify-hands.json`,
        '--label',
        'verify',
      ];
      if (typeof f.hands.accuracyMin === 'number') args.push('--floor', FLOOR);
      return cmd('node', args);
    },
  },
  // The light embellishment gate ("Add notes between"): the guard, the independent check, the lint
  // at every hand profile and the level heuristic on the library's level 1 and 2 pieces, against
  // benchmarks/floor.json `embellish.offeredMin`. Needs only the committed library and the build.
  {
    name: 'embellish',
    deps: ['build'],
    prepare: () => {
      if (cliUsage() === null) return { skip: 'engine not built (run the build step first)' };
      if (!has('embellish')) return { skip: 'engine CLI has no embellish command yet' };
      return cmd('node', [
        CLI,
        'embellish',
        '--library',
        LIBRARY_MANIFEST,
        '--floor',
        FLOOR,
        '--out',
        `${RUNS}/verify-embellish.json`,
      ]);
    },
  },
];

const logOf = (name) => `${LOGS}/${name.replace(/[^a-z0-9-]/gi, '-')}.log`;
const children = new Set();
const logged = new Set();
/** Kills a step's whole process tree: a stray `vite preview` would keep the e2e port. */
function kill(child) {
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
  else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
}
process.on('SIGINT', () => {
  for (const child of children) kill(child);
  process.exit(130);
});

/** Runs one step: on the console when serial, otherwise into its log file. */
function start(step, plan) {
  const line = `${plan.cmd} ${plan.args.join(' ')}`;
  const began = Date.now();
  if (serial) process.stdout.write(`\n=== ${step.name}: ${line}\n`);
  else process.stdout.write(`start ${step.name}\n`);
  // The log is opened before the command starts: a step whose log cannot be written never runs.
  let log;
  if (!serial) {
    mkdirSync(LOGS, { recursive: true });
    log = createWriteStream(logOf(step.name));
    logged.add(step.name);
    log.on('error', (error) => process.stdout.write(`${step.name}: log ${error.message}\n`));
    log.write(`=== ${step.name}: ${line}\n`);
  }
  return new Promise((resolve) => {
    const child = spawn(plan.cmd, plan.args, {
      shell: true,
      env: { ...process.env, ...plan.env },
      stdio: serial ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    children.add(child);
    if (log) {
      child.stdout.pipe(log, { end: false });
      child.stderr.pipe(log, { end: false });
    }
    let settled = false;
    const end = (ok) => {
      if (settled) return;
      settled = true;
      children.delete(child);
      const seconds = ((Date.now() - began) / 1000).toFixed(1);
      if (!serial) process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${step.name} ${seconds}s\n`);
      if (log) log.end(() => resolve({ ok }));
      else resolve({ ok });
    };
    child.on('error', (error) => {
      log?.write(`\n${error.message}\n`);
      end(false);
    });
    child.on('close', (code) => end(code === 0));
  });
}

// --changed: the steps the diff selects. They join `only`, so want('build') below stays right.
const selection = changedList
  ? planChanged(changedList, {
      gates: steps.map((s) => s.name),
      deps: Object.fromEntries(steps.map((s) => [s.name, s.deps ?? []])),
    })
  : null;
if (selection) {
  for (const r of selection.run) only.add(r.gate);
  const { run, specs, unit } = selection;
  const lines = [
    `=== verify --changed: ${changedList.length} file(s) changed since ${diff.base.slice(0, 7)} (origin/main)`,
    ...run.map((r) => `run   ${r.gate.padEnd(17)} ${r.why}`),
    `e2e specs: ${specs ? specs.join(' ') || 'none' : 'all'}`,
    `unit: ${
      unit
        ? `vitest related on ${unit.web.length} web file(s)${unit.scripts ? ' and the script tests' : ''}`
        : 'full pnpm test'
    }`,
  ];
  process.stdout.write(`${lines.join('\n')}\n\n`);
}

const results = await runGraph(steps, {
  start,
  only,
  serial,
  onSettled: (r) =>
    !serial && process.stdout.write(`${r.status.padEnd(5)} ${r.name} ${r.detail}\n`),
});

process.stdout.write('\n=== verify summary\n');
for (const r of results)
  process.stdout.write(`${r.status.padEnd(5)} ${r.name.padEnd(17)} ${r.detail}\n`);
const failed = results.filter((r) => r.status === 'FAIL');
// Only logs written in this run: a step that failed before it started has none, or a stale one.
if (!serial)
  for (const r of failed.filter((f) => logged.has(f.name))) {
    const lines = readFileSync(logOf(r.name), 'utf8').trimEnd().split('\n');
    process.stdout.write(`\n=== ${r.name} failed: the end of ${logOf(r.name)}\n`);
    process.stdout.write(`${lines.slice(-40).join('\n')}\n`);
  }
if (selection)
  for (const r of selection.skip) process.stdout.write(`SKIP  ${r.gate} not touched: ${r.why}\n`);
process.stdout.write(
  failed.length
    ? `\n${failed.length} step(s) failed\n`
    : selection
      ? '\nall selected steps passed; run the full pnpm verify once before the pull request\n'
      : '\nall steps passed\n',
);
process.exitCode = failed.length ? 1 : 0;
