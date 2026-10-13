#!/usr/bin/env node
// Repository hygiene: keeps git fast and the checkout lean.
//
// Fails when:
//   - any tracked or stage-able (untracked, not ignored) file exceeds MAX_FILE_KB,
//     unless its path is in ALLOW (exact) or matches an ALLOW_GLOB prefix;
//   - a directory known to be heavy is not ignored by git;
//   - the total size of trackable files exceeds MAX_TOTAL_MB.
// Prints the ten largest trackable files either way.
import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';

const MAX_FILE_KB = 1024;
const MAX_TOTAL_MB = 60;
const ALLOW_PREFIX = ['content/scores/']; // engraved scores may be up to 1.5 MB (checked below)
const SCORE_MAX_KB = 1536;
const MUST_BE_IGNORED = [
  'node_modules',
  'research/baselines/third_party',
  'research/baselines/outputs',
  'research/data/pig',
  'research/spikes/render/node_modules',
  'content/_raw',
];

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf8' }).split('\n').filter(Boolean);
}

const files = new Set([...git('ls-files'), ...git('ls-files -o --exclude-standard')]);
const sized = [];
for (const f of files) {
  try {
    sized.push({ f, kb: statSync(f).size / 1024 });
  } catch {
    // deleted or unreadable; ignore
  }
}
sized.sort((a, b) => b.kb - a.kb);

const problems = [];
let totalKb = 0;
for (const { f, kb } of sized) {
  totalKb += kb;
  const isScore = ALLOW_PREFIX.some((p) => f.startsWith(p));
  const limit = isScore ? SCORE_MAX_KB : MAX_FILE_KB;
  if (kb > limit) problems.push(`${f} is ${kb.toFixed(0)} KB (limit ${limit} KB)`);
}
if (totalKb / 1024 > MAX_TOTAL_MB) problems.push(`trackable files total ${(totalKb / 1024).toFixed(1)} MB (limit ${MAX_TOTAL_MB} MB)`);

for (const dir of MUST_BE_IGNORED) {
  try {
    statSync(dir);
  } catch {
    continue; // not present, nothing to check
  }
  const ignored = (() => {
    try {
      execSync(`git check-ignore -q "${dir}"`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  if (!ignored) problems.push(`${dir} exists but is not ignored by git`);
}

process.stdout.write(`trackable files: ${sized.length}, total ${(totalKb / 1024).toFixed(1)} MB\nlargest:\n`);
for (const { f, kb } of sized.slice(0, 10)) process.stdout.write(`  ${kb.toFixed(0).padStart(6)} KB  ${f}\n`);
if (problems.length) {
  process.stdout.write(`\nrepo hygiene problems:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('\nrepo hygiene ok\n');
}
