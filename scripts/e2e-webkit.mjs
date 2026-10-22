#!/usr/bin/env node
// Runs the web app's WebKit (iPhone) e2e project in Playwright's Linux image (issue 145).
// Playwright's WebKit for Windows has no video streams, so on a Windows host the score camera's
// Safari run needs Linux; Docker gives it. The checkout is copied into the container without its
// node_modules (built for the host), installed there, built, and tested.
//
//   node scripts/e2e-webkit.mjs [extra playwright arguments]
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = JSON.parse(readFileSync(resolve(root, 'apps/web/package.json'), 'utf8'));
const version = (web.devDependencies?.['@playwright/test'] ?? '').replace(/^[^\d]*/, '');
if (!version) throw new Error('No @playwright/test version in apps/web/package.json');
const image = `mcr.microsoft.com/playwright:v${version}-noble`;
const extra = process.argv
  .slice(2)
  .map((arg) => `'${arg.replaceAll("'", "'\\''")}'`)
  .join(' ');

const inside = [
  'set -e',
  'mkdir -p /work',
  'tar -C /src --exclude=node_modules --exclude=.git --exclude=dist --exclude=playwright-report --exclude=test-results -cf - . | tar -C /work -xf -',
  'cd /work',
  'corepack enable >/dev/null 2>&1',
  'export COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
  'pnpm config set store-dir /pnpm-store >/dev/null',
  'pnpm install --frozen-lockfile --reporter=silent',
  'pnpm --filter @digitus2/web build >/dev/null',
  'cd apps/web',
].join(' && ');
// The results (traces, error context) come back to apps/web/test-results/webkit, pass or fail.
const run = `CI=true pnpm exec playwright test --project=iphone --reporter=list ${extra}; status=$?; rm -rf /out/webkit; cp -r test-results /out/webkit 2>/dev/null; exit $status`;

const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--ipc=host',
    '-v',
    `${root}:/src:ro`,
    '-v',
    `${resolve(root, 'apps/web/test-results')}:/out`,
    '-v',
    'digitus2-pnpm-store:/pnpm-store',
    image,
    'bash',
    '-c',
    `${inside} && { ${run}; }`,
  ],
  { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
);
process.exit(result.status ?? 1);
