# A language model as a piano-teacher oracle for fingerings: protocol, pilot, measurements, recommendation

*Verification research report. Code: `research/teacher_review/` (renderer, fault injector, blinded
benchmark builder, collector, scorer, and the weekly job built on them). Results:
`research/teacher_review/results/`. Rendered passages and raw reviewer outputs stay under
`research/data/teacher_review/` (PIG-derived, not committed).*

## 1. Question and answer in brief

**Question.** Can a language model acting as a piano teacher be a useful *qualitative* oracle for
fingerings (the verification spec, section 2, lists only quantitative oracles), and how should it
be used in the verification loop?

**Answer.** Yes, with a clear role. In a blinded pilot on 40 PIG passages x 3 conditions x 2 runs
(240 reviews in 30 blinded batches, each read by a fresh Opus reviewer), the reviewer

* found **99%** of 184 planted hard faults within one note
  (95% with the right category), with
  **2.5 objections per 100 notes on expert fingerings**, of which only
  3 in 80 expert passages were called errors;
* ranked expert above corrupted in **80/80**
  passage-runs and FHMM3 above corrupted in 71/80,
  and gave FHMM3 (M_gen 65.0) a mean 2.0
  points less than the experts on a 0-15 scale;
* flagged notes where PIG annotators disagree among themselves 3.0 times
  as often as notes where they all agree, and 80% of its proposed
  fixes on expert passages were another annotator's actual finger;
* was self-consistent across two differently framed runs (Pearson 0.95 on overall
  scores, 81% verdict agreement, 91/92 faults found in both);
* read the text rendering back with 0 errors in 6042 digits;
* cost a median 15,805 tokens and 72 s of wall time per passage-condition
  (measured; almost all of it reasoning).

The failure modes are also clear: it applies the "finger still holding a key" rule to sounding
durations that pianists release early or pedal, it sometimes calls an expert's choice on a
*disputed* note an error, and its soft objections (which shift, which hop) move between runs.
So: a useful **qualitative** oracle for hard errors and for generating hypotheses, never a gate
and never a number to tune on. Section 6 gives the weekly-review design and the brief.

## 2. Protocol

### 2.1 Unit of review

A *passage*: two to eight bars of one PIG test piece, 10 to 48 notes in each reviewed hand, with
the other hand shown for musical context (pitches and rhythm, no fingers). Each passage is
reviewed in three *conditions* that share every note and differ only in the fingering digits:

| Condition | Fingering | Why |
|---|---|---|
| `expert` | one of the piece's four to six PIG annotators, drawn at random per passage | the positive control: what an experienced pianist actually played |
| `fhmm3` | the authors' released third-order HMM output for the same notes (`research/data/pig_hmm/Result_FHMM3`, M_gen 65.0 on the test split) | a realistic engine output, below the human ceiling |
| `corrupted` | the expert fingering with two or three planted faults of distinct, recorded kinds | the negative control with known ground truth per note |

### 2.2 Rendering

The reviewer never sees a score image or MusicXML; it sees a compact text block designed to be
unambiguous and short (`research/teacher_review/render.py`). One line per note, chord or rest;
hands in separate sections; every sounding note has a stable id used in objections and faults.

```
PASSAGE it-2b19
Composer: Mozart (sonata, first movement). Meter: 4/4. Tempo: quarter = 120 (estimated). Bars 1-4.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1     1   1     h     C5              1
R2     1   3     q     E5              3
R3     1   4     q     G5              5
R4     2   1     q.    B4              1
R5     2   2.5   s     C5              2
R6     2   2.75  s     D5              3
R7     2   3     q     C5              2
-      2   4     q     rest            -
R8     3   1     h     A5              3
...
LH (context)
L1     1   1     e     C4              -
L2     1   1.5   e     G4              -
...
```

Columns: `id` (hand letter + 1-based note number in onset order; a chord shows a range `R3-5`
with pitches low to high and fingers aligned, `1+3+5`), `bar`, `beat` (1-based, fractional:
`2.5` = half-way through beat 2; the beat is a quarter in x/4, a dotted quarter in 6/8 and 12/8,
an eighth in 3/8), `dur` (`w h q e s t` = whole to 32nd, `.` dotted, `e3` triplet eighth, `gr`
grace, otherwise `2.5q`), `pitch` (scientific, C4 = middle C, PIG spelling), `f` (1 thumb to 5).
Rest lines mark gaps of an eighth or longer. The legend shown to the reviewer is `render.LEGEND`.

*Round trip.* `parse_rendering(render_passage(p))` reproduces every event (onset, duration,
pitches, fingers, ids) for single notes, chords, rests, dotted and triplet values and compound
meters (`tests/test_render.py`). *Read-back by the model* is measured in the pilot (section 4.5):
every reviewer must echo the finger digits of each reviewed hand before judging.

*Bars and beats for PIG.* PIG files carry only synthesised onset and offset seconds, no meter and
no bar lines, with a few milliseconds of jitter and ornament notes off the grid. `pig_passages.py`
fixes the meter per piece from the score, estimates the quarter-note length from the inter-onset
interval distribution, finds the sixteenth-note phase by global alignment, and quantises each
onset to the nearest sixteenth, triplet or 32nd. Pieces where fewer than 85% of onsets sit on
that grid (003, 006, 007, 009, 010, 023: jitter or tempo drift) are excluded; the remaining 24
pieces are rendered with bar numbers that can be off by a bar where List.csv's bar count and the
timing disagree (015), which the legend tells the reviewer. With MusicXML input, as in the app,
bars and beats are exact and this estimation is not needed.

### 2.3 Rubric and output schema

Derived from the literature checklist P1 to P15 and the lint rules L01 to L23
(`docs/research/literature.md` sections 4.2 and 4.3). Five criteria, each scored 0 to 3, plus a
verdict and a list of specific objections:

| Criterion | What it covers | Checklist / lint |
|---|---|---|
| `possible` | hard rules: no two simultaneous notes on one finger (thumb smear excepted), chord fingers in pitch order, spans within a medium hand, no finger reused while it holds a key | L01-L05 |
| `idiomatic` | standard scale and arpeggio patterns, only thumb crossings, standard chord shapes | P4, P5, P6, L06, L19 |
| `economical` | few position changes, shifts at rests or long notes, no hops, no needless stretches | P1, P2, P8, L07, L11, L15, L16 |
| `consistent` | identical or sequential figures fingered alike | P11, L17, L18 |
| `beginner_friendly` | thumb and fifth off black keys, no thumb pass onto black, no 3-4-5 runs where avoidable, spans within an octave, no substitutions | P3, P9, P12, P13, L08-L10, L14, L23 |

Verdict: `good` / `acceptable` / `flawed` / `unplayable` (ranks 3 to 0). The overall score used
for ranking conditions is the sum of the five criteria (0 to 15).

Objection: `{"notes": ["R7","R8"], "kind": <vocabulary>, "severity": "error|warning|info",
"problem": <= 25 words, "fix": {"R7": 2, "R8": 3}}`. Kind vocabulary: `same_finger_chord`,
`crossed_chord`, `impossible_span`, `nonthumb_crossing`, `thumb_pass_onto_black`, `hop`,
`reversed_run`, `thumb_on_black`, `fifth_on_black`, `stretch`, `position_change`,
`inconsistent`, `weak_finger`, `repeated_note`, `nonstandard_pattern`, `other`.
Full schema and wording: `research/teacher_review/prompts/brief.md` (reproduced in section 7).

### 2.4 Blinding and randomisation

* Each reviewer is a fresh Opus subagent that reads exactly one batch file and writes one JSON
  file; it is told not to open anything else and not to guess sources.
* A batch holds eight *different* passages; the three conditions of a passage go to three
  different batches, so no reviewer can compare two fingerings of the same notes.
* Item ids are random hex (`it-6efc`); the file names the composer and a genre word ("sonata,
  first movement") but not the title, the annotator or the condition.
* The map from item to condition, annotator and planted faults is the key
  (`results/<run>/key.json`), written by the builder and read only by the scorer.
* Two runs (A, B) use different random item ids, different batch compositions and two different
  framings of the same brief (`prompts/variant_a.md` walks the criteria in rubric order;
  `variant_b.md` asks the reviewer to play the passage through in their mind and start from the
  student's point of view). The brief, rubric and schema are identical.

### 2.5 Planted faults

`research/teacher_review/inject.py` plants two or three faults of distinct kinds per passage,
never within two notes of each other, and records the notes, the fingers before and after, and
an anchor note. Kinds and what counts as naming them:

| Kind | Construction | Accepted objection kinds |
|---|---|---|
| `chord_same_finger` | two adjacent chord notes get the same finger (thumb smears over a third or less are not planted) | `same_finger_chord`, `impossible_span`, `crossed_chord` |
| `impossible_span` | a chord spanning at least a minor sixth (an octave for four notes) gets adjacent non-thumb fingers 2-3, 2-3-4 or 2-3-4-5 across it | `impossible_span`, `stretch`, `crossed_chord` |
| `nonthumb_crossing` | an outward step or third within a second gets a decreasing non-thumb pair (3-2, 4-3, ...) | `nonthumb_crossing`, `reversed_run`, `crossed_chord` |
| `hop_at_speed` | two different keys within 300 ms get the same finger | `hop`, `repeated_note` |
| `run_345_reversed` | three outward stepwise notes get 5-4-3 | `reversed_run`, `nonthumb_crossing` |
| `thumb_on_black_between_whites` | a black key between two white-key notes gets the thumb | `thumb_on_black`, `thumb_pass_onto_black` |

A fault counts as *detected by position* when any objection names a note within one note of a
fault note (same hand), and *detected by kind* when such an objection also carries an accepted
kind.

## 3. The pilot

### 3.1 Benchmark

* **40 passages** from 24 PIG test pieces (Bach 11, Mozart 15,
  Chopin 14), 2 to 5 bars long (median 2), reviewed hand(s):
  right hand only 16, left hand only 14, both hands 10; 14 to
  63 reviewed notes per passage (median 21),
  1007 reviewed notes in all. Pieces: 001, 002, 004, 005, 008, 011, 012, 013, 014, 015, 016, 017, 018, 019, 020, 021, 022, 024, 025, 026, 027, 028, 029, 030. Annotators drawn:
  EF x4, EN x2, ES x8, HI x7, HK x4, NH x3, YI x5, YS x1, YoI x6.
* **Conditions**: expert, FHMM3, corrupted, for every passage: 120 items per run.
* **Planted faults**: 92 in the 40 corrupted items (chord_same_finger 24, impossible_span 21, hop_at_speed 16, nonthumb_crossing 16, thumb_on_black_between_whites 9, run_345_reversed 6),
  balanced as far as the music allows (a reversed 3-4-5 run needs three outward stepwise notes; the
  thumb-on-black fault needs a black key between two white-key notes played by other fingers).
* The windows are shorter than the two-to-eight-bar range the protocol allows because the selector
  takes the shortest window from each start bar that holds at least 14 reviewed notes, and in these
  pieces that is usually two bars; a later run should sample the length uniformly.
* **Runs**: A (framing `variant_a`) and B (framing `variant_b`), each 15 batches of 8 items,
  independently shuffled and re-labelled. 30 reviewers in all, every one a fresh Opus
  subagent that saw one batch file and nothing else.
* Built by `teacher_review.build_benchmark` with seed 20261013; `research/teacher_review/README.md`
  reproduces the pilot.

### 3.2 Execution

All 30 batches returned valid JSON with all 8 items, every note id valid and every score in range
(`results/A/collect_report.json`, `results/B/collect_report.json`: 0 problems each). The
reviewers were launched with the prompt in `research/teacher_review/README.md`. Section 4 is
`results/summary.md` verbatim.

### 3.3 Cost (measured)

The Agent tool reports, per reviewer, the tokens it consumed in total (prompt, reasoning, tool
round-trips, output) and the wall time from launch to hand-back. These were captured for
14 of the 30 batches (`results/dispatch_log.json`):

| batch | tokens | wall s | items |
|---|---|---|---|
| A-02 | 126,441 | 578 | 8 |
| A-03 | 122,410 | 548 | 8 |
| A-04 | 122,992 | 567 | 8 |
| A-06 | 130,125 | 623 | 8 |
| A-08 | 127,945 | 600 | 8 |
| A-15 | 155,785 | 827 | 8 |
| B-02 | 132,151 | 630 | 8 |
| B-06 | 119,699 | 510 | 8 |
| B-10 | 116,477 | 488 | 8 |
| B-11 | 127,527 | 595 | 8 |
| B-12 | 142,578 | 748 | 8 |
| B-13 | 103,152 | 369 | 8 |
| B-14 | 108,060 | 422 | 8 |
| B-15 | 103,052 | 370 | 8 |

Median **126,441 tokens and 578 s per batch of 8 items**, i.e. about
**15,805 tokens and 72 s per passage-condition item** (range
12,881 to 19,473 tokens). The batch file itself is about
19,220 characters (4,805 tokens at
four characters per token, estimated) and the JSON answer about 848 characters per item,
so nearly all of the measured tokens are the reviewer's own reasoning. The whole pilot (240 item
reviews) cost roughly 3.8 million tokens (estimated from the median) and under
an hour of wall time with up to twenty reviewers in parallel.

## 4. Measurements

### 4.1 Fault detection (sensitivity by position, within one note; kind = an objection of a matching kind)

| kind | planted (per run) | run A pos / kind | run B pos / kind | pooled pos / kind | FP per 100 expert notes (pooled) |
|---|---|---|---|---|---|
| chord_same_finger | 24 | 100% / 100% | 100% / 100% | 100% / 100% | 0.10 |
| impossible_span | 21 | 100% / 95% | 100% / 90% | 100% / 93% | 0.45 |
| nonthumb_crossing | 16 | 94% / 94% | 100% / 100% | 97% / 97% | 0.00 |
| hop_at_speed | 16 | 100% / 94% | 100% / 94% | 100% / 94% | 0.79 |
| run_345_reversed | 6 | 100% / 100% | 100% / 67% | 100% / 83% | 0.00 |
| thumb_on_black_between_whites | 9 | 100% / 89% | 100% / 89% | 100% / 89% | 0.10 |
| **all** | 92 | 99% / 96% | 100% / 93% | 99% / 95% | |

### 4.2 Objections by condition (false positives on expert passages; spurious = not within one note of a planted fault)

| run | condition | items | notes | objections | per item | per 100 notes | errors | items with an error objection |
|---|---|---|---|---|---|---|---|---|
| A | expert | 40 | 1007 | 28 | 0.70 | 2.8 | 2 | 5% |
| A | fhmm3 | 40 | 1007 | 51 | 1.27 | 5.1 | 14 | 28% |
| A | corrupted | 40 | 1007 | 6 | 0.15 | 0.6 | 0 | 0% |
| B | expert | 40 | 1007 | 23 | 0.57 | 2.3 | 1 | 2% |
| B | fhmm3 | 40 | 1007 | 49 | 1.23 | 4.9 | 11 | 22% |
| B | corrupted | 40 | 1007 | 10 | 0.25 | 1.0 | 0 | 0% |
| pooled | expert | 80 | 2014 | 51 | 0.64 | 2.5 | 3 | 4% |
| pooled | fhmm3 | 80 | 2014 | 100 | 1.25 | 5.0 | 25 | 25% |
| pooled | corrupted | 80 | 2014 | 16 | 0.20 | 0.8 | 0 | 0% |

### 4.3 Ranking of conditions by overall score (sum of five criteria, 0-15)

| comparison | run A | run B |
|---|---|---|
| expert>=corrupted | 40/40 (100%) | 40/40 (100%) |
| expert>=fhmm3 | 33/40 (82%) | 34/40 (85%) |
| expert>=fhmm3>corrupted | 28/40 (70%) | 30/40 (75%) |
| expert>corrupted | 40/40 (100%) | 40/40 (100%) |
| expert>fhmm3 | 25/40 (62%) | 25/40 (62%) |
| expert>fhmm3>corrupted | 20/40 (50%) | 21/40 (52%) |
| fhmm3>=corrupted | 37/40 (92%) | 37/40 (92%) |
| fhmm3>corrupted | 35/40 (88%) | 36/40 (90%) |
| verdict expert>=fhmm3 | 36/40 (90%) | 38/40 (95%) |
| verdict expert>corrupted | 39/40 (98%) | 38/40 (95%) |
| verdict fhmm3>corrupted | 29/40 (72%) | 29/40 (72%) |

| mean score | expert (A) | fhmm3 (A) | corrupted (A) | expert (B) | fhmm3 (B) | corrupted (B) |
|---|---|---|---|---|---|---|
| possible | 2.83 | 2.35 | 0.72 | 2.88 | 2.42 | 0.68 |
| idiomatic | 2.75 | 2.38 | 1.12 | 2.85 | 2.35 | 1.25 |
| economical | 2.73 | 2.25 | 2.00 | 2.73 | 2.38 | 1.98 |
| consistent | 2.88 | 2.67 | 1.98 | 2.90 | 2.70 | 1.90 |
| beginner_friendly | 2.70 | 2.27 | 1.15 | 2.75 | 2.30 | 1.18 |
| overall | 13.88 | 11.93 | 6.97 | 14.10 | 12.15 | 6.97 |

| verdicts | expert (A) | fhmm3 (A) | corrupted (A) | expert (B) | fhmm3 (B) | corrupted (B) |
|---|---|---|---|---|---|---|
| good | 28 | 13 | 0 | 29 | 14 | 0 |
| acceptable | 9 | 12 | 0 | 9 | 15 | 3 |
| flawed | 2 | 5 | 9 | 1 | 2 | 2 |
| unplayable | 1 | 10 | 31 | 1 | 9 | 35 |

### 4.4 Expert passages: objections where the other annotators agree vs disagree with the reviewed annotator

| run | agreed notes | flagged | rate | disputed notes | flagged | rate | fixes | fix = another expert's finger |
|---|---|---|---|---|---|---|---|---|
| A | 557 | 39 | 7% | 450 | 62 | 14% | 70 | 71% |
| B | 557 | 17 | 3% | 450 | 75 | 17% | 73 | 88% |
| pooled | 1114 | 56 | 5% | 900 | 137 | 15% | 143 | 80% |

### 4.5 Self-consistency between runs

| items | Pearson (overall) | Spearman | mean abs diff | share abs diff <= 2 | verdict agreement | objection-note Jaccard | faults: both / one / neither |
|---|---|---|---|---|---|---|---|
| 120 | 0.95 | 0.95 | 0.67 | 95% | 81% | 0.65 | 91 / 1 / 0 |

### 4.6 Read-back accuracy

| run | hands | exact | digits | digit errors |
|---|---|---|---|---|
| A | 150 | 100% | 3021 | 0 (0%) |
| B | 150 | 100% | 3021 | 0 (0%) |
| pooled | 300 | 100% | 6042 | 0 (0%) |

### 4.7 Cost (per passage-condition item)

| run | batches | items | wall s per batch (median) | wall s per item | chars in | chars out | est. tokens in | est. tokens out |
|---|---|---|---|---|---|---|---|---|
| A | 15 | 120 | 572 | 72 | 2402 | 849 | 601 | 212 |
| B | 15 | 120 | 499 | 64 | 2420 | 854 | 605 | 214 |

### 4.8 Reading the tables

* **Fault detection.** Pooled over both runs, 183 of 184 planted faults
  (99%) were named within one note, 174
  (95%) with a matching kind, and 124
  (67%) with severity `error`. The kind-specific
  false-positive rates on expert passages are all below one objection per 100 notes; the highest is
  for hops, where the reviewer also objects to some expert hops at speed (which experts do use with
  detached articulation).
* **False positives.** On expert passages the reviewer raised 51 objections in
  2014 note-reviews (1007 notes, two runs; 2.5 per 100 notes, 0.64 per passage),
  of which 3 carried severity `error`
  (4% of expert passages). On FHMM3 passages the rate is
  5.0 per 100 notes with 25 errors
  (25% of passages); on corrupted passages only
  16 objections fell outside the planted faults.
* **Ranking.** The reviewer put the expert above the corrupted fingering in
  40/40 (A) and 40/40 (B)
  passages, FHMM3 above corrupted in 35/40 and
  36/40, and the expert at or above FHMM3 in
  33/40 and 34/40.
  The full strict order expert > FHMM3 > corrupted held in 20/40
  and 21/40. The expert-versus-FHMM3 comparison is the weak one:
  the passages where FHMM3 tied or beat the expert differ from the expert on 28-30% of their notes,
  about as much as the passages where the expert won (32-33%), so the reviewer is not failing to
  notice the HMM's deviations; it judges many of them to be legitimate alternatives, which is what
  the 60-80% pairwise agreement between PIG annotators also says. Hard faults are separated from
  clean fingerings decisively; among clean alternatives the reviewer prefers the pianist's choice
  only about 62% of the time. The mean gap between expert and FHMM3 on the 0-15 scale is
  1.9 (A) and
  1.9 (B); between
  expert and corrupted 6.9 and
  7.1.
* **Agreement with the experts' own disagreement.** On expert passages, notes on which every other
  annotator agrees with the reviewed annotator were flagged at 5%
  (56/1114); notes on which at least one other annotator
  differs were flagged at 15% (137/900).
  So the reviewer flags *more* often where experts themselves disagree, which is the behaviour one
  wants from a second opinion, and
  80% of its proposed fixes on expert passages are the finger
  another PIG annotator actually used.
* **Self-consistency.** Across the two runs (different framing, order, ids and batch-mates), overall
  scores correlate at Pearson 0.95 / Spearman 0.95, the
  mean absolute difference is 0.67 points on the 0-15 scale,
  verdicts agree on 81% of items, and of the 92 planted faults
  91 were found in both runs, 1 in one, 0 in neither.
  Objection *positions* agree less (mean Jaccard 0.65 over note sets):
  the soft objections (which hop, which shift) vary between runs, the hard ones do not.
* **Read-back.** 300 hand read-backs, 100% exact, 0 wrong digits in
  6042: the rendering is read without error.

## 5. Qualitative sample

All objections are in `results/qualitative.json` (hits on planted faults, objections on expert passages with every annotator's finger, spurious objections on corrupted passages, objections on FHMM3 passages). Quotations below are the reviewer's `problem` field verbatim; note ids refer to the rendered passage (hand letter + note number). "Others" lists the fingers the other PIG annotators used on the same note.

**Most insightful: objections that use evidence a lint rule would not (the context hand, the sequence, the other occurrence of the same chord)**

* Run B, piece 028 bars 1-2, expert, notes L2 L5 L8 L11 L14 L17 L20 L23 L26 L29 L32 L35, `other` (info): "With 5-3-1, LH 2 hovers between G#3 and Eb4, right where the RH thumb plays C4; 5-2-1 clears that space." Fix: finger 2 on every listed note. Expert: 3 on every listed note (others [3, 2, 3, 2] each). A hand-collision argument (checklist P14) made from the context hand, which carries no fingering; two of the four other annotators do use 5-2-1.
* Run A, piece 016 bars 11-14, expert, notes R7 R8 R9 R10 R11 R12 R13, `repeated_note` (warning): "Shifting 2-3-4 across the repeated A5s walks the hand for nothing; the F5-C6 five-finger position, 5-4-3-3-3-2-1, needs no shift." Fix {'R7': 5, 'R8': 4, 'R9': 3, 'R10': 3, 'R11': 3, 'R12': 2, 'R13': 1}. Expert: R7=4 (others [5, 5, 5, 5, 4]), R8=3 (others [4, 4, 4, 4, 3]), R9=2 (others [3, 3, 3, 3, 2]), R10=3 (others [3, 3, 2, 3, 2]), R11=4 (others [5, 3, 3, 3, 4]), R12=3 (others [4, 2, 2, 2, 3]), R13=2 (others [3, 1, 1, 1, 2]) The reviewed annotator is the outlier here: the proposed 5-4-3-3-3-2-1 is, note for note, what four of the five other annotators played.
* Run A, piece 021 bars 18-19, corrupted, notes L5 L6, `impossible_span` (error): "Fingers 3 and 2 cannot span the major sixth C3-A3; the same chord is taken 5+1 just before and after." Fix {'L5': 5, 'L6': 1}. Planted: impossible_span. Finds the planted span fault and cites the same chord's fingering on either side of it as the fix.
* Run B, piece 002 bars 19-20, corrupted, notes L2 L3, `hop` (warning): "Finger 5 hops from F3 to G3 on consecutive sixteenths; the sequence in bar 20 (L13-L15) uses 4-5-4." Fix {'L3': 4}. Planted: hop_at_speed. Finds the planted hop and cross-references the sequential repeat one bar later.
* Run A, piece 030 bars 8-10, fhmm3, notes L5 L6, `impossible_span` (error): "Octave B1-B2 fingered 5-4; the 4-5 pair cannot span more than a third." Fix {'L6': 1}. Experts' fingers: L5=[5, 5, 5, 5, 5], L6=[1, 1, 1, 1, 1] A genuine FHMM3 error: all five annotators play the octave 5-1. The HMM has no notion of span inside a chord; the reviewer does.
* Run A, piece 029 bars 21-24, fhmm3, notes L2 L3, `same_finger_chord` (error): "Finger 2 holds G#3 for the whole bar yet must also play A3 on beat 2; bar 23 correctly uses 3 on G#3." Fix {'L2': 3}. Experts' fingers: L2=[3, 2, 3, 3, 3], L3=[2, 1, 2, 2, 2] A genuine FHMM3 error of the kind M_gen cannot single out: the HMM ignores durations, so it re-uses a finger that is still holding a key (lint L03); four of five annotators avoid it exactly as the fix says.

**Most wrong: objections the experts contradict**

* Run A, piece 019 bars 2-3, expert, notes R14 R19 R20 R21, `other` (error): "The thumb must play D5 while still holding the dotted-half Bb4, and then hops from D5 to Eb5." Fix {'R19': 2, 'R20': 3}. Expert: R14=1 (others [1, 1, 1, 1, 1]), R19=1 (others [1, 1, 1, 1, 1]), R20=3 (others [3, 3, 3, 3, 3]), R21=1 (others [2, 2, 2, 1, 1]) Severity error on a choice all six annotators make. The dotted-half Bb4 is released early or pedalled by every pianist; the reviewer reads the sounding duration literally. This is the one systematic false positive, and it is a rendering problem (section 6.4) more than a judgement problem.
* Run A, piece 005 bars 7-8, expert, notes R1 R2 R3, `position_change` (warning): "E5-Eb5 on 3-2 then E5 on 5 forces a jump of the hand within three sixteenths; 5-4-5 stays put and matches later Eb5-E5." Fix {'R1': 5, 'R2': 4}. Expert: R1=3 (others [3, 3, 3]), R2=2 (others [2, 2, 2]), R3=5 (others [5, 4, 5]) The three other annotators finger these notes exactly as the reviewed one does; the objection is a preference stated as a warning.
* Run A, piece 028 bars 5-6, expert, notes R11 R13 R15, `impossible_span` (error): "Eb5 held by 4 while 3 plays Bb4 below: a perfect fourth between 3 and 4, beyond their third limit." Fix {'R13': 2, 'R15': 2}. Expert: R11=4 (others [4, 5, 5, 4]), R13=3 (others [2, 3, 3, 2]), R15=3 (others [2, 3, 3, 2]) Called an error, but the annotators split two against two on these notes and the proposed fix is the other pair's fingering: a disputed note, not an error.
* Run A, piece 026 bars 7-8, fhmm3, notes L23 L24, `impossible_span` (error): "3 on G#3 and 2 on D4 span a diminished fifth, wider than 2-3 allow; the repeat of this chord already uses 4." Fix {'L23': 4}. Experts' fingers: L23=[4, 4, 3, 3, 3], L24=[2, 2, 1, 1, 1] Called an error, yet three of the five annotators finger the chord as FHMM3 does; a wide but playable stretch over-called as impossible.

**Spurious objections on corrupted passages (not within one note of a planted fault)**

* Run A, piece 012 bars 4-5, corrupted, notes R2 R3, `thumb_on_black` (warning): "The repeated G#4 is retaken by the thumb on a black key; keeping 2 and taking D5 with 3 avoids it." Fix {'R3': 2, 'R4': 3}. A reasonable preference about an expert choice that was left intact; counted as spurious by the scorer because it is not a planted fault.
* Run B, piece 005 bars 7-8, corrupted, notes R19 R20, `hop` (warning): "Thumb plays F#4 then E4 back to back; retake F#4 with 2 so the thumb is free for E4." Fix {'R19': 2}. A warning about the expert's own thumb hop in the untouched part of the passage; run B raised the same objection on the expert condition of this passage, so it is a consistent preference, not noise.

Reading all 51 objections on expert passages (both runs): 3 are errors (discussed above), 28 are warnings and 20 are informational. Not one of the 51 names only notes on which every other annotator agrees with the reviewed one; if objections fell at random, about 8 would (55% of the reviewed notes are unanimous and an objection names 3.8 notes on average). Every objection touches at least one note the annotators themselves dispute, and in 43 of the 51 the proposed fix is a finger another annotator actually used. The reviewer's objections on FHMM3 passages concentrate on two real HMM weaknesses that the match-rate metrics blur: re-using a finger on a held note (the HMM has no duration model) and wide intervals inside chords (no span model), plus shifts across repeated notes that a third-order HMM cannot see.

## 6. Recommendation

### 6.1 Where it fits

The reviewer is a **qualitative oracle**: it turns an engine output into specific, positioned,
reasoned objections at about 15,000 tokens per passage. It is not a metric. The quantitative
oracles of the verification spec (PIG, Mutopia, textbook, expert base rates, baseline consensus)
stay the only judges of numbers; the reviewer reads what those oracles cannot explain and writes
the hypotheses the iteration protocol (spec section 4) needs.

It runs as a **weekly teacher review job** outside `pnpm verify`
(`research/teacher_review/weekly.py`: build, collect, report):

1. **Input selection** (automatic, from the latest bench run; `select.py`): (a) the 20 passages
   around the engine's lowest-confidence library notes (section 3.8 calibration buckets), at most
   two per piece, (b) up to 16 windows of two to four bars around the hard errors of the bench
   gallery (section 3.3), taken from PIG validation pieces only, never the official test pieces,
   (c) 10 random passages from the library pieces at levels 1 to 3 as a control, 4 of them also
   with planted faults and 4 others again as recall twins (section 6.4), and (d) the passages a
   user edited, which waits until the app stores edits. Each passage is rendered with
   `teacher_review.render` from the engine's MusicXML (exact bars and beats), the reviewed hand(s)
   fingered, the other hand as context.
2. **Dispatch** as blinded batches of 8 passages (different passages per batch, random order,
   opaque ids, no mention of the engine version or whether the passage is a control).
   Low-confidence and hard-error batches are read by two independent reviewers, one under each
   framing of section 2.4; control batches by one.
3. **Collect and score** with `teacher_review.collect`; the same validators apply.
4. **Turn consistent objections into hypotheses.** An objection is *consistent* when both
   reviewers raise it at the same position with the same kind, or one reviewer raises it with
   severity `error`. Group consistent objections by kind and by lint rule; each group with three
   or more members becomes one entry in `docs/experiments.md` ("the reviewer objects to hops in
   sixteenth-note Alberti figures in 6 of 20 low-confidence passages; hypothesis: the hop penalty
   is too weak below 150 ms; expected effect: fewer L11 warnings, no change in M_gen"). The
   hypothesis is then tested with the quantitative loop as usual. Planted and recall twins are
   instrument checks and feed no hypotheses.
5. **Report** `docs/reviews/teacher-YYYY-MM-DD.md`: the tables of section 4 for the control set
   (sensitivity on the planted-fault control, objection rate on expert control if PIG passages are
   included locally), the list of hypotheses, and the three most instructive objections verbatim.
   The control numbers are tracked over time only to notice *drift of the reviewer* (a model or
   prompt change), never as an engine metric.

Before any lint rule is added or re-weighted because of the reviewer, the expert base rate of that
rule on PIG (oracle 4) decides whether it is a law or a preference. The reviewer proposes; the data
disposes.

### 6.2 What it must never be used for

* **Not a gate.** No floor in `benchmarks/floor.json` may depend on reviewer scores, and
  `pnpm verify` must not call a model. Reasons measured here: the reviewer applies held-note rules
  that experts break with pedal and early release, it called two expert fingerings errors, its soft
  objections move between runs (note-level Jaccard 0.7), and it is the same model family that
  writes the engine's rules, so blind spots can be shared.
* **Not a number to tune on.** No weight, threshold or template is fitted to reviewer scores or
  to reviewer objection counts. The score scale is ordinal and run-dependent; the sensitivity on
  planted faults is an upper bound on sensitivity to real engine errors. Tuning to it would optimise
  the engine for the reviewer's habits rather than for pianists.
* **Not a replacement for human teachers** (literature 5.7). The protocol is built so that the
  same batch files can go to a teacher; when that happens, the reviewer's agreement with the
  teacher is the number to report, and the reviewer can be used as a pre-filter that chooses which
  passages are worth a teacher's time.
* **Not on PIG data in any shipped artefact.** PIG passages may be used for local control sets
  only; reviews that quote them stay under `research/data/`.

### 6.3 The periodic reviewer agent: exact brief

The agent receives three things: the dispatch wrapper below, the brief (the file
`research/teacher_review/prompts/brief.md`, unchanged; section 7), and one batch file produced by
`teacher_review.render` with the legend. Nothing else. The wrapper, ready to paste into an
agent prompt (replace the two paths):

> You are a reviewer in a blinded review of piano fingerings. Your only input is the file
> `<batch file>`. It contains a brief, a notation legend and 8 passages, each with a candidate
> fingering. Follow the brief's instructions exactly and write your review as a single JSON
> document to `<output file>` (UTF-8, nothing but the JSON).
>
> Rules:
> - Read only that one input file. Do not open, list, search or read any other file, directory
>   or web page, and do not look for the sources of the passages; the review depends on you
>   judging each passage from the text alone.
> - Do not run git. Do not run any program except one command to get a UTC timestamp before you
>   read the passages (bash: `date -u +%FT%TZ`) and one after you have written the JSON; put
>   them in `started_at` and `finished_at`.
> - Do not modify the input file. Write exactly one output file, the one named above.
> - Every item in the input must appear exactly once in `items`, in the same order as in the
>   file, each with `item`, `readback`, `scores`, `verdict`, `objections` and `comment` as the
>   brief specifies. Use only note ids that exist in the passage.
> - When done, reply with one line: the output path and the number of items written. Do not
>   include the JSON in your reply.

Model: Opus (the pilot's reviewer); Sonnet was not measured and should be piloted on the
planted-fault control before use. Batch size 8 (about 20,000 characters of input); two
reviewers per batch for the low-confidence and hard-error sets.

### 6.4 Two improvements over the pilot

The weekly job (`research/teacher_review/dispatch.py`, `select.py`) applies both.

1. **Say what `dur` means.** The weekly legend adds: "`dur` is the sounding length in the source;
   pianists release early or use the pedal, so a finger may be re-used after a long note unless
   the notes are slurred." This removes the one systematic false positive found in the pilot
   (section 5). The pilot's legend (`render.LEGEND`) did not say it.
2. **Score the rendering, not the memory.** Each recall twin is a control passage again with the
   composer hidden, transposed by a tritone, re-fingered by the engine in the new key and with
   its bars renumbered from 1. If the reviewer's objections change when the composer is hidden,
   it is recalling an edition rather than reading the passage. The pilot's read-back check shows
   the text is read correctly, not that it is the only thing read.

## 7. The reviewer brief

The brief is `research/teacher_review/prompts/brief.md`, read at run time by `dispatch.py`; paste it
into an agent prompt together with the notation legend and the passages. The dispatch wrapper of the
pilot is in `research/teacher_review/README.md` and section 6.3. It asks the reviewer, for every
passage, to:

1. Read the fingering back: for each reviewed hand, the fingers in note order (chord notes low to
   high) as a space-separated digit string, copied exactly.
2. Score the five criteria of section 2.3 from 0 to 3, with an anchor for each score. The reviewer is
   an experienced piano teacher judging for a student of beginning-to-intermediate level with a
   medium-sized adult hand (an octave is comfortable, a ninth is a stretch, a tenth is out of
   reach). The span limits behind `possible`: 3-4 or 4-5 no wider than a third, 2-3 a fourth, 2-5 or
   1-5 an octave to a ninth.
3. Give a verdict: `good` (hand it to the student as is), `acceptable` (one or two small edits),
   `flawed` (needs rework) or `unplayable` (contains something physically impossible at tempo).
4. List objections as in section 2.3: note ids, a kind from the vocabulary, a severity (`error` =
   physically impossible or a hard rule; `warning` = playable but ergonomically poor; `info` = a
   matter of preference), a problem of at most 25 words and a fix as a mapping from note id to
   finger. An empty list is a good answer when the fingering is sound; the reviewer must not invent
   notes or object to the music itself.
5. Add an optional comment of one or two sentences.

The brief says that the fingerings come from different sources (expert pianists, a computer program,
deliberately planted mistakes), that the reviewer is not told which is which and should not guess.
The output is one JSON document and nothing else: `batch`, `started_at` and `finished_at` (UTC
timestamps taken before reading and after writing), and `items`, one per passage in input order, each
with `item`, `readback` (only for the reviewed hands), `scores`, `verdict`, `objections` and `comment`.

## 8. Limitations

* **Synthetic faults are easier than real engine errors.** The planted faults are gross, local
  violations of hard rules; an engine's real mistakes are mostly soft (a plausible but
  uneconomical shift, a non-standard scale fragment) and are exactly what the `fhmm3` condition
  contains without per-note ground truth. Sensitivity on planted faults is an upper bound on
  sensitivity to real errors.
* **The expert condition is not error-free.** PIG annotators disagree on 30 to 40 percent of
  notes; an objection to an annotator's choice is counted as a false positive here even when it
  is musically defensible. Section 4.4 measures how often objections land on disputed notes and
  how often the proposed fix is another annotator's finger, which is the fairest reading.
* **One model family on both sides.** The reviewer is the same model family that will write the
  engine's rules and weights. Blind spots can be correlated, which is one reason the
  recommendation keeps the reviewer out of any gate.
* **Possible recall of the pieces.** The reviewer sees composer, genre and bar numbers of famous
  repertoire; it may recall standard editions' fingerings. For the use case (reviewing the
  engine's output on known pieces) that is realistic, but it inflates what the rendering alone
  conveys. The read-back check shows the rendering is at least read correctly.
* **Bars and beats of PIG passages are estimated** (section 2.2); six of the thirty test pieces
  were excluded for that reason, so the sample is 24 pieces, 40 passages, 1,007 reviewed
  notes per condition and run. Per-kind sensitivities rest on 6 to 24 planted faults each.
* **Two runs, one model, no human teacher.** Self-consistency is measured, inter-rater agreement
  with human teachers is not (literature 5.7 asks for several raters). The protocol is ready
  for that: the same batch files can be given to a teacher.
* **Cost is measured from the Agent tool's accounting** (all tokens a reviewer consumed, including
  reasoning); the input and output sizes are measured in characters. Prices are not quoted.

## 9. Sources

* Project documents: `docs/superpowers/specs/2026-10-13-verification-design.md` (oracles, error
  galleries, periodic qualitative review); `docs/research/literature.md` sections 4.1 to 4.3 and
  5.7 (checklist P1-P15, lint rules L01-L23, human evaluation protocol); `docs/research/datasets.md`
  sections 2.3, 2.6, 2.7 (PIG contents, anomalies, inter-annotator agreement); `docs/research/baselines.md`
  (FHMM3 outputs and scores); `research/data/README.md` and `research/data/manifests/pig_hmm_files.json`.
* Nakamura, E., Saito, Y., Yoshii, K. (2020). Statistical learning and estimation of piano
  fingering. *Information Sciences* 517, 68-85. PIG dataset v1.2: https://beam.kisarazu.ac.jp/research/PianoFingeringDataset/
  (non-profit academic use only); released HMM outputs: https://statpianofingering.github.io/demo.html
* Parncutt, R., Sloboda, J. A., Clarke, E. F., Raekallio, M., Desain, P. (1997). An ergonomic
  model of keyboard fingering for melodic fragments. *Music Perception* 14(4), 341-382 (span
  table and rules behind `possible`, `economical`, `beginner_friendly`).
* Srivatsan, N., Berg-Kirkpatrick, T. (2022). Checklist models for improved output fluency in
  piano fingering prediction. ISMIR (the "hops" metric and the 1-3 human rating scales that the
  rubric extends).
* Randolph, D. (pydactyl, MIT): Beringer & Dunhill scale and arpeggio fingerings used by the
  textbook oracle that the `idiomatic` criterion refers to.
