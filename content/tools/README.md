# content/tools: building the built-in library

These scripts produce everything in `content/scores/`, `content/manifest.json`
and `content/verification.json`. Provenance, licenses and the reasons behind
each choice are documented in `docs/research/content-library.md`.

## Quick start (regenerates everything)

```bash
# from the repository root; on Linux/macOS use content/.venv/bin/python
python -m venv content/.venv
content/.venv/Scripts/python -m pip install -r content/requirements.txt
content/.venv/Scripts/python -I content/tools/fetch_mutopia.py      # downloads into content/_raw/ (gitignored)
content/.venv/Scripts/python -I content/tools/build.py --png        # convert, arrange, validate, write manifest
content/.venv/Scripts/python -I -m pytest content/tools/tests -q -p no:cacheprovider
```

`build.py --only <slug> ...` rebuilds individual pieces and keeps the other
manifest entries. Run Python with `-I` (isolated mode) because the pipeline
reads downloaded, untrusted files.

## Files

| File | Role |
|---|---|
| `catalog.json` | Single source of truth: one entry per piece (slug, level, metadata, default tempo, Mutopia directory, conversion options such as excerpt range, LilyPond patches, key-name override). |
| `fetch_mutopia.py` | Downloads `.ly`, the published `.mid`, `.rdf` metadata and the A4 PDF for every Mutopia piece in the catalog from mutopiaproject.org. Logs URLs, SHA-256 and retrieval dates in `content/_raw/mutopia/fetch_log.json`. |
| `lilypond/xmldump.ily` | Scheme engravers loaded into LilyPond. They observe LilyPond's interpretation of the score (notes, rests, ties, beams, slurs, tuplets, grace notes, articulations, fingerings, dynamics, hairpins, pedals, clefs, keys, time signatures, bar lines, volta brackets, tempo marks) and write JSON lines. |
| `ly2musicxml.py` | Copies a source to `content/_build/<slug>/`, applies catalog patches, upgrades it with `convert-ly`, compiles it with LilyPond 2.24 and `xmldump.ily`, then writes partwise MusicXML 4.0: one part, two staves, voices packed per staff. Writes a stripped copy and, when the source has fingerings, a `.fingered` copy. Also usable as a CLI (`--help`). |
| `arrange.py` | Our own arrangements, written in a compact LilyPond-like note spec and built with music21. The output is deterministic (fixed encoding date and ids). |
| `xmlcheck.py` | Independent MusicXML timeline reader, a minimal MIDI reader, repeat unfolding and note-by-note comparison. |
| `validate.py` | Quality gate for every score: size and encoding, MusicXML 4.0 XSD, xmlcheck checks (staves, key and time, measure numbering, voice overlaps, overfull bars, durations, piano range, fingering presence) and a music21 parse. Renders the first page with verovio to `content/_preview/<slug>.svg` (and `.png` with `--png`). |
| `render.py` | verovio rendering helper (SVG, optional PNG). |
| `build.py` | Orchestrates fetch results, conversion, arrangements, MIDI cross-checks, validation, `manifest.json` and `verification.json`. |
| `tests/` | pytest: arrangement melodies against reference transcriptions, a converter regression fixture (`fixtures/features.ly`), and library-wide manifest and validation checks. |

## How a Mutopia piece is verified

1. **Notes:** the MusicXML is compared with the MIDI that LilyPond 2.24 renders
   from the same (upgraded) source, and with the MIDI the Mutopia Project
   published years ago from the original source. The comparison is per staff,
   on the sets of (onset, pitch), with repeats unfolded when the MIDI was
   unfolded. All pieces match LilyPond 2.24 exactly. The results are in
   `content/verification.json`.
2. **Schema:** every file is valid against the W3C MusicXML 4.0 XSD.
3. **Two readers:** xmlcheck and music21 both parse every file.
4. **Rendering:** verovio loads and engraves every file. The previews were
   inspected by eye against LilyPond's own rendering.

## Generated and ignored directories

| Path | Content | In git? |
|---|---|---|
| `content/_raw/` | Downloads (Mutopia sources, MusicXML XSD, reference wikitext) | no |
| `content/_build/` | LilyPond build dirs: upgraded source, dump, MIDI, PDF | no |
| `content/_preview/` | verovio SVG/PNG of page 1 of each score, plus `validation.json` | no (regenerate with `build.py --png`) |
| `content/.venv/` | Python virtual environment | no |
