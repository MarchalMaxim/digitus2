import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const id = process.argv[2];
if (!/^[a-z0-9-]+$/.test(id)) throw Error('A retained run ID is required');
const out = resolve('research/omr/results/connector-wave', id);
const corpusRoot = resolve('research/omr/results/fixtures-final');
const manifest = JSON.parse(await readFile(corpusRoot + '/manifest.json', 'utf8'));
const reference = manifest.pieces.find((p) => p.id === 'twinkle-twinkle-little-star');
const bytes = await readFile(resolve(corpusRoot, reference.reference));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (hash(bytes) !== reference.sha256) throw Error('Reference drift');
const raw = await readFile(out + '/twinkle-twinkle-little-star.musicxml');
const proof = JSON.parse(await readFile(out + '/report.json', 'utf8'));
if (hash(raw) !== proof.outputSha256) throw Error('Raw result drift');
const E = await import(pathToFileURL(resolve('packages/engine/dist/src/index.js')));
const actual = E.parseMusicXml(raw, { preserveNotation: true });
const expected = E.parseMusicXml(bytes, { preserveNotation: true });
const report = {
  scope: 'One clean Twinkle fixture only; no other browser-connected fixture claimed',
  method: 'ordinal-bar-exact-projections-v1',
  referenceSha256: reference.sha256,
  rawSha256: hash(raw),
  warnings: actual.warnings,
  evaluation: E.evaluateOmr(expected.score, actual.score),
};
await writeFile(out + '/strict-single-fixture.json', JSON.stringify(report, null, 2), {
  flag: 'wx',
});
console.log(JSON.stringify(report, null, 2));
