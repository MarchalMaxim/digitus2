import { serve } from './server.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const require = createRequire(resolve('apps/web/package.json'));
const { chromium } = require('@playwright/test');
const server = await serve();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { console: [], errors: [] };
try {
  const page = await browser.newPage();
  page.on('console', (m) => report.console.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => report.errors.push(String(e)));
  await page.goto('http://127.0.0.1:8995/');
  report.results = await page.evaluate(async () => {
    const ort = await import('/ort/ort.webgpu.min.mjs');
    ort.env.wasm.wasmPaths = '/ort/';
    ort.env.wasm.numThreads = 1;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    ort.env.webgpu.adapter = adapter;
    const adapterInfo = Object.fromEntries(
      ['vendor', 'architecture', 'device', 'description'].map((k) => [k, adapter.info[k]]),
    );
    const bitmap = await createImageBitmap(await (await fetch('/input.png')).blob());
    const canvas = new OffscreenCanvas(1612, 2280);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, 1612, 2280);
    const results = [];
    for (const model of [1, 2]) {
      const size = model === 1 ? 256 : 288;
      const pixels = ctx.getImageData(128, 128, size, size).data;
      const input = new Uint8Array(size * size * 3);
      for (let i = 0, j = 0; i < pixels.length; i += 4) {
        input[j++] = pixels[i + 2];
        input[j++] = pixels[i + 1];
        input[j++] = pixels[i];
      }
      const outputs = {};
      const timing = {};
      for (const backend of ['wasm', 'webgpu']) {
        const t = performance.now();
        const session = await ort.InferenceSession.create('/model' + model + '.onnx', {
          executionProviders: [backend],
        });
        const loadMs = performance.now() - t;
        const begin = performance.now();
        const output = await session.run({
          [session.inputNames[0]]: new ort.Tensor('uint8', input, [1, size, size, 3]),
        });
        const tensor = output[session.outputNames[0]];
        outputs[backend] = new Float32Array(tensor.data);
        timing[backend] = { loadMs, inferenceMs: performance.now() - begin, dims: tensor.dims };
        if (backend === 'webgpu') {
          const warm = performance.now();
          await session.run({
            [session.inputNames[0]]: new ort.Tensor('uint8', input, [1, size, size, 3]),
          });
          timing[backend].warmMs = performance.now() - warm;
        }
        await session.release();
      }
      const classes = model === 1 ? 3 : 4;
      let maxAbs = 0,
        changed = 0,
        finite = true;
      for (let i = 0; i < outputs.wasm.length; i++) {
        maxAbs = Math.max(maxAbs, Math.abs(outputs.wasm[i] - outputs.webgpu[i]));
        finite &&= Number.isFinite(outputs.webgpu[i]);
      }
      for (let i = 0; i < outputs.wasm.length; i += classes) {
        let a = 0,
          b = 0;
        for (let c = 1; c < classes; c++) {
          if (outputs.wasm[i + c] > outputs.wasm[i + a]) a = c;
          if (outputs.webgpu[i + c] > outputs.webgpu[i + b]) b = c;
        }
        if (a !== b) changed++;
      }
      results.push({
        model,
        size,
        timing,
        maxAbs,
        argmaxChanged: changed,
        pixels: size * size,
        finite,
      });
    }
    return { adapterInfo, results };
  });
} catch (e) {
  report.errors.push(String(e));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
  writeFileSync(
    'research/omr/results/performance-wave/tensor-control.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
