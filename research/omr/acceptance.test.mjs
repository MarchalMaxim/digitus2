import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('photo pages are counted by the facts read off the page, and a worse run is a breach', async () => {
  const { photoSummary, photoFloorsFrom, photoBreaches } = await import('./acceptance.mjs');
  const expect = { bars: 24, staves: 2, fifths: 1, time: '3/4' };
  const facts = (bars, staves, imports = true) => ({ imports, bars, staves, fifths: 1, time: '3/4' });
  const rows = [
    { variant: 'as-taken', expect, facts: facts(24, 2) },
    { variant: 'as-taken', expect, facts: facts(28, 2) },
    { variant: 'rotated', expect, facts: facts(24, 1, false) },
    { variant: 'as-taken', expect: { ...expect, time: null }, facts: null },
  ];
  const summary = photoSummary(rows);
  assert.deepEqual(summary['photos:as-taken'], { pages: 3, recognised: 2, imported: 2, barsRight: 1, stavesRight: 2, keyRight: 2, timeRight: 2 });
  assert.deepEqual(summary['photos:rotated'], { pages: 1, recognised: 1, imported: 0, barsRight: 1, stavesRight: 0, keyRight: 1, timeRight: 1 });
  const floors = photoFloorsFrom(summary);
  assert.deepEqual(photoBreaches(summary, floors), []);
  const worse = photoSummary(rows.map((r, i) => (i === 0 ? { ...r, facts: facts(23, 2) } : r)));
  assert.deepEqual(photoBreaches(worse, floors), ['photos:as-taken: barsRight 0 below floor 1']);
});

test('recognizeViaService writes the answer or the failure per job', async () => {
  const { recognizeViaService } = await import('./acceptance.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'digitus2-omr-service-'));
  try {
    writeFileSync(join(dir, 'page.pdf'), '%PDF-1.4');
    writeFileSync(join(dir, 'page.png'), 'png');
    const jobs = [
      { id: 'a:audiveris:pdf', input: join(dir, 'page.pdf'), output: join(dir, 'out', 'a.musicxml') },
      { id: 'a:homr:clean', input: join(dir, 'page.png'), output: join(dir, 'out', 'b.musicxml') },
    ];
    const requests = [];
    const answer = (status, body) => ({ status, json: async () => body, headers: new Headers() });
    const fetch = async (url, init) => {
      requests.push({ url, init });
      return init.headers['Content-Type'] === 'application/pdf'
        ? answer(200, { state: 'ready', xml: '<score-partwise/>' })
        : answer(422, { state: 'failed', failure: { code: 'blur', message: 'blur' } });
    };
    await recognizeViaService(jobs, 'http://scan.test', { fetch });
    assert.equal(readFileSync(jobs[0].output, 'utf8'), '<score-partwise/>');
    assert.match(readFileSync(jobs[1].output + '.failed.json', 'utf8'), /blur/);
    assert.deepEqual(JSON.parse(readFileSync(jobs[1].output + '.failed.json', 'utf8')), { status: 422, message: 'blur' });
    assert.equal(requests.length, 2);
    for (const { url, init } of requests) {
      assert.equal(url, 'http://scan.test/v1/recognize');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['X-Digitus2-Client'], '1');
      assert.ok(init.headers.Origin);
      assert.match(init.headers['X-Digitus2-Job'], /^[0-9a-f]{32}$/);
    }
    assert.equal(requests[1].init.headers['Content-Type'], 'image/png');
    // A job with an output or a recorded failure is not sent again.
    await recognizeViaService(jobs, 'http://scan.test', { fetch });
    assert.equal(requests.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recognizeViaService waits out a busy service and stops on the hourly limit', async () => {
  const { recognizeViaService } = await import('./acceptance.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'digitus2-omr-service-'));
  try {
    writeFileSync(join(dir, 'photo.jpeg'), 'jpeg');
    const job = { id: 'p:homr:as-taken', input: join(dir, 'photo.jpeg'), output: join(dir, 'p.musicxml') };
    const answers = [
      { status: 429, json: async () => ({ error: 'busy' }), headers: new Headers({ 'Retry-After': '2' }) },
      { status: 200, json: async () => ({ xml: '<score-partwise/>' }), headers: new Headers() },
    ];
    const ids = [];
    const waits = [];
    const fetch = async (_url, init) => {
      ids.push(init.headers['X-Digitus2-Job']);
      assert.equal(init.headers['Content-Type'], 'image/jpeg');
      return answers.shift();
    };
    await recognizeViaService([job], 'http://scan.test', { fetch, sleep: async (ms) => waits.push(ms) });
    assert.equal(readFileSync(job.output, 'utf8'), '<score-partwise/>');
    assert.deepEqual(waits, [2000]);
    assert.notEqual(ids[0], ids[1]);
    const limited = { ...job, output: join(dir, 'q.musicxml') };
    const fetchLimited = async () => ({ status: 429, json: async () => ({ error: 'rate-limited' }), headers: new Headers({ 'Retry-After': '600' }) });
    await assert.rejects(recognizeViaService([limited], 'http://scan.test', { fetch: fetchLimited }), /rate-limited/);
    assert.equal(existsSync(limited.output + '.failed.json'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the service cache is named by the recogniser the service reports', async () => {
  const { serviceLabel } = await import('./acceptance.mjs');
  assert.equal(
    serviceLabel('HOMR/ab369ac54277/experimental-piano-photo-cpu (images); Audiveris-5.11.0/x+y (PDF)'),
    'HOMR_ab369ac54277_experimental-piano-photo-cpu_images_Audiveris-5.11.0_x_y_PDF_',
  );
});

test('a timeout or server error is not cached and is asked again; only the recogniser verdict is', async () => {
  const { recognizeViaService } = await import('./acceptance.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'digitus2-omr-service-'));
  try {
    writeFileSync(join(dir, 'slow.png'), 'png');
    writeFileSync(join(dir, 'blur.png'), 'png');
    const slow = { id: 's:homr:clean', input: join(dir, 'slow.png'), output: join(dir, 's.musicxml') };
    const blur = { id: 'b:homr:clean', input: join(dir, 'blur.png'), output: join(dir, 'b.musicxml') };
    const sent = [];
    const fetch = async (_url, init) => {
      const name = sent.length % 2 ? 'blur' : 'slow';
      sent.push(name);
      return name === 'slow'
        ? { status: 504, json: async () => ({ state: 'timed_out', failure: { message: 'timed out' } }), headers: new Headers() }
        : { status: 422, json: async () => ({ state: 'failed', failure: { message: 'blur' } }), headers: new Headers() };
    };
    const first = await recognizeViaService([slow, blur], 'http://scan.test', { fetch });
    assert.deepEqual(first, { cachedFailures: 0, uncached: 1 });
    assert.equal(existsSync(slow.output + '.failed.json'), false);
    assert.equal(existsSync(slow.output), false);
    assert.match(readFileSync(blur.output + '.failed.json', 'utf8'), /blur/);
    // The next run asks again for the timed-out page only.
    const second = await recognizeViaService([slow, blur], 'http://scan.test', { fetch });
    assert.deepEqual(second, { cachedFailures: 1, uncached: 1 });
    assert.deepEqual(sent, ['slow', 'blur', 'slow']);
    // A connection that breaks is not cached either.
    const broken = async () => {
      throw new TypeError('fetch failed');
    };
    assert.deepEqual(await recognizeViaService([slow], 'http://scan.test', { fetch: broken }), { cachedFailures: 0, uncached: 1 });
    assert.equal(existsSync(slow.output + '.failed.json'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a busy service is waited out at most 30 times, one second when Retry-After is not a number', async () => {
  const { recognizeViaService } = await import('./acceptance.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'digitus2-omr-service-'));
  try {
    writeFileSync(join(dir, 'page.pdf'), '%PDF');
    const job = { id: 'p:audiveris:pdf', input: join(dir, 'page.pdf'), output: join(dir, 'p.musicxml') };
    const waits = [];
    const busy = async () => ({ status: 429, json: async () => ({ error: 'busy' }), headers: new Headers({ 'Retry-After': 'soon' }) });
    await assert.rejects(recognizeViaService([job], 'http://scan.test', { fetch: busy, sleep: async (ms) => waits.push(ms) }), /busy for 30 attempts/);
    assert.equal(waits.length, 29);
    assert.ok(waits.every((ms) => ms === 1000));
    assert.equal(existsSync(job.output + '.failed.json'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a recogniser label that names no folder is refused', async () => {
  const { serviceLabel } = await import('./acceptance.mjs');
  for (const bad of ['', '   ', '.', '..', undefined, null, 42]) assert.throws(() => serviceLabel(bad), /recogniser label/);
});
