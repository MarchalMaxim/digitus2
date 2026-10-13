# Teacher-review pilot: measured results

## Fault detection (sensitivity by position, within one note; kind = an objection of a matching kind)

| kind | planted (per run) | run A pos / kind | run B pos / kind | pooled pos / kind | FP per 100 expert notes (pooled) |
|---|---|---|---|---|---|
| chord_same_finger | 24 | 100% / 100% | 100% / 100% | 100% / 100% | 0.10 |
| impossible_span | 21 | 100% / 95% | 100% / 90% | 100% / 93% | 0.45 |
| nonthumb_crossing | 16 | 94% / 94% | 100% / 100% | 97% / 97% | 0.00 |
| hop_at_speed | 16 | 100% / 94% | 100% / 94% | 100% / 94% | 0.79 |
| run_345_reversed | 6 | 100% / 100% | 100% / 67% | 100% / 83% | 0.00 |
| thumb_on_black_between_whites | 9 | 100% / 89% | 100% / 89% | 100% / 89% | 0.10 |
| **all** | 92 | 99% / 96% | 100% / 93% | 99% / 95% | |

## Objections by condition (false positives on expert passages; spurious = not within one note of a planted fault)

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

## Ranking of conditions by overall score (sum of five criteria, 0-15)

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

## Expert passages: objections where the other annotators agree vs disagree with the reviewed annotator

| run | agreed notes | flagged | rate | disputed notes | flagged | rate | fixes | fix = another expert's finger |
|---|---|---|---|---|---|---|---|---|
| A | 557 | 39 | 7% | 450 | 62 | 14% | 70 | 71% |
| B | 557 | 17 | 3% | 450 | 75 | 17% | 73 | 88% |
| pooled | 1114 | 56 | 5% | 900 | 137 | 15% | 143 | 80% |

## Self-consistency between runs

| items | Pearson (overall) | Spearman | mean abs diff | share abs diff <= 2 | verdict agreement | objection-note Jaccard | faults: both / one / neither |
|---|---|---|---|---|---|---|---|
| 120 | 0.95 | 0.95 | 0.67 | 95% | 81% | 0.65 | 91 / 1 / 0 |

## Read-back accuracy

| run | hands | exact | digits | digit errors |
|---|---|---|---|---|
| A | 150 | 100% | 3021 | 0 (0%) |
| B | 150 | 100% | 3021 | 0 (0%) |
| pooled | 300 | 100% | 6042 | 0 (0%) |

## Cost (per passage-condition item)

| run | batches | items | wall s per batch (median) | wall s per item | chars in | chars out | est. tokens in | est. tokens out |
|---|---|---|---|---|---|---|---|---|
| A | 15 | 120 | 572 | 72 | 2402 | 849 | 601 | 212 |
| B | 15 | 120 | 499 | 64 | 2420 | 854 | 605 | 214 |
