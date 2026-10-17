# Private-photo acceptance tools

Read-only helpers for checking a recognised photo against the source. They run no recogniser, repair nothing and do not change the product. Python 3.11 standard library only.

```powershell
python -m unittest discover -s research/omr/prototypes/photo-acceptance -v
python research/omr/prototypes/photo-acceptance/inspect_omr.py SAVED.omr --out research/omr/results/photo-acceptance/grid.json
python research/omr/prototypes/photo-acceptance/check_score.py RAW.musicxml --truth PRIVATE-ANCHORS.json --out research/omr/results/photo-acceptance/check.json
```

- `check_score.py` normalises note timing to quarter-note units, including chords, backups and forwards. It then checks a few hand-read source anchors and structural expectations. These are exact local facts, not page accuracy or F1: passing the opening and ending anchors says nothing about the middle. Pitch alterations in the XML and the accidentals drawn in the render are different things, so inspect both.
- `inspect_omr.py` reads the staff grid records of a saved Audiveris `.omr` archive without running upstream code or extracting files. Missing curved staff groups often explain every later clef, chord and rhythm error.

Private photos, truth anchors, outputs and reports belong only in the ignored `research/omr/results/photo-acceptance/`; the synthetic tests here are redistributable. Use the same anchor file for every compared candidate, and never substitute a hand transcription for an app result.

Review checklist for a candidate: main systems and staff pairing, visible bar spans, the opening chord or rest duration, both hands in every main bar, editorial alternatives and footnotes excluded or flagged, one visible accidental, the final chord and bass rhythm, malformed ties, and inferred key or meter.
