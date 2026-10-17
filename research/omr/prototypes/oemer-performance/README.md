# oemer WebGPU experiments

Tries to speed up the browser oemer prototype (`../oemer/`) with ONNX Runtime Web's WebGPU provider, keeping the same models, preprocessing, patch order and reconstruction. Not used by the product.

Result: model 1 on the GPU changes 1,910 of 65,536 argmax pixels on a patch and is rejected. Model 2 matches the CPU output and runs five to seven times faster per patch. The proposed hybrid page (model 1 on WASM, model 2 on WebGPU) was never run end to end, so no whole-page speed-up is established. Details: [docs/research/omr.md](../../../../docs/research/omr.md).

## Run

Prepare the `../oemer/` assets first with its `setup.ps1`. Then, from the repository root, with installed Chrome, the repository's Node dependencies and Playwright:

```powershell
node research/omr/prototypes/oemer-performance/probe-gpu.mjs
node research/omr/prototypes/oemer-performance/control.mjs
node research/omr/prototypes/oemer-performance/control-expanded.mjs
node research/omr/prototypes/oemer-performance/run-full.mjs NEW-RUN-ID
node research/omr/prototypes/oemer-performance/run-full.mjs NEW-CANCEL-ID --cancel-smoke
```

Playwright's bundled headless Chromium has no hardware WebGPU (it reports SwiftShader), so these scripts use installed Chrome. The server binds localhost port 8995 and allows only the experiment assets and GETs of the pinned Pyodide runtime. Results go to the ignored `research/omr/results/performance-wave/`. The full runner refuses an existing run id. The probe and control scripts write fixed file names, so rename earlier outputs before repeating them. Before accepting a speed-up, check that the whole-page label hashes and the strict per-piece score match the baseline browser run.
