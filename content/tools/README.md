# content/tools: building the built-in library

These scripts produce everything in `content/scores/`, `content/manifest.json`
and `content/verification.json`. Provenance, licences and the reasons behind
each choice are in `docs/research/content-library.md`: the first 30 pieces,
then the section "L1 curated library (2026-10-14)" for the 119 pieces the L1
plan added (`docs/superpowers/plans/2026-10-14-l1-curated-library.md`). The
13-piece expansion (162 total), its source decisions and verification are
recorded in `docs/research/library-expansion-2026-10-15.md`; its reproducible
entries are in `catalog.d/expansion-bach.json` and `expansion-teaching.json`.

## Environment

- **Python 3.11** in `content/.venv`, with the packages pinned in
  `content/requirements.txt`:
  - the `lilypond` 2.24.3 wheel, which provides LilyPond itself:
    `ly2musicxml.lilypond_bin()` finds it, and nothing goes on `PATH`;
  - music21, verovio, lxml, resvg-py and pytest.

  Nothing else is installed. On Windows, create the venv with the full path
  of a Python 3.11 `python.exe`: bare `python` or the `py` launcher may pick
  another version.
- **Worktrees share one environment.** In a worktree made by
  `node scripts/worktree-add.mjs`, `content/.venv` and `content/_raw` are
  directory junctions (symlinks on Linux and macOS) to the main checkout. All
  worktrees therefore share one environment and one download folder. Create
  the venv through the junction, and remove a worktree only with
  `scripts/worktree-remove.mjs`.
- **Isolated mode.** Run every script from the repository root with `-I`,
  because the pipeline reads downloaded, untrusted files. Isolated mode
  ignores `PYTHONIOENCODING`, so each script switches its own output to UTF-8.
- **Node for the lint gate.** `gates.py` and `lint_gate.py` run the built
  engine CLI, `packages/engine/dist/cli/main.js`, with `node`. Build it with
  `pnpm --filter @digitus2/engine build`, and do not rebuild it while a gate
  is running.
- **Interpreter path.** Below, `PY=content/.venv/Scripts/python.exe` on
  Windows (Git Bash) and `PY=content/.venv/bin/python` on Linux and macOS.

## Quick start (regenerates everything)

```bash
# from the repository root
<python3.11> -m venv content/.venv
$PY -m pip install -r content/requirements.txt
pnpm --filter @digitus2/engine build                 # the CLI that gates.py lints with
$PY -I content/tools/fetch_mutopia.py                # every Mutopia piece of the merged catalog -> content/_raw/mutopia/
$PY -I content/tools/build.py --png                  # convert, arrange, check MIDI, validate, write manifest + verification
$PY -I content/tools/gates.py --all                  # spans, level proposals, melody checks, lint at medium and large
$PY -I content/tools/repro.py --all                  # optional: rebuild into content/_build/repro, compare byte for byte
$PY -I -m pytest content/tools/tests -q -p no:cacheprovider
```

- **The order matters:** fetch, then build, then gates. `build.py` writes the
  scores and the manifest. `gates.py` reads the built scores and adds its
  records to `verification.json`, so it must run after every build that
  changed a score. A stale lint record shows up as a `scoreSha256` that no
  longer matches its score.
- **Downloads.** `validate.load_schema()` downloads the MusicXML 4.0 XSD into
  `content/_raw/schema/` the first time. Apart from the Mutopia sources, it
  is the only download.
- **Timing.** A full build and a full gate run each take minutes; run them in
  the background. The full test suite validates every score with the XSD and
  music21.

## Working on a few pieces

Several builds can run at once, for example one per implementer:

- `build.py --only SLUG ...` rebuilds those pieces and keeps every other
  manifest entry.
- `gates.py --only SLUG ...` gates only those pieces.
- **The lock.** The read-modify-write of `manifest.json` and
  `verification.json` happens inside `jsonio.library_lock()`, an exclusive
  lock file at `content/_build/.library.lock`. A run waits up to 900 s for
  it. A lock older than 1,800 s, or held by a process that no longer runs, is
  broken.
- **Atomic writes.** Scores and JSON files are written to a temporary name
  and replaced atomically, so a concurrent reader never sees half a file.
- **Order.** Both JSON files are ordered by the data: level, then collection
  display order, then position in the merged catalog. The order does not
  depend on which build finished first.

Adding a Mutopia engraving:

1. Write its entry in your fragment, `catalog.d/<fragment>.json`, from the
   fetched facts in `candidates.json`. The fields are documented in
   `catalog.json`'s `_comment`.
2. Download it: `$PY -I content/tools/fetch_mutopia.py <ftpDir>`.
3. Build and gate it:
   `$PY -I content/tools/build.py --only <slug> --png`, then
   `$PY -I content/tools/gates.py --only <slug>`. Every gate must pass. A
   piece that fails is excerpted (`convert.barTo` plus `excerpt` text),
   replaced by a spare, or dropped into the fragment's `rejected` list with
   the reason. It is never shipped with a flag.
4. Set the level: run `$PY -I content/tools/level.py --report`, then write
   `levelNote` (a syllabus placement and the proposal). A final level more
   than one away from the proposal needs `levelOverride`.
5. Check the score by eye: compare `content/_preview/<slug>.png` with
   LilyPond's own engraving of the source. Fix a fault with a catalog patch
   (below). Never edit a score by hand.
6. Run `$PY -I -m pytest content/tools/tests -q -p no:cacheprovider -k <slug>`.

Adding an own arrangement:

1. Find a dated, notated source for the melody first. Type its pitches into
   `REFERENCES` of the collection module in `arrangements/`, and keep the
   retrieved page under `content/_raw/references/`.
2. Write the catalog entry with its `melody` block (`authors` with death
   years, or `"traditional"`; `firstPublished`; `reference`). Then write the
   arrangement in `PIECES`, following the level rules in the module's header
   comment.
3. Build and gate it as above. The melody gate compares the top line of the
   built score with the reference.

**Catalog patches** (`convert.patches`): a list of
`{file, find, replace, count, stage, dotall}`, applied as regular
expressions to the copy of the source in `content/_build/<slug>/src/`.

- A `"pre"` patch runs before `convert-ly`, and the default `"post"` patch
  runs after it, on the upgraded syntax.
- `count` must match exactly, or the build fails.
- Use at most two patches per piece, and give the reason in `notes`.

## Files

| File | Role |
|---|---|
| `catalog.json` | The core 30 pieces and the `collections` table (id, title, kind, in display order), schemaVersion 2. Its `_comment` documents every catalog field. |
| `catalog.d/*.json` | One fragment per implementer (`{task, pieces, rejected}`, where `task` is the plan's task number as an integer; `test_every_fragment_has_the_documented_shape` checks the shape), merged after `catalog.json` in file-name order. Slugs must be unique across all of them. `rejected` keeps every candidate that was not shipped, with the reason, and for a held piece its full entry and a `reinstate` instruction. |
| `candidates.json` | The L1 plan's Mutopia candidates, main and spare, with the facts the fetch wrote back: RDF licence, `lyFile`, maintainer, LilyPond version, MIDI files, PDF pages, `mainSha256`, `mirrorMatch`. |
| `fetch_mutopia.py` | Downloads the `.ly` (or `-lys.zip`), the published MIDI, the RDF and the A4 PDF of every Mutopia piece in the merged catalog, or of the named directories. It logs URL, SHA-256 and retrieval time in `content/_raw/mutopia/fetch_log.json` and never executes what it downloads. `--candidates PATH` also fetches the candidates and writes their facts back into that file; `--only-candidates` fetches only those; `--force` downloads again. |
| `lilypond/xmldump.ily` | Scheme engravers loaded into LilyPond. They observe LilyPond's interpretation of the score and write it as JSON lines: notes, rests, ties, beams, slurs, tuplets, grace notes, articulations, fingerings, dynamics, hairpins, pedals, clefs, keys, time signatures, bar lines, voltas and tempo marks. |
| `ly2musicxml.py` | Copies a source to `content/_build/<slug>/`, applies the catalog patches, upgrades it with `convert-ly`, compiles it with LilyPond 2.24 and `xmldump.ily`, and writes partwise MusicXML 4.0. The output has one part with two staves and voices packed per staff, as a stripped copy plus a `.fingered` copy when the source has fingerings. As a CLI (`--help`), pass absolute `--build` and `--out` paths: LilyPond runs in the source directory, so relative ones fail. `build.py` is not affected. |
| `arrange.py` | Our own arrangements, in a compact LilyPond-like note language built with music21. The output is deterministic (fixed encoding date `ENCODING_DATE` and fixed ids). `PIECES` is the ten core arrangements (`CORE_PIECES`) followed by the collection modules. |
| `arrangements/` | One module per collection (`children`, `christmas`, `hymns`, `folk`, `songs`), each with `PIECES` and `REFERENCES`, the published melody each arrangement must reproduce. `__init__.py` loads them (`load()`, `reference(slug)`), reads a built score's top line and checks it against the reference (`melody_check`). |
| `xmlcheck.py` | An independent MusicXML timeline reader, a minimal MIDI reader, repeat unfolding and a note-by-note comparison. |
| `validate.py` | The quality gate for every file: size and encoding, the MusicXML 4.0 XSD, and xmlcheck's structural checks (staves, key and time, measure numbering, voice overlaps, overfull bars, durations, piano range, fingering presence). It also parses each file with music21 and renders page 1 with verovio to `content/_preview/<slug>.svg` (`.png` with `--png`). |
| `render.py` | The verovio rendering helper (SVG, optional PNG). |
| `build.py` | Merges the catalog, then for each piece converts or arranges it and runs the MIDI cross-checks and the validation. It writes the scores, `manifest.json` and `verification.json` under the lock. `--only SLUG...` builds those pieces only; `--png` writes PNG previews; `--no-validate` skips validation. `--manifest-only` re-renders every manifest entry from the catalog without converting anything; it refuses while a catalog piece is unbuilt. `--out-dir DIR` writes the scores to DIR and prints the MIDI checks, touching nothing else. It refuses a licence other than public domain, CC BY or CC BY-SA. |
| `gates.py` | The post-build gates; run it after `build.py`. It runs the span check over the whole library, the level proposal, the melody check (own arrangements) and the lint gate, and records `levelProposal`, `melody` and `lint` per piece in `verification.json`. `--only SLUG...`, `--new` (every piece outside `core30`) or `--all`; `--no-lint` skips the lint. It exits 1 when a piece outside `core30` fails. Core-30 failures are reported as exempt. |
| `check_spans.py` | Flags slices that no single hand can strike (span over 15 semitones, more than five keys, or no valid finger order) and writes `spanFlags` into `verification.json` under the lock. `--no-write` only prints. `gates.py` calls it. |
| `level.py` | The level heuristic: `features`, `score`, `propose` with the frozen `CUTS`, plus `calibrate` and `leave_one_out` on the core 30. `--report` prints the proposal table for every manifest piece; `--write [--only SLUG...]` stores `levelProposal`. |
| `lint_gate.py` | Fingers a score with the built engine CLI at the medium and large profiles and lints each fingering (PIG files in `content/_build/lint/`). A record holds the counts, the score's SHA-256 and the engine source's SHA-256. `SLUG...` prints the records as JSON. |
| `repro.py` | `--core30` or `--all`: rebuilds those pieces into `content/_build/repro` (`build.py --out-dir`) and compares every file byte for byte with `content/scores/`. It exits 1 on any difference. |
| `jsonio.py` | `library_lock()`, `write_atomic()`, `write_json()` and `update_json()`: the lock and the atomic writes for the shared JSON files. |
| `musicxml2midi.py` | MusicXML to a format-1 MIDI file with the true hands as tracks (RH, LH), for engine test fixtures. |
| `tests/` | pytest. `test_core30.py` pins the 38 core files by SHA-256 (`fixtures/core30.json`). The other files cover the catalog and fragments, the candidates, `jsonio`, the level heuristic, the lint gate, the gates, the arrangements and their melodies, the converter (`fixtures/features.ly`) and library-wide consistency (`test_library.py`, including the counts per level). |

## How a piece is verified

1. **Notes, Mutopia engravings.** The MusicXML is compared with two MIDI
   files: the one LilyPond 2.24 renders from the same upgraded and patched
   source, and the one the Mutopia Project published from the original
   source. The comparison is per staff, on sets of (onset, pitch), with
   repeats unfolded when the MIDI unfolds them. The LilyPond 2.24 check must
   be exact. The published-MIDI check may differ only with a written reason
   in the piece's `notes`.
2. **Melody, own arrangements.** The top line of staff 1 of the built score
   must equal the reference melody, or its intervals when the reference is
   transposed.
3. **Schema and two readers.** Every file is valid against the W3C MusicXML
   4.0 XSD, and xmlcheck and music21 both parse it.
4. **Rendering.** verovio loads and engraves every file, and the previews
   are checked by eye against LilyPond's own engraving.
5. **Playability.** No slice that one hand cannot strike (`check_spans.py`).
   Zero lint law errors (L01 to L05) on the engine's own fingering at the
   medium and the large profile. The core 30 are exempt; their known flags
   are recorded.
6. **Level.** The final level is within one of the heuristic's proposal,
   or `levelOverride` gives the reason.
7. **Rebuild.** `repro.py --all` rebuilds every file byte for byte from the
   catalog and the fetched sources, which `sourceSha256` pins.
8. **Credit.** A CC BY or CC BY-SA engraving names its typesetter, Mutopia
   id, licence and licence URL in the manifest and in the `<rights>` element
   of the score and of its `.fingered` copy; a CC BY one also says that
   attribution is required (`gates.py`,
   `test_every_cc_engraving_is_credited_in_rights`).

## Generated and ignored directories

| Path | Content | In git? |
|---|---|---|
| `content/_raw/` | Downloads: Mutopia sources and `fetch_log.json`, the MusicXML XSD, and the reference pages of the arrangements (`references/`). A junction to the main checkout in worktrees. | no |
| `content/_build/` | LilyPond build directories (upgraded source, dump, MIDI, PDF), `repro/`, `lint/` (PIG fingerings) and the lock file `.library.lock` | no |
| `content/_preview/` | The verovio SVG and PNG of page 1 of each score, plus `validation.json` | no (regenerate with `build.py --png`) |
| `content/.venv/` | The Python virtual environment; a junction to the main checkout in worktrees | no |
