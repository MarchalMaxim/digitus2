# Piano-fingering baselines: every open-source implementation we could find, run on PIG

Code, wrappers and raw results: [`research/baselines/`](../../research/baselines/) (start with its
README).
Machine-readable results: [`research/baselines/results.json`](../../research/baselines/results.json),
per piece: `results_per_piece_test.csv` / `results_per_piece_all.csv`. Both key the rows by baseline
id, for example `nakamura_fhmm3` (FHMM3) and `fingerflow_learned` (FingerFlow, learned weights);
`digitus2 bench --compare` reads these ids.

## TL;DR

* We searched GitHub (`gh search repos/code`, ~20 queries), Bitbucket, papers and project pages
  and found **~70 repositories**. **23 implementations were set up and run end to end** on the
  PIG dataset (22 scored, 47 scored variants, all through one wrapper interface and one scorer; the
  EER DQN runs but is too slow to finish); the rest
  are triaged below with the reason they were not run.
* Scorer = the project's `research/fingering_eval` (Nakamura et al.'s four match rates). It
  reproduces the paper's Table 2 *exactly* from the authors' released HMM outputs, and agrees
  with the original C++ evaluator to < 5e-7 on every one of the 1,478 scored (baseline, piece)
  pairs.
* **Best result on the official test split (30 pieces) that did not see the test data:
  FingerFlow (learned weights) M_gen 68.6 / M_high 76.3 / M_soft 90.3 / M_rec 82.3**, a
  biomechanical feature cost + second-order Viterbi whose 99 weights are learned with a
  structured perceptron. Human inter-annotator agreement is 71.4 / 79.1 / 90.8 / 84.3.
* A cluster of very different methods sits at **65-67 M_gen**: ArGNN with beam search (66.7,
  the published neural SOTA), lumikey's 100k-parameter Transformer retrained by us on the
  train split (66.2), chirality's exact Viterbi over Parncutt's 12 rules with learned weights
  (66.0), the Hand-thesia planner (65.8) and Nakamura's 3rd-order HMM (65.0). With 30 test
  pieces these are statistically indistinguishable (paired bootstrap 95% CIs of the
  difference to FHMM3 all include 0); only FingerFlow is significantly better than FHMM3
  (+3.6 points, CI [+1.1, +6.3]) and marginally better than ArGNN-beam (+1.9, [+0.1, +3.7]).
* **Two released neural models are contaminated**: lumikey's checkpoints were trained on every
  note of all 309 PIG files (74.1, above human agreement) and APF-Gen's on a random 70% of PIG
  *files* (70.5). Retrained on the official split they score 66.2 and 59.1.
* Solving the classic **rule models exactly matters more than the rule set**: Parncutt's 1997
  rules solved by exact Viterbi (chirality) score 65.4, the same rules in pydactyl's pruned
  k-best Dijkstra 62.9; OpenNote's rule engine 64.2-64.5.
* Several well-known repos have **bugs that dominate their score**: pianoplayer's PIG reader
  never sets key positions (all thumbs; 48.7 even after our fix vs 57.2 via its MusicXML code
  path), ValHaLA fingers the left hand with the right-hand model (31.5; 52.3 mirrored), the
  2014 Balliauw VNS code does not optimise (below random), PianoFingering.jl crashes on 4/30
  pieces, huukhang's flagship "phrase-aware" pipeline is worse than its own simple DP.
* **License**: only the MIT repositories (pianoplayer, Ramoneda's ArGNN/ArLSTM code and weights,
  pydactyl, Kanma/piano_fingering, autofingering, huukhang, ValHaLA) can be reused as code; the
  rest has no license (all rights reserved), is copyleft or is non-commercial (see "Licenses and
  reuse in an MIT project"). The PIG dataset itself is "nonprofit, academic use only", and
  weights trained on it inherit that restriction: digitus2 treats PIG-fitted weights as research
  only and ships a set trained on open data (see [`datasets.md`](datasets.md)).

## Protocol

* **Data**: PIG v1.2 (2022/5/12), 150 pieces, 309 fingering files, from
  `research/data/pig/FingeringFiles` (identical byte-for-byte to the v1.2 folder of two GitHub
  mirrors; the official download needs a registration form).
* **Split**: `research/data/splits/pig_official.json`, `nakamura2020`: test = pieces 001-030
  (Bach, Mozart, Chopin sets; 150 fingering files, 4-6 annotators per piece), train =
  031-150. Ramoneda et al.'s `official_split.json` has the same test pieces and the same 120
  training pieces (100 train + 29 val, 9 pieces in both).
* **Input** (all wrappers): notes, timing and hand (channel) of the piece's first annotator
  file `NNN-1_fingering.txt`, exactly like Nakamura's released results. The finger column never
  reaches third-party code: it is blanked, or replaced by +1/-1 for programs that read the hand
  from the finger sign (Nakamura's HMM2/3, PianoFingering.jl). Models are always given the
  ground-truth hand split; none of them chooses hands.
* **Metrics**: `fingering_eval.metrics`, mode `official` (bit-for-bit the C++
  `Evaluate_MultipleGroundTruth`; mode `press`, which reduces ground-truth substitutions like
  `3_1` to the pressing finger, is also stored and differs by about +0.1). Macro average over
  the 30 pieces (as Table 2), micro averages in `results.json`.
* **Runtime**: wall clock per piece inside the wrapper (process start-up included for
  external binaries), on the reference desktop (16 logical cores, RTX 4080 SUPER), mostly
  single-threaded CPU.
* **Validation of the pipeline**: the authors' released FHMM1/2/3 outputs score
  61.65/68.34/82.75/74.02, 64.27/70.81/85.26/77.57, 64.48/71.00/85.49/77.78 = Table 2 to the
  printed digit; the human leave-one-out row gives 71.37/79.13/90.80/84.26 (Table 2: 71.4/79.1/
  90.8/84.3). Our re-runs of the same binaries on v1.2 are 0.6-0.9 higher because 64 test notes
  changed hand (and finger) between PIG v1.0 and v1.2; where the inputs agree our outputs are
  note-identical to the released ones.

## Results on the official PIG test split (30 pieces, 10,225 notes)

Sorted by M_gen. "Trained on" says what PIG data the evaluated parameters saw.
Rows marked *contaminated* saw the test pieces and are listed separately below.

| # | Implementation (variant) | Approach | License | Trained on | M_gen | M_high | M_soft | M_rec | Pieces | s/piece |
|---|---|---|---|---|---|---|---|---|---|---|
| | *Human annotators, leave-one-out* | | | | *71.4* | *79.1* | *90.8* | *84.3* | | |
| 1 | **FingerFlow** (learned weights) | biomech. features + 2nd-order Viterbi, structured perceptron | none | 031-150 (trained here) | **68.6** | **76.3** | **90.3** | **82.3** | 30 | 1.2 |
| 2 | Ramoneda et al. 2022 **ArGNN**, beam 10 | GNN encoder + AR LSTM decoder | MIT | ThumbSet + PIG train | 66.7 | 73.5 | 88.3 | 79.3 | 30 | 0.5 |
| 3 | **lumikey** Transformer, retrained by us | 100k-param Transformer, greedy AR | none | 031-150 (retrained here) | 66.2 | 72.6 | 87.9 | 79.3 | 30 | 0.2 |
| 4 | **chirality** Parncutt-rule Viterbi, learned weights | exact 2nd-order Viterbi over 12 rules, perceptron | AGPL-3.0 | 031-150 (trained here) | 66.0 | 72.1 | 87.2 | 79.5 | 30 | 0.1 |
| 5 | **Hand-thesia** planner (pygame-piano-animator) | beam search, physical cost + figure templates | none | 031-150 (shipped weights) | 65.8 | 73.1 | 87.5 | 79.1 | 30 | 0.1 |
| 6 | chirality Parncutt-rule Viterbi, uniform weights | exact Viterbi, Parncutt 1997 | AGPL-3.0 | none | 65.4 | 72.2 | 86.7 | 78.8 | 30 | 0.1 |
| 7 | Ramoneda ArLSTM, beam 10 | BiLSTM + AR decoder | MIT | ThumbSet + PIG train | 65.1 | 72.4 | 86.9 | 78.8 | 30 | 0.6 |
| 8 | **Nakamura FHMM3** (C++) | 3rd-order HMM | none | 031-150 | 65.0 | 71.6 | 86.3 | 78.6 | 30 | 0.06 |
| 9 | Nakamura FHMM2 | 2nd-order HMM | none | 031-150 | 64.9 | 71.5 | 86.1 | 78.2 | 30 | 0.05 |
| 10 | Ramoneda ArGNN, greedy | as 2 | MIT | ThumbSet + PIG train | 64.7 | 70.7 | 86.7 | 76.7 | 30 | 0.2 |
| 11 | **OpenNote** rules (Jacobs) | Viterbi over hand model + rules | PolyForm-NC | none (prior not distributed) | 64.5 | 71.8 | 85.9 | 77.6 | 30 | 0.3 |
| 12 | OpenNote rules (Parncutt) | " | PolyForm-NC | none | 64.4 | 72.2 | 86.0 | 77.7 | 30 | 0.4 |
| 13 | FingerFlow, hand-tuned weights | as 1 | none | none | 64.3 | 71.4 | 85.8 | 77.9 | 30 | 1.2 |
| 14 | Ramoneda ArLSTM, greedy | as 7 | MIT | ThumbSet + PIG train | 64.2 | 71.2 | 86.4 | 77.7 | 30 | 0.2 |
| 15 | OpenNote rules (consensus, default) | " | PolyForm-NC | none | 64.2 | 71.7 | 85.6 | 77.3 | 30 | 0.4 |
| 16 | **pydactyl** Jacobs 2001 | Parncutt-family DP (pruned k-best) | MIT | none | 63.6 | 70.5 | 84.9 | 77.0 | 30 | 1.2 |
| 17 | pydactyl Parncutt 1997 | " | MIT | none | 62.9 | 69.7 | 84.5 | 76.8 | 30 | 1.1 |
| 18 | **BShakhovsky** CalcModule | trellis over chord fingerings, cost rules | none | none | 62.6 | 69.3 | 83.4 | 75.7 | 30 | 0.02 |
| 19 | Nakamura FHMM1 | 1st-order HMM | none | 031-150 | 62.3 | 69.0 | 83.7 | 74.9 | 30 | 0.04 |
| 20 | Nakamura web demo FHMM1 (JavaScript) | 1st-order HMM | none | PIG (embedded params) | 62.2 | 69.0 | 83.6 | 74.9 | 30 | 0.06 |
| 21 | **autofingering** | 1st-order HMM (Python) | MIT | 031-150 (trained here) | 62.1 | 68.8 | 83.2 | 74.4 | 30 | 0.01 |
| 22 | **CHOWMHALVIN** HMM | 1st-order HMM + biomech. constraints | none | 031-150 (trained here) | 62.1 | 68.8 | 83.3 | 74.5 | 30 | 0.04 |
| 23 | Nakamura CHMM | chord HMM | none | 031-150 | 62.0 | 68.7 | 82.6 | 74.7 | 30 | 0.05 |
| 24 | pydactyl Balliauw 2017 rules | Parncutt-family DP | MIT | none | 61.7 | 68.3 | 83.4 | 74.3 | 30 | 1.1 |
| 25 | **Kanma/piano_fingering** (= blakewest/performer) | Viterbi over chord layers, cost table | MIT | none | 61.6 | 68.2 | 83.3 | 74.8 | 30 | 0.02 |
| 26 | pydactyl Badgerow 2009 | Parncutt-family DP | MIT | none | 61.4 | 68.6 | 82.8 | 74.8 | 30 | 1.0 |
| 27 | **huukhang** simple DP | physics DP over 5-finger hand states | MIT | none | 59.9 | 65.5 | 80.3 | 70.6 | 30 | 0.02 |
| 28 | **ackyedy** H2 / H1 interval HMM | semitone-interval HMM | none | 031-150 (trained here) | 59.8 / 59.6 | 66.6 / 66.1 | 80.8 / 80.7 | 73.1 / 72.6 | 30 | 0.002 |
| 29 | **APF-Gen** CNN-BiLSTM, retrained by us, argmax / beam | CNN-BiLSTM + attention + AR | none | 031-150 (retrained here) | 59.1 / 58.4 | 64.8 / 64.1 | 81.1 / 80.1 | 69.2 / 67.7 | 30 | 0.1 |
| 30 | **Smart Piano Fingering** (MuseScore 4 plugin) | pianoplayer-derived hand model, DP | GPL-3.0 | none | 58.8 | 66.4 | 80.1 | 71.4 | 30 | 0.08 |
| 31 | **PianoFingering.jl** (Gao et al. 2023) | per-piece Dyna-Q (model-based RL) | GPL-3.0 | none | 58.4 | 65.6 | 80.5 | 72.3 | 26 (4 crash) | 16 |
| 32 | **pianoplayer** (MusicXML-path emulation) | hand-velocity search over 5-9 notes | MIT | none | 57.2 | 64.2 | 78.2 | 69.3 | 30 | 19 |
| 33 | **ValHaLA**, LH mirrored by us / as shipped | 14-term physical action, Viterbi | MIT | none | 52.3 / 31.5 | 58.6 / 36.3 | 71.4 / 47.4 | 63.3 / 40.1 | 30 | 0.07 |
| 34 | pianoplayer, upstream PIG reader (+ our x fix) | as 32 | MIT | none | 48.7 | 55.5 | 68.9 | 60.1 | 30 | 14 |
| 35 | pydactyl Hart 2000 | interval cost table DP | MIT | none | 47.2 | 52.2 | 65.6 | 56.8 | 30 | 0.4 |
| 36 | **TimKoornstra** Q-learning (LH mirrored by us) | per-piece tabular Q-learning | GPL-3.0 | none | 46.8 | 52.0 | 63.5 | 54.2 | 30 | 2.5 |
| 37 | huukhang phrase-aware pipeline (flagship) | phrases + patterns + DP | MIT | none | 45.7 | 51.4 | 64.3 | 55.2 | 30 | 0.2 |
| 38 | ackyedy B1 direction rule / B0 most frequent finger | trivial baselines | none | none / 031-150 | 27.8 / 27.6 | 31.7 / 30.2 | 41.9 / 37.1 | 34.5 / 30.9 | 30 | 0 |
| 39 | pydactyl random | uniform legal fingering | MIT | none | 20.2 | 22.6 | 33.3 | 24.2 | 30 | 0.2 |
| 40 | **Balliauw et al. VNS** (C++, 2014 code) | variable neighbourhood search | none | none | 16.9 | 19.2 | 29.6 | 21.2 | 12 (stopped) | 294 |

Partial runs on the same pieces: PianoFingering.jl's 26 pieces score 63.1 with FHMM3 and 67.2
with FingerFlow; the VNS's 12 pieces 60.1 (FHMM3) and 64.7 (FingerFlow).

Reference: the authors' released FHMM1/2/3 outputs (PIG v1.0 hand assignment) score
61.6 / 64.3 / 64.5 M_gen on v1.2 -- exactly the published Table 2; Nakamura's DNN baselines
(not released) were 61.5 (FF) and 61.3 (LSTM) in that table.

**Per composer** (M_gen; human: Bach 62.4, Mozart 71.6, Chopin 80.1): FingerFlow 63.3 / 67.0 /
75.5, ArGNN-beam 62.5 / 64.9 / 72.8, lumikey-retrained 58.2 / 65.3 / 74.9, chirality-learned
62.5 / 63.6 / 71.9, Hand-thesia 59.6 / 63.6 / 74.1, FHMM3 61.2 / 59.4 / 74.4, pianoplayer
55.7 / 58.6 / 57.2. On the Bach set, where the annotators disagree most, the best systems
reach human agreement (FingerFlow 63.3, ArGNN-beam and chirality 62.5 vs 62.4); on Mozart and
Chopin even the best trail the humans by 4.6-7 points (FHMM3 by 12 on Mozart, pianoplayer by
23 on Chopin).

**Paired bootstrap over the 30 pieces** (M_gen difference, 95% percentile CI from 10,000
resamples with seed 0, pieces won):
FingerFlow - ArGNN-beam +1.90 [+0.08, +3.69] 18/30; FingerFlow - FHMM3 +3.62 [+1.11, +6.27]
21/30; ArGNN-beam - FHMM3 +1.71 [-0.60, +4.44] 18/30; lumikey-retrained - FHMM3 +1.14 [-1.23,
+3.43] 18/30; chirality-learned - FHMM3 +0.99 [-1.50, +3.40] 17/30; Hand-thesia - FHMM3 +0.74
[-1.99, +3.63] 17/30; FHMM3 - FHMM2 +0.13 [-0.49, +0.79] 16/30; learned - hand-tuned FingerFlow
weights +4.30 [+2.60, +5.98] 24/30; chirality exact Viterbi - pydactyl Parncutt +2.46 [+1.39,
+3.68] 23/30; MuseScore plugin - pianoplayer +1.64 [+0.20, +3.34] 18/30.

### Contaminated rows (trained on the test pieces -- not comparable)

| Implementation | Why contaminated | M_gen | M_high | M_soft | M_rec |
|---|---|---|---|---|---|
| lumikey released checkpoints | `data/pig_fingering_data_{right,left}.npz` hold 54,239 RH + 45,801 LH samples = every note of all 309 PIG files | 74.1 | 81.9 | 95.0 | 88.8 |
| APF-Gen released `best.pt`, argmax | trained on a random 70% of the 309 *files* (seed 42), i.e. most test-piece annotations | 70.5 | 77.0 | 91.8 | 80.7 |
| APF-Gen released `best.pt`, beam | same | 68.8 | 74.9 | 90.1 | 78.3 |

The leakage is worth +8 points for lumikey and +11 for APF-Gen, and APF-Gen's README reports
"test" M_gen ~82% from its leaky random split. Any PIG number from a model that splits by file
(rather than by piece) or trains on all of PIG should be treated the same way.

### Full dataset (150 pieces) -- training-free methods only

For methods that never saw PIG, pieces 031-150 are a second, four times larger held-out set
(mostly one or two annotators per piece, so M_gen is higher and M_soft/M_rec lower than on the
test set, and the numbers are not comparable to the test-split table). Macro averages:

| Implementation (variant) | All 150: M_gen | M_high | M_soft | M_rec | 031-150 only: M_gen | 001-030: M_gen |
|---|---|---|---|---|---|---|
| chirality Parncutt-rule Viterbi, uniform weights | 67.8 | 70.4 | 75.2 | 72.4 | 68.4 | 65.4 |
| OpenNote rules (Jacobs) | 67.3 | 69.9 | 74.7 | 71.8 | 68.0 | 64.5 |
| OpenNote rules (Parncutt) | 66.8 | 69.5 | 74.3 | 71.4 | 67.4 | 64.4 |
| OpenNote rules (consensus) | 66.8 | 69.4 | 74.2 | 71.3 | 67.4 | 64.2 |
| FingerFlow, hand-tuned weights | 66.2 | 68.7 | 73.6 | 70.8 | 66.7 | 64.3 |
| BShakhovsky CalcModule | 65.8 | 68.2 | 73.1 | 70.4 | 66.6 | 62.6 |
| pydactyl Jacobs | 65.2 | 67.8 | 72.6 | 69.8 | 65.6 | 63.6 |
| pydactyl Parncutt | 64.7 | 67.2 | 72.1 | 69.4 | 65.2 | 62.9 |
| pydactyl Balliauw | 63.1 | 65.4 | 70.4 | 67.3 | 63.5 | 61.7 |
| pydactyl Badgerow | 62.9 | 65.5 | 70.3 | 67.5 | 63.3 | 61.4 |
| huukhang simple DP | 61.4 | 63.6 | 68.4 | 65.2 | 61.8 | 59.9 |
| Kanma/piano_fingering | 61.0 | 63.4 | 68.4 | 65.4 | 60.9 | 61.6 |
| Smart Piano Fingering (MuseScore) | 60.4 | 62.9 | 67.6 | 64.6 | 60.8 | 58.8 |
| pianoplayer (MusicXML-path emulation) | 58.8 | 61.2 | 65.8 | 62.8 | 59.2 | 57.2 |
| ValHaLA, LH mirrored / as shipped | 53.1 / 34.9 | 55.3 / 36.5 | 59.5 / 40.1 | 56.8 / 37.7 | 53.3 / 35.7 | 52.3 / 31.5 |
| pydactyl Hart | 50.5 | 52.4 | 56.8 | 54.0 | 51.4 | 47.2 |
| TimKoornstra Q-learning | 48.0 | 49.8 | 53.5 | 50.6 | 48.2 | 46.8 |
| huukhang phrase-aware pipeline | 46.7 | 48.6 | 52.9 | 49.9 | 46.9 | 45.7 |
| ackyedy B1 direction rule | 30.1 | 31.5 | 34.6 | 32.3 | 30.6 | 27.8 |
| pydactyl random | 19.6 | 20.4 | 23.8 | 20.9 | 19.4 | 20.2 |

The ranking of the training-free methods is stable between the two sets (OpenNote's and
FingerFlow's hand-set weights may of course have been tuned by their authors while looking at
PIG). For the trained methods the 031-150 column is in-sample and shows how much each
overfits: FingerFlow-learned 70.3 (train) vs 68.6 (test), chirality-learned 69.3 vs 66.0,
FHMM3 73.8 vs 65.0, lumikey-retrained 76.9 vs 66.2, APF-Gen-retrained 73.0 vs 59.1. The
low-capacity linear models generalise; the HMM and the neural models memorise.
All rows (including in-sample ones) are in `results.json` (`baselines.<name>.all`) and
`results_per_piece_all.csv`. PianoFingering.jl and the VNS were run on the test split only.

## Per-implementation notes

Each entry: what had to be done to make it run, failure modes, code quality, and what is worth
learning or reusing. Commits are pinned in `research/baselines/setup_baselines.sh`.

### Nakamura, Saito & Yoshii 2020 -- FHMM1/2/3, CHMM (C++) and the web demo (JS)
* Source: `SourceCode_v190921.zip` and `Result_FHMM{1,2,3}.zip` from the paper's companion page
  (statpianofingering.github.io); the PIG dataset zip itself does not contain them. No license
  file. Builds unchanged with MinGW g++ 9.2 (`-static`); 0.04-0.06 s per piece.
* Gotchas: the 2nd/3rd-order decoders call `SetChannelFromFingerNumber()`, i.e. they take the
  hand from the *sign of the input finger*, not from the channel column -- feeding blanked
  fingers puts everything in the right hand. The shipped parameters are truncated to 6 digits
  (a handful of near-tie notes flip vs the released outputs; chirality documented 4/4/54 notes).
* The web demo (`FingeringEstimator.html`) contains a JS FHMM1 with embedded parameters
  (w1 = 1 instead of 0.964) and a hand-separation HMM for raw MIDI; we run it in Node.
* Learn/reuse: the output model (interval in a 2-D key lattice: white-key steps dx clipped to
  +-15, black/white dy; one distribution per finger pair) and the 30 ms "chord direction"
  penalty are compact and strong; 2nd order >> 1st order (+2.6), 3rd adds nothing. The
  parameter files are human-readable tables, but there is no license -- re-derive by training
  on PIG (autofingering and ackyedy show it is a few dozen lines). The evaluation code is the
  ground truth for the metrics (already ported in `fingering_eval`).

### Ramoneda et al. 2022 -- ArGNN / ArLSTM (MIT)
* `PRamoneda/Automatic-Piano-Fingering` ships the four finetuned checkpoints
  (`models/{right,left}_{ArGNN,ArLSTM}.pth`). Needs a sparse checkout on Windows (file names
  with `:`), numpy < 2 (`np.compat`), torch < 2.6 (`weights_only`). No inference script: our
  wrapper rebuilds their exact input pipeline from their own functions (pitch encoding with a
  -12 offset, per-hand sequences, onset/next edges, left hand mirrored with `reverse_hand`)
  and calls `model(...)` (greedy) or `decode_with_beam` (beam 10). M_gen is within 0.1 of
  their `table_beam_k.json` for greedy decoding (ArGNN 64.65 vs 64.70, ArLSTM 64.17 vs 64.25)
  and within 0.4 for beam 10 (66.73 vs 66.82, 65.13 vs 65.48).
* The ThumbSet pretraining corpus (2,523 crowd-annotated MuseScore pieces) is "available upon
  request"; without it, retraining from scratch is not possible.
* Learn/reuse (MIT): the gated graph encoder over onset/"next" edges is a neat way to give a
  sequence model polyphony; beam search over an autoregressive finger decoder is worth +1-2
  points; mirroring the LH so one model serves both hands. The checkpoints themselves are MIT
  but were fine-tuned on PIG.

### FingerFlow (MarcAlKareh/fingerflow; no license file)
* Python engine with a clean API (`engine.assign_fingering(hand_data, hand, hand_span_cm,
  weights)`) and a training module. We train its weights on the 120 training pieces only, with
  the repository's default hyper-parameters (8 epochs, ~30 s), then finger each hand.
  Its own benchmark claims 70.0 on the same 30 pieces (its own metric code; it also passes the
  test set as "dev" for logging only). Its docs claim PIG timings are real performances; PIG's
  README says they are synthesized from score-editing software.
* Learn (cannot copy -- no license): this is the strongest fair system and the closest to what
  we want: a second-order Viterbi over *chord-aware* assignments (events), 99 interpretable
  features (physical key geometry in cm, spans scaled to a hand profile, legato coupling that
  relaxes span constraints across rests, a tempo-dependent speed factor, a Fitts-law relocation
  cost, finger-pair indicators), and passive-aggressive structured-perceptron training with
  Hamming-augmented decoding and weight averaging. Learning the weights is worth +4.3 points
  over its hand-tuned defaults.

### chirality (vibetuned/chirality; AGPL-3.0)
* Declares Python >= 3.14, numpy >= 2.4, torch >= 2.10, but the modules we need
  (`chirality.hmm.pig`, `chirality.rules.weight_learning`) run unchanged on 3.11 / numpy 1.26.
  We train its path-difference perceptron (5 epochs, lr 0.01) on 031-150.
* Learn: Parncutt's 12 rules are all local to a 3-note window, so the *exact* optimum is a
  Viterbi over (previous finger, finger) states with precomputed (n, 5, 5, 12) and
  (n, 5, 5, 5, 12) feature tensors; this alone moves Parncutt from 62.9 (pydactyl's pruned
  k-best) to 65.4, and learned rule weights to 66.0 (thumb-passing weight 4.1, weak-finger and
  3-4 rules ~0.1).
  AGPL: ideas only. Its PPO agents (right hand only, 42-45% per its own table) were not run.

### Hand-thesia (V9011N/pygame-piano-animator; no license file)
* A falling-notes player whose fingering planner is a beam search over chord fingerings with a
  physical cost and "figure" templates (scales, arpeggios, octaves, thirds, trills), weights
  fitted by coordinate search on 031-150. Its loader re-orders notes (32% until the output is
  mapped back by (onset, pitch, channel), then 65.8). Fast (0.1 s/piece).
* Learn: explicit figure detection + standard fingerings as a soft prior is cheap and effective.

### lumikey/piano-fingering-model (no license file)
* PyTorch + ONNX + an npm package. The released checkpoints are trained on all PIG notes
  (contaminated, 74.1). `train_lumikey_pig.py` rebuilds training tokens with the repository's
  own `build_tokens` (teacher-forced finger state, GT finger hints in the lookahead that its
  `train.py` randomly masks) and calls its unmodified `train()`: 66.2 on the test split.
* Learn: a tiny Transformer over "where is each finger now + the next 20 notes" with
  optional finger hints in the lookahead supports *fill-in-the-blanks* (user-fixed fingers) for
  free and matches ArGNN. Same weights are inside JeffreyZhou798's A09 web app.

### APF-Gen (chrsztz/APF-Gen; no license file)
* CNN-BiLSTM with attention, AR finger embedding, a "physical" auxiliary head, 11-class signed
  output, beam search with physical transition costs. Only `best.pt` matches the released
  feature code (the 26 ablation checkpoints next to it are from an older feature version); `infer.py`
  hard-codes the config's device (`mps`). The released model is contaminated (random file
  split); `train_apfgen_official.py` retrains the default config on the official split
  (early stop at epoch 17): 58.4 (beam) / 59.1 (argmax). Lesson: its 82% "test" M_gen was
  leakage, and its beam decoder hurts.

### pydactyl (dvdrndlph/pydactyl; MIT)
* Randolph's toolkit with Parncutt, Jacobs, Badgerow, Balliauw (rules), Hart, Sayegh, random.
  Patches: Windows log path, a crash in the Balliauw rule set (`handed_finger_*`), python-magic
  stubbed. We build a 2-part music21 score from PIG; chords are arpeggiated low->high by
  pydactyl itself. The Parncutt family raises "No solution" when a leap exceeds every finger
  pair's MaxPrac (frequent in left-hand jumps) and Hart's table stops at 12 semitones, so the
  wrapper re-solves the hand in segments split at large leaps, only where the solver fails. Its CRF/Sayegh experiments depend on the author's local corpus database.
* Reuse (MIT): carefully transcribed rule sets with references (Parncutt MinPrac/MaxPrac tables,
  Jacobs's physical key distances, Badgerow, Balliauw). Combine with an exact Viterbi
  (chirality's insight) rather than pydactyl's k-best Dijkstra.

### OpenNote (carlosrmz009/OpenNote; PolyForm Noncommercial; Rust)
* Large Rust workspace (engine, 3-D hands, audio, OMR...). Official builds embed a learned
  n-gram prior (`models/helios-beta1.8.json`) that is not in the repository, and published
  models are sealed for official builds, so only the rules engine can be benchmarked. We wrote
  a 60-line driver crate against its `on-train`/`on-fingering` crates (OpenNote's own PIG reader
  and `eval::solve`), built with the GNU Rust toolchain (no MSVC linker). 64.2-64.5.
* Non-commercial license: no reuse.

### BShakhovsky/PianoFingering_CalcModule (no license file; C++)
* MSVC-only C++ (the `abstract` keyword, `136i16`, `= 0 {}` destructors, Boost); built with
  MinGW via a compat header, a Boost stand-in and three one-line patches. Trellis over all chord
  fingerings with vertical/horizontal cost rules: 62.6 at 0.02 s per piece -- a good
  cost/speed point for a hand-written rule system.

### Kanma/piano_fingering (MIT; = blakewest/performer)
* Runs unchanged. Viterbi over per-onset "layers" of chord fingerings with a pairwise cost
  table indexed by (note1, note2, finger1, finger2). 61.6 at 0.02 s/piece. Reuse (MIT): the
  layered chord Viterbi is a simple, correct baseline for polyphony.

### autofingering, ackyedy, CHOWMHALVIN (small HMMs)
* All three re-implement a first-order fingering HMM (autofingering: MIT, Nakamura-style key
  lattice; ackyedy: semitone intervals, also an interpolated 2nd-order; CHOWMHALVIN: key
  lattice + leap limits and chord/scale rules). All train in seconds on 031-150 and land at
  59.6-62.1, i.e. Nakamura's FHMM1. autofingering needed a pandas-2 patch. Takeaway: the 2-D key
  lattice (white-key steps + black/white) beats raw semitone intervals by ~2.5 points.

### pianoplayer (marcomusy/pianoplayer 3.0.2; MIT) and derivatives
* Bugs found: (1) its PIG reader never sets the key position `INote.x`, so every note is at
  x = 0 -- the output is all thumbs and the search runs for tens of minutes; (2) it treats any
  finger already present in a PIG file as a fixed anchor (ground truth leaks if you feed it a
  PIG file); (3) the PIG reader orders chord notes by note *name* and does not stagger them,
  unlike its MusicXML/MIDI readers; (4) `keypos_midi` (MIDI path) maps semitones with 7-key
  spacing, so positions are not monotonic across octave boundaries. Wrapper: x from
  `keypos` (its MusicXML formula) and chord stagger 0.05 s like the MusicXML path: 57.2 at
  19 s/piece (pure-Python exhaustive search). Upstream PIG path with only the x fix: 48.7.
* The MuseScore 4 plugin "Smart Piano Fingering" (GPL-3.0) is a JS port with chord/voice
  handling, held-note constraints and an exact DP: 58.8 at 0.08 s/piece, i.e. better and 200x
  faster than the original. Other derivatives (Piano Vision tools, OclefInc fork, Yannxinn's
  OMR skill) were not run separately.
* Reuse (MIT): the physical hand model (finger rest offsets in cm, hand-size presets,
  per-finger strength/black-key factors) is a reasonable interpretable prior, but its search
  objective (average finger velocity) is clearly weaker than learned costs.

### PianoFingering.jl (JuliaMusic; GPL-3.0; Gao et al. 2023, Applied Sciences)
* Portable Julia 1.10.5, PyCall bound to our venv (music21 is imported at load), depot inside
  the repo. Its PIG reader takes the hand from the finger *sign* (we pass +1/-1). Dyna-Q with
  10,000 episodes per segment, 12 threads: ~10-20 s per piece after JIT. Crashes on 022, 026,
  028, 030 (MDP states with no legal action). 58.4 on 26 pieces (FHMM3: 63.1 on those pieces).
  Per-piece RL is slow and not better than a DP over the same rules.

### ValHaLA (jpsmith8488/valhala-fingering-solver; MIT)
* 14-term "physical action" (kinetic, topographic, gravity, collision, coupling, key action,
  contact, adhesion, tempo, dissipation, rotation, stagger, tradition), first-order Viterbi,
  monophonic and isochronous (6 notes/s). Its two-hand solver runs the right-hand model on the
  bass line (31.5); mirroring the left hand (our change) gives 52.3. Interesting physics
  vocabulary, poor agreement with pianists.

### huukhang AutomaticPianoFingering (MIT)
* "Pianist-inspired" pipeline (phrase detection, Alberti/arpeggio pattern library, phrase-peak
  gravity, 3-D key geometry, auditor/repair). README claims 85.53% accuracy (own metric, first
  20 PIG files). On the PIG protocol the phrase pipeline gets 45.7 and the repo's *simple* DP
  59.9 -- the extra layers hurt.

### Balliauw, Herremans et al. 2017 VNS (Bitbucket, 2014; no license)
* The only code of the ITOR 2017 VNS paper (linked from dorienherremans.com). Builds with
  MinGW. Its MusicXML importer recomputes start times from voice durations and ignores ties, so
  we generate a compatible single-measure MusicXML; with an absolute time grid it allocates one
  "slice" per division and becomes very slow, so we use a rank time axis. The released code
  does not optimise: on its *own* bundled example (`piece2.xml`) the result repeats fingers on
  consecutive different notes (right-hand cost 60,877), and on PIG it plateaus after a ~7%
  cost reduction from its random start; rest slices also break its slice-adjacency rules. Below
  random (16.9 on 12 pieces) -- recorded as a failed reproduction (Nakamura et al. ran the
  authors' version on 14 pieces: 56.7).

### TimKoornstra/automatic-piano-fingering (GPL-3.0)
* Tabular Q-learning over (previous, current, next note) with a toy reward (distance to a
  finger slot in a rigid hand frame), right hand only. Trained per piece on itself; left hand
  mirrored by us: 46.8. Toy.

### EER (anandaphan/EER-piano-fingering; no license)
* Per-piece factored dueling DQN with Elite Episode Replay and Parncutt-style rewards
  (Mathematics 2025). Runs (gym 0.26.2), but ~28 s per episode on piece 002 means ~8 h per
  piece at the default 500 episodes x 2 hands, and only 5 test pieces are in its bundled
  first-finger table (the first chord of each hand is fixed from annotator 1's ground truth).
  Stopped after 32 episodes; not scored.

## Implementations found but not run

| Implementation | Why not run |
|---|---|
| Srivatsan & Berg-Kirkpatrick 2022, checklist models (ISMIR) | no code released (arXiv, Papers with Code, GitHub searches) |
| Moryossef, Elazar & Goldberg 2023, "At Your Fingertips" (video) | no model/data link; AmitMY's GitHub has only hand bounding boxes and dataset metadata |
| JeffreyZhou798/Piano-Fingering-Generator-A09 (+A03-A08), GPL-3.0 | TS/Next.js app = Dyna-Q port of PianoFingering.jl + lumikey's Transformer prior; its ONNX file is byte-identical to lumikey's (trained on all PIG), so PIG scores would be contaminated; both parts benchmarked above |
| monde-lointain/piano-fingering (C++20, ILS + beam search) | needs C++20 (defaulted `operator==`, `<filesystem>`, `<thread>`) + CMake FetchContent; only MinGW g++ 9.2 is available and Visual Studio has no VC toolset |
| dlegs/Optimal-Piano-Fingering-Algorithm (C, Hart DP) | prints only the optimal cost, never the fingering; intervals > 12 index out of bounds (Hart is run via pydactyl) |
| guwalgiya/Piano-Fingering-Generators (TF 2.0 BiLSTM) | experimental scripts with the pipeline commented out, hard-coded data paths, no weights |
| quadpixels/fingeringyonebayashiijcai07 (Yonebayashi 2007 HMM) | Python 2 course project, right hand only, trains on passages embedded in the code |
| PRamoneda/RL_PianoFingering (MIT) | five hard-coded toy Q-learning experiments, no general input |
| PRamoneda/APF_eval | pybind11 wrapper of Nakamura's evaluator (not a model) |
| PRamoneda difficulty repos (CIPI, Mikrokosmos, PianoVAM) | consume ArGNN fingering features / video fingering; the model is benchmarked |
| pudelos/piano-fingering-solver (MIT) | solver not implemented yet |
| blakewest/performer (JS) | same algorithm and table as Kanma/piano_fingering (benchmarked) |
| pianoplayer ports: tiefenb (Piano Vision JSON), OclefInc fork, Yannxinn OMR skill | represented by pianoplayer and the MuseScore plugin |
| notebook projects on PIG (sutkucanverdi, LunaticGhoulPiano, ilsotn, Anastasia1707, KeyGenius, chrsztz/xlpro-model, m4cy, OrigamiDream, to-osaki, Jerschow) | notebooks without a reusable inference entry point and/or their own unknown PIG splits; same model families as above |
| small right-hand/monophonic DPs and apps (amackenzie1, boramarasli, IrinaLee521, Traelx, serenado, mpg/pypiano-fingers, Kheops411, neewamp, Kobe972, kashizui (2012, Py2), Lteins, hanrodz (empty), akench & Blanel (Java), Optimal-Piano-MQP (MuseScore-bound Parncutt DP), ExxLiang193/MusicMark (RNN, GPL), ririanbo) | toy or GUI-bound; ideas covered by the Parncutt/Hart/Kanma/pianoplayer baselines |
| not fingering estimators (BACHprop hand separation, MusicXML2PIG, video/robot/hand-control repos, Piano Vision tooling, tutoring apps) | out of scope |

A MuseScore plugin search found no automatic piano-fingering plugin other than Smart Piano
Fingering (benchmarked) and pianoplayer integrations.

## Licenses and reuse in an MIT project

* **OK to reuse code (keep the notice)**: marcomusy/pianoplayer, PRamoneda/Automatic-Piano-
  Fingering (code and checkpoints), dvdrndlph/pydactyl, Kanma/piano_fingering,
  thegreatkwanghyeon/autofingering, huukhangapcs/AutomaticPianoFingering,
  jpsmith8488/valhala-fingering-solver (all MIT). The MuseScore plugin is GPL, but its
  algorithm descends from MIT pianoplayer.
* **Do not copy code** (ideas only, re-implemented from papers/first principles):
  no license = all rights reserved: Nakamura's C++ and JS, FingerFlow, lumikey, APF-Gen,
  Hand-thesia, BShakhovsky, ackyedy, CHOWMHALVIN, Balliauw VNS, EER;
  copyleft: chirality (AGPL-3.0), PianoFingering.jl, Smart Piano Fingering, TimKoornstra (GPL-3.0);
  non-commercial: OpenNote (PolyForm NC 1.0).
* **Data**: PIG is "nonprofit, academic use only"; every learned baseline here (and the
  Ramoneda MIT checkpoints) was trained on it. ThumbSet is "upon request". digitus2's shipped
  weight set uses neither.

## What digitus2 should take from this

1. **Reference points**: the best fair system is FingerFlow at 68.6 M_gen / 82.3 M_rec; humans
   are at 71.4 / 84.3 (Bach 62.4, Mozart 71.6, Chopin 80.1). The only configuration that gets near
   FingerFlow uses weights fitted on PIG, which cannot ship. On this test split digitus2's shipped set (`learned-open`,
   open data only) scores 63.89 M_gen, -1.12 [-3.93, +1.91] against FHMM3 and -4.74 [-6.84,
   -2.70] against FingerFlow-learned; the PIG-fitted research set scores 67.66, -0.97 [-2.73,
   +0.74] against FingerFlow-learned (`docs/experiments.md`). Report paired bootstrap CIs: with
   30 pieces anything within ~2 points of FHMM3 is noise.
2. **Architecture that works**: exact dynamic programming (Viterbi, second order or chord-aware
   events) over a *learned* linear cost on interpretable features. FingerFlow, chirality and
   Nakamura's HMMs all have this shape; exactness alone is worth ~2.5 points over pruned
   search, learning the weights ~4 points over hand tuning. Per-piece RL and local search are
   slower and worse.
3. **Features**: a 2-D key lattice (white-key steps + black/white) or physical key positions in
   cm beat semitone intervals; span limits relative to a hand profile; chord-internal
   ordering; tempo/IOI-dependent costs (speed, relocation); rests relax span constraints;
   explicit figures (scales, arpeggios) as priors.
4. **Neural models** reach the same band (66-67) with beam search; a small Transformer with
   lookahead and finger hints (lumikey) gives partial-annotation support for free; graph
   encoders (onset/next edges) handle polyphony. Pretraining on noisy crowd fingerings
   (ThumbSet) is the only external data any published system used.
5. **Evaluation hygiene**: split PIG by *piece* (never by file); give every system the same
   hands; never feed a file containing fingers to a system that treats them as anchors; check
   note alignment after any re-ordering reader (compare against the repository's own evaluator).
