# Hard errors after learning (M3 Task 7, step 1)

Date: 2026-10-14. Plan: `docs/superpowers/plans/2026-10-13-m3-learning.md`, Task 7 with the binding corrections 10 and 13. Protocol: verification spec section 4 (`docs/superpowers/specs/2026-10-13-verification-design.md`). The hypotheses this report motivates, and their outcomes, are in `docs/experiments.md` ("Hard-error iteration").

## What was measured

- **Pieces.** The 20 PIG validation pieces of `research/data/splits/pig_validation.json` (031 034 038 039 041 046 052 053 066 076 077 080 082 083 098 117 118 119 120 138; 8,936 notes). No PIG test piece (001 to 030) was decoded or read for this report.
- **Engine.** The Task 4 tree: the research set `learned-pig` (median seed 20261014, `research/weights/pig/weights-learned-pig.json`, PIG licence, never shipped) and, for comparison, the M2 rules (`parncutt`) and the shipped `learned-open`. Profile `large`, templates on, every hard rule of the M2 hardening.
- **Galleries.** `digitus2 bench --subset validation` (the option this task adds) wrote one page per piece under `research/weights/pig/errors/m3-pig-validation/` (gitignored with the weights, because they quote PIG fingerings).
- **Hard error.** A note where every annotator gives the same finger and the engine gives another. 16 of the 20 validation pieces have one annotator, so here "unanimous" mostly means "the annotator's finger". The bench's own hard-error rate needs at least two annotators (`src/eval/hardErrors.ts`): on the 4 validation pieces with two (046, 066, 076, 077; 606 unanimous notes) the pig set misses 120, 19.8 percent.
- **Rule attribution.** For each run of consecutive hard errors in one hand, the expert's fingers replace the engine's on the run and the difference of the weighted path features (`pathFeatures`, the solver's own cost) is split by rule. "Push" is the rule that adds the most cost to the expert's choice (why the engine did not take it); "favour" is the rule that saves the most. A run whose expert fingering breaks one of the solver's hard rules (a chord law or a held-note law) is marked with that rule instead.

Scripts (not tracked, run from the session scratchpad on the built engine): `analyze.mjs` (per-note table), `summarize.mjs` (patterns), `chordsplit.mjs` (chord terms by pair kind), `lawcheck.mjs` (law errors against an exact minimum).

| weight set (validation, bench scorer) | macro M_gen | hard errors (unanimous gold) | lint errors per 1000 |
| ------------------------------------- | ----------- | ---------------------------- | -------------------- |
| parncutt (M2 rules)                   | 69.06       | 2,394 of 8,633 (27.7%)       | 10.85                |
| learned-pig (research)                | 70.22       | 2,249 of 8,633 (26.1%)       | 10.85                |
| learned-open (shipped)                | 67.02       | 2,666 of 8,633 (30.9%)       | 10.97                |
| chirality, exact Parncutt, uniform    | 71.85       | not computed                 | not linted           |

## The ten most frequent hard-error patterns (learned-pig)

A pattern is the engine's finger, the unanimous expert finger and the texture (a chord note, or a melodic note with the interval from the previous note of the hand). "After" is the interval to the next note; "black" is the share of the pattern's notes on black keys; "IOI" the two most common inter-onset buckets. Example locations are PIG note ids (first column of the fingering file) with their onset.

| #   | engine → expert, texture | notes | share | pieces | after                  | black | IOI                       | push (expert's extra cost)                                    | favour (expert's saving)      | examples                                        |
| --- | ------------------------ | ----- | ----- | ------ | ---------------------- | ----- | ------------------------- | ------------------------------------------------------------- | ----------------------------- | ----------------------------------------------- |
| 1   | 5 → 4, chord             | 185   | 8.2%  | 17     | chord                  | 49%   | 0.3-0.6 s 42%, rest 27%   | chordLargeSpan 29%, handPositionShift 24%, weakFinger 16%     | weakFifth 69%                 | 031 R note 39 (3.87 s, G5); 034 R note 2 (C4)   |
| 2   | 3 → 2, chord             | 118   | 5.2%  | 15     | chord                  | 37%   | 0.15-0.3 s 48%            | handPositionShift 31%, tr:32:down 20%, largeSpan 9%           | tr:21:down 44%                | 031 R note 611 (48.34 s, F5); 034 R note 19     |
| 3   | 2 → 1, chord             | 116   | 5.2%  | 11     | chord                  | 80%   | 0.15-0.3 s 50%, rest 26%  | on:1:black 21%, tr:52:down 20%, tr:32:down 19%                | tr:31:down 37%                | 034 R note 22 (5.67 s, B3); 038 L note 17 (Eb3) |
| 4   | 4 → 3, chord             | 97    | 4.3%  | 16     | chord                  | 43%   | 0.15-0.3 s 31%            | chordLargeSpan 29%, on:1:black 16%, handPositionShift 13%     | tr:31:down 50%                | 031 R note 84 (8.00 s, D6); 034 R note 23       |
| 5   | 2 → 3, chord             | 92    | 4.1%  | 14     | chord                  | 38%   | rest 41%, 0.15-0.3 s 30%  | weakFifth 35%, chordLargeSpan 15%, held same finger (law) 9%  | weakFinger 33%, ch:12 29%     | 031 R note 366 (28.70 s, D5); 034 R note 15     |
| 6   | 4 → 5, chord             | 85    | 3.8%  | 12     | chord                  | 48%   | rest 48%, 0.15-0.3 s 29%  | weakFifth 65%, held same finger (law) 13%                     | weakFinger 45%                | 031 L note 1013 (79.34 s, G1); 034 R note 16    |
| 7   | 2 → 1, melodic, step down | 70   | 3.1%  | 9      | step up 53%            | 31%   | under 0.15 s 74%          | positionChangeSize 26%, tr:32:down 14%, shiftFast 11%         | positionChangeCount 16%       | 031 R note 157 (12.83 s, D3); 034 R note 123    |
| 8   | 2 → 3, melodic, step down | 60   | 2.7%  | 9      | step up 50%            | 72%   | under 0.15 s 67%          | tr:32:down 47%, fourOnBlack 15%                               | tr:43:down 68%                | 031 R note 209 (16.04 s, Eb3); 034 R note 426   |
| 9   | 3 → 2, melodic, third up | 55    | 2.4%  | 10     | third down 67%         | 36%   | under 0.15 s 71%          | tr:32:down 36%, shiftFast 20%, positionChangeSize 9%          | tr:21:down 55%                | 031 L note 788 (61.97 s, F3); 034 R note 1401   |
| 10  | 3 → 4, chord             | 51    | 2.3%  | 11     | chord                  | 43%   | rest 57%, 0.15-0.3 s 28%  | tr:31:down 28%, weakFinger 24%, chordLargeSpan 20%            | ch:24 24%, chordLargeSpan 20% | 031 R note 634 (50.09 s, G5); 034 R note 8      |

The same table for the M2 rules has the same leader (5 → 4 in a chord, 185 notes) but there the push is chordLargeSpan in 60 percent of the notes and the hard-error runs cost the expert 5.50 units more per run (median) against 1.75 for learned-pig: learning made the engine's mistakes cheap, not rare.

What the table says:

1. **Chords.** Seven of the ten patterns are chord notes. Chord notes are 42 percent of the unanimous notes (3,639) and 38 percent of the hard errors (851); their error rate (23.4 percent) is below the melodic one (28.0 percent), but they are the biggest single group. Split by where the cost sits (`chordsplit.mjs`, learned-pig, the 498 chord runs without a broken law, 1,115 cost units in total): the span and shift terms of the moves into and out of chords carry 515 units (largeSpan 146, handPositionShift 115, shiftFast 103, smallSpan 82, stretch 47, beyondPractical 22), the terms inside the chord 390 (chordLargeSpan 182, handPositionShift 96, chordStretch 49, `ch:*` 42, chordSmallSpan 19). Both are priced with Parncutt's melodic span tables, doubled inside a chord, whatever the interval: hypotheses H2 (a chord-adjacent copy of the span terms) and H3 (chord-pair indicators by interval width).
2. **The hard-rule ceiling.** In 88 of the 1,087 hard-error runs (8.1 percent, 228 notes) the expert's fingering breaks a hard rule of the solver: a held key spanned beyond practical (47 percent), the same finger on a key still held (46 percent), a chord span (8 percent). The same-finger cases are legato overlaps: median 30 ms, 24 of 44 at most 50 ms, 35 at most 100 ms. This is binding correction 10's ceiling: hypothesis H1 (a hold tolerance of 50 ms).
3. **Melodic runs** (patterns 7 to 9): fast (IOI under 0.15 s), stepwise, pushed by the transition indicators the learning made negative for the engine's choice (`tr:32:down`, `tr:21:down`) and by the position terms. No candidate feature in the plan targets them more directly than the learned `tr:*` already do; the iteration left them alone.

## Note by note against chirality (exact Parncutt, uniform weights)

chirality ([vibetuned/chirality](https://github.com/vibetuned/chirality), commit cd9c54e, AGPL-3.0; registry entry `chirality`, outputs `research/baselines/outputs/chirality_parncutt_viterbi_uniform/<id>-1_fingering.txt`, read for the 20 validation pieces only) is an exact second-order Viterbi over Parncutt's twelve rules with uniform weights. It scores 65.4 on the test split against the M2 rules' 61.9 (baselines report), and 71.85 on validation against 69.06 (parncutt) and 70.22 (learned-pig). Its predictions were aligned to the engine's notes by onset and pitch, so every disagreement is on the same note.

| engine set   | notes compared | disagreements   | chirality right, engine wrong | engine right, chirality wrong | both right | both wrong | runs  | on chord notes |
| ------------ | -------------- | --------------- | ----------------------------- | ----------------------------- | ---------- | ---------- | ----- | -------------- |
| parncutt     | 8,936          | 2,128 (23.8%)   | 1,019 (47.9%)                 | 732 (34.4%)                   | 58         | 319        | 1,135 | 838 (39.4%)    |
| learned-pig  | 8,936          | 1,932 (21.6%)   | 834 (43.2%)                   | 700 (36.2%)                   | 65         | 333        | 998   | 861 (44.6%)    |

"Right" means the finger matches at least one annotator. Learning removed 196 disagreements and moved the balance towards the engine (the net loss on disagreements fell from 287 notes to 134), but chirality still wins more of them than it loses.

The three most frequent disagreement patterns (engine finger → chirality's finger), with what the engine's own weights charge chirality's choice ("push") and what they save ("favour"):

| set         | #   | pattern      | notes      | push                                                             | favour                         | reading                                                                                                                                                                                                                                                              |
| ----------- | --- | ------------ | ---------- | ---------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| learned-pig | 1   | 3 → 2, chord | 172 (8.9%) | handPositionShift 37%, tr:32:down 11%, chordLargeSpan 6%         | tr:21:down 55%, weakFifth 12%  | chirality keeps a narrower hand on a chord (2 instead of 3 on an inner note); our five-finger anchor charges the move that 2 implies on the next note. chirality is right in 98 of these notes, the engine in 55.                                                   |
| learned-pig | 2   | 5 → 4, chord | 169 (8.7%) | weakFinger 27%, handPositionShift 25%, chordLargeSpan 21%        | weakFifth 73%                  | the top of a chord on 4 rather than 5: our weights charge the weak fourth finger and the chord span of 4 on a wide interval, which Parncutt's monophonic rules in chirality price less. Split: chirality right 66, engine right 88: the engine's choice is defensible. |
| learned-pig | 3   | 2 → 1, chord | 112 (5.8%) | handPositionShift 25%, on:1:black 20%, chord order (law) 13%     | tr:21:down 53%                 | the thumb on the bottom of a chord where the engine uses 2, two thirds of them on black keys: the learned `on:1:black` (0.87) and the anchor term charge it; 13% of chirality's choices here cross fingers inside a chord, which our chord law forbids. chirality right 72, engine right 35. |
| parncutt    | 1   | 5 → 4, chord | 194 (9.1%) | chordLargeSpan 60%, handPositionShift 20%, beyondPractical 7%    | weakFifth 50%, fiveOnBlack 27% | the rules double Parncutt's large span inside a chord (Balliauw), so 4 on a wide top note pays twice what it pays in chirality. chirality right 74, engine right 97.                                                                                                  |
| parncutt    | 2   | 3 → 2, chord | 174 (8.2%) | handPositionShift 68%, chordLargeSpan 13%, chord order (law) 5%  | none 60%, weakFifth 21%        | the hand-position term alone separates the two: with no learned transition weights, nothing favours chirality's 2. chirality right 71, engine right 68.                                                                                                             |
| parncutt    | 3   | 1 → 2, chord | 82 (3.9%)  | chordLargeSpan 37%, chord order (law) 16%, held same finger (law) 16% | thumbOnBlack 30%, largeSpan 18% | a third of chirality's choices break our chord order or a held key: chirality has no held-note law, so some of its "right" fingerings are fingerings our lint calls impossible.                                                                                    |

Where chirality is right and learned-pig is not, the rules charging its choice are tr:32:down (12 percent of the notes), shiftFast (11), handPositionShift (11), a held same finger (law, 7), the template (7), largeSpan (5) and chordLargeSpan (5); 247 of chirality's disagreeing notes break one of our hard rules (held same finger 49 percent, chord order 39 percent, held span 11 percent). The pieces where chirality gains most are 098 (79.2 against 66.3), 119 (79.6 against 67.6), 117 (68.6 against 60.4) and 031 (80.6 against 74.3); the engine leads on 138 (77.2 against 74.4), 118 (87.5 against 82.3) and 041 (63.8 against 59.6).

The comparison points the same way as the galleries: most of the gap is inside chords and around them, where Parncutt's monophonic tables (and our doubling of them) decide; the hand-position term, which chirality does not have, decides many of the chord disagreements both ways.

## Law errors of the learned sets on validation

Task 5 measured 3.91 lint errors per 1000 test notes for both learned sets against 3.81 for the rules; the hardening invariant says no law error (L01 to L05) may occur where a legal fingering exists. On validation each hand's law errors were compared with the exact minimum a fingering of that hand can have (an independent dynamic programme over every chord pair and held pair, chord order kept, checked by linting its own optimum: it lints to exactly the minimum on every hand).

| piece and hand        | notes | exact minimum | parncutt | learned-pig | learned-open | errors                        |
| --------------------- | ----- | ------------- | -------- | ----------- | ------------ | ----------------------------- |
| 031 R                 | 774   | 59            | 60 (+1)  | 60 (+1)     | 60 (+1)      | L03 56, L05 4                 |
| 031 L                 | 1,308 | 2             | 2        | 2           | 2            |                               |
| 034 R                 | 946   | 9             | 9        | 9           | 9            |                               |
| 034 L                 | 1,113 | 2             | 2        | 2           | 2            |                               |
| 038 R                 | 76    | 4             | 5 (+1)   | 5 (+1)      | 5 (+1)       | L03 5                         |
| 038 L                 | 38    | 6             | 7 (+1)   | 7 (+1)      | 8 (+2)       | open: L05 6, L03 2            |
| 039 L                 | 56    | 4             | 4        | 4           | 4            |                               |
| 098 R                 | 136   | 4             | 4        | 4           | 4            |                               |
| 098 L                 | 104   | 4             | 4        | 4           | 4            |                               |
| the other 31 hands    | 4,385 | 0             | 0        | 0           | 0            |                               |
| total                 | 8,936 | 94 (10.52/1000) | 97     | 97          | 98           |                               |

Every one of the 31 hands that has a fully legal fingering gets one from all three sets: the invariant holds on validation. The law errors are all in the nine hands that cannot be fingered legally (031, 034 and 098 have long notated holds under fast passages; 038 has chords spanning more than a hand). In three of those hands the solver stays one or two errors above the exact minimum, for every weight set: the law-domain pass lets go of the oldest held key when the laws cannot all hold, and that choice is not always the one that breaks the fewest laws. learned-open's one error more than the rules (98 against 97) is one of these: in 038 L it puts Eb3 and the C#2 that sounds under it on the same finger and breaks two held pairs where the rules break one (8 errors against 7, minimum 6). So the learned weights do not create law errors where a legal fingering exists; the excess over the minimum is the drop rule's, shared by all sets, and a fix belongs to the solver's law pass (a minimum-violation repair for hands without a legal fingering), not to lint.

## The library (binding addition 13)

| measure (library, profile medium, the Task 4 tree without the consistency pass) | parncutt  | learned-pig | learned-open |
| ------------------------------------------------------------------------------- | --------- | ----------- | ------------ |
| pairs of identical passages at the same place in the bar fingered alike (520)   | 228 (44%) | 283 (54%)   | 278 (53%)    |
| pairs of identical passages at any place in the bar fingered alike (1,217)      | 532 (44%) | 611 (50%)   | 553 (45%)    |
| repeated passages as a reader counts them, fingered alike (135)                 | 74        | 77          | 79           |
| thumb crossings inside one five-finger position, levels 1 and 2                 | 20        | 18          | 18           |

A pair of identical passages is two copies of at least four events (slices) of one hand with the same keys, durations and inter-onset intervals (`repeatPairs`: for every maximal run of matching events, the two copies' non-overlapping part), counted whatever any grouping keeps; "at the same place in the bar" adds that both copies start on the same beat (`barPositions`; a pickup bar counts from its end). The repeated passages as a reader counts them are the same matches grouped so that each event belongs to one group (`findRepeats`); that grouping misses a passage nested in a longer repeated one (Ode to Joy's bars 1-3 inside the repeat of bars 5-8 as 13-16), so it is a secondary count. A crossing inside one position is a thumb crossing between two single notes whose neighbours (two notes either side, no rest or chord between) span at most four white keys. Half the repeated passages of the library are fingered two ways: hypothesis H4 (the consistency pass). The crossings motivate H5. The first table of this section (2026-10-14, before the review of H4b) counted the `findRepeats` groups without bar positions: 100, 103 and 103 of 193.
