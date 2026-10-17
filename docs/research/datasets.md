# Piano-fingering ground truth for digitus2: datasets, validation, metrics

*Code: `research/fingering_eval/` (library), `research/scripts/` (download, build, validation),
`research/tests/`. Data layout, licences and reproduction commands:
[`research/data/README.md`](../../research/data/README.md).*

## 1. Summary

We have **three usable, independent kinds of ground truth** plus one large but noisy one:

| Source | What it is | Size | Labels | Licence | Obtained | Verdict |
|---|---|---|---|---|---|---|
| **PIG v1.2** (Nakamura, Saito & Yoshii 2020) | fingerings *actually used* by experienced pianists, every note fingered | 150 pieces (excerpts), 309 fingering files, 48,724 notes / 100,040 note-fingerings, 11 pianists | complete, 1-6 pianists per piece | non-profit academic use only, no redistribution | yes (public byte-identical mirrors; official site needs registration) | **Primary benchmark.** Clean (6 hard errors in 100k notes). Use the official split + the 4 metrics; the human ceiling is M_gen 71.4. |
| **Mutopia editorial fingerings** (built here) | fingerings printed by editors/typesetters in public-domain/CC LilyPond engravings, converted to PIG format | 310 two-hand parts from 164 pieces; 203,931 notes, 38,131 fingered (**286 verified parts, 160 pieces, 36,183 fingered notes**) | partial (median 30% of notes per part), one "editor" per piece | per piece PD / CC BY / CC BY-SA | yes | **Second, independent oracle**, strongest for beginner/intermediate pedagogy (Clementi Op. 42, Diabelli, Czerny, Burgmüller, Mozart K545, Chopin). Notes verified against LilyPond's own MIDI (293 of 310 parts; 2 more differ only through later source edits). Agrees with PIG pianists about as well as pianists agree with each other. Evaluate on fingered notes only. |
| **Beringer & Dunhill 1900** scales/arpeggios/broken chords (D. Randolph's pydactyl abcD transcriptions) | canonical technical fingerings in all keys | 84 exercises (128 fingering files incl. Beringer's alternatives), 13,648 notes | complete | PD fingerings, MIT transcription | yes | **Unit-test oracle**: an engine for beginners must reproduce standard scale/arpeggio fingerings. 1 transcription error found. |
| **PianoVAM v1.2** | fingering of amateur *performances*, labelled from video (semi-automatic) + 1,800 manually checked notes | 106 recordings, 525,483 notes (80% labelled) | automatic (95.7% accurate on the manual subset) | CC BY-NC-SA 4.0 | yes (labels only) | Secondary / sanity data: realistic amateur performances, but pseudo-labels and performance (not score) notes. Not an oracle. |
| PDMX fingered subset (MuseScore public-domain MusicXML) | user-entered fingerings in community scores (the population ThumbSet was built from) | 978 keyboard scores, 1.67 M notes, 110k fingering marks | partial (≈7% of notes), noisy | CC BY 4.0 / CC0 / PD | yes (opt-in, 2.1 GB download) | Large, noisy; candidate for training/weak supervision, not for verification. |

Not obtainable / not useful: ThumbSet (Zenodo, access by request only), APFD (host and repo
gone), PianoMotion10M (hand poses only, no per-note fingers), Mikrokosmos-difficulty & CIPI
(algorithmic fingerings / restricted), music21 corpus (4 lightly fingered pieces), OpenScore
(≈6 fingered songs), PiAnnotate/FürElise and SKY-Piano (labels not released / pseudo-labels),
no TNUA, Kaggle, or "Gao et al. 2024" fingering dataset could be found (section 9).

**Metrics.** `fingering_eval.metrics` implements M_gen, M_high, M_soft and M_rec exactly as the
authors' evaluation tool does: it reproduces **every number of Table 2 of the paper** (HMM1/2/3
and the human reference) from the authors' published HMM outputs, and agrees with the compiled
official C++ tool on 408 test cases to within its 6-digit printing precision (max |diff| 5e-7).

## 2. PIG Dataset v1.2

### 2.1 Acquisition and provenance

* Official page: <https://beam.kisarazu.ac.jp/research/PianoFingeringDataset/> (the older
  `~saito/` URL is dead, HTTP 404). Download requires a **registration form**
  (first/last name, country, affiliation, job title, phone, e-mail, purpose); a one-hour password
  is then e-mailed.
* We downloaded the public copy in `CHOWMHALVIN/Piano-Fingering-Suggestion-Model-with-Intuitive-UI`
  at commit `0aebdd3b29db1f71d2d2708c298b051727363d91` (folder `PianoFingeringDataset_v1.2`).
  Its 463 files (309 fingering files, 150 score PDFs, `List.csv/.pdf`, `README.pdf`,
  `README-ja.pdf`) have **identical git blob SHA-1s** to an independent copy
  (`lemonadedw/BACHprop@ec4672194eff`, used as fallback mirror), and all 309 fingering files are
  identical in two further copies (`chrsztz/xlpro-model`, `HACkerrr121/KeyGenius`).
  `README.pdf` says "version 1.2 (2022/5/12)"; its update note (also on the web page, there
  labelled "version 1.12") lists "Minor corrections in fingering data for 029-5, 032-2, and
  032-3". Hashes: `research/data/manifests/pig_v1.2_files.json`.
* **Licence (verbatim):** "Only nonprofit, academic use is allowed." — "Upon the use of PIG
  Dataset, we kindly ask every user to explicitly cite/mention the following paper": E. Nakamura,
  Y. Saito, K. Yoshii, *Statistical Learning and Estimation of Piano Fingering*, Information
  Sciences 517, 68–85 (2020), arXiv:1904.10237. ⇒ never commit or redistribute PIG files;
  anyone reproducing the PIG experiments registers on the official page and obtains the data
  themselves (non-profit research use only; digitus2's own code is MIT, the data is not part of
  it).

### 2.2 File format (verified on all 309 files)

* UTF-8 text, LF; first line `//Version: PianoFingering_v170101` (all files), no other
  comment lines; 100,040 note lines, **all with exactly 8 tab-separated columns**:
  `noteID onset offset spelledPitch onsetVel offsetVel channel finger`.
* Note IDs are 0-based and consecutive (one exception, below). Times in seconds from
  score-synthesised MIDI (not human timing); MIDI-style velocities (often 64/80).
* Spelled pitch: letter + accidental + octave, A4 = 440 Hz, C4 = MIDI 60. In v1.2 only the 12
  MIDI-derived spellings C C# D Eb E F F# G G# A Bb B occur ("does not necessarily match the
  score notation" — README).
* Channel: 0 = right hand, 1 = left hand (54,239 / 45,801 notes).
* Finger: RH `1..5`, **LH negative `-1..-5`** (in every file); substitutions joined by `_`
  (`3_1`, LH `-2_-1`), 323 notes (0.32%; the paper says 0.34% for its version), incl. two
  chained ones (`2_4_5`, `3_4_5`). The sign of the key-press finger always matches the channel.
* `List.csv` (UTF-8 with BOM): piece id, composer, title, bars, notes, number of fingerings,
  then **annotator initials per fingering slot** (file suffix `-k` = slot k).

`fingering_eval.pig_io` reads/writes this format (`read_pig`, `write_pig`, `Note` dataclass with
`pitch`, `press_finger`, `hand`; `parse_finger` handles substitutions and flags irregular strings).

### 2.3 Contents

| Subset | Pieces | Notes (unique) | Fingering files | Note-fingerings | Annotators per piece |
|---|---|---|---|---|---|
| Bach (001–010) | 10 | 3,657 | 40 | 14,628 | 4 (YI, ES, HI, NH) |
| Mozart (011–020) | 10 | 2,546 | 60 | 15,276 | 6 |
| Chopin (021–030) | 10 | 4,022 | 50 | 20,110 | 5 |
| Miscellaneous (031–150) | 120 | 38,499 | 159 | 50,026 | 1 (81 pieces) or 2 (39 pieces) |
| **All** | **150** | **48,724** | **309** | **100,040** | 69 pieces have ≥ 2 |

This matches Table 1 of the paper exactly except the miscellaneous subset (paper 38,501 / 50,030):
`List.csv` still says piece 032 has 691 notes, while the corrected v1.2 files 032-2 and 032-3
have 689 — the 2022 correction removed two notes from both annotations.

**Pieces with several annotations:** all 30 test pieces (Bach slots 1/2/5/8; Mozart six of slots
1, 3–7; Chopin slots 1, 3–6) and 39 miscellaneous pieces with two: 032, 043, 045–050, 061–071,
074, 076, 077, 079, 113, 115, 121–132, 140, 142. File suffix = slot, `List.csv` maps slots to
pianists (e.g. 001: 1 = YI, 2 = ES, 5 = HI, 8 = NH).

**Annotators** (fingering files): HI 65, YI 51, EF 49, YS 33, ES 30, HK 23, YoI 22, EN 15,
NH 10, AiY 10, TH 1 (11 pianists; the paper: "experienced pianists who graduated from a music
college or who had played the piano for more than twenty years").

### 2.4 Splits — `research/data/splits/pig_official.json`

* **`nakamura2020` (official)** — paper §6.1: "We used the miscellaneous subset for training and
  used the three composer-specific subsets for testing. In the testing stage, we used the musical
  notes in the upper and lower staves as the RH and LH parts." Test = pieces 001–030 (150 files),
  train = 031–150 (159 files); no validation set. Metrics are macro-averaged over the 30 test
  pieces. Verified: this split + our metrics reproduce Table 2 exactly (section 3).
* **`ramoneda2022`** — ArGNN/ArLSTM (ACM MM 2022), `official_split.json` from
  `PRamoneda/Automatic-Piano-Fingering@d0d2f43` (MIT): train 130 + val 29 files = the
  miscellaneous subset; test 130 files = the composer subsets **minus the 20 annotations of
  pianist EF** (Mozart slot 7, Chopin slot 3) — undocumented; numbers on this split are not
  comparable with Nakamura's. Note also that that repository's `metrics.py` computes M_high
  identically to M_gen, has no M_rec, and averages per piece with a bug
  (`zip(set(pieces), rates)`), so its reported numbers should not be compared with ours.
* **Moryossef 2019 / checklist models (Srivatsan & Berg-Kirkpatrick, ISMIR 2022)** use "alternate
  splits created by [Moryossef et al. 2019] which increase the relative size of the train and
  validation sets"; the file lists were never published and the referenced repository is gone
  (HTTP 404). Moryossef et al. 2023 instead keep Nakamura's split and move one unnamed training
  piece to a dev set. Not reproducible.

### 2.5 Code shipped with PIG

The dataset archive contains **no code** (README §3 lists only `ScorePDF/`, `FingeringFiles/`,
`List`). The paper's companion page <https://statpianofingering.github.io/demo.html> provides
`SourceCode_v190921.zip` (C++, no licence file) and the authors' HMM outputs on the 30 test pieces
(`Result_FHMM1/2/3.zip`); we keep them in `research/data/pig_hmm/`:

* `FingeringHMM{1,2,3}_Train/Run`, `CHMM_Train/Run` (chord HMM) + trained parameter files and
  `run_FHMM{1,2,3}.sh`, `run_CHMM.sh` (default models trained on the miscellaneous subset).
* `Evaluate_SimpleMatchRate GT EST` and `Evaluate_MultipleGroundTruth nGT GT_1 … GT_n EST`
  (prints `General,Highest,Soft,Recomb`), built on `FingeringEvaluation_v190306.hpp`.

We compiled the two evaluation programs (MinGW g++ 9.2, `-static`) from a copy in
`research/data/_build/` and used them only to cross-check our implementation
(`research/scripts/crosscheck_official_eval.py`). The HMMs themselves are benchmarked in
[`baselines.md`](baselines.md).

### 2.6 Validation (`research/fingering_eval/validate.py`, `research/scripts/validate_datasets.py`)

Checks: finger syntax/range, substitution syntax, sign vs channel, monotone onsets, positive
durations, ID sequence, pitch range per hand, duplicate notes, two simultaneous notes on one
finger, chord finger order, chord span (> major tenth = impossible), finger re-used while its
key is still held, and across annotations of a piece: equal note count, identical pitches and
onsets, hand-assignment differences. Results (`research/data/reports/pig_validation.json`,
every flagged item with piece / annotation / note id / line in `pig_anomalies.csv`):

| Check | Severity | Count | Items |
|---|---|---|---|
| finger outside 1..5, bad syntax, sign ≠ channel | error | **0** | — |
| onsets non-monotone / note-count or pitch mismatch between annotations | error | **0** | all multi-annotation pieces describe identical note lists |
| same finger on two simultaneous keys | error | **4** | 009-2 #304 (thumb on A4+C#5), 028-3 #135 (thumb C#4+G4), 028-4 #321 (finger 2 on G#4+C#5), 112-1 #185 (thumb F3+C#4) |
| | warning | 1 | 079-2 #117 thumb on Bb4+C#5 (minor third, two black keys — barely possible) |
| | info | 83 | thumb on two keys a (half) step apart — a legitimate technique (mostly 026, Chopin Polonaise) |
| simultaneous span > a major tenth in one hand | error | **2** | 038-1 #65 LH Eb2–Bb3 (19 st, probably a rolled chord), 150-1 #102 RH G3–C5 (17 st) |
| | warning (tenths, 15–16 st) | 55 | mostly 026, 030, 106 |
| malformed / odd finger strings | warning | 5 | 028-4 #85 `4_` (dangling `_`), 150-1 #25 `-2_1` and #42 `-1_1` (substitution switches hand sign), 005-1 #233 `2_4_5`, #257 `3_4_5` (chained substitutions, plausible) |
| chord fingers not ordered by pitch | warning | 4 | 022-1 #12 and #176 (A3=1, Eb4=5, F#4=4), 047-1 #266, 094-1 #286 (finger crossing inside a chord) |
| note ID gap | warning | 1 | 088-1: id 59 missing (ids jump 58→60); no content loss detectable |
| zero-length notes | warning | 35 | 115 (12), 108 (9), 135, 126, 101, 081 — synthesis artefacts |
| pitch outside the usual hand range | warning | 18 | e.g. 106-1 (La Campanella) LH above C6 — genuine hand crossings |
| hand assignment differs between annotators | info | 24 files / 138 notes | e.g. 063-2 (28 notes), 113-2 (17), 003-5 (13) — pianists redistribute notes between hands |
| finger re-used while its previous key is still held | info | 747 | early release / pedal; not an error |

**Finger usage** (key-press finger): RH 1 26.5%, 2 24.0%, 3 19.9%, 4 14.4%, 5 15.3%; LH 1 32.0%,
2 21.1%, 3 14.4%, 4 10.3%, 5 22.3%. **Most common melodic transitions** (consecutive single notes
in one hand): RH 2→1 (3,544), 3→2 (3,490), 1→2, 2→3, 4→3, 3→1, 1→3, 3→4, 5→4, 1→5; with
intervals RH 3→2 down a whole tone (1,659), 4→3 −2, 2→3 +2, 2→1 −2, 3→2 −1; LH 1→2 −2 (914),
5→1 +12 (759, octave accompaniment), 2→3 −2, 1→5 −12.

### 2.7 Inter-annotator agreement

Plain match rate (same key-press finger) between two pianists, averaged per piece:

| Subset | Pieces | Mean pairwise agreement | SD over pieces | All j pianists agree (j = 2 … J) |
|---|---|---|---|---|
| Bach | 10 | 62.8% | 4.1 | 62.8 / 47.2 / 38.4 |
| Mozart | 10 | 71.8% | 8.6 | 71.8 / 59.6 / 52.5 / 47.5 / 43.9 |
| Chopin | 10 | 80.2% | 4.0 | 80.2 / 71.3 / 65.4 / 61.0 |
| Miscellaneous (2 pianists) | 39 | 72.5% | 8.3 | — |
| All 69 multi-annotation pieces | 69 | 72.1% (72.7% over pairs) | | |

This matches the paper's Fig. 1 ("on average, 60% to 80% of the notes are played with the same
fingers"; Bach lowest, Chopin highest; the j-player decay is consistent with its power-law fits).
Pianist pairs (≥ 5 shared pieces) range from 62% (NH–YI, HI–NH) to 85% (EN–YoI, ES–YoI).

**Human reference of Table 2** (each pianist scored against the others, averaged per piece, then
over the 30 test pieces): we get **M_gen 71.37, M_high 79.13, M_soft 90.80, M_rec 84.26** vs the
paper's 71.4 / 79.1 / 90.8 / 84.3 (exact to the printed precision). With the paper's stated
protocol of using only the key-press finger for substitutions ("press" mode) M_gen is 71.60.

### 2.8 Verdict on PIG

Trustworthy. 100,040 note-fingerings, 0 format errors, 6 physically impossible items (listed
above, all in single annotations of the test/misc data), consistent annotations across pianists,
statistics and agreement exactly as published. Caveats: it records *performed* fingerings of
advanced repertoire excerpts (not beginner editions); pianists sometimes redistribute notes
between hands; timing is synthetic; substitutions are rare. Use it as the benchmark with the
official split and the four metrics, and quote the human ceiling (M_gen 71.4).

## 3. Metrics library (`research/fingering_eval/metrics.py`)

For a piece with N notes, estimate `est` and ground truths `gt_1..gt_G`:

* **M_gen** — mean over ground truths of the plain match rate.
* **M_high** — match rate against the closest ground truth. The official tool picks the closest
  ground truth **separately for the RH and the LH note sequences** (`MultiGTError` with switching
  costs 10000); `per_hand=False` gives the whole-piece variant.
* **M_soft** — fraction of notes whose finger equals the finger of at least one ground truth.
* **M_rec** — (N − E_rec)/N, where E_rec is the minimum edit cost of a *recombined* ground truth:
  follow one ground truth per note, switch between ground truths only where they agree, pay
  C_rec = 1 per switch and C_sub = 1 per mismatch with the estimate (Appendix A, C'_rec = ∞).
  Appendix A requires the two ground truths to agree on the *current* note, the official C++ on
  the *previous* note; both generate the same recombined sequences at the same cost (proved by
  argument in the docstring and checked by brute force on 300 random cases in the tests).
  The dynamic programme runs per hand, like the official tool.

Subtleties of the official tool that we reproduce (`mode="official"`, default of the library and the CLI):
* the RH/LH split for M_high/M_soft/M_rec comes from the sign of the **estimated** finger;
* M_gen compares the raw finger **strings** (`3_1` ≠ `3`), the other three use C `atoi`
  (key-press finger). `mode="press"` (paper protocol for all four) and `mode="exact"` exist too;
* scores are averaged over pieces (macro); the CLI also prints note-weighted (micro) averages.

**Reproduction of Table 2** from the published HMM outputs (`crosscheck_official_eval.py`,
`reports/official_eval_crosscheck.json`):

| Method | Paper M_gen / M_high / M_soft / M_rec | Ours (official mode) |
|---|---|---|
| 1st-order HMM | 61.7 / 68.3 / 82.8 / 74.0 | 61.653 / 68.336 / 82.754 / 74.016 |
| 2nd-order HMM | 64.3 / 70.8 / 85.3 / 77.6 | 64.269 / 70.809 / 85.258 / 77.574 |
| 3rd-order HMM | 64.5 / 71.0 / 85.5 / 77.8 | 64.479 / 71.003 / 85.490 / 77.779 |
| Human | 71.4 / 79.1 / 90.8 / 84.3 | 71.369 / 79.133 / 90.800 / 84.258 |

(In "press" mode M_gen becomes 61.76 / 64.40 / 64.62 / 71.60, i.e. the paper used the tool's
string comparison.) **Official binary vs ours:** 408 cases (90 HMM outputs, 228 leave-one-out
cases over every multi-annotation piece, 90 random perturbations with hand flips and substitution
strings, plus `Evaluate_SimpleMatchRate` on all of them): 0 disagreements, max |diff| 4.99e-7
(the tool prints 6 significant digits).

**API / CLI.** `evaluate_piece(gts, est, mode=...)`, `aggregate(scores)`, `leave_one_out(...)`,
`match_rate`, `general/highest/soft/recombination_match_rate`, `multi_gt_error`. Gold notes with
finger `0` (partially fingered corpora) are masked by the CLI.

```
python -I -m fingering_eval.evaluate --pred <dir|file> --gold research/data/pig --split test
  [--mode official|press|exact] [--per-piece] [--json out.json] [--pred-annotation K]
  [--gold-annotations K,..] [--human] [--whole-piece] [--status ok]   # --status for manifests
```
Run with the research venv's interpreter (`research/.venv`, see `research/data/README.md`). `research`
is on `sys.path` through the venv's `digitus2_research.pth`; otherwise `PYTHONPATH=research python -m fingering_eval.evaluate ...`
(bash) / `$env:PYTHONPATH='research'` (PowerShell), or in code `sys.path.insert(0, "research")`.

Real output (gold = all pianists, one pianist as prediction; HMM3; human reference):

```
$ python -I -m fingering_eval.evaluate --pred research/data/pig --pred-annotation 1 --gold research/data/pig --split test
Prediction research/data/pig vs gold research/data/pig split=test mode=official
                   M_gen  M_high  M_soft   M_rec
macro (paper)      77.10  100.00  100.00  100.00   (30 pieces)
micro (notes)      77.71  100.00  100.00  100.00   (10225 notes)
  Bach             71.60  100.00  100.00  100.00   (10 pieces)
  Chopin           81.97  100.00  100.00  100.00   (10 pieces)
  Mozart           77.72  100.00  100.00  100.00   (10 pieces)

$ python -I -m fingering_eval.evaluate --pred research/data/pig_hmm/Result_FHMM3 --gold research/data/pig --split test
Prediction research/data/pig_hmm/Result_FHMM3 vs gold research/data/pig split=test mode=official
                   M_gen  M_high  M_soft   M_rec
macro (paper)      64.48   71.00   85.49   77.78   (30 pieces)
micro (notes)      65.69   71.65   85.85   78.44   (10225 notes)
  Bach             59.80   66.02   84.95   75.20   (10 pieces)
  Chopin           74.14   79.43   89.73   83.58   (10 pieces)
  Mozart           59.50   67.56   81.79   74.56   (10 pieces)

$ python -I -m fingering_eval.evaluate --human --gold research/data/pig --split test
Human reference (leave-one-out) on research/data/pig split=test mode=official
                   M_gen  M_high  M_soft   M_rec
macro (paper)      71.37   79.13   90.80   84.26   (30 pieces)
micro (notes)      72.33   79.56   90.86   84.68   (10225 notes)
  Bach             62.43   68.80   85.15   76.49   (10 pieces)
  Chopin           80.09   86.89   93.91   89.57   (10 pieces)
  Mozart           71.59   81.71   93.34   86.71   (10 pieces)
```

In the first run M_gen of one pianist is not 100% because the other pianists disagree;
M_high/M_soft/M_rec are 100% because that pianist is one of the ground truths.

## 4. Mutopia editorial fingerings

### 4.1 Method (`fingering_eval/lilypond.py`, `fingering_eval/mutopia.py`, `scripts/build_mutopia_fingering.py`)

1. **Sources**: `MutopiaProject/MutopiaProject@2144afd6` (2024-11-07), `ftp/` tree, the 827 piece
   directories whose `mutopiainstrument` mentions a keyboard instrument; 172 of them contain
   fingering marks according to python-ly's lexer (50,076 marks in source files, incl. MIDI-only
   scores and A4/Letter duplicates).
2. **A LilyPond interpreter** on top of python-ly's lexer (no LilyPond, no Scheme execution):
   variables, local `\include`, `\relative` (with/without start pitch, nested, positioned rests
   moving the reference), `\absolute`, `\fixed`, `\transpose`, LilyPond's input-order default
   durations, dots/scaling/tuplets, chords and `q`, ties (incl. `^~`), grace notes,
   `\parallelMusic`, repeats (volta/segno in written order, unfold expanded, tremolo/percent as
   engraved), `\new`/`\context` Staff/PianoStaff/Voice semantics, `\change Staff`, `\autochange`,
   anacruses (`\partial`, `measurePosition`), languages (nederlands/english/deutsch/italiano…).
3. **Hands = staves**: every PianoStaff/GrandStaff with two staves (or a keyboard score with two
   ungrouped staves) is a part; upper staff = RH, lower = LH, cross-staff notes follow
   `\change Staff` (the convention PIG's authors used for their test inputs). Duets give two
   parts. Layout-only: `\midi`-only scores are ignored.
4. **Fingerings**: `-3`, `^3`, `_3`, inside chords, `\finger "4-1"` (→ PIG substitution `4_1`),
   `\markup \finger`. Fingerings written after a chord, or several marks on one note while other
   voices of the same hand sound, are mapped to the vertical chord only if the counts agree and
   exactly one order is anatomically monotone (RH finger rises with pitch, LH falls); two marks on
   a lone note are alternatives (first kept). Unfingered notes get finger `0`.
5. Output: `research/data/mutopia_fingering/FingeringFiles/MP<id>_s<score>_p<part>-0_fingering.txt`
   (PIG format, header lines give source file and licence) + `manifest.csv/json` (composer, title,
   opus, Mutopia id and URL, licence, LilyPond version, note/fingering counts per hand,
   bar-check results, MIDI recall, status, issues) + `failures.csv` + `summary.json`.

### 4.2 Validation of the conversion

* **Bar checks** (`|`) are verified against the meter grid (`\time`, `\partial`,
  `measurePosition`): 20,764 bar checks, 321 "breaks" (independent off-grid events; most are
  incomplete measures at section ends that LilyPond itself tolerates).
* **LilyPond's own MIDI** (shipped by Mutopia, `crosscheck_mutopia_midi.py`): for every part and
  hand, the exact longest common subsequence between our pitch sequence (onset order) and the
  best MIDI track (repeats may be unfolded there, so ours must be a subsequence).
  Every one of the 310 parts has a Mutopia MIDI: **293 reach recall ≥ 0.95 in both hands (nearly
  all exactly 1.0)**; 2 are *version skew* (BWV 926 and Burgmüller Op. 100/1 were edited on GitHub after the
  website build: converting the website's own source reproduces the website MIDI exactly);
  15 parts remain mismatched (13 small harpsichord examples of Couperin's *L'Art de toucher le
  clavecin*, Mozart K379 piano part iii, Rachmaninoff Op. 23/1) and are marked `suspect`.
* **Independent alignment with PIG** (`compare_mutopia_pig_overlap.py`): four pieces exist in both
  corpora; 1,402 of 1,417 PIG notes (98.9%) align by pitch sequence with our Mutopia notes.
* Validators (`reports/mutopia_validation.json`): 352 "impossible" spans and 37 same-finger
  chords, concentrated in virtuoso/reduction scores (Liszt Ballade 2, Verdi *Traviata* reductions,
  Mozart K379, Rachmaninoff) where a staff holds notes taken by the other hand — the
  staff = hand convention, not a parse error (most of these parts have MIDI recall 1.0). Errors per
  1,000 notes: Diabelli 0.04, Czerny/Kuhlau/Schumann/Bach 0, Burgmüller 0.7, Chopin 1.0, Verdi 1.6,
  Clementi 3.5 (a few lessons), Mozart 5.8 (mostly K379), Satie 15.7.

Final status: **286 `ok` parts** (MIDI-verified, or version skew, and at most max(2, 5%) bar-check
breaks) from
160 pieces, **193,059 notes, 36,183 fingered** (RH 24,783, LH 11,400); 24 `suspect` parts
(reasons in the manifest). `python -m fingering_eval.evaluate --gold research/data/mutopia_fingering --status ok --pred <dir>`
evaluates on fingered notes of verified parts only.

### 4.3 Yield (verified parts)

| Composer | Pieces | Parts | Notes | Fingered | Coverage |
|---|---|---|---|---|---|
| Clementi — *Introduction to the Art of Playing on the Piano Forte*, Op. 42 (77 lessons) | 1 | 71 | 19,791 | 9,655 | 49% |
| Diabelli — 28 melodic duets Op. 149, sonatinas Op. 163 (primo + secondo parts) | 36 | 80 | 22,931 | 7,829 | 34% |
| Chopin — Études Op. 10/1, 10/2, 10/5, 25/1, 25/2; Nocturnes Op. 9/2, 9/3, 27/2; Preludes Op. 28/7, Op. 45; Mazurkas Op. 6/1, 33/1; Waltz Op. 69/2; Sonata 2 | 14 | 14 | 19,581 | 6,166 | 31% |
| Verdi — *La Traviata* piano reductions | 19 | 20 | 55,842 | 3,373 | 6% |
| Mozart — K545 (3 mvts), K397, K379, … | 7 | 8 | 11,144 | 1,977 | 18% |
| Czerny — Op. 821 (19 exercises), Op. 840 (10 études) | 28 | 28 | 7,821 | 1,809 | 23% |
| Beethoven — Moonlight (3 mvts), Pathétique ii, Op. 2/1 ii | 3 | 5 | 8,716 | 1,383 | 16% |
| Burgmüller — 25 Études Op. 100 (19 of them) | 19 | 19 | 9,508 | 1,145 | 12% |
| Schumann, Grieg, Bach, Rachmaninoff, Hanon, Couperin, Benda, Gounod, Kuhlau, Pachelbel, Martini, Liszt, Tchaikovsky, Scriabin, Rieding, Gobbaerts, Joplin, Satie, Alkan, Field | 34 | 41 | 33,805 | 2,846 | 8% |
| **Total** | **160** | **286** | **193,059** | **36,183** | **19%** |

Coverage per part (fingered/notes): 10% of parts < 5%, quartiles 17% / 30% / 45%, 10% of parts
> 72%. Licences of the fingered notes: Public Domain 14,165; CC BY-SA 4.0 10,828; CC BY-SA 3.0
9,828; CC BY-SA 2.5 937; CC BY 3.0 288; CC BY 2.5 84; CC BY 4.0 53 (per part in the manifest).
Interpretation counters (all parts): 981 post-chord fingerings mapped, 646 dropped as ambiguous,
431 multi-mark notes mapped to simultaneous voices, 213 alternative marks (first kept), 115
unparseable fingering texts.

**Failure cases** (`failures.csv`): 20 files whose fingering marks end up on no layout-score note
(marks only in MIDI scores, unused variables or in other files of the unit), 20 duplicate
engravings (A4/Letter variants with the same notes and fingers; one is kept), 5 files without a
recognisable two-hand part (single-instrument score structures we do not support). Known limitations: user-defined Scheme music functions are skipped (their
arguments are parsed as music), `\partcombine` is treated as two voices, ornaments are not
realised, three-staff piano writing maps the middle staff by clef, Couperin's agréments examples
do not match their MIDI.

### 4.4 Is it a good oracle? Editorial vs performed fingering

On the four pieces in both corpora we compared Mutopia's printed fingering with every PIG pianist
on the same notes (`reports/mutopia_vs_pig_overlap.json`):

| Piece | Fingered notes compared | Mutopia vs pianists (mean = M_gen) | matches ≥ 1 pianist (M_soft) | pianists among themselves |
|---|---|---|---|---|
| Mozart K545 i (PIG 017, 6 pianists) | 53 | 90.9% | 98.1% | 89.8% |
| Chopin Nocturne Op. 9/2 (023, 5) | 71 | 53.0% | 80.3% | 66.5% |
| Chopin Waltz Op. 69/2 (077, 2) | 73 | 65.8% | 89.0% | 46.6% |
| Rachmaninoff Op. 23/9 (110, 1) | 123 | 80.5% | 80.5% | — |
| **All (note-weighted)** | **320** | **72.7%** | **85.3%** | |

The edition agrees with real pianists about as much as pianists agree with each other (PIG human
reference M_gen 71.4, M_soft 90.8). **Verdict:** a credible, independent second ground truth,
especially valuable for digitus2 because it is dominated by beginner/intermediate pedagogical
material (Clementi, Diabelli, Czerny, Burgmüller, Mozart K545) that PIG lacks. Use the `ok`
parts, evaluate only on fingered notes (single editor ⇒ M_gen = M_high = M_soft = M_rec), and
read it as "agreement with a published edition", not as the only correct fingering. Caveats:
editors finger the non-obvious notes (selection bias towards hard spots), staff ≠ hand in
virtuoso scores, some typesetters may have added their own fingerings.

## 5. Beringer & Dunhill scales, arpeggios, broken chords (pydactyl)

`dvdrndlph/pydactyl@0ad656db` (MIT) contains David Randolph's abcD transcriptions of
*Beringer & Dunhill (1900)*: 110 `.abcd` files (scales, arpeggios incl. dominant/diminished
sevenths, broken chords, in all keys), each with one or more "% abcD fingering N:
upper@lower" lines (N = 1 main, 2+ printed alternatives). `convert_pydactyl_beringer.py` contains
a minimal ABC reader for this subset and the abcD fingering grammar (from pydactyl's
`DAnnotation.py`): **128 fingering files for 84 exercises, 13,648 notes (13,642 fingered)**,
139 placeholder lines (`x@x`) skipped; 26 of the 110 files carry no fingering at all (e.g. chromatic scales). Validators: 0 errors,
10 range warnings (deep LH notes). Beringer's main vs alternative fingerings agree on 86.4% of
notes (39 exercises with alternatives). **Anomaly:** the broken-chord score annotations
(`"^$<staff><finger>"`) agree with the abcD line on 1,936 of 1,960 notes; all 24 disagreements
are in `broken_chords/csharp_minor.abcd`, whose abcD line is a copy of C minor's line while the
in-score annotations give the C#-minor fingering (thumbs off black keys) — the abcD header is
wrong. **Verdict:** small but authoritative; ideal as deterministic unit tests ("the engine must
produce standard scale/arpeggio fingerings") and for beginner technique, not as a benchmark of
musical fingering.

## 6. PianoVAM v1.2 (performance fingering from video)

HF `PianoVAM/PianoVAM_v1@1f039ab9` (CC BY-NC-SA 4.0); we download only `Fingering/`,
`Fingering_GT/`, `TSV/`, `metadata.json`, `README.md` (no audio/video). 106 solo recordings of
amateur pianists (Disklavier MIDI), 525,483 notes, hand+finger per note from MediaPipe hand
landmarks (19.9% `Noinfo`); `Fingering_GT/` = 1,800 manually annotated notes (first 150/300 notes
of 11 recordings). Loader: `datasets.load_pianovam(which="Fingering"|"Fingering_GT")` (unlabelled
notes get finger 0 and a pitch-based hand). We reproduce the README's accuracy exactly: 88.2% of GT
notes labelled, 95.7% of labelled notes correct (hand+finger), 99.2% correct hand. Validators on
the automatic labels: 146 impossible spans, 14 same-finger chords, 2,139 hand-range warnings
(labelled notes) — expected for pseudo-labels. **Verdict:** not a ground truth for score
fingering; useful for "what do amateurs actually do" statistics and as noisy training data.

## 7. music21 corpus, OpenScore, MuseScore

* **music21 10.5.0 corpus** (`check_music21_corpus.py`, `reports/music21_corpus_fingering.json`):
  3,219 files scanned for MusicXML `<fingering>`, Humdrum `**fing`, ABC `!n!`, MEI `<fing>`.
  Only Clara Schumann's *Polonaises* Op. 1 Nos. 1–4 carry piano fingerings (14, 5, 29 and 9 marks,
  i.e. 57 fingered notes); two Ryan's Mammoth fiddle tunes contain `!n!` decorations. Negligible.
* **OpenScore** (CC0): Lieder corpus — GitHub code search finds `<Fingering>` elements in about 6
  of ~1,300 songs; String Quartets/orchestral corpora are irrelevant. Negligible.
* **MuseScore.com**: user uploads default to "All rights reserved"; bulk download needs a Pro
  account/API and is not licensed for redistribution. The usable route is **PDMX** (section 8),
  which contains only scores their uploaders marked public domain/CC0.

## 8. PDMX fingered subset (optional, large, noisy)

PDMX (Long et al., ICASSP 2025; Zenodo 10.5281/zenodo.15571083, CC BY 4.0): 254k public-domain
MuseScore scores as MusicXML. ThumbSet (Ramoneda et al. 2022) was built from exactly this kind of
material but is access-restricted. `download_datasets.py pdmx_fingered` (opt-in, 1.9 GB) streams
`mxl.tar.gz` (md5-verified) and keeps only keyboard scores with `<fingering>` elements, writing
`research/data/pdmx_fingered/mxl/…` plus `fingered_keyboard_index.json` (fingering and note counts
per file) and `PDMX.csv` (per-score metadata/licence).

**Result of the scan:** of **254,035** PDMX scores only **1,538 (0.6%)** contain any
`<fingering>` element, and **978** of those are keyboard scores (884 with a two-staff part):
1.67 M notes, **110,366 fingering marks** (median density 11% of notes; 665 scores have ≥ 20
marks, 248 have ≥ 100). Licences (PDMX.csv): CC0 906, public-domain mark 72; PDMX flags 244 of
them with `license_conflict` (e.g. Bartók arrangements still under copyright in some
jurisdictions) — use the 734 conflict-free ones. MuseScore "complexity" 0–1 for 709 of 978, i.e.
mostly easy material (most frequent composers: Lemoine, Bartók's 1945 revisions — flagged —, Bach, Czerny).

A quick music21-based conversion of a random sample (`scripts/convert_pdmx_sample.py --n 150`,
`reports/pdmx_sample_validation.json`): 134 of 150 converted (16 without a grand-staff part),
121,335 notes of which 8,617 (7.1%) fingered; validators report 791 impossible chord spans,
8 same-finger chords and 4,857 duplicate notes — but concentrated in a minority of files
(70 of 134 files have no duplicate notes, 100 have no impossible span): doubled voices, reductions
and engraving shortcuts are common in community scores.

**Verdict:** a large *weak-supervision* source (user-entered, unreviewed, often partial and of
unknown provenance — ThumbSet's authors call the equivalent data noisy); do not use it to verify
the engine. It is not used for training. `convert_pdmx_sample.py` converts a sample to PIG format;
training on it would need the full conversion.

## 9. Other candidates checked

| Candidate | Finding |
|---|---|
| **ThumbSet** (Ramoneda et al., ACM MM 2022; Zenodo 10.5281/zenodo.6433702) | 2,523 MuseScore scores, partial fingerings in PIG encoding (windows). **Access restricted** ("available upon request through the Zenodo platform"); requires the user to request access with their own account. Not obtained. |
| **ArGNN repo / Mikrokosmos-difficulty** (Ramoneda) | ArGNN repo: models + `official_split.json` (taken), no fingering data. Mikrokosmos-difficulty (ICASSP 2022) fingerings are *computed* by Nakamura's HMM and pianoplayer (`Fingers/nakamura`, `Fingers/pianoplayer`) — not ground truth. CIPI (Zenodo 8037327) is access-restricted and also uses algorithmic fingering features. |
| **APFD** (Moryossef et al. 2019/2023, "At Your Fingertips") | 90 YouTube-derived pieces, 155,107 automatically labelled notes. Download URL `http://nlp.biu.ac.il/~amit/piano/cache/dataset.jsonl` times out/404, `AmitMY/piano-fingering-extraction` is gone (404); `AmitMY/piano-hands` holds only hand bounding boxes; no Wayback snapshot. **Unavailable.** |
| **PianoMotion10M** (ICLR 2025; Zenodo 13297386, CC BY-NC-ND 4.0) | 116 h of video with 10M MANO hand poses + MIDI; **no per-note finger labels** (fingers would have to be inferred as PianoVAM does). |
| **PianoVAM** | taken (section 6). |
| **PiAnnotate / FürElise** (2026) | expert-reviewed fingering of the FürElise performance dataset; no data release linked. |
| **SKY-Piano** (2026) | motion-capture performance dataset with *pseudo*-fingering. |
| **RP1M** | robot-hand finger placements from optimal transport; not human. |
| **TNUA / Taiwanese datasets**, **"Gao et al. 2024"**, Kaggle | nothing matching found (web, GitHub, Zenodo, HuggingFace searches). |
| **Czerny / Hanon** | covered through Mutopia (Czerny Op. 821/840, Hanon Part I) and Beringer (pydactyl). |
| **Lois Roberts annotations** (GitHub) | scanned PDF/JPEG only, no licence. |
| **pydactyl `wtc/`** | unfingered ABC of Bach WTC. |
| **Zenodo "piano fingering"** search | papers only (CRF model, RNN estimation, checklist models, merged-output HMM) — no further data. |

## 10. Files and reproducibility

* Library: `research/fingering_eval/` — `pig_io.py`, `metrics.py`, `validate.py`, `evaluate.py`
  (CLI), `datasets.py` (loaders + splits), `lilypond.py` + `mutopia.py` (Mutopia pipeline).
* Scripts: `download_datasets.py` (idempotent; lock files, atomic rename, per-file hash manifests,
  mirrors), `make_pig_splits.py`, `validate_datasets.py`, `crosscheck_official_eval.py`,
  `build_mutopia_fingering.py`, `crosscheck_mutopia_midi.py`, `compare_mutopia_pig_overlap.py`,
  `convert_pydactyl_beringer.py`, `check_music21_corpus.py`, `convert_pdmx_sample.py`.
* Tests: `research/tests/` (PIG parsing, metrics incl. brute-force M_rec and the paper's Fig. 5
  example, validators, CLI, LilyPond interpreter, Table 2 integration, corpus consistency incl.
  reproducing PianoVAM's published label accuracy), run with the research venv's interpreter:

```
cd research && python -I -m pytest tests
```
