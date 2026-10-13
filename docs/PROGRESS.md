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
| M1 Foundation | not started | |
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

- 2026-10-13: kickoff. Decisions: TS in-browser engine, MusicXML + library + MIDI, public MIT repo, name digitus2. Spec written. Five research agents launched. Repo scaffolded.
