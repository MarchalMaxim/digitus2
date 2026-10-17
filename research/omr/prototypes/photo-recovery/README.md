# Photo recovery patches and diagnostics

Maintains two of the three homr source patches that `../homr-photo/setup.ps1` applies, plus the diagnostics that led to them. Run setup through that script; do not patch a live source tree by hand. The patches run on an isolated copy of the AGPL upstream source, and no third-party source, weights or private photos belong in tracked files.

- `patch_accidentals.py SOURCE` (`upstream-accidentals.patch`) completes accidental display in homr's MusicXML generator from the recognised pitch, key and measure state. It does not change pitches, notes, durations, ties or voices.
- `patch_boundaries.py SOURCE` (`upstream-boundaries.patch`) masks a detached, smaller five-line staff in a grand staff's lower decoder margin before decoding. The uploaded bytes are untouched. Each decision is written to `*_foreign-staff-N.json` and shown as a review warning. The search is capped at sixteen line components (4,368 five-line combinations), and ambiguous margins are left alone.

Tests, using the prepared homr environment:

```powershell
$env:PYTHONPATH='research/omr/results/photo-options/toolchain/venv/Lib/site-packages'
python -m pytest research/omr/prototypes/photo-recovery/test_accidental_display.py research/omr/prototypes/photo-recovery/test_foreign_staff.py -q
node research/omr/prototypes/photo-recovery/render_accidentals.mjs
```

The accidental cases cover key signatures, naturals, repetitions, octaves, separate staves, simultaneous voices, chords and ties across bars. The foreign-staff cases check that main-staff pixels, same-size ledger chords, full-width following systems and noise are kept.

Diagnostics, not used in the product:

- `geometry.py` measures horizontal line structure.
- `diagnostic_rectify.py` flattens curved staves from hand-supplied crop bounds and staff seeds. It improved Audiveris's staff grouping but never produced acceptable music.
- `run_control.py` runs a bounded Audiveris job and lists all its exports. It never picks the largest one.
- `decoder_illumination_control.py` runs decoder-only controls on real staff images. Its manual cue-exclusion control led to the generic five-line detector; the product path uses no photo-specific rows.

Private evidence stays in the ignored `research/omr/results/photo-recovery/`.
