/* global process, console, fetch, document, window, setTimeout, performance, MutationObserver, requestAnimationFrame, PerformanceObserver */
// Re-measures the "Performance budget" numbers of docs/app.md: the library's largest contentful
// paint, the open path of Mozart K.545 (1st movement, 1,288 notes) and the relayout after a resize.
// A production build in Playwright's Chromium (new headless), service workers blocked,
// `?audio=silent`, a fresh browser context per run and condition. Prints one JSON line per run and
// measure, then a table of medians with min-max and the number of runs.
//
//   node scripts/measure-open.mjs --dist dist --port 4302 --runs 6 [--only lcp|open|resize]
//
// lcp     The library at 1280 x 900 and at 360 x 740 (mobile, touch): `largest-contentful-paint`
//         read once the piece rows show, the time `library-index.json` finished (resource timing)
//         and the pieces in that index (counted from the fetched JSON, never a constant).
// open    K.545 at 1280 x 900, three conditions, each in a fresh context (c follows b):
//           a  the piece's row clicked as soon as the library rendered,
//           b  the same after 3 s idle on the library,
//           c  "Back to the library", then the row again, in the same page.
//         Times are taken inside the page from the click (a capture-phase listener, armed just
//         before the row click) to the first animation frame or DOM change that shows the status
//         line (`.dock [role=status]` with text), the first score page (`.score-sheet svg`) and the first
//         digit (`.score-sheet g.fing`: the pages come with their digits; only the pages near the screen
//         are in the DOM, so `digitsTotal` then counts the whole piece by walking the sheet, 1,288
//         expected, after the timed milestones). The first open of a context includes the fetch of
//         `manifest.json`; its resource timing (start and end from the click, sizes) is reported.
//         A `window.Worker` wrapper timestamps every postMessage and every message received per
//         worker; for the engine worker and the Verovio worker, `*FirstReplyMs` is the time from
//         the first postMessage after the click to the first message back after it, an
//         approximation of the solve and of the layout (a worker that answers with a ready or
//         progress message before the result is read early; `verovioLastReplyBeforePageMs` is the
//         time from that first post to the last message before the first page shows).
// resize  After an open at 1280, the viewport goes to 360 x 740 and back, 5 resizes. Each is timed
//         from `setViewportSize` (the same machine clock in Node and the page, whole ms) to the
//         last DOM change in `.score-sheet` that is followed by 300 ms of quiet, so the settle wait
//         is not counted; `replacedMs` is to the moment the sheet's page svgs are swapped for the
//         new layout's (the sheet's own childList gains svgs; earlier changes are pages built). The viewport change itself is part of
//         the interval.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null))
    .filter(Boolean),
);
const dist = args.dist ?? 'dist';
const port = Number(args.port ?? 4302);
const runs = Number(args.runs ?? 6);
const only = args.only;
const SLUG = 'mozart-sonata-k545-mvt1';
const TIMEOUT = 30_000;
const BASE = `http://localhost:${port}`;
const URL_LIBRARY = `${BASE}/?audio=silent`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const round = (x) => (typeof x === 'number' ? Math.round(x * 10) / 10 : x);

// The row's accessible name, from the built-in library's entry (the row button of LibraryView).
const entry = JSON.parse(readFileSync('../../content/manifest.json', 'utf8')).find(
  (p) => p.slug === SLUG,
);
if (!entry) throw new Error(`no library piece ${SLUG}`);
const ROW_NAME = `Open ${entry.title} by ${entry.composer}`;
const SEARCH = entry.title.split(/[,(]/)[0].trim();

/** Installed in every page: LCP, the click clock, the milestones and the worker log. */
function initScript() {
  window.__lcp = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__lcp = e.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });

  window.__armed = false;
  window.__open = null;
  const check = (withDigits) => {
    const o = window.__open;
    if (!o || o.digits != null) return;
    const now = performance.now();
    if (o.status == null) {
      const s = document.querySelector('.dock [role="status"]');
      if (s && (s.textContent ?? '').trim()) o.status = now;
    }
    if (o.svg == null && document.querySelector('.score-sheet svg')) o.svg = now;
    if (withDigits && o.digits == null) {
      if (document.querySelector('.score-sheet g.fing')) o.digits = now;
    }
  };
  document.addEventListener(
    'click',
    () => {
      if (!window.__armed) return;
      window.__armed = false;
      window.__open = { t0: performance.now(), status: null, svg: null, digits: null };
    },
    true,
  );
  const frame = () => {
    check(true);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  new MutationObserver(() => check(false)).observe(document, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Every Worker: its script, the time of each postMessage and of each message received.
  window.__workers = [];
  const Orig = window.Worker;
  window.Worker = class extends Orig {
    constructor(url, opts) {
      super(url, opts);
      const log = { url: String(url), posts: [], msgs: [] };
      window.__workers.push(log);
      this.addEventListener('message', () => log.msgs.push(performance.now()));
      const post = Orig.prototype.postMessage;
      this.postMessage = (...a) => {
        log.posts.push(performance.now());
        return post.apply(this, a);
      };
    }
  };
}

const rowsOf = (page) => page.getByRole('button', { name: /^Open / });

async function newPage(browser, viewport, extra = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', ...extra });
  const page = await context.newPage();
  await page.addInitScript(initScript);
  return { context, page };
}

/** Waits for the library's first rows. */
async function libraryRows(page) {
  await rowsOf(page).first().waitFor({ state: 'visible', timeout: TIMEOUT });
}

async function resourceTiming(page, pattern, clickMark) {
  return page.evaluate(
    ([source, mark]) => {
      const re = new RegExp(source);
      const e = performance
        .getEntriesByType('resource')
        .filter((r) => re.test(r.name))
        .pop();
      if (!e) return null;
      return {
        name: e.name,
        startMs: e.startTime - mark,
        endMs: e.responseEnd - mark,
        transferSize: e.transferSize,
        decodedBodySize: e.decodedBodySize,
      };
    },
    [pattern, clickMark],
  );
}

async function measureLcp(browser, width, height, mobile) {
  const { context, page } = await newPage(
    browser,
    { width, height },
    mobile ? { isMobile: true, hasTouch: true } : {},
  );
  try {
    let pieces = null;
    page.on('response', async (res) => {
      if (/library-index.*\.json/.test(res.url())) {
        try {
          const json = await res.json();
          pieces = json.pieces.slug.length;
        } catch {
          // the body is gone
        }
      }
    });
    await page.goto(URL_LIBRARY, { waitUntil: 'load' });
    await libraryRows(page);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    await page.waitForFunction(() => window.__lcp > 0, null, { timeout: TIMEOUT });
    const lcp = await page.evaluate(() => window.__lcp);
    const index = await resourceTiming(page, 'library-index.*\\.json', 0);
    const rows = await rowsOf(page).count();
    return {
      measure: 'lcp',
      viewport: `${width}x${height}`,
      lcpMs: lcp,
      indexEndMs: index?.endMs ?? null,
      indexTransferKb: index ? index.transferSize / 1024 : null,
      indexPieces: pieces,
      rowsShown: rows,
    };
  } finally {
    await context.close();
  }
}

/** Clicks the K.545 row (searching first when it is not on screen), then waits for the digits. */
async function openPiece(page, sinceRows, withTotal = true) {
  const row = page.getByRole('button', { name: ROW_NAME, exact: true });
  if ((await row.count()) === 0) {
    await page.getByRole('searchbox').fill(SEARCH);
    await row.waitFor({ state: 'visible', timeout: TIMEOUT });
  }
  if (sinceRows != null) await sleep(Math.max(0, sinceRows - Date.now()));
  await page.evaluate(() => {
    window.__armed = true;
  });
  await row.click();
  try {
    await page.waitForFunction(() => window.__open?.digits != null, null, {
      timeout: TIMEOUT,
      polling: 50,
    });
  } catch (error) {
    const state = await page.evaluate(() => ({
      open: window.__open,
      fing: document.querySelectorAll('.score-sheet g.fing').length,
      alert: document.querySelector('[role="alert"]')?.textContent ?? null,
      status: document.querySelector('[role="status"]')?.textContent ?? null,
    }));
    throw new Error(`K.545 did not open: ${JSON.stringify(state)}`, { cause: error });
  }
  const state = await page.evaluate(() => ({ open: window.__open, workers: window.__workers }));
  if (withTotal) {
    // A long piece keeps only the pages near the screen in the DOM (issue 99), so every digit is
    // counted by walking the sheet, as e2e/helpers/sheet.ts does, after the timed milestones.
    state.total = await page.evaluate(async () => {
      const slots = () => [...document.querySelectorAll('.score-sheet > svg')];
      const perPage = new Map();
      const from = window.scrollY;
      for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight * 1.5) {
        window.scrollTo({ top: y, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, 120));
        slots().forEach((el, i) => {
          if (el.childElementCount > 0) perPage.set(i, el.querySelectorAll('g.fing').length);
        });
      }
      window.scrollTo({ top: from, behavior: 'instant' });
      return [...perPage.values()].reduce((a, b) => a + b, 0);
    });
  }
  return state;
}

function workerReport(workers, t0, firstPageAt) {
  const pick = (re) => workers.find((w) => re.test(w.url));
  const one = (w) => {
    if (!w) return {};
    const post = w.posts.find((t) => t >= t0);
    if (post == null) return { posted: false };
    const reply = w.msgs.find((t) => t >= post);
    const before = w.msgs.filter((t) => t >= post && t <= firstPageAt).pop();
    return {
      postMs: post - t0,
      firstReplyMs: reply == null ? null : reply - post,
      lastReplyBeforePageMs: before == null ? null : before - post,
      messages: w.msgs.filter((t) => t >= post).length,
    };
  };
  const eng = one(pick(/engine/i));
  const ver = one(pick(/verovio/i));
  return {
    engineFirstReplyMs: eng.firstReplyMs ?? null,
    engineWorkerMessages: eng.messages ?? null,
    verovioPostMs: ver.postMs ?? null,
    verovioFirstReplyMs: ver.firstReplyMs ?? null,
    verovioLastReplyBeforePageMs: ver.lastReplyBeforePageMs ?? null,
    verovioWorkerMessages: ver.messages ?? null,
    workerUrls: workers.map((w) => w.url.replace(/^.*\//, '')),
  };
}

function summary(result, workers, manifestTiming) {
  const o = result.open;
  return {
    statusMs: o.status == null ? null : o.status - o.t0,
    firstPageMs: o.svg == null ? null : o.svg - o.t0,
    firstDigitsMs: o.digits - o.t0,
    digitsTotal: result.total,
    ...workerReport(workers, o.t0, o.svg ?? o.digits),
    ...(manifestTiming
      ? {
          manifestStartMs: manifestTiming.startMs,
          manifestEndMs: manifestTiming.endMs,
          manifestTransferKb: manifestTiming.transferSize / 1024,
          manifestDecodedKb: manifestTiming.decodedBodySize / 1024,
        }
      : { manifestFetched: false }),
  };
}

async function manifestTimingOf(page, t0) {
  return resourceTiming(page, '/manifest[^/]*\\.json', t0);
}

/** Conditions a and b share one function; c continues from b in the same page. */
async function measureOpen(browser, idleMs) {
  const { context, page } = await newPage(browser, { width: 1280, height: 900 });
  try {
    await page.goto(URL_LIBRARY, { waitUntil: 'load' });
    await libraryRows(page);
    const shownAt = Date.now();
    const first = await openPiece(page, idleMs ? shownAt + idleMs : null);
    const t0 = first.open.t0;
    const result = [
      {
        measure: idleMs ? 'open-after-idle' : 'open-right-after-library',
        ...summary(first, first.workers, await manifestTimingOf(page, t0)),
      },
    ];
    if (idleMs) {
      await page.getByRole('button', { name: 'Back to the library' }).click();
      await libraryRows(page);
      const again = await openPiece(page, null);
      // The workers' log keeps counting: only messages after this click are read.
      result.push({
        measure: 'open-again-same-page',
        ...summary(again, again.workers, null),
      });
    }
    return result;
  } finally {
    await context.close();
  }
}

async function measureResize(browser) {
  const { context, page } = await newPage(browser, { width: 1280, height: 900 });
  try {
    await page.goto(URL_LIBRARY, { waitUntil: 'load' });
    await libraryRows(page);
    await openPiece(page, Date.now() + 1500, false);
    await sleep(1500);
    const out = [];
    const sizes = [
      { width: 360, height: 740 },
      { width: 1280, height: 900 },
      { width: 360, height: 740 },
      { width: 1280, height: 900 },
      { width: 360, height: 740 },
    ];
    for (const size of sizes) {
      await page.evaluate(() => {
        const rs = { replaced: null, last: null };
        window.__rs = rs;
        const target = document.querySelector('.score-sheet');
        new MutationObserver((records) => {
          const now = Date.now();
          rs.last = now;
          // The new layout: the sheet's own children (the page svgs) are swapped.
          const swapped = records.some(
            (m) =>
              m.target === target &&
              [...m.addedNodes].some((n) => n.nodeName.toLowerCase() === 'svg'),
          );
          if (swapped) rs.replaced ??= now;
        }).observe(target, { childList: true, subtree: true });
      });
      const start = Date.now();
      await page.setViewportSize(size);
      const deadline = start + TIMEOUT;
      let rs;
      for (;;) {
        rs = await page.evaluate(() => window.__rs);
        if (rs.replaced != null && Date.now() - rs.last > 300) break;
        if (Date.now() > deadline) throw new Error(`no relayout after resize to ${size.width}`);
        await sleep(50);
      }
      out.push({
        measure: 'resize',
        to: `${size.width}x${size.height}`,
        replacedMs: rs.replaced - start,
        settledMs: rs.last - start,
      });
      await sleep(300);
    }
    return out;
  } finally {
    await context.close();
  }
}

const results = new Map();
function record(run, line) {
  const { measure, ...rest } = line;
  const key = [measure, rest.viewport ?? rest.to ?? ''].filter(Boolean).join(' ');
  console.log(
    JSON.stringify({
      run,
      key,
      ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, round(v)])),
    }),
  );
  const bucket = results.get(key) ?? {};
  for (const [k, v] of Object.entries(rest)) {
    if (typeof v === 'number') (bucket[k] ??= []).push(v);
  }
  bucket.__runs = (bucket.__runs ?? 0) + 1;
  results.set(key, bucket);
}

const preview = spawn(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'vite', 'preview', '--outDir', dist, '--port', String(port), '--strictPort'],
  { stdio: 'ignore', shell: process.platform === 'win32' },
);
try {
  for (let tries = 0; ; tries++) {
    try {
      if ((await fetch(`${BASE}/`)).ok) break;
    } catch {
      if (tries > 60) throw new Error('the preview server did not start');
    }
    await sleep(500);
  }
  for (let run = 0; run < runs; run++) {
    // `--no-proxy-server`: on Windows, new headless Chromium looks for a proxy before the first
    // request of every context, which holds the page's own request back 2 or 4 s and would be
    // counted in the LCP; a reader's browser has settled its proxy long before.
    const browser = await chromium.launch({
      channel: 'chromium',
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-proxy-server'],
    });
    try {
      if (!only || only === 'lcp') {
        record(run, await measureLcp(browser, 1280, 900, false));
        record(run, await measureLcp(browser, 360, 740, true));
      }
      if (!only || only === 'open') {
        for (const line of await measureOpen(browser, 0)) record(run, line);
        for (const line of await measureOpen(browser, 3000)) record(run, line);
      }
      if (!only || only === 'resize') {
        for (const line of await measureResize(browser)) record(run, line);
      }
    } finally {
      await browser.close();
    }
  }
  console.log('\nmedian (min-max), n runs');
  for (const [key, bucket] of results) {
    console.log(`\n${key}  (${bucket.__runs} runs)`);
    for (const [k, xs] of Object.entries(bucket)) {
      if (k === '__runs') continue;
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
      console.log(
        `  ${k.padEnd(30)} ${String(round(median(xs))).padStart(9)}  (${round(lo)} - ${round(hi)})  n=${xs.length}`,
      );
    }
  }
} finally {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(preview.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // already gone
    }
  } else preview.kill();
}
