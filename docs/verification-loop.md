# Verification loop

`pnpm verify` is the definition of done: a change counts only when every step passes on the working tree. The goals, oracles and checks behind it are specified in `docs/superpowers/specs/2026-10-13-verification-design.md`; experiments are logged in `docs/experiments.md`. While iterating, run `pnpm verify --changed`; run the full `pnpm verify` once before the pull request.

## What `pnpm verify` runs

`scripts/verify.mjs` runs these steps as a graph, not one after another (issue 134), prints a summary table in the order of the table below and exits non-zero when any step fails. A step whose data or prerequisite is missing reports SKIP with the reason and does not fail the run.

The scheduler is `scripts/verify-graph.mjs`. A step starts once the steps it depends on have passed: `omr`, `omr:acceptance`, `bundle`, `e2e`, `benchmark`, `benchmark:mutopia`, `hands` and `embellish` need the built engine or app and wait for `build`; the other steps start at once. A step checks its preconditions (the built engine CLI, the datasets, the recognisers) only when its dependencies are done, so a fresh checkout does not skip the benchmark for want of a build that is about to exist; a step that cannot check them, or cannot start, fails with the reason in the summary while the others go on. When a dependency fails, its dependants report SKIP `not run: <step> failed` (the run fails because the dependency failed); a dependency that was itself skipped reports `not run: <step> did not run`. A dependency that is not among the named steps is not waited for: `pnpm verify omr` does not run `build`. The heavy steps (`unit`, which takes every core, `omr:acceptance`, whose recognisers use the cores, `e2e`, whose playback specs sample frames in real time, and `e2e:loop`, whose homr uses the cores) never run at the same time as each other; the other steps run alongside them. The scheduler has its own tests with fake steps, `scripts/verify-graph.test.mjs`, which `pnpm test` runs after the workspace suites (root `package.json`).

Each step's output goes to the gitignored `benchmarks/runs/verify-logs/<step>.log`. The console shows one line when each step starts and one when it ends, then the summary in the order of the table, then the last 40 lines of the log of every failed step that ran. If a timing-sensitive test (the playback specs, a vitest timeout) fails under load, `pnpm verify --serial` runs the steps one after another in the order of the table, with their output on the console, as `pnpm verify` ran them before issue 134.

| Step                | Command                                                                                                                 | Fails when                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hygiene`           | `node scripts/check-repo-size.mjs`                                                                                      | a trackable file or the repository exceeds its size limit, or a heavy directory is not ignored (details below)                                                                                                                       |
| `design`            | `node scripts/check-colors.mjs`                                                                                         | a colour breaks the black, white and one-red rule (details below)                                                                                                                                                                    |
| `typecheck`         | `pnpm typecheck`                                                                                                        | TypeScript errors in any package                                                                                                                                                                                                     |
| `lint`              | `pnpm lint`                                                                                                             | ESLint errors                                                                                                                                                                                                                        |
| `unit`              | `pnpm test`                                                                                                             | any vitest test fails, including the textbook floors (`packages/engine/src/eval/textbook.test.ts`), or a scheduler test (`scripts/verify-graph.test.mjs`)                                                                            |
| `build`             | `pnpm build`                                                                                                            | the engine or the app does not build                                                                                                                                                                                                 |
| `omr`               | `pnpm test:omr`                                                                                                         | the scanning harness tests fail (`research/omr/*.test.mjs`, run against the built engine)                                                                                                                                            |
| `omr:service`       | `python -m pytest research/omr/service research/omr/prototypes/local-worker -q`                                         | a Python test of the scan service or the loopback worker fails; SKIP without Python or pytest                                                                                                                                        |
| `omr:acceptance`    | `node research/omr/acceptance.mjs`                                                                                      | a scanning route (homr on four photo-like variants, Audiveris on PDFs) falls below `research/omr/acceptance/floor.json` on the library corpus; SKIP without the recognisers (`docs/research/omr.md`, Acceptance corpus and gate)     |
| `bundle`            | `node scripts/check-bundle-size.mjs`                                                                                    | the library page's initial JavaScript and CSS exceed 150 KB gzip, or a Verovio chunk is statically imported                                                                                                                          |
| `e2e`               | `pnpm --filter @digitus2/web exec playwright test` with `build` in the run, otherwise `pnpm --filter @digitus2/web e2e` | any Playwright flow fails, or (without `build` in the run) the app build fails (details below)                                                                                                                                       |
| `e2e:loop`          | `pnpm --filter @digitus2/web exec playwright test --project=loop`                                                       | the camera loop fails (`docs/scanning.md`, The loop on the PC); SKIP without a prepared homr (`DIGITUS2_OMR_HOMR`), which is not a pass                                                                                              |
| `benchmark`         | `digitus2 bench` on PIG                                                                                                 | a floor is breached (see Floors); also runs `benchmark:mutopia` and reports repeat consistency on the library without gating it                                                                                                      |
| `benchmark:mutopia` | `digitus2 bench` on the Mutopia test half                                                                               | a floor is breached (see Floors)                                                                                                                                                                                                     |
| `hands`             | `digitus2 evalhands`                                                                                                    | a floor is breached (see Floors)                                                                                                                                                                                                     |
| `embellish`         | `digitus2 embellish --library`                                                                                          | an offered level 1–2 piece fails the independent check, the lint at a hand size (a law error, or more beginner errors than the plain score) or the level (more than one up), or fewer pieces are offered than `embellish.offeredMin` |

Details:

- `hygiene`: a trackable file over 1 MB (scores 1.5 MB; the manifest, verification records and archive catalog fragments have their own limits), trackable files over 120 MB in total, or a heavy directory (`research/data/pig`, `content/_raw`, the piano samples in `apps/web/public/piano` and `build/piano-samples`, ...) not ignored by git. It uses `git ls-files`.
- `design`: a colour literal in `apps/web/src` or `index.html` outside `src/design/tokens.css`, a second chromatic colour in `tokens.css`, or the red referenced outside the `.is-red` rule.
- `omr`: fixture validation, pinned ground truth, whole-score export handling, and penalties for missing or invalid results. It runs no recognition model and is not an accuracy gate.
- `omr:acceptance`: a recognition is cached under `research/omr/results/acceptance/` by the hash of its input and of the pipeline's files, so a rerun recognises only what changed. On a cache miss `research/omr/acceptance/recognize.py` runs three recognitions at a time (`--workers`; `DIGITUS2_OMR_WORKERS` sets the number, `1` for one at a time). Each job is a separate native process that keeps the recognisers' own thread settings, so its output equals the serial run's byte for byte (checked on all 96 corpus and photo jobs, apart from the temporary input path Audiveris writes into its own output). ONNX Runtime sizes its own thread pool per job, so the jobs share the cores rather than having four each; three Audiveris JVMs with their 4 GiB heaps fit in 32 GB.
- `bundle`: counts the entry chunk and its static imports from `apps/web/dist/.vite/manifest.json`.
- `e2e`: with `build` in the run, the specs run on the build's output (`pnpm --filter @digitus2/web e2e` would build the web app again and rewrite `apps/web/dist` while `bundle` reads it); without `build` in the run, the `e2e` script builds the app first. It fails on more or fewer than one red element in any application state of `apps/web/e2e/helpers/states.ts` (desktop and 360 px, light and dark), a serious or critical axe violation, horizontal page scroll, library LCP of 2 s or more, the K.545 score taking 8 s or more to appear, the cursor out of sync with the audio clock, or (locally, project `visual`) a screenshot differing from its baseline. Every spec blocks service workers except `pwa.spec.ts`, which checks the web app manifest and icons, the service worker controlling the first visit, an offline reload of a piece opened before, the piano playing offline from the samples kept, a newer worker cleaning up after the older one, and the Reload of the update notice (a waiting worker stays waiting until it is told to skip, then takes the open page over with one change of controller and one reload). `scan-camera.spec.ts`, `scan-camera-real.spec.ts` and `scan-grand-staff.spec.ts` also run in WebKit as the `iphone` project, because an iPhone has no other engine; Playwright's WebKit for Windows has no video streams, so the project is left out on Windows and `node scripts/e2e-webkit.mjs` runs it in Playwright's Linux image under Docker. Tests that throttle the CPU through DevTools run in Chromium only. `scan-camera-loop.spec.ts` is the `e2e:loop` step's own: a `loop` project (a phone window) that exists only when `DIGITUS2_E2E_LOOP` is set and is then run with `--project=loop`, run after `e2e` and never beside it, because local homr's threads slow the other specs' timing. It films a real page photo through the camera, has local homr read the fused page and follows it to the score view; the step reports SKIP without a prepared homr (`DIGITUS2_OMR_HOMR`, and Python 3.11), which is not a pass (`docs/scanning.md`, The loop on the PC). No spec needs the piano samples: the flows that play the real instrument answer its sample requests with a silent WAV.

The benchmark and hands steps run `packages/engine/dist/cli/main.js`: they wait for the `build` step when it is in the run and otherwise need a build already in place, and they skip when the datasets are absent: no `FingeringFiles/` folder under `research/data/pig` or `research/data/mutopia_fingering`, because the manifests tracked beside them are not the data (see `research/data/README.md`). A run with those steps skipped has not checked the floors.

The `embellish` step needs only the build and the committed library, so it never reports SKIP once the build has run. It runs the same guard as the app, then checks each offered piece again on its own, in about a minute.

The format check (`pnpm format:check`) is not a step of the full `pnpm verify`; CI runs it, so run it before pushing. `pnpm verify --changed` runs it on the changed files.

### Wall time

Per step, one graph run on the dev machine (the camera work of issue 147), in a checkout without the datasets and without homr: `benchmark`, `benchmark:mutopia`, `hands` and `e2e:loop` skipped, `omr:acceptance` was cached or skipped, so their times are not in the table:

| Step                          | Time      |
| ----------------------------- | --------- |
| `e2e`                         | 239 s     |
| `embellish`                   | 52 s      |
| `unit`                        | 45 s      |
| `omr:service`                 | 30 s      |
| `typecheck`                   | 11 s      |
| `build`                       | 11 s      |
| `lint`                        | 6 s       |
| `hygiene`, `design`, `bundle` | under 1 s |

The wall time of the whole `pnpm verify`, measured on the dev machine (16 cores, 32 GB), with the PIG and Mutopia data and the recognisers in place (the serial run shared the machine with code-review agents, which slowed its `e2e`):

| Run                                                        | Wall time | `unit` | `e2e` |
| ---------------------------------------------------------- | --------- | ------ | ----- |
| serial (`--serial`), recognitions cached, no Beringer data | 544 s     | 17 s   | 374 s |
| graph, recognitions cached, no Beringer data               | 239 s     | 25 s   | 208 s |
| graph, cache miss (all 96 recognitions), no Beringer data  | 736 s     | 27 s   | 205 s |
| graph, recognitions cached, all data                       | 281 s     | 100 s  | 177 s |

Without the Beringer corpus the corpora tests skip, so `unit` takes about 20 s instead of 100 s. The longest chain is `build`, then `unit`, then `e2e`, because the heavy steps never overlap. Under the load of a second checkout's `pnpm verify`, the solver's timing test (`solve.test.ts`, the 2000-note random walk) failed once; `--serial`, or one verify at a time, avoids that. The recognition alone, on a cache miss:

| Recognition on a cache miss | Wall time |
| --------------------------- | --------- |
| one at a time               | 904 s     |
| three workers               | 532 s     |

## Running steps individually

Name one or more steps: `pnpm verify unit`, `pnpm verify build bundle`, `pnpm verify build omr`, `pnpm verify build benchmark`, `pnpm verify benchmark:mutopia` (the Mutopia oracle alone), `pnpm verify build embellish`. A named step waits only for the named steps it depends on: `pnpm verify build omr` builds first, `pnpm verify omr` runs against the build already in place. `pnpm verify --serial` runs the selection one step at a time.

- **E2E port.** Playwright starts `vite preview` on port 4173 and, outside CI, reuses any server already listening there: stop a stale preview first, or the suite tests an old build. `DIGITUS2_E2E_PORT=4189 pnpm verify` gives a second checkout its own port.

## Verifying only what a change touches

`pnpm verify --changed` is the loop while working; it does not replace the full run. It takes the files changed since the branch left `origin/main` (the diff against the merge-base, committed and uncommitted, plus untracked files; nothing is fetched) and runs:

- always: `hygiene`, `design`, `typecheck`, `lint` and `format` (`prettier --check` on the changed files);
- the steps the changed paths map to, from the rule table in `scripts/verify-changed.mjs` (the first matching rule wins). Paths that every area depends on select every step: `packages/engine`, `apps/web/src/app`, `design`, `i18n`, `engine` and `test`, the web app's and the repository's configuration files, and `content/`. A path no rule matches also selects every step, so a new directory is slow, never unchecked, until it gets a rule;
- the steps those need: a selected `e2e`, `bundle` or benchmark step brings `build` with it;
- `e2e` narrowed to the specs of the matching rules (a changed spec file runs alone), `unit` narrowed to the web tests that import a changed file (`vitest related`), and the script tests when `scripts/verify*` changed. A change that selects every step runs every spec and the whole test suite, and so does a change to a file some test reads outside the web sources: `benchmarks/` and the scripts the web tests import (`scripts/check-colors.mjs`, `scripts/piano-samples*`). A deleted spec file selects nothing; a rule that names a step `scripts/verify.mjs` does not have makes the run fail rather than drop the step.

The run prints before it starts what it will run and why, the specs and the unit selection, and after the summary every step it skipped with the reason. All selected steps passing is not done: the full `pnpm verify` once before the pull request is.

## Floors

`benchmarks/floor.json` holds the floors. Both benchmark steps solve with the weight set named by `weightSet` (`learned-open`, the engine's `RECOMMENDED_WEIGHT_SET`); a run with another set, or with weights whose hash differs from `weightSetHash` (the set was retrained without re-measuring the floors), is a breach. `bench` picks the floor block by the run's split file.

| Step                | Corpus                                                           | Fails when                                                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `benchmark`         | PIG official test split (30 pieces)                              | gen, high, soft or rec below `engine` (63.3, 69.9, 84.7, 75.8); lint errors per 1,000 notes above `lint.errorsPer1000Max` (3.92); calibration ECE above `calibration.eceMax` (0.0885); a piece skipped |
| `benchmark:mutopia` | Mutopia test half (62 parts, gold notes without a finger masked) | gen below `mutopia.gen` (64.9); a part skipped                                                                                                                                                         |
| `hands`             | PIG test split and the library's `core30` set                    | PIG macro hand-separation accuracy below `hands.accuracyMin` (91.0)                                                                                                                                    |
| `unit` (textbook)   | Textbook oracle (672 entries)                                    | note accuracy below `textbook`, solved with the solver's default weights (`parncutt`)                                                                                                                  |
| `embellish`         | the library's level 1 and 2 pieces (267)                         | offered below `embellish.offeredMin` (175)                                                                                                                                                             |

A floor is the milestone's measurement minus 0.5, rounded down (except `embellish.offeredMin`, which is the measured count, because the run is deterministic), and is raised in the same commit as the improvement, with a row in `benchmarks/history.md`. The Python scorer in `research/fingering_eval/` matches the official PIG evaluator, and the TypeScript metrics are checked against it.

### Scorecards

`pnpm verify` never rewrites a tracked file. Its scorecards go to the gitignored `benchmarks/runs/verify-pig.json`, `verify-mutopia.json`, `verify-hands.json` and `verify-embellish.json`. The tracked `benchmarks/latest.json` (PIG test split), `latest-mutopia.json` and `latest-hands.json` are milestone scorecards: a `bench` run with `--label` and neither `--limit` nor `--scorecard` replaces them, and is committed with the floors and the history row it backs. The milestone runs, from the repository root after `pnpm build`:

```bash
node packages/engine/dist/cli/main.js bench --gold research/data/pig --split research/data/splits/pig_official.json --label m3-open --weights learned-open --compare research/baselines/results_per_piece_test.csv --floor benchmarks/floor.json
node packages/engine/dist/cli/main.js bench --gold research/data/mutopia_fingering --split research/data/splits/mutopia_split.json --subset test --label mutopia-open --weights learned-open --floor benchmarks/floor.json
node packages/engine/dist/cli/main.js evalhands --gold research/data/pig --split research/data/splits/pig_official.json --subset test --library content/manifest.json --label m6-hands --out benchmarks/latest-hands.json
```

A PIG-fitted research set (never shipped) writes under `research/weights/` with `--out research/weights/pig/runs`. Every run prints deltas against the milestone scorecard of its corpus only when both were solved with the same weights.

## CI

Browser jobs use Ubuntu 24.04, supported by the pinned Playwright version. Keep that runner explicit: a newer `ubuntu-latest` image can fail browser installation before any test runs. Update the runner together with Playwright's supported operating systems.

`.github/workflows/ci.yml` runs on every push to `main` and on pull requests, as seven jobs side by side so the wall time is the longest job, about four minutes, not the sum: `typecheck, lint, format, build, omr`; `unit tests`; and five `e2e` jobs named for the specs they run (`playback`; `states on desktop`; `states on the phone`; `library, score, hands, embellish`; `the other specs`, which runs with `--grep-invert` so a new spec runs without being listed), each against the web build with `CI=true`: one retry, the group's HTML report uploaded on failure. The groups are balanced by measured time, and keep Playwright's default worker count, two on the runner's four cores, because the playback checks sample frames in real time and more browsers per runner would stretch them; speed comes from the number of jobs. A new push to a pull request cancels the run it supersedes. The hygiene, design, bundle, benchmark and hands steps run only under `pnpm verify`: PIG cannot be redistributed, so CI has no benchmark data. The solver's random-walk timing test has one budget everywhere: a ratio to a reference workload timed in the same moments, so a slower or busier machine does not move it.

Where the time goes, measured on the dev machine with the JSON reporter and read from the runner's logs: the e2e suite is about 1,100 worker-seconds (333 tests; `playback` 24 %, the `states` matrix of 34 states × light and dark × desktop and phone 33 %, the other 20 specs 43 %), which the runner, two to three times slower, ran in 13 minutes on two workers. The unit suites are 50 s each on the runner; two thirds of the web suite's time is worker start-up, happy-dom and the setup file per test file, so it runs in vitest's `threads` pool (`apps/web/vite.config.ts`). No test was removed for speed: every e2e test states a product rule (one red, contrast, axe, geometry, timing), and the slow ones (the cursor sampled against the dock for 18 s, Amazing Grace played to the end) are slow because the rule is about time.

`.github/workflows/pages.yml` builds and deploys the app to GitHub Pages on every push to `main`. Before the build it fetches the pinned piano samples (`node scripts/fetch-piano-samples.mjs`, which checks the release asset against `scripts/piano-samples.lock.json`; cached by the lock's hash), and after it fails unless `dist` holds the samples, `sw.js` and the web app manifest. `ci.yml` and `pnpm verify` do not fetch the samples; the service worker's precache budget (24 MiB) fails the `build` step, in CI and locally.

Checks that need a dataset outside the repository (the corpora, learn and reference-metrics suites) skip when it is absent, and say so on the console: `SKIPPED ... did not run`. CI has no such data, so those lines are expected there. On a machine that should have the data, `DIGITUS2_REQUIRE_DATA=1 pnpm test` turns each missing dataset into a failure instead.

## Recovery after a restart or a context compaction

1. Read `CLAUDE.md`, `docs/PROGRESS.md` and the open GitHub issues.
2. Check the tree: `git status` and `git log` show uncommitted output and the current branch.
3. Run `pnpm verify` (with the datasets in place) to learn the true state.
4. Look for agents or workflows that were interrupted: see which tasks finished, inspect the files an interrupted agent touched, and resume the workflow from its saved script (finished tasks are cached) instead of starting over.
5. Commit finished work with explicit paths, update `docs/PROGRESS.md`, close or tick the issue, and continue with "Next" in `docs/PROGRESS.md`.
