#!/usr/bin/env node
// Builds the piano samples' release asset (issue #51): downloads the Splendid Grand Piano samples
// that smplr plays from the source repository at a pinned commit, checks every file against that
// commit's git tree (size and blob SHA-1) and its samples/files.json, and writes one deterministic
// tar with a manifest (SHA-256 per file) and a README. Run it from the repository root.
//
//   node scripts/build-piano-samples.mjs               build; fail if the tar differs from the lock
//   node scripts/build-piano-samples.mjs --write-lock  build and write scripts/piano-samples.lock.json
//
// Output (gitignored): build/piano-samples/splendid-grand-piano-v1.tar and README.md (the release
// notes). Downloads stay in build/piano-samples/source/ and are reused while they still match.
// Set GITHUB_TOKEN if the GitHub API rate limit refuses the tree listing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ASSET_NAME,
  FORMATS,
  LOCK_FILE,
  README,
  SOURCE_COMMIT,
  SOURCE_REPOSITORY,
  assetEntries,
  checkAssetEntries,
  gitBlobSha1,
  lockFor,
  readTar,
  writeTar,
} from './piano-samples-lib.mjs';

const OUT = 'build/piano-samples';
const SOURCE_DIR = join(OUT, 'source');
const RAW = `https://raw.githubusercontent.com/${SOURCE_REPOSITORY}/${SOURCE_COMMIT}`;
const TREE = `https://api.github.com/repos/${SOURCE_REPOSITORY}/git/trees/${SOURCE_COMMIT}?recursive=1`;
const writeLock = process.argv.includes('--write-lock');

async function get(url, attempts = 3) {
  const headers = { 'user-agent': 'digitus2-piano-samples' };
  if (url.startsWith('https://api.github.com/') && process.env.GITHUB_TOKEN)
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= attempts) throw new Error(`${url}: ${error.message}`);
    }
  }
}

const json = (data) => JSON.parse(Buffer.from(data).toString('utf8'));

const tree = json(await get(TREE));
if (tree.truncated) throw new Error('the git tree listing of the source commit is truncated');
const blobs = new Map(
  tree.tree
    .filter((e) => e.type === 'blob' && e.path.startsWith('samples/'))
    .map((e) => [e.path, e]),
);
const names = json(await get(`${RAW}/samples/files.json`));
const wanted = new Set(names.flatMap((n) => FORMATS.map((f) => `samples/${n}.${f}`)));
const missing = [...wanted].filter((p) => !blobs.has(p));
const extra = [...blobs.keys()].filter((p) => p !== 'samples/files.json' && !wanted.has(p));
if (missing.length > 0 || extra.length > 0)
  throw new Error(`files.json and the tree disagree; missing: ${missing}; extra: ${extra}`);

const jobs = [...wanted].sort();
const samples = [];
let next = 0;
async function download() {
  while (next < jobs.length) {
    const path = jobs[next++];
    const blob = blobs.get(path);
    const local = join(SOURCE_DIR, path);
    let data = existsSync(local) ? new Uint8Array(readFileSync(local)) : null;
    if (!data || gitBlobSha1(data) !== blob.sha) {
      data = await get(`${RAW}/${path.split('/').map(encodeURIComponent).join('/')}`);
      mkdirSync(dirname(local), { recursive: true });
      writeFileSync(local, data);
    }
    if (data.length !== blob.size || gitBlobSha1(data) !== blob.sha)
      throw new Error(`${path} does not match the source commit`);
    const file = path.slice('samples/'.length);
    const dot = file.lastIndexOf('.');
    samples.push({
      name: file.slice(0, dot),
      format: file.slice(dot + 1),
      data,
      gitBlobSha1: blob.sha,
    });
  }
}
await Promise.all(Array.from({ length: 8 }, download));

const entries = assetEntries(samples);
const tar = writeTar(entries);
const lock = lockFor(tar, entries);
checkAssetEntries(readTar(tar), lock);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, ASSET_NAME), tar);
writeFileSync(join(OUT, 'README.md'), README);
const mb = (tar.length / 1e6).toFixed(1);
process.stdout.write(
  `${join(OUT, ASSET_NAME)}: ${entries.length} files, ${mb} MB, SHA-256 ${lock.sha256}\n`,
);

if (writeLock) {
  writeFileSync(LOCK_FILE, `${JSON.stringify(lock, null, 2)}\n`);
  process.stdout.write(`wrote ${LOCK_FILE}\n`);
} else {
  const pinned = existsSync(LOCK_FILE) ? JSON.parse(readFileSync(LOCK_FILE, 'utf8')) : null;
  if (pinned?.sha256 === lock.sha256 && pinned.bytes === lock.bytes) {
    process.stdout.write(`matches ${LOCK_FILE}\n`);
  } else {
    process.stdout.write(
      `FAIL the tar differs from ${LOCK_FILE} (run with --write-lock for a new asset)\n`,
    );
    process.exitCode = 1;
  }
}
