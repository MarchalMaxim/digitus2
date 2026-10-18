import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregate, breaches, floorsFrom, missing, pipelineHash, SKIP, toolchains } from './acceptance.mjs';

const metric = (matched, reference, recognized) => ({ matched, reference, recognized });
const row = (recognizer, variant, status, matched, extra = {}) => ({
  recognizer,
  variant,
  status,
  metrics: {
    fullNote: metric(matched, 10, status === 'parsed' ? 10 : 0),
    onsetPitch: metric(matched, 10, status === 'parsed' ? 10 : 0),
    pitch: metric(matched, 10, status === 'parsed' ? 10 : 0),
  },
  errors: status === 'parsed' ? { tiesMissed: 1, tiesExtra: 0, duplicates: 0, wrongStaff: 2, ...extra } : null,
  beams: metric(1, 2, status === 'parsed' ? 2 : 0),
});

test('routes aggregate micro F1 over every page, a failed page counting as an empty one', () => {
  const summary = aggregate([row('homr', 'clean', 'parsed', 9), row('homr', 'clean', 'failed', 0), row('audiveris', 'pdf', 'parsed', 10)]);
  assert.equal(summary['homr:clean'].pages, 2);
  assert.equal(summary['homr:clean'].imported, 1);
  // 9 matched of 20 reference and 10 recognised notes.
  assert.equal(summary['homr:clean'].fullNoteF1, (2 * 9) / 30);
  assert.equal(summary['homr:clean'].wrongStaff, 2);
  assert.equal(summary['audiveris:pdf'].fullNoteF1, 1);
});

test('floors follow the benchmark rule, and a worse run is a breach while an equal run is not', () => {
  const summary = aggregate([row('homr', 'clean', 'parsed', 9)]);
  const floors = floorsFrom(summary);
  assert.deepEqual(floors['homr:clean'], {
    importedMin: 1,
    fullNoteF1Min: 89.5,
    pitchF1Min: 89.5,
    beamF1Min: 49.5,
    tiesMissedMax: 1,
    tiesExtraMax: 0,
    duplicatesMax: 0,
    wrongStaffMax: 2,
  });
  assert.deepEqual(breaches(summary, floors), []);
  const worse = aggregate([row('homr', 'clean', 'parsed', 8, { duplicates: 1 })]);
  assert.deepEqual(breaches(worse, floors), [
    'homr:clean: fullNoteF1 80 below floor 89.5',
    'homr:clean: pitchF1 80 below floor 89.5',
    'homr:clean: duplicates 1 above ceiling 0',
  ]);
  assert.deepEqual(breaches({}, floors), ['homr:clean: not measured']);
  const { tiesExtraMax: _dropped, ...partial } = floors['homr:clean'];
  assert.deepEqual(breaches(summary, { 'homr:clean': partial }), [
    'homr:clean: floor.json lacks tiesExtraMax',
  ]);
  // A route that measures zero never gets a negative floor.
  assert.equal(floorsFrom(aggregate([row('homr', 'clean', 'parsed', 0)]))['homr:clean'].fullNoteF1Min, 0);
});

test('without the recognisers the gate reports why, for verify to skip it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'digitus2-omr-accept-'));
  try {
    const tc = toolchains({
      DIGITUS2_OMR_BUNDLE: join(dir, 'none'),
      DIGITUS2_OMR_TEXT_MODELS: join(dir, 'none'),
      DIGITUS2_OMR_HOMR: join(dir, 'none'),
    });
    assert.match(missing(tc), /Audiveris not prepared/);
    assert.equal(SKIP, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the cache key changes with any file of the recognition pipeline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'digitus2-omr-pipeline-'));
  try {
    const worker = join(dir, 'research/omr/prototypes/local-worker');
    mkdirSync(worker, { recursive: true });
    writeFileSync(join(worker, 'homr.py'), 'one');
    const before = pipelineHash(dir);
    writeFileSync(join(worker, 'homr.py'), 'two');
    assert.notEqual(pipelineHash(dir), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
