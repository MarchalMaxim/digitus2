import { startStaticServer } from './static-server.mjs';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(resolve('apps/web/package.json'));
const { chromium } = require('@playwright/test');
const out = 'research/omr/results/local-options';
const runId = process.argv[2] ?? 'browser-model-shapes';
if (!/^[a-z0-9-]+$/.test(runId) || existsSync(out + '/' + runId + '.json'))
  throw Error('Choose a new valid output id; shape-control evidence is retained');
const server = await startStaticServer(process.cwd(), 8994);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8994/' + out + '/index.html');
  const bytes = Array.from(
    await readFile(
      'research/omr/results/fixtures-final/twinkle-twinkle-little-star/page-001-clean.png',
    ),
  );
  const result = await page.evaluate(
    async ({ out, bytes }) => {
      const ort = await import('/' + out + '/ort-web/package/dist/ort.wasm.min.mjs');
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = '/' + out + '/ort-web/package/dist/';
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
      const scale = Math.sqrt(3675000 / (image.width * image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const results = [];
      for (const file of ['1st_model.onnx', 'source/oemer/checkpoints/seg_net/model.onnx']) {
        const start = performance.now();
        const session = await ort.InferenceSession.create('/' + out + '/' + file, {
          executionProviders: ['wasm'],
        });
        const loadMs = performance.now() - start;
        const inputMetadata = session.inputMetadata[0],
          outputMetadata = session.outputMetadata[0],
          size = inputMetadata.shape[1];
        const pixels = ctx.getImageData(128, 128, size, size).data,
          bgr = new Uint8Array(size * size * 3);
        for (let i = 0, j = 0; i < pixels.length; i += 4) {
          bgr[j++] = pixels[i + 2];
          bgr[j++] = pixels[i + 1];
          bgr[j++] = pixels[i];
        }
        const begun = performance.now(),
          output = await session.run({
            [session.inputNames[0]]: new ort.Tensor('uint8', bgr, [1, size, size, 3]),
          });
        const value = output[session.outputNames[0]],
          classes = outputMetadata.shape[3],
          counts = new Array(classes).fill(0);
        for (let i = 0; i < value.data.length; i += classes) {
          let best = 0;
          for (let c = 1; c < classes; c++) if (value.data[i + c] > value.data[i + best]) best = c;
          counts[best]++;
        }
        results.push({
          file,
          loadMs,
          inferenceMs: performance.now() - begun,
          inputMetadata,
          outputMetadata,
          actualOutput: value.dims,
          classes: counts,
          finite: value.data.every(Number.isFinite),
        });
        await session.release();
      }
      return results;
    },
    { out, bytes },
  );
  await writeFile(out + '/' + runId + '.json', JSON.stringify(result, null, 2), {
    flag: 'wx',
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  server.close();
}
