# Verification loop

The project is built autonomously for days, so every change must be judged by machines, not by a person watching. This document defines the loop. `CLAUDE.md` points here.

## One command

```bash
pnpm verify
```

`scripts/verify.mjs` runs, in order: typecheck, lint, unit tests (vitest for TypeScript), build, end-to-end tests (Playwright, once `apps/web` exists), and the benchmark gate. It prints a summary table and exits non-zero on any failure. `pnpm verify unit` runs one step.

Definition of done for any change, by a person or an agent: `pnpm verify` is green on the working tree before the commit.

## Levels

1. Unit tests next to the code (`*.test.ts`), written before the implementation. Readers and writers have round-trip tests; the solver has hand-constructed cases with known answers (scales, arpeggios, chords, repeated notes, crossings) and metamorphic property tests (octave transposition, mirror symmetry, repeated-passage consistency, pin idempotence).
2. Integration: the engine CLI parses every built-in score in `content/scores/` (smoke test) and round-trips PIG files; the app's Playwright flow opens a piece, sees fingerings, plays, edits a finger, exports.
3. Benchmark gate: `digitus2 bench` runs the solver over the official PIG test split and compares general, highest, soft and recombination match rates with `benchmarks/floor.json`. A drop below the floor fails `pnpm verify`. When a milestone improves the numbers, the floor is raised in the same commit. The floor file also records the baselines we must beat and the human ceiling.
4. Research cross-check: the Python scorer in `research/fingering_eval/` matches the official PIG evaluator; the TypeScript metrics are checked against it on real files, so both sides agree before any number is trusted.
5. CI: `.github/workflows/ci.yml` runs the same steps on every push to `main`, minus the benchmark when the dataset is not available in CI.

## Recovery after a restart or a context compaction

1. Read `docs/PROGRESS.md` (milestone table, directory ownership, log).
2. Run `pnpm verify` to learn the true state of the tree; `git status` shows uncommitted agent output.
3. Check running agents (ListAgents) and the latest workflow journal under the session directory (`subagents/workflows/<run>/journal.jsonl`); relaunch a dead workflow with its saved script (completed tasks are cached) and resume dead research agents with a short message.
4. Commit finished work with explicit paths, update the journal, continue with the next plan.
