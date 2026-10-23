/* global process, console, fetch, document, window, setTimeout, NodeFilter */
// Renderer memory of long pieces, the method of docs/research/ram-usage.md: a production build in
// Playwright's Chromium (new headless) on Windows, 1280 x 900, each piece opened by its address in
// a fresh browser. Prints one JSON object per piece and run, then the medians.
//
//   node scripts/measure-ram.mjs --dist dist --port 4301 --runs 3 [--rounds 4] [--slugs a,b]
//                                [--label before]
//
// Per run: the peak while the piece opens (sampled every 250 ms), then 6 s and 40 s after the score
// shows, then after a forced GC. Each reading is the renderer's private memory (Windows
// `Get-Process`), the JS heap (`Runtime.getHeapUsage`), the DOM node count, the nodes of the live
// DOM that no tree reaches any more (`detachedNodes`: the DevTools node counter less a walk of the
// document) and the SVG elements detached from it (`detachedSvg`, `Runtime.queryObjects`), and the
// pages built. The leak oracle (`--rounds`, 2 by default) scrolls the piece to the bottom and back
// that many times, forcing garbage collections and reading after each round, and once more after
// 40 s idle.
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null))
    .filter(Boolean),
);
const dist = args.dist ?? 'dist';
const port = Number(args.port ?? 4301);
const runs = Number(args.runs ?? 3);
const label = args.label ?? dist;
const rounds = Number(args.rounds ?? 2);
const SLUGS = (
  args.slugs ??
  [
    'pdmx-scherzo-no-2-f-chopin-op-31-31793326',
    'pdmx-beethoven-symphony-no-9-1st-movement-pia-e89a8615',
    'pdmx-precure-piano-medley-8edcc4b6',
  ].join(',')
).split(',');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mb = (bytes) => Math.round(bytes / 1048576);

/** Private memory of each process id, in bytes, from Windows. */
function privateBytes(pids) {
  if (pids.length === 0) return [];
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `(Get-Process -Id ${pids.join(',')} | ForEach-Object { $_.PrivateMemorySize64 }) -join ','`,
    ],
    { encoding: 'utf8' },
  );
  return out.trim().split(',').map(Number);
}

async function rendererMb(browserCdp) {
  const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo');
  const pids = processInfo.filter((p) => p.type === 'renderer').map((p) => p.id);
  return mb(Math.max(...privateBytes(pids)));
}

/** The SVG elements that are not in the document, alive (after a GC: `queryObjects` forces one). */
async function detachedSvg(cdp) {
  const { result: proto } = await cdp.send('Runtime.evaluate', {
    expression: 'SVGElement.prototype',
  });
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.objectId });
  const { result } = await cdp.send('Runtime.callFunctionOn', {
    objectId: objects.objectId,
    // The array holds Element.prototype itself, whose `isConnected` throws.
    functionDeclaration: `function () {
      let n = 0;
      for (const e of this) {
        try {
          if (!e.isConnected) n++;
        } catch {
          // a prototype object
        }
      }
      return n;
    }`,
    returnByValue: true,
  });
  await cdp.send('Runtime.releaseObject', { objectId: objects.objectId });
  await cdp.send('Runtime.releaseObject', { objectId: proto.objectId });
  return result.value;
}

async function reading(page, cdp, browserCdp) {
  const heap = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters');
  const pages = await page.evaluate(() => {
    const slots = [...document.querySelectorAll('.score-sheet > svg')];
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
    let connected = 0;
    while (walker.nextNode()) connected++;
    return {
      built: slots.filter((s) => s.childElementCount > 0).length,
      pagesBuilt: slots.flatMap((s, i) => (s.childElementCount > 0 ? [i] : [])),
      total: slots.length,
      connected,
    };
  });
  return {
    rendererMb: await rendererMb(browserCdp),
    jsHeapMb: mb(heap.usedSize),
    nodes: dom.nodes,
    detachedNodes: dom.nodes - pages.connected,
    detachedSvg: await detachedSvg(cdp),
    ...pages,
  };
}

async function measure(slug) {
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const browserCdp = await browser.newBrowserCDPSession();
    const cdp = await context.newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    let peak = 0;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        try {
          peak = Math.max(peak, await rendererMb(browserCdp));
        } catch {
          // the process list changes while the page opens
        }
        await sleep(250);
      }
    })();
    await page.goto(`http://localhost:${port}/?audio=silent#/piece/${slug}`);
    // A locator, not `page.waitForSelector`: that returns an element handle, which the DevTools
    // console then holds, and with it the whole page the element is in once the page is torn
    // (3,658 nodes and 70 to 80 MB that looked like a leak).
    await page
      .locator('.score-sheet g.fing')
      .first()
      .waitFor({ state: 'attached', timeout: 120_000 });
    const shown = Date.now();
    await sleep(6000 - (Date.now() - shown));
    const at6 = await reading(page, cdp, browserCdp);
    sampling = false;
    await sampler;
    await sleep(40_000 - (Date.now() - shown));
    const at40 = await reading(page, cdp, browserCdp);
    await cdp.send('HeapProfiler.collectGarbage');
    await sleep(1000);
    const gc = await reading(page, cdp, browserCdp);
    // The leak oracle: down the whole piece a viewport at a time, back to the top, forced GCs
    // (a detached tree can need more than one pass to go), `rounds` times over to see whether it
    // plateaus, then idle for 40 s.
    const cycle = () =>
      page.evaluate(async () => {
        const step = window.innerHeight;
        let steps = 0;
        let maxBuilt = 0;
        for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
          window.scrollTo(0, y);
          steps++;
          await new Promise((r) => setTimeout(r, 300));
          maxBuilt = Math.max(
            maxBuilt,
            document.querySelectorAll('.score-sheet > svg:has(g.measure)').length,
          );
        }
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 1000));
        return { steps, maxBuilt, scrollHeight: document.documentElement.scrollHeight };
      });
    const settle = async () => {
      for (let i = 0; i < 3; i++) {
        await cdp.send('HeapProfiler.collectGarbage');
        await sleep(1000);
      }
      return reading(page, cdp, browserCdp);
    };
    const fresh = await settle();
    const afterRounds = [];
    let scroll;
    for (let round = 0; round < rounds; round++) {
      scroll = await cycle();
      afterRounds.push(await settle());
    }
    await sleep(40_000);
    const idle = await settle();
    return { slug, label, peakMb: peak, at6, at40, gc, fresh, scroll, afterRounds, idle };
  } finally {
    await browser.close();
  }
}

const preview = spawn(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'vite', 'preview', '--outDir', dist, '--port', String(port), '--strictPort'],
  { stdio: 'ignore', shell: process.platform === 'win32' },
);
try {
  for (let tries = 0; ; tries++) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) break;
    } catch {
      if (tries > 60) throw new Error('the preview server did not start');
    }
    await sleep(500);
  }
  const all = new Map();
  for (let run = 0; run < runs; run++) {
    for (const slug of SLUGS) {
      const result = await measure(slug);
      console.log(JSON.stringify({ run, ...result }));
      all.set(slug, [...(all.get(slug) ?? []), result]);
    }
  }
  for (const [slug, rs] of all) {
    const med = (pick) => median(rs.map(pick));
    console.log(
      JSON.stringify({
        median: slug,
        label,
        peakMb: med((r) => r.peakMb),
        at6Mb: med((r) => r.at6.rendererMb),
        at40Mb: med((r) => r.at40.rendererMb),
        gcMb: med((r) => r.gc.rendererMb),
        freshMb: med((r) => r.fresh.rendererMb),
        roundsMb: Array.from({ length: rounds }, (_, i) => med((r) => r.afterRounds[i].rendererMb)),
        idleMb: med((r) => r.idle.rendererMb),
        nodes40: med((r) => r.at40.nodes),
        nodesFresh: med((r) => r.fresh.nodes),
        nodesAfterRounds: Array.from({ length: rounds }, (_, i) =>
          med((r) => r.afterRounds[i].nodes),
        ),
        detachedNodesFresh: med((r) => r.fresh.detachedNodes),
        detachedNodesAfterRounds: Array.from({ length: rounds }, (_, i) =>
          med((r) => r.afterRounds[i].detachedNodes),
        ),
        detachedSvgFresh: med((r) => r.fresh.detachedSvg),
        detachedSvgAfterRounds: Array.from({ length: rounds }, (_, i) =>
          med((r) => r.afterRounds[i].detachedSvg),
        ),
        built40: med((r) => r.at40.built),
        total: med((r) => r.at40.total),
      }),
    );
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
