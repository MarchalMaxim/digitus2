# Photo recovery controls

The automatic candidate uses the pinned HOMR source prepared by
`../homr-photo/setup.ps1`. That setup applies two explicit patches maintained here:

- `patch_accidentals.py SOURCE`: completes MusicXML accidental **display** inside
  the upstream generator from the already-recognized pitch/alter, key and measure
  state. It does not change pitches, notes, duration, ties or voices.
- `patch_boundaries.py SOURCE`: isolates a selected grand staff from a detached,
  smaller five-line staff inside the decoder's lower margin. It masks only the
  detected narrow region before model decoding. Original uploaded bytes stay
  unchanged. Each decision is retained in `*_foreign-staff-N.json` and must be
  exposed as a review warning. This is experimental geometry, not a guarantee that
  every omitted example is irrelevant.

Run setup through the single HOMR preparation entrypoint; do not patch a live
source tree manually. Prepared-source manifests fail closed on unexpected changes.
The patches run inside an isolated upstream source copy with its AGPL license.
No third-party source, weights or private book photos belong in tracked outputs.

Focused helper checks use host pytest and the already-installed model environment:

```powershell
$env:PYTHONPATH='research/omr/results/photo-options/toolchain/venv/Lib/site-packages'
python -m pytest research/omr/prototypes/photo-recovery/test_accidental_display.py research/omr/prototypes/photo-recovery/test_foreign_staff.py -q
node research/omr/prototypes/photo-recovery/render_accidentals.mjs
```

The accidental cases cover key signatures, naturals, repetitions, octaves,
independent staves, simultaneous voices, chords, ties across bars and unchanged
musical content. Foreign-staff cases preserve main-staff pixels, same-size ledger
chords, full-width following systems and arbitrary noise. Search is capped at
sixteen line components (at most 4,368 five-line combinations), with ambiguous
margins retained.

The remaining scripts are retained **diagnostics**, not production preprocessing:

- `geometry.py` measures horizontal line structure.
- `diagnostic_rectify.py` uses explicitly supplied crop bounds and staff seeds to
  test independent curved-staff flattening. These manually guided Audiveris
  experiments improved staff grouping but did not produce accepted music.
- `run_control.py` runs a bounded isolated Audiveris diagnostic and inventories all
  exports. It never silently chooses the largest movement.
- `decoder_illumination_control.py` performs matched decoder-only controls on
  retained real staff canvases. `--clip-bottom` records an explicitly manual
  diagnostic boundary. Its successful cue-exclusion control motivated the generic
  five-line detector; no fixed photo-specific row is used in the automatic path.

Private evidence stays under ignored `research/omr/results/photo-recovery/`.
A parseable export or a successful process is not evidence of accurate music;
actual source/result review remains required.
