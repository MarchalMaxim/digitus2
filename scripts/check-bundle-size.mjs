#!/usr/bin/env node
// Bundle budget for the library page (M4 plan, Task 10; rendering spike section 9).
//
//   node scripts/check-bundle-size.mjs [distDir]     distDir defaults to apps/web/dist
//
// Reads <distDir>/.vite/manifest.json (Vite writes it because build.manifest is true), takes the
// entry chunk and every chunk it imports statically, transitively (`imports`; `dynamicImports`
// load later and are not counted), gzips each of those JavaScript files and the CSS they list,
// and fails when:
//   - the sum exceeds 150 KB gzip (the initial JavaScript and CSS of the library page), or
//   - a statically imported chunk is Verovio (2.3 MB gzip; it must stay a lazy worker chunk).
// Prints the numbers either way. Run by `pnpm verify` as the step `bundle`, after `build`.
// Exported for scripts and tests: initialChunks(manifest), checkBundle(manifest, gzipSizeOf).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

export const BUDGET_BYTES = 150 * 1024;
const VEROVIO = /verovio/i;

/**
 * The manifest keys loaded before the library page can run: every entry chunk and its static
 * imports, transitively, in a stable order (entries first, then breadth first).
 */
export function initialChunks(manifest) {
  const entries = Object.keys(manifest).filter((k) => manifest[k].isEntry === true);
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const key = queue.shift();
    if (seen.has(key) || !(key in manifest)) continue;
    seen.add(key);
    for (const dep of manifest[key].imports ?? []) queue.push(dep);
  }
  return { entries, chunks: [...seen] };
}

/**
 * Applies the budget. `gzipSizeOf(file)` returns the gzip size in bytes of a file path relative
 * to the dist directory. Returns the counted files, their total and the problems found.
 */
export function checkBundle(manifest, gzipSizeOf, budget = BUDGET_BYTES) {
  const problems = [];
  const { entries, chunks } = initialChunks(manifest);
  if (entries.length === 0) problems.push('the manifest has no entry chunk (isEntry: true)');
  const files = [];
  const counted = new Set();
  const count = (file, kind, chunk) => {
    if (counted.has(file)) return;
    counted.add(file);
    files.push({ file, kind, chunk, gzip: gzipSizeOf(file) });
  };
  for (const key of chunks) {
    const chunk = manifest[key];
    if (VEROVIO.test(key) || VEROVIO.test(chunk.file) || VEROVIO.test(chunk.name ?? ''))
      problems.push(`Verovio is statically imported by the entry: ${key} (${chunk.file})`);
    count(chunk.file, 'js', key);
    for (const css of chunk.css ?? []) count(css, 'css', key);
  }
  const total = files.reduce((sum, f) => sum + f.gzip, 0);
  if (total > budget)
    problems.push(
      `initial JavaScript and CSS ${kb(total)} KB gzip exceeds the budget of ${kb(budget)} KB`,
    );
  return { files, total, budget, problems };
}

function kb(bytes) {
  return (bytes / 1024).toFixed(1);
}

if (process.argv[1] && /check-bundle-size\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  const dist = process.argv[2] ?? 'apps/web/dist';
  const manifestPath = join(dist, '.vite', 'manifest.json');
  if (!existsSync(manifestPath)) {
    process.stdout.write(`no ${manifestPath}: build the app first (pnpm build)\n`);
    process.exitCode = 1;
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const result = checkBundle(manifest, (file) => gzipSync(readFileSync(join(dist, file))).length);
    for (const f of result.files)
      process.stdout.write(`${kb(f.gzip).padStart(8)} KB gzip  ${f.kind.padEnd(3)}  ${f.file}\n`);
    process.stdout.write(
      `${kb(result.total).padStart(8)} KB gzip  total (budget ${kb(result.budget)} KB, ` +
        `${result.files.length} file(s) loaded by the library page)\n`,
    );
    for (const p of result.problems) process.stdout.write(`FAIL ${p}\n`);
    process.stdout.write(result.problems.length ? '\nbundle check failed\n' : '\nbundle ok\n');
    process.exitCode = result.problems.length ? 1 : 0;
  }
}
