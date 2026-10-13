# digitus2 — Verification Design

- Date: 2026-10-13
- Status: binding. Complements the product spec (`2026-10-13-digitus2-design.md`, section 8) and replaces its milestone ordering for verification: the verification core is built together with the first solver, not after it.
- Why this document exists: the build runs autonomously for days. The verification system is the only judge of quality in that time, so it has to be objective, hard to game, diagnostic enough to drive the next iteration, and faithful to what the user actually wants: fingerings that are good and easy to read for beginning-to-intermediate pianists.

## 1. Goals

Every goal is a number the system computes without a human. Floors are gates: `pnpm verify` fails below them. Targets are what a milestone must reach to be called done. Stretch goals are aspirations that get reported, never gated.

| Goal                                                 | Metric                                                                                                                                                 | Floor (gate)                                                 | Target                                | Stretch                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------- | ------------------------------------------ |
| Agree with expert pianists                           | PIG official test split, general match rate (gen)                                                                                                      | the best baseline we can run, currently 62.1 (Nakamura CHMM) | 66                                    | 69                                         |
|                                                      | highest match rate (high)                                                                                                                              | 68.7                                                         | 72                                    | 75                                         |
|                                                      | soft match rate (soft)                                                                                                                                 | 82.6                                                         | 86                                    | 89                                         |
|                                                      | recombination match rate (rec)                                                                                                                         | 74.7                                                         | 78                                    | 81                                         |
| Avoid real mistakes                                  | hard-error rate: mismatches on notes where every annotator of a piece agrees                                                                           | report                                                       | at most 20                            | at most 15                                 |
| Agree with editors on learner repertoire             | Mutopia editorial oracle match rate, overall and per difficulty level                                                                                  | best baseline on the same files                              | best baseline plus 3                  | plus 6                                     |
| Know the textbook                                    | textbook oracle: exact match on standard scale, arpeggio and chromatic fingerings in all 24 keys, both hands                                           | 100 on one- and two-octave scales                            | 100 including arpeggios and chromatic | plus common chord shapes and broken chords |
| Be physically possible                               | lint hard rules (never violated by experts in PIG): violations per 1000 notes                                                                          | 0                                                            | 0                                     | 0                                          |
| Be idiomatic                                         | lint soft rules: violation rate relative to the expert base rate measured on PIG                                                                       | at most 1.5 times                                            | at most 1.0 times                     | below                                      |
| Be consistent                                        | metamorphic suite pass rate (section 3.4)                                                                                                              | 100                                                          | 100                                   | 100                                        |
| Be easy to read                                      | printed-digit density: share of notes that receive a printed finger number after minimal-sufficient reduction (section 3.6)                            | at most 40                                                   | at most 30                            | editor level, about 20                     |
|                                                      | inferability: share of unprinted fingers a simple player model reconstructs correctly from the printed ones                                            | 100                                                          | 100                                   | 100                                        |
| Be easy to play (beginner and intermediate profiles) | position changes per 100 notes compared with the expert median on the same pieces; stretches wider than an octave on level 1 to 3 library pieces       | at most expert median plus 10 percent; 0 stretches           | at most expert median; 0              | below                                      |
| Mean what we say                                     | expected calibration error of per-note confidence against actual error rate                                                                            | at most 0.10                                                 | at most 0.05                          | at most 0.03                               |
| Be fast                                              | solve time for a 2000-note piece, Node and Chromium                                                                                                    | below 500 ms                                                 | below 200 ms                          | below 50 ms                                |
| Honor the design brief                               | exactly one red element in every end-to-end state; zero serious accessibility violations (axe); largest contentful paint under 2 s on the library page | gates                                                        |                                       |                                            |

All numbers are percent unless stated. Match rates are macro-averaged over pieces, as in the literature. Floors are raised, in the same commit, whenever a milestone beats them; they are never lowered without a dated note in `docs/PROGRESS.md`.

## 2. Oracles

An oracle is a source of truth the engine is compared against. Several independent oracles with different failure modes are the point: an engine tuned to one of them cannot quietly overfit it.

1. PIG expert annotations (Nakamura, Saito, Yoshii 2020): 150 pieces, 309 annotations, up to 5 annotators per test piece. Official test split for gates, train split for learning, never mixed. Cross-checked scorer: the Python metrics match the official C++ evaluator to 5e-7; the TypeScript port must match the Python on real files.
2. Mutopia editorial fingerings: finger numbers typeset by editors in public-domain editions, extracted from LilyPond sources. Different people, different repertoire (method-book and intermediate pieces), different convention (editors print only what matters). Used as a held-out oracle, never for tuning.
3. Textbook oracle: generated pieces whose correct fingering is canonical and exact: major and minor scales (harmonic and melodic) over one, two and three octaves in all keys, arpeggios of major, minor, dominant seventh and diminished chords, chromatic scales, in both hands and in parallel motion. The expected fingerings come from standard pedagogy tables and are stored as data with a citation each. This oracle is exact, cheap, and covers precisely what beginners practice.
4. Expert base rates: for every lint rule, the rate at which PIG annotators violate it. Rules with a zero base rate become hard gates; the others become soft rules with the measured rate as the yardstick. The data decides which rules are laws and which are preferences.
5. Baseline consensus: every third-party implementation that runs (currently more than twenty configurations under `research/baselines/outputs/`) is scored on the same split. Notes where strong baselines and annotators all agree but the engine differs are surfaced first in the error gallery.

## 3. Checks

### 3.1 Unit tests

Next to the code, written before the implementation. Readers and writers round-trip; the solver has hand-constructed cases with known answers; every lint rule has positive and negative examples.

### 3.2 Benchmark command

`digitus2 bench` runs the engine over an oracle and writes a scorecard (`benchmarks/runs/<git-sha>-<label>.json`, plus `benchmarks/latest.json`): every metric from section 1 that the oracle supports, per piece and aggregated, the engine version, parameter-file hashes, and timing. It compares with `benchmarks/floor.json` and with the previous run, prints the deltas, and exits non-zero on a floor breach. `pnpm verify` calls it.

### 3.3 Error gallery

Every bench run writes `benchmarks/errors/<run>/<piece>.md`: for each mismatch, the bar, the surrounding notes with their pitches, the engine's finger with its confidence and cost breakdown, every annotator's finger, and whether the note is a hard error. Hard errors sort first. This is what the next iteration reads; a number alone does not say what to fix.

### 3.4 Metamorphic suite

Properties that hold without any ground truth, run on PIG and library pieces:

- Octave transposition: shifting a piece by an octave within the comfortable range leaves fingers unchanged.
- Mirror symmetry: reflecting pitches about an axis and swapping hands maps fingers onto themselves.
- Tempo scaling: changing tempo by a moderate factor changes fingers on at most a small, reported share of notes.
- Repeated passages: identical passages in identical context get identical fingers.
- Locality: editing bars far away does not change a passage's fingering.
- Pin idempotence: pinning the engine's own output and re-solving changes nothing; pinning one note changes only a bounded neighborhood.
- Determinism: two runs produce byte-identical output.

### 3.5 Lint

`digitus2 lint` reports every rule violation with its severity (law or preference) and the expert base rate. The gate for laws is zero. Soft rules are reported against the base rate. Lint runs on engine output, on user edits in the app (as advice), and on the oracles themselves (which is how base rates and annotation errors are found).

### 3.6 Readability

A printed fingering is a subset of the complete fingering. The minimal-sufficient reduction keeps a digit only where a simple player model cannot infer it: after a position change, at a crossing, on the first note of a passage, on wide leaps, on chord outer voices, where the engine's confidence is low, and wherever the complete fingering would otherwise be ambiguous. The player model is a deterministic rule set (continue in the current five-finger position; stepwise motion uses adjacent fingers; repeated notes keep the finger) that must reconstruct 100 percent of the unprinted fingers from the printed ones. Density and inferability are both reported; density is also compared with editors' density on Mutopia pieces. The app prints the reduced set by default with a toggle to show all.

### 3.7 Ease profiles

For the beginner and intermediate profiles the scorecard reports position changes, maximum spans, thumb and fifth finger on black keys, and finger substitutions, each against the expert median for the same pieces, and per library level.

### 3.8 Calibration and ablation

Confidence buckets against actual error rates give the expected calibration error. `digitus2 bench --ablate` zeroes each rule weight in turn and reports the metric deltas: a rule whose removal changes nothing is flagged for review; a rule whose removal improves the target is a bug or a wrong weight.

### 3.9 Application checks

Playwright end-to-end flows for: open a library piece, see printed fingerings, play with the cursor moving, edit a finger and watch the re-solve, toggle editor's fingering, export. In every captured state a DOM check asserts exactly one element carries the red token (the design brief as a test). Axe runs on each page; screenshots are compared against stored baselines for the score view and the library.

### 3.10 Qualitative UI review (periodic, by a subagent)

Once a day while the app exists, an independent Opus subagent opens the deployed or locally served app in a browser, uses it as a beginner would (open a library piece, read the fingering, play, edit a finger, import a file, export), and writes `docs/reviews/ui-YYYY-MM-DD.md`: is it clear what to do next, do the main features work, is anything cluttered or confusing, does the black-and-white-plus-one-red brief hold on every screen, what would a piano teacher object to. Each review ends with a ranked list of concrete fixes; the top items become tasks. The reviewer never edits product code. The user asked for this on 2026-10-13; it starts once M4 ships a usable app.

### 3.11 Cross-implementation agreement

The TypeScript metrics and the Python metrics are run on the same prediction files in CI-like fashion inside `pnpm verify`; a disagreement above 1e-6 fails.

## 4. The iteration protocol (how autonomy stays honest)

1. State a hypothesis in `docs/experiments.md` (lab notebook): what changes, which metric should move, by how much.
2. Change code or parameters on the working tree.
3. Run `pnpm verify`. The bench prints deltas; the error gallery explains them.
4. Accept when the primary metric (gen on the PIG test split, or the oracle the experiment targets) improves without any floor breach and without a readability or lint regression; raise floors in the same commit. Reject otherwise and revert; record the outcome either way.
5. Never tune on the test split: parameter learning uses the PIG train split and the textbook oracle only; Mutopia is held out entirely.
6. Every milestone ends with a scorecard row appended to `benchmarks/history.md` and the goals table in this document updated with actual numbers.

## 5. Milestone placement

- M1 (foundation, in progress): metrics, PIG and MusicXML IO, CLI, `pnpm verify` skeleton.
- M2 (solver v1 with verification core): `digitus2 bench` with scorecards and error galleries, lint with base rates, textbook oracle, metamorphic suite, floors raised to the solver's first real numbers.
- M3 (learning): train-split parameter fitting, calibration, ablation, Mutopia oracle wired in, baseline consensus in the gallery.
- M4 and M5 (app): readability reduction, one-red-element check, axe, Playwright flows, visual baselines.
- M7 (verification complete): everything in section 3 running under `pnpm verify` and CI, goals table filled with measured values.
