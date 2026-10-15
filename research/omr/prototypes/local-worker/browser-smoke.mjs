import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const require = createRequire(resolve('apps/web/package.json'));
const { chromium, expect } = require('@playwright/test');
const runId = process.argv[2] ?? 'browser-smoke';
if (!/^[a-z0-9-]+$/.test(runId)) throw Error('Invalid run ID');
const out = resolve('research/omr/results/connector-wave', runId);
await mkdir(out);
const origin = 'https://marchalmaxim.github.io';
const endpoint = 'http://127.0.0.1:8996';
const report = { origin, endpoint, events: [], requests: [], errors: [] };
report.prototypeSha256 = Object.fromEntries(
  await Promise.all(
    ['worker.py', 'audiveris.py', 'client.mjs', 'browser-smoke.mjs'].map(async (name) => [
      name,
      createHash('sha256')
        .update(await readFile('research/omr/prototypes/local-worker/' + name))
        .digest('hex'),
    ]),
  ),
);
const workerArgs = [
  'research/omr/prototypes/local-worker/worker.py',
  '--root',
  out + '/jobs',
  '--short-staves',
];
const textIndex = process.argv.indexOf('--text-models');
if (textIndex >= 0) workerArgs.push('--text-models', process.argv[textIndex + 1]);
const worker = spawn('python', workerArgs, {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let workerLog = '';
worker.stdout.on('data', (data) => (workerLog += data));
worker.stderr.on('data', (data) => (workerLog += data));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
report.browserVersion = browser.version();
async function permission(page, setting) {
  const cdp = await page.context().newCDPSession(page);
  const { targetInfo } = await cdp.send('Target.getTargetInfo');
  await cdp.send('Browser.setPermission', {
    permission: { name: 'loopback-network' },
    setting,
    origin,
    browserContextId: targetInfo.browserContextId,
  });
  return page.evaluate(
    async () => (await navigator.permissions.query({ name: 'loopback-network' })).state,
  );
}
try {
  for (let i = 0; i < 200 && !workerLog.includes('listening'); i++)
    await new Promise((r) => setTimeout(r, 50));
  if (!workerLog.includes('listening')) throw Error('Worker not ready: ' + workerLog);
  const denied = await browser.newContext();
  const page = await denied.newPage();
  await page.goto(origin + '/digitus2/');
  const deniedState = await permission(page, 'denied');
  const deniedResult = await page.evaluate(async (endpoint) => {
    try {
      const r = await fetch(endpoint + '/v1/health', { targetAddressSpace: 'loopback' });
      return { unexpectedlyAllowed: true, status: r.status };
    } catch (error) {
      return { blocked: true, error: String(error) };
    }
  }, endpoint);
  report.denied = { permission: deniedState, ...deniedResult };
  expect(deniedState).toBe('denied');
  expect(deniedResult.blocked).toBe(true);
  await denied.close();
  const allowed = await browser.newContext();
  const active = await allowed.newPage();
  active.on('request', (r) => report.requests.push({ method: r.method(), url: r.url() }));
  active.on('console', (m) => report.events.push({ type: m.type(), message: m.text() }));
  active.on('requestfailed', (r) =>
    report.events.push({ type: 'requestfailed', url: r.url(), failure: r.failure() }),
  );
  active.on('pageerror', (e) => report.errors.push(String(e)));
  await active.goto(origin + '/digitus2/');
  const granted = await permission(active, 'granted');
  expect(granted).toBe('granted');
  const fixture = await readFile(
    'research/omr/results/fixtures-final/twinkle-twinkle-little-star/page-001-clean.png',
  );
  const result = await active.evaluate(
    async ({ endpoint, input, clientSource }) => {
      const fetch = (url, options = {}) =>
        globalThis.fetch(url, {
          targetAddressSpace: 'loopback',
          credentials: 'omit',
          mode: 'cors',
          ...options,
        });
      const moduleUrl = URL.createObjectURL(new Blob([clientSource], { type: 'text/javascript' }));
      const { createLocalWorkerClient } = await import(moduleUrl);
      URL.revokeObjectURL(moduleUrl);
      const client = createLocalWorkerClient(endpoint);
      const health = await client.health();
      const bytes = Uint8Array.from(atob(input), (c) => c.charCodeAt(0));
      const file = new Blob([bytes], { type: 'image/png' });
      const begin = performance.now();
      const submitted = await client.start(file);
      const states = [];
      const status = await client.wait(submitted.id, {
        onProgress(status) {
          if (states.at(-1) !== status.state) states.push(status.state);
        },
      });
      const rawResult = await client.result(submitted.id);
      const { xml } = rawResult;
      const elapsedMs = performance.now() - begin;
      const toCancel = await client.start(file);
      await new Promise((r) => setTimeout(r, 250));
      const cancelled = await client.cancel(toCancel.id);
      let cancelStatus;
      for (let i = 0; i < 100; i++) {
        cancelStatus = await client.status(toCancel.id);
        if (cancelStatus.state === 'cancelled') break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const canceledResultStatus = (await fetch(endpoint + '/v1/jobs/' + toCancel.id + '/result'))
        .status;
      return {
        healthStatus: health.httpStatus,
        health,
        submitStatus: submitted.httpStatus,
        submitted,
        states,
        status,
        resultStatus: rawResult.httpStatus,
        xml,
        elapsedMs,
        cancelSubmitStatus: toCancel.httpStatus,
        cancelled,
        cancelStatus,
        canceledResultStatus,
      };
    },
    {
      endpoint,
      input: fixture.toString('base64'),
      clientSource: await readFile('research/omr/prototypes/local-worker/client.mjs', 'utf8'),
    },
  );
  expect(result.healthStatus).toBe(200);
  expect(result.submitStatus).toBe(202);
  expect(result.status.state).toBe('ready');
  expect(result.status.needsReview).toBe(true);
  expect(result.resultStatus).toBe(200);
  expect(result.xml).toContain('<score-partwise');
  expect(result.cancelStatus.state).toBe('cancelled');
  expect(result.canceledResultStatus).toBe(409);
  await writeFile(out + '/twinkle-twinkle-little-star.musicxml', result.xml, { flag: 'wx' });
  await active.locator('input[type="file"]').setInputFiles({
    name: 'recognized-twinkle.musicxml',
    mimeType: 'application/vnd.recordare.musicxml+xml',
    buffer: Buffer.from(result.xml),
  });
  await expect(active.locator('.score-sheet svg').first()).toBeVisible({ timeout: 30000 });
  await expect(active.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 30000 });
  await expect(active.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  report.importedFingerings = await active.locator('.score-sheet g.fing').count();
  report.outputSha256 = createHash('sha256').update(result.xml).digest('hex');
  delete result.xml;
  report.allowed = { permission: granted, ...result };
  await active.screenshot({ path: out + '/deployed-origin.png' });
  await allowed.close();
  expect(report.errors).toEqual([]);
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  await browser.close();
  // Server termination here follows completed/cancelled jobs; never leave a listener behind.
  if (worker.exitCode === null) {
    if (process.platform === 'win32')
      await promisify(execFile)('taskkill.exe', ['/PID', String(worker.pid), '/T', '/F'], {
        windowsHide: true,
      }).catch(() => {});
    else worker.kill();
  }
  await new Promise((r) => (worker.exitCode !== null ? r() : worker.once('exit', r)));
  await writeFile(out + '/worker.log', workerLog);
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
