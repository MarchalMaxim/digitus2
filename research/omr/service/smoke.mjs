#!/usr/bin/env node
// The check after a build or a deploy: posts one phone photo and one corpus PDF to a running scan
// service (protocol digitus2-scan-v2) with the Pages origin, prints the state, recogniser, seconds
// and MusicXML size per route, and exits 1 unless every answer is a ready score-partwise.
//
//   node research/omr/service/smoke.mjs URL [--photo PATH] [--pdf PATH]
//
// The photo defaults to research/omr/photos/boellmann-op28-page5-flat.jpeg; the PDF to the first
// *.pdf under the newest research/omr/results/acceptance/fixtures-*/ directory (skipped with a note
// when none has been rendered; node research/omr/prepare.mjs renders them).
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const OMR = resolve(HERE, '..');
const ORIGIN = 'https://marchalmaxim.github.io';
const PLACEHOLDER = 'scan.digitus2.invalid';
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf' };

function fail(message) {
  console.error(message);
  process.exit(1);
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} needs a path`);
  return resolve(value);
}

function pdfsUnder(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return pdfsUnder(path);
      return entry.isFile() && extname(entry.name).toLowerCase() === '.pdf' ? [path] : [];
    });
}

function defaultPdf() {
  const root = join(OMR, 'results/acceptance');
  if (!existsSync(root)) return undefined;
  const newest = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('fixtures-'))
    .map((entry) => join(root, entry.name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  return newest ? pdfsUnder(newest)[0] : undefined;
}

export function rootElement(xml) {
  return /<(?![?!])([A-Za-z_][\w.:-]*)/.exec(xml.replace(/<!--[\s\S]*?-->/g, ''))?.[1];
}

async function recognize(base, label, path) {
  const type = TYPES[extname(path).toLowerCase()];
  if (!type) fail(`${label}: unsupported file type ${path}`);
  const started = performance.now();
  let response;
  try {
    response = await fetch(new URL('/v1/recognize', base), {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': type,
        'X-Digitus2-Client': '1',
        'X-Digitus2-Job': randomBytes(16).toString('hex'),
      },
      body: readFileSync(path),
    });
  } catch (error) {
    console.error(`${label}: no answer from ${base}: ${error.cause?.message ?? error.message}`);
    return false;
  }
  const text = await response.text();
  const seconds = Math.round((performance.now() - started) / 100) / 10;
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    console.error(`${label}: HTTP ${response.status}, not JSON: ${text.slice(0, 200)}`);
    return false;
  }
  const xml = typeof body.xml === 'string' ? body.xml : '';
  const summary = {
    state: body.state ?? body.error,
    recognizer: body.recognizer,
    seconds,
    xmlBytes: Buffer.byteLength(xml),
  };
  console.log(label, inspect(summary, { breakLength: Infinity }));
  if (response.status !== 200 || body.state !== 'ready') {
    console.error(`${label}: HTTP ${response.status}`, inspect(body.failure ?? body, { depth: 4 }));
    return false;
  }
  if (rootElement(xml) !== 'score-partwise') {
    console.error(`${label}: the answer's xml is not a score-partwise document`);
    return false;
  }
  return true;
}

async function main() {
  const url = process.argv[2];
  if (!url || url.startsWith('--'))
    fail('Usage: node research/omr/service/smoke.mjs URL [--photo PATH] [--pdf PATH]');
  let base;
  try {
    base = new URL(url);
  } catch {
    fail(`Not a URL: ${url}`);
  }
  if (base.hostname === PLACEHOLDER)
    fail(`${url} is the placeholder for the undeployed service; pass the deployed or local URL.`);
  const photo = option('--photo') ?? join(OMR, 'photos/boellmann-op28-page5-flat.jpeg');
  const pdf = option('--pdf') ?? defaultPdf();
  let ok = true;
  for (const [label, path] of [
    ['photo', photo],
    ['pdf', pdf],
  ]) {
    if (!path) {
      console.log(`${label}: skipped, no rendered fixture PDF (run node research/omr/prepare.mjs)`);
      continue;
    }
    if (!existsSync(path)) fail(`${label}: ${path} does not exist`);
    ok = (await recognize(base, label, path)) && ok;
  }
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
