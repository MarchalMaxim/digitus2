const BASE = '/research/omr/results/local-options/';
function progress(stage, details = {}) {
  postMessage({ type: 'progress', stage, ...details });
}
self.onmessage = async ({ data }) => {
  const begun = performance.now();
  try {
    const { loadPyodide } =
      await import('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs');
    progress('Loading local processing runtime');
    const py = await loadPyodide();
    await py.loadPackage([
      'numpy',
      'scipy',
      'scikit-learn',
      'opencv-python',
      'matplotlib',
      'pillow',
      'typing-extensions',
    ]);
    py.FS.mkdirTree('/home/pyodide/oemer');
    py.FS.mkdirTree('/safe');
    py.FS.mkdirTree('/work');
    async function put(url, path) {
      const response = await fetch(url);
      if (!response.ok) throw Error('Missing runtime asset ' + url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      py.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
      py.FS.writeFile(path, bytes);
    }
    const tree = await (await fetch(BASE + 'oemer-tree.json')).json();
    for (const entry of tree.tree.filter(
      (x) => x.path.startsWith('oemer/') && x.path.endsWith('.py'),
    ))
      await put(BASE + 'source/' + entry.path, '/home/pyodide/' + entry.path);
    for (const name of ['clef', 'rests', 'rests_above8', 'sfn'])
      for (const ext of ['json', 'npz'])
        await put(BASE + 'safe-svc/' + name + '.' + ext, '/safe/' + name + '.' + ext);
    py.FS.writeFile('/work/input.png', new Uint8Array(data.bytes));
    await py.runPythonAsync(`import sys,os
os.environ['MPLBACKEND']='Agg'
sys.path.insert(0,'/home/pyodide')
import cv2,numpy as np
from PIL import Image
from oemer.inference import resize_image
image=np.array(resize_image(Image.fromarray(cv2.imread('/work/input.png')).convert('RGB')))
image_height,image_width=image.shape[:2]
open('/work/image.bin','wb').write(image.tobytes())`);
    const width = py.globals.get('image_width'),
      height = py.globals.get('image_height');
    const image = py.FS.readFile('/work/image.bin');
    const ort = await import(BASE + 'ort-web/package/dist/ort.webgpu.min.mjs');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = BASE + 'ort-web/package/dist/';
    ort.env.webgpu.adapter = await navigator.gpu.requestAdapter();
    if (!ort.env.webgpu.adapter) throw Error('No hardware WebGPU adapter');
    const adapterInfo = Object.fromEntries(
      ['vendor', 'architecture', 'device', 'description'].map((k) => [
        k,
        ort.env.webgpu.adapter.info[k],
      ]),
    );
    const preparationMs = performance.now() - begun;
    const modelRuns = [];
    for (const model of [
      {
        name: 'Staff and symbol detection',
        file: '1st_model.onnx',
        classes: 3,
        output: '/work/staff-labels.bin',
      },
      {
        name: 'Note and clef detection',
        file: 'source/oemer/checkpoints/seg_net/model.onnx',
        classes: 4,
        output: '/work/symbol-labels.bin',
      },
    ]) {
      progress(model.name);
      const loaded = performance.now();
      const session = await ort.InferenceSession.create(BASE + model.file, {
        executionProviders: [model.classes === 4 ? 'webgpu' : 'wasm'],
      });
      const loadMs = performance.now() - loaded;
      const inputMetadata = session.inputMetadata[0];
      const outputMetadata = session.outputMetadata[0];
      const windowSize = inputMetadata.shape[1];
      if (
        inputMetadata.type !== 'uint8' ||
        inputMetadata.shape.length !== 4 ||
        !Number.isInteger(windowSize) ||
        windowSize < 1 ||
        inputMetadata.shape[2] !== windowSize ||
        inputMetadata.shape[3] !== 3 ||
        outputMetadata.shape[1] !== windowSize ||
        outputMetadata.shape[2] !== windowSize ||
        outputMetadata.shape[3] !== model.classes
      )
        throw Error(
          'Unexpected model tensor metadata: ' + JSON.stringify({ inputMetadata, outputMetadata }),
        );
      const accum = new Float32Array(width * height * model.classes);
      const patch = new Uint8Array(windowSize * windowSize * 3);
      let completed = 0;
      const total = Math.ceil(height / 128) * Math.ceil(width / 128);
      const modelStart = performance.now();
      for (let rawY = 0; rawY < height; rawY += 128) {
        const y = Math.min(rawY, height - windowSize);
        for (let rawX = 0; rawX < width; rawX += 128) {
          const x = Math.min(rawX, width - windowSize);
          for (let row = 0; row < windowSize; row++)
            patch.set(
              image.subarray(((y + row) * width + x) * 3, ((y + row) * width + x + windowSize) * 3),
              row * windowSize * 3,
            );
          const output = await session.run({
            [session.inputNames[0]]: new ort.Tensor('uint8', patch, [1, windowSize, windowSize, 3]),
          });
          const tensor = output[session.outputNames[0]];
          if (
            tensor.dims.length !== 4 ||
            tensor.dims[0] !== 1 ||
            tensor.dims[1] !== windowSize ||
            tensor.dims[2] !== windowSize ||
            tensor.dims[3] !== model.classes
          )
            throw Error('Unexpected actual model output shape: ' + JSON.stringify(tensor.dims));
          const values = tensor.data;
          for (let row = 0; row < windowSize; row++) {
            let target = ((y + row) * width + x) * model.classes;
            let source = row * windowSize * model.classes;
            for (let col = 0; col < windowSize * model.classes; col++)
              accum[target + col] += values[source + col];
          }
          completed++;
          if (completed % 16 === 0 || completed === total)
            progress(model.name, { completed, total });
        }
      }
      // Every class has the same overlap count at a pixel, so averaging
      // changes no argmax. Patch order/clamped edges match upstream inference.py.
      const labels = new Uint8Array(width * height);
      const counts = new Array(model.classes).fill(0);
      for (let i = 0; i < labels.length; i++) {
        let best = 0;
        for (let c = 1; c < model.classes; c++)
          if (accum[i * model.classes + c] > accum[i * model.classes + best]) best = c;
        labels[i] = best;
        counts[best]++;
      }
      const labelDigest = await crypto.subtle.digest('SHA-256', labels);
      const labelSha256 = Array.from(new Uint8Array(labelDigest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      py.FS.writeFile(model.output, labels);
      await session.release();
      modelRuns.push({
        name: model.name,
        loadMs,
        inferenceMs: performance.now() - modelStart,
        patches: completed,
        inputMetadata,
        outputMetadata,
        classes: counts,
        labelSha256,
      });
      console.info('OMR model complete', JSON.stringify(modelRuns.at(-1)));
    }
    progress('Assembling MusicXML');
    const code = await (await fetch(BASE + 'reconstruct-browser-full.py')).text();
    await py.runPythonAsync(code);
    const result = {
      type: 'result',
      xml: py.FS.readFile('/work/result.musicxml', { encoding: 'utf8' }),
      crossOriginIsolated,
      backend: 'model1-wasm-model2-webgpu',
      adapterInfo,
      threads: 1,
      preparationMs,
      totalMs: performance.now() - begun,
      modelRuns,
      reconstructionSeconds: py.globals.get('browser_reconstruction_seconds'),
      scaled: [width, height],
      inputId: data.id,
      inputBytes: data.bytes.byteLength,
    };
    postMessage(result);
  } catch (error) {
    postMessage({
      type: 'error',
      message: String(error),
      stack: error.stack,
      elapsedMs: performance.now() - begun,
    });
  }
};
