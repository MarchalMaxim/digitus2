# Experiments

Findings of the experiments on the solver, the learned weights, calibration, the floors and the MIDI hand separation: what was tried, what it was measured on, the result, and whether it was kept. It explains why parameters have their values and stops rejected ideas being tried again. The iteration protocol is section 4 of `docs/superpowers/specs/2026-10-13-verification-design.md`: state a hypothesis, change one thing, run `pnpm verify`, keep the change only if the primary metric improves without a floor breach, revert otherwise, and record the outcome either way. Milestone scorecards are in `benchmarks/history.md`.

## Method and vocabulary

- **Data used for decisions.** PIG train (pieces 031-150, 120 pieces), PIG validation (20 of those pieces, `research/data/splits/pig_validation.json`), the textbook oracle (672 entries, `benchmarks/textbook`), the 30 library benchmark pieces and the Mutopia train half (224 parts). The PIG official test split (pieces 001-030) and the Mutopia test half (62 parts of 48 pieces) are scored once per milestone for the record and never tuned on. PIG data is research only because its licence forbids redistribution: no shipped weight or table is fitted on it.
- **Metrics.** `gen`, `high`, `soft` and `rec` are the PIG scorer's general, highest, soft and recombination match rates, in percent, macro-averaged over pieces. The hard-error rate is the share of mismatches on notes where every annotator of a piece agrees. Lint errors are violations of the lint laws per 1000 notes: L01 two simultaneous notes share a finger, L02 crossed fingers inside a chord, L03 a finger reused while it holds a key, L04 more than five simultaneous notes in one hand, L05 a span beyond the practical maximum on keys held together. Textbook "exact" counts oracle entries fingered exactly as the books print (of 672); it is scored at quarter = 120 (inter-onset interval 0.5 s) and at qpm 480 (0.125 s).
- **Ablation.** Each non-zero weight is set to 0 in turn. The delta is in points against all rules: negative means the rule helps, positive means removing it helps.
- **Weight sets.** `parncutt`: the rule weights of the literature with a few weights set as described below, not fitted to data; the solver's own default. `learned-open`: the shipped set (`RECOMMENDED_WEIGHT_SET`), fitted on the textbook oracle, Beringer and the Mutopia train half, no PIG data. `learned-pig`: research only, fitted on PIG train minus validation.

## Solver rules and weights

The rules solver is Parncutt 1997, Jacobs and Balliauw rule terms, a hand-position term, textbook templates and an exact second-order Viterbi decode with held-note constraints. Its weights start from the literature (Parncutt et al. 1997, Balliauw et al. 2017 chord rules) and changed only where the entries below say so.

### Starting point: rules alone

Hypothesis: the exact rule-based Viterbi reaches at least the rule-based baselines (about 59). Measured on the PIG test split (30 pieces, 0 skipped): gen 59.74, high 66.02, soft 80.28, rec 70.05, hard-error rate 23.53. Lint errors 22.10 per 1000 notes (226 errors: L05 211, L03 15); the experts' own fingerings of the same pieces score 47.4 under that first lint. Textbook at quarter = 120: note accuracy 0.527, scales 0.552, exact 29 of 672. The metamorphic suite passes.

The gen of 59.74 clears the "about 59" level but sits below every Parncutt-family baseline measured on the same split in `docs/research/baselines.md`: pydactyl Badgerow 61.4, Balliauw 61.7, Parncutt 62.9, Jacobs 63.6, chirality's exact uniform-weight Parncutt Viterbi 65.4; also below Nakamura CHMM at 62.1, so the spec's gen gate is not met by rules alone. Ablation on test (seen on test, so only a lead): handPositionShift −4.87, thumbOnBlack −2.20, hop −1.62, positionChangeSize −1.12, chordLargeSpan −1.03; removing beyondPractical gained +0.92. **Partly confirmed.** The next questions were fitted weights and why beyondPractical hurts.

### What each rule change bought

PIG train gen after each step, with PIG test gen where it was scored (once per step, never tuned on) and textbook exact at quarter = 120. Each step is described below.

| Change                                                                  | PIG train gen | PIG test gen | Textbook exact |
| ----------------------------------------------------------------------- | ------------- | ------------ | -------------- |
| Rules as first built                                                    | 61.34         | 59.74        | 29             |
| Held-note loop keeps one side; doubled finger in slices over five notes | 62.05         | -            | 29             |
| Hop within a fourth costs 2 points, hop weight 10                       | 63.61         | -            | 410            |
| chordBeyondPractical 30                                                 | 63.91         | 60.91        | 410            |
| Hardening: every chord pair priced, holds beyond reach released         | 65.22         | 61.60        | 486            |
| Hardening re-review: held keys priced like chord partners               | 65.91         | 61.89        | 486            |

### Held-note loop and doubled fingers

Hypothesis: the held-note loop over-constrains. Forbidding only the later note's finger makes the decoder move the held note, whose new finger is forbidden next, until the hard decode is infeasible and the solver relaxes (Satie, Gymnopedie No. 1). A slice of more than five notes also puts one finger on every note (Chopin Op. 28 No. 4, last chord).

Change: each conflict (a note still sounding at the onset of a note at least three steps later, same finger) moves one note and keeps the other. The moving note is forbidden the shared finger and every finger that would cross the kept one; the kept note joins `held`. The note whose cheapest allowed finger costs less moves; a pinned or kept note never moves. Every held-note cost is finite (1000) in every mode, so only pins against the chord rules relax a hand; `maxHeldIterations` 5 → 8. A doubled finger in a slice of more than five notes costs 50 (100 unless it is the thumb on two adjacent white keys, the one double lint L01 accepts) on top of its chord span terms. It became the named rule `doubledFinger` (weight 50, 1 point for the thumb on two adjacent white keys, 2 otherwise) so that the solver cost stays weights times path features.

Result on PIG train: gen 61.34 → 62.05, relaxed hands 8 → 0, L03 in the engine's output 67 → 36 (17 under legato overlaps below 60 ms, 13 where the held keys span more than 15 semitones, 1 with more than five keys, 5 other). Library (30 pieces): relaxed hands 2 → 0, L03 9 → 2 (Moonlight's last bars, a held texture 27 semitones wide). Chopin Op. 28/4 last chord 1 1 1 1 1 1 → 5 4 3 2 2 1 (L01 15 → 1). A Lagrangian variant (raise a cost on the bad fingers of both notes of each conflict) did worse: train gen 61.87, L03 65, library L03 19. **Kept.**

### Hop rule

Hypothesis: a slow same-finger hop costs only 0.5 × 3 = 1.5, less than any thumb crossing, so textbook scales and arpeggios fail at quarter = 120 (left-hand C major 5 4 3 2 1 1 2 2) and real pieces hop stepwise 26 times per 1000 notes (experts 3.8).

Change (`rules.ts`): a hop within a perfect fourth (`hopStepMax` 5 semitones) costs 2 points at any inter-onset interval, a slower wider leap 0.5; hop weight 3 → 10. Chosen by the sweep below, on PIG train and the textbook oracle only.

Result: PIG train gen 62.05 → 63.61; textbook note accuracy at quarter = 120 0.527 → 0.842; exact 29 → 410 of 672 (scales 330 of 432, arpeggios 80 of 192, chromatic 0 of 48); right hand 0.516 → 0.873, left hand 0.539 → 0.811; sixteenths 0.756 → 0.842, now the same as quarters. Stepwise same-finger hops per 1000 notes: train 12.13 → 0.88 (the first annotator's 2.42), library 26.12 → 2.55. **Kept.**

Sweep. PIG train (120 pieces) and the textbook oracle only; PIG test was not looked at. Every run includes the held-note and doubled-finger fixes. `K` is the widest interval in semitones at which a slow hop costs the full 2 points (0 = the planned rule, where every slow hop costs 0.5); `slow` is the points of a slower, wider hop; `W` the hop weight. Textbook at quarter = 120 with templates on. Library lint errors per 1000 notes are under the first lint.

| K   | slow | W   | train gen | train high | textbook note | textbook exact | stepwise hops per 1000 (train) | library lint err/1000 |
| --- | ---- | --- | --------- | ---------- | ------------- | -------------- | ------------------------------ | --------------------- |
| 0   | 0.5  | 3   | 62.05     | 63.25      | 0.527         | 29             | 12.13                          | 27.85                 |
| 0   | 0.5  | 6   | 62.70     | 63.95      | 0.639         | 49             | 7.77                           | 27.95                 |
| 0   | 0.5  | 10  | 63.22     | 64.47      | 0.715         | 110            | 4.68                           | 28.06                 |
| 0   | 0.5  | 15  | 63.60     | 64.90      | 0.803         | 259            | 2.70                           | 28.06                 |
| 0   | 0.5  | 20  | 63.65     | 64.96      | 0.824         | 294            | 1.92                           | 29.28                 |
| 0   | 0.5  | 30  | 63.79     | 65.13      | 0.840         | 392            | 0.94                           | 32.03                 |
| 0   | 0.5  | 50  | 63.98     | 65.30      | 0.843         | 428            | 0.29                           | 33.36                 |
| 0   | 0.5  | 100 | 64.24     | 65.56      | 0.843         | 428            | 0.08                           | 37.44                 |
| 2   | 0.5  | 3   | 62.28     | 63.52      | 0.685         | 97             | 7.14                           | 27.95                 |
| 2   | 0.5  | 5   | 62.78     | 64.09      | 0.757         | 184            | 3.19                           | 27.95                 |
| 2   | 0.5  | 10  | 63.38     | 64.71      | 0.794         | 311            | 0.83                           | 28.06                 |
| 2   | 0.5  | 20  | 63.61     | 64.96      | 0.836         | 376            | 0.16                           | 29.89                 |
| 2   | 0.5  | 30  | 63.74     | 65.10      | 0.840         | 392            | 0.08                           | 32.75                 |
| 2   | 1    | 10  | 63.58     | 64.92      | 0.836         | 376            | 0.83                           | 28.16                 |
| 2   | 1    | 20  | 63.85     | 65.18      | 0.842         | 410            | 0.18                           | 30.40                 |
| 3   | 0.5  | 10  | 63.44     | 64.76      | 0.838         | 374            | 0.83                           | 27.95                 |
| 4   | 0.5  | 5   | 63.12     | 64.42      | 0.824         | 288            | 3.66                           | 27.85                 |
| 4   | 0.5  | 7   | 63.39     | 64.70      | 0.845         | 381            | 1.90                           | 27.95                 |
| 4   | 0.5  | 10  | 63.55     | 64.87      | 0.850         | 404            | 0.86                           | 27.95                 |
| 4   | 0.5  | 15  | 63.73     | 65.08      | 0.845         | 404            | 0.42                           | 28.36                 |
| 4   | 0.5  | 20  | 63.73     | 65.07      | 0.841         | 404            | 0.16                           | 29.69                 |
| 4   | 1    | 10  | 63.70     | 65.03      | 0.841         | 404            | 0.86                           | 28.16                 |
| 5   | 0.5  | 10  | 63.61     | 64.92      | 0.842         | 410            | 0.86                           | 28.06                 |
| 7   | 0.5  | 10  | 63.57     | 64.89      | 0.842         | 410            | 0.86                           | 28.06                 |
| 7   | 0.5  | 20  | 63.69     | 65.02      | 0.843         | 428            | 0.16                           | 29.99                 |

Chosen: K 5, slow 0.5, W 10, not by train gen alone. A plain high hop weight gains up to 0.6 more train gen, but it also makes a slow same-finger shift over a wide leap expensive, so the solver stretches beyond the practical span instead (library lint errors 27.85 → 37.44 per 1000 at W 100, under the first lint). The within-a-fourth rule keeps wide slow leaps cheap and reaches the textbook plateau (0.842 to 0.850) at W 10. Among K 4, 5 and 7 at W 10 the differences are within 0.06 train gen; K 5 also fingers the left-hand C major arpeggio 5 3 2 1 3 2 1 without the template bonus. Further gains were left to fitted weights.

### chordBeyondPractical

Hypothesis: under the new hop rule a chord span beyond the practical maximum (physically impossible, lint law L05) must cost more than a hop within a fourth (2 × 10 = 20), or the solver trades hops for impossible chords (`fixtures/two-staff.musicxml`: B3 D5 fingered 1-4, an L05 error).

Change: `chordBeyondPractical` 10 → 30, the smallest round weight above 20. Result: PIG train gen 63.61 → 63.91; train L05 (first lint) 1064 → 982; textbook unchanged (no chords). Sweep: 50 → 64.02, 100 → 64.17, 300 → 64.23; higher weights were left to fitting. **Kept at 30.** The learned sets later shrink it (22.30 pig, 0.57 open) because the chord law is infinite wherever a legal configuration exists.

### Hardening: every chord pair priced, holds beyond reach released

Hypothesis: pricing every chord pair, releasing holds beyond reach, and waiving beyondPractical after rests and on thumb crossings raises textbook exact matches and removes chord-law violations; expected gen on PIG train +1 or more. One known failure motivated the waiver: the right-hand C major arpeggio over two octaves came out 1 2 1 1 2 3 5, because passing the thumb under 3 for a fourth is beyond Parncutt's practical span for fingers 3-1 (4 semitones), so beyondPractical charged 10 on top of stretch and largeSpan.

Change (`solve.ts`, `rules.ts`, `reach.ts`; no weight changed):

- The chord span terms of notes two apart in a slice go through the triple term (`tripleTerms`).
- A chord pair beyond its practical span costs the chord-law penalty (infinite, `SOFT_PENALTY` when soft) wherever the slice has a legal configuration. A post-decode chord loop forbids a decoded configuration that breaks a pair three or four apart (at most 8 rounds). A slice with no legal configuration keeps the finite chordBeyondPractical price and is listed in `infeasibleSlices`.
- A held note more than maxPrac(1, 5) = 15 semitones from the new note does not block a finger (`outOfReach`).
- Melodic beyondPractical is skipped after a rest, a release or a hold beyond reach, and on thumb crossings by fingers 2-4 within a fourth.
- A chromatic run takes the template with 8 points per note instead of 1 (`chromaticTemplatePoints`; 6 is the smallest integer at which all 48 chromatic entries come out exact, 8 leaves a margin).
- Lint checks every key still held against every later note it sounds with (L05); a hold beyond reach is an L07 warning.

Measured on PIG train and the textbook oracle; the test split was scored once, after. PIG train gen 63.91 → 65.22 (+1.31). PIG test 60.91 → 61.60 (high 66.84 → 67.59, soft 81.65 → 82.38, rec 71.46 → 72.26, hard-error 21.88 → 20.84). Textbook exact 410 → 486 of 672 (scales 330 → 330 of 432, arpeggios 80 → 108 of 192, chromatic 0 → 48 of 48), note accuracy 0.842 → 0.880 (arpeggios 0.733 → 0.774, chromatic 0.628 → 1.000, scales 0.914); right hand 0.873 → 0.923, left hand 0.811 → 0.838, with left-hand arpeggios (46 of 96, note accuracy 0.650) the weakest group. Chord spans beyond practical in a slice with a legal configuration: 0 on test (68 before), train and library. Every remaining chord-span L05 is in a slice with no legal configuration (test 14 in 7 slices, train 41 in 29, library 63 in 19). **Kept.**

Under the stricter lint, errors per 1000 notes were test 12.42, train 16.94 and library 13.67 (the experts under the same lint: test 8.00, train 16.67). The held-pair errors (98 of 112 L05 on test) were the decoder seeing a held key only from the next note; the next entry fixes that. Of the 126 train L03, 115 were on a note that starts a chord: with the chord law infinite and the held-note penalty 1000, the solver reuses a held finger (98 times under a PIG legato overlap below 60 ms) rather than play an impossible chord.

### largeSpan on short thumb crossings

The hardening waives beyondPractical on a thumb crossing by finger 2, 3 or 4 within a fourth. Question: does waiving largeSpan there too help? The rule was to keep the variant with the better textbook exact rate that does not lower PIG train gen. Measured on the textbook oracle at both tempos and PIG train; PIG test was not looked at.

| variant                  | textbook exact (quarter = 120 and qpm 480) | note accuracy | scales exact | arpeggios exact | right / left exact | train gen |
| ------------------------ | ------------------------------------------ | ------------- | ------------ | --------------- | ------------------ | --------- |
| largeSpan charged (kept) | 486 of 672                                 | 0.8802        | 330 of 432   | 108 of 192      | 257 / 229          | 65.91     |
| largeSpan waived         | 480 of 672                                 | 0.8878        | 336 of 432   | 96 of 192       | 251 / 229          | 65.58     |

**Kept: largeSpan stays charged.** The waiver gains six scales and note accuracy but loses twelve arpeggios (the exact rate falls) and 0.33 train gen.

### Ablation on PIG train

PIG train (120 pieces) with the rules after the hardening re-review; most harmful removal first. The test column is reported only and was not used for any decision.

| rule                     | train gen | train high | train soft | train rec | test gen |
| ------------------------ | --------- | ---------- | ---------- | --------- | -------- |
| hop                      | -3.97     | -4.04      | -4.05      | -4.15     | -2.38    |
| handPositionShift        | -2.55     | -2.58      | -2.72      | -2.68     | -4.21    |
| positionChangeSize       | -1.25     | -1.27      | -1.24      | -1.24     | -1.15    |
| chordLargeSpan           | -0.89     | -0.90      | -0.92      | -0.96     | -0.78    |
| thumbOnBlack             | -0.72     | -0.54      | -0.80      | -0.62     | -1.83    |
| smallSpan                | -0.67     | -0.65      | -0.71      | -0.74     | +0.03    |
| weakFinger               | -0.63     | -0.70      | -0.67      | -0.69     | -0.19    |
| fiveOnBlack              | -0.25     | -0.29      | -0.25      | -0.26     | -0.33    |
| largeSpan                | -0.20     | -0.08      | -0.20      | -0.21     | -0.22    |
| chordSmallSpan           | -0.19     | -0.19      | -0.19      | -0.19     | +0.04    |
| template                 | -0.16     | -0.06      | -0.13      | -0.13     | -0.28    |
| weakFifth                | -0.13     | -0.09      | -0.15      | -0.15     | -0.01    |
| positionChangeCount      | -0.12     | -0.07      | -0.12      | -0.12     | -0.11    |
| chordStretch             | -0.10     | -0.11      | -0.10      | -0.11     | +0.01    |
| repeatedNoteSameFinger   | -0.05     | -0.05      | -0.04      | -0.05     | -0.08    |
| thumbPassing             | -0.04     | -0.04      | -0.03      | -0.04     | -0.14    |
| threeFourFive            | -0.01     | +0.01      | 0.00       | +0.03     | +0.07    |
| chordBeyondPractical     | 0.00      | 0.00       | 0.00       | 0.00      | 0.00     |
| doubledFinger            | 0.00      | 0.00       | 0.00       | 0.00      | 0.00     |
| repeatedNoteFingerChange | 0.00      | -0.01      | +0.01      | 0.00      | -0.01    |
| sameFingerPivot          | +0.03     | +0.07      | +0.04      | +0.04     | +0.02    |
| fourOnBlack              | +0.04     | +0.02      | +0.04      | +0.04     | +0.15    |
| beyondPractical          | +0.05     | +0.04      | +0.02      | +0.03     | -0.01    |
| threeToFour              | +0.08     | +0.09      | +0.09      | +0.10     | +0.07    |
| stretch                  | +0.50     | +0.49      | +0.51      | +0.52     | +0.05    |

Positive removal deltas on train: stretch +0.50, threeToFour +0.08, beyondPractical +0.05, fourOnBlack +0.04, sameFingerPivot +0.03. Only stretch is above 0.2, and it is positive on all four metrics (high +0.49, soft +0.51, rec +0.52). These were left to the fitted weights (verification spec 3.8: a wrong weight or a double count); the learned sets cut beyondPractical from 10 to 0.24 (pig) and 0.39 (open).

Two earlier readings explain the current values. Before the hardening, removing beyondPractical gained +0.60 on test and chordBeyondPractical cost −0.60; once the charges that made beyondPractical hurt were gone (leaps after a rest or a release, thumb crossings) it is neutral, and chordBeyondPractical, which now prices only slices with no legal configuration, is neutral too. doubledFinger has no effect on PIG (no slice there has more than five notes in one hand).

### Solve time

Time per 1000 notes on PIG test: 31 ms for the first rules, 36 ms after the re-review, 63 ms for learned-open with the consistent-repeats pass (parncutt 69 ms). The 2000-note random walk of `solve.test.ts` (right hand, `solveFingering`) takes 55 ms warm after the hardening, 66 to 74 ms with any of the three sets before the repeats pass, and about 125 ms with it (learned-open 124 ms, parncutt 129 ms). The test holds both sets to a 500 ms budget. Solving the 30 library pieces with the pass takes 461 to 490 ms instead of 310 to 386 ms (learned-open, profile large).

## Held-note law: hold tolerance and the drop rule

A key held under a later note is a law at any distance: the same finger or a span beyond practical is forbidden, and solver and lint walk the same holds (`reach.ts` `forEachHold`).

### Pricing a held key like a chord partner; the drop rule

Hypothesis: the hardened solver still breaks held-key laws (L05 between a held key and a later note, L03 under a chord whose own law is infinite) where a fully legal fingering exists, because the decoder sees a held key only from the next note and the held-note loop only mends a reused finger. Pricing a held key like a chord partner, at every distance, removes the avoidable errors and brings the lint gate back below the 8.32 it had before the lint became stricter, without costing gen. This is the hardening invariant: no law error occurs where a legal fingering exists.

Change:

- `forEachHold` walks a hand's held keys once for solver and lint. A hold beyond reach of a slice is released for good, decided per slice; a repeated key is no hold.
- A note one or two steps after a key that is still down pays the held-note penalty (1000, as for a reused finger) for the same finger or a span beyond practical.
- `lawDomains` (arc consistency over every held pair and every chord pair, finger sets as bit masks, per component of the law graph) forbids from the start the fingers no law-keeping fingering can use. Where the laws cannot all hold, it lets go of the oldest key held over the note whose set emptied (as a player releases the oldest key when the fingers run out) and starts that component again.
- The held-note loop also mends a span beyond practical: the moving note takes a finger that spans the interval to the kept note, non-crossing first.
- A chord with no legal configuration gets one that breaks the fewest pairs (minimising semitones alone was worse). The window codes of forbidden chord configurations are kept apart by width, since a three-note code could match a pair of fingers.

Decided on PIG train, the textbook oracle and the library only; the test split was scored once, after. PIG train gen 65.22 → 65.91 (+0.69), PIG test 61.60 → 61.89 (high 67.59 → 67.93, soft 82.38 → 82.62, rec 72.26 → 72.56, hard-error 20.84 → 20.47). Textbook unchanged (exact 486 of 672 at both tempos). A mirror test (templates off, reversed and re-finalised input) gives 0 differing notes on Bach Invention 1, Für Elise, K. 545, Op. 69/2 and Satie.

| Lint errors per 1000 notes | PIG test | PIG train | Library |
| -------------------------- | -------- | --------- | ------- |
| Hardened solver            | 12.42    | 16.94     | 13.67   |
| After the re-review fixes  | 3.81     | 7.95      | 9.08    |
| Experts' own fingerings    | 8.00     | 16.67     | -       |

On the library the law errors fall 134 → 89 (L05 85: 60 chord spans in the 19 infeasible slices and 25 held pairs; L03 2, L04 1, L01 1; Satie 37, Moonlight 25, Chopin Op. 28/4 22, Op. 28/7 4, Entertainer 1). Every library hand that has a fully legal fingering gets one: 55 of 60 hands, checked by an exact search in `solve.test.ts`. A 2000-note random walk with chords and holds goes 224 → 95 law errors (L03 52, L05 43; the minimum is 63, or 70 under the chord order).

Against the exact minimum under the lint (an exact search over every hand), the solver has 88 law errors without L04 against 61. Keeping the chord order (fingers strictly rise in a chord of at most five notes) the minimum is 85 and the solver is 3 above it, in Moonlight's left hand bar 23 (25 against 24) and in Op. 28/4's six-note chord (21 against 19). The other 24 of the gap are only avoidable by doubling a finger inside a chord of at most five notes (one L01 instead of several L05), which the chord order excludes.

The drop rule was chosen among variants on PIG train (gen, train lint errors), library law errors and random-walk law errors:

| Variant                                                 | Train gen | Train lint errors | Library | Walk |
| ------------------------------------------------------- | --------- | ----------------- | ------- | ---- |
| No law-domain pass                                      | 65.87     | 344               | 92      | 114  |
| The pass drops the law being checked                    | 65.77     | 315               | 89      | 87   |
| A component whose laws cannot all hold is left unpruned | 65.87     | 321               | 88      | 107  |
| Let go of the oldest hold (kept: best on train)         | 65.91     | 306               | 89      | 95   |

Without the pass the Entertainer's right hand keeps 4 library errors. Fewest breaks in infeasible chords against semitones only: train gen 65.91 against 65.90, library 89 against 91. **Kept.**

Known deviations, left open: (1) pairs three or four apart in a four- or five-note chord get the chord law (chord loop, law-domain pass) but no comfort terms (chordStretch, chordSmallSpan, chordLargeSpan), because a second-order decoder sees three notes at a time; a five-note chord has one configuration, so only the outer pair of a four-note chord is unpriced, and a slice-level term or expanded chord states would close it. (2) The held-note loop is greedy: the random walk keeps 25 law errors above the chord-order minimum (the library 3).

### Hold tolerance 50 ms (H1)

Hypothesis (H1 of the hard-error iteration below): a key whose notated offset is at most 50 ms after a later onset is a legato overlap, not a key held under that note. PIG experts play legato with overlaps below 60 ms (the held same-finger cases have a median overlap of 30 ms), and 88 hard-error runs (228 notes) of the pig set have an expert fingering that breaks a held-note law. Change: the hold tolerance of `forEachHold` becomes a parameter (`holdEpsSec`, default 1 ms) of the solver (`SolveOptions`, `RuleContext`), the trainer and lint, measured at 50 ms in all three. Expected: the trainer's 75 infeasible targets fall and validation gen rises by 1.0 or more; textbook unchanged; lint errors per 1000 no higher under the 50 ms law.

Result (three seeds, 20 validation pieces): gen 70.09 → 71.02 (+0.93), infeasible training targets 75 → 55, textbook exact 536 → 544. Under the current 1 ms law the solver's output doubles its lint errors (10.85 → 21.49 per 1000), because a 30 ms overlap on one finger is an L03 error there; under the 50 ms law it has slightly fewer than the baseline (2.57 against 2.69).

**Rejected: not kept at 50 ms.** +0.93 is short of the +1.0 threshold, and it changes the law itself. The tolerance stays a parameter, default 1 ms, of the solver (`SolveOptions.holdEpsSec`, `RuleContext.holdEpsSec`), the trainer (`TrainOptions.holdEpsSec`), lint (`LintOptions.holdEpsSec`) and the hold walk (`forEachHold`, `heldPairs`), with tests, so a later change can alter the law in all three at once; solver and lint must be given the same tolerance. A learned soft `heldSameFinger` term was not tried: under a 1 ms law it would put law errors where a legal fingering exists, which the hardening invariant forbids.

### Law errors of the learned sets on validation

Question: both learned sets score 3.91 lint errors per 1000 test notes against 3.81 for the rules, and the hardening invariant says no law error may occur where a legal fingering exists. Do the learned sets break it? Measured on the 20 validation pieces with an exact dynamic programme over every chord pair and held pair (chord order kept) that gives each hand's minimum number of law errors (L01 to L05), checked by linting its optimum (equal to the minimum on every hand). The per-hand table is in `docs/research/hard-errors-m3.md`.

Answer: no. The 31 hands that have a fully legal fingering get one from all three sets. All law errors are in the 9 hands that cannot be fingered legally (031 R and L, 034 R and L, 038 R and L, 039 L, 098 R and L; exact minimum 94 errors, 10.52 per 1000): parncutt 97, learned-pig 97, learned-open 98. The excess is in three hands and shared by every set: 031 R (60 against 59), 038 R (5 against 4) and 038 L (rules and pig 7, learned-open 8, against 6). learned-open's extra error is in 038 L, a hand of chords wider than the hand, where it puts a note and the bass note that sounds under it on one finger. These errors are not forced (the minimum is lower) but they are not where a legal fingering exists either: they come from the law-domain pass, whose drop of the oldest held key's law is not always the one that breaks the fewest laws. Raising the loop budgets (32 rounds) changes nothing; switching the pass off makes it worse (109 and 104). Left as a solver lead: a minimum-violation repair for hands without a legal fingering. Lint is right. The consistent-repeats pass changes none of these counts.

## Learning and weight sets

### Learned weight sets

Hypothesis: learned linear weights over the rule terms plus indicator and timing features beat the hand-tuned rules by 3 to 4 points of gen on the PIG test split (the baselines report +4.3 from learning for FingerFlow and +0.6 for chirality).

Change: `digitus2 learn --config pig|open` (`packages/engine/cli/learn.ts`) trains an averaged PA-I structured perceptron (C 0.2, rho 1, 12 epochs, averaging, penalty projection, `template` frozen at the Parncutt value 2, every example weight 1). It runs three seeds (20261013, 20261014, 20261015), keeps the best epoch of each on the 20 PIG validation pieces (pooled gen of the trainer's decode) and writes the seed with the median result. The features beyond the rule terms are key-colour indicators `on:<f>:<black|white>`, melodic transition indicators `tr:<g><f>:<up|down>` (hops included), chord pair indicators `ch:<g><f>`, and `latticeStep`, `levelChange`, `stretchFast`, `shiftFast` and `repeatFast`; all are 0 in the Parncutt set.

- `pig`: PIG train minus validation (100 pieces, 200 hand examples) → `research/weights/pig/weights-learned-pig.json` (gitignored; PIG licence, research only).
- `open`: textbook oracle (672) + Beringer (83) + Mutopia train half (224 parts) = 979 pieces, 1266 hand examples → `packages/engine/src/fingering/params/weights-learned-open.json` (shipped).

Training runs (validation = pooled gen of the trainer's decode on the 40 validation hands, 8,936 notes; the Parncutt weights score 70.79 on the same measure):

| config | seed     | best epoch | validation gen | train gen (best epoch) | updates per epoch  | infeasible targets | written |
| ------ | -------- | ---------- | -------------- | ---------------------- | ------------------ | ------------------ | ------- |
| pig    | 20261013 | 12         | 72.91          | 70.19                  | 199 to 200 of 200  | 75 of 200          |         |
| pig    | 20261014 | 11         | 72.59          | 70.30                  | 199 to 200 of 200  | 75 of 200          | yes     |
| pig    | 20261015 | 3          | 72.26          | 69.67                  | 199 to 200 of 200  | 75 of 200          |         |
| open   | 20261013 | 12         | 67.75          | 74.73                  | 885 to 911 of 1266 | 83 of 1266         | yes     |
| open   | 20261014 | 10         | 68.02          | 74.73                  | 878 to 919 of 1266 | 83 of 1266         |         |
| open   | 20261015 | 12         | 67.55          | 74.68                  | 889 to 937 of 1266 | 83 of 1266         |         |

Seed spread (sample standard deviation): pig 72.59 ± 0.33, open 67.77 ± 0.24. Three seeds take 70 s (pig) and 375 s (open). The pig validation curve peaks early (epoch 3 to 12) and stays within about 1 point; the open curve rises slowly over all 12 epochs.

Test-split record with the final engine (the consistent-repeats pass on): bench scorer, 30 PIG test pieces, 0 skipped; the Mutopia test half (62 parts, masked gold) scored once with the shipped set. Paired bootstrap of per-piece gen against `research/baselines/results_per_piece_test.csv`, 10,000 resamples, seed 1. Nothing was chosen on these.

| weight set             | gen   | high  | soft  | rec   | hard-error | lint per 1000 | ECE    | Δgen vs FHMM3 (95% CI) | Δgen vs FingerFlow-learned (95% CI) | Mutopia test gen |
| ---------------------- | ----- | ----- | ----- | ----- | ---------- | ------------- | ------ | ---------------------- | ----------------------------------- | ---------------- |
| learned-open (shipped) | 63.89 | 70.48 | 85.27 | 76.37 | 17.58      | 3.91          | 0.0684 | −1.12 [−3.93, +1.91]   | −4.74 [−6.84, −2.70]                | 65.48            |
| learned-pig (research) | 67.66 | 74.99 | 89.25 | 80.68 | 11.81      | 3.91          | 0.0451 | +2.65 [+0.07, +5.34]   | −0.97 [−2.73, +0.74]                | -                |
| parncutt (same engine) | 62.11 | 68.25 | 82.81 | 72.68 | 20.08      | 3.81          | -      | -                      | -                                   | 61.15            |

On PIG validation the gain is smaller: parncutt 69.06, learned-pig 70.22 (+1.16), learned-open 67.02 (−2.05), because the hardening raised the rules there from the prototype's 64.7 to 69.06, leaving less to learn. The shipped set is below the rules on validation but above them on PIG test (+1.78) and on the held-out Mutopia half (+4.33; the prototype measured +8.9 against the pre-hardening rules).

Textbook oracle (672 entries; scales 144 per octave count, arpeggios 192, chromatic 48), quarter = 120 / qpm 480. The open set is trained on the oracle, so its row is a training-set number.

| weight set   | exact     | one-octave scales | two-octave scales | three-octave scales | arpeggios | chromatic | note accuracy   |
| ------------ | --------- | ----------------- | ----------------- | ------------------- | --------- | --------- | --------------- |
| parncutt     | 486 / 486 | 126 / 126         | 126 / 126         | 78 / 78             | 108 / 108 | 48 / 48   | 0.8802 / 0.8802 |
| learned-pig  | 536 / 536 | 138 / 133         | 138 / 133         | 82 / 82             | 130 / 140 | 48 / 48   | 0.9547 / 0.9531 |
| learned-open | 601 / 580 | 140 / 138         | 140 / 138         | 103 / 100           | 170 / 156 | 48 / 48   | 0.9703 / 0.9666 |

Largest learned weights. pig: doubledFinger 45.10 (Parncutt 50), chordBeyondPractical 22.30 (30), tr:11:up 4.34, tr:11:down 3.97, tr:22:down 3.02, tr:22:up 2.82, tr:33:down 2.64, tr:44:up 2.35, tr:33:up 2.30, tr:55:down 2.03; the same-finger transitions take over from `hop` (10 → 1.18), and beyondPractical falls from 10 to 0.24. open: doubledFinger 42.55, tr:11:down 3.71, tr:55:up 3.54, ch:34 3.52, tr:11:up 2.76, tr:33:up 2.75, hop 2.58 (10), tr:44:up 2.46, ch:45 2.37; chordBeyondPractical falls from 30 to 0.57 and beyondPractical from 10 to 0.39. repeatedNoteFingerChange turns negative in both (−0.95, −0.94).

**Confirmed for the research set.** learned-pig gains +5.55 gen on PIG test over the rules (67.66 against 62.11; hard-error rate 20.08 → 11.81), above the 2-point acceptance and within 1 point of FingerFlow-learned. The shipped open set gains less and does not beat FHMM3 or FingerFlow on PIG, because it is not fitted on PIG. It becomes `RECOMMENDED_WEIGHT_SET` and the gate's set; the solver's own default stays parncutt. One- and two-octave scales are 126 of 144 exact with parncutt, not 100 percent; both learned sets raise them (pig 138, open 140 at quarter = 120).

### Hard-error iteration

Five hypotheses written from the hard-error galleries, a note-by-note comparison with chirality (both in `docs/research/hard-errors-m3.md`) and teacher notes from the daily UI review. Each hypothesis was stated before it was tried.

Measurement. Each hypothesis retrains the `pig` configuration (PIG train minus the 20 validation pieces, the settings above) with the three seeds and scores every seed's weights on the 20 validation pieces with the bench scorer (macro gen). Primary metric: the mean of the three seeds. Accepted when it improves by at least 1.0 (the seed noise is about 0.4, so the +0.3 first proposed is within it) and neither the textbook exact count (median seed) nor the validation lint errors per 1000 regress. H4 and H5 target the library: their primary metric is the library measure named with them, with validation gen not falling by more than the seed noise (0.4). The PIG test split is scored once per accepted hypothesis, for the record. Baseline: bench 70.10, 70.22, 69.96 (mean 70.09, sd 0.13); pooled 72.91, 72.59, 72.26 (72.59 ± 0.33); lint 10.85 errors per 1000 validation notes; textbook exact 536 of 672.

- **H1, hold tolerance 50 ms.** See "Hold tolerance 50 ms (H1)" above.
- **H2, chord-adjacent span family.** Add `adjStretch`, `adjSmallSpan`, `adjLargeSpan`, `adjShift`, `adjShiftFast`: the stretch, smallSpan, largeSpan, handPositionShift and shiftFast points of a pair of notes in different slices of which at least one is a chord (0 in the Parncutt set, signed when learned). Basis: six of the ten most frequent hard-error patterns are inside chords (5→4, 3→2, 2→1, 4→3, 2→3, 4→5; 38 percent of the pig set's hard errors), and the chord-adjacent span terms carry 515 of the 1115 cost units by which the experts' chord fingerings lose. Expected validation gen +1.0 or more; textbook and lint unchanged.
- **H3, chord width indicators.** Add interval-conditioned chord-pair indicators `chw:<g><f>:<w>` (neighbouring notes of a slice on fingers g < f, `w` the interval bucket `2` at most 2 semitones, `4` 3 or 4, `7` 5 to 7, `9` 8 or 9, `wide` 10 or more; 50 ids, 1 point each, 0 in the Parncutt set). Basis: Parncutt's span tables price a chord pair with melodic spans; chordLargeSpan, the in-chord handPositionShift, chordStretch and `ch:*` carry 390 of the 1115 units. Expected validation gen +1.0 or more.
- **H4, consistent fingering of repeats.** A post-pass in `solveFingering` behind `SolveOptions.consistentRepeats`. Teacher note: with the app's call (parncutt, profile medium) Ode to Joy bar 1 is fingered 2 2 3 5 against 3 3 4 5 in bars 5 and 13. Primary metric: the share of repeated passages of the 30 library pieces whose copies are fingered alike (`bench --library`); validation gen within 0.4 of the baseline (the experts rarely finger repeats differently, so no gain is expected there); textbook and lint unchanged. Two versions, below.
- **H5, `crossInPosition`.** Add a feature of 1 point on a thumb crossing (the thumb under a finger or a finger over the thumb, between notes of two single-note slices) when the run around the pair spans at most four white keys, so one five-finger position plays it without crossing (0 in the Parncutt set, a penalty when learned). The run is the notes at most two slices before or after each note of the pair (`positionSpan` in `buildHandSequence`): a window of the whole run between rests never fires on Twinkle, whose right hand has no rest and spans C4 to A4. Target: the crossings inside a five-finger position on the level 1 and 2 library pieces (Twinkle bars 3-4 and 11-12) that the learned sets produce; expected to fall to 0 with validation gen within 0.4.

Results (seeds 20261013, 20261014, 20261015; the bench validation gen of each seed's best epoch; lint errors per 1000 of the 8,936 validation notes under the 1 ms law unless named; textbook exact of 672 for the median seed; library on profile medium):

| hypothesis                                            | validation gen per seed | mean ± sd    | Δ vs baseline | pooled (trainer) | lint per 1000         | textbook exact | library measure                                            | kept     |
| ----------------------------------------------------- | ----------------------- | ------------ | ------------- | ---------------- | --------------------- | -------------- | ---------------------------------------------------------- | -------- |
| baseline (as trained above)                           | 70.10 70.22 69.96       | 70.09 ± 0.13 | -             | 72.59 ± 0.33     | 10.85 (2.69 at 50 ms) | 536            | crossings in position 18; pairs alike 283 of 520           | -        |
| H1 hold tolerance 50 ms (solver, trainer, lint)       | 71.31 71.25 70.51       | 71.02 ± 0.45 | +0.93         | 72.54 ± 0.26     | 21.49 (2.57 at 50 ms) | 544            | -                                                          | no       |
| H2 chord-adjacent span family (`adj*`, 5 ids)         | 71.97 69.59 69.90       | 70.49 ± 1.29 | +0.40         | 72.37 ± 0.33     | 10.85                 | 550            | crossings 18                                               | no       |
| H3 chord width indicators (`chw:*`, 50 ids)           | 70.50 70.93 70.90       | 70.78 ± 0.25 | +0.69         | 73.34 ± 0.25     | 10.85                 | 553            | crossings 18                                               | no       |
| H4 consistent repeats, as written (transposed copies) | 69.76 69.62 69.50       | 69.63        | -0.46         | (decode only)    | 10.85                 | 413            | passages alike 211 of 214 (its own grouping); crossings 20 | no       |
| H4b first version (greedy groups, reviewed)           | 70.07 69.94 69.68       | 69.90        | -0.19         | (decode only)    | 10.85                 | 536            | pairs alike 327 of 520; crossings 21                       | replaced |
| H4b revised (every identical passage, same beat)      | 69.84 70.24 69.62       | 69.90        | -0.19         | (decode only)    | 10.85                 | 536            | pairs alike 518 of 520; crossings 22                       | yes      |
| H5 `crossInPosition` (learned penalty)                | 70.37 70.37 70.23       | 70.32 ± 0.08 | +0.23         | 72.31 ± 0.12     | 10.85                 | 528            | crossings 18 (learned weight 0.14)                         | no       |

H2, H3 and H5 were trained with the other two families' ids frozen at 0, which is the same as leaving them out (the baseline run with all three frozen reproduces the earlier numbers to the last digit, seed by seed). H4 and H4b need no training: they are a pass of `solveFingering`, measured with the baseline seeds' weights.

Outcomes:

- **H1: rejected.** See above.
- **H2: rejected.** +0.40 with a seed spread of 1.29 (one seed +1.87 at its first epoch, two below the baseline). The learned `adj*` weights are small and negative (adjSmallSpan −0.29, adjStretch −0.15, adjLargeSpan −0.13): chord-adjacent moves are already priced about right.
- **H3: rejected.** +0.69 on the bench (+0.75 pooled), consistent over seeds, textbook +17, lint unchanged, but under +1.0. The learned widths are informative (chw:12:9 +2.05 and chw:13:wide +1.36, chw:24:9 −1.37 and chw:15:wide −1.27: a wide chord on 1-2 or 1-3 is penalised, on 2-4 or 1-5 rewarded). It is the strongest near miss of the loop.
- **H4 as first written: rejected.** Copies were passages with the same intervals, rhythm and key colours. Textbook exact 536 → 413 (the transposed tetrachords C D E F and G A B C of a scale, and its octaves, have one key-colour pattern, are pinned to one fingering, and the books finger them differently) and validation −0.46.
- **H5: rejected.** The learned weight is 0.14, too small to move a crossing (18 → 18 on the level 1 and 2 pieces), and textbook −8. PIG's experts cross the thumb inside small spans often enough that a learned penalty stays near zero; a beginner needs a fixed one, which the beginner level (`applyLevel`) and lint L15 provide.
- **H4b: kept.** See below.

#### Consistent repeats (H4b)

The pass takes every passage of at least four events that comes back identical, with all of its copies: the same keys, durations and rhythm, starting at the same place in the bar (`identicalPassages`, `barPositions`; a pickup counted from the end of its bar). Copies of two passages may overlap and a passage nested in a longer repeated one keeps every copy; most repeated events go first. A passage ties together the notes at the same place of its copies (a union-find over the notes) and the tie lasts for the rest of the pass, so the nested passage ends up fingered like the longer one. The candidates are the copies' fingerings as tied so far, each priced over every note it changes; a passage whose cheapest candidate pays a penalty, breaks a user pin or would give one tied class two fingers stays untied. A passage repeated back to back counts once per period. A second decode is kept only when it breaks no more laws than the first. A score without bars (PIG, Mutopia parts) has no bar-position constraint, so the pass ties every identical passage there whatever its beat.

Why it has this shape:

- The measure must not depend on the pass. Counting the groups of `findRepeats`, the greedy grouping the pass itself pinned, read 192 or 193 of 193 by construction and missed passages nested in a longer group (Ode to Joy's bars 1-3 are identical to bars 5-7 and 13-15). The measure is the share of pairs of identical passages at the same place in the bar that are fingered alike (`repeatPairs` with `barPositions`, 520 pairs on the library, counted whatever the pass grouped; `bench --library` reports it and `pnpm verify` passes it).
- Copies must start at the same place in the bar. Without it the pass tied Twinkle's F F E E of bar 3 to the F F E E that runs from beat 3 of bar 5 into bar 6, and carried bar 3's 2 2 1 1 into bars 5 to 8 (5 5 2 2 1 1 2 against 5 5 4 4 3 3 2).
- Short repeats are out of reach: Frère Jacques bars 7 and 8 (C G C, three events each, back to back) and Happy Birthday's left-hand fifth (one event per bar) are below four events. With parncutt bars 7 and 8 of Frère Jacques stay 2 1 3 against 3 1 3. These are left to the beginner level or a later hypothesis.
- A first version that grouped passages greedily fingered alike only 327, 354 and 284 of the 520 pairs (pig, learned-open, parncutt); the revision ties every identical passage, nested ones included.

Result, library, profile medium (large in brackets), pairs of identical passages at the same place in the bar fingered alike, of 520: pig 283 → 518 (273 → 518), learned-open 278 → 520 (270 → 520), parncutt 228 → 520 (241 → 520). The two pairs left (pig) are Jingle Bells' repeated E's in the right hand (bars 1 and 2 against 10 and 9, fingered 2 1 2 1 against 1 2 1 2): their copies overlap other copies of the same notes, and neither candidate gives every tied note one finger. At any place in the bar, of 1,217 pairs: pig 611 → 863, learned-open 553 → 887, parncutt 532 → 777; the rest are passages on different beats, left on purpose. The pass changes the app's default fingering (parncutt, profile medium) on 25 of the 30 library pieces; Twinkle, the piece of the app's visual baselines, is fingered as without it.

Cost. Validation gen is a paired comparison on fixed weights, so the seed noise does not apply: the pig seeds −0.26, +0.02 and −0.34 (mean −0.19), parncutt +0.25 (69.06 → 69.31), learned-open −0.49 (67.02 → 66.53). The shipped set's loss is beyond the 0.4 tolerance, and the pass is kept anyway because the teacher notes of the UI review ask for repeated bars fingered alike. Hard-error rate on the four two-annotator validation pieces: pig 4.20 → 4.70, learned-open 5.77 → 5.98, parncutt 4.75 → 5.04. Textbook unchanged for every set (pig 536, parncutt 486, learned-open 601); validation lint unchanged for every set (10.85, 10.85, 10.97); library lint errors unchanged for every set on both profiles; the validation law errors (97, 97, 98) unchanged. Thumb crossings inside a five-finger position on the level 1 and 2 pieces rise (pig 18 → 22, learned-open 18 → 22, parncutt 20 → 27), because the cheapest common fingering of the copies sometimes crosses (with parncutt: Greensleeves bar 16, Pachelbel bars 9 and 11, the G major minuet bars 7 and 21, the G minor minuet bar 4); the beginner level and lint L15 address them. The notes' confidences and cost gaps come from the decode before the pass, because under the pass's pins a pinned note would read as certain (validation ECE rose to 0.0722 for the pig set before this was fixed). Validation ECE at the sets' temperatures, without → with the pass: pig 0.0465 → 0.0496, learned-open 0.0628 → 0.0626, parncutt 0.1275 → 0.1280. Retraining both sets after the pass gave weights identical id for id, because the trainer decodes with `solveHand` alone.

PIG test scored once with the first version of the pass (nothing chosen on it): learned-pig 67.85 → 67.69 gen and learned-open 63.74 → 63.72. The rules, which the gate ran at the time: 61.89 without the pass, 61.95 with the first version, 62.11 with the revision (Mutopia test 62.01, 61.77, 61.15). The final-engine record is in the table above. **Kept as the default** (`SolveOptions.consistentRepeats` true).

### Disagreements with chirality

chirality's exact Parncutt Viterbi with uniform weights scores 71.85 on PIG validation against 69.06 for the rules and 70.22 for learned-pig. It disagrees with the rules on 2,128 of 8,936 notes (23.8 percent; chirality matches an annotator where the engine does not on 1,019, the reverse on 732) and with learned-pig on 1,932 (21.6 percent; 834 against 700). The three most frequent disagreements with learned-pig (engine finger → chirality's finger) are all chord notes: 3 → 2 (172 notes; our handPositionShift charges chirality's 2), 5 → 4 (169; weakFinger, handPositionShift and chordLargeSpan charge chirality's 4, and here the engine is right more often, 88 against 66) and 2 → 1 (112; the learned `on:1:black` and handPositionShift charge the thumb on a black chord note, and 13 percent of chirality's choices cross fingers inside the chord, which our chord law forbids). Against the rules: 5 → 4 (194; chordLargeSpan, our doubled chord spans), 3 → 2 (174; the hand-position term alone) and 1 → 2 (82; a third of chirality's choices break our chord order or a held key). H2 and H3 were built from this and neither reached the threshold, so the chord gap to chirality remains the main lead for the next solver work.

## Calibration

### Per-annotator correctness

Hypothesis: correctness defined as "the engine's finger matches at least one annotator" makes the calibration error depend on how many annotators a piece has. The PIG validation pieces have 1.2 annotators per piece and the test pieces 5.0, so the temperature fitted on validation (ECE 0.063 learned-open, 0.047 learned-pig) scored 0.243 and 0.197 on test, where some annotator agrees with the engine far more often.

Change (`packages/engine/src/learn/calibration.ts`): soft labels. A note's target is the share of its annotators who use each finger (`ConfidenceSample.target`, built by `confidenceSample`); the likelihood is the cross-entropy against that share (each annotator a sample of weight 1 over the note's annotators; an annotator whose finger the solver prices at a hard-rule penalty, margin 500 or more, is left out and the others keep their share); a bucket's accuracy is the mean share of annotators who use the chosen finger. On one annotator this is the old definition, and the mean accuracy over notes is the note-weighted gen. Both temperatures were re-fitted on the PIG validation pieces only; the weights came out byte-identical.

| weight set             | temperature         | validation ECE (any annotator → per annotator) | PIG test ECE (any annotator → per annotator) | Mutopia test ECE | test mean confidence / mean accuracy |
| ---------------------- | ------------------- | ---------------------------------------------- | -------------------------------------------- | ---------------- | ------------------------------------ |
| learned-open (shipped) | 2.9938 → 3.071694   | 0.0626 → 0.0517 (0.0663 at T = 2)              | 0.243 → 0.0684                               | 0.1037           | 0.609 / 0.648                        |
| learned-pig (research) | 2.077263 → 2.140226 | 0.0496 → 0.0415 (0.0455 at T = 2)              | 0.197 → 0.0451                               | -                | 0.697 / 0.687                        |

**Confirmed.** Validation and test errors now agree within 0.02 for both sets, and the shipped set meets the goals table's floor of 0.10 on PIG test (target 0.05 not met). Its reliability on test: under-confident from 0.2 to 0.7 (bucket 0.5: confidence 0.55, accuracy 0.65), over-confident in the top bucket (0.98 against 0.90, 1,614 notes). On the Mutopia test half the error is 0.104 (mean confidence 0.579 against accuracy 0.657: the editors agree with the engine more often than its PIG-fitted confidence says); this is reported, not gated.

## Floors and gates

### How the floors are set

- Agreement floors (`engine`, `mutopia.gen`): the labelled run's measurement minus 0.5, rounded down to one decimal. The hand-separation floor is the measurement minus 1.0. Textbook floors are fractions: the measurement minus 0.01, rounded down to two decimals.
- `calibration.eceMax`: the measurement plus 0.02, rounded up to four decimals, kept under the goals table's floor of 0.10.
- `lint.errorsPer1000Max`: the measurement rounded up to two decimals, no slack (with bench's 0.005 tolerance 40 errors pass and 41 fail). It may loosen only on evidence that the extra errors are forced.
- Floors are set from labelled milestone runs. `weightSet` names the set a floor was measured with and `weightSetHash` its weights: bench treats another set, or another hash under the same name, as a breach. The mechanics of the loop are in `docs/verification-loop.md`.
- The rules alone never reached the goals table's agreement floors (62.1 / 68.7 / 82.6 / 74.7, the best runnable baseline) and were gated at their own measurement minus 0.5 (last: 61.3 / 67.4 / 82.1 / 72.0). learned-open clears the goals table on all four.

### Re-basing on learned-open

| floor                            | before (parncutt)         | after (learned-open)      | from                                                    |
| -------------------------------- | ------------------------- | ------------------------- | ------------------------------------------------------- |
| `weightSet`                      | parncutt                  | learned-open              | `RECOMMENDED_WEIGHT_SET`                                |
| `weightSetHash`                  | -                         | 7ba9363fea541a4e          | m3-open `weightSet.hash`                                |
| `engine` gen / high / soft / rec | 61.3 / 67.4 / 82.1 / 72.0 | 63.3 / 69.9 / 84.7 / 75.8 | m3-open 63.89 / 70.48 / 85.27 / 76.37                   |
| `mutopia.gen`                    | null (not gated)          | 64.9                      | mutopia-open 65.48 (62 parts, 0 skipped)                |
| `calibration.eceMax`             | -                         | 0.0885                    | m3-open ECE 0.06841 + 0.02, rounded up; under 0.10      |
| `lint.errorsPer1000Max`          | 3.82                      | 3.92                      | m3-open 3.912, rounded up (forced-error evidence below) |

The textbook floors stay those of the solver's own default set (parncutt), which `textbook.test.ts` solves with.

### Lint laws as a gate

The experts' own fingerings break the lint laws too (below), so the lint maximum is a measurement, not 0, and it was re-based each time the lint got stricter.

- **L05 between consecutive notes.** As a law between consecutive notes that do not overlap it counted hand shifts, so lint errors could not gate physical possibility. Now L05 is an error between consecutive notes only while the earlier key still sounds; otherwise the leap is an L07 warning (a hand shift). Chord spans stay L05. The experts' own fingerings on PIG test went 47.4 → 6.68 errors per 1000 notes (L03 4.58, L05 1.58, L01 0.48, L02 0.04); PIG train experts 16.05 (L03 10.23, L05 5.62). The engine's output on the library went 26.73 → 14.08 per 1000, with the solver fixes of the same round. `bench` gates `lint.errorsPer1000Max` and fails a gated run that skips a piece.
- **Why not 0.** Under the hardened lint the experts still score 8.00 per 1000 on PIG test and 16.67 on train, mostly L03 and L05 (PIG's legato overlaps read as held keys under the 1 ms hold tolerance). The gate is therefore the solver's own measurement.

| Lint state                                                      | Gate (errors per 1000 PIG test notes) | Measured |
| --------------------------------------------------------------- | ------------------------------------- | -------- |
| First lint (L05 counts hand shifts)                             | 22.11                                 | 22.10    |
| L05 only while the earlier key still sounds                     | 8.32                                  | 8.31     |
| Every held key checked against every later note (hardened lint) | 12.43                                 | 12.42    |
| After the hardening re-review fixes                             | 3.82                                  | 3.81     |
| learned-open                                                    | 3.92                                  | 3.912    |

The 12.43 gate was set on a run with 98 held-pair errors on test that a legal fingering avoids; the re-review rejected it because it hid solver errors, and the fixes brought the gate down to 3.82.

**Lint maximum 3.82 → 3.92 on forced-error evidence.** learned-open scores 3.912 errors per 1000 test notes (40 errors) against parncutt's 3.814 (39). The only per-piece difference is piece 029 (25 against 24; 025 has 1 and 026 14 with both sets, every other piece 0), the piece whose hard decode is infeasible under legato overlaps of 9 to 27 ms; the test split was not analysed beyond its scorecards. The validation analysis (section "Law errors of the learned sets on validation" above): every law error of all three sets lies in the 9 hands that have no legal fingering, and each of the 31 hands with a legal fingering gets one from every set. learned-open's one error beyond the rules (98 against 97) is in 038 L, a hand of chords wider than the hand (8 against 7, minimum 6). So the extra errors fall where no legal fingering exists, no solver defect blocks the switch, and the maximum is the measurement rounded up to two decimals, 3.92, as 3.82 was set. An earlier proposal of 4.01 (the measurement plus 0.1) was rejected: that slack would let one more law error through unnoticed. The excess over the exact minimum inside such hands (three hands, every set) is the law-domain pass's drop rule, left as a solver lead.

## MIDI import and hand separation

### Hand separation of MIDI input

Hypothesis: a beam-searched pitch-trajectory DP with learned movement, span, position and pattern tables separates the hands of MIDI input as well as the literature's 91-93 percent.

Method. `separateHands`: beam 64, one split point per onset; cost = hand-pattern transition + per-hand movement (or position for its first chord) + chord span + crossing penalty μ 5 + idle-hand penalty ν 0.5 after `idleSec` 4 s. Tables fitted by `research/scripts/make_hand_motion.py` on the 30 library pieces and the Mutopia train half (224 parts) with equal weight per corpus; no PIG data (licence). Shipped as `packages/engine/src/io/midi/params/hand-motion.json`; refitting with the script's defaults reproduces every table and count exactly. μ, ν and `idleSec` are hand-set defaults. Scored by `digitus2 evalhands` (`packages/engine/cli/evalhands.ts`): each gold piece is played as MIDI, quantized and separated; accuracy is the percent of the piece's notes that get their true hand (PIG and Mutopia: channel; library: staff). PIG test pieces 001-030 and the Mutopia test half were only scored: no table, weight or setting was fitted or chosen on them.

Shipped tables, held-out and in-sample:

| Set                       | Role                     | Pieces                           | Notes   | Macro | Note-weighted | Weakest three                                                                                                                                   |
| ------------------------- | ------------------------ | -------------------------------- | ------- | ----- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| PIG test (nakamura2020)   | held out                 | 30, 0 skipped (first annotation) | 10,225  | 92.05 | 91.89         | 028 76.9; 021 79.5; 014 85.5                                                                                                                    |
| Mutopia test (piece70_30) | held out                 | 62 parts of 48 pieces, 0 skipped | 56,937  | 85.10 | 88.72         | MP0389_s01_p1 Diabelli Op. 149 No. 1 53.3; MP2037f1_s00_p0 Hanon, The Virtuoso Pianist I 54.1; MP0415_s01_p1 Diabelli Op. 149 No. 9 57.6        |
| Library                   | in-sample (fitted on it) | 30, 0 skipped                    | 9,802   | 92.96 | 90.45         | schumann-op68-no1-melody 76.0; bach-prelude-c-major-bwv-846 78.3; mozart-sonata-k545-mvt1 80.9 (Twinkle 64 of 64)                               |
| Mutopia train             | in-sample (fitted on it) | 224 parts, 0 skipped             | 136,122 | 87.58 | 88.84         | MP2070_s00_p0 Beethoven Op. 2 No. 1 mvt 2 48.4; MP0462_s04_p3 Diabelli Op. 149 No. 14 Trio 56.0; MP0409_s04_p3 Diabelli Op. 149 No. 7 Trio 57.1 |

From training to held-out Mutopia data the macro accuracy drops 2.48 points (87.58 to 85.10) and the note-weighted accuracy 0.12 (88.84 to 88.72); PIG, which no table saw, scores 92.05. Twinkle is 64 of 64. The errors are in textures where register does not tell the hands apart, and the `Hand split` control is the override: in MP0389_s01_p1 (Diabelli Op. 149 is for four hands; in this part both hands play in the treble an octave apart, MIDI 72 to 91) the DP gives the octave to the right hand, 42 of the 45 left-hand notes; in MP2037f1_s00_p0 (Hanon) 167 of 329 left-hand notes go right and 47 of 137 right-hand notes go left; in PIG 028, 88 of the 185 right-hand notes go left.

**Confirmed.** 92.05 on PIG test is inside the literature's 91-93 percent without any PIG data. Floor `hands.accuracyMin` 91.0 (measured minus 1.0).

PIG-fitted research variant (library + PIG train 031-150 with equal weight, `research/weights/hand-motion-pig.json`, not committed, never shipped):

| Tables                             | PIG test macro | PIG note-weighted | Mutopia test macro | Library macro |
| ---------------------------------- | -------------- | ----------------- | ------------------ | ------------- |
| Shipped: library + Mutopia train   | 92.05          | 91.89             | 85.10              | 92.96         |
| Research only: library + PIG train | 91.76 (−0.29)  | 91.54             | 85.21 (+0.11)      | 93.13 (+0.17) |

Fitting on PIG train does not help on PIG test, so the licence restriction costs nothing measurable here.

Ablation: each table flattened with the script's `--uniform` and refitted on the shipped corpora; deltas against the shipped tables; reported, not tuned.

| Table flattened | PIG test macro | PIG note-weighted | Mutopia test macro | Mutopia note-weighted | Library macro  | Library note-weighted | Twinkle (of 64) |
| --------------- | -------------- | ----------------- | ------------------ | --------------------- | -------------- | --------------------- | --------------- |
| none (shipped)  | 92.05          | 91.89             | 85.10              | 88.72                 | 92.96          | 90.45                 | 64              |
| move            | 81.66 (−10.39) | 82.10             | 76.21 (−8.89)      | 79.92                 | 81.03 (−11.93) | 79.36                 | 43              |
| span            | 81.76 (−10.29) | 81.56             | 79.15 (−5.95)      | 83.25                 | 79.84 (−13.12) | 82.56                 | 39              |
| position        | 91.92 (−0.13)  | 91.79             | 85.08 (−0.01)      | 88.72                 | 92.97 (+0.00)  | 90.45                 | 64              |
| pattern         | 92.44 (+0.39)  | 92.40             | 84.54 (−0.56)      | 88.65                 | 92.26 (−0.70)  | 89.96                 | 61              |

The movement and chord-span tables carry the model (about 10 points each on PIG test). No flattened table improves both PIG test and Mutopia test by more than 1 point, so there is no finding to act on: the pattern table's +0.39 on PIG test comes with −0.56 on Mutopia test, −0.70 on the library and 3 Twinkle notes in the wrong hand, and nothing was changed on the strength of test-set numbers. The position table (a hand's first chord) has no measurable effect on any set; in the design spike it fixed Twinkle's last two notes, but with the shipped tables Twinkle stays at 64 of 64 without it.

Sensitivity of μ (crossing) and ν (idle hand) on training data only (Mutopia train 224 parts and the library):

| μ   | ν   | Mutopia train macro | Mutopia train note-weighted | Library macro | Library note-weighted |
| --- | --- | ------------------- | --------------------------- | ------------- | --------------------- |
| 0   | 0.5 | 83.46 (−4.12)       | 85.94                       | 91.58 (−1.38) | 88.51                 |
| 2.5 | 0.5 | 87.55 (−0.03)       | 88.84                       | 92.91 (−0.05) | 90.36                 |
| 5   | 0.5 | 87.58 (shipped)     | 88.84                       | 92.96         | 90.45                 |
| 10  | 0.5 | 87.58 (+0.00)       | 88.84                       | 92.87 (−0.10) | 90.36                 |
| 5   | 0   | 86.42 (−1.16)       | 88.45                       | 92.85 (−0.11) | 90.25                 |
| 5   | 2   | 87.91 (+0.33)       | 88.89                       | 93.06 (+0.10) | 90.51                 |

The rule was to change the defaults only for a gain of at least 1.0 Mutopia-train macro without losing more than 0.5 on the library. The best setting (ν 2) gains 0.33, so μ 5 and ν 0.5 stay and `hand-motion.json` is unchanged. Without the crossing penalty (μ 0) the Mutopia train macro drops 4.12 points (two parts of MP0408 fall to about 21 percent); from 2.5 up the penalty barely matters. ν 2 is a lead for a later refit, on training data only.

Speed. `importMidi` (read, quantize, separate, engrave, read back) on the 2000-note file of `import.test.ts`, built engine in Node 22: 133 to 135 ms on the first call, 88 ms median warm; `twinkle.mid` (64 notes) 3.9 ms warm. The target was 500 ms and the CI bound 2 s. `evalhands` quantizes and separates all 30 PIG test pieces (10,225 notes) in 82 ms and the 62 Mutopia test parts (56,937 notes) in 386 ms.

## Teacher-review hypotheses

The weekly teacher review (`research/teacher_review/weekly.py`, method in `docs/research/teacher-review.md`) turns objections that two reviewers share, or any error-severity objection, into hypotheses for the quantitative loop. It is never a gate and never a tuning target (verification spec 3.12), and PIG passages appear only by opaque id. The job writes rows in this table's format (`research/teacher_review/hypotheses.py`), to be appended after the table's last row. Outcome "Open" means untested. A hypothesis is tested on PIG train, the textbook oracle and the library, never on the test split; its result then goes under the matching area above.

| Date       | Hypothesis                                                                                                                                                                                                                                                 | Change                                                                                                                                                                                                                                                                                               | Primary metric before → after                                                              | Other effects                                                                                                                                                                                                                                                                          | Outcome                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 2026-10-14 | Teacher review 2026-10-14 (K1): 16 consistent objections of kind hop in 8 passages (harderr 15, lowconf 1); lint L11 fires at 0 of them. Hypothesis: the hop penalty is too weak at the inter-onset intervals of these passages.                           | None yet; proposed: raise the hop weight below 300 ms or price hops by inter-onset interval. To be tested on PIG train, the textbook oracle and the library, never on the test split (verification spec section 4).                                                                                  | PIG train macro gen and lint L11 per 1000 notes: current value → not run                   | Evidence: docs/reviews/teacher-2026-10-14.md, group K1: 16 raised by both reviewers, 0 error-only; severities: warning 16; passages: he01, he06, he09, he10, he11, he13, he15, lc05.                                                                                                   | Open. Generated by the weekly teacher review; not a gate and not a tuning target (verification spec 3.12). |
| 2026-10-14 | Teacher review 2026-10-14 (K2): 10 consistent objections of kind inconsistent in 10 passages (harderr 6, lowconf 4); no lint rule covers this kind. Hypothesis: repeated or sequential figures receive different fingerings.                               | None yet; proposed: the consistent-repeats post-pass. To be tested on PIG train, the textbook oracle and the library, never on the test split (verification spec section 4).                                                                                                                         | metamorphic repeated-passage check and PIG train macro gen: current value → not run        | Evidence: docs/reviews/teacher-2026-10-14.md, group K2: 10 raised by both reviewers, 0 error-only; severities: warning 8, info 2; passages: he02, he03, he04, he05, he08, he12, lc01, lc12, lc15, lc17.                                                                                | Open. Generated by the weekly teacher review; not a gate and not a tuning target (verification spec 3.12). |
| 2026-10-14 | Teacher review 2026-10-14 (K3): 3 consistent objections of kind nonstandard_pattern in 3 passages (lowconf 3); no lint rule covers this kind. Hypothesis: scale or arpeggio fragments do not follow the textbook fingering.                                | None yet; proposed: extend the textbook templates to the fragments the reviewer names. To be tested on PIG train, the textbook oracle and the library, never on the test split (verification spec section 4).                                                                                        | textbook oracle exact matches and PIG train macro gen: current value → not run             | Evidence: docs/reviews/teacher-2026-10-14.md, group K3: 3 raised by both reviewers, 0 error-only; severities: warning 3; passages: lc02, lc14, lc18.                                                                                                                                   | Open. Generated by the weekly teacher review; not a gate and not a tuning target (verification spec 3.12). |
| 2026-10-14 | Teacher review 2026-10-14 (K4): 3 consistent objections of kind position_change in 3 passages (lowconf 3); no lint rule covers this kind. Hypothesis: the position-change cost lets the hand shift inside phrases where one position suffices.             | None yet; proposed: re-weight handPositionShift and positionChangeSize so shifts fall at rests and long notes. To be tested on PIG train, the textbook oracle and the library, never on the test split (verification spec section 4).                                                                | PIG train macro gen and position changes per 100 notes (spec 3.7): current value → not run | Evidence: docs/reviews/teacher-2026-10-14.md, group K4: 3 raised by both reviewers, 0 error-only; severities: warning 3; passages: lc07, lc08, lc18.                                                                                                                                   | Open. Generated by the weekly teacher review; not a gate and not a tuning target (verification spec 3.12). |
| 2026-10-14 | Teacher review 2026-10-14 (L1): no related lint rule fires at 32 consistent objections of 4 kinds (hop 16, inconsistent 10, nonstandard_pattern 3, position_change 3) in 23 passages. Hypothesis: lint lacks a rule for what the reviewer objects to here. | None yet; proposed: draft a lint rule for the largest kind and measure its expert base rate on PIG before deciding law or preference (verification spec section 2, oracle 4). To be tested on PIG train, the textbook oracle and the library, never on the test split (verification spec section 4). | expert base rate of the new rule on PIG: not measured → not run                            | Evidence: docs/reviews/teacher-2026-10-14.md, group L1: 32 raised by both reviewers, 0 error-only; severities: warning 30, info 2; passages: he01, he02, he03, he04, he05, he06, he08, he09, he10, he11, he12, he13, he15, lc01, lc02, lc05, lc07, lc08, lc12, lc14, lc15, lc17, lc18. | Open. Generated by the weekly teacher review; not a gate and not a tuning target (verification spec 3.12). |

K2 proposes the consistent-repeats pass, which has since been kept (H4b above); the row stays open until a later weekly run shows whether the objections remain.

## Open leads

- Chord fingering against chirality's Viterbi (3 → 2, 5 → 4 and 2 → 1 inside chords); H3's chord width indicators were the strongest near miss (+0.69).
- Comfort terms for pairs three or four apart in four- and five-note chords (a slice-level term or expanded chord states).
- A minimum-violation repair for hands that have no legal fingering; the law-domain pass's drop rule and the greedy held-note loop leave a few avoidable errors there.
- Consistent fingering of repeats shorter than four events.
- Hand separation: ν 2 for a later refit (training data only), and textures where register does not tell the hands apart (four-hand parts, Hanon).
- The open rows of the teacher-review table.
