# homr photo runtime

Prepares the pinned, patched [homr](https://github.com/liebharc/homr) that the local worker uses for PNG and JPEG pages; PDFs go to Audiveris. Results and the reasons for choosing homr: [docs/research/omr.md](../../../../docs/research/omr.md).

## Setup

From the repository root, with Python 3.11 or later:

```powershell
powershell -File research/omr/prototypes/homr-photo/setup.ps1
```

The script downloads homr at commit `ab369ac` and creates an isolated CPU-only virtual environment with the locked inference dependencies (`requirements-cpu.txt`). It fetches three pinned ONNX models (about 139 MB of downloads, 157 MB unpacked), applies the source patches below and verifies the 46 inference source files. No PyTorch, GPU or global package is needed. A second run re-verifies the prepared source, and any unexpected edit or added file fails it. The toolchain lands in the ignored `research/omr/results/photo-options/toolchain` (override with `-Root`). Pass that directory to the worker with `--homr-toolchain`.

At recognition time the adapter (`../local-worker/homr.py`) re-checks the source and model pins. It runs homr in a child Python process with networking disabled and title OCR off, and rejects images above 25 megapixels before decoding. It keeps the original image bytes and uses the worker's timeout, cancellation and log bounds.

## Source patches

- `upstream.patch` detects short, far-inset single-staff examples on a piano page before layout repair and decoding.
- `../photo-recovery/upstream-boundaries.patch` masks a detached, smaller five-line staff inside a grand staff's decoder margin, keeping the main staff and its ledger margin.
- `../photo-recovery/upstream-accidentals.patch` writes accidental display glyphs that match the recognised pitch alterations; pitches are unchanged.
- `../photo-recovery/upstream-coverage.patch` lets a staff that homr finds by its lines alone replace the one partial staff it overlaps. Without it, line tracking can split a staff when its clef is missed, and the duplicate filter keeps only the part with more anchors, so the decoder never sees the rest of the system (issue 129). The replacement needs the partial staff to span less than 75 percent of the page column, the new staff to add at least a tenth of the column (so a short last system found twice stays as it was) and four of the five lines to agree within half a staff space, which keeps out shifted copies from lines shining through the paper.
- `upstream-speed.patch` (`patch_speed.py`) changes speed only: title OCR (rapidocr) is imported only when title detection is on, which the adapter turns off, and the bounding-box touch pre-check reads each box's centre and major axis computed once, with the upstream arithmetic. The acceptance gate's 136 homr recognitions (its 30 pages through every route, rotated and perturbed copies included) give identical MusicXML and staff positions with and without it.
- `upstream-confidence.patch` (`patch_confidence.py`) keeps, for every decoded symbol, the three most probable tokens of the rhythm, pitch and accidental heads with their softmax probabilities (six significant digits) and writes them in the note as `<!-- conf: rhythm note_4 0.903 ...; pitch C5 1 D5 1.2e-05 ...; lift _ 1 ... -->`, beside `imgpos`. Decoding is untouched: the chosen tokens are the same argmax, and the MusicXML with the comments removed is byte-identical to the unpatched output. The review reads them to say when a page was read unclearly (issue 130; measurements in `docs/research/omr.md`, Confidence).

Each exclusion or mask is recorded in the job's audit and shown as a review warning, because an indented single-staff coda can look like an example. Key and time signatures missing from a continuation page may be inferred by the model. On the public clean piano and single-melody controls, the output is byte-identical with and without the first three patches. The coverage patch leaves the other thirteen photos of `research/omr/photos/` byte-identical and the library corpus routes at their recorded figures. Setup keeps the vendor files' byte format regardless of git line endings and never rewrites the patch files. The pinned source identity is in `source-manifests.json`.

The adapter also reads homr's staff positions: one row per staff of every system (a paired grand staff is one row, an unpaired staff a row of its own). The column is the median left and right edge of the staves at least 0.75 of the longest one. A staff that starts more than 25 percent of the column width right of the column's left edge, or that ends that far short of the column's right edge while some staff below it does not end short (so the short last system of a piece is left alone), was read in part: bars may be missing (a staff cut short) or added (a short stray staff from show-through). The adapter then adds the review warning `recognition-system-partly-read` with the staves, counted from the top, in `details.staves`, and the job audit lists them as `partlyReadStaves`. The app shows it translated, as an alert above the comparison, like the grand-staff warning.

homr code and models are AGPL-3.0; see `NOTICE.md` and `LICENSE.upstream`. The web app does not bundle this runtime.

## Research commands

```powershell
python research/omr/prototypes/homr-photo/test_piano_cues.py
python research/omr/prototypes/homr-photo/test_prepare_patched.py
python research/omr/prototypes/homr-photo/test_patch_speed.py
python -m pytest research/omr/prototypes/local-worker/test_homr.py -q
python research/omr/prototypes/homr-photo/run.py PATH_TO_IMAGE NEW_JOB --piano-cues
```

`run.py` is a debug runner. It writes the source bytes, raw MusicXML, model and source identities and audits to a new ignored job directory, and refuses to reuse one.
