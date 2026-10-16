# Scanning spike: reproducible recognition evaluation

_Codex · Astra orchestration · Sol 6.1 implementation and independent reviews · 2026-10-15._

2026-10-15. T9 / M10. This change prepares the experiment and scores recognition exports; it does not add PDF/photo import to the application. No recognizer has yet been measured on these fixtures. The public app stays browser-only.

## What is implemented

`research/omr/prepare.mjs` renders selected library scores into complete page sets, with clean images, deterministic scan-like degradations and PDFs. Its manifest pins each original MusicXML by SHA-256 and retains its source and licence metadata. The original XML is the ground truth. Generated files live under ignored `research/omr/results/`.

`evaluateOmr` in the engine compares parsed scores. `research/omr/evaluate.mjs` accepts whole-score `.musicxml`, `.xml` or compressed `.mxl` exports from any recognizer and writes a scorecard. Missing, invalid and ambiguous exports stay in the denominator. A changed ground-truth hash aborts the experiment. Existing output files are preserved. Harness tests run under `pnpm verify` and in CI after the engine build.

The app already has the downstream components: MusicXML parsing in `packages/engine/src/io/musicxml/`, loading and solving in `apps/web/src/engine/handlers.ts`, and Verovio engraving in `apps/web/src/score/render/`. Recognition should ultimately feed that pipeline. The present worker accepts MusicXML and MIDI only. The app's correction UI is still M5 work, so a recognizer alone would not finish M10.

## Run the experiment

From the repository root, with pinned pnpm dependencies installed:

```sh
pnpm --filter @digitus2/engine build
pnpm test:omr
node research/omr/prepare.mjs --out research/omr/results/fixtures
```

The generator requires the same Chromium installation as the app's Playwright tests (`pnpm --filter @digitus2/web exec playwright install chromium` if absent). It refuses an existing output directory. Use a new directory for a new fixture version. `--slugs` takes comma-separated library IDs. Keep complete page groups together; the reference is the whole piece, not just page one.

Run a separately installed recognizer against **one image condition at a time**, or the clean PDF, then collect one whole-score export per fixture ID:

```text
research/omr/results/candidate-clean/
  twinkle-twinkle-little-star.musicxml
  ...one export for every manifest piece...
```

```sh
node research/omr/evaluate.mjs --manifest research/omr/results/fixtures/manifest.json --recognized research/omr/results/candidate-clean --candidate candidate-version-clean --out research/omr/results/candidate-clean.json
```

Exit status is 0 when every requested export was parsed, 1 for missing/invalid/ambiguous exports, and 2 for configuration or ground-truth errors. **Exit 0 is not an accuracy gate.** Inspect the metrics and warnings; empty parsed scores still score zero. Save recognizer version, model hashes, invocation, image condition and timing alongside each real run. `recognitionExecuted: false` in the scorecard means this evaluator only consumed exports; it did not invoke the recognizer.

For a harness sanity check, copy the references into a separate export directory named by fixture ID. That should score perfectly, but is an identity check, never OMR accuracy. A missing export or planted pitch/rhythm error must reduce the result. Unit and runner tests enforce these controls.

## What the scores mean

Each bar is paired by ordinal position. Ticks become exact rational quarter-note units, measured from that bar's start. IDs, XML divisions and chord element order do not matter. This prevents one overlong bar from moving every later onset in the comparison. Bar start and length differences are reported separately. A deleted or inserted middle bar can misalign subsequent bars: v1 deliberately does not guess a best alignment. Diagnose those cases from the per-bar rows before comparing candidates.

| Metric     | Exact multiset projection compared within each bar                   |
| ---------- | -------------------------------------------------------------------- |
| pitch      | MIDI pitch, including multiplicity                                   |
| onsetPitch | Pitch and local onset                                                |
| duration   | Pitch, local onset and sounding duration                             |
| staff      | Pitch, local onset and global staff ordinal across all parts         |
| voice      | Voice partitions within a staff, independent of numeric voice labels |
| fullNote   | Combined pitch/onset/duration/staff/grace/voice representation       |

These are separate projection precision/recall/F1 scores, not conditional attribute accuracies on a hidden note alignment. All rates are 0–1. Micro scores pool note counts; macro F1 gives each requested piece equal weight, including failed exports. Duplicate, missing and extra notes are counted. Canonical voice signatures make merges and splits visible, but one changed member can affect its entire voice's signature; voice/fullNote are intentionally strict diagnostics.

The runner opts into `parseMusicXml(..., { preserveNotation: true })`, retaining duplicate note events and each chord member's declared duration; the ordinary app importer still applies its existing normalization. The engine parser merges tied segments into sounding notes. Thus equivalent tie spelling can compare equally; slurs, beaming, articulation, enharmonic spelling and visual layout are not scored. Rests are represented only indirectly by onset and measure timing. The corpus is synthetic engraving with controlled image degradation, not evidence of accuracy on historical IMSLP scans or actual phone photographs. Add those independent sets before making product claims.

## Harness controls, measured locally

| Check                                                         | Result                                                                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default corpus                                                | 3 complete scores, 3 pages, 436 parsed sounding notes                                                                                                   |
| Identity exports (reference copied as candidate; **not OMR**) | All six metrics precision/recall/F1 1.0; no bar timing mismatch                                                                                         |
| Multi-page generation                                         | Mozart K.545: all 4 pages retained in SVG/image output and PDF; last page inspected                                                                     |
| Repeated one-piece generation                                 | XML/SVG/PNG bytes match; PDF bytes match after fixed metadata dates                                                                                     |
| Strict parser compatibility survey                            | 181 of 182 library MusicXML files accepted; The Entertainer fails on existing orphan tie-stop warnings, so it cannot silently become clean ground truth |

Preservation-mode parsing rejects unsupported/inexact rhythmic values, ambiguous or noncontiguous ties, and parser warnings. Staff ordinals follow physical part order and each part's complete staff range, so two single-staff piano parts can compare with a single grand-staff part. Missing divisions retains the importer default of one tick per quarter; references should carry explicit divisions. Grace notes retain zero sounding duration. Resolve rejected references before adding them to an experiment rather than relaxing checks to improve a candidate's score.

Independent verification used separate agents for source review, adversarial metric examples, actual CLI usage, and visual inspection. The CLI reviewer regenerated Twinkle and all four K.545 pages and tested identity, compressed MXL, wrong pitch/rhythm, duplicate notes, missing/invalid/ambiguous exports, changed reference hashes, and overwrite protection. Those identity controls cover 1,352 sounding notes. The visual reviewer inspected 28 image variants and independently rendered all seven PDF pages with Poppler. It found an aspect-ratio discrepancy after SVG padding; the fix expands the viewBox to the page ratio, and corrected Twinkle PDF/PNG ink bounds agree within one pixel. These are harness checks, not recognition results.

## Candidate feasibility, checked 2026-10-15

| Candidate                                                       | Verified interface                                                                   | Runtime and licence findings                                                                                                                                                                                                                                                                                                                                                     | Next experiment                                                                                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [oemer](https://github.com/BreezeWhite/oemer)                   | Image to MusicXML, piano staff grouping/chords                                       | MIT source; Python, ONNX Runtime, OpenCV, SciPy and sklearn. Checkpoints download on demand; a separate explicit checkpoint grant was not established. ONNX weights alone do not port its Python reconstruction pipeline to a browser. [Dependencies](https://github.com/BreezeWhite/oemer/blob/main/setup.py)                                                                   | Local baseline on all fixture conditions; audit checkpoint provenance before redistribution                                                                                  |
| [homr](https://github.com/liebharc/homr)                        | Image/PDF to MusicXML, grand staffs and multiple voices                              | Python 3.11+, ONNX, OpenCV and PDFium. Code **and weights** are AGPL-3.0 according to its [licence FAQ](https://github.com/liebharc/homr/blob/main/LICENSE_FAQ.md), which also discusses training-data uncertainties. [PDF handling](https://github.com/liebharc/homr/blob/main/homr/pdf_utils.py)                                                                               | Separately installed research baseline; no bundled AGPL dependencies or models in this MIT app                                                                               |
| [Audiveris](https://github.com/Audiveris/audiveris)             | PDF/image to MusicXML 4.0, usually `.mxl`; multi-staff voices                        | AGPL-3.0 Java application. CLI supports `-batch -transcribe -export`; no verified browser build. [CLI guide](https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/), [voice handling](https://audiveris.github.io/audiveris/_pages/tutorials/main_window/voice_colors/)                                                                                              | Printed-scan baseline, especially multi-page PDFs                                                                                                                            |
| [CrispEmbed + SMT++](https://github.com/CrispStrobe/CrispEmbed) | Existing WASM client-side OMR; SMT++ handles full pianoform pages and emits `bekern` | MIT C++/ggml implementation, [browser API](https://github.com/CrispStrobe/CrispEmbed/blob/main/examples/wasm-ocr/README.md). [Upstream model](https://huggingface.co/PRAIG/smt-fp-grandstaff) has MIT metadata; [GGUF conversion](https://huggingface.co/cstr/smt-fp-grandstaff-GGUF) offers Q8 at about 17 MB and F32 about 48 MB. Neither was downloaded or run in this spike. | Leading **browser feasibility** candidate; verify model provenance, test worker loading on Pages, and validate `bekern` to MusicXML conversion before evaluating recognition |

The original roadmap named ONNX Runtime Web, but the fixed requirement is local browser execution, not a particular inference format. [ORT Web](https://onnxruntime.ai/docs/tutorials/web/) supplies inference, not staff segmentation or musical reconstruction. Its [runtime configuration](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html) documents backend and threading requirements. Begin with a single-thread worker that works on the deployed Pages origin; do not assume cross-origin isolation headers are available.

[satb-line-omr](https://github.com/alexanderalber/satb-line-omr) is an actual ONNX browser implementation, but its stated scope is one voice per staff and it excludes closed polyphonic scores and scanned material. It is not a suitable piano recognizer for this task.

## What remains before app integration

1. Run and pin the baseline recognizers and the browser candidate. No winner on accuracy has been chosen.
2. Add independently sourced printed scans and real photographs with manually verified MusicXML, including the user's Boellmann example where lawful access and a reference are available. Keep attribution with every fixture.
3. Check whole-page/system stitching, ties, pickup bars, cross-staff notes, voice preservation, and correction workload. A `bekern` adapter needs its own round-trip tests before its errors can be separated from recognition errors.
4. Measure actual download size, memory, first-use and warm latency on phone/desktop, plus deployed-origin browser compatibility.
5. Run the existing hand and fingering oracles on recognized scores. The new projection scores do not replace `benchmarks/floor.json` or establish a shipping threshold.
6. Only after those results and M5 correction support: one contextual scan entry beside file import, progress/cancellation, explicit recoverable errors and a review path. No permanent extra controls.
