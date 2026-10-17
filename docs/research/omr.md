# Optical music recognition (OMR) research

What was evaluated for the experimental scanning feature (`docs/scanning.md`), what was measured, and why the product runs homr (photos) and Audiveris (PDFs) on an optional local PC worker. The prototypes are under `research/omr/prototypes/`; raw outputs stay in the ignored `research/omr/results/`.

## Decision

- Recognition runs on the user's own PC in an optional loopback worker (`research/omr/prototypes/local-worker`). GitHub Pages stays the frontend; Python is allowed only in that worker, and the product code stays TypeScript.
- No external recognition service and no score upload: the owner requires recognition within the application. Online services were surveyed but never used.
- Photos (PNG, JPEG) go to a pinned, patched homr; PDFs go to Audiveris 5.11.0 with a short-staff profile and the English text model. Only these two recovered usable music in the tests below.
- Browser-only recognition was rejected: no tested checkpoint produced usable notes fast enough. SMT++ produced wrong notes; oemer took 21 minutes for one page and kept its rhythm and meter errors.
- Recognition output is never repaired or guessed. Errors stay visible for review, and a strict importer refuses malformed notation.

## Evaluation harness

`research/omr/prepare.mjs` renders library scores into complete page sets (clean PNG, deterministic photo-like degradations, PDF). Its manifest pins each original MusicXML by SHA-256 with its source and licence. The original XML is the ground truth. `research/omr/evaluate.mjs` scores whole-score exports (`.musicxml`, `.xml` or `.mxl`, one per fixture id) from any recogniser against it. The `omr` step of `pnpm verify` runs the harness tests (`pnpm test:omr`). It downloads no models and is not an accuracy gate.

```sh
pnpm --filter @digitus2/engine build
pnpm test:omr
node research/omr/prepare.mjs --out research/omr/results/fixtures            # needs Playwright Chromium; --slugs a,b,c picks pieces
node research/omr/evaluate.mjs --manifest research/omr/results/fixtures/manifest.json \
  --recognized DIR_OF_EXPORTS --candidate NAME --out research/omr/results/NAME.json
```

- `prepare.mjs` refuses an existing output directory, so a new fixture version needs a new directory.
- Exit status 0 means every export parsed, 1 means a missing, invalid or ambiguous export (all still counted as failures), and 2 means a configuration error or a changed ground-truth hash. Exit 0 is not an accuracy result.
- `recognitionExecuted: false` in a scorecard means the scorer only read exports. Record the recogniser version, invocation, input and timing next to each real run.
- Copying the references in as candidates must score 1.0. That is an identity check, never OMR accuracy.

Each bar is paired by ordinal position. Onsets are exact rational quarter-note offsets from the bar start, so one overlong bar does not shift every later onset. A deleted or inserted bar still misaligns the bars after it; the scorer does not guess an alignment.

| Metric     | Exact multiset compared within each bar                                    |
| ---------- | -------------------------------------------------------------------------- |
| pitch      | MIDI pitch, with multiplicity                                              |
| onsetPitch | Pitch and local onset                                                      |
| duration   | Pitch, onset and sounding duration                                         |
| staff      | Pitch, onset and global staff ordinal                                      |
| voice      | Voice partitions within a staff, independent of voice numbers              |
| fullNote   | Pitch, onset, duration, staff, grace status and the note's whole voice set |

These are precision, recall and F1 per projection, not per-note accuracy. Strict full-note F1 is the headline number. Because the voice key is the whole onset/pitch set of a voice in its bar, one wrong note can invalidate its neighbours. A low full-note F1 therefore does not mean that most noteheads were wrong. The scorer parses with `preserveNotation: true` (duplicates and chord-member durations kept; tied segments merged). Slurs, beams, articulations, enharmonic spelling and layout are not scored, and rests count only through timing. A reference that fails preservation-mode parsing is fixed or dropped; the checks are never relaxed to suit a candidate.

The default corpus is page 1 of three library pieces: Twinkle, Bach Minuet in G (BWV Anh. 114) and Chopin Prelude Op. 28 No. 7 (436 sounding notes). The held-out pages are Ode to Joy, Amazing Grace, Greensleeves and Schumann Op. 68 No. 1. All are synthetic engravings, not historical scans or phone photos.

## Routes evaluated

| Route                                                                                                                                                                                                                | Runs where                                       | Result                                                                                                                                                                     | Decision                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [SMT++](https://github.com/antoniorv6/SMT-plusplus) via [CrispEmbed](https://github.com/CrispStrobe/CrispEmbed) (ggml/WASM, [full-page](https://huggingface.co/cstr/smt-fp-grandstaff-GGUF) and [system](https://huggingface.co/cstr/smt-grandstaff-GGUF) GGUF) | Browser, single-thread worker                    | No usable notes on any clean fixture: empty output, repeated rests, or invented pitches and meters                                                                    | Rejected                                       |
| [oemer](https://github.com/BreezeWhite/oemer) (two ONNX segmentation models plus Python reconstruction)                                                                                                            | Native, and browser (ONNX Runtime Web + Pyodide) | Full-note F1 88.37 / 88.73 / 0.59 % on the three clean pages; no meter or beams exported; browser Twinkle took 21 min                                                      | Rejected                                       |
| [Audiveris](https://github.com/Audiveris/audiveris) 5.11.0                                                                                                                                                           | Native (bundled Java)                            | 4–8 s per clean page; 100 % on Twinkle with the short-staff profile; 86.73 % corpus F1 from original PDFs with English OCR                                                  | Adopted for PDFs                               |
| [homr](https://github.com/liebharc/homr), pinned and patched                                                                                                                                                         | Native (CPU ONNX)                                | Recovers all 13 main bars and both hands on two real book photos where Audiveris and oemer failed                                                                          | Adopted for photos                             |
| Online services: [Flat/Tutteo OMR API](https://flat.io/developers/docs/api/omr/), [Klangio Scan2Notes](https://klang.io/help/compare-apps-and-subscriptions/), [Newzik](https://newzik.com/notre-api-omr)           | Vendor servers                                   | Not run                                                                                                                                                                    | Rejected: no upload to external services       |
| [satb-line-omr](https://github.com/alexanderalber/satb-line-omr)                                                                                                                                                     | Browser ONNX                                     | Not run: one voice per staff, excludes polyphony and scans                                                                                                                 | Not suitable for piano                         |

### SMT++ in the browser

The runtime itself works: a classic Web Worker without COOP/COEP headers, lazily loaded static model and WASM files, transferable RGBA input, and worker termination as cancellation. Recognition does not. The original system-level safetensors, run in the [official PyTorch code](https://github.com/antoniorv6/SMT-plusplus/tree/e49345abccc77d3b030b84fcdec7387204563736), produce output byte-identical to the F32 browser GGUF on the same Twinkle crop, invented opening chord included. The checkpoint is the cause, not conversion or quantisation, so further crop or quantisation sweeps are not worth running. The full-page model also failed with inverted input. At native page resolution it exceeded the 2 GB WASM heap; half-scale pages used about 860 MB. Its confidence output is always zero. Model provenance: [PRAIG full-page model](https://huggingface.co/PRAIG/smt-fp-grandstaff), [original system weights](https://huggingface.co/antoniorv6/smt-grandstaff/tree/2eb5a45c29d63bdf063cd0427175f57675e7da9e). Both declare MIT.

### oemer, native and in the browser

| Clean page     | Notes ref/recognised | Pitch F1 | Onset+pitch F1 | Full-note F1 | Bars ref/recognised | Bar timing mismatches |
| -------------- | -------------------: | -------: | -------------: | -----------: | ------------------: | --------------------: |
| Twinkle        |                64/65 |   99.22% |         94.57% |       88.37% |               12/12 |                    12 |
| Bach minuet    |              204/204 |   99.02% |         94.12% |       88.73% |               32/32 |                    25 |
| Chopin prelude |              168/173 |   39.88% |         15.84% |        0.59% |               17/16 |                    16 |

Native CPU inference took about 200 s per page. Twinkle's printed metronome note becomes an extra event, which makes bar 1 five beats long and shifts every later bar. Chopin loses a bar and its meter, beams and rhythm. oemer's `decode_measure` (`build_system.py`) emits no time signature, and none of the exports contains a `<time>` or `<beam>` element, so a better checkpoint alone cannot fix it.

The browser version runs both ONNX models in [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) 1.22.0 (one WASM thread, not cross-origin isolated). It runs the unchanged upstream reconstruction in Pyodide 0.26.4 and loads its SVC classifiers from safe JSON/NPZ exports, never pickle. On Twinkle its label maps were byte-identical to native and its score was identical. It took 1,268 s on an AMD Ryzen 7 7800X3D: 366 s for model 1, 889 s for model 2 and 5 s for reconstruction, with a working set of about 1.5 GB.

WebGPU ([ORT WebGPU provider](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)) did not rescue it:

| Control                     | Result                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Model 1 on GPU, 256×256     | 1,910 of 65,536 argmax pixels differ from CPU, also with graph optimisation off: rejected |
| Model 2 on GPU, four patches | Zero argmax differences; about 0.5–0.7 s per patch against 3.45 s on CPU                 |

Playwright's bundled headless Chromium reports SwiftShader and no WebGPU adapter; installed Chrome and Edge expose the hardware GPU. The hybrid page (model 1 on WASM, model 2 on WebGPU) was never run end to end, so no speed-up is claimed. Porting oemer's reconstruction to TypeScript (about 4,500 lines of Python plus OpenCV and SciPy) would keep its recognition errors.

### Audiveris

Strict full-note F1 on the clean pages. The default and short-staff columns are PNG input; the last column is the original PDF with the English text model.

| Page             | oemer  | Audiveris default | Short-staff profile | Short-staff, PDF + OCR |
| ---------------- | -----: | ----------------: | ------------------: | ---------------------: |
| Twinkle          | 88.37% |            95.93% |                100% |                   100% |
| Bach minuet      | 88.73% |            91.18% |              91.18% |                 93.37% |
| Chopin prelude   |  0.59% |            40.91% |              40.91% |                 73.75% |
| Corpus           | 54.44% |            73.42% |              74.17% |                 86.73% |
| Held-out corpus  |      — |            81.10% |              81.10% |                 93.19% |

| Held-out page    | PNG (default = profile) | PDF + OCR | Events ref/recognised (PDF) |
| ---------------- | ----------------------: | --------: | --------------------------: |
| Ode to Joy       |                  86.25% |    96.39% |                       83/83 |
| Amazing Grace    |                  82.61% |      100% |                       69/69 |
| Greensleeves     |                  61.84% |      100% |                     106/106 |
| Schumann Op.68/1 |                  86.82% |    87.50% |                     256/256 |

- **Short-staff profile.** Audiveris drops staves shorter than 30 interlines ([LinesRetriever](https://github.com/Audiveris/audiveris/blob/9e1e55cd2746037d059345881c53e6a6754bffbd/app/src/main/java/org/audiveris/omr/sheet/grid/LinesRetriever.java)) and clusters shorter than 0.2 of the median line length ([ClustersRetriever](https://github.com/Audiveris/audiveris/blob/9e1e55cd2746037d059345881c53e6a6754bffbd/app/src/main/java/org/audiveris/omr/sheet/grid/ClustersRetriever.java)). Twinkle's one-bar final system fell under both. The profile sets `LinesRetriever.minStaffLength=12` and `ClustersRetriever.minClusterLengthRatio=0.15`, which recovers the missing bar. The parameters were fixed on Twinkle and left all six other pages unchanged. Lowering either constant alone does not recover the bar. This is recogniser configuration, not XML repair.
- **Original PDFs beat screenshots.** Audiveris rasterises the Chopin PDF at an interline of 21 px, against 11 px in the PNG. A 2× Lanczos-enlarged PNG reached only 60.59%, so the app sends the original PDF bytes and never enlarges images automatically.
- **English OCR.** The [language guide](https://audiveris.github.io/audiveris/_pages/guides/main/languages/) needs legacy-capable tessdata; LSTM-only `tessdata_fast` does not work. The worker pins [tessdata 4.1.0 `eng.traineddata`](https://raw.githubusercontent.com/tesseract-ocr/tessdata/4767ea922bcc460e70b87b1d303ebdfed0897da8/eng.traineddata) (Apache-2.0). Without it, text and tempo marks are lost and the worker says so.
- **Tempo stays unresolved.** OCR reads Twinkle's "= 100" but not the beat-unit glyph. The [metronome procedure](https://audiveris.github.io/audiveris/_pages/guides/specific/metronome/) needs both, so no tempo is exported. `audit_export.py` flags `metronome-beat-unit-unresolved` and `meter-unresolved`; it never invents a BPM.
- **Invocation.** The [CLI](https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/) runs as `-batch -transcribe -export`. The adapter launches the bundled `java.exe` with classpath `app/*` only: `app;app/*` puts Audiveris in development-resource mode, and it then misses its classifier. Settings, home, temp and native caches are per job.

Generated photo-like stresses (Audiveris, short-staff profile, English OCR):

| Control                          | Result                                                            | Full-note F1 |
| -------------------------------- | ----------------------------------------------------------------- | -----------: |
| Twinkle as clean JPEG            | 64/64 events                                                      |         100% |
| Twinkle rotated 1.5°             | Fails at Audiveris's 10-pixel interline threshold; no export      |            0 |
| Bach with edge shadow            | 204/204 events                                                    |       91.18% |
| Chopin at low contrast           | Export refused by strict import ("tie stop without a start")      |            0 |

### Real book photos

Two private photos of the same printed continuation page (768×1024 and 1200×1600), with book curvature, uneven light, four grand-staff systems, alternative bass cue staves and footnote music:

| Attempt                                                   | Result                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Audiveris, original input                                 | Smaller photo halts at about 6 px staff spacing; sharper photo exports only tiny fragments |
| Audiveris after contrast, illumination or 3× enlargement  | No export, or separate single-staff fragments                                             |
| oemer with dewarping (smaller photo)                      | Parses, but the bass is put on the upper staff and the rhythm and bars are wrong; no meter or beams |
| homr with the three patches below                         | All 13 main bars and both hands on both photos (156 and 157 notes imported)               |

homr ([commit ab369ac](https://github.com/liebharc/homr/tree/ab369ac54277afab582afa4725441f7cbba76593)) runs on the CPU with three ONNX models (about 139 MB of downloads). The setup applies three source patches:

1. Detect short, far-inset single-staff examples on a piano page before layout and decoding.
2. Mask a detached, smaller five-line staff that intrudes into a grand staff's decoder margin.
3. Write accidental display glyphs that match the recognised pitch alterations (pitches unchanged).

On the public clean piano and single-melody controls the output is byte-identical before and after the patches. The remaining errors are listed in `docs/scanning.md`. The pinned homr exporter writes no beams.

### Online services

The Flat/Tutteo OMR API was the most concrete option. Its capabilities endpoint answered: PNG/PDF in, MusicXML out, 50 pages per job, credits from about $0.10 to $0.33 per page, and job content kept 30 days ([billing](https://flat.io/developers/docs/api/omr/faq/credits), [legal and privacy](https://flat.io/developers/docs/api/omr/faq/legal)). Klangio's API covers audio, not OMR ([API docs](https://api-docs.klang.io/)), and Newzik needs a sales contract. None was used, because scores must not leave the user's machine. If an online route ever returns, it must be explicit, name the provider before any transfer, and never ship a shared token in the static bundle.

## Browser to worker connection

A public HTTPS page needs the browser's permission to reach a program on loopback ([Chrome local network access](https://developer.chrome.com/blog/local-network-access)). In Chrome 155 the governing permission is `loopback-network`; a legacy `local-network-access` grant alone was denied ([Chrome guidance](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/security/local-network-access.md)). The client sends `targetAddressSpace: 'loopback'` and no credentials. The worker binds 127.0.0.1 only and checks the exact Host and an allowed Origin. That origin check cannot tell apart the project paths under `marchalmaxim.github.io`, and it is not authentication against a local program that forges headers. The worker is not designed for a public or multi-user deployment: that would need authentication, TLS and isolation.

## Licences

Nothing below is bundled into the MIT web app. The setup scripts fetch each component and verify its pinned digest.

| Component                              | Licence                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| homr code and models                   | AGPL-3.0 ([licence FAQ](https://github.com/liebharc/homr/blob/main/LICENSE_FAQ.md), which also notes training-data uncertainty) |
| Audiveris                              | [AGPL-3.0-or-later](https://github.com/Audiveris/audiveris/blob/9e1e55cd2746037d059345881c53e6a6754bffbd/LICENSE) |
| tessdata English model                 | Apache-2.0                                                                                                     |
| oemer code ([checkpoints](https://github.com/BreezeWhite/oemer/releases/tag/checkpoints) carry no separate notice) | MIT                                                                                                            |
| SMT++ models and CrispEmbed runtime    | MIT                                                                                                            |

## Open questions

The open scanning requests (recognition errors, beam recovery, an acceptance corpus beyond one test page, in-browser correction, a shared library) are in `docs/TODO.md` under T9. Phone-photo robustness, multi-page books and mobile use are not established.
