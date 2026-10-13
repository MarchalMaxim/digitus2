#!/usr/bin/env node
// Creates an isolated git worktree for one workflow and makes it runnable:
//   node scripts/worktree-add.mjs <name> [--from <ref>]      create, link data, install
//   node scripts/worktree-add.mjs <name> --relink            only (re)create the data links
// - worktree at ../thingamajig-wt/<name> on branch wt/<name> (created from <ref>, default main)
// - directory junctions (Windows) or symlinks to the gitignored datasets and venvs, so
//   benchmarks, learning and research scripts find their data without copying gigabytes;
//   a partly tracked directory (research/data holds tracked manifests next to gitignored
//   downloads, research/data/mutopia_fingering holds a tracked manifest next to its files)
//   is walked and each untracked child directory is linked individually
// - pnpm install (uses the shared content-addressable store, so it is fast)
// Remove with: node scripts/worktree-remove.mjs <name>   (never rm -rf: it would follow the links)
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, statSync, symlinkSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const name = args[0];
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('usage: node scripts/worktree-add.mjs <name> [--from <ref>] [--relink]');
  process.exit(2);
}
const relinkOnly = args.includes('--relink');
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

if (!relinkOnly) {
  mkdirSync(wtRoot, { recursive: true });
  if (existsSync(dir)) {
    console.error(`${dir} already exists (use --relink to refresh its data links)`);
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
} else if (!existsSync(dir)) {
  console.error(`${dir} does not exist`);
  process.exit(1);
}

// Gitignored data that scripts expect at fixed relative paths (directories only).
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

function isRealDir(p) {
  try {
    const st = lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

function link(rel, depth = 0) {
  const target = resolve(root, rel);
  const at = resolve(dir, rel);
  if (!isRealDir(target)) return;
  if (!existsSync(at)) {
    mkdirSync(dirname(at), { recursive: true });
    try {
      symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
      console.log(`linked ${rel}`);
    } catch (e) {
      console.warn(`could not link ${rel}: ${e.message}`);
    }
    return;
  }
  // Already present in the worktree: a link we made earlier, or a partly tracked directory.
  if (!isRealDir(at) || depth >= 3) return;
  for (const child of readdirSync(target)) {
    if (child === 'node_modules' || child === '.git') continue;
    if (!statSync(resolve(target, child)).isDirectory()) continue;
    link(`${rel}/${child}`, depth + 1);
  }
}
for (const rel of LINKS) link(rel);

if (!relinkOnly) sh('pnpm install --frozen-lockfile', dir);
console.log(`\nworktree ready: ${dir} (branch ${branch})`);
