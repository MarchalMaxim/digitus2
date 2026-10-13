#!/usr/bin/env node
// Creates an isolated git worktree for one workflow and makes it runnable:
//   node scripts/worktree-add.mjs <name> [--from <ref>]
// - worktree at ../thingamajig-wt/<name> on branch wt/<name> (created from <ref>, default main)
// - directory junctions (Windows) or symlinks to the gitignored datasets and venvs, so
//   benchmarks, learning and research scripts find their data without copying gigabytes
// - pnpm install (uses the shared content-addressable store, so it is fast)
// Remove with: git worktree remove ../thingamajig-wt/<name> && git branch -d wt/<name>
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

const args = process.argv.slice(2);
const name = args[0];
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('usage: node scripts/worktree-add.mjs <name> [--from <ref>]');
  process.exit(2);
}
const fromIdx = args.indexOf('--from');
const from = fromIdx >= 0 ? args[fromIdx + 1] : 'main';

const root = resolve(execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim());
const parent = dirname(root);
const wtRoot = resolve(parent, `${basename(root)}-wt`);
const dir = resolve(wtRoot, name);
const branch = `wt/${name}`;

function sh(cmd, cwd = root) {
  console.log(`$ ${cmd}`);
  const r = spawnSync(cmd, { cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`command failed (${r.status}): ${cmd}`);
    process.exit(r.status ?? 1);
  }
}

mkdirSync(wtRoot, { recursive: true });
if (existsSync(dir)) {
  console.error(`${dir} already exists`);
  process.exit(1);
}
const branchExists =
  spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root })
    .status === 0;
sh(
  branchExists
    ? `git worktree add "${dir}" ${branch}`
    : `git worktree add -b ${branch} "${dir}" ${from}`,
);

// Gitignored data that scripts expect at fixed relative paths.
const LINKS = [
  'research/data',
  'research/.venv',
  'research/.venv-baselines',
  'research/.venv-readability',
  'research/.venv-learn',
  'research/.venv-review',
  'research/baselines/third_party',
  'research/baselines/outputs',
  'research/weights',
  'content/_raw',
  'content/.venv',
];
for (const rel of LINKS) {
  const target = resolve(root, rel);
  const link = resolve(dir, rel);
  if (!existsSync(target) || existsSync(link)) continue;
  mkdirSync(dirname(link), { recursive: true });
  try {
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    console.log(`linked ${rel}`);
  } catch (e) {
    console.warn(`could not link ${rel}: ${e.message}`);
  }
}

sh('pnpm install --frozen-lockfile', dir);
console.log(`\nworktree ready: ${dir} (branch ${branch})`);
