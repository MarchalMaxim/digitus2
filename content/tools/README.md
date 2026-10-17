# content/tools: building the built-in library

These scripts produce everything in `content/scores/`, `content/manifest.json`,
`content/verification.json` and `content/library-index.json`. The library has
2,702 pieces in six lanes:

| Lane | Catalog | Pieces | Documented in |
|---|---|---:|---|
| Core 30 (own arrangements and Mutopia engravings) | `catalog.json` | 30 | `docs/research/content-library.md` |
| L1 curated library | `catalog.d/` collection fragments | 119 | `docs/research/content-library.md`, section "L1 curated library" |
| Mutopia expansion | `catalog.d/expansion-bach.json`, `expansion-teaching.json` | 13 | [Mutopia expansions](#mutopia-expansions) |
| Bulk Mutopia | `catalog.d/expansion-bulk.json` | 91 | [Mutopia expansions](#mutopia-expansions) |
| MuseScore archive, classical | `catalog.d/pdmx-library.json`, `pdmx-advanced.json` | 1,449 | [MuseScore archive scores](#musescore-archive-scores-pdmx) |
| MuseScore archive, songs | `catalog.d/pdmx-songs.json` | 1,000 | [MuseScore archive scores](#musescore-archive-scores-pdmx) |

The first four lanes are the curated core of 253 pieces. Provenance, licences
and the reasons behind each choice for the first 149 are in
`docs/research/content-library.md`.

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

Several builds can run at once:

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
| `bulk_sources.py` | The bulk Mutopia collector (see [Mutopia expansions](#mutopia-expansions)). `--download` inventories the local mirror and caches canonical RDF and published MIDI with four workers; `--refresh` reconciles the cached metadata offline without resetting download status. |
| `bulk-candidates.json` | The committed index of the bulk lane: every inventoried edition with its source and RDF hashes, the counts, and the admission state regenerated from `expansion-bulk.json`. |
| `lilypond/xmldump.ily` | Scheme engravers loaded into LilyPond. They observe LilyPond's interpretation of the score and write it as JSON lines: notes, rests, ties, beams, slurs, tuplets, grace notes, articulations, fingerings, dynamics, hairpins, pedals, clefs, keys, time signatures, bar lines, voltas and tempo marks. |
| `ly2musicxml.py` | Copies a source to `content/_build/<slug>/`, applies the catalog patches, upgrades it with `convert-ly`, compiles it with LilyPond 2.24 and `xmldump.ily`, and writes partwise MusicXML 4.0. The output has one part with two staves and voices packed per staff, as a stripped copy plus a `.fingered` copy when the source has fingerings. As a CLI (`--help`), pass absolute `--build` and `--out` paths: LilyPond runs in the source directory, so relative ones fail. `build.py` is not affected. |
| `arrange.py` | Our own arrangements, in a compact LilyPond-like note language built with music21. The output is deterministic (fixed encoding date `ENCODING_DATE` and fixed ids). `PIECES` is the ten core arrangements (`CORE_PIECES`) followed by the collection modules. |
| `arrangements/` | One module per collection (`children`, `christmas`, `hymns`, `folk`, `songs`), each with `PIECES` and `REFERENCES`, the published melody each arrangement must reproduce. `__init__.py` loads them (`load()`, `reference(slug)`), reads a built score's top line and checks it against the reference (`melody_check`). |
| `xmlcheck.py` | An independent MusicXML timeline reader, a minimal MIDI reader, repeat unfolding and a note-by-note comparison. |
| `validate.py` | The quality gate for every file: size and encoding, the MusicXML 4.0 XSD, and xmlcheck's structural checks (staves, key and time, measure numbering, voice overlaps, overfull bars, durations, piano range, fingering presence). It also parses each file with music21 and renders page 1 with verovio to `content/_preview/<slug>.svg` (`.png` with `--png`). |
| `render.py` | The verovio rendering helper (SVG, optional PNG). |
| `scoreio.py` | `plain_path`: a plain MusicXML copy in `content/_build/plain/` of a gzip-compressed archive score, for the tools that read a score by path (engine CLI, xmlcheck, level features). |
| `build.py` | Merges the catalog, then for each piece converts or arranges it and runs the MIDI cross-checks and the validation. It writes the scores, `manifest.json` and `verification.json` under the lock. `--only SLUG...` builds those pieces only; `--png` writes PNG previews; `--no-validate` skips validation. `--manifest-only` re-renders every manifest entry from the catalog without converting anything; it refuses while a catalog piece is unbuilt. `--out-dir DIR` writes the scores to DIR and prints the MIDI checks, touching nothing else. It refuses a licence other than public domain, CC BY or CC BY-SA. The optional catalog field `compactXml: true` removes only intertag indentation from the generated XML, to stay within the repository's storage budget. |
| `gates.py` | The post-build gates; run it after `build.py`. It runs the span check over the whole library, the level proposal, the melody check (own arrangements) and the lint gate, and records `levelProposal`, `melody` and `lint` per piece in `verification.json`. `--only SLUG...`, `--new` (every piece outside `core30`) or `--all`; `--no-lint` skips the lint. It exits 1 when a piece outside `core30` fails. Core-30 failures are reported as exempt. |
| `check_spans.py` | Flags slices that no single hand can strike (span over 15 semitones, more than five keys, or no valid finger order) and writes `spanFlags` into `verification.json` under the lock. `--no-write` only prints. `gates.py` calls it. |
| `level.py` | The level heuristic: `features`, `score`, `propose` with the frozen `CUTS`, plus `calibrate` and `leave_one_out` on the core 30. `--report` prints the proposal table for every manifest piece; `--write [--only SLUG...]` stores `levelProposal`. |
| `lint_gate.py` | Fingers a score with the built engine CLI at the medium and large profiles and lints each fingering (PIG files in `content/_build/lint/`). A record holds the counts, the score's SHA-256 and the engine source's SHA-256. `SLUG...` prints the records as JSON. |
| `repro.py` | `--core30` or `--all`: rebuilds those pieces into `content/_build/repro` (`build.py --out-dir`) and compares every file byte for byte with `content/scores/`. It exits 1 on any difference. |
| `jsonio.py` | `library_lock()`, `write_atomic()`, `write_json()` and `update_json()`: the lock and the atomic writes for the shared JSON files. |
| `musicxml2midi.py` | MusicXML to a format-1 MIDI file with the true hands as tracks (RH, LH), for engine test fixtures. |
| `pdmx_*.py`, `dedupe.py`, `pdmx-excluded.json` | The MuseScore archive pipeline and its committed exclusion list (see [below](#musescore-archive-scores-pdmx)). |
| `tests/` | pytest. `test_core30.py` pins the 38 core files by SHA-256 (`fixtures/core30.json`). The other files cover the catalog and fragments, the candidates, `jsonio`, the level heuristic, the lint gate, the gates, the arrangements and their melodies, the converter (`fixtures/features.ly`) and library-wide consistency (`test_library.py`, including the counts per level). |

## How a piece is verified

1. **Notes, Mutopia engravings.** The MusicXML is compared with two MIDI
   files: the one LilyPond 2.24 renders from the same upgraded and patched
   source, and the one the Mutopia Project published from the original
   source. The comparison is per staff, on sets of (onset, pitch), with
   repeats unfolded when the MIDI unfolds them. The LilyPond 2.24 check must
   be exact. The published-MIDI check may differ only with a written reason
   in the piece's `notes`. An exact result does not cover durations, grace
   timing or expressive notation, which is why step 4 exists.
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

## Mutopia expansions

Both lanes convert Mutopia LilyPond sources with the ordinary pipeline above;
no pre-existing MusicXML edition is downloaded. Each edition's licence comes
from its RDF and the [Mutopia reuse policy](https://www.mutopiaproject.org/legal.html),
not from the composer's dates.

**Mutopia expansion (13 pieces).** Five Bach inventions
(`expansion-bach.json`) and eight teaching pieces (`expansion-teaching.json`:
BWV Anh. 118, three Handel Aylesford pieces, BWV 928, Pleyel, Müller and a
Swedish polska), built and gated like any Mutopia engraving. Decisions:

- Inventions 5 and 12 are held: the converter omits their directional
  mordents. Invention 9 is held: its delayed turn renders as literal
  `scripts.turn` text.
- Invention 6 and BWV Anh. 118 draw their final fermatas as rehearsal-mark
  glyphs. A catalog patch turns them into fermata articulations, and a
  source-specific test protects them, because the MIDI comparison cannot
  see fermatas. Invention 3 needs two syntax-only patches for its old
  LilyPond source.
- Pleyel ships only its 16-bar first theme, because the full piece needs
  D.C. al Fine playback, which the player does not implement. Its source
  title is "Menuett", although the Mutopia metadata says "Rondo".
- The Handel source editions are dated 1930 and carry explicit Mutopia
  public-domain declarations.

**Bulk Mutopia (91 pieces).** `bulk_sources.py` inventories the local
Mutopia mirror (`research/data/mutopia_src/`, see `research/data/README.md`),
keeping editions whose instrument declaration is only piano, harpsichord,
clavichord, keyboard or organ. It reads each edition's canonical RDF and
downloads published MIDI only when the RDF licence permits redistribution
(public domain, CC BY or CC BY-SA). It checks MIDI headers and confines
archive extraction. The committed `bulk-candidates.json` keeps source and RDF
hashes, counts and admission; the ignored `content/_raw/bulk/inventory.json`
keeps download URLs, MIDI hashes and cache paths, and the MIDI files are
cached in `content/_raw/bulk/mutopia/`. A fresh `--download` and an offline
`--refresh` both regenerate admission from `expansion-bulk.json`, so they
never erase a release decision. Accepted pieces build with the ordinary
`build.py` and `gates.py`.

```bash
$PY -I content/tools/bulk_sources.py --download
```

| Inventory | Count |
|---|---:|
| Keyboard editions inventoried | 608 |
| Editions with published MIDI (MIDI files) | 607 (733) |
| Editions not already in the catalog | 519 |
| Public domain / CC BY / CC BY-SA | 369 / 72 / 167 |
| Accepted / held with reasons / already represented | 91 / 428 / 89 |

Admission is stricter than for a hand-picked piece. Every accepted edition is:

- complete: no excerpt, simplification or catalog patch;
- one musical score with exactly one two-staff piano part;
- exact against both the LilyPond 2.24 MIDI and the published Mutopia MIDI.
  Both checks are mandatory, and MIDI inside a ZIP keeps its relative path
  so that the published check cannot silently drop out;
- free of span flags and medium or large law errors;
- within the 700 KB file budget.

Held editions sit in the fragment's `rejected` list with their reasons:

- unsupported notation, also screened in included sibling files, and literal
  musicglyph ornaments or fermatas;
- multi-score anthologies;
- the three editions that offer an organ alternative, pending pedal review;
- editions that lose text from the source, found by comparing source mark
  text with the XML: tempo and header expressions (Handel's Aylesford
  Ouverture loses "Maestoso"), Fine and D.C., a "Trio" label, an "Allegro
  vivace" written as a rehearsal mark, and a sextuplet drawn as 3 instead
  of 6 (BWV 1080 canon XIII);
- Scriabin Op. 16/1, whose adjacent hairpins the renderer mispairs.

None of the ten acquired Rachmaninoff editions passes the gates.

Composer identity comes from each edition's own metadata, never from its FTP
folder: folder-derived attribution put Petzold's name on Bach works. Two
notebook pieces carry qualified attributions. BWV 515 is "Johann Sebastian
Bach (attributed)" (David Schulenberg, [scholarly edition, p. 3](https://faculty.wagner.edu/david-schulenberg/files/2020/03/P225_selections.pdf)).
BWV Anh. 131 is "Johann Christian Bach (attributed)", W.A 22, correcting the
Mutopia label ([IMSLP](https://imslp.org/wiki/March_in_F_major,_W.A_22_(Bach,_Johann_Christian))).
Andrew Sidwell's contemporary original work is credited as a CC BY-SA 2.5
composition and engraving, not a public-domain composition.

The level heuristic was calibrated on the core 30 and never proposes more
than 5, so it cannot grade concert repertoire. Mature complete originals get
a conservative level 6, with a `levelNote` that claims no syllabus placement
and a `levelOverride` where 6 is more than one above the proposal. Teaching pieces keep a reviewed placement within one
of the proposal: Czerny Op. 821/5 went to level 3 rather than 2 for its
chromatic ornaments and density. The lane's levels are 37 at 3, 3 at 4, 1 at
5 and 50 at 6.

Known warnings, not defects:

- music21 cannot pair one diminuendo in Beethoven Op. 31/2, II, whose stop
  precedes its start in document order. The rendered hairpin matches the
  source.
- Verovio reports 36 mixed-beam placement fallbacks in Goldberg variations
  11, 20 and 28. These are layout warnings; no note or dynamic is dropped.

## MuseScore archive scores (PDMX)

2,449 pieces come from PDMX (Long et al. 2025, https://zenodo.org/records/15571083): MuseScore
files whose uploaders declared them public domain or CC0, and which PDMX found free of licence conflicts
(`license_conflict` false). Every one is a solo piano score on two staves with notes on both; the
library's own gates decide the rest. Two lanes. The classical lane (genres classical, folk, religious or unlabelled):
`catalog.d/pdmx-library.json` (1,300 pieces at levels 1 to 5) and `catalog.d/pdmx-advanced.json` (149 pieces at level 6,
some with relaxed gates). The songs lane (every other genre: pop, rock, soundtrack, jazz, blues, at the owner's request
for songs "not necessarily classical or folk"): `catalog.d/pdmx-songs.json` (1,000 pieces, capped by rating).
Their scores are
`scores/<slug>.musicxml.gz` (gzip, mtime 0, byte-identical on a rebuild; the app decompresses them with
the browser's DecompressionStream), and `content/library-index.json` lists every piece for the library
page (compact columnar form, see step 7). The steps, in order (run with `content/.venv/Scripts/python.exe -I`; the inputs are the PDMX
download in `research/data/_downloads/pdmx/`, and every output is under the ignored `content/_raw/pdmx/`
and `content/_build/`, except the committed `pdmx-excluded.json`):

1. `pdmx_screen.py --csv PDMX.csv --archive mxl.tar.gz`: streams the archive once, keeps the
   public-domain or CC0 rows without a licence conflict, genres classical, folk or religious (MuseScore's
   own tags) or unlabelled, 30 to 6,000 notes, and tests every file for a solo piano score.
   `screen.jsonl` has a reason for every rejection.
2. `pdmx_select.py --archive mxl.tar.gz`: keeps 40 to 2,500 notes and the two-staff rule (`grand_staff`:
   one sounding part, two staves), admits an unlabelled score only when its composer is a classical one
   (`CLASSICAL_COMPOSERS`), removes duplicates by title and by identical XML, and copies the chosen files to
   `_raw/pdmx/selected/`. An unnamed composer is kept and shown as "Unknown": the licence rule is the
   uploader's declaration, not the author's date (the owner's broad reading). The 2,500-note
   ceiling leaves out 164 longer candidates.
3. `pdmx_gate.py --grand-staff [--resume] [--limit N]`: for each candidate, the XSD of its own MusicXML
   version (3.1 or 4.0), the span check, notes on both staves, zero lint law errors at the medium and the
   large profile, and the level proposal of the frozen heuristic. `gate.jsonl` holds the results.
4. `dedupe.py [--apply]`: compares notes, not titles. Exact copies (the same notes at the same onsets)
   and near copies (Jaccard 0.9 or more of the (onset, pitch) sets, note counts within 10 percent) are
   removed among the archive pieces, and so is the same tune at the same level (top-line shingles: three
   Mozart minuets in F at level 2 are one piece to a learner); the copy that stays is a curated piece
   first, then a named composer, then the more rated. A curated piece is never removed, and curated
   copies of each other are only listed. The same tune at another level (an easy and a fuller arrangement)
   is reported and kept. `--apply` writes `duplicates` into `pdmx-excluded.json`.
5. `pdmx_scope.py export` and `apply`: MuseScore's genre tags are the uploader's, so a pop song can carry
   "classical". The candidates (best rated first, 2,037 of them, then the 157 relaxed advanced ones with
   `export --unreviewed`) were read by three independently framed reviews; a
   candidate any of them flagged as modern popular music, film, game or musical themes, or Nazi-era
   marches is out of scope (69 of 2,194) and recorded in `outOfScope`.
6. `pdmx_advanced.py` is the rule for level 6 (below). `pdmx_fragments.py [--limit 1300]` writes the two
   fragments: the best-rated passing candidates (a cap in rating order, not a random cut), the advanced
   ones apart and uncapped, skipping every candidate in `pdmx-excluded.json` (build failures, duplicates,
   out of scope). `--record-failures LOG` first adds the pieces a `build.py` log reports as refused.
7. `build.py --source pdmx [--only SLUG...]`: converts nothing (the MusicXML is the archive's own file).
   Source `<fingering>` digits are stripped first (`build.strip_fingerings`); each piece is then validated as a plain copy (`validate.check_file`: XSD, the two-staff rule, measure
   arithmetic and the other library checks), then written gzip-compressed. A failed piece gets no score and
   no manifest entry. A refused piece is recorded and dropped (`--record-failures`); `build.py --source pdmx
   --only SLUG...` then builds just the pieces that the new fragments added. Repeat until a build refuses nothing. `build.py --manifest-only` then
   re-renders every manifest entry, and `build.py` writes `library-index.json` (the eight fields the
   library list reads, in a compact columnar form: `build.library_index` describes it, and
   `decodeLibraryIndex` in `apps/web/src/library/manifest.ts` reads it; 79 KB gzip for 2,702 pieces).
8. `gates.py --pending` (or `--new`) writes the verification records (span check, lint, level). For a
   MuseScore piece the LilyPond 2.24 MIDI cross-check does not apply (there is no Mutopia engraving to
   cross-check); the other gates do.

**The songs lane** (`pdmx_songs.py`). `pdmx_screen.py --other` screens the rows the classical lane
skipped (3,224 metadata rows, 1,765 accepted), `pdmx_select.py` and `pdmx_gate.py` run on them with
`candidates-other.json` and `gate-other.jsonl` (4,228 candidates, 2,482 pass every gate; the songs lane takes no
relaxed gates and no level-6 override), `pdmx_songs.py items` and `apply` carry the review (two removal-only lenses,
junk and content safety: 324 removed), and `reinstate` lifts the genre and copyright-date
exclusions of the classical lane's scope review while keeping the content ones (Nazi-era marches, propaganda, junk).
`pdmx_fragments.py --songs-limit 1000` ships the best rated; jazz and blues go to the Modern genre, the rest to Songs.
Copyright: the owner's broad reading, the uploader's declaration with no author-date check. Post-1929 popular
songs can therefore be in the public repository; the repository carries that risk.

**Why the build refuses scores that the gate passed.** `pdmx_gate.py` checks the XSD, the grand staff, the spans, the
lint laws and the level; the build then runs `validate.check_file` on the file, which is a different, wider set of
checks. A refusal was therefore always a check the gate does not make. Of 390 refusals recorded in the songs lane,
278 were false positives of the pipeline, not bad scores, and 112 were real defects:

| Refusals | Cause | What stops it now |
|---|---|---|
| 193 | `<fingering>` digits: the archive file is stored as it is, and the validator refuses fingerings in a stripped copy | `build.strip_fingerings` removes the elements (and the `<technical>` and `<notations>` they leave empty) before the check; the engine reads source fingerings only as an editorial reference, never to solve, so the gate's lint result is unchanged |
| 94 (a lead sheet's chord symbols) | music21 lists a `<harmony>` chord symbol among `.notes` with a length of 0 | `validate.check_file` skips `music21.harmony.Harmony` in the zero-duration check |
| 112 | overfull bars (53), duplicate measure numbers (21), a backup before the bar start (17), no time signature (14), overlapping notes (5), malformed chord symbols (2) | nothing: the score is defective and stays refused |

(193 and 94 make 287, not 278: nine of those scores also carry a real defect, so they stay among the 112.)

`pdmx_fragments.py --recheck-failures` re-runs every recorded refusal through the build's own check and releases the
ones that pass (a refusal is otherwise kept forever), and `dedupe.py` leaves out a piece the build refuses, so it
cannot be the copy that stays. A piece that still fails is recorded in `pdmx-excluded.json` and dropped
("if the refusals do not work, drop them"); nothing is tried again for it.

**Level 6.** The heuristic has four cut points, so it never proposes 6; the 50 curated Advanced pieces
were placed by hand. An archive piece is placed at 6 by the rule in `pdmx_advanced.py`: a proposal of 5,
or of 4 with a score of 10.9 or more (the middle of that band); at least 60 seconds and 300 notes; and
both sustained fast notes (6 a second) and a stretch of 12 semitones. Speed and stretch are required
together, because either alone admitted pieces that were not advanced. A placement from proposal 4
carries a `levelOverride`. The thresholds were fixed before the yield was known and are not tuned to a
count. 38 archive pieces at level 6 pass every library gate.

**Relaxed gates for level 6** (the owner's decision). Advanced pieces are the ones the span check and
the lint law gate refuse, so a level-6 candidate that meets the rule and fails only those two gates ships
anyway (`pdmx_advanced.relaxed`): its XSD, notes-on-both-staves and validator checks still hold, and the
slices no hand can strike and the lint law errors are recorded in the catalog (`relaxedGates`), in the
piece's notes, and checked by `gates.py` and `test_gates.py` against what the engine finds, so a changed
score or engine cannot slip through. A total waiver would ship pieces where nearly every note breaks a
law (the worst candidate had 1,028 errors per 1,000 notes), so the relaxation has a ceiling of 40
law errors per 1,000 notes at each profile (ten times the engine's measured rate on real pieces, the
benchmark floor of 3.92) and 20 unplayable slices per 1,000 notes; both are constants in
`pdmx_advanced.py` (None lifts them). 111 pieces ship with relaxed gates: a median of 11 law errors a
piece (at most 92), and 92 of them with span flags (470 slices in all, at most 24 in one piece). The
digits at those places are advice.

**Result.** The classical lane screened 175,905 archive rows, kept 8,607 two-staff candidates after
de-duplication and passed 5,449 through every gate; the songs lane gated 4,228 candidates and passed 2,482.
The library ships 1,300 classical pieces at levels 1 to 5, 149 at level 6 (38 passing every gate, 111 with
relaxed gates) and 1,000 songs (979 Songs, 21 jazz and blues under Modern). The archive names a composer
for 462 of the 1,449 classical-lane pieces; the rest read "Unknown".

| Level | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---:|---:|---:|---:|---:|---:|
| Archive pieces | 23 | 168 | 1,332 | 747 | 30 | 149 |
| Whole library (253 curated + 2,449 archive) | 47 | 212 | 1,415 | 784 | 45 | 199 |

## Generated and ignored directories

| Path | Content | In git? |
|---|---|---|
| `content/_raw/` | Downloads: Mutopia sources and `fetch_log.json`, the MusicXML XSD, the reference pages of the arrangements (`references/`), the bulk lane's MIDI cache and `inventory.json` (`bulk/`) and the PDMX selection (`pdmx/`). A junction to the main checkout in worktrees. | no |
| `content/_build/` | LilyPond build directories (upgraded source, dump, MIDI, PDF), `repro/`, `lint/` (PIG fingerings), `plain/` (plain copies of archive scores) and the lock file `.library.lock` | no |
| `content/_preview/` | The verovio SVG and PNG of page 1 of each score, plus `validation.json` | no (regenerate with `build.py --png`) |
| `content/.venv/` | The Python virtual environment; a junction to the main checkout in worktrees | no |
