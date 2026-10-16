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
  await page.goto('http://127.0.0.1:8995/');
  report.results = await page.evaluate(async () => {
    const ort = await import('/ort/ort.webgpu.min.mjs');
    ort.env.wasm.wasmPaths = '/ort/';
    ort.env.wasm.numThreads = 1;
    ort.env.webgpu.adapter = await navigator.gpu.requestAdapter();
    const bitmap = await createImageBitmap(await (await fetch('/input.png')).blob());
    const canvas = new OffscreenCanvas(1612, 2280);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, 1612, 2280);
    const results = [];
    for (const model of [1, 2]) {
      const size = model === 1 ? 256 : 288,
        classes = model === 1 ? 3 : 4;
      const cpu = await ort.InferenceSession.create('/model' + model + '.onnx', {
        executionProviders: ['wasm'],
      });
      const gpu = await ort.InferenceSession.create('/model' + model + '.onnx', {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: model === 1 ? 'disabled' : 'all',
      });
      try {
        for (const [x, y] of [
          [0, 0],
          [512, 640],
          [1024, 1536],
        ]) {
          const pixels = ctx.getImageData(x, y, size, size).data,
            input = new Uint8Array(size * size * 3);
          for (let i = 0, j = 0; i < pixels.length; i += 4) {
            input[j++] = pixels[i + 2];
            input[j++] = pixels[i + 1];
            input[j++] = pixels[i];
          }
          const t = performance.now();
          const a = await cpu.run({
            [cpu.inputNames[0]]: new ort.Tensor('uint8', input, [1, size, size, 3]),
          });
          const cpuMs = performance.now() - t;
          const cpuValues = new Float32Array(a[cpu.outputNames[0]].data);
          const start = performance.now();
          const b = await gpu.run({
            [gpu.inputNames[0]]: new ort.Tensor('uint8', input, [1, size, size, 3]),
          });
          const gpuMs = performance.now() - start;
          const gpuValues = b[gpu.outputNames[0]].data;
          let maxAbs = 0,
            changed = 0,
            finite = true;
          for (let i = 0; i < cpuValues.length; i++) {
            maxAbs = Math.max(maxAbs, Math.abs(cpuValues[i] - gpuValues[i]));
            finite &&= Number.isFinite(gpuValues[i]);
          }
          for (let i = 0; i < cpuValues.length; i += classes) {
            let ca = 0,
              cb = 0;
            for (let c = 1; c < classes; c++) {
              if (cpuValues[i + c] > cpuValues[i + ca]) ca = c;
              if (gpuValues[i + c] > gpuValues[i + cb]) cb = c;
            }
            if (ca !== cb) changed++;
          }
          results.push({
            model,
            x,
            y,
            size,
            graphOptimizationLevel: model === 1 ? 'disabled' : 'all',
            cpuMs,
            gpuMs,
            maxAbs,
            argmaxChanged: changed,
            pixels: size * size,
            finite,
          });
        }
      } finally {
        await cpu.release();
        await gpu.release();
      }
    }
    return results;
  });
} catch (e) {
  report.errors.push(String(e));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
  writeFileSync(
    'research/omr/results/performance-wave/tensor-expanded.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
