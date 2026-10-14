# M7-A Teacher Review Job Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the teacher-review pilot (`research/teacher_review/`, `docs/research/teacher-review.md`) into the weekly job of verification spec section 3.12 and run it once for real on the current engine (default weight set, medium profile). The job selects passages automatically from one engine dump of the whole library and the latest PIG bench error gallery, renders them blinded, prepares the reviewer launches for the coordinator, collects and validates the reviews, measures the reviewer against its own controls, turns consistent objections into dated hypothesis rows for `docs/experiments.md`, and writes `docs/reviews/teacher-YYYY-MM-DD.md`. The first report is `docs/reviews/teacher-2026-10-14.md`.

**Architecture:** One Node ESM script and seven Python modules under `research/teacher_review/`, reusing the pilot's `model.py`, `render.py`, `inject.py`, `collect.py` and `score.py` unchanged except for new measurement functions in `score.py`.

- `engine_dump.mjs` imports only `packages/engine/dist/src/index.js` and writes per-note JSON: the 30 library pieces (optionally their tritone transpositions) and the PIG test pieces of the gallery. It records the measure, beat, duration, chord, tie, grace and document order, the chosen finger, confidence, cost gaps and lint issues of every note, and the rests of every library hand.
- `musicxml_passages.py` turns a dump piece into `Passage` windows with exact bars and beats and the same ids, chords and rests as the PIG adapter.
- `gallery.py` reads bench error galleries and builds PIG passages carrying the engine's fingers.
- `select.py` picks the five sets: low-confidence, hard-error, control, planted-fault control and recall control.
- `dispatch.py` writes blinded batch files, `key.json` and the launch list, and later validates reviewer outputs with `collect.normalise_item`.
- `hypotheses.py` groups consistent objections into hypothesis rows.
- `report.py` writes the report and the committed summary and audits that nothing PIG-derived leaks.
- `weekly.py` is the entry point with the subcommands `build`, `collect`, `report` and `where`.

The harness never calls a model. The coordinator launches the Opus reviewers from `launches.json`.

**Tech Stack:** Python 3.11 standard library plus pytest 9.1.1, run with `research/.venv/Scripts/python.exe -I`; Node 22 ESM with `node:` built-ins only; the built engine at `packages/engine/dist`. No new dependency anywhere.

**Depends on:**

- M2: `digitus2 bench` with error galleries, `SolveResult.explanations[].gaps`, `lintFingering`, `transposeScore`.
- The teacher-review pilot as committed at 813aa57 (36 tests green).
- M3 is optional. Before M3 the solver uses its literature defaults. After M3 the dump passes `RECOMMENDED_WEIGHT_SET` and records it.
- M5 is not required. User-edited passages (spec 3.12 item d) are out of scope until M5 ships edit storage in the app. Task 9's report says so.

Runs in the worktree `C:/Users/maxim/Desktop/projects/github/thingamajig-wt/teacher-review` (branch `wt/teacher-review`). It touches no file of another workflow.

**Spec:**

- `docs/superpowers/specs/2026-10-13-verification-design.md` sections 2 (oracles), 3.3 (error gallery), 3.8 (confidence), 3.12 (teacher review) and 4 (iteration protocol).
- `docs/research/teacher-review.md` sections 2 (protocol and rendering), 6.1 to 6.4 (the weekly design, what it must never be used for, the reviewer brief and wrapper, the two improvements) and 7 (the brief).
- `research/teacher_review/README.md` (dispatch wrapper).
- `docs/experiments.md` (row format: `| Date | Hypothesis | Change | Primary metric before → after | Other effects | Outcome |`).

Read these before Task 1.

## Decisions made while writing this plan (read before Task 1)

While writing this plan, throwaway prototypes in the session scratchpad (not in the repo) ran the built engine (`ENGINE_VERSION` 0.1.0 at 813aa57, medium profile, literature-default weights) through its public API. They covered all 30 library pieces (9,802 notes) and the 30 PIG test pieces (10,225 notes) and prototyped the adapter and the selection.

The plan's own code blocks for Tasks 1 to 6 and 8 were then extracted into a scratch copy of the harness and run against this worktree's engine build, library and PIG data. Every extracted test passed: 99, that is all except Task 7's tests and the one Task 8 test that needs `report.py`. The expected numbers of Task 7's pilot test were recomputed with the plan's functions and match.

A dry `weekly.py build` on the real library, with an empty gallery and therefore no bench, selected lowconf 20 (14 pieces), control 10, planted 4 (Wild Rider, Mozart K.2, Ode to Joy, Arabesque; 2 faults each) and recall 4. That gives 6 batches and 9 launches. The library batch files were 14 to 21 KB, and the committed directory 188 KB.

The numbers below come from those runs.

1. **The weekly build runs its own bench into the data directory.** The gallery must describe the same engine configuration as the dump, or hard-error windows point at notes the reviewed fingering does not get wrong. `pnpm verify` benches with the default large profile, and bench pages do not record the profile. A `bench --label` run without `--out` also replaces the tracked `benchmarks/latest.json`. `weekly.py build` therefore runs `bench ... --profile medium --label teacher-<date> --out research/data/teacher_review/weekly/<date>/bench/runs`, which writes the gallery to `.../bench/errors/teacher-<date>/` and `latest.json` to `.../bench/` (both gitignored). `--gallery DIR` reuses another gallery. The build always cross-checks gallery against dump (hand, pitch and engine finger of every hard-error row) and refuses on any mismatch.
2. **Windows are cut by onset tick, on regular measures only.** The engine gives each note a `measureIndex`, but grace notes written at the end of a bar (trill terminations, K.545 notes n460, n461, n1342, n1343 in bars 25 and 70) carry the earlier bar's index and the next downbeat's onset.
   - A window is 2 to 8 measures: plain numeric, consecutive numbers, one meter, nominal length. A pickup is allowed only as measure 0 opening the window, and a short final bar only as the piece's last measure closing the window.
   - Notes and rests belong to the window when `startTick(first) ≤ onsetTick < end(last)`.
   - Bars and beats come from ticks. The first full measure is the anchor and the pickup is right-aligned, so Happy Birthday's upbeat reads `R1 0 3 e. D4` and Greensleeves' reads `R1 0 2.667 e A4`.
   - Of the 793 four-bar windows of the library, 14 are irregular (Wild Rider's split bars `8a` and `16a`, Für Elise's 2/3 bars 8 and 105, and so on). On the other 779, bar and beat match the score for every note.
3. **Rests are derived.** The MusicXML reader drops `<rest>`, so the dump derives rests per library hand as silences of at least an eighth. A silence is the time after every earlier note of the hand has ended (the union of sounding notes, not just the previous event as in the PIG adapter, which mis-marks rests under held voices). The library has 366 such rests, for example Chopin Op. 69 No. 2 left hand bars 14, 16 and 30 beat 3. `musicxml_passages.derive_rests` is the Python twin of the Node rule, and a test holds them equal on all 30 pieces.
4. **Grace notes are separate events in document order.** The engine gives a grace note its main note's onset and chord id and sorts both by pitch, so Burgmüller's Pastorale has the grace F#5 `n17` after its main note E5 `n18`. The dump carries `sourceIndex` (document order). The adapter emits each grace as its own `gr` event before the chord at the same onset, so `R4 3 2.667 gr F#5` precedes `R5 3 2.667 e E5`.
5. **`render.py` stays unchanged, so the adapter guards against its column overflow.** `render_passage` uses fixed columns. A pitch list of 16 characters merges with the finger column (Satie bar 36 `A3+C#4+F#4+A4+D5`, Chopin Op. 28 Nos. 4 and 7), and so does an id range of 7 characters. `parse_rendering` then fails. This affects 10 of the 779 regular four-bar windows. `render_round_trips(p)` is part of every window check, so selection skips such windows. Widening the columns is a follow-up for `render.py` (`docs/PROGRESS.md` note in Task 9), not part of this plan.
6. **The weekly legend lives in `dispatch.py`.** `render.LEGEND` stays byte-identical so the pilot's batch files remain reproducible. `WEEKLY_LEGEND` adds the following:
   - The section 6.4 sentence on `dur`.
   - "A chord's dur is its longest note" (both adapters merge a chord to its longest note).
   - The 2/2 and 3/2 beat and "Bar 0 is an upbeat".
   - A tempo line that holds for every passage. The header still says "(estimated)" for library passages, because `render.py` is unchanged and its parser requires that word.
7. **The recall control is re-fingered by the engine in the new key.** Keeping the original fingers on tritone-transposed pitches would plant thumb-on-black and fifth-on-black faults (a C-major line moves to F#). That would measure topography, not recall. The dump therefore also solves every library piece transposed by a tritone (`transposeScore`, +6 for all 30 pieces, highest note 96 + 6 ≤ 108). The twin reviews the engine's fingering of that transposition, with composer "unknown", style "piano piece" and bars renumbered from 1. The report shows per pair the share of notes whose finger is the same in both keys, so a change in objections can be read against a change in fingering.
8. **Planted twins come first, and only from plantable controls.** On ten typical level 1 to 3 control windows, `inject_faults` planted two or more faults in six. It failed on Twinkle LH, Mozart K.2 LH, Happy Birthday RH, Mary RH and Bach's C major prelude LH, which have no chords, no fast pairs or only stepwise five-finger lines. The planted twins are therefore the first four controls, in seeded order, that accept at least two faults. The recall twins are four of the remaining controls. When fewer than four remain, a control may carry both twins, and its three variants then go to three different batches.
9. **Low-confidence seeds must sit in a line, and literal repeats are skipped.**
   - Notes with no same-hand neighbour within 1.0 s (`inject.LINE_IOI_S`) have a finger that does not matter, such as Satie's left hand in bars 42 and 43 at 0.303. They are 468 of 9,769 non-grace notes and 21 of the 200 least confident, and they are not seeds.
   - A window whose reviewed hand repeats an already selected one note for note and finger for finger (onsets, pitches, durations, fingers) is skipped, because there is nothing new to review.
   - A repeat the engine fingers differently is kept. In the dry run below, the Entertainer's bars 78-79 and 86-87 have the same twelve notes, and the engine fingers five of them differently (`2 3 4 3 2` against `3 4 5 4 3`). That is the inconsistent-repeat problem the UI review reported, which M3 plan addition 13 addresses, so both windows are reviewed.
   - Confidence ties are common (the value 0.3362 occurs in at least five pieces). They are broken by a seeded random rank, never by name order.
   - The window is the shortest centred one with at least 16 notes in the reviewed hand (the pilot's median was 21), falling back to 10. It never exceeds 48 notes in the reviewed hand or 96 in the passage, and it never overlaps a window already taken in the same piece.
   - The first prototype (shortest window with 10 notes, no line or repeat filter) found 20 windows after 38 seeds: 246 reviewed notes from 14 pieces of levels 1 to 5. The rules above make the windows longer and drop the repeat.
10. **Two reviewers means two framings of one batch composition.** The pilot's self-consistency (Pearson 0.95) was measured between `variant_a` and `variant_b`. Each low-confidence and hard-error batch is therefore written twice, as `batch-NNa.md` (framing a) and `batch-NNb.md` (framing b), with the same passages, fresh item ids and an independent order. Control batches get one reviewer, with framing a for odd and b for even batch numbers.
11. **The three pools never mix.** The pools are library low-confidence; PIG hard-error; and control with recall and planted twins. Library batch files contain no PIG data and can be committed under `research/teacher_review/results/weekly/<date>/library/`. A pool gets `max(ceil(n/8), most variants of one passage)` batches, balanced (20 → 7/7/6, 16 → 8/8, 18 → 6/6/6). Two variants of one passage never share a batch.
12. **A consistent objection is defined one-to-one.**
    - Two reviewers' objections on one passage match when they have the same kind and a note of one lies within one note of a note of the other in the same hand. The pilot used this tolerance for detection.
    - Matching is greedy: in reviewer a's order, each objection takes the first unmatched objection of reviewer b that matches.
    - A member is a matched pair (severity = the more severe of the two), or an unmatched `error` from either reviewer.
    - Control passages have one reviewer and contribute their `error` objections only. Planted and recall twins are instrument checks and never feed hypotheses.
    - On the pilot's FHMM3 passages this gives 42 members (33 pairs, 9 lone errors) in 27 passages. Kinds with three or more: hop 9, impossible_span 6, inconsistent 6, other 4, same_finger_chord 4, stretch 4, position_change 3. On expert passages it gives 13 members, of which only hop 3 reaches three. Tests pin both.
13. **A member's lint key is the related rule, not any rule at its notes.** L14 fires at 1,080 and L07 at 858 of the 9,802 library notes, so "some lint issue at the objected notes" would group noise. `KIND_LINT` maps each objection kind to the lint rules that check the same thing (hop → L11, stretch → L07/L05, …). The key is the first of those that fires at the member's notes, else `none`, or `n/a` when lint was not recorded (pilot data).
    - Kind groups of three or more become hypothesis entries `K1…`.
    - Lint groups of three or more that span at least two kinds become entries `L1…`. The `none` group is "lint is silent where the reviewer objects" and is a candidate for a new rule. Its expert base rate on PIG decides law or preference (spec section 2, oracle 4).
14. **The CLI must import its own checkout.**
    - `research/.venv` is a junction to the main checkout's venv, whose `digitus2_research.pth` puts the main checkout's `research/` on `sys.path`. In a worktree, `python -I -m teacher_review.<x>` therefore imports the main checkout's harness. This was verified: `teacher_review.__file__` resolves to `thingamajig/research/...`.
    - `-I` also implies `-P` in 3.11, so the script's own directory is not added either.
    - `weekly.py` is run by path and puts its own `research/` first. It also removes its own directory from `sys.path` when run without `-I`, because `select.py` would otherwise shadow the standard library's `select` (imported by `subprocess`).
    - Tests (pytest's rootdir insertion) are not affected.
15. **Hard-error windows come only from PIG pieces with a usable timing grid.**
    - These are `build_benchmark.USABLE`, 24 of the 30 test pieces. Bars of PIG passages are estimated (pilot section 2.2), and pieces 003, 006, 007, 009, 010 and 023 have no reliable grid.
    - In the prototype the medium-profile engine had 935 hard-error notes, 684 of them in usable pieces. The 16 best windows covered 308 of those, and piece 001 took 5 of the 16.
    - The brief's rule (cap 16, by descending hard-error count) is kept as written, with no per-piece cap. Ties go to the shorter window, then piece, then first bar. The report gives per-piece counts so the coordinator can decide on a cap later.
16. **Out of scope:**
    - User-edited passages (spec 3.12 item d), until M5.
    - Scheduling the weekly cron, which is the coordinator's call after the first run.
    - Any change to `packages/`, `apps/`, `render.py`, `collect.py`, `build_benchmark.py`, `inject.py`, `model.py`, `pig_passages.py` or the prompt files.
    - The brief still tells reviewers that some fingerings are by expert pianists, although none are this week. It is kept verbatim (teacher-review.md 6.3) so this week's numbers stay comparable with the pilot's. The report says so.

## Engine API gaps found in `packages/engine/dist` (813aa57)

Listed for the engine owners. Every one is worked around inside this plan, and nothing under `packages/` changes.

1. **No weight-set selection.** `SolveOptions` has no `weightSet`, and `RECOMMENDED_WEIGHT_SET` and `WEIGHT_SETS` are not exported (M3 adds them). The dump feature-detects. Without them it solves with the built-in `PARNCUTT_WEIGHTS` and records `weightSet: "parncutt-defaults"` and the weights hash. `--weight-set` fails with exit 2 until M3 lands.
2. **No rests in `Score`.** The MusicXML reader drops `<rest>`. The dump derives rests (decision 3).
3. **Grace notes share their main note's onset and `chordId` and are sorted by pitch.** Document order is only in `Note.sourceIndices`. The dump exports `sourceIndex` (decision 4).
4. **`measureIndex` is the document measure, not the sounding one.** For grace notes at a barline, `beatQ` is 4.0 in a 4/4 bar, which is why windows are cut by tick (decision 2).
5. **Measure numbers are free strings** (`"0"` pickups, `"8a"`), and measure lengths may differ from the meter. There is no helper for bar and beat. The adapter computes them (decision 2).
6. **`explanations[id].gaps` uses `+Infinity`, which `JSON.stringify` turns into `null`.** The dump writes `null` and documents it as "no complete path gives this finger". Over 20,027 notes, 19,619 of the 100,135 gap entries are `null`, and the chosen finger's gap is always 0.
7. **Bench galleries do not record profile or weights.** `bench --label` without `--out` overwrites the tracked `benchmarks/latest.json`, and the gallery's `bar` column is `-` for PIG (no measures in PIG scores). Hence decision 1 and estimated PIG bars. The bench also runs `git rev-parse HEAD` for its scorecard. This read-only call is the same one `pnpm verify` already makes.
8. **No public API names the first gold file of a PIG piece.** The dump reproduces bench's rule: the files `<id>-<k>_fingering.txt` in name order, the first one.

## Global Constraints

- **Ownership:** this plan writes only `research/teacher_review/**`, `research/data/teacher_review/weekly/**` (gitignored; a junction to the main checkout's data directory inside the worktree) and `docs/reviews/teacher-2026-10-14.md`. The coordinator alone edits `docs/experiments.md`, `docs/PROGRESS.md` and the verification spec. Nothing under `packages/` or `apps/` changes. If an engine API is missing, work around it with what `dist` exports and add a line to the gap list in the Task 9 hand-off.
- **Python:** 3.11 standard library plus pytest. Open every text file with `encoding="utf-8"` and write with `newline="\n"`. Run tests with `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests -q`, and the job with `research/.venv/Scripts/python.exe -I research/teacher_review/weekly.py ...` from the repository root (decision 14). Never use `-m teacher_review.weekly` in a worktree.
- **Node:** `engine_dump.mjs` imports only `packages/engine/dist/src/index.js` and `node:` built-ins. If `dist` is missing, it prints the build command and exits 2. Build with `pnpm --filter @digitus2/engine build`.
- **Determinism:** the same dump, gallery and seed give byte-identical selection, batch files, key, launches and library copies. The same collected outputs give a byte-identical report, summary and hypothesis rows. Randomness comes only from `random.Random("<seed>-<purpose>")`. String seeds go through SHA-512 and do not depend on `PYTHONHASHSEED`. There are no timestamps in generated files. The default seed is the date as an integer (2026-10-14 → 20261014).
- **PIG licence:** PIG passages, their renderings, the dump, `key.json`, raw reviewer outputs and `judgements.json` stay under `research/data/teacher_review/`. Tracked files (`docs/`, `research/teacher_review/results/`) refer to PIG passages only by opaque passage id (`he03`) and counts. They never contain PIG pitches, bars, renderings or reviewer text about PIG passages. `report.audit_no_pig` enforces this before anything is written.
- **Not a gate (spec 3.12, teacher-review.md 6.2):** `pnpm verify` never runs this job, no floor reads its numbers, and nothing is fitted to them.
- **Sizes:** every new tracked file stays under 900 KB. Each committed library batch copy stays under 64 KB, and the whole `results/weekly/<date>/` directory under 400 KB. The repository hygiene gate (1 MB per file) must stay green.
- **Formatting:** `research/` is ignored by prettier and eslint. Run `pnpm exec prettier --write docs/reviews/teacher-2026-10-14.md` after generating it.
- **Git:** implementers never run git. Each task ends with a hand-off step listing exact paths for the coordinator's commit. Use the Write tool for files longer than a few lines. Long commands (the real build, about one minute) run in the background.
- **Done means:** the research pytest suite is green, with all pre-existing tests unchanged and passing, and `pnpm verify` stays green (it does not run research tests, but its hygiene step sees the new tracked files).

## Review Focus

1. **Note identity must be exact.** A reviewer's objection is located by id, bar and beat. An off-by-one bar, a pickup shown left-aligned, or a grace note after its main note sends every objection to the wrong note, and nothing downstream can tell. Pinned by Task 2: `test_pickup_is_bar_zero_and_right_aligned`, `test_grace_notes_precede_their_main_note_in_document_order`, `test_window_membership_follows_onset_ticks`, and `test_every_regular_window_of_the_library_round_trips` (all 779 regular four-bar windows, bar and beat checked note by note against ticks).
2. **The gallery and the dump must describe the same engine.** Otherwise hard-error windows mark notes the reviewed fingering does not get wrong. Pinned by Task 3 `test_gallery_and_dump_must_agree` and by Task 8's build refusing on a mismatch (`test_build_refuses_a_gallery_from_another_engine`).
3. **No PIG data may leak into a tracked file:** no renderings, pitches, bars or reviewer text about PIG passages. Pinned by Task 5 `test_library_copies_contain_no_pig_items` and Task 7 `test_pig_items_appear_only_as_counts` (the audit catches two consecutive PIG note lines or a PIG objection text anywhere in the report, summary or rows).
4. **Blinding must hold.** No batch holds two variants of one passage, item ids are unique across the day, and the passage blocks never name the set, the piece title, the passage id or the transposition. Pinned by Task 5 `test_plan_batches_sizes_twins_and_framings` and `test_write_day_files_blinding_and_key`.
5. **The recall twin must carry the engine's fingering of the transposed piece,** not the original fingers on transposed pitches (decision 7). Pinned by Task 4 `test_recall_twin_uses_transposed_engine_fingers`.
6. **Consistent-objection matching must be one-to-one and deterministic.** Its counts on the pilot are known exactly (decision 12). Pinned by Task 6 `test_consistent_objections_on_the_pilot` and `test_hypotheses_and_rows_on_the_pilot`.
7. **The CLI must run this checkout's harness, not the main checkout's,** and must not shadow the standard library's `select`. Pinned by Task 8 `test_cli_imports_this_checkout` and `test_cli_without_isolation_still_runs`.
8. **The build must be deterministic and must not destroy reviewer outputs.** Pinned by Task 8 `test_build_is_deterministic_and_refuses_to_overwrite_outputs`.
9. **The weekly report must reproduce the pilot's measured numbers** when fed the pilot's committed results (planted detection 183/184 by position, reviewer agreement Pearson 0.95), so the drift table compares like with like. Pinned by Task 7 `test_report_on_the_pilot_results`.

## File Structure

```
research/teacher_review/engine_dump.mjs          Node: per-note engine output through dist's public API (library, tritone copies, PIG pieces)
research/teacher_review/musicxml_passages.py     library adapter: dump piece -> Passage (regular windows, ticks -> bars and beats, chords, graces, rests),
                                                 LIBRARY_STYLE, derive_rests, render_round_trips
research/teacher_review/gallery.py               bench gallery reader, gallery/dump cross-check, PIG passage with engine fingers
research/teacher_review/select.py                the five sets and record -> Passage
research/teacher_review/dispatch.py              WEEKLY_LEGEND, WRAPPER, batch plan, batch files, key.json, launches, library copies, collect_outputs
research/teacher_review/score.py                 + match_objections, rates_by, recall_comparison, hard_error_agreement, seed_hits
research/teacher_review/hypotheses.py            consistent objections, grouping by kind and lint rule, docs/experiments.md rows
research/teacher_review/report.py                Day, load_day, build_report, audit_no_pig
research/teacher_review/weekly.py                entry point: build | collect | report | where
research/teacher_review/README.md                + section "Weekly review (verification spec 3.12)"
research/teacher_review/tests/weekly_fixtures.py synthetic dumps, PIG pieces, gallery pages, fake reviews; engine and PIG skip markers
research/teacher_review/tests/test_engine_dump.py, test_musicxml_passages.py, test_gallery.py, test_select.py, test_dispatch.py,
                              test_hypotheses.py, test_report.py, test_weekly.py   (new)
research/teacher_review/tests/test_score.py      + tests for the new score functions
research/teacher_review/results/weekly/2026-10-14/  committed: summary.json, hypotheses.md, library/batch-*.md
docs/reviews/teacher-2026-10-14.md               the first weekly report
research/data/teacher_review/weekly/2026-10-14/  gitignored: bench/, dump.json, selection.json, batch-*.md, items/*.txt, key.json,
                                                 launches.json, launches.md, out/*.json, judgements.json, collect_report.json, dispatch_log.json
```

Record this ownership in `docs/PROGRESS.md` before launching (coordinator). The `research/teacher_review/` row moves from the teacher-review agent to the M7-A workflow. Tasks 1 to 8 run in order. Task 3 may run alongside Task 2 once Task 1's fixtures exist. Task 9 needs everything.

## Interfaces the plan relies on

**Engine `dist` (public API, `packages/engine/dist/src/index.js`):**

```ts
parseMusicXml(input: string | Uint8Array, opts?: { source?: string }): { score: Score; editorial: Assignment; warnings: string[] }
parsePig(text: string, opts?: { source?: string }): { score: Score; assignment: Assignment }
solveFingering(score: Score, opts?: { profile?: 'child'|'small'|'medium'|'large'; weightSet?: string /* M3 */ }): SolveResult
//   SolveResult.assignment[id] = { finger: 1..5, confidence?: number, alternatives?, source }
//   SolveResult.explanations[id] = { terms, total, gaps?: number[5] /* +Infinity = no complete path */, heldBy? }
//   SolveResult.hands[] = { hand, cost, iterations, relaxed, notes, infeasibleSlices: {slice, noteIds}[] }
lintFingering(score, assignment, { profile }): { issues: { rule: 'L01'..'L14', severity, hand, noteIds: string[], message }[], ... }
LINT_RULES: Record<'L01'..'L14', { title: string; law: boolean }>
transposeScore(score: Score, semitones: number): Score      // keeps note ids; spelling re-derived (sharps)
formatPigPitch(s: Spelling): string; HAND_PROFILES; PIANO_MIN (21); PIANO_MAX (108); PARNCUTT_WEIGHTS; ENGINE_VERSION
// optional, after M3: RECOMMENDED_WEIGHT_SET: string; WEIGHT_SETS: Record<string, unknown>
// Score: divisions; tempoMap[{tick, qpm}]; timeSignatures[{tick, beats, beatType}]; measures[{index, startTick, lengthTicks, number: string}];
//        notes[{id, onsetTick, offsetTick, onsetSec, offsetSec, midi, spelling, hand, staff, voice, measureIndex, isGrace, chordId, sourceIndices}]
//        notes sorted by onsetTick, hand (R first), midi, id; chordId = `${hand}@${onsetTick}`; grace notes: offsetTick = onsetTick
```

**Engine CLI** (`node packages/engine/dist/cli/main.js`):

- `bench --gold research/data/pig --split research/data/splits/pig_official.json --subset test --profile medium --label teacher-<date> --out <runs>` writes three things:
  - `<runs>/<sha7>-teacher-<date>.json`: the scorecard, with `gitSha`, `label`, `profile`, `weightsHash`, `macro.gen` and `macro.hardErrorRate`.
  - `<dirname(runs)>/errors/teacher-<date>/<piece>.md`: one gallery page per piece with any mismatch.
  - `<dirname(runs)>/latest.json`.
- The usage text lists `--weights` only after M3.

Gallery page rows, as written by `cli/bench.ts` `scorePiece`, are one table:

```
| # | bar | onset s | hand | pitch | context | engine (confidence) top terms | runner-up | annotators | why not | hard |
|---|---|---|---|---|---|---|---|---|---|---|
| 12 | - | 3.00 | L | C3 | E3:3 D3:4 [C3] B2:1 A2:2 | 5 (55%) thumbPassing 2.0 | - | 4 4 4 | 4: held note 9 (+1.5) | hard |
```

- `#` is the index into `parsePig(<first gold file in name order>).score.notes`.
- `bar` is `-` for PIG.
- The engine cell starts `<finger> (<confidence>%)`.
- `annotators` holds one finger per gold file, or `-`.
- `hard` is `hard` or empty. A hard row means every annotator (at least two) agrees and the engine differs.

**Pilot harness (unchanged):**

- `model`: `Passage`, `Event`, `number_events`, `pitch_name`.
- `render`: `render_passage`, `parse_rendering`, `LEGEND`, `dur_label`.
- `inject`: `inject_faults(p, rng, prefer=…)` returns `(Passage, [Fault])` and raises `ValueError` below two faults; also `Fault.as_dict()`, `LINE_IOI_S` and `KINDS`.
- `collect`: `normalise_item(raw, key_item, problems)` (needs `passage`, `condition`, `hands`, `n_notes`, `fingers`), `_parse_ts`, `CRITERIA`, `KINDS`.
- `score`: `fault_detection`, `false_positives`, `consistency(keyA, jA, keyB, jB)` (pairs by `(passage, condition)`), `readback`, `cost(collect_report)`, `overall`, `_near`.
- `pig_passages`: `build_piece(pid, slot)` (returns `PieceData`, with `.events`, `.bar_of(onset_q)`, `.bars`, `.composer`, `.style` and `.grid.tempo_qpm`), `extract_window(piece, b1, b2, hands, pid, fingers="none")`, `Grid`.
- `build_benchmark`: `USABLE`, `make_run` (used only by a format test), `PROMPTS`.
- `prompts/brief.md`, `prompts/variant_a.md` and `prompts/variant_b.md` are unchanged.

**Dispatch wrapper:** the prompt is the README's "Dispatch" paragraph, with the passage count as a parameter.

---

### Task 1: `engine_dump.mjs`, the per-note engine output

**Files:**

- Create: `research/teacher_review/engine_dump.mjs`, `research/teacher_review/tests/weekly_fixtures.py` (engine part), `research/teacher_review/tests/test_engine_dump.py`

**Interfaces:**

- Consumes: the `dist` API above; `content/manifest.json` (`slug`, `title`, `composer`, `level`, `files.score` relative to the manifest's directory); `research/data/pig/FingeringFiles/<id>-<k>_fingering.txt`.
- Produces: one JSON document, the dump:

```
{ "version": 1, "engineVersion": "0.1.0", "profile": "medium", "weightSet": "parncutt-defaults" | "<M3 set id>",
  "weightsHash": "<16 hex: sha256(JSON.stringify(PARNCUTT_WEIGHTS))>", "lintRules": { "L01": {"title", "law"}, ... },
  "pieces": [ {
     "id": "<slug>" | "<slug>@tritone" | "pig:<id>", "source": "library" | "pig",
     library: "slug", "title", "composer", "level", "file" (repo-relative), "transpose": 0 | 6 | -6
     pig:     "pigId", "file" ("<id>-<k>_fingering.txt"), "transpose": 0
     "divisions", "tempoMap": [{"tick","qpm"}],
     "measures": [{"index","number","startTick","lengthTicks","beats","beatType"}]      (library; [] for PIG)
     "notes": [{"index","id","hand","staff","voice","midi","pitch","onsetTick","offsetTick","onsetSec","offsetSec",
                "measureIndex","measure","beatQ","durQ","isGrace","chordId","tied","sourceIndex",
                "finger","confidence","gaps":[5 x number|null],"lint":["L11:warning",...]}]   (score.notes order; PIG: measure fields null)
     "rests": [{"hand","startTick","endTick","measureIndex","measure","beatQ","durQ"}]   (library; R then L, time order; [] for PIG)
     "solve": [{"hand","relaxed","iterations","infeasibleSlices"}] } ] }
```

- `beatQ` and `durQ` are quarter notes as floats, for reading only. The adapter uses ticks.
- A `null` gap means no complete path gives that finger.
- A library piece's tritone copy follows it directly when `--tritone` is given. Its transposition is +6 when the highest note + 6 ≤ 108, else −6. A copy that would leave the piano range is skipped with a warning on stderr.

- [ ] **Step 1: Write the test helpers (engine part)**

`research/teacher_review/tests/weekly_fixtures.py` (Task 2, Task 3, Task 5 and Task 8 extend it):

```python
"""Helpers for the weekly-job tests: the real engine dump (skipped without node and the engine
build), and, from Task 2 on, synthetic dumps, PIG pieces, gallery pages and fake reviews (no
engine, no PIG data)."""
from __future__ import annotations

import json
import shutil
import subprocess
from fractions import Fraction
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
ENGINE_DUMP = REPO / "research" / "teacher_review" / "engine_dump.mjs"
DIST_INDEX = REPO / "packages" / "engine" / "dist" / "src" / "index.js"
PIG_FILES = REPO / "research" / "data" / "pig" / "FingeringFiles"
NODE = shutil.which("node")

needs_engine = pytest.mark.skipif(not NODE or not DIST_INDEX.exists(),
                                  reason="needs node and the engine build (pnpm --filter @digitus2/engine build)")
needs_pig = pytest.mark.skipif(not PIG_FILES.exists(), reason="needs the PIG dataset under research/data/pig")


def run_dump(out: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([NODE, str(ENGINE_DUMP), "--out", str(out), *args], cwd=REPO, capture_output=True,
                          text=True, encoding="utf-8", timeout=600)
```

- [ ] **Step 2: Write the failing tests**

`research/teacher_review/tests/test_engine_dump.py`:

```python
"""engine_dump.mjs: per-note engine output through the built engine's public API only."""
from __future__ import annotations

import json

import pytest

from .weekly_fixtures import needs_engine, needs_pig, run_dump

pytestmark = needs_engine

SLUGS = "twinkle-twinkle-little-star,happy-birthday,burgmuller-op100-no3-pastorale,chopin-waltz-op69-no2"


@pytest.fixture(scope="module")
def small(tmp_path_factory):
    out = tmp_path_factory.mktemp("dump") / "small.json"
    r = run_dump(out, "--manifest", "content/manifest.json", "--slugs", SLUGS, "--tritone")
    assert r.returncode == 0, r.stderr
    return json.loads(out.read_text(encoding="utf-8"))


def _piece(dump, pid):
    return next(p for p in dump["pieces"] if p["id"] == pid)


def test_meta_and_piece_order(small):
    assert small["version"] == 1 and small["profile"] == "medium"
    assert isinstance(small["engineVersion"], str) and isinstance(small["weightSet"], str)
    assert len(small["weightsHash"]) == 16
    assert {"L01", "L05", "L11", "L14"} <= set(small["lintRules"])
    assert [p["id"] for p in small["pieces"]] == [
        "twinkle-twinkle-little-star", "twinkle-twinkle-little-star@tritone",
        "happy-birthday", "happy-birthday@tritone",
        "burgmuller-op100-no3-pastorale", "burgmuller-op100-no3-pastorale@tritone",
        "chopin-waltz-op69-no2", "chopin-waltz-op69-no2@tritone"]
    used = {x.split(":")[0] for p in small["pieces"] for n in p["notes"] for x in n["lint"]}
    assert used <= set(small["lintRules"])


def test_twinkle_notes_measures_and_engine_fields(small):
    p = _piece(small, "twinkle-twinkle-little-star")
    assert (p["source"], p["slug"], p["level"], p["transpose"]) == ("library", "twinkle-twinkle-little-star", 1, 0)
    assert p["file"] == "content/scores/twinkle-twinkle-little-star.musicxml"
    assert p["divisions"] == 10080 and p["tempoMap"][0]["qpm"] == 100
    assert [m["number"] for m in p["measures"]] == [str(i) for i in range(1, 13)]
    assert all((m["beats"], m["beatType"], m["lengthTicks"]) == (4, 4, 40320) for m in p["measures"])
    notes = p["notes"]
    assert len(notes) == 64 and sum(n["hand"] == "R" for n in notes) == 42
    assert [n["index"] for n in notes] == list(range(64))
    first = notes[0]
    assert (first["id"], first["hand"], first["midi"], first["pitch"]) == ("n0", "R", 60, "C4")
    assert (first["measureIndex"], first["measure"], first["beatQ"], first["durQ"]) == (0, "1", 0, 1)
    assert p["rests"] == []
    for n in notes:
        assert n["finger"] in (1, 2, 3, 4, 5) and 0 <= n["confidence"] <= 1
        assert len(n["gaps"]) == 5 and n["gaps"][n["finger"] - 1] == 0
        assert all(g is None or g >= 0 for g in n["gaps"])


def test_pickup_measure_is_kept_as_written(small):
    p = _piece(small, "happy-birthday")
    assert len(p["notes"]) == 43 and len(p["measures"]) == 9
    m0 = p["measures"][0]
    assert (m0["number"], m0["startTick"], m0["lengthTicks"], m0["beats"], m0["beatType"]) == ("0", 0, 10080, 3, 4)
    n0 = p["notes"][0]
    assert (n0["measure"], n0["beatQ"], n0["durQ"], n0["pitch"]) == ("0", 0, 0.75, "D4")


def test_grace_notes_keep_document_order(small):
    p = _piece(small, "burgmuller-op100-no3-pastorale")
    order = [n["id"] for n in p["notes"]]
    notes = {n["id"]: n for n in p["notes"]}
    assert sum(n["isGrace"] for n in p["notes"]) == 9
    grace, main = notes["n17"], notes["n18"]
    assert grace["isGrace"] and not main["isGrace"] and grace["durQ"] == 0
    assert grace["chordId"] == main["chordId"] and grace["sourceIndex"] < main["sourceIndex"]
    assert order.index("n18") < order.index("n17")      # the engine sorts by pitch: E5 before the grace F#5


def test_rests_are_silences_of_an_eighth_or_more(small):
    pastorale = _piece(small, "burgmuller-op100-no3-pastorale")
    assert [(r["hand"], r["measure"], r["beatQ"]) for r in pastorale["rests"]] == [
        ("R", "10", 2.5), ("L", "10", 2.5), ("L", "15", 0.0), ("L", "18", 2.5), ("L", "28", 1.0), ("L", "28", 2.5)]
    assert [r["durQ"] for r in pastorale["rests"][:2]] == [0.5, 0.5]
    waltz = _piece(small, "chopin-waltz-op69-no2")
    assert [(r["hand"], r["measure"], r["beatQ"], r["durQ"]) for r in waltz["rests"]] == [
        ("L", "14", 2.0, 1.0), ("L", "16", 2.0, 1.0), ("L", "30", 2.0, 1.0)]


def test_tritone_copy_is_transposed_and_solved_again(small):
    orig = _piece(small, "twinkle-twinkle-little-star")
    tt = _piece(small, "twinkle-twinkle-little-star@tritone")
    assert tt["transpose"] == 6 and tt["slug"] == orig["slug"] and tt["level"] == 1
    assert [n["id"] for n in tt["notes"]] == [n["id"] for n in orig["notes"]]
    assert [n["midi"] for n in tt["notes"]] == [n["midi"] + 6 for n in orig["notes"]]
    assert all(n["finger"] in (1, 2, 3, 4, 5) for n in tt["notes"])


def test_output_is_deterministic(tmp_path):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    for out in (a, b):
        r = run_dump(out, "--manifest", "content/manifest.json", "--slugs", "twinkle-twinkle-little-star")
        assert r.returncode == 0, r.stderr
    assert a.read_bytes() == b.read_bytes()


def test_usage_errors_exit_2_and_write_nothing(tmp_path):
    out = tmp_path / "x.json"
    assert run_dump(out).returncode == 2                                     # nothing to dump
    assert run_dump(out, "--manifest", "content/manifest.json", "--slugs", "no-such-piece").returncode == 2
    assert run_dump(out, "--manifest", "content/manifest.json", "--profile", "huge").returncode == 2
    assert run_dump(out, "--manifest", "content/manifest.json", "--slugs", "twinkle-twinkle-little-star",
                    "--weight-set", "no-such-set").returncode == 2
    assert not out.exists()


@needs_pig
def test_pig_piece_uses_the_first_annotation_file(tmp_path):
    out = tmp_path / "pig.json"
    r = run_dump(out, "--pig-dir", "research/data/pig", "--pig-pieces", "001")
    assert r.returncode == 0, r.stderr
    (p,) = json.loads(out.read_text(encoding="utf-8"))["pieces"]
    assert (p["id"], p["source"], p["pigId"], p["file"]) == ("pig:001", "pig", "001", "001-1_fingering.txt")
    assert len(p["notes"]) == 469 and p["measures"] == [] and p["rests"] == []
    n0 = p["notes"][0]
    assert (n0["id"], n0["pitch"], n0["measure"], n0["beatQ"]) == ("0", "C4", None, None)
```

Run: `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests/test_engine_dump.py -q`
Expected: FAIL (the script does not exist; every test errors on the missing file). If the engine is not built, all tests are skipped. Build it first with `pnpm --filter @digitus2/engine build`.

- [ ] **Step 3: Write the dump**

`research/teacher_review/engine_dump.mjs`:

```js
#!/usr/bin/env node
// engine_dump.mjs: per-note engine output for the weekly teacher review (verification spec 3.12).
// Uses only the built engine's public API (packages/engine/dist/src/index.js) and node: built-ins.
//
//   node research/teacher_review/engine_dump.mjs --out <file.json> [--manifest content/manifest.json]
//        [--slugs a,b] [--tritone] [--pig-dir research/data/pig --pig-pieces 001,002]
//        [--profile medium] [--weight-set <id>]
//
// Paths are relative to the current directory (the repository root). Deterministic for the same
// engine build and inputs. Schema: docs/superpowers/plans/2026-10-14-m7a-teacher-review-job.md, Task 1.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(REPO, 'packages', 'engine', 'dist', 'src', 'index.js');

function fail(message) {
  process.stderr.write(`engine_dump: ${message}\n`);
  process.exit(2);
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      out: { type: 'string' },
      manifest: { type: 'string' },
      slugs: { type: 'string' },
      tritone: { type: 'boolean' },
      'pig-dir': { type: 'string' },
      'pig-pieces': { type: 'string' },
      profile: { type: 'string', default: 'medium' },
      'weight-set': { type: 'string' },
    },
  }));
} catch (err) {
  fail(err.message);
}
if (!values.out) fail('--out is required');
if (!values.manifest && !values['pig-pieces'])
  fail('nothing to dump: give --manifest and/or --pig-pieces');
if (!existsSync(DIST)) fail(`no engine build at ${DIST}; run pnpm --filter @digitus2/engine build`);
const E = await import(pathToFileURL(DIST).href);
if (!(values.profile in E.HAND_PROFILES)) fail(`unknown profile ${values.profile}`);

// Weight sets arrive with M3 (RECOMMENDED_WEIGHT_SET, WEIGHT_SETS, SolveOptions.weightSet). Before
// that the solver uses its literature defaults (PARNCUTT_WEIGHTS) and the dump says so.
const hasWeightSets = typeof E.RECOMMENDED_WEIGHT_SET === 'string';
let weightSet = null;
if (values['weight-set']) {
  if (!hasWeightSets)
    fail('this engine build has no weight sets (M3 not merged); omit --weight-set');
  if (E.WEIGHT_SETS && !(values['weight-set'] in E.WEIGHT_SETS))
    fail(`unknown weight set ${values['weight-set']}`);
  weightSet = values['weight-set'];
} else if (hasWeightSets) weightSet = E.RECOMMENDED_WEIGHT_SET;
const solveOpts = { profile: values.profile, ...(weightSet ? { weightSet } : {}) };

function sigAt(score, tick) {
  let sig = { beats: 4, beatType: 4 };
  for (const t of [...score.timeSignatures].sort((a, b) => a.tick - b.tick))
    if (t.tick <= tick) sig = t;
  return sig;
}

function measureAt(measures, tick) {
  let k = -1;
  for (let i = 0; i < measures.length; i++) {
    if (measures[i].startTick <= tick) k = i;
    else break;
  }
  return k;
}

function lintByNote(score, assignment) {
  const report = E.lintFingering(score, assignment, { profile: values.profile });
  const out = new Map();
  for (const issue of report.issues)
    for (const id of issue.noteIds) {
      const list = out.get(id) ?? [];
      const tag = `${issue.rule}:${issue.severity}`;
      if (!list.includes(tag)) list.push(tag);
      out.set(id, list);
    }
  for (const list of out.values()) list.sort();
  return out;
}

// A rest is a silence of at least an eighth in one hand: no note of the hand sounds (the union of
// every earlier note, not only the previous one). Grace notes have no length and are ignored.
function restsOf(score, measures) {
  const out = [];
  for (const hand of ['R', 'L']) {
    let until = null;
    for (const n of score.notes) {
      if (n.hand !== hand || n.isGrace) continue;
      if (until !== null && n.onsetTick - until >= score.divisions / 2) {
        const mi = measureAt(measures, until);
        const m = mi >= 0 ? measures[mi] : null;
        out.push({
          hand,
          startTick: until,
          endTick: n.onsetTick,
          measureIndex: mi,
          measure: m ? m.number : null,
          beatQ: m ? (until - m.startTick) / score.divisions : null,
          durQ: (n.onsetTick - until) / score.divisions,
        });
      }
      until = until === null ? n.offsetTick : Math.max(until, n.offsetTick);
    }
  }
  return out;
}

function dumpScore(score, head) {
  let result;
  try {
    result = E.solveFingering(score, solveOpts);
  } catch (err) {
    fail(`solve failed for ${head.id}: ${err.message}`);
  }
  const lint = lintByNote(score, result.assignment);
  const library = head.source === 'library';
  const measures = library
    ? score.measures.map((m) => {
        const s = sigAt(score, m.startTick);
        return {
          index: m.index,
          number: m.number,
          startTick: m.startTick,
          lengthTicks: m.lengthTicks,
          beats: s.beats,
          beatType: s.beatType,
        };
      })
    : [];
  const notes = score.notes.map((n, index) => {
    const a = result.assignment[n.id];
    const ex = result.explanations[n.id];
    const m = library ? score.measures[n.measureIndex] : undefined;
    return {
      index,
      id: n.id,
      hand: n.hand,
      staff: n.staff,
      voice: n.voice,
      midi: n.midi,
      pitch: E.formatPigPitch(n.spelling),
      onsetTick: n.onsetTick,
      offsetTick: n.offsetTick,
      onsetSec: n.onsetSec,
      offsetSec: n.offsetSec,
      measureIndex: m ? n.measureIndex : null,
      measure: m ? m.number : null,
      beatQ: m ? (n.onsetTick - m.startTick) / score.divisions : null,
      durQ: (n.offsetTick - n.onsetTick) / score.divisions,
      isGrace: n.isGrace,
      chordId: n.chordId,
      tied: n.sourceIndices.length > 1,
      sourceIndex: n.sourceIndices[0] ?? index,
      finger: a ? a.finger : null,
      confidence: a && typeof a.confidence === 'number' ? a.confidence : null,
      gaps: ex && ex.gaps ? ex.gaps.map((g) => (Number.isFinite(g) ? g : null)) : null,
      lint: lint.get(n.id) ?? [],
    };
  });
  return {
    ...head,
    divisions: score.divisions,
    tempoMap: score.tempoMap,
    measures,
    notes,
    rests: library ? restsOf(score, measures) : [],
    solve: result.hands.map((h) => ({
      hand: h.hand,
      relaxed: h.relaxed,
      iterations: h.iterations,
      infeasibleSlices: h.infeasibleSlices.length,
    })),
  };
}

const pieces = [];
if (values.manifest) {
  const manifestPath = resolve(values.manifest);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const want = values.slugs ? values.slugs.split(',') : null;
  if (want)
    for (const s of want) if (!manifest.some((e) => e.slug === s)) fail(`unknown slug ${s}`);
  for (const entry of manifest) {
    if (want && !want.includes(entry.slug)) continue;
    const file = join(dirname(manifestPath), entry.files.score);
    const { score } = E.parseMusicXml(readFileSync(file), { source: entry.slug });
    const base = {
      source: 'library',
      slug: entry.slug,
      title: entry.title,
      composer: entry.composer,
      level: entry.level,
      file: relative(process.cwd(), file).split('\\').join('/'),
    };
    pieces.push(dumpScore(score, { id: entry.slug, ...base, transpose: 0 }));
    if (values.tritone) {
      const midis = score.notes.map((n) => n.midi);
      const t = Math.max(...midis) + 6 <= E.PIANO_MAX ? 6 : -6;
      if (Math.min(...midis) + t < E.PIANO_MIN) {
        process.stderr.write(
          `engine_dump: ${entry.slug} cannot move a tritone inside the piano range; no copy\n`,
        );
        continue;
      }
      pieces.push(
        dumpScore(E.transposeScore(score, t), {
          id: `${entry.slug}@tritone`,
          ...base,
          transpose: t,
        }),
      );
    }
  }
}
if (values['pig-pieces']) {
  const root = resolve(values['pig-dir'] ?? 'research/data/pig');
  const dir = existsSync(join(root, 'FingeringFiles')) ? join(root, 'FingeringFiles') : root;
  const names = existsSync(dir) ? readdirSync(dir) : [];
  for (const id of values['pig-pieces'].split(',')) {
    const files = names.filter((f) => new RegExp(`^${id}-\\d+_fingering\\.txt$`).test(f)).sort();
    if (files.length === 0) fail(`no PIG file for piece ${id} in ${dir}`);
    const { score } = E.parsePig(readFileSync(join(dir, files[0]), 'utf8'), { source: files[0] });
    pieces.push(
      dumpScore(score, { id: `pig:${id}`, source: 'pig', pigId: id, file: files[0], transpose: 0 }),
    );
  }
}

const dump = {
  version: 1,
  engineVersion: E.ENGINE_VERSION,
  profile: values.profile,
  weightSet: weightSet ?? 'parncutt-defaults',
  weightsHash: createHash('sha256')
    .update(JSON.stringify(E.PARNCUTT_WEIGHTS))
    .digest('hex')
    .slice(0, 16),
  lintRules: E.LINT_RULES,
  pieces,
};
writeFileSync(values.out, JSON.stringify(dump) + '\n');
process.stdout.write(
  `engine_dump: ${pieces.length} pieces, ${pieces.reduce((s, p) => s + p.notes.length, 0)} notes -> ${values.out}\n`,
);
```

- [ ] **Step 4: Run the tests**

Run: `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests/test_engine_dump.py -q`
Expected: 9 passed (8 if the PIG data is absent).

Then time the full dump, which the real build will run:
`node research/teacher_review/engine_dump.mjs --out C:/Users/maxim/AppData/Local/Temp/dump-check.json --manifest content/manifest.json --tritone --pig-dir research/data/pig --pig-pieces 001,002,003,004,005,006,007,008,009,010,011,012,013,014,015,016,017,018,019,020,021,022,023,024,025,026,027,028,029,030`
Expected: `engine_dump: 90 pieces, 29829 notes`, about 2 to 4 s, and a file of about 11 MB. The note count is 9,802 × 2 + 10,225. Delete the file afterwards.

- [ ] **Step 5: Hand-off**

Paths: `research/teacher_review/engine_dump.mjs`, `research/teacher_review/tests/weekly_fixtures.py`, `research/teacher_review/tests/test_engine_dump.py`. Message: `research(teacher-review): engine dump through the public API for the weekly job`.

---

### Task 2: `musicxml_passages.py`, the library adapter

**Files:**

- Create: `research/teacher_review/musicxml_passages.py`, `research/teacher_review/tests/test_musicxml_passages.py`
- Modify: `research/teacher_review/tests/weekly_fixtures.py` (synthetic library pieces)

**Interfaces:**

- Consumes: dump pieces (Task 1); `model.Event`, `model.Passage`, `model.number_events`; `render.render_passage`, `render.parse_rendering`, `render.dur_label`.
- Produces:

```python
GRACE_Q = Fraction(1, 24)            # renders as "gr"
REST_MIN_Q = Fraction(1, 2)
MAX_BARS = 8
HIDDEN = ("unknown", "piano piece")
LIBRARY_STYLE: dict[str, tuple[str, str]]   # slug -> (composer shown, style shown); no "(" in composers, no ")" in styles
class IrregularWindow(ValueError)
def measure_at(piece: dict, tick: int) -> int                       # last measure whose startTick <= tick, -1 before the first
def regular_anchor(piece: dict, i1: int, i2: int) -> int            # index of the window's first full measure; raises IrregularWindow
def window_ticks(piece: dict, i1: int, i2: int) -> tuple[int, int]  # [startTick of i1, end of i2)
def count_notes(piece: dict, i1: int, i2: int, hand: str) -> int    # notes of the hand with onset in the window (graces count)
def library_window(piece: dict, i1: int, i2: int, hands: list[str], passage_id: str, *, fingers: str = "engine",
                   composer: str | None = None, style: str | None = None, first_bar: int | None = None) -> Passage
def derive_rests(piece: dict) -> list[dict]                         # Python twin of engine_dump.mjs restsOf
def render_round_trips(p: Passage) -> bool
```

`library_window` sets the following in `notes_meta`:

- `bar1_q = 0`, `piece`, and `measures = [i1, i2]`.
- `source` maps passage note id to engine id.
- `engine` maps passage note id to `{"id", "finger", "confidence", "lint": [rule ids]}`.

`first_bar` renumbers the window so that its first full measure is that number. A pickup then gets one less.

- [ ] **Step 1: Add synthetic library pieces to the test helpers**

Append to `research/teacher_review/tests/weekly_fixtures.py`:

```python
DIV = 4  # ticks per quarter in synthetic dumps

LINT_RULES = {"L01": {"title": "Two simultaneous notes share a finger", "law": True},
              "L05": {"title": "Span beyond the practical maximum on keys held together", "law": True},
              "L06": {"title": "Non-thumb crossing", "law": False},
              "L07": {"title": "Uncomfortable span", "law": False},
              "L11": {"title": "Fast hop with the same finger", "law": False},
              "L14": {"title": "Agility", "law": False}}


def nt(onset_q, dur_q, midi, finger, conf=0.95, grace=False, lint=()):
    """One synthetic note; onset in quarters from the start of bar 1 (negative = pickup)."""
    return {"onset": Fraction(onset_q), "dur": Fraction(dur_q), "midi": midi, "finger": finger, "conf": conf,
            "grace": grace, "lint": list(lint)}


def line(start_q, step_q, midis, fingers, conf=0.95):
    step = Fraction(step_q)
    return [nt(Fraction(start_q) + i * step, step, m, f, conf) for i, (m, f) in enumerate(zip(midis, fingers))]


def eighths(bars, conf=None, vary=True, shift=0):
    """RH eighths up and down a five-finger position, 8 per bar, fingers 1-2-3-4-5-4-3-2. With vary,
    each bar moves by (7 * bar) mod 12 semitones so no two bars of a piece are equal. conf maps
    (bar, k) to a confidence."""
    pitches, fingers, out = [60, 62, 64, 65, 67, 65, 64, 62], [1, 2, 3, 4, 5, 4, 3, 2], []
    for b in range(1, bars + 1):
        move = shift + ((7 * b) % 12 if vary else 0)
        for k in range(8):
            out.append(nt(Fraction(4 * (b - 1)) + Fraction(k, 2), Fraction(1, 2), pitches[k] + move, fingers[k],
                          conf=(conf or {}).get((b, k), 0.95)))
    return out


def quarters(bars, conf=None, beats=4):
    out = []
    for b in range(1, bars + 1):
        for k in range(beats):
            out.append(nt(beats * (b - 1) + k, 1, 60 + 2 * k + (b % 5), k + 1, conf=(conf or {}).get((b, k), 0.95)))
    return out


def chords(bars):
    """LH half-note triads (C3-E3-G3, fingers 5-3-1) on beats 1 and 3."""
    return [nt(Fraction(4 * (b - 1) + h * 2), 2, m, f) for b in range(1, bars + 1) for h in (0, 1)
            for m, f in ((48, 5), (52, 3), (55, 1))]


def lib_piece(slug, *, rh=(), lh=(), meter=(4, 4), bars=8, pickup_q=0, level=1, tempo=100, title="Test piece",
              composer="Test Composer", transpose=0, numbers=None, lengths_q=None):
    """A library dump piece shaped like engine_dump.mjs output. Notes are sorted like the engine's
    (onset, R before L, pitch); ids n<k> and sourceIndex k follow the input order (rh, then lh)."""
    beats, beat_type = meter
    bar_q = Fraction(4 * beats, beat_type)
    lengths = [Fraction(x) for x in lengths_q] if lengths_q else \
        ([Fraction(pickup_q)] if pickup_q else []) + [bar_q] * bars
    first = 0 if pickup_q else 1
    nums = list(numbers) if numbers else [str(first + i) for i in range(len(lengths))]
    measures, start = [], 0
    for i, (ln, num) in enumerate(zip(lengths, nums)):
        ticks = int(ln * DIV)
        measures.append({"index": i, "number": num, "startTick": start, "lengthTicks": ticks, "beats": beats,
                         "beatType": beat_type})
        start += ticks
    origin = int(Fraction(pickup_q) * DIV)
    raw = [("R", k, n) for k, n in enumerate(rh)] + [("L", len(rh) + k, n) for k, n in enumerate(lh)]

    def tick(q):
        return origin + int(Fraction(q) * DIV)

    order = sorted(raw, key=lambda x: (tick(x[2]["onset"]), 0 if x[0] == "R" else 1, x[2]["midi"], x[1]))
    qsec = 60 / tempo
    notes = []
    for index, (hand, src, n) in enumerate(order):
        on = tick(n["onset"])
        off = on if n["grace"] else on + int(n["dur"] * DIV)
        mi = max(i for i, m in enumerate(measures) if m["startTick"] <= on)
        notes.append({"index": index, "id": f"n{src}", "hand": hand, "staff": 1 if hand == "R" else 2, "voice": 1,
                      "midi": n["midi"] + transpose, "pitch": "", "onsetTick": on, "offsetTick": off,
                      "onsetSec": on / DIV * qsec, "offsetSec": off / DIV * qsec, "measureIndex": mi,
                      "measure": measures[mi]["number"], "beatQ": (on - measures[mi]["startTick"]) / DIV,
                      "durQ": (off - on) / DIV, "isGrace": n["grace"], "chordId": f"{hand}@{on}", "tied": False,
                      "sourceIndex": src, "finger": n["finger"], "confidence": n["conf"],
                      "gaps": [0 if f == n["finger"] else 1.5 * abs(f - n["finger"]) for f in range(1, 6)],
                      "lint": [f"{r}:warning" for r in n["lint"]]})
    piece = {"id": slug + ("@tritone" if transpose else ""), "source": "library", "slug": slug, "title": title,
             "composer": composer, "level": level, "file": f"content/scores/{slug}.musicxml", "transpose": transpose,
             "divisions": DIV, "tempoMap": [{"tick": 0, "qpm": tempo}], "measures": measures, "notes": notes,
             "rests": [], "solve": []}
    from teacher_review.musicxml_passages import derive_rests
    piece["rests"] = derive_rests(piece)
    return piece


def fake_dump(*pieces):
    return {"version": 1, "engineVersion": "test", "profile": "medium", "weightSet": "parncutt-defaults",
            "weightsHash": "0" * 16, "lintRules": LINT_RULES, "pieces": list(pieces)}
```

- [ ] **Step 2: Write the failing tests**

`research/teacher_review/tests/test_musicxml_passages.py`:

```python
"""musicxml_passages: library windows from the engine dump become Passages with exact bars and beats."""
from __future__ import annotations

import json
import re
from fractions import Fraction

import pytest

from teacher_review.musicxml_passages import (HIDDEN, LIBRARY_STYLE, IrregularWindow, derive_rests, library_window,
                                              measure_at, regular_anchor, render_round_trips)
from teacher_review.render import parse_rendering, render_passage

from .weekly_fixtures import REPO, eighths, lib_piece, line, needs_engine, nt, run_dump


def _rows(p, hand="R"):
    return [ln.split() for ln in render_passage(p).splitlines() if re.match(rf"{hand}\d", ln)]


def test_pickup_is_bar_zero_and_right_aligned():
    # 3/4 with a one-quarter upbeat (Happy Birthday): D4 dotted eighth + D4 sixteenth | E4 D4 G4 | F#4 half
    rh = [nt(-1, Fraction(3, 4), 62, 1), nt(Fraction(-1, 4), Fraction(1, 4), 62, 1), nt(0, 1, 64, 2), nt(1, 1, 62, 1),
          nt(2, 1, 67, 4), nt(3, 2, 66, 3)]
    p = lib_piece("happy", rh=rh, meter=(3, 4), bars=4, pickup_q=1)
    assert [m["number"] for m in p["measures"]] == ["0", "1", "2", "3", "4"]
    w = library_window(p, 0, 2, ["R"], "t-0001", fingers="none")
    assert (w.bar_first, w.bar_last, w.meter) == (0, 2, (3, 4))
    text = render_passage(w)
    assert "R1     0   3     e.    D4              -" in text
    assert "R2     0   3.75  s     D4              -" in text
    assert "R3     1   1     q     E4              -" in text
    assert "R6     2   1     h     F#4             -" in text


def test_compound_meter_upbeat_eighth():
    # 6/8 with an eighth upbeat (Greensleeves): the upbeat sits on beat 2.667 of bar 0
    rh = [nt(Fraction(-1, 2), Fraction(1, 2), 69, 1), nt(0, 1, 72, 2), nt(1, Fraction(1, 2), 74, 3)]
    p = lib_piece("green", rh=rh, meter=(6, 8), bars=2, pickup_q=Fraction(1, 2))
    text = render_passage(library_window(p, 0, 2, ["R"], "t-0002", fingers="none"))
    assert "R1     0   2.667 e     A4              -" in text
    assert "R2     1   1     q     C5              -" in text
    assert "R3     1   1.667 e     D5              -" in text


def test_grace_notes_precede_their_main_note_in_document_order():
    rh = [nt(0, Fraction(3, 2), 74, 5), nt(Fraction(3, 2), 0, 78, 4, grace=True), nt(Fraction(3, 2), Fraction(1, 2), 76, 3),
          nt(2, Fraction(1, 2), 72, 1)]
    p = lib_piece("graces", rh=rh, meter=(6, 8), bars=2)
    # like the engine, the fixture lists the main E5 (76) before the grace F#5 (78)
    assert [n["midi"] for n in p["notes"] if n["onsetTick"] == 6] == [76, 78]
    w = library_window(p, 0, 1, ["R"], "t-0003")
    rows = _rows(w)
    assert rows[1] == ["R2", "1", "2", "gr", "F#5", "4"]
    assert rows[2] == ["R3", "1", "2", "e", "E5", "3"]
    assert (w.notes_meta["source"]["R2"], w.notes_meta["source"]["R3"]) == ("n1", "n2")


def test_chord_takes_its_longest_note_and_rests_mark_silences():
    lh = [nt(0, 2, 48, 5), nt(0, 1, 52, 3), nt(0, 1, 55, 1), nt(3, 1, 43, 5)]
    rh = line(0, 1, [72, 74, 76, 77, 79, 77, 76, 74], [1, 2, 3, 4, 5, 4, 3, 2])
    p = lib_piece("chords", rh=rh, lh=lh, bars=2)
    assert [(r["hand"], r["measure"], r["beatQ"], r["durQ"]) for r in p["rests"]] == [("L", "1", 2.0, 1.0)]
    w = library_window(p, 0, 1, ["L"], "t-0004")
    rows = [ln.split() for ln in render_passage(w).splitlines() if re.match(r"L\d|- ", ln)]
    assert rows[0] == ["L1-3", "1", "1", "h", "C3+E3+G3", "5+3+1"]
    assert rows[1] == ["-", "1", "3", "q", "rest", "-"]
    assert rows[2] == ["L4", "1", "4", "q", "G2", "5"]


def test_window_membership_follows_onset_ticks():
    # a trill termination written at the end of bar 1 sounds on the downbeat of bar 2 (K.545 bars 25 and 70)
    rh = line(0, 1, [60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65, 67, 65, 64, 62], [1, 2, 3, 4, 5, 4, 3, 2] * 2)
    rh.append(nt(4, 0, 59, 1, grace=True))
    p = lib_piece("trill", rh=rh, bars=4)
    grace = next(n for n in p["notes"] if n["isGrace"])
    grace["measureIndex"], grace["measure"], grace["beatQ"] = 0, "1", 4.0   # as the engine reports it
    w = library_window(p, 1, 2, ["R"], "t-0005")
    assert _rows(w)[0][:4] == ["R1", "2", "1", "gr"]
    assert grace["id"] not in library_window(p, 2, 3, ["R"], "t-0006").notes_meta["source"].values()


@pytest.mark.parametrize("numbers,lengths,i1,i2", [
    (["1", "2", "2a", "3"], [4, 4, 1, 3], 0, 3),          # split measure number (Wild Rider 8a)
    (["1", "2", "3", "4"], [4, 2, 4, 4], 0, 3),           # short measure inside (Für Elise bar 8)
    (["1", "2", "4", "5"], [4, 4, 4, 4], 0, 3),           # numbers jump
    (["1", "2", "3", "4"], [4, 4, 4, 4], 1, 1),           # one measure
    (["0", "1", "2", "3"], [5, 4, 4, 4], 0, 3),           # an upbeat longer than a bar
])
def test_irregular_windows_are_refused(numbers, lengths, i1, i2):
    p = lib_piece("irregular", rh=line(0, 1, [60] * 15, [1] * 15), numbers=numbers, lengths_q=lengths)
    with pytest.raises(IrregularWindow):
        regular_anchor(p, i1, i2)


def test_regular_windows_and_their_anchor():
    p = lib_piece("regular", rh=line(0, 1, [60] * 14, [1] * 14), numbers=["1", "2", "3", "4"], lengths_q=[4, 4, 4, 2])
    assert regular_anchor(p, 2, 3) == 2                   # a short last bar may close the window
    up = lib_piece("upbeat", rh=line(-1, 1, [60] * 9, [1] * 9), bars=2, pickup_q=1)
    assert regular_anchor(up, 0, 2) == 1                  # the upbeat may open it
    meter = lib_piece("meter", rh=line(0, 1, [60] * 12, [1] * 12), bars=3)
    meter["measures"][2]["beats"] = 3
    with pytest.raises(IrregularWindow):
        regular_anchor(meter, 0, 2)
    with pytest.raises(IrregularWindow):
        regular_anchor(lib_piece("long", rh=line(0, 1, [60] * 40, [1] * 40), bars=10), 0, 8)


def test_measure_at_and_rests_follow_ticks():
    p = lib_piece("gaps", rh=[nt(0, 1, 60, 1), nt(3, 1, 62, 2), nt(5, Fraction(1, 4), 64, 3), nt(Fraction(23, 4), 1, 65, 4)], bars=2)
    assert [measure_at(p, t) for t in (0, 15, 16, 31)] == [0, 0, 1, 1]
    assert [(r["measure"], r["beatQ"], r["durQ"]) for r in derive_rests(p)] == [
        ("1", 1.0, 2.0), ("2", 0.0, 1.0), ("2", 1.25, 0.5)]


def test_style_table_covers_the_manifest_and_parses():
    manifest = json.loads((REPO / "content" / "manifest.json").read_text(encoding="utf-8"))
    assert {e["slug"] for e in manifest} <= set(LIBRARY_STYLE)
    for composer, style in list(LIBRARY_STYLE.values()) + [HIDDEN]:
        assert composer and style and "(" not in composer and ")" not in style


def test_recall_options_hide_the_composer_and_renumber_bars():
    p = lib_piece("twinkle-twinkle-little-star", rh=line(0, 1, [60, 62, 64, 65] * 4, [1, 2, 3, 4] * 4), bars=4)
    w = library_window(p, 2, 3, ["R"], "t-0007", composer=HIDDEN[0], style=HIDDEN[1], first_bar=1)
    head = render_passage(w).splitlines()[1]
    assert head.startswith("Composer: unknown (piano piece). Meter: 4/4.") and head.endswith("Bars 1-2.")
    assert parse_rendering(render_passage(w)).bar_first == 1
    normal = render_passage(library_window(p, 2, 3, ["R"], "t-0007")).splitlines()[1]
    assert normal.startswith("Composer: Traditional (children's song, arranged).") and normal.endswith("Bars 3-4.")


def test_engine_fingers_only_on_reviewed_hands_with_engine_info():
    rh = [dict(n, lint=["L11"]) if k == 0 else n for k, n in enumerate(eighths(2))]
    p = lib_piece("fingers", rh=rh, lh=[nt(0, 4, 48, 5), nt(4, 4, 43, 5)], bars=2)
    w = library_window(p, 0, 1, ["R"], "t-0008")
    assert all(f > 0 for e in w.sounding("R") for f in e.fingers)
    assert all(f == 0 for e in w.sounding("L") for f in e.fingers)
    assert w.notes_meta["engine"]["R1"] == {"id": "n0", "finger": 1, "confidence": 0.95, "lint": ["L11"]}
    assert w.notes_meta["piece"] == "fingers" and w.notes_meta["measures"] == [0, 1]


def test_render_round_trips_flags_column_overflow():
    # a five-note chord A3+C#4+F#4+A4+D5 fills render.py's 16-character pitch column (Satie bar 36)
    rh = [nt(0, 2, m, f) for m, f in zip([57, 61, 66, 69, 74], [1, 2, 3, 4, 5])] + line(2, 1, [74, 73], [5, 4]) \
        + line(4, 1, [69, 71, 73, 74], [1, 2, 3, 4])
    w = library_window(lib_piece("satie-like", rh=rh, bars=2), 0, 1, ["R"], "t-0009")
    assert render_round_trips(w) is False
    ok = library_window(lib_piece("plain", rh=eighths(2), bars=2), 0, 1, ["R"], "t-0010")
    assert render_round_trips(ok) is True


# ---- against the real library (needs node and the engine build) -------------------------------

@pytest.fixture(scope="module")
def library(tmp_path_factory):
    out = tmp_path_factory.mktemp("lib") / "library.json"
    r = run_dump(out, "--manifest", "content/manifest.json")
    assert r.returncode == 0, r.stderr
    return {p["id"]: p for p in json.loads(out.read_text(encoding="utf-8"))["pieces"]}


def _expected_bar_beat(p, tick):
    mi = measure_at(p, tick)
    m = p["measures"][mi]
    beats, beat_type = m["beats"], m["beatType"]
    beat_q = Fraction(3, 2) if beat_type == 8 and beats % 3 == 0 and beats >= 6 else Fraction(4, beat_type)
    offset = Fraction(tick - m["startTick"], p["divisions"])
    nominal = Fraction(p["divisions"] * 4 * beats, beat_type)
    if mi == 0 and m["lengthTicks"] < nominal:
        offset += Fraction(nominal - m["lengthTicks"], p["divisions"])     # an upbeat is right-aligned
    return m["number"], offset / beat_q + 1


@needs_engine
def test_dump_rests_match_the_python_rule(library):
    for p in library.values():
        assert p["rests"] == derive_rests(p), p["id"]


@needs_engine
def test_every_regular_window_of_the_library_round_trips(library):
    clean = overflow = 0
    for p in library.values():
        notes = {n["id"]: n for n in p["notes"]}
        for i1 in range(len(p["measures"]) - 3):
            try:
                regular_anchor(p, i1, i1 + 3)
            except IrregularWindow:
                continue
            w = library_window(p, i1, i1 + 3, ["R", "L"], "t-0011")
            if not render_round_trips(w):
                overflow += 1
                continue
            clean += 1
            for evs in w.events.values():
                for e in evs:
                    if e.is_rest:
                        continue
                    bar, beat = w.bar_beat(e.onset_q)
                    for sid in e.source_ids:
                        assert (str(bar), beat) == _expected_bar_beat(p, notes[sid]["onsetTick"]), (p["id"], i1, sid)
    # measured while writing the plan: 779 regular four-bar windows, 10 of them overflow render.py's columns
    assert (clean, overflow) == (769, 10)


@needs_engine
def test_real_scores_render_as_on_the_page(library):
    hb = render_passage(library_window(library["happy-birthday"], 0, 2, ["R"], "t-0012", fingers="none"))
    assert "R1     0   3     e.    D4              -" in hb and "L1-2   1   1     h.    G2+D3           -" in hb
    pastorale = _rows(library_window(library["burgmuller-op100-no3-pastorale"], 2, 4, ["R"], "t-0013", fingers="none"))
    assert pastorale[3][:5] == ["R4", "3", "2.667", "gr", "F#5"] and pastorale[4][:5] == ["R5", "3", "2.667", "e", "E5"]
    assert [r[3] for r in pastorale[10:13]] == ["gr", "gr", "e"]
    waltz = render_passage(library_window(library["chopin-waltz-op69-no2"], 13, 15, ["L"], "t-0014", fingers="none"))
    assert "-      14  3     q     rest            -" in waltz
```

Run: `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests/test_musicxml_passages.py -q`
Expected: FAIL (`ModuleNotFoundError: teacher_review.musicxml_passages`).

- [ ] **Step 3: Write the adapter**

`research/teacher_review/musicxml_passages.py`:

```python
"""Library adapter: one engine-dump piece (engine_dump.mjs) -> Passage windows with exact bars and beats.

A window is a run of 2 to 8 regular measures: plain numeric, consecutive numbers, one meter, and the
nominal length, except an upbeat (measure index 0) opening the window or a short last measure of the
piece closing it. Notes and rests belong to the window by onset tick, so a grace note written at the
end of a bar (a trill termination: Mozart K.545 bars 25 and 70) is shown on the next downbeat, where it
sounds. Bars and beats come from ticks: the window's first full measure is the anchor, and an upbeat bar
is numbered one less and right-aligned, as on the page. Chords take their longest note (as the PIG
adapter does); grace notes are separate "gr" events before their main note, in document order.
"""
from __future__ import annotations

import bisect
import re
from fractions import Fraction

from .model import Event, Passage, number_events
from .render import dur_label, parse_rendering, render_passage

GRACE_Q = Fraction(1, 24)
REST_MIN_Q = Fraction(1, 2)
MAX_BARS = 8
HIDDEN = ("unknown", "piano piece")

# What the reviewer sees instead of the title: a surname and a genre word (as in the pilot, which showed
# "Mozart (sonata, first movement)"). No "(" in a composer, no ")" in a style: render.py's header parser.
LIBRARY_STYLE: dict[str, tuple[str, str]] = {
    "twinkle-twinkle-little-star": ("Traditional", "children's song, arranged"),
    "mary-had-a-little-lamb": ("Traditional", "children's song, arranged"),
    "ode-to-joy": ("Beethoven", "symphonic theme, simplified"),
    "frere-jacques": ("Traditional", "round, arranged"),
    "jingle-bells": ("Pierpont", "song, arranged"),
    "happy-birthday": ("Hill", "song, arranged"),
    "amazing-grace": ("Traditional", "hymn, arranged"),
    "scarborough-fair": ("Traditional", "folk song, arranged"),
    "greensleeves": ("Traditional", "folk song, arranged"),
    "pachelbel-canon-in-d": ("Pachelbel", "canon, simplified"),
    "bach-minuet-g-major-bwv-anh-114": ("Petzold", "minuet"),
    "bach-minuet-g-minor-bwv-anh-115": ("Petzold", "minuet"),
    "mozart-minuet-f-major-k2": ("Mozart", "minuet"),
    "schumann-op68-no1-melody": ("Schumann", "character piece for children"),
    "burgmuller-op100-no1-la-candeur": ("Burgmüller", "study"),
    "burgmuller-op100-no2-arabesque": ("Burgmüller", "study"),
    "burgmuller-op100-no3-pastorale": ("Burgmüller", "study"),
    "burgmuller-op100-no5-innocence": ("Burgmüller", "study"),
    "schumann-op68-no8-wild-rider": ("Schumann", "character piece for children"),
    "clementi-sonatina-op36-no1-mvt1": ("Clementi", "sonatina, first movement"),
    "bach-prelude-c-major-bwv-846": ("Bach", "prelude"),
    "satie-gymnopedie-no1": ("Satie", "slow dance"),
    "beethoven-fur-elise-woo-59": ("Beethoven", "bagatelle"),
    "mozart-sonata-k545-mvt1": ("Mozart", "sonata, first movement"),
    "chopin-prelude-op28-no7": ("Chopin", "prelude"),
    "chopin-prelude-op28-no4": ("Chopin", "prelude"),
    "bach-invention-no1-bwv-772": ("Bach", "two-part invention"),
    "joplin-the-entertainer": ("Joplin", "rag"),
    "beethoven-moonlight-sonata-mvt1": ("Beethoven", "sonata, first movement"),
    "chopin-waltz-op69-no2": ("Chopin", "waltz"),
}


class IrregularWindow(ValueError):
    """The measures cannot be shown with constant bar arithmetic (render.py's Passage model)."""


def _nominal(piece: dict, m: dict) -> Fraction:
    return Fraction(piece["divisions"] * 4 * m["beats"], m["beatType"])


def measure_at(piece: dict, tick: int) -> int:
    return bisect.bisect_right([m["startTick"] for m in piece["measures"]], tick) - 1


def window_ticks(piece: dict, i1: int, i2: int) -> tuple[int, int]:
    ms = piece["measures"]
    return ms[i1]["startTick"], ms[i2]["startTick"] + ms[i2]["lengthTicks"]


def regular_anchor(piece: dict, i1: int, i2: int) -> int:
    ms = piece["measures"]
    if not 0 <= i1 < i2 < len(ms):
        raise IrregularWindow(f"measures {i1}..{i2}: a window has at least two measures of the piece")
    if i2 - i1 + 1 > MAX_BARS:
        raise IrregularWindow(f"{i2 - i1 + 1} measures; at most {MAX_BARS}")
    if len({(ms[i]["beats"], ms[i]["beatType"]) for i in range(i1, i2 + 1)}) != 1:
        raise IrregularWindow("the meter changes inside the window")
    anchor, prev = None, None
    for i in range(i1, i2 + 1):
        m = ms[i]
        if not m["number"].isdigit():
            raise IrregularWindow(f"measure number {m['number']!r} is not a plain number")
        num = int(m["number"])
        if prev is not None and num != prev + 1:
            raise IrregularWindow(f"measure numbers jump from {prev} to {num}")
        prev = num
        nominal = _nominal(piece, m)
        if m["lengthTicks"] == nominal:
            anchor = i if anchor is None else anchor
        elif not (m["lengthTicks"] < nominal and ((i == i1 == 0) or (i == i2 == len(ms) - 1))):
            raise IrregularWindow(f"measure {m['number']} has {m['lengthTicks']} ticks, not {nominal}")
    if anchor is None:
        raise IrregularWindow("no full measure in the window")
    return anchor


def count_notes(piece: dict, i1: int, i2: int, hand: str) -> int:
    t1, t2 = window_ticks(piece, i1, i2)
    return sum(1 for n in piece["notes"] if n["hand"] == hand and t1 <= n["onsetTick"] < t2)


def _tempo_at(piece: dict, tick: int) -> int:
    qpm = 120.0
    for ev in sorted(piece.get("tempoMap") or [], key=lambda e: e["tick"]):
        if ev["tick"] <= tick:
            qpm = ev["qpm"]
    return int(round(qpm))


def _seconds(piece: dict, tick: int) -> float:
    tempo = sorted(piece.get("tempoMap") or [{"tick": 0, "qpm": 120}], key=lambda e: e["tick"])
    sec, cursor, qpm = 0.0, 0, tempo[0]["qpm"] if tempo[0]["tick"] <= 0 else 120
    for ev in tempo:
        if ev["tick"] >= tick:
            break
        sec += (ev["tick"] - cursor) / piece["divisions"] * 60 / qpm
        cursor, qpm = ev["tick"], ev["qpm"]
    return sec + (tick - cursor) / piece["divisions"] * 60 / qpm


def _fallback_composer(piece: dict) -> str:
    words = re.sub(r"\s*\(.*?\)", "", piece.get("composer") or "").split()
    return words[-1] if words else HIDDEN[0]


def _hand_events(piece: dict, hand: str, t1: int, t2: int, q, show: bool) -> list[Event]:
    div = piece["divisions"]
    keyed: list[tuple[tuple, Event]] = []
    by_tick: dict[int, list[dict]] = {}
    for n in piece["notes"]:
        if n["hand"] == hand and t1 <= n["onsetTick"] < t2:
            by_tick.setdefault(n["onsetTick"], []).append(n)
    for tick, group in by_tick.items():
        graces = sorted((n for n in group if n["isGrace"]), key=lambda n: n["sourceIndex"])
        for k, g in enumerate(graces):
            keyed.append(((q(tick), 1, k), Event(hand, q(tick), g["onsetSec"], GRACE_Q, [g["midi"]],
                                                 [g["finger"] if show else 0], [], [g["id"]])))
        mains = sorted((n for n in group if not n["isGrace"]), key=lambda n: n["midi"])
        if mains:
            dur = max(Fraction(n["offsetTick"] - n["onsetTick"], div) for n in mains)
            keyed.append(((q(tick), 2, 0), Event(hand, q(tick), min(n["onsetSec"] for n in mains), dur,
                                                 [n["midi"] for n in mains],
                                                 [n["finger"] if show else 0 for n in mains], [],
                                                 [n["id"] for n in mains])))
    for r in piece["rests"]:
        if r["hand"] == hand and t1 <= r["startTick"] < t2:
            end = min(r["endTick"], t2)
            keyed.append(((q(r["startTick"]), 0, 0), Event(hand, q(r["startTick"]), _seconds(piece, r["startTick"]),
                                                          Fraction(end - r["startTick"], div))))
    keyed.sort(key=lambda kv: kv[0])
    evs = [e for _, e in keyed]
    while evs and evs[0].is_rest:
        evs.pop(0)
    while evs and evs[-1].is_rest:
        evs.pop()
    return evs


def library_window(piece: dict, i1: int, i2: int, hands: list[str], passage_id: str, *, fingers: str = "engine",
                   composer: str | None = None, style: str | None = None, first_bar: int | None = None) -> Passage:
    anchor = regular_anchor(piece, i1, i2)
    ms, div = piece["measures"], piece["divisions"]
    a = ms[anchor]
    bar_q = Fraction(4 * a["beats"], a["beatType"])
    shift = 0 if first_bar is None else first_bar - int(a["number"])
    n_anchor = int(a["number"]) + shift
    origin = a["startTick"]
    t1, t2 = window_ticks(piece, i1, i2)

    def q(tick: int) -> Fraction:
        return Fraction(tick - origin, div) + (n_anchor - 1) * bar_q

    default = LIBRARY_STYLE.get(piece.get("slug", piece["id"]), (_fallback_composer(piece), HIDDEN[1]))
    p = Passage(passage_id=passage_id, composer=composer or default[0], style=style or default[1],
                meter=(a["beats"], a["beatType"]), tempo_qpm=_tempo_at(piece, t1),
                bar_first=int(ms[i1]["number"]) + shift, bar_last=int(ms[i2]["number"]) + shift,
                target_hands=list(hands))
    p.notes_meta.update({"bar1_q": 0, "piece": piece["id"], "measures": [i1, i2], "source": {}, "engine": {}})
    for hand in ("R", "L"):
        evs = _hand_events(piece, hand, t1, t2, q, show=(fingers == "engine" and hand in hands))
        if not evs:
            continue
        numbered = number_events(evs, hand)
        for e in numbered:
            for nid, sid in zip(e.ids, e.source_ids):
                p.notes_meta["source"][nid] = sid
        p.events[hand] = numbered
    by_id = {n["id"]: n for n in piece["notes"]}
    for nid, sid in p.notes_meta["source"].items():
        n = by_id[sid]
        p.notes_meta["engine"][nid] = {"id": sid, "finger": n["finger"], "confidence": n["confidence"],
                                       "lint": sorted({x.split(":")[0] for x in n["lint"]})}
    return p


def derive_rests(piece: dict) -> list[dict]:
    """The rests engine_dump.mjs writes, recomputed: silences of an eighth or more per hand (R, then L)."""
    out, div = [], piece["divisions"]
    for hand in ("R", "L"):
        until = None
        notes = sorted((n for n in piece["notes"] if n["hand"] == hand and not n["isGrace"]),
                       key=lambda n: (n["onsetTick"], n["midi"]))
        for n in notes:
            if until is not None and Fraction(n["onsetTick"] - until, div) >= REST_MIN_Q:
                mi = measure_at(piece, until)
                m = piece["measures"][mi] if mi >= 0 else None
                out.append({"hand": hand, "startTick": until, "endTick": n["onsetTick"], "measureIndex": mi,
                            "measure": m["number"] if m else None,
                            "beatQ": (until - m["startTick"]) / div if m else None,
                            "durQ": (n["onsetTick"] - until) / div})
            until = n["offsetTick"] if until is None else max(until, n["offsetTick"])
    return out


def _rows(p: Passage, hand: str, fingers: bool) -> list[tuple]:
    return [(e.onset_q, dur_label(e.dur_q), tuple(e.pitches), tuple(e.fingers) if fingers and not e.is_rest else ())
            for e in p.events.get(hand, [])]


def render_round_trips(p: Passage) -> bool:
    """True when render_passage(p) parses back to the same events. render.py's fixed columns merge
    when a chord's pitch list reaches 16 characters or an id range 7 (Satie bar 36: A3+C#4+F#4+A4+D5);
    such a passage cannot be shown and is skipped by the selection."""
    try:
        back = parse_rendering(render_passage(p))
    except (ValueError, KeyError, IndexError, AssertionError):
        return False
    if back.target_hands != list(p.target_hands) or (back.bar_first, back.bar_last) != (p.bar_first, p.bar_last):
        return False
    return all(_rows(back, h, h in p.target_hands) == _rows(p, h, h in p.target_hands) for h in ("R", "L"))
```

- [ ] **Step 4: Run the tests**

Run: `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests -q`
Expected: every test passes. That is the 36 pilot tests, Task 1's 9 and this task's 19 (the five parametrised cases count separately). The three library tests take a few seconds. If `test_every_regular_window_of_the_library_round_trips` reports counts other than `(769, 10)`, find the cause (an upbeat or short-bar rule, the overflow guard) before touching the assertion.

- [ ] **Step 5: Hand-off**

Paths: `research/teacher_review/musicxml_passages.py`, `research/teacher_review/tests/test_musicxml_passages.py`, `research/teacher_review/tests/weekly_fixtures.py`. Message: `research(teacher-review): library adapter with exact bars, beats, graces and rests`.

---

### Task 3: `gallery.py`, bench galleries and PIG passages with the engine's fingers

**Files:**

- Create: `research/teacher_review/gallery.py`, `research/teacher_review/tests/test_gallery.py`
- Modify: `research/teacher_review/tests/weekly_fixtures.py` (synthetic PIG pieces and gallery pages)

**Interfaces:**

- Consumes: the gallery page format (Interfaces section); `pig_passages.PieceData`, `pig_passages.Grid`, `pig_passages.extract_window`, `pig_passages.build_piece`; dump PIG pieces (Task 1).
- Produces:

```python
@dataclass(frozen=True)
class GalleryRow:
    piece: str; index: int; bar: str; onset_s: float; hand: str; pitch: str
    engine_finger: int | None; confidence: float | None; annotators: tuple[int | None, ...]; hard: bool
def parse_page(piece: str, text: str) -> list[GalleryRow]
def read_gallery(directory: Path) -> dict[str, list[GalleryRow]]       # pages named NNN.md only, by name
def slot_of(dump_piece: dict) -> str                                    # "001-1_fingering.txt" -> "1"
def check_against_dump(rows: dict[str, list[GalleryRow]], dump: dict) -> list[str]
def pig_engine_window(piece: PieceData, b1: int, b2: int, hands: list[str], passage_id: str, dump_piece: dict) -> Passage
```

- [ ] **Step 1: Add synthetic PIG helpers**

Append to `research/teacher_review/tests/weekly_fixtures.py`:

```python
def pig_piece(piece_id, rh, lh=(), meter=(4, 4), bars=8, tempo=120, composer="Bach", style="two-part invention"):
    """A PieceData like pig_passages.build_piece's, from (onset_q, dur_q, midi) single notes. Note ids are
    "0", "1", ... in the engine's order (onset, R before L, pitch), as PIG files number them."""
    from teacher_review.model import Event, number_events
    from teacher_review.pig_passages import Grid, PieceData
    qsec = 60 / tempo
    raw = sorted([("R", Fraction(o), Fraction(d), m) for o, d, m in rh] + [("L", Fraction(o), Fraction(d), m) for o, d, m in lh],
                 key=lambda x: (x[1], 0 if x[0] == "R" else 1, x[3]))
    ids = {k: str(i) for i, k in enumerate(raw)}
    events = {}
    for hand in ("R", "L"):
        evs = [Event(hand, o, float(o) * qsec, d, [m], [0], [], [ids[(h, o, d, m)]]) for (h, o, d, m) in raw if h == hand]
        if evs:
            events[hand] = number_events(evs, hand)
    grid = Grid(quarter_s=qsec, bar1_s=0.0, tempo_qpm=tempo, residual=0.0, align=1.0, mode_ioi=qsec,
                quarter_from_bars=qsec, implied_bars=float(bars))
    return PieceData(piece_id=piece_id, composer=composer, title="Test", bars=bars, meter=meter, style=style, grid=grid,
                     annotation="1", annotators={"1": "XX"}, events=events, all_fingers={}, fhmm3={},
                     source_hand={ids[k]: k[0] for k in raw})


def pig_dump_piece(piece_id, piece, fingers, conf=0.5):
    """The dump entry engine_dump.mjs would write for that PieceData with the given engine fingers."""
    from teacher_review.model import pitch_name
    rows = []
    for hand, evs in piece.events.items():
        for e in evs:
            for sid, midi in zip(e.source_ids, e.pitches):
                rows.append((int(sid), {"id": sid, "hand": hand, "midi": midi, "pitch": pitch_name(midi),
                                        "onsetSec": e.onset_s, "isGrace": False, "finger": fingers[sid],
                                        "confidence": conf, "gaps": [0 if f == fingers[sid] else 1.0 for f in range(1, 6)],
                                        "lint": []}))
    notes = [dict(n, index=i) for i, (_, n) in enumerate(sorted(rows, key=lambda r: r[0]))]
    return {"id": f"pig:{piece_id}", "source": "pig", "pigId": piece_id, "file": f"{piece_id}-1_fingering.txt",
            "transpose": 0, "divisions": 480, "tempoMap": [], "measures": [], "notes": notes, "rests": [], "solve": []}


def gallery_page(piece_id, rows):
    """A page in bench.ts's format; rows are (index, hand, pitch, engine finger, confidence %, annotators, hard)."""
    head = [f"# Piece {piece_id}", "",
            "gen 50.00 high 60.00 soft 70.00 rec 65.00 hard-error 25.00 notes 40 annotators 3", "",
            "Context: two notes of the same hand on each side as pitch:engine finger, the note itself in brackets.", "",
            "| # | bar | onset s | hand | pitch | context | engine (confidence) top terms | runner-up | annotators | why not | hard |",
            "|---|---|---|---|---|---|---|---|---|---|---|"]
    body = [f"| {i} | - | {i * 0.25:.2f} | {h} | {p} | x:1 [{p}] y:2 | {f} ({c}%) hop 12.0 | 3 +0.4 | "
            f"{' '.join('-' if a is None else str(a) for a in ann)} | 3: +0.4 | {'hard' if hard else ''} |"
            for i, h, p, f, c, ann, hard in rows]
    return "\n".join(head + body) + "\n"
```

- [ ] **Step 2: Write the failing tests**

`research/teacher_review/tests/test_gallery.py`:

```python
"""gallery: bench error galleries, their agreement with the dump, PIG passages with engine fingers."""
from __future__ import annotations

import json

import pytest

from teacher_review.gallery import check_against_dump, parse_page, pig_engine_window, read_gallery, slot_of
from teacher_review.pig_passages import build_piece

from .weekly_fixtures import (fake_dump, gallery_page, needs_engine, needs_pig, pig_dump_piece, pig_piece, run_dump)


def test_read_gallery_reads_rows_and_hard_flags(tmp_path):
    rows = [(5, "R", "E4", 2, 41, [3, 3, 3], True), (7, "R", "G4", 5, 88, [5, 4, 5], False),
            (12, "L", "C3", 5, 55, [4, 4, 4], True)]
    (tmp_path / "900.md").write_text(gallery_page("900", rows), encoding="utf-8")
    (tmp_path / "notes.md").write_text("not a page", encoding="utf-8")
    g = read_gallery(tmp_path)
    assert list(g) == ["900"]
    assert [(r.index, r.hand, r.pitch, r.engine_finger, r.annotators, r.hard) for r in g["900"]] == [
        (5, "R", "E4", 2, (3, 3, 3), True), (7, "R", "G4", 5, (5, 4, 5), False), (12, "L", "C3", 5, (4, 4, 4), True)]
    assert (g["900"][0].confidence, g["900"][0].onset_s, g["900"][0].bar) == (0.41, 1.25, "-")


def test_parse_page_reads_bench_rows_verbatim():
    bench_row = ("| 12 | - | 3.00 | L | C3 | E3:3 D3:4 [C3] B2:1 A2:2 | 5 (55%) thumbPassing 2.0 | - | 4 4 4 "
                 "| 4: held note 9 (+1.5) | hard |")
    (row,) = parse_page("901", bench_row + "\n")
    assert (row.index, row.engine_finger, row.annotators, row.hard) == (12, 5, (4, 4, 4), True)
    unfingered = "| 3 | - | 0.50 | R | D4 | C4:1 [D4] E4:3 | - (0%) no cost | - | 2 - 2 | 2: +1.0 |  |"
    (row,) = parse_page("901", unfingered + "\n")
    assert row.engine_finger is None and row.annotators == (2, None, 2) and not row.hard


def test_gallery_and_dump_must_agree():
    piece = pig_piece("900", rh=[(i * 0.5, 0.5, 60 + i) for i in range(16)])
    fingers = {str(i): (i % 5) + 1 for i in range(16)}
    dump = fake_dump(pig_dump_piece("900", piece, fingers))
    good = {"900": parse_page("900", gallery_page("900", [(5, "R", "F4", 1, 40, [3, 3, 3], True)]))}
    assert check_against_dump(good, dump) == []
    bad = {"900": parse_page("900", gallery_page("900", [(5, "R", "F4", 4, 40, [3, 3, 3], True),
                                                         (99, "R", "C4", 1, 40, [2, 2, 2], True)]))}
    assert check_against_dump(bad, dump) == ["900 #5: gallery engine finger 4, dump 1", "900 #99: no such note in the dump"]
    missing = {"901": parse_page("901", gallery_page("901", [(1, "R", "C4", 1, 40, [2, 2], True)]))}
    assert check_against_dump(missing, dump) == ["901: the dump has no PIG piece 901"]
    assert slot_of(dump["pieces"][0]) == "1"


def test_pig_engine_window_sets_engine_fingers_on_reviewed_hands_only():
    rh = [(i * 0.5, 0.5, 60 + (i % 8)) for i in range(32)]
    lh = [(i * 2, 2, 48) for i in range(8)]
    piece = pig_piece("902", rh, lh)
    dp = pig_dump_piece("902", piece, {sid: 3 for sid in piece.source_hand})
    p = pig_engine_window(piece, 2, 3, ["R"], "t-0100", dp)
    assert (p.bar_first, p.bar_last, p.target_hands) == (2, 3, ["R"])
    assert len(p.notes("R")) == 16 and set(p.finger_map("R").values()) == {3}
    assert all(f == 0 for e in p.sounding("L") for f in e.fingers)
    assert p.notes_meta["engine"]["R1"] == {"id": p.notes_meta["source"]["R1"], "finger": 3, "confidence": 0.5, "lint": []}
    del dp["notes"][5]                 # note "5" sounds in bar 1
    with pytest.raises(KeyError):
        pig_engine_window(piece, 1, 2, ["R"], "t-0101", dp)


@needs_pig
@needs_engine
def test_build_piece_and_dump_share_note_ids(tmp_path):
    out = tmp_path / "pig.json"
    assert run_dump(out, "--pig-dir", "research/data/pig", "--pig-pieces", "001").returncode == 0
    (dp,) = json.loads(out.read_text(encoding="utf-8"))["pieces"]
    piece = build_piece("001", slot_of(dp))
    hand_of = {sid: hand for hand, evs in piece.events.items() for e in evs for sid in e.source_ids}
    assert set(hand_of) == {n["id"] for n in dp["notes"]}
    assert all(hand_of[n["id"]] == n["hand"] for n in dp["notes"])
```

Run: `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests/test_gallery.py -q`
Expected: FAIL (`ModuleNotFoundError: teacher_review.gallery`).

- [ ] **Step 3: Write `gallery.py`**

```python
"""Bench error galleries (written by packages/engine/cli/bench.ts) and PIG passages carrying the engine's fingers.

A gallery page benchmarks/errors/<label>/<piece>.md lists every note where the engine differs from at
least one annotator; '#' is the index into parsePig(<first gold file in name order>).score.notes, which
engine_dump.mjs reproduces, and 'hard' marks notes where every annotator (two or more) agrees and the
engine differs. PIG-derived: everything read here stays under research/data/.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .model import Passage
from .pig_passages import PieceData, extract_window

_ENGINE = re.compile(r"^(?P<f>[1-5]|-)\s*\((?P<c>\d+)%\)")
_PAGE = re.compile(r"^\d{3}$")


@dataclass(frozen=True)
class GalleryRow:
    piece: str
    index: int
    bar: str
    onset_s: float
    hand: str
    pitch: str
    engine_finger: int | None
    confidence: float | None
    annotators: tuple[int | None, ...]
    hard: bool


def parse_page(piece: str, text: str) -> list[GalleryRow]:
    rows = []
    for line in text.splitlines():
        if not line.startswith("| ") or line.startswith("| #"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 11 or not cells[0].isdigit():
            continue
        m = _ENGINE.match(cells[6])
        rows.append(GalleryRow(piece=piece, index=int(cells[0]), bar=cells[1], onset_s=float(cells[2]), hand=cells[3],
                               pitch=cells[4], engine_finger=int(m["f"]) if m and m["f"] != "-" else None,
                               confidence=int(m["c"]) / 100 if m else None,
                               annotators=tuple(None if a == "-" else int(a) for a in cells[8].split()),
                               hard=cells[10] == "hard"))
    return rows


def read_gallery(directory: Path) -> dict[str, list[GalleryRow]]:
    out: dict[str, list[GalleryRow]] = {}
    for page in sorted(Path(directory).glob("*.md")):
        if _PAGE.match(page.stem):
            out[page.stem] = parse_page(page.stem, page.read_text(encoding="utf-8"))
    return out


def slot_of(dump_piece: dict) -> str:
    return dump_piece["file"].split("-", 1)[1].split("_", 1)[0]


def check_against_dump(rows: dict[str, list[GalleryRow]], dump: dict) -> list[str]:
    """Every hard row must name the dump's note: same hand, pitch and engine finger. A mismatch means the
    gallery came from another engine build, profile or weight set."""
    pig = {p["pigId"]: p for p in dump["pieces"] if p["source"] == "pig"}
    problems = []
    for piece, rs in sorted(rows.items()):
        hard = [r for r in rs if r.hard]
        if not hard:
            continue
        if piece not in pig:
            problems.append(f"{piece}: the dump has no PIG piece {piece}")
            continue
        notes = pig[piece]["notes"]
        for r in hard:
            if not 0 <= r.index < len(notes):
                problems.append(f"{piece} #{r.index}: no such note in the dump")
                continue
            n = notes[r.index]
            for field, g, d in (("hand", r.hand, n["hand"]), ("pitch", r.pitch, n["pitch"]),
                                ("engine finger", r.engine_finger, n["finger"])):
                if g != d:
                    problems.append(f"{piece} #{r.index}: gallery {field} {g!r}, dump {d!r}")
    return problems


def pig_engine_window(piece: PieceData, b1: int, b2: int, hands: list[str], passage_id: str,
                      dump_piece: dict) -> Passage:
    """extract_window(fingers="none"), then the engine's fingers (by PIG note id) on the reviewed hands."""
    p = extract_window(piece, b1, b2, hands, passage_id, fingers="none")
    by_id = {n["id"]: n for n in dump_piece["notes"]}
    p.notes_meta["engine"] = {}
    for hand in hands:
        for e in p.sounding(hand):
            e.fingers = [by_id[sid]["finger"] for sid in e.source_ids]
            for nid, sid in zip(e.ids, e.source_ids):
                n = by_id[sid]
                p.notes_meta["engine"][nid] = {"id": sid, "finger": n["finger"], "confidence": n["confidence"],
                                               "lint": sorted({x.split(":")[0] for x in n["lint"]})}
    return p
```

- [ ] **Step 4: Run the tests**

Run: `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests -q`
Expected: all pass. That is Task 3's 5 tests, with the PIG integration test skipped only without PIG data.

- [ ] **Step 5: Hand-off**

Paths: `research/teacher_review/gallery.py`, `research/teacher_review/tests/test_gallery.py`, `research/teacher_review/tests/weekly_fixtures.py`. Message: `research(teacher-review): bench gallery reader and PIG passages with engine fingers`.

---

### Task 4: `select.py`, the five sets

**Files:**

- Create: `research/teacher_review/select.py`, `research/teacher_review/tests/test_select.py`

**Interfaces:**

- Consumes: Tasks 1 to 3; `inject.inject_faults`, `inject.LINE_IOI_S`; `build_benchmark.USABLE`; `pig_passages.build_piece`.
- Produces:

```python
N_LOWCONF, PER_PIECE_LOWCONF, N_HARDERR, N_CONTROL, N_RECALL, N_PLANTED = 20, 2, 16, 10, 4, 4
MIN_NOTES, TARGET_NOTES, MAX_NOTES, MAX_PASSAGE_NOTES = 10, 16, 48, 96
CONTROL_LEVELS = (1, 2, 3); HARD_BARS = (2, 4)
USABLE_PIG: set[str]                                                    # flattened build_benchmark.USABLE
def select_lowconf(library: list[dict], seed: int, n: int = N_LOWCONF) -> list[dict]
def select_harderr(pig: dict[str, dict], rows: dict[str, list[GalleryRow]], *, loader=build_piece,
                   usable: set[str] = USABLE_PIG, cap: int = N_HARDERR) -> tuple[list[dict], dict]
def select_controls(library: list[dict], lowconf: list[dict], seed: int, n: int = N_CONTROL) -> list[dict]
def plant_and_twin(controls: list[dict], by_id: dict[str, dict], seed: int) -> tuple[list[dict], list[dict]]
def select_all(dump: dict, rows: dict[str, list[GalleryRow]], seed: int, *, loader=build_piece,
               usable: set[str] = USABLE_PIG) -> dict              # {"seed", "records", "counts", "skipped"}
def build_passages(records: list[dict], dump: dict, *, loader=build_piece) -> dict[str, Passage]
```

Every record has these fields:

- `passage`: `lc01…`, `he01…`, `ct01…`, `pf01…` or `rc01…`.
- `set`: `lowconf`, `harderr`, `control`, `planted` or `recall`.
- `source`: `library` or `pig`.
- `piece`: the dump piece id.
- `hands`.

Library records also carry `slug`, `title`, `level` and `measures: [i1, i2]`. PIG records carry `pig`, `slot`, `bars: [b1, b2]` and `hard: {pig note id: annotators' finger}`. `lowconf` adds `seed_note` (passage note id) and `seed_confidence`. `planted` and `recall` carry `twin_of`. `planted` adds `faults` (`Fault.as_dict()` list) and `recall` adds `transpose`. Each selector numbers its own records (`lc01…`, `he01…`, `ct01…`, `pf01…`, `rc01…`). `select_all` concatenates them in set order lowconf, harderr, control, planted, recall.

- [ ] **Step 1: Write the failing tests**

`research/teacher_review/tests/test_select.py`:

```python
"""select: the five sets of the weekly review."""
from __future__ import annotations

from collections import Counter
from fractions import Fraction
from itertools import combinations

from teacher_review.gallery import parse_page
from teacher_review.musicxml_passages import library_window
from teacher_review.render import render_passage
from teacher_review.select import (build_passages, plant_and_twin, select_all, select_controls, select_harderr,
                                   select_lowconf)

from .weekly_fixtures import (chords, eighths, fake_dump, gallery_page, lib_piece, nt, pig_dump_piece, pig_piece,
                              quarters)


def test_lowconf_takes_the_lowest_seeds_two_per_piece_without_overlap():
    a = lib_piece("piece-a", rh=eighths(16, conf={(5, 0): 0.2, (12, 0): 0.25, (9, 0): 0.3}), bars=16, level=4)
    b = lib_piece("piece-b", rh=quarters(8, conf={(3, 0): 0.22}), bars=8, level=2)
    c = lib_piece("piece-c", lh=[nt(4 * i, 2, 48, 5, conf=0.1) for i in range(8)], bars=8, level=1)   # 2.4 s apart
    first3 = select_lowconf([a, b, c], seed=7, n=3)
    assert [(r["piece"], r["measures"], r["hands"]) for r in first3] == [
        ("piece-a", [4, 5], ["R"]), ("piece-b", [1, 4], ["R"]), ("piece-a", [11, 12], ["R"])]
    assert (first3[0]["seed_note"], first3[0]["seed_confidence"]) == ("R1", 0.2)
    full = select_lowconf([a, b, c], seed=7)
    assert Counter(r["piece"] for r in full) == {"piece-a": 2, "piece-b": 2}
    for x, y in combinations([r for r in full if r["piece"] == "piece-b"], 2):
        assert x["measures"][1] < y["measures"][0] or y["measures"][1] < x["measures"][0]
    assert select_lowconf([a, b, c], seed=7) == full


def test_lowconf_skips_a_literal_repeat():
    d = lib_piece("piece-d", rh=eighths(8, conf={(1, 0): 0.2, (5, 0): 0.21}, vary=False), bars=8)
    assert [r["measures"] for r in select_lowconf([d], seed=1)] == [[0, 1]]


def test_lowconf_window_is_the_shortest_centred_one_with_enough_notes():
    e = lib_piece("piece-e", rh=quarters(12, conf={(6, 0): 0.2}, beats=3), meter=(3, 4), bars=12)
    (r,) = select_lowconf([e], seed=1, n=1)
    assert r["measures"] == [3, 8]                       # 16 notes need six bars, centred on bar 6
    f = lib_piece("piece-f", rh=[nt(2 * k, 2, 60 + k % 5, 1 + k % 5, conf=0.2 if k == 4 else 0.95) for k in range(10)],
                  bars=5, tempo=120)
    (r,) = select_lowconf([f], seed=1, n=1)
    assert r["measures"] == [0, 4]                       # 16 is out of reach; ten notes in five bars


def _hard_setup():
    rh = [(i * 0.5, 0.5, 60 + (i % 8)) for i in range(64)]            # 8 bars of eighths
    lh = [(i * 1.0, 1.0, 48 + (i % 5)) for i in range(32)]            # 8 bars of quarters
    piece = pig_piece("950", rh, lh)
    dp = pig_dump_piece("950", piece, {sid: 1 for sid in piece.source_hand})
    idx = {(n["hand"], n["onsetSec"]): n for n in dp["notes"]}
    picks = [("R", s) for s in (4.0, 4.25, 4.5, 4.75, 5.0, 6.0, 6.25)] + [("L", 12.0)]   # bars 3 (5), 4 (2), 7 (L)
    rows = [(idx[k]["index"], k[0], idx[k]["pitch"], 1, 30, [2, 2, 2], True) for k in picks]
    return piece, dp, {"950": parse_page("950", gallery_page("950", rows))}


def test_harderr_ranks_windows_by_hard_errors_and_prefers_short_ones():
    piece, dp, rows = _hard_setup()
    recs, skipped = select_harderr({"950": dp}, rows, loader=lambda pid, slot: piece, usable={"950"})
    assert [(r["bars"], r["hands"], len(r["hard"])) for r in recs] == [([3, 4], ["R"], 7), ([5, 7], ["L"], 1)]
    assert skipped == {"unusable grid": 0, "not in the quantised piece": 0, "not covered": 0}
    one, skipped = select_harderr({"950": dp}, rows, loader=lambda pid, slot: piece, usable={"950"}, cap=1)
    assert len(one) == 1 and skipped["not covered"] == 1
    none, skipped = select_harderr({"950": dp}, rows, loader=lambda pid, slot: piece, usable=set())
    assert none == [] and skipped["unusable grid"] == 8


def _library(levels=(1, 2, 3, 3, 4, 5, 1, 2, 2, 3, 1, 2), tritone=True):
    lib = []
    for k, level in enumerate(levels):
        slug = f"c{k:02d}"
        lib.append(lib_piece(slug, rh=eighths(12, shift=k), lh=chords(12), bars=12, level=level))
        if tritone:
            tt = eighths(12, shift=k)
            tt[2] = dict(tt[2], finger=2)                                    # the engine fingers the new key differently
            lib.append(lib_piece(slug, rh=tt, lh=chords(12), bars=12, level=level, transpose=6))
    return lib


def test_controls_are_random_level_1_to_3_windows_one_per_piece_avoiding_lowconf():
    lib = _library()
    by_id = {p["id"]: p for p in lib}
    low = [{"piece": "c00", "measures": [2, 5]}]
    ctrl = select_controls(lib, low, seed=11)
    assert len(ctrl) == 10 and len({r["piece"] for r in ctrl}) == 10
    assert all(by_id[r["piece"]]["level"] <= 3 and by_id[r["piece"]]["transpose"] == 0 for r in ctrl)
    for r in ctrl:
        i1, i2 = r["measures"]
        assert 2 <= i2 - i1 + 1 <= 8
        if r["piece"] == "c00":
            assert i2 < 2 or i1 > 5
        p = library_window(by_id[r["piece"]], i1, i2, r["hands"], "x")
        assert all(10 <= len(p.notes(h)) <= 48 for h in r["hands"])
        assert sum(len(p.notes(h)) for h in p.events) <= 96
    assert select_controls(lib, low, seed=11) == ctrl and select_controls(lib, low, seed=12) != ctrl


def test_planted_twins_come_first_and_recall_twins_from_the_rest():
    lib = _library()
    ctrl = select_controls(lib, [], seed=11)
    planted, recall = plant_and_twin(ctrl, {p["id"]: p for p in lib}, seed=11)
    assert len(planted) == 4 and len(recall) == 4
    assert {r["twin_of"] for r in planted}.isdisjoint({r["twin_of"] for r in recall})
    by_pid = {r["passage"]: r for r in ctrl}
    for r in planted:
        assert 2 <= len(r["faults"]) <= 3 and r["measures"] == by_pid[r["twin_of"]]["measures"]
    for r in recall:
        assert r["piece"] == by_pid[r["twin_of"]]["piece"] + "@tritone" and r["transpose"] == 6
    passages = build_passages(ctrl + planted, fake_dump(*lib))
    for r in planted:
        before, after = passages[r["twin_of"]], passages[r["passage"]]
        changed = {nid for h in after.target_hands for nid, f in after.finger_map(h).items()
                   if before.finger_map(h)[nid] != f}
        recorded = {nid for f in r["faults"] for nid in f["notes"] if f["before"][nid] != f["after"][nid]}
        assert changed == recorded


def test_recall_twin_uses_transposed_engine_fingers():
    orig = lib_piece("tw", rh=eighths(4, vary=False), bars=4, level=1)
    tt_notes = [dict(n, finger=2) if n["midi"] == 64 else n for n in eighths(4, vary=False)]
    tt = lib_piece("tw", rh=tt_notes, bars=4, level=1, transpose=6)
    rec = {"passage": "rc01", "set": "recall", "source": "library", "piece": "tw@tritone", "slug": "tw", "title": "T",
           "level": 1, "measures": [2, 3], "hands": ["R"], "twin_of": "ct01", "transpose": 6}
    p = build_passages([rec], fake_dump(orig, tt))["rc01"]
    head = render_passage(p).splitlines()[1]
    assert head.startswith("Composer: unknown (piano piece).") and head.endswith("Bars 1-2.")
    assert [pitch for _, pitch, _, _, _ in p.notes("R")][:3] == [66, 68, 70]
    assert p.finger_string("R").split()[:3] == ["1", "2", "2"]          # the transposed piece's fingers, not 1 2 3


def test_select_all_numbers_sets_and_is_deterministic():
    dump = fake_dump(*_library())
    sel = select_all(dump, {}, seed=3)
    ids = [r["passage"] for r in sel["records"]]
    assert ids == sorted(ids, key=lambda x: (["lc", "he", "ct", "pf", "rc"].index(x[:2]), x))
    assert sel["counts"] == {s: sum(r["set"] == s for r in sel["records"])
                             for s in ("lowconf", "harderr", "control", "planted", "recall")}
    assert sel["counts"]["harderr"] == 0 and sel["counts"]["control"] == 10
    assert select_all(dump, {}, seed=3) == sel
    passages = build_passages(sel["records"], dump)
    assert set(passages) == set(ids)
```

Run: `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests/test_select.py -q`
Expected: FAIL (`ModuleNotFoundError: teacher_review.select`).

- [ ] **Step 2: Write `select.py`**

```python
"""Passage selection for the weekly teacher review (verification spec 3.12, teacher-review.md 6.1 and 6.4).

lowconf  windows around the engine's lowest-confidence library notes: 2 to 8 bars, the shortest centred
         window with 16 notes in the reviewed hand (10 when 16 is out of reach, never above 48), at most
         two per piece, no overlap, no literal repeat; seed notes must sit in a line (a same-hand
         neighbour within inject.LINE_IOI_S), ties broken by a seeded rank
harderr  windows of 2 to 4 bars around the hard errors of the bench gallery, most hard errors first,
         then the shorter window; at most 16; PIG test pieces with a usable timing grid only
control  10 random windows of level 1 to 3 library pieces, one per piece, avoiding lowconf windows
planted  the first 4 controls (seeded order) that take two or more faults from inject.py
recall   4 other controls again: tritone transposition re-fingered by the engine, composer hidden,
         bars renumbered from 1
"""
from __future__ import annotations

import bisect
import random
from collections import Counter, defaultdict

from .build_benchmark import USABLE
from .gallery import GalleryRow, pig_engine_window, slot_of
from .inject import LINE_IOI_S, inject_faults
from .model import Passage
from .musicxml_passages import (HIDDEN, IrregularWindow, count_notes, library_window, measure_at, regular_anchor,
                                render_round_trips)
from .pig_passages import build_piece

N_LOWCONF, PER_PIECE_LOWCONF, N_HARDERR, N_CONTROL, N_RECALL, N_PLANTED = 20, 2, 16, 10, 4, 4
MIN_NOTES, TARGET_NOTES, MAX_NOTES, MAX_PASSAGE_NOTES = 10, 16, 48, 96
CONTROL_LEVELS = (1, 2, 3)
HARD_BARS = (2, 4)
USABLE_PIG = {pid for ids in USABLE.values() for pid in ids}
SET_ORDER = ("lowconf", "harderr", "control", "planted", "recall")


def _overlaps(w: list[int] | tuple[int, int], taken) -> bool:
    return any(not (w[1] < a or w[0] > b) for a, b in taken)


def _window_fits(piece: dict, i1: int, i2: int, hands: list[str]) -> Passage | None:
    try:
        regular_anchor(piece, i1, i2)
    except IrregularWindow:
        return None
    counts = {h: count_notes(piece, i1, i2, h) for h in ("R", "L")}
    if any(not MIN_NOTES <= counts[h] <= MAX_NOTES for h in hands) or sum(counts.values()) > MAX_PASSAGE_NOTES:
        return None
    p = library_window(piece, i1, i2, hands, "probe")
    return p if render_round_trips(p) else None


def _signature(p: Passage, hand: str) -> tuple:
    evs = p.events.get(hand, [])
    t0 = evs[0].onset_q if evs else 0
    return tuple((e.onset_q - t0, tuple(e.pitches), e.dur_q, tuple(e.fingers)) for e in evs)


def _in_line(onsets: dict[str, list[float]], n: dict) -> bool:
    """A same-hand onset other than the note's own within LINE_IOI_S before or after it. ``onsets`` holds the
    sorted distinct onsets of the hand's non-grace notes, so the note's own onset is xs[i]."""
    xs = onsets[n["hand"]]
    i = bisect.bisect_left(xs, n["onsetSec"])
    return any(0 < abs(xs[j] - n["onsetSec"]) <= LINE_IOI_S + 1e-9 for j in (i - 1, i + 1) if 0 <= j < len(xs))


def _centred(piece: dict, mi: int, hand: str, min_notes: int, avoid) -> tuple[int, int, Passage] | None:
    for length in range(2, 9):
        for o in sorted(range(length), key=lambda o: (abs(2 * o - (length - 1)), o)):
            i1 = mi - o
            i2 = i1 + length - 1
            if i1 < 0 or i2 >= len(piece["measures"]) or _overlaps((i1, i2), avoid):
                continue
            if count_notes(piece, i1, i2, hand) < min_notes:
                continue
            p = _window_fits(piece, i1, i2, [hand])
            if p is not None:
                return i1, i2, p
    return None


def _library_record(piece: dict, i1: int, i2: int, hands: list[str], set_name: str) -> dict:
    return {"set": set_name, "source": "library", "piece": piece["id"], "slug": piece["slug"], "title": piece["title"],
            "level": piece["level"], "measures": [i1, i2], "hands": list(hands)}


def select_lowconf(library: list[dict], seed: int, n: int = N_LOWCONF) -> list[dict]:
    originals = [p for p in library if p.get("transpose", 0) == 0]
    by_id = {p["id"]: p for p in originals}
    rng = random.Random(f"{seed}-lowconf")
    seeds = []
    for piece in originals:
        onsets = {h: sorted({x["onsetSec"] for x in piece["notes"] if x["hand"] == h and not x["isGrace"]})
                  for h in ("R", "L")}
        for note in piece["notes"]:
            rank = rng.random()
            if note["isGrace"] or note["confidence"] is None or not _in_line(onsets, note):
                continue
            seeds.append((round(note["confidence"], 9), rank, piece["id"], note["index"]))
    seeds.sort()
    out, taken, signatures = [], defaultdict(list), set()
    for conf, _, pid, idx in seeds:
        if len(out) == n:
            break
        piece = by_id[pid]
        note = piece["notes"][idx]
        if len(taken[pid]) >= PER_PIECE_LOWCONF:
            continue
        mi = measure_at(piece, note["onsetTick"])
        if any(a <= mi <= b for a, b in taken[pid]):
            continue
        found = _centred(piece, mi, note["hand"], TARGET_NOTES, taken[pid]) or \
            _centred(piece, mi, note["hand"], MIN_NOTES, taken[pid])
        if found is None:
            continue
        i1, i2, p = found
        sig = _signature(p, note["hand"])
        if sig in signatures:
            continue
        signatures.add(sig)
        taken[pid].append((i1, i2))
        seed_note = next(k for k, v in p.notes_meta["source"].items() if v == note["id"])
        out.append(dict(_library_record(piece, i1, i2, [note["hand"]], "lowconf"), passage=f"lc{len(out) + 1:02d}",
                        seed_note=seed_note, seed_confidence=note["confidence"]))
    return out


def select_harderr(pig: dict[str, dict], rows: dict[str, list[GalleryRow]], *, loader=build_piece,
                   usable: set[str] = USABLE_PIG, cap: int = N_HARDERR) -> tuple[list[dict], dict]:
    skipped = {"unusable grid": 0, "not in the quantised piece": 0, "not covered": 0}
    cands, pieces, hard_all, total = [], {}, {}, 0
    for pid in sorted(rows):
        hard_rows = [r for r in rows[pid] if r.hard]
        if not hard_rows:
            continue
        if pid not in usable:
            skipped["unusable grid"] += len(hard_rows)
            continue
        dp = pig[pid]
        piece = pieces[pid] = loader(pid, slot_of(dp))
        where = {sid: (piece.bar_of(e.onset_q), hand) for hand, evs in piece.events.items() for e in evs
                 for sid in e.source_ids}
        hard = []
        for r in hard_rows:
            sid = dp["notes"][r.index]["id"]
            if sid not in where:
                skipped["not in the quantised piece"] += 1
                continue
            hard.append((where[sid][0], where[sid][1], sid, r.annotators[0]))
        hard_all[pid] = hard
        total += len(hard)

        def notes_in(b1, b2, h):
            return sum(len(e.pitches) for e in piece.events.get(h, []) if not e.is_rest and b1 <= piece.bar_of(e.onset_q) <= b2)

        seen = set()
        for bar, _, _, _ in sorted(set(hard)):
            for length in range(HARD_BARS[0], HARD_BARS[1] + 1):
                for b1 in range(bar - length + 1, bar + 1):
                    b2 = b1 + length - 1
                    if b1 < 1 or b2 > piece.bars or (b1, b2) in seen:
                        continue
                    seen.add((b1, b2))
                    hands = [h for h in ("R", "L") if any(b1 <= hb <= b2 and hh == h for hb, hh, _, _ in hard)]
                    counts = {h: notes_in(b1, b2, h) for h in ("R", "L")}
                    if any(not MIN_NOTES <= counts[h] <= MAX_NOTES for h in hands) or sum(counts.values()) > MAX_PASSAGE_NOTES:
                        continue
                    score = sum(1 for hb, hh, _, _ in hard if b1 <= hb <= b2 and hh in hands)
                    cands.append((-score, b2 - b1, pid, b1, b2, tuple(hands)))
    cands.sort()
    out = []
    for _, _, pid, b1, b2, hands in cands:
        if len(out) == cap:
            break
        if _overlaps((b1, b2), [tuple(r["bars"]) for r in out if r["pig"] == pid]):
            continue
        p = pig_engine_window(pieces[pid], b1, b2, list(hands), "probe", pig[pid])
        if not render_round_trips(p):
            continue
        hard = {sid: f for hb, hh, sid, f in hard_all[pid] if b1 <= hb <= b2 and hh in hands}
        out.append({"passage": f"he{len(out) + 1:02d}", "set": "harderr", "source": "pig", "piece": pig[pid]["id"],
                    "pig": pid, "slot": slot_of(pig[pid]), "bars": [b1, b2], "hands": list(hands), "hard": hard})
    skipped["not covered"] = total - sum(len(r["hard"]) for r in out)
    return out, skipped


def select_controls(library: list[dict], lowconf: list[dict], seed: int, n: int = N_CONTROL) -> list[dict]:
    rng = random.Random(f"{seed}-control")
    pool = sorted((p for p in library if p.get("transpose", 0) == 0 and p["level"] in CONTROL_LEVELS),
                  key=lambda p: p["id"])
    rng.shuffle(pool)
    taken = defaultdict(list)
    for r in lowconf:
        taken[r["piece"]].append(tuple(r["measures"]))
    out = []
    for piece in pool:
        if len(out) == n:
            break
        nmeas = len(piece["measures"])
        for _ in range(40):
            hands = rng.choice([["R"], ["L"], ["R", "L"]])
            length = rng.randint(2, 8)
            if length > nmeas:
                continue
            i1 = rng.randrange(0, nmeas - length + 1)
            i2 = i1 + length - 1
            if _overlaps((i1, i2), taken[piece["id"]]) or _window_fits(piece, i1, i2, hands) is None:
                continue
            out.append(dict(_library_record(piece, i1, i2, hands, "control"), passage=f"ct{len(out) + 1:02d}"))
            break
    return out


def plant_and_twin(controls: list[dict], by_id: dict[str, dict], seed: int) -> tuple[list[dict], list[dict]]:
    order = sorted(controls, key=lambda r: r["passage"])
    random.Random(f"{seed}-planted").shuffle(order)
    planted, kinds = [], Counter()
    for rec in order:
        if len(planted) == N_PLANTED:
            break
        base = library_window(by_id[rec["piece"]], *rec["measures"], rec["hands"], rec["passage"])
        try:
            q, faults = inject_faults(base, random.Random(f"{seed}-{rec['passage']}"), prefer=dict(kinds))
        except ValueError:
            continue
        if not render_round_trips(q):
            continue
        kinds.update(f.kind for f in faults)
        planted.append(dict(rec, passage=f"pf{len(planted) + 1:02d}", set="planted", twin_of=rec["passage"],
                            faults=[f.as_dict() for f in faults]))
    with_planted = {r["twin_of"] for r in planted}
    ordered = sorted(controls, key=lambda r: r["passage"])
    free = [r for r in ordered if r["passage"] not in with_planted]
    pool = free if len(free) >= N_RECALL else ordered
    rng = random.Random(f"{seed}-recall")
    recall = []
    for rec in rng.sample(pool, len(pool)):
        if len(recall) == N_RECALL:
            break
        tt = by_id.get(f"{rec['piece']}@tritone")
        if tt is None:
            continue
        p = library_window(tt, *rec["measures"], rec["hands"], "probe", composer=HIDDEN[0], style=HIDDEN[1], first_bar=1)
        if not render_round_trips(p):
            continue
        recall.append(dict(rec, set="recall", piece=tt["id"], twin_of=rec["passage"], transpose=tt["transpose"]))
    recall.sort(key=lambda r: r["twin_of"])
    for k, r in enumerate(recall, 1):
        r["passage"] = f"rc{k:02d}"
    return planted, recall


def select_all(dump: dict, rows: dict[str, list[GalleryRow]], seed: int, *, loader=build_piece,
               usable: set[str] = USABLE_PIG) -> dict:
    library = [p for p in dump["pieces"] if p["source"] == "library"]
    pig = {p["pigId"]: p for p in dump["pieces"] if p["source"] == "pig"}
    by_id = {p["id"]: p for p in dump["pieces"]}
    low = select_lowconf(library, seed)
    hard, skipped = select_harderr(pig, rows, loader=loader, usable=usable)
    ctrl = select_controls(library, low, seed)
    planted, recall = plant_and_twin(ctrl, by_id, seed)
    records = low + hard + ctrl + planted + recall
    return {"seed": seed, "records": records, "counts": {s: sum(r["set"] == s for r in records) for s in SET_ORDER},
            "skipped": skipped}


def build_passages(records: list[dict], dump: dict, *, loader=build_piece) -> dict[str, Passage]:
    by_id = {p["id"]: p for p in dump["pieces"]}
    out: dict[str, Passage] = {}
    cache: dict[tuple[str, str], object] = {}
    for rec in sorted(records, key=lambda r: SET_ORDER.index(r["set"])):     # controls before their twins
        pid = rec["passage"]
        if rec["set"] in ("lowconf", "control"):
            out[pid] = library_window(by_id[rec["piece"]], *rec["measures"], rec["hands"], pid)
        elif rec["set"] == "recall":
            out[pid] = library_window(by_id[rec["piece"]], *rec["measures"], rec["hands"], pid,
                                      composer=HIDDEN[0], style=HIDDEN[1], first_bar=1)
        elif rec["set"] == "planted":
            p = out[rec["twin_of"]].copy() if rec["twin_of"] in out else \
                library_window(by_id[rec["piece"]], *rec["measures"], rec["hands"], pid)
            for f in rec["faults"]:
                for nid, finger in f["after"].items():
                    p.set_finger(nid, finger)
            p.passage_id = pid
            out[pid] = p
        else:
            key = (rec["pig"], rec["slot"])
            if key not in cache:
                cache[key] = loader(*key)
            p = pig_engine_window(cache[key], *rec["bars"], rec["hands"], pid, by_id[rec["piece"]])
            p.notes_meta["hard"] = {nid: rec["hard"][sid] for nid, sid in p.notes_meta["source"].items()
                                    if sid in rec["hard"] and nid[0] in rec["hands"]}
            out[pid] = p
    return out
```

Notes for the implementer:

- `_in_line` checks the onsets on either side of the note's own onset. A chord's notes share an onset and do not count as neighbours.
- `rng.random()` is drawn for every note, in dump order, before filtering. The tie ranks therefore do not depend on the filter.
- `random.Random(f"…")` seeds from a string, as `build_benchmark.make_run` does.

- [ ] **Step 3: Run the tests**

Run: `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests -q`
Expected: all pass (Task 4 adds 8 tests).

- [ ] **Step 4: Hand-off**

Paths: `research/teacher_review/select.py`, `research/teacher_review/tests/test_select.py`. Message: `research(teacher-review): passage selection for the weekly review`.

---

### Task 5: `dispatch.py`, blinded batches, key, launches and collection

**Files:**

- Create: `research/teacher_review/dispatch.py`, `research/teacher_review/tests/test_dispatch.py`
- Modify: `research/teacher_review/tests/weekly_fixtures.py` (fake reviewer outputs)

**Interfaces:**

- Consumes: records and Passages (Task 4); `render.render_passage`, `render.LEGEND` (base of the weekly legend); `prompts/brief.md`, `prompts/variant_a.md`, `prompts/variant_b.md`; `collect.normalise_item`, `collect._parse_ts`.
- Produces:

```python
FENCE = "`" * 3
WEEKLY_LEGEND: str
WRAPPER: str                          # README "Dispatch" prompt; placeholders {batch_file}, {out_file}, {n}
POOLS = (("lowconf", ("lowconf",), 2), ("harderr", ("harderr",), 2), ("control", ("control", "recall", "planted"), 1))
def plan_batches(records: list[dict], seed: int, batch_size: int = 8) -> list[dict]
    # [{"number": 1, "pool": "lowconf", "framings": ["a", "b"], "passages": [...]}, ...] numbered across pools
def batch_text(bid: str, framing: str, brief: str, legend: str, passage_texts: list[str], out_line: str) -> str
def write_day(day: Path, results_day: Path, records: list[dict], passages: dict[str, Passage], *, seed: int, date: str,
              meta: dict, repo: Path = REPO) -> dict      # returns the key; writes everything below
def collect_outputs(day: Path) -> dict                    # collect.collect's report shape; writes judgements.json, collect_report.json
```

`write_day` writes the following:

- In `day`: `batch-<NN><f>.md`, `items/<item id>.txt`, `key.json`, `launches.json`, `launches.md` and the empty `out/`.
- In `results_day/library/`: a byte-identical copy of every batch file of the `lowconf` and `control` pools.

Key item fields:

- From the pilot: `passage`, `condition` (`"engine"`, or `"corrupted"` for planted), `piece`, `bars`, `hands`, `batch`, `n_notes`, `fingers`, `faults`, `alt` (`{}`).
- New: `set`, `source`, `title`, `level`, `reviewer` (framing letter), `pool`, `twin_of`, `transpose`, `engine` (reviewed notes only), `hard`, `seed_note`.

Batch entries: `items`, `file` (absolute), `out` (absolute), `chars`, `pool`, `framing`. `key["passages"]` holds the records and `key["meta"]` holds `meta`.

- [ ] **Step 1: Add fake reviews to the test helpers**

Append to `research/teacher_review/tests/weekly_fixtures.py`:

```python
def fake_reviews(day, skip=(), objections=None, bad_note=()):
    """Write a valid reviewer output for every batch of day/key.json (except those in skip). objections(item
    key entry) -> list of objection dicts; bad_note: batch ids whose first item names a note that does not exist."""
    key = json.loads((Path(day) / "key.json").read_text(encoding="utf-8"))
    for bid, b in key["batches"].items():
        if bid in skip:
            continue
        items = []
        for k, iid in enumerate(b["items"]):
            ki = key["items"][iid]
            obs = list(objections(ki)) if objections else []
            if bid in bad_note and k == 0:
                obs.append({"notes": [f"{ki['hands'][0]}999"], "kind": "hop", "severity": "warning", "problem": "x", "fix": {}})
            items.append({"item": iid, "readback": {h: ki["fingers"][h] for h in ki["hands"]},
                          "scores": {"possible": 3, "idiomatic": 3, "economical": 2, "consistent": 3, "beginner_friendly": 3},
                          "verdict": "good", "objections": obs, "comment": ""})
        out = Path(b["out"])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({"batch": bid, "started_at": "2099-01-01T10:00:00Z", "finished_at": "2099-01-01T10:09:00Z",
                                   "items": items}), encoding="utf-8")
```

- [ ] **Step 2: Write the failing tests**

`research/teacher_review/tests/test_dispatch.py`:

```python
"""dispatch: blinded weekly batches, the key, the reviewer launches and collection."""
from __future__ import annotations

import json
import re
from pathlib import Path

from teacher_review import build_benchmark as bb
from teacher_review.dispatch import (FENCE, WEEKLY_LEGEND, WRAPPER, batch_text, collect_outputs, plan_batches,
                                     write_day)
from teacher_review.render import LEGEND

from .conftest import make_passage
from .weekly_fixtures import REPO, fake_reviews

HERE = Path(__file__).resolve().parents[1]


def test_weekly_legend_states_what_dur_means():
    flat = " ".join(WEEKLY_LEGEND.split())
    assert ("dur is the sounding length in the source; pianists release early or use the pedal, so a finger may be "
            "re-used after a long note unless the notes are slurred.") in flat
    assert "A chord's dur is its longest note." in flat and "a half note in 2/2" in flat and "Bar 0 is an upbeat" in flat
    assert "come from the performance timing" not in flat


def test_wrapper_is_the_readme_prompt():
    readme = (HERE / "README.md").read_text(encoding="utf-8").split("## Dispatch", 1)[1]
    quoted = " ".join(ln[2:] for ln in readme.splitlines() if ln.startswith("> "))
    quoted = quoted.replace("`<batch file>`", "`X`").replace("`<output file>`", "`Y`")
    assert " ".join(WRAPPER.format(batch_file="X", out_file="Y", n=8).split()) == " ".join(quoted.split())


def _records():
    recs = [{"passage": f"lc{k:02d}", "set": "lowconf", "source": "library"} for k in range(1, 21)]
    recs += [{"passage": f"he{k:02d}", "set": "harderr", "source": "pig"} for k in range(1, 17)]
    recs += [{"passage": f"ct{k:02d}", "set": "control", "source": "library"} for k in range(1, 11)]
    recs += [{"passage": f"pf{k:02d}", "set": "planted", "source": "library", "twin_of": f"ct{k:02d}"} for k in range(1, 5)]
    recs += [{"passage": f"rc{k:02d}", "set": "recall", "source": "library", "twin_of": f"ct{k + 4:02d}"} for k in range(1, 5)]
    return recs


def test_plan_batches_sizes_twins_and_framings():
    recs = _records()
    plan = plan_batches(recs, seed=3)
    assert [(b["number"], b["pool"], b["framings"]) for b in plan] == [
        (1, "lowconf", ["a", "b"]), (2, "lowconf", ["a", "b"]), (3, "lowconf", ["a", "b"]),
        (4, "harderr", ["a", "b"]), (5, "harderr", ["a", "b"]),
        (6, "control", ["b"]), (7, "control", ["a"]), (8, "control", ["b"])]
    sizes = {pool: sorted(len(b["passages"]) for b in plan if b["pool"] == pool) for pool in ("lowconf", "harderr", "control")}
    assert sizes == {"lowconf": [6, 7, 7], "harderr": [8, 8], "control": [6, 6, 6]}
    base = {r["passage"]: r.get("twin_of") or r["passage"] for r in recs}
    for b in plan:
        bases = [base[p] for p in b["passages"]]
        assert len(bases) == len(set(bases))
    assert plan_batches(recs, seed=3) == plan
    many_twins = [{"passage": "ct01", "set": "control"}, {"passage": "pf01", "set": "planted", "twin_of": "ct01"},
                  {"passage": "rc01", "set": "recall", "twin_of": "ct01"}]
    assert len(plan_batches(many_twins, seed=1)) == 3        # three variants of one passage need three batches


def _small_day(tmp_path):
    recs, passages = [], {}
    sets = [("lc", "lowconf", "library", 5), ("he", "harderr", "pig", 3), ("ct", "control", "library", 3)]
    for prefix, set_name, source, n in sets:
        for k in range(1, n + 1):
            pid = f"{prefix}{k:02d}"
            recs.append({"passage": pid, "set": set_name, "source": source, "piece": f"piece-{pid}", "title": "Test piece",
                         "level": 2, "hands": ["R"]})
            p = make_passage([(i * 0.5, 0.5, [60 + (i + k) % 12], [1 + i % 5]) for i in range(12)], pid=pid)
            p.notes_meta["engine"] = {nid: {"id": f"n{i}", "finger": f, "confidence": 0.5, "lint": []}
                                      for i, (nid, _, f, _, _) in enumerate(p.notes("R"))}
            passages[pid] = p
    recs.append({"passage": "rc01", "set": "recall", "source": "library", "piece": "piece-ct01@tritone", "title": "Test piece",
                 "level": 2, "hands": ["R"], "twin_of": "ct01", "transpose": 6})
    passages["rc01"] = passages["ct01"].copy()
    recs.append({"passage": "pf01", "set": "planted", "source": "library", "piece": "piece-ct02", "title": "Test piece",
                 "level": 2, "hands": ["R"], "twin_of": "ct02",
                 "faults": [{"kind": "hop_at_speed", "hand": "R", "notes": ["R3", "R4"], "anchor": "R4",
                             "before": {"R3": 3, "R4": 4}, "after": {"R3": 3, "R4": 3}}]})
    passages["pf01"] = passages["ct02"].copy()
    passages["pf01"].set_finger("R4", 3)
    key = write_day(tmp_path / "day", tmp_path / "results", recs, passages, seed=5, date="2099-01-01",
                    meta={"engineVersion": "test"}, repo=tmp_path)
    return key


def test_write_day_files_blinding_and_key(tmp_path):
    key = _small_day(tmp_path)
    day = tmp_path / "day"
    assert sorted(p.name for p in day.glob("batch-*.md")) == [
        "batch-01a.md", "batch-01b.md", "batch-02a.md", "batch-02b.md", "batch-03a.md", "batch-04b.md"]
    assert len(key["items"]) == 5 * 2 + 3 * 2 + 5
    words = ("lowconf", "harderr", "control", "recall", "planted", "tritone", "Test piece", "piece-",
             "lc0", "he0", "ct0", "rc0", "pf0")
    for bid, b in key["batches"].items():
        text = (day / f"batch-{bid}.md").read_text(encoding="utf-8")
        body = text.split("## Passages", 1)[1]
        assert not [w for w in words if w in body], bid
        assert body.count(FENCE) == 2 * len(b["items"])
        assert text.rstrip().endswith(f"Output file: day/out/batch-{bid}.json")
        assert WEEKLY_LEGEND.strip() in text and text.startswith(f"# Batch {bid}\n")
        assert len(text) == b["chars"]
    a = [key["items"][i]["passage"] for i in key["batches"]["01a"]["items"]]
    b_ = [key["items"][i]["passage"] for i in key["batches"]["01b"]["items"]]
    assert sorted(a) == sorted(b_) and set(key["batches"]["01a"]["items"]).isdisjoint(key["batches"]["01b"]["items"])
    assert {key["items"][i]["reviewer"] for i in key["batches"]["01b"]["items"]} == {"b"}
    pf = next(v for v in key["items"].values() if v["passage"] == "pf01")
    assert pf["condition"] == "corrupted" and pf["faults"][0]["kind"] == "hop_at_speed"
    rc = next(v for v in key["items"].values() if v["passage"] == "rc01")
    assert (rc["twin_of"], rc["transpose"], rc["condition"]) == ("ct01", 6, "engine")
    lc = next(v for v in key["items"].values() if v["passage"] == "lc01")
    assert lc["n_notes"] == {"R": 12} and lc["fingers"]["R"].split()[:3] == ["1", "2", "3"] and set(lc["engine"]) >= {"R1"}
    launches = json.loads((day / "launches.json").read_text(encoding="utf-8"))
    assert [l["batch"] for l in launches] == ["01a", "01b", "02a", "02b", "03a", "04b"]
    for l in launches:
        assert Path(l["batch_file"]).is_absolute() and l["model"] == "opus"
        assert l["prompt"] == WRAPPER.format(batch_file=l["batch_file"], out_file=l["out_file"], n=l["items"])
    assert (day / "launches.md").read_text(encoding="utf-8").count("| 0") >= 6
    assert all(re.fullmatch(r"it-[0-9a-f]{4}", i) for i in key["items"])


def test_library_copies_contain_no_pig_items(tmp_path):
    key = _small_day(tmp_path)
    lib = tmp_path / "results" / "library"
    assert sorted(p.name for p in lib.glob("*.md")) == ["batch-01a.md", "batch-01b.md", "batch-03a.md", "batch-04b.md"]
    pig_items = {i for i, v in key["items"].items() if v["source"] == "pig"}
    for p in lib.glob("*.md"):
        text = p.read_text(encoding="utf-8")
        assert len(text.encode("utf-8")) < 64_000 and not any(i in text for i in pig_items)
        assert text == (tmp_path / "day" / p.name).read_text(encoding="utf-8")


def test_collect_outputs_validates_like_the_pilot(tmp_path):
    key = _small_day(tmp_path)
    day = tmp_path / "day"
    fake_reviews(day, skip={"04b"}, bad_note={"01a"})
    rep = collect_outputs(day)
    missing = set(key["batches"]["04b"]["items"])
    assert rep["n_items"] == len(key["items"]) - len(missing) and set(rep["missing_items"]) == missing
    assert any("unknown notes" in p for p in rep["problems"])
    js = json.loads((day / "judgements.json").read_text(encoding="utf-8"))
    assert set(js) == set(key["items"]) - missing
    assert all(j["readback"]["R"]["exact"] for j in js.values())
    assert rep["batches"]["01a"]["wall_s"] == 540.0


def test_batch_layout_matches_build_benchmark(tmp_path, monkeypatch, scale_passage):
    monkeypatch.setattr(bb, "DATA_OUT", tmp_path / "data")
    monkeypatch.setattr(bb, "RESULTS", tmp_path / "results")
    passages = [{"passage": "p01", "piece": "001", "composer": "Test", "slot": "1", "annotator": "XX", "bars": [1, 2],
                 "hands": ["R"]}]
    renders = {"p01": {c: scale_passage.copy() for c in bb.CONDITIONS}}
    info = {"p01": {"n_notes": {"R": 16, "L": 9}, "fingers": {c: {"R": scale_passage.finger_string("R")} for c in bb.CONDITIONS},
                    "faults": [], "alt": {}}}
    key = bb.make_run("T", passages, renders, info, seed=1, batch_size=1, variant="a")
    bid, b = next(iter(key["batches"].items()))
    run_dir = tmp_path / "data" / "runs" / "T"
    texts = [(run_dir / "items" / f"{iid}.txt").read_text(encoding="utf-8") for iid in b["items"]]
    expected = batch_text(bid, (bb.PROMPTS / "variant_a.md").read_text(encoding="utf-8"),
                          (bb.PROMPTS / "brief.md").read_text(encoding="utf-8"), LEGEND, texts, b["out"])
    assert (run_dir / "batch-01.md").read_text(encoding="utf-8") == expected
```

Run: `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests/test_dispatch.py -q`
Expected: FAIL (`ModuleNotFoundError: teacher_review.dispatch`).

- [ ] **Step 3: Write `dispatch.py`**

```python
"""Blinded weekly batches (the layout of build_benchmark.make_run), the key, the reviewer launches,
and collection of the reviewers' JSON with collect.normalise_item (the pilot's validator).

Pools never mix: library low-confidence passages, PIG hard-error passages, and the control pool
(controls, planted twins, recall twins). Engine pools are written twice per batch, framing a and
framing b, with the same passages, fresh item ids and an independent order (two reviewers); control
batches get one reviewer (framing a for odd batch numbers, b for even). Library batch files are copied
byte for byte to research/teacher_review/results/weekly/<date>/library/.
"""
from __future__ import annotations

import json
import math
import random
import re
from pathlib import Path

from .collect import _parse_ts, normalise_item
from .model import Passage
from .render import render_passage

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
PROMPTS = HERE / "prompts"
FENCE = "`" * 3
POOLS = (("lowconf", ("lowconf",), 2), ("harderr", ("harderr",), 2), ("control", ("control", "recall", "planted"), 1))

WEEKLY_LEGEND = """How to read a passage block
- One line per note, chord or rest; both hands in separate sections, each in time order.
- id = hand letter + note number (R1, R2, ... for the right hand; L1, L2, ... for the left). A chord
  shows a range (R3-5): its pitches are listed low to high and its fingers in the same order (1+3+5).
  Rests have no id. Refer to notes by these ids.
- bar / beat: bar number and beat within the bar, 1-based; 2.5 means half-way through beat 2. The beat
  is a quarter note in x/4 meters, a half note in 2/2 and 3/2, a dotted quarter in 6/8, 9/8 and 12/8,
  an eighth in 3/8. Bar 0 is an upbeat (pickup) bar.
- dur: w h q e s t = whole, half, quarter, eighth, 16th, 32nd; a trailing dot = dotted (q. = dotted
  quarter); e3 = triplet eighth; gr = grace note, played just before the note that follows it; otherwise
  a multiple of a quarter (2.5q). A chord's dur is its longest note. dur is the sounding length in the
  source; pianists release early or use the pedal, so a finger may be re-used after a long note unless
  the notes are slurred. Rest lines mark gaps of an eighth or longer in that hand.
- pitch: scientific pitch names, C4 = middle C, sharps except Eb and Bb. Black keys: C# Eb F# G# Bb.
- f: finger, 1 = thumb ... 5 = little finger, for both hands. "-" = no fingering given for that note.
- Tempo is given in quarter notes per minute and is approximate in every passage. In some passages the
  bar numbers were estimated from a recording and may be off by a bar; the order, the rhythm and the
  pitches are exact.
"""

WRAPPER = (
    "You are a reviewer in a blinded study of piano fingerings. Your only input is the file "
    "`{batch_file}`. It contains a brief, a notation legend and {n} passages, each with a candidate "
    "fingering. Follow the brief's instructions exactly and write your review as a single JSON "
    "document to `{out_file}` (UTF-8, nothing but the JSON).\n"
    "Rules: read only that one input file; do not open, list, search or read any other file, "
    "directory or web page, and do not look for the sources of the passages. Do not run git. Do not "
    "run any program except one command to get a UTC timestamp before you read the passages "
    "(bash: `date -u +%FT%TZ`) and one after you have written the JSON; put them in `started_at` and "
    "`finished_at`. Do not modify the input file. Every item in the input must appear exactly once in "
    "`items`, in the same order, each with `item`, `readback`, `scores`, `verdict`, `objections` and "
    "`comment`. Use only note ids that exist in the passage. When done, reply with one line: the "
    "output path and the number of items written."
)


def _base(rec: dict) -> str:
    return rec.get("twin_of") or rec["passage"]


def plan_batches(records: list[dict], seed: int, batch_size: int = 8) -> list[dict]:
    plan, number = [], 0
    for pool, sets, reviewers in POOLS:
        recs = sorted((r for r in records if r["set"] in sets), key=lambda r: r["passage"])
        if not recs:
            continue
        rng = random.Random(f"{seed}-batches-{pool}")
        ids = [r["passage"] for r in recs]
        rng.shuffle(ids)
        base = {r["passage"]: _base(r) for r in recs}
        per_base = max(sum(1 for r in recs if _base(r) == b) for b in set(base.values()))
        n = max(math.ceil(len(ids) / batch_size), per_base)
        batches: list[list[str]] = [[] for _ in range(n)]
        for pid in ids:
            order = list(range(n))
            rng.shuffle(order)
            order.sort(key=lambda k: len(batches[k]))
            for k in order:
                if len(batches[k]) < batch_size and all(base[x] != base[pid] for x in batches[k]):
                    batches[k].append(pid)
                    break
            else:
                raise RuntimeError(f"cannot place {pid} in pool {pool} without two variants in one batch")
        for b in batches:
            number += 1
            framings = ["a", "b"] if reviewers == 2 else (["a"] if number % 2 else ["b"])
            plan.append({"number": number, "pool": pool, "framings": framings, "passages": b})
    return plan


def batch_text(bid: str, framing: str, brief: str, legend: str, passage_texts: list[str], out_line: str) -> str:
    """The pilot's batch layout, line for line (build_benchmark.make_run)."""
    lines = [f"# Batch {bid}", "", framing.strip(), "", brief.strip(), "", "## Notation", "", legend.strip(), "",
             f"## Passages ({len(passage_texts)})", ""]
    for text in passage_texts:
        lines += [FENCE, text.rstrip("\n"), FENCE, ""]
    lines += [f"Output file: {out_line}", ""]
    return "\n".join(lines)


def _key_item(rec: dict, p: Passage, bid: str, framing: str, pool: str) -> dict:
    hands = list(p.target_hands)
    return {"passage": rec["passage"], "set": rec["set"], "source": rec["source"],
            "condition": "corrupted" if rec["set"] == "planted" else "engine",
            "piece": rec.get("piece"), "title": rec.get("title", ""), "level": rec.get("level"),
            "bars": [p.bar_first, p.bar_last], "hands": hands, "batch": bid, "reviewer": framing, "pool": pool,
            "n_notes": {h: len(p.notes(h)) for h in p.events}, "fingers": {h: p.finger_string(h) for h in hands},
            "faults": rec.get("faults", []), "alt": {}, "twin_of": rec.get("twin_of"), "transpose": rec.get("transpose", 0),
            "engine": {k: v for k, v in (p.notes_meta.get("engine") or {}).items() if k[0] in hands},
            "hard": dict(p.notes_meta.get("hard") or {}), "seed_note": rec.get("seed_note")}


def write_day(day: Path, results_day: Path, records: list[dict], passages: dict[str, Passage], *, seed: int,
              date: str, meta: dict, repo: Path = REPO) -> dict:
    day, results_day = Path(day), Path(results_day)
    (day / "out").mkdir(parents=True, exist_ok=True)
    (day / "items").mkdir(parents=True, exist_ok=True)
    library_dir = results_day / "library"
    library_dir.mkdir(parents=True, exist_ok=True)
    brief = (PROMPTS / "brief.md").read_text(encoding="utf-8")
    framings = {f: (PROMPTS / f"variant_{f}.md").read_text(encoding="utf-8") for f in ("a", "b")}
    by_pid = {r["passage"]: r for r in records}
    ids_rng = random.Random(f"{seed}-ids")
    taken: set[str] = set()
    key = {"date": date, "seed": seed, "meta": meta, "items": {}, "batches": {}, "passages": by_pid}
    launches = []
    for b in plan_batches(records, seed):
        for framing in b["framings"]:
            bid = f"{b['number']:02d}{framing}"
            order = list(b["passages"])
            random.Random(f"{seed}-order-{bid}").shuffle(order)
            texts, items = [], []
            for pid in order:
                while True:
                    iid = f"it-{ids_rng.randrange(16 ** 4):04x}"
                    if iid not in taken:
                        taken.add(iid)
                        break
                p = passages[pid].copy()
                p.passage_id = iid
                text = render_passage(p)
                (day / "items" / f"{iid}.txt").write_text(text, encoding="utf-8", newline="\n")
                texts.append(text)
                items.append(iid)
                key["items"][iid] = _key_item(by_pid[pid], passages[pid], bid, framing, b["pool"])
            out = day / "out" / f"batch-{bid}.json"
            try:        # repo-relative in the batch file, so committed copies carry no local path
                out_line = out.resolve().relative_to(Path(repo).resolve()).as_posix()
            except ValueError:
                out_line = out.resolve().as_posix()
            text = batch_text(bid, framings[framing], brief, WEEKLY_LEGEND, texts, out_line)
            path = day / f"batch-{bid}.md"
            path.write_text(text, encoding="utf-8", newline="\n")
            if b["pool"] != "harderr":
                (library_dir / path.name).write_text(text, encoding="utf-8", newline="\n")
            key["batches"][bid] = {"items": items, "file": path.resolve().as_posix(), "out": out.resolve().as_posix(),
                                   "chars": len(text), "pool": b["pool"], "framing": framing}
            launches.append({"n": len(launches) + 1, "batch": bid, "pool": b["pool"], "framing": framing,
                             "items": len(items), "batch_file": path.resolve().as_posix(),
                             "out_file": out.resolve().as_posix(), "model": "opus",
                             "prompt": WRAPPER.format(batch_file=path.resolve().as_posix(),
                                                      out_file=out.resolve().as_posix(), n=len(items))})
    (day / "key.json").write_text(json.dumps(key, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n")
    (day / "launches.json").write_text(json.dumps(launches, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n")
    rows = ["| # | pool | batch file (input) | output file | items | framing |", "|---|---|---|---|---|---|"]
    rows += [f"| {l['n']:02d} | {l['pool']} | `{l['batch_file']}` | `{l['out_file']}` | {l['items']} | {l['framing']} |"
             for l in launches]
    (day / "launches.md").write_text(
        f"# Reviewer launches, {date}\n\nLaunch one fresh Opus subagent per row with the prompt in launches.json "
        f"(the README wrapper with the two paths and the item count). Nothing else goes into the prompt.\n\n"
        + "\n".join(rows) + "\n", encoding="utf-8", newline="\n")
    return key


def collect_outputs(day: Path) -> dict:
    """collect.collect for a weekly day: same validation, same report shape, files in the day directory."""
    day = Path(day)
    key = json.loads((day / "key.json").read_text(encoding="utf-8"))
    report = {"date": key["date"], "batches": {}, "problems": [], "missing_items": [], "n_items": 0}
    judgements = {}
    for bid, b in key["batches"].items():
        out = Path(b["out"])
        entry = {"file": out.as_posix(), "present": out.exists(), "wall_s": None, "chars_in": b["chars"],
                 "chars_out": 0, "n_items": 0}
        report["batches"][bid] = entry
        if not out.exists():
            report["missing_items"] += b["items"]
            continue
        text = out.read_text(encoding="utf-8")
        entry["chars_out"] = len(text)
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            m = re.search(r"\{.*\}", text, re.S)
            try:
                raw = json.loads(m.group(0)) if m else None
            except json.JSONDecodeError:
                raw = None
        if not isinstance(raw, dict):
            report["problems"].append(f"{bid}: output is not valid JSON")
            report["missing_items"] += b["items"]
            continue
        t0, t1 = _parse_ts(raw.get("started_at")), _parse_ts(raw.get("finished_at"))
        if t0 and t1 and t1 > t0:
            entry["wall_s"] = (t1 - t0).total_seconds()
        seen = set()
        for item in raw.get("items") or []:
            iid = item.get("item") if isinstance(item, dict) else None
            if iid not in b["items"]:
                report["problems"].append(f"{bid}: unexpected item id {iid!r}")
                continue
            if iid in seen:
                report["problems"].append(f"{bid}: duplicate item {iid}")
                continue
            seen.add(iid)
            problems: list[str] = []
            j = normalise_item(item, key["items"][iid], problems)
            j["batch"] = bid
            report["problems"] += problems
            judgements[iid] = j
        entry["n_items"] = len(seen)
        report["missing_items"] += [iid for iid in b["items"] if iid not in seen]
    report["n_items"] = len(judgements)
    (day / "judgements.json").write_text(json.dumps(judgements, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n")
    (day / "collect_report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n")
    return report
```

- [ ] **Step 4: Run the tests**

Run: `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests -q`
Expected: all pass (Task 5 adds 7 tests).

- [ ] **Step 5: Hand-off**

Paths: `research/teacher_review/dispatch.py`, `research/teacher_review/tests/test_dispatch.py`, `research/teacher_review/tests/weekly_fixtures.py`. Message: `research(teacher-review): blinded weekly batches, launches and collection`.

---

### Task 6: New measurements in `score.py` and `hypotheses.py`

**Files:**

- Modify: `research/teacher_review/score.py` (append functions; change nothing that exists), `research/teacher_review/tests/test_score.py` (append tests)
- Create: `research/teacher_review/hypotheses.py`, `research/teacher_review/tests/test_hypotheses.py`

**Interfaces:**

- Produces in `score.py`:

```python
def match_objections(obs_a: list[dict], obs_b: list[dict], tol: int = 1) -> list[tuple[int, int]]
def rates_by(key_items: dict, judgements: dict, field: str = "set", tol: int = 1) -> dict[str, dict]
    # per group: items, notes, objections, by_severity, by_kind, per_item, per_100_notes, share_items_with_error,
    #            mean_overall, verdicts; objections near planted faults (condition "corrupted") excluded
def recall_comparison(key_items: dict, judgements: dict, tol: int = 1) -> dict
def hard_error_agreement(key_items: dict, judgements: dict, tol: int = 1) -> dict
def seed_hits(key_items: dict, judgements: dict, tol: int = 1) -> dict
```

- Produces in `hypotheses.py`: `Member`, `KIND_LINT`, `KIND_TEXT`, `lint_key`, `members_from_pair`, `members_single`, `weekly_members`, `group_by`, `hypotheses`, `experiments_rows`, `MIN_GROUP = 3`, `PAIR_SETS = ("lowconf", "harderr")`, `SINGLE_SETS = ("control",)`.

- [ ] **Step 1: Write the failing tests**

Append this block to the end of `research/teacher_review/tests/test_score.py`. It brings its own imports and reuses the file's `_ob`, `_j` and `false_positives`; change nothing above it:

```python
import json
from pathlib import Path

from teacher_review.score import hard_error_agreement, match_objections, rates_by, recall_comparison, seed_hits

_RESULTS = Path(__file__).resolve().parents[1] / "results"


def _pilot(run):
    base = _RESULTS / run
    return (json.loads((base / "key.json").read_text(encoding="utf-8"))["items"],
            json.loads((base / "judgements.json").read_text(encoding="utf-8")))


def test_rates_by_condition_reproduces_the_pilot_false_positive_table():
    k, j = _pilot("A")
    r = rates_by(k, j, field="condition")
    fp = false_positives(k, j)
    for c in ("expert", "fhmm3", "corrupted"):
        for f in ("items", "notes", "objections", "by_severity", "per_100_notes", "share_items_with_error"):
            assert r[c][f] == fp[c][f], (c, f)
    assert (r["expert"]["objections"], r["expert"]["by_severity"]) == (28, {"warning": 14, "info": 12, "error": 2})
    assert r["corrupted"]["objections"] == 6


def test_match_objections_is_one_to_one_and_ordered():
    a = [_ob(["R3"], "hop"), _ob(["R4"], "hop"), _ob(["L2"], "stretch")]
    b = [_ob(["R4"], "hop"), _ob(["R9"], "hop"), _ob(["R2"], "stretch")]
    assert match_objections(a, b) == [(0, 0)]
    assert match_objections(b, a) == [(0, 0)]


def test_recall_comparison_pairs_each_twin_with_its_control():
    key = {"c": {"passage": "ct01", "set": "control", "condition": "engine", "hands": ["R"], "n_notes": {"R": 8},
                 "fingers": {"R": "1 2 3 4 5 1 2 3"}},
           "r": {"passage": "rc01", "set": "recall", "condition": "engine", "twin_of": "ct01", "hands": ["R"],
                 "n_notes": {"R": 8}, "fingers": {"R": "1 2 3 4 5 1 2 4"}}}
    js = {"c": _j("c", "engine", [3, 3, 2, 3, 2], "acceptable", [_ob(["R3"], "hop"), _ob(["R7"], "stretch", "error")]),
          "r": _j("r", "engine", [3, 3, 3, 3, 2], "good", [_ob(["R4"], "hop")])}
    out = recall_comparison(key, js)
    (p,) = out["pairs"]
    assert (p["control"], p["recall"], p["notes"], p["finger_agreement"]) == ("ct01", "rc01", 8, 0.875)
    assert p["objections"] == [2, 1] and p["per_100_notes"] == [25.0, 12.5]
    assert p["overall"] == [13.0, 14.0] and p["verdict"] == ["acceptable", "good"]
    assert p["matched"] == 1 and abs(p["dice"] - 2 / 3) < 1e-9
    assert (out["n"], out["mean_overall_diff"], out["verdict_agreement"]) == (1, 1.0, 0.0)


def test_hard_error_agreement_counts_hits_and_fixes():
    key = {"h": {"passage": "he01", "set": "harderr", "condition": "engine", "hands": ["R"], "n_notes": {"R": 10},
                 "hard": {"R3": 2, "R8": 4}}}
    js = {"h": _j("h", "engine", [3, 3, 3, 3, 3], "good", [_ob(["R4"], "hop", fix={"R3": 2}),
                                                            _ob(["R8"], "stretch", fix={"R8": 5})])}
    assert hard_error_agreement(key, js) == {"items": 1, "hard_notes": 2, "hit": 2, "hit_share": 1.0, "fix_on_hard": 2,
                                             "fix_match": 1, "fix_match_share": 0.5}


def test_seed_hits():
    base = {"condition": "engine", "set": "lowconf", "hands": ["R"], "n_notes": {"R": 10}}
    key = {"x": dict(base, passage="lc01", seed_note="R5"), "y": dict(base, passage="lc02", seed_note="L2")}
    js = {"x": _j("x", "engine", [3] * 5, "good", [_ob(["R6"], "hop")]),
          "y": _j("y", "engine", [3] * 5, "good", [_ob(["R2"], "hop")])}
    assert seed_hits(key, js) == {"reviews": 2, "hit": 1, "share": 0.5}
```

`research/teacher_review/tests/test_hypotheses.py`:

```python
"""hypotheses: consistent objections, groups by kind and lint rule, rows for docs/experiments.md."""
from __future__ import annotations

import json
from pathlib import Path

from teacher_review.collect import KINDS
from teacher_review.hypotheses import (KIND_LINT, KIND_TEXT, Member, experiments_rows, group_by, hypotheses, lint_key,
                                       members_from_pair, weekly_members)

RESULTS = Path(__file__).resolve().parents[1] / "results"


def _load(run):
    return (json.loads((RESULTS / run / "key.json").read_text(encoding="utf-8"))["items"],
            json.loads((RESULTS / run / "judgements.json").read_text(encoding="utf-8")))


def _fhmm3():
    (ka, ja), (kb, jb) = _load("A"), _load("B")
    return members_from_pair(ka, ja, kb, jb, include=lambda ki: ki["condition"] == "fhmm3")


def test_every_objection_kind_has_a_text_and_a_lint_mapping():
    assert set(KIND_TEXT) == KINDS and set(KIND_LINT) == KINDS


def test_consistent_objections_on_the_pilot():
    fh = _fhmm3()
    assert len(fh) == 42 and sum(m.basis == "both" for m in fh) == 33 and len({m.passage for m in fh}) == 27
    sizes = {k: len(v) for k, v in group_by(fh, "kind").items() if len(v) >= 3}
    assert sizes == {"hop": 9, "impossible_span": 6, "inconsistent": 6, "other": 4, "same_finger_chord": 4,
                     "stretch": 4, "position_change": 3}
    assert all(m.lint is None and m.lint_key == "n/a" for m in fh)
    (ka, ja), (kb, jb) = _load("A"), _load("B")
    ex = members_from_pair(ka, ja, kb, jb, include=lambda ki: ki["condition"] == "expert")
    assert len(ex) == 13 and {k: len(v) for k, v in group_by(ex, "kind").items() if len(v) >= 3} == {"hop": 3}


def test_hypotheses_and_rows_on_the_pilot():
    hs = hypotheses(_fhmm3(), "2026-10-14", "teacher-2026-10-14.md")
    assert [(h["id"], h["key"], h["members"], len(h["passages"])) for h in hs] == [
        ("K1", "hop", 9, 8), ("K2", "impossible_span", 6, 5), ("K3", "inconsistent", 6, 6), ("K4", "other", 4, 4),
        ("K5", "same_finger_chord", 4, 4), ("K6", "stretch", 4, 4), ("K7", "position_change", 3, 2)]
    rows = experiments_rows(hs).splitlines()
    assert len(rows) == 7
    assert rows[0].startswith(
        "| 2026-10-14 | Teacher review 2026-10-14 (K1): 9 consistent objections of kind hop in 8 passages (fhmm3 9); "
        "lint was not recorded. Hypothesis: the hop penalty is too weak at the inter-onset intervals of these passages. "
        "| None yet; proposed: ")
    assert "severities: error 2, warning 7" in rows[0]
    assert all(r.startswith("| ") and r.endswith(" |") and r.count(" | ") == 5 for r in rows)


def test_lint_key_uses_only_the_related_rule():
    assert lint_key("hop", ["L07", "L11", "L14"]) == "L11"
    assert lint_key("hop", ["L07", "L14"]) == "none"
    assert lint_key("position_change", ["L11"]) == "none"
    assert lint_key("hop", None) == "n/a"


def _m(passage, kind, key):
    return Member(passage=passage, set="lowconf", source="library", kind=kind, severity="warning", notes=["R1"],
                  basis="both", reviewers=["a", "b"], problems=["x"], fix={}, lint=[] if key == "none" else [key],
                  lint_key=key)


def test_lint_groups_need_two_kinds_and_none_is_its_own_group():
    ms = [_m("lc01", "hop", "L11"), _m("lc02", "hop", "L11"), _m("lc03", "hop", "L11"),
          _m("lc04", "stretch", "L07"), _m("lc05", "stretch", "L07"), _m("lc06", "impossible_span", "L07"),
          _m("lc07", "position_change", "none"), _m("lc08", "position_change", "none"), _m("lc09", "inconsistent", "none")]
    hs = hypotheses(ms, "2026-10-21", "teacher-2026-10-21.md", lint_titles={"L07": "Uncomfortable span", "L11": "Fast hop"})
    assert [(h["id"], h["key"]) for h in hs] == [("K1", "hop"), ("L1", "L07"), ("L2", "none")]
    rows = experiments_rows(hs).splitlines()
    assert "lint L11 fires at 3 of them" in rows[0]
    assert rows[1].split(" | ")[1].startswith(
        "Teacher review 2026-10-21 (L1): lint L07 (Uncomfortable span) also fires at 3 consistent objections of "
        "2 kinds (stretch 2, impossible_span 1) in 3 passages.")
    assert rows[2].split(" | ")[1].startswith(
        "Teacher review 2026-10-21 (L2): no related lint rule fires at 3 consistent objections of 2 kinds "
        "(position_change 2, inconsistent 1) in 3 passages.")


def _item(passage, set_name, reviewer, engine=None, condition="engine"):
    return {"passage": passage, "set": set_name, "source": "library", "condition": condition, "reviewer": reviewer,
            "hands": ["R"], "n_notes": {"R": 10}, "fingers": {"R": "1 2 3 4 5 1 2 3 4 5"}, "engine": engine or {}}


def _jd(obs):
    return {"scores": {}, "verdict": "good", "verdict_rank": 3, "objections": obs, "comment": "", "readback": {}}


def _o(notes, kind, sev="warning"):
    return {"notes": notes, "kind": kind, "severity": sev, "problem": f"{kind} at {notes[0]}", "fix": {}}


def test_weekly_members_pair_engine_sets_and_take_errors_from_controls():
    key = {"a1": _item("lc01", "lowconf", "a", engine={"R3": {"lint": ["L11"]}, "R4": {"lint": []}}),
           "b1": _item("lc01", "lowconf", "b", engine={"R3": {"lint": ["L11"]}, "R4": {"lint": []}}),
           "c1": _item("ct01", "control", "a"),
           "p1": _item("pf01", "planted", "b", condition="corrupted"),
           "r1": _item("rc01", "recall", "a")}
    js = {"a1": _jd([_o(["R3"], "hop"), _o(["R9"], "stretch", "info")]),
          "b1": _jd([_o(["R4"], "hop"), _o(["R1"], "impossible_span", "error")]),
          "c1": _jd([_o(["R2"], "hop"), _o(["R5"], "same_finger_chord", "error")]),
          "p1": _jd([_o(["R2"], "hop", "error")]), "r1": _jd([_o(["R2"], "hop", "error")])}
    ms = weekly_members(key, js)
    assert [(m.passage, m.kind, m.basis, m.lint_key) for m in ms] == [
        ("ct01", "same_finger_chord", "error", "none"), ("lc01", "hop", "both", "L11"),
        ("lc01", "impossible_span", "error", "none")]
    assert ms[1].problems == ["hop at R3", "hop at R4"] and ms[1].notes == ["R3", "R4"]
```

Run: `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests/test_score.py research/teacher_review/tests/test_hypotheses.py -q`
Expected: FAIL (import errors).

- [ ] **Step 2: Append to `score.py`**

```python
# ---------------------------------------------------------------------------------------
# 7. weekly-run measurements (M7-A): rates per set, recall control, hard errors, seeds
# ---------------------------------------------------------------------------------------

def match_objections(obs_a: list[dict], obs_b: list[dict], tol: int = 1) -> list[tuple[int, int]]:
    """One-to-one matches between two reviewers' objections on one passage: same kind and a note of one
    within ``tol`` of a note of the other in the same hand. Greedy in the order of ``obs_a``; each takes
    the first unmatched objection of ``obs_b`` that matches."""
    used: set[int] = set()
    out = []
    for i, oa in enumerate(obs_a):
        for j, ob in enumerate(obs_b):
            if j in used or oa["kind"] != ob["kind"]:
                continue
            if any(_near(n, ob["notes"], tol) for n in oa["notes"]):
                used.add(j)
                out.append((i, j))
                break
    return out


def rates_by(key_items: dict, judgements: dict, field: str = "set", tol: int = 1) -> dict:
    """Objection rates per value of key_items[iid][field] (falling back to the condition). Objections
    within ``tol`` of a planted fault are left out, as in false_positives."""
    groups: dict[str, dict] = {}
    for iid, j in judgements.items():
        ki = key_items[iid]
        g = groups.setdefault(ki.get(field) or ki["condition"], {
            "items": 0, "notes": 0, "objections": 0, "by_severity": Counter(), "by_kind": Counter(),
            "items_with_error": 0, "overall": [], "verdicts": Counter()})
        g["items"] += 1
        g["notes"] += sum(ki["n_notes"][h] for h in ki["hands"])
        planted = [n for f in ki.get("faults", []) for n in f["notes"]]
        err = False
        for ob in j["objections"]:
            if ki["condition"] == "corrupted" and any(_near(n, planted, tol) for n in ob["notes"]):
                continue
            g["objections"] += 1
            g["by_severity"][ob["severity"]] += 1
            g["by_kind"][ob["kind"]] += 1
            err = err or ob["severity"] == "error"
        g["items_with_error"] += err
        o = overall(j)
        if o is not None:
            g["overall"].append(o)
        if j["verdict"]:
            g["verdicts"][j["verdict"]] += 1
    out = {}
    for name, g in sorted(groups.items()):
        n, notes = g["items"], g["notes"]
        out[name] = {"items": n, "notes": notes, "objections": g["objections"], "by_severity": dict(g["by_severity"]),
                     "by_kind": dict(g["by_kind"]), "per_item": g["objections"] / n if n else None,
                     "per_100_notes": 100 * g["objections"] / notes if notes else None,
                     "share_items_with_error": g["items_with_error"] / n if n else None,
                     "mean_overall": sum(g["overall"]) / len(g["overall"]) if g["overall"] else None,
                     "verdicts": dict(g["verdicts"])}
    return out


def _mean(xs: list) -> float | None:
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def recall_comparison(key_items: dict, judgements: dict, tol: int = 1) -> dict:
    """Each recall twin (set 'recall', 'twin_of' = its control) against its control: the share of notes
    fingered alike in both keys, objections, scores, verdicts, and matched objections (Dice)."""
    by_passage: dict[str, list] = {}
    for iid, j in judgements.items():
        by_passage.setdefault(key_items[iid]["passage"], []).append((key_items[iid], j))
    pairs = []
    for pid in sorted(by_passage):
        for ki, j in by_passage[pid]:
            if ki.get("set") != "recall" or not by_passage.get(ki.get("twin_of")):
                continue
            ko, jo = by_passage[ki["twin_of"]][0]
            notes = sum(ki["n_notes"][h] for h in ki["hands"])
            fo = " ".join(ko["fingers"][h] for h in ko["hands"]).split()
            ft = " ".join(ki["fingers"][h] for h in ki["hands"]).split()
            matched = match_objections(jo["objections"], j["objections"], tol)
            no, nt = len(jo["objections"]), len(j["objections"])
            pairs.append({"control": ki["twin_of"], "recall": pid, "notes": notes,
                          "finger_agreement": sum(a == b for a, b in zip(fo, ft)) / len(fo) if fo else None,
                          "objections": [no, nt],
                          "per_100_notes": [100 * no / notes, 100 * nt / notes] if notes else [None, None],
                          "overall": [overall(jo), overall(j)], "verdict": [jo["verdict"], j["verdict"]],
                          "matched": len(matched), "dice": 2 * len(matched) / (no + nt) if no + nt else None})
    return {"pairs": pairs, "n": len(pairs),
            "mean_overall_diff": _mean([p["overall"][1] - p["overall"][0] for p in pairs if None not in p["overall"]]),
            "mean_per_100_diff": _mean([p["per_100_notes"][1] - p["per_100_notes"][0] for p in pairs
                                        if None not in p["per_100_notes"]]),
            "verdict_agreement": _mean([float(p["verdict"][0] == p["verdict"][1]) for p in pairs if None not in p["verdict"]]),
            "mean_dice": _mean([p["dice"] for p in pairs]),
            "mean_finger_agreement": _mean([p["finger_agreement"] for p in pairs])}


def hard_error_agreement(key_items: dict, judgements: dict, tol: int = 1) -> dict:
    """On hard-error passages ('hard': note id -> the annotators' unanimous finger): how often an objection
    lands within ``tol`` of a hard-error note, and how often a fix gives the annotators' finger."""
    items = hard_notes = hit = fix_on = fix_match = 0
    for iid, j in judgements.items():
        ki = key_items[iid]
        hard = ki.get("hard") or {}
        if ki.get("set") != "harderr" or not hard:
            continue
        items += 1
        named = [n for ob in j["objections"] for n in ob["notes"]]
        fixes: dict = {}
        for ob in j["objections"]:
            fixes.update(ob["fix"])
        for nid, finger in sorted(hard.items()):
            hard_notes += 1
            hit += any(_near(n, [nid], tol) for n in named)
            if nid in fixes:
                fix_on += 1
                fix_match += fixes[nid] == finger
    return {"items": items, "hard_notes": hard_notes, "hit": hit, "hit_share": hit / hard_notes if hard_notes else None,
            "fix_on_hard": fix_on, "fix_match": fix_match, "fix_match_share": fix_match / fix_on if fix_on else None}


def seed_hits(key_items: dict, judgements: dict, tol: int = 1) -> dict:
    """On low-confidence passages: reviews with an objection within ``tol`` of the seed note."""
    n = hit = 0
    for iid, j in judgements.items():
        ki = key_items[iid]
        seed = ki.get("seed_note")
        if ki.get("set") != "lowconf" or not seed:
            continue
        n += 1
        hit += any(_near(x, [seed], tol) for ob in j["objections"] for x in ob["notes"])
    return {"reviews": n, "hit": hit, "share": hit / n if n else None}
```

- [ ] **Step 3: Write `hypotheses.py`**

```python
"""Consistent objections -> dated hypotheses for docs/experiments.md (verification spec 3.12, teacher-review.md 6.1).

A member is a pair of objections the two reviewers share on a low-confidence or hard-error passage (same
kind, within one note, one-to-one: score.match_objections), or any error-severity objection of one reviewer
(the only kind a single-reviewer control passage contributes). Planted and recall twins are instrument checks
and never feed hypotheses. Kind groups of three or more become entries K1..; lint groups of three or more
that span two kinds or more become entries L1.. ('none' = no related lint rule fires: a candidate new rule).
The job only writes rows; the coordinator appends them to docs/experiments.md.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from .score import match_objections

MIN_GROUP = 3
SEVERITY_RANK = {"error": 0, "warning": 1, "info": 2}
PAIR_SETS = ("lowconf", "harderr")
SINGLE_SETS = ("control",)

KIND_LINT: dict[str, list[str]] = {
    "same_finger_chord": ["L01", "L03"], "crossed_chord": ["L02"], "impossible_span": ["L05", "L07"],
    "nonthumb_crossing": ["L06"], "thumb_pass_onto_black": ["L10"], "hop": ["L11"], "reversed_run": ["L14", "L06"],
    "thumb_on_black": ["L08"], "fifth_on_black": ["L09"], "stretch": ["L07", "L05"], "position_change": [],
    "inconsistent": [], "weak_finger": ["L14"], "repeated_note": ["L12", "L13"], "nonstandard_pattern": [], "other": [],
}

# kind -> (hypothesis, proposed change, metrics to watch)
KIND_TEXT: dict[str, tuple[str, str, str]] = {
    "hop": ("the hop penalty is too weak at the inter-onset intervals of these passages",
            "raise the hop weight below 300 ms or price hops by inter-onset interval", "PIG train macro gen and lint L11 per 1000 notes"),
    "position_change": ("the position-change cost lets the hand shift inside phrases where one position suffices",
                        "re-weight handPositionShift and positionChangeSize so shifts fall at rests and long notes",
                        "PIG train macro gen and position changes per 100 notes (spec 3.7)"),
    "inconsistent": ("repeated or sequential figures receive different fingerings",
                     "the consistent-repeats post-pass (M3 plan addition 13)",
                     "metamorphic repeated-passage check and PIG train macro gen"),
    "impossible_span": ("chord or held-note spans exceed what a medium hand can hold",
                        "check the medium profile's practical spans and the held-note law", "lint L05 per 1000 notes and PIG train macro gen"),
    "stretch": ("the solver accepts uncomfortable stretches where a closer finger is free",
                "raise the stretch weight for the medium profile", "lint L07 per 1000 notes and PIG train macro gen"),
    "same_finger_chord": ("a finger is reused while it still holds a key, or doubled inside a chord",
                          "check the chord law and the held-note law (L01, L03)", "lint L01 and L03 per 1000 notes"),
    "crossed_chord": ("chord fingers are not in pitch order", "check the chord law (L02)", "lint L02 per 1000 notes"),
    "nonthumb_crossing": ("long fingers cross each other", "raise the cost of non-thumb crossings (L06)",
                          "lint L06 per 1000 notes and PIG train macro gen"),
    "thumb_pass_onto_black": ("the thumb passes onto black keys", "raise the cost of a thumb pass onto a black key (L10)",
                              "lint L10 per 1000 notes"),
    "thumb_on_black": ("the thumb lands on black keys where a white-key finger is free",
                       "raise thumbOnBlack for the medium and beginner profiles", "lint L08 per 1000 notes and PIG train macro gen"),
    "fifth_on_black": ("the fifth finger lands on black keys next to white keys", "raise the fifth-on-black cost (L09)",
                       "lint L09 per 1000 notes"),
    "reversed_run": ("runs are fingered against the direction of motion", "check the crossing and agility terms (L06, L14)",
                     "lint L14 and L06 per 1000 notes"),
    "weak_finger": ("the weak fingers carry notes a stronger finger could take", "raise the agility cost (L14)",
                    "lint L14 per 1000 notes"),
    "repeated_note": ("repeated keys get finger changes, or same-finger repeats, against the tempo",
                      "check the repeated-note rules (L12, L13)", "lint L12 and L13 per 1000 notes"),
    "nonstandard_pattern": ("scale or arpeggio fragments do not follow the textbook fingering",
                            "extend the textbook templates to the fragments the reviewer names",
                            "textbook oracle exact matches and PIG train macro gen"),
    "other": ("the reviewer objects to something no rule names", "read the objections in the report and name the rule",
              "none until a rule is named"),
}

OUTCOME = "Open. Generated by the weekly teacher review; not a gate and not a tuning target (verification spec 3.12)."
TESTED = "To be tested on PIG train, the textbook oracle and the library, never on the test split (verification spec section 4)."


@dataclass
class Member:
    passage: str
    set: str
    source: str
    kind: str
    severity: str
    notes: list[str]
    basis: str                  # "both" | "error"
    reviewers: list[str]
    problems: list[str]
    fix: dict
    lint: list[str] | None      # lint rules at the notes; None when the key has no engine info (pilot)
    lint_key: str               # related rule that fires, "none", or "n/a"


def _set(ki: dict) -> str:
    return ki.get("set") or ki["condition"]


def _note_key(n: str) -> tuple:
    return (n[0] != "R", int(n[1:]))


def lint_key(kind: str, lint: list[str] | None) -> str:
    if lint is None:
        return "n/a"
    for rule in KIND_LINT.get(kind, []):
        if rule in lint:
            return rule
    return "none"


def _member(ki: dict, obs: list[dict], basis: str, reviewers: list[str]) -> Member:
    notes = sorted({n for o in obs for n in o["notes"]}, key=_note_key)
    engine = ki.get("engine")
    lint = None if engine is None else sorted({r for n in notes for r in (engine.get(n) or {}).get("lint", [])})
    fix: dict = {}
    for o in obs:
        fix.update(o["fix"])
    kind = obs[0]["kind"]
    return Member(passage=ki["passage"], set=_set(ki), source=ki.get("source", "pig"), kind=kind,
                  severity=min((o["severity"] for o in obs), key=SEVERITY_RANK.__getitem__), notes=notes, basis=basis,
                  reviewers=reviewers, problems=[o["problem"] for o in obs], fix=fix, lint=lint, lint_key=lint_key(kind, lint))


def members_from_pair(key_a: dict, j_a: dict, key_b: dict, j_b: dict, include=None, tol: int = 1) -> list[Member]:
    def index(key, js):
        return {(key[i]["passage"], key[i]["condition"]): (key[i], js[i]) for i in js if include is None or include(key[i])}
    a, b = index(key_a, j_a), index(key_b, j_b)
    out: list[Member] = []
    for k in sorted(set(a) | set(b)):
        if k in a and k in b:
            (ka, ja), (kb, jb) = a[k], b[k]
            pairs = match_objections(ja["objections"], jb["objections"], tol)
            used_a, used_b = {i for i, _ in pairs}, {j for _, j in pairs}
            out += [_member(ka, [ja["objections"][i], jb["objections"][j]], "both", ["a", "b"]) for i, j in pairs]
            out += [_member(ka, [o], "error", ["a"]) for i, o in enumerate(ja["objections"])
                    if i not in used_a and o["severity"] == "error"]
            out += [_member(kb, [o], "error", ["b"]) for j, o in enumerate(jb["objections"])
                    if j not in used_b and o["severity"] == "error"]
        else:
            side = "a" if k in a else "b"
            ki, js = a[k] if k in a else b[k]
            out += [_member(ki, [o], "error", [side]) for o in js["objections"] if o["severity"] == "error"]
    return out


def members_single(key_items: dict, judgements: dict, include=None) -> list[Member]:
    out = []
    for iid in sorted(judgements):
        ki = key_items[iid]
        if include is not None and not include(ki):
            continue
        out += [_member(ki, [o], "error", [ki.get("reviewer", "a")]) for o in judgements[iid]["objections"]
                if o["severity"] == "error"]
    return out


def weekly_members(key_items: dict, judgements: dict, tol: int = 1) -> list[Member]:
    def side(r):
        ks = {i: k for i, k in key_items.items() if k.get("reviewer") == r and i in judgements}
        return ks, {i: judgements[i] for i in ks}
    (ka, ja), (kb, jb) = side("a"), side("b")
    ms = members_from_pair(ka, ja, kb, jb, include=lambda ki: _set(ki) in PAIR_SETS, tol=tol)
    ms += members_single(key_items, judgements, include=lambda ki: _set(ki) in SINGLE_SETS)
    return sorted(ms, key=lambda m: (m.passage, m.kind, _note_key(m.notes[0]) if m.notes else (False, 0)))


def group_by(members: list[Member], attr: str) -> dict[str, list[Member]]:
    out: dict[str, list[Member]] = {}
    for m in members:
        out.setdefault(getattr(m, attr), []).append(m)
    return dict(sorted(out.items()))


def _counts(c: Counter) -> str:
    return ", ".join(f"{k} {v}" for k, v in sorted(c.items(), key=lambda kv: (-kv[1], kv[0])))


def _entry(gid: str, basis: str, key: str, ms: list[Member], date: str, report_name: str, titles: dict) -> dict:
    passages = sorted({m.passage for m in ms})
    sets = ", ".join(f"{k} {v}" for k, v in sorted(Counter(m.set for m in ms).items()))
    sev = ", ".join(f"{s} {c}" for s, c in sorted(Counter(m.severity for m in ms).items(), key=lambda x: SEVERITY_RANK[x[0]]))
    both = sum(m.basis == "both" for m in ms)
    evidence = (f"Evidence: docs/reviews/{report_name}, group {gid}: {both} raised by both reviewers, {len(ms) - both} "
                f"error-only; severities: {sev}; passages: {', '.join(passages)}.")
    if basis == "kind":
        hyp, change, metric = KIND_TEXT[key]
        if all(m.lint is None for m in ms):
            lint_phrase = "lint was not recorded"
        elif not KIND_LINT[key]:
            lint_phrase = "no lint rule covers this kind"
        else:
            fires = sum(m.lint_key not in ("none", "n/a") for m in ms)
            lint_phrase = f"lint {'/'.join(KIND_LINT[key])} fires at {fires} of them"
        cells = [f"Teacher review {date} ({gid}): {len(ms)} consistent objections of kind {key} in {len(passages)} "
                 f"passages ({sets}); {lint_phrase}. Hypothesis: {hyp}.",
                 f"None yet; proposed: {change}. {TESTED}", f"{metric}: current value → not run", evidence, OUTCOME]
    elif key == "none":
        kinds = Counter(m.kind for m in ms)
        cells = [f"Teacher review {date} ({gid}): no related lint rule fires at {len(ms)} consistent objections of "
                 f"{len(kinds)} kinds ({_counts(kinds)}) in {len(passages)} passages. Hypothesis: lint lacks a rule "
                 f"for what the reviewer objects to here.",
                 "None yet; proposed: draft a lint rule for the largest kind and measure its expert base rate on PIG "
                 f"before deciding law or preference (verification spec section 2, oracle 4). {TESTED}",
                 "expert base rate of the new rule on PIG: not measured → not run", evidence, OUTCOME]
    else:
        kinds = Counter(m.kind for m in ms)
        title = titles.get(key, key)
        cells = [f"Teacher review {date} ({gid}): lint {key} ({title}) also fires at {len(ms)} consistent objections of "
                 f"{len(kinds)} kinds ({_counts(kinds)}) in {len(passages)} passages. Hypothesis: the solver's cost behind "
                 f"{key} is too low where lint already flags the fingering.",
                 f"None yet; proposed: raise the solver terms that correspond to {key} and check the expert base rate of "
                 f"{key} on PIG. {TESTED}", f"lint {key} per 1000 notes on the library and PIG train macro gen: current "
                 "value → not run", evidence, OUTCOME]
    return {"id": gid, "basis": basis, "key": key, "members": len(ms), "both": both, "passages": passages,
            "sets": dict(Counter(m.set for m in ms)), "kinds": dict(Counter(m.kind for m in ms)),
            "severity": dict(Counter(m.severity for m in ms)), "date": date, "cells": cells}


def hypotheses(members: list[Member], date: str, report_name: str, lint_titles: dict | None = None) -> list[dict]:
    titles = {k: (v["title"] if isinstance(v, dict) else v) for k, v in (lint_titles or {}).items()}
    out = []
    kinds = sorted(((k, ms) for k, ms in group_by(members, "kind").items() if len(ms) >= MIN_GROUP),
                   key=lambda kv: (-len(kv[1]), kv[0]))
    for n, (kind, ms) in enumerate(kinds, 1):
        out.append(_entry(f"K{n}", "kind", kind, ms, date, report_name, titles))
    lints = sorted(((k, ms) for k, ms in group_by(members, "lint_key").items()
                    if k != "n/a" and len(ms) >= MIN_GROUP and len({m.kind for m in ms}) >= 2),
                   key=lambda kv: (-len(kv[1]), kv[0]))
    for n, (key, ms) in enumerate(lints, 1):
        out.append(_entry(f"L{n}", "lint", key, ms, date, report_name, titles))
    return out


def experiments_rows(hyps: list[dict]) -> str:
    """Rows in docs/experiments.md's format: | Date | Hypothesis | Change | Primary metric before → after |
    Other effects | Outcome |."""
    return "".join("| " + " | ".join([h["date"]] + [c.replace("|", "/") for c in h["cells"]]) + " |\n" for h in hyps)
```

`hypotheses()` accepts `lint_titles` either as `{rule: title}` or as the dump's `lintRules` (`{rule: {"title", "law"}}`).

- [ ] **Step 4: Run the tests**

Run: `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests -q`
Expected: all pass (5 new score tests, 6 hypothesis tests). If the pilot counts differ from 42/33/27 or the group sizes, the matching rule differs from decision 12. Fix the rule, not the numbers.

- [ ] **Step 5: Hand-off**

Paths: `research/teacher_review/score.py`, `research/teacher_review/tests/test_score.py`, `research/teacher_review/hypotheses.py`, `research/teacher_review/tests/test_hypotheses.py`. Message: `research(teacher-review): weekly measurements and consistent-objection hypotheses`.

---

### Task 7: `report.py`, the weekly report, its summary and the PIG audit

**Files:**

- Create: `research/teacher_review/report.py`, `research/teacher_review/tests/test_report.py`

**Interfaces:**

- Consumes: `score.fault_detection`, `consistency`, `readback`, `cost`, `rates_by`, `recall_comparison`, `hard_error_agreement`, `seed_hits`, `overall`; `hypotheses.weekly_members`, `hypotheses.hypotheses`, `hypotheses.experiments_rows`; the pilot summary `research/teacher_review/results/summary.json`.
- Produces:

```python
@dataclass
class Day:
    date: str; meta: dict; key_items: dict; judgements: dict; collect_report: dict; renders: dict; dispatch_log: dict | None
class PigLeak(RuntimeError)
SET_ORDER = ["lowconf", "harderr", "control", "recall", "planted"]
def load_day(day: Path) -> Day                                    # key.json, judgements.json, collect_report.json, items/*.txt, dispatch_log.json
def build_report(day: Day, pilot: dict, prior: list[dict]) -> tuple[str, dict, str]   # markdown, summary, experiments rows
def audit_no_pig(day: Day, *texts: str) -> None                   # raises PigLeak
```

**The report** (headings fixed, in this order):

```
# Teacher review, <date>

- Date / Engine (version, commit from meta.bench.gitSha[:7], profile, weight set, weights hash) / Inputs (dump, bench label,
  PIG test gen and hard-error rate) / Reviewers (launch count, framing scheme, model Opus) / Use (qualitative oracle,
  never a gate, never tuned on; spec 3.12)

## Passages          table | set | what it is | passages | item reviews | reviewed notes per review |
## Reviewer controls
### Planted faults    table | kind | planted | by position | by kind | with severity error |  (+ the pilot's pooled row for reference)
### Agreement between the two reviewers   table | items | Pearson (overall) | Spearman | mean abs diff | verdict agreement | objection-note Jaccard |
### Read-back         one line: hands, exact share, digit errors
### Drift over time   table | run | planted found by position | by kind | control objections per 100 notes | read-back exact | reviewer verdict agreement |
## Objection rates per set   table | set | items | notes | objections | per item | per 100 notes | error | warning | info | items with an error |
                             then one line per set: mean overall score and verdicts
## Low-confidence notes      "An objection names the low-confidence note (within one note) in k of n reviews (x%)."
## Recall control            per pair: control id, piece title and bars, notes, fingers alike, objections per 100 notes (control / recall),
                             overall, verdicts, matched objections; then the means and one sentence of reading
## Hard-error passages       counts only: passages, hard-error notes, hit share, fix = annotators' finger share, objections by
                             kind and severity, consistent members; per-piece passage counts by opaque id
## Hypotheses                one bullet per entry (id, key, members, passages, lint phrase, hypothesis, proposal);
                             then "Rows for docs/experiments.md: research/teacher_review/results/weekly/<date>/hypotheses.md
                             (the coordinator appends them)."
## Three instructive objections   library members only (sets lowconf and control), ranked by (severity, both reviewers first,
                             lint 'none' first, a fix given first, passage, first note), at most one per passage; each quoted
                             with the rendered lines of its notes, the engine's fingers and confidences, the lint rules, every
                             reviewer's problem text verbatim and the fix. None: "No library passage had a consistent objection
                             this week."
## Cost                      score.cost(collect_report) plus, when dispatch_log.json exists, total and median tokens per batch
## Limits of this run        fixed bullets: small control samples (planted passages, recall pairs), one model family, PIG bars
                             estimated, user-edited passages out of scope until M5, the brief's "expert" sentence kept for
                             comparability, never a gate
```

Formats:

- Counts with shares are written `183 (99%)`.
- Rates use two decimals.
- A share in a rate table is written `4%`.
- A missing value is written `n/a`.

**`summary.json`**, committed:

- `date` and `meta`.
- `sets`: passages and item reviews per set.
- `rates`: `rates_by` per set.
- `planted`: `fault_detection` without `rows`.
- `agreement`: `consistency` over a/b pairs.
- `readback`.
- `drift`: `planted_pos`, `planted_kind`, `control_per_100`, `readback` and `verdict_agreement`.
- `seed_hits`.
- `recall`: `recall_comparison`.
- `hard_errors`: `hard_error_agreement`.
- `hypotheses`: the entries, without members' problem texts.
- `instructive`: library quotes.
- `library_passages`: passage, set, slug, title, bars and hands.
- `pig_passages`: exactly the keys `passage`, `notes`, `hard_errors`, `objections`, `errors` and `consistent`.
- `cost`.

**Audit:** `audit_no_pig` collects the forbidden strings and raises `PigLeak` naming the item when any text contains one. The forbidden strings are:

- every objection `problem` of 24 characters or more on a PIG item (shorter generic phrases could match template text by chance);
- every pair of consecutive note lines (lines matching `^[RL]\d`, joined with `\n`) of every PIG item's rendering in `day.renders`.

- [ ] **Step 1: Write the failing tests**

`research/teacher_review/tests/test_report.py`:

```python
"""report: the weekly report, its summary, the drift table and the PIG audit."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from teacher_review.render import render_passage
from teacher_review.report import Day, PigLeak, audit_no_pig, build_report

from .conftest import make_passage

RESULTS = Path(__file__).resolve().parents[1] / "results"
PILOT = json.loads((RESULTS / "summary.json").read_text(encoding="utf-8"))


def _pilot_day():
    """The pilot's committed results seen as a weekly run: run A = reviewer a, run B = reviewer b; FHMM3 passages
    play the low-confidence set, corrupted passages the planted control, expert passages stay 'expert'."""
    sets = {"expert": "expert", "fhmm3": "lowconf", "corrupted": "planted"}
    items, js, batches = {}, {}, {}
    for run, rev in (("A", "a"), ("B", "b")):
        key = json.loads((RESULTS / run / "key.json").read_text(encoding="utf-8"))["items"]
        jud = json.loads((RESULTS / run / "judgements.json").read_text(encoding="utf-8"))
        for iid, ki in key.items():
            items[f"{run}:{iid}"] = dict(ki, set=sets[ki["condition"]], source="pig", reviewer=rev)
            js[f"{run}:{iid}"] = jud[iid]
        batches.update(json.loads((RESULTS / run / "collect_report.json").read_text(encoding="utf-8"))["batches"])
    report = {"batches": batches, "problems": [], "missing_items": [], "n_items": len(js)}
    return Day(date="2026-10-14", meta={}, key_items=items, judgements=js, collect_report=report, renders={},
               dispatch_log=None)


def test_report_on_the_pilot_results():
    day = _pilot_day()
    md, summary, rows = build_report(day, PILOT, [])
    assert "| all | 184 | 183 (99%) | 174 (95%) | 124 (67%) |" in md
    assert "| 120 | 0.95 | 0.95 | 0.67 | 81% | 0.65 |" in md
    assert "| expert | 80 | 2014 | 51 | 0.64 | 2.53 | 3 | 28 | 20 | 4% |" in md
    assert "| 2026-10-13 (pilot) | 99% | 95% | 2.53 | 100% | 81% |" in md
    assert "| 2026-10-14 | 99% | 95% | n/a | 100% | 81% |" in md
    assert [h["key"] for h in summary["hypotheses"]] == [
        "hop", "impossible_span", "inconsistent", "other", "same_finger_chord", "stretch", "position_change"]
    assert "(K1): 9 consistent objections of kind hop in 8 passages (lowconf 9)" in rows
    assert [ln for ln in md.splitlines() if ln.startswith("## ")] == [
        "## Passages", "## Reviewer controls", "## Objection rates per set", "## Low-confidence notes",
        "## Recall control", "## Hard-error passages", "## Hypotheses", "## Three instructive objections", "## Cost",
        "## Limits of this run"]
    assert "No library passage had a consistent objection this week." in md
    blob = md + json.dumps(summary, ensure_ascii=False) + rows
    assert "Octave B1-B2 fingered 5-4; the 4-5 pair cannot span more than a third." not in blob
    audit_no_pig(day, md, json.dumps(summary, ensure_ascii=False), rows)
    assert len(md.encode("utf-8")) < 900_000 and len(json.dumps(summary).encode("utf-8")) < 900_000


def _library_item(pid, rev, p, engine_lint=None, set_name="lowconf"):
    hands = ["R"]
    engine = {nid: {"id": f"n{i}", "finger": f, "confidence": 0.4, "lint": (engine_lint or {}).get(nid, [])}
              for i, (nid, _, f, _, _) in enumerate(p.notes("R"))}
    return {"passage": pid, "set": set_name, "source": "library", "condition": "engine", "reviewer": rev, "piece": f"slug-{pid}",
            "title": f"Title {pid}", "level": 2, "bars": [3, 4], "hands": hands, "n_notes": {"R": len(p.notes("R"))},
            "fingers": {"R": p.finger_string("R")}, "faults": [], "alt": {}, "engine": engine, "hard": {}, "seed_note": "R2"}


def _j(obs):
    return {"scores": {"possible": 3, "idiomatic": 3, "economical": 2, "consistent": 3, "beginner_friendly": 3},
            "verdict": "acceptable", "verdict_rank": 2, "objections": obs, "comment": "",
            "readback": {"R": {"n": 8, "errors": 0, "exact": True, "length_ok": True}}}


def _o(notes, kind, sev, problem, fix=None):
    return {"notes": notes, "kind": kind, "severity": sev, "problem": problem, "fix": fix or {}}


def _synthetic_day():
    p = make_passage([(i * 0.5, 0.5, [60 + i], [1 + i % 5]) for i in range(8)], pid="it-0000")
    pp = make_passage([(i * 0.5, 0.5, [74 + i], [5 - i % 5]) for i in range(8)], pid="it-0000")   # the PIG passage
    items, js, renders = {}, {}, {}

    def add(iid, ki, obs, passage=p):
        items[iid], js[iid] = ki, _j(obs)
        q = passage.copy()
        q.passage_id = iid
        renders[iid] = render_passage(q)

    # lc01: a shared warning hop where lint L11 fires, with a fix
    add("it-0101", _library_item("lc01", "a", p, {"R3": ["L11"]}), [_o(["R3"], "hop", "warning", "Hop from R3 to R4 at speed.", {"R4": 2})])
    add("it-0102", _library_item("lc01", "b", p, {"R3": ["L11"]}), [_o(["R4"], "hop", "warning", "Finger 3 hops to R4.", {"R4": 2})])
    # lc02: one reviewer's error with a fix (lint silent)
    add("it-0201", _library_item("lc02", "a", p), [_o(["R5"], "same_finger_chord", "error", "Finger 1 is still holding C4.", {"R5": 2})])
    add("it-0202", _library_item("lc02", "b", p), [])
    # lc03: a shared warning where lint is silent, with a fix
    add("it-0301", _library_item("lc03", "a", p), [_o(["R2"], "position_change", "warning", "Needless shift at R2.", {"R2": 2})])
    add("it-0302", _library_item("lc03", "b", p), [_o(["R2"], "position_change", "warning", "The hand shifts for nothing.", {"R2": 2})])
    # lc04: a shared info without a fix
    add("it-0401", _library_item("lc04", "a", p), [_o(["R1"], "other", "info", "A matter of taste here.")])
    add("it-0402", _library_item("lc04", "b", p), [_o(["R1"], "other", "info", "Could also start with 2.")])
    # he01: a PIG passage both reviewers object to
    pig = dict(_library_item("he01", "a", pp), set="harderr", source="pig", title="", hard={"R3": 2})
    add("it-0901", pig, [_o(["R3"], "hop", "warning", "PIGSECRET: finger 2 hops from D5 to E5 at speed.")], pp)
    add("it-0902", dict(pig, reviewer="b"), [_o(["R3"], "hop", "warning", "PIGSECRET: the same hop again, D5 to E5.")], pp)
    rep = {"batches": {"01a": {"wall_s": 540.0, "chars_in": 20000, "chars_out": 7000, "n_items": 5},
                       "01b": {"wall_s": 600.0, "chars_in": 20000, "chars_out": 6000, "n_items": 5}},
           "problems": [], "missing_items": [], "n_items": len(js)}
    return Day(date="2099-01-01", meta={"engineVersion": "test"}, key_items=items, judgements=js, collect_report=rep,
               renders=renders, dispatch_log=None)


def test_instructive_objections_rank_and_quote_library_only():
    md, summary, _ = build_report(_synthetic_day(), PILOT, [])
    section = md.split("## Three instructive objections", 1)[1].split("## Cost", 1)[0]
    heads = [ln for ln in section.splitlines() if ln.startswith("### ")]
    assert [h.split()[2].rstrip(":,") for h in heads] == ["lc02", "lc03", "lc01"]
    assert "Finger 1 is still holding C4." in section and "A matter of taste here." not in section
    assert [q["passage"] for q in summary["instructive"]] == ["lc02", "lc03", "lc01"]


def test_pig_items_appear_only_as_counts():
    day = _synthetic_day()
    md, summary, rows = build_report(day, PILOT, [])
    blob = md + json.dumps(summary, ensure_ascii=False) + rows
    assert "PIGSECRET" not in blob
    (pig,) = summary["pig_passages"]
    assert set(pig) == {"passage", "notes", "hard_errors", "objections", "errors", "consistent"}
    audit_no_pig(day, md, json.dumps(summary, ensure_ascii=False), rows)
    lines = [ln for ln in day.renders["it-0901"].splitlines() if ln[:1] in "RL" and ln[1:2].isdigit()]
    with pytest.raises(PigLeak):
        audit_no_pig(day, md + "\n" + "\n".join(lines[2:4]))
    with pytest.raises(PigLeak):
        audit_no_pig(day, md, "PIGSECRET: finger 2 hops from D5 to E5 at speed.")


def test_drift_table_lists_earlier_weeks_in_date_order():
    prior = [{"date": "2026-10-07", "drift": {"planted_pos": 0.9, "planted_kind": 0.8, "control_per_100": 3.1,
                                              "readback": 1.0, "verdict_agreement": 0.75}}]
    md, summary, _ = build_report(_synthetic_day(), PILOT, prior)
    table = [ln for ln in md.split("### Drift over time", 1)[1].splitlines() if ln.startswith("| 20")]
    assert [ln.split(" | ")[0] for ln in table] == ["| 2026-10-13 (pilot)", "| 2026-10-07", "| 2099-01-01"]
    assert table[1] == "| 2026-10-07 | 90% | 80% | 3.10 | 100% | 75% |"
    assert summary["drift"]["control_per_100"] is None
```

Run: `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests/test_report.py -q`
Expected: FAIL (`ModuleNotFoundError: teacher_review.report`).

- [ ] **Step 2: Write `report.py`**

Implement the module to the spec above. The pieces with exact formats:

```python
"""The weekly teacher-review report: docs/reviews/teacher-<date>.md, results/weekly/<date>/summary.json and
the rows for docs/experiments.md. Library passages may be quoted; PIG passages appear only by opaque id and
counts (audit_no_pig). Never a gate and never a number to tune on (verification spec 3.12)."""
from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from .collect import CRITERIA
from .hypotheses import SEVERITY_RANK, experiments_rows, hypotheses, weekly_members
from .inject import KINDS as FAULT_KINDS
from .score import (consistency, cost, fault_detection, hard_error_agreement, rates_by, readback, recall_comparison,
                    seed_hits)

SET_ORDER = ["lowconf", "harderr", "control", "recall", "planted"]
SET_WHAT = {"lowconf": "around the engine's lowest-confidence library notes",
            "harderr": "around the hard errors of the PIG bench gallery",
            "control": "random level 1 to 3 library passages",
            "recall": "controls again, composer hidden, transposed by a tritone and re-fingered",
            "planted": "controls with two or three planted faults"}
_NOTE_LINE = re.compile(r"^[RL]\d")


class PigLeak(RuntimeError):
    pass


@dataclass
class Day:
    date: str
    meta: dict
    key_items: dict
    judgements: dict
    collect_report: dict
    renders: dict
    dispatch_log: dict | None


def load_day(day: Path) -> Day:
    day = Path(day)
    key = json.loads((day / "key.json").read_text(encoding="utf-8"))
    log = day / "dispatch_log.json"
    return Day(date=key["date"], meta=key.get("meta", {}), key_items=key["items"],
               judgements=json.loads((day / "judgements.json").read_text(encoding="utf-8")),
               collect_report=json.loads((day / "collect_report.json").read_text(encoding="utf-8")),
               renders={p.stem: p.read_text(encoding="utf-8") for p in sorted((day / "items").glob("*.txt"))},
               dispatch_log=json.loads(log.read_text(encoding="utf-8")) if log.exists() else None)


def _pct(x) -> str:
    return "n/a" if x is None else f"{100 * x:.0f}%"


def _num(x, d=2) -> str:
    return "n/a" if x is None else f"{x:.{d}f}"


def _share(c: int, n: int) -> str:
    return f"{c} ({100 * c / n:.0f}%)" if n else f"{c} (n/a)"


def _split(day: Day):
    def side(r):
        ks = {i: k for i, k in day.key_items.items() if k.get("reviewer") == r and i in day.judgements}
        return ks, {i: day.judgements[i] for i in ks}
    return side("a"), side("b")


def planted_table(key_items: dict, judgements: dict) -> tuple[str, dict]:
    fd = fault_detection(key_items, judgements)
    lines = ["| kind | planted | by position | by kind | with severity error |", "|---|---|---|---|---|"]
    for k in FAULT_KINDS:
        c = fd["per_kind"][k]
        if c.get("planted"):
            lines.append(f"| {k} | {c['planted']} | {_share(c['detected_pos'], c['planted'])} | "
                         f"{_share(c['detected_kind'], c['planted'])} | {_share(c['detected_error'], c['planted'])} |")
    t = fd["total"]
    n = t.get("planted", 0)
    lines.append(f"| all | {n} | {_share(t.get('detected_pos', 0), n)} | {_share(t.get('detected_kind', 0), n)} | "
                 f"{_share(t.get('detected_error', 0), n)} |")
    fd.pop("rows", None)
    return "\n".join(lines), fd


def agreement_table(c: dict) -> str:
    return "\n".join(["| items | Pearson (overall) | Spearman | mean abs diff | verdict agreement | objection-note Jaccard |",
                      "|---|---|---|---|---|---|",
                      f"| {c['items']} | {_num(c['overall_pearson'])} | {_num(c['overall_spearman'])} | "
                      f"{_num(c['mean_abs_diff_overall'])} | {_pct(c['verdict_agreement'])} | "
                      f"{_num(c['objection_note_jaccard_mean'])} |"])


def rates_table(rates: dict) -> str:
    order = [s for s in SET_ORDER if s in rates] + sorted(s for s in rates if s not in SET_ORDER)
    lines = ["| set | items | notes | objections | per item | per 100 notes | error | warning | info | items with an error |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for s in order:
        r = rates[s]
        sev = r["by_severity"]
        lines.append(f"| {s} | {r['items']} | {r['notes']} | {r['objections']} | {_num(r['per_item'])} | "
                     f"{_num(r['per_100_notes'])} | {sev.get('error', 0)} | {sev.get('warning', 0)} | {sev.get('info', 0)} | "
                     f"{_pct(r['share_items_with_error'])} |")
    return "\n".join(lines)


def drift_row(label: str, d: dict) -> str:
    return (f"| {label} | {_pct(d['planted_pos'])} | {_pct(d['planted_kind'])} | {_num(d['control_per_100'])} | "
            f"{_pct(d['readback'])} | {_pct(d['verdict_agreement'])} |")


def pilot_drift(pilot: dict) -> dict:
    t = pilot["pooled"]["fault_detection"]["total"]
    return {"planted_pos": t["sensitivity_pos"], "planted_kind": t["sensitivity_kind"],
            "control_per_100": pilot["pooled"]["false_positives"]["expert"]["per_100_notes"],
            "readback": pilot["pooled"]["readback"]["exact_share"],
            "verdict_agreement": pilot["consistency"]["verdict_agreement"]}
```

`build_report(day, pilot, prior)` composes the sections in the order above:

- Planted table: `planted_table` over all items whose set is `planted` (in the pilot-shaped test, the 80 corrupted items of both reviewers: 184 faults).
- Agreement: `agreement_table(consistency(ka, ja, kb, jb))` over the a/b split.
- Read-back: `readback(day.judgements)`.
- Drift: the pilot row (`2026-10-13 (pilot)`), then the earlier weeks from `prior` sorted by date (each row from its own summary's `drift`), then this run.
- This run's drift block:
  - `planted_pos` and `planted_kind` come from the planted fault detection totals.
  - `control_per_100` comes from `rates["control"]["per_100_notes"]`, or `None` without controls.
  - `readback` is the read-back exact share.
  - `verdict_agreement` comes from the a/b consistency.
- Rates: `rates_table(rates_by(day.key_items, day.judgements))`.
- Seed hits, `recall_comparison` and `hard_error_agreement` fill their sections.
- Hypotheses: `hypotheses(weekly_members(...), day.date, f"teacher-{day.date}.md", day.meta.get("lintRules"))`. `experiments_rows` gives the third return value.

The instructive objections are `weekly_members` with `source == "library"` and set in `("lowconf", "control")`, sorted by `(SEVERITY_RANK[severity], basis != "both", lint_key != "none", not fix, passage, first note)`, keeping the first per passage, up to three. Each is quoted as follows:

- A heading `### <k>. <passage>: <title>, bars <b1>-<b2>, <right hand|left hand|both hands> (<low-confidence passage|control passage>)`.
- The note lines of its notes from any rendering of that passage in `day.renders`, in a fenced block.
- `Engine: R5 3 (confidence 0.40); lint at these notes: L11 (or none).`
- One line per reviewer problem in plain double quotes, then `Fix: R5→2`.

`audit_no_pig(day, *texts)` builds the forbidden strings described above from `day.key_items`, `day.judgements` and `day.renders`, and raises `PigLeak(f"{iid}: {what}")` on the first hit.

- [ ] **Step 3: Run the tests**

Run: `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests -q`
Expected: all pass (Task 7 adds 4 tests).

- [ ] **Step 4: Hand-off**

Paths: `research/teacher_review/report.py`, `research/teacher_review/tests/test_report.py`. Message: `research(teacher-review): weekly report, summary, drift table and PIG audit`.

---

### Task 8: `weekly.py`, the entry point, and the README

**Files:**

- Create: `research/teacher_review/weekly.py`, `research/teacher_review/tests/test_weekly.py`
- Modify: `research/teacher_review/README.md` (new section), `research/teacher_review/tests/weekly_fixtures.py` (`cli_dump`)

**Interfaces:**

- Commands, run from the repository root:

```
research/.venv/Scripts/python.exe -I research/teacher_review/weekly.py build   --date YYYY-MM-DD [--seed N] [--profile medium]
        [--weight-set ID] [--dump FILE] [--gallery DIR] [--force] [--data-dir DIR] [--results-dir DIR]
research/.venv/Scripts/python.exe -I research/teacher_review/weekly.py collect --date YYYY-MM-DD [--data-dir DIR]
research/.venv/Scripts/python.exe -I research/teacher_review/weekly.py report  --date YYYY-MM-DD [--allow-missing]
        [--data-dir DIR] [--results-dir DIR] [--docs-dir DIR]
research/.venv/Scripts/python.exe -I research/teacher_review/weekly.py where
```

- Defaults:
  - `--data-dir research/data/teacher_review/weekly`
  - `--results-dir research/teacher_review/results/weekly`
  - `--docs-dir docs/reviews`
  - `--seed` is the date as an integer.
  - `--profile medium`.
- Exit codes:
  - `0` on success.
  - `1` from `build` when reviewer outputs exist without `--force`, when the gallery disagrees with the dump, or when bench or the dump fail.
  - `1` from `collect` when items are missing.
  - `1` from `report` when items are missing without `--allow-missing`, or when the PIG audit fails.
  - `2` on a usage error.
- `build` prints exactly these five lines (numbers illustrative):

```
bench: teacher-2026-10-14, gallery research/data/teacher_review/weekly/2026-10-14/bench/errors/teacher-2026-10-14 (30 pages, 935 hard-error rows)
dump: 90 pieces (30 library, 30 tritone, 30 PIG), engine 0.1.0, profile medium, weight set parncutt-defaults
selected: lowconf 20, harderr 16, control 10, planted 4, recall 4 (hard errors skipped: unusable grid 251, not in the quantised piece 0, not covered 376)
batches: 8 (lowconf 3 x2, harderr 2 x2, control 3 x1) -> 13 reviewer launches, 90 item reviews
launches: research/data/teacher_review/weekly/2026-10-14/launches.md
```

- [ ] **Step 1: Add the CLI fixture**

Append to `research/teacher_review/tests/weekly_fixtures.py`:

```python
def cli_dump(path):
    """A synthetic library of eight level 1 to 3 pieces (and two harder ones), each with its tritone copy, written
    as a dump file for the CLI tests."""
    pieces = []
    for k, level in enumerate([1, 2, 3, 1, 2, 3, 2, 1, 4, 5]):
        rh = eighths(12, shift=k, conf={(3 + k % 5, 1): 0.2 + 0.01 * k, (9, 2): 0.3})
        pieces.append(lib_piece(f"cli-{k:02d}", rh=rh, lh=chords(12), bars=12, level=level))
        tt = [dict(n, finger=2) if i == 2 else n for i, n in enumerate(rh)]
        pieces.append(lib_piece(f"cli-{k:02d}", rh=tt, lh=chords(12), bars=12, level=level, transpose=6))
    Path(path).write_text(json.dumps(fake_dump(*pieces)), encoding="utf-8")
    return path
```

- [ ] **Step 2: Write the failing tests**

`research/teacher_review/tests/test_weekly.py`:

```python
"""weekly.py: the whole job from the command line (synthetic dump, empty gallery, fake reviewers)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from .weekly_fixtures import REPO, cli_dump, fake_reviews, gallery_page

WEEKLY = Path(__file__).resolve().parents[1] / "weekly.py"


def run(*args, isolated=True):
    flags = ["-I"] if isolated else []
    return subprocess.run([sys.executable, *flags, str(WEEKLY), *args], cwd=REPO, capture_output=True, text=True,
                          encoding="utf-8", timeout=600)


def test_cli_imports_this_checkout():
    r = run("where")
    assert r.returncode == 0, r.stderr
    assert Path(r.stdout.strip()) == WEEKLY.parent.resolve()


def test_cli_without_isolation_still_runs():
    r = run("where", isolated=False)          # select.py must not shadow the standard library's select
    assert r.returncode == 0, r.stderr
    assert Path(r.stdout.strip()) == WEEKLY.parent.resolve()


def _dirs(tmp_path):
    return ["--data-dir", str(tmp_path / "data"), "--results-dir", str(tmp_path / "results")]


def _build(tmp_path, *extra):
    gallery = tmp_path / "gallery"
    gallery.mkdir(exist_ok=True)
    dump = cli_dump(tmp_path / "dump.json")
    return run("build", "--date", "2099-01-01", "--dump", str(dump), "--gallery", str(gallery), *_dirs(tmp_path), *extra)


def _snapshot(root: Path) -> dict:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def test_build_is_deterministic_and_refuses_to_overwrite_outputs(tmp_path):
    r = _build(tmp_path)
    assert r.returncode == 0, r.stderr
    assert r.stdout.splitlines()[2].startswith("selected: lowconf ")
    day = tmp_path / "data" / "2099-01-01"
    for name in ("key.json", "launches.json", "launches.md", "selection.json"):
        assert (day / name).exists()
    launches = json.loads((day / "launches.json").read_text(encoding="utf-8"))
    assert {l["pool"] for l in launches} == {"lowconf", "control"}
    first = _snapshot(tmp_path / "data") | {f"results/{k}": v for k, v in _snapshot(tmp_path / "results").items()}
    assert _build(tmp_path, "--force").returncode == 0
    second = _snapshot(tmp_path / "data") | {f"results/{k}": v for k, v in _snapshot(tmp_path / "results").items()}
    assert first == second
    (day / "out" / "batch-01a.json").write_text("{}", encoding="utf-8")
    r = _build(tmp_path)
    assert r.returncode == 1 and "already holds reviewer outputs" in r.stderr


def test_build_refuses_a_gallery_from_another_engine(tmp_path):
    gallery = tmp_path / "gallery"
    gallery.mkdir()
    (gallery / "001.md").write_text(gallery_page("001", [(3, "R", "C4", 2, 40, [1, 1, 1], True)]), encoding="utf-8")
    dump = cli_dump(tmp_path / "dump.json")
    r = run("build", "--date", "2099-01-01", "--dump", str(dump), "--gallery", str(gallery), *_dirs(tmp_path))
    assert r.returncode == 1 and "001: the dump has no PIG piece 001" in r.stderr


def test_collect_and_report(tmp_path):
    assert _build(tmp_path).returncode == 0
    day = tmp_path / "data" / "2099-01-01"

    def objections(ki):
        return [{"notes": [f"{ki['hands'][0]}2"], "kind": "hop", "severity": "warning", "problem": "Hop at speed.",
                 "fix": {f"{ki['hands'][0]}2": 2}}] if ki["set"] == "lowconf" else []

    fake_reviews(day, objections=objections)
    r = run("collect", "--date", "2099-01-01", *_dirs(tmp_path))
    assert r.returncode == 0, r.stdout + r.stderr
    docs = tmp_path / "docs"
    r = run("report", "--date", "2099-01-01", *_dirs(tmp_path), "--docs-dir", str(docs))
    assert r.returncode == 0, r.stdout + r.stderr
    md = (docs / "teacher-2099-01-01.md").read_text(encoding="utf-8")
    assert md.startswith("# Teacher review, 2099-01-01\n")
    results = tmp_path / "results" / "2099-01-01"
    summary = json.loads((results / "summary.json").read_text(encoding="utf-8"))
    assert summary["date"] == "2099-01-01" and summary["hypotheses"][0]["key"] == "hop"
    assert (results / "hypotheses.md").read_text(encoding="utf-8").splitlines()[1].startswith("| 2099-01-01 | Teacher review")
    assert sum(p.stat().st_size for p in results.rglob("*") if p.is_file()) < 400_000
```

Run: `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests/test_weekly.py -q`
Expected: FAIL (the script does not exist).

- [ ] **Step 3: Write `weekly.py`**

```python
"""Weekly teacher review (verification spec 3.12): build | collect | report | where.

Run by path from the repository root, never with -m: in a worktree the shared research/.venv puts the
main checkout's research/ on sys.path, so -m would run the main checkout's harness.

    research/.venv/Scripts/python.exe -I research/teacher_review/weekly.py build --date 2026-10-14
    (the coordinator launches one Opus reviewer per row of research/data/teacher_review/weekly/<date>/launches.json)
    research/.venv/Scripts/python.exe -I research/teacher_review/weekly.py collect --date 2026-10-14
    research/.venv/Scripts/python.exe -I research/teacher_review/weekly.py report --date 2026-10-14
"""
from __future__ import annotations

import sys
from pathlib import Path

if __package__ in (None, ""):
    _here = Path(__file__).resolve().parent
    # without -I Python puts this directory first, where select.py would shadow the standard library's select
    sys.path[:] = [p for p in sys.path if Path(p or ".").resolve() != _here]
    sys.path.insert(0, str(_here.parent))

import argparse  # noqa: E402
import json  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402

import teacher_review  # noqa: E402
from teacher_review import dispatch, gallery, report, select  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
ENGINE_CLI = REPO / "packages" / "engine" / "dist" / "cli" / "main.js"
ENGINE_DUMP = HERE / "engine_dump.mjs"


def _err(msg: str) -> int:
    print(f"weekly: {msg}", file=sys.stderr)
    return 1


def _node() -> str:
    node = shutil.which("node")
    if not node:
        raise SystemExit("weekly: node is not on PATH")
    return node


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, encoding="utf-8")


def run_bench(day: Path, args) -> tuple[Path, dict]:
    label = f"teacher-{args.date}"
    runs = day / "bench" / "runs"
    cmd = [_node(), str(ENGINE_CLI), "bench", "--gold", "research/data/pig", "--split", "research/data/splits/pig_official.json",
           "--subset", "test", "--profile", args.profile, "--label", label, "--out", runs.as_posix()]
    if args.weight_set:
        usage = _run([_node(), str(ENGINE_CLI)])
        if "--weights" not in usage.stdout + usage.stderr:
            raise SystemExit("weekly: this engine's bench has no --weights (M3 not merged); omit --weight-set")
        cmd += ["--weights", args.weight_set]
    r = _run(cmd)
    if r.returncode != 0:
        raise SystemExit(f"weekly: bench failed\n{r.stderr}")
    card = json.loads(next(runs.glob(f"*-{label}.json")).read_text(encoding="utf-8"))
    return day / "bench" / "errors" / label, {"label": label, "gitSha": card.get("gitSha"), "profile": card.get("profile"),
                                              "gen": card["macro"]["gen"], "hardErrorRate": card["macro"]["hardErrorRate"],
                                              "weightsHash": card.get("weightsHash")}


def run_dump(day: Path, args, pig_ids: list[str]) -> Path:
    out = day / "dump.json"
    cmd = [_node(), str(ENGINE_DUMP), "--out", out.as_posix(), "--manifest", "content/manifest.json", "--tritone",
           "--profile", args.profile]
    if pig_ids:
        cmd += ["--pig-dir", "research/data/pig", "--pig-pieces", ",".join(pig_ids)]
    if args.weight_set:
        cmd += ["--weight-set", args.weight_set]
    r = _run(cmd)
    if r.returncode != 0:
        raise SystemExit(f"weekly: engine dump failed\n{r.stderr}")
    return out


def build(args) -> int:
    day = Path(args.data_dir) / args.date
    out_dir = day / "out"
    if out_dir.exists() and any(out_dir.glob("*.json")) and not args.force:
        return _err(f"{out_dir} already holds reviewer outputs; use --force to rebuild")
    day.mkdir(parents=True, exist_ok=True)
    seed = args.seed if args.seed is not None else int(args.date.replace("-", ""))
    if args.gallery:
        gallery_dir, bench = Path(args.gallery), {"label": None}
    else:
        gallery_dir, bench = run_bench(day, args)
    rows = gallery.read_gallery(gallery_dir)
    hard_pages = sorted(pid for pid, rs in rows.items() if any(r.hard for r in rs))
    dump_path = Path(args.dump) if args.dump else run_dump(day, args, hard_pages)
    dump = json.loads(dump_path.read_text(encoding="utf-8"))
    problems = gallery.check_against_dump(rows, dump)
    if problems:
        return _err("the gallery does not describe the dumped engine:\n  " + "\n  ".join(problems[:20]))
    sel = select.select_all(dump, rows, seed)
    (day / "selection.json").write_text(json.dumps(sel, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n")
    passages = select.build_passages(sel["records"], dump)
    meta = {"engineVersion": dump["engineVersion"], "profile": dump["profile"], "weightSet": dump["weightSet"],
            "weightsHash": dump["weightsHash"], "lintRules": dump["lintRules"], "bench": bench, "seed": seed,
            "skipped": sel["skipped"], "counts": sel["counts"]}
    key = dispatch.write_day(day, Path(args.results_dir) / args.date, sel["records"], passages, seed=seed,
                             date=args.date, meta=meta)
    kinds = {"library": 0, "tritone": 0, "pig": 0}
    for p in dump["pieces"]:
        kinds["pig" if p["source"] == "pig" else "tritone" if p.get("transpose") else "library"] += 1
    n_hard = sum(r.hard for rs in rows.values() for r in rs)
    print(f"bench: {bench['label']}, gallery {gallery_dir.as_posix()} ({len(rows)} pages, {n_hard} hard-error rows)")
    print(f"dump: {len(dump['pieces'])} pieces ({kinds['library']} library, {kinds['tritone']} tritone, {kinds['pig']} PIG), "
          f"engine {dump['engineVersion']}, profile {dump['profile']}, weight set {dump['weightSet']}")
    c, s = sel["counts"], sel["skipped"]
    print(f"selected: lowconf {c['lowconf']}, harderr {c['harderr']}, control {c['control']}, planted {c['planted']}, "
          f"recall {c['recall']} (hard errors skipped: unusable grid {s['unusable grid']}, not in the quantised piece "
          f"{s['not in the quantised piece']}, not covered {s['not covered']})")
    pools = {}
    for b in key["batches"].values():
        pools.setdefault(b["pool"], set()).add(b["file"].rsplit("batch-", 1)[1][:2])
    desc = ", ".join(f"{pool} {len(nums)} x{2 if pool != 'control' else 1}" for pool, nums in pools.items())
    print(f"batches: {sum(len(v) for v in pools.values())} ({desc}) -> {len(key['batches'])} reviewer launches, "
          f"{len(key['items'])} item reviews")
    print(f"launches: {(day / 'launches.md').as_posix()}")
    return 0


def collect(args) -> int:
    rep = dispatch.collect_outputs(Path(args.data_dir) / args.date)
    print(f"weekly collect {args.date}: {rep['n_items']} items, {len(rep['missing_items'])} missing, "
          f"{len(rep['problems'])} problems")
    for p in rep["problems"][:40]:
        print("  -", p)
    return 1 if rep["missing_items"] else 0


def report_cmd(args) -> int:
    day = report.load_day(Path(args.data_dir) / args.date)
    if day.collect_report["missing_items"] and not args.allow_missing:
        return _err(f"{len(day.collect_report['missing_items'])} items are missing; relaunch or pass --allow-missing")
    pilot = json.loads((HERE / "results" / "summary.json").read_text(encoding="utf-8"))
    results = Path(args.results_dir)
    prior = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(results.glob("*/summary.json"))
             if p.parent.name < args.date]
    md, summary, rows = report.build_report(day, pilot, prior)
    blob = json.dumps(summary, indent=1, ensure_ascii=False)
    try:
        report.audit_no_pig(day, md, blob, rows)
    except report.PigLeak as leak:
        return _err(f"PIG data would leak into a tracked file: {leak}")
    docs = Path(args.docs_dir)
    docs.mkdir(parents=True, exist_ok=True)
    (docs / f"teacher-{args.date}.md").write_text(md, encoding="utf-8", newline="\n")
    (results / args.date).mkdir(parents=True, exist_ok=True)
    (results / args.date / "summary.json").write_text(blob + "\n", encoding="utf-8", newline="\n")
    header = (f"<!-- Teacher review {args.date}: rows for the table in docs/experiments.md. The coordinator appends them "
              "after the table's last row and runs prettier. Generated by research/teacher_review/weekly.py report. -->\n")
    (results / args.date / "hypotheses.md").write_text(header + (rows or "<!-- no group reached three consistent objections -->\n"),
                                                       encoding="utf-8", newline="\n")
    print(f"report: {(docs / f'teacher-{args.date}.md').as_posix()}, {len(summary['hypotheses'])} hypotheses")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("build", "collect", "report"):
        p = sub.add_parser(name)
        p.add_argument("--date", required=True)
        p.add_argument("--data-dir", default=str(REPO / "research" / "data" / "teacher_review" / "weekly"))
        p.add_argument("--results-dir", default=str(HERE / "results" / "weekly"))
        if name == "build":
            p.add_argument("--seed", type=int)
            p.add_argument("--profile", default="medium")
            p.add_argument("--weight-set")
            p.add_argument("--dump")
            p.add_argument("--gallery")
            p.add_argument("--force", action="store_true")
        if name == "report":
            p.add_argument("--docs-dir", default=str(REPO / "docs" / "reviews"))
            p.add_argument("--allow-missing", action="store_true")
    sub.add_parser("where")
    args = ap.parse_args(argv)
    if args.cmd == "where":
        print(Path(teacher_review.__file__).resolve().parent)
        return 0
    return {"build": build, "collect": collect, "report": report_cmd}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Extend the README**

Append to `research/teacher_review/README.md`:

````markdown
## Weekly review (verification spec 3.12)

The pilot's harness runs every week on the current engine. Plan:
`docs/superpowers/plans/2026-10-14-m7a-teacher-review-job.md`. Run it by path from the repository
root, not with `-m` (in a worktree the shared venv would import the main checkout's harness):

```bash
PY=research/.venv/Scripts/python.exe
pnpm --filter @digitus2/engine build
$PY -I research/teacher_review/weekly.py build --date 2026-10-21      # bench, dump, select, batches, launches
# the coordinator launches one Opus reviewer per row of research/data/teacher_review/weekly/<date>/launches.json
$PY -I research/teacher_review/weekly.py collect --date 2026-10-21
$PY -I research/teacher_review/weekly.py report --date 2026-10-21     # docs/reviews/teacher-<date>.md
```

| Module                 | What                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `engine_dump.mjs`      | per-note engine output through the built engine's public API (library, tritone copies, PIG pieces) |
| `musicxml_passages.py` | library windows with exact bars, beats, chords, grace notes and rests                              |
| `gallery.py`           | bench error galleries; PIG passages with the engine's fingers                                      |
| `select.py`            | the five sets: low-confidence, hard-error, control, planted-fault control, recall control          |
| `dispatch.py`          | weekly legend, blinded batches (two framings for engine sets), key, launches, collection           |
| `hypotheses.py`        | consistent objections, groups by kind and lint rule, rows for `docs/experiments.md`                |
| `report.py`            | the report, `results/weekly/<date>/summary.json`, the PIG audit                                    |

Data: `research/data/teacher_review/weekly/<date>/` (gitignored: dump, batches, key, outputs).
Committed: `results/weekly/<date>/summary.json`, `hypotheses.md` and the library-only batch files
under `library/`. PIG passages appear in tracked files only by opaque id and counts.
````

- [ ] **Step 5: Run the tests**

Run: `research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests -q`
Expected: all pass. That is the pilot's 36 and 68 new tests (9 + 19 + 5 + 8 + 7 + 11 + 4 + 5), with the engine and PIG integration tests running when the build and the dataset exist.

- [ ] **Step 6: Hand-off**

Paths: `research/teacher_review/weekly.py`, `research/teacher_review/tests/test_weekly.py`, `research/teacher_review/tests/weekly_fixtures.py`, `research/teacher_review/README.md`. Message: `research(teacher-review): weekly entry point build, collect, report`.

---

### Task 9: The first weekly review, 2026-10-14

This task is split between the implementer (a subagent, no git, no agent launches) and the coordinator (who launches the reviewers, appends the hypotheses and commits). Run it on the engine as it is when the task starts. If M3 has been merged into `main` by then, the coordinator rebases `wt/teacher-review` first and rebuilds `dist`, so that "the default weight set" is `RECOMMENDED_WEIGHT_SET`. Otherwise it is the literature defaults (`parncutt-defaults`). The report records which.

**Files:**

- Create:
  - (gitignored) `research/data/teacher_review/weekly/2026-10-14/**`
  - (tracked) `research/teacher_review/results/weekly/2026-10-14/summary.json`, `hypotheses.md`, `library/batch-*.md` (about 9 files, 15 to 25 KB each)
  - `docs/reviews/teacher-2026-10-14.md`
- Modify (coordinator only): `docs/experiments.md`, `docs/PROGRESS.md`, `docs/superpowers/specs/2026-10-13-verification-design.md` (a dated note under 3.12)

**Implementer, part 1 (build):**

- [ ] **Step 1: Preflight**

```bash
pnpm --filter @digitus2/engine build
research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests -q
research/.venv/Scripts/python.exe -I research/teacher_review/weekly.py where
```

Expected: the build succeeds, all tests pass with the engine and PIG integration tests running (not skipped), and `where` prints this worktree's `research/teacher_review`.

- [ ] **Step 2: Build the day (background; about a minute)**

```bash
research/.venv/Scripts/python.exe -I research/teacher_review/weekly.py build --date 2026-10-14
```

Expected output: five lines as in Task 8. With the engine at 813aa57 the prototype predicts the following:

- About 30 gallery pages and 935 hard-error rows.
- The dump: 90 pieces, about 11 MB.
- `lowconf 20, harderr 16, control 10, planted 4, recall 4`, with hard errors skipped: unusable grid about 251 and not covered about 376.
- 8 batches and 13 launches, for 90 item reviews.

A later engine moves these numbers. Then check the files:

- `ls -la research/data/teacher_review/weekly/2026-10-14/batch-*.md`: library batches about 14 to 22 KB (dry run: 14 to 21 KB), PIG batches about 25 to 45 KB.
- Every file in `research/teacher_review/results/weekly/2026-10-14/library/` is under 64 KB.
- Open `batch-01a.md` and one PIG batch and read two passages: bars, beats, upbeats and grace lines look right, and no set, title or passage id appears in the passage blocks.

If the build prints fewer than 20 lowconf or 16 harderr passages, that is acceptable. Record the numbers and the skip counts.

- [ ] **Step 3: Hand over to the coordinator**

Hand back the five build lines, the path `research/data/teacher_review/weekly/2026-10-14/launches.md`, and the exact table from it. Stop here. The implementer does not launch reviewers.

**Coordinator (launches; nobody else does this):**

- [ ] **Step 4: Record ownership and check the budget**

Add `research/teacher_review/**`, `research/data/teacher_review/weekly/**` and `docs/reviews/teacher-*.md` to the ownership table in `docs/PROGRESS.md` as M7-A. Check `get_usage`. The run costs about 90 item reviews × 16k tokens, about 1.4 M subagent tokens, and about 10 to 15 minutes with the 13 reviewers in parallel (pilot: median 126k tokens and 578 s per batch of 8).

- [ ] **Step 5: Launch the 13 reviewers**

Launch one fresh Opus subagent per row of `research/data/teacher_review/weekly/2026-10-14/launches.json`, all in the background. Each launch is `Agent(description="Teacher review batch <batch>", subagent_type="general-purpose", model="opus", prompt=<row.prompt>, run_in_background=true)`. The prompt is exactly `row.prompt`, the README wrapper with the absolute batch file, output file and item count. Nothing else goes into it: no context about the project, the engine, the sets or this plan.

With the expected counts the list is:

| #   | pool    | input (batch file, under `research/data/teacher_review/weekly/2026-10-14/`) | output file          | items | framing |
| --- | ------- | --------------------------------------------------------------------------- | -------------------- | ----- | ------- |
| 1   | lowconf | `batch-01a.md`                                                              | `out/batch-01a.json` | 7     | a       |
| 2   | lowconf | `batch-01b.md`                                                              | `out/batch-01b.json` | 7     | b       |
| 3   | lowconf | `batch-02a.md`                                                              | `out/batch-02a.json` | 7     | a       |
| 4   | lowconf | `batch-02b.md`                                                              | `out/batch-02b.json` | 7     | b       |
| 5   | lowconf | `batch-03a.md`                                                              | `out/batch-03a.json` | 6     | a       |
| 6   | lowconf | `batch-03b.md`                                                              | `out/batch-03b.json` | 6     | b       |
| 7   | harderr | `batch-04a.md`                                                              | `out/batch-04a.json` | 8     | a       |
| 8   | harderr | `batch-04b.md`                                                              | `out/batch-04b.json` | 8     | b       |
| 9   | harderr | `batch-05a.md`                                                              | `out/batch-05a.json` | 8     | a       |
| 10  | harderr | `batch-05b.md`                                                              | `out/batch-05b.json` | 8     | b       |
| 11  | control | `batch-06b.md`                                                              | `out/batch-06b.json` | 6     | b       |
| 12  | control | `batch-07a.md`                                                              | `out/batch-07a.json` | 6     | a       |
| 13  | control | `batch-08b.md`                                                              | `out/batch-08b.json` | 6     | b       |

The item counts per batch come from `launches.json`. Which of the three lowconf batches holds 6 depends on the seed. If the counts differ (for example 9 hard-error passages → 2 batches of 5 and 4), `launches.json` is authoritative: the files are numbered lowconf first, then harderr, then control, and engine batches always come in a/b pairs.

The prompt of row 1, for reference. `<ROOT>` is `C:/Users/maxim/Desktop/projects/github/thingamajig-wt/teacher-review/research/data/teacher_review/weekly/2026-10-14`:

> You are a reviewer in a blinded study of piano fingerings. Your only input is the file `<ROOT>/batch-01a.md`. It contains a brief, a notation legend and 7 passages, each with a candidate fingering. Follow the brief's instructions exactly and write your review as a single JSON document to `<ROOT>/out/batch-01a.json` (UTF-8, nothing but the JSON).
> Rules: read only that one input file; do not open, list, search or read any other file, directory or web page, and do not look for the sources of the passages. Do not run git. Do not run any program except one command to get a UTC timestamp before you read the passages (bash: `date -u +%FT%TZ`) and one after you have written the JSON; put them in `started_at` and `finished_at`. Do not modify the input file. Every item in the input must appear exactly once in `items`, in the same order, each with `item`, `readback`, `scores`, `verdict`, `objections` and `comment`. Use only note ids that exist in the passage. When done, reply with one line: the output path and the number of items written.

As each reviewer completes, copy its usage block (subagent tokens, duration, tool uses) into `research/data/teacher_review/weekly/2026-10-14/dispatch_log.json` in the pilot's format: `{"note": "...", "batches": {"01a": {"subagent_tokens": n, "duration_ms": n, "tool_uses": n}}}`. A missing usage block is recorded as `null` with a note.

- [ ] **Step 6: Collect and relaunch at most once**

```bash
research/.venv/Scripts/python.exe -I research/teacher_review/weekly.py collect --date 2026-10-14
```

Expected: `90 items, 0 missing, 0 problems` (the pilot had 0 problems in 240 reviews). For a batch that is missing or not valid JSON, relaunch the same row once, with the same prompt and files, then collect again. Validation problems such as an unknown note id are reported and kept. A second failure stays missing, and the report runs with `--allow-missing` and says so.

**Implementer, part 2 (report), or the coordinator:**

- [ ] **Step 7: Write the report**

```bash
research/.venv/Scripts/python.exe -I research/teacher_review/weekly.py report --date 2026-10-14
pnpm exec prettier --write docs/reviews/teacher-2026-10-14.md
```

Expected:

- `report: docs/reviews/teacher-2026-10-14.md, <n> hypotheses`. The audit passes; if it fails, fix `report.py` and never the audit.
- Read the report from top to bottom and check the following:
  - The planted-fault table found most of the 8 to 12 planted faults by position. The pilot found 99 percent; a large drop is a finding about the reviewer, not the engine, and goes into the report's last section in one sentence.
  - The control objection rate is of the order of the pilot's 2.5 per 100 notes on expert PIG fingerings. It is not the same population, so it is reported, not judged.
  - The recall section has four pairs, each with its finger-agreement share.
  - The hard-error section names no PIG piece, bar or pitch.
  - The instructive objections are library passages, quoted verbatim.
- File sizes: the report and `summary.json` under 900 KB, and `results/weekly/2026-10-14/` under 400 KB.
- The section "Limits of this run" states that user-edited passages (spec 3.12 item d) are out of scope until M5.

- [ ] **Step 8: Verify**

```bash
research/.venv/Scripts/python.exe -I -m pytest research/teacher_review/tests -q
pnpm verify hygiene
pnpm exec prettier --check docs/reviews/teacher-2026-10-14.md
```

Expected: all pass. The full `pnpm verify` is unchanged by this plan; run it before the merge as usual.

- [ ] **Step 9: Hand-off (implementer)**

Paths for the coordinator's commit:

- `research/teacher_review/results/weekly/2026-10-14/summary.json`
- `research/teacher_review/results/weekly/2026-10-14/hypotheses.md`
- `research/teacher_review/results/weekly/2026-10-14/library/` (every file)
- `docs/reviews/teacher-2026-10-14.md`

Also report the build lines, the collect line, the number of hypotheses, and any engine API gap not already in this plan.

**Coordinator, closing:**

- [ ] **Step 10: Hypotheses into the lab notebook, journal, spec note, commit**

- Lab notebook:
  - Append the rows of `research/teacher_review/results/weekly/2026-10-14/hypotheses.md`, without its comment line, to `docs/experiments.md` after the last row of the main table (the last line that starts with `| 20` before the first `###` section).
  - Then run `pnpm exec prettier --write docs/experiments.md`.
  - The job never writes this file itself.
- `docs/PROGRESS.md`:
  - Set the milestone row "M7-A teacher review job" to done, with the build counts, the planted detection, the reviewer agreement and the number of hypotheses.
  - Add a log entry.
  - Add a standing finding with three parts: the weekly job exists and is not a gate; `render.py`'s column overflow (decision 5) is an open follow-up; and PIG-derived hard-error passages stay under `research/data`.
- Verification spec, under 3.12, add a dated note: `First weekly run 2026-10-14: docs/reviews/teacher-2026-10-14.md (engine <version> <commit>, profile medium, weight set <id>); job: research/teacher_review/weekly.py (plan 2026-10-14-m7a-teacher-review-job.md). User-edited passages start when M5 stores edits.`
- Commit with explicit paths only (never `git add -A`):
  - `research/teacher_review/` (code, tests, README, results/weekly)
  - `docs/reviews/teacher-2026-10-14.md`
  - `docs/experiments.md`
  - `docs/PROGRESS.md`
  - the spec
  - this plan
- Merge `wt/teacher-review` per the standing rule (verify green, rebase, fast-forward).
- Optionally schedule the next run (2026-10-21) the way the daily UI review is scheduled.

---

## Self-review notes

**Coverage of the binding constraints:**

1. Everything new lives under `research/teacher_review/`: Python 3.11 standard library plus pytest, run with `-I`, and one Node script that uses only the `dist` public API (Task 1).
   - The dump has every field the brief lists: piece id, hand, measure number, beat in quarter notes, MIDI and spelled pitch, duration in quarter notes, tie and chord grouping, rest positions, finger, confidence and gaps. It adds `sourceIndex`, lint issues and seconds for the adapter and the hypotheses.
   - Nothing under `packages/` or `apps/` changes. The gaps are listed, with their workarounds.
2. The library adapter produces the PIG adapter's structures: ids by `number_events`, chords with their longest duration, rest events, and bars and beats through `Passage.bar_beat`. `render.py` and `collect.py` work on them unchanged.
   - Round trips are pinned on synthetic cases and on all 779 regular four-bar windows of the real library (Task 2).
   - The overflow guard exists because `render.py` must stay unchanged (decision 5).
3. Selection:
   - (a) 20 low-confidence windows, 2 to 8 bars, 10 to 48 notes per reviewed hand, non-overlapping, at most two per piece.
   - (b) Hard-error windows of 2 to 4 bars from the latest gallery, capped at 16 by descending hard-error count, rendered only under `research/data`.
   - (c) 10 seeded level 1 to 3 controls.
   - (d) Both section 6.4 improvements: the legend sentence (Task 5) and 4 recall twins, composer and title hidden and transposed by a tritone (Tasks 1 and 4).
   - The refinements (in-line seeds, repeat dedup, target 16 notes, shorter windows on ties) are decisions 8, 9 and 15, each with the measurement that motivated it.
   - User-edited passages are declared out of scope until M5 (Depends on, decision 16, the report's last section).
4. Dispatch:
   - Batches of at most 8 with opaque ids and random order, `batch-NN<f>.md` and `key.json` under `research/data/teacher_review/weekly/<date>/`.
   - The layout is proven identical to `build_benchmark.make_run`'s by a characterization test rather than by editing `build_benchmark.py`.
   - Two reviewers per engine batch and one per control batch.
   - The launch list, with input and output per launch and the exact prompt, is in Task 9 and is generated as `launches.json`, so a workflow script can iterate it.
5. Collection reuses `collect.normalise_item` and `_parse_ts`.
   - The loop is reproduced because `collect.collect` hard-codes `results/<run>/key.json` and the brief puts the key under `research/data`.
   - `score.py` gains only measurements the pilot lacked: rates per set, the recall comparison, hard-error agreement, seed hits and the shared matcher.
   - `hypotheses.py` emits rows in `docs/experiments.md`'s exact six-column format, and the coordinator appends them.
6. The report holds the control tables:
   - The planted-fault control on four library control passages (`inject.py`), which keeps reviewer drift measurable.
   - Objection rates per set, the recall comparison, the hypothesis list, and three instructive library objections verbatim.
   - PIG passages appear only by opaque id and counts, enforced by an audit.
7. `weekly.py build | collect | report` is the whole job, with launches in between.
   - It is deterministic for a seed (tested byte for byte).
   - Tests cover the adapter round trip, selection windows and caps, batch blinding, hypothesis grouping on synthetic judgements and on the pilot, and the report on the pilot's committed results.
8. Task 9 runs the first review for real and separates implementer from coordinator steps.
9. Size limits are tested: library copies under 64 KB each and `results/weekly/<date>/` under 400 KB. PIG renderings and raw outputs stay in the gitignored data directory.

**Type consistency:**

- Dump pieces flow from Task 1 into `musicxml_passages` (Task 2), `gallery.check_against_dump` and `pig_engine_window` (Task 3) and `select` (Task 4).
- Records from Task 4 are the input of `dispatch.plan_batches` and `write_day` (Task 5), which write the key items read by `collect.normalise_item`, the score functions and `hypotheses` (Task 6), and `report` (Task 7).
- `Passage.notes_meta` carries `engine` (all tasks), `hard` (PIG) and `source`; `seed_note` and `twin_of` travel in records and key items.
- The set names `lowconf`, `harderr`, `control`, `planted` and `recall` are the same strings everywhere. The condition is `engine` or `corrupted`, so `score.fault_detection` and `consistency` work unchanged.

**Measured while writing, not assumed:**

- The library's notes, rests, graces and irregular windows.
- The overflow count (10 of 779).
- Plantability of typical controls (6 of 10).
- Confidence quantiles: 1 % 0.384, 5 % 0.506, 10 % 0.611, median 0.953.
- Hard errors under the medium profile (935, 684 in usable pieces, 308 coverable by 16 windows).
- The pilot's consistent-objection counts.
- Every exact number in a test was computed from the committed pilot results or from the built engine at 813aa57. The engine-dependent values (fingers, confidences) are never asserted exactly.

**Known weaknesses to read the first report against:**

- Four planted passages and four recall pairs are smoke checks, not estimates. The report says so.
- Piece 001 may dominate the hard-error set (5 of 16 in the prototype); a per-piece cap is the coordinator's call.
- Reviewers are told some fingerings are by experts although none are this week, kept for comparability with the pilot (decision 16).
- One model family both writes the engine's rules and reviews them (teacher-review.md section 8).

**Placeholder scan:**

- Every test is complete. Code is complete for `engine_dump.mjs`, `musicxml_passages.py`, `gallery.py`, `select.py`, `dispatch.py`, the `score.py` additions, `hypotheses.py` and `weekly.py`.
- `report.py` has its exact table builders, formats, section order and audit rule, and the remaining prose sections are specified line by line. Its tests pin every number and heading.
