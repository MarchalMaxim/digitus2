import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateCorpus, validateCorpus } from './evaluate.mjs';

const xml = (step = 'C') => `<?xml version="1.0"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
</measure></part></score-partwise>`;

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'digitus2-omr-eval-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const recognizedDir = join(dir, 'exports');
  mkdirSync(recognizedDir);
  const pieces = ['piece-a', 'piece-b'].map((id) => {
    const reference = `${id}.musicxml`;
    writeFileSync(join(dir, reference), xml());
    return { id, reference, sha256: createHash('sha256').update(xml()).digest('hex') };
  });
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, pieces }));
  return { dir, manifestPath, recognizedDir, candidate: 'test-only' };
}

test('identical exports score 1 and a pitch error reduces both corpus averages', async (t) => {
  const f = fixture(t);
  for (const id of ['piece-a', 'piece-b'])
    writeFileSync(join(f.recognizedDir, `${id}.musicxml`), xml());
  const perfect = await evaluateCorpus(f);
  assert.equal(perfect.summary.metrics.fullNote.f1, 1);
  assert.equal(perfect.summary.failed, 0);
  writeFileSync(join(f.recognizedDir, 'piece-b.musicxml'), xml('D'));
  const damaged = await evaluateCorpus(f);
  assert.equal(damaged.summary.metrics.pitch.f1, 0.5);
  assert.equal(damaged.summary.metrics.pitch.macroF1, 0.5);
  assert.equal(damaged.recognitionExecuted, false);
});

test('missing and malformed exports stay in the denominator', async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.recognizedDir, 'piece-a.musicxml'), '<not-a-score/>');
  const report = await evaluateCorpus(f);
  assert.equal(report.summary.failed, 2);
  assert.deepEqual(
    report.pieces.map((p) => p.status),
    ['invalid', 'missing'],
  );
  assert.equal(report.summary.metrics.pitch.reference, 2);
  assert.equal(report.summary.metrics.pitch.recall, 0);
  assert.equal(report.summary.metrics.pitch.macroF1, 0);
});

test('import normalization cannot hide duplicate notes or chord duration errors', async (t) => {
  const f = fixture(t);
  const chord =
    '<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>';
  const gold = xml().replace('</measure>', `${chord}</measure>`);
  const manifest = JSON.parse(readFileSync(f.manifestPath, 'utf8'));
  for (const piece of manifest.pieces) {
    writeFileSync(join(f.dir, piece.reference), gold);
    piece.sha256 = createHash('sha256').update(gold).digest('hex');
  }
  writeFileSync(f.manifestPath, JSON.stringify(manifest));
  writeFileSync(
    join(f.recognizedDir, 'piece-a.musicxml'),
    gold.replace('</measure>', `${chord}</measure>`),
  );
  writeFileSync(
    join(f.recognizedDir, 'piece-b.musicxml'),
    gold.replace(chord, chord.replace('<duration>4</duration>', '<duration>8</duration>')),
  );
  const report = await evaluateCorpus(f);
  assert.equal(report.pieces[0].evaluation.recognizedNotes, 3);
  assert.equal(report.pieces[0].evaluation.metrics.pitch.precision, 2 / 3);
  assert.equal(report.pieces[1].evaluation.metrics.duration.f1, 0.5);
});

test('ambiguous exports fail instead of choosing a convenient candidate', async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.recognizedDir, 'piece-a.musicxml'), xml());
  writeFileSync(join(f.recognizedDir, 'piece-a.xml'), xml('D'));
  const report = await evaluateCorpus(f);
  assert.equal(report.pieces[0].status, 'invalid');
  assert.match(report.pieces[0].error, /ambiguous/);
});

test('reference hashes and manifest membership are enforced', async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.dir, 'piece-a.musicxml'), xml('D'));
  await assert.rejects(evaluateCorpus(f), /hash mismatch/);
  const manifest = JSON.parse(readFileSync(f.manifestPath, 'utf8'));
  manifest.pieces.push(manifest.pieces[0]);
  assert.throws(() => validateCorpus(manifest), /duplicate/);
  manifest.pieces[0].id = '../escape';
  assert.throws(() => validateCorpus(manifest), /invalid corpus piece id/);
});

test('reference traversal is rejected and existing reports are preserved', async (t) => {
  const f = fixture(t);
  const out = join(f.dir, 'result.json');
  await evaluateCorpus({ ...f, out });
  const previous = readFileSync(out, 'utf8');
  await assert.rejects(evaluateCorpus({ ...f, out }), /already exists/);
  assert.equal(readFileSync(out, 'utf8'), previous);
  const manifest = JSON.parse(readFileSync(f.manifestPath, 'utf8'));
  manifest.pieces[0].reference = '../outside.musicxml';
  writeFileSync(f.manifestPath, JSON.stringify(manifest));
  await assert.rejects(evaluateCorpus(f), /escapes/);
});
