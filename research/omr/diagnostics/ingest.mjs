// Turns a scan's "Download everything" archive (apps/web/src/scan/bundle.ts) into a validation
// case (issue 233, docs/scanning.md "Validation cases"): a folder in DIGITUS2_SCAN_CASES holding
// page-N.jpg (or .png), page-N-recognized.musicxml for N = 1..k, and the archive's scan.json.
//
//   node research/omr/diagnostics/ingest.mjs <zip or folder> [...]
//   node research/omr/diagnostics/ingest.mjs        every *-scan.zip in Downloads not yet ingested
//
// An archive is untrusted data: only the entries a case holds are read, under names this script
// writes itself, and anything that is not such an archive is refused with the reason.
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// fflate is the engine's own zip library (it reads `.mxl` with it), as the app's archive is made.
const { unzipSync } = createRequire(
  resolve(import.meta.dirname, '../../../packages/engine/package.json'),
)('fflate');

export const SUMMARY = 'scan.json';
const PAGE = /^page-(\d+)\.(jpg|png)$/;
const RECOGNIZED = (n) => `page-${n}-recognized.musicxml`;

/** Why a source is not a case: said to the owner as it is. */
export class Refusal extends Error {}

/**
 * The case files of an archive's entries (a name to its bytes): the page photos, their
 * recognitions and scan.json, checked against scan.json's list of pages. Throws a Refusal.
 */
export function caseFiles(entries) {
  const summaryBytes = entries[SUMMARY];
  if (!summaryBytes) throw new Refusal('no scan.json: not a "Download everything" archive');
  let summary;
  try {
    summary = JSON.parse(new TextDecoder().decode(summaryBytes));
  } catch {
    throw new Refusal('scan.json does not parse');
  }
  const pages = summary?.pages;
  if (!Array.isArray(pages) || pages.length === 0) throw new Refusal('scan.json lists no pages');
  const files = new Map([[SUMMARY, summaryBytes]]);
  pages.forEach((page, index) => {
    const n = index + 1;
    const entry = typeof page?.entry === 'string' ? page.entry : '';
    const match = PAGE.exec(entry);
    if (!match || Number(match[1]) !== n)
      throw new Refusal(
        /\.pdf$/i.test(entry)
          ? `page ${n} is a PDF: a case is made of photos`
          : `page ${n} is not a photo the archive names page-${n}.jpg or .png`,
      );
    if (!entries[entry]) throw new Refusal(`page ${n}: ${entry} is missing`);
    const recognized = entries[RECOGNIZED(n)];
    if (!recognized)
      throw new Refusal(`page ${n} was not recognized${page.error ? ` (${page.error})` : ''}`);
    files.set(entry, entries[entry]);
    files.set(RECOGNIZED(n), recognized);
  });
  return { files, summary };
}

/** The entries of a ZIP archive's bytes. Throws a Refusal when they are not a ZIP. */
export function zipEntries(bytes) {
  try {
    return unzipSync(new Uint8Array(bytes));
  } catch {
    throw new Refusal('not a ZIP archive');
  }
}

/** The entries of a folder: its files, by name (a folder that holds an unzipped archive). */
function folderEntries(dir) {
  const entries = {};
  for (const name of readdirSync(dir))
    if (statSync(join(dir, name)).isFile()) entries[name] = readFileSync(join(dir, name));
  return entries;
}

/**
 * A content fingerprint of a case: its page photos and recognitions, by name. The same scan
 * ingested twice, or a case the owner named by hand, is found by it whatever its folder is called.
 */
export function fingerprint(files) {
  const hash = createHash('sha256');
  for (const name of [...files.keys()].filter((n) => n !== SUMMARY).sort()) {
    hash.update(`${name}\0`);
    hash.update(files.get(name));
  }
  return hash.digest('hex');
}

/** The fingerprint of a case folder already in the store, or undefined when it is no case. */
export function folderFingerprint(dir) {
  const files = new Map();
  for (let n = 1; ; n++) {
    const photo = ['jpg', 'png'].map((ext) => `page-${n}.${ext}`).find((f) => existsSync(join(dir, f)));
    if (!photo || !existsSync(join(dir, RECOGNIZED(n)))) break;
    files.set(photo, readFileSync(join(dir, photo)));
    files.set(RECOGNIZED(n), readFileSync(join(dir, RECOGNIZED(n))));
  }
  return files.size ? fingerprint(files) : undefined;
}

/** The local date (YYYY-MM-DD) of a time. */
function day(date) {
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A case's folder name, from the archive's name and the scan's date: `photo 22.57.16-scan.zip`
 * recognized on 28 October gives `photo-22-57-16-2026-10-28`.
 */
export function caseName(source, summary, fallback = new Date()) {
  const stem =
    basename(source)
      .replace(/\.zip$/i, '')
      .replace(/-scan$/i, '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'scan';
  const at = new Date(summary?.recognizedAt ?? NaN);
  return `${stem}-${day(Number.isNaN(at.getTime()) ? fallback : at)}`;
}

/** The fingerprints of the cases in the store, to their folder names. */
function storeFingerprints(store) {
  const known = new Map();
  if (!existsSync(store)) return known;
  for (const name of readdirSync(store)) {
    const dir = join(store, name);
    if (name.startsWith('.') || !statSync(dir).isDirectory()) continue;
    const print = folderFingerprint(dir);
    if (print) known.set(print, name);
  }
  return known;
}

/**
 * Ingests one archive (or the folder of an unzipped one) into the store.
 * @returns {{ status: 'ingested' | 'present' | 'refused', name?: string, reason?: string }}
 */
export function ingest(source, store, known = storeFingerprints(store)) {
  let files, summary;
  try {
    const isFolder = statSync(source).isDirectory();
    ({ files, summary } = caseFiles(
      isFolder ? folderEntries(source) : zipEntries(readFileSync(source)),
    ));
  } catch (error) {
    if (error instanceof Refusal) return { status: 'refused', reason: error.message };
    return { status: 'refused', reason: `cannot read it: ${error.message}` };
  }
  const print = fingerprint(files);
  if (known.has(print)) return { status: 'present', name: known.get(print) };
  const base = caseName(source, summary, statSync(source).mtime);
  let name = base;
  for (let i = 2; existsSync(join(store, name)); i++) name = `${base}-${i}`;
  // Written beside the store's cases, then moved in whole: a broken ingest leaves no half case.
  const partial = join(store, `.ingest-${process.pid}-${name}`);
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  for (const [file, bytes] of files) writeFileSync(join(partial, file), bytes);
  renameSync(partial, join(store, name));
  known.set(print, name);
  return { status: 'ingested', name };
}

/** The archives in Downloads, the default source: every `*-scan.zip`. */
export function downloadedArchives(downloads = join(homedir(), 'Downloads')) {
  if (!existsSync(downloads)) return [];
  return readdirSync(downloads)
    .filter((name) => /-scan\.zip$/i.test(name))
    .map((name) => join(downloads, name));
}

export function main(args = process.argv.slice(2)) {
  const store = process.env.DIGITUS2_SCAN_CASES;
  if (!store) {
    console.error('Set DIGITUS2_SCAN_CASES to the folder of the scan cases (docs/scanning.md).');
    return 2;
  }
  const sources = args.length ? args : downloadedArchives();
  if (!sources.length) {
    console.log('No *-scan.zip in Downloads: nothing to ingest.');
    return 0;
  }
  mkdirSync(store, { recursive: true });
  const known = storeFingerprints(store);
  let refused = 0;
  for (const source of sources) {
    const result = ingest(source, store, known);
    if (result.status === 'ingested') console.log(`ingested  ${source} -> ${join(store, result.name)}`);
    else if (result.status === 'present') console.log(`present   ${source} (as ${result.name})`);
    else {
      refused++;
      console.log(`refused   ${source}: ${result.reason}`);
    }
  }
  // Refusals of the Downloads sweep are reported, not failed: Downloads holds other zips too.
  return args.length && refused ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main();
