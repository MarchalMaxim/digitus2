# digitus2 — progress journal

Durable state for the multi-day autonomous build. Update after every completed step. Newest entries at the bottom of each section.

## Where things are

- Spec: `docs/superpowers/specs/2026-10-13-digitus2-design.md`
- Plan: `docs/superpowers/plans/` (written after the spec)
- Research reports: `docs/research/`
- Repo: public GitHub repo `digitus2` under MarchalMaxim (created at scaffold time); local folder is still named `thingamajig`.

## Milestone status

| Milestone | Status | Notes |
|---|---|---|
| M0 Research | in flight | five Opus agents launched 2026-10-13 (datasets, literature, baselines, content, rendering spike) |
| M1 Foundation | in flight | plan `docs/superpowers/plans/2026-10-13-m1-engine-foundation.md`; executed by an ultracode workflow (implementer + reviewer per task, lanes A: PIG→metrics, B: MusicXML) started 2026-10-13 |
| M2 Solver v1 | not started | |
| M3 Learning | not started | |
| M4 App MVP | not started | |
| M5 Interaction | not started | |
| M6 MIDI import | not started | |
| M7 Verification suite | not started | |
| M8 Polish and deploy | not started | |
| M9 Neural evaluation | not started | |

## Directory ownership (concurrent agents)

| Path | Owner | Deliverable |
|---|---|---|
| `research/data/`, `research/fingering_eval/`, `research/scripts/`, `research/tests/`, `research/requirements.txt`, `docs/research/datasets.md` | datasets agent | PIG, Mutopia fingerings, validators, metrics, evaluate CLI |
| `docs/research/literature.md` | literature agent | survey and implementation-ready recommendation |
| `research/baselines/`, `research/.venv-baselines/`, `docs/research/baselines.md` | baselines agent | third-party implementations wrapped and scored |
| `content/`, `docs/research/content-library.md` | content agent | built-in library with manifest |
| `research/spikes/render/`, `docs/research/rendering-spike.md` | rendering spike agent | renderer, player, parser recommendation |
| everything else | coordinator | scaffold, spec, plan, commits |

## Log

- 2026-10-13: kickoff. Decisions: TS in-browser engine, MusicXML + library + MIDI, public MIT repo, name digitus2. Spec written. Five research agents launched. Repo scaffolded. GitHub repo created: https://github.com/MarchalMaxim/digitus2.
- 2026-10-13 (later): the Claude Code session restarted and stopped all five research agents mid-flight; they were resumed from their transcripts. Their partial output is on disk (research/, content/) but no reports in docs/research/ yet. M1 plan written and committed. M1 execution started as an ultracode workflow. Early result from the baselines agent, before the restart: Nakamura CHMM on the official PIG test split (30 pieces) scores M_gen 62.1, M_high 68.7, M_soft 82.6, M_rec 74.7 (macro, percent), and the Python scorer matches the official C++ evaluator to within 5e-7, so the metrics pipeline is trustworthy. The user asked that ultracode workflows be used whenever work can be parallelized.
- 2026-10-13 (later still): verification loop added (`pnpm verify`, `benchmarks/floor.json`, `docs/verification-loop.md`). The first M1 workflow died with the restart after starting Task 1; relaunched from the saved script (run wf_9580d530-f4c) with Task 1 told to finish on top of the partial scaffold. Correction: the original run wf_2b1815f9-74e had survived (Tasks 1-3 approved, lanes A/B started), so the duplicate was stopped at 21:11 after its Task 1 had registered `pnpm verify`; the original run continues and is the only M1 workflow. The five original research agents survived and are still running; the peer session's resumed copies were stopped.
