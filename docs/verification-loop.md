# Verification loop

The project is built autonomously for days, so every change must be judged by machines, not by a person watching. This document is the operator's guide to the loop; the goals, oracles and checks themselves are specified in `docs/superpowers/specs/2026-10-13-verification-design.md`, and experiments are logged in `docs/experiments.md`. `CLAUDE.md` points here.

## One command

```bash
pnpm verify
```

`scripts/verify.mjs` runs, in order: hygiene (repository size), design (the color guard), typecheck, lint, unit tests (vitest for TypeScript), build, bundle (the app's first-load budget), end-to-end tests (Playwright), the benchmark gate, and the hand-separation gate (`hands`). It prints a summary table and exits non-zero on any failure. `pnpm verify unit` runs one step; several names run several (`pnpm verify build bundle`).

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
3. Benchmark gate: `digitus2 bench` runs the solver over the official PIG test split and compares general, highest, soft and recombination match rates with `benchmarks/floor.json`. A drop below the floor fails `pnpm verify`. When a milestone improves the numbers, the floor is raised in the same commit. The floor file also records the baselines we must beat and the human ceiling.

3b. Hand-separation gate: `digitus2 evalhands` scores the MIDI hand separation on the PIG test split (first annotation per piece, channel = truth) and on the 30 library pieces (staff = truth), writes `benchmarks/latest-hands.json`, and fails `pnpm verify` (step `hands`) when the PIG macro accuracy drops below `hands.accuracyMin` in `benchmarks/floor.json`.

4. Research cross-check: the Python scorer in `research/fingering_eval/` matches the official PIG evaluator; the TypeScript metrics are checked against it on real files, so both sides agree before any number is trusted.
5. CI: `.github/workflows/ci.yml` runs the same steps on every push to `main`, minus the benchmark when the dataset is not available in CI. As of M4 it runs typecheck, lint, the format check, unit, build and e2e (without the local-only `visual` project); the hygiene, design and bundle steps run under `pnpm verify` only until the workflow calls them too.

## Recovery after a restart or a context compaction

1. Read `docs/PROGRESS.md` (milestone table, directory ownership, log).
2. Run `pnpm verify` to learn the true state of the tree; `git status` shows uncommitted agent output.
3. Check running agents (ListAgents) and the latest workflow journal under the session directory (`subagents/workflows/<run>/journal.jsonl`); relaunch a dead workflow with its saved script (completed tasks are cached) and resume dead research agents with a short message.
4. Commit finished work with explicit paths, update the journal, continue with the next plan.
