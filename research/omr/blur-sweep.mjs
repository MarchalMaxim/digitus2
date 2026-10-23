#!/usr/bin/env node
// Blur sweep (issue 162): where does local homr stop reading a page as it blurs, and what does the
// staff-line sharpness measure (apps/web/src/scan/camera/sharpness.ts) say about the same pages? The
// curve of recognition against the measure is what a capture gate would be calibrated on, and the
// scorecard's `calibration` says whether one floor could serve (see docs/research/omr.md, Blur sweep).
//
//   node research/omr/blur-sweep.mjs                  everything, cached, scorecard at the end
//   node research/omr/blur-sweep.mjs --parallel 3     recognize.py processes side by side
//   node research/omr/blur-sweep.mjs --no-recognize   variants and the measure only
//   node research/omr/blur-sweep.mjs --no-measure     variants and recognition only
//
// Prerequisites as for camera-fusion.mjs: `pnpm --filter @digitus2/engine build`, the web app's
// Playwright Chromium (decoding and PNG coding) and a prepared homr toolchain (DIGITUS2_OMR_HOMR,
// default C:/Users/maxim/omr/homr2).
//
// Pages: the 8 one-page truth pieces of camera-fusion.mjs (page 1 rendered clean by prepare.mjs, the
// library MusicXML is the truth) and the 14 real phone photos in research/omr/photos as taken
// (manifest facts). Variants, at the page's own pixel scale, applied to every colour channel:
//  - Gaussian blur, sigma 0, 0.5, 1, 1.5, 2, 2.5 and 3 px;
//  - motion blur, a uniform line of 3, 6 and 9 px, vertical (across the staff lines, which the
//    measure sees in full) and horizontal (along them, which it cannot see at all): together they
//    bracket every direction a shaking hand gives;
//  - on the truth pages only, Gaussian blur of 0.25, 0.3 and 0.4 of the page's own interline (their
//    interline is 14 px, so 3 px is only 0.2 of it and a third of it is beyond the plain sweep).
// Sigma 0 is the page itself (the clean PNG, the photo's own JPEG); every other variant is a PNG.
// Each is recognised by local homr (acceptance/recognize.py) and cached by the hash of its bytes and
// of the acceptance pipeline; truth pages are scored with evaluateOmr (pitch F1, exact bars) and the
// staves homr reports, photos with the manifest's bars, staves, key and time. The measure is the
// TypeScript in the app, transpiled as is, run on each variant's pixels.
//
// Outputs (git-ignored) under research/omr/results/blur-sweep/: variants/, cache/, build/, and the
// scorecard latest.json.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipelineHash } from './acceptance.mjs';
import { Codec, DEFAULT_PIECES, fixtures, gaussianBlur } from './camera-fusion.mjs';
import { photoFacts } from './diagnose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const OUT = join(REPO, 'research/omr/results/blur-sweep');
const CAMERA = join(REPO, 'apps/web/src/scan/camera');
export const VERSION = 'blur-sweep-v1';

export const VARIANTS = [
  ...[0, 0.5, 1, 1.5, 2, 2.5, 3].map((sigma) => ({ id: `g${sigma}`, kind: 'gauss', sigma })),
  ...[3, 6, 9].map((length) => ({ id: `mv${length}`, kind: 'motion', length, vertical: true })),
  ...[3, 6, 9].map((length) => ({ id: `mh${length}`, kind: 'motion', length, vertical: false })),
];
export const FRACTIONS = [0.25, 0.3, 0.4];
/** A variant's direction relative to the staff lines: the measure sees blur across them only. */
export const groupOf = (variantId) => (variantId.startsWith('mh') ? 'horizontal' : variantId.startsWith('mv') ? 'vertical' : 'gauss');
/** The variants of a page: the common ones, and for a truth page blurs that are fractions of its interline. */
const variantsOf = (page, interline) =>
  page.kind === 'truth' && interline
    ? [...VARIANTS, ...FRACTIONS.map((fraction) => ({ id: `gd${Math.round(fraction * 100)}`, kind: 'gauss', fraction, sigma: Math.round(fraction * interline * 10) / 10 }))]
    : VARIANTS;

const sha = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p).update('\0');
  return h.digest('hex');
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** A uniform line blur of `length` px along x or y: the mean of length + 1 bilinear taps. */
export function motionBlur(src, width, height, length, vertical) {
  if (length <= 0) return Float32Array.from(src);
  const n = Math.max(2, Math.round(length) + 1);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = 0; k < n; k++) {
        const s = (k / (n - 1) - 0.5) * length;
        const p = vertical ? y + s : x + s;
        const limit = (vertical ? height : width) - 1.001;
        const c = Math.max(0, Math.min(limit, p));
        const i = Math.floor(c), t = c - i;
        const a = vertical ? src[i * width + x] : src[y * width + i];
        const b = vertical ? src[Math.min(height - 1, i + 1) * width + x] : src[y * width + Math.min(width - 1, i + 1)];
        acc += a * (1 - t) + b * t;
      }
      out[y * width + x] = acc / n;
    }
  return out;
}

/** The variant of an RGBA picture, each colour channel blurred alike. */
export function degrade(rgba, width, height, variant) {
  const out = new Uint8ClampedArray(rgba.length);
  for (let c = 0; c < 3; c++) {
    const channel = new Float32Array(width * height);
    for (let i = 0; i < channel.length; i++) channel[i] = rgba[i * 4 + c];
    const blurred =
      variant.kind === 'gauss'
        ? gaussianBlur(channel, width, height, variant.sigma)
        : motionBlur(channel, width, height, variant.length, variant.vertical);
    for (let i = 0; i < channel.length; i++) out[i * 4 + c] = blurred[i];
  }
  for (let i = 0; i < width * height; i++) out[i * 4 + 3] = 255;
  return out;
}

async function png(codec, rgba, width, height) {
  const b64 = await codec.page.evaluate(
    async ({ rgb, width, height }) => {
      const blob = await blobOf(canvasOf(fromB64(rgb), width, height), 'image/png');
      return toB64(new Uint8Array(await blob.arrayBuffer()));
    },
    { rgb: Codec.rgb(rgba), width, height },
  );
  return Buffer.from(b64, 'base64');
}

const typeOf = (file) => (file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');

/** Every page's variants as files, made once (named by the source's hash and the blur code). */
async function variants(codec, page) {
  const dir = join(OUT, 'variants', page.id);
  mkdirSync(dir, { recursive: true });
  const source = readFileSync(page.file);
  const code = sha(VERSION, degrade.toString(), motionBlur.toString(), gaussianBlur.toString()).slice(0, 10);
  const stamp = sha(source, code).slice(0, 12);
  const files = {};
  let decoded = null;
  for (const v of page.variants) {
    if (v.id === 'g0') {
      files[v.id] = page.file;
      continue;
    }
    const file = join(dir, `${v.id}-${stamp}${v.fraction ? `-s${v.sigma}` : ''}.png`);
    files[v.id] = file;
    if (existsSync(file)) continue;
    decoded ??= await codec.decode(source, typeOf(page.file));
    const started = performance.now();
    writeFileSync(file, await png(codec, degrade(decoded.data, decoded.width, decoded.height, v), decoded.width, decoded.height));
    log(`  ${page.id} ${v.id}: ${decoded.width}x${decoded.height} in ${Math.round(performance.now() - started)} ms`);
  }
  return files;
}

// ---------------------------------------------------------------- the measure, transpiled
async function transpile(source) {
  const tsModule = await import(pathToFileURL(join(REPO, 'node_modules/typescript/lib/typescript.js')).href);
  const ts = tsModule.default ?? tsModule;
  let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const name of ['staffGeometry', 'vision']) js = js.split(`from './${name}'`).join(`from './${name}.js'`);
  return js;
}
/** sharpness.ts and staffGeometry.ts as they are in the working tree, or null before they exist. */
export async function buildMeasure() {
  const names = ['sharpness', 'staffGeometry'];
  if (!names.every((n) => existsSync(join(CAMERA, `${n}.ts`)))) return null;
  const sources = names.map((n) => readFileSync(join(CAMERA, `${n}.ts`), 'utf8'));
  const hash = sha(...sources).slice(0, 12);
  const dir = join(OUT, 'build', hash);
  mkdirSync(dir, { recursive: true });
  for (const [i, n] of names.entries()) writeFileSync(join(dir, `${n}.js`), await transpile(sources[i]));
  writeFileSync(join(dir, 'vision.js'), 'export {};\n');
  return { hash, module: await import(pathToFileURL(join(dir, 'sharpness.js')).href) };
}

/** The camera's live blur measure (vision.ts sharpness, 80 or more to be tracked) as it is in the tree. */
export async function buildLegacy() {
  const file = join(CAMERA, 'vision.ts');
  if (!existsSync(file)) return null;
  const source = readFileSync(file, 'utf8');
  const hash = sha(source).slice(0, 12);
  const dir = join(OUT, 'build', `vision-${hash}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'reconstruction.js'), 'export const reconstructPage = () => { throw new Error("not in the sweep"); };' + String.fromCharCode(10));
  writeFileSync(join(dir, 'vision.js'), await transpile(source));
  return { hash, module: await import(pathToFileURL(join(dir, 'vision.js')).href) };
}
export const TRACKABLE = 80;
/** The share of a page's staves (as traced unblurred) a variant must still trace to be judged in the covered calibration. */
export const COVERAGE = 0.5;
/** The frame as the camera's analysis sees it: the long edge 360 px (box-averaged here, the camera's canvas scales it). */
export function trackingFrame(frame, long = 360) {
  const scale = Math.min(1, long / Math.max(frame.width, frame.height));
  if (scale === 1) return frame;
  const width = Math.round(frame.width * scale), height = Math.round(frame.height * scale);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y / scale), y1 = Math.max(y0 + 1, Math.min(frame.height, Math.floor((y + 1) / scale)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x / scale), x1 = Math.max(x0 + 1, Math.min(frame.width, Math.floor((x + 1) / scale)));
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += frame.data[(yy * frame.width + xx) * 4 + c];
        data[(y * width + x) * 4 + c] = sum / ((y1 - y0) * (x1 - x0));
      }
      data[(y * width + x) * 4 + 3] = 255;
    }
  }
  return { width, height, data };
}

// ---------------------------------------------------------------- recognition and scoring
async function recognize(jobs, homr, parallel) {
  const pending = jobs.filter((j) => !existsSync(j.output) && !existsSync(j.output + '.failed.json'));
  log(`recognition: ${jobs.length} jobs, ${pending.length} to run on ${parallel} process(es)`);
  const seconds = {};
  const chunks = Array.from({ length: parallel }, (_, i) => pending.filter((_, k) => k % parallel === i)).filter((c) => c.length);
  await Promise.all(
    chunks.map(
      (chunk, i) =>
        new Promise((done, fail) => {
          const file = join(OUT, `jobs-${i}.json`);
          writeFileSync(file, JSON.stringify(chunk.map(({ id, input, output }) => ({ id, recognizer: 'homr', input, output })), null, 1));
          const child = spawn(process.env.DIGITUS2_OMR_PYTHON || 'python', ['-I', join(HERE, 'acceptance/recognize.py'), file, '--bundle', 'unused', '--text-models', 'unused', '--homr-toolchain', homr], { stdio: ['ignore', 'pipe', 'inherit'] });
          let buffer = '';
          child.stdout.on('data', (d) => {
            buffer += d;
            let n;
            while ((n = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, n).trim();
              buffer = buffer.slice(n + 1);
              try {
                const m = JSON.parse(line);
                if (m.id) seconds[m.id] = m.seconds;
              } catch {}
              if (line) log(`  [homr ${i}] ${line}`);
            }
          });
          child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`recognize.py exited with ${code}`))));
        }),
    ),
  );
  return seconds;
}

function truthScore(E, refScore, refStaves, file) {
  const empty = { ...refScore, notes: [], measures: [] };
  let status = 'missing', rec = empty, staves = null;
  if (existsSync(file)) {
    const xml = readFileSync(file, 'utf8');
    try {
      rec = E.parseMusicXml(xml, { preserveNotation: true }).score;
      E.evaluateOmr(refScore, rec);
      staves = photoFacts(E, xml).staves;
      status = 'parsed';
    } catch {
      status = 'invalid';
      rec = empty;
    }
  } else if (existsSync(file + '.failed.json')) status = 'failed';
  const ev = E.evaluateOmr(refScore, rec);
  const pitch = ev.metrics.pitch, fullNote = ev.metrics.fullNote;
  const barsRight = status === 'parsed' && ev.recognizedBars === ev.referenceBars;
  const stavesRight = staves === refStaves;
  return {
    status,
    pitchF1: pitch.f1,
    fullNoteF1: fullNote.f1,
    pitch: { matched: pitch.matched, reference: pitch.reference, recognized: pitch.recognized },
    bars: ev.recognizedBars,
    expectBars: ev.referenceBars,
    staves,
    expectStaves: refStaves,
    barsRight,
    stavesRight,
    read: barsRight && stavesRight,
  };
}
function photoScore(E, photo, file) {
  const facts = existsSync(file) ? photoFacts(E, readFileSync(file, 'utf8')) : null;
  const barsRight = !!facts && facts.bars === photo.bars;
  const stavesRight = !!facts && facts.staves === photo.staves;
  return {
    status: facts ? (facts.imports ? 'parsed' : 'invalid') : existsSync(file + '.failed.json') ? 'failed' : 'missing',
    bars: facts?.bars ?? null,
    expectBars: photo.bars,
    staves: facts?.staves ?? null,
    expectStaves: photo.staves,
    notes: facts?.notes ?? null,
    keyRight: !!facts && facts.fifths === photo.fifths,
    timeRight: photo.time === null ? null : !!facts && facts.time === photo.time,
    barsRight,
    stavesRight,
    read: barsRight && stavesRight,
  };
}

function parseArgs(args) {
  const o = { parallel: 3, recognize: true, measure: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--parallel') o.parallel = Math.max(1, Number(args[++i]));
    else if (a === '--no-recognize') o.recognize = false;
    else if (a === '--no-measure') o.measure = false;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const median = (values) => {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

// ---------------------------------------------------------------- calibration
const measuredValue = (row) => (Number.isFinite(row.measure?.value) ? row.measure.value : null);

/** The gate's floor from the scorecard's rows. Only pages homr reads right as they are (bars and
 * staves) take part, and only blur across the staff lines (Gaussian and vertical motion), which is
 * what the measure sees; horizontal motion is reported apart. A variant passes the gate when its
 * measure is at most the floor; a variant without a measure (the tracer finds no staff) is not judged.
 * The floor is the measured value that keeps every photo as taken and passes no variant homr reads
 * with the wrong staves, and among those the one on which the gate agrees most with homr (pass
 * when homr reads bars and staves right), the largest on a tie.
 *
 * `minCoverage` (0 to 1) also leaves unjudged a variant whose tracer found fewer than that share of the
 * staves it finds on the page unblurred: the measure is the median of whichever staves are traced, and
 * a partial trace keeps only the sharpest parts of the page. */
export function calibrate(rows, { minCoverage = 0 } = {}) {
  const sharp = new Set(rows.filter((r) => r.variant === 'g0' && r.read).map((r) => r.page));
  const eligible = rows.filter((r) => groupOf(r.variant) !== 'horizontal' && sharp.has(r.page));
  const unblurred = new Map(rows.filter((r) => r.variant === 'g0').map((r) => [r.page, r.measure?.staves]));
  const covered = (r) => !minCoverage || (unblurred.get(r.page) > 0 && r.measure?.staves / unblurred.get(r.page) >= minCoverage);
  const measured = eligible.filter((r) => measuredValue(r) !== null && covered(r));
  const photos = rows.filter((r) => r.kind === 'photo' && r.variant === 'g0' && measuredValue(r) !== null);
  const lowest = Math.max(...photos.map(measuredValue));
  const lost = measured.filter((r) => !r.stavesRight);
  const highest = lost.length ? Math.min(...lost.map(measuredValue)) : Infinity;
  const round = (f) => (f < highest && Math.ceil(f * 1000) / 1000 < highest ? Math.ceil(f * 1000) / 1000 : f);
  const agreementAt = (f) => measured.filter((r) => (measuredValue(r) <= f) === r.read).length / measured.length;
  let best = null;
  for (const f of [...new Set(measured.map(measuredValue))].sort((a, b) => a - b))
    if (f >= lowest && f < highest) {
      const a = agreementAt(f);
      if (!best || a >= best.agreement) best = { floor: f, agreement: a };
    }
  const floor = best ? round(best.floor) : null;
  const base = { photos: photos.length, measured: measured.length, unjudged: eligible.length - measured.length, lowest, highest: Number.isFinite(highest) ? highest : null };
  if (floor === null) return { ...base, feasible: false };
  const horizontal = rows.filter((r) => groupOf(r.variant) === 'horizontal' && sharp.has(r.page) && measuredValue(r) !== null);
  const judged = new Set(measured);
  const lostAll = eligible.filter((r) => !r.stavesRight);
  const rightAll = eligible.filter((r) => r.read);
  // The gate as the camera runs it: the staff-line measure where a staff is traced, else the live 360 px
  // measure (vision.ts sharpness, TRACKABLE or more), against the live measure alone.
  const live = (r) => !(Number.isFinite(r.measure?.sharp) && r.measure.sharp < TRACKABLE);
  const gates = {
    combined: (r) => (measuredValue(r) !== null ? measuredValue(r) <= floor : live(r)),
    live,
    // Where no staff is traced the frame counts as blurry.
    strict: (r) => measuredValue(r) !== null && measuredValue(r) <= floor,
  };
  const gateStats = Object.fromEntries(
    Object.entries(gates).map(([name, passes]) => [
      name,
      {
        agreement: eligible.filter((r) => passes(r) === r.read).length / eligible.length,
        rightRejected: rightAll.filter((r) => !passes(r)).length,
        lostStavesPassed: lostAll.filter(passes).length,
        lostStavesRejected: lostAll.filter((r) => !passes(r)).length,
        photosRejected: rows.filter((r) => r.kind === 'photo' && r.variant === 'g0' && !passes(r)).length,
      },
    ]),
  );
  return {
    ...base,
    feasible: photos.every((r) => measuredValue(r) <= floor) && lost.every((r) => measuredValue(r) > floor),
    floor,
    agreement: agreementAt(floor),
    photoRejected: photos.filter((r) => measuredValue(r) > floor).length,
    stavesFalsePass: lost.filter((r) => measuredValue(r) <= floor).length,
    rightRejected: measured.filter((r) => r.read && measuredValue(r) > floor).length,
    rightTotal: measured.filter((r) => r.read).length,
    rightAll: rightAll.length,
    lostStaves: lostAll.length,
    lostStavesRejected: lostAll.filter((r) => judged.has(r) && measuredValue(r) > floor).length,
    lostStavesUnjudged: lostAll.filter((r) => !judged.has(r)).length,
    horizontalFalsePass: horizontal.filter((r) => !r.stavesRight && measuredValue(r) <= floor).length,
    horizontalLost: horizontal.filter((r) => !r.stavesRight).length,
    eligible: eligible.length,
    gates: gateStats,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const homr = resolve(process.env.DIGITUS2_OMR_HOMR || 'C:/Users/maxim/omr/homr2');
  const pipeline = pipelineHash();
  const started = performance.now();
  mkdirSync(OUT, { recursive: true });
  const fx = await fixtures(DEFAULT_PIECES);
  const byId = new Map(fx.manifest.pieces.map((p) => [p.id, p]));
  const manifest = JSON.parse(readFileSync(join(HERE, 'photos/manifest.json'), 'utf8'));
  const pages = [
    ...DEFAULT_PIECES.map((id) => ({ id, kind: 'truth', piece: byId.get(id), file: join(fx.dir, byId.get(id).pages[0].images.clean) })),
    ...manifest.photos.map((photo) => ({ id: photo.id, kind: 'photo', photo, file: join(HERE, 'photos', photo.file) })),
  ];
  const measure = await buildMeasure();
  const legacy = await buildLegacy();
  if (!measure) log('the measure (sharpness.ts) is not there yet: no interline for the truth pages, no measures');
  const measureCache = join(OUT, 'measure-cache.json');
  const known = measure && existsSync(measureCache) ? JSON.parse(readFileSync(measureCache, 'utf8')) : {};
  const codec = new Codec();
  await codec.start();
  const measured = {};
  const interline = {};
  /** The measure of a picture, cached by the measure's code and the picture's bytes. */
  const measureOf = async (file) => {
    const bytes = readFileSync(file);
    const key = `${measure.hash}:${sha(bytes).slice(0, 16)}`;
    const legacyKey = legacy ? `legacy:${legacy.hash}:${sha(bytes).slice(0, 16)}` : null;
    let frame = null;
    const decoded = async () => (frame ??= await codec.decode(bytes, typeOf(file)));
    if (known[key]?.traceMs === undefined) {
      const f = await decoded();
      // Tracing the staves and measuring them are timed apart: the trace is the slow part.
      const t0 = performance.now();
      const tracing = measure.module.traceStaves(f);
      const t1 = performance.now();
      const m = measure.module.staffSharpness(f, tracing);
      const t2 = performance.now();
      known[key] = { traceMs: Math.round(t1 - t0), measureMs: Math.round(t2 - t1), traced: tracing?.traced ?? null, ...(m ? { value: m.value, worst: m.worst, staves: m.staves, interline: m.interline, scale: m.scale, samples: m.samples } : { value: null }) };
    }
    // The camera's live measure of the same picture, at the 360 px it judges.
    if (legacyKey && !known[legacyKey]) known[legacyKey] = { sharp: legacy.module.sharpness(trackingFrame(await decoded())) };
    writeFileSync(measureCache, JSON.stringify(known));
    return { ...known[key], sharp: legacyKey ? known[legacyKey].sharp : null };
  };
  try {
    for (const page of pages) {
      // The truth pages' blur fractions need their interline, from the measure of the page itself.
      const own = measure ? await measureOf(page.file) : null;
      interline[page.id] = own?.interline && own.scale ? own.interline / own.scale : null;
      page.variants = variantsOf(page, interline[page.id]);
      page.files = await variants(codec, page);
      if (!measure || !opts.measure) continue;
      for (const v of page.variants) measured[`${page.id}:${v.id}`] = await measureOf(page.files[v.id]);
      log(`${page.id}: ${page.variants.map((v) => `${v.id} ${measured[`${page.id}:${v.id}`]?.value?.toFixed(3) ?? '-'}`).join('  ')}`);
    }
  } finally {
    await codec.close();
  }
  const allVariants = [...VARIANTS, ...FRACTIONS.map((f) => ({ id: `gd${Math.round(f * 100)}` }))];

  const cache = join(OUT, 'cache');
  mkdirSync(cache, { recursive: true });
  const keyOf = (input) => join(cache, `${sha(readFileSync(input), `homr:${pipeline}`).slice(0, 24)}.musicxml`);
  const jobs = pages.flatMap((page) => page.variants.map((v) => ({ id: `${page.id}:${v.id}`, page, variant: v, input: page.files[v.id], output: keyOf(page.files[v.id]) })));
  let seconds = {};
  if (opts.recognize) seconds = await recognize([...new Map(jobs.map((j) => [j.output, j])).values()], homr, opts.parallel);

  const E = await import(pathToFileURL(join(REPO, 'packages/engine/dist/src/index.js')).href);
  const refs = new Map();
  const rows = jobs.map((job) => {
    const { page, variant } = job;
    let result;
    if (page.kind === 'truth') {
      if (!refs.has(page.id)) {
        const xml = readFileSync(join(fx.dir, page.piece.reference), 'utf8');
        refs.set(page.id, { score: E.parseMusicXml(xml, { preserveNotation: true }).score, staves: photoFacts(E, xml).staves });
      }
      const ref = refs.get(page.id);
      result = truthScore(E, ref.score, ref.staves, job.output);
    } else result = photoScore(E, page.photo, job.output);
    const d = interline[page.id];
    return {
      page: page.id,
      kind: page.kind,
      variant: variant.id,
      blur: variant,
      ...result,
      measure: measured[job.id] ?? null,
      seconds: seconds[job.id] ?? null,
      interline: d,
      blurPerInterline: d ? (variant.kind === 'gauss' ? variant.sigma : variant.length / Math.sqrt(12)) / d : null,
    };
  });
  const sharpRead = Object.fromEntries(pages.map((p) => [p.id, rows.find((r) => r.page === p.id && r.variant === 'g0').read]));
  const summary = {};
  for (const v of allVariants) {
    const vr = rows.filter((r) => r.variant === v.id);
    const truth = vr.filter((r) => r.kind === 'truth');
    const photos = vr.filter((r) => r.kind === 'photo');
    const t = { matched: 0, reference: 0, recognized: 0 };
    for (const r of truth) for (const k of Object.keys(t)) t[k] += r.pitch[k];
    summary[v.id] = {
      group: groupOf(v.id),
      truth: {
        pages: truth.length,
        pitchF1: t.reference + t.recognized ? (2 * t.matched) / (t.reference + t.recognized) : 1,
        barsRight: truth.filter((r) => r.barsRight).length,
        stavesRight: truth.filter((r) => r.stavesRight).length,
        blurPerInterline: median(truth.map((r) => r.blurPerInterline)),
        measure: median(truth.map((r) => r.measure?.value)),
        measured: truth.filter((r) => Number.isFinite(r.measure?.value)).length,
      },
      photos: {
        pages: photos.length,
        barsRight: photos.filter((r) => r.barsRight).length,
        stavesRight: photos.filter((r) => r.stavesRight).length,
        keyRight: photos.filter((r) => r.keyRight).length,
        timeRight: photos.filter((r) => r.timeRight).length,
        readWhereSharpRead: photos.filter((r) => r.read && sharpRead[r.page]).length,
        sharpRead: photos.filter((r) => sharpRead[r.page]).length,
        blurPerInterline: median(photos.map((r) => r.blurPerInterline)),
        measure: median(photos.map((r) => r.measure?.value)),
        measured: photos.filter((r) => Number.isFinite(r.measure?.value)).length,
      },
    };
  }
  const calibration = measure && opts.measure ? calibrate(rows) : null;
  const calibrationCovered = measure && opts.measure ? calibrate(rows, { minCoverage: COVERAGE }) : null;
  const card = {
    schemaVersion: 1,
    version: VERSION,
    generated: new Date().toISOString(),
    pipeline,
    homr,
    measure: measure?.hash ?? null,
    variants: allVariants,
    pages: pages.map((p) => ({ id: p.id, kind: p.kind, interline: interline[p.id], sharpRead: sharpRead[p.id] })),
    summary,
    calibration,
    calibrationCovered,
    rows,
    seconds: (performance.now() - started) / 1000,
  };
  writeFileSync(join(OUT, 'latest.json'), JSON.stringify(card, null, 2));
  const f = (x, d = 3) => (x === null || x === undefined ? '-' : x.toFixed(d));
  const line = (v) => {
    const s = summary[v.id];
    const photos = s.photos.pages ? `${String(s.photos.barsRight).padStart(4)} ${String(s.photos.stavesRight).padStart(6)} ${`${s.photos.readWhereSharpRead}/${s.photos.sharpRead}`.padStart(6)}  ${f(s.photos.blurPerInterline).padStart(6)} ${f(s.photos.measure).padStart(7)} (${s.photos.measured})` : '';
    return `${v.id.padEnd(7)}        ${f(100 * s.truth.pitchF1, 1).padStart(6)} ${String(s.truth.barsRight).padStart(4)} ${String(s.truth.stavesRight).padStart(6)}  ${f(s.truth.blurPerInterline).padStart(6)} ${f(s.truth.measure).padStart(7)} (${s.truth.measured}) | ${photos}`;
  };
  console.log('\nvariant  truth: pitchF1 bars staves  blur/d measure (n) | photos: bars staves read*  blur/d measure (n)');
  for (const v of allVariants.filter((v) => groupOf(v.id) !== 'horizontal')) console.log(line(v));
  console.log('\nThe measure\'s blind spot (blur along the lines):');
  for (const v of allVariants.filter((v) => groupOf(v.id) === 'horizontal')) console.log(line(v));
  if (calibration?.feasible) {
    const g = calibration.gates;
    const pct = (x) => `${(100 * x.agreement).toFixed(1)} %`;
    console.log(
      `
Gate as the camera runs it (staff measure, else the live 360 px measure) against the live measure alone, over ${calibration.eligible} variants: agreement ${pct(g.combined)} against ${pct(g.live)}; variants losing staves passed ${g.combined.lostStavesPassed} against ${g.live.lostStavesPassed} of ${calibration.lostStaves}; right-read variants rejected ${g.combined.rightRejected} against ${g.live.rightRejected} of ${calibration.rightAll}; photos rejected ${g.combined.photosRejected} against ${g.live.photosRejected}.
Gate that treats a frame without a traced staff as blurry (floor ${calibration.floor}): agreement ${pct(g.strict)}; variants losing staves passed ${g.strict.lostStavesPassed} of ${calibration.lostStaves}; right-read variants rejected ${g.strict.rightRejected} of ${calibration.rightAll}; photos rejected ${g.strict.photosRejected}.`,
    );
  }
  if (calibration) {
    const c = calibration;
    console.log(
      c.feasible
        ? `\nCalibration: floor ${c.floor}, agreement ${(100 * c.agreement).toFixed(1)} % of ${c.measured} measured variants, photos rejected ${c.photoRejected}/${c.photos}, staves false passes ${c.stavesFalsePass}, right-read variants rejected ${c.rightRejected}/${c.rightTotal}, variants losing staves rejected ${c.lostStavesRejected}/${c.lostStaves} (${c.lostStavesUnjudged} without a measure), horizontal false passes ${c.horizontalFalsePass}/${c.horizontalLost}`
        : `\nCalibration: no floor keeps all ${c.photos} photos (measure up to ${c.lowest}) and passes no variant that loses its staves (measure from ${c.highest}).`,
    );
  }
  if (calibrationCovered) {
    const c = calibrationCovered;
    console.log(
      c.feasible
        ? `Calibration on variants that still trace ${100 * COVERAGE} % of their page's staves: floor ${c.floor}, agreement ${(100 * c.agreement).toFixed(1)} % of ${c.measured} measured variants, photos rejected ${c.photoRejected}/${c.photos}, staves false passes ${c.stavesFalsePass}, right-read variants rejected ${c.rightRejected}/${c.rightTotal}, variants losing staves rejected ${c.lostStavesRejected}/${c.lostStaves} (${c.lostStavesUnjudged} not judged)`
        : `Calibration on variants that still trace ${100 * COVERAGE} % of their page's staves: no floor keeps all ${c.photos} photos (measure up to ${c.lowest}) and passes no variant that loses its staves (measure from ${c.highest}).`,
    );
  }
  console.log(`\nScorecard: ${join(OUT, 'latest.json')} (${card.seconds.toFixed(0)} s)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(
    (code) => (process.exitCode = code),
    (error) => {
      console.error(error.stack ?? error.message);
      process.exitCode = 2;
    },
  );
