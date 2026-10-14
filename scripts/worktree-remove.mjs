#!/usr/bin/env node
// Removes a worktree created by scripts/worktree-add.mjs without touching the linked data:
//   node scripts/worktree-remove.mjs <name> [--delete-branch]
// Every junction or symlink inside the worktree is unlinked first (rmdir on the link itself,
// which never recurses into the target); then git removes the tree, or, when git no longer
// knows the directory, Node deletes it (fs.rm does not follow links either).
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, rmdirSync, rmSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const name = args[0];
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('usage: node scripts/worktree-remove.mjs <name> [--delete-branch]');
  process.exit(2);
}
const root = resolve(execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim());
const dir = resolve(dirname(root), `${basename(root)}-wt`, name);
const branch = `wt/${name}`;

function unlinkLinks(d, depth = 0) {
  let count = 0;
  if (depth > 6) return count; // links live near the top; never walk node_modules deeply
  for (const entry of readdirSync(d)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const p = join(d, entry);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      try {
        rmdirSync(p); // removes the junction/symlink itself on Windows
      } catch {
        unlinkSync(p);
      }
      console.log(`unlinked ${p}`);
      count++;
    } else if (st.isDirectory()) {
      count += unlinkLinks(p, depth + 1);
    }
  }
  return count;
}

/**
 * Stops the processes started inside the worktree (workflow agents leave `vite preview` servers
 * behind), so the delete does not fail with EBUSY on apps/web. Windows only; the match is on the
 * command line, so this never touches a process of another worktree or of the main checkout.
 */
function stopProcessesIn(d) {
  if (process.platform !== 'win32') return;
  const needle = d.replace(/\//g, '\\').replace(/'/g, "''");
  const ps =
    "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*" +
    needle +
    "*' -and $_.ProcessId -ne $PID } | ForEach-Object { Write-Output ('stopping ' + $_.ProcessId + ' ' + $_.Name); Stop-Process -Id $_.ProcessId -Force }";
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  if (r.stdout && r.stdout.trim()) console.log(r.stdout.trim());
}

if (existsSync(dir)) {
  stopProcessesIn(dir);
  unlinkLinks(dir);
  if (unlinkLinks(dir) !== 0) {
    console.error('links remain after unlinking; refusing to delete');
    process.exit(1);
  }
  const registered = execSync('git worktree list --porcelain', { cwd: root, encoding: 'utf8' })
    .split('\n')
    .some((l) => l.startsWith('worktree ') && resolve(l.slice(9)) === dir);
  if (registered) {
    const r = spawnSync(`git worktree remove --force "${dir}"`, {
      cwd: root,
      stdio: 'inherit',
      shell: true,
    });
    if (r.status !== 0) {
      console.error('git worktree remove failed; deleting the directory with Node instead');
      rmSync(dir, { recursive: true, force: true });
    }
  } else {
    rmSync(dir, { recursive: true, force: true });
  }
}
spawnSync('git worktree prune', { cwd: root, stdio: 'inherit', shell: true });
if (args.includes('--delete-branch')) {
  spawnSync(`git branch -D ${branch}`, { cwd: root, stdio: 'inherit', shell: true });
}
console.log(`removed worktree ${name}`);
