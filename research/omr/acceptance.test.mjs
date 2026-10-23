import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregate, breaches, floorFile, floorsFrom, missing, perturbedCopies, PERTURBATIONS, pipelineHash, SKIP, toolchains } from './acceptance.mjs';

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

test('a photos-only floor update keeps the corpus floors only when they were measured on this corpus', async () => {
  const { keptFloors } = await import('./acceptance.mjs');
  const floors = { 'homr:clean': { fullNoteF1Min: 89 } };
  assert.equal(keptFloors({ corpus: 'v1', floors }, 'v1'), floors);
  assert.throws(() => keptFloors({ corpus: 'v1', floors }, 'v2'), /measured on corpus v1, not v2/);
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
  const facts = (bars, staves, imports = true, parts = 1) => ({ imports, parts, bars, staves, fifths: 1, time: '3/4' });
  const rows = [
    { variant: 'as-taken', expect, facts: facts(24, 2) },
    { variant: 'as-taken', expect, facts: facts(28, 2) },
    { variant: 'rotated', expect, facts: facts(24, 1, false) },
    { variant: 'as-taken', expect: { ...expect, time: null }, facts: null },
  ];
  const summary = photoSummary(rows);
  assert.deepEqual(summary['photos:as-taken'], { pages: 3, recognised: 2, imported: 2, twoParts: 0, barsRight: 1, stavesRight: 2, keyRight: 2, timeRight: 2 });
  assert.deepEqual(summary['photos:rotated'], { pages: 1, recognised: 1, imported: 0, twoParts: 0, barsRight: 1, stavesRight: 0, keyRight: 1, timeRight: 1 });
  const floors = photoFloorsFrom(summary);
  assert.deepEqual(photoBreaches(summary, floors), []);
  const worse = photoSummary(rows.map((r, i) => (i === 0 ? { ...r, facts: facts(23, 2) } : r)));
  assert.deepEqual(photoBreaches(worse, floors), ['photos:as-taken: barsRight 0 below floor 1']);
});

test('a page read as two one-staff parts does not have the right staves, however many staves each reads', async () => {
  const { photoSummary } = await import('./acceptance.mjs');
  const expect = { bars: 19, staves: 2, fifths: 1, time: '3/4' };
  const facts = (parts, staves) => ({ imports: true, parts, bars: 19, staves, fifths: 1, time: '3/4' });
  const summary = photoSummary([
    { variant: 'as-taken', expect, facts: facts(1, 2) },
    // Two parts of two staves each, as homr read a page: the largest <staves> is 2, the layout is wrong.
    { variant: 'as-taken', expect, facts: facts(2, 2) },
    { variant: 'as-taken', expect, facts: facts(2, 1) },
    { variant: 'as-taken', expect, facts: facts(1, 1) },
  ]);
  assert.equal(summary['photos:as-taken'].stavesRight, 1);
  assert.equal(summary['photos:as-taken'].twoParts, 2);
  assert.equal(summary['photos:as-taken'].barsRight, 4);
});

test('the perturbed photos are counted together: parts read as two, and the floors as measured', async () => {
  const { perturbedSummary, perturbedFloorsFrom, perturbedBreaches } = await import('./acceptance.mjs');
  const expect = { bars: 24, staves: 2, fifths: 1, time: '3/4' };
  const facts = (bars, parts = 1, staves = 2, imports = true) => ({ imports, parts, bars, staves, fifths: 1, time: '3/4' });
  const rows = [
    { variant: 'q95', expect, facts: facts(24) },
    { variant: 'q80', expect, facts: facts(24) },
    { variant: 'crop3', expect, facts: facts(12, 2) },
    { variant: 'rot05', expect, facts: null },
  ];
  const summary = perturbedSummary(rows);
  assert.deepEqual(summary, { pages: 4, recognised: 3, imported: 3, twoParts: 1, barsRight: 2, stavesRight: 2, keyRight: 3, timeRight: 3 });
  const floors = perturbedFloorsFrom(summary);
  assert.deepEqual(floors, { recognisedMin: 3, importedMin: 3, twoPartsMax: 1, barsRightMin: 2, stavesRightMin: 2, keyRightMin: 3, timeRightMin: 3 });
  assert.deepEqual(perturbedBreaches(summary, floors), []);
  // One more two-part read costs a staves hit and adds a two-part read: each is a breach.
  const worse = perturbedSummary([rows[0], { ...rows[1], facts: facts(24, 2) }, rows[2], rows[3]]);
  assert.deepEqual(perturbedBreaches(worse, floors), [
    'photos:perturbed: twoParts 2 above ceiling 1',
    'photos:perturbed: stavesRight 1 below floor 2',
  ]);
  // A floor file that lost a key is a broken file, never a pass.
  assert.deepEqual(perturbedBreaches(summary, { recognisedMin: 3 }), [
    'photos:perturbed: floor.json lacks importedMin',
    'photos:perturbed: floor.json lacks twoPartsMax',
    'photos:perturbed: floor.json lacks barsRightMin',
    'photos:perturbed: floor.json lacks stavesRightMin',
    'photos:perturbed: floor.json lacks keyRightMin',
    'photos:perturbed: floor.json lacks timeRightMin',
  ]);
});

test('every manifest photo becomes four perturbed recognitions, the rotated ones from the upright copy', async () => {
  const { perturbedJobs, PERTURBATIONS } = await import('./acceptance.mjs');
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, 'photos/manifest.json'), 'utf8'));
  assert.deepEqual(PERTURBATIONS, ['q95', 'q80', 'crop3', 'rot05']);
  const dir = mkdtempSync(join(tmpdir(), 'digitus2-omr-perturbed-'));
  try {
    const turned = [];
    const turn = (_tc, photo) => {
      const file = join(dir, `${photo.id}-up.png`);
      writeFileSync(file, `upright ${photo.id}`);
      turned.push(photo.id);
      return file;
    };
    const derived = [];
    // Stands for perturb.py: one file per variant whose bytes differ per input and variant.
    const derive = (_tc, input, out, stem) => {
      derived.push(input);
      mkdirSync(out, { recursive: true });
      return Object.fromEntries(
        PERTURBATIONS.map((variant) => {
          const file = join(out, `${stem}-${variant}.jpg`);
          writeFileSync(file, `${variant}:${readFileSync(input, 'utf8')}`);
          return [variant, file];
        }),
      );
    };
    const options = { dir: join(dir, 'perturbed'), turn, derive };
    const jobs = perturbedJobs({}, 'pipe', join(dir, 'cache'), options);
    assert.equal(jobs.length, manifest.photos.length * 4);
    assert.equal(new Set(jobs.map((j) => j.id)).size, jobs.length);
    assert.equal(new Set(jobs.map((j) => j.output)).size, jobs.length);
    assert.deepEqual(jobs.slice(0, 4).map((j) => j.variant), PERTURBATIONS);
    assert.equal(jobs[0].id, `${manifest.photos[0].id}:homr:q95`);
    assert.ok(jobs.every((j) => j.perturbed && j.recognizer === 'homr' && j.output.endsWith('.musicxml')));
    // Only the photos taken upside down are turned, and the turned copy is what is perturbed.
    assert.deepEqual(turned, manifest.photos.filter((p) => p.rotate).map((p) => p.id));
    const upside = manifest.photos.find((p) => p.rotate);
    assert.ok(derived.includes(join(dir, `${upside.id}-up.png`)));
    assert.equal(derived.filter((f) => !f.endsWith('-up.png')).length, manifest.photos.length - turned.length);
    // The cache key is the hash of the variant's bytes and the pipeline.
    const again = perturbedJobs({}, 'pipe', join(dir, 'cache'), options);
    assert.deepEqual(again.map((j) => j.output), jobs.map((j) => j.output));
    // A photo re-shot under the same id (other bytes) is perturbed under another stem, so the old copies are not reused.
    const stems = (options2) => {
      const seen = [];
      perturbedJobs({}, 'pipe', join(dir, 'cache'), { ...options2, derive: (tc, input, out, stem) => (seen.push(stem), derive(tc, input, out, stem)) });
      return seen;
    };
    const first = stems(options);
    assert.ok(first.every((stem) => /-[0-9a-f]{12}$/.test(stem)));
    assert.equal(new Set(first).size, first.length);
    const turnedAgain = (_tc, photo) => {
      const file = join(dir, `${photo.id}-up.png`);
      writeFileSync(file, `reshot ${photo.id}`);
      return file;
    };
    const second = stems({ ...options, turn: turnedAgain });
    const hashOf = (list) => Object.fromEntries(list.map((stem) => [stem.slice(0, -13), stem.slice(-12)]));
    const [h1, h2] = [hashOf(first), hashOf(second)];
    const rotatedIds = manifest.photos.filter((p) => p.rotate).map((p) => p.id);
    assert.ok(rotatedIds.length > 0);
    for (const photo of manifest.photos) assert.equal(h1[photo.id] === h2[photo.id], !photo.rotate, photo.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the perturbed copies live in a folder named by the script that makes them', async () => {
  const { perturbedDirectory } = await import('./acceptance.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'digitus2-omr-perturb-script-'));
  try {
    const script = join(dir, 'perturb.py');
    writeFileSync(script, 'crop = 0.03');
    const before = perturbedDirectory(script);
    assert.equal(perturbedDirectory(script), before);
    writeFileSync(script, 'crop = 0.04');
    assert.notEqual(perturbedDirectory(script), before);
    assert.match(before, /photos-perturbed.[0-9a-f]{12}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const homrPython = join(toolchains().homr, 'venv/Scripts/python.exe');
test('perturb.py writes the four capture changes once, and keeps a file that exists', { skip: !existsSync(homrPython) && 'homr venv not prepared' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'digitus2-omr-perturb-run-'));
  try {
    const src = join(import.meta.dirname, 'photos/bach-invention13-page3-photoscan.jpeg');
    const out = perturbedCopies(toolchains(), src, dir, 'p');
    assert.deepEqual(Object.keys(out), PERTURBATIONS);
    const sizes = spawnSync(homrPython, ['-I', '-c', 'import sys,json;from PIL import Image;print(json.dumps([Image.open(f).size for f in sys.argv[1:]]))', src, ...PERTURBATIONS.map((v) => out[v])], { encoding: 'utf8' });
    assert.equal(sizes.status, 0, sizes.stderr);
    const [input, q95, q80, crop3, rot05] = JSON.parse(sizes.stdout);
    const [w, h] = input;
    assert.deepEqual(q95, input);
    assert.deepEqual(q80, input);
    assert.deepEqual(crop3, [Math.round(w * 0.97) - Math.round(w * 0.03), Math.round(h * 0.97) - Math.round(h * 0.03)]);
    assert.deepEqual(rot05, input);
    assert.ok(statSync(out.q80).size < statSync(out.q95).size);
    const hashes = (paths) => PERTURBATIONS.map((v) => createHash('sha256').update(readFileSync(paths[v])).digest('hex'));
    const before = hashes(out);
    // A file that exists is kept, not rewritten: the sentinel survives the second call.
    writeFileSync(out.crop3, 'sentinel');
    const again = perturbedCopies(toolchains(), src, dir, 'p');
    assert.deepEqual(again, out);
    assert.equal(readFileSync(out.crop3, 'utf8'), 'sentinel');
    assert.deepEqual(hashes(again).filter((_, i) => PERTURBATIONS[i] !== 'crop3'), before.filter((_, i) => PERTURBATIONS[i] !== 'crop3'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the perturbation table puts each photo as taken beside its four variants', async () => {
  const { perturbationTable } = await import('./acceptance.mjs');
  const row = (photo, variant, parts, bars) => ({ photo, variant, facts: parts === null ? null : { parts, bars } });
  const lines = perturbationTable(
    [
      { photo: 'a', variant: 'as-taken', facts: { parts: 1, bars: 19 } },
      { photo: 'b', variant: 'as-taken', facts: { parts: 1, bars: 24 } },
      { photo: 'b', variant: 'rotated', facts: { parts: 2, bars: 12 } },
    ],
    [row('a', 'q95', 1, 19), row('a', 'q80', 2, 25), row('a', 'crop3', null), row('a', 'rot05', 1, 20), row('b', 'q95', 1, 24)],
  );
  assert.deepEqual(lines, [
    'photo | as taken | q95 | q80 | crop3 | rot05',
    'a | 1p/19b | 1p/19b | 2p/25b | none | 1p/20b',
    'b | 2p/12b | 1p/24b | - | - | -',
  ]);
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

test('rewriting the floors keeps the keys another benchmark owns', () => {
  const previous = { schemaVersion: 1, corpus: 'v1', imgpos: { halfHeightSpaces: 2, insideCropMin: 0.9 }, floors: { old: {} } };
  const summary = { 'homr:clean': { pages: 1, imported: 1, fullNoteF1: 0.9, pitchF1: 0.9, beamF1: 0, tiesMissed: 0, tiesExtra: 0, duplicates: 0, wrongStaff: 0 } };
  const next = floorFile(previous, 'v1', summary, {});
  assert.deepEqual(next.imgpos, previous.imgpos);
  assert.deepEqual(Object.keys(next.floors), ['homr:clean']);
  assert.equal(next.corpus, 'v1');
  assert.deepEqual(floorFile(undefined, 'v1', summary, {}).corpus, 'v1');
});
