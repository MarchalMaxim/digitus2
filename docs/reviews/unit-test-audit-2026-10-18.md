# Unit-test audit

Question: are the unit tests useful, or generated filler? This report measures it two ways and states what it did not cover.

## Verdict

The tests are mostly real. They are not assertion-free or tautological filler, but they are good at the typical case and thin at the edges.

- **When a test runs a line, it notices a change to that line 73% of the time** (653 of 895 mutants; see "Mutation sampling"). Equality flips, dropped negations and inverted conditions are caught 90% to 97% of the time.
- **Boundaries are where the tests are weakest.** Changing `<` to `<=` or `>` to `>=` is caught only 39% of the time, and `&&`/`||` guards 57%. The tests prove that features work on ordinary inputs and rarely probe the edge of an input.
- **React component tests are the weakest group** (59% against 75% for plain TypeScript). Layout and class names are left to the Playwright suite.
- **Reviewers graded 507 vitest cases: 74% useful, 22% weak, 3% slop** (14 cases). 19% are change detectors: they pin numbers or strings copied from the current output. A sample of the Python suites reads better (86% useful).
- **The one independent oracle does not run in CI.** The test that compares the metrics with the official fingering evaluator, the corpus tests and the training test skip silently when the gitignored datasets are absent, and CI does not download them. Eleven cases are affected (see "Gaps").

The suite is worth keeping and extending. It does not need deleting; it needs the missing assertions named under "Gaps" (the reviewers called 109 survivors real gaps, several pointing at the same missing assertion) and a handful of weak tests tightened.

## What was done

| Part                             | Scope                                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Static scan                      | all 118 vitest files: skips, tautologies, weak matchers, snapshots, mocks                                                                                                                                                |
| Mutation sampling                | 110 of 118 vitest files; up to 10 mutants per test file, 1,028 in all                                                                                                                                                    |
| Whole-suite recheck of survivors | 246 of 359 survivors (partial; see below)                                                                                                                                                                                |
| Qualitative review               | 60 vitest files: 52 mutated files (those under a 70% kill rate when the review was run, plus a deterministic one-in-five sample of the rest) and the eight that cannot be mutated; 13 sampled Python and node:test files |

Not covered:

- **Seven vitest files cannot be mutated** (the corpus, reference and WASM-render tests: `smoke`, `engrave.library`, `metrics.reference`, `textbook`, `metamorphic`, `verovio.node`, `verovio.midi.node`) and `tokens.test.ts` has no source file. They were judged by reading only.
- **58 mutated files were not read qualitatively**; their only evidence is the mutation score. Their scores are higher, but a high score does not expose change detectors.
- **Mutation is sampled**: at most 10 operator changes per test file, spread evenly over the sibling source file and rotated through the operator kinds. It measures a sample of the code, not all of it.
- **Scores are per test file.** Each test file was run alone against mutants of its own source. A survivor can be caught by a different test file, and the sibling file may exercise only part of a large source. The recheck below addresses this for the survivors it reached.
- **The Playwright suite (19 specs) was not audited.** The Python suites (about 67 files) were sampled at low depth (13 files). `BarSeek.test.tsx` is excluded because it was written alongside this audit.
- **Reviewers are language models working read-only.** Ten of their claims were checked by hand (a tautological assertion in `transport.test.ts`, the vacuous `toBeLessThanOrEqual(before)` in `LibraryView.test.tsx`, the copied constants in `motion.test.ts`, the copied floors in `textbook.test.ts` and others); all held, though a few "slop" calls are arguable (an export-identity check in `infra.test.ts` protects a real public surface).

## Mutation sampling

Method: one operator at a time is changed in the source file next to a test (found from the syntax tree, not by text search): `<`/`<=`, `>`/`>=`, `===`/`!==`, `&&`/`||`, `true`/`false`, a dropped `!`, an inverted `if` condition, swapped ternary branches, `Math.min`/`Math.max`, `+`/`-` and `*`/`/` on numbers, and an integer constant raised by one. That test file alone is then re-run. A mutant is _killed_ when a test fails, and _survived_ otherwise. For each survivor the same expression is replaced by one that throws; if the test still passes, the test never executes that expression (_not executed_, a scope gap rather than a weak test).

|                                                     | Count     |
| --------------------------------------------------- | --------- |
| Mutants                                             | 1028      |
| Killed                                              | 653       |
| Survived, expression executed                       | 242       |
| Survived, expression not executed by that test file | 117       |
| Timed out, failed to load or errored (not scored)   | 16        |
| **Kill rate where the test executes the code**      | **73.0%** |
| Kill rate over all scored mutants                   | 64.5%     |

Kill rate by operator, lowest first (executed mutants only):

| Operator  | Mutants | Killed | Survived, executed | Survived, not executed | Kill rate |
| --------- | ------- | ------ | ------------------ | ---------------------- | --------- |
| boundary  | 106     | 35     | 55                 | 14                     | 39%       |
| logical   | 100     | 52     | 39                 | 8                      | 57%       |
| const     | 135     | 70     | 50                 | 12                     | 58%       |
| boolean   | 67      | 35     | 17                 | 15                     | 67%       |
| arith     | 137     | 83     | 36                 | 16                     | 70%       |
| ternary   | 102     | 72     | 18                 | 12                     | 80%       |
| equality  | 129     | 103    | 12                 | 12                     | 90%       |
| minmax    | 40      | 32     | 3                  | 5                      | 91%       |
| cond-flip | 133     | 107    | 10                 | 13                     | 91%       |
| negation  | 79      | 64     | 2                  | 10                     | 97%       |

Kill rate by area:

| Area                                         | Files | Mutants | Killed | Survived, executed | Survived, not executed | Kill rate |
| -------------------------------------------- | ----- | ------- | ------ | ------------------ | ---------------------- | --------- |
| apps/web, all                                | 59    | 528     | 323    | 127                | 74                     | 71.8%     |
| apps/web, source is a React component (.tsx) | 21    | 167     | 78     | 55                 | 34                     | 58.6%     |
| apps/web, source is plain TypeScript         | 38    | 361     | 245    | 72                 | 40                     | 77.3%     |
| packages/engine                              | 51    | 500     | 330    | 115                | 43                     | 74.2%     |

Test files by kill rate (files with at least one scored mutant the test executed):

| Kill rate  | Files |
| ---------- | ----- |
| under 50%  | 11    |
| 50% to 69% | 26    |
| 70% to 84% | 38    |
| 85% to 99% | 16    |
| 100%       | 17    |

About one survivor in five is an equivalent mutant, one that cannot change behaviour (cosmetic wording, a tie broken the same way). Of the 160 survivors the reviewers judged, 109 were real gaps, 32 equivalent and 19 another test file's job. The kill rates above therefore understate the tests by a few points.

### Whole-suite recheck

The 246 survivors rechecked so far were re-applied and run against every test file that imports the mutated source, not just the sibling. **32 of 246 were caught by some other test**; 214 survived the whole related suite (web: 171 of 198 survived; engine: 43 of 48). Survivors that outlive the whole suite are the strongest evidence of an untested behaviour. The recheck is partial: it runs web files in path order and engine files from the end, and an engine mutant takes about two minutes because most engine modules are imported by hundreds of tests. Engine survivors are therefore under-represented.

### Best and worst files by mutation

Files whose tests caught every mutant they executed (at least five):

| Test file                      | Cases | Killed | Survived, executed | Survived, not executed | Kill rate |
| ------------------------------ | ----- | ------ | ------------------ | ---------------------- | --------- |
| `library/disclosure.test.ts`   | 5     | 10     | 0                  | 0                      | 100%      |
| `learn/features.test.ts`       | 14    | 10     | 0                  | 0                      | 100%      |
| `engine/client.test.ts`        | 7     | 10     | 0                  | 0                      | 100%      |
| `library/levels.test.ts`       | 8     | 10     | 0                  | 0                      | 100%      |
| `fingering/spans.test.ts`      | 5     | 10     | 0                  | 0                      | 100%      |
| `score/handLetters.test.ts`    | 14    | 10     | 0                  | 0                      | 100%      |
| `learn/data.test.ts`           | 7     | 10     | 0                  | 0                      | 100%      |
| `library/benchmarkSet.test.ts` | 4     | 9      | 0                  | 0                      | 100%      |
| `score/bars.test.ts`           | 5     | 7      | 0                  | 3                      | 100%      |
| `io/musicxml/read.omr.test.ts` | 49    | 6      | 0                  | 4                      | 100%      |

Files with the most survivors the test executed but did not notice (at least four):

| Test file                             | Cases | Killed | Survived, executed | Survived, not executed | Kill rate |
| ------------------------------------- | ----- | ------ | ------------------ | ---------------------- | --------- |
| `score/score.i18n.test.tsx`           | 7     | 0      | 5                  | 4                      | 0%        |
| `fingering/params/weightSets.test.ts` | 4     | 0      | 4                  | 1                      | 0%        |
| `score/ScoreSheet.test.tsx`           | 2     | 1      | 4                  | 0                      | 20%       |
| `io/midi/motion.test.ts`              | 5     | 1      | 4                  | 0                      | 20%       |
| `score/usePlayback.ornaments.test.ts` | 1     | 2      | 7                  | 1                      | 22%       |
| `score/ScoreView.letters.test.tsx`    | 3     | 2      | 6                  | 2                      | 25%       |
| `scan/ScanView.test.tsx`              | 7     | 3      | 5                  | 2                      | 38%       |
| `fingering/features.test.ts`          | 6     | 3      | 5                  | 2                      | 38%       |
| `app/NoteBurst.test.tsx`              | 9     | 4      | 6                  | 0                      | 40%       |
| `audio/transport.test.ts`             | 33    | 5      | 5                  | 0                      | 50%       |

Several of the weakest files are weak because the code they exercise is large and the file covers one aspect of it (`usePlayback.ornaments.test.ts` exercises only the ornament path of `usePlayback.ts`; `score.i18n.test.tsx` checks wording, not the keyboard and import panel behind it). Those are scope limits, not slop.

## Qualitative review

Each reviewer read its test files in full and graded each case: **useful** (fails if the named behaviour regresses, with an expected value from an oracle independent of the implementation, and covers an edge or failure mode), **weak** (real but shallow), or **slop** (cannot meaningfully fail: a tautology, an assertion on a mock's own return value, a copy of the code under test, a constant copied from the source). A **change detector** is a case that pins numbers, markup or copy taken from the current output; it can be useful or weak and still be brittle.

| Suite                         | Files | Cases | Useful | Weak | Slop | Change detectors |
| ----------------------------- | ----- | ----- | ------ | ---- | ---- | ---------------- |
| vitest                        | 60    | 507   | 377    | 114  | 14   | 94               |
| pytest and node:test (sample) | 13    | 174   | 150    | 23   | 1    | 17               |

File verdicts, vitest: useful 25, mixed 30, weak 5. Pytest and node:test: useful 11, mixed 2.

The files with slop cases, or a weak verdict, and the worst case the reviewer found in each:

- `io/musicxml/smoke.test.ts` (weak; 0 useful, 1 weak, 0 slop): expect(score.notes.length).toBeGreaterThan(0)
- `eval/textbook.test.ts` (mixed; 3 useful, 3 weak, 2 slop): expect(r.exactRate).toBe(1) (chord fingers [9,9,9] with alternatives)
- `eval/metamorphic.test.ts` (mixed; 4 useful, 2 weak, 1 slop): expect(r.checks.map((c) => c.id)).toEqual(['DET', 'MR1', 'MR2', 'MR10', 'MR6', 'MR7', 'MR8'])
- `research/teacher_review/tests/test_dispatch.py` (useful; 9 useful, 0 weak, 1 slop): test_weekly_legend_states_what_dur_means: asserts copied legend phrases, so it guards wording rather than behaviour; 'assert "come from the performance timing" not in flat'.
- `design/Button.test.tsx` (weak; 1 useful, 0 weak, 1 slop): Second test checks `toBeDisabled()` and type pass-through: mostly tests React's attribute forwarding.
- `library/levels.test.ts` (mixed; 4 useful, 2 weak, 2 slop): Shelf noun test re-lists six strings copied from levels.ts, e.g. 'jazz, ragtime and modern pieces'.
- `library/LibraryView.test.tsx` (mixed; 20 useful, 15 weak, 2 slop): Length filter test ends `expect(rows().length).toBeLessThanOrEqual(before)`, which passes if the filter does nothing.
- `score/ScoreSheet.test.tsx` (weak; 1 useful, 1 weak, 0 slop): 'renders the pages as inline SVG…' asserts the copied string "Score of Twinkle, Twinkle, Little Star" plus a length.
- `score/SidePanel.test.tsx` (mixed; 9 useful, 3 weak, 1 slop): 'has no red element' queries .is-red in a panel that never renders it; cannot fail meaningfully.
- `cli/corpora.test.ts` (mixed; 6 useful, 3 weak, 1 slop): 'validation pieces are 20 fixed train ids' ends with a copied list of ids: "031 034 038 039 041 046 052 053 066 076 077"
- `score/score.i18n.test.tsx` (weak; 1 useful, 6 weak, 0 slop): 'writes the side panel in French': "Doigté calculé en 6 ms · mise en page en 63 ms" and other copied copy.
- `fingering/solve.test.ts` (useful; 35 useful, 10 weak, 2 slop): expect(makeContext(HAND_PROFILES.large).holdEpsSec).toBe(1e-3)
- `io/musicxml/infra.test.ts` (useful; 11 useful, 4 weak, 1 slop): expect(api.timewiseToPartwise).toBe(timewiseToPartwise)
- `lint/rules.test.ts` (useful; 13 useful, 0 weak, 1 slop): 'documents the warning in the rule table': expect(LINT_RULES.L07.title).toMatch(/hold beyond reach/)
- `version.test.ts` (weak; 0 useful, 1 weak, 0 slop): expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)

What the weak and slop cases have in common:

1. **Constants and copy copied from the source**: floors measured and then pinned (`textbook.test.ts`: measured minus 0.01), exact durations and easings (`motion.test.ts`), shelf names and French wording (`levels.test.ts`, `score.i18n.test.tsx`), the 20 validation piece ids (`corpora.test.ts`). These fail on harmless edits and cannot catch a wrong value.
2. **Vacuous assertions**: `expect(x ?? true).toBeTruthy()` in `transport.test.ts`; `rows().length <= before` in `LibraryView.test.tsx`, which passes when the filter does nothing; "has no red element" in `SidePanel.test.tsx`, which queries a panel that never renders one.
3. **Pass-through and existence checks**: `Button.test.tsx` second case, `version.test.ts`, the smoke test (`score.notes.length > 0` catches a crash, not a wrong note).
4. **Golden counts**: 81 `toHaveLength(<number>)` assertions with a literal of two or more digits and the 67 and 64 digit counts in the Verovio tests are numbers taken from a run.

## Gaps

Behaviour the reviewers found untested, grouped by kind. Each is a concrete assertion to add:

- **Boundaries**: a press exactly `DRAG_PX` away in `NoteBurst`; a note exactly 30 ticks before a beat, and a same-key note whose offset equals the next onset in `quantize`; `resamples: 1` in `bootstrap`; the 2047/2048-character limit in the local-library records; a margin exactly equal to `PENALTY_MARGIN` in calibration; the lower piano bound (MIDI 21) in the ornament realiser.
- **Bad input**: tempo factors of 0, negative, NaN and infinity in `Transport`; null, array or non-object JSON in `validateWeightSet`; a motion table with `mu: 0` and `mu: -1`; invalid pitch step or staff value in preserve-mode MusicXML; parts with differing measure counts in the scan joiner.
- **Modifier keys and defaults**: Alt, Ctrl and Meta clicks in `isEmptyClick`; a fresh `Transport` has count-in off; `ScoreSheet` without `resting` or `hopping`; `ScoreHeader` without a back handler.
- **Tie-breaks and ordering**: sort tie-breaks in `quantize` and `handSeparation`; shuffled-order alignment in `align`; first-file selection by annotator index in `corpora`.
- **Outputs that are never read back**: `pig.macro` and `noteWeighted` in `evalhands`; `timeSignatures` in the hand scorer; the hash corrected to `#/` after an unrestorable route; the width passed to the renderer in `ScanView`.

Data-dependent tests that skip silently:

| Test                        | Cases skipped without the data                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `corpora.test.ts`           | 7 of 10                                                                                                          |
| `learn.test.ts`             | 2 of 4                                                                                                           |
| `metrics.reference.test.ts` | 1 of 1 (compares gen, high, soft and rec with the official evaluator to 1e-6: the strongest oracle in the suite) |
| `bench.test.ts` (baselines) | 1                                                                                                                |

The CI workflow runs `pnpm test` without downloading the datasets, and the benchmark gates are not part of CI either, so these checks run only on a machine that has the data. A missing dataset is reported as a skip, which reads as a pass.

## Recommendations

None of these is done; delete or rewrite nothing without the owner's say.

1. **Make the skips loud.** Under CI, fail (or at least print a warning with the count) when a data-dependent suite skips, and decide whether a small committed fixture can carry the reference-metrics oracle.
2. **Add the boundary and bad-input assertions listed above.** The reviewers named 109 survivors as real gaps (several share one missing assertion); the cheapest, highest-value ones are the numeric boundaries and the input-validation cases, because that is where the mutation score is lowest.
3. **Remove or tighten the vacuous assertions** (the three in "What the weak and slop cases have in common", item 2). They add noise and no protection.
4. **Replace copied constants with relations where a relation exists**: for example derive the expected shelf names from the library index, and assert the unit relation for the easing rather than the literal numbers. Keep literal pins where they are the specification (the contrast ratios in `tokens.test.ts` are a good model: a real WCAG formula is the oracle).
5. **Run mutation sampling occasionally, not in the verification loop.** It is slow (an engine mutant can take two minutes) and noisy. A quarterly run on the files that changed is enough to keep the boundary and guard coverage honest.

## Appendix: every vitest file

Columns: test cases in the file; mutants run; killed; survived (executed / not executed); kill rate where executed; survivors caught by another test (of those rechecked); reviewer verdict with useful / weak / slop counts.

| Test file                                                    | Cases | Mutants | Killed | Survived (exec / not) | Kill rate | Caught elsewhere | Review          |
| ------------------------------------------------------------ | ----- | ------- | ------ | --------------------- | --------- | ---------------- | --------------- |
| `about/AboutView.test.tsx`                                   | 6     | 10      | 7      | 3/0                   | 70%       | 0 of 3           | -               |
| `app/App.test.tsx`                                           | 5     | 10      | 8      | 2/0                   | 80%       | 0 of 2           | -               |
| `app/NoteBurst.test.tsx`                                     | 9     | 10      | 4      | 6/0                   | 40%       | 0 of 6           | mixed: 6/3/0    |
| `app/routes.test.ts`                                         | 4     | 10      | 7      | 3/0                   | 70%       | 0 of 3           | useful: 4/0/0   |
| `app/store.test.ts`                                          | 27    | 10      | 7      | 3/0                   | 70%       | 1 of 3           | -               |
| `audio/beats.test.ts`                                        | 5     | 10      | 8      | 2/0                   | 80%       | 0 of 2           | -               |
| `audio/clock.test.ts`                                        | 3     | 10      | 8      | 2/0                   | 80%       | 0 of 2           | -               |
| `audio/ornaments.test.ts`                                    | 8     | 10      | 8      | 2/0                   | 80%       | 0 of 2           | -               |
| `audio/transport.test.ts`                                    | 33    | 10      | 5      | 5/0                   | 50%       | 3 of 5           | useful: 27/6/0  |
| `design/Button.test.tsx`                                     | 2     | 2       | 2      | 0/0                   | 100%      | -                | weak: 1/0/1     |
| `design/checkColors.test.ts`                                 | 5     | 10      | 7      | 2/1                   | 78%       | -                | -               |
| `design/Loader.test.tsx`                                     | 4     | 10      | 5      | 5/0                   | 50%       | 0 of 5           | mixed: 3/1/0    |
| `design/media.test.ts`                                       | 4     | 3       | 3      | 0/0                   | 100%      | -                | -               |
| `design/motion.test.ts`                                      | 4     | 10      | 6      | 4/0                   | 60%       | 0 of 4           | mixed: 2/2/0    |
| `design/theme.test.ts`                                       | 18    | 10      | 9      | 1/0                   | 90%       | 0 of 1           | -               |
| `design/ThemeToggle.test.tsx`                                | 4     | 2       | 2      | 0/0                   | 100%      | -                | -               |
| `design/tokens.test.ts` (no source to mutate)                | 23    | -       | -      | -                     | -         | -                | useful: 20/3/0  |
| `engine/client.test.ts`                                      | 7     | 10      | 10     | 0/0                   | 100%      | -                | useful: 7/0/0   |
| `engine/handlers.test.ts`                                    | 13    | 10      | 9      | 1/0                   | 90%       | 0 of 1           | -               |
| `export/download.test.ts`                                    | 2     | 3       | 3      | 0/0                   | 100%      | -                | -               |
| `i18n/i18n.test.ts`                                          | 16    | 10      | 5      | 1/4                   | 83%       | 0 of 5           | -               |
| `i18n/LanguageLine.test.tsx`                                 | 2     | 6       | 4      | 2/0                   | 67%       | 0 of 2           | mixed: 1/1/0    |
| `library/disclosure.test.ts`                                 | 5     | 10      | 10     | 0/0                   | 100%      | -                | -               |
| `library/levels.test.ts`                                     | 8     | 10      | 10     | 0/0                   | 100%      | -                | mixed: 4/2/2    |
| `library/LibraryView.test.tsx`                               | 37    | 10      | 6      | 3/1                   | 67%       | 0 of 4           | mixed: 20/15/2  |
| `library/local/library.test.ts`                              | 8     | 10      | 7      | 2/1                   | 78%       | 0 of 3           | -               |
| `library/local/records.test.ts`                              | 3     | 10      | 6      | 4/0                   | 60%       | 0 of 4           | mixed: 2/1/0    |
| `library/manifest.test.ts`                                   | 15    | 10      | 4      | 1/4                   | 80%       | 0 of 5           | -               |
| `library/model.test.ts`                                      | 44    | 10      | 8      | 2/0                   | 80%       | 0 of 2           | -               |
| `library/ownFile.test.ts`                                    | 5     | 10      | 3      | 2/5                   | 60%       | 5 of 7           | mixed: 3/2/0    |
| `library/OwnFileLine.test.tsx`                               | 4     | 0       | 0      | 0/0                   | n/a       | -                | mixed: 2/2/0    |
| `library/search.test.ts`                                     | 8     | 10      | 9      | 1/0                   | 90%       | 0 of 1           | -               |
| `scan/ImagePages.test.tsx`                                   | 7     | 10      | 4      | 3/3                   | 57%       | 0 of 6           | useful: 6/1/0   |
| `scan/join.test.ts`                                          | 18    | 10      | 7      | 2/1                   | 78%       | 0 of 3           | useful: 16/2/0  |
| `scan/rotation.test.ts`                                      | 3     | 10      | 0      | 1/9                   | 0%        | 0 of 10          | mixed: 3/0/0    |
| `scan/scan.test.ts`                                          | 6     | 10      | 5      | 3/2                   | 63%       | 1 of 5           | mixed: 4/2/0    |
| `scan/ScanView.test.tsx`                                     | 7     | 10      | 3      | 5/2                   | 38%       | 0 of 7           | mixed: 6/1/0    |
| `score/bars.test.ts`                                         | 5     | 10      | 7      | 0/3                   | 100%      | 0 of 3           | -               |
| `score/handLetters.test.ts`                                  | 14    | 10      | 10     | 0/0                   | 100%      | -                | -               |
| `score/Keyboard.test.tsx`                                    | 10    | 10      | 6      | 4/0                   | 60%       | 0 of 4           | mixed: 7/3/0    |
| `score/midiCopy.test.ts`                                     | 4     | 10      | 9      | 1/0                   | 90%       | 0 of 1           | -               |
| `score/MidiImportPanel.test.tsx`                             | 3     | 4       | 4      | 0/0                   | 100%      | -                | -               |
| `score/onsetGroups.test.ts`                                  | 3     | 10      | 5      | 2/0                   | 71%       | 0 of 2           | useful: 3/0/0   |
| `score/RedFlight.test.ts`                                    | 5     | 10      | 3      | 1/6                   | 75%       | 0 of 7           | -               |
| `score/render/dom.test.ts`                                   | 8     | 10      | 7      | 3/0                   | 70%       | 0 of 3           | -               |
| `score/render/injectIds.test.ts`                             | 3     | 5       | 5      | 0/0                   | 100%      | -                | -               |
| `score/render/normalizeVoices.test.ts`                       | 4     | 10      | 6      | 2/2                   | 75%       | 0 of 4           | -               |
| `score/render/renderer.test.ts`                              | 4     | 10      | 6      | 4/0                   | 60%       | 0 of 4           | mixed: 3/1/0    |
| `score/render/scanBeams.test.ts`                             | 15    | 10      | 7      | 3/0                   | 70%       | 0 of 3           | useful: 15/0/0  |
| `score/render/verovio.midi.node.test.ts` (read, not mutated) | -     | -       | -      | -                     | -         | -                | mixed: 1/1/0    |
| `score/render/verovio.node.test.ts` (read, not mutated)      | -     | -       | -      | -                     | -         | -                | useful: 1/0/0   |
| `score/score.i18n.test.tsx`                                  | 7     | 9       | 0      | 5/4                   | 0%        | 7 of 9           | weak: 1/6/0     |
| `score/ScoreHeader.test.tsx`                                 | 4     | 9       | 4      | 3/2                   | 57%       | 1 of 5           | mixed: 2/2/0    |
| `score/ScoreSheet.test.tsx`                                  | 2     | 5       | 1      | 4/0                   | 20%       | 0 of 4           | weak: 1/1/0     |
| `score/ScoreView.letters.test.tsx`                           | 3     | 10      | 2      | 6/2                   | 25%       | 2 of 8           | useful: 3/0/0   |
| `score/ScoreView.test.ts`                                    | 10    | 10      | 2      | 0/8                   | 100%      | 2 of 8           | -               |
| `score/SidePanel.test.tsx`                                   | 13    | 10      | 2      | 2/6                   | 50%       | 0 of 8           | mixed: 9/3/1    |
| `score/Transport.test.tsx`                                   | 25    | 10      | 9      | 1/0                   | 90%       | 0 of 1           | -               |
| `score/useCursor.test.ts`                                    | 29    | 10      | 8      | 1/1                   | 89%       | 0 of 2           | -               |
| `score/usePlayback.ornaments.test.ts`                        | 1     | 10      | 2      | 7/1                   | 22%       | 0 of 8           | mixed: 1/0/0    |
| `score/useScoreDocument.midi.test.ts`                        | 3     | 10      | 3      | 2/5                   | 60%       | 4 of 7           | useful: 2/1/0   |
| `score/useScoreDocument.test.ts`                             | 11    | 10      | 6      | 3/1                   | 67%       | 1 of 4           | useful: 9/2/0   |
| `cli/bench.test.ts`                                          | 18    | 10      | 7      | 3/0                   | 70%       | 0 of 3           | -               |
| `cli/corpora.test.ts`                                        | 10    | 10      | 5      | 4/1                   | 56%       | 0 of 5           | mixed: 6/3/1    |
| `cli/evalhands.test.ts`                                      | 4     | 10      | 5      | 5/0                   | 50%       | 0 of 5           | mixed: 3/1/0    |
| `cli/evaluate.test.ts`                                       | 2     | 10      | 9      | 1/0                   | 90%       | 0 of 1           | useful: 2/0/0   |
| `cli/import.test.ts`                                         | 4     | 9       | 7      | 2/0                   | 78%       | 0 of 2           | -               |
| `cli/learn.test.ts`                                          | 4     | 10      | 6      | 3/0                   | 67%       | 0 of 3           | -               |
| `cli/run.test.ts`                                            | 21    | 10      | 5      | 1/4                   | 83%       | 0 of 5           | -               |
| `eval/align.test.ts`                                         | 6     | 10      | 5      | 4/1                   | 56%       | 0 of 1           | useful: 5/1/0   |
| `eval/hands.test.ts`                                         | 4     | 10      | 5      | 5/0                   | 50%       | 0 of 2           | mixed: 2/2/0    |
| `eval/hardErrors.test.ts`                                    | 2     | 10      | 9      | 1/0                   | 90%       | 0 of 1           | -               |
| `eval/metamorphic.test.ts` (read, not mutated)               | -     | -       | -      | -                     | -         | -                | mixed: 4/2/1    |
| `eval/metrics.reference.test.ts` (read, not mutated)         | -     | -       | -      | -                     | -         | -                | mixed: 1/0/0    |
| `eval/metrics.test.ts`                                       | 18    | 10      | 9      | 1/0                   | 90%       | -                | -               |
| `eval/omr.test.ts`                                           | 29    | 10      | 8      | 2/0                   | 80%       | -                | useful: 26/3/0  |
| `eval/textbook.test.ts` (read, not mutated)                  | -     | -       | -      | -                     | -         | -                | mixed: 3/3/2    |
| `fingering/features.test.ts`                                 | 6     | 10      | 3      | 5/2                   | 38%       | -                | mixed: 3/1/0    |
| `fingering/geometry.test.ts`                                 | 2     | 10      | 8      | 2/0                   | 80%       | -                | -               |
| `fingering/params/weightSets.test.ts`                        | 4     | 10      | 0      | 4/1                   | 0%        | -                | mixed: 2/2/0    |
| `fingering/profilesWeights.test.ts`                          | 15    | 10      | 8      | 1/1                   | 89%       | -                | -               |
| `fingering/repeats.test.ts`                                  | 9     | 10      | 7      | 3/0                   | 70%       | -                | -               |
| `fingering/rules.test.ts`                                    | 30    | 10      | 7      | 2/1                   | 78%       | -                | -               |
| `fingering/sequence.test.ts`                                 | 5     | 10      | 4      | 1/5                   | 80%       | -                | useful: 4/1/0   |
| `fingering/solve.test.ts`                                    | 47    | 10      | 5      | 3/1                   | 63%       | -                | useful: 35/10/2 |
| `fingering/spans.test.ts`                                    | 5     | 10      | 10     | 0/0                   | 100%      | -                | -               |
| `fingering/templates.test.ts`                                | 21    | 10      | 9      | 1/0                   | 90%       | -                | -               |
| `fingering/viterbi.test.ts`                                  | 7     | 10      | 7      | 3/0                   | 70%       | -                | -               |
| `io/midi/engrave.library.test.ts` (read, not mutated)        | -     | -       | -      | -                     | -         | -                | useful: 1/0/0   |
| `io/midi/engrave.test.ts`                                    | 13    | 10      | 5      | 1/4                   | 83%       | -                | -               |
| `io/midi/handSeparation.test.ts`                             | 11    | 10      | 7      | 3/0                   | 70%       | -                | useful: 8/3/0   |
| `io/midi/import.test.ts`                                     | 7     | 10      | 7      | 3/0                   | 70%       | -                | -               |
| `io/midi/key.test.ts`                                        | 9     | 10      | 7      | 3/0                   | 70%       | -                | -               |
| `io/midi/motion.test.ts`                                     | 5     | 10      | 1      | 4/0                   | 20%       | -                | mixed: 3/2/0    |
| `io/midi/quantize.test.ts`                                   | 8     | 10      | 6      | 4/0                   | 60%       | -                | useful: 7/1/0   |
| `io/midi/read.test.ts`                                       | 10    | 10      | 7      | 3/0                   | 70%       | -                | -               |
| `io/midi/toScore.test.ts`                                    | 12    | 10      | 7      | 2/1                   | 78%       | -                | -               |
| `io/musicxml/infra.test.ts`                                  | 16    | 12      | 7      | 3/2                   | 70%       | -                | useful: 11/4/1  |
| `io/musicxml/ornaments.test.ts`                              | 12    | 10      | 7      | 1/2                   | 88%       | -                | -               |
| `io/musicxml/read.omr.test.ts`                               | 49    | 10      | 6      | 0/4                   | 100%      | -                | -               |
| `io/musicxml/read.test.ts`                                   | 53    | 10      | 7      | 1/2                   | 88%       | -                | -               |
| `io/musicxml/scanOrnaments.test.ts`                          | 4     | 10      | 2      | 3/5                   | 40%       | -                | mixed: 3/1/0    |
| `io/musicxml/smoke.test.ts` (read, not mutated)              | -     | -       | -      | -                     | -         | -                | weak: 0/1/0     |
| `io/musicxml/write.test.ts`                                  | 5     | 10      | 8      | 2/0                   | 80%       | -                | -               |
| `io/pig/pig.test.ts`                                         | 14    | 10      | 5      | 3/2                   | 63%       | -                | useful: 12/2/0  |
| `learn/bootstrap.test.ts`                                    | 4     | 10      | 6      | 4/0                   | 60%       | -                | mixed: 2/2/0    |
| `learn/calibration.test.ts`                                  | 17    | 10      | 9      | 1/0                   | 90%       | -                | useful: 15/2/0  |
| `learn/data.test.ts`                                         | 7     | 10      | 10     | 0/0                   | 100%      | -                | -               |
| `learn/features.test.ts`                                     | 14    | 10      | 10     | 0/0                   | 100%      | -                | -               |
| `learn/lcg.test.ts`                                          | 5     | 10      | 9      | 1/0                   | 90%       | -                | -               |
| `learn/perceptron.test.ts`                                   | 16    | 10      | 7      | 2/1                   | 78%       | 0 of 3           | -               |
| `library/benchmarkSet.test.ts`                               | 4     | 9       | 9      | 0/0                   | 100%      | -                | useful: 4/0/0   |
| `lint/lint.test.ts`                                          | 20    | 10      | 8      | 2/0                   | 80%       | 1 of 2           | -               |
| `lint/rules.test.ts`                                         | 14    | 10      | 5      | 3/2                   | 63%       | 3 of 5           | useful: 13/0/1  |
| `score/build.test.ts`                                        | 8     | 10      | 8      | 1/1                   | 89%       | 0 of 2           | -               |
| `score/ornaments.test.ts`                                    | 9     | 10      | 5      | 5/0                   | 50%       | 0 of 5           | mixed: 7/2/0    |
| `score/pitch.test.ts`                                        | 7     | 10      | 7      | 3/0                   | 70%       | 1 of 3           | -               |
| `version.test.ts`                                            | 1     | 0       | 0      | 0/0                   | n/a       | -                | weak: 0/1/0     |
