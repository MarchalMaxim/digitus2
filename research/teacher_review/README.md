# teacher_review: a language model as a qualitative fingering oracle

Research harness for the question "can an LLM acting as a piano teacher review fingerings
usefully, and how should it sit in the verification loop?". Findings, protocol and rubric:
[`docs/research/teacher-review.md`](../../docs/research/teacher-review.md); the reviewer brief is
`prompts/brief.md`.

Pure Python 3.11 standard library (plus `pytest` for the tests); reuses `research/fingering_eval`
for PIG reading. Run everything with `research/.venv` (its `digitus2_research.pth` puts
`research/` on `sys.path`), or create `research/.venv-review` from `requirements.txt` and set
`PYTHONPATH=research`.

## Layout

| Path | What |
|---|---|
| `model.py` | `Passage` / `Event` data model: hands, notes with stable ids (`R7`, `L3`), chords, rests, bars and beats derived from the meter |
| `render.py` | the compact text rendering shown to the reviewer (`render_passage`), its legend (`LEGEND`) and the parser (`parse_rendering`) used for round-trip tests |
| `pig_passages.py` | PIG adapter: meters per test piece, quarter-note and bar-1 estimation from the synthesised timing, quantisation, chord merging, rests, alignment of every annotator and of the authors' FHMM3 output |
| `inject.py` | fault injector: six fault kinds with recorded positions (`Fault`), non-overlapping, balanced across kinds |
| `build_benchmark.py` | selects the 40 passages, builds the three conditions, randomises and blinds them into batch files, writes the key |
| `collect.py` | validates reviewer JSON against the schema, checks the read-back, writes normalised judgements |
| `score.py` | all measurements (fault detection, false positives, ranking, expert-disagreement agreement, self-consistency, read-back, cost) and the markdown summary |
| `prompts/brief.md` | the reviewer brief (rubric, output schema); `variant_a.md` / `variant_b.md` are the two framings used for the self-consistency runs |
| `tests/` | renderer round trip, injector (faults land where recorded), scorer on synthetic data |
| `results/` | committed: `passages.json`, `<run>/key.json`, `<run>/judgements.json`, `<run>/collect_report.json`, `summary.json`, `summary.md`, `qualitative.json`, `grid_diagnostics.json` |

Rendered passages and raw reviewer outputs live under `research/data/teacher_review/` (gitignored:
they are derived from PIG, which permits non-profit academic use but not redistribution).

## Reproduce the pilot

```bash
PY=research/.venv/Scripts/python.exe
$PY -m pytest research/teacher_review/tests -q
$PY -I -m teacher_review.build_benchmark --seed 20261013 --runs A B  # 40 passages x 3 conditions x 2 runs
# dispatch one blinded reviewer per batch file (see "Dispatch" below), then:
$PY -I -m teacher_review.collect --run A
$PY -I -m teacher_review.collect --run B
$PY -I -m teacher_review.score --runs A B                            # results/summary.{json,md}, qualitative.json
```

`build_benchmark` is deterministic for a seed: the same passages, annotators, faults, item ids
and batches come out every time, so a run can be re-dispatched without touching the key.

## Dispatch

The reviewers are Opus subagents, launched from an agent session. The harness prepares the inputs
and validates the outputs; it does not call a model API itself. For every
`research/data/teacher_review/runs/<run>/batch-NN.md` launch one agent with this prompt,
substituting the two paths:

> You are a reviewer in a blinded study of piano fingerings. Your only input is the file
> `<batch file>`. It contains a brief, a notation legend and 8 passages, each with a candidate
> fingering. Follow the brief's instructions exactly and write your review as a single JSON
> document to `<output file>` (UTF-8, nothing but the JSON).
> Rules: read only that one input file; do not open, list, search or read any other file,
> directory or web page, and do not look for the sources of the passages. Do not run git. Do not
> run any program except one command to get a UTC timestamp before you read the passages
> (bash: `date -u +%FT%TZ`) and one after you have written the JSON; put them in `started_at` and
> `finished_at`. Do not modify the input file. Every item in the input must appear exactly once in
> `items`, in the same order, each with `item`, `readback`, `scores`, `verdict`, `objections` and
> `comment`. Use only note ids that exist in the passage. When done, reply with one line: the
> output path and the number of items written.

Blinding: a batch file contains eight different passages (never the same passage twice), the
three conditions are mixed in random order, item ids are random hex, and nothing in the file or
the prompt names the condition, the annotator or the piece title. The key that maps items back
is written only under `results/<run>/key.json`, which the reviewers are told not to read.

## Conditions

| Condition | Fingering shown |
|---|---|
| `expert` | one PIG annotator of the piece (chosen at random per passage) |
| `fhmm3` | the authors' released third-order HMM output (`research/data/pig_hmm/Result_FHMM3`) for the same notes |
| `corrupted` | the expert fingering with two or three planted faults of distinct kinds (`inject.py`) |

Fault kinds: `chord_same_finger`, `impossible_span` (adjacent fingers across a wide chord),
`nonthumb_crossing`, `hop_at_speed` (same finger on two different keys at or under 300 ms),
`run_345_reversed` (an outward stepwise run fingered 5-4-3), `thumb_on_black_between_whites`.

## Rendering format

See the module docstring of `render.py` and `LEGEND`. One line per note, chord or rest:
`id bar beat dur pitch f`, hands in separate sections, the context hand without fingers.
Bars and beats of PIG passages are estimated from the synthesised timing (the pieces whose grid
could not be recovered are excluded, see `results/grid_diagnostics.json`); with MusicXML input
they are exact.

## Weekly review (verification spec 3.12)

The weekly job runs this harness on the current engine; it is specified in
`docs/superpowers/specs/2026-10-13-verification-design.md`, section 3.12. Run the harness by path
from the repository root, not with `-m`: a venv shared between checkouts would import another
checkout's harness.
`weekly.py where` prints the harness directory actually imported. `<date>` is the run date,
YYYY-MM-DD.

```bash
PY=research/.venv/Scripts/python.exe
pnpm --filter @digitus2/engine build
$PY -I research/teacher_review/weekly.py build --date <date>      # bench, dump, select, batches, launches
# launch one Opus reviewer per row of research/data/teacher_review/weekly/<date>/launches.json
$PY -I research/teacher_review/weekly.py collect --date <date>
$PY -I research/teacher_review/weekly.py report --date <date>     # docs/reviews/teacher-<date>.md
```

| Module | What |
|---|---|
| `engine_dump.mjs` | per-note engine output through the built engine's public API (library, tritone copies, PIG pieces) |
| `musicxml_passages.py` | library windows with exact bars, beats, chords, grace notes and rests |
| `gallery.py` | bench error galleries; PIG passages with the engine's fingers |
| `select.py` | the five sets: low-confidence, hard-error, control, planted-fault control, recall control |
| `dispatch.py` | weekly legend, blinded batches (two framings for engine sets), key, launches, collection |
| `hypotheses.py` | consistent objections, groups by kind and lint rule, rows for `docs/experiments.md` |
| `report.py` | the report, `results/weekly/<date>/summary.json`, the PIG audit |
| `weekly.py` | the entry point: `build`, `collect`, `report`, `where` |

`build` runs `bench --profile medium` into `research/data/teacher_review/weekly/<date>/bench/`
(never `benchmarks/`) on the PIG validation pieces of `research/data/splits/pig_validation.json`,
through a split file it writes there (`bench/validation-split.json`), because the hard-error set
must never come from the official test pieces 001 to 030. Only the validation pieces with two
annotations (046, 066, 076, 077) can carry a hard error; the set takes at most 16 windows and at
most 4 per piece. `--gallery DIR` reuses a gallery (refused if it holds a test piece), `--dump FILE`
reuses a dump; the gallery and the dump must describe the same engine, or the build refuses.
`build` refuses to overwrite reviewer outputs without `--force`. `collect` exits 1 while any item
is missing: relaunch a missing or invalid batch once with the same row of `launches.json`; if it
fails again, `report --allow-missing` writes the report without it and names the missing batches
in the section "Limits of this run".

Data: `research/data/teacher_review/weekly/<date>/` (gitignored: bench, dump, batches, key, outputs).
Committed: `results/weekly/<date>/summary.json`, `hypotheses.md` and the library-only batch files
under `library/`. PIG passages appear in tracked files only by opaque id and counts.
