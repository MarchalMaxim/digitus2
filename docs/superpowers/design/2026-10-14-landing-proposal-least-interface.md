# Landing page proposal: least interface

- Date: 2026-10-14
- Angle: least interface, Apple-style disclosure. The page is one calm list. A control appears only when the list is long enough to need it, and a hint or count appears only when it answers a question the reader has at that moment.
- Brief: the user's words in `docs/TODO.md` T6 ("divide into more easily parsable units", "pill filters (for difficulty / genre)", "some UI elements only appear when they are needed", "be brutal"), T1 for the dock, and the critique `docs/reviews/design-2026-10-14.md` (C1 to C14).
- Rules kept: black and white, exactly one red element, no other chromatic colour, motion on the 120/160/200 ms ease-out tokens, no icons that need a legend, layout from 360 px.
- Evidence: the counts come from the L1 manifest (`thingamajig-wt/library-150/content/manifest.json`: 149 pieces, 23 collections, read-only). The layout figures come from a throwaway static mock that uses the app's tokens and font stack (Inter is not bundled, so Chromium falls back to Arial). The mock was measured with Playwright at 360 x 780, 768 x 1024 and 1280 x 800, and the dock figures come from the live main build on port 5174. The mock is not committed. Figures marked "today" are the critic's.

## 1. The page in one paragraph

On a first visit the page shows the name `digitus2`, one sentence, the red `Start with Twinkle, Twinkle, Little Star` button, and then the pieces. Until the library holds more than 48 pieces, the list is grouped by level as it is today, without the legend, the file link, the Start-here card, the tags or the dashed drop zone. Once the library is longer, one row of level pills takes the place of the level headings. Exactly one pill is always selected, and only that level's pieces are shown, grouped under quiet collection headings. Further controls arrive with size. Genre pills appear inside a level only when the level holds more than 72 pieces. A search field appears only when the library holds more than 200, and before that a keyboard user can call it up by typing. A returning reader sees no sentence; the red button reads `Continue: <last piece>`, and their level is already selected. Opening your own file takes one quiet line at the end, plus a drop anywhere on the window. Everything else is either gone or lives where it is needed, such as the finger legend above the score. At 360 px the 30-piece page shrinks from 4,233 to 2,618 px, with 7 rows on the first screen instead of 2. The 149-piece library stops being a 17,477 px list: each level becomes a page of 1,623 to 3,775 px.

## 2. Information architecture

### 2.1 The units, in order

| #   | Unit                                    | What it is for                                                        | When it is on the page                                                                  |
| --- | --------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | Name `digitus2` (h1)                    | Where you are                                                         | Always                                                                                  |
| 2   | Welcome sentence (gray)                 | What this is, and the red rule                                        | Until the reader has opened a library piece once (decided at page load)                 |
| 3   | The red button                          | The one next step: start, or continue                                 | Always                                                                                  |
| 4   | Search field                            | Find a piece whose name you know                                      | Library above 200 pieces; from 49 pieces only after a keyboard user starts typing      |
| 5   | Level pills                             | Choose a difficulty                                                   | Library above 48 pieces                                                                 |
| 6   | Genre pills                             | Narrow a long level                                                   | Selected level above 72 pieces, with at least two genres of 12 or more pieces in it     |
| 7   | Hint line (gray, one line)              | What the chosen level asks of the hands, or what the chosen genre is  | Whenever level pills are shown                                                          |
| 8   | The list                                | The pieces: level headings up to 48 pieces, collection headings inside a long view | Always                                                               |
| 9   | Search count or empty line              | How many matched, or that nothing did                                 | While a search has text: the count only above 12 matches                               |
| 10  | File line `Open your own MusicXML or MIDI file` | Open a file of your own (rare)                                | Always, at the end of the list                                                          |
| 11  | Footer `About and licences`             | Licences and credits                                                  | Always, last                                                                            |
| -   | Drop target (whole window)              | Where to drop a dragged file                                          | Only while a file is dragged over the window                                            |
| -   | Notice (existing, gray)                 | Why a file was refused                                                | Only after a refusal                                                                    |

A row is one button with two lines: the title in bold with the length right-aligned on the same line, then the composer in gray. Under a collection heading whose pieces all share one composer, the composer line is dropped and the row becomes one line, 48 px tall, the way an album's track list omits the album artist.

### 2.2 What disappears from today's page

| Today (5174, 30 pieces)                                                            | Cost today at 360                         | Goes where                                                                                                   | Critique |
| ---------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------- |
| Finger legend under the welcome                                                    | 26 words, 61 px                           | Above the score until the reader first presses Play; it stays in the side panel                              | C1       |
| Link `Open your own MusicXML file` above the red button                            | 44 px, read before the primary action      | Removed; the file line at the end replaces it                                                                | C2       |
| Dashed drop zone listing five extensions                                           | 140 px                                    | Replaced by the file line plus a whole-window drop; the extensions appear only in the refusal notice         | C2       |
| Start-here card: box, `Start here`, `Twinkle… by Traditional`, `First steps · 0:29` | 206 px, Twinkle named three times         | Only the red button stays                                                                                     | C3       |
| `Level 1:` prefixes and three formats for one level                                | -                                         | One name everywhere: `First steps`, also in the score's side panel (today `2 · Easy`)                        | C5       |
| `Stretch`, `Early intermediate`, `Intermediate`                                    | -                                         | Renamed `Advanced`, `Moderate`, `Challenging` (section 4.1)                                                   | C5       |
| `editor's fingering` tags                                                          | 8 of 30 rows (33 of 149)                  | Removed from the list; the score view already says it                                                         | C9       |
| The length on its own third line on a phone                                        | 103 px per row                            | Right-aligned on the title line: 61 px per row, 48 px for one-line rows                                       | C7       |
| `Traditional (tune attributed to Lowell Mason)` and 19 other variants              | -                                         | `Traditional` in the list; the attribution stays in the score view                                            | C6       |
| The composer on every row of a one-composer collection                             | 81 of 149 rows at L1 scale                | Said once by the heading                                                                                      | C6       |
| `(Album for the Young, No. 1)` and the like under a heading that already says it   | 20 of 149 titles                          | Short list titles such as `Melody (No. 1)`                                                                    | C11      |
| The 1,120 px row width at 1280                                                     | length about 1,000 px from the title      | A 40 rem (640 px) reading measure, left-aligned with the score view                                          | C8       |
| The welcome sentence for a returning reader                                        | 46 px, 15 words                           | Shown only until the first piece is opened                                                                    | (new)    |
| Score view: practice controls standing open from 480 px up, `Clear loop` before any loop | 96 px above the music at 768 and 1280 | Folded into `Practice` in the dock at every width; loop fields only after `Loop` is ticked (section 10)    | C13      |

Net effect at 360 px (mock):

| Measure                              | Today, 30 pieces | Proposal, 30 pieces, first visit | Proposal, 30, returning | Today, 149       | Proposal, 149, first visit (level 1) | Proposal, 149, returning (level 2) |
| ------------------------------------ | ---------------: | -------------------------------: | ----------------------: | ---------------: | -----------------------------------: | ---------------------------------: |
| Words before the first row           |               70 |                               24 |                       8 |               39 |                                   36 |                                 21 |
| Red button top (px)                  |              385 |                              120 |                      66 |              264 |                                  120 |                                 66 |
| First row top (px)                   |              509 |                              231 |                     177 |              388 |                                  382 |                                327 |
| Rows fully on the first screen       |                2 |                                7 |                       8 |                3 |                                    7 |                                  8 |
| Page height (px)                     |            4,233 |                            2,618 |                   2,563 |           17,477 |                                2,114 |                              3,775 |

Words are counted the same way in every column: all text before the first row, headings included. That is why today's 30-piece page counts 70 here and 64 in the critique, which leaves out the level heading. The today-149 column is 5175, which predates the polish, so it has no legend or file link. All figures were measured at 360 x 780.

## 3. Wireframes

Notation: `[[ … ]]` is the red element; `(( … ))` is a selected pill (ink fill, paper text); `( … )` is a pill (gray-3 outline, fully rounded); `[_ … _]` is the search field (rounded like the pills); `[ … ]` is an ink-outlined button; `____` is a gray-2 hairline. The second line of a row, the lengths and the hint line are gray. The numbers on the right are top offsets in px from the mock at that width.

### 3.1 First visit, 30 pieces

360 x 780:

```
+------------------------------------------------+
| digitus2                                       |   16
| Finger numbers for piano music. Pick a piece,  |   60
| press play, and follow the red note.           |
| [[ Start with Twinkle, Twinkle, Little Star ]] |  120
|                                                |
| First steps                                    |  196
| ______________________________________________ |
|  Twinkle, Twinkle, Little Star            0:29 |  231
|  Traditional                                   |
| ______________________________________________ |
|  Mary Had a Little Lamb                   0:18 |  292
|  Traditional                                   |
| ______________________________________________ |
|  Ode to Joy (simplified)                  0:36 |
|  Ludwig van Beethoven                          |
| ______________________________________________ |
|  Frère Jacques                            0:18 |
|  Traditional                                   |
|  … 7 rows on the first screen                  |
+------------------------------------------------+  780
   Easy (10 rows), Moderate (7), Challenging (5), Advanced (3)
   Open your own MusicXML or MIDI file
   About and licences                                page 2,618
```

1280 x 800 (the content starts 80 px from the left edge, like the score view; the list is 640 px wide; from 768 px the page has 40 px of top padding instead of 16):

```
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|      digitus2                                                                               40     |
|      Finger numbers for piano music. Pick a piece, press play, and follow the red note.            |
|      [[ Start with Twinkle, Twinkle, Little Star ]]                                         121    |
|                                                                                                    |
|      First steps                                                                                   |
|      __________________________________________________                                            |
|       Twinkle, Twinkle, Little Star                 0:29                                    232    |
|       Traditional                                                                                  |
|      __________________________________________________                                            |
|       Mary Had a Little Lamb                        0:18                                           |
|       Traditional                                                                                  |
|      __________________________________________________                                            |
|       … 8 rows on the first screen                                                                 |
+----------------------------------------------------------------------------------------------------+
                                                                                    page 2,513
```

At 30 pieces there are no pills, no search and no collection headings: no level holds more than 10 pieces, and the whole list is 3.4 phone screens.

### 3.2 First visit, 150 pieces (the L1 library, 149)

360 x 780:

```
+------------------------------------------------+
| digitus2                                       |   16
| Finger numbers for piano music. Pick a piece,  |   60
| press play, and follow the red note.           |
| [[ Start with Twinkle, Twinkle, Little Star ]] |  120
|                                                |
| ((First steps))  ( Easy )  ( Moderate )        |  196
| ( Challenging )  ( Advanced )                  |  248
| Each hand stays on five keys.                  |  304
|                                                |
| Children's songs                               |  348
| ______________________________________________ |
|  Twinkle, Twinkle, Little Star            0:29 |  382
|  Mary Had a Little Lamb                   0:18 |
|  Frère Jacques                            0:18 |
|  Hot Cross Buns                           0:10 |
|  … rows with hairlines between them            |
+------------------------------------------------+
   Children's songs (15), Christmas carols and songs (2), Hymns and
   spirituals (2), Songs before 1929 (4), Classical themes, simplified (1)
   Open your own MusicXML or MIDI file / About and licences    page 2,114
```

The children's songs drop their composer line because the collection's composer is `Traditional` (section 4.3). Only Reichardt's lullaby keeps its line. Rows are 48 px, or 64 px when a long title wraps, and 7 rows fit wholly on the first screen.

1280 x 800:

```
+----------------------------------------------------------------------------------------------------+
|      digitus2                                                                               40     |
|      Finger numbers for piano music. Pick a piece, press play, and follow the red note.            |
|      [[ Start with Twinkle, Twinkle, Little Star ]]                                         121    |
|                                                                                                    |
|      ((First steps))  ( Easy )  ( Moderate )  ( Challenging )  ( Advanced )                 197    |
|      Each hand stays on five keys.                                                                 |
|                                                                                                    |
|      Children's songs                                                                              |
|      __________________________________________________                                            |
|       Twinkle, Twinkle, Little Star                 0:29                                    330    |
|       Mary Had a Little Lamb                        0:18                                           |
|       Frère Jacques                                 0:18                                           |
|       …                                                                                            |
+----------------------------------------------------------------------------------------------------+
```

Per-level page heights with 149 pieces (mock):

| Level shown        | Pieces | Collections | 360 px | 768 and 1280 px | Today, this level's section at 360 inside one page |
| ------------------ | -----: | ----------: | -----: | --------------: | -------------------------------------------------: |
| First steps        |     24 |           5 |  2,114 |           2,014 |                                              2,589 |
| Easy               |     43 |          14 |  3,775 |           3,627 |                                              4,608 |
| Moderate           |     41 |          10 |  3,335 |           3,140 |                                              4,727 |
| Challenging        |     27 |          10 |  2,716 |           2,400 |                                              3,222 |
| Advanced           |     14 |           5 |  1,623 |           1,490 |                                              1,610 |

### 3.3 With 1,000 pieces (returning reader, level `Moderate`, genre `Baroque`)

The library is synthetic: the L1 manifest repeated to 1,000 pieces, with levels 1 to 6 holding 168, 301, 205, 215, 97 and 14 pieces. Level `Moderate` then holds 205 pieces: Romantic 115, Baroque 55, Classical 30 and Songs 5. Songs falls under the 12-piece bar, so it gets no pill.

360 x 780:

```
+------------------------------------------------+
| digitus2                                       |   16
| [[ Continue: Minuet in G major ]]              |   66
|                                                |
| [_ Title or composer _________________________]|  142
| ( First steps )  ( Easy )  ((Moderate))        |  198
| ( Challenging )  ( Advanced )  ( Expert )      |
| ((Baroque))  ( Classical )  ( Romantic )       |
| Bach, Handel and their time, about 1700.       |
|                                                |
| Notebook for Anna Magdalena Bach (1725)        |
| ______________________________________________ |
|  Minuet in F major                        1:36 |  435
|  Anonymous                                     |
|  Minuet in G major                        1:55 |
|  Anonymous                                     |
|  …                                             |
+------------------------------------------------+
   Moderate + Baroque: 55 rows, 4,291 px (Moderate alone: 14,604 px)
```

1280 x 800:

```
+----------------------------------------------------------------------------------------------------+
|      digitus2                                                                               40     |
|      [[ Continue: Minuet in G major ]]                                                      90     |
|                                                                                                    |
|      [_ Title or composer ______________________________]                                   166    |
|      ( First steps )  ( Easy )  ((Moderate))  ( Challenging )  ( Advanced )  ( Expert )     222    |
|      ((Baroque))  ( Classical )  ( Romantic )                                                      |
|      Bach, Handel and their time, about 1700.                                                      |
|                                                                                                    |
|      Notebook for Anna Magdalena Bach (1725)                                                       |
|      __________________________________________________                                            |
|       Minuet in F major                             1:36                                    407    |
|       Anonymous                                                                                    |
|       …                                                                                            |
+----------------------------------------------------------------------------------------------------+
```

### 3.4 Pills active (149 pieces, returning reader, `Easy` chosen)

360 x 780:

```
+------------------------------------------------+
| digitus2                                       |   16
| [[ Continue: Minuet in G major ]]              |   66
|                                                |
| ( First steps )  ((Easy))  ( Moderate )        |  142
| ( Challenging )  ( Advanced )                  |
| Hands move to new positions now and then.      |
|                                                |
| Children's songs                               |
| ______________________________________________ |
|  Pease Porridge Hot                       0:18 |  327
| Folk songs                                     |
| ______________________________________________ |
|  Scarborough Fair                         0:30 |   one line each:
|  Greensleeves                             0:30 |   the heading
|  Yankee Doodle                            0:35 |   says Traditional
|  Auld Lang Syne                           0:49 |
|  Sakura, Sakura                           0:47 |
|  …                                             |
+------------------------------------------------+
   then Christmas carols and songs (7, composers shown), Hymns and spirituals (4),
   National anthems (3), Songs before 1929 (3), Ragtime, simplified (1),
   Classical themes, simplified (4), Notebook for Anna Magdalena Bach (1725) (3),
   Handel, Aylesford Pieces (1), Minuets, dances and rondos (1), Burgmüller (1),
   Schumann, Album for the Young, Op. 68 (4), Romantic character pieces (1)
```

1280 x 800:

```
+----------------------------------------------------------------------------------------------------+
|      digitus2                                                                               40     |
|      [[ Continue: Minuet in G major ]]                                                      90     |
|                                                                                                    |
|      ( First steps )  ((Easy))  ( Moderate )  ( Challenging )  ( Advanced )                 166    |
|      Hands move to new positions now and then.                                                     |
|                                                                                                    |
|      Children's songs                                                                              |
|      __________________________________________________                                            |
|       Pease Porridge Hot                            0:18                                    299    |
|      Folk songs                                                                                    |
|      __________________________________________________                                            |
|       Scarborough Fair                              0:30                                           |
|       Greensleeves                                  0:30                                           |
|       …                                                                                            |
+----------------------------------------------------------------------------------------------------+
```

### 3.5 Search active

At 149 pieces there is no visible field. On a keyboard device, typing a letter calls the search up, and it takes the pill row's place. On a phone, the field is only there above 200 pieces, so the 360 frame shows the 1,000-piece library.

360 x 780, 1,000 pieces, `chopin` typed:

```
+------------------------------------------------+
| digitus2                                       |   16
| [[ Continue: Minuet in G major ]]              |   66
|                                                |
| [_ chopin ______________________ Clear _]      |  142
| 24 pieces                                      |        (only above 12)
|                                                |
| Challenging                                    |        level headings
| ______________________________________________ |        return in results
|  Prelude in A major                       0:41 |
|  Frédéric Chopin                               |
|  Prelude in E minor                       1:48 |
|  Frédéric Chopin                               |
|  …                                             |
| Advanced                                       |
| ______________________________________________ |
|  Waltz in B minor (opening)               0:38 |
|  Frédéric Chopin                               |
+------------------------------------------------+
```

1280 x 800, 149 pieces, `minuet` typed (type-to-search; the field stands where the pills were):

```
+----------------------------------------------------------------------------------------------------+
|      digitus2                                                                               40     |
|      [[ Continue: Minuet in G major ]]                                                      90     |
|                                                                                                    |
|      [_ minuet ________________________________ Clear _]                                    166    |
|                                                                        (9 matches: no count)       |
|      Easy                                                                                          |
|      __________________________________________________                                            |
|       Minuet in G major                             1:36                                    277    |
|       Christian Petzold                                                                            |
|       Minuet in G minor                             1:43                                           |
|       Christian Petzold                                                                            |
|       Minuet in D minor (Aylesford Pieces)          0:48                                           |
|       George Frideric Handel                                                                       |
|       Minuet in F major                             0:48                                           |
|       Wolfgang Amadeus Mozart                                                                      |
|      Moderate                                                                                      |
|       Minuet in F major … (Anonymous)                                                              |
+----------------------------------------------------------------------------------------------------+
```

Search results always show the composer line and full titles, because rows from different collections sit together. The three colliding title pairs (Minuet in G major, Minuet in F major, Sonatina in C major 2nd movement) can then be told apart.

### 3.6 Empty result

360 x 780 (1,000 pieces):

```
+------------------------------------------------+
| digitus2                                       |
| [[ Continue: Minuet in G major ]]              |
|                                                |
| [_ chopn _______________________ Clear _]      |
|                                                |
| No title or composer matches “chopn”.          |
|                                                |
| Open your own MusicXML or MIDI file            |
| About and licences                             |
+------------------------------------------------+
```

1280 x 800: the same lines in the 640 px column, starting 80 px from the left edge. Nothing else is shown: no suggestions and no "did you mean". The `Clear` next to the query is the only way out a reader needs.

### 3.7 A dropped file

1280 x 800, while a file is dragged over the window:

```
+----------------------------------------------------------------------------------------------------+
| +------------------------------------------------------------------------------------------------+ |
| |                                                                                                | |
| |                                                                                                | |
| |                                   Drop the file to open it                                     | |
| |                                                                                                | |
| |                                                                                                | |
| +------------------------------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------------------------------+
  the inner frame is the red element (2 px, 16 px inset); the page beneath is hidden
```

On drop, a MusicXML or MIDI file opens straight into the score view, as it does today, where Play is the red element. Any other file brings the page back with the existing notice at the top:

```
+----------------------------------------------------------------------------------------------------+
|      +----------------------------------------------------------------------------------------+    |
|      | That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid   Dismiss |    |
|      | or .midi).                                                                             |    |
|      +----------------------------------------------------------------------------------------+    |
|      digitus2                                                                                      |
|      [[ Start with Twinkle, Twinkle, Little Star ]]                                                |
|      …                                                                                             |
+----------------------------------------------------------------------------------------------------+
```

360 x 780: a phone cannot drag, so the way in is the file line at the end of the list. Tapping it opens the system file picker; the chosen file opens in the score view, or the notice shows as above. The list of extensions appears only in that refusal, where it answers the question the reader has.

```
+------------------------------------------------+
|  … last rows of the level                      |
|                                                |
| Open your own MusicXML or MIDI file            |   underlined text button, 44 px
| About and licences                             |   underlined text button, 44 px
+------------------------------------------------+
```

## 4. The pill filters

### 4.1 Difficulty pills (levels)

| Level | Pill label (also the heading and the side panel's name) | Today         | Hint line under the pills (gray, 14 px, one line at 360) | Reference, never shown                |
| ----: | -------------------------------------------------------- | ------------- | -------------------------------------------------------- | ------------------------------------- |
|     1 | `First steps`                                            | First steps   | `Each hand stays on five keys.`                          | five-finger position                  |
|     2 | `Easy`                                                   | Easy          | `Hands move to new positions now and then.`              | about ABRSM grades 1 to 2             |
|     3 | `Moderate`                                               | Early intermediate | `Both hands busy, with shifts and two voices.`      | grades 2 to 4                         |
|     4 | `Challenging`                                            | Intermediate  | `Wider stretches, faster runs, more voices.`             | grades 5 to 6                         |
|     5 | `Advanced`                                               | Stretch       | `Longer pieces with leaps and fast passages.`            | grades 6 to 7                         |
|     6 | `Expert` (arrives with L2)                               | (T5: "advanced") | `Concert pieces across the whole keyboard.`           | grade 8 and above                     |

Why the renames:

- One word per pill, and every word distinct. "Early intermediate" and "Intermediate" read as the same word twice in a row of pills.
- Width. At 15 px with 16 px of padding, `Early intermediate` alone is about 165 px. With the old names, six pills need three rows at 360 px (148 px). With these names they need two rows (96 px), measured at 103, 67, 97, 113, 101 and about 80 px.
- `Stretch` did not say what it is (C5).

The order on screen carries the progression, and the hint line says what each level asks of the hands. The grade references are for teachers and the docs only.

### 4.2 Genre pills: seven genres for the 23 collections

| Genre id       | Pill label         | Hint line when pressed                        | Collections                                                                                  | Pieces at 149 (L1, L2, L3, L4, L5) |
| -------------- | ------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------- |
| `songs`        | `Songs`            | `Songs, folk tunes and famous themes.`        | children-songs, folk-songs, songs-before-1929, anthems, classical-themes, swedish-folk-dances | 46 (20, 20, 1, 0, 0)               |
| `carols-hymns` | `Carols and hymns` | `Christmas carols, hymns and spirituals.`     | christmas, hymns                                                                              | 15 (4, 11, 0, 0, 0)                |
| `baroque`      | `Baroque`          | `Bach, Handel and their time, about 1700.`    | anna-magdalena, handel-aylesford, bach-little-preludes, bach-inventions, bach-wtc             | 27 (0, 4, 11, 8, 4)                |
| `classical`    | `Classical`        | `Mozart, Beethoven and sonatinas, about 1790.` | sonatinas, dances                                                                            | 17 (0, 1, 6, 7, 3)                 |
| `romantic`     | `Romantic`         | `Schumann, Chopin and their time, 1830–1900.` | burgmuller-op100, schumann-op68, schumann-op15, tchaikovsky-op39, chopin-op28, character-pieces | 45 (0, 6, 23, 12, 4)            |
| `ragtime`      | `Ragtime`          | `Joplin and the piano rags of about 1900.`    | easy-rags, ragtime                                                                            | 4 (0, 1, 0, 0, 3)                  |
| `modern`       | `Modern`           | `Debussy, Bartók and music since 1900.`       | none yet (reserved for L2: Debussy, Bartók, CC-licensed contemporary music)                   | 0                                  |

Mapping by collection id, in manifest order: children-songs `songs`, christmas `carols-hymns`, hymns `carols-hymns`, songs-before-1929 `songs`, classical-themes `songs`, folk-songs `songs`, anthems `songs`, easy-rags `ragtime`, anna-magdalena `baroque`, handel-aylesford `baroque`, dances `classical`, burgmuller-op100 `romantic`, schumann-op68 `romantic`, character-pieces `romantic`, bach-little-preludes `baroque`, swedish-folk-dances `songs`, tchaikovsky-op39 `romantic`, sonatinas `classical`, bach-wtc `baroque`, bach-inventions `baroque`, schumann-op15 `romantic`, chopin-op28 `romantic`, ragtime `ragtime`.

The choices behind it:

- **Arrangements versus originals.** The 56 digitus2 song arrangements fall into `songs` and `carols-hymns`. Those are the genres a beginner looks for by name, Christmas above all. The 93 original piano pieces are grouped by era, the axis every piano book and exam list uses. The names `Baroque`, `Classical` and `Romantic` mean little to a beginner on their own, so each pill's hint line names two composers and a date.
- **classical-themes in Songs.** Ode to Joy, the Surprise theme and Brahms's Lullaby are famous tunes arranged like the songs, at levels 1 and 2.
- **swedish-folk-dances in Songs.** It is a folk tune. Its one piece sits at level 3, where Songs never reaches 12 pieces, so it gets no pill there.
- **One genre per collection.** A collection that mixes eras takes one genre: character-pieces holds Behr, Satie, Beethoven's Für Elise, Chopin, Schubert and Mendelssohn, and goes to `romantic`. L2 may add a per-piece `genre` override (section 11).

**Where the genre lives.** The `collections[]` entries in `content/tools/catalog.json` already carry `id`, `title` and `kind`; each gains `genre`, one of the seven ids. `content/tools/build.py` copies it onto every manifest piece next to `collection` and `collectionId`, and into the slim library index (section 9). `validate.py` fails the build when a collection has no genre or an unknown one, so every L2 collection must declare one. `apps/web/src/library/manifest.ts` gains `type Genre`, `GENRE_NAMES` and `GENRE_HINTS`, beside `LEVEL_NAMES` and a new `LEVEL_HINTS`.

**Per level at 149**, the reason no genre pill shows yet: level 1 is Songs 20 and Carols 4; level 2 is Songs 20, Carols 11, Romantic 6, Baroque 4, Ragtime 1 and Classical 1; level 3 is Romantic 23, Baroque 11, Classical 6 and Songs 1. No level passes 72 pieces, and at this size the collection headings already give each level its landmarks (14 groups in level 2). A genre pill row would mostly repeat the level, as the critique found.

### 4.3 Two content fields the rows need

- `collections[].composer` (optional) is the collection's composer, in the sense of an album artist. The build fills it when every piece in the collection shares one list composer, and the catalog sets it by hand for children-songs (`Traditional`, 15 of 16). A row whose list composer equals it drops its composer line. At 149 that is 81 rows. Notebook for Anna Magdalena Bach has no single composer, so its rows keep `Anonymous`, which corrects the common belief that these pieces are Bach's.
- `listTitle` (optional, per piece) is the title as shown under its collection heading, which removes a parenthetical the heading already says. It is authored for the 20 titles that carry `(Album for the Young, No. n)`, `(Scenes from Childhood, No. n)`, `(Aylesford Pieces)` or `(Well-Tempered Clavier, Book I, No. 1)`. Examples: `Melody (No. 1)`, `The Wild Rider (No. 8)`, `Prelude in C major (Book I, No. 1)`. The validator requires it to be unique within its collection. The Bach Little Preludes keep their parentheticals, because three of them are called "Little Prelude in C major".

### 4.4 Behaviour

| Question                              | Level pills                                                                                                                              | Genre pills                                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Single or multi select                | Single. Exactly one is always selected, like the score view's Hands control                                                              | Single, and it can be undone                                                                                                        |
| How it clears                         | It does not clear; choosing another level replaces it                                                                                    | Press the selected pill again, or Escape while focus is in the row; choosing another level also clears it                           |
| What the list shows with none chosen  | Never happens once pills exist. First visit: `First steps`; afterwards the level last chosen or last opened (persisted)                  | The whole selected level, all genres, under collection headings                                                                     |
| While a search has text               | Hidden; results come from every level; clearing the search brings back the same level                                                    | Hidden; clearing brings back the same genre                                                                                         |
| Look                                  | 44 px tall, 15 px label, 1 px gray-3 outline, fully rounded; selected: ink fill, paper label; 0.5 rem gaps, wrapping (2 rows at 360)     | 44 px tall, 14 px label, 1 px gray-2 outline (quieter than the levels); pressed: ink fill                                           |

Why there is no "nothing selected" state for levels: at 149 pieces, nothing selected means today's 17,477 px list, and at 1,000 it would be about 64,000 px. A level pill that toggled off would bring back exactly the list this design removes.

Pills are the only rounded shapes in the app. That is deliberate: a rounded chip says "this narrows the list", while the square, ink-outlined boxes are actions. The red is never on a pill.

## 5. Disclosure rules

### 5.1 Thresholds

The unit is the phone screen. At 360 x 780, a two-line row is 61 px, so a screen holds about 12 rows.

| Element                        | Appears when (exact)                                                                                                         | At 30 pieces           | At 149                              | At 1,000 (synthetic)                                     | Why this number                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Welcome sentence               | No library piece has been opened in this browser (`lastPiece` unset), decided at page load                                   | first visit only       | first visit only                    | first visit only                                         | It answers "what is this?", which only a newcomer asks                                                              |
| `Continue: <title>` label      | `lastPiece` is set and is still in the library                                                                               | returning              | returning                           | returning                                                | A returning reader's next step                                                                                      |
| Level headings (h2, visible)   | Library holds 48 pieces or fewer, or a search has text (results grouped by level)                                            | yes, 5                 | only in search results              | only in search results                                   | -                                                                                                                  |
| Level pills and hint line      | Library holds more than 48 pieces                                                                                            | no                     | yes, 5 pills                        | yes, 6 pills                                             | 48 rows is 4 phone screens; past that, one long list stops being calm                                               |
| Collection headings (h3)       | The list on screen (a level, or a level and genre) holds more than 12 pieces; never in search results                        | no (largest level 10)  | yes, every level (14 to 43 pieces)  | yes                                                      | Landmarks are needed once a list does not fit on one screen                                                         |
| Genre pills                    | The selected level holds more than 72 pieces and at least two genres hold 12 or more pieces in it; only those genres get a pill | no                   | no (largest level 43)               | yes in 5 of 6 levels (e.g. Moderate: Baroque, Classical, Romantic) | 72 rows is 6 screens even with headings; a pill under 12 pieces narrows to less than a screen          |
| Search field, always shown     | Library holds more than 200 pieces                                                                                           | no                     | no                                  | yes                                                      | Below 200, any piece is at most 5 pill presses and 5 screens away (the longest level at 149 is 3,775 px); above it, the pills alone are not enough         |
| Search field, type-to-search   | Level pills exist, the field is not already shown, and a keyboard user types a printable character (or `/`) outside a field   | no                     | yes, on keyboards                   | (field already shown)                                    | It costs nothing on screen                                                                                          |
| Search count `n pieces`        | A search has more than 12 matches                                                                                            | -                      | when it applies                     | when it applies                                          | At 12 or fewer, the matches fit on one screen and the list is the count                                            |
| Empty line                     | A search has no match                                                                                                        | -                      | yes                                 | yes                                                      | -                                                                                                                  |
| Composer line on a row         | Hidden under a collection heading whose `composer` equals the row's; otherwise shown; always shown in search results; always shown when two rows in view share a title | always | shown on 68 of 149 rows, hidden on 81 | as declared                                    | Say it once                                                                                                         |
| Drop target                    | A drag carrying files is over the window                                                                                     | -                      | -                                   | -                                                        | A drop target nobody is dragging toward is clutter                                                                  |
| Finger legend above the score  | The reader has not yet pressed Play in any piece (`legendSeen` unset)                                                        | -                      | -                                   | -                                                        | It is needed the first time a score is in front of the reader, not on the library                                   |

None of these thresholds can change while the page is open, except the search count. The library's size and each level's size are fixed by the build, so no control appears or vanishes under the reader's pointer. Elements appear only in response to the reader's own action: choosing a level, typing, or dragging a file.

### 5.2 Motion

All on the existing tokens (`--dur-fast` 120 ms, `--dur` 160 ms, `--dur-slow` 200 ms, `--ease` ease-out); all drop to 0 under `prefers-reduced-motion`.

| Change                                         | Motion                                                                                                                                                                  | What holds still                                                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A level pill is chosen                         | The pill's fill: 120 ms. The list: the old list fades out over 120 ms and the new one fades in over 160 ms, opacity only. The hint line changes its text in the same fade | The pill row, the red button and the scroll position. The list region keeps `min-height: 100vh`, so a shorter level never pulls the page up under the reader's finger                          |
| The genre row appears or goes (with a level change only) | Height 0 to 44 px and opacity over 160 ms, together with the list's fade; it leaves in 120 ms                                                                 | Everything above it. It changes only in the same frame as the list it governs, which is being replaced anyway                                                                                  |
| A genre pill is pressed or released            | Fill 120 ms; the list fades out over 120 ms and in over 160 ms; the hint line fades to the genre's text, or back to the level's                                          | Both pill rows                                                                                                                                                                                 |
| Type-to-search opens the field                 | The pill rows fade out over 120 ms; the field fades in over 160 ms at the pills' top edge; the list fades to the results                                                | The red button. The field takes the place where the reader's eye already was                                                                                                                    |
| The field (above 200) gets its first character | The pill rows collapse and fade over 160 ms; the results fade in over 160 ms                                                                                            | The field itself, which is above the pills and does not move                                                                                                                                   |
| Each further keystroke                         | None: results update in the same frame                                                                                                                                  | -                                                                                                                                                                                             |
| The search is cleared (`Clear` or Escape)      | The reverse of the opening, then the previous level and genre are restored                                                                                              | The field, until it fades in type-to-search mode                                                                                                                                               |
| A file is dragged over the window              | The drop target fades in over 120 ms, and out over 120 ms on leave or drop                                                                                              | Nothing moves; the page beneath is hidden, not reflowed                                                                                                                                        |
| `Continue` label, welcome sentence             | No motion: both are decided before the first paint (the sentence once per page load), so Back to the list never shifts the restored scroll position                     | -                                                                                                                                                                                             |

## 6. The one red element, in every state

| State                                              | The red element                                                      | Notes                                                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First visit, any size                              | `Start with Twinkle, Twinkle, Little Star`                           | The first level-1 piece in manifest order (`recommendedPiece`)                                                                                              |
| Returning reader                                   | `Continue: <title>`                                                  | The last opened library piece; a dropped file never counts, because it cannot be restored after a reload                                                    |
| A level chosen, a genre pressed                    | Unchanged                                                            | Selected pills are ink, never red                                                                                                                           |
| Search active, any number of results               | Unchanged                                                            | Kept so the field does not jump up; it remains a valid next step                                                                                            |
| Empty result                                       | Unchanged                                                            | -                                                                                                                                                           |
| List scrolled past the button                      | None on screen                                                       | Allowed. The spec gains one sentence: "A scrolled list may show no red; the red is never made sticky." Short level pages keep this brief (C12)              |
| Refusal notice showing                             | Unchanged                                                            | The notice is gray                                                                                                                                          |
| A file dragged over the window                     | The drop target's 2 px frame                                         | The page beneath is `visibility: hidden`, so the start button is not visible and `expectOneRed` counts one red root. Dropping is the next action            |
| After a drop                                       | The score view's rule: Play while stopped                            | Unchanged; T10 handles pause                                                                                                                                |
| About                                              | `Back to the library`                                                | Unchanged                                                                                                                                                   |

Hover, focus, the selected pills, the search field, the hint line, the count and the collection headings are never red.

## 7. Exact copy

### 7.1 Library

| Element                         | Text (exact)                                                                                     | Style                                     | When                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------- |
| Name (h1)                       | `digitus2`                                                                                       | 28 px, 600, ink                           | always                                   |
| Welcome sentence                | `Finger numbers for piano music. Pick a piece, press play, and follow the red note.`             | 16 px, gray-3                             | first visit                              |
| Red button, first visit         | `Start with Twinkle, Twinkle, Little Star`                                                       | 16 px, paper on red, 44 px                | first visit                              |
| Red button, returning           | `Continue: {title}` (the manifest title in full; wraps to at most two lines)                     | the same                                  | returning                                |
| Search field                    | placeholder `Title or composer`; accessible name `Search the library`                            | 16 px, gray-3 outline, rounded, 44 px     | per 5.1                                  |
| Search clear                    | `Clear` (accessible name `Clear the search`)                                                     | 14 px, underlined, inside the field's end | while the field has text                 |
| Level radiogroup name           | `Level` (screen readers only)                                                                    | -                                         | with pills                               |
| Level pills                     | `First steps`, `Easy`, `Moderate`, `Challenging`, `Advanced`, `Expert`                           | 15 px                                     | per 5.1                                  |
| Level hints                     | as in 4.1                                                                                        | 14 px, gray-3                             | with pills, while no genre is pressed    |
| Genre group name                | `Genre` (screen readers only)                                                                    | -                                         | with genre pills                         |
| Genre pills                     | `Songs`, `Carols and hymns`, `Baroque`, `Classical`, `Romantic`, `Ragtime`, `Modern`             | 14 px                                     | per 5.1                                  |
| Genre hints                     | as in 4.2                                                                                        | 14 px, gray-3                             | while a genre is pressed                 |
| Level heading (h2)              | the level's name, e.g. `First steps`                                                             | 18 px, 600                                | up to 48 pieces; in search results       |
| Level heading with pills (h2)   | the selected level's name, e.g. `Moderate`                                                       | visually hidden                           | with pills                               |
| Collection heading (h3)         | the manifest `collection`, e.g. `Burgmüller, 25 Easy and Progressive Studies, Op. 100`           | 14 px, 600, ink                           | per 5.1                                  |
| Row, first line                 | `{listTitle}` under a heading, else `{title}`; the length `m:ss` at the right                    | 16 px, 600; length 14 px gray-3, tabular  | always                                   |
| Row, second line                | the list composer: `Traditional` for any `Traditional (…)`, else the manifest `composer`         | 14 px, gray-3                             | per 5.1                                  |
| Row, accessible name            | `Open {title} by {composer}`, described by the length (unchanged)                                | -                                         | always                                   |
| Search count                    | `{n} pieces`                                                                                     | 14 px, gray-3                             | more than 12 matches                     |
| Empty result                    | `No title or composer matches “{query}”.`                                                        | 16 px, ink                                | no match                                 |
| File line                       | `Open your own MusicXML or MIDI file`                                                            | 16 px, underlined text button, 44 px      | always, after the list                   |
| Footer                          | `About and licences`                                                                             | 16 px, underlined text button, 44 px      | always, last                             |
| Drop target                     | `Drop the file to open it`                                                                       | 18 px, ink, centred in the red frame      | while dragging                           |
| Refusal notice (unchanged)      | `That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).` and `Dismiss` | existing notice                    | after a refused file                     |
| Screen-reader status (hidden)   | `{Level}: {n} pieces`; `{Level}, {Genre}: {n} pieces`; `{n} pieces match`; or the empty line      | visually hidden, `role="status"`          | 500 ms after a pill change or the last keystroke |

Words that leave the page: `Finger numbers: 1 is the thumb…` (moved to the score), `Open your own MusicXML file`, `Start here`, `by Traditional`, `First steps · 0:29`, `Level 1:` through `Level 5:`, `editor's fingering` (up to 33 times), `Drop a MusicXML or MIDI file here (.musicxml, .xml, .mxl, .mid or .midi), or choose a file`, and every `Traditional (…)` attribution in the list.

### 7.2 Outside the library, changed by this design

| Place                          | Today                                    | Proposed                                                                                                                                       |
| ------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Score side panel, level fact   | `2 · Easy`                               | `Easy`                                                                                                                                         |
| Above the score, first time    | (legend only in the side panel on phones) | `Finger numbers: 1 is the thumb and 5 the little finger, in both hands. The upper staff is the right hand, the lower staff the left.` (existing text, 14 px, ink), shown until the first Play |
| Dock, Practice (section 10)    | `Practice` summary above the score below 480 px; open controls from 480 px | `Practice` in the dock at every width                                                                                |
| Loop control                   | `Loop bars` `[from]` – `[to]` `Clear loop` | `Loop` checkbox; when ticked: `bars [n] to [n]`; the existing `The loop needs "from" before "to".` line stays                                 |

## 8. Keyboard and screen reader

**Tab order:** red button, then the search field (when shown), then the level pills (one tab stop), then the genre pills, then the rows, then the file line, then the footer.

**Level pills.** They are a radiogroup named `Level`, built from native radios inside labels, exactly like the score view's `.segmented` Hands control, so the browser supplies the behaviour:

- Tab lands on the selected pill.
- The arrow keys move between pills and select as they go, with wrapping.
- The list changes on each arrow press. The status line is debounced to 500 ms, so arrowing through four levels announces only the last one.
- A screen reader hears "Level, radio group, Moderate, selected, 3 of 5", followed by the hint, because each radio is `aria-describedby` the hint line.
- Focus never leaves the pill when the list changes.

**Genre pills.** They are toggle buttons (`aria-pressed`) in a group named `Genre`, each its own tab stop; there are at most 7, and typically 2 to 4. Enter or Space toggles a pill, and pressing another releases the first. Escape inside the group releases the pressed pill. Radios are not used because a radio cannot be unselected, and "no genre" is the default state.

**Search field.**

- It is `<input type="search">` with a visually hidden label, `Search the library`.
- `aria-controls` points at the results list, a `<section aria-label="Search results">` with an h2 for each level.
- Enter moves focus to the first result. ArrowDown does the same.
- The first Escape clears the text. A second Escape, with the field empty, leaves search mode: in type-to-search mode the field fades back into the pills, and focus returns to the selected pill.
- `Clear` is a button after the input.

**Type-to-search.** The listener runs on `document`, on the library view only. It reacts to a printable character (or `/`) typed with focus outside any input, select, textarea or contenteditable, and with no Ctrl, Meta or Alt held. Space is excluded, because it scrolls. The field opens with that character in it and the caret at the end.

**Headings.**

- The h1 is `digitus2`.
- With pills, a visually hidden h2 names the selected level, and the collections are h3. A screen reader's heading list therefore reads "Moderate, Notebook for Anna Magdalena Bach (1725), Bach, Little Preludes, …".
- Without pills, the h2 headings are the levels.
- In search results, the h2 headings are the levels and there are no h3 headings.

**Rows.** They are unchanged: one `<button>` each, with the accessible name `Open {title} by {composer}` (full title and composer, even when both are shortened on screen) and described by the length. The hover and focus rule that turns gray text ink for AA contrast on gray-1 stays.

**Status.** One visually hidden `role="status"` region in the library carries the counts that a sighted reader gets at a glance (section 7.1). There is no other live region, and nothing is announced on page load.

**Focus after Back.** The level, genre and query are restored from the store, and so is the scroll position. Focus goes to the h1, as today.

## 9. Rendering at 1,000 pieces

**What is in the DOM:**

| Part                                                                   | Nodes at 1,000 (synthetic)                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Header: h1, red button, field, 6 level pills, at most 7 genre pills, hint, status | about 40                                                           |
| The selected level's rows, or the selected level and genre's            | the largest level 301 rows (about 1,500 nodes) plus its collection headings; with a genre pressed, 30 to 140 rows |
| Other levels                                                            | not rendered: data only                                                       |
| Search results                                                          | every match, grouped by level; a one- or two-letter query matches word starts only, which keeps "b" from listing half the library |
| Each collection group                                                   | `content-visibility: auto; contain-intrinsic-size: auto 600px`, so groups off screen cost no layout or paint |

**No virtualisation.** A windowed list would break the browser's find-in-page within a level, screen-reader browse mode, the restored scroll position on Back, and the print stylesheet. One level of a few hundred plain buttons is well within what a phone renders in a frame or two.

**Data.** Today `manifest.ts` imports the whole manifest into the library's entry chunk. At 149 pieces that is 174,240 bytes minified and 26,063 bytes gzip (measured). At 1,000 pieces it would be about 1.2 MB, or roughly 150 to 175 KB gzip, which alone exceeds the 150 KB initial-load gate (today's entry is 93.1 KB). The build should therefore emit a slim library index, which the entry imports:

- Fields: slug, title, listTitle, list composer, level, collectionId, genre and duration, plus the collections table (id, title, genre, composer).
- Size: 19,078 bytes and 4,793 bytes gzip at 149, measured on the first six fields. At 1,000 pieces that is about 130 KB raw and 32 KB gzip.
- The rest of each record (source, licence, notes, files) moves to a lazily loaded module that the score view and the about page import. Both are already lazy in part.

**Search index.** It is built once, when the module loads. Each piece gets one normalised string: NFD, combining marks removed, lower case, containing title, listTitle, list composer, collection and catalogue. Matching rules:

- Every query word must match the start of some word in the string (AND). So `fur eli` finds Für Elise and `op 28` finds the Chopin preludes, but `chopn` finds nothing.
- At 1,000 pieces a keystroke filters in well under a millisecond. Rendering is the cost, which `content-visibility` bounds.

**Performance gates.** These are written first, as e2e tests against a generated 1,000-piece fixture, under 4x CPU throttling:

- A level change paints within 100 ms.
- A search keystroke paints within 50 ms.
- The library's largest contentful paint stays under the existing 2 s gate.
- `check-bundle-size.mjs` stays at 150 KB with the 1,000-piece index in the entry.

**State.** The selected level is persisted with the settings. The genre and the query live in the store only for the visit, so Back from a score returns to the same list at the same scroll position.

## 10. T1: the dock and Practice at 768 and 1280 px

### 10.1 What changes

The phone's `Practice` disclosure becomes the rule at every width, and it moves into the dock, so it is reachable wherever the cursor has scrolled the score. It stays the same single control: a button with `aria-expanded` controlling a region, which replaces the `<details>` because the panel must open above the dock's buttons. The 96 px block of open controls above the music at 480 px and up goes away. Inside the panel, the loop fields appear only after `Loop` is ticked, and `Clear loop` goes away: unticking `Loop` clears the loop.

| Width | Dock today (closed)                                   | Dock proposed (closed)                                                                       | Height today, proposed (px) | First system top today, proposed (px) | Keyboard width                    |
| ----- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------: | ------------------------------------: | --------------------------------- |
| 360   | Play, Rewind in a row above the keys; Practice is a line above the score | Play, Rewind, `Practice` in one row above the keys (96 + 83 + about 96 px + gaps = 291 of 328) |               173, 173 |                            278, about 218 | unchanged (328)              |
| 768   | Play, Rewind stacked left of the keys; controls open above the score | Play, Rewind, `Practice` stacked left of the keys (3 x 44 + 2 x 8 = 148 px)             |                121, about 173 |                        310, about 198 | unchanged (624)                   |
| 1280  | the same, in the 832 px score column, side panel right | the same                                                                                    |                133, about 173 |                        309, about 197 | unchanged (720)                   |

At 768 and 1280 the dock grows by 52 and 40 px. In exchange, the first system moves up by 112 px (the 96 px block and its 16 px gap), so the first screen shows about 60 px (768) and 72 px (1280) more music above the dock, and none of the 9 controls stand in front of it. The keyboard keeps its width and height at every size. Moving Practice changes nothing about the keys, so the T11 measurements in the critique still hold.

### 10.2 Wireframes

768 x 1024, closed:

```
+----------------------------------------------------------------------------------+
| [ Back to the library ]                                                          |
| Minuet in G major                                                                |
| Christian Petzold                                                                |
| Engraving by Allen Garvin for the Mutopia Project, public domain                 |
|                                                                                  |
|  ===== first system ========================================================     |  ~198
|  ===== second system =======================================================     |
|  …                                                                               |
|----------------------------------------------------------------------------------|  dock, sticky
| [[  Play  ]]  | | | | | | | | | | | | | | | | | | | | | | | | | | | | | | | |    |
| [ Rewind  ]   |                 keyboard, 624 x 94, unchanged               |    |
|  > Practice   | | | | | | | | | | | | | | | | | | | | | | | | | | | | | | | |    |
+----------------------------------------------------------------------------------+
```

768 x 1024, open (the dock grows upward over the score, and the cursor's scroll keeps the current system above it through `--dock-h`):

```
|----------------------------------------------------------------------------------|
| Tempo ----o---- 100 % · ♩ = 120   ((Both hands)) ( Right hand ) ( Left hand )    |
| [ ] Metronome     [x] Count-in     [ ] Loop                                      |
|                                                                                  |
| [[  Play  ]]  | keyboard                                                 |       |
| [ Rewind  ]   |                                                          |       |
|  v Practice   |                                                          |       |
+----------------------------------------------------------------------------------+
  with Loop ticked:  [x] Loop  bars [ 5 ] to [ 8 ]
```

1280 x 800: the same dock in the 832 px score column, with the side panel (legend, level, key, hand size, export) on the right as today. When open, the controls take two rows (tempo, hands and metronome; then count-in and loop), 96 px plus a 12 px gap, so the open dock is about 281 px tall.

360 x 780, closed and open:

```
|------------------------------------------------|
| [[ Play ]] [ Rewind ]  > Practice              |
| keyboard (328 x 92, scrolls sideways)          |
+------------------------------------------------+

|------------------------------------------------|
| Tempo ----o----  100 % · ♩ = 120               |
| ((Both hands)) ( Right hand ) ( Left hand )    |
| [ ] Metronome   [x] Count-in                   |
| [ ] Loop                                       |
| [[ Play ]] [ Rewind ]  v Practice              |
| keyboard                                       |
+------------------------------------------------+   open dock about 385 px of 780
```

### 10.3 Behaviour

- **Opening and closing.** The panel opens on the Practice button. It closes on the same button, or on Escape while focus is inside the panel. It never closes by itself: a reader may slow the tempo while listening.
- **Animation.** The height goes from 0 to auto over 160 ms using `grid-template-rows: 0fr` to `1fr`, and closes in 120 ms. The score never moves; the dock is sticky and grows upward.
- **What is remembered.** Whether the panel is open is remembered for the visit (store, not persisted). Every new visit starts closed. The settings inside it persist as they do today.
- **Space.** Space keeps playing and pausing, except in the panel's own fields and buttons (the existing `TAKES_SPACE` rule in `Transport.tsx`).
- **Loop defaults.** Ticking `Loop` fills the first bar field with the bar under the cursor (bar 1 at the start) and the second with three bars later, clamped to the last bar, and the loop starts at once. Unticking clears it. The values come back if `Loop` is ticked again during the visit.
- **Red.** Nothing in the panel is ever red. Play, Pause and the cursor keep their rules, and T10 adds the resume point.

### 10.4 The keyboard's hand letters (T11, the request that started this batch)

The dock design leaves the keyboard alone, so T11 can be implemented as its own task without conflict. In the same least-interface spirit, this proposal supports the critique's rule (section 8.3 there), which matches the user's words "only when the L and R notes are close to each other":

- Letters appear on both hands' keys for a bar in which the hands come within 7 semitones (a fifth) or cross.
- No letters appear in other bars.
- On a phone, a hand whose partner is scrolled out of the keyboard's view keeps its letter.

With this rule, the minuet shows letters in 9 of its 32 bars and Amazing Grace in none, against 135 of 135 onset groups and 32 of 32 today.

## 11. Risks, and what is deliberately left out

### 11.1 Risks

| Risk                                                                                                                                                                       | Mitigation                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| With one level always selected, a newcomer at 149 pieces sees 24 pieces and might not realise 125 more exist                                                                | The pill row is on the first screen at every width (196 px at 360). The daily UI review should ask a newcomer-style question: "find a piece by Bach".                                                              |
| Between 49 and 200 pieces a phone has no search; a known title needs its level guessed (at most 5 presses)                                                                 | The 200 is one constant. If the review finds readers hunting, lower it to 100, where the critique put it. Keyboard users have type-to-search from 49.                                                             |
| Type-to-search is invisible                                                                                                                                                | It is a bonus, never the only way: pills plus headings reach every piece                                                                                                                                         |
| Rounded pills are the only rounded shapes in a square system                                                                                                               | Deliberate (filters against actions). If the review finds them foreign, the fallback is `.segmented`-style square chips with gaps; the behaviour does not change.                                                  |
| The renames (`Moderate`, `Challenging`, `Advanced`, `Expert`) touch the side panel, the about page, tests and visual baselines, and T5's plan calls level 6 "advanced"      | One `LEVEL_NAMES` table; T5's level 6 takes `Expert`; baselines are regenerated in the same task                                                                                                                 |
| Genre is per collection, so mixed collections are approximate (Für Elise, 1810, and Satie's Gymnopédie, 1888, sit in Romantic)                                              | No genre pill shows at 149 at all; for L2, allow an optional per-piece `genre` override in the catalog, validated against the seven ids                                                                          |
| `Classical` as an era name may read as "all of it is classical"                                                                                                            | The hint line names Mozart, Beethoven and sonatinas, about 1790, the moment the pill is pressed                                                                                                                  |
| The welcome sentence is gone for anyone using a browser where a piece was opened before (a shared family computer)                                                          | The red button still teaches by its colour; the sentence is one constant away from "always"                                                                                                                     |
| The open Practice panel takes about half a phone screen (385 of 780 px with the dock)                                                                                     | It is the reader's choice and closes with one press; the closed state costs nothing at 360                                                                                                                       |
| A closed Practice does not say that a setting differs from the default (70 %, right hand only)                                                                             | The score dims the muted hand, and the tempo is audible. If the review finds readers confused, the button can gain one gray line (left out for now).                                                             |
| Collection headings over one-piece collections (4 at 149) look like structure for nothing                                                                                  | Kept for one consistent rule. L2's ingestion should fold one-piece sets into broader collections where honest.                                                                                                   |
| The drag overlay hides the page for the length of a drag                                                                                                                   | 120 ms fade in and out; a drop elsewhere or Escape ends it                                                                                                                                                       |
| The slim index splits one source of truth in two                                                                                                                           | Both are generated by `build.py` from the catalog; a test asserts that every index entry matches its manifest record                                                                                             |

### 11.2 Deliberately left out

- Composer pills, era pills beyond the seven genres, sort controls (by length or title), and an "editor's fingering" filter.
- Counts on pills or headings, and a "Showing 43 of 149" summary.
- A "Start here" heading, a recommended-next-piece row, favourites, recents, progress tracking, and a separate "Continue" list. The single red `Continue` is the only memory shown.
- A sticky header or sticky red button.
- "Show more" buttons, infinite scroll and virtualisation.
- Icons (a search magnifier, ×, chevrons other than the disclosure triangle), thumbnails and tags.
- Genre pills at 30 and 149 pieces: the data would repeat the level.
- Grade numbers on the pills.
- A level explanation page: the one-line hint is the explanation.
- The extension list anywhere except the refusal notice.
- A drop-zone box, and drag-and-drop wording on touch screens.
- Automatic closing of the Practice panel.

## 12. Implementation estimate

Twelve tasks, one agent each, test-first. All of them start after the L1 merge, because they need the 149-piece manifest.

| #   | Task                                                                                                                                                                                                                   | Main files                                                                                 | Tests first                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 1   | Content: `genre` and optional `composer` on the 23 collections; `listTitle` for the 20 titles; list-form composer; validation                                                                                          | `content/tools/catalog.json`, `catalog.d/*`, `build.py`, `validate.py`                     | pytest: every collection has one of 7 genres; listTitle unique per collection; build copies the fields |
| 2   | Slim library index in the entry; full records lazy; 1,000-piece fixture generator; bundle gate with the fixture                                                                                                        | `build.py`, `manifest.ts`, `check-bundle-size.mjs`, about page                             | vitest on the index shape; bundle gate at 1,000                                                     |
| 3   | Store: `lastPiece`, `libraryLevel` (persisted), genre and query (visit), `legendSeen`; settings migration                                                                                                              | `store.ts`                                                                                 | store tests, including a missing slug falling back                                                  |
| 4   | Library top: remove the legend, link and card; red `Start` or `Continue`; sentence rule; one level name everywhere (renames, side panel `Easy`)                                                                        | `LibraryView.tsx`, `manifest.ts`, `SidePanel.tsx`                                          | component tests: one `.is-red` in both labels; no sentence when returning                            |
| 5   | Rows and grouping: two-line rows, length on the title line, composer rule, collision rule, no tags, 40 rem measure, collection headings above 12                                                                       | `LibraryView.tsx` (split into `PieceList.tsx`), `base.css`                                 | unit tests for the composer and collision rules; heading threshold                                  |
| 6   | Level pills: radiogroup above 48, hint line, list swap motion and `min-height`, status line, preselection                                                                                                              | `LevelPills.tsx`, `LibraryView.tsx`, `base.css`                                            | thresholds at 30, 49 and 149; arrow keys; status debounce                                            |
| 7   | Genre pills: above 72 with two genres of 12 or more, toggle semantics, genre hints                                                                                                                                     | `GenrePills.tsx`                                                                           | thresholds on the 1,000 fixture; Escape and re-press clear                                          |
| 8   | Search: field above 200, type-to-search above 48, matcher, grouped results, count above 12, empty line, Clear, Enter, ArrowDown, Escape; performance gates                                                              | `search.ts`, `SearchField.tsx`                                                             | matcher unit tests (`fur eli`, `op 28`, `chopn`); e2e 50 ms keystroke and 100 ms level-change gates   |
| 9   | Own files: end-of-list file line, whole-window drop with the red-framed target, refusal unchanged; remove the drop-zone box                                                                                            | `FileOpen.tsx` (replaces `DropZone.tsx`), `App.tsx`                                        | drag events show and hide the target; one red while dragging; refusal notice                         |
| 10  | Finger legend above the score until the first Play; side panel unchanged                                                                                                                                               | `ScoreView.tsx`, `FingerLegend.tsx`                                                        | shown before, gone after the first Play, across pieces                                              |
| 11  | T1: Practice in the dock at every width (button and region), loop behind `Loop`, no `Clear loop`, Escape closes                                                                                                        | `Transport.tsx`, `ScoreView.tsx`, `base.css`                                               | the dock has no controls above the score at 768 and 1280; the loop is cleared on untick; Space rules  |
| 12  | Verification: the state walk and visual baselines for the new states (library by level, search, empty, drag-over at 360 and 1280, open Practice), `expectOneRed` everywhere, the spec's red sentence, `docs/app.md` | `e2e/*`, spec section 9, `docs/app.md`                                                     | the e2e and visual specs themselves                                                                 |

T11 (hand letters) is a separate task in this batch and is not counted here.
