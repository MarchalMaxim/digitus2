#!/usr/bin/env node
// Puts the piano samples where the app serves them (issue #51): downloads the release asset named
// in scripts/piano-samples.lock.json, checks its size and SHA-256, checks every file against the
// asset's manifest, and unpacks it into apps/web/public/piano (gitignored). vite dev, vite preview
// and the build then serve the samples at <base>piano/. The Pages workflow runs it before the
// build; run it once locally to hear the piano. A run with nothing to do says so. Run it from the
// repository root.
//
//   node scripts/fetch-piano-samples.mjs [--from <tar>] [--dest <dir>]
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LOCK_FILE, checkAssetEntries, readTar, sha256 } from './piano-samples-lib.mjs';

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
const dest = resolve(arg('--dest') ?? 'apps/web/public/piano');
const from = arg('--from');
/** Written last: the SHA-256 of the asset the directory was unpacked from. */
const MARKER = 'asset.sha256';

function upToDate() {
  try {
    if (readFileSync(join(dest, MARKER), 'utf8').trim() !== lock.sha256) return false;
    const names = ['README.md', 'manifest.json', ...lock.files];
    checkAssetEntries(
      names.map((name) => ({ name, data: new Uint8Array(readFileSync(join(dest, name))) })),
      lock,
    );
    return true;
  } catch {
    return false;
  }
}

if (upToDate()) {
  process.stdout.write(`piano samples up to date in ${dest}\n`);
} else {
  let tar;
  if (from) {
    tar = new Uint8Array(readFileSync(from));
  } else {
    const url = `https://github.com/${lock.repository}/releases/download/${lock.tag}/${lock.asset}`;
    process.stdout.write(`downloading ${url}\n`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    tar = new Uint8Array(await response.arrayBuffer());
  }
  if (tar.length !== lock.bytes || sha256(tar) !== lock.sha256)
    throw new Error(
      `the asset does not match ${LOCK_FILE}: ${tar.length} bytes, SHA-256 ${sha256(tar)}`,
    );
  const entries = readTar(tar);
  checkAssetEntries(entries, lock); // only safe plain names: nothing can land outside dest
  const partial = `${dest}.partial`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  for (const e of entries) writeFileSync(join(partial, e.name), e.data);
  writeFileSync(join(partial, MARKER), `${lock.sha256}\n`);
  rmSync(dest, { recursive: true, force: true });
  renameSync(partial, dest);
  process.stdout.write(`piano samples: ${entries.length} files unpacked into ${dest}\n`);
}
