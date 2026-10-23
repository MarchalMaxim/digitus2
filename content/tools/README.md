# content/tools: building the built-in library

These scripts produce everything in `content/scores/`, `content/manifest.json`,
`content/verification.json` and `content/library-index.json`. The library has
3,245 pieces in six lanes:

| Lane | Catalog | Pieces | Documented in |
|---|---|---:|---|
| Core 30 (own arrangements and Mutopia engravings) | `catalog.json` | 30 | `docs/research/content-library.md` |
| L1 curated library | `catalog.d/` collection fragments | 119 | `docs/research/content-library.md`, section "L1 curated library" |
| Mutopia expansion | `catalog.d/expansion-bach.json`, `expansion-teaching.json` | 13 | [Mutopia expansions](#mutopia-expansions) |
| Bulk Mutopia | `catalog.d/expansion-bulk.json` | 141 | [Mutopia expansions](#mutopia-expansions) |
| MuseScore archive, classical | `catalog.d/pdmx-library.json`, `pdmx-advanced.json` | 1,530 | [MuseScore archive scores](#musescore-archive-scores-pdmx) |
| MuseScore archive, songs | `catalog.d/pdmx-songs.json`, `pdmx-songs-advanced.json` | 1,412 | [MuseScore archive scores](#musescore-archive-scores-pdmx) |

The first four lanes are the curated core of 303 pieces. Provenance, licences
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
   the reason. It is never shipped with a flag, except a level-6 bulk edition
   that the Mutopia rule releases under the relaxed gates (see
   [Mutopia expansions](#mutopia-expansions)).
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
| `bulk_sources.py` | The bulk Mutopia collector (see [Mutopia expansions](#mutopia-expansions)). `--download` inventories the local mirror and caches canonical RDF and published MIDI with four workers; `--refresh` reconciles the cached metadata offline without resetting download status; `--readmit` regenerates only the admission of the committed `bulk-candidates.json` from the catalog, offline and without the ignored inventory. |
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
| `mutopia_advanced.py` | The Mutopia rule: which bulk editions held only for the span or lint gate ship at level 6 under the relaxed gates (`CONCERT` and `KEPT`, with a category for each) and the level note. `gates.py` checks it for every Mutopia piece with `relaxedGates`. |
| `pdmx_*.py`, `dedupe.py`, `pdmx-excluded.json` | The MuseScore archive pipeline and its committed exclusion list (see [below](#musescore-archive-scores-pdmx)). |
| `pdmx_repair.py`, `pdmx-repairs.json` | The verified rounding repairs of four refused advanced uploads, pinned by SHA-256 (see [Repairs for refused uploads](#repairs-for-refused-uploads)). |
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
   are recorded. Level 6 may relax the span and lint gates within the
   archive's ceiling (`relaxedGates`; MuseScore archive pieces by
   `pdmx_advanced.py`, bulk Mutopia editions by `mutopia_advanced.py`).
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
- Pleyel ships only its 16-bar first theme. The converter writes the
  "D.C. al Fine" as words and the player acts on them, so the full piece
  needs no converter change: it needs `convert.barTo` dropped and the build
  gates passed, and `unfold_order` in `xmlcheck.py` knows no D.C. while
  Mutopia's MIDI stops before the da capo. Its source
  title is "Menuett", although the Mutopia metadata says "Rondo".
- The Handel source editions are dated 1930 and carry explicit Mutopia
  public-domain declarations.

**Bulk Mutopia (141 pieces).** `bulk_sources.py` inventories the local
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
| Accepted / held with reasons / already represented | 141 / 378 / 89 |

Admission is stricter than for a hand-picked piece. Every accepted edition is:

- complete: no excerpt, simplification or catalog patch;
- one musical score with exactly one two-staff piano part;
- exact against both the LilyPond 2.24 MIDI and the published Mutopia MIDI.
  Both checks are mandatory, and MIDI inside a ZIP keeps its relative path
  so that the published check cannot silently drop out;
- free of span flags and medium or large law errors, except the level-6
  editions released under the relaxed gates (below);
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

None of the ten acquired Rachmaninoff editions passes the gates. Op. 23 No. 10
comes closest: it is held at 41.5 law errors per 1,000 notes, over the
relaxed ceiling of 40.

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
chromatic ornaments and density. The lane's levels are 1 at 2, 49 at 3, 3 at 4,
1 at 5 and 87 at 6.

**Level 6 under the relaxed gates** (the owner's decision: concert-level bulk
editions held only for the span or lint gate may ship at grade 6 under the
archive's relaxed gates and ceiling). `mutopia_advanced.py` states the rule.
Each of the 66 editions held only for those gates is placed in `CONCERT`
(preludes and fugues, variations, sonata and suite movements, Romantic concert
pieces, rags) or in `KEPT` (chorales, Satie, teaching and children's
collections, a folk dance, light contemporary originals, reductions), with its
category. A concert edition ships at 6 when it stays within the archive's
ceiling (`pdmx_advanced.within_ceiling`) and passes every other gate, both MIDI
checks included. The rule first also asked for a whole piece by the archive
rule (60 s and 300 notes). The owner dropped that test after the first
measurement: a bulk edition is complete by admission, so the test only held
back short complete works, nine of them. Its flags are in `relaxedGates` and in its notes
(`pdmx_advanced.relaxed_sentence`). The archive's own level-6 rule could not
place these editions, because the heuristic proposes 3 for most of this
Baroque repertoire.

The 42 concert editions were fetched again with `fetch_mutopia.py` (a
candidates file of their directories) and pinned by `sourceSha256`, then built
and gated twice. The first pass measured the flags; the second checked the
recorded ones. When the whole-piece test was dropped, the held concert editions
were rebuilt and gated again.

| Concert editions | Count |
|---|---:|
| Released at level 6 | 33 (16 Bach, 5 Chopin, 3 Mozart, 2 each Beethoven, Brahms, Haydn and Liszt, Turpin) |
| Held: beyond the ceiling | 7 (Goldberg 15, 21 and 24, Scarlatti, Rachmaninoff Op. 23 No. 10, K. 331 Var. 4, Scriabin Op. 16 No. 5) |
| Held: a lost tempo word | 1 (Goldberg 22) |
| Held: source changed since it was pinned | 1 (Chopin Op. 28 No. 20) |

Goldberg 15 and 22 also lose their tempo word ("Andante", "Alla breve"),
which the source writes as a rehearsal mark (#49). A screen of every tempo,
mark and text-script word against the MusicXML found it, as did the visual
check.

The 33 released editions:

- carry a median of 6 law errors at the worse profile (at most 45, Brahms
  Op. 118 No. 2);
- 30 of them have span flags: 124 slices in all, at most 15 in one piece.

Two archive uploads copied released editions: Chopin's Preludes Op. 28 No. 12
(a near copy) and No. 19 (the same tune at the same level). Following
dedupe's rule that the curated piece stays, they are recorded under
`duplicates` in `pdmx-excluded.json`, and `pdmx_fragments.py` no longer ships
them. The comparison used dedupe's own functions and thresholds, run on every
shipped piece against the 33.

**Released by the grace-count fix (issue 49).** `xmlcheck.best_midi_match` counted a written grace note
once when it compared the unfolded score with a MIDI file, but a repeated section plays its grace notes
again. It now counts each grace note once per pass of `unfold_order` (`unfolded_grace_pitches`); the
written comparison is unchanged. 35 held editions differed only in notes that the MIDI had and the score
did not, and had no other reason to be held. They were fetched again with `fetch_mutopia.py`, all 35 still
match their pinned `sourceSha256`, and they were built and measured with the fixed comparator.

| Held editions with only MIDI-only notes | Count |
|---|---:|
| Both MIDI checks exact, every gate passes: released | 17 (9 polskas, Schumann Op. 68 Nos. 7, 13, 18 and 36, Mozart K. 331 Theme and Variation 2, Grieg Op. 12 No. 7, Sousa's The Invincible Eagle) |
| LilyPond 2.24 check exact, published MIDI not exact | 5 (Mendelssohn Op. 102 No. 3, K. 331 Variations 3 and 6, Sousa's King Cotton and The Liberty Bell) |
| Both checks still differ | 13 (11 polskas, Schumann Op. 68 No. 26, Rimsky-Korsakov Op. 11 No. 3) |

The held editions' reasons now give the measured differences. The released polskas and Schumann pieces
keep the heuristic's proposal (teaching and folk sets); Grieg, Sousa and the two Mozart movements, complete
concert originals, take the lane's level 6. Four archive uploads copied released editions: K. 331's theme
and Op. 68 No. 7 (near copies), No. 13 (the same tune at the same level) and No. 18 (an exact copy). They
are recorded under `duplicates` in `pdmx-excluded.json`, by the same comparison as above, and four hymns
took their places under the classical lane's cap.

After a release, `bulk_sources.py --readmit` regenerates the admission of
`bulk-candidates.json`.

Known warnings, not defects:

- music21 cannot pair one diminuendo in Beethoven Op. 31/2, II, whose stop
  precedes its start in document order. The rendered hairpin matches the
  source. The same holds for one hairpin in Grieg Op. 12 No. 7 (bar 12) and
  three in Sousa's The Invincible Eagle (bars 8, 24 and 25).
- Verovio reports 36 mixed-beam placement fallbacks in Goldberg variations
  11, 20 and 28. These are layout warnings; no note or dynamic is dropped.

## MuseScore archive scores (PDMX)

2,942 pieces come from PDMX (Long et al. 2025, https://zenodo.org/records/15571083): MuseScore
files whose uploaders declared them public domain or CC0, and which PDMX found free of licence conflicts
(`license_conflict` false). Every one is a solo piano score on two staves with notes on both; the
library's own gates decide the rest. Two lanes. The classical lane (genres classical, folk, religious or unlabelled):
`catalog.d/pdmx-library.json` (1,310 pieces at levels 1 to 5) and `catalog.d/pdmx-advanced.json` (220 pieces at level 6,
some with relaxed gates). The songs lane (every other genre: pop, rock, soundtrack, jazz, blues, at the owner's request
for songs "not necessarily classical or folk"): `catalog.d/pdmx-songs.json` (1,023 pieces at levels 1 to 5) and
`catalog.d/pdmx-songs-advanced.json` (389 pieces at level 6, some with relaxed gates). The caps by rating hold levels
1 to 4 only (1,300 classical pieces, 1,000 songs): a piece at level 5 or 6 ships whenever it passes, because the
library is short of hard pieces. Within a cap a piece the fragments already ship keeps its place, and the best-rated
new candidates take the places left, so a larger pool never pushes a shipped piece out.
Their scores are
`scores/<slug>.musicxml.gz` (gzip, mtime 0, byte-identical on a rebuild; the app decompresses them with
the browser's DecompressionStream), and `content/library-index.json` lists every piece for the library
page (compact columnar form, see step 7). The steps, in order (run with `content/.venv/Scripts/python.exe -I`; the inputs are the PDMX
download in `research/data/_downloads/pdmx/`, and every output is under the ignored `content/_raw/pdmx/`
and `content/_build/`, except the committed `pdmx-excluded.json`):

1. `pdmx_screen.py --csv PDMX.csv --archive mxl.tar.gz`: streams the archive once, keeps the
   public-domain or CC0 rows without a licence conflict, genres classical, folk or religious (MuseScore's
   own tags) or unlabelled, 30 to 25,000 notes, and tests every file for a solo piano score.
   `screen.jsonl` has a reason for every rejection. `--above N` screens only the rows a ceiling of N left
   out and appends them, so a raised ceiling needs no full run.
2. `pdmx_select.py --archive mxl.tar.gz`: keeps 40 to 25,000 notes and the two-staff rule (`grand_staff`:
   one sounding part, two staves), admits an unlabelled score only when its composer is a classical one
   (`CLASSICAL_COMPOSERS`), removes duplicates by title and by identical XML, and copies the chosen files to
   `_raw/pdmx/selected/`. An unnamed composer is kept and shown as "Unknown": the licence rule is the
   uploader's declaration, not the author's date (the owner's broad reading).
3. `pdmx_gate.py --grand-staff [--resume] [--limit N]`: for each candidate, the XSD of its own MusicXML
   version (3.1 or 4.0), the span check, notes on both staves, zero lint law errors at the medium and the
   large profile, and the level proposal of the frozen heuristic. `gate.jsonl` holds the results.
4. `dedupe.py [--apply]`: compares notes, not titles. Exact copies (the same notes at the same onsets)
   and near copies (Jaccard 0.9 or more of the (onset, pitch) sets, note counts within 10 percent) are
   removed among the archive pieces, and so is the same tune at the same level (top-line shingles: three
   Mozart minuets in F at level 2 are one piece to a learner); the copy that stays is a curated piece
   first, then a named composer, then the more rated. A curated piece is never removed, and curated
   copies of each other are only listed. The same tune at another level (an easy and a fuller arrangement)
   is reported and kept. `--apply` writes `duplicates` into `pdmx-excluded.json`. A copy already recorded
   stays while the piece it copies can still ship: a larger pool makes more shingles common (`COMMON`) and
   can hide a pair the smaller pool found (six pairs when the note ceiling was lifted).
5. `pdmx_scope.py export` and `apply`: MuseScore's genre tags are the uploader's, so a pop song can carry
   "classical". The candidates (best rated first, 2,037 of them, then the 157 relaxed advanced ones with
   `export --unreviewed`) were read by three independently framed reviews; a
   candidate any of them flagged as modern popular music, film, game or musical themes, or Nazi-era
   marches is out of scope (69 of 2,194) and recorded in `outOfScope`. The genre and date reasons were
   lifted later (the songs lane, below); the content reasons stay.
6. `pdmx_advanced.py` is the rule for level 6 (below). `pdmx_fragments.py [--limit 1300] [--songs-limit 1000]`
   writes the four fragments: the best-rated passing candidates at levels 1 to 4 within each lane's cap, every
   passing one at level 5, and the advanced ones apart and uncapped, skipping every candidate in
   `pdmx-excluded.json` (build failures, duplicates, out of scope). The catalog is the authority for a
   shipped piece's title and composer (they were repaired by hand, `titles.py`), and a new piece's damaged
   name is repaired from its own score's text or the piece is left out. `--record-failures LOG` first adds the
   pieces a `build.py` log reports as refused.
7. `build.py --source pdmx [--only SLUG...]`: converts nothing (the MusicXML is the archive's own file).
   Source `<fingering>` digits are stripped first (`build.strip_fingerings`); each piece is then validated as a plain copy (`validate.check_file`: XSD, the two-staff rule, measure
   arithmetic and the other library checks), then written gzip-compressed. The 1.5 MB size limit applies to
   the stored gzip file, not the plain copy: a long score is several MB as plain XML. A failed piece gets no score and
   no manifest entry. A refused piece is recorded and dropped (`--record-failures`); `build.py --source pdmx
   --only SLUG...` then builds just the pieces that the new fragments added. Repeat until a build refuses nothing. `build.py --manifest-only` then
   re-renders every manifest entry, and `build.py` writes `library-index.json` (the eight fields the
   library list reads, in a compact columnar form: `build.library_index` describes it, and
   `decodeLibraryIndex` in `apps/web/src/library/manifest.ts` reads it; 93 KB gzip for 3,245 pieces).
8. `gates.py --pending` (or `--new`) writes the verification records (span check, lint, level). For a
   MuseScore piece the LilyPond 2.24 MIDI cross-check does not apply (there is no Mutopia engraving to
   cross-check); the other gates do.

**The songs lane** (`pdmx_songs.py`). `pdmx_screen.py --other` screens the rows the classical lane
skipped (3,239 metadata rows, 1,770 accepted), `pdmx_select.py` and `pdmx_gate.py` run on them with
`candidates-other.json` and `gate-other.jsonl` (4,439 candidates, 2,528 pass every gate), `pdmx_songs.py items` and
`apply` carry the review (two removal-only lenses, junk and content safety), and `reinstate` lifts the genre and
copyright-date exclusions of the classical lane's scope review while keeping the content ones (Nazi-era marches,
propaganda, junk). The songs lane takes the level-6 rule and its relaxed gates like the classical lane; a level-6
song keeps its Songs or Modern collection, so the Challenging level shows it on that shelf.
`pdmx_fragments.py --songs-limit 1000` ships the best rated at levels 1 to 4; jazz and blues go to the Modern genre,
the rest to Songs. Copyright: the owner's broad reading, the uploader's declaration with no author-date check.
Post-1929 popular songs can therefore be in the public repository; the repository carries that risk.

**The review.** Any reader's flag removes a piece (`outOfScope`, 364 in all). The first songs pool lost 324 to the
two lenses. When the note ceiling was lifted, the 595 pieces the fragments newly shipped, in both lanes, were read in the
same two lenses by two independent readers, and the 14 that entered later, as refusals freed places, by one
(`pdmx_songs.py apply FLAGS --index INDEX` numbers a review list other than `items.txt`): 29 removed, for drafts and
works in progress, fragments, accompaniment parts, altered versions of known works, titles that are only a code, a
number or a hash, damaged titles that cannot be recovered, and three military marches. Three damaged titles were
restored exactly instead, and one composer's name up to the character between its two parts.

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

When the note ceiling was lifted, the first build of the 574 new pieces refused 154. 105 of those refusals were the
validator's 1.5 MB limit on the plain XML, a second ceiling on long scores; with the limit on the stored file, 64
of them pass. The 93 refusals that remain (with the later entrants) are real: bars longer than their time
signature (72 scores; of the 44 refused for that alone, 31 by more than half a quarter note, such as the cadenza
bars of Chopin's Ballade No. 4, and 11 by at most a thirty-second of a quarter, a rounding of the file's divisions), a backup before the bar
start (30), overlapping notes (13) and measure numbers out of order (10).

`pdmx_fragments.py --recheck-failures` re-runs every recorded refusal through the build's own check and releases the
ones that pass (a refusal is otherwise kept forever), and `dedupe.py` leaves out a piece the build refuses, so it
cannot be the copy that stays. A piece that still fails is recorded in `pdmx-excluded.json` and dropped
("if the refusals do not work, drop them"); nothing is tried again for it.

**The note ceiling.** It was 2,500 notes in `pdmx_select.py` and 6,000 in `pdmx_screen.py` until the owner asked to
lift it (2026-10-19). It is now 25,000 in both, the longest score tested in the app: Chopin's twelve Études Op. 25 in
one file (24,956 notes, 919 bars) is fingered in 3.9 s and laid out in 4.7 s, opens in 16 s at phone width (190
pages, 110 MB of page heap) and plays. Chopin's Sonata No. 3 (13,871 notes) took 4.2 and 3.1 s, the Ballade No. 4
(6,277 notes) 0.6 and 1.3 s, all measured in a background tab of the dev server. Above 25,000 notes the archive holds only collections, one whole symphony and MIDI dumps.
The library ships 160 archive pieces above 2,500 notes and 14 above 6,000; the longest is 20,329.

**Level 6.** The heuristic has four cut points, so it never proposes 6; the curated Advanced pieces
were placed by hand (50) or by the Mutopia rule (33, see [Mutopia expansions](#mutopia-expansions)). An archive piece is placed at 6 by the rule in `pdmx_advanced.py`: a proposal of 5,
or of 4 with a score of 10.9 or more (the middle of that band); at least 60 seconds and 300 notes; and
both sustained fast notes (6 a second) and a stretch of 12 semitones. Speed and stretch are required
together, because either alone admitted pieces that were not advanced. A placement from proposal 4
carries a `levelOverride`. The thresholds were fixed before the yield was known and are not tuned to a
count. 171 archive pieces at level 6 pass every library gate.

**Relaxed gates for level 6** (the owner's decision). Advanced pieces are the ones the span check and
the lint law gate refuse, so a level-6 candidate that meets the rule and fails only those two gates ships
anyway (`pdmx_advanced.relaxed`): its XSD, notes-on-both-staves and validator checks still hold, and the
slices no hand can strike and the lint law errors are recorded in the catalog (`relaxedGates`), in the
piece's notes, and checked by `gates.py` and `test_gates.py` against what the engine finds, so a changed
score or engine cannot slip through; both also hold every relaxed piece, archive or Mutopia, to the ceiling
(`pdmx_advanced.within_ceiling`) and look for its flags in its notes. A total waiver would ship pieces where nearly every note breaks a
law (the worst candidate had 1,028 errors per 1,000 notes), so the relaxation has a ceiling of 40
law errors per 1,000 notes at each profile (ten times the engine's measured rate on real pieces, the
benchmark floor of 3.92) and 20 unplayable slices per 1,000 notes; both are constants in
`pdmx_advanced.py` (None lifts them). 438 pieces ship with relaxed gates: a median of 13.5 law errors a
piece (at most 277, in a long piece within the ceiling), and 369 of them with span flags (3,035 slices in all, at
most 63 in one piece). The digits at those places are advice.

**The scoped relaxation for four composers** (the owner's decision, issue #80, 2026-10-19: "relax the ceiling",
"loosen the advanced rule, but no more beginner songs"). For an archive piece credited to Liszt, Tchaikovsky,
Rachmaninoff or Prokofiev (`pdmx_advanced.requested`, read from the archive's composer field), the advanced rule
accepts a proposal of 4 at any score, with sustained fast notes from 4 a second (`REQUESTED_NPS_MIN`), and the
ceiling is 60 law errors and 30 unplayable slices per 1,000 notes (`REQUESTED_LINT_PER_1000`,
`REQUESTED_SPANS_PER_1000`). A proposal of 3 or below is never advanced, so the relaxation adds no beginner piece.
Every other composer keeps the rule and the ceiling above. Pieces whose composer field is "NA" are not covered,
because the library would list them as Unknown (#48). Three archive pieces were removed by review as misattributed:
a Czerny étude credited to Rachmaninoff, an "Intermezzo" credited to Justinas Bernotas, and an untitled "FERAL"
credited to Liszt (`pdmx-excluded.json`, `outOfScope`). Of the eleven pieces the relaxation admits, four pass the
validator and are shipped; seven are refused for bars that run over their time signature.

**Result.** The classical lane screened 176,155 archive rows, kept 8,855 two-staff candidates after
de-duplication and passed 5,470 through every gate; the songs lane gated 4,439 candidates and passed 2,528.
The library ships 1,310 classical pieces at levels 1 to 5, 220 at level 6, 1,023 songs at levels 1 to 5 and 389
at level 6 (1,368 in Songs, 44 jazz and blues under Modern). Of the 609 archive pieces at level 6, 171 pass every
gate and 438 ship with relaxed gates. The archive names a composer for 530 of the 1,530 classical-lane pieces; the
rest read "Unknown".

| Level | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---:|---:|---:|---:|---:|---:|
| Archive pieces | 23 | 176 | 1,379 | 722 | 33 | 609 |
| Whole library (303 curated + 2,942 archive) | 47 | 221 | 1,474 | 759 | 48 | 696 |

### Repairs for refused uploads

The validator refuses a score at its first defect, and an upload can have many. `pdmx_repair.py` repairs the four
advanced uploads whose defects are rounding-sized (issue #80): a voice that runs past its bar by at most 1/32 of a
quarter (tuplet rounding) loses that excess from its last note, and a backup that reaches before the bar start by
that much gets one rest of the missing length. `verify_content` then compares every pitched note (pitch, voice,
staff, onset and duration) and every non-note element of the two scores, and the repaired score must pass the
validator. The repairs are pinned by SHA-256 in `pdmx-repairs.json`. `build.py` applies them before its check, and
`pdmx_fragments.py` takes a repaired piece's gate counts from the engine's own measurement on the shipped score
(`measured_gate`), so `gates.py` checks what ships. The other ten refused advanced uploads are not repaired: each has
bars that run over by more than 1/32 of a quarter (from 1/8 to 18 quarters) or overlapping notes in one voice, which
no change of this kind fixes.

## Generated and ignored directories

| Path | Content | In git? |
|---|---|---|
| `content/_raw/` | Downloads: Mutopia sources and `fetch_log.json`, the MusicXML XSD, the reference pages of the arrangements (`references/`), the bulk lane's MIDI cache and `inventory.json` (`bulk/`) and the PDMX selection (`pdmx/`). A junction to the main checkout in worktrees. | no |
| `content/_build/` | LilyPond build directories (upgraded source, dump, MIDI, PDF), `repro/`, `lint/` (PIG fingerings), `plain/` (plain copies of archive scores) and the lock file `.library.lock` | no |
| `content/_preview/` | The verovio SVG and PNG of page 1 of each score, plus `validation.json` | no (regenerate with `build.py --png`) |
| `content/.venv/` | The Python virtual environment; a junction to the main checkout in worktrees | no |
