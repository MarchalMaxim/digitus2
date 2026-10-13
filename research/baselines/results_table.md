| # | Implementation | Variant | Approach | License | Trained on | M_gen | M_high | M_soft | M_rec | Pieces | s/piece |
|---|---|---|---|---|---|---|---|---|---|---|---|
| - | *Human annotators (leave-one-out)* | | | | | *71.4* | *79.1* | *90.8* | *84.3* | 30/30 | |
| 1 | lumikey/piano-fingering-model | released checkpoints **(contaminated)** | neural | none (all rights reserved) | all 309 PIG files incl. the test pieces | 74.1 | 81.9 | 95.0 | 88.8 | 30/30 | 0.17 |
| 2 | chrsztz/APF-Gen | released best.pt, argmax **(contaminated)** | neural | none (all rights reserved) | random 70% of PIG files incl. most test pieces | 70.5 | 77.0 | 91.8 | 80.7 | 30/30 | 0.12 |
| 3 | chrsztz/APF-Gen | released best.pt, beam **(contaminated)** | neural | none (all rights reserved) | random 70% of PIG files incl. most test pieces | 68.8 | 74.9 | 90.1 | 78.3 | 30/30 | 0.17 |
| 4 | MarcAlKareh/fingerflow (FingerFlow engine) | learned weights (031-150) | learned cost (structured prediction) | none (all rights reserved) | PIG 031-150 (trained by our wrapper; repository default hyper-parameters) | 68.6 | 76.3 | 90.3 | 82.3 | 30/30 | 1.24 |
| 5 | Ramoneda et al. 2022 ArGNN / ArLSTM (ACM MM) | ArGNN, beam 10 | neural | MIT | ThumbSet + PIG official train split (031-150 minus their val) | 66.7 | 73.5 | 88.3 | 79.3 | 30/30 | 0.51 |
| 6 | lumikey/piano-fingering-model | retrained on PIG train split | neural | none (all rights reserved) | PIG 031-150 (retrained here) | 66.2 | 72.6 | 87.9 | 79.3 | 30/30 | 0.23 |
| 7 | vibetuned/chirality | Parncutt rules, learned weights | learned cost (structured prediction) | AGPL-3.0-or-later | PIG 031-150 (learned variant, trained by our wrapper with its own perceptron) | 66.0 | 72.1 | 87.2 | 79.5 | 30/30 | 0.11 |
| 8 | V9011N/pygame-piano-animator (Hand-thesia) fingering planner | handthesia_planner | learned cost (search) | none (all rights reserved) | PIG 031-150 (weights shipped) | 65.8 | 73.1 | 87.5 | 79.1 | 30/30 | 0.12 |
| 9 | vibetuned/chirality | Parncutt rules, uniform weights | learned cost (structured prediction) | AGPL-3.0-or-later | none (uniform rule weights) | 65.4 | 72.2 | 86.7 | 78.8 | 30/30 | 0.11 |
| 10 | Ramoneda et al. 2022 ArGNN / ArLSTM (ACM MM) | ArLSTM, beam 10 | neural | MIT | ThumbSet + PIG official train split (031-150 minus their val) | 65.1 | 72.4 | 86.9 | 78.8 | 30/30 | 0.58 |
| 11 | Nakamura, Saito & Yoshii 2020 fingering HMMs (C++) | FHMM3 (3rd-order) | statistical | none stated (all rights reserved) | PIG miscellaneous set 031-150 (shipped params) | 65.0 | 71.6 | 86.3 | 78.6 | 30/30 | 0.06 |
| 12 | Nakamura, Saito & Yoshii 2020 fingering HMMs (C++) | FHMM2 (2nd-order) | statistical | none stated (all rights reserved) | PIG miscellaneous set 031-150 (shipped params) | 64.9 | 71.5 | 86.1 | 78.2 | 30/30 | 0.05 |
| 13 | Ramoneda et al. 2022 ArGNN / ArLSTM (ACM MM) | ArGNN, greedy | neural | MIT | ThumbSet + PIG official train split (031-150 minus their val) | 64.7 | 70.7 | 86.7 | 76.7 | 30/30 | 0.16 |
| 14 | carlosrmz009/OpenNote (Rust) | rules: Jacobs | rule/cost | PolyForm-Noncommercial-1.0.0 | none (rules only; the learned prior is not distributed) | 64.5 | 71.8 | 85.9 | 77.6 | 30/30 | 0.35 |
| 15 | Nakamura, Saito & Yoshii 2020 fingering HMMs (C++) | FHMM3, authors' released outputs (PIG v1.0 hands) | statistical | none stated (all rights reserved) | PIG miscellaneous set 031-150 (shipped params) | 64.5 | 71.0 | 85.5 | 77.8 | 30/30 |  |
| 16 | carlosrmz009/OpenNote (Rust) | rules: Parncutt | rule/cost | PolyForm-Noncommercial-1.0.0 | none (rules only; the learned prior is not distributed) | 64.4 | 72.2 | 86.0 | 77.7 | 30/30 | 0.35 |
| 17 | MarcAlKareh/fingerflow (FingerFlow engine) | hand-tuned weights | learned cost (structured prediction) | none (all rights reserved) | none (hand-tuned) | 64.3 | 71.4 | 85.8 | 77.9 | 30/30 | 1.16 |
| 18 | Nakamura, Saito & Yoshii 2020 fingering HMMs (C++) | FHMM2, authors' released outputs (PIG v1.0 hands) | statistical | none stated (all rights reserved) | PIG miscellaneous set 031-150 (shipped params) | 64.3 | 70.8 | 85.3 | 77.6 | 30/30 |  |
| 19 | Ramoneda et al. 2022 ArGNN / ArLSTM (ACM MM) | ArLSTM, greedy | neural | MIT | ThumbSet + PIG official train split (031-150 minus their val) | 64.2 | 71.2 | 86.4 | 77.7 | 30/30 | 0.21 |
| 20 | carlosrmz009/OpenNote (Rust) | rules: consensus | rule/cost | PolyForm-Noncommercial-1.0.0 | none (rules only; the learned prior is not distributed) | 64.2 | 71.7 | 85.6 | 77.3 | 30/30 | 0.41 |
| 21 | dvdrndlph/pydactyl (Randolph) | Jacobs 2001 | rule/cost | MIT | none | 63.6 | 70.5 | 84.9 | 77.0 | 30/30 | 1.16 |
| 22 | dvdrndlph/pydactyl (Randolph) | Parncutt 1997 | rule/cost | MIT | none | 62.9 | 69.7 | 84.5 | 76.8 | 30/30 | 1.15 |
| 23 | BShakhovsky/PianoFingering_CalcModule (of PianoTranscription_Windows) | bshakhovsky_trellis | rule/cost | none (all rights reserved) | none | 62.6 | 69.3 | 83.4 | 75.7 | 30/30 | 0.02 |
| 24 | Nakamura, Saito & Yoshii 2020 fingering HMMs (C++) | FHMM1 (1st-order) | statistical | none stated (all rights reserved) | PIG miscellaneous set 031-150 (shipped params) | 62.3 | 69.0 | 83.7 | 74.9 | 30/30 | 0.04 |
| 25 | Nakamura web demo FHMM1 (JavaScript) | web demo FHMM1 (JS) | statistical | none stated | PIG (embedded parameters, presumably 031-150) | 62.2 | 69.0 | 83.6 | 74.9 | 30/30 | 0.06 |
| 26 | thegreatkwanghyeon/autofingering | autofingering_hmm | statistical | MIT | PIG 031-150 (trained by our wrapper) | 62.1 | 68.8 | 83.2 | 74.4 | 30/30 | 0.01 |
| 27 | CHOWMHALVIN/Piano-Fingering-Suggestion-Model-with-Intuitive-UI | chowmhalvin_hmm | statistical | none (all rights reserved) | PIG 031-150 (trained by our wrapper; repo uses a random 80/20 piece split) | 62.1 | 68.8 | 83.3 | 74.5 | 30/30 | 0.04 |
| 28 | Nakamura, Saito & Yoshii 2020 fingering HMMs (C++) | CHMM (chord HMM) | statistical | none stated (all rights reserved) | PIG miscellaneous set 031-150 (shipped params) | 62.0 | 68.7 | 82.6 | 74.7 | 30/30 | 0.05 |
| 29 | dvdrndlph/pydactyl (Randolph) | Balliauw 2017 rules | rule/cost | MIT | none | 61.7 | 68.3 | 83.4 | 74.3 | 30/30 | 1.10 |
| 30 | Nakamura, Saito & Yoshii 2020 fingering HMMs (C++) | FHMM1, authors' released outputs (PIG v1.0 hands) | statistical | none stated (all rights reserved) | PIG miscellaneous set 031-150 (shipped params) | 61.6 | 68.3 | 82.8 | 74.0 | 30/30 |  |
| 31 | Kanma/piano_fingering (PyPI piano_fingering 1.0.0; port of blakewest/performer) | kanma_piano_fingering | rule/cost | MIT | none | 61.6 | 68.2 | 83.3 | 74.8 | 30/30 | 0.02 |
| 32 | dvdrndlph/pydactyl (Randolph) | Badgerow 2009 | rule/cost | MIT | none | 61.4 | 68.6 | 82.8 | 74.8 | 30/30 | 1.00 |
| 33 | huukhangapcs/AutomaticPianoFingering | simple DP | rule/cost | MIT | none | 59.9 | 65.5 | 80.3 | 70.6 | 30/30 | 0.02 |
| 34 | ackyedy/piano-fingering-analysis | H2 interval HMM | statistical | none (all rights reserved) | PIG 031-150 (trained by our wrapper) | 59.8 | 66.6 | 80.8 | 73.1 | 30/30 | 0.00 |
| 35 | ackyedy/piano-fingering-analysis | H1 interval HMM | statistical | none (all rights reserved) | PIG 031-150 (trained by our wrapper) | 59.6 | 66.1 | 80.7 | 72.6 | 30/30 | 0.00 |
| 36 | chrsztz/APF-Gen | retrained on official split, argmax | neural | none (all rights reserved) | PIG 031-150 (retrained here) | 59.1 | 64.8 | 81.1 | 69.2 | 30/30 | 0.11 |
| 37 | emanuelemerlo/smart-piano-fingering (MuseScore 4 plugin) | smart_piano_fingering_musescore | rule/cost | GPL-3.0 | none | 58.8 | 66.4 | 80.1 | 71.4 | 30/30 | 0.08 |
| 38 | JuliaMusic/PianoFingering.jl (Gao et al. 2023, Applied Sciences) | pianofingering_jl | RL (per piece) | GPL-3.0 | none (per-piece optimisation) | 58.4 | 65.6 | 80.5 | 72.3 | 26/30 | 16 |
| 39 | chrsztz/APF-Gen | retrained on official split, beam | neural | none (all rights reserved) | PIG 031-150 (retrained here) | 58.4 | 64.1 | 80.1 | 67.7 | 30/30 | 0.17 |
| 40 | marcomusy/pianoplayer 3.0.2 | MusicXML-path emulation (x fix + chord stagger) | rule/cost | MIT | none | 57.2 | 64.2 | 78.2 | 69.3 | 30/30 | 19 |
| 41 | jpsmith8488/valhala-fingering-solver (ValHaLA) | LH mirrored (our change) | rule/cost | MIT | none | 52.3 | 58.6 | 71.4 | 63.3 | 30/30 | 0.07 |
| 42 | marcomusy/pianoplayer 3.0.2 | upstream PIG reader (+ x fix) | rule/cost | MIT | none | 48.7 | 55.5 | 68.9 | 60.1 | 30/30 | 14 |
| 43 | dvdrndlph/pydactyl (Randolph) | Hart 2000 | rule/cost | MIT | none | 47.2 | 52.2 | 65.6 | 56.8 | 30/30 | 0.36 |
| 44 | TimKoornstra/automatic-piano-fingering | timkoornstra_qlearning | RL (per piece) | GPL-3.0 | none (trained per piece on itself) | 46.8 | 52.0 | 63.5 | 54.2 | 30/30 | 2.55 |
| 45 | huukhangapcs/AutomaticPianoFingering | phrase-aware pipeline | rule/cost | MIT | none | 45.7 | 51.4 | 64.3 | 55.2 | 30/30 | 0.19 |
| 46 | jpsmith8488/valhala-fingering-solver (ValHaLA) | as shipped (LH = RH model) | rule/cost | MIT | none | 31.5 | 36.3 | 47.4 | 40.1 | 30/30 | 0.07 |
| 47 | ackyedy/piano-fingering-analysis | B1 direction rule | statistical | none (all rights reserved) | none | 27.8 | 31.7 | 41.9 | 34.5 | 30/30 | 0.00 |
| 48 | ackyedy/piano-fingering-analysis | B0 most frequent finger | statistical | none (all rights reserved) | PIG 031-150 (trained by our wrapper) | 27.6 | 30.2 | 37.1 | 30.9 | 30/30 | 0.00 |
| 49 | dvdrndlph/pydactyl (Randolph) | random | rule/cost | MIT | none | 20.2 | 22.6 | 33.3 | 24.2 | 30/30 | 0.15 |
| 50 | Balliauw, Herremans et al. 2017 VNS (C++) | balliauw_vns | search | none (all rights reserved) | none | 16.9 | 19.2 | 29.6 | 21.2 | 12/30 | 294 |
