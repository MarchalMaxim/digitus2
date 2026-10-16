# oemer local research prototype

Research only. No service receives a score. Current native clean-fixture strict structural/full-note F1 is 88.37% for Twinkle, 88.73% for Bach and 0.59% for Chopin. Bar alignment and whole-voice fingerprints compound structural errors; these are not literal notehead-detection accuracy percentages. See the [evidence report](../../../../docs/research/browser-omr-next-2026-10-15.md). Real whole-image browser Twinkle recognition completed in 21 min 08 s, with exact native label/per-piece-score parity and the same rhythm/timing errors. Product integration is not accepted.

From repository root, with Python 3.11, Node/pnpm dependencies and Playwright Chromium installed:

```powershell
pnpm --filter @digitus2/engine build
node research/omr/prepare.mjs --out research/omr/results/fixtures-final
powershell -NoProfile -File research/omr/prototypes/oemer/setup.ps1
node research/omr/results/local-options/check-model-shapes.mjs
node research/omr/results/local-options/run-browser-full.mjs
```

Fixture preparation refuses to overwrite an existing corpus; skip that command when the pinned fixture corpus already exists. Setup downloads official pinned MIT oemer source/checkpoints and ONNX Runtime Web into ignored `research/omr/results/local-options/`, checks source/model/package hashes, creates an isolated venv and converts inspected classifiers to safe NPZ/JSON. No Torch or system install. ONNX files total 109.2 MB; native Python dependencies, ORT Web and Pyodide packages are additional. Preserve upstream notices; wrapper files do not relicense upstream. Browser runtime uses pinned Pyodide 0.26.4 public static packages. Processing happens in a dedicated local worker; cold runtime downloads need internet.

The browser runner chooses the actual clean Twinkle PNG, executes both ONNX models in browser WASM, reconstructs MusicXML in browser WASM, and saves unmodified XML, timings, request audit and screenshot. It has a 30-minute timeout and closes its browser/server. Evidence filenames are retained; pass a new run ID for another call:

```powershell
node research/omr/results/local-options/run-browser-full.mjs independent-review
node research/omr/results/local-options/run-browser-full.mjs cancel-check --cancel-smoke
node research/omr/prototypes/oemer/check-static-server.mjs
```

The local server serves only required experiment assets. External requests are restricted to GETs of pinned public Pyodide runtime/package files. Cancellation terminates the worker. Raw results and large third-party assets remain ignored. Use the same pinned fixture corpus/reference MusicXML; do not derive expected notes from recognition output.

For native diagnosis:

```powershell
research/omr/results/local-options/.venv/Scripts/python.exe research/omr/results/local-options/run-oemer-native.py twinkle-twinkle-little-star
```

Other fixture IDs are `bach-minuet-g-major-bwv-anh-114` and `chopin-prelude-op28-no7`. Locally generated prediction caches make later native calls reconstruction-only. The native diagnostic runner overwrites its prior XML and native-ID JSON, and does not bind an existing cache to a fixture hash. Use a fresh experiment directory for independent native recognition, or archive prior outputs and explicitly remove only the known generated cache before fresh inference. Do not treat a cached reconstruction as fresh recognition. Preserve earlier logs and scorecards. The native runner uses restricted upstream SVC unpickling, four CPU ORT threads and clean-image deskew disabled. The browser never loads pickle. Third-party Python-to-WASM is allowed only for this research; the product TypeScript rule is not waived.

Meaningful validation is actual whole-image browser XML, strict `research/omr/evaluate.mjs` scoring, raw-output rendering, cancellation and network-boundary audit. Patch inference or reconstruction from native masks alone is not end-to-end recognition. No perfect-accuracy claim or calibrated confidence is supported.
