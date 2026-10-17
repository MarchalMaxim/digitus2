# Verification loop

`pnpm verify` is the definition of done: a change counts only when every step passes on the working tree. The goals, oracles and checks behind it are specified in `docs/superpowers/specs/2026-10-13-verification-design.md`; experiments are logged in `docs/experiments.md`.

## What `pnpm verify` runs

`scripts/verify.mjs` runs these steps in order, prints a summary table and exits non-zero when any step fails. A step whose data or prerequisite is missing reports SKIP with the reason and does not fail the run.

| Step                | Command                                   | Fails when                                                                                                                      |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `hygiene`           | `node scripts/check-repo-size.mjs`        | a trackable file or the repository exceeds its size limit, or a heavy directory is not ignored (details below)                  |
| `design`            | `node scripts/check-colors.mjs`           | a colour breaks the black, white and one-red rule (details below)                                                               |
| `typecheck`         | `pnpm typecheck`                          | TypeScript errors in any package                                                                                                |
| `lint`              | `pnpm lint`                               | ESLint errors                                                                                                                   |
| `unit`              | `pnpm test`                               | any vitest test fails, including the textbook floors (`packages/engine/src/eval/textbook.test.ts`)                              |
| `build`             | `pnpm build`                              | the engine or the app does not build                                                                                            |
| `omr`               | `pnpm test:omr`                           | the scanning harness tests fail (`research/omr/*.test.mjs`, run against the built engine)                                       |
| `bundle`            | `node scripts/check-bundle-size.mjs`      | the library page's initial JavaScript and CSS exceed 150 KB gzip, or a Verovio chunk is statically imported                     |
| `e2e`               | `pnpm --filter @digitus2/web e2e`         | the app build or any Playwright flow fails (details below)                                                                      |
| `benchmark`         | `digitus2 bench` on PIG                   | a floor is breached (see Floors); also runs `benchmark:mutopia` and reports repeat consistency on the library without gating it |
| `benchmark:mutopia` | `digitus2 bench` on the Mutopia test half | a floor is breached (see Floors)                                                                                                |
| `hands`             | `digitus2 evalhands`                      | a floor is breached (see Floors)                                                                                                |

Details:

- `hygiene`: a trackable file over 1 MB (scores 1.5 MB; the manifest, verification records and archive catalog fragments have their own limits), trackable files over 100 MB in total, or a heavy directory (`research/data/pig`, `content/_raw`, ...) not ignored by git. It uses `git ls-files`.
- `design`: a colour literal in `apps/web/src` or `index.html` outside `src/design/tokens.css`, a second chromatic colour in `tokens.css`, or the red referenced outside the `.is-red` rule.
- `omr`: fixture validation, pinned ground truth, whole-score export handling, and penalties for missing or invalid results. It runs no recognition model and is not an accuracy gate.
- `bundle`: counts the entry chunk and its static imports from `apps/web/dist/.vite/manifest.json`.
- `e2e`: fails on more or fewer than one red element in any application state of `apps/web/e2e/helpers/states.ts` (desktop and 360 px, light and dark), a serious or critical axe violation, horizontal page scroll, library LCP of 2 s or more, the K.545 score taking 8 s or more to appear, the cursor out of sync with the audio clock, or (locally, project `visual`) a screenshot differing from its baseline.

The benchmark and hands steps run `packages/engine/dist/cli/main.js`, so they need a build, and they skip when the datasets are absent (`research/data/pig`, `research/data/mutopia_fingering`; see `research/data/README.md`). A run with those steps skipped has not checked the floors.

The format check (`pnpm format:check`) is not a verify step; CI runs it, so run it before pushing.

## Running steps individually

Name one or more steps: `pnpm verify unit`, `pnpm verify build bundle`, `pnpm verify build omr`, `pnpm verify build benchmark`, `pnpm verify benchmark:mutopia` (the Mutopia oracle alone).

- **E2E port.** Playwright starts `vite preview` on port 4173 and, outside CI, reuses any server already listening there: stop a stale preview first, or the suite tests an old build. `DIGITUS2_E2E_PORT=4189 pnpm verify` gives a second checkout its own port.
- **Visual baselines.** The `visual` project runs only outside CI (fonts differ between machines) and compares against `apps/web/e2e/visual.spec.ts-snapshots/`. The committed baselines are Windows renders (`*-win32.png`); on another OS there is nothing to compare against, so run the other projects only: `pnpm --filter @digitus2/web build && pnpm --filter @digitus2/web exec playwright test --project desktop --project mobile`. After an intended visual change, rewrite the baselines on Windows with `pnpm --filter @digitus2/web exec playwright test --project=visual --update-snapshots=all`, review every PNG, and restore the ones the change should not have touched. The comparison tolerates small pixel differences (`maxDiffPixelRatio` 0.002), so a changed count in a baseline can go stale without failing.

## Floors

`benchmarks/floor.json` holds the floors. Both benchmark steps solve with the weight set named by `weightSet` (`learned-open`, the engine's `RECOMMENDED_WEIGHT_SET`); a run with another set, or with weights whose hash differs from `weightSetHash` (the set was retrained without re-measuring the floors), is a breach. `bench` picks the floor block by the run's split file.

| Step                | Corpus                                                           | Fails when                                                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `benchmark`         | PIG official test split (30 pieces)                              | gen, high, soft or rec below `engine` (63.3, 69.9, 84.7, 75.8); lint errors per 1,000 notes above `lint.errorsPer1000Max` (3.92); calibration ECE above `calibration.eceMax` (0.0885); a piece skipped |
| `benchmark:mutopia` | Mutopia test half (62 parts, gold notes without a finger masked) | gen below `mutopia.gen` (64.9); a part skipped                                                                                                                                                         |
| `hands`             | PIG test split and the library's `core30` set                    | PIG macro hand-separation accuracy below `hands.accuracyMin` (91.0)                                                                                                                                    |
| `unit` (textbook)   | Textbook oracle (672 entries)                                    | note accuracy below `textbook`, solved with the solver's default weights (`parncutt`)                                                                                                                  |

A floor is the milestone's measurement minus 0.5, rounded down, and is raised in the same commit as the improvement, with a row in `benchmarks/history.md`. The Python scorer in `research/fingering_eval/` matches the official PIG evaluator, and the TypeScript metrics are checked against it.

### Scorecards

`pnpm verify` never rewrites a tracked file. Its scorecards go to the gitignored `benchmarks/runs/verify-pig.json`, `verify-mutopia.json` and `verify-hands.json`. The tracked `benchmarks/latest.json` (PIG test split), `latest-mutopia.json` and `latest-hands.json` are milestone scorecards: a `bench` run with `--label` and neither `--limit` nor `--scorecard` replaces them, and is committed with the floors and the history row it backs. The milestone runs, from the repository root after `pnpm build`:

```bash
node packages/engine/dist/cli/main.js bench --gold research/data/pig --split research/data/splits/pig_official.json --label m3-open --weights learned-open --compare research/baselines/results_per_piece_test.csv --floor benchmarks/floor.json
node packages/engine/dist/cli/main.js bench --gold research/data/mutopia_fingering --split research/data/splits/mutopia_split.json --subset test --label mutopia-open --weights learned-open --floor benchmarks/floor.json
node packages/engine/dist/cli/main.js evalhands --gold research/data/pig --split research/data/splits/pig_official.json --subset test --library content/manifest.json --label m6-hands --out benchmarks/latest-hands.json
```

A PIG-fitted research set (never shipped) writes under `research/weights/` with `--out research/weights/pig/runs`. Every run prints deltas against the milestone scorecard of its corpus only when both were solved with the same weights.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and on pull requests: install, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm test:omr`, then the Playwright e2e suite with `CI=true` (no `visual` project, one retry, the HTML report uploaded on failure). The hygiene, design, bundle, benchmark and hands steps run only under `pnpm verify`: PIG cannot be redistributed, so CI has no benchmark data. The solver's random-walk timing test allows 1,200 ms under CI against 500 ms locally, because the GitHub runner is slower.

`.github/workflows/pages.yml` builds and deploys the app to GitHub Pages on every push to `main`.

## Recovery after a restart or a context compaction

1. Read `CLAUDE.md`, `docs/PROGRESS.md` and `docs/TODO.md`.
2. Check the tree: `git status` and `git log` show uncommitted output and the current branch.
3. Run `pnpm verify` (with the datasets in place) to learn the true state.
4. Look for agents or workflows that were interrupted: see which tasks finished, inspect the files an interrupted agent touched, and resume the workflow from its saved script (finished tasks are cached) instead of starting over.
5. Commit finished work with explicit paths, update `docs/PROGRESS.md` and `docs/TODO.md`, and continue with "Next" in `docs/PROGRESS.md`.
