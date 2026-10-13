# readability — what editors print, and a validated player model

Research code behind `docs/research/readability.md` (verification spec section 3.6: print a
finger number only where a simple player model cannot infer it). Python 3.11, standard library
plus numpy and scikit-learn; nothing here ships in the product.

## Setup

```
python -m venv research/.venv-readability
research/.venv-readability/Scripts/python.exe -m pip install -r research/readability/requirements.txt
echo C:/.../thingamajig/research > research/.venv-readability/Lib/site-packages/digitus2_research.pth
```

The `.pth` line puts `research/` on `sys.path` so that `readability` and `fingering_eval` import.
Always run with `-X utf8` on Windows (the manifests contain non-ASCII titles).

## Data

* Mutopia editorial corpus: `research/data/mutopia_fingering/FingeringFiles/*.txt` (PIG format,
  hand in the channel column, finger `0` = nothing printed) plus `manifest.json`; built by
  `research/scripts/build_mutopia_fingering.py` (datasets agent). Only `status == ok` parts are
  used: 286 parts, 193,059 notes, 36,183 printed digits.
* Library pieces with the source edition's fingerings: `content/scores/*.fingered.musicxml`
  (8 pieces, 3,457 notes, 751 printed digits after merging tied continuations).
* Textbook scale, arpeggio and chromatic fingerings: `benchmarks/textbook/*.json`.
* Derived, gitignored (`research/data/.gitignore` ignores everything under `research/data/`
  except the listed manifests): `research/data/readability/mutopia_beats/<piece_id>.json` (beats
  and bars recovered from the LilyPond sources) and `research/data/readability/features.csv`
  (one row per note, 37 MB).

## Pipeline

```
research/.venv-readability/Scripts/python.exe -X utf8 research/readability/run_all.py
```

runs, in order (about two minutes on one core; `OMP_NUM_THREADS=2`):

| Step | Script | Output |
|---|---|---|
| beats and bars for Mutopia (needs `research/data/mutopia_src/ftp`; re-runs `fingering_eval.mutopia.convert_file` and checks it reproduces each PIG file exactly) | `enrich_mutopia.py` | `research/data/readability/mutopia_beats/` |
| per-note context features | `build_features.py` (`features.py`, `corpus.py`, `musicxml.py`, `keyboard.py`) | `research/data/readability/features.csv`, `results/features_summary.json` |
| item 1 and 5: density, print rate by context, printed-derived contexts | `stats.py` | `results/density.json`, `results/print_rate_by_context.csv`, `results/printed_contexts.json` |
| item 2: repeated passages | `repeats.py` | `results/repeats.json` |
| item 3: player model, hide-20 and leave-one-out | `eval_player.py` (`player_model.py`, `textbook.py`) | `results/player_model*.json/csv` |
| the minimal-sufficient reduction applied to editorial digits (unbiased on fully fingered parts) | `reduce.py` | `results/reduction.json`, `results/reduction_by_part.csv` |
| item 4: printed-digit predictor | `predictor.py` | `results/predictor*.json/csv/txt` |
| markdown tables for the report | `report_tables.py` | stdout |

Tests: `research/.venv-readability/Scripts/python.exe -X utf8 -m pytest research/readability/tests -q`.

## Conventions

* Hands: 0 = right, 1 = left. Fingers 1..5 unsigned for both hands.
* An *event* is all notes of one hand with the same onset (a chord or a single note); the
  "previous event" is the previous event of the same hand; a note's interval is measured to
  the nearest pitch of the previous event.
* Level groups (Mutopia): `teaching` = Clementi Op. 42, Diabelli, Czerny, Burgmüller, Kuhlau,
  Mozart K545; `concert` = Chopin, Liszt, Rachmaninoff; `other` = everything else (Verdi
  reductions, Beethoven, Schumann, Bach, ...). Library pieces carry their manifest level 1..5.
* Keyboard geometry: Balliauw's 14-unit octave (`keyboard.x14`); anchor model of literature
  section 6.6: `anchor = x14/2 - (finger - 1)` for the right hand, mirrored for the left.
* Beats are quarter notes. Seconds come from the source (the score's first `\tempo`, default
  quarter = 100; 220 of 286 Mutopia parts use the default), so note density per second is
  "at the score tempo".
