#!/usr/bin/env node
// The scanning acceptance gate: renders the corpus in research/omr/acceptance/corpus.json from the
// library (the library's MusicXML is the ground truth), recognises every page with the PC worker's
// own recognisers (acceptance/recognize.py), scores note by note (the engine's evaluateOmr and
// diagnose.mjs) and fails when a route falls below its floor in acceptance/floor.json.
//
//   node research/omr/acceptance.mjs --check         exit 0 when the recognisers are installed,
//                                                     3 with the reason when not (verify: SKIP)
//   node research/omr/acceptance.mjs                 run, compare with the floors
//   node research/omr/acceptance.mjs --update-floor  run and rewrite floor.json (a measured change)
//   node research/omr/acceptance.mjs --photos        only the photo routes (photos:as-taken, :rotated and
//                                                     :perturbed), which need homr and nothing else; with
//                                                     --update-floor it rewrites only their floors
//   node research/omr/acceptance.mjs --service URL   run, recognising through a running scan service
//                                                     (research/omr/service), and compare with the
//                                                     same floors: the Linux build's equivalence check
//
// Toolchains: the setup scripts' folders (docs/scanning.md), or DIGITUS2_OMR_BUNDLE,
// DIGITUS2_OMR_TEXT_MODELS and DIGITUS2_OMR_HOMR. Recognition outputs are cached under
// research/omr/results/acceptance/ by the hash of the input and of the pipeline's files, so a rerun
// recognises only what changed. The scorecard goes to research/omr/results/acceptance/latest.json;
// with --service, outputs go to cache-service/<the recogniser the service reports>/ and the
// scorecard to latest-service.json.
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beamGroups, compareBeams, errorClasses, photoFacts } from './diagnose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const RESULTS = join(REPO, 'research/omr/results/acceptance');
const CORPUS = join(HERE, 'acceptance/corpus.json');
const FLOOR = join(HERE, 'acceptance/floor.json');
const PHOTOS = join(HERE, 'photos');
export const SKIP = 3;

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** A recognition's cache name: the input's bytes and the recogniser with the pipeline's hash. */
export const recognitionKey = (input, recognizer, pipeline) =>
  sha(Buffer.concat([readFileSync(input), Buffer.from(`${recognizer}:${pipeline}`)])).slice(0, 24);

export function toolchains(env = process.env) {
  const pick = (name, fallback) => resolve(REPO, env[name] || fallback);
  return {
    bundle: pick('DIGITUS2_OMR_BUNDLE', 'research/omr/results/quality-wave/toolchain'),
    textModels: pick('DIGITUS2_OMR_TEXT_MODELS', 'research/omr/results/quality-wave/text-models'),
    homr: pick('DIGITUS2_OMR_HOMR', 'research/omr/results/photo-options/toolchain'),
    python: env.DIGITUS2_OMR_PYTHON || 'python',
  };
}

/** Why the gate cannot run here, or null when it can. */
export function missing(tc = toolchains(), { photosOnly = false } = {}) {
  if (!photosOnly && !existsSync(join(tc.bundle, 'portable/Audiveris')))
    return `Audiveris not prepared (${tc.bundle}; docs/scanning.md)`;
  if (!photosOnly && !existsSync(join(tc.textModels, 'eng.traineddata')))
    return `English text model not prepared (${tc.textModels})`;
  if (!existsSync(join(tc.homr, 'venv')))
    return `homr not prepared (${tc.homr}; or set DIGITUS2_OMR_HOMR)`;
  const version = spawnSync(tc.python, ['-c', 'import sys;print(sys.version_info[:2]>=(3,11))'], {
    encoding: 'utf8',
  });
  if (version.stdout?.trim() !== 'True') return `Python 3.11 or later not found as "${tc.python}"`;
  return null;
}

// Recognitions at once on a cache miss (issue 134). Each job keeps the recognisers' own thread pools
// (ONNX Runtime sizes its pool from the machine, not OMP_NUM_THREADS), so the jobs share the cores:
// on 16 cores three workers take issue 134's 96 corpus and photo recognitions from 904 s to 532 s, and three
// Audiveris JVMs with their 4 GiB heaps fit in 32 GB. DIGITUS2_OMR_WORKERS sets it.
const WORKERS = Math.max(1, Number(process.env.DIGITUS2_OMR_WORKERS) || 3);

/** The files whose content decides a recognition; any change invalidates the cache. */
const PIPELINE = [
  'research/omr/prototypes/local-worker/homr.py',
  'research/omr/prototypes/local-worker/audiveris.py',
  'research/omr/prototypes/local-worker/recognition_errors.py',
  'research/omr/prototypes/local-worker/normalize_export.py',
  'research/omr/acceptance/recognize.py',
  'research/omr/prototypes/homr-photo/source-manifests.json',
  'research/omr/prototypes/homr-photo/requirements-cpu.txt',
  'research/omr/prototypes/homr-photo/upstream.patch',
  'research/omr/prototypes/photo-recovery/upstream-boundaries.patch',
  'research/omr/prototypes/photo-recovery/upstream-accidentals.patch',
  'research/omr/prototypes/photo-recovery/upstream-coverage.patch',
  'research/omr/prototypes/homr-photo/upstream-speed.patch',
];
export function pipelineHash(repo = REPO) {
  const h = createHash('sha256');
  for (const file of PIPELINE) {
    const path = join(repo, file);
    h.update(file).update('\0').update(existsSync(path) ? readFileSync(path) : 'absent').update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

/** Per route and variant: micro F1s over every page (failures count as empty), and error counts. */
export function aggregate(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.recognizer}:${row.variant}`;
    const g =
      groups.get(key) ??
      { pages: 0, imported: 0, metrics: {}, errors: { tiesMissed: 0, tiesExtra: 0, duplicates: 0, wrongStaff: 0 }, beams: { matched: 0, reference: 0, recognized: 0 } };
    g.pages++;
    if (row.status === 'parsed') g.imported++;
    for (const [name, m] of Object.entries(row.metrics)) {
      const t = (g.metrics[name] ??= { matched: 0, reference: 0, recognized: 0 });
      t.matched += m.matched;
      t.reference += m.reference;
      t.recognized += m.recognized;
    }
    for (const [name, value] of Object.entries(row.errors ?? {})) g.errors[name] += value;
    if (row.beams) for (const k of ['matched', 'reference', 'recognized']) g.beams[k] += row.beams[k];
    groups.set(key, g);
  }
  const f1 = (t) => (t.reference + t.recognized ? (2 * t.matched) / (t.reference + t.recognized) : 1);
  return Object.fromEntries(
    [...groups].map(([key, g]) => [
      key,
      {
        pages: g.pages,
        imported: g.imported,
        fullNoteF1: f1(g.metrics.fullNote),
        onsetPitchF1: f1(g.metrics.onsetPitch),
        pitchF1: f1(g.metrics.pitch),
        beamF1: f1(g.beams),
        ...g.errors,
      },
    ]),
  );
}

/**
 * The floor file, the keys another benchmark owns (such as imgpos) kept from the previous one. A
 * null `summary` (a --photos run measured no corpus page) keeps the corpus floors already there;
 * without `perturbedTotals` the perturbed floors are the previous ones.
 */
export function floorFile(previous, corpusVersion, summary, photoTotals, perturbedTotals) {
  return {
    ...previous,
    schemaVersion: 1,
    corpus: corpusVersion,
    note: 'Measured by node research/omr/acceptance.mjs --update-floor: F1 floors are the measurement in percent minus 0.5, rounded down; error ceilings are the measured counts; photo floors are the measured counts of pages right on each fact; the perturbed floors are the measured counts over the perturbed photos, with the pages read as two parts as a ceiling; the imgpos floor is set by node research/omr/imgpos.mjs and kept when these are rewritten.',
    floors: summary ? floorsFrom(summary) : keptFloors(previous, corpusVersion),
    photoFloors: photoFloorsFrom(photoTotals),
    ...(perturbedTotals && { photoPerturbedFloors: perturbedFloorsFrom(perturbedTotals) }),
  };
}

/** Floors as benchmarks/floor.json sets them: an F1 in percent minus 0.5, rounded down to 0.1. */
export function floorsFrom(summary) {
  const pct = (x) => Math.max(0, Math.floor((x * 100 - 0.5) * 10) / 10);
  return Object.fromEntries(
    Object.entries(summary).map(([key, s]) => [
      key,
      {
        importedMin: s.imported,
        fullNoteF1Min: pct(s.fullNoteF1),
        pitchF1Min: pct(s.pitchF1),
        beamF1Min: pct(s.beamF1),
        tiesMissedMax: s.tiesMissed,
        tiesExtraMax: s.tiesExtra,
        duplicatesMax: s.duplicates,
        wrongStaffMax: s.wrongStaff,
      },
    ]),
  );
}

/** The breaches of `summary` against `floors`, as readable lines. */
export function breaches(summary, floors) {
  const out = [];
  for (const [key, f] of Object.entries(floors)) {
    const s = summary[key];
    if (!s) {
      out.push(`${key}: not measured`);
      continue;
    }
    // A floor without one of its keys is a broken floor file, never a silent pass.
    const keys = ['importedMin', 'fullNoteF1Min', 'pitchF1Min', 'beamF1Min', 'tiesMissedMax', 'tiesExtraMax', 'duplicatesMax', 'wrongStaffMax'];
    const absent = keys.filter((k) => typeof f[k] !== 'number');
    if (absent.length) out.push(`${key}: floor.json lacks ${absent.join(', ')}`);
    const pct = (x) => Math.round(x * 10000) / 100;
    if (s.imported < f.importedMin) out.push(`${key}: ${s.imported} pages import, floor ${f.importedMin}`);
    for (const [name, min] of [['fullNoteF1', f.fullNoteF1Min], ['pitchF1', f.pitchF1Min], ['beamF1', f.beamF1Min]])
      if (pct(s[name]) < min) out.push(`${key}: ${name} ${pct(s[name])} below floor ${min}`);
    for (const [name, max] of [['tiesMissed', f.tiesMissedMax], ['tiesExtra', f.tiesExtraMax], ['duplicates', f.duplicatesMax], ['wrongStaff', f.wrongStaffMax]])
      if (s[name] > max) out.push(`${key}: ${name} ${s[name]} above ceiling ${max}`);
  }
  return out;
}

/**
 * The corpus floors a --photos --update-floor keeps. They were measured on the corpus version in
 * floor.json: writing the current version over them would pass stale floors off as current.
 */
export function keptFloors(previous, version) {
  if (previous.corpus !== version)
    throw new Error(`floor.json was measured on corpus ${previous.corpus}, not ${version}: run --update-floor without --photos`);
  return previous.floors;
}

const PHOTO_COUNTS = ['recognised', 'imported', 'barsRight', 'stavesRight', 'keyRight', 'timeRight'];
const emptyTally = () => ({ pages: 0, ...Object.fromEntries([...PHOTO_COUNTS, 'twoParts'].map((k) => [k, 0])) });

/**
 * One photo page into a tally. Staves are right only for a single part with the page's staves: a
 * page read as a treble part and a bass part has one staff in each, or two staves in each when
 * homr draws a grand staff for both, and neither is the grand staff the page has (issue 163).
 */
function tally(g, row) {
  g.pages++;
  const f = row.facts;
  if (!f) return;
  g.recognised++;
  if (f.imports) g.imported++;
  if (f.parts > 1) g.twoParts++;
  if (f.bars === row.expect.bars) g.barsRight++;
  if (f.parts === 1 && f.staves === row.expect.staves) g.stavesRight++;
  if (f.fifths === row.expect.fifths) g.keyRight++;
  if (row.expect.time !== null && f.time === row.expect.time) g.timeRight++;
}

/**
 * Real phone photos have no MusicXML ground truth: each is checked on the facts read off the page
 * (research/omr/photos/manifest.json). Per variant ('as-taken', and 'rotated' for a photo taken
 * upside down and turned with Rotate): how many pages the recogniser returned at all, how many the
 * strict import accepts, how many it read as more than one part, and how many have exactly the
 * page's bars, staves (one part), key and time.
 */
export function photoSummary(rows) {
  const out = {};
  for (const row of rows) tally((out[`photos:${row.variant}`] ??= emptyTally()), row);
  return out;
}
export function photoFloorsFrom(summary) {
  return Object.fromEntries(
    Object.entries(summary).map(([key, s]) => [key, Object.fromEntries(PHOTO_COUNTS.map((k) => [`${k}Min`, s[k]]))]),
  );
}
export function photoBreaches(summary, floors) {
  const out = [];
  for (const [key, f] of Object.entries(floors)) {
    const s = summary[key];
    if (!s) {
      out.push(`${key}: not measured`);
      continue;
    }
    for (const k of PHOTO_COUNTS) {
      if (typeof f[`${k}Min`] !== 'number') out.push(`${key}: floor.json lacks ${k}Min`);
      else if (s[k] < f[`${k}Min`]) out.push(`${key}: ${k} ${s[k]} below floor ${f[`${k}Min`]}`);
    }
  }
  return out;
}

/** The small capture changes of photos:perturbed, in the order perturb.py writes them. */
export const PERTURBATIONS = ['q95', 'q80', 'crop3', 'rot05'];
const PERTURBED = 'photos:perturbed';
/** The checks of the perturbed photos, in the order their floors are written and compared. */
const PERTURBED_FLOORS = [
  ['recognised', 'recognisedMin'],
  ['imported', 'importedMin'],
  ['twoParts', 'twoPartsMax'],
  ['barsRight', 'barsRightMin'],
  ['stavesRight', 'stavesRightMin'],
  ['keyRight', 'keyRightMin'],
  ['timeRight', 'timeRightMin'],
];

/** Every perturbed photo together: one tally, because the question is how often a capture goes wrong. */
export function perturbedSummary(rows) {
  const g = emptyTally();
  for (const row of rows) tally(g, row);
  return g;
}
export function perturbedFloorsFrom(summary) {
  return Object.fromEntries(PERTURBED_FLOORS.map(([k, floor]) => [floor, summary[k]]));
}
export function perturbedBreaches(summary, floors) {
  const out = [];
  for (const [k, floor] of PERTURBED_FLOORS) {
    if (typeof floors[floor] !== 'number') out.push(`${PERTURBED}: floor.json lacks ${floor}`);
    else if (floor.endsWith('Max') ? summary[k] > floors[floor] : summary[k] < floors[floor])
      out.push(`${PERTURBED}: ${k} ${summary[k]} ${floor.endsWith('Max') ? 'above ceiling' : 'below floor'} ${floors[floor]}`);
  }
  return out;
}

/**
 * Per photo, the layout of each reading: parts and bars (`2p/19b`), as taken (the turned copy for a
 * photo taken upside down, as the gate recognises it) and under each perturbation; `none` is a
 * recognition that failed and `-` one that did not run.
 */
export function perturbationTable(photoRows, perturbedRows) {
  const cell = (row) => (!row ? '-' : row.facts ? `${row.facts.parts}p/${row.facts.bars}b` : 'none');
  const ids = [...new Set(photoRows.map((r) => r.photo))];
  const lines = [['photo', 'as taken', ...PERTURBATIONS].join(' | ')];
  for (const id of ids) {
    const taken = photoRows.filter((r) => r.photo === id);
    const upright = taken.find((r) => r.variant === 'rotated') ?? taken[0];
    lines.push([id, cell(upright), ...PERTURBATIONS.map((v) => cell(perturbedRows.find((r) => r.photo === id && r.variant === v)))].join(' | '));
  }
  return lines;
}

/** The origin the scan service admits: the app's own. */
export const ORIGIN = 'https://marchalmaxim.github.io';
const CONTENT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf' };

/** The service's recogniser label as a folder name; a label that names no folder is refused. */
export function serviceLabel(recognizer) {
  if (typeof recognizer !== 'string' || !recognizer.trim())
    throw new Error(`the scan service reports no recogniser label (${JSON.stringify(recognizer)})`);
  const label = recognizer.replace(/[^A-Za-z0-9._-]+/g, '_');
  if (/^\.*$/.test(label)) throw new Error(`the recogniser label ${JSON.stringify(recognizer)} names no cache folder`);
  return label;
}

const BUSY_ATTEMPTS = 30;

/**
 * Recognises through a running scan service, one job after another, as recognize.py does locally: a
 * job whose output or recorded failure exists is skipped; a 200 writes the MusicXML. Only the
 * recogniser's own verdict (422) is cached as a `.failed.json` the scoring counts as an empty page;
 * a timeout, a server error or a broken answer depends on the service's code and host, which the
 * cache key does not cover, so it is reported and asked again on the next run. A busy service is
 * waited out (Retry-After, at most 30 attempts); the hourly limit stops the run, since a page refused
 * for it says nothing about the recogniser.
 */
export async function recognizeViaService(
  jobs,
  service,
  { fetch = globalThis.fetch, origin = ORIGIN, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {},
) {
  const cachedFailures = jobs.filter((job) => !existsSync(job.output) && existsSync(job.output + '.failed.json')).length;
  const pending = jobs.filter((job) => !existsSync(job.output) && !existsSync(job.output + '.failed.json'));
  console.log(JSON.stringify({ jobs: jobs.length, toRun: pending.length, cachedFailures }));
  const url = `${service.replace(/\/+$/, '')}/v1/recognize`;
  let uncached = 0;
  for (const [index, job] of pending.entries()) {
    const type = CONTENT_TYPES[extname(job.input).toLowerCase()];
    if (!type) throw new Error(`${job.id}: no content type for ${job.input}`);
    const bytes = readFileSync(job.input);
    const started = Date.now();
    let status;
    try {
      let response;
      let body;
      for (let attempt = 1; ; attempt++) {
        response = await fetch(url, {
          method: 'POST',
          headers: { Origin: origin, 'X-Digitus2-Client': '1', 'X-Digitus2-Job': randomBytes(16).toString('hex'), 'Content-Type': type },
          body: bytes,
        });
        body = await response.json().catch(() => ({}));
        if (response.status !== 429) break;
        if (body.error !== 'busy') throw new Error(`the scan service refused ${job.id}: ${body.error ?? 429} (Retry-After ${response.headers.get('Retry-After')} s)`);
        if (attempt >= BUSY_ATTEMPTS) throw new Error(`the scan service stayed busy for ${BUSY_ATTEMPTS} attempts at ${job.id}; is another client using it?`);
        const seconds = Number(response.headers.get('Retry-After'));
        const wait = Number.isFinite(seconds) && seconds > 0 ? seconds : 1;
        console.log(JSON.stringify({ busy: job.id, attempt, waitSeconds: wait }));
        await sleep(wait * 1000);
      }
      mkdirSync(dirname(job.output), { recursive: true });
      if (response.status === 200 && typeof body.xml === 'string') {
        writeFileSync(job.output, body.xml);
        status = 'ok';
      } else if (response.status === 422) {
        writeFileSync(job.output + '.failed.json', JSON.stringify({ status: response.status, message: body.failure?.message ?? body.error }));
        status = 'failed: 422';
      } else {
        uncached++;
        status = `not cached: ${response.status} ${body.state ?? body.error ?? ''} ${body.failure?.message ?? ''}`.trim();
      }
    } catch (error) {
      if (/^the scan service (refused|stayed busy)/.test(error.message)) throw error;
      uncached++;
      status = `not cached: ${error.message}`;
    }
    console.log(JSON.stringify({ done: index + 1, of: pending.length, id: job.id, status, seconds: Math.round((Date.now() - started) / 100) / 10 }));
  }
  console.log(`Service run: ${cachedFailures} cached failures skipped, ${uncached} answers not cached (asked again on the next run).`);
  return { cachedFailures, uncached };
}

const manifestOfPhotos = () => JSON.parse(readFileSync(join(PHOTOS, 'manifest.json'), 'utf8'));

/** A photo taken upside down, turned upright as the app's Rotate makes it (a PNG); made once. */
function turnedCopy(tc, photo) {
  const turned = join(RESULTS, 'photos');
  mkdirSync(turned, { recursive: true });
  // Named by the hash of the photo's bytes, so a photo re-shot under the same id is turned anew.
  const target = join(turned, `${photo.id}-rotated-${photo.rotate}-${sha(readFileSync(join(PHOTOS, photo.file))).slice(0, 12)}.png`);
  if (!existsSync(target)) {
    // The homr environment has Pillow; the turn is exact (no resampling at 180 degrees).
    const python = join(tc.homr, 'venv/Scripts/python.exe');
    const r = spawnSync(python, ['-I', '-c', 'import sys;from PIL import Image;Image.open(sys.argv[1]).rotate(int(sys.argv[3]),expand=True).save(sys.argv[2])', join(PHOTOS, photo.file), target, String(-photo.rotate)], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`could not turn ${photo.file}: ${r.stderr}`);
  }
  return target;
}

/** The photos as jobs: each as taken, and a turned copy (a PNG, as the app's Rotate makes) when needed. */
function photoJobs(tc, pipeline, cache = join(RESULTS, 'cache')) {
  const jobs = [];
  for (const photo of manifestOfPhotos().photos) {
    const variants = [['as-taken', join(PHOTOS, photo.file)]];
    if (photo.rotate) variants.push(['rotated', turnedCopy(tc, photo)]);
    for (const [variant, input] of variants) {
      const key = sha(Buffer.concat([readFileSync(input), Buffer.from(`homr:${pipeline}`)])).slice(0, 24);
      jobs.push({ id: `${photo.id}:homr:${variant}`, photo, recognizer: 'homr', variant, input, output: join(cache, `${key}.musicxml`) });
    }
  }
  return jobs;
}

const PERTURB =join(HERE, 'acceptance/perturb.py');
/** Where the perturbed copies are kept: named by perturb.py's hash, so a changed crop or turn writes new files. */
export function perturbedDirectory(script = PERTURB) {
  return join(RESULTS, 'photos-perturbed', sha(readFileSync(script)).slice(0, 12));
}

/** perturb.py's four small capture changes of one upright photo, as files (a file that exists is kept). */
export function perturbedCopies(tc, input, dir, stem) {
  const python = join(tc.homr, 'venv/Scripts/python.exe');
  const r = spawnSync(python, ['-I', PERTURB, input, dir, stem], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`could not perturb ${input}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

/**
 * The photos:perturbed jobs (issue 163): every manifest photo, turned upright as photos:rotated does
 * when it was taken upside down, re-encoded at JPEG quality 95 and 80, cropped by 3% on each side
 * and rotated by 0.5 degrees, each recognised by the same adapter and cached by the hash of its
 * bytes and the pipeline like the other photos. `turn` and `derive` stand in for Pillow in tests.
 */
export function perturbedJobs(tc, pipeline, cache = join(RESULTS, 'cache'), { dir = perturbedDirectory(), turn = turnedCopy, derive = perturbedCopies } = {}) {
  const jobs = [];
  for (const photo of manifestOfPhotos().photos) {
    const upright = photo.rotate ? turn(tc, photo) : join(PHOTOS, photo.file);
    // The stem carries the hash of the upright bytes: a photo re-shot under the same id is perturbed anew.
    const copies = derive(tc, upright, dir, `${photo.id}-${sha(readFileSync(upright)).slice(0, 12)}`);
    for (const variant of PERTURBATIONS) {
      const input = copies[variant];
      if (!input) throw new Error(`${photo.id}: no ${variant} copy`);
      const key = sha(Buffer.concat([readFileSync(input), Buffer.from(`homr:${pipeline}`)])).slice(0, 24);
      jobs.push({ id: `${photo.id}:homr:${variant}`, photo, recognizer: 'homr', variant, perturbed: true, input, output: join(cache, `${key}.musicxml`) });
    }
  }
  return jobs;
}

/** The corpus's rendered pages (prepare.mjs), rendered on first use. */
export async function fixtures(corpus) {
  const dir = join(RESULTS, `fixtures-${corpus.version}`);
  const manifest = join(dir, 'manifest.json');
  if (!existsSync(manifest)) {
    const { prepareFixtures } = await import(pathToFileURL(join(HERE, 'prepare.mjs')).href);
    console.log(`Rendering ${corpus.slugs.length} corpus pieces into ${dir}`);
    await prepareFixtures({ out: dir, slugs: corpus.slugs });
  }
  const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  const ids = parsed.pieces.map((p) => p.id).join(',');
  if (ids !== corpus.slugs.join(','))
    throw new Error(`${dir} holds another corpus; remove it or raise corpus.json "version"`);
  return { dir, manifest: parsed };
}

function score(E, reference, file) {
  const ref = E.parseMusicXml(reference, { preserveNotation: true });
  const empty = { ...ref.score, notes: [], measures: [] };
  let status = 'missing';
  let rec = empty;
  let recXml = null;
  let error = null;
  if (file && existsSync(file)) {
    recXml = readFileSync(file, 'utf8');
    try {
      rec = E.parseMusicXml(recXml, { preserveNotation: true }).score;
      E.evaluateOmr(ref.score, rec);
      status = 'parsed';
    } catch (cause) {
      status = 'invalid';
      error = cause.message;
      rec = empty;
    }
  } else if (file && existsSync(file + '.failed.json')) {
    status = 'failed';
    error = JSON.parse(readFileSync(file + '.failed.json', 'utf8')).message;
  }
  const evaluation = E.evaluateOmr(ref.score, rec);
  const metrics = Object.fromEntries(
    Object.entries(evaluation.metrics).map(([k, m]) => [k, { matched: m.matched, reference: m.reference, recognized: m.recognized }]),
  );
  const refBeams = beamGroups(reference.toString('utf8'));
  return {
    status,
    error,
    metrics,
    bars: { missing: evaluation.missingBars, extra: evaluation.extraBars, timing: evaluation.barTimingMismatches },
    errors: status === 'parsed' ? errorClasses(ref.score, rec) : null,
    beams: compareBeams(refBeams, status === 'parsed' ? beamGroups(recXml) : []),
  };
}

export async function main(args = process.argv.slice(2)) {
  const tc = toolchains();
  const photosOnly = args.includes('--photos');
  const reason = missing(tc, { photosOnly });
  if (args.includes('--check')) {
    if (reason) console.log(reason);
    return reason ? SKIP : 0;
  }
  if (reason) {
    console.log(`SKIP: ${reason}`);
    return SKIP;
  }
  const at = args.indexOf('--service');
  const service = at >= 0 ? args[at + 1] : null;
  if (at >= 0 && !/^https?:\/\//.test(service ?? '')) throw new Error('--service needs the service URL, e.g. http://127.0.0.1:8996');
  // The floors are the Windows build's measurement; a service run is checked against them, never sets them.
  if (service && args.includes('--update-floor')) throw new Error('--update-floor measures the local recognisers, not --service');
  let cache = join(RESULTS, 'cache');
  let recognizedBy = null;
  if (service) {
    const health = await fetch(`${service.replace(/\/+$/, '')}/v1/health`, { headers: { Origin: ORIGIN } });
    const about = await health.json().catch(() => ({}));
    if (about.protocol !== 'digitus2-scan-v2') throw new Error(`${service} is not a digitus2-scan-v2 service (${health.status})`);
    recognizedBy = { service, recognizer: about.recognizer };
    cache = join(RESULTS, 'cache-service', serviceLabel(about.recognizer));
    console.log(`Recognising through ${service}: ${about.recognizer}`);
  }
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
  const pipeline = pipelineHash();
  const jobs = [];
  let dir = null;
  let manifest = { pieces: [] };
  if (!photosOnly) {
    ({ dir, manifest } = await fixtures(corpus));
    for (const piece of manifest.pieces) {
      if (piece.pages.length !== 1) throw new Error(`${piece.id}: the gate scores one-page pieces only`);
      for (const [recognizer, variants] of Object.entries(corpus.routes))
        for (const variant of variants) {
          const input = join(dir, variant === 'pdf' ? piece.pdf : piece.pages[0].images[variant]);
          const key = recognitionKey(input, recognizer, pipeline);
          jobs.push({ id: `${piece.id}:${recognizer}:${variant}`, piece, recognizer, variant, input, output: join(cache, `${key}.musicxml`) });
        }
    }
  }
  mkdirSync(cache, { recursive: true });
  const photos = [...photoJobs(tc, pipeline, cache), ...perturbedJobs(tc, pipeline, cache)];
  if (service) await recognizeViaService([...jobs, ...photos], service);
  else {
    const jobFile = join(RESULTS, photosOnly ? 'jobs-photos.json' : 'jobs.json');
    mkdirSync(RESULTS, { recursive: true });
    writeFileSync(jobFile, JSON.stringify([...jobs, ...photos].map(({ id, recognizer, input, output }) => ({ id, recognizer, input, output })), null, 1));
    const run = spawnSync(
      tc.python,
      ['-I', join(HERE, 'acceptance/recognize.py'), jobFile, '--bundle', tc.bundle, '--text-models', tc.textModels, '--homr-toolchain', tc.homr, '--workers', String(WORKERS)],
      { stdio: 'inherit' },
    );
    if (run.status !== 0) throw new Error(`recognize.py exited with ${run.status}`);
  }

  const E = await import(pathToFileURL(join(REPO, 'packages/engine/dist/src/index.js')).href);
  const rows = jobs.map((job) => {
    const reference = readFileSync(join(dir, job.piece.reference));
    return { id: job.id, piece: job.piece.id, recognizer: job.recognizer, variant: job.variant, ...score(E, reference, job.output) };
  });
  const summary = aggregate(rows);
  const photoRow = (job) => ({
    id: job.id,
    photo: job.photo.id,
    variant: job.variant,
    expect: { bars: job.photo.bars, staves: job.photo.staves, fifths: job.photo.fifths, time: job.photo.time },
    facts: existsSync(job.output) ? photoFacts(E, readFileSync(job.output, 'utf8')) : null,
  });
  const photoRows = photos.filter((job) => !job.perturbed).map(photoRow);
  const perturbedRows = photos.filter((job) => job.perturbed).map(photoRow);
  const photoTotals = photoSummary(photoRows);
  const perturbedTotals = perturbedSummary(perturbedRows);
  const card = { schemaVersion: 1, corpus: corpus.version, pipeline, recognitionExecuted: true, ...(recognizedBy && { recognizedBy }), summary, rows, photos: { summary: photoTotals, rows: photoRows, perturbed: { summary: perturbedTotals, rows: perturbedRows } } };
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, service ? 'latest-service.json' : photosOnly ? 'latest-photos.json' : 'latest.json'), JSON.stringify(card, null, 2));

  const pct = (x) => (x * 100).toFixed(2);
  if (!photosOnly) {
    console.log('\nroute:variant          pages imported fullNote pitch  beams ties-missed dup wrong-staff');
    for (const [key, s] of Object.entries(summary))
      console.log(
        `${key.padEnd(22)} ${String(s.pages).padStart(5)} ${String(s.imported).padStart(8)} ${pct(s.fullNoteF1).padStart(8)} ${pct(s.pitchF1).padStart(6)} ${pct(s.beamF1).padStart(6)} ${String(s.tiesMissed).padStart(11)} ${String(s.duplicates).padStart(3)} ${String(s.wrongStaff).padStart(11)}`,
      );
  }
  console.log('\nphotos:variant      pages recognised imported two-parts bars staves key time');
  for (const [key, p] of [...Object.entries(photoTotals), [PERTURBED, perturbedTotals]])
    console.log(`${key.padEnd(19)} ${String(p.pages).padStart(5)} ${String(p.recognised).padStart(10)} ${String(p.imported).padStart(8)} ${String(p.twoParts).padStart(9)} ${String(p.barsRight).padStart(4)} ${String(p.stavesRight).padStart(6)} ${String(p.keyRight).padStart(3)} ${String(p.timeRight).padStart(4)}`);
  console.log('\n' + perturbationTable(photoRows, perturbedRows).join('\n'));
  if (args.includes('--update-floor')) {
    // --photos measured no corpus page (no summary): it replaces only the photo floors of the floors already there.
    const previous = existsSync(FLOOR) ? JSON.parse(readFileSync(FLOOR, 'utf8')) : undefined;
    writeFileSync(FLOOR, JSON.stringify(floorFile(previous, corpus.version, photosOnly ? null : summary, photoTotals, perturbedTotals), null, 2) + '\n');
    console.log(`\nFloors written to ${FLOOR}`);
    return 0;
  }
  if (!existsSync(FLOOR)) {
    console.log('\nNo floor.json yet: run with --update-floor once the measurement is reviewed.');
    return 1;
  }
  const floor = JSON.parse(readFileSync(FLOOR, 'utf8'));
  if (floor.corpus !== corpus.version) throw new Error('floor.json was measured on another corpus version');
  const found = [...breaches(summary, photosOnly ? {} : floor.floors), ...photoBreaches(photoTotals, floor.photoFloors ?? {})];
  if (!floor.photoFloors) found.push('photos: floor.json has no photoFloors');
  if (!floor.photoPerturbedFloors) found.push(`${PERTURBED}: floor.json has no photoPerturbedFloors`);
  else found.push(...perturbedBreaches(perturbedTotals, floor.photoPerturbedFloors));
  if (found.length) {
    console.log('\nRegressions:\n' + found.map((line) => `  ${line}`).join('\n'));
    return 1;
  }
  console.log('\nEvery route meets its floor.');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(
    (code) => (process.exitCode = code),
    (error) => {
      console.error(`OMR acceptance: ${error.message}`);
      process.exitCode = 2;
    },
  );
