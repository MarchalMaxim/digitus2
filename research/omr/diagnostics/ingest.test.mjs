import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { caseFiles, caseName, ingest, Refusal, zipEntries } from './ingest.mjs';

const { strToU8, zipSync } = createRequire(
  resolve(import.meta.dirname, '../../../packages/engine/package.json'),
)('fflate');

/** A "Download everything" archive's entries, as apps/web/src/scan/bundle.ts writes them. */
function bundle({ pages = 2, recognizedAt = '2026-10-28T21:58:47.923Z', omit = [], entry } = {}) {
  const entries = {};
  const summaries = [];
  for (let n = 1; n <= pages; n++) {
    const photo = entry?.(n) ?? `page-${n}.jpg`;
    entries[photo] = strToU8(`jpeg bytes of page ${n}`);
    entries[`page-${n}-recognized.musicxml`] = strToU8(`<score-partwise>${n}</score-partwise>`);
    summaries.push({ entry: photo, name: `photo 22.57.1${n}.jpg`, type: 'image/jpeg', warnings: [] });
  }
  entries['combined-recognized.musicxml'] = strToU8('<score-partwise/>');
  entries['../escape.txt'] = strToU8('never written');
  entries['scan.json'] = strToU8(JSON.stringify({ recognizedAt, pages: summaries }));
  for (const name of omit) delete entries[name];
  return entries;
}

const refusal = (entries) => {
  try {
    caseFiles(entries);
  } catch (error) {
    assert.ok(error instanceof Refusal, String(error));
    return error.message;
  }
  assert.fail('accepted');
};

test('an archive gives its photos, their recognitions and scan.json, and nothing else', () => {
  const { files, summary } = caseFiles(zipEntries(zipSync(bundle())));
  assert.deepEqual([...files.keys()].sort(), [
    'page-1-recognized.musicxml',
    'page-1.jpg',
    'page-2-recognized.musicxml',
    'page-2.jpg',
    'scan.json',
  ]);
  assert.equal(summary.pages.length, 2);
});

test('anything that is not such an archive is refused with the reason', () => {
  assert.throws(() => zipEntries(strToU8('not a zip at all')), /not a ZIP archive/);
  assert.match(refusal(bundle({ omit: ['scan.json'] })), /no scan\.json/);
  assert.match(refusal({ 'scan.json': strToU8('{') }), /does not parse/);
  assert.match(refusal({ 'scan.json': strToU8('{"pages":[]}') }), /lists no pages/);
  assert.match(refusal(bundle({ omit: ['page-2-recognized.musicxml'] })), /page 2 was not recognized/);
  assert.match(refusal(bundle({ omit: ['page-1.jpg'] })), /page 1: page-1\.jpg is missing/);
  assert.match(refusal(bundle({ pages: 1, entry: () => 'page-1.pdf' })), /page 1 is a PDF/);
  // Pages out of order, or an entry named outside the case: never read.
  assert.match(refusal(bundle({ entry: (n) => `page-${3 - n}.jpg` })), /page 1 is not a photo/);
  assert.match(refusal(bundle({ pages: 1, entry: () => '../page-1.jpg' })), /page 1 is not a photo/);
});

test('a case is named from the archive and the day it was recognized', () => {
  assert.equal(
    caseName('C:/Downloads/photo 22.57.16-scan.zip', { recognizedAt: '2026-10-28T12:00:00Z' }),
    'photo-22-57-16-2026-10-28',
  );
  assert.equal(
    caseName('Boëllmann Op. 28 (1)-scan.zip', {}, new Date(2026, 9, 19)),
    'boellmann-op-28-1-2026-10-19',
  );
});

test('ingest writes the case once; the same scan again is found by its content', () => {
  const root = mkdtempSync(join(tmpdir(), 'scan-cases-'));
  try {
    const store = join(root, 'cases');
    const archive = join(root, 'photo 22.57.16-scan.zip');
    writeFileSync(archive, zipSync(bundle({ recognizedAt: '2026-10-28T12:00:00Z' })));
    assert.deepEqual(ingest(archive, store), {
      status: 'ingested',
      name: 'photo-22-57-16-2026-10-28',
    });
    const dir = join(store, 'photo-22-57-16-2026-10-28');
    assert.equal(readFileSync(join(dir, 'page-2.jpg'), 'utf8'), 'jpeg bytes of page 2');
    assert.ok(!existsSync(join(root, 'escape.txt')));
    // The owner renamed the folder: the same archive is still present, under its new name.
    const copy = join(root, 'again-scan.zip');
    writeFileSync(copy, zipSync(bundle({ recognizedAt: '2026-10-28T12:00:00Z' })));
    writeFileSync(join(dir, 'review.png'), 'a screenshot the gate wrote');
    assert.deepEqual(ingest(copy, store), { status: 'present', name: 'photo-22-57-16-2026-10-28' });
    // Another scan of the same name and day gets a folder of its own.
    writeFileSync(archive, zipSync(bundle({ pages: 1, recognizedAt: '2026-10-28T12:00:00Z' })));
    assert.equal(ingest(archive, store).name, 'photo-22-57-16-2026-10-28-2');
    assert.deepEqual(readdirSync(store).sort(), [
      'photo-22-57-16-2026-10-28',
      'photo-22-57-16-2026-10-28-2',
    ]);
    const bad = join(root, 'other-scan.zip');
    writeFileSync(bad, 'not a zip');
    assert.deepEqual(ingest(bad, store), { status: 'refused', reason: 'not a ZIP archive' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
