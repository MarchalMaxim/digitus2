import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertOutputAbsent,
  CONFIG,
  DEFAULT_SLUGS,
  expandPageViewBox,
  normalizePdfMetadata,
  parseArgs,
  safeRelativePath,
  selectPieces,
  validateManifest,
} from './prepare.mjs';

const a4Page = { x: 0, y: 0, width: 1260, height: 1782 };
function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);
}

test('padded Twinkle ink keeps the A4 ratio and fits without stretching', () => {
  const ink = { x: 41, y: -20.8278, width: 1189, height: 729 };
  const expanded = expandPageViewBox(a4Page, ink, 12);
  closeTo(expanded.y, -32.8278);
  closeTo(expanded.height, 1814.8278);
  closeTo(expanded.width / expanded.height, a4Page.width / a4Page.height);
  closeTo(expanded.x + expanded.width / 2, a4Page.width / 2);
  assert.ok(expanded.x <= ink.x - 12);
  assert.ok(expanded.y <= ink.y - 12);
  assert.ok(expanded.x + expanded.width >= ink.x + ink.width + 12);
  assert.ok(expanded.y + expanded.height >= ink.y + ink.height + 12);
});

test('horizontal overflow expands height symmetrically and a fitting page stays unchanged', () => {
  const ink = { x: -40, y: 100, width: 1360, height: 1200 };
  const expanded = expandPageViewBox(a4Page, ink, 12);
  closeTo(expanded.x, -52);
  closeTo(expanded.width, 1384);
  closeTo(expanded.width / expanded.height, a4Page.width / a4Page.height);
  closeTo(expanded.y + expanded.height / 2, a4Page.height / 2);
  assert.deepEqual(
    expandPageViewBox(a4Page, { x: 40, y: 50, width: 1180, height: 1600 }, 12),
    a4Page,
  );
});

test('page geometry requires finite coordinates, positive dimensions, and nonnegative padding', () => {
  const ink = { x: 20, y: 20, width: 500, height: 500 };
  for (const invalid of [NaN, Infinity, -Infinity]) {
    for (const key of ['x', 'y', 'width', 'height']) {
      assert.throws(() => expandPageViewBox({ ...a4Page, [key]: invalid }, ink, 12));
      assert.throws(() => expandPageViewBox(a4Page, { ...ink, [key]: invalid }, 12));
    }
    assert.throws(() => expandPageViewBox(a4Page, ink, invalid));
  }
  for (const value of [0, -1]) {
    for (const key of ['width', 'height']) {
      assert.throws(() => expandPageViewBox({ ...a4Page, [key]: value }, ink, 12));
      assert.throws(() => expandPageViewBox(a4Page, { ...ink, [key]: value }, 12));
    }
  }
  assert.throws(() => expandPageViewBox(a4Page, ink, -1));
  assert.deepEqual(expandPageViewBox(a4Page, ink, 0), a4Page);
});

const source = {
  name: 'Fixture',
  license: 'CC0-1.0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
};
const catalog = DEFAULT_SLUGS.map((slug) => ({
  slug,
  title: slug,
  source,
  files: { score: `scores/${slug}.musicxml` },
}));
function fixtureManifest() {
  return {
    schemaVersion: 1,
    renderer: { name: 'Verovio', version: '6.3.0', options: {} },
    config: CONFIG,
    pieces: [
      {
        id: 'test',
        title: 'Test',
        reference: 'test/reference.musicxml',
        sha256: 'a'.repeat(64),
        source,
        pdf: 'test/clean.pdf',
        pages: [1, 2].map((page) => ({
          page,
          svg: `test/${page}.svg`,
          images: Object.fromEntries(
            Object.keys(CONFIG.variants).map((variant) => [variant, `test/${page}-${variant}.png`]),
          ),
        })),
      },
    ],
  };
}

test('CLI parses exact selections and rejects ambiguous or unsupported flags', () => {
  assert.deepEqual(parseArgs(['--out', 'scans', '--slugs', 'a,b']), {
    out: 'scans',
    slugs: ['a', 'b'],
  });
  for (const args of [
    ['--out'],
    ['--out', '--slugs', 'a'],
    ['--force'],
    ['--out', 'a', '--out', 'b'],
  ]) {
    assert.throws(() => parseArgs(args));
  }
});

test('defaults select three scores in a stable order and preserve provenance', () => {
  const selected = selectPieces([...catalog].reverse());
  assert.deepEqual(
    selected.map((piece) => piece.slug),
    DEFAULT_SLUGS,
  );
  assert.equal(selected[0].source, source);
  assert.deepEqual(selectPieces(catalog, [DEFAULT_SLUGS[2]]), [catalog[2]]);
});

test('selection rejects unknown, duplicate and traversal slugs before reading files', () => {
  for (const slugs of [
    [],
    ['unknown'],
    [DEFAULT_SLUGS[0], DEFAULT_SLUGS[0]],
    ['../score'],
    ['a/b'],
    ['C:\\score'],
    [''],
  ]) {
    assert.throws(() => selectPieces(catalog, slugs));
  }
  assert.throws(() => selectPieces([...catalog, catalog[0]], [DEFAULT_SLUGS[0]]));
  assert.throws(() =>
    selectPieces([{ ...catalog[0], files: { score: '../private.musicxml' } }], [DEFAULT_SLUGS[0]]),
  );
  assert.throws(() => selectPieces([{ ...catalog[0], source: {} }], [DEFAULT_SLUGS[0]]));
});

test('manifest paths are portable and cannot escape the manifest directory', () => {
  assert.equal(safeRelativePath('piece/page-001-clean.png'), 'piece/page-001-clean.png');
  for (const value of [
    '',
    '/root/file',
    '../file',
    'piece/../file',
    'piece//file',
    './file',
    'C:/file',
    '\\server\\file',
    'piece\\file',
    'piece/.. /file',
    'piece/score\u0000.xml',
  ]) {
    assert.throws(() => safeRelativePath(value));
  }
});

test('PDF metadata dates are deterministic without shifting cross-reference offsets', () => {
  const bytes = Buffer.from(
    "%PDF-1.7\n/CreationDate (D:20261015181022+00'00')\n/ModDate (D:20261015181022+00'00')\n\u00ff\u0000stream",
    'latin1',
  );
  const normalized = normalizePdfMetadata(bytes);
  assert.equal(normalized.length, bytes.length);
  assert.equal(normalized.indexOf('stream'), bytes.indexOf('stream'));
  assert.match(normalized.toString('latin1'), /CreationDate \(D:20000101000000/);
  assert.match(normalized.toString('latin1'), /ModDate \(D:20000101000000/);
  assert.deepEqual(normalizePdfMetadata(normalized), normalized);
  assert.equal(normalized.at(-8), 255);
});

test('schema requires all variants, provenance, unique paths and full sequential pages', () => {
  assert.equal(validateManifest(fixtureManifest()).pieces[0].pages.length, 2);
  for (const mutate of [
    (m) => {
      delete m.pieces[0].pages[1].images.shadow;
    },
    (m) => {
      m.pieces[0].pages[1].page = 3;
    },
    (m) => {
      m.pieces[0].pages[1].svg = m.pieces[0].pages[0].svg;
    },
    (m) => {
      m.pieces[0].reference = '../reference.musicxml';
    },
    (m) => {
      m.pieces[0].sha256 = 'invalid';
    },
    (m) => {
      delete m.pieces[0].source.license;
    },
    (m) => {
      m.pieces[0].pages = [];
    },
  ]) {
    const manifest = structuredClone(fixtureManifest());
    mutate(manifest);
    assert.throws(() => validateManifest(manifest));
  }
});

test('existing output is always refused, including files and empty directories', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'omr-prepare-'));
  try {
    const out = path.join(temp, 'fixtures');
    await assertOutputAbsent(out);
    await mkdir(out);
    await assert.rejects(assertOutputAbsent(out), /already exists/);
    const file = path.join(temp, 'existing-file');
    await writeFile(file, 'sentinel');
    await assert.rejects(assertOutputAbsent(file), /already exists/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
