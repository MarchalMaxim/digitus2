# Which way a page is turned

Issue: [#165](https://github.com/MarchalMaxim/digitus2/issues/165).

## Decision

`apps/web/src/scan/camera/orientation.ts` tells the turn of a page from its staff lines and abstains when unsure; no screen uses it yet. It is a pure module (`detectOrientation`, `rotateFrame`, `downscaleForAnalysis`, `measureSides`) built on `analyzeStaffGeometry`, which it only imports.

The turn is the number of clockwise degrees to apply with **Rotate** to make the page upright: `quarterTurns * 90` in `apps/web/src/scan/rotation.ts`, `rotate` in `research/omr/photos/manifest.json`. A page turned k quarter turns clockwise needs `((4 - k) % 4) * 90`.

The module meets its floors on the rendered pages and gives no wrong turn on any photo, but it abstains on 6 of the 14 photos turned 180°, against a floor of 2. It is not wired to a screen, and the `orientation` step is not part of `pnpm verify`.

## Method

| Step         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Axis         | `analyzeStaffGeometry` traces horizontal rulings only. It runs on the page as given and on the page turned a quarter. The axis with staves wins when its total staff coverage is at least `minCoverage` and at least `axisRatio` times the other's.                                                                                                                                                                                           |
| Staff extent | Per staff: the longest run of columns where at least 4 of the 5 lines are darker than halfway between the paper and the typical line, bridging gaps of two spaces. A staff shorter than half the page width is not measured.                                                                                                                                                                                                                  |
| Side         | Ink fraction in a window of `window` spaces at each end of every measured staff, over rows within `band` spaces of the middle line and not within 1 px of a line. A pixel is ink when it is darker than halfway between the window's own paper and the staff's dark end, so a shadow is not ink; that paper level never falls below halfway between the staff's paper and its dark end, so a clef that darkens the whole window is still ink. |
| Decision     | `side = (left - right) / (left + right)` over the summed windows. A staff starts with a clef and a key signature and ends with a barline, so the start carries more ink. The module abstains when fewer than 2 staves are measured, when the heavier end holds less than `minInk` per staff, or when `side` is below `sideMargin`.                                                                                                            |

| Limit                       | Value |
| --------------------------- | ----: |
| `minCoverage`               |   1.0 |
| `axisRatio`                 |     2 |
| `sideMargin`                |   0.2 |
| `minInk`                    |  0.08 |
| `window` (spaces)           |     4 |
| `band` (spaces)             |   2.5 |
| `minContrast` (grey levels) |    25 |

`sideMargin` keeps the value set before any measurement (0.2) and has not been moved. `window`, `band` and `minInk` were fixed on the unit tests and the rendered pages; the photo outcomes were visible during that work, so the photo rows are not held out. Staff lines of a page turned 90° run vertically, where the geometry finds no staves, so the axis comes from where staves are found and the side from the ink at the ends, for 0° against 180° and for 90° against 270° alike.

## Benchmark

`pnpm --filter @digitus2/web bench:orientation` (Chromium renders the 16 acceptance pages with `research/omr/prepare.mjs`, shared with `research/omr/acceptance.mjs`, and decodes the 14 phone photos; the first run takes about a minute longer). It turns each image to all four turns and records, per image, the turn read, the `side` value and the axis coverage in `research/omr/results/orientation/benchmark.json` (gitignored). Rendered pages are the first page of each acceptance piece, clean variant, upright. Photos are made upright with the `rotate` of their manifest entry first, so the two photos that are upside down as taken are the 180° case. The benchmark is not in `pnpm test`: it needs a browser.

## Results

Outcome by image class and clockwise turn applied to the upright page.

| Class         | Turn applied | Correct | Abstained | Wrong |
| ------------- | -----------: | ------: | --------: | ----: |
| Rendered (16) |           0° |      16 |         0 |     0 |
| Rendered (16) |          90° |      16 |         0 |     0 |
| Rendered (16) |         180° |      16 |         0 |     0 |
| Rendered (16) |         270° |      16 |         0 |     0 |
| Photos (14)   |           0° |       8 |         6 |     0 |
| Photos (14)   |          90° |       8 |         6 |     0 |
| Photos (14)   |         180° |       8 |         6 |     0 |
| Photos (14)   |         270° |       8 |         6 |     0 |

Each turn is analysed as the page and the page turned a quarter; the axis therefore finds the same staves at every turn, and the same six photos abstain at every turn.

| Floor                                           | Result        | Pass |
| ----------------------------------------------- | ------------- | :--: |
| Rendered pages: every turn correct or abstained | 0 wrong of 64 | yes  |
| Real photos: no wrong turn                      | 0 wrong of 56 | yes  |
| Photos turned 180°: at most 2 of 14 abstentions | 6             |  no  |

| Class                    | `side` range (absolute, decided and abstained) |
| ------------------------ | ---------------------------------------------: |
| Rendered                 |                                   0.22 to 0.62 |
| Photos with staves found |                                   0.04 to 0.95 |

## Limits

| Photo                                      | Outcome  | Why                                           |
| ------------------------------------------ | -------- | --------------------------------------------- |
| `boellmann-op28-page4-perspective-cut-off` | abstains | `analyzeStaffGeometry` finds no staves        |
| `bach-invention13-page3-photoscan`         | abstains | `analyzeStaffGeometry` finds no staves        |
| `boellmann-op28-page1-hand-shadow`         | abstains | `side` 0.04: the ink at the two ends is equal |
| `boellmann-op28-page4-upside-down`         | abstains | `side` 0.10                                   |
| `boellmann-op28-page2-shadow-cut-off`      | abstains | `side` 0.15                                   |
| `boellmann-op28-page5-shadow-torn`         | abstains | `side` 0.14                                   |
| `continuation-page25-book-warm-light`      | correct  | `side` 0.24, just above the margin            |
| `bach-invention13-page1-photoscan`         | correct  | only 3 staves measured                        |
| `bach-invention13-page2-photoscan`         | correct  | only 2 staves measured                        |

The two photos with no staves are the geometry's limit, and with them the floor of 2 abstentions leaves no room for any other: the other twelve photos must all be decided. Four are not, because the ink at the start and the end of the staves is nearly equal on a page with a shadow, a tear or a curve. The `side` values of those four (0.04 to 0.15) sit under the 0.2 margin, and the module has no cue that does not rest on ink amounts. The next cue is tracked in [issue 165](https://github.com/MarchalMaxim/digitus2/issues/165).
