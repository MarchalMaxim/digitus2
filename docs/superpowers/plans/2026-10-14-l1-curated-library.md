# L1 Curated Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the built-in library from 30 to about 150 curated pieces (153 if every main candidate passes), every one public domain, CC0, CC BY or CC BY-SA, converted and verified by the content pipeline, levelled 1 to 5 with a documented heuristic and a syllabus citation, grouped into collections. Level targets with the 30: level 1 27, level 2 45, level 3 41, level 4 25, level 5 15. The app, the tests and `pnpm verify` stay green, and every library-based engine measurement keeps measuring exactly the current 30 pieces.

**Architecture:** Content only, plus three small, named changes outside `content/`:

- **Selection.** Mutopia candidates are enumerated from the pinned mirror (`research/data/mutopia_src/ftp`) and fetched from the live site with `fetch_mutopia.py`, which gives the RDF licence, the published MIDI and a SHA-256 log, as for the first 30 (decision 1). Beginner pieces at levels 1 and 2 are new arrangements in `arrange.py`'s note language.
- **Catalog.** `content/tools/catalog.json` keeps the core 30 and gains a `collections` table. New pieces live in one fragment per task under `content/tools/catalog.d/`, so that eleven implementers can work at once. `build.py` merges the fragments and writes the manifest and `verification.json` under a file lock with atomic writes (decision 3).
- **Gates.** A new `gates.py` runs, after `build.py`, every check that is not already in `build.py`/`validate.py`: the span check (now a hard gate for new pieces), the level proposal (`level.py`), the melody check of arrangements, and the engine's lint on the engine's own fingering at the medium and large profiles (`lint_gate.py`, through the built CLI). The results go into `verification.json` and are asserted by `tests/test_gates.py`.
- **Benchmark set.** Every manifest entry gets `benchmarkSet` (`"core30"` for the first 30, `null` otherwise). A pure helper `packages/engine/src/library/benchmarkSet.ts` selects the set. `digitus2 evalhands` and the engine tests outside the forbidden files use it. The forbidden files that iterate the library get a pre-written patch that the coordinator applies after the M3 merge; the content merge waits for it (section "Deferred to the coordinator").
- **App.** The manifest type gains `collection`, `collectionId` and `benchmarkSet`. CC BY engravings are credited (today they would be labelled "public domain"). Tests and flows take the piece count from the manifest instead of hard-coding 30. The library list is already grouped by level and needs no redesign.

**Tech Stack:** Python 3.11 in `content/.venv` (lilypond 2.24.3 wheel, music21 10.5.0, verovio 6.3.0, lxml 6.1.3, resvg-py 0.5.0, pytest 9.1.1; `content/requirements.txt`, unchanged); TypeScript, vitest and Playwright as in M4 and M6. No new dependencies anywhere.

**Depends on:** the M0 content pipeline (`content/tools/*`, `docs/research/content-library.md`), M2 (`digitus2 finger` and `digitus2 lint` in `packages/engine/dist/cli/main.js`), M4 (`apps/web/src/library/manifest.ts`, the e2e suites, the visual baselines), M6 (`digitus2 evalhands --library`). Runs in the worktree `C:/Users/maxim/Desktop/projects/github/thingamajig-wt/library-150` (branch `wt/library-150`) while M3 (`wt/m3-learning`) and the polish workflow (`wt/m4-polish`) are in flight. It merges **after** M3 and polish: the coordinator applies the deferred patch, re-runs the lint gate on the merged solver and regenerates the visual baselines after rebasing.

**Spec:** product spec `docs/superpowers/specs/2026-10-13-digitus2-design.md`. Section 2 makes the built-in library a required input; section 4 places it in `content/scores/` with `manifest.json`; section 7.2 makes the app default to the beginner profile for level 1 and 2 pieces, so levels are product behaviour, not decoration; section 9, view 1, shows the library "as a clean list grouped by level with title, composer and length". Verification spec `2026-10-13-verification-design.md`: the goals table rows "Be easy to play" (level 1 to 3 library pieces), "Be physically possible" ("every library hand that has a fully legal fingering gets one") and "Honor the design brief" (library LCP and states); check 3.9 (UI flows and baselines); check 3.12 (teacher review controls drawn from level 1 to 3 library passages). `docs/research/content-library.md` records how the 30 were chosen, converted and verified; read it in full before Task 1.

## Decisions made while writing this plan (read before Task 0)

1. **Mutopia sources come from the live site, the mirror is for enumeration and cross-checking.** `build.py` reads the RDF of each piece for licence, Mutopia id, typesetter, edition and LilyPond version. It cross-checks the notes against two MIDI files: the one LilyPond 2.24 renders and the one Mutopia published. It also takes `retrievedAt` and the SHA-256 provenance from `fetch_log.json`. The mirror (`research/data/mutopia_src/ftp`, MutopiaProject@2144afd6, 832 piece directories, 659 of them solo keyboard after removing duets, voice and other instruments) has the `.ly` sources but no RDF, no published MIDI and no PDF. Task 3 fetches every candidate with `fetch_mutopia.py`, exactly as the 30 were built. It then records whether each fetched main `.ly` is byte-identical to the mirror's copy; a difference is reported, not fatal.
2. **The content environment and the raw downloads are gone and must be recreated.** In this worktree `content/.venv` and `content/_raw` are junctions to `C:/Users/maxim/Desktop/projects/github/thingamajig/content/.venv` and `.../content/_raw`. Both targets were empty on 2026-10-14 at 10:30, and no LilyPond binary exists anywhere under the user profile. The 2026-10-13 fetch log is therefore lost as well. Consequences:
   - Task 0 recreates the shared environment through the junction, which is what `scripts/worktree-add.mjs` intends: one gitignored environment for all worktrees.
   - The first 30 must not change. Task 1 pins each core Mutopia entry's `retrievedAt` in the catalog (`"2026-10-13"`, the value in today's manifest), because that date becomes `<encoding-date>` and `source.retrievedAt`; a re-fetch would otherwise move it to today. Task 1 also pins the SHA-256 of the 38 committed core files in a test fixture.
   - Task 3 proves that the refetched sources rebuild the core 30 byte for byte before anything new is converted.
3. **Parallel implementers write separate files, and shared JSON is written under a lock.** New catalog entries go to `content/tools/catalog.d/<fragment>.json`, one fragment per task. `build.py`, `check_spans.py` and `gates.py` read, modify and write `manifest.json` and `verification.json` inside `jsonio.library_lock()` (an exclusive lock file under `content/_build/`) and replace files atomically. Scores are written to a temporary name and `os.replace`d, so a concurrent reader never sees half a file. Merge order in the manifest is defined by the data, not by who finished first: (level, collection order in `catalog.json`, position in the merged catalog). The merged catalog is `catalog.json` first, then the fragments in file-name order.
4. **`benchmarkSet` is data, and the selection lives in one pure engine helper.** The manifest carries `"benchmarkSet": "core30"` on the first 30 and `null` on everything else. `benchmarkEntries(entries, set = 'core30')` returns the entries of a set, or every entry for `'all'` or for a manifest that has no `benchmarkSet` field at all (so old manifests and the evalhands test fixture keep working). It throws when a named set matches nothing. It lives in `packages/engine/src/library/benchmarkSet.ts`. That directory is new and not forbidden, it uses no Node API, and it is not exported from `src/index.ts` (forbidden), so both `cli/` and the tests import it by relative path. Every library consumer in a forbidden file needs only a one-line change to adopt it (section "Deferred to the coordinator").
5. **The level heuristic is fixed now and was measured while writing this plan.** A throwaway prototype computed the formula in Task 4 on the 30 labelled pieces with their catalogue tempos:

   | Measure                                               | Result                              |
   | ----------------------------------------------------- | ----------------------------------- |
   | In-sample, cut points fitted on all 30                | 30 of 30 within one level, 19 exact |
   | Leave-one-out (cut points refitted without the piece) | 27 of 30 within one level, 14 exact |
   | Fitted cut points                                     | 1.76, 4.09, 9.11, 12.68             |

   The weights are fixed a priori and only the four cut points are fitted, by exhaustive search over the midpoints between sorted scores, maximising (within one, exact, minus the summed absolute error). The heuristic underrates counterpoint: it puts Invention No. 1 at 3, while the catalogue has 4. It overrates held left-hand chords: it puts the arrangements of Amazing Grace and Greensleeves at 3, while the catalogue has 2. Both stay within one level. The proposal is advice. The final level is the implementer's, with a one-line justification (`levelNote`). A new piece whose final level differs from the proposal by more than one needs a `levelOverride` reason.

6. **The lint gate runs at two profiles.** The binding gate is zero law errors (lint severity `error`) on the engine's own fingering at the medium profile. The gate also requires zero at the large profile, the solver's default. The reason is the forbidden `src/fingering/solve.test.ts`: its "every library hand that has a fully legal fingering gets one" test solves every file in `content/scores/` at the default profile and expects `2 * files - 5` legal hands, so a new piece that fails at large would break `pnpm verify` before the coordinator can patch that file.

   `digitus2 lint` has no `--profile` option (`cli/run.ts` belongs to M3), so the laws are checked with lint's default, large-hand span tables; the fingering being checked is the medium one. A `--profile` flag for `lint` is in the deferred list. Once it exists, the gate switches to linting at medium.

   Measured while writing this plan (engine built from this worktree), core 30 at medium:

   | Pieces                  | Law errors at medium |
   | ----------------------- | -------------------- |
   | 25 pieces               | 0                    |
   | Moonlight               | 33                   |
   | Chopin Op. 28 No. 4     | 22                   |
   | Chopin Op. 28 No. 7     | 4                    |
   | Satie, Gymnopédie No. 1 | 40                   |
   | Joplin, The Entertainer | 2                    |

   About 0.5 s per piece and profile. The core 30 are exempt; new pieces that fail are excerpted or dropped, never shipped with errors.

7. **Melodies must be public domain in the US and the EU, which is stricter than "before 1929".** Rule for every new arrangement: the melody is traditional, or every author of the melody died in 1955 or earlier (EU: 70 years after death, in force on 1 January 2026) **and** it was first published in 1928 or earlier. US works published before 1931 are public domain since 1 January 2026; the user's cut-off is 1928. Lyrics are never printed, so only melody authors count. A test enforces the rule from the catalog (`melody.authors[].died`, `melody.firstPublished`).

   Popular pre-1929 songs excluded by the EU half of the rule:

   | Song                         | Author who died after 1955   |
   | ---------------------------- | ---------------------------- |
   | Take Me Out to the Ball Game | Albert Von Tilzer, died 1956 |
   | Shine On, Harvest Moon       | Jack Norworth, died 1959     |
   | Alexander's Ragtime Band     | Irving Berlin, died 1989     |
   | Hello! Ma Baby               | Joseph E. Howard, died 1961  |
   | K-K-K-Katy                   | Geoffrey O'Hara, died 1967   |
   | Cielito Lindo                | Quirino Mendoza, died 1957   |
   | Kookaburra                   | Marion Sinclair, died 1988   |

   Tunes are named by their traditional title where a modern text is protected: "Londonderry Air", not "Danny Boy". Korobeiniki is the folk song, not the 1989 video-game arrangement. Simple Gifts is the 1848 Shaker tune, not Copland's 1944 setting.

8. **Collections are a controlled vocabulary.** `catalog.json` gains `collections: [{ id, title, kind: "set" | "genre" }]` in display order. Each piece names one `collection` id. The manifest gets both `collection` (the title, as the brief asks) and `collectionId` (a stable kebab-case id), which L2's browsable UI can use for URLs and filters without renaming anything. Published sets are collections of their own (Burgmüller Op. 100, Schumann Op. 68, the Anna Magdalena Notebook, the Inventions); single pieces go to a genre collection (sonatinas and sonatas, Romantic character pieces, ragtime).
9. **The library page needs no redesign.** `LibraryView.tsx` already renders one `<section>` per level with an `h2` heading and the pieces in manifest order, with a "Start here" card on `recommendedPiece()`, the first level-1 piece in manifest order. With 153 pieces the longest group is level 2 (45 rows), which stays usable at 360 px. The only change to ordering is data: inside a level, pieces follow collection order, so related pieces sit together. The first collection is "Children's songs", which starts with Twinkle, so "Start here" stays Twinkle (tested in content and in the app).
10. **CC BY engravings need a code fix in the app.** `attribution()` in `manifest.ts` returns "…, public domain" for every Mutopia engraving that is not share-alike, so a CC BY 2.5 engraving would be mis-credited. Two more places assume only five CC BY-SA engravings exist: the About page's sentence ("Five engravings are shared under CC BY-SA") and its test. Task 6 fixes all three. These are the only `apps/web` source changes besides types, and they follow from the binding attribution constraint, not from a count.
11. **Four classical themes are a judgement call.** The user's list for arrangements is folk songs, carols, hymns, children's songs, pre-1929 songs and rags. The existing library already has two simplified classical themes (Ode to Joy, Pachelbel's Canon), so this plan adds three at level 2: Haydn's Surprise theme, Brahms's Lullaby and the opening of Eine kleine Nachtmusik. Their melodies are long out of copyright. If the coordinator disagrees, the three spares Loch Lomond, Red River Valley and The First Noel replace them one for one.
12. **Engine tests that iterate the library, and how each one is handled.**

    In allowed files:
    - `src/io/midi/motion.test.ts` compares counts with the shipped `hand-motion.json`. It would fail as soon as the library grows, so it switches to the benchmark set.
    - `src/io/midi/engrave.library.test.ts` round-trips through the M6 engraver, which supports only the rhythms of the 30. It switches to the benchmark set.
    - `src/io/musicxml/smoke.test.ts` parses every score. It stays on every file, because it is a useful gate for new pieces, but becomes one test per file: it measured 0.96 s for 38 files, and about 185 files would come close to vitest's 5 s default timeout.

    In forbidden files, deferred to the coordinator:
    - `src/eval/hands.test.ts`: at least 85 percent macro over the whole manifest.
    - `src/eval/metamorphic.test.ts`: the first six files of an unsorted `readdirSync`. New slugs such as `a-mighty-fortress` or `alle-meine-entchen` would displace today's six on Windows, and on Linux the order is already arbitrary.
    - `src/fingering/solve.test.ts`: the exact-search oracle over every file, 0.88 s for 30 pieces today. About 3.5 to 4.5 s is expected for 153 pieces against a 5 s timeout, and a slower CI runner would exceed it.
    - M3's `cli/bench.ts` `libraryRepeats`: verify's benchmark step passes `--library content/manifest.json` in the M3 tree.

13. **Sizes are reported, not compressed.** Measured: the 38 committed scores total 4.6 MB (largest 518 KB). The estimate for 123 new pieces plus about 28 editorial-fingering copies is 10 to 12 MB, under the brief's 15 MB threshold and far under the hygiene limits:

    | Hygiene limit (`scripts/check-repo-size.mjs`) | Value  |
    | --------------------------------------------- | ------ |
    | Per score file                                | 1.5 MB |
    | Per other tracked file                        | 1 MB   |
    | Total of trackable files                      | 60 MB  |

    The engine (`unpack.ts`, fflate) and the app's drop zone read `.mxl`. The library path does not: `validate.py` refuses `.mxl`, and `manifest.ts` globs `*.musicxml`. So `.mxl` is not adopted, and Task 19 reports the measured totals instead.

14. **The manifest is in the library page's first load.** `manifest.ts` imports `content/manifest.json` statically: 28.9 KB minified and 5.6 KB gzip for 30 pieces. The estimate for 153 pieces is about 25 KB gzip, against a 150 KB budget of which M4 used 88.8 KB. Task 19 measures it with `scripts/check-bundle-size.mjs`. If the total exceeds 140 KB, it reports to the coordinator rather than restructuring the loader. The likely fix would be a slim index written by `build.py`, which is an app change outside this plan.

## Global Constraints

- **Paths this plan may change:**
  - `content/**`
  - `docs/research/content-library.md`: append one dated section; never rewrite the existing text.
  - `packages/engine/src/library/**` (new).
  - `packages/engine/cli/evalhands.ts` and `cli/evalhands.test.ts`.
  - `packages/engine/src/io/midi/motion.test.ts`, `src/io/midi/engrave.library.test.ts`, `src/io/musicxml/smoke.test.ts`.
  - In `apps/web`, exactly these files:

    | File                                                                                                                 | Change                       |
    | -------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
    | `src/library/manifest.ts`                                                                                            | types and attribution        |
    | `src/library/manifest.test.ts`                                                                                       | counts and attribution tests |
    | `src/library/LibraryView.test.tsx`                                                                                   | one count line               |
    | `src/about/AboutView.tsx`                                                                                            | one sentence                 |
    | `src/about/AboutView.test.tsx`                                                                                       | licence counts               |
    | `e2e/helpers/library.ts`                                                                                             | new file                     |
    | `e2e/library.spec.ts`                                                                                                | count                        |
    | `e2e/about.spec.ts`                                                                                                  | count                        |
    | `e2e/helpers/states.ts`                                                                                              | count                        |
    | `e2e/visual.spec.ts-snapshots/library-visual-win32.png`, `library-notice-visual-win32.png`, `about-visual-win32.png` | regenerated                  |
- **Never touch:**
  - `packages/engine/cli/{bench,run,corpora,learn}.ts`
  - `packages/engine/src/fingering/**`, `src/eval/**`, `src/lint/**`, `src/index.ts`
  - `scripts/**`, `benchmarks/**`, `docs/experiments.md`, `docs/PROGRESS.md`, `docs/app.md`, `docs/verification-loop.md`
  - `research/**`

  Needed changes there are listed under "Deferred to the coordinator".

- Implementers never run git. Each task ends with a hand-off listing exact paths. `pnpm verify` rewrites the tracked `benchmarks/latest.json` and `benchmarks/latest-hands.json`: never list them in a hand-off; the coordinator restores them.
- Invocation (Git Bash, from the worktree root): `PY=content/.venv/Scripts/python.exe`. Run every Python with `-I` (isolated mode: the pipeline reads downloaded, untrusted files). Isolated mode ignores `PYTHONIOENCODING`, so every script's `main()` starts with `sys.stdout.reconfigure(encoding="utf-8")`: titles such as "Hézaine" and "Gymnopédie" otherwise crash the cp1252 console. LilyPond needs no PATH setup: `ly2musicxml.lilypond_bin()` finds it through the `lilypond` wheel (`lilypond.executable()`). In PowerShell use `& content/.venv/Scripts/python.exe -I ...`.
- Content tests: `$PY -I -m pytest content/tools/tests -q -p no:cacheprovider`. The full suite validates every score with XSD and music21. Expect several minutes at 150 pieces; run it in the background. Parallel tasks run `-k` on their own slugs plus the module tests they touch; Task 19 runs everything.
- Downloads land in `content/_raw/mutopia/` (gitignored junction). Fetch only with `fetch_mutopia.py`, which never executes what it downloads. Keep every script outside `_raw`.
- **Build-concurrency rules (parallel waves):**
  - Only Tasks 0, 2 and 19 to 21 run `pnpm build` or `pnpm --filter @digitus2/engine build`. All other tasks use the engine `dist/` built by Task 2: the lint gate reads `packages/engine/dist/cli/main.js`, and a rebuild in the middle of another task's gate run would read half-written files.
  - Only Tasks 6, 19 and 21 run Playwright, and never two at once. Always prefix it with `DIGITUS2_E2E_PORT=4175` (PowerShell: `$env:DIGITUS2_E2E_PORT='4175'`) so it does not collide with other worktrees.
  - Parallel content tasks run `pnpm verify hygiene design typecheck lint unit` (no build, bundle, e2e, benchmark or hands).
- Known red tests while the library grows: the three forbidden engine tests of decision 12 (`src/eval/hands.test.ts` "85 percent on the built-in library", `src/eval/metamorphic.test.ts` "passes on built-in library pieces", `src/fingering/solve.test.ts` "exact search oracle") may fail or time out in Wave C because they iterate the whole library.
  - If they are the only failures, record name, error and duration in the hand-off and continue.
  - The deferred patch fixes them before the merge.
  - Any other failure belongs to the task that sees it.
- Determinism:
  - `build.py` output depends only on the merged catalog, the fetched sources (pinned by `sourceSha256`) and the pinned `retrievedAt`.
  - Arrangements use `arrange.ENCODING_DATE` (`2026-10-13`) and are byte-identical across rebuilds.
  - No script writes a timestamp into a tracked file. `gates.py` records hashes, not dates.
- Every new tracked file must stay well under 1 MB: a new score at most 700 KB (gated), any other file at most 200 KB.
- Formatting: run `pnpm exec prettier --write` on every TypeScript, JSON or Markdown file you change outside the prettier-ignored folders (`content/`, `research/`, `benchmarks/`, `docs/research/` are ignored). CI runs `pnpm format:check`.
- Use the Write tool for files longer than a few lines (Bash heredocs are unreliable here). Use forward slashes in Bash.

## Review Focus

1. **The first 30 never change.** Their bytes, their manifest facts and their benchmark membership stay as they are; a re-fetch with a new date or a rebuild must not move a byte. Pinned by:
   - Task 1: `test_core30_scores_are_byte_identical`, `test_core30_manifest_entries_only_gain_the_new_keys`, `test_exactly_the_core30_carry_the_benchmark_set`.
   - Task 2: `keeps exactly the 30 pieces of the first library from the built-in manifest`.
   - Task 3: `repro.py --core30` (reported in the hand-off).
   - Task 19: `evalhands scores 30 library pieces`.
2. **Parallel builds must not lose or corrupt shared files.** Pinned by Task 1 `test_concurrent_writers_keep_every_entry` and `test_atomic_write_leaves_no_temporary_file`, and Task 19's full rebuild (`repro.py --all`).
3. **An arrangement plays the tune as published, note for note.** Pinned by Task 5 `test_built_melody_equals_the_reference` (read from the built MusicXML, not the spec) and `test_every_reference_cites_a_dated_source`. Task 7 also records the result per piece (`verification[slug].melody.exact`).
4. **No new piece ships with a slice one hand cannot play or a lint law error, at medium and at large.** Pinned by Task 7 `test_new_piece_passes_every_gate` and `test_span_flags_only_on_core30`.
5. **Every CC BY and CC BY-SA engraving is credited** (typesetter, Mutopia id, licence, licence URL) in the manifest, the MusicXML `<rights>` and the app; a CC BY engraving is never called public domain. Pinned by:
   - Task 6: `credits every CC BY and CC BY-SA engraving with its typesetter and licence` and `calls only public-domain engravings public domain`.
   - Task 7: `test_new_piece_passes_every_gate`, the rights assertion.
   - Task 1: `test_build_refuses_an_unknown_licence`.
6. **No arrangement's melody is still in copyright in the US or the EU.** Pinned by Task 1 `test_new_arrangements_are_public_domain_in_the_us_and_the_eu`.
7. **The level heuristic reproduces the labelled levels.** Pinned by Task 4 `test_reproduces_the_labelled_levels_within_one` (at least 27 of 30), `test_leave_one_out_generalises` (at least 25 of 30) and `test_frozen_cuts_are_the_fit`.
8. **"Start here" stays Twinkle.** Pinned by Task 1 `test_twinkle_is_the_first_level_one_piece` and the existing app test `recommends the first level-1 piece`.

## File Structure

```
content/tools/catalog.json              schemaVersion 2, collections table, core-30 fields (collection, benchmarkSet, retrievedAt, tempoSource, levelNote)
content/tools/catalog.d/*.json          one fragment per task: children, christmas, hymns, folk, songs, anna-magdalena, burgmuller, schumann-tchaikovsky, bach, sonatinas, character-rags
content/tools/candidates.json           the Mutopia candidates of this plan with the facts the fetch found (RDF licence, lyFile, MIDI names, PDF pages, mirror match)
content/tools/jsonio.py                 library_lock(), write_atomic(), write_json(), update_json()
content/tools/build.py                  fragments, sort by collection, lock + atomic writes, --manifest-only, --out-dir, pinned retrievedAt, licences BY 2.5/4.0 and BY-SA 4.0, refuses unknown licences
content/tools/fetch_mutopia.py          --candidates content/tools/candidates.json
content/tools/repro.py                  rebuilds into content/_build/repro and compares bytes with content/scores (--core30 or --all)
content/tools/level.py                  features, score, CUTS, propose, calibrate, leave_one_out; --write puts levelProposal into verification.json
content/tools/lint_gate.py              digitus2 finger + lint at medium and large through packages/engine/dist/cli/main.js
content/tools/gates.py                  spans (whole library), level proposals, melody check, lint gate; writes verification.json; exit 1 on a failing new piece
content/tools/check_spans.py            writes under the lock (no behaviour change)
content/tools/arrange.py                merges the arrangements package into PIECES (collision check)
content/tools/arrangements/__init__.py  loads the collection modules; reference(slug)
content/tools/arrangements/{children,christmas,hymns,folk,songs}.py   PIECES and REFERENCES per collection
content/tools/README.md                 fragments, gates, level, lint gate, lock, environment
content/tools/tests/fixtures/core30.json            30 slugs and the SHA-256 of their 38 files
content/tools/tests/test_core30.py, test_catalog.py, test_jsonio.py, test_level.py,
  test_lint_gate.py, test_gates.py, test_arrangements.py, test_candidates.py   new
content/tools/tests/test_library.py     new keys, licences, sort, Twinkle first, level counts (Task 19)
content/scores/*.musicxml               ~123 new scores and ~28 new .fingered copies
content/manifest.json, content/verification.json   regenerated
docs/research/content-library.md        appended section "L1 curated library (2026-10-14)"
packages/engine/src/library/benchmarkSet.ts (+ .test.ts)
packages/engine/cli/evalhands.ts (+ .test.ts)       librarySet option, default core30
packages/engine/src/io/midi/motion.test.ts, engrave.library.test.ts   benchmark set
packages/engine/src/io/musicxml/smoke.test.ts       one test per file
apps/web/src/library/manifest.ts (+ .test.ts), LibraryView.test.tsx
apps/web/src/about/AboutView.tsx (+ .test.tsx)
apps/web/e2e/helpers/library.ts (new), library.spec.ts, about.spec.ts, helpers/states.ts
apps/web/e2e/visual.spec.ts-snapshots/{library,library-notice,about}-visual-win32.png
```

## Interfaces the plan relies on

- `content/tools/build.py`:
  - `load_catalog()`, `build_mutopia(piece, log)`, `build_own(piece)`, `manifest_entry(piece, built, stats)`, `midi_check(...)`, `rights_text(piece, src)`.
  - `LICENSES` (RDF licence text to SPDX-like id and URL).
  - The CLI `--only SLUG...`, `--png`, `--no-validate`.
  - Today `--only` keeps other manifest entries, but drops `spanFlags` and every non-catalog key from `verification.json`.
- `content/tools/ly2musicxml.py`: `compile_lilypond(files, main, build_dir, patches)`, `convert_dump(dump, score, Options)`. `Options` supports `bar_from`, `bar_to`, `staff_order`, `drop_text`, `text_replace`, `first_key_mode`. The catalog's `convert` takes `score` (n-th `\score`), `barFrom`, `barTo`, `patches`, `textReplace`, `minFingerings`.
- `content/tools/xmlcheck.py`:
  - `parse_musicxml(path) -> XScore`, with notes `XNote(onset, rel, dur, pitch, voice, staff, grace, chord, tie_start, tie_stop, number)`.
  - `written_notes`, `read_midi`, `compare_notes`, `best_midi_match`.
- `content/tools/validate.py`: `check_file(path, preview_dir, png, tempo) -> {ok, errors, warnings, stats}`. Stats include `xsdValid`, `measures`, `approxDurationSec`, `key`, `time`, `bytes`, `pitchRange`, `verovioPages`. `MAX_BYTES = 1_500_000`.
- `content/tools/check_spans.py`: `span_flags(path, slug)`, `library_flags()`, and `main(["--no-write"])`. It writes `verification["spanFlags"]`.
- `content/tools/arrange.py`:
  - `PIECES`, `parse(spec)`, `build(slug, meta)` and `ENCODING_DATE`.
  - Note language: absolute LilyPond pitches, durations 1 to 32 with dots, chords `<...>`, `~`, `(` `)`, `!mf`, `^fermata`, `|`, optional `pickup`.
  - Not supported: triplets, repeats, voltas, grace notes, two voices in a staff, key or time changes. Write repeats out; put held notes in chords.
- `content/tools/fetch_mutopia.py`: `fetch_piece(ftp_dir, force) -> record`. It writes `content/_raw/mutopia/<ftpDir>/` and `fetch_log.json` (`retrievedAt`, file SHA-256s, extracted zips).
- Engine CLI (built: `node packages/engine/dist/cli/main.js`):
  - `finger <file> --profile child|small|medium|large --format pig --out <f>` writes PIG with the score's note ids.
  - `lint <file> --fingering <pig> --json` returns `{notes, errors, warnings, infos, counts: {L01..}, issues: [{rule, severity, hand, noteIds, message}]}` and exits 1 when `errors > 0`.
  - `evalhands --library <manifest>`.
- `packages/engine/cli/evalhands.ts`: `runEvalHands(opts: EvalHandsOptions) -> { scorecard, floorBreaches }`, where `scorecard.library: HandSetResult & { manifest }`, and `formatHandsScorecard(card)`.
- `apps/web/src/library/manifest.ts`:
  - Values and types: `pieces`, `LibraryPiece`, `PieceSourceInfo`, `LEVEL_NAMES`.
  - Lookup and display helpers: `recommendedPiece()` (the first level-1 piece in manifest order), `pieceBySlug`, `scoreUrl` (glob of `content/scores/*.musicxml`), `formatDuration`.
  - Licence helpers: `isShareAlike`, `licenseLabel`, `attribution`.

## Interfaces added by this plan

```python
# content/tools/jsonio.py
LOCK: Path  # content/_build/.library.lock
@contextmanager
def library_lock(timeout: float = 900, stale: float = 1800) -> Iterator[None]: ...
def write_atomic(path: Path, data: bytes) -> None: ...  # temp file in the same directory, os.replace with 5 retries (Windows PermissionError)
def write_json(path: Path, obj) -> None: ...            # indent 2, ensure_ascii False, trailing newline, LF
def update_json(path: Path, fn: Callable[[object], object]) -> object: ...  # read, fn, write inside library_lock()

# content/tools/build.py (additions)
def load_catalog() -> list[dict]: ...      # catalog.json pieces, then catalog.d/*.json pieces in file-name order; unique slugs; known collections
def load_collections() -> list[dict]: ...  # [{id, title, kind}] in display order
def sort_key(piece_or_entry, catalog_index: dict, collection_index: dict) -> tuple: ...  # (level, collection order, merged catalog index)
# CLI: --manifest-only (re-render every entry from catalog + existing entry + verification stats),
#      --out-dir DIR (write scores there, skip validation, manifest and verification)

# content/tools/level.py
CUTS: tuple[float, float, float, float]          # (1.76, 4.09, 9.11, 12.68)
WEIGHTS: dict[str, float]
def features(path: Path, tempo: float) -> dict[str, float]: ...
def score(f: dict[str, float]) -> float: ...
def propose(s: float, cuts: tuple = CUTS) -> int: ...
def calibrate(rows: list[tuple[int, float]]) -> tuple[float, ...]: ...
def leave_one_out(rows: list[tuple[int, float]]) -> tuple[int, int]: ...  # (within one, exact)

# content/tools/lint_gate.py
CLI: Path  # packages/engine/dist/cli/main.js
PROFILES = ("medium", "large")
def lint_piece(score: Path, profile: str) -> dict: ...  # {notes, errors, warnings, counts}
def engine_src_sha256() -> str: ...                     # sha256 over packages/engine/src/**/*.ts (sorted paths, LF-normalised)
def gate(slugs: list[str]) -> dict[str, dict]: ...      # {slug: {profiles: {medium, large}, scoreSha256, engineSrcSha256, cli}}

# content/tools/gates.py   CLI: --only SLUG... | --new | --all  [--no-lint]
# content/tools/arrangements/__init__.py
def load() -> tuple[dict[str, dict], dict[str, dict]]: ...  # (PIECES, REFERENCES) of every collection module present
def reference(slug: str) -> dict: ...                        # {melody: [midi...], compare: "exact"|"intervals", url, retrieved, note}
```

```ts
// packages/engine/src/library/benchmarkSet.ts
export const CORE_BENCHMARK_SET = 'core30';
export interface BenchmarkTagged {
  slug: string;
  benchmarkSet?: string | null;
}
export function benchmarkEntries<T extends BenchmarkTagged>(
  entries: readonly T[],
  set?: string,
): T[];

// packages/engine/cli/evalhands.ts
export interface EvalHandsOptions {
  /* existing fields */ librarySet?: string; // default 'core30'; 'all' scores every piece
}
// HandsScorecard.library: (HandSetResult & { manifest: string; set: string }) | null

// apps/web/src/library/manifest.ts
export interface LibraryPiece {
  /* existing fields */ collection: string;
  collectionId: string;
  benchmarkSet: string | null;
}
export function requiresCredit(p: LibraryPiece): boolean; // CC BY and CC BY-SA
```

Catalog piece fields (new pieces; core 30 get the ones marked \*):

- **Every piece:**
  - `slug`, `source` (`"own"` or `"mutopia"`), `level`, `title`, `composer`, `composerDates`, `catalogue`, `year`.
  - `tempoBpm` (quarter notes per minute).
  - `tempoSource`\*: where the tempo comes from, for example `"printed: Allegretto, quarter = 108 (Schirmer 1904)"`, `"LilyPond \\midi block of the source"`, or `"editorial: comfortable beginner tempo, half of the customary 160"`.
  - `collection`\* (a collection id).
  - `levelNote`\*: one line with the syllabus placement and the heuristic's proposal.
  - `levelOverride`: only when the final level differs from the proposal by more than one.
  - `benchmarkSet`\*: `"core30"` for the 30; omitted, which means `null`, for new pieces.
  - `notes`.
- **Mutopia only:**
  - `ftpDir`, `main` (the RDF `lyFile`), `subdir`, `publishedMidi`.
  - `retrievedAt`\* (pinned `YYYY-MM-DD`).
  - `sourceSha256` (SHA-256 of the fetched main `.ly`; for the core 30, Task 3 adds it once the reproduction succeeds).
  - `convert`, `excerpt`, `keyName`.
- **Own arrangements only:**
  - `arranger: "digitus2 project"`.
  - `melody: { authors: [{ name, died }] | "traditional", firstPublished: <year or null>, reference: { url, retrieved, description } }`.

Manifest additions (every entry): `collection` (title), `collectionId`, `benchmarkSet` (`"core30"` or `null`), inserted right after `level`. `tempoSource`, `levelNote` and `melody` stay in the catalog: the manifest is in the first load (decision 14).

`verification.json` additions per piece, written by `gates.py`:

| Key             | Content                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `levelProposal` | `{features, score, level}`                                                                                 |
| `melody`        | own pieces only: `{exact, notes, compare, reference, firstDifference}`                                     |
| `lint`          | `{profiles: {medium: {notes, errors, warnings, counts}, large: {...}}, scoreSha256, engineSrcSha256, cli}` |

The top-level `spanFlags` is unchanged.

## Collections (display order)

| id                     | title                                                          | kind  | Core 30 members                                        |
| ---------------------- | -------------------------------------------------------------- | ----- | ------------------------------------------------------ |
| `children-songs`       | Children's songs                                               | genre | Twinkle, Mary, Frère Jacques                           |
| `folk-songs`           | Folk songs                                                     | genre | Scarborough Fair, Greensleeves                         |
| `christmas`            | Christmas carols and songs                                     | genre | Jingle Bells                                           |
| `hymns`                | Hymns and spirituals                                           | genre | Amazing Grace                                          |
| `anthems`              | National anthems                                               | genre |                                                        |
| `songs-before-1929`    | Songs before 1929                                              | genre | Happy Birthday                                         |
| `easy-rags`            | Ragtime, simplified                                            | genre |                                                        |
| `classical-themes`     | Classical themes, simplified                                   | genre | Ode to Joy, Pachelbel                                  |
| `anna-magdalena`       | Notebook for Anna Magdalena Bach (1725)                        | set   | BWV Anh. 114, 115                                      |
| `handel-aylesford`     | Handel, Aylesford Pieces                                       | set   |                                                        |
| `bach-little-preludes` | Bach, Little Preludes                                          | set   |                                                        |
| `dances`               | Minuets, dances and rondos                                     | genre | Mozart K. 2                                            |
| `swedish-folk-dances`  | Swedish folk dances (Traditioner af Swenska Folk-Dansar, 1814) | set   |                                                        |
| `burgmuller-op100`     | Burgmüller, 25 Easy and Progressive Studies, Op. 100           | set   | Nos. 1, 2, 3, 5                                        |
| `schumann-op68`        | Schumann, Album for the Young, Op. 68                          | set   | Nos. 1, 8                                              |
| `tchaikovsky-op39`     | Tchaikovsky, Album for the Young, Op. 39                       | set   |                                                        |
| `sonatinas`            | Sonatinas and sonatas                                          | genre | Clementi Op. 36/1 mvt 1, K. 545 mvt 1, Moonlight mvt 1 |
| `bach-inventions`      | Bach, Inventions, BWV 772–786                                  | set   | Invention No. 1                                        |
| `bach-wtc`             | Bach, The Well-Tempered Clavier                                | set   | Prelude BWV 846                                        |
| `schumann-op15`        | Schumann, Scenes from Childhood, Op. 15                        | set   |                                                        |
| `chopin-op28`          | Chopin, Preludes, Op. 28                                       | set   | Nos. 4, 7                                              |
| `character-pieces`     | Romantic character pieces                                      | genre | Für Elise, Gymnopédie No. 1, Waltz Op. 69/2            |
| `ragtime`              | Ragtime                                                        | genre | The Entertainer                                        |

## Candidate list

Levels follow `catalog.json`'s comment: 1 five-finger position, 2 easy (ABRSM about grades 1 to 2), 3 early intermediate (about 2 to 4), 4 intermediate (about 5 to 6), 5 stretch (about 6 to 7).

Syllabus anchors for the `levelNote`:

- **Henle's 1 to 9 scale** ([levels of difficulty](https://www.henle.de/Levels-of-Difficulty/)): level 1 is Anna Magdalena Notebook Nos. 4 and 5, level 2 is WTC I Prelude No. 1, level 3 is Beethoven Op. 49, level 4 is Grieg Op. 12 No. 4. Mapping: Henle 1 is about our 2, Henle 2 about our 3, Henle 3 about our 4, Henle 4 about our 5.
- **Henle's per-piece levels for Burgmüller Op. 100** ([HN 1726](https://www.henle.de/en/25-Etudes-op.-100/HN-1726)): levels 1 to 3.
- **ABRSM** ([piano exams](https://www.abrsm.org/en-gb/exams/piano-exams); current and past syllabus lists).
- **RCM Piano Syllabus 2022** ([PDF](https://teacherportal.rcmusic.com/getattachment/57f3734d-97e5-4777-b67e-4b1111ee31a3/piano-syllabus-2022-edition.pdf)): RCM 1 to 2 is about our 2, 3 to 5 about our 3, 6 to 7 about our 4, 8 to 9 about our 5.
- **The collection's own progression:**
  - Burgmüller's progressive order.
  - Schumann's split of Op. 68 into "Für Kleinere" (Nos. 1 to 18) and "Für Erwachsenere" (Nos. 19 to 43).
  - Tchaikovsky's Op. 39, written for children.
  - Clementi's numbering.

Where nothing is published, the `levelNote` says so and relies on the heuristic.

Spares: about 23 percent (11 of 47) for arrangements and about 28 percent (21 of 76) for Mutopia engravings, concentrated at levels 3 to 5, where conversion, span and lint failures are expected (the core 30 had 5 lint failures and 4 span-flagged pieces, all at levels 3 to 5). Use a spare only when a main candidate of the same level fails or turns out over length.

An implementer may add up to three replacements per task from the mirror. Each must meet every rule here (licence, instrument, length, gates) and be recorded in its fragment with `"addedBy": "Task N"` and the reason. Mutopia piece pages are `https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=<id>`.

### Arrangements (own, CC0): 47 main, 11 spares

| Task | Slug                             | Tune                                        | Melody author (died) / first published           | Collection        | Level |
| ---- | -------------------------------- | ------------------------------------------- | ------------------------------------------------ | ----------------- | ----- |
| 8    | `hot-cross-buns`                 | Hot Cross Buns                              | traditional (English street cry, printed 1798)   | children-songs    | 1     |
| 8    | `alle-meine-entchen`             | Alle meine Entchen (All My Ducklings)       | traditional (German, 19th c.)                    | children-songs    | 1     |
| 8    | `lightly-row`                    | Lightly Row (Hänschen klein)                | traditional (German)                             | children-songs    | 1     |
| 8    | `au-clair-de-la-lune`            | Au clair de la lune                         | traditional (French, 18th c.)                    | children-songs    | 1     |
| 8    | `go-tell-aunt-rhody`             | Go Tell Aunt Rhody                          | J.-J. Rousseau (1778), Le devin du village, 1752 | children-songs    | 1     |
| 8    | `london-bridge`                  | London Bridge Is Falling Down               | traditional (English)                            | children-songs    | 1     |
| 8    | `hush-little-baby`               | Hush, Little Baby                           | traditional (American)                           | children-songs    | 1     |
| 8    | `this-old-man`                   | This Old Man                                | traditional (English, printed 1906)              | children-songs    | 1     |
| 8    | `old-macdonald-had-a-farm`       | Old MacDonald Had a Farm                    | traditional (printed 1917)                       | children-songs    | 1     |
| 8    | `skip-to-my-lou`                 | Skip to My Lou                              | traditional (American, 1840s)                    | children-songs    | 1     |
| 8    | `kuckuck`                        | Kuckuck, Kuckuck, ruft's aus dem Wald       | traditional (Austrian)                           | children-songs    | 1     |
| 8    | `the-muffin-man`                 | The Muffin Man                              | traditional (English, c. 1820)                   | children-songs    | 1     |
| 8    | `pease-porridge-hot`             | Pease Porridge Hot                          | traditional (English, c. 1760)                   | children-songs    | 1     |
| 9    | `jolly-old-saint-nicholas`       | Jolly Old Saint Nicholas                    | traditional (American, 1865)                     | christmas         | 1     |
| 9    | `up-on-the-housetop`             | Up on the Housetop                          | Benjamin Hanby (1867), 1864                      | christmas         | 1     |
| 9    | `silent-night`                   | Silent Night                                | Franz Xaver Gruber (1863), 1818                  | christmas         | 2     |
| 9    | `joy-to-the-world`               | Joy to the World (tune Antioch)             | Lowell Mason (1872), 1839                        | christmas         | 2     |
| 9    | `o-come-all-ye-faithful`         | O Come, All Ye Faithful (Adeste Fideles)    | John Francis Wade (1786), c. 1751                | christmas         | 2     |
| 9    | `deck-the-halls`                 | Deck the Halls (Nos Galan)                  | traditional (Welsh)                              | christmas         | 2     |
| 9    | `we-wish-you-a-merry-christmas`  | We Wish You a Merry Christmas               | traditional (English West Country)               | christmas         | 2     |
| 9    | `good-king-wenceslas`            | Good King Wenceslas (Tempus adest floridum) | traditional, Piae Cantiones 1582                 | christmas         | 2     |
| 10   | `when-the-saints-go-marching-in` | When the Saints Go Marching In              | traditional (spiritual; hymn version 1896)       | hymns             | 1     |
| 10   | `michael-row-the-boat-ashore`    | Michael, Row the Boat Ashore                | traditional (spiritual, printed 1867)            | hymns             | 1     |
| 10   | `old-hundredth`                  | Old Hundredth                               | Louis Bourgeois (c. 1560), Genevan Psalter 1551  | hymns             | 2     |
| 10   | `simple-gifts`                   | Simple Gifts (the 1848 Shaker tune)         | Joseph Brackett (1882), 1848                     | hymns             | 2     |
| 10   | `holy-holy-holy`                 | Holy, Holy, Holy (tune Nicaea)              | John Bacchus Dykes (1876), 1861                  | hymns             | 2     |
| 10   | `swing-low-sweet-chariot`        | Swing Low, Sweet Chariot                    | traditional (spiritual, printed 1872)            | hymns             | 2     |
| 10   | `la-marseillaise`                | La Marseillaise                             | Claude-Joseph Rouget de Lisle (1836), 1792       | anthems           | 2     |
| 10   | `god-save-the-king`              | God Save the King                           | traditional (printed 1744)                       | anthems           | 2     |
| 11   | `yankee-doodle`                  | Yankee Doodle                               | traditional (American, 18th c.)                  | folk-songs        | 1     |
| 11   | `shenandoah`                     | Shenandoah                                  | traditional (American, 19th c.)                  | folk-songs        | 2     |
| 11   | `londonderry-air`                | Londonderry Air                             | traditional (Irish), Petrie Collection 1855      | folk-songs        | 2     |
| 11   | `auld-lang-syne`                 | Auld Lang Syne                              | traditional (Scottish), Thomson 1799             | folk-songs        | 2     |
| 11   | `sakura-sakura`                  | Sakura, Sakura                              | traditional (Japanese), printed 1888             | folk-songs        | 2     |
| 11   | `korobeiniki`                    | Korobeiniki (the folk song)                 | traditional (Russian, 1860s)                     | folk-songs        | 2     |
| 11   | `la-cucaracha`                   | La Cucaracha                                | traditional (Spanish and Mexican)                | folk-songs        | 2     |
| 11   | `home-on-the-range`              | Home on the Range                           | Daniel E. Kelley (1905), 1873                    | folk-songs        | 2     |
| 12   | `camptown-races`                 | Camptown Races                              | Stephen Foster (1864), 1850                      | songs-before-1929 | 1     |
| 12   | `oh-susanna`                     | Oh! Susanna                                 | Stephen Foster (1864), 1848                      | songs-before-1929 | 1     |
| 12   | `long-long-ago`                  | Long, Long Ago                              | Thomas Haynes Bayly (1839), 1833                 | songs-before-1929 | 1     |
| 12   | `little-brown-jug`               | Little Brown Jug                            | Joseph Eastburn Winner (1918), 1869              | songs-before-1929 | 1     |
| 12   | `daisy-bell`                     | Daisy Bell (A Bicycle Built for Two)        | Harry Dacre (1922), 1892                         | songs-before-1929 | 2     |
| 12   | `the-entertainer-easy`           | The Entertainer, A strain (simplified)      | Scott Joplin (1917), 1902                        | easy-rags         | 2     |
| 12   | `maple-leaf-rag-easy`            | Maple Leaf Rag, A strain (simplified)       | Scott Joplin (1917), 1899                        | easy-rags         | 2     |
| 12   | `surprise-symphony-theme`        | Theme from the "Surprise" Symphony          | Joseph Haydn (1809), Symphony No. 94, 1791       | classical-themes  | 2     |
| 12   | `brahms-lullaby`                 | Lullaby (Wiegenlied), Op. 49 No. 4          | Johannes Brahms (1897), 1868                     | classical-themes  | 2     |
| 12   | `eine-kleine-nachtmusik-theme`   | Eine kleine Nachtmusik, opening theme       | W. A. Mozart (1791), K. 525, 1787                | classical-themes  | 2     |

Spares:

| Task | Slug                         | Level | Collection        | Author / first published            |
| ---- | ---------------------------- | ----- | ----------------- | ----------------------------------- |
| 8    | `lucy-locket`                | 1     | children-songs    | traditional                         |
| 8    | `sur-le-pont-d-avignon`      | 1     | children-songs    | traditional                         |
| 8    | `love-somebody`              | 1     | children-songs    | traditional                         |
| 9    | `o-christmas-tree`           | 2     | christmas         | traditional (German)                |
| 9    | `the-first-noel`             | 2     | christmas         | traditional (Cornish), printed 1823 |
| 10   | `a-mighty-fortress`          | 2     | hymns             | Martin Luther (1546), 1529          |
| 10   | `austrian-hymn`              | 2     | anthems           | Joseph Haydn (1809), 1797           |
| 11   | `loch-lomond`                | 2     | folk-songs        | traditional (Scottish), 1841        |
| 11   | `red-river-valley`           | 2     | folk-songs        | traditional, 1896                   |
| 12   | `in-the-good-old-summertime` | 2     | songs-before-1929 | George Evans (1915), 1902           |
| 12   | `morning-mood`               | 2     | classical-themes  | Edvard Grieg (1907), 1888           |

**Melody references.** The arrangement must reproduce the reference's pitch sequence exactly. A transposed reference is compared by intervals. Rhythm may be simplified (dotted or syncopated values straightened, and for the rags' A strains and the classical themes only the melody line of the cited bars kept); the omitted or altered bars are listed in the reference `note`. In order of preference:

1. The score in the English (or German, for `alle-meine-entchen`, `lightly-row`, `kuckuck`) Wikipedia article of the tune, as the M0 arrangements used.
2. A public-domain hymnal scan on Hymnary.org (tune page) for hymns and carols.
3. IMSLP for the classical themes: the first edition or a public-domain complete edition.
4. For the two rags, our own core MusicXML `joplin-the-entertainer` and the Mutopia Maple Leaf Rag (`JoplinS/maple`, id 23, public domain).
5. A dated public-domain song sheet (Library of Congress, Levy Sheet Music Collection) for the pre-1929 songs.

Record the URL, the retrieval date and which version you used (key, verse). Keep the retrieved page text under `content/_raw/references/` (gitignored), as M0 did. If no source with notation can be found, use the spare.

### Mutopia engravings: 76 main, 21 spares

PD means the typesetter placed the engraving in the public domain. CC licences are named with their version. Expected licences come from the mirror's headers; the RDF fetched in Task 3 is authoritative.

| Task | Slug                                                | Piece                                                 | Composer                             | Collection           | Mutopia id | Licence (typesetter)                        | Level | Notes                                                                                         |
| ---- | --------------------------------------------------- | ----------------------------------------------------- | ------------------------------------ | -------------------- | ---------- | ------------------------------------------- | ----- | --------------------------------------------------------------------------------------------- |
| 13   | `bach-minuet-f-major-bwv-anh-113`                   | Minuet in F major, BWV Anh. 113                       | Anonymous (Notebook)                 | anna-magdalena       | 74         | PD (Allen Garvin)                           | 2     | `BachJS/BWVAnh113/anna-magdalena-03`                                                          |
| 13   | `bach-minuet-g-major-bwv-anh-116`                   | Minuet in G major, BWV Anh. 116                       | Anonymous (Notebook)                 | anna-magdalena       | 77         | PD (Allen Garvin)                           | 2     | `BachJS/BWVAnh116/anna-magdalena-07`                                                          |
| 13   | `bach-minuet-a-minor-bwv-anh-120`                   | Minuet in A minor, BWV Anh. 120                       | Anonymous (Notebook)                 | anna-magdalena       | 1612       | PD (Steven McDougall)                       | 2     | `BachJS/BWVAnh120/BWV-120`                                                                    |
| 13   | `bach-polonaise-f-major-bwv-anh-117a`               | Polonaise in F major, BWV Anh. 117a                   | Anonymous (Notebook)                 | anna-magdalena       | 1013       | PD (Steven McDougall)                       | 2     | `BachJS/BWV117a/BWV-117a`                                                                     |
| 13   | `bach-minuet-c-minor-bwv-anh-121`                   | Minuet in C minor, BWV Anh. 121                       | Anonymous (Notebook)                 | anna-magdalena       | 1613       | PD (Steven McDougall)                       | 3     | `BachJS/BWVAnh121/BWV-121`                                                                    |
| 13   | `bach-musette-d-major-bwv-anh-126`                  | Musette in D major, BWV Anh. 126                      | Anonymous (Notebook)                 | anna-magdalena       | 79         | PD (Allen Garvin)                           | 3     | `BachJS/BWVAnh126/anna-magdalena-22`                                                          |
| 13   | `bach-march-e-flat-major-bwv-anh-127`               | March in E-flat major, BWV Anh. 127                   | Anonymous (Notebook)                 | anna-magdalena       | 1614       | PD (Steven McDougall)                       | 3     | `BachJS/BWVAnh127/BWV-127`                                                                    |
| 13   | `bach-polonaise-g-minor-bwv-anh-119`                | Polonaise in G minor, BWV Anh. 119                    | Anonymous (Notebook)                 | anna-magdalena       | 1016       | PD (Steven McDougall)                       | 3     | `BachJS/BWVAnh119/BWV-119`                                                                    |
| 13   | `bach-polonaise-d-minor-bwv-anh-128`                | Polonaise in D minor, BWV Anh. 128                    | Anonymous (Notebook)                 | anna-magdalena       | 1615       | PD (Steven McDougall)                       | 3     | `BachJS/BWVAnh128/BWV-128`                                                                    |
| 13   | `handel-aylesford-minuet-d-minor`                   | Minuet in D minor (Aylesford Pieces)                  | George Frideric Handel (1685–1759)   | handel-aylesford     | 157        | PD (Bas Wassink; Schott 1930)               | 2     | `HandelGF/Aylesford/09-menueti`                                                               |
| 13   | `behr-in-may`                                       | In May (Im Mai)                                       | Franz Behr (1837–1898)               | character-pieces     | 2155       | PD (John Mamoun; Thiebes-Stierlin c. 1903)  | 2     | header licence field is `mutopialicense`                                                      |
| 13   | `swedish-polska-norrbotten`                         | Polska from Norrbotten (part 1, No. 1)                | Traditional (Swedish)                | swedish-folk-dances  | 815        | CC BY 2.5 (Erik Sjölund)                    | 2     | LilyPond 2.8.5 source                                                                         |
| 13   | `andre-sonatina-op34-mvt1`                          | Sonatina in C major, Op. 34, 1st movement             | Johann Anton André (1775–1842)       | sonatinas            | 207        | PD (Bas Wassink)                            | 3     |                                                                                               |
| 13   | `wanhal-rondo-op42-no1`                             | Rondo in C major, Op. 42 No. 1                        | Johann Baptist Wanhal (1739–1813)    | dances               | 192        | PD (Bas Wassink)                            | 3     |                                                                                               |
| 14   | `burgmuller-op100-no4-la-petite-reunion`            | La petite réunion, Op. 100 No. 4                      | Friedrich Burgmüller (1806–1874)     | burgmuller-op100     | 219        | PD (Bas Wassink; Litolff)                   | 3     | editorial fingering (86)                                                                      |
| 14   | `burgmuller-op100-no6-progres`                      | Progrès, Op. 100 No. 6                                | Burgmüller                           | burgmuller-op100     | 215        | PD (Bas Wassink; Litolff)                   | 3     | fingering (87)                                                                                |
| 14   | `burgmuller-op100-no7-le-courant-limpide`           | Le courant limpide, Op. 100 No. 7                     | Burgmüller                           | burgmuller-op100     | 216        | PD (Bas Wassink; Litolff)                   | 3     | fingering (30)                                                                                |
| 14   | `burgmuller-op100-no8-la-gracieuse`                 | La gracieuse, Op. 100 No. 8                           | Burgmüller                           | burgmuller-op100     | 217        | PD (Bas Wassink; Litolff)                   | 3     | fingering (43)                                                                                |
| 14   | `burgmuller-op100-no10-tendre-fleur`                | Tendre fleur, Op. 100 No. 10                          | Burgmüller                           | burgmuller-op100     | 221        | PD (Bas Wassink; Litolff)                   | 3     | fingering (66)                                                                                |
| 14   | `burgmuller-op100-no11-la-bergeronnette`            | La bergeronnette, Op. 100 No. 11                      | Burgmüller                           | burgmuller-op100     | 222        | PD (Bas Wassink; Litolff)                   | 3     | fingering (45)                                                                                |
| 14   | `burgmuller-op100-no13-consolation`                 | Consolation, Op. 100 No. 13                           | Burgmüller                           | burgmuller-op100     | 224        | PD (Bas Wassink; Litolff)                   | 3     | fingering (55)                                                                                |
| 14   | `burgmuller-op100-no14-la-styrienne`                | La styrienne, Op. 100 No. 14                          | Burgmüller                           | burgmuller-op100     | 225        | PD (Bas Wassink; Litolff)                   | 3     | fingering (46)                                                                                |
| 14   | `burgmuller-op100-no16-douce-plainte`               | Douce plainte, Op. 100 No. 16                         | Burgmüller                           | burgmuller-op100     | 228        | PD (Bas Wassink; Litolff)                   | 3     | fingering (70)                                                                                |
| 14   | `burgmuller-op100-no9-la-chasse`                    | La chasse, Op. 100 No. 9                              | Burgmüller                           | burgmuller-op100     | 220        | PD (Bas Wassink; Litolff)                   | 4     | fingering (87)                                                                                |
| 14   | `burgmuller-op100-no12-l-adieu`                     | L'adieu, Op. 100 No. 12                               | Burgmüller                           | burgmuller-op100     | 223        | PD (Bas Wassink; Litolff)                   | 4     | fingering (97)                                                                                |
| 14   | `burgmuller-op100-no15-ballade`                     | Ballade, Op. 100 No. 15                               | Burgmüller                           | burgmuller-op100     | 227        | PD (Bas Wassink; Litolff)                   | 4     | fingering (63)                                                                                |
| 14   | `burgmuller-op100-no17-la-babillarde`               | La babillarde, Op. 100 No. 17                         | Burgmüller                           | burgmuller-op100     | 229        | PD (Bas Wassink; Litolff)                   | 4     | fingering (106)                                                                               |
| 14   | `burgmuller-op100-no18-inquietude`                  | Inquiétude, Op. 100 No. 18                            | Burgmüller                           | burgmuller-op100     | 230        | PD (Bas Wassink; Litolff)                   | 4     | fingering (38)                                                                                |
| 15   | `schumann-op68-no3-humming-song`                    | Humming Song, Op. 68 No. 3                            | Robert Schumann (1810–1856)          | schumann-op68        | 651        | CC BY-SA 3.0 (Philippe Hézaine; Peters)     | 2     | fingering (43)                                                                                |
| 15   | `schumann-op68-no5-little-piece`                    | Little Piece, Op. 68 No. 5                            | Schumann                             | schumann-op68        | 653        | CC BY-SA 2.5 (Philippe Hézaine; Peters)     | 2     | fingering (31)                                                                                |
| 15   | `schumann-op68-no2-soldiers-march`                  | Soldiers' March, Op. 68 No. 2                         | Schumann                             | schumann-op68        | 650        | CC BY-SA 2.5 (Philippe Hézaine)             | 3     |                                                                                               |
| 15   | `schumann-op68-no6-poor-orphan`                     | Poor Orphan, Op. 68 No. 6                             | Schumann                             | schumann-op68        | 687        | CC BY-SA 2.5 (Philippe Hézaine)             | 3     |                                                                                               |
| 15   | `schumann-op68-no7-hunting-song`                    | Hunting Song, Op. 68 No. 7                            | Schumann                             | schumann-op68        | 691        | CC BY-SA 3.0 (Philippe Hézaine)             | 3     |                                                                                               |
| 15   | `schumann-op68-no9-little-folk-song`                | Little Folk Song, Op. 68 No. 9                        | Schumann                             | schumann-op68        | 675        | CC BY-SA 2.5 (Philippe Hézaine)             | 3     |                                                                                               |
| 15   | `schumann-op68-no10-the-happy-farmer`               | The Happy Farmer, Op. 68 No. 10                       | Schumann                             | schumann-op68        | 659        | CC BY-SA 2.5 (Philippe Hézaine)             | 3     |                                                                                               |
| 15   | `schumann-op68-no16-first-loss`                     | First Loss, Op. 68 No. 16                             | Schumann                             | schumann-op68        | 676        | CC BY-SA 2.5 (Philippe Hézaine)             | 3     |                                                                                               |
| 15   | `schumann-op68-no18-reapers-song`                   | Reaper's Song, Op. 68 No. 18                          | Schumann                             | schumann-op68        | 663        | CC BY-SA 2.5 (Philippe Hézaine)             | 3     |                                                                                               |
| 15   | `schumann-op68-no12-knecht-ruprecht`                | Knecht Ruprecht, Op. 68 No. 12                        | Schumann                             | schumann-op68        | 784        | CC BY-SA 2.5 (Philippe Hézaine)             | 4     |                                                                                               |
| 15   | `schumann-op68-no14-little-study`                   | Little Study, Op. 68 No. 14                           | Schumann                             | schumann-op68        | 786        | CC BY-SA 2.5 (Philippe Hézaine)             | 4     |                                                                                               |
| 15   | `schumann-op68-no26-untitled`                       | Untitled (No. 26), Op. 68 No. 26                      | Schumann                             | schumann-op68        | 788        | CC BY-SA 2.5 (Philippe Hézaine)             | 4     |                                                                                               |
| 15   | `tchaikovsky-op39-no1-morning-prayer`               | Morning Prayer, Op. 39 No. 1                          | Pyotr Ilyich Tchaikovsky (1840–1893) | tchaikovsky-op39     | 2032       | PD (Rem Zolotykh; Schirmer 1904)            | 3     | fingering (34)                                                                                |
| 15   | `tchaikovsky-op39-no16-old-french-song`             | Old French Song, Op. 39 No. 16                        | Tchaikovsky                          | tchaikovsky-op39     | 2080       | PD (David McNamara; Schirmer 1904)          | 3     |                                                                                               |
| 15   | `tchaikovsky-op39-no5-march-of-the-wooden-soldiers` | March of the Wooden Soldiers, Op. 39 No. 5            | Tchaikovsky                          | tchaikovsky-op39     | 1806       | PD (typesetter "Anonymous"; Schirmer 1904)  | 4     |                                                                                               |
| 16   | `bach-prelude-c-major-bwv-939`                      | Little Prelude in C major, BWV 939                    | Johann Sebastian Bach (1685–1750)    | bach-little-preludes | 1593       | CC BY-SA 3.0 (Hajo Dezelski)                | 2     |                                                                                               |
| 16   | `bach-applicatio-c-major-bwv-994`                   | Applicatio, BWV 994                                   | Bach                                 | bach-little-preludes | 66         | PD (Allen Garvin)                           | 3     | Bach's own fingering exercise: keep a `.fingered` copy if the source has digits               |
| 16   | `bach-prelude-c-major-bwv-924`                      | Little Prelude in C major, BWV 924                    | Bach                                 | bach-little-preludes | 978        | CC BY-SA 3.0 (JD Erickson)                  | 3     |                                                                                               |
| 16   | `bach-prelude-d-minor-bwv-926`                      | Little Prelude in D minor, BWV 926                    | Bach                                 | bach-little-preludes | 69         | PD (Allen Garvin)                           | 3     | fingering (84)                                                                                |
| 16   | `bach-prelude-c-major-bwv-933`                      | Little Prelude in C major, BWV 933                    | Bach                                 | bach-little-preludes | 1537       | CC BY-SA 3.0 (Hajo Dezelski)                | 3     |                                                                                               |
| 16   | `bach-prelude-d-minor-bwv-940`                      | Little Prelude in D minor, BWV 940                    | Bach                                 | bach-little-preludes | 1594       | CC BY-SA 3.0 (Hajo Dezelski)                | 3     |                                                                                               |
| 16   | `bach-prelude-e-minor-bwv-941`                      | Little Prelude in E minor, BWV 941                    | Bach                                 | bach-little-preludes | 1595       | CC BY-SA 3.0 (Hajo Dezelski)                | 3     |                                                                                               |
| 16   | `bach-invention-no4-bwv-775`                        | Invention No. 4 in D minor, BWV 775                   | Bach                                 | bach-inventions      | 67         | PD (Allen Garvin)                           | 4     |                                                                                               |
| 16   | `bach-invention-no8-bwv-779`                        | Invention No. 8 in F major, BWV 779                   | Bach                                 | bach-inventions      | 61         | PD (Allen Garvin)                           | 4     |                                                                                               |
| 16   | `bach-invention-no10-bwv-781`                       | Invention No. 10 in G major, BWV 781                  | Bach                                 | bach-inventions      | 62         | PD (Allen Garvin)                           | 4     |                                                                                               |
| 16   | `bach-invention-no13-bwv-784`                       | Invention No. 13 in A minor, BWV 784                  | Bach                                 | bach-inventions      | 59         | PD (Allen Garvin)                           | 4     |                                                                                               |
| 16   | `bach-invention-no14-bwv-785`                       | Invention No. 14 in B-flat major, BWV 785             | Bach                                 | bach-inventions      | 72         | PD (Allen Garvin)                           | 5     |                                                                                               |
| 16   | `bach-invention-no15-bwv-786`                       | Invention No. 15 in B minor, BWV 786                  | Bach                                 | bach-inventions      | 68         | PD (Allen Garvin)                           | 5     |                                                                                               |
| 17   | `clementi-sonatina-op36-no1-mvt2`                   | Sonatina Op. 36 No. 1, 2nd movement (Andante)         | Muzio Clementi (1752–1832)           | sonatinas            | 804        | PD (Brian D. Rude; Schirmer 1893)           | 3     | same source as the core mvt 1, `convert.score: 2`                                             |
| 17   | `clementi-sonatina-op36-no1-mvt3`                   | Sonatina Op. 36 No. 1, 3rd movement (Vivace)          | Clementi                             | sonatinas            | 804        | PD (Brian D. Rude)                          | 3     | `convert.score: 3`                                                                            |
| 17   | `kuhlau-sonatina-op20-no1-mvt2`                     | Sonatina Op. 20 No. 1, 2nd movement (Andante)         | Friedrich Kuhlau (1786–1832)         | sonatinas            | 233        | PD (Bas Wassink; Schott)                    | 3     |                                                                                               |
| 17   | `kuhlau-sonatina-op20-no1-mvt1`                     | Sonatina Op. 20 No. 1, 1st movement (Allegro)         | Kuhlau                               | sonatinas            | 232        | PD (Bas Wassink)                            | 4     | fingering (58)                                                                                |
| 17   | `kuhlau-sonatina-op20-no1-mvt3`                     | Sonatina Op. 20 No. 1, 3rd movement (Rondo)           | Kuhlau                               | sonatinas            | 234        | PD (Bas Wassink)                            | 4     | fingering (14)                                                                                |
| 17   | `mozart-sonata-k545-mvt2`                           | Piano Sonata K. 545, 2nd movement (Andante)           | Wolfgang Amadeus Mozart (1756–1791)  | sonatinas            | 1007       | CC BY-SA 3.0 (Alejandro Sierra)             | 4     | fingering (294)                                                                               |
| 17   | `mozart-sonata-k545-mvt3`                           | Piano Sonata K. 545, 3rd movement (Rondo)             | Mozart                               | sonatinas            | 1027       | CC BY-SA 3.0 (Alejandro Sierra)             | 4     | fingering (284)                                                                               |
| 17   | `beethoven-sonata-op49-no2-mvt2`                    | Sonata Op. 49 No. 2, 2nd movement (Tempo di Menuetto) | Ludwig van Beethoven (1770–1827)     | sonatinas            | 777        | PD (Stelios Samelis; B&H)                   | 4     | Henle level 3                                                                                 |
| 17   | `haydn-sonata-hob-xvi-27-mvt2`                      | Sonata Hob. XVI:27, 2nd movement (Menuetto)           | Joseph Haydn (1732–1809)             | sonatinas            | 186        | PD (Bas Wassink; Peters)                    | 4     |                                                                                               |
| 17   | `mozart-sonata-k331-mvt3-rondo-alla-turca`          | Rondo alla Turca, K. 331, 3rd movement                | Mozart                               | sonatinas            | 108        | PD (Rune Zedeler and Chris Sawer)           | 5     | fingering (132); excerpt if over 4 minutes                                                    |
| 17   | `beethoven-sonata-op13-mvt2`                        | Sonata "Pathétique" Op. 13, 2nd movement (opening)    | Beethoven                            | sonatinas            | 295        | PD (Chris Sawer; Berners 1908)              | 5     | excerpt: the theme and its restatement (about bars 1–16), end at the cadence; fingering (349) |
| 18   | `grieg-lyric-pieces-op12-no7-album-leaf`            | Album Leaf, Op. 12 No. 7                              | Edvard Grieg (1843–1907)             | character-pieces     | 2194       | CC BY-SA 4.0 (Knute Snortum; Schirmer 1902) | 4     | check the number against the source (directory says No03)                                     |
| 18   | `schumann-op15-no1-of-foreign-lands`                | Of Foreign Lands and Peoples, Op. 15 No. 1            | Schumann                             | schumann-op15        | 354        | PD (Ying-Chun Liu; 1900)                    | 5     | fingering (75)                                                                                |
| 18   | `schumann-op15-no7-traumerei`                       | Träumerei, Op. 15 No. 7                               | Schumann                             | schumann-op15        | 504        | PD (Ying-Chun Liu; 1900)                    | 5     | fingering (194)                                                                               |
| 18   | `chopin-prelude-op28-no20`                          | Prelude in C minor, Op. 28 No. 20                     | Frédéric Chopin (1810–1849)          | chopin-op28          | 472        | PD (Magnus Lewis-Smith; Peters)             | 5     | span risk (chords)                                                                            |
| 18   | `chopin-prelude-op28-no6`                           | Prelude in B minor, Op. 28 No. 6                      | Chopin                               | chopin-op28          | 469        | PD (Magnus Lewis-Smith; Peters)             | 5     | multi-file source (`header.ly`): `main` from the RDF                                          |
| 18   | `schubert-moment-musical-d780-no3`                  | Moment musical in F minor, D. 780 No. 3               | Franz Schubert (1797–1828)           | character-pieces     | 1023       | PD (Claude Chaudron; 1827 edition)          | 5     |                                                                                               |
| 18   | `mendelssohn-op30-no6-venetian-boat-song`           | Venetian Boat Song, Op. 30 No. 6                      | Felix Mendelssohn (1809–1847)        | character-pieces     | 1741       | PD (Ryan Prince; B&H 1874–77)               | 5     |                                                                                               |
| 18   | `joplin-the-easy-winners`                           | The Easy Winners                                      | Scott Joplin (1868–1917)             | ragtime              | 352        | PD (Tom Harke; original edition)            | 5     | excerpt if over 4 min 15 s                                                                    |
| 18   | `joplin-peacherine-rag`                             | Peacherine Rag                                        | Joplin                               | ragtime              | 335        | PD (Antonio Palamà)                         | 5     | excerpt if over 4 min 15 s                                                                    |

Spares (Mutopia):

| Task | Slug                                              | Mutopia id | Licence      | Level | Collection                      |
| ---- | ------------------------------------------------- | ---------- | ------------ | ----- | ------------------------------- |
| 13   | `bach-minuet-b-flat-major-bwv-anh-118`            | 1014       | PD           | 2     | anna-magdalena                  |
| 13   | `handel-aylesford-minuet-d-major`                 | 161        | PD           | 2     | handel-aylesford                |
| 13   | `handel-aylesford-minuet-f-major`                 | 163        | PD           | 2     | handel-aylesford                |
| 13   | `swedish-polska-vastergotland`                    | 820        | CC BY 2.5    | 2     | swedish-folk-dances             |
| 13   | `pleyel-minuet-c-major`                           | 191        | PD           | 3     | dances                          |
| 13   | `muller-siciliano-a-minor`                        | 208        | PD           | 3     | dances                          |
| 13   | `handel-aylesford-air-b-flat-major`               | 162        | PD           | 3     | handel-aylesford                |
| 15   | `schumann-op68-no4-chorale`                       | 782        | CC BY-SA 2.5 | 2     | schumann-op68                   |
| 15   | `schumann-op68-no11-sicilienne`                   | 783        | CC BY-SA 2.5 | 4     | schumann-op68                   |
| 16   | `bach-prelude-f-major-bwv-928`                    | 63         | PD           | 4     | bach-little-preludes            |
| 16   | `bach-invention-no2-bwv-773`                      | 58         | PD           | 5     | bach-inventions                 |
| 17   | `beethoven-sonata-op49-no1-mvt1`                  | 912        | PD           | 4     | sonatinas                       |
| 17   | `mozart-sonata-k331-mvt1-theme`                   | 614        | PD           | 4     | sonatinas                       |
| 17   | `beethoven-minuet-woo-82`                         | 904        | PD           | 4     | dances                          |
| 17   | `beethoven-sonata-op49-no2-mvt1`                  | 776        | PD           | 5     | sonatinas                       |
| 18   | `satie-gymnopedie-no3`                            | 39         | PD           | 4     | character-pieces                |
| 18   | `gobbaerts-les-etoiles-d-or-no1`                  | 2092       | CC BY-SA 4.0 | 3     | character-pieces                |
| 18   | `czerny-op821-no1`                                | 2060       | PD           | 3     | dances                          |
| 18   | `joplin-elite-syncopations`                       | 1540       | PD           | 5     | ragtime                         |
| 18   | `grieg-op46-no4-in-the-hall-of-the-mountain-king` | 1888       | PD           | 5     | character-pieces                |
| 18   | `debussy-clair-de-lune`                           | 1778       | PD           | 5     | character-pieces (excerpt only) |

Excluded on purpose:

| Excluded                                                                                                   | Why                                             |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Living or recent composers on Mutopia (Kumar, Sidwell, Comeau, Iliev, Magnenat, Doonan, Brown, Hunter)     | not method repertoire                           |
| Verdi Traviata reductions                                                                                  | "Calcografía" licence strings, opera reductions |
| Czerny Op. 840                                                                                             | no `\score` block in the piece files            |
| Clementi Op. 42, Hanon                                                                                     | exercise collections without `\score` per piece |
| Large works (Schubert Impromptus, Chopin Études, Ballades, Beethoven sonata first movements beyond Op. 49) | above level 5                                   |

Clementi Op. 36 Nos. 2 to 6, Kuhlau Op. 55, Diabelli, Gurlitt, Türk and Köhler are not on Mutopia (checked against the mirror and the live composer pages on 2026-10-14).

### Counts

| Level | Core 30 | New own | New Mutopia | Total (all main pass) | Target | Spares (own / Mutopia) |
| ----- | ------- | ------- | ----------- | --------------------- | ------ | ---------------------- |
| 1     | 5       | 22      | 0           | 27                    | 25     | 3 / 0                  |
| 2     | 10      | 25      | 10          | 45                    | 45     | 8 / 5                  |
| 3     | 7       | 0       | 34          | 41                    | 40     | 0 / 5                  |
| 4     | 5       | 0       | 20          | 25                    | 25     | 0 / 6                  |
| 5     | 3       | 0       | 12          | 15                    | 15     | 0 / 5                  |
| All   | 30      | 47      | 76          | 153                   | 150    | 11 / 21                |

Licences of the 153 if every main candidate passes:

| Licence                  | Pieces | Source of the increase                                             |
| ------------------------ | ------ | ------------------------------------------------------------------ |
| CC0, own arrangements    | 57     | +47                                                                |
| Public-domain engravings | 70     | +55                                                                |
| CC BY-SA engravings      | 25     | +20: 12 Schumann Op. 68, 5 Bach little preludes, 2 K. 545, 1 Grieg |
| CC BY engraving          | 1      | the Swedish polska                                                 |

## Waves and ownership

| Wave | Tasks                  | Runs                                           | Depends on                                  |
| ---- | ---------------------- | ---------------------------------------------- | ------------------------------------------- |
| A    | 0 → 1 → 2              | sequential                                     |                                             |
| B    | 3, 4, 5, 6 in parallel | Task 6 is the only one running e2e             | A                                           |
| B2   | 7                      | after Tasks 4 and 5                            |                                             |
| C    | 8–18 in parallel       | eleven implementers, one catalog fragment each | 7; the Mutopia tasks 13–18 also depend on 3 |
| D    | 19 → 20 → 21           | sequential                                     |                                             |

Record in `docs/PROGRESS.md` (coordinator) before launching: owner "L1 workflow (wt/library-150)" for the paths under Global Constraints. `packages/engine/cli/evalhands.ts` may conflict with M3 if M3 changes the scorecard output path. This plan changes only the library selection and adds `set` to the library section.

---

### Task 0: Environment and baselines

**Files:**

- Create (gitignored, not committed): the shared `content/.venv` (through the junction), `content/_raw/schema/*.xsd` (downloaded by `validate.load_schema()`), `packages/engine/dist/`.

- [ ] **Step 1: Create the content environment.**

```bash
cd C:/Users/maxim/Desktop/projects/github/thingamajig-wt/library-150
test -x content/.venv/Scripts/python.exe || python -m venv content/.venv   # junction target is empty: this populates the shared env
content/.venv/Scripts/python.exe -m pip install -r content/requirements.txt  # background it: the lilypond wheel is large
content/.venv/Scripts/python.exe -I -c "import lilypond, music21, verovio, lxml; print(lilypond.executable(), music21.__version__, verovio.toolkit().getVersion())"
```

Expected: a `lilypond.exe` path, `10.5.0`, a Verovio 6.3 version. If writing through the junction fails (permissions), create `content/.venv-l1` instead: the root `.gitignore` ignores `.venv-*/`. Then use `PY=content/.venv-l1/Scripts/python.exe` everywhere and say so in the hand-off.

- [ ] **Step 2: Check LilyPond and the schema.**

```bash
PY=content/.venv/Scripts/python.exe
$PY -I content/tools/ly2musicxml.py content/tools/tests/fixtures/features.ly --build content/_build/_smoke --out content/_build/_smoke/out.musicxml
$PY -I -c "import sys; sys.path.insert(0, 'content/tools'); import validate; print(validate.load_schema() is not None)"
```

Expected: `wrote content/_build/_smoke/out.musicxml`, and `True` (the XSD is downloaded into `content/_raw/schema/`).

- [ ] **Step 3: Baselines.**

```bash
$PY -I -m pytest content/tools/tests -q -p no:cacheprovider
pnpm --filter @digitus2/engine build
pnpm --filter @digitus2/engine exec vitest run src/fingering/solve.test.ts src/eval/hands.test.ts src/eval/metamorphic.test.ts src/io/midi/engrave.library.test.ts src/io/musicxml/smoke.test.ts src/io/midi/motion.test.ts --reporter=verbose
pnpm verify hygiene design typecheck lint unit build bundle
```

Expected: content pytest all pass (M0 recorded 95; M6 added `test_musicxml2midi.py`). The engine tests pass. Record the durations of these six library tests (measured while writing this plan):

| Test                                         | Duration |
| -------------------------------------------- | -------- |
| `motion` "counts the 30 library pieces"      | 694 ms   |
| `hands` "85 percent on the built-in library" | 812 ms   |
| `smoke` "parses every built-in score"        | 957 ms   |
| `solve` "five-note chord"                    | 568 ms   |
| `metamorphic` "library pieces"               | 1614 ms  |
| `solve` "exact search oracle"                | 884 ms   |

Record the bundle step's initial JavaScript and CSS gzip total (M4: 88.8 KB).

- [ ] **Step 4: Hand-off.** No tracked file changes. Report: the environment path, the six durations, the bundle total, the content and engine test counts.

---

### Task 1: Catalog v2, fragments, a safe build, and the core-30 pins

**Files:**

- Create: `content/tools/jsonio.py`, `content/tools/catalog.d/.gitkeep`, `content/tools/tests/fixtures/core30.json`, `content/tools/tests/fixtures/core30-manifest.json` (today's manifest, the reference for the core-30 entries), `content/tools/tests/test_jsonio.py`, `content/tools/tests/test_core30.py`, `content/tools/tests/test_catalog.py`
- Modify: `content/tools/catalog.json`, `content/tools/build.py`, `content/tools/check_spans.py` (write under the lock), `content/tools/tests/test_library.py`, `content/manifest.json` (regenerated with `--manifest-only`), `content/.gitignore` (nothing new: `_build/` already covers the lock)

**Interfaces:** consumes `build.py` as described above; produces `jsonio`, `load_catalog()` with fragments, `load_collections()`, the new manifest keys, `--manifest-only`, `--out-dir`.

- [ ] **Step 1: Write the fixture of the core 30.** Write `content/tools/tests/fixtures/core30.json` with a one-off script (scratchpad; do not commit the script):

```json
{
  "slugs": ["twinkle-twinkle-little-star", "...30 slugs in today's manifest order..."],
  "sha256": { "twinkle-twinkle-little-star.musicxml": "<hex>", "...": "...38 files..." }
}
```

Compute the SHA-256 over the committed bytes of every file in `content/scores/` today (38 files: 30 scores and 8 `.fingered`).

- [ ] **Step 2: Write the failing tests.**

`content/tools/tests/test_jsonio.py`:

```python
"""jsonio: one lock for the library's shared JSON files and atomic replacement (L1 plan, decision 3)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import jsonio  # noqa: E402

WRITER = """
import sys
sys.path.insert(0, {tools!r})
import jsonio
from pathlib import Path
p = Path({path!r})
for i in range(40):
    jsonio.update_json(p, lambda d: {{**d, f"{name}-{{i}}": i}})
"""


def test_concurrent_writers_keep_every_entry(tmp_path):
    path = tmp_path / "shared.json"
    jsonio.write_json(path, {})
    procs = [subprocess.Popen([sys.executable, "-I", "-c", WRITER.format(tools=str(TOOLS), path=str(path), name=n)])
             for n in ("a", "b", "c")]
    assert [p.wait(timeout=300) for p in procs] == [0, 0, 0]
    data = json.loads(path.read_text(encoding="utf-8"))
    assert len(data) == 120


def test_atomic_write_leaves_no_temporary_file(tmp_path):
    target = tmp_path / "x.musicxml"
    jsonio.write_atomic(target, b"<a/>")
    jsonio.write_atomic(target, b"<b/>")
    assert target.read_bytes() == b"<b/>"
    assert [p.name for p in tmp_path.iterdir()] == ["x.musicxml"]


def test_stale_lock_is_broken(tmp_path, monkeypatch):
    monkeypatch.setattr(jsonio, "LOCK", tmp_path / ".lock")
    (tmp_path / ".lock").write_text("123 0", encoding="utf-8")
    import os, time
    os.utime(tmp_path / ".lock", (time.time() - 4000, time.time() - 4000))
    with jsonio.library_lock(timeout=5, stale=1800):
        assert (tmp_path / ".lock").exists()
    assert not (tmp_path / ".lock").exists()
```

`content/tools/tests/test_core30.py`:

```python
"""The first 30 pieces never change (L1 plan, Review Focus 1)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
CONTENT = TOOLS.parent
FIX = json.loads((TOOLS / "tests" / "fixtures" / "core30.json").read_text(encoding="utf-8"))
MANIFEST = json.loads((CONTENT / "manifest.json").read_text(encoding="utf-8"))
NEW_KEYS = {"collection", "collectionId", "benchmarkSet"}


def test_core30_scores_are_byte_identical():
    for name, digest in FIX["sha256"].items():
        assert hashlib.sha256((CONTENT / "scores" / name).read_bytes()).hexdigest() == digest, name


def test_exactly_the_core30_carry_the_benchmark_set():
    tagged = [e["slug"] for e in MANIFEST if e["benchmarkSet"] == "core30"]
    assert sorted(tagged) == sorted(FIX["slugs"]) and len(tagged) == 30
    assert all(e["benchmarkSet"] is None for e in MANIFEST if e["slug"] not in FIX["slugs"])


def test_core30_manifest_entries_only_gain_the_new_keys():
    before = {e["slug"]: e for e in json.loads((TOOLS / "tests" / "fixtures" / "core30-manifest.json").read_text(encoding="utf-8"))}
    for e in MANIFEST:
        if e["slug"] in before:
            assert {k: v for k, v in e.items() if k not in NEW_KEYS} == before[e["slug"]]


def test_twinkle_is_the_first_level_one_piece():
    assert next(e for e in MANIFEST if e["level"] == 1)["slug"] == "twinkle-twinkle-little-star"
```

(Step 1 also copies today's `content/manifest.json` to `content/tools/tests/fixtures/core30-manifest.json`, 35 KB, as the reference for this test.)

`content/tools/tests/test_catalog.py`:

```python
"""The merged catalog: fragments, collections, required fields, licences of new arrangements."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import build  # noqa: E402

CAT = build.load_catalog()
COLL = {c["id"] for c in build.load_collections()}
NEW = [p for p in CAT if p.get("benchmarkSet") != "core30"]


def test_slugs_are_unique_and_collections_known():
    assert len({p["slug"] for p in CAT}) == len(CAT)
    assert all(p["collection"] in COLL for p in CAT)
    assert {p["collection"] for p in CAT} <= COLL


def test_fragments_load_in_file_name_order(tmp_path, monkeypatch):
    d = tmp_path / "catalog.d"
    d.mkdir()
    (d / "b.json").write_text(json.dumps({"task": "t", "pieces": [{"slug": "y"}], "rejected": []}), encoding="utf-8")
    (d / "a.json").write_text(json.dumps({"task": "t", "pieces": [{"slug": "x"}], "rejected": []}), encoding="utf-8")
    monkeypatch.setattr(build, "FRAGMENTS", d)
    assert [p["slug"] for p in build.load_fragments()] == ["x", "y"]


@pytest.mark.parametrize("piece", NEW, ids=lambda p: p["slug"])
def test_new_pieces_have_the_required_fields(piece):
    for k in ("tempoBpm", "tempoSource", "levelNote", "collection", "notes"):
        assert piece.get(k), k
    if piece["source"] == "mutopia":
        assert piece["retrievedAt"] and len(piece["sourceSha256"]) == 64


@pytest.mark.parametrize("piece", [p for p in NEW if p["source"] == "own"], ids=lambda p: p["slug"])
def test_new_arrangements_are_public_domain_in_the_us_and_the_eu(piece):
    m = piece["melody"]
    if m["authors"] != "traditional":
        assert all(a["died"] <= 1955 for a in m["authors"]), m["authors"]
        assert m["firstPublished"] is not None and m["firstPublished"] <= 1928
    assert m["reference"]["url"].startswith("https://") and m["reference"]["retrieved"]


def test_build_refuses_an_unknown_licence():
    with pytest.raises(SystemExit, match="unknown licence"):
        build.license_id("Creative Commons Attribution-NonCommercial 3.0")
```

Update `content/tools/tests/test_library.py`:

- `REQUIRED` gains `collection`, `collectionId`, `benchmarkSet`.
- The licence allow-list becomes `("Public Domain", "CC0-1.0", "CC-BY-2.5", "CC-BY-3.0", "CC-BY-4.0", "CC-BY-SA-2.5", "CC-BY-SA-3.0", "CC-BY-SA-4.0")`.
- `test_manifest_matches_catalog` sorts with `build.sort_key` over `build.load_catalog()`.
- Add: every `CC-BY*` entry has `typesetter`, `mutopiaId`, `licenseUrl` in `source`.

Run: `$PY -I -m pytest content/tools/tests/test_jsonio.py content/tools/tests/test_core30.py content/tools/tests/test_catalog.py content/tools/tests/test_library.py -q -p no:cacheprovider`
Expected: FAIL (`ModuleNotFoundError: jsonio`, missing keys, missing functions).

- [ ] **Step 3: Implement `jsonio.py`.**
  - Implement the interface above.
  - `library_lock` creates `LOCK` with `os.open(..., O_CREAT | O_EXCL | O_WRONLY)`, writes `"<pid> <time>"`, polls every 0.2 s, breaks a lock older than `stale` seconds, raises `TimeoutError` after `timeout`, and deletes the lock in `finally`.
  - `write_atomic` writes `.<name>.<pid>.tmp` in the target's directory, then calls `os.replace`, retrying five times with 0.2 s sleeps on `PermissionError` (Windows refuses replacement while a reader has the target open).
  - `update_json` reads (or `{}`/`[]` if missing), applies `fn`, and writes with `write_json`, all inside the lock.

- [ ] **Step 4: Change `build.py`.**
  1. `FRAGMENTS = HERE / "catalog.d"`.
     - `load_fragments()` reads `catalog.d/*.json` sorted by name and returns their `pieces`.
     - `load_catalog()` returns `catalog.json` pieces plus fragment pieces. It raises `SystemExit` on a duplicate slug or an unknown collection id.
     - `load_collections()` returns `catalog.json["collections"]`.
  2. `license_id(rdf_text)` maps through `LICENSES`, extended with:
     - `"Creative Commons Attribution 2.5"` → `CC-BY-2.5`, `https://creativecommons.org/licenses/by/2.5/`
     - `"Creative Commons Attribution 4.0"` and `"Creative Commons Attribution 4.0 International"` → `CC-BY-4.0`
     - `"Creative Commons Attribution-ShareAlike 4.0"` and `"...4.0 International"` → `CC-BY-SA-4.0`, `https://creativecommons.org/licenses/by-sa/4.0/`

     Any other text raises `SystemExit(f"unknown licence {text!r}")` instead of passing through.

  3. `rights_text` keeps its two existing wordings: "placed in the public domain" for public domain, and the licence wording for any CC licence. For CC BY add `(attribution required)` after the licence id; the CC BY-SA text is unchanged, so the core-30 bytes are unchanged.
  4. `mutopia_source` takes `retrievedAt` from the catalog piece when present, falling back to `fetch_log.json`.
  5. `manifest_entry` inserts `collection` (title), `collectionId`, `benchmarkSet` (`piece.get("benchmarkSet")`, default `None`) right after `level`.
  6. Sort with `sort_key(entry) = (level, collection order, merged catalog index)` for both the manifest and `verification.json`.
  7. Writes:
     - Scores go through `jsonio.write_atomic`.
     - The final manifest and verification merge happens inside `jsonio.library_lock()`: re-read both files, replace only the slugs built in this run, keep every other entry and every top-level key (including `spanFlags`), sort, `write_json`.
     - Remove the old filter that dropped non-catalog keys. Keep the removal of slugs that are no longer in the catalog.
  8. `--manifest-only`: inside the lock, rebuild every manifest entry from the catalog piece, the existing manifest entry (`source`, `hasEditorialFingering`) and `verification[slug]["stats"]`. A catalog slug without an existing entry is an error ("build it first").
  9. `--out-dir DIR`: convert or arrange the `--only` slugs into `DIR` (scores and fingered copies), run the MIDI checks, print them, and skip validation and every write to `manifest.json` and `verification.json`. Task 3's `repro.py` uses it.
  10. `main()` begins with `sys.stdout.reconfigure(encoding="utf-8")`.

  `check_spans.py` `main()` writes `spanFlags` through `jsonio.update_json`.

- [ ] **Step 5: Update `catalog.json`.**
  - Add `"schemaVersion": 2` and the `collections` array (the Collections table above, in that order).
  - Rewrite `_comment` to document every field of "Catalog piece fields" and the fragments.
  - For each core piece add:
    - `collection`, per the table.
    - `benchmarkSet: "core30"`.
    - `retrievedAt: "2026-10-13"` for Mutopia pieces.
    - `tempoSource`: the catalog's own reasons where its `notes` give one (for example Chopin Op. 28 No. 7: "editorial: 72 rather than the Mutopia MIDI's 120, too fast for Andantino"; the Waltz: "printed: Moderato, quarter = 152 (Peters)"); otherwise `"set by the M0 content agent (docs/research/content-library.md)"`.
    - `levelNote: "M0 content agent (docs/research/content-library.md)"`.

  Do not reorder the pieces in the file.

- [ ] **Step 6: Regenerate the manifest without converting.**

Run: `$PY -I content/tools/build.py --manifest-only`
Expected: `manifest: 30 pieces`. The core-30 entries differ from `fixtures/core30-manifest.json` only by the three new keys. The order changes only inside levels (collection order). No file in `content/scores/` changes (`test_core30_scores_are_byte_identical` passes).

- [ ] **Step 7: Run the tests.**

Run: `$PY -I -m pytest content/tools/tests -q -p no:cacheprovider`
Expected: all PASS (new tests included; `test_check_spans.test_verification_report_is_current` still passes because `spanFlags` is kept).

Run: `pnpm --filter @digitus2/web test` and `pnpm --filter @digitus2/engine test`
Expected: PASS. The app still sees 30 pieces with Twinkle first; the new keys are ignored until Task 6.

- [ ] **Step 8: Hand-off.** Paths: `content/tools/jsonio.py`, `content/tools/build.py`, `content/tools/check_spans.py`, `content/tools/catalog.json`, `content/tools/catalog.d/.gitkeep`, `content/tools/tests/fixtures/core30.json`, `content/tools/tests/fixtures/core30-manifest.json`, `content/tools/tests/test_jsonio.py`, `content/tools/tests/test_core30.py`, `content/tools/tests/test_catalog.py`, `content/tools/tests/test_library.py`, `content/manifest.json`. Message: `content: catalog v2 (collections, benchmark set core30, fragments), locked atomic library writes, core-30 pins`.

---

### Task 2: The benchmark set in the engine

**Files:**

- Create: `packages/engine/src/library/benchmarkSet.ts`, `packages/engine/src/library/benchmarkSet.test.ts`
- Modify: `packages/engine/cli/evalhands.ts`, `packages/engine/cli/evalhands.test.ts`, `packages/engine/src/io/midi/motion.test.ts`, `packages/engine/src/io/midi/engrave.library.test.ts`, `packages/engine/src/io/musicxml/smoke.test.ts`

**Interfaces:** consumes `content/manifest.json` with `benchmarkSet` (Task 1); produces `benchmarkEntries`, `CORE_BENCHMARK_SET`, `EvalHandsOptions.librarySet`, `scorecard.library.set`.

- [ ] **Step 1: Write the failing tests.**

`packages/engine/src/library/benchmarkSet.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { benchmarkEntries, CORE_BENCHMARK_SET } from './benchmarkSet.js';

const CORE30 = [
  'amazing-grace',
  'bach-invention-no1-bwv-772',
  'bach-minuet-g-major-bwv-anh-114',
  'bach-minuet-g-minor-bwv-anh-115',
  'bach-prelude-c-major-bwv-846',
  'beethoven-fur-elise-woo-59',
  'beethoven-moonlight-sonata-mvt1',
  'burgmuller-op100-no1-la-candeur',
  'burgmuller-op100-no2-arabesque',
  'burgmuller-op100-no3-pastorale',
  'burgmuller-op100-no5-innocence',
  'chopin-prelude-op28-no4',
  'chopin-prelude-op28-no7',
  'chopin-waltz-op69-no2',
  'clementi-sonatina-op36-no1-mvt1',
  'frere-jacques',
  'greensleeves',
  'happy-birthday',
  'jingle-bells',
  'joplin-the-entertainer',
  'mary-had-a-little-lamb',
  'mozart-minuet-f-major-k2',
  'mozart-sonata-k545-mvt1',
  'ode-to-joy',
  'pachelbel-canon-in-d',
  'satie-gymnopedie-no1',
  'scarborough-fair',
  'schumann-op68-no1-melody',
  'schumann-op68-no8-wild-rider',
  'twinkle-twinkle-little-star',
];
const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../content/manifest.json', import.meta.url)),
    'utf8',
  ),
) as Array<{ slug: string; benchmarkSet?: string | null }>;
const tagged = [
  { slug: 'a', benchmarkSet: 'core30' },
  { slug: 'b', benchmarkSet: null },
  { slug: 'c' },
];

describe('benchmarkEntries', () => {
  it('keeps exactly the 30 pieces of the first library from the built-in manifest', () => {
    expect(CORE_BENCHMARK_SET).toBe('core30');
    expect(
      benchmarkEntries(manifest)
        .map((e) => e.slug)
        .sort(),
    ).toEqual(CORE30);
  });
  it('treats a missing benchmarkSet like null and keeps manifest order', () => {
    expect(benchmarkEntries(tagged).map((e) => e.slug)).toEqual(['a']);
  });
  it('returns every piece for "all" and for a manifest without benchmark sets', () => {
    expect(benchmarkEntries(tagged, 'all').map((e) => e.slug)).toEqual(['a', 'b', 'c']);
    expect(benchmarkEntries([{ slug: 'x' }, { slug: 'y' }]).map((e) => e.slug)).toEqual(['x', 'y']);
  });
  it('refuses a set that no piece belongs to', () => {
    expect(() => benchmarkEntries(tagged, 'core31')).toThrow(/core31/);
  });
});
```

Append to `packages/engine/cli/evalhands.test.ts` (inside the `describe`):

```ts
it('scores only the core benchmark set of a tagged manifest unless asked for all', () => {
  const f = fixtureDir();
  const tagged = join(f.root, 'library', 'tagged.json');
  writeFileSync(
    tagged,
    JSON.stringify([
      { slug: 'twinkle', benchmarkSet: 'core30', files: { score: 'scores/twinkle.musicxml' } },
      { slug: 'twinkle-again', benchmarkSet: null, files: { score: 'scores/twinkle.musicxml' } },
    ]),
  );
  const core = runEvalHands({ library: tagged }).scorecard.library!;
  expect(core.pieces.map((p) => p.id)).toEqual(['twinkle']);
  expect(core.set).toBe('core30');
  const all = runEvalHands({ library: tagged, librarySet: 'all' }).scorecard.library!;
  expect(all.pieces.map((p) => p.id)).toEqual(['twinkle', 'twinkle-again']);
  expect(all.set).toBe('all');
});
```

Run: `pnpm --filter @digitus2/engine exec vitest run src/library cli/evalhands.test.ts`
Expected: FAIL (module not found; `librarySet` unknown).

- [ ] **Step 2: Implement `benchmarkSet.ts`.**

```ts
/**
 * The library pieces a measurement uses. Library-based floors and metrics (hand separation on the
 * library, repeat consistency, the library checks in the engine tests) measure one benchmark set,
 * so that growing the built-in library never moves a number. The 30 pieces of the first library
 * carry `benchmarkSet: "core30"` in content/manifest.json; later pieces carry null (L1 plan,
 * decision 4). Pure: no Node API, so src/ and cli/ can both use it.
 */
export const CORE_BENCHMARK_SET = 'core30';

export interface BenchmarkTagged {
  slug: string;
  benchmarkSet?: string | null;
}

/**
 * The entries of `set` in manifest order. 'all' returns every entry; so does a manifest in which
 * no entry has a benchmarkSet (a manifest from before benchmark sets, or a test fixture). A named
 * set that no entry belongs to is an error, never an empty measurement.
 */
export function benchmarkEntries<T extends BenchmarkTagged>(
  entries: readonly T[],
  set: string = CORE_BENCHMARK_SET,
): T[] {
  if (set === 'all') return [...entries];
  if (!entries.some((e) => typeof e.benchmarkSet === 'string')) return [...entries];
  const chosen = entries.filter((e) => e.benchmarkSet === set);
  if (chosen.length === 0) throw new Error(`no library piece is in benchmark set "${set}"`);
  return chosen;
}
```

- [ ] **Step 3: Use it in evalhands and in the allowed tests.**
  - `evalhands.ts`:
    - Add `librarySet?: string` to `EvalHandsOptions`, documented as "benchmark set of the library manifest, default core30; 'all' scores every piece".
    - Map `benchmarkEntries(entries, o.librarySet ?? CORE_BENCHMARK_SET)` instead of `entries`. The entries type gains `benchmarkSet?: string | null`.
    - The library result becomes `{ ...set, manifest: manifestPath, set: o.librarySet ?? CORE_BENCHMARK_SET }` and the type `(HandSetResult & { manifest: string; set: string }) | null`.
    - Leave `formatHandsScorecard` unchanged (its text is tested). A CLI flag needs `run.ts` (forbidden; deferred).
  - `motion.test.ts` and `engrave.library.test.ts`: wrap the parsed manifest in `benchmarkEntries(...)` (import from `../../library/benchmarkSet.js`). The motion test's name stays "counts the 30 library pieces …", which is now literally true.
  - `smoke.test.ts`: replace the single loop with

```ts
describe.skipIf(files.length === 0)('content library smoke test', () => {
  it.each(files)('parses %s', (f) => {
    const { score } = parseMusicXml(readFileSync(join(dir, f)));
    expect(score.notes.length).toBeGreaterThan(0);
    expect(score.notes.some((n) => n.hand === 'L')).toBe(true);
    expect(score.notes.some((n) => n.hand === 'R')).toBe(true);
  });
});
```

The smoke test stays on every file (decision 12).

- [ ] **Step 4: Verify.**

```bash
pnpm exec prettier --write packages/engine/src/library packages/engine/cli/evalhands.ts packages/engine/cli/evalhands.test.ts packages/engine/src/io/midi/motion.test.ts packages/engine/src/io/midi/engrave.library.test.ts packages/engine/src/io/musicxml/smoke.test.ts
pnpm --filter @digitus2/engine test
pnpm --filter @digitus2/engine build
node packages/engine/dist/cli/main.js evalhands --library content/manifest.json
pnpm verify hygiene design typecheck lint unit
```

Expected: all PASS. `evalhands` prints `library: 30 pieces, 0 skipped, macro …`. The `dist/` built here is the one every later parallel task uses (Global Constraints).

- [ ] **Step 5: Hand-off.** Paths: the seven files under Files. Message: `engine: benchmark set helper; evalhands and the library tests measure core30`.

---

### Task 3: Mutopia candidates, fetch, and reproduction of the core 30 (Wave B, parallel)

**Files:**

- Create: `content/tools/candidates.json`, `content/tools/repro.py`, `content/tools/tests/test_candidates.py`
- Modify: `content/tools/fetch_mutopia.py` (`--candidates`), `content/tools/catalog.json` (core Mutopia `sourceSha256`, only if the reproduction is exact)

- [ ] **Step 1: Write `candidates.json` from this plan.** Every row of both Mutopia tables, main and spare, as:

```json
{
  "slug": "burgmuller-op100-no9-la-chasse",
  "task": 14,
  "level": 4,
  "collection": "burgmuller-op100",
  "spare": false,
  "ftpDir": "BurgmullerJFF/O100/25EF-09",
  "mutopiaId": "220",
  "expectedLicense": "Public Domain",
  "convert": null
}
```

Take `ftpDir` from the plan's Notes column or from the mirror (`research/data/mutopia_src/ftp/<ftpDir>`). Write `"convert": {"score": 2}` and `{"score": 3}` for the two Clementi movements.

- [ ] **Step 2: Failing test.** `content/tools/tests/test_candidates.py`:
  - Every slug is unique and absent from the core 30.
  - `ftpDir` exists in the mirror. Skip if `research/data/mutopia_src` is missing.
  - Main candidates per level are `{2: 10, 3: 34, 4: 20, 5: 12}`; spares `{2: 5, 3: 5, 4: 6, 5: 5}`.
  - Every collection id is known.
  - After the fetch (skip if `content/_raw/mutopia/fetch_log.json` is missing): every candidate has `rdfLicense` and `lyFile`, and `rdfLicense` maps through `build.license_id` (no unknown licence).

- [ ] **Step 3: Extend `fetch_mutopia.py`.**
  - `--candidates PATH` adds every `ftpDir` from the file to the directories to fetch, after the catalog's. `--only-candidates` fetches only those.
  - The fetch log keeps its format.
  - After fetching, the script writes back into `candidates.json`, through `jsonio.update_json`, for each candidate:
    - `rdfLicense`, `lyFile`, `maintainer`, `lilypondVersion` (from the RDF via `build.rdf_info`).
    - `midiFiles`: the `.mid` names and extracted `-mids` files.
    - `pdfPages`: count `/Type /Page` objects that are not `/Pages` in the A4 PDF.
    - `mainSha256`.
    - `mirrorMatch`: whether the fetched main `.ly` is byte-identical to `research/data/mutopia_src/ftp/<ftpDir>/<lyFile>`; `null` if the mirror is absent.

- [ ] **Step 4: Fetch (background).**

Run: `$PY -I content/tools/fetch_mutopia.py --candidates content/tools/candidates.json` (about 100 directories, 0.5 s politeness each plus downloads; expect 5 to 15 minutes).
Expected: every directory fetched; `fetch_log.json` lists the core 20 Mutopia directories and the candidates. A candidate whose RDF licence differs from `expectedLicense` is reported. A non-free licence (anything outside public domain, CC BY, CC BY-SA) marks it `"excluded": "<reason>"`.

- [ ] **Step 5: Reproduce the core 30.** Write `content/tools/repro.py`:
  - `--core30` or `--all` (every catalog slug) calls `build.py --out-dir content/_build/repro --only <slugs>`.
  - It compares each produced `<slug>.musicxml` and `.fingered.musicxml` byte for byte with `content/scores/`.
  - It prints `identical`, or the first differing line, per file, and exits 1 on any difference.

Run: `$PY -I content/tools/repro.py --core30` (background; about 3 minutes of LilyPond).
Expected: `38/38 identical`. If identical, add `sourceSha256` (the fetched main `.ly`'s SHA-256) to each of the 20 core Mutopia entries in `catalog.json`. If any differ, do **not** touch `content/scores/` or the catalog. Report the differing files, the reason (a Mutopia source update shows as a changed `mainSha256` against `mirrorMatch`) and stop the Mutopia tasks for that piece's collection until the coordinator decides.

- [ ] **Step 6: Run** `$PY -I -m pytest content/tools/tests/test_candidates.py content/tools/tests/test_core30.py -q -p no:cacheprovider` (PASS).
- [ ] **Step 7: Hand-off.** Paths: `content/tools/candidates.json`, `content/tools/fetch_mutopia.py`, `content/tools/repro.py`, `content/tools/tests/test_candidates.py`, `content/tools/catalog.json`. Report the reproduction result, the candidates excluded or with licence surprises, `mirrorMatch` false counts, and the PDF page counts above 6. Message: `content: Mutopia candidates fetched; core 30 reproduced byte for byte`.

---

### Task 4: Level heuristic (Wave B, parallel)

**Files:**

- Create: `content/tools/level.py`, `content/tools/tests/test_level.py`

- [ ] **Step 1: Write the failing test.** `content/tools/tests/test_level.py`:

```python
"""level.py: a documented, testable level proposal calibrated on the 30 labelled pieces (L1 plan, decision 5)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
CONTENT = TOOLS.parent
sys.path.insert(0, str(TOOLS))
import level  # noqa: E402

MANIFEST = json.loads((CONTENT / "manifest.json").read_text(encoding="utf-8"))
CORE = [e for e in MANIFEST if e["benchmarkSet"] == "core30"]


def rows():
    return [(e["level"], level.score(level.features(CONTENT / e["files"]["score"], e["tempoBpm"]))) for e in CORE]


def test_reproduces_the_labelled_levels_within_one():
    r = rows()
    within = sum(abs(level.propose(s) - lvl) <= 1 for lvl, s in r)
    exact = sum(level.propose(s) == lvl for lvl, s in r)
    assert len(r) == 30 and within >= 27, (within, exact)


def test_frozen_cuts_are_the_fit():
    assert tuple(round(c, 2) for c in level.calibrate(rows())) == level.CUTS


def test_leave_one_out_generalises():
    within, exact = level.leave_one_out(rows())
    assert within >= 25, (within, exact)


def test_features_of_twinkle():
    f = level.features(CONTENT / "scores" / "twinkle-twinkle-little-star.musicxml", 100)
    assert (f["span"], f["chord"], f["fifths"], f["accidentals"], f["leaps"]) == (0, 0, 0, 0, 0)
    assert f["nps"] == pytest.approx(2.22, abs=0.01) and f["seconds"] == pytest.approx(28.8)
    assert level.propose(level.score(f)) == 1


@pytest.mark.parametrize("name", ["nps", "shifts", "span", "chord", "fifths", "accidentals", "seconds", "leaps"])
def test_score_grows_with_every_feature(name):
    base = {"nps": 3, "shifts": 20, "span": 9, "chord": 0.2, "fifths": 1, "accidentals": 3, "seconds": 60, "leaps": 2}
    assert level.score({**base, name: base[name] * 2}) > level.score(base)


def test_proposals_are_recorded_for_every_piece():
    ver = json.loads((CONTENT / "verification.json").read_text(encoding="utf-8"))
    for e in MANIFEST:
        lp = ver[e["slug"]]["levelProposal"]
        assert lp["level"] == level.propose(lp["score"]), e["slug"]
```

Run: `$PY -I -m pytest content/tools/tests/test_level.py -q -p no:cacheprovider`
Expected: FAIL (`ModuleNotFoundError: level`).

- [ ] **Step 2: Implement `content/tools/level.py`.**

```python
"""Level proposal for library pieces, computed from the MusicXML (L1 plan, decision 5).

Hands as in check_spans.py (staff 1 the right hand, every other staff the left); grace notes and
tie continuations are not struck. Features:
  nps          sounding notes per second at the catalogue tempo, both hands (note density)
  shifts       position shifts per 100 onsets, mean of the two hands: a hand keeps a window of
               pitches no wider than 7 semitones (a five-finger position on white keys); a slice
               that would widen it beyond 7 opens a new window and counts one shift
  span         widest slice struck by one hand, in semitones (hand span demand)
  chord        share of a hand's onsets that strike two or more keys, the larger hand (polyphony)
  fifths       sharps or flats in the first key signature
  accidentals  percent of notes outside the major scale of the first key signature
  seconds      written length (no repeats) at the catalogue tempo
  leaps        per 100 onsets, consecutive slice centres more than an octave apart, the larger hand
score = 0.35 min(nps, 12) + 0.06 shifts + 0.12 max(0, span - 7) + 2.0 chord + 0.25 fifths
        + 0.05 accidentals + 0.3 min(seconds, 240) / 60 + 0.05 leaps
level = 1 + number of CUTS below the score. The weights are fixed; the four cut points are fitted
on the 30 labelled pieces (calibrate): exhaustive search over midpoints between sorted scores for
the most pieces within one level, then the most exact, then the least absolute error.
Measured 2026-10-14: 30/30 within one (19 exact); leave-one-out 27/30 within one (14 exact).

    python -I content/tools/level.py --report            # proposal table for every catalog piece
    python -I content/tools/level.py --write [--only S]  # levelProposal into verification.json
License: MIT.
"""
from __future__ import annotations

import argparse
import itertools
import json
import sys
from collections import defaultdict
from fractions import Fraction as F
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import xmlcheck as xc  # noqa: E402

CONTENT = HERE.parent
MAJOR = (0, 2, 4, 5, 7, 9, 11)
WINDOW = 7
CUTS = (1.76, 4.09, 9.11, 12.68)


def features(path: Path, tempo: float) -> dict[str, float]:
    xs = xc.parse_musicxml(path)
    fifths = int(xs.keys[0][1]) if xs.keys and xs.keys[0][1] else 0
    tonic = (7 * fifths) % 12
    scale = {(tonic + d) % 12 for d in MAJOR}
    seconds = float(sum((m.length for m in xs.measures), F(0))) * 60 / tempo
    hands: dict[str, dict] = defaultdict(lambda: defaultdict(list))
    for n in xs.notes:
        if n.pitch is None or n.grace or n.tie_stop:
            continue
        hands["R" if xs.staves < 2 or n.staff == "1" else "L"][n.onset].append(n.pitch)
    notes = outside = 0
    shifts, spans, chords, leaps = [], [], [], []
    for slices in hands.values():
        onsets = sorted(slices)
        spans.append(max(max(v) - min(v) for v in slices.values()))
        chords.append(sum(1 for v in slices.values() if len(set(v)) > 1) / len(onsets))
        lo = hi = prev = None
        sh = lp = 0
        for o in onsets:
            a, b = min(slices[o]), max(slices[o])
            if lo is None:
                lo, hi = a, b
            elif max(hi, b) - min(lo, a) > WINDOW:
                sh += 1
                lo, hi = a, b
            else:
                lo, hi = min(lo, a), max(hi, b)
            centre = (a + b) / 2
            if prev is not None and abs(centre - prev) > 12:
                lp += 1
            prev = centre
        shifts.append(100 * sh / len(onsets))
        leaps.append(100 * lp / len(onsets))
        for v in slices.values():
            notes += len(v)
            outside += sum(1 for p in v if p % 12 not in scale)
    return {"nps": notes / seconds, "shifts": sum(shifts) / len(shifts), "span": max(spans),
            "chord": max(chords), "fifths": abs(fifths), "accidentals": 100 * outside / notes,
            "seconds": seconds, "leaps": max(leaps)}


def score(f: dict[str, float]) -> float:
    return (0.35 * min(f["nps"], 12) + 0.06 * f["shifts"] + 0.12 * max(0, f["span"] - 7)
            + 2.0 * f["chord"] + 0.25 * f["fifths"] + 0.05 * f["accidentals"]
            + 0.3 * min(f["seconds"], 240) / 60 + 0.05 * f["leaps"])


def propose(s: float, cuts: tuple = CUTS) -> int:
    return 1 + sum(s > c for c in cuts)


def calibrate(rows: list[tuple[int, float]]) -> tuple[float, ...]:
    rs = sorted(rows, key=lambda r: r[1])
    scores, levels = [r[1] for r in rs], [r[0] for r in rs]
    mids = [(a + b) / 2 for a, b in zip(scores, scores[1:])]
    best = None
    for cuts in itertools.combinations(mids, 4):
        pred = [propose(s, cuts) for s in scores]
        key = (sum(abs(p - l) <= 1 for p, l in zip(pred, levels)), sum(p == l for p, l in zip(pred, levels)),
               -sum(abs(p - l) for p, l in zip(pred, levels)))
        if best is None or key > best[0]:
            best = (key, cuts)
    return best[1]


def leave_one_out(rows: list[tuple[int, float]]) -> tuple[int, int]:
    within = exact = 0
    for i, (lvl, s) in enumerate(rows):
        p = propose(s, calibrate(rows[:i] + rows[i + 1:]))
        within += abs(p - lvl) <= 1
        exact += p == lvl
    return within, exact
```

`main()` reconfigures stdout and loads the manifest. `--report` prints, per manifest piece, the level, the proposal, the score and the eight features in catalog order. `--write` updates `verification[slug]["levelProposal"] = {features (rounded to 3 decimals), score (3 decimals), level}` through `jsonio.update_json`, for `--only` slugs or all.

- [ ] **Step 3: Record and verify.**

Run: `$PY -I content/tools/level.py --write` then `$PY -I -m pytest content/tools/tests/test_level.py -q -p no:cacheprovider`
Expected: PASS. The in-sample within-one count is 30 and LOO 27 (as measured while writing this plan). If the numbers differ, the implementation differs from the code above: fix the code, never the thresholds.

- [ ] **Step 4: Hand-off.** Paths: `content/tools/level.py`, `content/tools/tests/test_level.py`, `content/verification.json`. Report the in-sample and LOO numbers and the `--report` table for the 30. Message: `content: level heuristic calibrated on the 30 labelled pieces`.

---

### Task 5: Arrangement framework (Wave B, parallel)

**Files:**

- Create: `content/tools/arrangements/__init__.py`, `content/tools/tests/test_arrangements.py`, `content/tools/tests/fixtures/arrangement_demo.py` (test-only module)
- Modify: `content/tools/arrange.py` (merge the package)

- [ ] **Step 1: Write the failing test.** `content/tools/tests/test_arrangements.py` checks every **new** own arrangement, parametrized over `arrangements.load()[0]`:
  1. `test_every_reference_cites_a_dated_source`: `reference(slug)` has `url` starting `https://`, `retrieved` (YYYY-MM-DD), `melody` (at least 8 MIDI numbers), `compare` in `{"exact", "intervals"}`.
  2. `test_built_melody_equals_the_reference`: the top line of staff 1 of `content/scores/<slug>.musicxml` matches the reference, or its intervals do when `compare` is `"intervals"`. Top line: xmlcheck notes on staff 1, not grace, not tie-stop; per onset the highest pitch; onsets in order. It also equals the spec's own melody (`arrange.parse` top notes).
  3. `test_level_one_rules` (catalog level 1):
     - Right hand: single notes, range ≤ 10 semitones.
     - Left hand: range ≤ 7 semitones, at most 2 keys per slice.
     - Key and pitches: first key signature |fifths| ≤ 1; no pitch outside the key's major scale (the key's natural minor for minor keys).
     - Time signature in {2/4, 3/4, 4/4, 6/8}.
     - `tempoBpm` ≤ 120, at most 32 bars.
     - The recorded `levelProposal.level` ≤ 2.
  4. `test_level_two_rules` (catalog level 2):
     - Right hand range ≤ 19 semitones; left hand at most 3 keys per slice and slice span ≤ 9.
     - |fifths| ≤ 2.
     - `levelProposal.level` ≤ 3.
  5. `test_no_strong_beat_clashes`. Strong beats:
     - 2/4 and 3/4: beat 1.
     - 4/4: beats 1 and 3.
     - 6/8: both dotted-quarter beats.

     On each strong beat, every left-hand key sounding against the right hand's top note is compared by interval class. Classes {1, 2, 6, 10, 11} are flagged unless the spec lists `(bar, beat)` in `allowedClashes` with a reason.

  6. `test_deterministic`: building the first slug of each module twice gives identical bytes.

  The fixture module `fixtures/arrangement_demo.py` (one 4-bar piece and its reference) lets the framework's own tests run before any collection exists: `load(extra_modules=[...])`.

- [ ] **Step 2: Implement.**
  - `arrangements/__init__.py`:
    - `MODULES = ("children", "christmas", "hymns", "folk", "songs")`.
    - `load(extra_modules=())` imports each module that exists (`importlib.util.find_spec`). Each module defines `PIECES: dict[str, dict]` and `REFERENCES: dict[str, dict]`.
    - It raises `ValueError` on a duplicate slug, on a slug in `PIECES` without a reference, or on a slug that collides with `arrange.CORE_PIECES`.
    - `reference(slug)` returns the reference.
  - `arrange.py`: rename the existing dict to `CORE_PIECES` and set `PIECES = {**CORE_PIECES, **arrangements.load()[0]}`. The core ten stay byte-identical (`test_core30_scores_are_byte_identical`). Update the module docstring: new arrangements live in `arrangements/<collection>.py`, with a reference per piece.
  - Each module's header comment states the arrangement rules for implementers:
    - Level 1: right hand in one five-finger position with at most one extension (the Twinkle A); left hand whole, half or quarter notes, single notes or open fifths in one position; keys C, G or F major or A or D minor.
    - Level 2: the right hand may move positions; left hand simple triads within a fifth, broken fifths, or a waltz bass at moderate tempo; keys with up to two sharps or flats.
    - Both levels: no triplets, repeats, grace notes or voices (the spec language does not have them); write repeats out.

- [ ] **Step 3: Verify.**

Run: `$PY -I -m pytest content/tools/tests/test_arrangements.py content/tools/tests/test_arrange.py content/tools/tests/test_core30.py -q -p no:cacheprovider`
Expected: PASS. The parametrized per-piece tests have no new pieces yet; the framework tests use the demo fixture.

- [ ] **Step 4: Hand-off.** Paths: `content/tools/arrangements/__init__.py`, `content/tools/arrange.py`, `content/tools/tests/test_arrangements.py`, `content/tools/tests/fixtures/arrangement_demo.py`. Message: `content: arrangement framework with references and level rules`.

---

### Task 6: App: manifest schema, attribution, counts from the manifest (Wave B, parallel; the only e2e in the wave)

**Files:** see the `apps/web` list under Global Constraints (all but the PNGs).

- [ ] **Step 1: Write the failing tests.** Replace the first and fourth tests of `apps/web/src/library/manifest.test.ts` and add:

```ts
import manifestJson from '../../../../content/manifest.json';
// ...
it('lists every manifest piece across five levels, sorted by level, with unique slugs', () => {
  expect(pieces).toHaveLength((manifestJson as unknown[]).length);
  expect(new Set(pieces.map((p) => p.slug)).size).toBe(pieces.length);
  expect(new Set(pieces.map((p) => p.level))).toEqual(new Set([1, 2, 3, 4, 5]));
  expect(pieces.map((p) => p.level)).toEqual([...pieces.map((p) => p.level)].sort((a, b) => a - b));
  expect(Object.keys(LEVEL_NAMES)).toHaveLength(5);
});
it('keeps the 30 pieces of the first library as the benchmark set and gives every piece a collection', () => {
  expect(pieces.filter((p) => p.benchmarkSet === 'core30')).toHaveLength(30);
  for (const p of pieces) {
    expect(p.collection.length, p.slug).toBeGreaterThan(0);
    expect(p.collectionId, p.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  }
});
it('credits every CC BY and CC BY-SA engraving with its typesetter and licence', () => {
  for (const p of pieces.filter(requiresCredit)) {
    const a = attribution(p);
    expect(a.text).toContain(p.source.typesetter);
    expect(a.text).toContain(licenseLabel(p.source.license));
    expect(a.url).toBe(p.source.licenseUrl);
  }
});
it('calls only public-domain engravings public domain', () => {
  const k2 = pieceBySlug('mozart-minuet-f-major-k2')!;
  const byOnly = {
    ...k2,
    source: {
      ...k2.source,
      license: 'CC-BY-2.5',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.5/',
    },
  };
  expect(attribution(k2).text).toMatch(/public domain$/);
  expect(attribution(byOnly).text).toBe(
    `Engraving by ${k2.source.typesetter} for the Mutopia Project, CC BY 2.5`,
  );
  expect(attribution(byOnly).url).toBe('https://creativecommons.org/licenses/by/2.5/');
});
it('still marks the five share-alike engravings of the first library', () => {
  expect(
    pieces
      .filter((p) => isShareAlike(p) && p.benchmarkSet === 'core30')
      .map((p) => p.slug)
      .sort(),
  ).toEqual([
    'bach-invention-no1-bwv-772',
    'beethoven-moonlight-sonata-mvt1',
    'mozart-sonata-k545-mvt1',
    'schumann-op68-no1-melody',
    'schumann-op68-no8-wild-rider',
  ]);
});
```

Other test changes:

- `LibraryView.test.tsx`: the first test's title becomes "shows the welcome, five level sections and a row per piece", and `toHaveLength(30)` becomes `toHaveLength(pieces.length)` (import `pieces`).
- `AboutView.test.tsx`: replace the `.toBe(5)` count with one link per piece, labelled by `licenseLabel` (`getAllByRole('link', { name: label })` per distinct label, summed, equals the number of pieces whose licence starts with `CC-`). Add a test that the credit paragraph reads exactly:
  - `All compositions are in the public domain. ${countWord(sa)} engravings are shared under CC BY-SA and are credited here and on their score pages.` when there is no CC BY engraving;
  - otherwise `All compositions are in the public domain. ${countWord(sa)} engravings are shared under CC BY-SA and ${countWord(by).toLowerCase()} under CC BY; all are credited here and on their score pages.`

  Export `countWord` from `AboutView.tsx` for the test.

e2e: create `apps/web/e2e/helpers/library.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Pieces in the built-in library (content/manifest.json), so the flows follow its growth. */
export const LIBRARY_COUNT = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../../content/manifest.json', import.meta.url)),
      'utf8',
    ),
  ) as unknown[]
).length;
```

Then:

- `library.spec.ts`: `toHaveCount(30)` becomes `toHaveCount(LIBRARY_COUNT)` and the test title becomes "library: every piece, one red element, …". Add a test: "library: the last piece is reachable and nothing overflows". It scrolls the last `Open …` button into view, expects it in the viewport and expects no horizontal overflow; the mobile project runs it at 360 px.
- `helpers/states.ts`: `library()` uses `LIBRARY_COUNT`.
- `about.spec.ts`: `toHaveCount(31)` becomes `toHaveCount(LIBRARY_COUNT + 1)`, and the comment about Hézaine's two rows becomes "He engraved the CC BY-SA Schumann pieces".

Run: `pnpm --filter @digitus2/web test`
Expected: FAIL (`requiresCredit` missing; CC BY credited as public domain; `countWord` not exported).

- [ ] **Step 2: Implement.**
  - `manifest.ts`:
    - Add `collection: string; collectionId: string; benchmarkSet: string | null;` to `LibraryPiece`.
    - Add `export function requiresCredit(p) { return p.source.license.startsWith('CC-BY'); }`.
    - In `attribution`, replace `if (isShareAlike(p))` by `if (requiresCredit(p))`, so CC BY and CC BY-SA are both credited with their licence and URL. Keep `isShareAlike`, which `AboutView` uses.
  - `AboutView.tsx`:
    - `const attributionOnlyCount = pieces.filter((p) => requiresCredit(p) && !isShareAlike(p)).length;`
    - The paragraph renders the two forms above. With today's 30 pieces the text is unchanged.
    - Export `countWord`.

  `LibraryView.tsx` does not change (decision 9).

- [ ] **Step 3: Verify.**

```bash
pnpm exec prettier --write apps/web/src/library apps/web/src/about apps/web/e2e/helpers/library.ts apps/web/e2e/library.spec.ts apps/web/e2e/about.spec.ts apps/web/e2e/helpers/states.ts
pnpm --filter @digitus2/web test
DIGITUS2_E2E_PORT=4175 pnpm --filter @digitus2/web e2e --project=desktop --project=mobile
pnpm verify hygiene design typecheck lint unit
```

Expected: all PASS with 30 pieces. Visual baselines are unchanged at this point; `--project=visual` is not run here.

- [ ] **Step 4: Hand-off.** Paths: the files above. Message: `app: manifest collections and benchmark set; CC BY engravings credited; flows count the library`.

---

### Task 7: Post-build gates (Wave B2, after Tasks 4 and 5)

**Files:**

- Create: `content/tools/lint_gate.py`, `content/tools/gates.py`, `content/tools/tests/test_lint_gate.py`, `content/tools/tests/test_gates.py`, `content/tools/tests/fixtures/lint-report.json` (one recorded `digitus2 lint --json` output)

- [ ] **Step 1: Write the failing tests.**

`content/tools/tests/test_lint_gate.py`:

- `parse_report(text)` turns the fixture into `{notes, errors, warnings, counts}`.
- `engine_src_sha256()` is 64 hex characters and stable across two calls.
- A real run on Twinkle when `packages/engine/dist/cli/main.js` exists (skip otherwise): `lint_piece(twinkle, p)["errors"] == 0` for both profiles.

`content/tools/tests/test_gates.py`:

```python
"""Every new library piece passes every gate (L1 plan, Review Focus 3 to 5)."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
CONTENT = TOOLS.parent
sys.path.insert(0, str(TOOLS))
import build  # noqa: E402

MANIFEST = json.loads((CONTENT / "manifest.json").read_text(encoding="utf-8"))
VER = json.loads((CONTENT / "verification.json").read_text(encoding="utf-8"))
CAT = {p["slug"]: p for p in build.load_catalog()}
NEW = [e for e in MANIFEST if e["benchmarkSet"] is None]
MAX_NEW_BYTES = 700_000


@pytest.mark.parametrize("entry", NEW, ids=lambda e: e["slug"])
def test_new_piece_passes_every_gate(entry):
    slug, v, cat = entry["slug"], VER[entry["slug"]], CAT[entry["slug"]]
    assert v["ok"] is True and all(r["ok"] for r in v["validation"].values())
    st = v["stats"]
    assert st["xsdValid"] is True and st.get("verovioPages", 0) >= 1
    assert 21 <= st["pitchRange"][0] and st["pitchRange"][1] <= 108
    if cat["source"] == "own":
        assert v["melody"]["exact"] is True, v["melody"]
    else:
        assert v["midiChecks"]["lilypond224Midi"]["exact"] is True
    for profile in ("medium", "large"):
        assert v["lint"]["profiles"][profile]["errors"] == 0, (profile, v["lint"]["profiles"][profile]["counts"])
    score = CONTENT / entry["files"]["score"]
    assert v["lint"]["scoreSha256"] == hashlib.sha256(score.read_bytes()).hexdigest(), "stale lint: run gates.py"
    for f in filter(None, entry["files"].values()):
        assert (CONTENT / f).stat().st_size <= MAX_NEW_BYTES, f
    proposal = v["levelProposal"]["level"]
    assert abs(proposal - entry["level"]) <= 1 or cat.get("levelOverride"), (proposal, entry["level"])
    if entry["source"]["license"].startswith("CC-BY"):
        src = entry["source"]
        assert src["typesetter"] and src["mutopiaId"] and src["licenseUrl"]
        rights = score.read_text(encoding="utf-8")
        assert src["typesetter"] in rights and src["mutopiaId"] in rights and src["license"] in rights


def test_span_flags_only_on_core30():
    core = {e["slug"] for e in MANIFEST if e["benchmarkSet"] == "core30"}
    assert {f["piece"] for f in VER["spanFlags"]} <= core
```

Run: `$PY -I -m pytest content/tools/tests/test_lint_gate.py content/tools/tests/test_gates.py -q -p no:cacheprovider`
Expected: FAIL (`ModuleNotFoundError: lint_gate`). `test_gates.py` collects zero new pieces and passes `test_span_flags_only_on_core30`.

- [ ] **Step 2: Implement `lint_gate.py`.**
  - `CLI = ROOT / "packages/engine/dist/cli/main.js"`; it refuses to run if missing ("build the engine first: pnpm --filter @digitus2/engine build").
  - `lint_piece(score, profile)`:
    - runs `node CLI finger <score> --profile <profile> --format pig --out content/_build/lint/<slug>.<profile>.pig.txt`;
    - then runs `node CLI lint <score> --fingering <that> --json` (exit code 1 is normal when errors exist);
    - parses stdout with `parse_report`;
    - uses `subprocess.run([...], capture_output=True, text=True, encoding="utf-8", check=False)`, and a missing JSON output is an exception with stderr attached.
  - `engine_src_sha256()`: hash over the sorted relative paths and LF-normalised contents of `packages/engine/src/**/*.ts` that are not tests.
  - `gate(slugs)`: the record per slug as in "Interfaces added". `CLI` is stored as a relative POSIX path.

- [ ] **Step 3: Implement `gates.py`.**
  - CLI: `--only SLUG... | --new | --all`, plus `--no-lint`.
  - Steps:
    1. `check_spans.main([])`: the whole library, under the lock.
    2. `level.features` + `score` + `propose` for the selection.
    3. For own pieces in the selection, the melody check against `arrangements.reference(slug)`, with the same top-line rule as Task 5's test, recording `{exact, notes, compare, reference: url, firstDifference}`.
    4. `lint_gate.gate(selection)` unless `--no-lint`.
  - It writes all per-slug keys with one `jsonio.update_json` call.
  - It prints a table: slug, level, proposal, MIDI or melody, span flags, medium errors, large errors, bytes, verdict.
  - It exits 1 if any non-core30 piece in the selection fails a gate. Core-30 pieces are reported and never fail the run.
  - `--all` on the core 30 reproduces the lint baseline in decision 6.

- [ ] **Step 4: Verify.**

```bash
$PY -I content/tools/gates.py --all
$PY -I -m pytest content/tools/tests/test_lint_gate.py content/tools/tests/test_gates.py content/tools/tests/test_level.py content/tools/tests/test_check_spans.py -q -p no:cacheprovider
```

Expected: exit 0 (no new pieces yet). The table shows the core 30 with 0 medium errors on 25 pieces and 33, 22, 4, 40, 2 on Moonlight, Chopin 28/4, 28/7, Satie, Joplin. Tests PASS.

- [ ] **Step 5: Hand-off.** Paths: the five files under Files and `content/verification.json`. Message: `content: post-build gates (spans, level proposal, melody, engine lint at medium and large)`.

---

### Tasks 8 to 12: Arrangements by collection (Wave C, parallel)

One task per row. Each writes only its own module and fragment and the scores it builds.

| Task | Module                      | Fragment                   | Pieces (main)                                                | Spares                                            |
| ---- | --------------------------- | -------------------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| 8    | `arrangements/children.py`  | `catalog.d/children.json`  | the 13 children's songs                                      | lucy-locket, sur-le-pont-d-avignon, love-somebody |
| 9    | `arrangements/christmas.py` | `catalog.d/christmas.json` | 2 level 1 + 6 level 2 carols                                 | o-christmas-tree, the-first-noel                  |
| 10   | `arrangements/hymns.py`     | `catalog.d/hymns.json`     | 2 level 1 spirituals, 4 hymns, 2 anthems                     | a-mighty-fortress, austrian-hymn                  |
| 11   | `arrangements/folk.py`      | `catalog.d/folk.json`      | yankee-doodle (1) + 7 level 2 folk songs                     | loch-lomond, red-river-valley                     |
| 12   | `arrangements/songs.py`     | `catalog.d/songs.json`     | 4 level 1 songs, daisy-bell, 2 easy rags, 3 classical themes | in-the-good-old-summertime, morning-mood          |

**Files (each task):** create the module and the fragment; the new `content/scores/<slug>.musicxml`; `content/manifest.json` and `content/verification.json` (merged under the lock). Nothing else.

- [ ] **Step 1: References first.** For each tune, find a notated source per "Melody references" and type its pitch sequence into `REFERENCES[slug]` as MIDI numbers:

```python
REFERENCES = {
    "silent-night": dict(
        url="https://en.wikipedia.org/wiki/Silent_Night", retrieved="2026-10-14", compare="exact",
        description="Score in the article, first verse, B-flat major", note="",
        melody=[65, 67, 65, 62, ...],
    ),
}
```

Save the source text under `content/_raw/references/<slug>.txt`. A tune whose only sources disagree is replaced by a spare. Record the choice in the fragment's `rejected` with the reason.

- [ ] **Step 2: Failing test.** Add the catalog entries to the fragment, including `melody: {authors, firstPublished, reference}` from the table and `levelNote` (for example `"Level 1: right hand in C position, left hand open fifths; heuristic proposes 1"`, or a method-book citation). Then run:

`$PY -I -m pytest content/tools/tests/test_arrangements.py content/tools/tests/test_catalog.py -q -p no:cacheprovider -k "<module slugs>"`

Expected: FAIL (no `PIECES` entry, no score).

- [ ] **Step 3: Write the arrangements** in `PIECES` following the module's rules and the level rules of Task 5. Then build and gate only your slugs:

```bash
$PY -I content/tools/build.py --only <slugs>
$PY -I content/tools/gates.py --only <slugs>
```

Expected: every piece `OK`. Resolve a failure in this order:

- A melody difference is a typing error in the spec or in the reference: re-check against the source.
- A lint law error means the left hand needs a simpler shape.
- A level-rule failure moves the tune to level 2 (and drops this task's lowest-priority level-2 piece) or brings in a spare.

- [ ] **Step 4: Verify.**

```bash
$PY -I -m pytest content/tools/tests/test_arrangements.py content/tools/tests/test_gates.py content/tools/tests/test_catalog.py content/tools/tests/test_arrange.py -q -p no:cacheprovider -k "<module slugs>"
pnpm --filter @digitus2/engine test
pnpm verify hygiene design typecheck lint unit
```

Expected: PASS. The engine suite's smoke test now parses the new files; the motion and engrave tests stay on core30.

- [ ] **Step 5: Hand-off.** Paths: the module, the fragment, every new `content/scores/<slug>.musicxml`, `content/manifest.json`, `content/verification.json`. Report: pieces accepted per level, spares used, `rejected` entries, the reference URL per piece. Message: `content: <collection> arrangements (<n> pieces)`.

---

### Tasks 13 to 18: Mutopia engravings by collection (Wave C, parallel; need Task 3)

| Task | Fragment                              | Pieces (main, see the table)                                                                   |
| ---- | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 13   | `catalog.d/anna-magdalena.json`       | 9 Notebook pieces, Handel minuet, Behr, Swedish polska, André, Wanhal (14)                     |
| 14   | `catalog.d/burgmuller.json`           | Burgmüller Op. 100 Nos. 4 and 6 to 18 (14)                                                     |
| 15   | `catalog.d/schumann-tchaikovsky.json` | Schumann Op. 68 (12), Tchaikovsky Op. 39 (3)                                                   |
| 16   | `catalog.d/bach.json`                 | Little preludes and Applicatio (7), Inventions (6)                                             |
| 17   | `catalog.d/sonatinas.json`            | Clementi, Kuhlau, K. 545, Beethoven, Haydn, Rondo alla Turca, Pathétique (11)                  |
| 18   | `catalog.d/character-rags.json`       | Grieg, Kinderszenen 1 and 7, Chopin 28/20 and 28/6, Schubert, Mendelssohn, two Joplin rags (9) |

**Files (each task):** the fragment; new `content/scores/<slug>.musicxml` and `.fingered.musicxml`; `content/manifest.json`, `content/verification.json` (merged under the lock).

- [ ] **Step 1: Catalog entries.** For each candidate of the task, write the fragment entry from `candidates.json`:
  - `ftpDir`, `main` (the RDF `lyFile`), `subdir` when the main file sits in a `-lys` folder, `publishedMidi` (the matching name in `midiFiles`; for multi-movement files the one for this `\score`).
  - `retrievedAt` (the fetch log's date), `sourceSha256` (`mainSha256`).
  - `title` (English, with the original title in `notes` when it differs, as M0 did), `composer`, `composerDates`, `catalogue`, `year`.
  - `collection`, `level`.
  - `tempoBpm` and `tempoSource`. Use the printed metronome mark if the source has one; else the source's `\midi` tempo if it is plausible for the marking; else a conventional tempo for the printed marking from a cited teaching edition. Say which.
  - `levelNote`: a syllabus placement (Henle per-piece level, ABRSM or RCM list, or the collection's own order), and the heuristic proposal after Step 3.
  - `keyName` where the key signature alone misnames the key (as the Wild Rider and Moonlight did).
  - `convert` (`score`, `barTo` for an excerpt) and `excerpt` text when needed.
  - `notes`: edition, typesetter, licence sentence for CC pieces, anything unusual.

  Candidates whose RDF licence is not public domain, CC BY or CC BY-SA are dropped into `rejected`.

- [ ] **Step 2: Build and gate.**

```bash
$PY -I content/tools/build.py --only <slugs>
$PY -I content/tools/gates.py --only <slugs>
```

Expected: `lilypond224Midi: EXACT` for each and every gate `OK`.

Handling failures (record every outcome in `rejected` or in `notes`):

| Failure                                               | Action                                                                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `convert-ly` or LilyPond fails on an old source       | a catalog `patches` entry, as M0 did for Moonlight; if more than two patches are needed, drop and use a spare                                       |
| MIDI difference                                       | investigate as M0 did (an accepted difference needs a written reason, and only for the published-MIDI check; the LilyPond 2.24 check must be exact) |
| Span flag or lint law error                           | excerpt to a section that ends on the tonic before the first offending bar, if that keeps at least 16 bars and a musical whole; otherwise drop      |
| `approxDurationSec` over 255 or more than 6 PDF pages | excerpt at a section end, or drop                                                                                                                   |
| File over 700 KB                                      | excerpt                                                                                                                                             |

- [ ] **Step 3: Levels.** Run `$PY -I content/tools/level.py --report` for your slugs. Set the final level: the plan's intended level, adjusted when a syllabus placement says otherwise. Write the `levelNote`. A level more than one away from the proposal needs `levelOverride` with the reason (for example "counterpoint: the heuristic underrates two-part inventions; Henle level 3").

- [ ] **Step 4: Visual check.** Run `$PY -I content/tools/build.py --only <slugs> --png`, which re-renders the previews. Compare page 1 of each PNG in `content/_preview/` with Mutopia's A4 PDF in `content/_raw/mutopia/<ftpDir>/`: clefs, key, metre, voices, ties, slurs. Report anything wrong. Fix it with a catalog patch or drop the piece; never hand-edit a score.

- [ ] **Step 5: Verify.**

```bash
$PY -I -m pytest content/tools/tests/test_gates.py content/tools/tests/test_catalog.py content/tools/tests/test_library.py content/tools/tests/test_level.py -q -p no:cacheprovider -k "<task slugs>"
pnpm --filter @digitus2/engine test
pnpm verify hygiene design typecheck lint unit
```

Expected: PASS.

- [ ] **Step 6: Hand-off.** Paths: the fragment, the new score files, `content/manifest.json`, `content/verification.json`. Report:
  - pieces accepted per level;
  - excerpts with their bar ranges;
  - spares used and `rejected` reasons;
  - each piece's medium and large lint counts and size;
  - the editorial-fingering copies written.

  Message: `content: <collection> from Mutopia (<n> pieces)`.

---

### Task 19: Integration: levels, counts, sizes, bundle, engine library tests

**Files:**

- Modify: `content/tools/tests/test_library.py` (level counts), the fragments (level adjustments only), `content/manifest.json`, `content/verification.json`

- [ ] **Step 1: Failing test.** Add to `test_library.py`:

```python
LEVEL_RANGES = {1: (24, 28), 2: (42, 48), 3: (37, 43), 4: (22, 28), 5: (13, 17)}


def test_level_counts_are_weighted_to_beginners():
    counts = {lvl: sum(1 for e in MANIFEST if e["level"] == lvl) for lvl in LEVEL_RANGES}
    for lvl, (lo, hi) in LEVEL_RANGES.items():
        assert lo <= counts[lvl] <= hi, counts
    assert 145 <= len(MANIFEST) <= 156
```

- [ ] **Step 2: Bring every piece through every gate at once.**

```bash
pnpm --filter @digitus2/engine build
$PY -I content/tools/build.py --manifest-only
$PY -I content/tools/gates.py --all
$PY -I content/tools/repro.py --all
$PY -I -m pytest content/tools/tests -q -p no:cacheprovider
```

Run the last three in the background.

Expected:

- `gates.py` exits 0.
- `repro.py --all` reports every file identical. This proves that `build.py` rebuilds the whole library from the catalog and the fetched sources (constraint 8).
- The full content suite passes.

If a level is outside its range, move borderline pieces between adjacent levels where their `levelNote` allows it (cite the reason), or activate spares. Never invent new candidates here.

- [ ] **Step 3: Sizes and bundle.**
  - Sum the bytes of every new file: the scores, the fragments, the arrangement modules, `candidates.json`, the tests and the fixtures.
  - Measure the largest new file.
  - Run `pnpm build` and `node scripts/check-bundle-size.mjs`, and record the initial JavaScript and CSS total against M4's 88.8 KB and Task 0's baseline.

  Expected:
  - New files total under 15 MB (decision 13).
  - Bundle under 150 KB. Above 140 KB, write the measurement in the hand-off for the coordinator (decision 14); do not change the loader.

- [ ] **Step 4: Engine tests against the full library.**

```bash
pnpm --filter @digitus2/engine exec vitest run src/fingering/solve.test.ts src/eval/hands.test.ts src/eval/metamorphic.test.ts src/io/midi/engrave.library.test.ts src/io/musicxml/smoke.test.ts src/io/midi/motion.test.ts --reporter=verbose
node packages/engine/dist/cli/main.js evalhands --library content/manifest.json
pnpm verify
```

Run `pnpm verify` with `DIGITUS2_E2E_PORT=4175`, in the background, once no other task runs.

Expected:

- `evalhands` prints `library: 30 pieces` (`evalhands scores 30 library pieces`).
- Record pass or fail and duration of the three forbidden tests: hands 85 percent, metamorphic, solve oracle. Each is a merge blocker for the coordinator if it fails or the oracle takes more than 2.5 s; the "Deferred to the coordinator" patch fixes both.
- `pnpm verify` is green except, possibly, `visual` baselines of the library and about pages (Task 21) and the forbidden tests listed.

- [ ] **Step 5: Hand-off.** Paths: `content/tools/tests/test_library.py`, any fragments changed, `content/manifest.json`, `content/verification.json`. Report:
  - counts per level and source;
  - licence counts;
  - total bytes added and the largest file;
  - bundle total;
  - the three forbidden tests' status and durations;
  - the hands library line;
  - the full verify summary.

  Message: `content: library integrated (n pieces), counts per level gated`.

---

### Task 20: Provenance report

**Files:**

- Modify: `docs/research/content-library.md` (append only), `content/tools/README.md`

- [ ] **Step 1:** Append `## L1 curated library (2026-10-14)` to `docs/research/content-library.md`. Keep numbers in tables and cite sources with URLs. Subsections:
  1. **At a glance:** pieces per level and per source; licences.
  2. **Selection:** the rules (instrument, length, licence preference, PD melody rule with the excluded songs of decision 7), the mirror enumeration counts, the fetch date.
  3. **Levelling:**
     - the heuristic's formula;
     - its calibration (in-sample, LOO, cut points);
     - the syllabus anchors;
     - a table of every new piece: slug, final level, proposal, `levelNote`.
  4. **Provenance of the new Mutopia engravings:** slug, Mutopia piece link, typesetter, edition, engraving licence, LilyPond version, MIDI check, editorial fingerings. Same columns as the existing table.
  5. **The new arrangements:** slug, tune, melody author and dates, first published, reference URL and retrieval date, level, deliberate clashes.
  6. **Gates and results:** XSD, xmlcheck, music21, Verovio, MIDI, span check, lint at medium and large (counts summary), sizes.
  7. **Benchmark set:**
     - `core30`, why, and which consumers filter by it;
     - the new pieces in the Mutopia train or test half of `research/data/splits/mutopia_split.json` (overlap list), so that nobody evaluates learned weights on "the library" without the filter.
  8. **Considered and rejected:** from every fragment's `rejected`, plus the exclusions of this plan.
  9. **Reproducibility:** the lost raw downloads, the pinned `retrievedAt`, the byte-for-byte reproduction.
- [ ] **Step 2:** Update `content/tools/README.md`: quick start with the environment note, `catalog.d/`, `candidates.json`, `gates.py`, `level.py`, `lint_gate.py`, `repro.py`, `jsonio.py`, the lock, and the order build → gates.
- [ ] **Step 3: Hand-off.** Paths: `docs/research/content-library.md`, `content/tools/README.md`. Message: `docs: L1 curated library provenance and levelling`.

---

### Task 21: Visual baselines, full verify, hand-off

**Files:**

- Modify: `apps/web/e2e/visual.spec.ts-snapshots/library-visual-win32.png`, `library-notice-visual-win32.png`, `about-visual-win32.png`

- [ ] **Step 1:** Regenerate the baselines:

```bash
pnpm --filter @digitus2/web build
DIGITUS2_E2E_PORT=4175 pnpm --filter @digitus2/web exec playwright test --project=visual --update-snapshots
```

Review the three changed PNGs: every level heading present, Twinkle in the "Start here" card, no overflow. Check that each PNG is under 1 MB (hygiene). At M4 the library baseline was 1280 × 3065 px and 119 KB; expect roughly 1280 × 11,000 px and 400 to 600 KB. Report if any exceeds 900 KB, because `visual.spec.ts` uses `fullPage: true` and is outside this plan's paths. The score-state baselines must not change; if one does, find out why before accepting it.

**Note for the coordinator:** after rebasing onto the polish branch (which redesigns parts of the library and score pages), run this step again.

- [ ] **Step 2:** `DIGITUS2_E2E_PORT=4175 pnpm verify` (all steps, background). Expected: green, with the exceptions recorded in Task 19 for the forbidden tests if any.
- [ ] **Step 3: Hand-off.** Paths: the three PNGs. Report the verify summary. Restate the deferred patch status and the merge order: M3 merge → rebase → deferred patch → `gates.py --new` on the merged solver → polish rebase → this task's Step 1 again → verify → merge. Message: `app: visual baselines for the 150-piece library`.

## Deferred to the coordinator (forbidden files)

Apply after M3 merges into `main` and `wt/library-150` is rebased onto it, **before** merging this branch.

**Required for the merge:** (a), (c) and (d) keep library measurements on the 30; (b) makes the metamorphic sample fixed; (f) keeps the research tests green and the shipped hand-motion fit on the 30.

**Can follow the merge:** (e), (g) to (j).

1. **(a)** `packages/engine/src/eval/hands.test.ts`: import `benchmarkEntries` from `../library/benchmarkSet.js` and wrap the parsed manifest: `const manifest = benchmarkEntries(JSON.parse(read('content/manifest.json').toString('utf8')) as Array<{ slug: string; benchmarkSet?: string | null; files: { score: string } }>);`. The "85 percent over 30 simple textures" check then measures the 30 again.
2. **(b)** `packages/engine/src/eval/metamorphic.test.ts`: replace the unsorted `readdirSync(...).slice(0, 6)` with the six pieces it ran on in M2:

   ```ts
   // The six library pieces of the M2 run, pinned: the library grows (L1) and readdirSync order is
   // not sorted on Linux.
   const METAMORPHIC_PIECES = [
     'amazing-grace',
     'bach-invention-no1-bwv-772',
     'bach-minuet-g-major-bwv-anh-114',
     'bach-minuet-g-minor-bwv-anh-115',
     'bach-prelude-c-major-bwv-846',
     'beethoven-fur-elise-woo-59',
   ];
   const library = existsSync(scoresDir) ? METAMORPHIC_PIECES.map((s) => `${s}.musicxml`) : [];
   ```

3. **(c)** `packages/engine/src/fingering/solve.test.ts`, test "every library hand that has a fully legal fingering gets one": build `files` from `benchmarkEntries(<parsed content/manifest.json>).map((e) => e.files.score.replace(/^scores\//, ''))` instead of `readdirSync(LIBRARY)`. The `2 * files.length - 5` assertion and its comment stay true. New pieces are covered by the content lint gate at the large profile (decision 6).
4. **(d)** M3's `packages/engine/cli/bench.ts` `libraryRepeats(manifest, solveOpts)`: add a parameter `set = CORE_BENCHMARK_SET` and map `benchmarkEntries(entries, set)`. The repeat-consistency metric that `pnpm verify`'s benchmark step reports then measures the 30.
5. **(e)** `packages/engine/cli/run.ts`:
   - `--library-set <name|all>` for `bench` and `evalhands`, passed as `librarySet` or `set`.
   - `--profile` for `lint` (passes `profile` to `lintFingering`). With it, `content/tools/lint_gate.py` should add `--profile <p>` to its lint call; this is a one-line follow-up in `content/`.
6. **(f)** `research/scripts/make_hand_motion.py` `library_files()`: keep entries with `e.get("benchmarkSet", "core30") == "core30"`. Without it, `research/tests/test_make_hand_motion.py` fails (`[("library", 30)]`), and a refit of the shipped `hand-motion.json` would silently include the new pieces, some of which are in the Mutopia test half.
7. **(g)** `research/readability/corpus.py` `iter_library()`: skip fingered files whose manifest entry is not `core30`, or decide deliberately to widen the readability corpus with about 28 new editorial fingerings and re-run the readability report.
8. **(h)** M3 plan items that test "level 1 to 3" or "level 1 and 2" library pieces (beginner stretches, L15 crossings): select with `benchmarkEntries` unless the coordinator decides to hold the new pieces to those goals as well.
9. **(i)** M5 plan (not started): its editor-relative readability gate uses the library's `.fingered` copies. About 28 new copies appear (Burgmüller, Schumann, Bach BWV 926, Kuhlau, K. 545, K. 331, Pathétique, Kinderszenen, Tchaikovsky). Amend it to use `benchmarkEntries` or deliberately re-base its floors.
10. **(j)** Text:
    - `docs/app.md` line 7 ("one of the 30 built-in pieces") and line 58 (`library` "30 pieces");
    - `docs/verification-loop.md` 3b ("on the 30 library pieces" is now "on the library's benchmark set core30");
    - `docs/PROGRESS.md`: the milestone row, a standing finding on `benchmarkSet`, and the empty `content/.venv` and `content/_raw` finding.

After (a) to (f): run `pnpm verify` in the rebased worktree. Then run `$PY -I content/tools/gates.py --new`, because the merged M3 solver may finger differently. A new piece with a law error after the merge is dropped, or excerpted by a follow-up task, before the merge. The case goes to the hard-error gallery as an engine finding.

## Self-review notes

**Brief coverage, constraint by constraint:**

1. **Paths:** Global Constraints list every file. Engine changes are outside the forbidden list: `src/library/**` (new), `cli/evalhands.ts`, three tests under `src/io/`. The forbidden consumers are handled by the Deferred section.
2. **Selection:**
   - Mutopia enumerated from the mirror. 832 directories, 659 solo keyboard. Instrument, length (240 s, six pages, excerpt rule) and licence preference applied.
   - 47 arrangements at levels 1 and 2. Each has a reference and a melody test against the built file.
   - Counts by level as the brief asked, at 153 if every main candidate passes.
   - Candidate tables give slug, composer, source, licence and level, plus the spare policy.
   - Every piece has a collection: the vocabulary and both manifest fields are defined.
3. **Levelling:**
   - Heuristic features as required: span, density at the default tempo, position shifts, polyphony per hand (chord share), key signature, length, plus accidentals and leaps.
   - Tested at ≥ 27 of 30, measured at 30; leave-one-out at 27.
   - `levelNote` with a syllabus citation; `levelOverride` when the final level disagrees with the proposal; `tempoSource` per piece.
4. **Benchmark set:**
   - `benchmarkSet: "core30"` and `null` in the manifest.
   - The helper, evalhands' default, and the allowed tests.
   - Exactly which engine files change.
   - The forbidden ones deferred, with code, and the merge waits for them.
5. **Gates:**
   - Existing: XSD, xmlcheck, music21, MIDI against LilyPond 2.24 or the reference melody, Verovio page 1, piano range.
   - Span check, now a hard gate for new pieces.
   - The new lint gate at medium (plus large, decision 6), with counts recorded in `verification.json`.
   - Sizes per file (700 KB) and in total (reported, with the `.mxl` question answered in decision 13).
6. **App:**
   - Optional fields with tests.
   - "Start here" stays Twinkle.
   - The current list is already grouped by level (decision 9).
   - Baselines regenerated in the last task, with the polish re-run noted.
   - `DIGITUS2_E2E_PORT=4175` everywhere Playwright runs.
7. **Attribution:**
   - Typesetter, Mutopia id, licence and URL in manifest and `<rights>`.
   - Asserted for every CC piece.
   - The app's CC BY bug fixed.
   - A provenance table in the report.
8. **Determinism:**
   - `build.py` rebuilds everything from the catalog and the fetched sources (`repro.py --all`, Task 19).
   - Arrangements stay deterministic.
   - Tests cover the melody of every new arrangement, the level heuristic, the manifest (counts per level, unique slugs, files present, gates), and the benchmark-set filter.
9. **Tasks:**
   - Sized for one implementer each.
   - Waves mark the parallel ones (eleven content tasks in Wave C, one catalog fragment each, with a lock for the shared JSON).
   - Implementers never run git.
   - How to invoke the environment and LilyPond is under Global Constraints.

**Blockers and risks found while writing:**

1. **Empty content environment and raw downloads.** `content/.venv` and `content/_raw` are empty: the junction targets are empty directories. LilyPond is installed nowhere. The 2026-10-13 fetch log is lost. Task 0 recreates the environment; Tasks 1 and 3 pin and prove the core 30.
2. **Library consumers in forbidden files:**
   - `src/eval/hands.test.ts` (85 percent over the whole manifest);
   - `src/eval/metamorphic.test.ts` (first six unsorted files);
   - `src/fingering/solve.test.ts` (exact oracle over every file, near the 5 s timeout at 150 pieces);
   - M3's `cli/bench.ts` `libraryRepeats`;
   - `cli/run.ts` (no `--library-set`, no `lint --profile`).

   All deferred; the merge waits.

3. **Research consumers:** `research/scripts/make_hand_motion.py` with `research/tests/test_make_hand_motion.py` (asserts 30 library files), and `research/readability/corpus.py`. Deferred.
4. **Three engine tests in allowed files would break or time out:** `motion.test.ts` (counts must equal the shipped tables), `engrave.library.test.ts` (rhythms the M6 engraver does not support) and `smoke.test.ts` (timeout). Fixed in Task 2.
5. **The app would credit a CC BY engraving as public domain.** Fixed in Task 6.

**Judgement calls flagged for the coordinator:**

- the three classical themes (decision 11);
- the lint gate also at the large profile (decision 6);
- `collectionId` in addition to the requested `collection` (decision 8);
- Behr's "In May" filed under Romantic character pieces;
- the Swedish polska as the single CC BY engraving (it exercises the attribution path).

**Placeholder scan:** the infrastructure tasks give complete tests and either complete code (`benchmarkSet.ts`, `level.py`, the tests) or exact behaviour (`jsonio`, `build.py` changes, `lint_gate`, `gates`, app edits). The content tasks give the exact candidate rows, commands, acceptance gates and failure handling. Final levels, tempos and syllabus citations are left to the implementers, as the brief requires.
