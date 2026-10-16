# Browser-local OMR evidence — 2026-10-15

The practical reusable path is oemer's two ONNX segmentation models plus its reconstruction pipeline. Native recognition produced real MusicXML on all three clean licensed fixtures. A real whole-image browser experiment also completed: its Twinkle labels and strict per-piece score match native, but desktop CPU latency is 21 minutes. **Production integration is not accepted:** native rhythm, timing and bar-structure errors already fail the quality gate. No product code or scan UI was added.

The user's correction supersedes online-service exploration: download reusable code and execute within the application. No score was uploaded, no service/account/payment was created. Audiveris was only downloaded/extracted, never launched. Fingering remains local; the product TypeScript convention has not been waived.

## Recognition quality: completed native baseline

No recognized XML was manually corrected. Pinned oemer ran CPU ONNX Runtime 1.20.1 with four threads, clean-image deskew disabled. Images and references come from the existing pinned `research/omr/results/fixtures-final/manifest.json` corpus.

| Clean fixture  |                                         Native elapsed | Notes reference/recognized | Pitch within ordinal bar F1 | Onset+pitch F1 | Strict structural/full-note F1 | Bars reference/recognized | Absolute bar timing mismatches |
| -------------- | -----------------------------------------------------: | -------------------------: | --------------------------: | -------------: | -----------------------------: | ------------------------: | -----------------------------: |
| Twinkle        | 195.52 s inference; 4.00 s final cached reconstruction |                      64/65 |                      99.22% |         94.57% |                         88.37% |                     12/12 |                             12 |
| Bach minuet    |                                               208.44 s |                    204/204 |                      99.02% |         94.12% |                         88.73% |                     32/32 |                             25 |
| Chopin prelude |                                               200.17 s |                    168/173 |                      39.88% |         15.84% |                          0.59% |                     17/16 |                             16 |
| Corpus micro   |                                                      — |                    436/442 |                      76.08% |         63.78% |                         54.44% |                     61/60 |                             53 |

All three exports parse. Actual renders of all three raw outputs were inspected. Twinkle's printed metronome note becomes an extra musical event, making the first bar five beats and shifting subsequent absolute timing; some half notes become quarters. Bach remains recognizable but has rhythm, voice and rest errors. Chopin remains visibly related to the reference but loses a bar/pickup alignment and damages rhythm, time signature, beams, slurs and pedal. No photographed/degraded fixture was run with oemer.

This is also a pipeline/export capability gap. Independent inspection of pinned `oemer/build_system.py:1019` (`decode_measure`) finds divisions, key, staves and clefs, but no time-signature emission. All three actual native XMLs contain zero `<time>` and zero `<beam>` elements; Chopin visibly requires 3/4 meter and beamed notes. Missing meter/engraving support cannot be solved by swapping a checkpoint alone. These observations retain the unmodified XML and unchanged strict metrics.

**Metric interpretation:** keep the strict gates unchanged. Bars are paired by ordinal position, so a missing/shifted bar compounds later pitch/onset mismatches. Chopin's 39.88% pitch F1 does not imply roughly 60% of raw noteheads have wrong pitches. Voice identity is the entire onset/pitch multiset on a staff within a bar. Full-note keys contain onset, pitch, duration, staff, grace status and that complete voice fingerprint; one changed event can invalidate other otherwise-correct events. These are strict structural/full-note F1s, not percentages of individual notes correctly transcribed.

Complementary corpus projections are duration 59.91%, staff 62.41%, voice 55.35% F1. Full-note matches 239/reference 436/recognized 442; pitch 334/436/442; onset+pitch 280/436/442. Use absolute timing, other projections and raw render inspection alongside these strict scores.

Ignored evidence under `research/omr/results/local-options/`:

- Complete strict card: `scorecard-final.json`; preliminary cards deliberately retain missing pieces as failures.
- Unmodified XML: `native/<fixture-id>/<fixture-id>.musicxml` and `exports/<fixture-id>.musicxml`.
- Actual rendered output: `exports/<fixture-id>.musicxml.png` and SVG.
- Execution: `native-twinkle.log`, `native-twinkle-compatible-versions.log`, `native-bach.log`, `native-chopin.log`.

Initial Twinkle reconstruction hit an OpenCV5 `HoughLinesP` return-shape incompatibility. The research wrapper normalizes its shape; pinning NumPy 1.26.4/OpenCV 4.11/sklearn 1.2.0 removed compatibility warnings and preserved all Twinkle metric counts. The 195.52 s inference is retained in the original log; later reconstruction-only calls must not be reported as fresh recognition.

## Browser experiment and measured boundaries

The dedicated research worker accepts a real local PNG/JPG, preprocesses it, runs both actual ONNX models, reconstructs raw MusicXML in Pyodide and returns a download. This is separate from product integration. It does not yet implement PDF rasterization, deskew or correction.

Pinned runtime: ONNX Runtime Web 1.22.0, one WASM thread, `crossOriginIsolated=false`; Pyodide 0.26.4 scientific-Python packages. Chromium exposed `navigator.gpu`, but actual `requestAdapter()` returned null, so the measured path uses CPU WASM. This is an observation on this test browser, not every user's GPU.

The Twinkle PNG SHA256 is `e8331b58a5797d78c1c91da563006acf6a0d5a66f600a48553cf181e5c823c15`. Preprocessing matches upstream BGR/PIL resizing to 1612×2280. Both models process 234 sequential patches at 128-pixel stride: first 256×256, second 288×288, preserving clamped repeated edge patches and original traversal order. Browser batch 1 replaces native batch 16. It sums overlapping probabilities before argmax: division by the common per-pixel overlap count cannot change class order. Independent review verified all 29 upstream Python files against pinned Git blob hashes, preprocessing, class mapping and patch traversal. Measured complete label parity on Twinkle is recorded below; this does not imply universal floating-point parity.

The worker writes its own browser-generated labels into its private virtual filesystem, then calls unchanged upstream reconstruction with these masks. It never loads a native prediction cache. Safe SVC data exports replace upstream pickle loading; the browser disables `pickle.load`. Native-mask files are excluded from the local server allowlist.

### Joined whole-image run (completed and independently reviewed)

The corrected run is an actual local image→both browser ONNX models→browser reconstruction→unmodified MusicXML proof. It did not consume native masks/cache. Output parses, and its **entire Twinkle per-piece evaluation is exactly identical to native**.

| Browser Twinkle stage/result                 |          Actual measurement |
| -------------------------------------------- | --------------------------: |
| Runtime/source/image preparation             |                      5.06 s |
| First model, 234 patches and merge           |                    365.78 s |
| Second model, 234 patches and merge          |                    888.90 s |
| Browser reconstruction                       |                      4.85 s |
| Whole-image total                            | **1268.25 s (21 min 08 s)** |
| Pitch within ordinal bar                     |         64/64/65; 99.22% F1 |
| Onset+pitch                                  |         61/64/65; 94.57% F1 |
| Strict structural/full-note                  |     57/64/65; **88.37% F1** |
| Bars reference/recognized; timing mismatches |    12/12; **12 mismatches** |

The single-page raw render was inspected by the experimenter, independent reviewer and coordinator. It visibly retains the extra metronome-note event, missing meter/tempo/dynamic and incorrect final duration. This accepts research feasibility, **not production readiness**. Only Twinkle ran wholly in-browser; the full-manifest browser scorecard honestly reports **1 parsed/3, Bach and Chopin missing**. Its corpus summary is not a browser three-piece accuracy result.

Host: Windows, AMD Ryzen 7 7800X3D (8 cores/16 logical processors), about 32 GB RAM. Sampled corrected-run process-tree working-set sum was 1.50–1.52 GB, largest process 1.26 GB. Shared pages can be double-counted; this is not a measured peak or mobile test. Twenty-one-minute desktop CPU latency independently blocks a usable interactive scanner at present.

All 24 external requests were GETs of pinned public Pyodide runtime/packages; there were zero blocked requests and no recognition-service requests. Executed worker/bridge/server/runner hashes match the durable prototype. The runner exited successfully and closed its browser/server.

No-inference comparison against the locally generated native cache, with matching native/browser input SHA256, establishes **byte-identical complete argmax label maps for both models on this fixture**:

| Label map    | Native and browser SHA256                                          |
| ------------ | ------------------------------------------------------------------ |
| Staff/symbol | `8ea1c1ef4c0b1727f92afd6238d33da027ea52325024c5910c83b495118418b4` |
| Note/clef    | `31e69c357f72413138f849099073b103200a94e3b8b6cf1427773874fc5d33f3` |

This is label parity on one real image, not a guarantee of identical floating-point probabilities on every image. Safe comparison helper: `research/omr/prototypes/oemer/compare-label-parity.py`; retained record `native-browser-label-parity-final.json`.

Final ignored artifacts under `research/omr/results/local-options/`:

- `browser-full-twinkle-v2.musicxml` — untouched XML SHA256 `8b8cd41cfe9c96ac76795300c23f5b581768c754360b804c779e4292c91e35fe`.
- `browser-full-twinkle-v2.json` — input/output/prototype hashes, exact model metadata/timings and request audit.
- `browser-full-twinkle-v2.png` — completed research UI; `browser-full-twinkle-v2.musicxml.png/.svg` — actual raw one-page render.
- `browser-full-v2-execution.log`, `scorecard-browser-full-v2.json`, `browser-memory-samples.jsonl`.
- `browser-full-exports/twinkle-twinkle-little-star.musicxml` — byte-for-byte raw copy used by the existing scorer.

The first joined attempt retained a wrapper failure after its first model completed in 369.03 s: the second model requires 288×288, while the initial wrapper reused 256×256. No XML was produced. Failure is retained in `browser-full-twinkle.json` and `browser-full-execution.log`. Real one-patch controls then verified each input/output shape and name (`browser-model-shapes.json`): first `prediction`, 256×256×3, 1.604 s; second `conv2d_25`, 288×288×4, 3.500 s. Corrected code derives windows/names from actual ONNX metadata, asserts output dimensions, and passed independent review before v2.

### Earlier controls, explicitly partial

| Actual control                                  | Result                                                                     | What it establishes                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| First model, one real Twinkle patch             | 267.7 ms load; 1656.9 ms inference; finite output 1×256×256×3              | ONNX graph runs in non-isolated browser WASM                        |
| Pyodide reconstruction using saved native masks | 8.09 s reconstruction; 19.05 s including setup; same Twinkle metric counts | Reconstruction/dependency path works; not browser image recognition |
| Default Chromium WebGPU adapter                 | null                                                                       | CPU fallback required on this test browser                          |

Partial artifacts are `oemer-browser-patch.json`, `oemer-webgpu-patch.json`, `browser-reconstruction.musicxml/.json` and `scorecard-browser-reconstruction.json`. Partial browser XML SHA256 `cebbbc2ae2fe9ee791ea8fdf14060bc203693c3d0ef3c5cbf5fc684da24fb2b9`. These must not be substituted for the joined result.

## Local execution, cancellation and asset safety

All score bytes, segmentation and reconstruction stay in the browser. The harness allows only local experiment assets plus GET requests to pinned public `https://cdn.jsdelivr.net/pyodide/v0.26.4/full/*` runtime/package files; other network requests are aborted and logged. Runtime downloads require internet on a cold run, distinct from score uploads. Production offline packaging remains unimplemented.

A dedicated worker is terminated on cancellation, result or error. Three actual cancel smoke runs returned canceled with no XML and no blocked requests. The runner has a 30-minute bound and closes its browser/server in finally. The local HTTP server uses `relative(root,path)` path-boundary checks and exact/prefix asset allowlists; actual HTTP regressions confirm valid assets 200, encoded/raw sibling-prefix traversal 404/no marker disclosure, and .git/native-cache-image 404. Validating these boundaries does not imply browser/mobile performance acceptance.

Original SVC assets total ~34.9 MB. Static opcode inspection and an allowlisted NumPy/SVC unpickler are used only for one-time native conversion; safe JSON/NPZ exports load with `allow_pickle=False`. All four classifiers passed data-only roundtrip prediction checks. Browser sklearn 1.4.2 differs from native trained version 1.2.0; partial reconstruction matched the strict score but this is not blanket numerical parity.

## Pinned assets and licensing

[oemer source at dbe2a933d630d0f74805d717960eb259473f5978](https://github.com/BreezeWhite/oemer/tree/dbe2a933d630d0f74805d717960eb259473f5978) is MIT. [Official release checkpoints](https://github.com/BreezeWhite/oemer/releases/tag/checkpoints) have no separate weight-specific licence notice. Repository provenance is recorded; this is not a new guarantee about all training-data rights. Preserve upstream notices if packaging. No third-party source/model/dataset is committed.

| Asset                        | Source                                                                                                                   | SHA256                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Source archive               | [Pinned GitHub tarball](https://api.github.com/repos/BreezeWhite/oemer/tarball/dbe2a933d630d0f74805d717960eb259473f5978) | `68c2e15412410894a48532c4e9dbad91121f8d72ab4505304fa324a646c89c73` |
| First ONNX 70,767,752 bytes  | [Official release](https://github.com/BreezeWhite/oemer/releases/download/checkpoints/1st_model.onnx)                    | `37512e858731096439746f60b377c049f07055b4a23ec6eb9a178ce92cfba174` |
| Second ONNX 38,448,467 bytes | [Official release](https://github.com/BreezeWhite/oemer/releases/download/checkpoints/2nd_model.onnx)                    | `ed2e1a86ea75712ee6cdc740e96f7a36753543cf9bb980227c071c9256d9d82e` |
| ONNX Runtime Web 1.22.0      | [npm package](https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.22.0.tgz)                                   | `e293551f9d36d003e293d0f2937fee7b3dfdcef76d71d1449b55e2d4157c7aea` |

Pyodide runtime/package version is pinned 0.26.4; its fetched URLs are audited in result JSON. Runtime wheels are not independently hash-locked by this wrapper; production packaging would need a reviewed static manifest rather than the research CDN arrangement.

## Reproduce from a fresh checkout

Durable setup/runners live in [research/omr/prototypes/oemer](../../research/omr/prototypes/oemer/README.md). Python 3.11, installed pnpm dependencies and Playwright Chromium are required. Large assets/raw outputs remain ignored.

```powershell
pnpm --filter @digitus2/engine build
node research/omr/prepare.mjs --out research/omr/results/fixtures-final
powershell -NoProfile -File research/omr/prototypes/oemer/setup.ps1
node research/omr/results/local-options/run-browser-full.mjs independent-review
node research/omr/prototypes/oemer/check-static-server.mjs
node research/omr/results/local-options/run-browser-full.mjs cancel-review --cancel-smoke
```

Fixture preparation refuses to overwrite an existing corpus; skip it when already present. Setup validates source/model/ORT archive hashes, extracts isolated upstream directories, creates an isolated research venv, pins native requirements and exports safe classifiers. No Torch or system installation is required. ONNX files total 109.2 MB; ORT/Pyodide/native dependencies add downloads. Output IDs must be new for browser runs.

For the native comparison, run `research/omr/results/local-options/.venv/Scripts/python.exe research/omr/results/local-options/run-oemer-native.py <fixture-id>`; fixture IDs are `twinkle-twinkle-little-star`, `bach-minuet-g-major-bwv-anh-114`, `chopin-prelude-op28-no7`.

**Native cache limitation:** this diagnostic runner overwrites its prior XML/native-ID JSON, and does not hash-bind an existing cache to the fixture. Use a fresh experiment directory for independent native inference, or archive prior output and explicitly remove only the known generated cache. Cached calls are reconstruction-only. Browser runner has no such native cache and retains existing output filenames.

```powershell
node research/omr/evaluate.mjs --manifest research/omr/results/fixtures-final/manifest.json --recognized research/omr/results/local-options/exports --candidate oemer-dbe2a933-onnx-native --out NEW-SCORECARD.json
node research/omr/results/local-options/render-output.mjs research/omr/results/local-options/exports/twinkle-twinkle-little-star.musicxml
```

For browser-only Twinkle scoring after the fresh run above, preserve the raw file and copy it into a new flat scoring directory under the original fixture ID:

```powershell
New-Item -ItemType Directory research/omr/results/local-options/browser-review-exports
Copy-Item research/omr/results/local-options/independent-review.musicxml research/omr/results/local-options/browser-review-exports/twinkle-twinkle-little-star.musicxml
node research/omr/evaluate.mjs --manifest research/omr/results/fixtures-final/manifest.json --recognized research/omr/results/local-options/browser-review-exports --candidate oemer-browser-review --out NEW-BROWSER-SCORECARD.json
node research/omr/results/local-options/render-output.mjs research/omr/results/local-options/independent-review.musicxml
```

Read the Twinkle per-piece result; the unchanged full manifest penalizes the two missing browser pieces. For the native three-piece card, copy each completed raw `native/<fixture-id>/<fixture-id>.musicxml` into a fresh `exports/` directory under that same filename before scoring.

Optional no-inference parity check after native and browser runs:

```powershell
research/omr/results/local-options/.venv/Scripts/python.exe research/omr/prototypes/oemer/compare-label-parity.py research/omr/results/local-options/native/twinkle-twinkle-little-star/twinkle-twinkle-little-star.pkl research/omr/results/local-options/native/twinkle-twinkle-little-star/twinkle-twinkle-little-star.png research/omr/results/local-options/independent-review.json
```

The scorer's `recognitionExecuted:false` means the scorer itself does not launch recognition; retained recognizer logs establish actual execution. Scoring outputs are append-only. References come from the original fixture manifest, never the recognized XML.

## Concrete integration boundary

No production release is accepted with this accuracy, missing meter/export support and measured 21-minute desktop latency. The demonstrated components can support a future TypeScript `LocalOmrWorker` boundary: lazy static assets, local transferable bytes, structured progress/error, worker termination, strict XML parsing and local fingering after review. No upload endpoint or recognition server belongs in this design.

Two reviewable implementation choices remain:

1. TypeScript app plus third-party WASM/Pyodide reconstruction. Reuse the demonstrated reconstruction rather than blindly rewriting roughly 4500 nonblank Python lines and OpenCV/SciPy. This embeds third-party Python in WASM and needs an explicit product-stack decision. Download size, latency, memory, offline pinning and dependency notices still need resolution.
2. TypeScript reconstruction port. Keep ONNX checkpoints and safe SVC parameters, port image/staff/note/voice/rhythm/XML logic, and validate intermediate masks and final-note parity. This preserves the current language decision but is a substantial implementation and does not cure upstream recognition errors.

Current oemer cannot silently supply reliable beginner playback/fingering. A correction/review workflow and improved recognition must resolve metronome artifacts, durations, voices, pickup/bar structure and timing before release. Meter recognition/export and engraving support also need implementation; a new checkpoint alone is insufficient. Photographic robustness and mobile performance are unproved. No evidence supports perfect recognition.

The earlier SMT candidate is independently ruled out by identical official-PyTorch versus browser F32 wrong output on the same Twinkle crop; both tested full-page polarities fail. See [SMT diagnosis](omr-runtime-2026-10-15.md). Further quantization/crop sweeps on that checkpoint are not justified.

## Verification status

Joined output, strict scoring, exact label comparison and actual rendering completed. Independent source/raw-output review and coordinator review accept research feasibility only. No git or merge was performed by this research agent.

`$env:DIGITUS2_E2E_PORT='4194'; pnpm verify` completed with exit 0: **all 12 gates passed**, including OMR harness tests, 175 browser E2E checks, PIG/Mutopia benchmarks and hand separation. Library preview 4191 was left running; inference stopped before verification. Evidence: `research/omr/results/local-options/verify-omr-final.log` and `verify-omr-final-exit.json`.

Explicit `pnpm format:check` passed with exit 0; its output is recorded separately in `research/omr/results/local-options/format-check-final.log`. The repository ignores research/report paths for Prettier, so direct Prettier API checks also cover the prototype MJS/HTML/README and this report. Python AST, Node and PowerShell syntax checks passed. Actual HTTP containment regression, three worker-loading cancellation smokes, safe-SVC roundtrips, exact executed/durable source hashes and native/browser input/label checks passed. The cancellation smokes cancel during worker/runtime loading; no claim of a separately timed mid-inference cancellation test is made.
