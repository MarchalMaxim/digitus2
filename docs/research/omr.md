# Optical music recognition (OMR) research

What was evaluated for the experimental scanning feature (`docs/scanning.md`), what was measured, and why the product runs homr (photos) and Audiveris (PDFs) on the project's scan service on Google Cloud Run (`docs/scan-service.md`). The prototypes are under `research/omr/prototypes/`; raw outputs stay in the ignored `research/omr/results/`.

## Decision

- Recognition runs on a container the project operates on Google Cloud Run (`research/omr/service/`, `docs/scan-service.md`): one recognition at a time, scaled to zero when idle, its spend capped at 10 a month by a budget that disables billing. Every device scans the same way, phones included, with nothing to install and no account (Hosted recognition, below). GitHub Pages stays the only deployment of the app, and the product code stays TypeScript; Python runs only in that container.
- The loopback worker (`research/omr/prototypes/local-worker`) is a research tool: the acceptance gate and the adapters' tests run its code, and the service imports its job runner and adapters. The app does not talk to it.
- No vendor recognition service: the online services surveyed need sign-ups, sell per-page credits and keep the score on the vendor's servers (Online services, below). The project's own service names its provider before any page is sent, is used only on the reader's explicit **Scan this score**, keeps nothing and ships no token in the static bundle.
- Photos (PNG, JPEG) go to a pinned, patched homr; PDFs go to Audiveris 5.11.0 with a short-staff profile and the English text model. Only these two recovered usable music in the tests below.
- Browser-only recognition was rejected: no tested checkpoint produced usable notes fast enough. SMT++ produced wrong notes; oemer took 21 minutes for one page and kept its rhythm and meter errors.
- Recognition output is never repaired or guessed. Errors stay visible for review, and a strict importer refuses malformed notation. The worker applies two lossless export rules, checked on the file and reported in the review (Acceptance corpus and gate, below).

## Evaluation harness

`research/omr/prepare.mjs` renders library scores into complete page sets (clean PNG, deterministic photo-like degradations, PDF). Its manifest pins each original MusicXML by SHA-256 with its source and licence. The original XML is the ground truth. `research/omr/evaluate.mjs` scores whole-score exports (`.musicxml`, `.xml` or `.mxl`, one per fixture id) from any recogniser against it. The `omr` step of `pnpm verify` runs the harness tests (`pnpm test:omr`); it downloads no models and is not an accuracy gate. The accuracy gate is `omr:acceptance` (below).

`research/omr/piece-match.mjs` measures whether a recognised page finds its library piece by its pitch sequence: `docs/research/piece-match.md`.

```sh
pnpm --filter @digitus2/engine build
pnpm test:omr
node research/omr/prepare.mjs --out research/omr/results/fixtures            # needs Playwright Chromium; --slugs a,b,c picks pieces
node research/omr/evaluate.mjs --manifest research/omr/results/fixtures/manifest.json \
  --recognized DIR_OF_EXPORTS --candidate NAME --out research/omr/results/NAME.json
```

- `prepare.mjs` refuses an existing output directory, so a new fixture version needs a new directory.
- Exit status 0 means every export parsed, 1 means a missing, invalid or ambiguous export (all still counted as failures), and 2 means a configuration error or a changed ground-truth hash. Exit 0 is not an accuracy result.
- `recognitionExecuted: false` in a scorecard means the scorer only read exports. Record the recogniser version, invocation, input and timing next to each real run.
- Copying the references in as candidates must score 1.0. That is an identity check, never OMR accuracy.

Each bar is paired by ordinal position. Onsets are exact rational quarter-note offsets from the bar start, so one overlong bar does not shift every later onset. A deleted or inserted bar still misaligns the bars after it; the scorer does not guess an alignment.

| Metric     | Exact multiset compared within each bar                                    |
| ---------- | -------------------------------------------------------------------------- |
| pitch      | MIDI pitch, with multiplicity                                              |
| onsetPitch | Pitch and local onset                                                      |
| duration   | Pitch, onset and sounding duration                                         |
| staff      | Pitch, onset and global staff ordinal                                      |
| voice      | Voice partitions within a staff, independent of voice numbers              |
| fullNote   | Pitch, onset, duration, staff, grace status and the note's whole voice set |

These are precision, recall and F1 per projection, not per-note accuracy. Strict full-note F1 is the headline number. Because the voice key is the whole onset/pitch set of a voice in its bar, one wrong note can invalidate its neighbours. A low full-note F1 therefore does not mean that most noteheads were wrong. The scorer parses with `preserveNotation: true` (duplicates and chord-member durations kept; tied segments merged). Slurs, beams, articulations, enharmonic spelling and layout are not scored, and rests count only through timing. A reference that fails preservation-mode parsing is fixed or dropped; the checks are never relaxed to suit a candidate.

The default corpus is page 1 of three library pieces: Twinkle, Bach Minuet in G (BWV Anh. 114) and Chopin Prelude Op. 28 No. 7 (436 sounding notes). The held-out pages are Ode to Joy, Amazing Grace, Greensleeves and Schumann Op. 68 No. 1. All are synthetic engravings, not historical scans or phone photos.

## Acceptance corpus and gate

`research/omr/acceptance.mjs` is the scanning gate, the `omr:acceptance` step of `pnpm verify`. It renders the 16 one-page library pieces of `research/omr/acceptance/corpus.json` with `prepare.mjs`, recognises every page with the adapters the scan service runs (`acceptance/recognize.py` imports `local-worker/homr.py` and `audiveris.py`, so the gate measures the shipped pipeline), and scores note by note against the library MusicXML: the projection F1s above plus `diagnose.mjs`. It fails when a route falls below `research/omr/acceptance/floor.json`. Without the recognisers it reports SKIP with the reason. Outputs are cached in the ignored `research/omr/results/acceptance/` by the hash of the input and of the pipeline's files, so a rerun recognises only what changed (80 recognitions take about 15 minutes on a Ryzen 7 7800X3D). The photos add 16 recognitions as taken and turned and 56 perturbed (`photos:perturbed`); `--photos` runs only the photo routes, which need homr alone, and with `--update-floor` rewrites only their floors.

```sh
node research/omr/acceptance.mjs --check          # 0, or 3 with the reason the recognisers are missing
node research/omr/acceptance.mjs                  # recognise what changed, score, compare with floor.json
node research/omr/acceptance.mjs --update-floor   # after a reviewed, measured change
```

Set `DIGITUS2_OMR_HOMR`, `DIGITUS2_OMR_BUNDLE` or `DIGITUS2_OMR_TEXT_MODELS` when a toolchain is not in its setup folder. The corpus adds pieces with ties across voices and bars, chords, volta endings, long beams, tuplets and two-voice staves to the earlier seven: Bach BWV Anh. 120, 119 and BWV 941, Burgmüller Op. 100 No. 5, Tchaikovsky Op. 39 No. 1, Czerny Op. 821 No. 5, Kuhlau Op. 20 No. 1 (II), Chopin Op. 69 No. 2 and Schumann Op. 68 No. 10. Each page goes to homr in four variants (clean, shadow, low contrast, 1.5° skew) and its PDF to Audiveris. They are synthetic engravings: exact truth for the pipeline, not evidence of robustness to camera photos.

`diagnose.mjs` counts the error classes of issue #39 over bars whose starts agree: **ties missed** (a reference tie the recognition re-attacks), **ties extra** (the reverse), **duplicates** (notes beyond the reference's count at one staff, onset and pitch) and **wrong staff** (onset and pitch right, staff wrong), plus **beam F1** over exact primary beam groups. Floors follow the benchmark rule (F1 in percent minus 0.5, rounded down); error ceilings are the measured counts.

A page cut from a longer piece (camera-fusion.mjs `sliceScore`, used for the PhotoScan pages of Invention 13) starts at tick 0 as a recognised page does, with every bar keeping its length, so its bars pair with the recognised page's by ordinal position: all 10 bars of PhotoScan page 2 and all 3 of page 3 pair, where a cut that kept its absolute starts paired none and counted each as a timing mismatch. The error classes are 0 over every paired bar; the full-note F1 of the three pages (76.70, 88.74, 87.88) does not depend on the pairing.

| Route (16 pages each) | Imports | Full-note F1 before | after | Pitch F1 after | Ties missed before | after | Extra ties | Duplicates | Wrong staff | Beam F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| homr, clean | 16 | 86.77 | 89.95 | 99.26 | 17 | 13 | 1 | 2 | 1 | 0 |
| homr, shadow | 16 | 83.54 | 86.75 | 99.25 | 18 | 13 | 1 | 1 | 63 | 0 |
| homr, low contrast | 16 | 87.79 | 90.96 | 99.54 | 17 | 13 | 1 | 1 | 0 | 0 |
| homr, skew | 15 | 86.14 | 89.39 | 96.95 | 17 | 13 | 1 | 0 | 0 | 0 |
| Audiveris, PDF | 16 | 86.65 | 86.65 | 98.72 | 8 | 8 | 0 | 1 | 0 | 92.01 |

The two worker rules behind "after" (`local-worker/normalize_export.py`, applied to every homr export and reported as a review warning):

- **An empty measure joins its neighbours.** homr writes the bracket that closes a first ending as a measure of its own, holding only that barline; every later bar was then counted one too far (Burgmüller Op. 100 No. 5: 51.2% to 91.2%). The barline moves onto the bar it closes, attributes and directions open the next bar, and no pitch, duration or onset changes. Two empty measures in a row, or barlines that would collide, leave the file unchanged.
- **A slur joining one pitch to its continuation is a tie, whatever the voice numbers.** homr's model draws ties and slurs as one class and its exporter converts a slur to a tie only between notes of the same voice number; its voice numbers change across held notes (Bach BWV 941 bar 4: the held E5 is voice 2, its continuation voice 1). The worker applies the same rule by staff, pitch and exact time: one slur start and the stop of the same slur number, on one pitch, the second note starting where the first ends; ambiguous cases stay slurs.

What remains, and why:

- **13 missed ties per homr variant** carry no tie or slur mark in homr's output at all (Bach BWV 941, Chopin Op. 28 No. 7, Kuhlau): the model did not see them, and inventing them would be a guess. The review's **Tied to next** corrects them.
- **63 wrong-staff notes** are one page (Bach BWV Anh. 120 with the edge shadow) that homr read as a single staff whose clef alternates between treble and bass: the grand staff was not paired. The worker detects this pattern (one part, no `<staves>`, three or more treble–bass clef changes; it fires on this page and on no other of the 64) and the review's verdict line names the page; nothing is repaired.
- **Duplicates** are mostly shared noteheads written in two voices, which the reference also has; the remaining counts are rhythm errors (Czerny's sixteenths read as 32nds).
- **Beams.** homr writes no beams, its segmentation has no beam class (stems and rests only) and its note positions are attention estimates in staff-crop coordinates, so beam strokes cannot be linked to recognised notes without an alignment homr does not provide. The app's display inference (`scanBeams.ts`) matches 133 of the 357 reference groups on clean pages (precision 26.6%, recall 37.3%). Recovering beams from the image would have to beat that at about 98% precision on every variant to be presented as read from the source; that work is not done (#39). The PDF route reads beams from the source: 92.01% exact groups.

### Note positions (imgpos)

homr writes each note's estimated centre as `<!-- imgpos: x, y -->`, in the pixels of the image it was given (mapped back through its staff crop, its 1920 px resize and its autocrop). The review draws the page photo around that point (`docs/scanning.md`), so how far the point lies from the notehead sets the size of the crop. `research/omr/imgpos.mjs` measures it on the 16 clean pages of the corpus:

- **Truth.** Verovio draws each reference again with every note named by its document-order index, which must give the fixture's drawing exactly; Chromium lays that drawing out at the PNG's size, and each notehead's box centre is its true position. Distances are in the page's staff spaces (10.8 px on these pages).
- **Pairing.** Recognised notes pair with reference notes as `evaluateOmr` pairs them: bar by ordinal, then equal onset in the bar and MIDI pitch (the same staff first). `alignScores` is not used, because it needs equal note counts and pitches. Only notes recognised at the right time and pitch are measured: 2,986 of 3,047 reference notes.
- **Crop.** A crop is 2H staff spaces high and 4H wide, centred on the reported point; a note is inside when |dy| <= H and |dx| <= 2H.

| Measure (16 pages, 2,986 paired notes)        |             Value |
| --------------------------------------------- | ----------------: |
| Distance, median                              | 0.75 staff spaces |
| Distance, 90th percentile                     | 1.65 staff spaces |
| \|dx\|, median / 90th percentile              |       0.33 / 0.78 |
| \|dy\|, median / 90th percentile              |       0.56 / 1.53 |
| Signed dx, dy (recognised minus true), median |     -0.22 / -0.12 |
| Inside a crop of H = 1                        |             74.5% |
| Inside a crop of H = 1.5                      |             89.1% |
| Inside a crop of H = 2                        |             96.5% |
| Inside a crop of H = 2.5                      |             99.0% |
| Inside a crop of H = 3                        |             99.5% |

The vertical axis is the weak one: a position is nearer the right bar and beat than the right line or space. The crop is the smallest of H = 1.5, 2, 2.5 and 3 that holds at least 90% of the notes, so it is 4 staff spaces high and 8 wide (H = 2); H = 1.5 holds 89.1%. The signed medians are under 0.3 staff spaces, so the app applies no correction. Per page, the share inside the H = 2 crop is lowest for Ode to Joy (86.7%), Czerny Op. 821 No. 5 (88.9%) and Tchaikovsky Op. 39 No. 1 (90.8%); the others reach 93.5% to 100%. `research/omr/acceptance/floor.json` holds `imgpos: {halfHeightSpaces: 2, insideCropMin: 0.95}`, and the benchmark fails below it.

```sh
DIGITUS2_OMR_HOMR=<homr toolchain> node research/omr/imgpos.mjs          # measure, compare with the floor
node research/omr/imgpos.mjs --check                                      # 0, or 3 with the reason homr is missing
```

It reuses the acceptance gate's recognition cache and recognises the pages that are not cached. It is run by hand, not by `pnpm verify`.

### Real phone photos

`research/omr/photos/` holds fourteen phone photographs by the owner (public domain): eleven WhatsApp-compressed JPEGs (1200×1600, one 1308×1600, about 0.2 MB each) of pages 1 to 5 of Boëllmann's Improvisations Op. 28 (No. I in 3/4 with one sharp, No. II in 9/8 with two sharps), several in two conditions, and of the continuation page of a bound book that first tested scanning; and three Google PhotoScan images (about 1070×1600) of the three pages of Bach's Invention No. 13. Only the invention is in the library (`bach-invention-no13-bwv-784`), but the gate checks its photos like the others, on facts alone, so no photo is scored note by note: `manifest.json` holds what was read off each page by eye (bars, staves, key and time signature), and the gate's `photos` route checks it exactly. Two photos are cut off at the bottom; none is unusable. The upside-down photos are scanned as taken and turned 180° as **Rotate** does.

| Photo | Bars (page) | Staves | Key | Time (page) | Strict import | Worker rules |
| --- | ---: | ---: | :---: | :---: | :---: | --- |
| No. I p. 1, hand shadow | 19 (19) | 2 | ✓ | ✓ | ✓ | none needed |
| No. I p. 2, shadow, cut off | 28 (24) | 2 | ✓ | ✓ | ✓ | 4 slurs read as ties |
| No. I p. 2, flat | 24 (24) | 2 | ✓ | ✓ | ✓ | 4 slurs read as ties |
| No. I p. 3, upside down, as taken | 24 (24) | 1 | ✗ | ✓ | ✓ | grand-staff warning shown |
| No. I p. 3, upside down, rotated | 24 (24) | 2 | ✓ | ✓ | ✓ | 9 slurs read as ties |
| No. I p. 3, perspective | 24 (24) | 2 | ✓ | ✓ | ✓ | 8 slurs read as ties |
| No. II p. 4, perspective, cut off | 14 (11) | 2 | ✓ | ✓ | ✗ tie gap | none |
| No. II p. 4, upside down, as taken | 11 (11) | 2 | ✗ | 4/4 (9/8) | ✗ tie gap | none |
| No. II p. 4, upside down, rotated | 16 (11) | 2 | ✓ | ✓ | ✗ tie gap | none |
| No. II p. 5, shadow, torn | 27 → 26 (15) | 2 | ✓ | 4/4 (9/8) | ✓ | 1 empty measure merged, 1 tie |
| No. II p. 5, flat | 15 (15) | 2 | ✓ | 4/4 (9/8) | ✓ | 1 slur read as a tie |
| Book p. 25, warm light | 13 (13) | 2 | ✓ | 4/4 inferred (none printed) | ✓ | 1 slur read as a tie |
| Book p. 25, dim | 13 (13) | 2 | ✓ | 4/4 inferred (none printed) | ✓ | 1 slur read as a tie |
| Invention 13 p. 1, PhotoScan | 12 (12) | 2 | ✓ | ✓ | ✓ | none |
| Invention 13 p. 2, PhotoScan | 10 (10) | 2 | ✓ | 4/4 inferred (none printed) | ✓ | none |
| Invention 13 p. 3, PhotoScan | 3 (3) | 2 | ✓ | 4/4 inferred (none printed) | ✓ | none |

Totals as taken (14 photos): 14 recognised, 12 pass the strict import, 11 have the page's bars, 13 its staves, 12 its key, 7 its time signature. Rotated (2 photos): both recognised, 1 imports, and both have the right staves, key and time; 1 has the right bars. These counts are the gate's `photoFloors`. All 14 are read as one part; staves count as right only for a single part with the page's staves, since a page read as a treble part and a bass part is not the grand staff it shows. The bars of a page are the sum of its parts' measures when every part is a grand staff (a page cut into consecutive halves), and those of its longest part otherwise. The worker rules changed the bar count only on the torn page (27 to 26) and changed no import result. All four slurs read as ties on page 2 (flat) were checked against the print: each is a half note tied to an eighth of the same pitch (bars 14 to 17). The other conversions were not checked by eye.

What the photos show:

- **Turn an upside-down photo before scanning.** As taken, page 3 lost its grand staff (one staff whose clef keeps changing, which the review flags) and page 4 lost its key and meter; rotated, both read the right staves, key and time.
- **The 9/8 pages are the weak case.** homr infers the meter from bar lengths when it misses the printed one, and read 4/4 on both photos of page 5, so every bar there runs 4.5 beats into a 4-beat bar; the review lists each one as longer than its time signature and offers **Set 9/8 time from bar 1**, which leaves one place to check of 14 on the flat photo (bar 14, where the hands disagree) and one of 7 on the torn photo. Page 4 fails the strict import on all three photos with a tie whose two notes do not meet. On the rotated photo it is bar 16 of homr's 16: a tied half note A4 that ends a beat before its continuation. The review points at it, and making the note dotted clears it; that bar is also one of homr's extra bars, so the photo still needs checking against the page.
- **A missed clef can cost bars.** On Invention 13 page 1, homr finds no bass clef in the first system and its line tracking splits that staff in two; without the coverage patch the duplicate filter keeps only the right part, the system is read from the middle of bar 2, and bars 1 and 2 are lost while bar 3 is read twice (issue 129). With the patch the complete staff, found by its lines alone, takes its place and the page reads all 12 bars.
- **A partly read system is flagged.** The adapter works on homr's staff-position rows, one row per staff of every system (a paired grand staff is one row, an unpaired staff a row of its own). The column is the median left and right edge of the staves at least 0.75 of the longest one. A staff is flagged when it starts more than 25 percent of the column's width right of the column's left edge, or when it ends that far short of the column's right edge and some staff below it does not end short: the short last system of a piece is not flagged, a short system that ends a piece partway down the page, with a full staff below it, is. On this set it fires on No. I p. 2 (shadow, cut off), No. II p. 4 (perspective, cut off) and No. II p. 5 (shadow, torn): each has a short stray staff that adds bars. Without the coverage patch it also fires on Invention 13 p. 1, whose first system starts late.
- **Extra bars** come from the cut-off photos (a partial last system) and the torn corner, which homr splits into more measures than the page has.
- **The book page** reads the same on both photos: all 13 main bars, both hands, 155 notes. The earlier test (156 and 157 notes on the owner's first two photos of this page) also found a duplicated C5 and a bass E3 in the upper hand; without note-level truth the gate does not count them.

### Capture variability (photos:perturbed)

A phone never gives the same bytes twice, and the same paper was paired on one capture and split on the next (issue 156). The `photos:perturbed` route recognises each photo, turned upright when taken upside down, under four small changes made by `acceptance/perturb.py`: re-encoded at JPEG quality 95 and 80, cropped by 3% on each side, and rotated by 0.5°. It checks parts, staves, bars, key and time like the photos route. Cells are parts/bars; for the two upside-down photos "as taken" is the turned copy.

| Photo (page bars) | as taken | q95 | q80 | crop 3% | rotate 0.5° |
| --- | ---: | ---: | ---: | ---: | ---: |
| No. I p. 1, hand shadow (19) | 1/19 | 1/19 | 1/19 | 1/22 | 1/19 |
| No. I p. 2, shadow, cut off (24) | 1/28 | 2/24 | 2/25 | 2/28 | 2/20 |
| No. I p. 2, flat (24) | 1/24 | 1/24 | 1/24 | 1/24 | 1/24 |
| No. I p. 3, upside down, turned (24) | 1/24 | 1/24 | 1/24 | 1/24 | 1/24 |
| No. I p. 3, perspective (24) | 1/24 | 1/24 | 2/24 | 2/24 | 2/24 |
| No. II p. 4, perspective, cut off (11) | 1/14 | 1/16 | 1/11 | 2/17 | 2/12 |
| No. II p. 4, upside down, turned (11) | 1/16 | 1/12 | 1/11 | 1/11 | 1/11 |
| No. II p. 5, shadow, torn (15) | 1/26 | 1/28 | 1/25 | 2/18 | 2/20 |
| No. II p. 5, flat (15) | 1/15 | 1/15 | 1/15 | 1/18 | 1/15 |
| Book p. 25, warm light (13) | 1/13 | 1/13 | 1/13 | 1/13 | 1/13 |
| Book p. 25, dim (13) | 1/13 | 1/13 | 1/13 | 1/15 | 1/13 |
| Invention 13 p. 1, PhotoScan (12) | 1/12 | 1/12 | 1/12 | 1/12 | 1/12 |
| Invention 13 p. 2, PhotoScan (10) | 1/10 | 1/10 | 1/10 | 1/10 | 1/10 |
| Invention 13 p. 3, PhotoScan (3) | 1/3 | 1/3 | 1/3 | 1/3 | 1/3 |

Totals over 56 readings: 56 recognised, 48 import, 11 read as two parts, 42 have the page's bars, 44 its staves, 49 its key, 30 its time. Four of the 14 photos are read as two parts under at least one change (No. I p. 2 shadow, cut off: all four; No. I p. 3 perspective: three; No. II p. 4 cut off and No. II p. 5 torn: two each); the other ten stay one part. Where a page splits, its bars are counted over the whole score: on No. I p. 3 perspective two grand-staff parts of 12 bars each add up to the 24-bar page, while on No. I p. 2 shadow, cut off a 19-bar one-staff part beside a 24-bar grand staff counts 24, the longest part, since a sum would count the same bars twice. The 3% crop of No. I p. 1 reads one staff and key -3. Six photos read the same under every change (No. I p. 2 flat, No. I p. 3 turned, book p. 25 warm light, the three PhotoScan pages). These are the gate's `photoPerturbedFloors` (two-part readings as a ceiling). The changes are a proxy for capture variability, not a copy of it.

### Blur sweep

`node research/omr/blur-sweep.mjs` blurs the 8 one-page truth pieces of `camera-fusion.mjs` (page 1 rendered clean, 1260 × 1782 px, interline 10.7 px) and the 14 phone photos above (interline 8.1 to 11.7 px) at the page's own pixel scale, recognises every variant with local homr (cached by the hash of its bytes and of the acceptance pipeline), and scores it: truth pages with `evaluateOmr` (pitch F1, exact bars, staves), photos with the manifest facts (bars, staves). Variants: Gaussian blur of sigma 0 to 3 px, motion blur of 3, 6 and 9 px across the staff lines (vertical) and along them (horizontal), and on the truth pages Gaussian blur of 0.25, 0.3 and 0.4 interline (2.7, 3.2 and 4.3 px). A page counts as read when its bars and its staves are right. Only pages that read right unblurred take part in the calibration: 18 of 22 (the two cut-off photos, the upside-down page 3 and the torn page 5 do not). The scorecard, with every row, is `research/omr/results/blur-sweep/latest.json` (git-ignored).

The measure is `staffSharpness` in `apps/web/src/scan/camera/sharpness.ts`. For each of the five lines of every staff that `analyzeStaffGeometry` traces, at 20 columns, it divides the line's equivalent width (the area of its dip below the paper over the dip's depth) by the interline, and returns the median. Blur conserves the dip's area and lowers its depth, so the width is 2.5 sigma for a blurred line and the line's own thickness for a sharp one; the paper level comes from the bands just beyond the staff. The rise distance from 10 to 90% of the dip, which the issue names, saturates at about 0.30 interline once neighbouring lines overlap (sigma 2 on a 10 px interline), exactly where homr starts losing bars; the equivalent width keeps growing. When the tracer finds no staff, a copy of the frame with its local contrast raised (gains 4, 8, then 32) is traced instead, which extends the reach from about 0.17 to about 0.3 interline of sigma. A synthetic page of eight staves (interline 10 px, lines 1.2 px thick) measures:

| Gaussian sigma (px) | 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Measure | 0.169 | 0.193 | 0.299 | 0.410 | 0.523 | 0.626 | 0.724 |

Across ink levels 25 and 90 and dense or sparse notes the values stay within 0.7% of their mean, and the same page drawn twice as large and blurred twice as much measures 4.8% lower (0.390 against 0.410); `sharpness.test.ts` asserts 10% for both, that a page blurred to sigma 3 is traced only on the raised-contrast copy, and that no staff is traced, raised contrast included, on sensor noise, faint noise, JPEG-like blocks, a page of text and three test cards. Over the 310 variants of the sweep, on the desktop that ran it with other jobs running, measuring the traced staves takes a median of 6 ms (90th percentile 10 ms, 31 ms at most) and tracing them is the cost: a median of 383 ms (90th percentile 613 ms, 1.1 s at most) on a frame the tracer reads as it is (152 variants), 928 ms (90th percentile 1.6 s, 2.7 s at most) when a raised-contrast copy is needed, the plain attempt included (81 variants), and 1.4 s (90th percentile 2.1 s, 3.1 s at most) to fail (77 variants). The scorecard keeps both times of every row (`traceMs`, `measureMs`).

| Variant | Blur / interline (truth) | Truth pitch F1 | Truth bars right | Truth staves right | Truth measure (traced) | Photos bars right | Photos staves right | Photos read, of those read sharp | Photo blur / interline | Photos measure (traced) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| none | 0 | 99.7 | 8/8 | 8/8 | 0.138 (8) | 11/14 | 13/14 | 10/10 | 0 | 0.257 (13) |
| Gaussian 0.5 | 0.05 | 99.7 | 8/8 | 8/8 | 0.162 (8) | 11/14 | 13/14 | 10/10 | 0.05 | 0.276 (13) |
| Gaussian 1 | 0.09 | 99.7 | 8/8 | 8/8 | 0.267 (8) | 11/14 | 14/14 | 9/10 | 0.11 | 0.369 (12) |
| Gaussian 1.5 | 0.14 | 99.5 | 8/8 | 8/8 | 0.374 (8) | 10/14 | 13/14 | 8/10 | 0.16 | 0.474 (12) |
| Gaussian 2 | 0.19 | 93.2 | 7/8 | 8/8 | 0.480 (8) | 5/14 | 13/14 | 3/10 | 0.21 | 0.580 (11) |
| Gaussian 2.5 | 0.23 | 50.9 | 1/8 | 7/8 | 0.588 (7) | 3/14 | 14/14 | 2/10 | 0.27 | 0.688 (9) |
| Gaussian 3 | 0.28 | 24.5 | 0/8 | 8/8 | 0.699 (6) | 0/14 | 9/14 | 0/10 | 0.32 | 0.711 (5) |
| 0.25 interline | 0.25 | 35.4 | 0/8 | 7/8 | 0.632 (8) | | | | | |
| 0.3 interline | 0.30 | 21.8 | 0/8 | 7/8 | 0.737 (4) | | | | | |
| 0.4 interline | 0.40 | 5.2 | 0/8 | 2/8 | none (0) | | | | | |
| Vertical motion 3 | 0.08 | 99.6 | 8/8 | 8/8 | 0.373 (8) | 11/14 | 13/14 | 9/10 | 0.09 | 0.440 (11) |
| Vertical motion 6 | 0.16 | 89.1 | 6/8 | 8/8 | 0.642 (1) | 8/14 | 13/14 | 8/10 | 0.19 | 0.716 (8) |
| Vertical motion 9 | 0.24 | 20.1 | 0/8 | 3/8 | none (0) | 0/14 | 7/14 | 0/10 | 0.28 | 0.779 (2) |
| Horizontal motion 3 | 0.08 | 90.9 | 6/8 | 8/8 | 0.142 (8) | 7/14 | 14/14 | 7/10 | 0.09 | 0.256 (13) |
| Horizontal motion 6 | 0.16 | 19.9 | 0/8 | 6/8 | 0.144 (8) | 0/14 | 13/14 | 0/10 | 0.19 | 0.261 (13) |
| Horizontal motion 9 | 0.24 | 12.9 | 0/8 | 6/8 | 0.146 (8) | 0/14 | 9/14 | 0/10 | 0.28 | 0.271 (13) |

Blur per interline is sigma for Gaussian blur and length over the square root of 12 for motion blur, over the page's interline. The photos' own blur adds to it: the 13 traced photos as taken measure 0.210 to 0.283 where the truth pages measure 0.134 to 0.142.

What the sweep shows:

- **The measure predicts where homr breaks.** Truth pages lose a bar at 0.48 (7 of 8 bars right) and most bars at 0.59; photos lose bars at 0.58 (3 of 10 still read) and are gone at 0.71. Both curves cross at a measure of about 0.5 to 0.6.
- **The live 360 px gate sees none of it.** `sharpness` in `vision.ts` at the 360 px the camera judges (TRACKABLE, 80) passes all 204 variants of the 18 calibration pages, the 25 that lose their staves among them: its agreement with homr's outcome is 55.4%, the share of variants homr reads right.
- **Staff loss follows the blur only where the tracer still sees the page.** The lowest measures at which a variant loses its staves are 0.480 (page 3, perspective, Gaussian 1.5) and 0.484 (book page, warm light, Gaussian 2), but both rest on a partial trace: the tracer finds 2 of the 11 staves it finds on page 3 unblurred and 3 of the 8 on the book page, and the measure is the median of the staves traced, which are the sharpest parts of the page. At Gaussian 2 the same page 3 measures 0.618 on 9 staves, and it already loses bars at Gaussian 1 (20 of 24, measure 0.380). The flat page 5 still reads both staves and all 15 bars at 0.694 and the hand-shadow page 1 at 0.635. The two low rows therefore do not show that staff loss is independent of the blur. A floor that passes no variant that loses its staves, and rejects none of the photos as taken (the largest is 0.283), has to sit below 0.480 over every measured variant. Over the variants that still trace at least half of their page's staves the lowest such measure is 0.711 (hand-shadow page 1, Gaussian 3, 5 of 9 staves), but 24 of the 25 variants that lose their staves are then not judged.
- **The tracer limits the reach.** The staff tracer finds no staff on 77 of the 310 variants (every variant of the cut-off page 4 photo, which has strong perspective, among them) and these are the heavy blurs: 18 of the 25 variants that lose their staves have no measure. Higher contrast gains (128 and 512, tried on two truth pages) do not extend the reach: past about 0.3 interline the lines are one grey band.
- **Blur along the staff lines is invisible.** Horizontal motion moves the median measure by at most 0.015 (0.257 to 0.271 on the photos) and any single page by at most 0.03 (0.029 on the torn page 5, 0.023 on the hand-shadow page 1), while 0.16 interline of it already costs every photo its bars; the variants of it that lose their staves measure 0.282 or less, below any floor that keeps the photos, so all 8 of them pass.

| Floor | Photos as taken rejected | Agreement, measured variants (146) | Right-read variants rejected (of 100) | Variants losing staves passed, of the 7 measured | Agreement, gate as the camera would run it (204) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.40 | 0 | 79.5% | 28 | 0 | 63.2% |
| 0.479 | 0 | 87.0% | 16 | 0 | 68.6% |
| 0.55 | 0 | 88.4% | 10 | 2 | 69.6% |
| 0.60 | 0 | 84.9% | 6 | 2 | 67.2% |
| 0.70 | 0 | 74.0% | 2 | 3 | 59.3% |

The gate as the camera would run it judges by the measure where a staff is traced and by the live 360 px measure where none is. The best floor that passes no staves-losing variant is 0.479: it keeps all 13 measurable photos, rejects 16 of the 100 variants homr reads right and 7 of the 25 that lose their staves (18 have no measure, and the live measure passes them), against the 95% agreement and zero false passes the issue asks for.

Two other rules answer the two weaknesses above, a partial trace and no trace. Their floors come from the same calibration (`calibrationCovered` and `gates.strict` in the scorecard):

| Rule | Floor | Variants judged | Agreement | Right-read variants rejected | Variants losing staves passed | Photos as taken rejected |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Measure where traced; the live 360 px measure where none is | 0.479 | 204 | 68.6% | 16 of 113 | 18 of 25 | 0 |
| Measure where traced; no traced staff counts as blurry | 0.479 | 204 | 84.3% | 29 of 113 | 0 of 25 | 1 |
| Measure only where at least half of the page's staves are traced | 0.597 | 102 | 93.1% | 2 of 87 | 0 of 1 judged (24 not judged) | 0 |

The second rule is the only one that passes none of the 25 staves-losing variants over all 204, and it is infeasible: it rejects the cut-off page 4 photo as taken (no staff is traced on it, and homr misreads it anyway) and 29 of the 113 variants homr reads right, so it fails the zero-photos-rejected constraint and the agreement is 84.3%. The third reaches 93.1% by leaving 102 variants unjudged, among them 24 of the 25 that lose their staves, so its zero false passes rest on one variant. No rule reaches the 95% agreement with zero false passes and zero photos rejected, and no capture gate is built on any of them. Reproduce with `DIGITUS2_OMR_HOMR=... node research/omr/blur-sweep.mjs` after `pnpm --filter @digitus2/engine build`; the first run takes about 55 minutes on the recognitions, later runs read them from the cache. The open work is [issue 162](https://github.com/MarchalMaxim/digitus2/issues/162).

## Routes evaluated

| Route                                                                                                                                                                                                                | Runs where                                       | Result                                                                                                                                                                     | Decision                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [SMT++](https://github.com/antoniorv6/SMT-plusplus) via [CrispEmbed](https://github.com/CrispStrobe/CrispEmbed) (ggml/WASM, [full-page](https://huggingface.co/cstr/smt-fp-grandstaff-GGUF) and [system](https://huggingface.co/cstr/smt-grandstaff-GGUF) GGUF) | Browser, single-thread worker                    | No usable notes on any clean fixture: empty output, repeated rests, or invented pitches and meters                                                                    | Rejected                                       |
| [oemer](https://github.com/BreezeWhite/oemer) (two ONNX segmentation models plus Python reconstruction)                                                                                                            | Native, and browser (ONNX Runtime Web + Pyodide) | Full-note F1 88.37 / 88.73 / 0.59 % on the three clean pages; no meter or beams exported; browser Twinkle took 21 min                                                      | Rejected                                       |
| [Audiveris](https://github.com/Audiveris/audiveris) 5.11.0                                                                                                                                                           | Native (bundled Java)                            | 4–8 s per clean page; 100 % on Twinkle with the short-staff profile; 86.73 % corpus F1 from original PDFs with English OCR                                                  | Adopted for PDFs                               |
| [homr](https://github.com/liebharc/homr), pinned and patched                                                                                                                                                         | Native (CPU ONNX)                                | Recovers all 13 main bars and both hands on two real book photos where Audiveris and oemer failed                                                                          | Adopted for photos                             |
| Online services: [Flat/Tutteo OMR API](https://flat.io/developers/docs/api/omr/), [Klangio Scan2Notes](https://klang.io/help/compare-apps-and-subscriptions/), [Newzik](https://newzik.com/notre-api-omr)           | Vendor servers                                   | Not run                                                                                                                                                                    | Rejected: sign-ups, per-page credits, the score on the vendor's servers |
| [satb-line-omr](https://github.com/alexanderalber/satb-line-omr)                                                                                                                                                     | Browser ONNX                                     | Not run: one voice per staff, excludes polyphony and scans                                                                                                                 | Not suitable for piano                         |

### SMT++ in the browser

The runtime itself works: a classic Web Worker without COOP/COEP headers, lazily loaded static model and WASM files, transferable RGBA input, and worker termination as cancellation. Recognition does not. The original system-level safetensors, run in the [official PyTorch code](https://github.com/antoniorv6/SMT-plusplus/tree/e49345abccc77d3b030b84fcdec7387204563736), produce output byte-identical to the F32 browser GGUF on the same Twinkle crop, invented opening chord included. The checkpoint is the cause, not conversion or quantisation, so further crop or quantisation sweeps are not worth running. The full-page model also failed with inverted input. At native page resolution it exceeded the 2 GB WASM heap; half-scale pages used about 860 MB. Its confidence output is always zero. Model provenance: [PRAIG full-page model](https://huggingface.co/PRAIG/smt-fp-grandstaff), [original system weights](https://huggingface.co/antoniorv6/smt-grandstaff/tree/2eb5a45c29d63bdf063cd0427175f57675e7da9e). Both declare MIT.

### oemer, native and in the browser

| Clean page     | Notes ref/recognised | Pitch F1 | Onset+pitch F1 | Full-note F1 | Bars ref/recognised | Bar timing mismatches |
| -------------- | -------------------: | -------: | -------------: | -----------: | ------------------: | --------------------: |
| Twinkle        |                64/65 |   99.22% |         94.57% |       88.37% |               12/12 |                    12 |
| Bach minuet    |              204/204 |   99.02% |         94.12% |       88.73% |               32/32 |                    25 |
| Chopin prelude |              168/173 |   39.88% |         15.84% |        0.59% |               17/16 |                    16 |

Native CPU inference took about 200 s per page. Twinkle's printed metronome note becomes an extra event, which makes bar 1 five beats long and shifts every later bar. Chopin loses a bar and its meter, beams and rhythm. oemer's `decode_measure` (`build_system.py`) emits no time signature, and none of the exports contains a `<time>` or `<beam>` element, so a better checkpoint alone cannot fix it.

The browser version runs both ONNX models in [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) 1.22.0 (one WASM thread, not cross-origin isolated). It runs the unchanged upstream reconstruction in Pyodide 0.26.4 and loads its SVC classifiers from safe JSON/NPZ exports, never pickle. On Twinkle its label maps were byte-identical to native and its score was identical. It took 1,268 s on an AMD Ryzen 7 7800X3D: 366 s for model 1, 889 s for model 2 and 5 s for reconstruction, with a working set of about 1.5 GB.

WebGPU ([ORT WebGPU provider](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)) did not rescue it:

| Control                     | Result                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Model 1 on GPU, 256×256     | 1,910 of 65,536 argmax pixels differ from CPU, also with graph optimisation off: rejected |
| Model 2 on GPU, four patches | Zero argmax differences; about 0.5–0.7 s per patch against 3.45 s on CPU                 |

Playwright's bundled headless Chromium reports SwiftShader and no WebGPU adapter; installed Chrome and Edge expose the hardware GPU. The hybrid page (model 1 on WASM, model 2 on WebGPU) was never run end to end, so no speed-up is claimed. Porting oemer's reconstruction to TypeScript (about 4,500 lines of Python plus OpenCV and SciPy) would keep its recognition errors.

### Audiveris

Strict full-note F1 on the clean pages. The default and short-staff columns are PNG input; the last column is the original PDF with the English text model.

| Page             | oemer  | Audiveris default | Short-staff profile | Short-staff, PDF + OCR |
| ---------------- | -----: | ----------------: | ------------------: | ---------------------: |
| Twinkle          | 88.37% |            95.93% |                100% |                   100% |
| Bach minuet      | 88.73% |            91.18% |              91.18% |                 93.37% |
| Chopin prelude   |  0.59% |            40.91% |              40.91% |                 73.75% |
| Corpus           | 54.44% |            73.42% |              74.17% |                 86.73% |
| Held-out corpus  |      — |            81.10% |              81.10% |                 93.19% |

| Held-out page    | PNG (default = profile) | PDF + OCR | Events ref/recognised (PDF) |
| ---------------- | ----------------------: | --------: | --------------------------: |
| Ode to Joy       |                  86.25% |    96.39% |                       83/83 |
| Amazing Grace    |                  82.61% |      100% |                       69/69 |
| Greensleeves     |                  61.84% |      100% |                     106/106 |
| Schumann Op.68/1 |                  86.82% |    87.50% |                     256/256 |

- **Short-staff profile.** Audiveris drops staves shorter than 30 interlines ([LinesRetriever](https://github.com/Audiveris/audiveris/blob/9e1e55cd2746037d059345881c53e6a6754bffbd/app/src/main/java/org/audiveris/omr/sheet/grid/LinesRetriever.java)) and clusters shorter than 0.2 of the median line length ([ClustersRetriever](https://github.com/Audiveris/audiveris/blob/9e1e55cd2746037d059345881c53e6a6754bffbd/app/src/main/java/org/audiveris/omr/sheet/grid/ClustersRetriever.java)). Twinkle's one-bar final system fell under both. The profile sets `LinesRetriever.minStaffLength=12` and `ClustersRetriever.minClusterLengthRatio=0.15`, which recovers the missing bar. The parameters were fixed on Twinkle and left all six other pages unchanged. Lowering either constant alone does not recover the bar. This is recogniser configuration, not XML repair.
- **Original PDFs beat screenshots.** Audiveris rasterises the Chopin PDF at an interline of 21 px, against 11 px in the PNG. A 2× Lanczos-enlarged PNG reached only 60.59%, so the app sends the original PDF bytes and never enlarges images automatically.
- **English OCR.** The [language guide](https://audiveris.github.io/audiveris/_pages/guides/main/languages/) needs legacy-capable tessdata; LSTM-only `tessdata_fast` does not work. The worker pins [tessdata 4.1.0 `eng.traineddata`](https://raw.githubusercontent.com/tesseract-ocr/tessdata/4767ea922bcc460e70b87b1d303ebdfed0897da8/eng.traineddata) (Apache-2.0). Without it, text and tempo marks are lost and the worker says so.
- **Tempo stays unresolved.** OCR reads Twinkle's "= 100" but not the beat-unit glyph. The [metronome procedure](https://audiveris.github.io/audiveris/_pages/guides/specific/metronome/) needs both, so no tempo is exported. `audit_export.py` flags `metronome-beat-unit-unresolved` and `meter-unresolved`; it never invents a BPM.
- **Invocation.** The [CLI](https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/) runs as `-batch -transcribe -export`. The adapter launches the bundled `java.exe` with classpath `app/*` only: `app;app/*` puts Audiveris in development-resource mode, and it then misses its classifier. Settings, home, temp and native caches are per job.

Generated photo-like stresses (Audiveris, short-staff profile, English OCR):

| Control                          | Result                                                            | Full-note F1 |
| -------------------------------- | ----------------------------------------------------------------- | -----------: |
| Twinkle as clean JPEG            | 64/64 events                                                      |         100% |
| Twinkle rotated 1.5°             | Fails at Audiveris's 10-pixel interline threshold; no export      |            0 |
| Bach with edge shadow            | 204/204 events                                                    |       91.18% |
| Chopin at low contrast           | Export refused by strict import ("tie stop without a start")      |            0 |

### Real book photos

The owner's first two photos of a printed continuation page (768×1024 and 1200×1600; the page is in the gate as `continuation-page25`, from two later photos), with book curvature, uneven light, four grand-staff systems, alternative bass cue staves and footnote music:

| Attempt                                                   | Result                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Audiveris, original input                                 | Smaller photo halts at about 6 px staff spacing; sharper photo exports only tiny fragments |
| Audiveris after contrast, illumination or 3× enlargement  | No export, or separate single-staff fragments                                             |
| oemer with dewarping (smaller photo)                      | Parses, but the bass is put on the upper staff and the rhythm and bars are wrong; no meter or beams |
| homr with the first three patches below                         | All 13 main bars and both hands on both photos (156 and 157 notes imported)               |

homr ([commit ab369ac](https://github.com/liebharc/homr/tree/ab369ac54277afab582afa4725441f7cbba76593)) runs on the CPU with three ONNX models (about 139 MB of downloads). The setup applies these source patches:

1. Detect short, far-inset single-staff examples on a piano page before layout and decoding.
2. Mask a detached, smaller five-line staff that intrudes into a grand staff's decoder margin.
3. Write accidental display glyphs that match the recognised pitch alterations (pitches unchanged).
4. Let a staff that homr finds by its lines alone replace the one partial staff it overlaps, when it contains that staff, adds at least a tenth of the page column, the partial staff spans less than 75 percent of the column, and four of the five lines agree within half a staff space (issue 129).
5. Speed only, output unchanged: load title OCR only when title detection is on, and compute each bounding box's centre and major axis once for the touch pre-check (Scan speed, below).

On the public clean piano and single-melody controls the output is byte-identical before and after the first three patches. The coverage patch changes Invention 13 p. 1 only: the other thirteen photos are byte-identical, and the library corpus routes keep their recorded figures. The remaining errors are listed in `docs/scanning.md`. The pinned homr exporter writes no beams.

### Online services

The Flat/Tutteo OMR API was the most concrete option. Its capabilities endpoint answered: PNG/PDF in, MusicXML out, 50 pages per job, credits from about $0.10 to $0.33 per page, and job content kept 30 days ([billing](https://flat.io/developers/docs/api/omr/faq/credits), [legal and privacy](https://flat.io/developers/docs/api/omr/faq/legal)). Klangio's API covers audio, not OMR ([API docs](https://api-docs.klang.io/)), and Newzik needs a sales contract. None was used: each needs a sign-up or a contract, charges per page and keeps the score on the vendor's servers, and the owner rejected all three. The rules for any online route are the ones the project's own service follows: it is explicit, it names the provider before any transfer, and it never ships a shared token in the static bundle.

## Hosted recognition

The loopback worker has to be installed and started on a Windows PC, and a phone cannot reach it at all. The owner asked for a way that does not rely on a local machine (#62), was open to a Google Cloud or Azure instance "as long as we keep the costs heavily in control (also: no AWS)", ruled out services where the reader signs up, and did not want on-device recognition for its own sake. The routes weighed:

| Route | Verdict |
| --- | --- |
| Cloud Run, request-based billing, scale to zero | **Adopted.** The worker's code and recognisers run unchanged in a Linux container; the free grant covers the expected use; the worst case is bounded by one instance and a billing kill-switch; no account for the reader. |
| Azure Container Apps, consumption plan | Equivalent free grant and scale to zero ([pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/)); not chosen because the owner already has a Google Cloud account, and Google documents the billing kill-switch pattern. The container is portable, so this stays a fallback. |
| On-device recognition in the browser (homr on ONNX Runtime Web with WebGPU) | Not now. Never measured; homr's inference code is 46 Python files on OpenCV and numpy, a faithful port is weeks of work and must match the native output; phone speed and memory are unknown (the oemer browser run took 21 minutes single-threaded, and homr reuses that UNet); the AGPL code and models cannot ship inside the MIT app ([WebGPU in major browsers](https://web.dev/blog/webgpu-supported-major-browsers)). A spike remains possible later. |
| Phone paired with the reader's PC over the local network | Still needs the scripts on a PC. Rejected. |
| A desktop installer for the worker | Helps PC readers only. Rejected. |
| Vendor OMR APIs (Flat, Klangio, Newzik) | Sign-ups, per-page credits and the score on a vendor's servers. Rejected by the owner. |
| Hugging Face Spaces, free CPU tier | Zero cost, but 2 vCPU, a 48-hour sleep with a minute-long wake-up, and a provider the owner did not name. Not chosen. |
| A 10-second keep-warm ping | Each ping bills at least 100 ms of the whole instance, about 104,000 of the 180,000 free vCPU-seconds a month ([Cloud Run pricing](https://cloud.google.com/run/pricing)), and Cloud Run may recycle the instance anyway. Replaced by one warm-up request when the reader opens the scan page. |

The numbers behind the choice (the full cost table and its sources are in `docs/scan-service.md`):

| Figure | Value |
| --- | --- |
| Free Cloud Run grant a month, per billing account | 180,000 vCPU-seconds, 360,000 GiB-seconds, 2 million requests |
| One second of the service (4 vCPU, 8 GiB) beyond the grant | $0.000116 |
| Free recognition time a month at that size | 45,000 s, about 1,300 photos of 35 s |
| Worst case, one instance busy around the clock | about $10 a day; the budget caps it at 10 a month plus what the hours of alert lag cost |
| A phone photo, in the container at 4 vCPU on the owner's PC, warm | 8.5 s (11.5 s before the changes of issue 73) |
| A corpus PDF, in the container at 4 vCPU on the owner's PC | 6.3 s (9.9 s before) |
| The same photo and PDF on the deployed service without the speed changes, warm | 35.2 s and 16.2 s |
| The deployed service's cold start, a health request with no instance left | 4.5 s |

The Linux build is a different build of the same pinned libraries: Python 3.12 from Ubuntu 24.04 installs the locked `homr-photo/requirements-cpu.txt` unchanged, the patched homr source matches `source-manifests.json`, and Audiveris 5.11.0 comes from its Ubuntu package. Its adapter's class path is `lib/app/*` only: with `lib/app` itself on it, the package's loose classes load first and Audiveris exports nothing. On a headless Linux Audiveris also needs fontconfig with one font and `GDK_SCALE` set, which its package does not declare (`research/omr/service/README.md`).

**Equivalence.** `node research/omr/acceptance.mjs --service URL` sends the same 16-piece corpus through a running container, scores it with the same scorer and compares it with `research/omr/acceptance/floor.json`, like the gate. A route within one count per error class or 0.5 F1 points of its floor is explained here and does not block a deploy; a larger gap goes to the owner first.

The container's results against the floors, with the Windows gate's numbers beside them. Every route meets its floor, and the two builds agree on every count; the MusicXML differs only in line endings, temporary paths and font sizes.

| Route | Floor (imported, full-note F1, pitch F1) | Windows | Container at 4 CPUs |
| --- | --- | --- | --- |
| homr, clean | 16, 89.4, 98.7 | 16, 89.95, 99.26 | 16, 89.95, 99.26 |
| homr, shadow | 16, 86.2, 98.7 | 16, 86.75, 99.25 | 16, 86.75, 99.25 |
| homr, low contrast | 16, 90.4, 99.0 | 16, 90.96, 99.54 | 16, 90.96, 99.54 |
| homr, skew | 15, 88.8, 96.4 | 15, 89.39, 96.95 | 15, 89.39, 96.95 |
| Audiveris, PDF | 16, 86.1, 98.2, beams 91.5 | 16, 86.65, 98.72, beams 92.01 | 16, 86.65, 98.72, beams 92.01 |
| Photos as taken (11 pages): recognised, imported, bars, staves, key, time | 11, 9, 8, 10, 9, 6 | 11, 9, 8, 10, 9, 6 | 11, 9, 8, 10, 9, 6 |
| Photos rotated (2 pages) | 2, 1, 1, 2, 2, 2 | 2, 1, 1, 2, 2, 2 | 2, 1, 1, 2, 2, 2 |

In the container a corpus page takes 13 s at the median and 28 s at most (the dense Schumann page and the Chopin waltz), well inside the 180 s limit; without the thread budget the same dense pages took 76 s to over 180 s, because ONNX Runtime sized its thread pool from the host's cores rather than the container's quota.

### Scan speed

Where a page's seconds go, measured in the container at `--cpus 4` with the thread budget of 4 on a Ryzen 7 7800X3D, on the reference photo and PDF of `docs/scan-service.md` (#73). Each option was timed A/B/A/B against a baseline, because other work on the same PC slowed pure-Python stages by 1.5 to 2 times.

A photo (homr), warm, 9.9 s:

| Stage | Seconds | Faster with more cores |
| --- | ---: | --- |
| Python start and imports (title OCR alone 0.33) | 0.69 | no |
| ONNX session creation, three models | 0.28 | no |
| Read, autocrop, resize to 1,920 px wide, contrast | 0.15 | no |
| Segmentation, 48 patches of 320×320 | 2.05 | yes (6.3 s at 1 thread) |
| Symbol bounding boxes | 0.47 | no |
| Staff detection, pure Python (the second staff search for staves without a clef 1.15) | 1.98 | no |
| Other detection: bar lines, braces, notes, filters | 0.33 | no |
| Staff dewarping, 10 staves | 0.63 | no |
| Encoder, 10 staves | 0.70 | yes (2.2 s at 1 thread) |
| Decoder, 834 steps | 1.91 | barely (2.7 s at 1 thread) |
| MusicXML, adapter and HTTP | about 0.5 | no |

A PDF page (Audiveris), 8.8 s: JVM start 0.37 s, book open and first save 0.36 s, then the recognition steps, led by BEAMS (2.45 s), HEADS (1.47 s) and CURVES (0.75 s). The JVM keeps about 2 cores busy. A second book in the same JVM takes 5.5 s instead of 8.45 s, so about 3 s of each page is class loading and JIT warm-up.

What the service runs, each with identical output on the acceptance gate: 152 recognitions of its 30 pages (the 16 corpus pieces through four homr routes and Audiveris, the 14 photos as taken and two of them rotated, and 56 perturbed copies), 28,700 staff positions among them, on Windows and in the container. Together they take the reference photo from 11.5 to 8.5 s and the PDF from 9.9 to 6.3 s in the container, the median of six requests each (`docs/scan-service.md`, Timings). How the savings split:

| Change | Saves in the container | Why it is safe |
| --- | ---: | --- |
| Audiveris without `-save` | about 0.9 s a PDF (the 2.3 s total less the cache's share) | It rewrote the `.omr` book after every step, and nothing reads it. |
| A JDK 25 ahead-of-time class cache for Audiveris ([JEP 483](https://openjdk.org/jeps/483), [JEP 514](https://openjdk.org/jeps/514)) | 1.4 s a PDF (Audiveris alone, 7.8 to 6.4 s, three runs each) | Recorded in the image from one recognition through the adapter; the build fails unless a run in strict mode maps it and gives the same MusicXML. In the service's default mode the JVM ignores a cache it cannot use. 65 MB. |
| homr loads title OCR (rapidocr) only when title detection is on | 1.2 s a photo, the two homr changes together | The adapter passes `--no-title`. |
| homr computes each bounding box's centre and major axis once for the touch pre-check | (in the 1.2 s above) | About 1.1 million calls a page; the arithmetic is upstream's, and 850,000 random box pairs give the same answers. |

Measured one at a time during the investigation, on a PC that other work was slowing, the four changes saved 2.4, 3.2, 1.2 and 1.3 s. Those figures do not add up to the totals measured here, so the table gives the A/B measurements.

Measured and not adopted:

| Option | Result |
| --- | --- |
| ONNX Runtime graph optimisation | already at `ORT_ENABLE_ALL` by default ([ORT graph optimisations](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html)) |
| Memory pattern or arena off; `ORT_PARALLEL`; staves in parallel; the decoder at 1 or 2 threads | noise or slower |
| `allow_spinning=0` ([ORT threading](https://onnxruntime.ai/docs/performance/tune-performance/threading.html)) | 12.1 s instead of 8.9 s here |
| The photo at its own width, or at 1,600 px, instead of 1,920 px | 20 to 45% faster, but the photo's bars fall below the floor (8 to 5 or 6) |
| `-XX:TieredStopAtLevel=1`; a pre-filled JavaCPP cache | 13.0 s instead of 8.8 s; noise |
| 8 vCPU on Cloud Run | neither recogniser is faster locally, and the cost per page rises 83% ([Cloud Run pricing](https://cloud.google.com/run/pricing)) |
| A GPU on Cloud Run | needs instance-based billing and at least 4 CPU and 16 GiB ([Cloud Run GPU](https://docs.cloud.google.com/run/docs/configuring/services/gpu)) |

The larger options are measured but not built ([issue 211](https://github.com/MarchalMaxim/digitus2/issues/211)): a long-lived homr process with the models loaded (about 3.5 s a photo), a second staff search that reuses the first (2 to 3.5 s), and quantised models, which change pinned models. A photo takes about 3.5 times longer on Cloud Run than in this container and a PDF page about 1.9 times; this PC cannot reproduce Cloud Run's CPUs, so that gap is unexplained.

## Browser to research worker connection

This section describes the loopback worker, the research harness's server; the app does not use it. A public HTTPS page needs the browser's permission to reach a program on loopback ([Chrome local network access](https://developer.chrome.com/blog/local-network-access)). In Chrome 155 the governing permission is `loopback-network`; a legacy `local-network-access` grant alone was denied ([Chrome guidance](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/security/local-network-access.md)). The client sends `targetAddressSpace: 'loopback'` and no credentials. The worker binds 127.0.0.1 only and checks the exact Host and an allowed Origin. That origin check cannot tell apart the project paths under `marchalmaxim.github.io`, and it is not authentication against a local program that forges headers. The worker is not designed for a public or multi-user deployment: that would need authentication, TLS and isolation.

## Licences

Nothing below is bundled into the MIT web app. The research setup scripts and the scan service's container build fetch each component and verify its pinned digest; homr, Audiveris and the text model run on the project's scan service, whose complete source is public in this repository (`research/omr/service/`).

| Component                              | Licence                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| homr code and models                   | AGPL-3.0 ([licence FAQ](https://github.com/liebharc/homr/blob/main/LICENSE_FAQ.md), which also notes training-data uncertainty) |
| Audiveris                              | [AGPL-3.0-or-later](https://github.com/Audiveris/audiveris/blob/9e1e55cd2746037d059345881c53e6a6754bffbd/LICENSE) |
| tessdata English model                 | Apache-2.0                                                                                                     |
| oemer code ([checkpoints](https://github.com/BreezeWhite/oemer/releases/tag/checkpoints) carry no separate notice) | MIT                                                                                                            |
| SMT++ models and CrispEmbed runtime    | MIT                                                                                                            |

## Open questions

Source beam recovery for photos is open (#39). The phone photos have page-level facts only (bars, staves, key, time); note-level errors on them, such as the duplicated C5 and the bass E3 in the upper hand on the book page, are not counted, and the synthetic corpus does not reproduce them.
