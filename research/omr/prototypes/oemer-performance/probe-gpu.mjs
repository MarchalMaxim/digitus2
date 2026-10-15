import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
const require = createRequire(resolve('apps/web/package.json'));
const { chromium } = require('@playwright/test');
const server = createServer((req, res) => res.end('<!doctype html><title>GPU probe</title>'));
await new Promise((r) => server.listen(8995, '127.0.0.1', r));
const results = [];
try {
  for (const [name, options] of [
    ['chromium-default', {}],
    ['chrome-headless', { channel: 'chrome' }],
    ['edge-headless', { channel: 'msedge' }],
    ['chromium-d3d11', { args: ['--use-angle=d3d11'] }],
  ]) {
    let browser;
    try {
      browser = await chromium.launch({ headless: true, ...options });
      const cdp = await browser.newBrowserCDPSession();
      const system = await cdp.send('SystemInfo.getInfo');
      const page = await browser.newPage();
      await page.goto('http://127.0.0.1:8995/');
      const gpu = await page.evaluate(async () => {
        const result = { secureContext: isSecureContext, available: !!navigator.gpu };
        if (!navigator.gpu) return result;
        for (const powerPreference of ['high-performance', 'low-power']) {
          const a = await navigator.gpu.requestAdapter({ powerPreference });
          result[powerPreference] = a
            ? {
                info: { ...a.info },
                features: [...a.features],
                limits: {
                  maxBufferSize: a.limits.maxBufferSize,
                  maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize,
                },
              }
            : null;
          if (a) {
            const d = await a.requestDevice();
            result[powerPreference].device = true;
            d.destroy();
          }
        }
        return result;
      });
      results.push({ name, version: browser.version(), gpu, system });
    } catch (e) {
      results.push({ name, error: String(e) });
    } finally {
      await browser?.close();
    }
  }
} finally {
  server.close();
}
writeFileSync(
  'research/omr/results/performance-wave/gpu-probe.json',
  JSON.stringify(results, null, 2),
);
console.log(
  JSON.stringify(
    results.map(({ name, gpu, error, system }) => ({
      name,
      gpu,
      error,
      devices: system?.gpu?.devices,
      featureStatus: system?.gpu?.featureStatus,
    })),
    null,
    2,
  ),
);
