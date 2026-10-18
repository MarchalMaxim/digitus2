# Listening test (issue #38): blinded reviews scored

30 passages; scores 0 to 3, total 0 to 9. Written by `research/embellish/score.py`.

## Mean scores

| Condition | Passages | musical | fits_harmony | beginner_friendly | Total (0-9) |
| --- | ---: | ---: | ---: | ---: | ---: |
| plain | 10 | 2.90 | 2.80 | 2.80 | 8.50 |
| light | 10 | 3.00 | 2.70 | 2.80 | 8.50 |
| playful | 10 | 2.20 | 2.60 | 1.90 | 6.70 |

## Verdicts

| Condition | natural | acceptable | awkward | wrong | natural or acceptable |
| --- | ---: | ---: | ---: | ---: | ---: |
| plain | 7 | 3 | 0 | 0 | 10 of 10 (100%) |
| light | 4 | 6 | 0 | 0 | 10 of 10 (100%) |
| playful | 3 | 3 | 4 | 0 | 6 of 10 (60%) |

## Objections per 100 notes

Notes count both hands. Per item is the plain count of objections per passage.

| Condition | Notes | Objections | Per item | Per 100 notes | error | warning | info |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| plain | 202 | 6 | 0.60 | 2.97 | 0.00 | 0.50 | 2.48 |
| light | 219 | 8 | 0.80 | 3.65 | 0.00 | 0.46 | 3.20 |
| playful | 281 | 20 | 2.00 | 7.12 | 0.00 | 3.91 | 3.20 |

| Condition | wrong_note | clash | rhythm | clutter | repetitive | phrase | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| plain | 0.00 | 1.49 | 0.50 | 0.50 | 0.50 | 0.00 | 0.00 |
| light | 0.00 | 1.37 | 1.37 | 0.00 | 0.00 | 0.46 | 0.46 |
| playful | 0.00 | 1.42 | 0.36 | 3.20 | 1.42 | 0.71 | 0.00 |

## Hits and false positives

A hit names at least one inserted note (inserted only, or mixed with original notes). A false positive names original right-hand notes and no inserted note. Left-hand-only objections are neither. In the plain passages nothing is inserted, so every right-hand objection there is a false positive by construction.

| Condition | Objections | Inserted only | Mixed | Original only | Left hand only | Hits | False positives | Hits, warning or error | False positives, warning or error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| plain | 6 | 0 | 0 | 5 | 1 | 0 | 5 | 0 | 1 |
| light | 8 | 0 | 2 | 5 | 1 | 2 | 5 | 0 | 1 |
| playful | 20 | 5 | 13 | 2 | 0 | 18 | 2 | 11 | 0 |

## Per note (right hand)

The share of right-hand notes that at least one objection names.

| Condition | Inserted named | Original named | Inserted named, warning or error | Original named, warning or error |
| --- | ---: | ---: | ---: | ---: |
| plain | - | 9 of 118 (8%) | - | 2 of 118 (2%) |
| light | 3 of 17 (18%) | 13 of 118 (11%) | 0 of 17 (0%) | 1 of 118 (1%) |
| playful | 39 of 79 (49%) | 40 of 118 (34%) | 28 of 79 (35%) | 29 of 118 (25%) |

## Rules

Inserted notes per rule in the passages, and how many an objection names.

| Rule | Condition | Inserted notes | Named | Named, warning or error |
| --- | --- | ---: | ---: | ---: |
| passing | light | 13 | 0 of 13 (0%) | 0 of 13 (0%) |
| neighbour-repeated | light | 4 | 3 of 4 (75%) | 0 of 4 (0%) |
| passing | playful | 26 | 7 of 26 (27%) | 2 of 26 (8%) |
| neighbour-long | playful | 22 | 10 of 22 (45%) | 6 of 22 (27%) |
| neighbour-repeated | playful | 17 | 15 of 17 (88%) | 15 of 17 (88%) |
| anticipation | playful | 14 | 7 of 14 (50%) | 5 of 14 (36%) |
| passing | all | 39 | 7 of 39 (18%) | 2 of 39 (5%) |
| neighbour-long | all | 22 | 10 of 22 (45%) | 6 of 22 (27%) |
| neighbour-repeated | all | 21 | 18 of 21 (86%) | 15 of 21 (71%) |
| anticipation | all | 14 | 7 of 14 (50%) | 5 of 14 (36%) |

## Per piece

Total score (0 to 9) per condition; each condition is a different reviewer.

| # | Piece | plain | light | playful | Highest |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | Twinkle, Twinkle, Little Star | 9 | 9 | 5 | plain, light |
| 2 | Jingle Bells (chorus) | 9 | 9 | 4 | plain, light |
| 3 | When the Saints Go Marching In | 9 | 9 | 9 | plain, light, playful |
| 4 | Camptown Races | 9 | 9 | 7 | plain, light |
| 5 | Ode to Joy (simplified) | 9 | 9 | 4 | plain, light |
| 6 | Scarborough Fair | 9 | 9 | 7 | plain, light |
| 7 | Allegro | 9 | 8 | 9 | plain, playful |
| 8 | Bayernhymne | 8 | 8 | 8 | plain, light, playful |
| 9 | Come let us All with Fervour | 7 | 7 | 5 | plain, light |
| 10 | Andantino | 7 | 8 | 9 | playful |

| Condition | Highest or tied | Sole highest |
| --- | ---: | ---: |
| plain | 9 | 0 |
| light | 8 | 0 |
| playful | 4 | 1 |

## Paired comparison per piece

First higher, tie and second higher count pieces by total score. The sign test is exact and two-sided, with ties dropped.

| Comparison | Pieces | First higher | Tie | Second higher | Mean difference | Sign test p |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| plain vs light | 10 | 1 | 8 | 1 | 0.00 | 1.000 |
| plain vs playful | 10 | 6 | 3 | 1 | 1.80 | 0.125 |
| light vs playful | 10 | 6 | 2 | 2 | 1.80 | 0.289 |
