import { serve as startStaticServer } from './server.mjs';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const require = createRequire(resolve('apps/web/package.json'));
const { chromium } = require('@playwright/test');
const runId = process.argv[2] ?? 'hybrid-twinkle';
if (!/^[a-z0-9-]+$/.test(runId)) throw Error('Invalid run id');
const cancelSmoke = process.argv.includes('--cancel-smoke');
if (
  ['json', 'musicxml', 'png'].some((ext) =>
    existsSync('research/omr/results/performance-wave/' + runId + '.' + ext),
  )
)
  throw Error('Choose a new run id; outputs are retained');
const out = 'research/omr/results/performance-wave';
const server = await startStaticServer(8995);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const cdp = await browser.newBrowserCDPSession();
const memorySamples = [];
let sampling = false;
const memoryTimer = setInterval(async () => {
  if (sampling) return;
  sampling = true;
  try {
    const info = await cdp.send('SystemInfo.getProcessInfo');
    const ids = info.processInfo.map((p) => Number(p.id)).filter(Number.isSafeInteger);
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`,
      ],
      { windowsHide: true },
    );
    const rows = JSON.parse(stdout);
    memorySamples.push({ at: new Date().toISOString(), rows: Array.isArray(rows) ? rows : [rows] });
  } catch (error) {
    memorySamples.push({ error: String(error) });
  } finally {
    sampling = false;
  }
}, 5000);
const page = await browser.newPage();
const requests = [];
const blocked = [];
await page.context().route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  const local = url.startsWith('http://127.0.0.1:8995/');
  const runtime =
    request.method() === 'GET' && url.startsWith('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/');
  if (local || runtime) await route.continue();
  else {
    blocked.push({ method: request.method(), url });
    await route.abort('blockedbyclient');
  }
});
page.context().on('request', (r) => {
  if (!r.url().startsWith('http://127.0.0.1:8995/'))
    requests.push({ method: r.method(), url: r.url() });
});
page.on('console', (m) => console.log('browser:', m.text()));
try {
  await page.goto('http://127.0.0.1:8995/research/omr/prototypes/oemer-performance/index.html');
  await page
    .locator('#image')
    .setInputFiles(
      'research/omr/results/fixtures-final/twinkle-twinkle-little-star/page-001-clean.png',
    );
  await page.locator('#run').click();
  if (cancelSmoke) await page.locator('#cancel').click();
  await page.waitForFunction(() => window.omrOutcome !== null, {}, { timeout: 1800000 });
  const result = await page.evaluate(() => window.omrOutcome);
  if (result.type === 'result') {
    result.outputSha256 = createHash('sha256').update(result.xml).digest('hex');
    await writeFile(out + '/' + runId + '.musicxml', result.xml, { flag: 'wx' });
    delete result.xml;
  }
  await writeFile(
    out + '/' + runId + '.json',
    JSON.stringify(
      {
        ...result,
        prototypeSha256: Object.fromEntries(
          await Promise.all(
            ['oemer-worker.mjs', 'server.mjs', 'run-full.mjs'].map(async (name) => [
              name,
              createHash('sha256')
                .update(await readFile('research/omr/prototypes/oemer-performance/' + name))
                .digest('hex'),
            ]),
          ),
        ),
        inputSha256: createHash('sha256')
          .update(
            await readFile(
              'research/omr/results/fixtures-final/twinkle-twinkle-little-star/page-001-clean.png',
            ),
          )
          .digest('hex'),
        externalRequests: requests,
        blockedRequests: blocked,
        memorySamples,
        memoryLimitations:
          'Sampled process working sets are not dedicated GPU memory or a mobile-memory guarantee; shared pages may be counted more than once.',
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  await page.screenshot({ path: out + '/' + runId + '.png' });
  console.log(JSON.stringify(result, null, 2));
  if (result.type === 'error' || blocked.length || (cancelSmoke && result.type !== 'canceled'))
    process.exitCode = 1;
} finally {
  clearInterval(memoryTimer);
  await browser.close();
  server.close();
}
