# digitus2 — progress journal

Durable state for the multi-day autonomous build. Update after every completed step. Newest entries at the bottom of each section. After a restart or a context compaction: read this file, run `pnpm verify`, check running agents and the latest workflow journal (see "Recovery" in `docs/verification-loop.md`), then continue with "Next".

## Where things are

- Product spec: `docs/superpowers/specs/2026-10-13-digitus2-design.md`
- Verification spec (binding goals, oracles, checks, iteration protocol): `docs/superpowers/specs/2026-10-13-verification-design.md`
- Plans: `docs/superpowers/plans/` (M1 foundation, M2 solver and verification core)
- Research reports: `docs/research/` (literature, rendering-spike, content-library; datasets, baselines and textbook-oracle pending)
- Lab notebook: `docs/experiments.md`; benchmark history: `benchmarks/history.md` (created by M2 Task 11)
- Repo: public GitHub repo https://github.com/MarchalMaxim/digitus2 (MIT); local folder is still named `thingamajig`.
- Workflow journals (session-local): `~/.claude/projects/C--Users-maxim-Desktop-projects-github-thingamajig/<session>/subagents/workflows/<run>/journal.jsonl`; saved scripts under `<session>/workflows/scripts/`.

## User rules (standing)

- Opus 5.5 for substantive subagent work, Sonnet 5.5 for trivial tasks; Fable coordinates and plans. Use ultracode workflows for anything parallelizable.
- Verification loop is paramount; `pnpm verify` is the definition of done. Readability for intermediate players is a first-class metric.
- Once the app exists: a daily qualitative UI review by an Opus subagent (verification spec 3.10).
- Never merge a feature branch into main without explicit confirmation; linear commits on main by the coordinator only.
- Keep this journal current so compaction loses nothing.

## Milestone status

| Milestone                        | Status      | Notes                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 Research                      | in flight   | done: literature (`docs/research/literature.md`), rendering spike (`docs/research/rendering-spike.md`, Verovio in a worker + smplr + midi-file + own MusicXML reader + vanilla CSS + zustand), content library (30 pieces, 8 with editorial fingerings, `content/manifest.json`). Still running: datasets (PIG validation, Mutopia oracle), baselines (20+ configurations scored), textbook oracle |
| M1 Foundation                    | done        | plan `2026-10-13-m1-engine-foundation.md`; ultracode workflow wf_2b1815f9-74e (25 agents, all tasks approved, final adversarial review approved); review follow-ups fixed; 106 engine tests; commits 5d118e3..1160485                                                                                                                                                                              |
| M2 Solver v1 + verification core | in flight   | plan `2026-10-13-m2-solver-verification-core.md` (12 tasks: metrics reconciliation, geometry/spans, rules, sequences, decoder, solver, lint, textbook oracle, templates, metamorphic, CLI finger/lint/bench, first benchmark + floors); ultracode workflow wf_171d24a1-e90 launched 2026-10-13 ~22:05                                                                                              |
| M3 Learning                      | not started | needs datasets + baselines reports; plan: Python fitting on PIG train + permissive data, calibration, ablation, Mutopia oracle, hard-error analysis                                                                                                                                                                                                                                                |
| M4 App MVP                       | not started | plan from the rendering spike: Vite + React 19 + TS, Verovio 6.3 lazy in a Web Worker (OSMD fallback), smplr SplendidGrandPiano, midi-file, vanilla CSS + custom properties, zustand, vitest + Testing Library + Playwright; attribution screen for CC BY-SA engravings                                                                                                                            |
| M5 Interaction                   | not started |                                                                                                                                                                                                                                                                                                                                                                                                    |
| M6 MIDI import                   | not started | hand separation: pitch-trajectory DP (literature 6.7)                                                                                                                                                                                                                                                                                                                                              |
| M7 Verification suite            | not started | readability reduction + player model, calibration, one-red-element check, axe, visual baselines                                                                                                                                                                                                                                                                                                    |
| M8 Polish and deploy             | not started | GitHub Pages                                                                                                                                                                                                                                                                                                                                                                                       |
| M9 Neural evaluation             | not started | ArGNN is the best published (66.84); only if it beats the hybrid on all oracles                                                                                                                                                                                                                                                                                                                    |

## Directory ownership (concurrent agents)

| Path                                                                                                                                           | Owner                 | Deliverable                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| `research/data/`, `research/fingering_eval/`, `research/scripts/`, `research/tests/`, `research/requirements.txt`, `docs/research/datasets.md` | datasets agent        | PIG, Mutopia fingerings, validators, metrics, evaluate CLI             |
| `research/baselines/`, `research/.venv-baselines/`, `docs/research/baselines.md`                                                               | baselines agent       | third-party implementations wrapped and scored                         |
| `benchmarks/textbook/`, `docs/research/textbook-oracle.md`                                                                                     | textbook oracle agent | canonical scale, arpeggio and chromatic fingerings for all keys, cited |
| `packages/engine/**` (M2 files), `benchmarks/floor.json`, `benchmarks/history.md`, `docs/experiments.md`                                       | M2 workflow agents    | solver, lint, oracles, bench                                           |
| everything else                                                                                                                                | coordinator           | scaffold, specs, plans, commits                                        |

## Standing findings

- Licensing (literature §6.9): PIG is for non-profit academic use; weights trained on it cannot ship without the maintainers' permission. Plan: Engine A (rules only) ships unconditionally; shipped learned weights come from permissive data (textbook oracle, Beringer corpus from pydactyl (MIT), Mutopia editorial fingerings after per-piece checks); PIG is evaluation-only. Asking the PIG maintainers for permission is the user's decision.
- Content licensing: five library engravings are CC BY-SA (Schumann Op. 68 No. 1 and No. 8, Moonlight mvt 1, Mozart K.545, Bach Invention 1); the compositions are public domain but the files require attribution in the app (typesetter, licence, Mutopia id are in `content/manifest.json`). Scarborough Fair uses the traditional Dorian tune.
- Literature leaderboard (PIG test, M_gen): human ceiling 71.4; ArGNN 66.84 (best published); HMM3 64.5; an unverified exact rule-based Viterbi (chirality project) 64.9. Nothing new on the benchmark since 2022.
- Baselines (early, Python scorer verified against the official C++ evaluator to 5e-7): Nakamura CHMM on the official test split: gen 62.1, high 68.7, soft 82.6, rec 74.7.
- The recombination metric charges one point per annotator switch (Nakamura 2020 App. A); M1 Task 9 was corrected but implemented before the correction, so M2 Task 0 reconciles the TypeScript metrics with the Python reference.
- Rendering: Verovio keeps our note ids and tags every fingering digit with `data-startid`; one CSS class turns one note or digit red; cursor sync via `getOutputTimestamp()` is within 5 ms.
- Repo hygiene: `pnpm verify` fails on any tracked file over 1 MB (scores 1.5 MB); the datasets agent was asked to keep `research/data/reports/` files under 1 MB (one 1035 KB CSV outstanding at 22:00).

## Next

1. When the M2 workflow completes: read its journal, run `pnpm verify`, commit per task group, update the milestone table with the measured scorecard (gen/high/soft/rec, hard-error rate, textbook accuracy, lint, speed), append to `benchmarks/history.md` if Task 11 did not.
2. When datasets and baselines reports land: commit them, read them, write the M3 plan (learning) and the M4 plan (app MVP) — M4 does not depend on M3 and should run in parallel with M3 as a separate workflow (apps/web is a disjoint directory).
3. Textbook oracle: when it lands, commit; the M2 templates task consumes `benchmarks/textbook/*.json` (if it is not there yet when Task 7/8 run, those tasks' tests skip and must be re-run).

## Log

- 2026-10-13: kickoff. Decisions: TS in-browser engine, MusicXML + library + MIDI, public MIT repo, name digitus2. Spec written. Five research agents launched. Repo scaffolded. GitHub repo created.
- 2026-10-13 (later): the Claude Code session restarted and stopped all five research agents mid-flight; a peer session resumed them, then handed the build back; the originals had survived. M1 plan written and committed. M1 execution started as an ultracode workflow. Early baselines result: Nakamura CHMM gen 62.1 / high 68.7 / soft 82.6 / rec 74.7.
- 2026-10-13 (later still): verification loop added (`pnpm verify`, `benchmarks/floor.json`, `docs/verification-loop.md`). A duplicate M1 workflow was launched by mistake and stopped at 21:11; the original run wf_2b1815f9-74e completed all 11 tasks (25 agents, 0 errors). Verification design spec written with numeric goals, oracles (PIG, Mutopia editorial, textbook, expert base rates, baseline consensus), checks (bench, galleries, metamorphic, lint, readability, calibration, ablation, UI, cross-implementation) and the iteration protocol. Textbook oracle agent launched. Repo hygiene guard added.
- 2026-10-13 21:40: M1 committed (5d118e3, f1660e7, e910b36). Literature survey committed (23.6k words, 80 refs). Rendering spike committed. M1 review follow-ups fixed by a cleanup agent (106 tests), committed as 1160485. Content library (30 pieces) committed as 414f859.
- 2026-10-13 22:05: M2 plan committed (9e91237, 2936 lines, 12 tasks). M2 ultracode workflow wf_171d24a1-e90 launched.
