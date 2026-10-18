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
//
// Toolchains: the setup scripts' folders (docs/scanning.md), or DIGITUS2_OMR_BUNDLE,
// DIGITUS2_OMR_TEXT_MODELS and DIGITUS2_OMR_HOMR. Recognition outputs are cached under
// research/omr/results/acceptance/ by the hash of the input and of the pipeline's files, so a rerun
// recognises only what changed. The scorecard goes to research/omr/results/acceptance/latest.json.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beamGroups, compareBeams, errorClasses } from './diagnose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const RESULTS = join(REPO, 'research/omr/results/acceptance');
const CORPUS = join(HERE, 'acceptance/corpus.json');
const FLOOR = join(HERE, 'acceptance/floor.json');
export const SKIP = 3;

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

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
export function missing(tc = toolchains()) {
  if (!existsSync(join(tc.bundle, 'portable/Audiveris')))
    return `Audiveris not prepared (${tc.bundle}; docs/scanning.md)`;
  if (!existsSync(join(tc.textModels, 'eng.traineddata')))
    return `English text model not prepared (${tc.textModels})`;
  if (!existsSync(join(tc.homr, 'venv')))
    return `homr not prepared (${tc.homr}; or set DIGITUS2_OMR_HOMR)`;
  const version = spawnSync(tc.python, ['-c', 'import sys;print(sys.version_info[:2]>=(3,11))'], {
    encoding: 'utf8',
  });
  if (version.stdout?.trim() !== 'True') return `Python 3.11 or later not found as "${tc.python}"`;
  return null;
}

/** The files whose content decides a recognition; any change invalidates the cache. */
const PIPELINE = [
  'research/omr/prototypes/local-worker/homr.py',
  'research/omr/prototypes/local-worker/audiveris.py',
  'research/omr/prototypes/local-worker/recognition_errors.py',
  'research/omr/prototypes/homr-photo/source-manifests.json',
  'research/omr/prototypes/homr-photo/requirements-cpu.txt',
  'research/omr/prototypes/homr-photo/upstream.patch',
  'research/omr/prototypes/photo-recovery/upstream-boundaries.patch',
  'research/omr/prototypes/photo-recovery/upstream-accidentals.patch',
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

/** Floors as benchmarks/floor.json sets them: an F1 in percent minus 0.5, rounded down to 0.1. */
export function floorsFrom(summary) {
  const pct = (x) => Math.floor((x * 100 - 0.5) * 10) / 10;
  return Object.fromEntries(
    Object.entries(summary).map(([key, s]) => [
      key,
      {
        importedMin: s.imported,
        fullNoteF1Min: pct(s.fullNoteF1),
        pitchF1Min: pct(s.pitchF1),
        beamF1Min: pct(s.beamF1),
        tiesMissedMax: s.tiesMissed,
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
    const pct = (x) => Math.round(x * 10000) / 100;
    if (s.imported < f.importedMin) out.push(`${key}: ${s.imported} pages import, floor ${f.importedMin}`);
    for (const [name, min] of [['fullNoteF1', f.fullNoteF1Min], ['pitchF1', f.pitchF1Min], ['beamF1', f.beamF1Min]])
      if (pct(s[name]) < min) out.push(`${key}: ${name} ${pct(s[name])} below floor ${min}`);
    for (const [name, max] of [['tiesMissed', f.tiesMissedMax], ['duplicates', f.duplicatesMax], ['wrongStaff', f.wrongStaffMax]])
      if (s[name] > max) out.push(`${key}: ${name} ${s[name]} above ceiling ${max}`);
  }
  return out;
}

async function fixtures(corpus) {
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
  const reason = missing(tc);
  if (args.includes('--check')) {
    if (reason) console.log(reason);
    return reason ? SKIP : 0;
  }
  if (reason) {
    console.log(`SKIP: ${reason}`);
    return SKIP;
  }
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
  const { dir, manifest } = await fixtures(corpus);
  const pipeline = pipelineHash();
  const jobs = [];
  for (const piece of manifest.pieces) {
    if (piece.pages.length !== 1) throw new Error(`${piece.id}: the gate scores one-page pieces only`);
    for (const [recognizer, variants] of Object.entries(corpus.routes))
      for (const variant of variants) {
        const input = join(dir, variant === 'pdf' ? piece.pdf : piece.pages[0].images[variant]);
        const key = sha(Buffer.concat([readFileSync(input), Buffer.from(`${recognizer}:${pipeline}`)])).slice(0, 24);
        jobs.push({ id: `${piece.id}:${recognizer}:${variant}`, piece, recognizer, variant, input, output: join(RESULTS, 'cache', `${key}.musicxml`) });
      }
  }
  mkdirSync(join(RESULTS, 'cache'), { recursive: true });
  const jobFile = join(RESULTS, 'jobs.json');
  writeFileSync(jobFile, JSON.stringify(jobs.map(({ id, recognizer, input, output }) => ({ id, recognizer, input, output })), null, 1));
  const run = spawnSync(
    tc.python,
    ['-I', join(HERE, 'acceptance/recognize.py'), jobFile, '--bundle', tc.bundle, '--text-models', tc.textModels, '--homr-toolchain', tc.homr],
    { stdio: 'inherit' },
  );
  if (run.status !== 0) throw new Error(`recognize.py exited with ${run.status}`);

  const E = await import(pathToFileURL(join(REPO, 'packages/engine/dist/src/index.js')).href);
  const rows = jobs.map((job) => {
    const reference = readFileSync(join(dir, job.piece.reference));
    return { id: job.id, piece: job.piece.id, recognizer: job.recognizer, variant: job.variant, ...score(E, reference, job.output) };
  });
  const summary = aggregate(rows);
  const card = { schemaVersion: 1, corpus: corpus.version, pipeline, recognitionExecuted: true, summary, rows };
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, 'latest.json'), JSON.stringify(card, null, 2));

  const pct = (x) => (x * 100).toFixed(2);
  console.log('\nroute:variant          pages imported fullNote pitch  beams ties-missed dup wrong-staff');
  for (const [key, s] of Object.entries(summary))
    console.log(
      `${key.padEnd(22)} ${String(s.pages).padStart(5)} ${String(s.imported).padStart(8)} ${pct(s.fullNoteF1).padStart(8)} ${pct(s.pitchF1).padStart(6)} ${pct(s.beamF1).padStart(6)} ${String(s.tiesMissed).padStart(11)} ${String(s.duplicates).padStart(3)} ${String(s.wrongStaff).padStart(11)}`,
    );
  if (args.includes('--update-floor')) {
    writeFileSync(FLOOR, JSON.stringify({ schemaVersion: 1, corpus: corpus.version, note: 'Measured by node research/omr/acceptance.mjs --update-floor: F1 floors are the measurement in percent minus 0.5, rounded down; error ceilings are the measured counts.', floors: floorsFrom(summary) }, null, 2) + '\n');
    console.log(`\nFloors written to ${FLOOR}`);
    return 0;
  }
  if (!existsSync(FLOOR)) {
    console.log('\nNo floor.json yet: run with --update-floor once the measurement is reviewed.');
    return 1;
  }
  const floor = JSON.parse(readFileSync(FLOOR, 'utf8'));
  if (floor.corpus !== corpus.version) throw new Error('floor.json was measured on another corpus version');
  const found = breaches(summary, floor.floors);
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
