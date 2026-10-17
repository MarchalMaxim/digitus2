# oemer in the browser

Research prototype that runs [oemer](https://github.com/BreezeWhite/oemer) entirely in the browser: both ONNX segmentation models in ONNX Runtime Web (one WASM thread, no cross-origin isolation) and oemer's unchanged Python reconstruction in Pyodide. A native runner serves as the comparison. Not used by the product.

Result: on the clean Twinkle page the browser output matches native exactly (identical label maps and score), but the run takes 21 minutes on a desktop CPU. Native strict full-note F1 is 88.37% (Twinkle), 88.73% (Bach) and 0.59% (Chopin), and oemer exports no meter or beams. Details: [docs/research/omr.md](../../../../docs/research/omr.md).

## Run

From the repository root, with Python 3.11, pnpm dependencies and Playwright Chromium:

```powershell
pnpm --filter @digitus2/engine build
node research/omr/prepare.mjs --out research/omr/results/fixtures-final     # skip if the corpus exists; it refuses to overwrite
powershell -NoProfile -File research/omr/prototypes/oemer/setup.ps1
node research/omr/results/local-options/check-model-shapes.mjs
node research/omr/results/local-options/run-browser-full.mjs NEW-RUN-ID
node research/omr/results/local-options/run-browser-full.mjs NEW-CANCEL-ID --cancel-smoke
node research/omr/prototypes/oemer/check-static-server.mjs
```

`setup.ps1` downloads oemer at commit `dbe2a933`, its two release checkpoints (109.2 MB) and ONNX Runtime Web 1.22.0 into the ignored `research/omr/results/local-options/`, checking every hash. It copies the runners there and creates an isolated venv from `requirements.txt`. It also converts oemer's pickled SVC classifiers to safe NPZ/JSON, so the browser never loads pickle. Nothing is installed system-wide. The browser fetches Pyodide 0.26.4 from its public CDN; the local server allows only those GETs and the experiment's own assets, and cancelling terminates the worker. The browser runner has a 30-minute limit and closes its browser and server.

Native comparison and label parity:

```powershell
research/omr/results/local-options/.venv/Scripts/python.exe research/omr/results/local-options/run-oemer-native.py twinkle-twinkle-little-star
research/omr/results/local-options/.venv/Scripts/python.exe research/omr/prototypes/oemer/compare-label-parity.py NATIVE.pkl NATIVE.png BROWSER-RUN.json
node research/omr/results/local-options/render-output.mjs OUTPUT.musicxml
```

The other fixture ids are `bach-minuet-g-major-bwv-anh-114` and `chopin-prelude-op28-no7`. The native runner overwrites its previous XML. It also reuses a cached prediction without checking that it belongs to the fixture, which turns the call into reconstruction only. Use a fresh directory for a fresh native run. Score outputs with `research/omr/evaluate.mjs` against the fixture manifest, never against recognition output.
