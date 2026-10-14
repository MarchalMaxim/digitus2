#!/usr/bin/env node
// digitus2 verification loop: one command that says whether the project is healthy.
//
//   pnpm verify            run every step
//   pnpm verify unit       run only the named steps (hygiene, design, typecheck, lint, unit, build,
//                          bundle, e2e, benchmark, hands)
//
// Exit code is non-zero if any step fails. The bundle step (after build) fails when the library
// page's initial JavaScript and CSS exceed 150 KB gzip or Verovio is statically imported
// (scripts/check-bundle-size.mjs). The benchmark step compares the engine's PIG
// test-split scores with benchmarks/floor.json and fails on a regression; it is skipped
// (and says so) while the engine has no `bench` command or the dataset is absent. The hands step
// scores MIDI hand separation (`digitus2 evalhands`) on the PIG test split and the library, writes
// benchmarks/latest-hands.json, and fails when the PIG macro accuracy drops below
// hands.accuracyMin in benchmarks/floor.json; while that is null it only reports.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const only = new Set(process.argv.slice(2));
const want = (name) => only.size === 0 || only.has(name);
const results = [];

function run(name, cmd, args) {
  const started = Date.now();
  process.stdout.write(`\n=== ${name}: ${cmd} ${args.join(' ')}\n`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  results.push({ name, status: r.status === 0 ? 'PASS' : 'FAIL', detail: `${seconds}s` });
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
if (want('bundle')) run('bundle', 'node', ['scripts/check-bundle-size.mjs']);

if (want('e2e')) {
  if (existsSync('apps/web/playwright.config.ts'))
    run('e2e', 'pnpm', ['--filter', '@digitus2/web', 'e2e']);
  else skip('e2e', 'no apps/web/playwright.config.ts yet');
}

if (want('benchmark')) {
  const floorPath = 'benchmarks/floor.json';
  const cli = 'packages/engine/dist/cli/main.js';
  if (!existsSync(floorPath)) skip('benchmark', 'no benchmarks/floor.json');
  else {
    const floor = JSON.parse(readFileSync(floorPath, 'utf8'));
    const usage = existsSync(cli)
      ? spawnSync('node', [cli], { encoding: 'utf8', shell: true })
      : null;
    const hasBench = usage && /\bbench\b/.test(`${usage.stdout}${usage.stderr}`);
    if (!hasBench) skip('benchmark', 'engine CLI has no bench command yet');
    else if (!existsSync(floor.goldDir)) skip('benchmark', `dataset missing: ${floor.goldDir}`);
    else if (floor.engine === null)
      run('benchmark', 'node', [cli, 'bench', '--gold', floor.goldDir, '--split', floor.split]);
    else
      run('benchmark', 'node', [
        cli,
        'bench',
        '--gold',
        floor.goldDir,
        '--split',
        floor.split,
        '--floor',
        floorPath,
      ]);
  }
}

if (want('hands')) {
  const floorPath = 'benchmarks/floor.json';
  const cli = 'packages/engine/dist/cli/main.js';
  const floor = existsSync(floorPath) ? JSON.parse(readFileSync(floorPath, 'utf8')) : null;
  const usage = existsSync(cli)
    ? spawnSync('node', [cli], { encoding: 'utf8', shell: true })
    : null;
  const hasEvalHands = usage && /\bevalhands\b/.test(`${usage.stdout}${usage.stderr}`);
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
      'benchmarks/latest-hands.json',
      '--label',
      'verify',
    ];
    if (typeof floor.hands.accuracyMin === 'number') args.push('--floor', floorPath);
    run('hands', 'node', args);
  }
}

process.stdout.write('\n=== verify summary\n');
for (const r of results)
  process.stdout.write(`${r.status.padEnd(5)} ${r.name.padEnd(10)} ${r.detail}\n`);
const failed = results.filter((r) => r.status === 'FAIL');
process.stdout.write(
  failed.length ? `\n${failed.length} step(s) failed\n` : '\nall steps passed\n',
);
process.exitCode = failed.length ? 1 : 0;
