# Audiveris adapter and setup

Setup scripts and a research runner for [Audiveris](https://github.com/Audiveris/audiveris) 5.11.0, the recogniser the local worker uses for PDFs. The folder also holds a cached oemer diagnostic. The measured results (short-staff profile, original PDF and English OCR) are in [docs/research/omr.md](../../../../docs/research/omr.md). Audiveris is AGPL-3.0-or-later; these wrappers do not relicense it, and no binaries are committed.

## Setup (used by the product)

```powershell
powershell -NoProfile -File research/omr/prototypes/oemer-quality/prepare-audiveris.ps1
powershell -NoProfile -File research/omr/prototypes/oemer-quality/prepare-text-models.ps1
```

- `prepare-audiveris.ps1` downloads the official Windows console installer (85 MB) and checks its SHA-256. It unpacks the installer with an administrative extraction (`msiexec /a`, never a system install) into the ignored `research/omr/results/quality-wave/toolchain`, and refuses to overwrite an existing extraction.
- `prepare-text-models.ps1` downloads the pinned legacy-capable English `eng.traineddata` from tessdata 4.1.0 (23.5 MB, Apache-2.0) with its licence into `research/omr/results/quality-wave/text-models`. LSTM-only `tessdata_fast` models do not work with Audiveris.

## Research runner

Python 3.11 standard library only:

```powershell
python research/omr/prototypes/oemer-quality/run-audiveris.py INPUT.pdf NEW-JOB --runtime-root research/omr/results/quality-wave/toolchain --short-staves --text-models research/omr/results/quality-wave/text-models
python research/omr/prototypes/oemer-quality/collect-audiveris.py research/omr/results/quality-wave/NEW-JOB FIXTURE-ID research/omr/results/quality-wave/NEW-COLLECTION
pnpm --filter @digitus2/engine build
node research/omr/evaluate.mjs --manifest FIXTURE-MANIFEST.json --recognized research/omr/results/quality-wave/NEW-COLLECTION/scores --candidate NAME --out NEW-CARD.json
node research/omr/prototypes/oemer/render-output.mjs research/omr/results/quality-wave/NEW-COLLECTION/render-xml/FIXTURE-ID.musicxml
```

- The runner launches the bundled `java.exe` directly with classpath `app/*` only; `app;app/*` makes Audiveris miss its classifier. Each job gets its own home, AppData, temp, native cache and tessdata, under a 180 s cap that kills the JVM. It keeps the MXL, hashes, arguments and logs. Each job id must be new.
- `--short-staves` sets `LinesRetriever.minStaffLength=12` and `ClustersRetriever.minClusterLengthRatio=0.15`, which keep short staves such as a one-bar final system. Omit it to reproduce the default.
- The collector accepts exactly one whole MXL. It keeps it byte for byte under `scores/` and writes the embedded XML to `render-xml/` for rendering. Reference XML goes only to the scorer, never to recognition.
- `audit_export.py` flags tempo text without a beat unit (`metronome-beat-unit-unresolved`) and missing meter (`meter-unresolved`). It never edits the XML.

## Cached oemer diagnostic

```powershell
research/omr/results/local-options/.venv/Scripts/python.exe -m unittest discover -s research/omr/prototypes/oemer-quality -v
research/omr/results/local-options/.venv/Scripts/python.exe research/omr/prototypes/oemer-quality/run-cached.py INPUT.png NATIVE-CACHE.pkl NEW-JOB --correction raw-image
```

This uses the environment and source prepared by `../oemer/setup.ps1`. It rebuilds the score from saved oemer masks, without fresh inference. The hollow-notehead correction raised Twinkle's full-note F1 from 88.37% to 91.47% but left the metronome and timing errors. It is not used by the product.
