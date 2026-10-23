#!/usr/bin/env node
// Match a recognised page to a library piece by its pitch sequence (issue 166).
// Each piece is reduced to the pitch classes of one voice per hand in onset order; a page is
// matched by the share of its 8-note windows ("shingles") that the piece also contains.
// This measures how often that finds the piece; it changes nothing in the app.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

export const SHINGLE = 8;
const SAME_WORK = 0.5;
const RATES = [0, 0.02, 0.05, 0.1, 0.2];
const MIN_SHINGLES = 10;
const PAGE_MEASURES = 8;
const SEED = 166;
const GRID_SCORE = [0.2, 0.3, 0.4];
const GRID_MARGIN = [0.1, 0.2, 0.3];
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** One voice per hand: the top note of each right-hand onset, the bottom note of each left-hand one. */
export function pitchSequences(score) {
  const byHand = { R: new Map(), L: new Map() };
  for (const note of score.notes) {
    if (note.isGrace) continue;
    const groups = byHand[note.hand === 'L' ? 'L' : 'R'];
    const group = groups.get(note.onsetTick);
    if (!group) groups.set(note.onsetTick, [note]);
    else group.push(note);
  }
  const reduce = (groups, pick) =>
    [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, notes]) => {
        const chosen = notes.reduce((best, n) => (pick(n.midi, best.midi) ? n : best));
        return { pc: ((chosen.midi % 12) + 12) % 12, measure: chosen.measureIndex };
      });
  return {
    R: reduce(byHand.R, (a, b) => a > b),
    L: reduce(byHand.L, (a, b) => a < b),
  };
}

/** Every window of 8 consecutive pitch classes within a hand, both hands pooled in one set. */
export function shingles(seqs) {
  const out = new Set();
  for (const hand of ['R', 'L']) {
    const seq = seqs[hand] ?? [];
    for (let i = 0; i + SHINGLE <= seq.length; i++) {
      let key = '';
      for (let k = 0; k < SHINGLE; k++) key += seq[i + k].pc.toString(16);
      out.add(key);
    }
  }
  return out;
}

export function buildIndex(entries) {
  const slugs = entries.map((e) => e.slug);
  const titles = entries.map((e) => e.title ?? e.slug);
  const sets = entries.map((e) => shingles(e.sequences));
  const postings = new Map();
  sets.forEach((set, i) => {
    for (const key of set) {
      const list = postings.get(key);
      if (list) list.push(i);
      else postings.set(key, [i]);
    }
  });
  return { slugs, titles, sets, postings, works: new Map() };
}

/** Two pieces are the same work when one holds at least half of the other's shingles. */
export function sameWork(index, i, j) {
  if (i === j) return true;
  const a = index.sets[i];
  const b = index.sets[j];
  const small = a.size <= b.size ? a : b;
  const large = small === a ? b : a;
  if (small.size === 0) return false;
  let shared = 0;
  for (const key of small) if (large.has(key)) shared++;
  return shared / small.size >= SAME_WORK;
}

/** Slugs of every piece that is the same work as piece i, itself included. */
export function workOf(index, i) {
  const cached = index.works.get(i);
  if (cached) return cached;
  const counts = new Map();
  for (const key of index.sets[i]) {
    for (const j of index.postings.get(key)) counts.set(j, (counts.get(j) ?? 0) + 1);
  }
  const work = new Set([index.slugs[i]]);
  for (const [j, shared] of counts) {
    if (shared / Math.min(index.sets[i].size, index.sets[j].size) >= SAME_WORK)
      work.add(index.slugs[j]);
  }
  index.works.set(i, work);
  return work;
}

/** Rank pieces by the share of the query's shingles they hold; the margin is against another work. */
export function matchSequences(index, seqs, { exclude } = {}) {
  const query = shingles(seqs);
  const counts = new Map();
  for (const key of query) {
    const list = index.postings.get(key);
    if (list) for (const j of list) counts.set(j, (counts.get(j) ?? 0) + 1);
  }
  const all = [];
  for (const [j, shared] of counts) {
    if (exclude?.has(index.slugs[j])) continue;
    all.push({ j, slug: index.slugs[j], score: shared / query.size });
  }
  all.sort((a, b) => b.score - a.score || a.j - b.j);
  const best = all[0] ? { slug: all[0].slug, score: all[0].score } : null;
  let margin = 0;
  if (best) {
    const work = workOf(index, all[0].j);
    const other = all.find((r) => !work.has(r.slug));
    margin = best.score - (other ? other.score : 0);
  }
  return {
    shingles: query.size,
    ranked: all.slice(0, 5).map(({ slug, score }) => ({ slug, score })),
    best,
    margin,
  };
}

export function matchScore(index, score, opts) {
  return matchSequences(index, pitchSequences(score), opts);
}

export function accepts(result, { minScore = 0.3, minMargin = 0.2 } = {}) {
  return !!result.best && result.best.score >= minScore && result.margin >= minMargin;
}

/** The pages are the measure ranges [k*m, (k+1)*m). */
export function cutPages(seqs, measuresPerPage) {
  let last = -1;
  for (const hand of ['R', 'L']) for (const e of seqs[hand] ?? []) last = Math.max(last, e.measure);
  const pages = [];
  for (let k = 0; k * measuresPerPage <= last; k++) {
    const lo = k * measuresPerPage;
    const hi = lo + measuresPerPage;
    const within = (seq) => (seq ?? []).filter((e) => e.measure >= lo && e.measure < hi);
    pages.push({ R: within(seqs.R), L: within(seqs.L) });
  }
  return pages;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each element, with probability `rate`, is shifted by a tone or two, dropped, or followed by a stray one. */
export function corruptSequences(seqs, rate, rng) {
  const shifts = [-2, -1, 1, 2];
  const out = { R: [], L: [] };
  for (const hand of ['R', 'L']) {
    for (const e of seqs[hand] ?? []) {
      if (rng() >= rate) {
        out[hand].push(e);
        continue;
      }
      const kind = Math.floor(rng() * 3);
      if (kind === 0) {
        const shift = shifts[Math.floor(rng() * shifts.length)];
        out[hand].push({ pc: (((e.pc + shift) % 12) + 12) % 12, measure: e.measure });
      } else if (kind === 2) {
        out[hand].push(e, { pc: Math.floor(rng() * 12), measure: e.measure });
      }
    }
  }
  return out;
}

/** Parse every manifest piece into pitch sequences; a piece that fails to parse is skipped and counted. */
export function loadLibrary(repo, E) {
  const manifest = JSON.parse(readFileSync(join(repo, 'content/manifest.json'), 'utf8'));
  const entries = [];
  let failed = 0;
  for (const piece of manifest) {
    try {
      const path = join(repo, 'content', piece.files.score);
      let bytes = readFileSync(path);
      if (path.endsWith('.gz')) bytes = gunzipSync(bytes);
      const score = E.parseMusicXml(new Uint8Array(bytes)).score;
      entries.push({ slug: piece.slug, title: piece.title, sequences: pitchSequences(score) });
    } catch {
      failed++;
    }
  }
  entries.failed = failed;
  return entries;
}

// ---- measurement ----------------------------------------------------------------------------

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const pct = (n, d) => (d ? (100 * n) / d : null);

/** One query: the match with the whole library (in) and with the truth's whole work removed (out). */
function runQuery(index, seqs, truth) {
  const ti = index.slugs.indexOf(truth);
  const work = workOf(index, ti);
  const inn = matchSequences(index, seqs);
  const out = matchSequences(index, seqs, { exclude: work });
  return {
    truth,
    in: {
      best: inn.best?.slug ?? null,
      score: inn.best?.score ?? 0,
      margin: inn.margin,
      inWork: !!inn.best && work.has(inn.best.slug),
      exact: inn.best?.slug === truth,
    },
    out: { best: out.best?.slug ?? null, score: out.best?.score ?? 0, margin: out.margin },
  };
}
const noMatch = (truth) => ({
  truth,
  in: { best: null, score: 0, margin: 0, inWork: false, exact: false },
  out: { best: null, score: 0, margin: 0 },
});

function summarise(runs, opts = {}) {
  const hit = runs.filter((r) => accepts(r.in, opts) && r.in.inWork).length;
  const wrong = runs.filter((r) => accepts(r.in, opts) && !r.in.inWork).length;
  const falseMatch = runs.filter((r) => accepts(r.out, opts)).length;
  return { hit, wrong, falseMatch };
}
// accepts() reads best.score; the run records carry flat score fields, so adapt them.
const asResult = (side) => ({
  best: side.best ? { slug: side.best, score: side.score } : null,
  margin: side.margin,
});
function stats(runs) {
  const view = runs.map((r) => ({
    truth: r.truth,
    in: { ...asResult(r.in), inWork: r.in.inWork },
    out: asResult(r.out),
  }));
  const s = summarise(view);
  const n = runs.length;
  const inMargins = runs.map((r) => r.in.margin);
  const outScores = runs.map((r) => r.out.score);
  return {
    n,
    hitPct: pct(s.hit, n),
    wrongPct: pct(s.wrong, n),
    rejectedPct: pct(n - s.hit - s.wrong, n),
    top1WorkPct: pct(runs.filter((r) => r.in.inWork).length, n),
    top1ExactPct: pct(runs.filter((r) => r.in.exact).length, n),
    falseMatchPct: pct(s.falseMatch, n),
    inScoreMedian: quantile(
      runs.map((r) => r.in.score),
      0.5,
    ),
    inMarginP10: quantile(inMargins, 0.1),
    inMarginMedian: quantile(inMargins, 0.5),
    inMarginP90: quantile(inMargins, 0.9),
    outScoreMedian: quantile(outScores, 0.5),
    outScoreP99: quantile(outScores, 0.99),
    outScoreMax: quantile(outScores, 1),
  };
}
function grid(runs) {
  const view = runs.map((r) => ({
    in: { ...asResult(r.in), inWork: r.in.inWork },
    out: asResult(r.out),
  }));
  const rows = [];
  for (const minScore of GRID_SCORE) {
    for (const minMargin of GRID_MARGIN) {
      const s = summarise(view, { minScore, minMargin });
      rows.push({
        minScore,
        minMargin,
        hitPct: pct(s.hit, runs.length),
        falseMatchPct: pct(s.falseMatch, runs.length),
      });
    }
  }
  return rows;
}

const basename = (p) => String(p).split(/[\\/]/).pop();

export async function measure({ repo = REPO, cameraFusion, acceptance, log = console.log } = {}) {
  const E = await import(pathToFileURL(resolve(repo, 'packages/engine/dist/src/index.js')).href);
  const t0 = Date.now();
  const library = loadLibrary(repo, E);
  const index = buildIndex(library);
  const bySlug = new Map(library.map((e) => [e.slug, e]));
  log(
    `index: ${index.slugs.length} pieces (${library.failed} unparsed), ${index.postings.size} shingles, ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  );
  const titleOf = (slug) => index.titles[index.slugs.indexOf(slug)] ?? slug;
  const INV13 = 'bach-invention-no13-bwv-784';
  const corpus = JSON.parse(
    readFileSync(join(REPO, 'research/omr/acceptance/corpus.json'), 'utf8'),
  );
  const report = {
    library: {
      pieces: index.slugs.length,
      unparsed: library.failed,
      shingles: index.postings.size,
    },
  };

  // A. owner pages
  report.owner = [1, 2, 3].map((n) => {
    const score = E.parseMusicXml(
      new Uint8Array(readFileSync(join(repo, `apps/web/fixtures/scan/owner-page-${n}.musicxml`))),
    ).score;
    const r = matchScore(index, score);
    const ti = index.slugs.indexOf(INV13);
    const work = workOf(index, ti);
    const other = matchScore(index, score, { exclude: work });
    return {
      page: n,
      shingles: r.shingles,
      best: r.best?.slug,
      score: r.best?.score,
      margin: r.margin,
      bestOther: other.best?.score ?? 0,
      accepted: accepts(r),
    };
  });

  // B. camera fusion
  if (cameraFusion) {
    const runs = [];
    const dir = resolve(cameraFusion);
    for (const name of [0, 1, 2, 3]) {
      const file = join(dir, `jobs-${name}.json`);
      if (!existsSync(file)) continue;
      for (const job of JSON.parse(readFileSync(file, 'utf8'))) {
        const [severity, slug] = String(job.id).split(':');
        let run;
        try {
          if (!index.slugs.includes(slug)) throw new Error('unknown piece');
          const bytes = readFileSync(join(dir, 'cache', basename(job.output)));
          const score = E.parseMusicXml(new Uint8Array(bytes)).score;
          run = runQuery(index, pitchSequences(score), slug);
        } catch {
          run = noMatch(slug);
        }
        runs.push({ ...run, severity, id: job.id });
      }
    }
    const severities = [...new Set(runs.map((r) => r.severity))];
    report.cameraFusion = {
      all: stats(runs),
      bySeverity: Object.fromEntries(
        severities.map((s) => [s, stats(runs.filter((r) => r.severity === s))]),
      ),
      grid: grid(runs),
      raw: runs,
    };
  }

  // B2. acceptance recognitions: the corpus pieces, each recogniser and variant. The job file is
  // untrusted data: only the base name of an output is read, from the cache beside it.
  if (acceptance) {
    const runs = [];
    const dir = resolve(acceptance);
    const jobs = JSON.parse(readFileSync(join(dir, 'jobs.json'), 'utf8'));
    let outside = 0;
    for (const job of jobs) {
      const [slug, recognizer, variant] = String(job.id).split(':');
      if (!corpus.slugs.includes(slug)) {
        outside++;
        continue;
      }
      let run;
      try {
        if (!index.slugs.includes(slug)) throw new Error('unknown piece');
        const bytes = readFileSync(join(dir, 'cache', basename(job.output)));
        const score = E.parseMusicXml(new Uint8Array(bytes)).score;
        run = runQuery(index, pitchSequences(score), slug);
      } catch {
        run = noMatch(slug);
      }
      runs.push({ ...run, recognizer, variant, id: job.id });
    }
    const group = (key) =>
      Object.fromEntries(
        [...new Set(runs.map(key))].map((k) => [k, stats(runs.filter((r) => key(r) === k))]),
      );
    report.acceptance = {
      pieces: new Set(runs.map((r) => r.truth)).size,
      outsideCorpus: outside,
      all: stats(runs),
      byRecognizer: group((r) => r.recognizer),
      byVariant: group((r) => `${r.recognizer} ${r.variant}`),
      raw: runs,
    };
  }

  // C. injected
  const manifest = JSON.parse(readFileSync(join(repo, 'content/manifest.json'), 'utf8'));
  const queryPieces = [
    ...new Set([...corpus.slugs, ...manifest.filter((_, i) => i % 25 === 0).map((p) => p.slug)]),
  ].filter((s) => bySlug.has(s));
  let dropped = 0;
  let pageCount = 0;
  const pages = [];
  for (const slug of queryPieces) {
    for (const page of cutPages(bySlug.get(slug).sequences, PAGE_MEASURES)) {
      if (shingles(page).size < MIN_SHINGLES) dropped++;
      else pages.push({ slug, page });
    }
  }
  pageCount = pages.length;
  const byRate = {};
  const pairs = new Map();
  const falsePairs = [];
  for (const rate of RATES) {
    const rng = mulberry32(SEED);
    const runs = pages.map(({ slug, page }) => {
      const run = runQuery(index, rate ? corruptSequences(page, rate, rng) : page, slug);
      if (run.in.best && run.in.best !== slug && run.in.inWork) {
        const key = `${slug} -> ${run.in.best}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
      if (accepts(asResult(run.out)))
        falsePairs.push({
          rate,
          truth: slug,
          best: run.out.best,
          score: run.out.score,
          margin: run.out.margin,
        });
      return run;
    });
    byRate[rate] = { ...stats(runs), grid05: rate === 0.05 ? grid(runs) : undefined };
  }
  report.injected = {
    queryPieces: queryPieces.length,
    pages: pageCount,
    droppedPages: dropped,
    pageMeasures: PAGE_MEASURES,
    byRate,
  };
  report.injectedGrid = byRate[0.05].grid05;
  report.duplicatePairs = [...pairs.entries()]
    .map(([pair, count]) => ({ pair, count }))
    .sort((a, b) => b.count - a.count);
  report.falseMatches = falsePairs
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((f) => ({ ...f, truthTitle: titleOf(f.truth), bestTitle: titleOf(f.best) }));
  const grouped = new Map();
  for (const x of falsePairs) {
    const key = `${x.truth} -> ${x.best}`;
    const g = grouped.get(key) ?? { ...x, count: 0 };
    g.count++;
    if (x.score > g.score) Object.assign(g, { score: x.score, margin: x.margin, rate: x.rate });
    grouped.set(key, g);
  }
  report.falseMatchPairs = [...grouped.values()]
    .sort((a, b) => b.count - a.count || b.score - a.score)
    .map((g) => ({ ...g, truthTitle: titleOf(g.truth), bestTitle: titleOf(g.best) }));
  report.seconds = (Date.now() - t0) / 1000;
  return report;
}

const f = (v, d = 1) => (v == null ? '-' : v.toFixed(d));

function printTables(report) {
  const row = (label, s) =>
    `${label.padEnd(18)} n=${String(s.n).padStart(5)} hit ${f(s.hitPct)}%  wrong ${f(s.wrongPct)}%  rejected ${f(s.rejectedPct)}%  top1-exact ${f(s.top1ExactPct)}%  false ${f(s.falseMatchPct)}%  in-margin p10/med/p90 ${f(s.inMarginP10, 3)}/${f(s.inMarginMedian, 3)}/${f(s.inMarginP90, 3)}  out-score med/p99/max ${f(s.outScoreMedian, 3)}/${f(s.outScoreP99, 3)}/${f(s.outScoreMax, 3)}`;
  console.log('\nOwner pages');
  for (const o of report.owner)
    console.log(
      `page ${o.page}: ${o.best} score ${f(o.score, 3)} margin ${f(o.margin, 3)} best other ${f(o.bestOther, 3)} shingles ${o.shingles}`,
    );
  if (report.cameraFusion) {
    console.log('\nCamera fusion');
    console.log(row('all', report.cameraFusion.all));
    for (const [s, v] of Object.entries(report.cameraFusion.bySeverity)) console.log(row(s, v));
    console.log('grid', JSON.stringify(report.cameraFusion.grid));
  }
  if (report.acceptance) {
    const a = report.acceptance;
    console.log(
      `\nAcceptance recognitions (${a.pieces} pieces, ${a.outsideCorpus} jobs outside the corpus skipped)`,
    );
    console.log(row('all', a.all));
    for (const [k, v] of Object.entries(a.byRecognizer)) console.log(row(k, v));
    for (const [k, v] of Object.entries(a.byVariant)) console.log(row(k, v));
  }
  console.log(
    `\nInjected: ${report.injected.queryPieces} pieces, ${report.injected.pages} pages (${report.injected.droppedPages} dropped)`,
  );
  for (const [rate, s] of Object.entries(report.injected.byRate))
    console.log(row(`rate ${rate}`, s));
  console.log('grid (rate 0.05)', JSON.stringify(report.injectedGrid));
  console.log('\nDuplicate pairs');
  for (const d of report.duplicatePairs.slice(0, 30)) console.log(`${d.count}  ${d.pair}`);
  console.log('\nOut-run false matches by pair (count over all rates)');
  for (const x of report.falseMatchPairs)
    console.log(`${x.count}  ${x.truth} -> ${x.best} max score ${f(x.score, 3)}`);
  console.log('\nHighest out-run false matches');
  for (const x of report.falseMatches)
    console.log(
      `rate ${x.rate} ${x.truth} (${x.truthTitle}) -> ${x.best} (${x.bestTitle}) score ${f(x.score, 3)} margin ${f(x.margin, 3)}`,
    );
}

export async function main(args) {
  try {
    const { values } = parseArgs({
      args,
      options: {
        'camera-fusion': { type: 'string' },
        acceptance: { type: 'string' },
        out: { type: 'string' },
        help: { type: 'boolean' },
      },
    });
    if (values.help) {
      console.log(
        'node research/omr/piece-match.mjs [--camera-fusion DIR] [--acceptance DIR] [--out research/omr/results/piece-match/latest.json]',
      );
      return 0;
    }
    const report = await measure({
      cameraFusion: values['camera-fusion'],
      acceptance: values.acceptance,
    });
    printTables(report);
    const target = resolve(
      values.out ?? join(REPO, 'research/omr/results/piece-match/latest.json'),
    );
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nwritten ${target}`);
    return 0;
  } catch (error) {
    console.error(`piece match: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await main(process.argv.slice(2));
