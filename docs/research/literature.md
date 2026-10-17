# Automatic Piano Fingering: A Literature Survey for digitus2 (1997–2026)

*Scope.* This document surveys research on automatic piano fingering from Parncutt et al. (1997) to October 2026. It is written so that an engineer can implement the most useful approaches in TypeScript, in the browser and without a server, from this document alone. Every factual claim carries a bracketed reference number that resolves to a URL in [§9 References](#9-references). Where a number could not be verified against a primary source it is marked **(unverified)**, and where sources disagree both versions are given.

*Sources.* The primary PDFs were read in full for: Parncutt et al. 1997 [1], Nakamura, Saito & Yoshii 2020 [9], Nakamura, Ono & Sagayama 2014 [8], Yonebayashi et al. 2007 [5], Al Kasimi et al. 2007 [6], Balliauw et al. 2017 [13], Moryossef et al. [14], Ramoneda et al. 2022 [15], Srivatsan & Berg-Kirkpatrick 2022 [16], Guan, Yan & Hsu 2021 [17], Zhao, Guan & Li [18], Ramoneda et al. 2021 [19], Ramoneda et al. ICASSP 2022 [20], and Randolph, Di Eugenio & Badgerow 2023 [24]. Jacobs 2001 [2] and Hart et al. 2000 [3] are paywalled. They are described from their abstracts and from independent open-source re-implementations ([26], [42]), and the text says so where this applies.

The engine in `packages/engine` follows §6. Where the build departs from the recommendation, or where a proposal is now implemented, a status note says so (§0, §4.3, §4.4, §5, §6, §7).

---

## 0. Executive summary

**Benchmark.** The de-facto benchmark is the PIG dataset (150 excerpts, 309 fingerings, Nakamura et al. 2020 [9], [10]). Its standard protocol trains on the 120-piece "miscellaneous" subset and tests on 30 multi-annotated pieces by Bach, Mozart and Chopin. On that test set humans reach **M_gen 71.4 / M_high 79.1 / M_soft 90.8 / M_rec 84.3** when each annotator is compared with the others [9].

**Leaderboard, comparable rows only** (PIG standard test set; full table with caveats in §3):

| System | M_gen | M_high | M_soft | M_rec | Source |
|---|---|---|---|---|---|
| ArGNN (ThumbSet pre-train, PIG fine-tune) | **66.84** | **72.62** | **86.83** | **78.55** | [15] |
| BiLSTM, pre-trained on YouTube-derived APFD, then PIG | 66.8 | – | – | – | [14] |
| ArLSTM (ThumbSet pre-train) | 65.34 | 71.73 | 85.49 | 77.80 | [15] |
| Parncutt rules with learned weights, exact Viterbi (open-source, not peer-reviewed) | 65.4 | 71.5 | 86.3 | 78.7 | [42] (unverified) |
| Linear-chain CRF (note-weighted average) | 65.01 | 68.69 | 84.95 | – | [24] |
| 3rd-order HMM | 64.5 | 71.0 | 85.5 | 77.8 | [9] |
| 2nd-order HMM | 64.3 | 70.8 | 85.3 | 77.6 | [9] |
| 1st-order HMM | 61.7 | 68.3 | 82.8 | 74.0 | [9] |
| VNS (Balliauw et al.), only 14 of the 30 pieces | 56.7 | 62.4 | 78.2 | 67.5 | [9] |

The spread between a 2007-style first-order HMM and the best 2022 neural model is only about 5 points of M_gen. All methods sit 4.5 to 10 points below the human ceiling.

**Recommendation** (details in §6):
1. **First:** a deterministic, interpretable **cost-based Viterbi engine** in TypeScript. It uses Parncutt's 12 rules [1], Jacobs' refinements [2], and Balliauw's chord rules [13], decoded with an *exact* second-order dynamic program over each hand's note sequence, with a chord-slice trellis for dense polyphony. Hand-size presets cover small and beginner hands. It needs no training data, so it carries no licensing risk. It also powers the "fingering lint" and the explanations shown to students.
2. **Second:** **learn the weights** of the same feature set, extended with Nakamura-style HMM transition and lattice-interval log-probabilities and timing features. Train with a structured perceptron or CRF in Python, export to JSON, and reuse the exact same TypeScript Viterbi. Published evidence puts such models at or just above HMM3 (64.5 to 65.4 M_gen) [9], [24], [42]. The model files are a few kilobytes for rule weights and about 100 KB with HMM tables.
3. **Optional third:** a small neural re-ranker (ArGNN-like [15]; by our estimate about 10^5 parameters; pure PyTorch, exportable to ONNX Runtime Web). Use it on the Viterbi N-best list and as an uncertainty signal. Expect about +0.5 to +2 M_gen (our estimate), at the cost of a dependency on non-commercially licensed training data.
4. **For MIDI import:** decode hand separation first with a cheap DP or Kalman filter (about 91 to 93% note-level accuracy reported [8], [40]), then decode fingering per hand.

**Status.** Items 1, 2 and 4 are built (§6.10), with one difference: the learned weights are linear weights over the rule terms and indicator features, with no HMM tables. Item 3, the neural re-ranker, is not built.

**Surprises and caveats:**
- **Licensing.** PIG may be used only for non-profit academic purposes [10]. ThumbSet is access-restricted [15]. Models trained on them carry these terms (the `chirality` project explicitly propagates them [42]). Decision: the shipped weights are trained on open data only, and PIG-fitted weights stay research-only (§6.9).
- **Re-runs disagree with the published HMM numbers.** Re-running Nakamura's HMMs with a proper validation split lowers HMM3 from 64.5 to 63.63 M_gen and makes HMM2 the best HMM [15]. Nakamura's weight coefficients were tuned for estimation accuracy without a separate validation set [9]. Treat third-decimal differences as noise.
- **The human "ceiling" has been re-measured inconsistently.** The right-hand-only human M_gen is 70.2 in [15] but 67.6 in [42]. The row in [15] is identical, digit for digit, to Nakamura's human row for a different 14-piece subset [9]. Implement the metrics yourself and test them.
- **An exact Viterbi over Parncutt's 1997 rules, with equal weights, reportedly reaches 64.9 M_gen**, about equal to HMM3, whereas earlier rule solvers reached about 59 [42] (single developer). A re-run in this repository confirms it: 65.4 with uniform weights and 66.0 with weights learned here, against 65.0 for HMM3 on the same split (`docs/research/baselines.md`). The main weakness of rule-based systems was the solver (fragment enumeration, VNS, local search), not the rules.
- **No peer-reviewed transformer, diffusion or LLM model reports PIG results** as of October 2026. Recent activity is in video and motion-capture datasets (PianoVAM, FürElise, SKY-Piano, PianoMotion10M), robot piano playing (RoboPianist, RP1M), and fingering-based difficulty estimation [30]–[39].
- **Match rate is a weak proxy for quality.** Two models with nearly equal M_gen can differ drastically in physically awkward patterns ("hops", "smears", crossings) [16]. Use the lint and metamorphic tests in §5.

---

## 1. Problem definition and evaluation

### 1.1 Formal statement

**Input.** A piece is a sequence of notes $n = 1..N$, each with onset $t^{on}_n$, offset $t^{off}_n$, pitch $p_n$ (MIDI number, or spelled pitch), and usually a hand label $h_n \in \{L, R\}$. Notes are ordered by onset, with ties broken by ascending pitch [24], [9].

**Output.** A finger $f_n \in \{1,..,5\}$ per note (1 = thumb, 5 = little finger). PIG writes left-hand fingers as negative numbers, $-1..-5$ [9]. A **finger substitution**, a silent change of finger on a held key, is written as a pair, e.g. `1_2` [9]. Substitutions are rare: 0.34% of PIG notes. Nakamura et al. use only the first (striking) finger for analysis and modelling [9], and independent PIG parsers do the same [42].

**Constraints.** The following are almost universal; individual papers treat some as soft:
- one finger per key at a time;
- at most five simultaneous notes per hand;
- no finger crossing inside a chord (pitch order equals finger order: ascending for RH, descending for LH) [6], [9], [13];
- spans within anatomical limits [1];
- a finger holding a sustained note cannot strike another key unless a substitution is notated [6], [9].

**Hands.** Most methods assume hand assignment is given: staff for scores, channel for PIG [9], [24]. Methods that also infer hands for MIDI input are Nakamura et al. 2014 [8], Hadjakos et al. [41], and Penner & Hindle 2026 [40].

**Decision problem.** Rule-based systems minimise a cost $C(f_{1:N}; p_{1:N})$. Statistical systems maximise $P(f_{1:N} \mid p_{1:N})$, or equivalently $P(f, p)$ [5], [9]. Neural autoregressive systems maximise $\prod_n P(f_n \mid f_{<n}, x)$ with beam search [15], [16]. In all cases the decoder should be global (Viterbi, DP or beam), because local per-note classification produces incoherent sequences [9], [15], [16].

### 1.2 Keyboard geometry

Semitone intervals do not reflect key geometry: C–E and D–F♯ are both major thirds, but they differ physically and in black/white pattern [1], [2]. Three representations recur:

1. **Semitones**, with separate black/white indicators as extra features [1], [17].
2. **A two-dimensional "keyboard lattice"** (Nakamura [8], [9]). Each key maps to $(x, y)$, with $y = 1$ for black keys and $y = 0$ for white keys. Output distributions depend only on $(\Delta x, \Delta y)$, with $\Delta y \in \{-1, 0, 1\}$ and $\Delta x$ clipped at a cutoff (15 in the paper) [9]. Two published descriptions of the x axis differ:
   - **White-key columns** (7 per octave), with each black key sharing the column of the white key below it. This is the mapping used by an open re-implementation that reports bit-exact agreement with Nakamura's reference binary on all 10,225 test notes [42]. It also matches Srivatsan's description of the lattice, which counts white keys horizontally and adds a black/white step vertically [16].
   - **Half-white-key units** (14 per octave). Randolph et al. describe the lattice this way [24].

   Use white-key columns if you need to reproduce Nakamura's released parameters, and verify against the released result files [11].
3. **Balliauw's 14-unit metric.** Adding "imaginary" black keys between E–F and B–C gives 14 key units per octave: units mod 2 give the key colour, and units mod 14 give the pitch class [13]. This is the same geometry as half-white-key units, and it is what Balliauw's span tables (§2.10) are written in.

**Physical size.** An octave spans about 165 mm, or about 13.7 mm per semitone on average [1]. Jacobs proposed measuring all spans as physical distances [2]; see §2.3.

### 1.3 The PIG dataset

The PIG dataset is described in Nakamura, Saito & Yoshii, *Information Sciences* 517:68–85 (2020) [9], and published at [10].

- **Content:** 150 excerpts by 24 composers (3,180 bars, 48,726 notes). They carry 309 fingerings by experienced pianists (100,044 fingered notes). A typical excerpt is about one page, about 20 bars or about 300 notes [9].
- **Subsets:**
  - Bach: 10 pieces × 4 pianists, 3,657 notes per fingering set.
  - Mozart: 10 × 6, 2,546 notes.
  - Chopin: 10 × 5, 4,022 notes.
  - Miscellaneous: 120 pieces, 159 fingerings, by 1 or 2 pianists.

  The three composer subsets total 10,225 notes [9], [42]. Pianists fingered pieces they could play, giving the fingering they actually used [9].
- **File format:** one line per note, in onset order: `id  onset_s  offset_s  pitch  onset_vel  offset_vel  channel(0=RH,1=LH)  finger` [9]. In the released files the pitch is a spelled name (e.g. `C#4`), and substitutions appear as `a_b` [42]. Timings are generated from the score, not from a human performance: chord notes have identical onsets [24].
- **Standard split:** train on the miscellaneous subset (120 pieces); test on the 30 composer-subset pieces. Nakamura et al. used the upper and lower staves as RH and LH at test time [9]. Ramoneda et al. added an "official" validation split: the 30 training pieces fingered by annotator "NE" were moved to validation. They also removed 20 test-set items annotated by the same annotator, to limit bias between validation and test. The text is ambiguous whether whole pieces or only that annotator's fingerings were dropped [15]. Moryossef et al. moved one training piece to development [14]. Srivatsan & Berg-Kirkpatrick used different, larger train/validation splits derived from Moryossef et al. [16]. Penner & Hindle used 100 random 130/10 splits [40]. Guan, Yan & Hsu held out one composer subset at a time [17].
- **Version and licence:** v1.12 (2022-05-12) corrected fingering errors in 029-5, 032-2 and 032-3, found by D. Randolph. Terms: *"Only nonprofit, academic use is allowed."* Download requires registration [10].
- **Code:** Nakamura's C++ code for HMM1/2/3, the chord HMM, training and the metrics is at [11]. It is `SourceCode_v190921.zip` and no licence is stated on the page. Ramoneda et al. describe the code and models as available for noncommercial activities [20]. A browser-based `FingeringVisualizer.html` is provided [10], [11].

**Known issues.** Different annotators can assign the same note to different hands, but only one channel assignment is given to the model at test time. Randolph et al. argue that match rates are fully valid only when hand assignment is uncontroversial [24].

### 1.4 The four PIG metrics (exact definitions)

Let a test piece have $N$ notes, an estimate $\hat f_{1:N}$, and $G$ ground truths $f^{(1)}, \dots, f^{(G)}$. All four metrics compare first fingers only. They are computed per piece and **averaged over the 30 pieces, unweighted** [9]. Randolph et al. point out that whether to weight the average by note count is a choice, and report both [24].

1. **General match rate.** $M_{gen} = \frac{1}{G}\sum_{g=1}^{G} \frac{1}{N}\sum_n [\hat f_n = f^{(g)}_n]$, the average single-reference accuracy [9].
2. **Highest match rate.** $M_{high} = \max_g \frac{1}{N}\sum_n [\hat f_n = f^{(g)}_n]$, accuracy against the closest ground truth [9].
3. **Soft match rate.** $M_{soft} = \frac{1}{N}\sum_n [\exists g: \hat f_n = f^{(g)}_n]$: a note counts as correct if any annotator used that finger [9].
4. **Recombination match rate** [9, App. A]. Build a recombined ground truth $f^{rec}_n = f^{(z_n)}_n$, where $z_n \in \{1..G\}$ selects the reference annotator at each note. Minimise the edit cost
$$E_{rec}(z_{1:N}) = \sum_{n=2}^{N} C(z_{n-1}, z_n) + \sum_{n=1}^{N} C_{sub}\,[f^{(z_n)}_n \ne \hat f_n],$$
with
$$C(z',z)=\begin{cases}0 & z=z'\\ C_{rec} & z\ne z' \text{ and the two ground truths agree at the switch point}\\ C'_{rec} & \text{otherwise.}\end{cases}$$
The settings are $C_{sub} = C_{rec} = 1$ and $C'_{rec} = \infty$: switching between annotators is allowed only where their fingers coincide. Then $M_{rec} = (N - \min_z E_{rec}) / N$, computed with Viterbi over $z$ [9]. The extracted equation does not show exactly which note index defines "agree at the switch point" (note $n-1$ or note $n$). Use the reference C++ evaluator [11] as ground truth for the implementation. Ramoneda et al. wrap it from Python and note small floating-point differences [15].

```ts
// M_rec reference implementation (Viterbi over which annotator is "active")
function mRec(est: number[], gts: number[][], cRec = 1, cSub = 1): number {
  const N = est.length, G = gts.length;
  let D = gts.map(gt => (gt[0] === est[0] ? 0 : cSub));
  for (let n = 1; n < N; n++) {
    const next = new Array(G).fill(Infinity);
    for (let z = 0; z < G; z++) for (let zp = 0; zp < G; zp++) {
      let trans = 0;
      if (z !== zp) {
        // switch allowed only where the two ground truths agree (check index convention vs reference code)
        trans = gts[z][n - 1] === gts[zp][n - 1] ? cRec : Infinity;
      }
      next[z] = Math.min(next[z], D[zp] + trans);
    }
    for (let z = 0; z < G; z++) next[z] += gts[z][n] === est[n] ? 0 : cSub;
    D = next;
  }
  return (N - Math.min(...D)) / N;
}
```

### 1.5 The human agreement ceiling

- **Pairs of pianists.** On average 60–80% of notes receive the same finger. Agreement decays slowly, roughly as a power function, as more players are compared [9].
- **By composer.** Bach shows the lowest agreement and the largest variety of fingers; Chopin the highest, attributed to large chords constraining the choice [9].
- **Most notes have only one or two plausible fingers.** In the Bach set, 4 players gave a single finger choice for 39.3% of notes and two choices for 49.4% [9].
- **The reference human row** (each player compared with all *other* annotators, 30 test pieces): **M_gen 71.4, M_high 79.1, M_soft 90.8, M_rec 84.3** [9]. On the 14-piece subset that VNS could process it is 70.2 / 78.9 / 91.0 / 84.5 [9].
- **Re-measurements:**
  - Ramoneda et al. report RH 70.2 / 78.9 / 91.0 / 84.5 and LH 73.1 / 79.3 / 90.5 / 84.0, with the same combined row as Nakamura [15]. The RH row equals Nakamura's 14-piece row digit for digit, which suggests a transcription error.
  - The `chirality` project re-measures the combined row as 71.4 / 79.1 / 90.8 / 84.3 (leave-one-out) and a right-hand-only M_gen ceiling of 67.6 [42] (unverified).
  - The CRF paper repeats 71.4 as the plateau [24]. Srivatsan & Berg-Kirkpatrick note that M_gen saturates near this ceiling, while 4-gram precision has more headroom [16].
- **Bias caveat.** Each human is scored against $G-1$ references, while models are scored against all $G$. For M_high and M_soft, which improve with more references, the human row is therefore biased *low* relative to models. M_gen is approximately unbiased. *(This is an inference from the definitions, not a claim made in the cited papers.)*

### 1.6 Other evaluation practices

| Practice | What it measures | Source |
|---|---|---|
| Rank of pianists' fingerings among the model's lowest-cost candidates | Whether rule costs order fingerings plausibly (7 Czerny fragments, 28 pianists) | Parncutt et al. 1997 [1] |
| Validation split, plus **change-position rate (CPR)**: the number of hand-position changes (crossings and shifts), normalised by the expert average (1.0 = human) | Effort and sequential coherence. Non-autoregressive DNNs inflate CPR (e.g. FF 1.19 vs ArGNN 1.01) | Ramoneda et al. 2022 [15]; framework at [68] |
| **Fluency statistics:** thumb crosses, thumbless crosses, crossed chords, "hops" (same finger on consecutive different notes), "smears" (one finger for several chord notes), step/chord spread (semitones per finger), anchored **4-gram precision** (four consecutive notes all correct against one annotator) | Playability that per-note precision misses | Srivatsan & Berg-Kirkpatrick 2022 [16] |
| Human expert ratings, 1–3 scale: physical comfort, mechanical efficiency, ease of learning | Perceived quality. One pianist, 10 validation songs: Bi-LSTM 1.6 / 1.4 / 1.6 vs checklist 2.8 / 2.5 / 2.9 | [16] |
| **Incapable-performing fingering rate (IFR)** | Share of transitions that violate hand-and-direction-dependent "impossible transition" rules | Zhao, Guan & Li [18] |
| Proper / non-ideal / erroneous transition rates from rule tables keyed by interval and black/white category | Playability (RH only) | Guan, Yan & Hsu 2021 [17] |
| **Expected reciprocal rank (ERR)**, adapted from web search | Fingering advice framed as a ranked recommendation list | Randolph, Di Eugenio & Badgerow 2021 [23] |
| Video-derived labels scored by precision, recall and F1 against manual labels (F1 0.97 at no confidence threshold) | Quality of automatically extracted ground truth | Moryossef et al. [14] |
| Joint hand-plus-finger accuracy using M_rec, plus pipeline recall (correct pitch within 250 ms and correct hand/finger) | End-to-end transcription with fingering | Penner & Hindle 2026 [40] |
| Precision of semi-automatic video fingering against manual labels (95.6% on the first 150 notes of 10 pieces) | Dataset label quality | PianoVAM [35] |

---

## 2. Method survey (chronological)

### 2.0 Overview

| Year | Method | Family | Polyphony | Both hands | Substitution | Trained on | Best reported (PIG M_gen unless noted) | Code / licence | Browser |
|---|---|---|---|---|---|---|---|---|---|
| 1997 | Parncutt et al. [1] | 12 ergonomic rules + enumeration / shortest path | no | LH by mirroring | no | none (hand-set) | Czerny fragments only; 59.1 with a generic Dijkstra solver, 64.9 with exact Viterbi [42] (unverified) | none; re-impl. [26] MIT, [42] AGPL | trivial |
| 2000 | Hart, Bosch & Tsai [3] | cost table + DP | no | mirror | no | none | – | re-impl. [26] MIT | trivial |
| 2001 | Jacobs [2] | refined rules (physical distance) | no | mirror | no | none | 59.5 (Dijkstra) [42] (unverified) | re-impl. [26], [42] | trivial |
| 2006 | Lin & Liu [4] | rule-based expert system + graph pruning | ? | ? | no | none | – | none | – |
| 2007 | Yonebayashi et al. [5] | HMM, hand-set 2-D Gaussian outputs | proposed | proposed | no | none (manual tuning) | qualitative only | none | trivial |
| 2007 | Al Kasimi et al. [6] | chord trellis, vertical + horizontal costs, Viterbi | **yes** | per hand | no | user-specified | 50.9 [42] (unverified); chord-HMM variant 61.2 [9] | none | trivial |
| 2014 | Nakamura, Ono & Sagayama [8] | merged-output HMM | yes (arpeggiated) | **yes, incl. hand separation** | no | own data | 56.0% RH / 55.4% LH (own data) | none public | trivial |
| 2015/17 | Balliauw et al. [12], [13] | 15 rules + tabu / VNS metaheuristic | **yes** | per hand | no | none (expert-tuned) | 56.7 (14-piece subset) [9] | C++ on Bitbucket, no licence stated | feasible, slow |
| 2020 | Nakamura, Saito & Yoshii [9] | HMM orders 1–3, chord HMM, DNN baselines | yes (arpeggiated + chord constraint) | per hand | no | PIG | **64.5** (HMM3) | C++, no licence stated [11] | trivial (KB of parameters) |
| 2019/23 | Moryossef et al. [14] | BiLSTM tagger, pre-trained on video-derived data | arpeggiated | per hand | no | APFD (155k notes) + PIG | 66.8 | hand dataset only | easy (ONNX) |
| 2021 | Guan, Yan & Hsu [17] | BiLSTM over interval/colour features | chords removed | RH only | no | PIG | per-composer only | – | easy |
| 2021/22 | Zhao, Guan & Li [18] | pitch-difference BiLSTM + hard transition constraints | yes | yes | no | PIG + rule-generated augmentation | ≈ HMM3 + 3 points (figure only) | none | easy |
| 2021 | Ramoneda et al. [19] | DQN reinforcement learning per score | no | RH | no | none | qualitative | GitHub | slow |
| 2022 | Ramoneda et al. [15] | autoregressive LSTM / GNN encoder–decoder + beam | **yes (graph)** | per hand | no | ThumbSet + PIG | **66.84** | MIT [15] | feasible (ONNX, about 10^5 parameters est.) |
| 2022 | Srivatsan & Berg-Kirkpatrick [16] | Bi-LSTM + checklist + REINFORCE | arpeggiated | mirrored LH | no | PIG (other split) | 69.5 on their split (not comparable) | not found | heavy (estimated tens of millions of parameters) |
| 2023 | Randolph et al. [24] | linear-chain CRF (sklearn-crfsuite) | partial (concurrency features) | per staff | no | PIG / own corpora | 65.01 (weighted) | pydactyl MIT [26] | trivial at inference |
| 2023 | Gao et al. [27] | model-based reinforcement learning | ? | ? | no | none | not on PIG | Julia, GPL-3.0 [28] (association unconfirmed) | slow |
| 2026 | Penner & Hindle [40] | Kalman filter (hands) + HMM (fingers); n-gram LMs | yes | **yes, incl. hand separation** | no | PIG | joint hand+finger M_rec 56.6; hand accuracy 90.8 | Zenodo, licence not stated | trivial |
| 2026 | `chirality` [42] | Parncutt rules + learned weights, exact Viterbi; HMMs; PPO | per README | yes (mirrored) | no | PIG misc | 65.4 (unverified) | AGPL-3.0 | trivial |

### 2.1 Parncutt, Sloboda, Clarke, Raekallio & Desain 1997: the ergonomic model [1]

*Music Perception* 14(4):341–382. The author-hosted PDF is at [1].

**Idea.** Enumerate every fingering of a melodic fragment that respects the maximum *practical* spans. Score each fingering by the linear sum of 12 rule contributions, each a separate source of ergonomic difficulty. Rank by total cost [1]. For longer melodies the authors replace enumeration by a shortest-path search over an "exploded" network. Each node holds (previous, current, next) fingers, so rules spanning three notes can be evaluated locally. The network has at most $n \cdot 5 \cdot 4 \cdot 4 + 2$ nodes, because the same finger is never used on consecutive notes [1].

**Span table** (Table 1 of [1]). Right hand, semitones, finger pair $f \to g$ with $f < g$. Positive values are rising intervals. Negative values for thumb pairs mean the finger passes over the thumb, or the thumb passes under.

| Pair | MinPrac | MinComf | MinRel | MaxRel | MaxComf | MaxPrac |
|---|---|---|---|---|---|---|
| 1-2 | −5 | −3 | 1 | 5 | 8 | 10 |
| 1-3 | −4 | −2 | 3 | 7 | 10 | 12 |
| 1-4 | −3 | −1 | 5 | 9 | 12 | 14 |
| 1-5 | −1 | 1 | 7 | 10 | 13 | 15 |
| 2-3 | 1 | 1 | 1 | 2 | 3 | 5 |
| 2-4 | 1 | 1 | 3 | 4 | 5 | 7 |
| 2-5 | 2 | 2 | 5 | 6 | 8 | 10 |
| 3-4 | 1 | 1 | 1 | 2 | 2 | 4 |
| 3-5 | 1 | 1 | 3 | 4 | 5 | 7 |
| 4-5 | 1 | 1 | 1 | 2 | 3 | 5 |

How the columns relate [1]:
- MaxComf = MaxPrac − 2 for every pair.
- MinComf = MinPrac + 2 for thumb pairs, and MinComf = MinPrac for other pairs.
- Non-thumb pairs: MaxRel = 2·(g − f) semitones and MinRel = MaxRel − 1. This is the "next-note-next-finger" diatonic hand.
- Thumb pairs: MaxRel = MaxComf − 3 and MinRel = 2·(g − f) − 1.

**Reverse pairs and the left hand** [1]:
- For a pair played in reverse order, negate the values and swap Min and Max: MaxX(g, f) = −MinX(f, g) and MinX(g, f) = −MaxX(f, g). For example, MaxPrac(2, 1) = 5.
- For the left hand, either reverse the finger order or negate the intervals.
- The values are meant for an average adult male pianist. For smaller hands the authors suggest multiplying all values by about 0.9 [1].

**Full 5×5 matrices** (Appendix of [1]; row $f$ = first finger, column $g$ = second finger). The Min matrices follow from $\text{Min}X(f,g) = -\text{Max}X(g,f)$.

```
MaxPrac            MaxComf            MaxRel
 0 10 12 14 15      0  8 10 12 13      0  5  7  9 10
 5  0  5  7 10      3  0  3  5  8     -1  0  2  4  6
 4 -1  0  4  7      2 -1  0  2  5     -3 -1  0  2  4
 3 -1 -1  0  5      1 -1 -1  0  3     -5 -3 -1  0  2
 1 -2 -1 -1  0     -1 -2 -1 -1  0     -7 -5 -3 -1  0
```

**The 12 rules with exact weights** (paraphrased from [1]). Let $i$ be the signed interval in semitones from the note played by finger $f$ to the next note played by finger $g$ (right hand).

| # | Rule | Points |
|---|---|---|
| 1 | **Stretch** | 2 per semitone that $i$ exceeds MaxComf(f,g) or falls below MinComf(f,g). |
| 2 | **Small-Span** | Per semitone that $i$ falls below MinRel(f,g): 1 if the thumb is one of the two fingers, otherwise 2. |
| 3 | **Large-Span** | Per semitone that $i$ exceeds MaxRel(f,g): 1 if the thumb is involved, otherwise 2. |
| 4 | **Position-Change-Count** | Look at three consecutive notes with fingers $f_1, f_2, f_3$. A position change occurs when the interval from note 1 to note 3 exceeds MaxComf($f_1,f_3$) or falls below MinComf($f_1,f_3$). It is a **full change, 2 points**, when all three hold: $f_2$ is the thumb; the middle pitch lies between the outer two; and the 1→3 interval exceeds MaxPrac($f_1,f_3$) or falls below MinPrac($f_1,f_3$). Any other change is a **half change, 1 point**. Special case: when notes 1 and 3 have the *same pitch* but different fingers (e.g. C4–F4–C4 played 2–5–1), count a half change of size 0. |
| 5 | **Position-Change-Size** | For the same triple: if the 1→3 interval is below MinComf($f_1,f_3$), add (MinComf − interval); if above MaxComf($f_1,f_3$), add (interval − MaxComf). |
| 6 | **Weak-Finger** | 1 every time finger 4 or 5 is used. |
| 7 | **Three-Four-Five** | 1 every time fingers 3, 4 and 5 occur on three consecutive notes in any order. Overlapping groups count separately. |
| 8 | **Three-to-Four** | 1 every time finger 3 is immediately followed by finger 4. |
| 9 | **Four-on-Black** | 1 every time fingers 3 and 4 are consecutive, in either order, with 3 on a white key and 4 on a black key. |
| 10 | **Thumb-on-Black** | 1 when the thumb plays a black key; +2 if the preceding note is on a white key; +2 if the following note is on a white key. |
| 11 | **Five-on-Black** | When finger 5 plays a black key: 0 if both neighbours are black; +2 if the preceding note is white; +2 if the following note is white. |
| 12 | **Thumb-Passing** | 1 for each thumb-under or finger-over pass on the same level (white→white or black→black); 3 when the lower note is white and played by a non-thumb finger and the upper note is black and played by the thumb. |

**Implementation notes.**
- **Rules 2 and 3 for reversed pairs.** In the matrix formulation (Appendix of [1]), rules 2 and 3 swap names when $f > g$, for example when passing the thumb. The *total* cost is unchanged, so an implementation can simply add both one-sided penalties with the thumb-dependent multiplier.
- **Same finger twice.** The model never assigns the same finger to two consecutive notes. Repeated notes, sliding and silent finger changes were explicitly not modelled [1].
- **Decomposition for a DP.**
  - Unary terms (depend on one finger plus the colours of neighbouring keys): rules 6, 10, 11.
  - Pairwise terms: rules 1, 2, 3, 8, 9, 12.
  - Triple terms: rules 4, 5, 7.

  A second-order Viterbi, whose state is (previous finger, current finger), is therefore exact. See §6.4.
- **Unit tests.**
  - Table 2 of [1] gives the combined rule 1+2+3 cost for every finger pair and interval. For example, a falling 5 semitones played 1-2 costs 10: 4 from Stretch and 6 from Small-Span.
  - The worked network example in [1] fingers the RH fragment A4–C4–A4–E5 optimally as **4-1-2-5 with total cost 15**. Our own decomposition: pairs 0 + 6 + 2, Weak-Finger 2, Position-Change-Count 1 + 1 (the first triple is the same-pitch special case), Position-Change-Size 0 + 3. This reproduces 15 *only if* the same-pitch special case overrides the general rule; implement it that way.
  - One prose example in [1] (Fig. 2(iii)) contains internally inconsistent numbers. Test against Tables 2 and 4, not against the prose.

**Evaluation** [1]:
- 28 pianists wrote their preferred right-hand fingerings for the opening of 7 Czerny studies (op. 821): 13 professionals, 3 students, 8 other professionals, 3 of the authors, and Czerny's own printed fingering.
- Each fragment was at most 8 notes. The first and last fingers were fixed as constraints.
- In most pieces the most popular human fingering was among the model's 10 cheapest. The exception was Piece F, where the popular fingering kept a constantly stretched hand on an arpeggio-like figure, which the model penalises.
- The model also ranked many fingerings highly that no pianist chose.

**Behavioural findings** (companion sight-reading study, [1] fn. 22):
- 17 pianists × 7 Czerny studies × 2 runs, about 30,000 fingered notes.
- 4→3 occurred 1,663 times and 3→4 only 1,142 times, the evidence for rule 8.
- Other asymmetries were observed but not modelled: 3-1 > 1-3, 1-4 > 4-1, 3-2 > 2-3, 2-4 > 4-2, 5-4 > 4-5.
- A factor analysis grouped the rules into five factors explaining 78% of the variance of sight-read fingerings: "stretch" (rules 1, 3, 10, 11), "position change" (2, 4, 5), "agility" (6, 7, 8), and rules 9 and 12 on their own [1].

**Self-identified limitations and proposed extensions** [1]. These are useful as feature ideas:
- the 3-note window is too short;
- the rules are not orthogonal and may not add linearly;
- avoid small position changes inside large ones (a motor "tongue-twister" effect);
- avoid sudden accelerations: the hand's centre should follow a smoothed pitch trajectory, and sudden compact↔stretched span changes should cost something;
- reaching white keys with other fingers while the thumb is on a black key is hard;
- cognitive economy: use standard scale and arpeggio fingerings; reuse fingerings from the repertoire; the "rule of regularity" (finger repeated or sequential passages the same way); align fingering with structure;
- context: strong fingers on metric accents, position changes at phrase boundaries, tempo (faster tempi weight position changes and short fingers on black keys more), articulation (staccato permits more shifts), and register.

**Card.**
- Family: rule-based cost.
- Polyphony: no.
- Hands: RH, LH by mirroring.
- Substitutions: no.
- Data: none.
- Code: none from the authors. Re-implementations exist in `pydactyl` (MIT, Python) [26] and `chirality` (AGPL-3.0) [42]; the latter claims to reproduce Table 2, all transcribed Table 4 rows, and the playable-fingering counts.
- Browser: trivial.
- Failure modes: monophonic only; no timing; ad-hoc weights; over-generates plausible-looking but unpianistic fingerings.

### 2.2 Hart, Bosch & Tsai 2000: dynamic programming with a cost table [3]

*The UMAP Journal* 21(2):167–177 (paywalled). The method finds a minimum-cost monophonic fingering by stage-wise (backward) dynamic programming over a table of transition costs between consecutive notes [3], [13].

The MIT-licensed `pydactyl` framework contains a transcription of the tables, attributed to this paper (`data/tables_0.dat`) [26]:
- costs indexed by key-colour transition (W→W, W→B, B→W, B→B), finger on the lower note, finger on the higher note, and semitone distance 0..12;
- 999 means forbidden;
- `Max_Interval: 12`.

The DP is a backward recursion $fs[n, s] = \min_{s'} c(s, s'; \Delta p) + fs[n+1, s']$ [26]. These tables could not be verified against the original. pydactyl extends the method to repeated pitches and two staves [26].

**Card.**
- Family: cost table + DP.
- Hands: monophonic, single hand.
- Data: none.
- No PIG results published.
- Failure modes: only pairwise context; no leaps beyond an octave; costs are ad hoc.

### 2.3 Jacobs 2001: refinements to the ergonomic model [2]

*Music Perception* 18(4):505–511 (paywalled). The abstract reviews the Parncutt model and identifies the specification of spans in semitones as problematic [2]. A later paper summarises the main refinement as replacing semitone distance by **physical distance** between keys [18].

Independent re-implementations encode Jacobs' changes as follows. This has not been verified against the original text.
1. Spans are measured physically. pydactyl maps millimetre key distances into semitone-equivalent bins.
2. The Large-Span rule no longer doubles the cost for non-thumb pairs (a "unified" large-span rule).
3. The Weak-Finger rule applies to finger 4 only, not finger 5.
4. The Three-Four-Five rule is dropped for parsimony [26], [42].

Balliauw et al. credit "Parncutt et al. and Jacobs" for their relaxed-span rule, which uses one point per unit without the thumb distinction, and for their fourth-finger rule [13].

**Card.**
- Family: as Parncutt.
- PIG M_gen 59.5 with a Dijkstra-style solver [42] (unverified).

### 2.4 Other early work (1989–2005)

- **Sayegh 1989.** Optimal-path fingering for string instruments (*Computer Music Journal* 13(3)). It is the conceptual precursor of the shortest-path formulation [1], [6].
- **Japanese technical reports** cited by [5] and [8]: Noguchi et al. 1996 (n-gram finger statistics), Sekiguchi & Eiho (1999/2000, performance generation and display), and Hayashida & Mizutani 2003 (logical rule representation, with conflict resolution between rules as the stated problem).
- **SIEDP** (Viana & Morais Júnior, SBCM 2003). A genetic algorithm for optimal melodic fingering [56].
- **Al Kasimi, Nichols & Raphael 2005**, *Automatic Fingering System (AFS)*, an ISMIR 2005 poster [7]. It is the precursor of [6] and is cited by [5].
- **Takegawa, Terada & Nishio 2006.** Real-time fingering *detection* using coloured fingernail markers and a camera covering 2 octaves, with simple correction rules [14].

### 2.5 Lin & Liu 2006: an intelligent virtual piano tutor [4]

*Proc. ACM VRCIA 2006*, pp. 353–356, DOI 10.1145/1128923.1128986. The system uses rule-based fingering generation with graph pruning, runs in real time from MIDI input, and drives a virtual tutor [4], [54]. Balliauw et al. group it with the Dijkstra-based Parncutt-style solvers [13]. Zhu et al. criticise rule-based expert systems like it for conflicting or inapplicable rules [54]. No quantitative evaluation was found.

### 2.6 Yonebayashi, Kameoka & Sagayama 2007: the first fingering HMM [5]

*IJCAI 2007*, pp. 2915–2921. This is the first fingering model built as an HMM.

**Model** [5]:
- An arc-emission (Mealy) HMM whose hidden state is the finger, or set of fingers, and whose output is the *pitch transition* between consecutive notes:
  $$P(S \mid Y) \propto \prod_i P(y_i \mid f_i, f_{i-1})\, P(f_i \mid f_{i-1}).$$
- The output for each finger pair is a **2-D Gaussian** over the key displacement vector: horizontal distance plus "depth" for black versus white.
- The parameters were set by hand from anatomy and then hand-tuned:
  - the mean horizontal distance follows the finger distance (3→5 ≈ 2 white keys);
  - thumb pairs get larger variance;
  - thumb pairs are bimodal, with one mode for normal fingering and one for crossing;
  - transitions 3↔4 and 4↔5 get about 30% lower probability than the others.
- Octave position and note durations are ignored.

**Evaluation.** Qualitative only, on right-hand melodies from Bach Inventions 1 and 2 (about 620 notes). The fingerings are reasonable in most places. Documented failures: the same finger on repeated short notes, caused by ignoring duration, and awkward hand motion [5].

**Proposed extensions.**
- polyphony and both hands via $2^{10} = 1024$ "which fingers are down" states;
- N-best decoding;
- unsupervised Baum–Welch training;
- fixing fingers given in the score by constraining the search;
- per-note likelihood as a measure of difficulty.

### 2.7 Al Kasimi, Nichols & Raphael 2007: a polyphonic trellis [6]

*ISMIR 2007*, pp. 355–356. This is the first explicitly polyphonic method. (Some citations use the surname "Kasimi"; it is the same first author, Alia Al Kasimi.)

**Trellis.** One layer for every time point where a note begins or ends. Each node is a complete assignment of fingers to the notes sounding at that moment, subject to three rules:
1. within a node, fingers are ordered by pitch (no crossing);
2. a held note keeps its finger (no substitution);
3. each finger presses one key at most [6].

**Costs.**
- **Vertical (node) cost:** $\sum_{k} c_v(\text{pair}_k, d_k)$ over *adjacent* pitch pairs inside the chord.
- **Horizontal (edge) cost:** the *average* over all pairs (one note from each chord) of $c_h(\text{finger pair}, d)$.
- $c_h = c_v$ except for crossovers, which get their own cost function; thumb crossovers are cheaper.

**Tuning.** Per-user "bathtub" cost curves are elicited by questions: the smallest easily playable interval, the comfort zone, and the near-impossible stretch. Example for fingers 2–5: easy from 4 half-steps, comfortable 4–7, nearly impossible beyond 11 [6]. Decoding is by Viterbi.

**Limitations** (stated by the authors): no substitutions, no black/white distinction, no hand assignment [6]. Evaluation is qualitative, e.g. Ellmenreich's *Spinning Song*.

**Later results.** Nakamura et al. reformulated this as a probabilistic "chord HMM", with states being finger combinations per chord ($\binom{5}{K}$ states for $K$ pitches), sustained notes keeping their finger, and a $K^{-\gamma}$ weighting. It scored 61.2 M_gen on PIG, slightly below HMM1, which they partly attribute to the synthetic note durations in the data [9]. A Dijkstra re-implementation of the original costs reports 50.9 [42] (unverified).

**Card.**
- Family: cost-based chord trellis + Viterbi.
- Polyphony: yes.
- Data: none.
- Browser: trivial. The state space is at most $\binom{5}{K} \le 10$ per slice.

### 2.8 Robine 2009; Zhu, Ramakrishnan, Hamann & Neff 2013

- **Robine 2009.** *Analyse automatique du doigté au piano*, Journées d'Informatique Musicale 2009, pp. 106–112 [55]. A dynamic-programming fingering analyser, cited by Balliauw et al. alongside Hart et al. as using transition matrices with backward DP [13]. No PIG results.
- **Zhu et al. 2013.** *A system for automatic animation of piano performances*, *Computer Animation and Virtual Worlds* 24(5):445–457 [54]. Fingering is decided on a DAG with rule-based comfort constraints, then smoothed with statistics from motion-capture-glove recordings, so that hands can be animated [14], [54].

### 2.9 Nakamura, Ono & Sagayama 2014: merged-output HMM for both hands [8]

*ISMIR 2014*, pp. 531–536. **Relevant to digitus2's MIDI import, because the method also separates the hands.**

**One-hand model.** This extends Yonebayashi's HMM [8]:
$$P(p_{1:N}, f_{1:N}) = \prod_n P(p_n \mid p_{n-1}, f_{n-1}, f_n)\, P(f_n \mid f_{n-1}).$$
- The output depends only on the keyboard-lattice displacement, $F(\Delta x, \Delta y; f, f')$, which gives translation symmetry.
- Time-inversion symmetry is imposed.
- LH and RH tables are tied by x-reflection.
- Chords are handled by "virtually arpeggiating" them from low to high pitch.
- Substitutions are not considered [8].

**Both hands.** Two "part HMMs", one per hand, are merged. The state is $k = (\eta, f_L, f_R)$, where $\eta \in \{L, R\}$ says which part HMM moves at this note. Then [8]:
$$a_{k'k} = \begin{cases}\alpha_L\, a^L_{f'_L f_L}\,\delta_{f'_R f_R} & \eta = L\\ \alpha_R\, a^R_{f'_R f_R}\,\delta_{f'_L f_L} & \eta = R\end{cases},\qquad b_{k'k}(\cdot) = b^{\eta}_{f'_\eta f_\eta}(\cdot),\qquad \alpha_L \approx \alpha_R \approx \tfrac{1}{2}.$$
Viterbi over $k$ yields the hand assignment and both hands' fingers at once [8].

**Cheaper hand separation.** A simpler merged-output model has state $x = (\eta, p_L, p_R)$, the last pitch played by each hand, with transition probabilities between successive pitches *within* each hand estimated from piano scores [8]. With noiseless observations this reduces to a potential that can be minimised by dynamic programming. The extra variable $h_n$ counts how many notes ago the opposite hand last played; $N_h = 50$ suffices [8].

**Results** [8]:
- **Fingering:** leave-one-out on Bach Inventions 1, 2, 3, 8 and part of Beethoven Sonata No. 8, with add-0.1 smoothing: 56.0% RH, 55.4% LH (5,202 / 5,539 notes). Closed-test accuracy exceeded 70%, suggesting that more data would help.
- **Hand separation error** on 39,650 notes:

  | Model | Error |
  |---|---|
  | 0th-order HMM | 9.9% |
  | 1st-order HMM | 8.5% |
  | 2nd-order HMM | 8.9% |
  | **Merged-output HMM** | **7.1%** |

  Merged-output error by composer: Bach 1.9%, Beethoven 9.28%, Chopin 3.8%, **Debussy 18.7%** (wide hand movements).
- **Difficulty:** $D(t) = -\ln P(p(t), f(t)) / \Delta t$ over a window $\Delta t$ (1 s in the paper). Bach Inventions stay below about 10, a Beethoven sonata reaches 20–30, and Chopin's *Fantaisie-Impromptu* reaches about 40 [8].

**Card.**
- Family: generative HMM.
- Polyphony: arpeggiated.
- Both hands: yes, including hand separation.
- Data: own small corpus.
- Code: not public.
- Browser: trivial. 50 states $(\eta, f_L, f_R)$ give at most 2,500 transitions per note.
- A 2026 re-implementation reported only 67.4% hand accuracy and 39.7 joint accuracy on PIG, with very long runtimes. That suggests faithful re-implementation is non-trivial [40].

### 2.10 Balliauw, Herremans, Palhazi Cuervo & Sörensen 2015/2017: tabu search and VNS [12], [13]

- **2015:** tabu search, *Mathematics and Computation in Music*, LNCS 9110, pp. 149–160 [12].
- **2017:** variable neighbourhood search, *International Transactions in Operational Research* 24(3):509–535 [13]. A preprint is at [13], and the C++ source is linked from the authors' page (Bitbucket; no licence stated) [13].

**Representation** [13]:
- Distances are measured in "key units" on a keyboard with imaginary black keys at E–F and B–C (14 units per octave; see §1.2).
- Span tables are given for a *large*, *medium* and *small* right hand, with the same six columns as Parncutt.
- Reverse pairs and the left hand are derived as in [1].

Span tables, right hand, key units (14 per octave) [13]:

| Pair | Large: MinPrac / MinComf / MinRel / MaxRel / MaxComf / MaxPrac | Medium | Small |
|---|---|---|---|
| 1-2 | −10 / −8 / 1 / 6 / 9 / 11 | −8 / −6 / 1 / 5 / 8 / 10 | −7 / −5 / 1 / 3 / 8 / 10 |
| 1-3 | −8 / −6 / 3 / 9 / 13 / 15 | −7 / −5 / 3 / 9 / 12 / 14 | −6 / −4 / 3 / 6 / 10 / 12 |
| 1-4 | −6 / −4 / 5 / 11 / 14 / 16 | −5 / −3 / 5 / 11 / 13 / 15 | −4 / −2 / 5 / 8 / 11 / 13 |
| 1-5 | −2 / 0 / 7 / 12 / 16 / 18 | −2 / 0 / 7 / 12 / 14 / 16 | −2 / 0 / 7 / 10 / 12 / 14 |
| 2-3 | 1 / 1 / 1 / 2 / 5 / 7 | 1 / 1 / 1 / 2 / 5 / 7 | 1 / 1 / 1 / 2 / 4 / 6 |
| 2-4 | 1 / 1 / 3 / 4 / 6 / 8 | 1 / 1 / 3 / 4 / 6 / 8 | 1 / 1 / 3 / 4 / 6 / 8 |
| 2-5 | 2 / 2 / 5 / 6 / 10 / 12 | 2 / 2 / 5 / 6 / 10 / 12 | 2 / 2 / 5 / 6 / 8 / 10 |
| 3-4 | 1 / 1 / 1 / 2 / 2 / 4 | 1 / 1 / 1 / 2 / 2 / 4 | 1 / 1 / 1 / 2 / 2 / 4 |
| 3-5 | 1 / 1 / 3 / 4 / 6 / 8 | 1 / 1 / 3 / 4 / 6 / 8 | 1 / 1 / 3 / 4 / 6 / 8 |
| 4-5 | 1 / 1 / 1 / 2 / 4 / 6 | 1 / 1 / 1 / 2 / 4 / 6 | 1 / 1 / 1 / 2 / 4 / 6 |

In this metric the thumb-to-fifth practical maximum is 18 units (a 10th) for the large hand, 16 (a 9th) for the medium hand, and 14 (an octave) for the small hand. The small-hand table is the natural starting point for beginners and children (§4.4).

**Objective function** (Table 2 of [13], paraphrased; exact scores). All terms are summed per hand, and each hand is minimised independently. "Mono" rules apply to monophonic note sequences, "All" to both monophonic and polyphonic music. The table credits each rule to Parncutt [1], Jacobs [2] or Al Kasimi [6], or marks it as the authors' own.

| # | Applies to | Rule | Score |
|---|---|---|---|
| 1 | All | per unit two consecutive notes lie below MinComf or above MaxComf | +2 |
| 2 | All | per unit below MinRel or above MaxRel (no thumb distinction) | +1 |
| 3 | Mono | three consecutive notes: notes 1–3 outside the comfortable range | +1 |
|   |      | …plus: middle pitch between the outer two, played by the thumb, and notes 1–3 outside the practical range | +1 more |
|   |      | …plus: notes 1 and 3 have the same pitch but different fingers | +1 more |
| 4 | Mono | per unit the notes 1–3 distance lies outside the comfortable range | +1 |
| 5 | Mono | each use of finger 4 (**set to 0 by default** in the experiments) | +1 |
| 6 | Mono | fingers 3 and 4 used consecutively | +1 |
| 7 | Mono | finger 3 on white and 4 on black, consecutively, either order | +1 |
| 8 | Mono | thumb on black | +0.5 |
|   |      | …plus a different finger on a white key just before | +1 |
|   |      | …plus a different finger on a white key just after | +1 |
| 9 | Mono | finger 5 on black | 0 |
|   |      | …plus a different finger on white just before | +1 |
|   |      | …plus a different finger on white just after | +1 |
| 10 | Mono | thumb crossing or passing on the same level (W–W or B–B) | +1 |
| 11 | Mono | thumb on black crossed by a non-thumb finger on white | +2 |
| 12 | Mono | notes 1 and 3 differ, are played by the *same* finger, and the middle pitch lies between them (e.g. C4–G4–C5 as 2-1-2) | +1 |
| 13 | All | per unit two consecutive notes lie beyond MinPrac/MaxPrac (a soft version of Parncutt's hard limit) | +10 |
| 14 | Poly | *within a chord*: apply rules 1 and 2 with **doubled** scores, plus rule 13 | – |
| 15 | All | consecutive slices containing exactly the same pitches: per finger that changes | +1 |

Notes on the objective [13]:
- **Hard constraint:** one finger cannot play two keys at the same time.
- **Rules 8 and 9** were halved relative to Parncutt. Their original scores could reach 5 and 4 points per note pair, which the authors judged too high relative to the other rules.
- **Rule 5** defaults to 0 because pianists may want to train finger 4. Rules 6 and 7 are kept because of the biomechanical coupling of fingers 3 and 4.
- **Weight source:** the relative scores came from discussions with professional musicians.

**Algorithm** [13]:
1. **Random feasible initial solution,** built slice by slice. A slice is the duration of the shortest note in the piece.
2. **Swap pre-processing:** exchange every occurrence of two fingers throughout the piece (at most 10 moves).
3. **Local search in three neighbourhoods,** with steepest or first descent:
   - **Change1:** change one note's finger; size $(5-s)t$.
   - **Change2:** change two adjacent or simultaneous notes.
   - **SwapPart:** swap the finger of a long note with the finger used on the notes it contains.

   The order of Change1 and SwapPart is randomised.
4. **Perturbation:** re-randomise blocks of consecutive slices.
5. **Stop** after a parameterised number of non-improving iterations.

**Results** [13], [9]:
- **Speed:** 110 s for a 203-note minuet (both hands) and 38 s for a 156-note Handel variation, on a 2.93 GHz i7.
- **Match with printed fingerings:** close to IMSLP editions, with only a few fingers differing.
- **Hand size:** difficulty is significantly lower for larger hands (Wilcoxon, p < 0.0001).
- **On PIG** [9]: the program processed only **14 of 30 test pieces**, presumably because of MusicXML parsing failures. On those 14 pieces it scored M_gen 56.7, M_high 62.4, M_soft 78.2, M_rec 67.5, against 60.5 / 67.9 / 82.4 / 73.7 for HMM1 on the same pieces.

**Card.**
- Family: metaheuristic over a rule objective.
- Polyphony: **yes**.
- Hands: each staff gets its own hand; hand reassignment is future work.
- Substitutions: no.
- Data: none.
- Browser: feasible as a Web Worker but slow and stochastic.
- Failure modes: local optima, random initialisation, runtime of tens of seconds.

**Lesson for digitus2:** keep Balliauw's *chord rules* (14 and 15, plus the hand-size tables) but replace the stochastic search with exact DP (§6).

### 2.11 Nakamura, Saito & Yoshii 2020: statistical learning and estimation [9]

*Information Sciences* 517:68–85, DOI 10.1016/j.ins.2019.12.068. The arXiv version is 1904.10237 [9]. This paper introduced the PIG dataset and the four metrics (§1.3–1.4).

**First-order HMM** (Section 5.2 of [9]):
$$P(f) = P(f_1)\prod_{n\ge2} P(f_n \mid f_{n-1}),\qquad P(p\mid f) = P(p_1 \mid f_1)\prod_{n\ge2} F(p_n - p_{n-1};\, f_{n-1}, f_n),$$
- **Transposition symmetry** (the output depends only on the interval) is always imposed. With fully general outputs there would be $88^2 \cdot 5^2 \approx 2\times10^5$ parameters.
- **Pitch differences** use either integers with a cutoff $\delta p_{max} = 15$, or the keyboard lattice with $\Delta y \in \{-1, 0, 1\}$ and an x cutoff.
- **Optional extra symmetries:**
  - time inversion: $F(d; a, b) = F(-d; b, a)$;
  - LH/RH reflection: $F_L(d; a, b) = F_R(-[d]_x; a, b)$.
- **Chord constraint:** if two notes start within 30 ms of each other and the finger order opposes the pitch direction, the output probability is set to 0 [9]. An open re-implementation that reports bit-exact agreement with the reference binary uses a soft log-penalty of −5 instead [42].
- **Weight on the output term:** an exponent $\alpha_1$ (0.964 for HMM1) [9].
- **Decoding:** Viterbi for $\arg\max_f P(f, p)$ [9].

**Higher-order HMMs** (order $m = 2, 3$) [9]:
- Transitions are smoothed by linear interpolation:
  $$P(f_n\mid f_{n-m:n-1}) = \Big(1-\sum_{l=1}^{m-1}\lambda_l\Big)P_{ML}(f_n\mid f_{n-m:n-1}) + \sum_{l=1}^{m-1}\lambda_l\,P_{ML}(f_n \mid f_{n-l:n-1})$$
- Outputs are factorised into pairwise terms:
  $$P(p_n \mid p_{n-m:n-1}, f_{n-m:n}) \propto \prod_{l=1}^{m} P(p_n \mid p_{n-l}, f_{n-l}, f_n)^{\alpha_l}$$
  Each factor is a first-order-style table $F_l(\Delta; f_{n-l}, f_n)$.

**What is learned and what is fixed** [9]:
- **Learned by counting** (maximum likelihood on the miscellaneous subset): initial probabilities, transition tables of orders 1..m, and the per-lag output tables $F_l$, separately for each hand.
- **Tuned for estimation accuracy** by Bayesian optimisation (Gaussian-process mutual information, 200 iterations): the exponents $\alpha_l$, the interpolation weights $\lambda_l$, and the chord-HMM coefficients. The paper reports no separate validation set; see §3.
- **Fixed:** lattice geometry, cutoffs, and the 30 ms chord threshold.

Tuned parameters (Table 3 of [9]):

| Model | Parameters |
|---|---|
| HMM1 | α₁ = 0.964 |
| HMM2 | α = (0.556, 0.407), λ₁ = 0.474 |
| HMM3 | α = (0.448, 0.292, 0.194), λ = (0.470, 0.504) |
| Chord HMM | five coefficients 0.94, 4.70, 7.53, 5.29, 0.10 (the mapping to symbols was lost in text extraction; see the paper) |

**Size.** For HMM3, each hand has transition tables of 5 + 25 + 125 rows × 5, and three output tables of 25 × 93 (lattice bins) [42]. That is about $8\times10^3$ numbers per hand, roughly 100–150 KB of JSON for both hands, and less if quantised.

**Results.** Test set = 30 composer-subset pieces; training = miscellaneous subset [9].

| Method | M_gen | M_high | M_soft | M_rec |
|---|---|---|---|---|
| 1st-order HMM | 61.7 | 68.3 | 82.8 | 74.0 |
| 2nd-order HMM | 64.3 | 70.8 | 85.3 | 77.6 |
| 3rd-order HMM | **64.5** | **71.0** | **85.5** | **77.8** |
| Chord HMM | 61.2 | 67.7 | 81.7 | 73.8 |
| DNN (FF: 3 hidden layers, ±5-note window) | 61.5 | 66.2 | 82.5 | 69.5 |
| DNN (LSTM: 3 layers × 32 units) | 61.3 | 66.1 | 82.8 | 69.5 |
| Human | 71.4 | 79.1 | 90.8 | 84.3 |

On the 14-piece "VNS set" [9]: HMM1 60.5 / 67.9 / 82.4 / 73.7; HMM2 63.1 / 70.6 / 85.1 / 77.6; LSTM 59.8 / 64.6 / 82.6 / 67.9; VNS 56.7 / 62.4 / 78.2 / 67.5; human 70.2 / 78.9 / 91.0 / 84.5.

**Ablations** (first-order HMM, α₁ = 1) [9]:
- **Representation and chord constraint (Table 5):** lattice 61.6 / 68.3 / 82.8 / 74.0; integer pitches 61.4 / 67.9 / 82.6 / 74.0; lattice 60.0 / 66.7 / 81.2 / 72.7; integer 59.5 / 66.2 / 80.6 / 72.2. The text states that the chord constraint consistently improves results. From the values, the first two rows appear to be *with* the constraint and the last two *without*; the table's constraint column was lost in extraction.
- **Learning curves** follow $A(N) = a - b/\sqrt{N}$ in the number of training notes, so more data still helps.
- **Extra symmetries** (time inversion, and especially reflection) *hurt* with the full training set but *help* with small training sets. The LH/RH reflection is the less accurate of the two approximations [9].

**Stated limitations** [9]: timing, phrase boundaries and inter-hand dependence are not modelled. The DNNs' much lower M_rec shows that per-note classifiers lack sequential consistency.

**Card.**
- Family: generative HMM.
- Polyphony: arpeggiated, with a chord constraint.
- Hands: given.
- Substitutions: no.
- Data: PIG (non-commercial).
- Code: C++ [11], no licence stated.
- Browser: **trivial**. The order-3 Viterbi has 125 states and 625 transitions per note.

### 2.12 Moryossef, Elazar & Goldberg 2019/2023: *At Your Fingertips* [14]

First posted on OpenReview in 2019, then on arXiv in 2023 (2303.03745) [14].

**Data pipeline** [14]:
- **Source:** YouTube piano videos from one channel that publishes synchronised MIDI.
- **Keyboard:** detection by image processing.
- **Hands:** a Faster R-CNN detector fine-tuned on 476 hand annotations.
- **Fingers:** convolutional pose machines, adapted to dark, high-contrast footage with a CycleGAN-based self-training procedure.
- **Finger per note:** a Gaussian "fit" of each fingertip to the pressed key, integrated over frames with exponentially decaying weights.
- **Alignment:** audio–MIDI offset search that maximises a confidence score.
- **Result:** **APFD, 90 pieces by 42 composers, 155,107 notes** (about 1,723 notes per piece). Extraction F1 against 6,894 manually tagged notes is 0.97 at no confidence threshold, versus 0.93 for the off-the-shelf pose model [14].

**Fingering model** [14]. A standard BiLSTM tagger (the same as Nakamura's "DNN (LSTM)"), evaluated with M_gen only:

| Training | M_gen on PIG |
|---|---|
| PIG only | 64.1 |
| Pre-train on APFD, fine-tune on PIG | **66.8** |

66.8 is 2.3 points above HMM3's 64.5. The paper calls it a 2.7-point gain over the previous state of the art, which matches the gain over its own PIG-only baseline (64.1) instead. One training piece was moved to a development set [14].

**Card.**
- Family: neural sequence tagger plus large noisy data.
- Polyphony: arpeggiated.
- Substitutions: no.
- Code: the hand-detection dataset is released [14]; APFD availability is unclear.
- Browser: easy (small BiLSTM via ONNX).
- Failure modes: per-note tagging without global constraints; video errors from occlusion, blur and alignment.

### 2.13 The two "Guan et al." papers (2021, 2022)

A "Guan et al." graph-neural-network fingering paper is sometimes cited. **No such paper was found.** There are two BiLSTM papers with a Guan as an author. The GNN fingering model in the literature is Ramoneda et al.'s ArGNN (§2.15).

**(a) Guan, Yan & Hsu 2021**, Nordic SMC 2021 (Zenodo 5723888, CC BY 4.0) [17]:
- **Model:** a BiLSTM over a 4-D input vector per note transition: previous finger, colour of the start key, colour of the end key, and semitone distance clipped to ±12. It predicts note $n+1$ from $a$ past and $b$ future notes; the tuned values were (a, b) = (2, 8) to (2, 10), so future context mattered more.
- **Scope:** right hand only, with **chords removed**. Each composer subset was held out in turn (Bach, Mozart, Chopin) [17].
- **Results** (M_gen / M_high / M_soft):

  | Held-out subset | BiLSTM | HMM3 |
  |---|---|---|
  | Bach | 60.5 / 68.3 / 86.9 | 59.1 / 66.2 / 86.4 |
  | Mozart | 62.1 / 67.2 / 87.2 | 58.7 / 63.3 / 82.6 |
  | Chopin | 67.9 / 73.4 / 83.6 | **71.0** / 76.3 / 87.8 |

  These are not comparable with the standard protocol.
- **Playability metric:** rule tables of "proper" and "erroneous" right-hand transitions per interval and black/white category. The BiLSTM had a *lower* proper rate (88.7–89.0% vs 92.8–95.0% for the HMMs on Bach and Mozart) and similar erroneous rates. The authors suggest a trade-off between matching ground truth and playability [17].

**(b) Zhao, Guan & Li**, arXiv 2108.09058 (2021); *EURASIP J. Audio, Speech, Music Process.* 2022 [18]:
- **Model** ("PdF"): the input is the pitch-difference sequence with timing, so that 555 distinct RH note combinations collapse to 108 pitch differences. A BiLSTM-like network adds chord information. A **prior-knowledge layer** sets the probability of impossible finger transitions to zero during decoding: for example, in a descending RH line without a hand shift, 2→3 is impossible, while 2/3/4→1 is possible.
- **Augmentation:** extra training data generated from fingering rules.
- **New metric:** **IFR**, the incapable-performing fingering rate.
- **Results:** against HMM3 on Nakamura's test set, M_gen rises by **3%** and M_high by **1.6%**; without augmentation the gains are 2.1% and 0.1%. IFR reaches 0. The numbers are given only in a figure and as these deltas [18], so absolute values cannot be verified.
- **Code:** none public. Ramoneda et al. note that it was unavailable [15].

### 2.14 Ramoneda, Miron & Serra 2021: reinforcement learning [19]

arXiv 2111.08009. A preliminary workshop-style paper [19]:
- **Setup:** each score is its own environment, right hand only. The state is (current finger, current note, next note); a fully connected deep Q-network predicts the next finger.
- **Reward:** positive when the hand position does not change, negative for position changes and anatomically infeasible actions.
- **Results:** sensible fingerings on toy examples (repeated notes, five-finger patterns, a C major scale), but convergence was too slow compared with offline methods.
- **Follow-up:** a shallow GRU trained on more than 1,500 MuseScore scores fingered by `pianoplayer` imitated it with 78% balanced accuracy [19].
- **Code:** linked from the paper [19].

### 2.15 Ramoneda, Jeong, Nakamura, Serra & Miron 2022: ArLSTM and ArGNN [15]

*ACM Multimedia 2022*, pp. 6502–6510, DOI 10.1145/3503161.3548372. An author copy is at [15]; code (MIT) at [15]; evaluation framework at [68].

**ThumbSet** (Zenodo 6433702, access on request) [15]:
- 2,523 public-domain MusicXML scores from MuseScore that carry *partial* editorial fingering, sliced into 178,737 windows of 32–64 notes.
- 52% of notes are annotated. 61% of the labels are right-hand.
- Distributed in PIG text format, so the original scores cannot be reconstructed.
- The labels are noisy and their source is unclear, and the repertoire leans towards early-grade pieces [15].

**Models** [15]. Both are sequence-to-sequence with one output per input note and a 5-way softmax.
- **ArLSTM:**
  - encoder: a 3-layer **bi-LSTM**, 32 units per direction, over pitch;
  - decoder: an autoregressive 1-layer LSTM (64 units) fed the previous finger's embedding;
  - training: teacher forcing (ratio 0.7 in the code);
  - inference: **beam search**. The paper uses k = 6, citing a cognitive look-ahead of about 5 notes; the code defaults to 10 or 20.
- **ArGNN:** the same decoder with a **gated graph neural network encoder** (GGNN, three gated graph layers). Each note is a node. Edge types are *onset* (simultaneous notes) and *next* (consecutive notes), each with a reverse edge, plus a self-loop. The implementation is **pure PyTorch** with dense adjacency matrix products and has no graph-library dependency, so ONNX export is straightforward [15].
- **Data augmentation:**
  - **hand inversion:** mirror the physical distances to obtain an LH sequence from an RH one and vice versa, choosing keys by grid search so that black/white types match;
  - **time inversion:** reverse the sequence;
  - **octave transposition:** up to 7 copies [15].
- **Soft labels:** 30% smoothing, motivated by the roughly 70% agreement between annotators.
- **Optimiser:** Adam, learning rate 5·10⁻⁵, batch 64.
- **Training:** pre-train on ThumbSet with unlabelled outputs masked, then fine-tune on PIG [15].

**Results.** PIG test set with the new validation split; their Python wrapper of Nakamura's evaluator [15]:

| Model | M_gen | M_high | M_soft | M_rec | CPR (human = 1) | Inference time |
|---|---|---|---|---|---|---|
| HMM1 | 61.77 | 67.66 | 81.09 | 73.15 | 1.12 | 0.30 ms |
| HMM2 | 63.78 | 69.49 | 83.59 | 76.12 | 1.02 | 0.49 ms |
| HMM3 | 63.63 | 69.40 | 83.05 | 75.42 | 1.06 | 0.66 ms |
| FF-base | 61.44 | 66.31 | 81.34 | 69.82 | 1.19 | 73.57 ms |
| LSTM-base | 62.71 | 67.34 | 82.69 | 71.09 | 1.07 | 385.06 ms |
| ArLSTM-Thumb-f (frozen encoder) | 65.34 | 71.73 | 85.49 | 77.80 | 0.99 | 215.78 ms |
| **ArGNN-Thumb-s (soft labels)** | **66.84** | **72.62** | **86.83** | **78.55** | 1.01 | 161.71 ms |
| Human | 71.4 | 79.1 | 90.8 | 84.3 | 1 | – |

Per hand (M_gen / M_high / M_soft / M_rec) [15]:

| Model | Right hand | Left hand |
|---|---|---|
| ArGNN | 62.77 / 68.87 / 86.15 / 76.6 | 70.92 / 76.32 / 87.58 / 80.37 |
| HMM2 | 60.65 / 66.72 / 83.92 / 75.17 | 66.3 / 71.88 / 82.98 / 76.61 |

Models do much better on the LH than on the RH, and most of the neural gain is on the LH. Inference times were measured on an i7-7700 CPU.

**Ablations** (M_gen) [15]:

| Variant | ArGNN | ArLSTM |
|---|---|---|
| Without autoregressive decoder | 63.55 | **27.39** |
| Greedy instead of beam | 64.70 | 64.25 |
| Without augmentation | 60.36 | 64.69 |
| PIG only (no ThumbSet) | 60.53 | **26.82** |
| ThumbSet only (no PIG fine-tuning) | 65.24 | 64.38 |

Two lessons follow. The noisy, partially labelled corpus is what makes the neural models work, and a model trained on ThumbSet *alone* already beats the HMMs [15].

**Card.**
- Family: neural autoregressive with beam search.
- Polyphony: yes, via graph edges.
- Hands: per hand.
- Substitutions: no.
- Data: ThumbSet (restricted) + PIG (non-commercial).
- Code: MIT.
- Browser: feasible. Hidden sizes are 32–64. A parameter count of order $10^5$ is our estimate from the code, not a reported figure. Export the encoder and a single decoder step to ONNX Runtime Web and run beam search in TypeScript.
- Failure modes:
  - no hard physical constraints, so it can output impossible chords unless decoding is constrained;
  - weak right-hand accuracy;
  - training-data licences.

### 2.16 Srivatsan & Berg-Kirkpatrick 2022: checklist models [16]

*ISMIR 2022*; arXiv 2209.05622 [16].

**Model** [16]:
- **Input representations compared:**
  - raw pitch embedding;
  - note name + octave;
  - note name + relative distance, clipped at 15 semitones;
  - **lattice:** horizontal white-key distance, clipped at 9, plus the black/white step.

  The lattice works best.
- **Architecture:** a 2-layer Bi-LSTM and a 2-layer MLP, hidden size 1,024, dropout 0.2, embedding size 256.
- **Feedback of past predictions,** in increasing richness:
  - an autoregressive tagger;
  - the previous finger's embedding;
  - a **binary checklist:** a 5-D vector giving +1 or −1 when a finger was used within the last 100 ms on a higher or lower note;
  - a **distance checklist:** per-finger lattice offsets to the current note.
- **Training:** cross-entropy plus **REINFORCE**, with reward $\exp(-\#\text{hops} - \#\text{smears})$ computed over 10-note chunks and a rolling-average baseline. Mixed objective, warm-started.
- **Inference:** beam search with beam size 10.
- **Preprocessing:** LH parts are mirrored into "RH" songs; chords are arpeggiated from low to high, keeping the timing [16].

**Data.** Alternate PIG splits from Moryossef et al. [16]. **These results are not comparable with the standard split:** the same authors' HMM3 scores M_gen 70.2 on it.

**Results** (M_gen / 4-gram precision on their test split) [16]:

| Model | M_gen | 4-gram |
|---|---|---|
| Bi-LSTM (MIDI) | 66.7 | 27.8 |
| HMM-3 | 70.2 | 39.5 |
| Autoregressive tagger + REINFORCE | 68.7 | 36.5 |
| Binary checklist + REINFORCE | 69.5 | 37.1 |
| Distance checklist | 68.8 | 36.6 |

Fluency counts on their test split [16]:

| | Hops | Smears |
|---|---|---|
| Gold | 155 | 7 |
| Bi-LSTM | 485 | 148 |
| HMM-3 | 196 | 84 |
| Prev-finger embedding + REINFORCE | 53 | 12 |

The HMM also produces too few thumb crosses and too wide a finger spread.

**Human evaluation.** One piano professor rated 10 validation songs on a 1–3 scale (comfort / efficiency / learnability): checklist 2.8 / 2.5 / 2.9 vs Bi-LSTM 1.6 / 1.4 / 1.6 [16]. The pianist reported that all models struggle with **successive chords** [16].

**Card.**
- Family: neural sequence model with constraint-aware feedback and RL fine-tuning.
- Polyphony: arpeggiated.
- Browser: heavy. We estimate tens of millions of parameters from the stated sizes.
- Code: not found.

### 2.17 Randolph, Di Eugenio & Badgerow: data collection, CRFs, ERR and pydactyl [22]–[26]

- **Dactylize (ISMIR 2016 LBD)** [22]. Hardware fingering capture: foil tape on each key and conductive fabric on each fingertip, read by a microcontroller patch-bay matrix and synchronised with MIDI. Over 99% accuracy up to 12.5 notes per second. Cost about US$300 plus a digital piano. Code on GitHub [22].
- **ERR evaluation (SMC 2021, pp. 53–59)** [23]. Treats fingering advice as a ranked list and adapts the expected reciprocal rank metric, so that the "satisfaction" estimate becomes how likely a pianist is to find a suggested fingering adequate [23].
- **CRF model** [24]. A first-order linear-chain CRF (sklearn-crfsuite, L-BFGS, default hyperparameters). Features:
  - lattice distances to the 3 previous and 3 following notes, with a leap ceiling of 15;
  - n-gram contours over 3-, 5- and 7-note windows;
  - concurrency counts: notes above and below starting within 30 ms, and held-over notes;
  - black-key unigrams and trigrams;
  - MIDI velocity;
  - articulation (staccato counts, normalised silence, separated-note counts in a 9-note window);
  - local note rates;
  - repetition counts [24].
- **CRF results on PIG** (train on PIG train, test on PIG test) [24]:

  | Average | M_gen | M_high | M_soft |
  |---|---|---|---|
  | Note-weighted | 65.01 | 68.69 | 84.95 |
  | Unweighted | 64.55 | 68.49 | 85.15 |
  | HMM3 [9] | 64.5 | 71.0 | 85.5 |

  The CRF matches HMM3 on M_gen but trails on M_high and M_soft.
- **New corpora** [24]:
  - **Beringer & Dunhill scales, arpeggios and broken chords:** 194 exercises in all 12 keys, both hands, 11,860 notes.
  - **"Layer One":** Clementi Op. 36 sonatinas, with fingering from five public-domain editions and six professional pianists, plus phrase segmentation.

  Cross-validated M_gen on the combined rudiments-plus-sonatinas data was 24 points (note-weighted) to 29 points (unweighted) higher than on the sonatinas alone. The authors read this as **scale and arpeggio rudiments transferring** to real music [24]. The Beringer corpus ships in `pydactyl/data/corpora/beringer2` (MIT) [26].
- **Thesis (UIC 2023)** [25]. Proposes a recommender-system framing and argues for modelling individual pianists first [25].
- **pydactyl (MIT)** [26]. Python implementations of the Parncutt, Jacobs, "Badgerow", Balliauw, Hart and Sayegh models, plus a random baseline. The Badgerow variant follows suggestions by pianist Justin Badgerow and adds four rules [26]:
  - **3-4-3 / 4-3-4 and 4-5-4 / 5-4-5 alternation:** +1 each.
  - **Same outer pitch, different fingers:** +1.
  - **RH descending 1→4 or 1→5 from black to white:** +3 or +4.
  - **Black-thumb pivot:** a further rule; the source code does not document its weight.

  It also uses MaxComf(1,2) = 9.

### 2.18 Gao et al. 2023: model-based reinforcement learning [27]

*Applied Sciences* 13(20):11321 [27]:
- **Method:** fingering as a partially constrained combinatorial optimisation, solved with model-based RL in an environment built from prior knowledge. The reward favours minimal finger motion, and scores are segmented so the work can be parallelised.
- **Claims:** no physically impossible fingerings, and less finger movement [27].
- **Evaluation:** no PIG match rates were found.
- **Related code:** `PianoFingering.jl` (Julia, GPL-3.0, archived in 2024, self-described as experimental) implements model-based RL (Dyna / Q-learning) with MusicXML and PIG input [28]. Its connection to [27] is unconfirmed.
- **Other RL code:** a Q-learning repository exists as well [62].
- **Observation:** RL has not been competitive on match rate. In one 2026 comparison, PPO policies trained on generated scales and chords reach only 39.9–44.8 M_gen (right hand) [42] (unverified).

### 2.19 2023–2026: datasets, robotics, generative models, and what is missing

**Hand-motion and video datasets with fingering:**

| Dataset | Year / venue | Size | How fingering was obtained | Licence / availability |
|---|---|---|---|---|
| APFD | 2019/2023 [14] | 90 pieces, 155k notes | YouTube video + MIDI, pose estimation | see [14] |
| PianoMotion10M | ICLR 2025 [33] | 1,966 videos, 116 h, 10M hand poses | bird's-eye internet videos | GitHub / Zenodo [33] |
| FürElise | SIGGRAPH Asia 2024 [34] | about 10 h, 15 elite pianists, 153 pieces | markerless multi-view 3-D capture refined with Disklavier key data | [34] |
| PiAnnotate layer on FürElise | arXiv 2026 [39] | 153 performances; 5.3M edited and 5.1M rule notes | rule-based labels plus expert editing in 3 review rounds; rule/edited agreement 91.82% | tool code MIT; edited labels **not released** |
| Tipiano | arXiv 2026 [38] | expert fingerings for FürElise (153 pieces) | expert annotation | – |
| PianoVAM | ISMIR 2025 [35] | 106 recordings, 10 amateurs, about 21 h, 1.05M notes | top-view video + MediaPipe hands + MIDI. A note is auto-labelled only when exactly one fingertip is a strong candidate; otherwise a human decides. About 95.6% precision on checked notes; about 13% of notes had no candidate | CC BY-NC 4.0 per paper; a 2026 paper could not obtain the labels [40] |
| ASDF annotation toolkit | ISMIR 2025 LBD [36] | – | web GUI for video-based fingering annotation | licence not stated |
| SKY-Piano | ISMIR 2026 [37] | about 11 h, 7 professional + 12 amateur pianists, motion capture | pseudo-labels from a fingering model and tool using MIDI + motion | see [37] |

**Robotics and simulation:**
- **RoboPianist** (CoRL 2023) uses PIG fingering labels as a *shaping reward* so that simulated hands can learn 150 pieces ("Repertoire-150", built from PIG) [30].
- **RP1M** (CoRL 2024) and **OmniPianist** (arXiv 2025) replace human fingering with an **optimal-transport assignment** of fingers to keys, so they need no labels [31], [32].
- These are offline, GPU-scale, and not usable in a browser. They are relevant to digitus2 only as possible future **physical-plausibility oracles** (§5).

**Diffusion.**
- FürElise uses a diffusion model to generate reference motions that supply trajectory and fingering information for a physics controller [34].
- PianoMotion10M uses a diffusion gesture generator [33].
- Tipiano reports F1 = 0.910 against 0.121 for diffusion baselines. The abstract does not say what the F1 measures [38].
- No diffusion model targets score-to-fingering prediction on PIG.

**Transformers.**
- The only transformer results found are a PPO transformer policy at 42.2 M_gen RH [42] (unverified) and PiAnnotate's tiny causal transformer (1 layer, d = 64). That probe flags rule-label errors, with 79.7% precision on 1.91% of notes flagged [39].
- No peer-reviewed transformer reports PIG results.

**LLMs.** No study evaluating large language models on piano fingering was found. A 2025–26 LLM score-understanding benchmark (MSU-Bench) contains no fingering tasks [57]. LLMs are in any case incompatible with digitus2's no-server constraint.

**Joint hand separation and fingering for transcription.** Penner & Hindle 2026, U. Alberta [40]:
- **Task:** assign hand and finger together, including an audio→MIDI→score pipeline.
- **Data:** 100 random 130/10 PIG splits.
- **Models:** Viterbi and beam-search variants with explicit rules (no crossing, RH above LH, chord ordering, ideal reach scaled by elapsed time), and KenLM trigram models over tokens such as `R3_dx2`.

Results [40]:

| Model | Hand accuracy | Joint hand + finger (M_rec) | Runtime |
|---|---|---|---|
| **"Synthesis"** (bidirectional Kalman filter for hands [41], then a first-order finger HMM) | **90.8** | **56.6** | 2.78 s |
| Best trigram model | 90.4 | 50.7 | – |
| Merged-output HMM (their re-implementation) | 67.4 | 39.7 | 498 s |

The runtime is a geometric mean per piece. The replication package is on Zenodo; no licence is stated [40]. Hadjakos et al. also proposed an RNN for MIDI hand detection that beats a heuristic baseline [41].

**`chirality` (2026; AGPL-3.0; single developer, not peer-reviewed)** [42]. A Python pipeline that re-implements the Parncutt, Jacobs, Balliauw and Al Kasimi rule sets with "paper reproduction" tests, Nakamura's HMMs (with reported bit-exact agreement with the reference binary), a PPO environment, and **Parncutt-rule weights learned with path-difference learning** (Radisavljevic & Driessen 2004 [73]; a structured perceptron, 5 epochs, learning rate 0.01, trained on PIG miscellaneous).

Reported results on the 30-piece PIG test set (10,225 notes) [42]:

| System | M_gen | M_high | M_soft | M_rec |
|---|---|---|---|---|
| Rule Viterbi, learned weights | 65.4 | 71.5 | 86.3 | 78.7 |
| Rule Viterbi, uniform weights | 64.9 | 71.7 | 85.9 | 78.1 |
| HMM3 | 64.4 | 70.9 | 85.5 | 77.8 |
| VNS (Jacobs rules) | 60.2 | – | – | – |
| Dijkstra (Jacobs rules) | 59.5 | – | – | – |
| Dijkstra (Parncutt rules) | 59.1 | – | – | – |
| Dijkstra (Al Kasimi rules) | 50.9 | – | – | – |

Learned weights (one multiplier per Parncutt rule) [42]:

| Rule | Weight | Rule | Weight |
|---|---|---|---|
| str | 0.6003 | 3t4 | 0.1013 |
| sma | 1.5466 | bl4 | 0.587 |
| lar | 1.0416 | bl1 | 0.607 |
| pcc | 0.6321 | bl5 | 0.3232 |
| pcs | 0.637 | **pa1** | **4.0985** |
| wea | 0.1328 | 345 | 0.3534 |

The resulting model makes thumb-passing much more expensive and nearly switches off the weak-finger rules. The repository does not document how chords are handled in its Viterbi [42].

**Other 2026 items found but not verified:**
- A journal paper on a web-based "adaptive GNN + RL" fingering system that fuses MIDI with 3-D joint tracking (ScienceDirect, 2026; the page was inaccessible) [76].
- Commercial AI fingering apps (§2.22).

### 2.20 Fingering as a basis for difficulty estimation

- **Nakamura et al. 2014.** $D(t) = -\ln P(p(t), f(t))/\Delta t$, the negative log-probability of notes and fingers per second in a sliding window, for each hand [8]. It was used to control playability in statistical piano reduction [43].
- **Ramoneda et al., ICASSP 2022** [20]:
  - **Dataset:** **Mikrokosmos-difficulty**, 147 Bartók pieces in 3 levels (volumes I–II, III–IV, V–VI) [64].
  - **Features:** per-onset 10-finger matrices from `pianoplayer` (finger + "velocity" cost) and from Nakamura's HMM (finger + transition probability).
  - **Classifiers:** XGBoost on segments and a GRU with attention.
  - **Finding:** fingering-based features beat a note-only baseline [20].
- **Ramoneda et al., ESWA 2024 (arXiv 2306.08480)** [21]:
  - **Dataset:** **CIPI**, 652 pieces by 29 composers, Henle levels 1–9.
  - **Features:** ArGNN decoder embeddings as "fingering" features.

  Results [21]:

  | Features | CIPI 9-class balanced accuracy | CIPI ±1 accuracy | Mikrokosmos 3-class |
  |---|---|---|---|
  | ArGNN fingering | 32.6% | 72.0% | 75.3% |
  | Fingering + expressiveness + pitch ensemble | 39.5% | 87.3% | – |
- **Later work.** A parameter-efficient, interpretable model reaches 41.4% on 9 classes [63]. Others include robot-hand-based difficulty (MOCO 2026) [67] and earlier descriptor sets (Sébastien et al. 2012; Chiu & Chen 2012, including a "hand displacement rate") [65], [66].

### 2.21 Biomechanical and hand-span models

**Parncutt's six spans** [1]:
- defined for an average adult male;
- scale them by about 0.9 for smaller hands;
- MaxPoss (anatomical maximum) data come from Wagner 1988 [71] (more than 200 pianists) and Matzdorff 1968 (more than 700 non-pianists); pianists' spans exceed non-pianists' [1].

**Balliauw** [13]: small, medium and large tables (octave, 9th and 10th maximum 1–5 span).

**`pianoplayer`** (Musy; MIT; PyPI) [29]:
- **Hand model:**
  - relaxed fingertip offsets (−7.0, −2.8, 0, 2.8, 5.6) cm for fingers 1–5;
  - scaled by a hand factor: XXS 0.33, XS 0.46, S 0.64, M 0.82, L 1.0, XL 1.1, XXL 1.2;
  - per-finger weights 1.1 / 1.0 / 1.1 / 0.9 / 0.8 and black-key factors 0.3 / 1.0 / 1.1 / 0.8 / 0.7, so a thumb on black costs about 3× more.
- **Cost:** the mean of $\text{speed} = \Delta x / (\Delta t + 0.1\,\text{s})$ divided by the finger weight, over a look-ahead window of 4–9 notes, searched depth-first.
- **Pruning rules:**
  - no same finger on consecutive *different* short notes;
  - no non-thumb crossing against the melodic direction;
  - no thumb onto a black key going up;
  - chord order and per-pair maximum chord stretch in cm: 3-4: 5, 4-5: 5, 2-3: 6, 2-4: 7, 3-5: 8, 2-5: 11, 1-2: 12, 1-3: 14, 1-4: 16. The measured distance is multiplied by hand factor/0.8 before comparison.
- **Features:** pre-fingered notes act as anchors.
- **Ports:** a JavaScript port runs fully in the browser [58].
- **Gaps:** no published PIG evaluation; hands are independent; ornaments are ignored [29].

**Yonebayashi's model** [5]: Gaussian outputs whose means follow finger distances and whose variances are larger for thumb pairs.

**Hand-span statistics** (Boyle, Boyle & Booker 2015; 473 adult pianists) [44]:
- mean thumb-to-fifth span 22.6 cm (8.9 in) for men and 20.1 cm (7.9 in) for women;
- small < 8.5 in, very small < 7.6 in;
- 8.5 in is the benchmark for comfortable octaves on the standard 16.5 cm octave.

**Small hands and children:**
- Children aged 6–12 are typically quoted around 15–20 cm. This figure comes from an educational exercise, not a pianist study [75]. PASK notes that children's hands vary greatly and that some ten-year-old boys have larger hands than most adult women [74].
- Wristen et al. 2006 (pilot, n = 2): small-handed pianists (span ≤ 8 in) on a 7/8-size keyboard showed smaller radial and ulnar hand-span angles and found playing easier [45].

**Physics simulation.** Robot and simulated hands [30]–[32], [34] can, in principle, check whether a fingering is physically executable at tempo. This is outside the browser budget.

### 2.22 Commercial and open-source tools

| Tool | What it is | Evidence of quality |
|---|---|---|
| `pianoplayer` [29] | Python CLI/GUI; MusicXML / MuseScore / MIDI / PIG; outputs MusicXML for MuseScore | Popular (about 900 GitHub stars [62]); MuseScore forum users report setup pain and that it helps only in simple cases [61] |
| Browser port of pianoplayer (`audiotool.monkeymore.app`) [58] | JavaScript, depth-limited search, runs in under 1 s | No evaluation |
| MuseScore | No built-in automatic piano fingering; the "Fingering Diagram" plugin is for wind instruments [61] | – |
| Dorico, Sibelius, Finale | Manual fingering entry. The Steinberg forum confirms Dorico has no automatic fingering; a third-party Finale script exists. Finale has been discontinued [60] | – |
| KeyGenius [59] | AI fingering on photos and PDFs, alpha | No accuracy claims |
| PineappleMusicLab [59] | AI fingering on PDF / MusicXML with editing | No public evaluation |
| Songscription [59] | Transcription service that lists a fingering generator | No method details |
| ROLI Learn "AI Music Coach" (2026) [59] | Hand tracking at 90 fps and feedback, not a fingering generator | – |
| UltraFingering [62] | Practice software (advertising repository only) | – |
| `chirality` [42], `PianoFingering.jl` [28], pydactyl [26], Q-learning repositories [62], an HMM-with-UI repository [62] | Research and open-source code | See above |

**Conclusion:** **no commercial product publishes a benchmark result.** A beginner-focused open tool with transparent evaluation would be novel.

---

## 3. Results leaderboard on PIG

All numbers are percentages. "Std" means trained on the 120-piece miscellaneous subset and tested on the 30 Bach/Mozart/Chopin pieces (10,225 notes). Rows from different groups below are **not strictly comparable**: the validation protocol, which annotations are kept, the evaluator wrapper, and note-weighting differ.

**A. Standard protocol, original paper** [9]. The α/λ coefficients were tuned for accuracy without a separate validation set.

| Method | M_gen | M_high | M_soft | M_rec |
|---|---|---|---|---|
| HMM1 | 61.7 | 68.3 | 82.8 | 74.0 |
| HMM2 | 64.3 | 70.8 | 85.3 | 77.6 |
| HMM3 | 64.5 | 71.0 | 85.5 | 77.8 |
| Chord HMM | 61.2 | 67.7 | 81.7 | 73.8 |
| DNN-FF | 61.5 | 66.2 | 82.5 | 69.5 |
| DNN-LSTM | 61.3 | 66.1 | 82.8 | 69.5 |
| **Human** (leave-one-annotator-out) | **71.4** | **79.1** | **90.8** | **84.3** |

**B. Same test set, other training details**

| Method | Protocol | M_gen | M_high | M_soft | M_rec | Source |
|---|---|---|---|---|---|---|
| BiLSTM, PIG only | std; one training piece used as dev | 64.1 | – | – | – | [14] |
| BiLSTM, APFD pre-train + PIG | as above | **66.8** | – | – | – | [14] |
| Linear-chain CRF (note-weighted) | std | 65.01 | 68.69 | 84.95 | – | [24] |
| Linear-chain CRF (unweighted) | std | 64.55 | 68.49 | 85.15 | – | [24] |
| PdF BiLSTM + transition constraints + augmentation | Nakamura's test set | ≈ HMM3 + 3.0 | ≈ HMM3 + 1.6 | – | – | [18] (figure only) |
| Parncutt rules, exact Viterbi, uniform weights | std (open-source) | 64.9 | 71.7 | 85.9 | 78.1 | [42] (unverified) |
| Parncutt rules, exact Viterbi, learned weights | std | 65.4 | 71.5 | 86.3 | 78.7 | [42] (unverified) |
| Re-implemented HMM3 | std | 64.4 | 70.9 | 85.5 | 77.8 | [42] |

**C. Ramoneda et al.'s protocol** (validation split taken from the training set; 20 test items by annotator "NE" removed, see §1.3; Python wrapper of the reference evaluator) [15]

| Method | M_gen | M_high | M_soft | M_rec |
|---|---|---|---|---|
| HMM1 | 61.77 | 67.66 | 81.09 | 73.15 |
| HMM2 | 63.78 | 69.49 | 83.59 | 76.12 |
| HMM3 | 63.63 | 69.40 | 83.05 | 75.42 |
| FF-base | 61.44 | 66.31 | 81.34 | 69.82 |
| LSTM-base | 62.71 | 67.34 | 82.69 | 71.09 |
| ArLSTM-Thumb-f | 65.34 | 71.73 | 85.49 | 77.80 |
| **ArGNN-Thumb-s** | **66.84** | **72.62** | **86.83** | **78.55** |
| Human (as reported) | 71.4 | 79.1 | 90.8 | 84.3 |

**D. The 14-piece "VNS set"** (the test pieces that the Balliauw program could parse) [9]

| Method | M_gen | M_high | M_soft | M_rec |
|---|---|---|---|---|
| HMM1 | 60.5 | 67.9 | 82.4 | 73.7 |
| HMM2 | 63.1 | 70.6 | 85.1 | 77.6 |
| DNN-LSTM | 59.8 | 64.6 | 82.6 | 67.9 |
| VNS [13] | 56.7 | 62.4 | 78.2 | 67.5 |
| Human | 70.2 | 78.9 | 91.0 | 84.5 |

**E. Not comparable** (different split, task or data)

| Method | Protocol | Result | Source |
|---|---|---|---|
| Checklist models | Moryossef-derived split, arpeggiated chords. Their HMM3 scores 70.2 on the same split | Best M_gen 69.5; best 4-gram 37.1 (HMM3: 39.5) | [16] |
| Guan, Yan & Hsu BiLSTM | RH only, chords removed, one composer subset held out at a time | 60.5 (Bach), 62.1 (Mozart), 67.9 (Chopin) | [17] |
| "Synthesis" (Kalman hands + HMM fingers) | 100 random 130/10 splits; joint hand + finger M_rec | 56.6 (hand accuracy 90.8) | [40] |
| Merged-output HMM | Own Bach/Beethoven corpus, leave-one-out | 56.0 RH / 55.4 LH | [8] |
| PPO policies | RH only, trained on generated exercises | 39.9–44.8 M_gen | [42] (unverified) |

**Reading the table:**
1. Every method in groups A–C lies between about 61 and 67 M_gen, against a human 71.4. Pre-training on large, noisy fingering data (APFD, ThumbSet) is the only ingredient that has clearly moved the needle, by +2 to +3 points over HMM3.
2. **M_rec separates models that keep sequences consistent** (HMMs, autoregressive networks: 74–79) from per-note classifiers (FF and LSTM: about 69.5). Use M_rec and the fluency metrics when choosing between models of similar M_gen [9], [15], [16].
3. Protocol effects reach about 1 point. HMM3 is 64.5 under the original protocol and 63.63 under Ramoneda's. Differences below about 1 point between papers should not drive design decisions.
4. A good rule-based engine reaches HMM level: 64.9 with equal weights and 65.4 with learned weights [42]. A re-run in this repository agrees (65.4 with uniform weights, 66.0 with weights learned here; `docs/research/baselines.md`), which removes the main argument for preferring a data-trained model in digitus2.

---

## 4. What makes a fingering good for a beginner

### 4.1 Sources and their stance

- **Historical treatises:** C. P. E. Bach (1753), Türk (1789), Clementi (1801), Czerny (1839) and Kullak (1876). Parncutt et al. summarise them as the origin of most of their rules [1]. C. P. E. Bach's chapter "On fingering" is available in translation [46].

  **Czerny's** own printed fingerings for op. 821 were one of the 28 "pianists" in Parncutt's experiment. Parncutt et al. characterise them as minimising difficulty, maximising possible tempo, and avoiding the older practice of crossing long fingers over each other [1].

  **Hanon**, *The Virtuoso Pianist* (1873), transposes one short figure stepwise up and back down two octaves, keeping the figure fixed. It explicitly targets thumb crossing and the weakness of fingers 4 and 5, and its Part III adds repeated notes, double notes, and scales in thirds and octaves. Its pedagogical value is contested (Whiteside, Taubman) [80]. For digitus2, the relevant ideas are the fixed fingering of a transposed figure (regularity) and the attention to fingers 4 and 5.

  Bardas, *Zur Psychologie der Klaviertechnik* (Berlin, 1927) [51], is a German classic on the psychology of technique. Its fingering rules could not be accessed for this survey. Gellrich & Parncutt (1998) revive a forgotten 18th–19th-century fingering method [72]. Musafia (1971) [8] and Bar-Niv (2012) [78] are book-length treatments of fingering.
- **Empirical studies:**
  - Clarke et al.'s interview study (*Talking Fingers*, 1997) [70] and Sloboda et al.'s sight-reading study (1998) [69] are summarised in [1]. Pianists use stronger fingers on metrical accents, change hand position at phrase boundaries, and use 4→3 about 45% more often than 3→4.
  - The PIG analysis [9] shows that most notes admit only one or two fingers.
- **Beginner method books:** *Faber Piano Adventures* Primer level is built on the **C 5-finger scale** and **Middle C** positions [48]. A companion Faber series introduces the Middle C, C major, G major and F major 5-finger positions at Level 1 [79]. Alfred's *Pentascale Pro* drills all 12 major and minor five-finger patterns [77]. The open textbook *Piano Basics* (Baylor) teaches the standard scale fingering: two hand positions per octave, with the thumb tucking under after 3 (RH ascending) and 3 crossing over on the way down. C, G, D, A and E major share one fingering [47].
- **Reference fingerings:**
  - **Scales and arpeggios:** the ABRSM *Manual of Scales, Broken Chords and Arpeggios* (Gerald, 2001) is the British standard [50]. Beringer & Dunhill's older manual is available machine-readable in pydactyl [26], [24].
  - **Penelope Roskell:** *The Complete Pianist* (Peters) and *The Art of Piano Fingering* cover ergonomic fingering principles and full scale and arpeggio charts. Both are paywalled, so only their tables of contents could be checked [49].
- **Repeated notes:** practising teachers recommend changing fingers on fast repetitions (3-2-1 is typical). For slow repetitions it is a choice: a finger change gives better legato, but the same finger is acceptable [52].
- **Small hands:**
  - Boyle et al. (2015): adult female pianists average a 20.1 cm thumb-to-fifth span [44].
  - The PASK benchmark for comfortable octaves on a standard 16.5 cm octave is 21.6 cm (8.5 in), so many women and most children cannot comfortably play octaves [44], [74].
  - Parncutt et al. note that pieces for beginners generally avoid octaves [1].

### 4.2 Principles turned into a checklist

Each principle carries a *beginner adjustment*: how digitus2 should weight it compared with models fitted to expert data such as PIG.

| # | Principle | Evidence | Beginner adjustment |
|---|---|---|---|
| P1 | **Five-finger positions.** Map consecutive scale steps to consecutive fingers ("next-note-next-finger"); stay in one position as long as possible. | Relaxed spans and rules 2–3 [1]; method books [48], [77], [47] | Stronger. Prefer an explicit position model (§6.6). |
| P2 | **Minimise position changes, and change position at rests, long notes or phrase ends.** | Rules 4–5 [1]; Clarke et al. via [1]; tradition back to Diruta and Sancta Maria [1] | Stronger. Add a "shift inside a phrase" cost. |
| P3 | **Keep the thumb (and, less strictly, the 5th finger) off black keys,** especially between white keys. | Rules 10–11 [1]; Kullak's hand-position difficulty ranking [1]; Bach and Türk via [1] | Stronger, except in black-key passages. |
| P4 | **Legal crossings only:** thumb under 2/3/4 and 2/3/4 over the thumb. **No non-thumb crossings.** Easiest: non-thumb on black passing to thumb on white. Hardest: thumb onto black from a white non-thumb key. | Rule 12 [1]; Clementi, Marpurg, Bach via [1]; pianoplayer pruning [29] | Make thumb-onto-black passes and non-thumb crossings hard errors. |
| P5 | **Use standard scale and arpeggio fingerings** wherever the music matches a scale or arpeggio fragment. | Cognitive principle 1 in [1]; [47], [50]; rudiments transfer to real music in CRF training [24] | Strong. Template matching (§6.6). |
| P6 | **Chords:** distinct fingers, no crossing, and finger gaps that match interval gaps. RH triads: root 1-3-5, first inversion 1-2-5, second inversion 1-3-5 or 1-2-4. LH: root 5-3-1, second inversion 5-2-1; sources disagree on the LH first inversion. | Hard constraints [6], [9], [13]; lessons [53]; relaxed spans reproduce these choices [1] | Same. Within-chord stretches get doubled cost, as in Balliauw rule 14 [13]. |
| P7 | **Repeated notes:** same finger when slow, alternate (3-2-1) when fast. | [52]; Balliauw rule 15 penalises needless finger changes [13]; Yonebayashi's failure on repeated short notes [5] | Use the same finger unless the inter-onset interval is below a threshold, for example 180 ms (to be tuned). |
| P8 | **Avoid "hops":** the same finger on consecutive *different* notes, unless there is a rest, a detached articulation, or a deliberate shift. | Never allowed in Parncutt's model [1]; "hops" metric [16]; Balliauw rule 12 [13] | Stronger. |
| P9 | **Agility:** avoid 3→4, runs of 3-4-5, and 3 on white with 4 on black. 4→3 is easier than 3→4. | Rules 7–9 and fn. 22 [1]; 3-4 coupling [13] | Same. Down-weight the generic weak-finger penalty, as Jacobs and the learned weights in [42] do. |
| P10 | **Strong fingers on metrical accents** and dynamic accents. | C. P. E. Bach and Clarke et al. via [1] | Mild. |
| P11 | **Consistency (rule of regularity):** finger identical passages identically, and transposed sequences too when their black/white pattern is the same. | Kullak, Werkenthin, Rosenbaum via [1] | Strong. Enforced in decoding (§6.6). |
| P12 | **Spans within the student's hand.** Stay within MaxComf and never exceed MaxPrac for the chosen hand size. Avoid octaves for small hands. | [1], [13], [44] | Choose a hand-size profile (§4.4). |
| P13 | **No finger substitutions** for beginners. | 0.34% of notes even in expert data [9] | Disable by default. |
| P14 | **Hands must not collide;** the RH stays above the LH unless the score crosses them. | [40] rules | Same. |
| P15 | **Tempo matters.** At speed, shifts and short fingers on black keys cost more. **Articulation matters.** Staccato tolerates more shifts and same-finger reuse. **Register matters.** In the high register, the RH thumb on isolated white keys is fine. | [1] | Scale costs by inter-onset interval (§6.3). |

### 4.3 "Fingering lint" rules

These rules run on any fingering, whether computed, imported from MusicXML, or typed by a teacher. Interval $i$ is the signed RH interval; mirror it for the LH. Spans come from the active hand profile (§4.4). Severity: **E** = error (physically implausible), **W** = warning (ergonomically poor), **I** = info. Default thresholds are proposals to calibrate on data (§5).

| ID | Sev. | Condition (per hand) | Source |
|---|---|---|---|
| L01 | E | Two simultaneous notes share a finger. Exception: thumb on two adjacent white keys, which is info only. | [13], [16] ("smears") |
| L02 | E | Chord with crossed fingers (finger order differs from pitch order). | [6], [9] |
| L03 | E | A finger used for a new key while it still holds a sustained key, without a notated substitution. | [6], [9] |
| L04 | E | More than 5 simultaneous notes in one hand. | [13] |
| L05 | E | Consecutive interval or chord span outside [MinPrac, MaxPrac] for the finger pair. | [1], [13] |
| L06 | E (beginner) / W | Non-thumb crossing, e.g. 3 over 4 or 2 over 3. | [1], [29] |
| L07 | W | Span outside [MinComf, MaxComf]: Stretch, cost 2 per unit. | [1] |
| L08 | W | Thumb on black; severity rises with white neighbours (Parncutt points 1 + 2 + 2). | [1] |
| L09 | W | 5th finger on black with a white neighbour. | [1] |
| L10 | E (beginner) / W | Thumb pass onto a black key from a white key played by another finger (3 points in [1]). | [1] |
| L11 | W | Same finger on consecutive different keys with an inter-onset interval below $\tau_{hop}$ (default 250 ms) and no rest between ("hop"). | [16], [13] (rule 12) |
| L12 | W | Fast repeated note (inter-onset interval below $\tau_{rep}$, default 180 ms) on the same finger. | [52] |
| L13 | I | Slow repeated note with a finger change: unnecessary for beginners. | [13] (rule 15) |
| L14 | W | Agility: 3→4, a 3-4-5 run, or 3 on white with 4 on black. | [1] |
| L15 | W | Position change (Parncutt rule 4) inside a phrase while a rest or long note lies within $k$ notes. | [1] (Clarke et al.) |
| L16 | W | Passage fits within a five-finger position (span within MaxRel of 1–5) but the fingering shifts. | [1], [48] |
| L17 | W | Identical passages (same pitches, rhythm, hand and preceding context) fingered differently. | [1] |
| L18 | I | Transposed sequence with the same black/white pattern fingered differently. | [1] |
| L19 | W | Scale or arpeggio fragment (4 or more notes) whose fingering deviates from the standard table. | [47], [50], [26] |
| L20 | I | Weak finger (4 or 5) on a metrical accent while a stronger finger is available at equal cost. | [1] |
| L21 | E | Hand collision: RH and LH key ranges overlap at the same time without a notated crossing. | [40] |
| L22 | W | Too many position changes per bar for the selected level (e.g. more than 1 at "Primer"). | proposal |
| L23 | I | Finger substitution present (discouraged for beginners). | [9] |

Status: `packages/engine/src/lint/rules.ts` implements L01 to L14 under these ids, with L06 and L10 as errors for beginners. Its L15 is a different rule (a thumb crossing inside one five-finger position, beginners only), and its L24 tells a beginner about the other thumb crossings. The catalogue's L15 to L23 are not implemented.

### 4.4 Hand-size profiles for beginners

Two families of tables are available:
- Parncutt's semitone tables [1], which the authors suggest scaling by about 0.9 for smaller hands;
- Balliauw's small, medium and large tables in 14-unit key distance [13], with thumb-to-fifth practical maxima of an octave, a 9th and a 10th.

Proposed digitus2 presets (calibrate with teachers):

| Preset | Intended user | Thumb–5 MaxPrac | Table |
|---|---|---|---|
| `child` | Roughly ages 6–10; 15–17 cm thumb–5 span | minor 7th to octave (10–12 semitones) | Balliauw "small" (octave), optionally reduced to a minor 7th for the smallest hands |
| `small` | Teen or adult, under 20 cm | octave | Balliauw "small" |
| `medium` | about 20–22 cm | 9th | Balliauw "medium" |
| `large` | over 22 cm | 10th | Balliauw "large", or Parncutt [1] |

Basis for the boundaries:
- The PASK benchmark of 21.6 cm (8.5 in) for comfortable octaves on a 16.5 cm octave [44], [74].
- Mean spans of 20.1 cm for adult women and 22.6 cm for adult men [44].
- The children's range comes from a non-pianist educational estimate [75], so treat it as a placeholder.

Status: the engine implements the presets as Parncutt's semitone tables scaled by 1.0 (`large`), 0.9 (`medium`), 0.8 (`small`) and 0.7 (`child`) (`packages/engine/src/fingering/params/profiles.json`), not as Balliauw's tables. The `small` and `child` factors are placeholders to calibrate with teachers.

---

## 5. Verification beyond match rate

Match rates against PIG are necessary for comparison with the literature but insufficient for a beginner tool:
- they reward agreement with expert, non-beginner fingerings;
- they cannot tell an "unusual but fine" fingering from an impossible one [16], [17], [18];
- the PIG licence restricts how PIG can be used (§6.9).

The proposals below are concrete and automatable. Items marked *(new)* are, as far as this survey found, not used in the published literature.

Status: built are the four PIG metrics (matching the Python reference evaluator), lint with a gate on errors per 1,000 notes (`benchmarks/floor.json`), the metamorphic tests MR1, MR2, MR6, MR7, MR8 and MR10 (`packages/engine/src/eval/metamorphic.ts`), and a weekly language-model teacher review that stands in for §5.7 (`docs/research/teacher-review.md`) and is never a gate. A human teacher study has not been run.

### 5.1 A metric suite (Python and TypeScript, kept in lock-step)

1. **The four PIG metrics,** with M_rec as in §1.4. Report both piece-averaged and note-weighted means [24]. Check against Nakamura's reference evaluator [11] on the released HMM outputs.
2. **Sequence metrics:**
   - anchored 4-gram precision;
   - counts per 100 notes of hops, smears, thumb crossings, non-thumb crossings and crossed chords;
   - mean step and chord spread [16];
   - change-position rate (CPR) [15];
   - IFR [18].
3. **Ergonomic cost per note** under each rule set: Parncutt, Jacobs, Balliauw. Report the mean and the 95th percentile, and compare with the human fingerings' cost on the same pieces. A model should not be systematically "easier" than humans on hard pieces, which would suggest it ignores musical constraints, nor much harder.
4. **Lint counts** per severity (§4.3). Gate: **zero E-level findings** in any shipped output.
5. **Difficulty curves** $D(t)$ [8] and rule-cost curves per bar, used for difficulty sanity checks (§5.8).

### 5.2 Metamorphic tests *(new as a test suite; the underlying symmetries are from [9], [15])*

| ID | Transformation | Expected relation | Rationale | Pass criterion |
|---|---|---|---|---|
| MR1 | **Octave transposition** of a whole hand part (±12, ±24 within range) | Identical fingering | Translation symmetry of lattice models [9]; octave augmentation [15]. Register effects are minor [1]. | 100% identical for interval or lattice models; ≥ 99% for neural models |
| MR2 | **Mirror the RH into the LH** by reflecting pitch about D, $p' = 2 \cdot 62 - p$, or about A♭. The black/white layout of the keyboard is symmetric about D and A♭. Swap the hand label. | LH fingering = RH fingering, note for note | Nakamura's reflection symmetry [9]; Ramoneda's "hand inversion" [15]. The symmetry is only approximate [9]. | ≥ 95% agreement (calibrate on human data); report a trend, do not hard-fail |
| MR3 | **Retrograde:** reverse the note order of a phrase | Fingering reversed | Time-inversion symmetry [9]; augmentation [15]. Approximate. | ≥ 90%; trend |
| MR4 | **Tempo scaling** ×0.8–1.25 | Timing-free models: identical. Timing-aware models: changes only at hops, repeated notes or shifts, and *monotone*: faster tempo never adds hops | Tempo effects [1]; repeated notes [52] | No non-monotone changes |
| MR5 | **White-key diatonic shift** of an all-white passage (e.g. C-D-E-F-G → D-E-F-G-A) | Identical fingering for five-finger-position passages | White-key lattice dx is unchanged [9], [42]; method-book five-finger positions [48] | 100% for passages within one position |
| MR6 | **Duplicate a passage,** repeating it after itself | Both copies get the same fingering (except at the boundaries) | Rule of regularity [1] | 100% after the consistency pass (§6.6) |
| MR7 | **Distant edit:** change one note more than 2 bars away, or after a rest | Fingering of the unaffected region unchanged | Locality; phrase-based fingering [24] | ≥ 99% unchanged beyond a rest |
| MR8 | **Smaller hand-size profile** | Max span used never increases, and total cost never decreases | Hand-size monotonicity [13] | Hard check |
| MR9 | **Clamp one note** to the human finger (an "anchor") | All other notes change only near the anchor; the M_gen of the anchored decode is at least the unanchored M_gen | Anchoring [5], [29] | Statistical test on PIG |
| MR10 | **Enharmonic respelling** (C♯ ↔ D♭) | Identical fingering | Physical key is the same; PIG parsers collapse spellings [42] | 100% |

### 5.3 Physical-plausibility linting as a hard gate

Lint rules L01–L06, L10 and L21 (§4.3) are hard constraints. Encode them in the decoder's state space, not only as post-hoc checks, so that the output is plausible by construction. Then run the lint again on every output (and on human data, to calibrate false positives).

Published neural models do not guarantee these constraints. The checklist paper reports 74–148 smears for its Bi-LSTM baselines on its PIG test split, against 7 in the gold data [16]. Neural outputs must therefore always be filtered or decoded under constraints.

### 5.4 Multi-annotator soft metrics *(partly new)*

- **Coverage@k.** Fraction of notes where at least one human finger is among the model's top-k per-note marginals (from forward–backward), for k = 1, 2. Evaluated with k = 1 on the decoded path, it equals M_soft. Most notes have only 1–2 human choices [9], so Coverage@2 should approach the human M_soft of 90.8.
- **M_rec sensitivity curve.** Recompute M_rec for $C_{rec} \in \{0, 0.5, 1, 2, \infty\}$ [9]. $C_{rec} = 0$ allows free switching wherever annotators agree; $C_{rec} = \infty$ allows no switching, which reduces to M_high. The curve shows whether errors come from local ambiguity or from incoherent sequences.
- **Recommender metrics.** ERR or nDCG over the N-best list [23], since teachers choose among alternatives.

### 5.5 Agreement with editorial fingerings from public-domain editions *(practice from [15], [24])*

Editorial fingerings are *sparse*: editors mark the decision points (shifts, crossings, ambiguous notes). Methods:
1. **Decision-point accuracy:** accuracy on marked notes only.
2. **Anchored-decode stability:** clamp all marked notes and decode. The unmarked notes' fingering should be nearly unchanged, otherwise the model disagrees with the editor's implied fingering.
3. **Source-weighted training data:** editions with known editors weigh more than anonymous MuseScore annotations [15].

Sources: ThumbSet-style extraction from public-domain MuseScore files [15]; Clementi Op. 36 multi-edition fingerings [24]; IMSLP editions [13]. Check each source's licence (§6.9).

### 5.6 Ensemble disagreement and uncertainty *(new for fingering)*

- **Per-note uncertainty signals:**
  1. HMM or CRF posterior marginals from forward–backward;
  2. the N-best cost margin (cost of the best alternative that differs at note $n$, minus the best cost);
  3. votes across an ensemble: rule-based with each hand profile, HMM2, HMM3, log-linear, optional neural.
- **Validation:** on PIG test pieces, the disagreement between annotators is known per note: the number of distinct fingers among 4–6 humans [9]. Compute AUROC for predicting "humans disagree" from model uncertainty. A good model is uncertain where humans are.
- **Product use:** highlight high-uncertainty notes for teacher review and offer alternatives. This turns ambiguity into pedagogy and fits the recommender framing [23].

### 5.7 Human evaluation protocol

- **Pairwise preference.** Blind A/B comparisons by piano teachers on beginner repertoire: model vs model, and model vs printed method-book fingering.
- **Ratings.** 1–5 Likert on physical comfort, mechanical efficiency and ease of learning, extending the 1–3 scales of [16].
- **Statistics.** Several raters, with inter-rater agreement reported. The single-rater, 10-song protocol of [16] is a minimum, not a target.
- **Free-text "why" comments.** Map them back to lint rules to discover missing rules.

### 5.8 Difficulty sanity checks

- **Grade correlation.** Fingering cost per note and $D(t)$ [8] should rise with graded level on Mikrokosmos-difficulty (3 levels) [20], [64] and on CIPI's Henle levels [21]. Use Spearman correlation.
- **Hand size.** Total cost should be higher for the small-hand profile, replicating [13].
- **Beginner pieces.** Method-book pieces at Primer and Level 1 should yield near-zero position changes and no thumb-on-black, with the printed fingering as the decoder's top choice. Test against a hand-entered set of method-book fingerings, kept internal because of copyright.

### 5.9 Golden tests

- **Parncutt Table 2:** all pairs and intervals (rules 1–3 combined), plus the A4–C4–A4–E5 → 4-1-2-5 (cost 15) example [1]. The `chirality` project shows these can be reproduced exactly [42].
- **Nakamura HMMs:** if licensing allows, reproduce the released `Result_FHMM{1,2,3}` outputs [11] bit-exactly with parameters trained on PIG miscellaneous [42]. Use this only to validate the decoder, not to ship.
- **Scales and arpeggios:** 100% match on the standard fingerings for all major and harmonic minor scales and root-position arpeggios. Use Beringer from pydactyl (MIT) [26]; cross-check with ABRSM [50].
- **Chords:** RH 1-3-5 for root-position triads and 1-2-5 for first inversion with the default profile [53]; LH 5-2-1 for second inversion.

---

## 6. Recommendation for digitus2

**Status.** Built as recommended, with these departures. Engine B is learned linear weights over the rule terms and indicator features (finger pairs, finger on a black or white key, lattice step), fitted with an averaged passive-aggressive structured perceptron; it has no HMM tables and no CRF. The shipped set `learned-open` is fitted on open data only (the textbook oracle, the Beringer corpus and the Mutopia train half), and PIG-fitted sets stay research-only (§6.9). The neural re-ranker (§6.8) is not built. Measured results are in `docs/experiments.md` and `benchmarks/history.md`; per-component status is in §6.10.

### 6.1 Decision

| Order | Component | Why | Accuracy expectation (PIG M_gen, research evaluation only) | Complexity | Browser cost |
|---|---|---|---|---|---|
| **1** | **Engine A: exact second-order Viterbi over ergonomic rule costs.** Parncutt 12 rules + Jacobs toggles + Balliauw chord rules 13–15 + beginner terms, with hand-size profiles. | No training data, so no licensing risk. Interpretable: each cost is a sum of named rule contributions, which drives explanations and lint. Exact DP fixes the weakness of earlier search-based solvers. Reproducible against published tables [1], [13]. | 59–65. Generic solvers reach about 59 [42]; an exact Viterbi reportedly 64.9 [42] (unverified). | Medium (rules) + low (DP) | < 10 ms per 1,000 notes (estimate) |
| **2** | **Engine B: the same decoder with learned weights.** A log-linear model over rule features + HMM features (Nakamura-style transition and lattice-interval log-probabilities) + timing. Also a pure HMM2/HMM3 mode. | HMMs and CRFs are the best-understood learned models (64.3–65.0) [9], [24]. Learned rule weights reportedly reach 65.4 [42]. Model files are kilobytes, and the decoder is shared with Engine A. | 64–66 (HMM3: 64.5 [9]; CRF: 65.0 [24]) | Medium (Python training + JSON) | same as Engine A |
| 3 (optional) | **Neural re-ranker / uncertainty:** an ArGNN-like encoder–decoder in ONNX Runtime Web, scoring Engine B's N-best list | Best published PIG numbers (66.84) [15]; gives uncertainty signals | +0.5 to +2 over Engine B (estimate) | High | about 1–2 MB model; tens to hundreds of ms per piece (estimate) |
| parallel | **Hand separation for MIDI import:** DP or Kalman filter over hand anchor positions, then per-hand fingering | Score input has staves, MIDI does not [8], [40], [41] | 90–93% note-level hand accuracy [8], [40] | Low–medium | negligible |

Why this order:
1. The accuracy gap between the cheapest credible model (HMM2: 64.3) and the best neural model (66.84) is only about 2.5 points, and about 1 point of that can come from protocol differences between papers alone (§3).
2. Beginner quality depends mostly on things match rates do not measure: hard constraints, consistency, positions, and standard fingerings. Those are easiest to guarantee in an explicit cost model.
3. Every data-trained model inherits training-data licensing questions (§6.9).

### 6.2 Pipeline

```
MusicXML ─┐                                      ┌─> lint (§4.3) ──> UI: fingering + explanations + alternatives
          ├─> notes ─> [hand separation*] ─> per-hand sequence ─> Engine A/B (Viterbi, N-best) ─┤
MIDI ─────┘   (*MIDI only; MusicXML uses staves)                                                └─> metrics/MR tests (CI)
```

### 6.3 Pre-processing

1. **Notes per hand.** For MusicXML, take the hand from the staff. Honour cross-staff notes when the staff assignment is explicit. For MIDI, run hand separation (§6.7).
2. **Slices.** Group notes whose onsets differ by at most ε into a slice: ε = 0 for score input; ε = 30 ms for performance MIDI [9], [24]. Within a slice, sort by ascending pitch.
3. **Sequence order.** Notes are ordered by slice, then by pitch. This is the "arpeggiated" order used by the HMMs [8], [9] and the checklist model [16].
4. **Mirroring the left hand.** For the rule engine, map each LH pitch to $p' = 124 - p$ (reflection about D4). The keyboard's black/white layout and key geometry are symmetric about D, so the LH problem becomes an RH problem *exactly*. Fingers are output unchanged. Learned models keep separate LH parameters, because statistical LH/RH reflection symmetry is only approximate [9].
5. **Geometry.** For each note compute:
   - the semitone pitch $p$;
   - the colour $y$ (1 = black);
   - the white-key column $x_w = 7\cdot(\text{octave}+1) + \text{col}(pc)$, with col = [0,0,1,1,2,3,3,4,4,5,5,6] for pitch classes C..B (black keys share the column of the white key below);
   - the 14-unit physical coordinate $x_{14} = 14\cdot(\text{octave}+1) + [0,1,2,3,4,6,7,8,9,10,11,12][pc]$ [13].

   Engine A's span tables can be in semitones (Parncutt [1]) or in 14-units (Balliauw [13]). Engine B's HMM features use $(\Delta x_w, \Delta y)$ with $\Delta x_w$ clipped to ±15, giving 93 bins [9], [42].
6. **Timing.** Compute the inter-onset interval $\text{IOI}_n = t_n - t_{n-1}$ (0 within a slice), rests, held notes, metric position, and slur and staccato marks when available.

### 6.4 Engine A: exact Viterbi over ergonomic costs

**Objective.** For one hand's sequence $f_{1:N}$:
$$J(f) = \sum_{n=1}^{N} u_n(f_n) + \sum_{n=2}^{N} b_n(f_{n-1}, f_n) + \sum_{n=3}^{N} c_n(f_{n-2}, f_{n-1}, f_n).$$

**Recursion.** The state is $s_n = (f_{n-1}, f_n)$, giving 25 states:
$$D_2(g,f) = u_1(g) + u_2(f) + b_2(g,f),\qquad D_n(g,f) = u_n(f) + b_n(g,f) + \min_{h}\big[D_{n-1}(h,g) + c_n(h,g,f)\big].$$
Store backpointers $\arg\min_h$. The answer is $\min_{g,f} D_N(g,f)$. The cost is $125N$ operations, so a 10,000-note piece takes about $1.25\times10^6$ additions.

**Hard constraints** (cost $+\infty$, i.e. state pruning):
- within a slice, fingers must strictly increase with pitch (RH after mirroring), which also makes them distinct [6], [9];
- consecutive span outside [MinPrac, MaxPrac]. Alternatively use Balliauw's soft +10 per unit [13] and let lint L05 catch violations;
- clamped "anchor" notes (teacher or editorial fingerings) [5], [29];
- busy fingers: see below.

**Unary terms** $u_n(f)$. Let $\text{prev}$ and $\text{next}$ be the neighbouring notes in melodic order; for chords, use the neighbouring slices' nearest notes.

| Term | Formula | Default weight | Source |
|---|---|---|---|
| Weak finger | $[f=4] + [f=5]\cdot\omega_5$, with $\omega_5 = 1$ (Parncutt) or 0 (Jacobs) | 1 | [1], [2] |
| Thumb on black | $[f=1 \wedge black_n]\,(1 + 2[white_{prev}] + 2[white_{next}])$ | 1 | [1] |
| Five on black | $[f=5 \wedge black_n]\,(2[white_{prev}] + 2[white_{next}])$ | 1 | [1] |
| Weak finger on accent (beginner) | $[f \in \{4,5\}]\cdot \text{accent}_n$ | 0.5 | [1] (P10) |
| Template bonus (beginner) | $-[f = \text{template}_n]$ inside a detected scale or arpeggio | 1–3 (tune) | [47], [50] (P5) |

**Pair terms** $b_n(g,f)$, with interval $i = p_n - p_{n-1}$ (or 14-units) and finger pair $(g \to f)$. Look the six spans up in the active profile's full 5×5 matrices, including reverse pairs (§2.1). Define the one-sided excesses
$\text{over}(v,M) = \max(0, v - M)$ and $\text{under}(v,m) = \max(0, m - v)$, and the thumb factor $\theta = 1$ if $1 \in \{g,f\}$, else 2.

*Melodic transition* (notes $n-1$ and $n$ in different slices):

| Term | Formula | Default weight | Source |
|---|---|---|---|
| Stretch | $\text{over}(i,\text{MaxComf}) + \text{under}(i,\text{MinComf})$ | 2 | rule 1 [1] |
| Small span | $\theta\cdot\text{under}(i,\text{MinRel})$ | 1 | rule 2 [1] |
| Large span | $\theta\cdot\text{over}(i,\text{MaxRel})$ | 1 | rule 3 [1] |
| Beyond practical (soft) | $\text{over}(i,\text{MaxPrac}) + \text{under}(i,\text{MinPrac})$ | 10 | rule 13 [13] |
| Three-to-four | $[g=3 \wedge f=4]$ | 1 | rule 8 [1] |
| Four on black | $[\{g,f\}=\{3,4\} \wedge white(\text{note of 3}) \wedge black(\text{note of 4})]$ | 1 | rule 9 [1] |
| Thumb passing | if $1\in\{g,f\}$ and $(f-g)\cdot i < 0$: 1 for the same level, 3 for a white non-thumb note below a black thumb note | 1 | rule 12 [1] |
| Hop (beginner) | $[g=f \wedge i\ne0]\cdot h(\text{IOI})$, with $h = 2$ if IOI < 250 ms, else 0.5; 0 across a rest | 1 | P8 [16], [1] |
| Repeated note | if $i=0$: $[g\ne f]\cdot r_{slow}$ when IOI ≥ 180 ms, and $[g=f]\cdot r_{fast}$ when IOI < 180 ms | $r_{slow}=1$, $r_{fast}=2$ | P7 [13], [52] |
| Timing-scaled shift | $\text{shift}(g,f,i)\cdot\frac{\tau}{\text{IOI}+\tau}$, with τ = 0.1 s | 0 in phase 1; learn in phase 2 | [29], [40] |

*Same finger on a different key* ($g = f$, $i \ne 0$). Parncutt forbids this outright [1]. Balliauw's zero diagonal spans make it cost +10 per unit [13]. Humans do it occasionally: 155 "hops" appear in the gold fingerings of Srivatsan & Berg-Kirkpatrick's PIG test split [16]. So for $g = f$ skip the span terms and charge only the hop term (and, in Phase 2, its learned weight).

*Within-chord transition* (same slice). This is Balliauw rule 14 [13]: the hard no-crossing constraint, plus $2\times$(Stretch + Small span + Large span), plus 10 × beyond-practical.

**Triple terms** $c_n(h,g,f)$. Apply them only when notes $n-2$, $n-1$, $n$ are in three different slices (a melodic context). Let $i_{13} = p_n - p_{n-2}$, with fingers $(h \to f)$ and middle finger $g$.

| Term | Formula | Default weight | Source |
|---|---|---|---|
| Position-change count | if $p_n = p_{n-2}$ and $h \ne f$: 1. Else, if $i_{13} > \text{MaxComf}(h,f)$ or $< \text{MinComf}(h,f)$: 2 when $g=1 \wedge p_{n-1}$ strictly between $\wedge$ $i_{13}$ is outside [MinPrac, MaxPrac], otherwise 1 | 1 | rule 4 [1] |
| Position-change size | 0 when $p_n=p_{n-2}$; else $\text{over}(i_{13},\text{MaxComf}(h,f)) + \text{under}(i_{13},\text{MinComf}(h,f))$ | 1 | rule 5 [1] |
| Three-four-five | $[\{h,g,f\}=\{3,4,5\}]$ | 1 (0 for Jacobs) | rule 7 [1], [2] |
| Same finger around a pivot | $[h=f \wedge p_{n-2}\ne p_n \wedge p_{n-1}$ between them$]$ | 1 | rule 12 [13] |
| Alternation (optional) | $[(h,g,f)\in\{(3,4,3),(4,3,4),(4,5,4),(5,4,5)\}]$ | 1 | Badgerow variant [26] |

The diagonal spans are $\text{MaxComf}(h,h) = \text{MinComf}(h,h) = 0$, so the same finger on notes 1 and 3 with a non-zero interval counts as a position change [1].

**Busy fingers** (held notes):
1. The DP knows fingers two steps back. Forbid $f_n \in \{f_{n-1}, f_{n-2}\}$ whenever the corresponding note is still sounding at $t_n$ (pedal ignored).
2. For longer holds, use a **constraint-generation loop**: decode; find L03 conflicts; forbid the conflicting finger at the offending note; re-decode. Two or three iterations normally suffice (an estimate).
3. If a piece has many held voices, as in Bach-style polyphony, switch to Al Kasimi's slice trellis [6]. There a state is the finger assignment of *all sounding notes*, transitions must keep held notes' fingers, and the same cost library applies to the outer voices. States per slice are at most $\binom{5}{K}$, at most 10.

**N-best and explanations.**
- Implement k-best Viterbi (k ≈ 5) to offer alternatives, matching the recommender framing [23].
- Because $J$ is a sum of named terms, the UI can show each note's top contributions, for example "thumb on black between white keys: 5 points".

**Hand profiles.** Swap the span matrices (§4.4). The decoder does not change.

**Validation.** Use the golden tests of §5.9, then PIG test M_gen (research use).

```ts
// Engine A/B decoder core (second-order Viterbi); costs injected as functions or precomputed tables.
type Cost = (n: number, h: number, g: number, f: number) => number; // returns +Infinity for infeasible
function viterbi2(N: number, unary: (n:number,f:number)=>number,
                  pair: (n:number,g:number,f:number)=>number,
                  triple: Cost): number[] {
  const F = 5, INF = Number.POSITIVE_INFINITY;
  if (N === 1) { let best = 0; for (let f = 1; f < F; f++) if (unary(0,f) < unary(0,best)) best = f; return [best + 1]; }
  let D = new Float64Array(F*F).fill(INF);                  // D[g*F+f] for (f_{n-1}=g, f_n=f)
  const back: Int8Array[] = [];
  for (let g = 0; g < F; g++) for (let f = 0; f < F; f++)
    D[g*F+f] = unary(0,g) + unary(1,f) + pair(1,g,f);
  for (let n = 2; n < N; n++) {
    const Dn = new Float64Array(F*F).fill(INF), bp = new Int8Array(F*F).fill(-1);
    for (let g = 0; g < F; g++) for (let f = 0; f < F; f++) {
      const local = unary(n,f) + pair(n,g,f);
      if (local === INF) continue;
      let best = INF, arg = -1;
      for (let h = 0; h < F; h++) {
        const v = D[h*F+g] + triple(n,h,g,f);
        if (v < best) { best = v; arg = h; }
      }
      Dn[g*F+f] = best + local; bp[g*F+f] = arg;
    }
    back.push(bp); D = Dn;
  }
  let bi = 0; for (let k = 1; k < F*F; k++) if (D[k] < D[bi]) bi = k;
  const out = new Array<number>(N); out[N-1] = bi % F; out[N-2] = Math.floor(bi / F);
  for (let n = N-1; n >= 2; n--) out[n-2] = back[n-2][out[n-1]*F + out[n]];
  return out.map(f => f + 1);                               // fingers 1..5
}
```

### 6.5 Engine B: learned models in Python, exported to JSON

**(a) Pure HMM mode, as in Nakamura et al. [9].** Per hand $h$, order $m \in \{2, 3\}$:
$$\log P(f,p) = \sum_n \Big[\log \tilde P_h(f_n \mid f_{n-m:n-1}) + \sum_{l=1}^{m} \alpha_l \log F^{h}_l\big(\Delta(p_{n-l},p_n);\, f_{n-l}, f_n\big) + \kappa\,[\text{crossing within a 30 ms chord}]\Big]$$
- $\tilde P$ is linearly interpolated across orders (Eq. 10 of [9]).
- $\Delta$ is the lattice bin (93 bins).
- κ = −∞ in the paper, or −5 in a reference-matching re-implementation [9], [42].
- **Decoding:** Engine A's decoder with $u, b, c$ set to the negated log-terms (order 2). For order 3, use the analogous third-order recursion: states $(f_{n-2}, f_{n-1}, f_n)$, 125 states and 625 transitions per note.
- **Training:**
  1. count transitions and per-lag output tables (add-α smoothing, e.g. 0.1 [8]);
  2. tune $\alpha_l$, $\lambda_l$ and κ on a *held-out validation set*, avoiding the test-set tuning criticised in [15];
  3. export.

**(b) Log-linear model (recommended Engine B).** Cost $J_w(f) = w^\top \Phi(x, f)$, where $\Phi$ decomposes into the same unary, pair and triple terms as §6.4, so the same Viterbi applies. Features:
- every rule quantity in §6.4 as a separate feature, using the semitone counts without built-in multipliers;
- HMM log-probabilities as features: $-\log\tilde P(f_n\mid\cdot)$ and $-\log F_l(\cdot)$ for $l = 1..3$, from §6.5(a);
- timing interactions: hop × [IOI bucket], shift × $\tau/(\text{IOI}+\tau)$, repeated-note × [IOI bucket];
- position and template features (§6.6);
- separate weight copies per hand where data allow.

Training options:
1. **Structured perceptron / path-difference learning** [73], [42]: decode $\hat f = \arg\min_f w^\top\Phi(x,f)$; pick the target $f^\star$ as the annotator fingering (or its recombination, §1.4) *closest* to $\hat f$; update $w \leftarrow w + \eta\,(\Phi(x,\hat f) - \Phi(x, f^\star))$; project penalty weights to $w \ge 0$; average the weights. Choosing the closest annotator as the target is a latent-structure variant, *(new)*, suited to multiple valid answers.
2. **CRF** [24]: $P_w(f\mid x) = \exp(-J_w(f))/Z(x)$. Maximise $\sum_{\text{pieces}} \log \sum_{g} P_w(f^{(g)} \mid x)$, the marginal over annotators, with L2 regularisation, computing $Z$ by the forward algorithm on the second-order trellis. The CRF also yields calibrated per-note marginals for uncertainty (§5.6). An existing pure-Python linear-chain CRF (MIT) exists [26] (`dvdrndlph/crf`).

**JSON export** (one file per model and version, a few KB to a few hundred KB):
```json
{
  "schema": "digitus2.fingering-model/1",
  "geometry": {"spans": "semitone", "lattice": "whiteColumn", "dxClip": 15, "chordEpsilonSec": 0.03},
  "handProfiles": {"small": {"MaxPrac": [[0,10,12,13,14],[...]], "MaxComf": [[...]], "MaxRel": [[...]]}},
  "features": ["str","sma","lar","beyondPrac","pcc","pcs","wea4","wea5","t345","t3to4","bl4","bl1","bl5","pa1",
               "hopFast","hopSlow","repSameFast","repChangeSlow","shiftTimed","hmmTrans","hmmOut1","hmmOut2","template","positionShift"],
  "weights": {"R": [ ... ], "L": [ ... ]},
  "hmm": {"order": 2, "R": {"init": [5], "trans1": [[5,5]], "trans2": [[25,5]], "out": [[[5,5,93]],[[5,5,93]]]},
          "L": { ... }, "alpha": [0.556, 0.407], "lambda": [0.474]},
  "thresholds": {"hopSec": 0.25, "repeatSec": 0.18, "restBreaksContext": true},
  "provenance": {"trainingData": ["..."], "licence": "...", "commit": "..."}
}
```
In the snippet, `[5]` and `[[5,5]]` stand for arrays of those shapes. The HMM α/λ values shown are Nakamura's [9] and must be re-tuned on our own training data.

The shipped weight files use a simpler schema, `digitus2.weights/1` (`packages/engine/src/fingering/params/weightSets.ts`): one weight per rule id, a confidence temperature and the provenance of the fit.

**Parity.** Generate features in Python and TypeScript from one shared specification. Add a CI test that compares per-note feature vectors and decoded outputs on a fixed corpus.

### 6.6 Beginner-specific extensions

1. **Hand-position model** (P1, P2). Define the implied hand anchor of note $n$ played by finger $f$ as $a_n = x_w(p_n) - o_f$, with relaxed diatonic offsets $o = (0,1,2,3,4)$ white columns for fingers 1..5 (RH, after mirroring). Use $x_{14}/2$ instead of $x_w$ for half-key resolution on black keys. A position change is $a_n \ne a_{n-1}$. Its cost is $|a_n - a_{n-1}|$, discounted when the transition crosses a rest, a long note or a phrase end. This is a pair term, so the DP stays exact. It formalises Parncutt's "next-note-next-finger" principle and the method-book five-finger positions [1], [48].
2. **Standard fingering templates** (P5).
   - *Detection:* runs of ≥ 4 notes moving by diatonic steps in one direction within a key (scales), and broken triads (arpeggios).
   - *Use:* add a unary bonus for matching the standard fingering, aligned to the run's start note and key. Take the tables from Beringer (pydactyl, MIT) [26], cross-checked against ABRSM [50].
   - The CRF study suggests these rudiments transfer to real music [24].
3. **Consistency across repeats** (P11).
   - Detect repeated segments: same hand, the same sequence of (pitch interval, duration, inter-onset interval), at least 4 notes, using rolling hashes.
   - Decode once. For each group of repeats, evaluate every distinct candidate fingering among the copies' decodes and N-best lists *in every copy's context*, choose the one with minimum total cost, clamp it, and re-decode the boundaries.
   - Treat sequences that have the same black/white pattern the same way, with an option to switch this off.
4. **Hand-size profiles** (§4.4). Expose them as a user setting with `child` / `small` as defaults for beginners.
5. **Teacher anchors.** Fingers given in the score are clamped, as proposed in [5] and implemented in [29].
6. **Level-dependent weights.** "Primer" raises the weights for position shifts, thumb-on-black and hops, and disables substitutions and non-thumb crossings. "Intermediate" moves towards the expert-fitted weights.

Status: all six are built: the five-finger-position term (`handPositionShift`), standard-fingering templates, the consistent-repeats pass, hand-size profiles, pinned fingers (teacher and editorial anchors), and level-dependent weights (`profiles-weights.json`, CLI `--level beginner|expert`).

### 6.7 Hand separation for MIDI import

Option 1 is the **pitch-trajectory DP**, the recommended starting point. It is in the spirit of the merged-output pitch model of [8] and the Kalman approach of [41], [40].
- **Per slice** $k$ with $m_k$ notes sorted by pitch: choose a split $s_k \in \{0..m_k\}$, with notes below $s_k$ going to the LH.
- **Constraints:** at most 5 notes per hand per slice; each hand's chord span ≤ the profile's MaxPrac(1,5) plus a tolerance (soft).
- **State:** $(\ell_k, r_k)$, the representative pitch (chord centre) of each hand, carried forward when a hand is silent.
- **Cost:**
  $$-\log P_L(\ell_k-\ell_{k-1}) - \log P_R(r_k - r_{k-1}) + \mu\,[\max \text{LH} > \min \text{RH}] + \nu\,[\text{a hand idle} > T].$$
  $P_L$ and $P_R$ are per-hand histograms of pitch movement, learned from MusicXML corpora with staves [8].
- **Search:** keep a beam of about 64 states per slice. This is fast enough for whole pieces.
- **Expected accuracy:** about 91–93% of notes. Nakamura's merged-output HMM had 7.1% error on its corpus [8]; Penner & Hindle's Kalman-based "Synthesis" reached 90.8% on PIG [40]. Expect the most errors in textures with wide hand movements, such as Debussy at 18.7% [8].

Option 2 is **joint refinement**. After per-hand fingering, if a hand has E-level lint (span or more than 5 notes), try moving the boundary notes of that slice to the other hand and re-decode locally. Balliauw et al. list this as future work [13]. It was not evaluated in the literature found.

Status: option 1 is built as `separateHands` (`packages/engine/src/io/midi/handSeparation.ts`; beam 64, learned movement, span, position and pattern tables). It gives 92.05% of PIG test notes the ground-truth hand (macro average over the 30 test pieces, after the score is played as MIDI; `benchmarks/history.md`, section Hand separation).

### 6.8 Optional Phase 3: neural re-ranker

- **Model:** an ArGNN-style encoder (3 gated-graph layers over *onset* and *next* edges, hidden 32–64) with an autoregressive LSTM decoder [15]. It is pure PyTorch with dense adjacency [15], so ONNX export covers the encoder and one decoder step.
- **Use:** score Engine B's k-best candidates (teacher-forced log-likelihood) and output $\arg\min_f [J_w(f) - \beta \log P_{NN}(f\mid x)]$. Also expose $P_{NN}$ disagreement as uncertainty.
- **Latency:** restrict rescoring to windows where candidates differ, to bound cost. Ramoneda et al. measured 162 ms per test piece for ArGNN beam search on a CPU [15]; browser figures will differ.
- **Data:** ThumbSet-style pre-training is what made ArGNN work [15]. digitus2 would need its own permissively licensed corpus (§6.9). Deprioritise until Engines A and B have been evaluated with teachers.

### 6.9 Licensing and data plan (not legal advice)

| Resource | Terms | Use in digitus2 |
|---|---|---|
| PIG dataset [10] | Non-profit academic use only | Research evaluation; shipping weights trained on it needs the maintainers' permission |
| Nakamura code and parameters [11] | No licence stated; described as noncommercial [20] | Re-implement from the paper; do not copy |
| ThumbSet [15] | Access on request | Same caution as PIG |
| PianoVAM [35] | CC BY-NC 4.0 | Non-commercial only |
| `pianoplayer` [29] | MIT | Safe to port |
| `pydactyl` + Beringer corpus [26] | MIT | Safe; a good source for scale and arpeggio templates and training rudiments |
| ArGNN code [15] | MIT | Code reusable; the weights inherit their data terms |
| `chirality` [42] | AGPL-3.0 | Read for ideas only, unless digitus2 is AGPL-compatible |
| `PianoFingering.jl` [28] | GPL-3.0 | Same caution |
| Balliauw C++ [13] | No licence stated | Re-implement from the paper |

**Data plan:**
1. Rudiments: Beringer (MIT) plus generated scales, arpeggios and five-finger patterns in all keys.
2. Teacher-annotated beginner pieces, public-domain or commissioned, licensed CC BY or CC0, collected with a PiAnnotate- or ASDF-like annotation UI [39], [36].
3. Public-domain editorial fingerings, after checking each source's terms.
4. PIG for comparison with the literature, for research only, unless permission is obtained.

Status: the shipped weights use items 1 and 3 (Beringer, the textbook scales and arpeggios, and Mutopia editorial fingerings); item 2 (teacher-annotated beginner pieces) is not done; PIG serves research evaluation only.

### 6.10 Components and acceptance criteria

| Component | Deliverable | Acceptance | Status |
|---|---|---|---|
| Evaluation harness | Evaluation harness (TS + Python), PIG reader, metrics, lint, metamorphic tests | Metrics equal the reference evaluator [11] to 0.01 on released outputs; tests run in CI | Built (`packages/engine/src/eval`, `src/lint`). The four metrics agree with the Python reference to 1e-6 on a real PIG piece. |
| Engine A | Engine A + hand profiles + anchors + N-best + explanations | Parncutt Table 2 and the 4-1-2-5 example exact [1]; standard scales 100%; zero E-lint; MR1/MR5/MR6/MR8/MR10 pass; < 50 ms per 1,000 notes in the browser; PIG M_gen reported (target ≥ 62; 64+ would replicate [42]) | Built (`packages/engine/src/fingering`) with per-note alternatives and term explanations instead of a k-best list. With the literature-default weights it scored 59.7 M_gen on the PIG test split when first built and 61.9 after hardening (`benchmarks/history.md`). |
| Engine B | Engine B (HMM mode + log-linear), JSON models, parity tests | Under the standard protocol, ≥ HMM3 (64.5) with PIG-trained research weights; report the drop with permissive-only weights; M_rec ≥ 77; hops and smears at least as low as HMM3's [16] | Built as learned weights, without an HMM mode. PIG-trained research weights score 67.7 M_gen and 80.7 M_rec; the shipped open-data set `learned-open` scores 63.9 and 76.4, a drop of 3.8 M_gen (`benchmarks/history.md`). |
| Hand separation | Hand separation for MIDI import | ≥ 90% note-level hand accuracy on score-derived MIDI and on PIG [40] | Built (§6.7); 92.05% on the PIG test split. |
| Neural re-ranker (optional) | Neural re-ranker | +1 M_gen over Engine B with no increase in E-lint, hops or smears | Not built. |
| Teacher study | Teacher study | Pairwise preference ≥ 60% for digitus2 over the Engine B baseline on beginner pieces; inter-rater agreement reported (§5.7) | Not run with human teachers. The language-model review of §5 is built so that its batch files can go to a human teacher unchanged (`docs/research/teacher-review.md`). |

---

## 7. Open questions and risks

1. **Does the "exact rule Viterbi = HMM3" result reproduce?** It is reported by one developer, without peer review [42]. It reproduces for chirality's implementation: 65.4 M_gen with uniform weights and 66.0 with weights learned here, against 65.0 for HMM3 (`docs/research/baselines.md`); the paired-bootstrap interval of the learned-weights run against HMM3 includes 0. digitus2's own engine with the literature-default weights scored 59.7 M_gen when first built and 61.9 after hardening, and open-data learned weights score 63.9 (`benchmarks/history.md`).
2. **No beginner ground truth.** PIG is advanced classical repertoire by experienced pianists [9]. A small, permissively licensed beginner corpus is needed to tune Engine B for digitus2's audience (§6.9). The shipped weights are fitted on the textbook oracle, Beringer and Mutopia editorial fingerings (`docs/research/textbook-oracle.md`, `docs/research/datasets.md`), which are not beginner-specific.
3. **Polyphony within one hand.** Even the best models struggle with successive chords [16]. Rule chords [13] and slice trellises [6] are untested on PIG beyond the chord HMM (61.2) [9].
4. **Interaction between hands.** It is not modelled by any method that reports PIG results [9]. Parncutt, Sloboda & Clarke (1999) studied hand interdependence in parallel melodic music (cited in [13]).
5. **Timing, articulation, pedal and tempo** are largely unused because PIG timings are score-derived [24]. MusicXML tempo, slurs and staccato can still provide these signals for digitus2.
6. **Hand-size calibration for children** relies on non-pianist estimates [75]. Validate the presets with teachers.
7. **Metric validity.** Hand-assignment ambiguity in PIG [24] and inconsistent human-ceiling re-measurements (§1.5) argue for a self-built, tested metric implementation.

---

## 8. Glossary

- **M_gen / M_high / M_soft / M_rec:** the PIG match rates (§1.4) [9].
- **MinPrac / MinComf / MinRel / MaxRel / MaxComf / MaxPrac:** Parncutt's six span limits per finger pair: practical, comfortable and relaxed minimum and maximum intervals [1].
- **Lattice:** a 2-D keyboard coordinate (white-key column, black/white row) used by HMMs and neural models [9], [16].
- **Slice:** the set of notes with (near-)simultaneous onsets; a chord within one hand.
- **Hop:** the same finger on two consecutive different keys [16].
- **Smear:** one finger on several simultaneous keys [16].
- **CPR:** change-position rate, the number of crossings and shifts relative to the human average [15].
- **IFR:** incapable-performing fingering rate, the share of rule-defined impossible transitions [18].
- **Substitution:** a silent change of finger on a held key, notated `a_b` [9].
- **Anchor:** a note whose finger is fixed in advance (by the score or a teacher) and is clamped during decoding [5], [29].

---

## 9. References

Every URL was accessed in October 2026. "(via [k])" means the item was not read directly and is cited through reference k.

1. Parncutt, R., Sloboda, J. A., Clarke, E. F., Raekallio, M., & Desain, P. (1997). An ergonomic model of keyboard fingering for melodic fragments. *Music Perception* 14(4):341–382. PDF: https://static.uni-graz.at/fileadmin/_Persoenliche_Webseite/parncutt_richard/Pdfs/PaSlClRaDe97_FingeringModel.pdf
2. Jacobs, J. P. (2001). Refinements to the ergonomic model for keyboard fingering of Parncutt, Sloboda, Clarke, Raekallio, and Desain. *Music Perception* 18(4):505–511. https://doi.org/10.1525/mp.2001.18.4.505 (paywalled; content via [18], [26], [42])
3. Hart, M., Bosch, R., & Tsai, E. (2000). Finding optimal piano fingerings. *The UMAP Journal* 21(2):167–177. https://comap.com/membership/member-resources/item/finding-optimal-piano-fingerings-umap (paywalled; tables via [26])
4. Lin, C.-C., & Liu, D. S.-M. (2006). An intelligent virtual piano tutor. *Proc. ACM VRCIA 2006*, 353–356. https://doi.org/10.1145/1128923.1128986
5. Yonebayashi, Y., Kameoka, H., & Sagayama, S. (2007). Automatic decision of piano fingering based on hidden Markov models. *IJCAI 2007*, 2915–2921. https://www.ijcai.org/Proceedings/07/Papers/469.pdf
6. Al Kasimi, A., Nichols, E., & Raphael, C. (2007). A simple algorithm for automatic generation of polyphonic piano fingerings. *ISMIR 2007*, 355–356. https://archives.ismir.net/ismir2007/paper/000355.pdf
7. Al Kasimi, A., Nichols, E., & Raphael, C. (2005). Automatic Fingering System (AFS). ISMIR 2005 poster (via [5]; the original URL in [5] is no longer verified).
8. Nakamura, E., Ono, N., & Sagayama, S. (2014). Merged-output HMM for piano fingering of both hands. *ISMIR 2014*, 531–536. https://archives.ismir.net/ismir2014/paper/000251.pdf
9. Nakamura, E., Saito, Y., & Yoshii, K. (2020). Statistical learning and estimation of piano fingering. *Information Sciences* 517:68–85. https://doi.org/10.1016/j.ins.2019.12.068 ; arXiv: https://arxiv.org/abs/1904.10237
10. PIG Dataset (Piano Fingering Dataset), v1.12. https://beam.kisarazu.ac.jp/research/PianoFingeringDataset/
11. Nakamura, E. Companion page with source code (SourceCode_v190921.zip), results (Result_FHMM1–3) and visualiser. https://statpianofingering.github.io/demo.html
12. Balliauw, M., Herremans, D., Palhazi Cuervo, D., & Sörensen, K. (2015). Generating fingerings for polyphonic piano music with a tabu search algorithm. *MCM 2015*, LNCS 9110, 149–160. https://doi.org/10.1007/978-3-319-20603-5_15
13. Balliauw, M., Herremans, D., Palhazi Cuervo, D., & Sörensen, K. (2017). A variable neighborhood search algorithm to generate piano fingerings for polyphonic sheet music. *International Transactions in Operational Research* 24(3):509–535. https://doi.org/10.1111/itor.12211 ; preprint: https://dorienherremans.com/sites/default/files/ITOR_VNS_APF_preprint.pdf ; code page: http://dorienherremans.com/automatic-piano-fingerings
14. Moryossef, A., Elazar, Y., & Goldberg, Y. (2019/2023). At your fingertips: Extracting piano fingering instructions from videos. arXiv:2303.03745 (paper from 2019; OpenReview version titled "Automatic piano fingering detection"). https://arxiv.org/abs/2303.03745
15. Ramoneda, P., Jeong, D., Nakamura, E., Serra, X., & Miron, M. (2022). Automatic piano fingering from partially annotated scores using autoregressive neural networks. *ACM Multimedia 2022*, 6502–6510. https://doi.org/10.1145/3503161.3548372 ; author copy: https://eita-nakamura.github.io/articles/Ramoneda_PianoFingeringFromPartiallyAnnotatedScores_2022.pdf ; code (MIT): https://github.com/PRamoneda/Automatic-Piano-Fingering ; ThumbSet: https://zenodo.org/records/6433702
16. Srivatsan, N., & Berg-Kirkpatrick, T. (2022). Checklist models for improved output fluency in piano fingering prediction. *ISMIR 2022*. https://arxiv.org/abs/2209.05622 ; https://archives.ismir.net/ismir2022/paper/000063.pdf
17. Guan, H., Yan, Z., & Hsu, T. (2021). Automatic piano fingering estimation using recurrent neural networks. *Nordic SMC 2021*. https://zenodo.org/records/5723888
18. Zhao, H., Guan, X., & Li, Q. (2021/2022). Estimation of playable piano fingering by pitch-difference fingering match model. arXiv:2108.09058; *EURASIP J. Audio, Speech, and Music Processing* 2022. https://arxiv.org/abs/2108.09058 ; https://doi.org/10.1186/s13636-022-00237-8
19. Ramoneda, P., Miron, M., & Serra, X. (2021). Piano fingering with reinforcement learning. arXiv:2111.08009. https://arxiv.org/abs/2111.08009
20. Ramoneda, P., Tamer, N. C., Eremenko, V., Serra, X., & Miron, M. (2022). Score difficulty analysis for piano performance education based on fingering. *ICASSP 2022*. https://arxiv.org/abs/2203.13010
21. Ramoneda, P., et al. (2024). Combining piano performance dimensions for score difficulty classification. *Expert Systems with Applications*. https://arxiv.org/abs/2306.08480
22. Randolph, D. A., & Di Eugenio, B. (2016). Dactylize: Automatically collecting piano fingering data from performance. ISMIR 2016 Late-Breaking Demo. https://bpb-us-e1.wpmucdn.com/wp.nyu.edu/dist/2/2294/files/2016/08/randolph-dactylize.pdf ; code: https://github.com/dvdrndlph/dactylize
23. Randolph, D. A., Di Eugenio, B., & Badgerow, J. (2021). Expected reciprocal rank for evaluating musical fingering advice. *Proc. Sound and Music Computing Conference 2021*, 53–59. Record: https://jayscholar.etown.edu/facpubharvest/818
24. Randolph, D. A., Di Eugenio, B., & Badgerow, J. (2023). Modeling piano fingering decisions with conditional random fields. https://nlp.lab.uic.edu/wp-content/uploads/sites/314/2023/06/Randolph_CRF2.pdf
25. Randolph, D. A. (2023). *Toward Actionable Computational Models of Piano Fingering*. PhD thesis, University of Illinois Chicago. https://indigo.uic.edu/articles/thesis/Toward_Actionable_Computational_Models_of_Piano_Fingering/24241678
26. pydactyl: Python framework for piano fingering models (MIT), including Parncutt/Jacobs/Badgerow/Balliauw/Hart implementations, `data/tables_0.dat` and the `beringer2` corpus. https://github.com/dvdrndlph/pydactyl ; CRF package: https://github.com/dvdrndlph/crf
27. Gao, W., Zhang, S., Zhang, N., Xiong, X., Shi, Z., & Sun, K. (2023). Generating fingerings for piano music with model-based reinforcement learning. *Applied Sciences* 13(20):11321. https://doi.org/10.3390/app132011321
28. PianoFingering.jl (GPL-3.0, archived). https://github.com/JuliaMusic/PianoFingering.jl
29. Musy, M. pianoplayer: automatic fingering generator for piano scores (MIT). https://github.com/marcomusy/pianoplayer
30. Zakka, K., et al. (2023). RoboPianist: Dexterous piano playing with deep reinforcement learning. *CoRL 2023*, PMLR 229. https://arxiv.org/abs/2304.04150 ; https://kzakka.com/robopianist/
31. Zhao, Y., Chen, L., Schneider, J., Gao, Q., Kannala, J., Schölkopf, B., Pajarinen, J., & Büchler, D. (2024). RP1M: A large-scale motion dataset for piano playing with bi-manual dexterous robot hands. *CoRL 2024*. https://arxiv.org/abs/2408.11048
32. Chen, L., et al. (2025). Dexterous robotic piano playing at scale (OmniPianist). arXiv:2511.02504. https://arxiv.org/abs/2511.02504
33. Gan, Q., Wang, S., Wu, S., & Zhu, J. (2025). PianoMotion10M: Dataset and benchmark for hand motion generation in piano performance. *ICLR 2025*. https://arxiv.org/abs/2406.09326
34. Wang, R., Xu, P., Shi, H., Schumann, E., & Liu, C. K. (2024). FürElise: Capturing and physically synthesizing hand motions of piano performance. *SIGGRAPH Asia 2024*. https://arxiv.org/abs/2410.05791
35. Kim, Y., Park, J., Bae, J., Kim, K., Kwon, T., Lerch, A., & Nam, J. (2025). PianoVAM: A multimodal piano performance dataset. *ISMIR 2025*. https://arxiv.org/abs/2509.08800
36. Park, J., et al. (2025). Two web toolkits for multimodal piano performance dataset acquisition and fingering annotation. ISMIR 2025 LBD. https://arxiv.org/abs/2509.15222
37. Bae, J., et al. (2026). SKY-Piano: A multimodal piano performance dataset. *ISMIR 2026*. https://arxiv.org/abs/2607.27296
38. Bae, J., et al. (2026). Tipiano: Cascaded piano hand motion synthesis via fingertip priors. arXiv:2604.09692. https://arxiv.org/abs/2604.09692
39. PiAnnotate: A web annotation tool for piano fingering, with a diagnostic probe (2026). arXiv:2605.23982. https://arxiv.org/abs/2605.23982 ; code (MIT): https://github.com/joonhyungbae/PiAnnotate
40. Penner, D., & Hindle, A. (2026). Statistical models for automatic fingering-annotated piano sheet music transcription. arXiv:2609.28787. https://arxiv.org/abs/2609.28787 ; replication: https://doi.org/10.5281/zenodo.22871714
41. Hadjakos, A., Waloschek, S., & Leemhuis, A. (2019). Detecting hands from piano MIDI data. *Mensch und Computer 2019* (workshops). https://dl.gi.de/handle/20.500.12116/25209
42. Fillastre, P. (2026). chirality: piano fingering from ergonomic rules, statistical models, and reinforcement learning (AGPL-3.0; v0.1.0, 2026-07-17). https://github.com/vibetuned/chirality ; results: https://github.com/vibetuned/chirality/blob/main/docs/experiments_summary.md ; models: https://huggingface.co/vibetuned/chirality-models ; https://pypi.org/project/chirality/
43. Nakamura, E., & Yoshii, K. (2018). Statistical piano reduction controlling performance difficulty. *APSIPA Trans. Signal and Information Processing*. https://arxiv.org/abs/1808.05006
44. Boyle, R., Boyle, R., & Booker, E. (2015). Pianist hand spans: Gender and ethnic differences and implications for piano playing. *APPC 2015*. https://paskpiano.org/wp-content/uploads/2023/10/Boyle-Boyle-Booker-_APPCA-2015_Dec-2015.pdf
45. Wristen, B., Jung, M.-C., Wismer, A., & Hallbeck, M. S. (2006). Assessment of muscle activity and joint angles in small-handed pianists: A pilot study on the 7/8-sized keyboard versus the full-sized keyboard. *Medical Problems of Performing Artists* 21(1):3–9. https://digitalcommons.unl.edu/musicfacpub/7
46. Bach, C. P. E. *Essay on the True Manner of Playing the Clavier*, Part I, Ch. 1, "On fingering" (Packard Humanities Institute translation). https://versuch.cpebach.org/v-html/part-I/chapter-1/I-1-p9.html
47. *Piano Basics* (Baylor University open textbook): scale fingering. https://openbooks.library.baylor.edu/pianobasics/?p=59
48. Faber, N., & Faber, R. *Piano Adventures Primer Level Lesson Book* (2nd ed.). https://www.halleonard.com/product/420168/primer-level-lesson-book-2nd-edition
49. Roskell, P. *The Complete Pianist* (Edition Peters): https://www.editionpeterspublications.us/products/the-complete-pianist-peters ; *The Art of Piano Fingering*: https://online-academy.informance.biz/content/pages/6-the-art-of-piano-fingering
50. ABRSM. *The Manual of Scales, Broken Chords and Arpeggios* (Gerald, 2001). https://www.musicroom.com/the-manual-of-scales-broken-chords-and-arpeggios-9781860961120
51. Bardas, W. (1927). *Zur Psychologie der Klaviertechnik*. Berlin. Record of a study about it: https://opus.bibliothek.uni-augsburg.de/opus4/frontdoor/index/index/year/2024/docId/111758
52. Repeated-note fingering: Estrin, R., "2 reasons you must change fingers on repeated notes," https://livingpianos.com/2-reasons-you-must-change-fingers-on-repeated-notes ; "How to play repeated notes on the piano," *Pianist*, https://www.pianistmagazine.com/how-to-play-repeated-notes-on-the-piano
53. Chord-inversion fingering lesson (secondary source): https://pianote.com/my-lessons/chord-inversions
54. Zhu, Y., Ramakrishnan, A. S., Hamann, B., & Neff, M. (2013). A system for automatic animation of piano performances. *Computer Animation and Virtual Worlds* 24(5):445–457. https://www.cs.ucdavis.edu/~neff/papers/cav1477.pdf
55. Robine, M. (2009). Analyse automatique du doigté au piano. *Journées d'Informatique Musicale 2009*, 106–112 (via [13]).
56. Viana, A. B., & Morais Júnior, A. C. (2003). Technological improvements in the SIEDP. *SBCM 2003*. https://compmus.ime.usp.br/sbcm/2003/papers/rAlexandre_Viana.html
57. Dai, C., et al. (2025/2026). Musical Score Understanding Benchmark (MSU-Bench). arXiv:2511.20697. https://arxiv.org/abs/2511.20697
58. Ikesan (2026). Browser port of pianoplayer (article). https://lilting.ch/en/articles/musicxml-piano-fingering-physics
59. Commercial tools: KeyGenius https://keygenius.app/ ; PineappleMusicLab https://pineapplemusiclab.com/ ; Songscription https://www.songscription.ai/ ; ROLI AI Music Coach (2026) https://magneticmag.com/2026/02/roli-introduces-ai-music-coach-for-real-time-piano-learning/
60. Steinberg forum, "Fingerings automatic in Dorico". https://forums.steinberg.net/t/fingerings-automatic-in-dorico/946181
61. MuseScore forum threads on pianoplayer and fingering plugins. https://musescore.org/en/node/323943 ; https://musescore.org/en/project/fingering-diagram
62. GitHub topic "piano-fingering". https://github.com/topics/piano-fingering
63. Ramoneda, P., Eremenko, V., D'Hooge, A., Parada-Cabaleiro, E., & Serra, X. (2024). Towards explainable and interpretable musical difficulty estimation: A parameter-efficient approach. *ISMIR 2024*. https://arxiv.org/abs/2408.00473
64. Mikrokosmos-difficulty dataset. https://github.com/PRamoneda/Mikrokosmos-difficulty
65. Sébastien, V., Ralambondrainy, H., Sébastien, O., & Conruyt, N. (2012). Score analyzer: Automatically determining scores difficulty level for instrumental e-learning. *ISMIR 2012*, 571–576 (via [13], [20]).
66. Chiu, S.-C., & Chen, M.-S. (2012). A study on difficulty level recognition of piano sheet music. *IEEE ISM 2012* (via [8], [63]).
67. Neuhauser, A., & Cancino-Chacón, C. (2026). Estimating piano piece difficulty via embodied robotic hand performance analysis. *MOCO 2026*. https://doi.org/10.1145/3802842.3802850
68. APF_eval: evaluation framework for automatic piano fingering. https://github.com/PRamoneda/APF_eval
69. Sloboda, J. A., Clarke, E. F., Parncutt, R., & Raekallio, M. (1998). Determinants of finger choice in piano sight-reading. *J. Exp. Psychol.: Human Perception and Performance* 24(1):185–203 (via [1], [13]).
70. Clarke, E. F., Parncutt, R., Raekallio, M., & Sloboda, J. A. (1997). Talking fingers: An interview study of pianists' views on fingering. *Musicae Scientiae* 1(1):87–107 (via [1], [13]).
71. Wagner, C. (1988). The pianist's hand: Anthropometry and biomechanics. *Ergonomics* (via [1]).
72. Gellrich, M., & Parncutt, R. (1998). Piano technique and fingering in the eighteenth and nineteenth centuries: Bringing a forgotten method back to life. *British Journal of Music Education* 15(1):5–23 (via [1], [13]).
73. Radisavljevic, A., & Driessen, P. F. (2004). Path difference learning for guitar fingering problem. *ICMC 2004* (via [42]).
74. PASK (Pianists for Alternatively Sized Keyboards): hand-span studies and small-hand benchmarks. https://paskpiano.org/pianists-hand-spans-australian-study/ ; https://paskpiano.org/how-many-adults-have-small-hands/
75. Illustrative Mathematics, "Hand Span Measures" (children's hand-span range; educational estimate). https://tasks.illustrativemathematics.org/content-standards/tasks/485
76. "A Web-Enabled AI System for Real-Time Piano Fingering Optimization in Music Education" (2026). https://www.sciencedirect.com/org/science/article/pii/S1548109326000513 (inaccessible; unverified)
77. Alfred's *Pentascale Pro*, Book 1 (major and minor 5-finger patterns in all keys). https://hsiaoya.com/en/products/03-00-31999-pentascale-pro-book-1-an-introduction-to-major-and-minor-5-finger-patterns
78. "Fingering (music)", Wikipedia (lists Musafia 1971; Bar-Niv 2012; Matthay 1908). https://en.wikipedia.org/wiki/Fingering_(music)
79. Faber, *The Church Musician* piano method, Level 1 (Middle C, C, G and F 5-finger positions). https://www.jwpepper.com/church-musician-piano-method-10000235/p
80. "The Virtuoso Pianist in 60 Exercises" (Hanon, 1873), Wikipedia. https://en.wikipedia.org/wiki/The_Virtuoso_Pianist_in_60_Exercises
