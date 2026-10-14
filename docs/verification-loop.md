# Verification loop

The project is built autonomously for days, so every change must be judged by machines, not by a person watching. This document is the operator's guide to the loop; the goals, oracles and checks themselves are specified in `docs/superpowers/specs/2026-10-13-verification-design.md`, and experiments are logged in `docs/experiments.md`. `CLAUDE.md` points here.

## One command

```bash
pnpm verify
```

`scripts/verify.mjs` runs, in order: hygiene (repository size), design (the color guard), typecheck, lint, unit tests (vitest for TypeScript), build, bundle (the app's first-load budget), end-to-end tests (Playwright), the benchmark gate (`benchmark`, which also runs `benchmark:mutopia`), and the hand-separation gate (`hands`). It prints a summary table and exits non-zero on any failure. `pnpm verify unit` runs one step; several names run several (`pnpm verify build bundle`; `pnpm verify benchmark:mutopia` runs the Mutopia oracle alone).

### Scorecards: what verify writes and what a milestone writes

`pnpm verify` never rewrites a tracked file. Its benchmark and hands steps write their scorecards to gitignored paths: `benchmarks/runs/verify-pig.json`, `benchmarks/runs/verify-mutopia.json` and `benchmarks/runs/verify-hands.json` (`.gitignore` covers `benchmarks/runs/` and the error galleries under `benchmarks/errors/`). The tracked `benchmarks/latest.json` (PIG test split), `benchmarks/latest-mutopia.json` (Mutopia test half) and `benchmarks/latest-hands.json` are milestone scorecards: only a labelled run replaces them, and it is committed with the floors and the `benchmarks/history.md` row it backs. A `bench` run is a milestone run when it has `--label` and neither `--limit` nor `--scorecard`; it then replaces `latest.json` for PIG or `latest-<corpus>.json` for another corpus. The M3 milestone runs, from the repository root after `pnpm build`:

```bash
node packages/engine/dist/cli/main.js bench --gold research/data/pig --split research/data/splits/pig_official.json --label m3-open --weights learned-open --compare research/baselines/results_per_piece_test.csv --floor benchmarks/floor.json
node packages/engine/dist/cli/main.js bench --gold research/data/mutopia_fingering --split research/data/splits/mutopia_split.json --subset test --label mutopia-open --weights learned-open --floor benchmarks/floor.json
node packages/engine/dist/cli/main.js evalhands --gold research/data/pig --split research/data/splits/pig_official.json --subset test --library content/manifest.json --label m6-hands --out benchmarks/latest-hands.json
```

A research set (PIG-fitted, never shipped) writes its scorecards under `research/weights/` with `--out research/weights/pig/runs`, so its milestone file is `research/weights/pig/latest.json`, never a tracked one. Every run prints its deltas against the milestone scorecard of its corpus, but only when both were solved with the same weights (`weightSet.hash`); otherwise the deltas read `-` and a line names the previous run and its weight set.

### What the benchmark steps gate

Both benchmark steps solve with the weight set named by `weightSet` in `benchmarks/floor.json` (`--weights`; since M3 `learned-open`, the engine's `RECOMMENDED_WEIGHT_SET`) and gate against that file. `bench` picks the floor block by the run's split file: the block whose `split` is that file (`mutopia` for the Mutopia split), else the PIG block (`engine`, `lint`, `calibration`) when floor.json's own `split` is that file; only when no block names the file does the first word of the split's `dataset` field decide. A run with another weight set than `weightSet`, or with weights whose hash differs from `weightSetHash` (the set was retrained without re-measuring the floors), is a breach, and so is an explicit `--floor` whose block for the split sets no metric.

| Step              | Corpus                                                           | Fails when                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| benchmark         | PIG official test split (30 pieces)                              | gen, high, soft or rec below `engine`; lint errors per 1000 notes above `lint.errorsPer1000Max`; calibration ECE above `calibration.eceMax`; a piece skipped; the weight set or its hash differs |
| benchmark:mutopia | Mutopia test half (62 parts, gold notes without a finger masked) | gen below `mutopia.gen` (reported with "no floor set" while it is null); a part skipped; the weight set or its hash differs                                                                      |
| hands             | PIG test split and the library                                   | PIG macro hand accuracy below `hands.accuracyMin`                                                                                                                                                |

The textbook floors (`textbook` in floor.json) are enforced by the unit step (`packages/engine/src/eval/textbook.test.ts`), with the solver's own default weights (parncutt).

### What the app steps gate

The web app (`apps/web`, described in `docs/app.md`) adds three steps; together they are verification spec check 3.9 and the goals "Be fast" (library page) and "Honor the design brief".

| Step   | Command                                                     | Fails when                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| design | `node scripts/check-colors.mjs`                             | a color literal appears in `apps/web/src` or `index.html` outside `src/design/tokens.css`, `tokens.css` gains a second chromatic color, or the red is referenced outside the `.is-red` rule                                                                                                                                                                                                                                                            |
| bundle | `node scripts/check-bundle-size.mjs` (after build)          | the library page's initial JavaScript and CSS (the entry chunk and its static imports, from `apps/web/dist/.vite/manifest.json`) exceed 150 KB gzip, or a Verovio chunk is statically imported by the entry                                                                                                                                                                                                                                            |
| e2e    | `pnpm --filter @digitus2/web e2e` (builds, then Playwright) | any flow fails, including: more or fewer than one red element in any of the ten application states (`e2e/states.spec.ts`, desktop and 360 px), a serious or critical axe violation, horizontal page scroll, library LCP of 2 s or more, the K.545 score taking 8 s or more to appear, the cursor out of sync with the audio clock, or (locally, project `visual`) a screenshot differing from its baseline in `apps/web/e2e/visual.spec.ts-snapshots/` |

The `visual` project exists only outside CI (fonts differ between machines). After an intended visual change, rewrite the baselines with `pnpm --filter @digitus2/web exec playwright test --project=visual --update-snapshots=all` and review the PNGs before committing. Playwright reuses any server already listening on port 4173; stop a stale `vite preview` before a run, or the suite tests an old build.

Definition of done for any change, by a person or an agent: `pnpm verify` is green on the working tree before the commit.

## Levels

1. Unit tests next to the code (`*.test.ts`), written before the implementation. Readers and writers have round-trip tests; the solver has hand-constructed cases with known answers (scales, arpeggios, chords, repeated notes, crossings) and metamorphic property tests (octave transposition, mirror symmetry, repeated-passage consistency, pin idempotence).
2. Integration: the engine CLI parses every built-in score in `content/scores/` (smoke test) and round-trips PIG files; the app's Playwright flow opens a piece, sees fingerings, plays, edits a finger, exports.
3. Benchmark gate: `digitus2 bench` runs the solver, with the weight set named by `weightSet` in `benchmarks/floor.json`, over the official PIG test split and compares general, highest, soft and recombination match rates, lint errors and the calibration ECE with `benchmarks/floor.json`; `benchmark:mutopia` does the same for the held-out Mutopia test half. A drop below the floor fails `pnpm verify`. When a milestone improves the numbers, the floor is raised in the same commit. The floor file also records the baselines we must beat and the human ceiling.

3b. Hand-separation gate: `digitus2 evalhands` scores the MIDI hand separation on the PIG test split (first annotation per piece, channel = truth) and on the 30 library pieces (staff = truth), writes its scorecard (`benchmarks/runs/verify-hands.json` under verify, `benchmarks/latest-hands.json` for a milestone), and fails `pnpm verify` (step `hands`) when the PIG macro accuracy drops below `hands.accuracyMin` in `benchmarks/floor.json`.

4. Research cross-check: the Python scorer in `research/fingering_eval/` matches the official PIG evaluator; the TypeScript metrics are checked against it on real files, so both sides agree before any number is trusted.
5. CI: `.github/workflows/ci.yml` runs the same steps on every push to `main`, minus the benchmark when the dataset is not available in CI. As of M4 it runs typecheck, lint, the format check, unit, build and e2e (without the local-only `visual` project); the hygiene, design and bundle steps run under `pnpm verify` only until the workflow calls them too.

## Recovery after a restart or a context compaction

1. Read `docs/PROGRESS.md` (milestone table, directory ownership, log).
2. Run `pnpm verify` to learn the true state of the tree; `git status` shows uncommitted agent output.
3. Check running agents (ListAgents) and the latest workflow journal under the session directory (`subagents/workflows/<run>/journal.jsonl`); relaunch a dead workflow with its saved script (completed tasks are cached) and resume dead research agents with a short message.
4. Commit finished work with explicit paths, update the journal, continue with the next plan.
