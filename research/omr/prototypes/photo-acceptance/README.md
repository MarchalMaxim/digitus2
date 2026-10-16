# Private-photo acceptance tools

Read-only research helpers. They do not run a recognizer, generate replacement MusicXML, repair a result, select a model, or alter the product. Python 3.11 standard library only.

```powershell
python -m unittest discover -s research/omr/prototypes/photo-acceptance -v
python research/omr/prototypes/photo-acceptance/inspect_omr.py SAVED.omr --out research/omr/results/photo-acceptance/grid.json
python research/omr/prototypes/photo-acceptance/check_score.py RAW.musicxml --truth PRIVATE-ANCHORS.json --out research/omr/results/photo-acceptance/check.json
```

Private source photographs, tiny manually read truth anchors, diagnostic regions, actual outputs and JSON checks belong only under ignored `research/omr/results/photo-acceptance/`. Do not commit them. Synthetic parser tests are redistributable and remain separate from private truth. Pass the same fixed private anchor file to matched controls; do not replace an app result with a hand transcription. A private source hash verifies case identity; it is not a recognition input.

`check_score.py` normalizes note timing in quarter-note units, including chords, backups and forwards. It checks a few explicitly supplied source anchors/regions and structural expectations. Checks are exact local facts, **not full-page note accuracy or F1**. Passing the opening/ending anchors alone does not certify the middle of a page. XML pitch alterations and displayed accidental glyphs are different: inspect both semantics and the actual render. The helper is a compact diagnostic, not a replacement for the project's strict importer/evaluator.

`inspect_omr.py` reads the saved `.omr` ZIP's XML grid records without executing upstream code or extracting archive filenames. Compare detected staff coordinates to the original and saved binary: missing curved staff groups can precede every later clef/chord/rhythm error. A low staff count alone does not identify a unique cause.

For each candidate, review: main systems/staff pairing and visible bar spans; opening chord/rest duration; both hands in every main bar; editorial alternatives/footnotes excluded or explicitly separated; a small visible accidental/pitch anchor; the final chord/bass rhythm; malformed ties and inferred context. Preserve raw XML and record source/preparation/model identity. No visible meter or prior-page context should be manufactured into a source truth claim.
