// THROWAWAY spike: headless Playwright measurement driver.
//   node scripts/measure.mjs [base=http://localhost:4317] [only=osmd,verovio,...]
// For each bench page: open it with ?auto=1, wait for window.__bench, record results JSON
// (results/<name>.json), network bytes (per host / per content type) and a screenshot of the
// interactive variant (screenshots/<name>.png). Run against `pnpm preview` (production build) for
// the numbers in the report, or against `pnpm dev` while iterating.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] ?? 'http://localhost:4317';
const only = process.argv[3]?.split(',');
const RUNS = process.env.RUNS ?? '5';
// CPU_THROTTLE=4 emulates a mid-range phone via CDP (Emulation.setCPUThrottlingRate); results get an @cpu4x suffix
const THROTTLE = Number(process.env.CPU_THROTTLE ?? 1);
const SUFFIX = THROTTLE > 1 ? `@cpu${THROTTLE}x` : '';
mkdirSync(join(here, '..', 'results'), { recursive: true });
mkdirSync(join(here, '..', 'screenshots'), { recursive: true });

const PLAYERS = ['smplr-sequencer-api', 'smplr-splendid', 'smplr-splendid-mf', 'smplr-soundfont', 'tonejs-piano', 'soundfont-player', 'soundfont-player-fluid', 'tone-sampler-selfhosted'];
const jobs = [
  { name: 'osmd', url: `/osmd.html?auto=1&runs=${RUNS}`, shots: [['osmd-short', '/osmd.html?fx=short&highlight=n10'], ['osmd-long', '/osmd.html?fx=long'], ['osmd-horizontal', '/osmd.html?fx=short&mode=horizontal'], ['osmd-mobile', '/osmd.html?fx=short&width=360']] },
  { name: 'verovio', url: `/verovio.html?auto=1&runs=${RUNS}`, shots: [['verovio-short', '/verovio.html?fx=short&highlight=n10&hlfing=1'], ['verovio-long', '/verovio.html?fx=long'], ['verovio-horizontal', '/verovio.html?fx=short&mode=horizontal'], ['verovio-mobile', '/verovio.html?fx=short&width=360']] },
  { name: 'vexml', url: `/vexml.html?auto=1&runs=${RUNS}`, shots: [['vexml-short', '/vexml.html?fx=short&highlight=n10']] },
  { name: 'vexflow', url: `/vexflow.html?auto=1&runs=${RUNS}`, shots: [['vexflow-short', '/vexflow.html?fx=short&highlight=n10']] },
  { name: 'parsers', url: `/parsers.html?auto=1&runs=${RUNS}`, shots: [] },
  { name: 'midi', url: `/midi.html?auto=1`, shots: [] },
  { name: 'playback-osmd', url: `/playback.html?auto=1&renderer=osmd`, shots: [] },
  { name: 'playback', url: `/playback.html?auto=1`, shots: [['playback-sync', '/playback.html?auto=1&shot=1&seconds=3']] },
  ...PLAYERS.map((p) => ({ name: `player-${p}`, url: `/players.html?auto=1&player=${p}`, shots: [] })),
];

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const all = {};
for (const job of jobs) {
  if (only && !only.some((o) => job.name.startsWith(o))) continue;
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  if (THROTTLE > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); }
  const net = { bytes: 0, requests: 0, byHost: {}, byType: {}, failed: [] };
  const logs = [];
  page.on('console', (m) => { const t = m.text(); if (!t.startsWith('[vite]') && !t.includes('MIDI timemap failed')) logs.push(`[${m.type()}] ${t.slice(0, 500)}`); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  page.on('requestfailed', (r) => net.failed.push(r.url() + ' ' + (r.failure()?.errorText ?? '')));
  page.on('response', async (r) => {
    try {
      const url = new URL(r.url());
      if (url.pathname.endsWith('.html') || r.status() >= 300) return;
      let size = 0;
      const sizes = await r.request().sizes().catch(() => null);
      if (sizes) size = sizes.responseBodySize + sizes.responseHeadersSize;
      else { const b = await r.body().catch(() => null); size = b ? b.length : 0; }
      net.bytes += size; net.requests++;
      net.byHost[url.host] = (net.byHost[url.host] ?? 0) + size;
      const ct = (r.headers()['content-type'] ?? '?').split(';')[0];
      net.byType[ct] = (net.byType[ct] ?? 0) + size;
    } catch { /* ignore */ }
  });
  const t0 = Date.now();
  let bench;
  try {
    await page.goto(base + job.url);
    await page.waitForFunction(() => window.__bench && window.__bench.status !== 'running', null, { timeout: 180_000 });
    bench = await page.evaluate(() => window.__bench);
  } catch (e) { bench = { status: 'error', error: String(e) }; }
  const out = { job: job.name + SUFFIX, cpuThrottle: THROTTLE, url: job.url, base, wallMs: Date.now() - t0, status: bench.status, error: bench.error, results: bench.results, network: net, logs: logs.slice(0, 40) };
  all[job.name + SUFFIX] = out;
  writeFileSync(join(here, '..', 'results', job.name + SUFFIX + '.json'), JSON.stringify(out, null, 1));
  console.log(job.name, bench.status, `${(net.bytes / 1024).toFixed(0)} KiB over ${net.requests} req`, bench.error ? '\n  ' + String(bench.error).slice(0, 300) : '');
  for (const [shot, url] of THROTTLE > 1 ? [] : job.shots) {
    try {
      const p = await browser.newPage({ viewport: { width: url.includes('width=360') ? 400 : 1280, height: url.includes('width=360') ? 800 : 720 } });
      await p.goto(base + url);
      await p.waitForFunction(() => window.__bench && window.__bench.status !== 'running', null, { timeout: 60_000 });
      await p.waitForTimeout(300);
      await p.screenshot({ path: join(here, '..', 'screenshots', shot + '.png') });
      await p.close();
    } catch (e) { console.log('  screenshot failed', shot, String(e).slice(0, 200)); }
  }
  await page.close();
}
// merge into results/all*.json so partial runs (only=...) do not drop earlier jobs
const allFile = join(here, '..', 'results', `all${SUFFIX}.json`);
let prev = {};
try { prev = JSON.parse(readFileSync(allFile, 'utf8')); } catch { /* first run */ }
writeFileSync(allFile, JSON.stringify({ ...prev, ...all }, null, 1));
await browser.close();
