#!/usr/bin/env node
// digitus2 verification loop: one command that says whether the project is healthy.
//
//   pnpm verify            run every step
//   pnpm verify unit       run only the named steps (hygiene, design, typecheck, lint, unit, build,
//                          omr (requires build), omr:service, omr:acceptance (requires build), bundle, e2e,
//                          benchmark, benchmark:mutopia, hands, embellish)
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
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const only = new Set(process.argv.slice(2));
const want = (name) => only.size === 0 || only.has(name);
const results = [];

function run(name, cmd, args, note) {
  const started = Date.now();
  process.stdout.write(`\n=== ${name}: ${cmd} ${args.join(' ')}\n`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const detail = note ? `${seconds}s, ${note}` : `${seconds}s`;
  results.push({ name, status: r.status === 0 ? 'PASS' : 'FAIL', detail });
  return r.status === 0;
}

function skip(name, why) {
  results.push({ name, status: 'SKIP', detail: why });
}

if (want('hygiene')) run('hygiene', 'node', ['scripts/check-repo-size.mjs']);
if (want('design')) run('design', 'node', ['scripts/check-colors.mjs']);
if (want('typecheck')) run('typecheck', 'pnpm', ['typecheck']);
if (want('lint')) run('lint', 'pnpm', ['lint']);
if (want('unit')) run('unit', 'pnpm', ['test']);
if (want('build')) run('build', 'pnpm', ['build']);
// Research OMR runner tests use the freshly built parser/evaluator, as external recognizers do.
if (want('omr')) run('omr', 'pnpm', ['test:omr']);
// The scan service and the loopback worker's Python tests; SKIP where Python or pytest is missing.
if (want('omr:service')) {
  const probe = spawnSync('python', ['-c', '"import pytest"'], { stdio: 'ignore', shell: true });
  if (probe.status !== 0) skip('omr:service', 'python with pytest not found');
  else
    run('omr:service', 'python', [
      '-m',
      'pytest',
      'research/omr/service',
      'research/omr/prototypes/local-worker',
      '-q',
    ]);
}
// The scanning acceptance gate: the loopback worker's recognisers on the library corpus, against
// research/omr/acceptance/floor.json. Without the recognisers (docs/scanning.md) it is skipped.
if (want('omr:acceptance')) {
  const check = spawnSync('node', ['research/omr/acceptance.mjs', '--check'], {
    encoding: 'utf8',
    shell: true,
  });
  if (check.status === 3)
    skip('omr:acceptance', `recognisers missing: ${check.stdout.trim() || 'see docs/scanning.md'}`);
  else run('omr:acceptance', 'node', ['research/omr/acceptance.mjs']);
}
if (want('bundle')) run('bundle', 'node', ['scripts/check-bundle-size.mjs']);

if (want('e2e')) {
  if (existsSync('apps/web/playwright.config.ts'))
    run('e2e', 'pnpm', ['--filter', '@digitus2/web', 'e2e']);
  else skip('e2e', 'no apps/web/playwright.config.ts yet');
}

// `benchmark` runs the PIG gate and the Mutopia oracle; `benchmark:mutopia` the latter alone.
const LIBRARY_MANIFEST = 'content/manifest.json';
// Gitignored scorecards of the verify runs (.gitignore: benchmarks/runs/).
const RUNS = 'benchmarks/runs';
const CLI = 'packages/engine/dist/cli/main.js';
/** The built engine CLI's usage text (it prints usage without a command), or null when not built. */
function cliUsage() {
  if (!existsSync(CLI)) return null;
  const r = spawnSync('node', [CLI], { encoding: 'utf8', shell: true });
  return `${r.stdout}${r.stderr}`;
}
const wantPig = want('benchmark');
const wantMutopia = want('benchmark') || only.has('benchmark:mutopia');
if (wantPig || wantMutopia) {
  const floorPath = 'benchmarks/floor.json';
  const cli = CLI;
  const floor = existsSync(floorPath) ? JSON.parse(readFileSync(floorPath, 'utf8')) : null;
  const usage = floor ? cliUsage() : null;
  const hasBench = usage !== null && /\bbench\b/.test(usage);
  // The weight set the floors were measured with; bench refuses to gate another set against them.
  const weights = floor?.weightSet ? ['--weights', floor.weightSet] : [];
  if (wantPig) {
    if (!floor) skip('benchmark', 'no benchmarks/floor.json');
    else if (!hasBench) skip('benchmark', 'engine CLI has no bench command yet');
    else if (!existsSync(floor.goldDir)) skip('benchmark', `dataset missing: ${floor.goldDir}`);
    else
      run('benchmark', 'node', [
        cli,
        'bench',
        '--gold',
        floor.goldDir,
        '--split',
        floor.split,
        '--label',
        'verify-pig',
        '--scorecard',
        `${RUNS}/verify-pig.json`,
        ...weights,
        ...(floor.engine === null ? [] : ['--floor', floorPath]),
        // Repeat consistency on the library (M3 Task 7, H4): reported, not gated.
        ...(existsSync(LIBRARY_MANIFEST) ? ['--library', LIBRARY_MANIFEST] : []),
      ]);
  }
  if (wantMutopia) {
    // The held-out Mutopia oracle (M3 Task 5): scored with the floor's weight set, gated once
    // mutopia.gen is set; deltas against the milestone benchmarks/latest-mutopia.json.
    const m = floor?.mutopia;
    if (!floor) skip('benchmark:mutopia', 'no benchmarks/floor.json');
    else if (!m) skip('benchmark:mutopia', 'no mutopia block in benchmarks/floor.json');
    else if (!hasBench) skip('benchmark:mutopia', 'engine CLI has no bench command yet');
    else if (!existsSync(m.goldDir) || !existsSync(m.split))
      skip('benchmark:mutopia', `dataset missing: ${existsSync(m.goldDir) ? m.split : m.goldDir}`);
    else {
      const gated = typeof m.gen === 'number';
      run(
        'benchmark:mutopia',
        'node',
        [
          cli,
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
          ...weights,
          ...(gated ? ['--floor', floorPath] : []),
        ],
        gated ? undefined : 'no floor set',
      );
    }
  }
}

if (want('hands')) {
  const floorPath = 'benchmarks/floor.json';
  const cli = CLI;
  const floor = existsSync(floorPath) ? JSON.parse(readFileSync(floorPath, 'utf8')) : null;
  const usage = cliUsage();
  const hasEvalHands = usage !== null && /\bevalhands\b/.test(usage);
  if (!floor?.hands) skip('hands', 'no hands block in benchmarks/floor.json');
  else if (!hasEvalHands) skip('hands', 'engine CLI has no evalhands command yet');
  else if (!existsSync(floor.goldDir)) skip('hands', `dataset missing: ${floor.goldDir}`);
  else {
    const args = [
      cli,
      'evalhands',
      '--gold',
      floor.goldDir,
      '--split',
      floor.split,
      '--subset',
      'test',
      '--library',
      'content/manifest.json',
      '--out',
      `${RUNS}/verify-hands.json`,
      '--label',
      'verify',
    ];
    if (typeof floor.hands.accuracyMin === 'number') args.push('--floor', floorPath);
    run('hands', 'node', args);
  }
}

// The light embellishment gate ("Add notes between"): the guard, the independent check, the lint
// at every hand profile and the level heuristic on the library's level 1 and 2 pieces, against
// benchmarks/floor.json `embellish.offeredMin`. Needs only the committed library and the build.
if (want('embellish')) {
  const cli = CLI;
  const usage = cliUsage();
  if (usage === null) skip('embellish', 'engine not built (run the build step first)');
  else if (!/\bembellish\b/.test(usage))
    skip('embellish', 'engine CLI has no embellish command yet');
  else
    run('embellish', 'node', [
      cli,
      'embellish',
      '--library',
      LIBRARY_MANIFEST,
      '--floor',
      'benchmarks/floor.json',
      '--out',
      `${RUNS}/verify-embellish.json`,
    ]);
}

process.stdout.write('\n=== verify summary\n');
for (const r of results)
  process.stdout.write(`${r.status.padEnd(5)} ${r.name.padEnd(17)} ${r.detail}\n`);
const failed = results.filter((r) => r.status === 'FAIL');
process.stdout.write(
  failed.length ? `\n${failed.length} step(s) failed\n` : '\nall steps passed\n',
);
process.exitCode = failed.length ? 1 : 0;
