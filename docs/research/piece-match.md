# Matching a scan to a library piece

## Question

Does the pitch sequence of a recognised page find its piece among the library's 3,228 pieces, and how often does a page of a piece the library lacks find a wrong one? (issue 166)

## Method

`research/omr/piece-match.mjs` builds the index and runs the measurement (`--camera-fusion DIR` and `--acceptance DIR` add the recognition sets below; each reads the job list and the cached MusicXML beside it, and takes only the base name of an output path from the job list); `research/omr/piece-match.test.mjs` pins the behaviour on seven pieces and a second edition of Invention No. 13.

**Sequences.** Every piece is parsed with the engine's `parseMusicXml`. Per hand, grace notes are dropped, notes are grouped by onset tick, and each onset keeps one pitch class (`midi mod 12`): the highest note for the right hand, the lowest for the left. A page is cut at measure boundaries, so page `k` of `m` measures holds the measures `[k*m, (k+1)*m)`.

**Shingles.** A shingle is 8 consecutive pitch classes of one hand, written as 8 hex digits. A piece `p` has the set `S_p` of its shingles, both hands pooled; windows never cross hands. The index holds 783,069 distinct shingles over the 3,228 pieces.

**Score.** For a query with shingle set `Q`:

```
score(p) = |Q ∩ S_p| / |Q|
```

**Same work.** Pieces `i` and `j` are the same work when `|S_i ∩ S_j| / min(|S_i|, |S_j|) >= 0.5`. `best` is the piece with the highest score. The margin is `score(best)` minus the score of the highest-ranked piece that is not the same work as `best`; when no other work shares a shingle that score is taken as 0, so the margin equals `score(best)`.

**Accept.** A match is accepted when `score(best) >= 0.3` and `margin >= 0.2`. A hit is an accepted match whose best piece is the same work as the truth; a wrong match is an accepted match of another work.

**Leave-out run.** Every query runs twice. The in-run uses the whole library. The out-run removes the truth's whole work from the index, so the page belongs to a piece the library lacks; any accept in an out-run is a false match.

**Sets.**

| Set | Queries | Truth |
|---|---|---|
| Owner pages | `apps/web/fixtures/scan/owner-page-{1,2,3}.musicxml`, the owner's three recognised pages | Invention No. 13 (`bach-invention-no13-bwv-784`) |
| Acceptance | 80 cached recognitions of the 16 acceptance pieces: homr on 4 variants of the first page (clean, shadow, low contrast, skew) and Audiveris on the PDF; the 13 further jobs in the job list (photographed pages of other music) are not library pieces and are skipped | the slug in the job id |
| Camera fusion | 72 homr recognitions of camera-simulated first pages of 8 acceptance pieces (3 severities, 3 variants each) | the slug in the job id |
| Injected | pages of 8 measures from 144 library pieces (the 16 acceptance pieces and every 25th manifest entry); 928 pages with at least 10 shingles, 77 shorter pages dropped | the page's piece |

**Injected errors.** For each element of a hand, with probability `rate` one error is applied, chosen uniformly: the pitch class moves by 1 or 2 semitones up or down, the element is dropped, or a random pitch class follows it. The generator is `mulberry32(166)`, fresh for each rate.

## Results

### Owner pages

| Page | Shingles | Best piece | Score | Best other work | Margin |
|---|---|---|---|---|---|
| 1 | 235 | Invention No. 13 | 0.698 | 0.026 | 0.672 |
| 2 | 203 | Invention No. 13 | 0.961 | 0.015 | 0.946 |
| 3 | 52 | Invention No. 13 | 0.846 | 0.077 | 0.769 |

All three pages are accepted.

### Acceptance recognitions

| Recogniser and variant | Queries | Top-1 is the exact slug | Hit | Wrong | Rejected | Median best score | Margin p10 / median / p90 | False match (out-run) | Out-run best score median / max |
|---|---|---|---|---|---|---|---|---|---|
| all | 80 | 93.8% | 98.8% | 0.0% | 1.3% | 1.00 | 0.76 / 0.89 / 0.96 | 0.0% | 0.06 / 0.23 |
| homr, all four variants | 64 | 93.8% | 98.4% | 0.0% | 1.6% | 1.00 | 0.76 / 0.89 / 0.96 | 0.0% | 0.06 / 0.23 |
| homr clean | 16 | 93.8% | 100.0% | 0.0% | 0.0% | 1.00 | 0.76 / 0.92 / 0.96 | 0.0% | 0.06 / 0.23 |
| homr shadow | 16 | 93.8% | 93.8% | 0.0% | 6.3% | 1.00 | 0.76 / 0.87 / 0.96 | 0.0% | 0.06 / 0.23 |
| homr low contrast | 16 | 93.8% | 100.0% | 0.0% | 0.0% | 1.00 | 0.77 / 0.92 / 0.96 | 0.0% | 0.06 / 0.23 |
| homr skew | 16 | 93.8% | 100.0% | 0.0% | 0.0% | 1.00 | 0.76 / 0.92 / 0.96 | 0.0% | 0.06 / 0.23 |
| Audiveris PDF | 16 | 93.8% | 100.0% | 0.0% | 0.0% | 1.00 | 0.67 / 0.87 / 0.95 | 0.0% | 0.06 / 0.23 |

The one rejected recognition is homr on the shadow variant of `bach-minuet-a-minor-bwv-anh-120`: the right piece ranks first with score 0.213 (margin 0.191), under both thresholds. The five Chopin waltz recognitions (one per variant) rank the PDMX excerpt first, a tie broken by manifest order (see Duplicate editions); all 16 recognitions rank the same work first. The highest out-run score, 0.227, is Ode to Joy against `pdmx-himne-a-l-alegria-beethoven-1f4b23de`, another edition of the same melody that shares too few shingles to be clustered with it, and its margin of 0.114 is below the threshold.

### Camera fusion

| Severity | Queries | Top-1 is the exact slug | Top-1 is the same work | Hit | Wrong | Median best score | Margin p10 / median / p90 | False match (out-run) | Out-run best score median / max |
|---|---|---|---|---|---|---|---|---|---|
| all | 72 | 87.5% | 100.0% | 100.0% | 0.0% | 0.97 | 0.71 / 0.92 / 0.96 | 0.0% | 0.05 / 0.10 |
| moderate | 24 | 87.5% | 100.0% | 100.0% | 0.0% | 1.00 | 0.78 / 0.95 / 0.98 | 0.0% | 0.05 / 0.10 |
| harsh | 24 | 87.5% | 100.0% | 100.0% | 0.0% | 0.86 | 0.67 / 0.77 / 0.94 | 0.0% | 0.05 / 0.10 |
| misregistered | 24 | 87.5% | 100.0% | 100.0% | 0.0% | 1.00 | 0.76 / 0.95 / 0.98 | 0.0% | 0.05 / 0.10 |

### Injected errors

| Rate | Queries | Hit | Wrong | Rejected | Top-1 is the exact slug | Median best score | Margin p10 / median / p90 | False match (out-run) | Out-run best score median / p99 / max |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 928 | 99.5% | 0.0% | 0.5% | 99.6% | 1.00 | 0.72 / 0.91 / 0.97 | 1.1% | 0.09 / 0.61 / 0.97 |
| 0.02 | 928 | 99.0% | 0.0% | 1.0% | 99.6% | 0.88 | 0.52 / 0.76 / 0.93 | 0.9% | 0.08 / 0.54 / 0.85 |
| 0.05 | 928 | 96.0% | 0.0% | 4.0% | 99.2% | 0.67 | 0.32 / 0.57 / 0.81 | 0.9% | 0.07 / 0.47 / 0.96 |
| 0.10 | 928 | 74.4% | 0.0% | 25.6% | 98.4% | 0.44 | 0.14 / 0.36 / 0.59 | 0.5% | 0.06 / 0.42 / 0.58 |
| 0.20 | 928 | 16.4% | 0.1% | 83.5% | 87.1% | 0.18 | 0.00 / 0.13 / 0.29 | 0.1% | 0.04 / 0.31 / 0.71 |

The median best score follows `(1 - rate)^8` closely (0.85, 0.66, 0.43, 0.17 at the four non-zero rates): one error spoils every window that contains it.

### Thresholds

Hit and false-match percentages for each pair of thresholds. Camera fusion is 100.0% hit and 0.0% false match in all nine cells. The table below is the injected set at rate 0.05.

| Min score | Min margin | Hit | False match |
|---|---|---|---|
| 0.2 | 0.1 | 98.2% | 3.2% |
| 0.2 | 0.2 | 96.6% | 1.0% |
| 0.2 | 0.3 | 91.2% | 0.4% |
| 0.3 | 0.1 | 97.4% | 1.9% |
| 0.3 | 0.2 | 96.0% | 0.9% |
| 0.3 | 0.3 | 91.2% | 0.4% |
| 0.4 | 0.1 | 93.1% | 1.2% |
| 0.4 | 0.2 | 92.1% | 0.5% |
| 0.4 | 0.3 | 89.5% | 0.4% |

### Duplicate editions

Pairs where the best piece is not the truth but is the same work, over all injected queries.

| Truth | Best piece | Queries |
|---|---|---|
| `chopin-waltz-op69-no2` | `pdmx-valse-in-b-minor-op-69-no-2-excerpt-f27c4307` | 19 |
| `chopin-waltz-op69-no2` | `pdmx-waltz-in-b-minor-5d9b9832` | 1 |

In camera fusion, 9 of 72 recognitions (all of `chopin-waltz-op69-no2`) rank the PDMX excerpt of the same waltz first (score 0.57 to 1.00, margin 0.54 to 0.96 against the best other work). The excerpt does not score higher: the core edition's 130 shingles are all in the excerpt too (containment 1.000), so both editions score the same and the sort breaks the tie by manifest order, where the excerpt (index 2179) precedes the core edition (index 2496).

### False matches in the out-runs

Queries accepted after the truth's work is removed, counted over all rates (injected set).

| Truth | Best piece | Queries | Highest score |
|---|---|---|---|
| `pdmx-xml-swan-song-serenaded957no4-dminor-01-808504d7` (Schubert, Swan Song) | `pdmx-st-ndchen-serenade-9ef3fa09` (Ständchen Serenade) | 26 | 0.700 |
| `pdmx-beethoven-symphony-no-5-3rd-movement-pia-403c9359` | `pdmx-d-scarlatti-sonata-in-c-minor-k158-6753e9eb` | 3 | 0.455 |
| `pdmx-dance-to-this-c00008b7` | `pdmx-xi-freedom-dive-3f52152c` | 2 | 0.541 |
| `pdmx-beethoven-symphony-no-5-3rd-movement-pia-403c9359` | `pdmx-to-the-world-in-its-sorrow-sing-of-hope-0b138e4e` | 1 | 0.400 |

The largest group is two pieces that both name Schubert's Ständchen and share fewer than half of the smaller piece's shingles, so they are not clustered as one work.

## What it means

At the default thresholds (score 0.3, margin 0.2) the owner's three pages and 79 of the 80 acceptance recognitions find their work with no wrong match and no false match (the 80th is declined, not mismatched). All 72 camera-fusion recognitions do the same, but they cover 8 pieces (3 severities and 3 variants of the same first pages), not 72 independent trials, and the acceptance set covers 16 pieces with 5 recognitions each. Injected pages find their work in 99.5% of queries at rate 0 and 96.0% at rate 0.05, with 0.0% wrong matches and 0.9% to 1.1% false matches in the out-runs at those rates. At rate 0.10 the hit rate falls to 74.4% and at rate 0.20 to 16.4%, while false matches fall with it, so a page with many misread pitches is declined rather than matched to the wrong piece.

Duplicate editions are common enough that the margin is taken against the best piece of a different work: the exact slug is first for 93.8% of acceptance recognitions and 87.5% of camera-fusion recognitions, the same work for 100.0% of both.

The shingles are pitch classes, so a page in a transposed key (a misread key signature) behaves like a high error rate.
