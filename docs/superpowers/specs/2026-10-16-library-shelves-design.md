# Library at 2,700 pieces: three levels and style shelves

- Date: 2026-10-16
- Issue: https://github.com/MarchalMaxim/digitus2/issues/10 ("Make public library easier to read")
- Status: design for implementation on branch `claude/pensive-mccarthy-lya162`.
- Supersedes, for the library page only: `2026-10-14-ui-batch-design.md` sections 4.1 (six level pills), 6.1 (PILLS_ABOVE, GENRES_ABOVE, FOLD_ABOVE thresholds) and 6.2 (the list's shapes). Everything else there (rows, one red element, motion, keyboard, drop, own-file line, About) stands.

## 1. The problem, measured

The library holds 2,702 pieces (`content/library-index.json`). Today the page shows six level pills and then every piece of the chosen level, so the page a reader lands on is one of these lists:

| Level (today)    | Pieces | Rows rendered on arrival |
| ---------------- | -----: | -----------------------: |
| 1 First steps    |     47 |                       47 |
| 2 Easy           |    212 |                      212 |
| 3 Moderate       |  1,415 |                    1,415 |
| 4 Intermediate   |    784 |                      784 |
| 5 Challenging    |     45 |                       45 |
| 6 Advanced       |    199 |                      199 |

Six pills whose names do not order themselves (is Intermediate harder than Moderate?), and a list of up to 1,415 rows with no shape: it is hard to read and slow to render. The index the page waits for is 717 KB (129 KB gzip).

## 2. The rule of 7

No logical scope on the page holds more than 7 siblings: at most 7 page units, 3 level pills, at most 6 shelves, at most 5 rows per shelf on arrival, at most 4 length pills. Long lists exist only behind one deliberate step (opening a shelf, typing a search) and then arrive in pages, never all at once.

## 3. Three levels

The issue asks for Easy, Medium and Challenging. The engine's content tools keep grading pieces 1 to 6 (`content/tools/level.py`; the manifest's `level` field is unchanged, so benchmarks and the build are untouched). The web app maps the grade to a level:

| Level       | Grades | Pieces | Gray line under the pills                       |
| ----------- | ------ | -----: | ----------------------------------------------- |
| Easy        | 1, 2   |    259 | Each hand stays close to home.                  |
| Medium      | 3      |  1,415 | The hands move, with more notes and wider reaches. |
| Challenging | 4, 5, 6 |  1,028 | Fast runs, leaps and full chords.               |

The issue text says "four levels" but names three; this design builds the three named. A fourth (splitting Challenging into Challenging and Advanced at grade 6) is one line in `levels.ts` if wanted.

One name everywhere: pill, search section heading, the score's side panel (which shows the level, not the grade). A level persisted by an older build (1 to 6) migrates to its level on load.

## 4. Shelves: styles inside a level

Inside the chosen level, pieces sit on style shelves. The eight catalog genres fold into six shelves, in this order (well-known tunes first, the beginner's usual way in):

| Shelf                   | Catalog genres     | Easy | Medium | Challenging |
| ----------------------- | ------------------ | ---: | -----: | ----------: |
| Songs                   | songs              |  145 |    643 |         256 |
| Classical               | classical          |   71 |    658 |         650 |
| Folk and carols         | folk, carols       |   29 |     57 |          28 |
| Baroque                 | baroque            |    5 |     15 |          48 |
| Romantic                | romantic           |    6 |     36 |          28 |
| Jazz, ragtime and modern | ragtime, modern   |    3 |      6 |          18 |

A shelf with no piece in the level is not shown. Each shelf has a one-line gray description (copy in section 9).

### 4.1 The arrival page (level chosen, no search, no shelf open)

Each shelf shows: its name (h2), its count (`145 pieces`, gray, tabular), and at most 5 sample rows. Under the rows one quiet text button, `All 145 songs` (`All 71 classical pieces`, ...: copy in section 9), opens the shelf. A shelf of 5 or fewer pieces shows them all and no button.

The 5 sample rows show the shelf's range, not its first five manifest entries:

1. Shuffle the shelf's pieces with a seeded PRNG; the seed is the local date (`YYYY-MM-DD`) plus the level and shelf id, so the samples change once a day and never while the reader looks. The date is injected (tests pass a fixed one).
2. Walk the shuffled order and take a piece only if its named composer is not already taken (`Unknown`, `Traditional...` and `Anonymous` never block) and its collection holds fewer than 2 picks. Curated collections (ids not starting `pdmx-`) are walked before archive ones for the first two picks, so a shelf with hand-picked pieces shows them.
3. If fewer than 5 are taken, fill from the shuffled order.
4. Show the picks in the order shortest first: the eye meets the easiest win first.

The reader's last-played piece, when it is in this level and shelf, is always the first sample (the red Continue button already points at it; the row is not red).

At most 6 shelves x 5 rows = 30 rows render on arrival (today up to 1,415).

### 4.2 A shelf opened

Opening a shelf replaces the shelves with that one shelf, in place (no new route). At the top: a quiet back text button `All styles` (left), the shelf name as h2, the count. The level pills stay; choosing another level keeps the shelf open if it exists there, else returns to the shelves. Rows group under collection headings by the existing rules (`model.ts` draftGroups: headings above 12 pieces, `Other pieces` below 3). Rows arrive in pages of 40; one text button at the end, `Show 40 more` (`Show the last 17` for the final page), appends the next page. Focus moves to the first new row. Escape or the back button returns to the shelves, focusing the shelf's `All N` button.

Shelf-open and pages-shown are visit state in the store (not persisted), so Back from a score returns to the same shelf, the same number of pages and the same scroll.

### 4.3 Length pills (the improved filter)

When the list in view (an open shelf, or search results) holds more than 40 pieces, one row of length pills appears above it: `Any length` (default), `Under 1 min`, `1 to 3 min`, `Over 3 min`. A pill whose range would hold no piece of the list is not shown; if only `Any length` would remain the row is not shown. The choice is visit state, kept across shelves, levels and searches, reset when the list it filters drops to 40 or fewer pieces (it would then be hidden and must not silently filter).

### 4.4 Search

The search field stays in the start row. Typing replaces the level pills and shelves with results across every level, in three sections (Easy, Medium, Challenging), each with its count. A section shows its first 7 rows and `All 312 in Medium` opens that section to pages of 40, like a shelf. Search also matches shelf names (`baroque`, `jazz`) as words of every piece on that shelf, so a style is one word away. Length pills apply when the results exceed 40. The empty result stays as today.

## 5. Page units, in reading order

| # | Unit                         | Present                                         |
| - | ---------------------------- | ----------------------------------------------- |
| 1 | Welcome: name, sentence, red Start/Continue button, search field | always                        |
| 2 | My scores (browser-local uploads) | when the reader has any                     |
| 3 | Level pills and the gray level line | no search typed                           |
| 4 | Length pills                 | list in view over 40 pieces                     |
| 5 | Shelves, or the open shelf, or search results | always                         |
| 6 | Own-file line                | always                                          |
| 7 | Footer: About and licences   | always                                          |

Seven at most; on a first visit the reader sees 1, 3, 5, 6, 7.

## 6. Performance

| Measure                         | Before        | Target     |
| ------------------------------- | ------------- | ---------- |
| Rows rendered on arrival        | up to 1,415   | at most 30 |
| Rows rendered in any list view  | up to 1,415   | 40 per page shown |
| `library-index.json`, gzip      | 129 KB        | at least 30 % smaller (compact columnar form with a collection table) |
| Start-up JS+CSS (bundle gate)   | under 150 KB  | unchanged gate |

The full manifest still loads on demand only.

## 7. Red, motion, keyboard

- The one red element stays the Start/Continue button. Chosen pills are ink-filled. Shelf buttons and `Show more` are quiet text buttons.
- Opening a shelf, a page, a level: the list fades in with the existing `is-fresh` 160 ms ease-out; heights never animate; reduced motion is instant.
- Level and length pills are native radio fieldsets (existing `LevelPills` technique). Shelf headings are h2, collection headings h3. The polite live region announces `Medium: 1,415 pieces`, `Songs: 643 pieces`, `Showing 80 of 643`, and search counts, 500 ms after the last change, never on arrival.

## 8. What leaves

- Six level names (First steps, Moderate, Intermediate, Advanced leave the UI).
- The level-long list on arrival.
- Unused disclosure constants for the never-built L2 shapes (`GENRES_ABOVE`, `GENRE_MIN`, `FOLD_ABOVE`, `genrePills`), replaced by shelves.

## 9. Exact copy

| Where | Copy |
| ----- | ---- |
| Songs line | Well-known tunes from children's songs to film and games. |
| Classical line | Mozart, Clementi, Czerny and the studies pianists grow up on. |
| Folk and carols line | Folk tunes, dances, carols and hymns. |
| Baroque line | Bach, Handel, Scarlatti and others, 1600 to 1750. |
| Romantic line | Schumann, Chopin, Tchaikovsky and others, 1820 to 1900. |
| Jazz, ragtime and modern line | Joplin's rags and music written since 1900. |
| Shelf button | `All {n} songs`, `All {n} classical pieces`, `All {n} folk tunes and carols`, `All {n} baroque pieces`, `All {n} romantic pieces`, `All {n} jazz, ragtime and modern pieces` |
| Back | `All styles` |
| More | `Show 40 more`, `Show the last {n}` |
| Search section more | `All {n} in {Level}` |

## 10. Follow-ups (not in this change)

- About 1,200 MuseScore-archive pieces sit under Classical by collection although their composers (Chopin, Debussy, Scriabin) belong to Romantic or Modern; classifying them by composer in `content/tools` would make the shelves more truthful.
- Many archive pieces have composer `Unknown` and raw titles (`FZW Audition Violin: ...`); a title clean-up pass in the content tools.
- Windows visual baselines (`apps/web/e2e/visual.spec.ts-snapshots/*-win32.png`) for the library states must be regenerated on the Windows host.
