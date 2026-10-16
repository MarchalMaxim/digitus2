# Native OMR quality adapters

Research only. Audiveris 5.11.0 is AGPL-3.0-or-later; our wrappers do not relicense it. No binaries or raw scores are committed. See the [quality report](../../../../docs/research/omr-quality-wave-2026-10-15.md) for actual untouched before/after results and limitations.

Use Python 3.11. Native adapters use only the standard library; cached oemer diagnostics use the baseline research venv/dependencies.

## Existing runtime

```powershell
python research/omr/prototypes/oemer-quality/run-audiveris.py INPUT.png new-job --short-staves
python research/omr/prototypes/oemer-quality/collect-audiveris.py research/omr/results/quality-wave/new-job FIXTURE-ID research/omr/results/quality-wave/new-collection
pnpm --filter @digitus2/engine build
node research/omr/evaluate.mjs --manifest FIXTURE-MANIFEST.json --recognized research/omr/results/quality-wave/new-collection/scores --candidate audiveris-review --out NEW-CARD.json
node research/omr/prototypes/oemer/render-output.mjs research/omr/results/quality-wave/new-collection/render-xml/FIXTURE-ID.musicxml
```

The default runtime root is the previously checked/extracted `research/omr/results/audiveris-spike`. For a fresh checkout, run `powershell -NoProfile -File research/omr/prototypes/oemer-quality/prepare-audiveris.ps1`, then pass `--runtime-root research/omr/results/quality-wave/toolchain` to the native runner. Setup downloads the official 85 MB MSI, checks its published digest and uses administrative extraction into ignored data, never normal product installation. Existing targets are preserved.

The runner launches bundled Java directly (app/* only), isolates user.home/APPDATA/LOCALAPPDATA/temp/native caches per job, has a 180-second default cap and kills its owned JVM on timeout. Each run ID must be new. Actual MXL/OMR, input/archive hashes, arguments and logs are retained. No HTTP service or external recognizer is started.

`--short-staves` applies two fixed supported Audiveris constants: LinesRetriever.minStaffLength=12 and ClustersRetriever.minClusterLengthRatio=0.15. It fixes the development image's short final system and had unchanged strict results on six other clean images, including four held-out pages. It is not a universal accuracy guarantee or silent XML repair. Omit it to reproduce default behavior.

Collector accepts exactly one whole MXL, preserves it byte-for-byte under `scores/`, and writes unchanged embedded XML separately under `render-xml/`. Multiple XML/MXL files under the same scoring ID are ambiguous and deliberately rejected by the evaluator. References are only passed to scoring, never recognition.

## Cheap oemer diagnostic

```powershell
research/omr/results/runtime-diagnosis/.venv/Scripts/python.exe -m unittest discover -s research/omr/prototypes/oemer-quality -v
research/omr/results/runtime-diagnosis/.venv/Scripts/python.exe research/omr/prototypes/oemer-quality/run-cached.py INPUT.png ASSOCIATED-NATIVE-CACHE.pkl new-cached-job --correction raw-image
```

Only locally generated NumPy/SVC cache values are allowlisted. These runs are explicitly reconstruction from saved masks, not fresh inference. The original-image hollow-head correction improves two real durations but leaves metronome/timing errors; the equation detector abstains when evidence is insufficient. It is not the selected integration path.

## Original PDF and text OCR

Prefer original PDF bytes; do not rasterize them in the browser.

```powershell
powershell -NoProfile -File research/omr/prototypes/oemer-quality/prepare-text-models.ps1
python research/omr/prototypes/oemer-quality/run-audiveris.py INPUT.pdf new-pdf-job --short-staves --text-models research/omr/results/quality-wave/text-models
```

Setup verifies the pinned official Apache-2.0 legacy-capable English model (23.47 MB) and retains LICENSE. LSTM-only fast models are incompatible. Runner isolates tessdata/settings and records the model hash. Recognition never reads reference XML. The export audit flags unresolved equation-like tempo text without a beat unit and absent meter; raw XML remains unchanged. Twinkle still lacks metronome/BPM despite exact note matching. Treat exports as unreviewed.
