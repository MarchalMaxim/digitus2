#!/usr/bin/env node
// How close homr's image positions land to the notes they name (issue 161). homr writes each
// note's estimated centre as `<!-- imgpos: x, y -->` in the pixels of the image it was given; the
// review crops the page around it. This measures the distance on the acceptance corpus's clean
// pages (research/omr/acceptance/corpus.json, rendered by prepare.mjs), where every notehead's true
// position is known from the Verovio drawing the page image was made from.
//
//   node research/omr/imgpos.mjs --check   exit 0 when local homr is prepared, 3 with the reason
//   node research/omr/imgpos.mjs           measure, and compare with floor.json's "imgpos" floor
//
// Recognitions are the acceptance gate's own: the same cache folder and names (the input's hash
// and the pipeline's), so a page either run recognised is not recognised again. Truth: the
// reference MusicXML is drawn again with each <note> named by its document-order index, which
// must give the fixture's drawing exactly; Chromium lays that drawing out at the PNG's size and
// each notehead's box centre is its true position. Notes are paired as the engine's evaluateOmr
// pairs them: bar by ordinal, then onset in the bar and MIDI pitch (staff breaks a tie), so only
// notes recognised at the right time and pitch are measured. Distances are in the page's staff
// spaces (the distance between two staff lines).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixtures, pipelineHash, recognitionKey, SKIP, toolchains } from './acceptance.mjs';
import { RENDER_OPTIONS } from './prepare.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const RESULTS = join(REPO, 'research/omr/results/acceptance');
const CORPUS = join(HERE, 'acceptance/corpus.json');
const FLOOR = join(HERE, 'acceptance/floor.json');
const VARIANT = 'clean';
/** The thresholds reported, in staff spaces; 1.5 is half the review's crop height. */
export const THRESHOLDS = [0.5, 0.75, 1, 1.5, 2, 3];

/** Why the benchmark cannot run here, or null when it can: local homr and Python 3.11. */
export function missing(tc = toolchains()) {
  if (!existsSync(join(tc.homr, 'venv')))
    return `homr not prepared (${tc.homr}; or set DIGITUS2_OMR_HOMR)`;
  const version = spawnSync(tc.python, ['-c', 'import sys;print(sys.version_info[:2]>=(3,11))'], {
    encoding: 'utf8',
  });
  if (version.stdout?.trim() !== 'True') return `Python 3.11 or later not found as "${tc.python}"`;
  return null;
}

/** Each `<note>`'s image position in document order: `{x, y}`, or null for a note without one. */
export function imagePositions(xml) {
  const out = [];
  for (const match of xml.matchAll(/<note(?:\s[^>]*)?>([\s\S]*?)<\/note>/g)) {
    const found = /<!--\s*imgpos:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*-->/.exec(match[1]);
    out.push(found ? { x: Number(found[1]), y: Number(found[2]) } : null);
  }
  return out;
}

/** The value below which a share `q` of the sorted values lies (nearest rank). */
export function quantile(sorted, q) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

/** Distances in staff spaces, summarised: median, 90th percentile and the share within each threshold. */
export function summarise(distances) {
  const sorted = [...distances].sort((a, b) => a - b);
  const round = (x) => (x === null ? null : Math.round(x * 1000) / 1000);
  return {
    notes: sorted.length,
    median: round(quantile(sorted, 0.5)),
    p90: round(quantile(sorted, 0.9)),
    within: Object.fromEntries(
      THRESHOLDS.map((t) => [t, sorted.length ? round(sorted.filter((d) => d <= t).length / sorted.length) : null]),
    ),
  };
}

/**
 * The share of notes a crop of half height `halfHeight` staff spaces holds: the crop is twice as
 * wide as it is high, so a note is inside when |dy| <= H and |dx| <= 2H. dx, dy are absolute.
 */
export function insideShare(dx, dy, halfHeight) {
  if (!dx.length) return null;
  const inside = dx.filter((x, i) => x <= 2 * halfHeight && dy[i] <= halfHeight).length;
  return Math.round((inside / dx.length) * 1000) / 1000;
}

/** The half heights tried, in staff spaces: the crop is 2H high and 4H wide. */
export const HALF_HEIGHTS = [1, 1.5, 2, 2.5, 3];

/** Signed offsets (recognised minus true, in staff spaces) per axis: signed median, absolute median and 90th percentile, crop shares. */
function axes(dx, dy) {
  const round = (x) => (x === null ? null : Math.round(x * 1000) / 1000);
  const signed = (values) => round(quantile([...values].sort((a, b) => a - b), 0.5));
  const adx = dx.map(Math.abs);
  const ady = dy.map(Math.abs);
  return {
    signedMedianDx: signed(dx),
    signedMedianDy: signed(dy),
    medianAbsDx: summarise(adx).median,
    medianAbsDy: summarise(ady).median,
    p90AbsDx: summarise(adx).p90,
    p90AbsDy: summarise(ady).p90,
    insideCrop: Object.fromEntries(HALF_HEIGHTS.map((h) => [h, insideShare(adx, ady, h)])),
  };
}

const gcd =(a, b) => (b ? gcd(b, a % b) : a);
/** A bar-local onset in quarters as an exact fraction, as evaluateOmr compares onsets. */
const quarters = (ticks, divisions) => {
  const d = gcd(Math.abs(ticks), divisions) || 1;
  return `${ticks / d}/${divisions / d}`;
};

/**
 * Pairs recognised notes with reference notes as the engine's evaluateOmr does: bars by ordinal,
 * then equal bar-local onset and MIDI pitch; among equals, the same staff first, then file order.
 * Grace notes are left out (their onset is their main note's). Returns [recognised, reference].
 */
export function pairNotes(reference, recognized) {
  const byBar = (score) => {
    const ordinal = new Map(score.measures.map((m, i) => [m.index, i]));
    const bars = score.measures.map(() => []);
    for (const n of score.notes) {
      if (n.isGrace) continue;
      const i = ordinal.get(n.measureIndex);
      if (i === undefined) continue;
      const m = score.measures[i];
      bars[i].push({ note: n, key: `${quarters(n.onsetTick - m.startTick, score.divisions)}|${n.midi}` });
    }
    return bars;
  };
  const ref = byBar(reference);
  const rec = byBar(recognized);
  const pairs = [];
  for (let i = 0; i < Math.min(ref.length, rec.length); i++) {
    const open = [...ref[i]];
    for (const r of rec[i]) {
      const same = open.filter((g) => g.key === r.key);
      if (!same.length) continue;
      const pick = same.find((g) => g.note.staff === r.note.staff) ?? same[0];
      open.splice(open.indexOf(pick), 1);
      pairs.push([r.note, pick.note]);
    }
  }
  return pairs;
}

/** The reference drawn again with each `<note>` named `s<index>`; fingerings removed as prepare.mjs does. */
function namedReference(xml) {
  let index = 0;
  return xml
    .replace(/<fingering(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/fingering>)/g, '')
    .replace(/<note(\s[^>]*)?>/g, (_, attributes = '') => {
      const kept = attributes.replace(/\s(?:xml:)?id="[^"]*"/g, '');
      return `<note id="s${index++}"${kept}>`;
    });
}

/** The notehead glyph placements of a Verovio drawing, sorted: its geometry, independent of ids. */
const noteheads = (svg) =>
  [...svg.matchAll(/class="notehead"[^>]*>\s*<use[^>]*transform="([^"]*)"/g)].map((m) => m[1]).sort();

async function truthPositions(dir, manifest) {
  const appRequire = createRequire(join(REPO, 'apps/web/package.json'));
  const [{ default: createVerovioModule }, { VerovioToolkit }, playwright] = await Promise.all([
    import(pathToFileURL(appRequire.resolve('verovio/wasm')).href),
    import(pathToFileURL(appRequire.resolve('verovio/esm')).href),
    import(pathToFileURL(appRequire.resolve('@playwright/test')).href),
  ]);
  const { chromium } = playwright.default ?? playwright;
  const module = await createVerovioModule();
  const { widthPx: width, heightPx: height } = manifest.config.page;
  const browser = await chromium.launch({ headless: true });
  const out = new Map();
  try {
    const page = await browser.newPage({ viewport: { width: width + 40, height: height + 40 } });
    for (const piece of manifest.pieces) {
      const fixtureSvg = readFileSync(join(dir, piece.pages[0].svg), 'utf8');
      const toolkit = new VerovioToolkit(module);
      let svg;
      try {
        toolkit.setOptions(RENDER_OPTIONS);
        if (!toolkit.loadData(namedReference(readFileSync(join(dir, piece.reference), 'utf8'))))
          throw new Error(`Verovio failed to load ${piece.id}`);
        if (toolkit.getPageCount() !== 1) throw new Error(`${piece.id}: expected one page`);
        svg = toolkit.renderToSVG(1);
      } finally {
        toolkit.destroy();
      }
      // Named notes must not move a single notehead: the drawing is the fixture's.
      if (noteheads(svg).join('\n') !== noteheads(fixtureSvg).join('\n'))
        throw new Error(`${piece.id}: the named drawing differs from the fixture's`);
      const viewBox = /\bviewBox="([^"]*)"/.exec(fixtureSvg)[1];
      svg = svg.replace(/\bviewBox="[^"]*"/, `viewBox="${viewBox}"`);
      const measured = await page.evaluate(
        ({ svg, width, height }) => {
          document.body.style.margin = '0';
          document.body.innerHTML = svg;
          const root = document.body.querySelector('svg');
          root.setAttribute('width', String(width));
          root.setAttribute('height', String(height));
          root.style.display = 'block';
          const origin = root.getBoundingClientRect();
          const centre = (el) => {
            const r = el.getBoundingClientRect();
            return { x: r.left - origin.left + r.width / 2, y: r.top - origin.top + r.height / 2 };
          };
          const heads = {};
          for (const note of root.querySelectorAll('g.note[id^="s"]')) {
            const head = note.querySelector('.notehead');
            if (head) heads[note.id.slice(1)] = centre(head);
          }
          const spaces = [];
          for (const staff of root.querySelectorAll('g.staff')) {
            const lines = [...staff.querySelectorAll(':scope > path')].map((p) => centre(p).y);
            if (lines.length === 5) spaces.push((Math.max(...lines) - Math.min(...lines)) / 4);
          }
          spaces.sort((a, b) => a - b);
          return { heads, space: spaces[Math.floor(spaces.length / 2)] ?? null };
        },
        { svg, width, height },
      );
      if (!measured.space) throw new Error(`${piece.id}: no staff lines found`);
      out.set(piece.id, measured);
    }
  } finally {
    await browser.close();
  }
  return out;
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
  const cache = join(RESULTS, 'cache');
  mkdirSync(cache, { recursive: true });
  const jobs = manifest.pieces.map((piece) => {
    const input = join(dir, piece.pages[0].images[VARIANT]);
    return { id: `${piece.id}:homr:${VARIANT}`, piece, recognizer: 'homr', input, output: join(cache, `${recognitionKey(input, 'homr', pipeline)}.musicxml`) };
  });
  if (jobs.some((job) => !existsSync(job.output) && !existsSync(job.output + '.failed.json'))) {
    const jobFile = join(RESULTS, 'imgpos-jobs.json');
    writeFileSync(jobFile, JSON.stringify(jobs.map(({ id, recognizer, input, output }) => ({ id, recognizer, input, output })), null, 1));
    const workers = String(Math.max(1, Number(process.env.DIGITUS2_OMR_WORKERS) || 3));
    const run = spawnSync(
      tc.python,
      ['-I', join(HERE, 'acceptance/recognize.py'), jobFile, '--bundle', 'unused', '--text-models', 'unused', '--homr-toolchain', tc.homr, '--workers', workers],
      { stdio: 'inherit' },
    );
    if (run.status !== 0) throw new Error(`recognize.py exited with ${run.status}`);
  }

  const E = await import(pathToFileURL(join(REPO, 'packages/engine/dist/src/index.js')).href);
  const truth = await truthPositions(dir, manifest);
  const rows = [];
  const all = { distances: [], dx: [], dy: [] };
  for (const job of jobs) {
    const row = { piece: job.piece.id, status: 'missing' };
    rows.push(row);
    if (!existsSync(job.output)) continue;
    const xml = readFileSync(job.output, 'utf8');
    const positions = imagePositions(xml);
    const { heads, space } = truth.get(job.piece.id);
    let reference, recognized;
    try {
      reference = E.parseMusicXml(readFileSync(join(dir, job.piece.reference)), { preserveNotation: true }).score;
      recognized = E.parseMusicXml(xml, { preserveNotation: true }).score;
    } catch (cause) {
      row.status = 'invalid';
      row.error = cause.message;
      continue;
    }
    row.status = 'parsed';
    const pairs = pairNotes(reference, recognized);
    const distances = [];
    const dx = [];
    const dy = [];
    let unplaced = 0;
    for (const [rec, ref] of pairs) {
      const at = positions[rec.sourceIndices[0]];
      const head = heads[ref.sourceIndices[0]];
      if (!at || !head) {
        unplaced++;
        continue;
      }
      distances.push(Math.hypot(at.x - head.x, at.y - head.y) / space);
      dx.push((at.x - head.x) / space);
      dy.push((at.y - head.y) / space);
    }
    Object.assign(row, {
      staffSpacePx: Math.round(space * 100) / 100,
      referenceNotes: reference.notes.filter((n) => !n.isGrace).length,
      recognizedNotes: recognized.notes.filter((n) => !n.isGrace).length,
      paired: pairs.length,
      unplaced,
      ...summarise(distances),
      ...axes(dx, dy),
    });
    all.distances.push(...distances);
    all.dx.push(...dx);
    all.dy.push(...dy);
  }
  const total = {
    pages: rows.length,
    measuredPages: rows.filter((r) => r.status === 'parsed').length,
    referenceNotes: rows.reduce((s, r) => s + (r.referenceNotes ?? 0), 0),
    paired: rows.reduce((s, r) => s + (r.paired ?? 0), 0),
    unplaced: rows.reduce((s, r) => s + (r.unplaced ?? 0), 0),
    ...summarise(all.distances),
    ...axes(all.dx, all.dy),
  };
  const card = { schemaVersion: 1, corpus: corpus.version, variant: VARIANT, pipeline, total, rows };
  writeFileSync(join(RESULTS, 'imgpos.json'), JSON.stringify(card, null, 2));

  const fmt = (x) => (x === null || x === undefined ? '-' : String(x));
  console.log('\npiece                                    sp px  paired  median   p90  <=1   <=1.5 <=2   crop1.5');
  for (const r of rows)
    console.log(
      `${r.piece.slice(0, 40).padEnd(40)} ${fmt(r.staffSpacePx).padStart(5)} ${fmt(r.paired).padStart(7)} ${fmt(r.median).padStart(7)} ${fmt(r.p90).padStart(5)} ${fmt(r.within?.[1]).padStart(5)} ${fmt(r.within?.[1.5]).padStart(5)} ${fmt(r.within?.[2]).padStart(5)} ${fmt(r.insideCrop?.[1.5]).padStart(8)}${r.status === 'parsed' ? '' : ` (${r.status})`}`,
    );
  console.log(`\nall: ${JSON.stringify(total)}`);

  const floor = existsSync(FLOOR) ? JSON.parse(readFileSync(FLOOR, 'utf8')).imgpos : undefined;
  if (!floor) {
    console.log('\nfloor.json sets no imgpos floor: measured only.');
    return 0;
  }
  const share = total.insideCrop[floor.halfHeightSpaces];
  if (typeof share !== 'number' || share < floor.insideCropMin) {
    console.log(`\nRegression: ${share} of notes inside a crop of half height ${floor.halfHeightSpaces} staff spaces, floor ${floor.insideCropMin}`);
    return 1;
  }
  console.log(`\n${share} of notes inside a crop of half height ${floor.halfHeightSpaces} staff spaces meets the floor ${floor.insideCropMin}.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(
    (code) => (process.exitCode = code),
    (error) => {
      console.error(`imgpos benchmark: ${error.message}`);
      process.exitCode = 2;
    },
  );
