# Landing page proposal: the library at scale

- Date: 2026-10-14
- Status: proposal, one of three for the UI batch (T6, with T1 in section 10). Nothing here is built.
- Angle: design for the library the project is heading to (L2: a thousand or more pieces, levels 1 to 6, dozens of collections, composers with complete catalogues) while staying brutally simple at 150 and at 30 pieces.
- Brief: the user's words in `docs/TODO.md` T6 ("the landing page is a bit cluttered", "pill filters (for difficulty / genre)", "keep the brutal simplicity", "some UI elements only appear when they are needed"), the minimalism and disclosure rules of spec section 9 and `CLAUDE.md`, and the critique `docs/reviews/design-2026-10-14.md` (its items C1 to C14 are cited by number).
- Method: a throwaway prototype of this design (static HTML and a few dozen lines of script, kept outside the repository) rendered the real L1 manifest (149 pieces, `thingamajig-wt/library-150/content/manifest.json`) and a synthetic L2 library: those 149 plus 851 invented pieces in 44 invented collections, 1,000 pieces in all, 6 levels of 96 to 218 pieces, 67 collections, 12 to 28 collections per level. Playwright's Chromium measured it at 360 x 780, 768 x 1024 and 1280 x 800 (page height, first row, rows in view, elements in the DOM, render time, horizontal overflow). Today's numbers come from the critique and from the same script run against `http://localhost:5174` (main, 30 pieces) and `http://localhost:5175` (the L1 branch, 149 pieces). The prototype uses the app's font stack and sizes, so its heights are close to, not equal to, what the React build will measure.

## 1. The page in one paragraph

The page is a short welcome and one list that is never longer than one level. The welcome is the name, the one sentence ("Pick a piece, press play, and follow the red note") and the one red button: "Start with Twinkle, Twinkle, Little Star" on a first visit, "Continue with Minuet in G major" for a reader who has opened a piece before. Below it sits the library, and the library changes shape with its own size instead of growing longer: up to 60 pieces it is every level on one page, as today minus the clutter; past 60 a search field and one row of level pills appear, one level is always chosen (the reader's own, or First steps), and only that level is on the page; inside a level of more than 12 pieces the rows gather under their collections; past 30 pieces a second, quieter row of genre pills appears; past 60 pieces in view the collections close to one line each and open in place. Rows are one line (title and length) when their heading already names the composer, two lines otherwise. The finger legend, the file link, the Start-here card, the drop zone and the editor's-fingering tags leave the page; opening your own file becomes one quiet line at the end and a drop anywhere on the window. Measured on the prototype, the page at 360 px is 2,837 px tall with 30 pieces (today 4,233), 2,050 to 3,547 px with 149 (today 17,477), and 1,236 to 2,322 px with 1,000 pieces, and it never holds more than about 1,000 elements.

## 2. Information architecture

### 2.1 The units, in reading order

| #   | Unit                       | What it is for                                                                                                       | Present                                                                                    |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | Welcome                    | The name `digitus2`, the one sentence, and the red button: what this is and the one first step.                      | always                                                                                     |
| 2   | Search field               | Find a piece or composer you already have in mind, across every level.                                               | when the library holds more than 60 pieces                                                 |
| 3   | Level pills and level line | Choose how hard; one gray line says what the chosen level asks of the hands.                                         | with the search field; hidden while a search is typed                                      |
| 4   | Genre pills                | Narrow a long level by style.                                                                                        | when the chosen level holds more than 30 pieces in at least two genres of 3 or more pieces |
| 5   | The list                   | The pieces of the chosen level (or of the search, or, up to 60 pieces, of every level), grouped as section 2.2 says. | always                                                                                     |
| 6   | Footer                     | `Open a MusicXML or MIDI file` and `About and licences`, two quiet text buttons.                                     | always                                                                                     |
| –   | Drop frame                 | Says where a dragged file goes.                                                                                      | only while a file is dragged over the window                                               |

At 30 pieces the page is units 1, 5 and 6: three units, 32 words before the first row (today 8 units and 64 words). At 149 and 1,000 pieces it is units 1 to 6, with 4 only on long levels.

### 2.2 The list's three shapes

One rule set renders whatever list is in view: every level (up to 60 pieces), the chosen level with its genre, or the results of a search grouped by level.

| Shape   | When                                             | What it looks like                                                                                                                                                                                                                                                        |
| ------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flat    | a section holds 12 pieces or fewer               | Rows in manifest order, full titles, composer line on every row that has a named composer.                                                                                                                                                                                |
| Grouped | a section holds more than 12 pieces              | A heading per collection with 2 or more pieces in the section, in collection display order, its rows under it; collections with one piece in the section gather in a last group, `Other pieces`. Under its own heading a title drops what the heading already says (2.3). |
| Folded  | the whole list in view holds more than 60 pieces | Every collection of 2 or more pieces is one closed line (name and `15 pieces`) that opens in place; `Other pieces` stays open. On arrival the collection holding the reader's last piece is open.                                                                         |

A section is a level section (up to 60 pieces), the chosen level (past 60), or one level of a search's results. At 30 pieces every level is flat (3 to 10 rows). At 149 every level is grouped (14 to 43 rows) and nothing folds. At 1,000 every level folds until a genre narrows it to 60 or fewer.

### 2.3 Rows

| Part    | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line 1  | Title (16 px, 600) at the left, length (`m:ss`, gray, tabular) at the right of the first line, also when the title wraps. No tags.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Line 2  | The composer (14 px, gray), shown only when it says something the heading does not: hidden when every row of the group has the same composer, and never shown for `Traditional` or `Anonymous`. The list shows the composer up to the first ` (` (`Traditional (tune attributed to Lowell Mason)` becomes nothing, `Lowell Mason (tune Antioch)` becomes `Lowell Mason`); the score view keeps the full string.                                                                                                                                                                                            |
| Heading | When the group's shared composer is hidden from the rows and the collection name does not contain the composer's last name, one gray line under the heading names the composer (`Notebook for Anna Magdalena Bach (1725)` at Early intermediate, all `Anonymous`, gets none; a future one-composer set without the name in its title gets one).                                                                                                                                                                                                                                                            |
| Title   | Under its own collection heading, a title that ends in a parenthesis whose first part appears, as whole words, in the collection's name loses that part: `Melody (Album for the Young, No. 1)` under `Schumann, Album for the Young, Op. 68` reads `Melody (No. 1)`; under a `Bach, The Well-Tempered Clavier` heading, `Prelude in C major (Well-Tempered Clavier, Book I, No. 1)` would read `Prelude in C major (Book I, No. 1)`. `Progrès (Progress)` keeps its parenthesis (`Progress` is not a word of `Progressive`). Nowhere else: flat lists, `Other pieces` and search results show full titles. |
| Target  | The whole row is one button, as today; its accessible name keeps the full title and composer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Effect at 149 pieces, over the five level views: 92 of the 149 rows are one line: the 42 by `Traditional` or `Anonymous`, 17 of Burgmüller's 18, 14 of Schumann's 15, 14 of J. S. Bach's 15, and the Chopin and Tchaikovsky sets (the 18th Burgmüller, the 15th Schumann and the Well-Tempered Clavier prelude are alone in their collection at their level, so they sit in `Other pieces` with their composer). 17 titles shorten under their heading: 16 lose `Album for the Young` or `Scenes from Childhood` and keep their number, and `Canon in D (simplified)` reads `Canon in D` under `Classical themes, simplified`. The three colliding title pairs stay apart: two pairs sit in different levels, and the two `Sonatina in C major, 2nd movement (Andante)` rows share a group of several composers, so they keep `Muzio Clementi` and `Friedrich Kuhlau`.

### 2.4 What leaves today's page

| Today                                                                | Critique | Where it goes                                                                                                                                               |
| -------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finger legend (26 words)                                             | C1       | Above the score the first time a piece is opened, folded after; it stays in the score's side panel. A separate task in the score view (section 12, task 8). |
| Link `Open your own MusicXML file` above the red button              | C2       | Gone. The footer line opens the chooser.                                                                                                                    |
| Drop zone (dashed box, five extensions)                              | C2       | Gone. The whole window takes a dropped file; a frame shows only during a drag.                                                                              |
| Start-here card: box, `Start here`, title line, `First steps · 0:29` | C3       | Gone. The red button stays, directly under the sentence.                                                                                                    |
| `Level 1: First steps` headings                                      | C5       | One name per level everywhere: `First steps` (heading, pill, side panel); the number never shows.                                                           |
| `Stretch`                                                            | C5       | Renamed `Late intermediate`.                                                                                                                                |
| Composer line on every row                                           | C6, C7   | Shown only when it says something (2.3); one-composer collections have one-line rows.                                                                       |
| Length on its own line below 480 px                                  | C7       | On the title's first line at every width.                                                                                                                   |
| 1,120 px rows at 1280                                                | C8       | A 46rem (736 px) column, left-aligned with the score view's edge.                                                                                           |
| `editor's fingering` tags (33 at 149)                                | C9       | Gone from the list; the score view says it where the toggle is.                                                                                             |
| One flat list of every piece                                         | C10      | One level at a time past 60 pieces, collections inside it, folding past 60 in view.                                                                         |
| Practice controls standing open from 480 px                          | C13      | The `Practice` disclosure in the dock at every width (section 10).                                                                                          |

### 2.5 Today and the proposal, measured

| View                                                              | Rows in the DOM | 360 px: page (screens) | 360 px: first row | 360 px: rows fully on the first screen | 1280 px: page | Elements |
| ----------------------------------------------------------------- | --------------: | ---------------------: | ----------------: | -------------------------------------: | ------------: | -------: |
| Today, 30 pieces (5174)                                           |              30 |            4,233 (5.4) |               509 |                                      2 |         3,166 |      204 |
| Proposal, 30 pieces, first visit                                  |              30 |            2,837 (3.6) |               259 |                                      7 |         2,544 |      182 |
| Today, 149 pieces (5175, before the polish)                       |             149 |          17,477 (22.4) |               388 |                                      3 |        12,035 |      821 |
| Proposal, 149, first visit (First steps, 24)                      |              24 |            2,050 (2.6) |               386 |                                      8 |         1,913 |      147 |
| Proposal, 149, Easy (the largest level, 43)                       |              43 |            3,547 (4.5) |               456 |                                      5 |         3,296 |      253 |
| Proposal, 149, Easy and Baroque                                   |               4 |              849 (1.1) |               428 |                                      4 |           800 |       52 |
| Proposal, 149, search `bach` (26)                                 |              26 |            2,370 (3.0) |               341 |                                      7 |         2,141 |      154 |
| Proposal, 1,000, first visit (First steps, 96 in 11 collections)  |              96 |            1,236 (1.6) |               406 |                                     22 |         1,146 |      488 |
| Proposal, 1,000, Advanced (218 in 22 collections)                 |             218 |            1,787 (2.3) |               427 |                                     22 |         1,559 |    1,017 |
| Proposal, 1,000, Early intermediate, two collections opened (153) |             153 |            3,327 (4.3) |               427 |                                     12 |         2,914 |      754 |
| Proposal, 1,000, Early intermediate and Baroque (21)              |              21 |            1,845 (2.4) |               456 |                                      7 |         1,687 |      135 |
| Proposal, 1,000, search `chopin` (117 in 13 collections)          |             117 |            1,440 (1.8) |               328 |                                     27 |         1,280 |      564 |

"Rows fully on the first screen" counts piece rows and closed collection lines. No view has horizontal page scroll at 360, 768 or 1280.

## 3. Wireframes

Notation: `[[ … ]]` the one red element; `[ … ]` a field or square button; `_…_` a quiet text button; `( … )` a pill, `(# … #)` the chosen level (ink fill), `(= … =)` the chosen genre (ink outline); `»` the pill row continues sideways; `▸` a closed collection, `▾` an open one; `----` the rule under a row. Heights are the prototype's. At 1280 the column is 46rem at the page's left edge (x = 80 px, the same as the score view's title); the right side stays empty.

### 3.1 First visit, 30 pieces

360 px, first visit, 30 pieces (2,837 px tall, 3.6 screens; first row at 259 px):

```text
+------------------------------------------------+
| digitus2                                       |
| Finger numbers for piano music. Pick a         |
| piece, press play, and follow the red note.    |
|                                                |
| [[ Start with Twinkle, Twinkle, Little Star ]] |
|                                                |
| First steps                                    |
| Each hand stays in one five-finger position.   |
| ---------------------------------------------- |
| Twinkle, Twinkle, Little Star             0:29 |
| ---------------------------------------------- |
| Mary Had a Little Lamb                    0:18 |
| ---------------------------------------------- |
| Frère Jacques                             0:18 |
| ---------------------------------------------- |
| Jingle Bells (chorus)                     0:32 |
| James Lord Pierpont                            |
| ---------------------------------------------- |
| Ode to Joy (simplified)                   0:36 |
| Ludwig van Beethoven                           |
| ---------------------------------------------- |
|                                                |
| Easy                                           |
| Both hands together, with small moves out of   |
| position.                                      |
| ---------------------------------------------- |
| Happy Birthday to You                     0:15 |
| Mildred J. Hill and Patty Hill                 |
| ---------------------------------------------- |
| ...  (Easy 10, Early intermediate 7,           |
|       Intermediate 5, Late intermediate 3)     |
|                                                |
| _Open a MusicXML or MIDI file_                 |
| _About and licences_                           |
+------------------------------------------------+
```

1280 px, first visit, 30 pieces (2,544 px tall; first row at 236 px; the column is 46rem, left-aligned):

```text
+--------------------------------------------------------------------------------------------------------+
|      digitus2                                                                                          |
|      Finger numbers for piano music. Pick a piece, press play, and follow the red note.                |
|                                                                                                        |
|      [[ Start with Twinkle, Twinkle, Little Star ]]                                                    |
|                                                                                                        |
|      First steps                                                                                       |
|      Each hand stays in one five-finger position.                                                      |
|      ------------------------------------------------------------------------------------------        |
|      Twinkle, Twinkle, Little Star                                                         0:29        |
|      ------------------------------------------------------------------------------------------        |
|      Mary Had a Little Lamb                                                                0:18        |
|      ------------------------------------------------------------------------------------------        |
|      Frère Jacques                                                                         0:18        |
|      ------------------------------------------------------------------------------------------        |
|      Jingle Bells (chorus)                                                                 0:32        |
|      James Lord Pierpont                                                                               |
|      ------------------------------------------------------------------------------------------        |
|      Ode to Joy (simplified)                                                               0:36        |
|      Ludwig van Beethoven                                                                              |
|      ------------------------------------------------------------------------------------------        |
|                                                                                                        |
|      Easy                                                                                              |
|      Both hands together, with small moves out of position.                                            |
|      ------------------------------------------------------------------------------------------        |
|      ...                                                                                               |
|                                                                                                        |
|      _Open a MusicXML or MIDI file_     _About and licences_                                           |
+--------------------------------------------------------------------------------------------------------+
```

### 3.2 First visit, 150 pieces

360 px, first visit, 149 pieces (2,050 px tall, 2.6 screens; first row at 386 px):

```text
+------------------------------------------------+
| digitus2                                       |
| Finger numbers for piano music. Pick a         |
| piece, press play, and follow the red note.    |
|                                                |
| [[ Start with Twinkle, Twinkle, Little Star ]] |
|                                                |
| [ Search pieces and composers               ]  |
| (# First steps #) ( Easy ) ( Early interm»     |
| Each hand stays in one five-finger position.   |
|                                                |
| Children's songs                               |
| ---------------------------------------------- |
| Twinkle, Twinkle, Little Star             0:29 |
| ---------------------------------------------- |
| Mary Had a Little Lamb                    0:18 |
| ---------------------------------------------- |
| Frère Jacques                             0:18 |
| ---------------------------------------------- |
| ...  (15 rows, one line each; only Schlaf,     |
|       Kindlein, schlaf adds a composer line)   |
|                                                |
| Christmas carols and songs                     |
| ---------------------------------------------- |
| Jingle Bells (chorus)                     0:32 |
| James Lord Pierpont                            |
| ---------------------------------------------- |
| Jolly Old Saint Nicholas                  0:20 |
| James R. Murray                                |
| ---------------------------------------------- |
|                                                |
| Hymns and spirituals                 (2 rows)  |
| Songs before 1929                    (4 rows)  |
| Other pieces                         (1 row)   |
|                                                |
| _Open a MusicXML or MIDI file_                 |
| _About and licences_                           |
+------------------------------------------------+
```

1280 px, first visit, 149 pieces (1,913 px tall, 2.4 screens; first row at 363 px):

```text
+--------------------------------------------------------------------------------------------------------+
|      digitus2                                                                                          |
|      Finger numbers for piano music. Pick a piece, press play, and follow the red note.                |
|                                                                                                        |
|      [[ Start with Twinkle, Twinkle, Little Star ]]                                                    |
|                                                                                                        |
|      [ Search pieces and composers                                                           ]         |
|      (# First steps #) ( Easy ) ( Early intermediate ) ( Intermediate ) ( Late intermediate )          |
|      Each hand stays in one five-finger position.                                                      |
|                                                                                                        |
|      Children's songs                                                                                  |
|      ------------------------------------------------------------------------------------------        |
|      Twinkle, Twinkle, Little Star                                                         0:29        |
|      ------------------------------------------------------------------------------------------        |
|      Mary Had a Little Lamb                                                                0:18        |
|      ------------------------------------------------------------------------------------------        |
|      ...                                                                                               |
|                                                                                                        |
|      Christmas carols and songs                                                                        |
|      ------------------------------------------------------------------------------------------        |
|      Jingle Bells (chorus)                                                                 0:32        |
|      James Lord Pierpont                                                                               |
|      ------------------------------------------------------------------------------------------        |
|      ...                                                                                               |
+--------------------------------------------------------------------------------------------------------+
```

### 3.3 1,000 pieces

The first visit at 360 (level 1 holds 96 pieces, so its collections are closed and its genre pills appear), and a returning reader at 1280 whose last piece was Arabesque: the red button continues it, Early intermediate is chosen, and the Burgmüller collection that holds it is open. Collection names other than the 23 real ones are invented for the measurement.

360 px, first visit, 1,000 pieces (1,236 px tall, 1.6 screens; level 1 holds 96):

```text
+------------------------------------------------+
| digitus2                                       |
| Finger numbers for piano music. Pick a         |
| piece, press play, and follow the red note.    |
|                                                |
| [[ Start with Twinkle, Twinkle, Little Star ]] |
|                                                |
| [ Search pieces and composers               ]  |
| (# First steps #) ( Easy ) ( Early interm»     |
| Each hand stays in one five-finger position.   |
| ( Songs ) ( Classical ) ( Romantic ) ( Mod»    |
|                                                |
| ---------------------------------------------- |
| ▸ Children's songs                   15 pieces |
| ---------------------------------------------- |
| ▸ Christmas carols and songs          2 pieces |
| ---------------------------------------------- |
| ▸ Hymns and spirituals                2 pieces |
| ---------------------------------------------- |
| ▸ Songs before 1929                   4 pieces |
| ---------------------------------------------- |
| ▸ Gurlitt, The First Lessons,        14 pieces |
|   Op. 117                                      |
| ---------------------------------------------- |
| ▸ Türk, Pieces for Beginners         14 pieces |
| ---------------------------------------------- |
| ...  (11 collections in all)                   |
|                                                |
| Other pieces                                   |
| ---------------------------------------------- |
| Ode to Joy (simplified)                   0:36 |
| Ludwig van Beethoven                           |
| ---------------------------------------------- |
+------------------------------------------------+
```

1280 px, returning reader at level 3 of 1,000 pieces (1,704 px tall; 153 pieces in 19 collections):

```text
+--------------------------------------------------------------------------------------------------------+
|      digitus2                                                                                          |
|      Finger numbers for piano music. Pick a piece, press play, and follow the red note.                |
|                                                                                                        |
|      [[ Continue with Arabesque ]]                                                                     |
|                                                                                                        |
|      [ Search pieces and composers                                                           ]         |
|      (First steps) (Easy) (#Early intermediate#) (Intermediate) (Late intermediate) (Advanced)         |
|      (six pills fit one row of the 46rem column: 709 of 736 px)                                        |
|      Thumb crossings, quicker notes and longer pieces.                                                 |
|      ( Songs ) ( Baroque ) ( Classical ) ( Romantic ) ( Modern )                                       |
|                                                                                                        |
|      ------------------------------------------------------------------------------------------        |
|      ▸ Notebook for Anna Magdalena Bach (1725)                                         7 pieces        |
|      ------------------------------------------------------------------------------------------        |
|      ▾ Burgmüller, 25 Easy and Progressive Studies, Op. 100                           15 pieces        |
|          Arabesque                                                                         0:43        |
|          Pastorale                                                                         1:07        |
|          ...                                                                                           |
|      ------------------------------------------------------------------------------------------        |
|      ▸ Schumann, Album for the Young, Op. 68                                           5 pieces        |
|      ------------------------------------------------------------------------------------------        |
|      ...  (19 collections in all)                                                                      |
|                                                                                                        |
|      Other pieces                                                                                      |
|      ------------------------------------------------------------------------------------------        |
|      Rondo in C major                                                                      0:27        |
|      Johann Baptist Wanhal                                                                             |
|      ------------------------------------------------------------------------------------------        |
+--------------------------------------------------------------------------------------------------------+
```

### 3.4 Pills active

360 px, 149 pieces, Easy and Baroque chosen (849 px tall):

```text
+------------------------------------------------+
| digitus2                                       |
| Finger numbers for piano music. Pick a         |
| piece, press play, and follow the red note.    |
|                                                |
| [[ Continue with Minuet in G major ]]          |
|                                                |
| [ Search pieces and composers               ]  |
| ( First steps ) (# Easy #) ( Early interme»    |
| Both hands together, with small moves out of   |
| position.                                      |
| ( Songs ) (= Baroque =) ( Romantic )           |
|                                                |
| ---------------------------------------------- |
| Minuet in G major                         1:36 |
| Christian Petzold                              |
| ---------------------------------------------- |
| Minuet in G minor                         1:43 |
| Christian Petzold                              |
| ---------------------------------------------- |
| Polonaise in F major                      1:12 |
| ---------------------------------------------- |
| Minuet in D minor (Aylesford Pieces)      0:48 |
| George Frideric Handel                         |
| ---------------------------------------------- |
|                                                |
| _Open a MusicXML or MIDI file_                 |
| _About and licences_                           |
+------------------------------------------------+
```

1280 px, 149 pieces, Early intermediate and Romantic chosen (1,722 px tall; 23 pieces):

```text
+--------------------------------------------------------------------------------------------------------+
|      digitus2                                                                                          |
|      Finger numbers for piano music. Pick a piece, press play, and follow the red note.                |
|                                                                                                        |
|      [[ Start with Twinkle, Twinkle, Little Star ]]                                                    |
|                                                                                                        |
|      [ Search pieces and composers                                                           ]         |
|      ( First steps ) ( Easy ) (# Early intermediate #) ( Intermediate ) ( Late intermediate )          |
|      Thumb crossings, quicker notes and longer pieces.                                                 |
|      ( Baroque ) ( Classical ) (= Romantic =)                                                          |
|                                                                                                        |
|      Burgmüller, 25 Easy and Progressive Studies, Op. 100                                              |
|      ------------------------------------------------------------------------------------------        |
|      Arabesque                                                                             0:43        |
|      ------------------------------------------------------------------------------------------        |
|      Pastorale                                                                             1:07        |
|      ------------------------------------------------------------------------------------------        |
|      ...  (15 rows, one line each)                                                                     |
|                                                                                                        |
|      Schumann, Album for the Young, Op. 68                                                             |
|      ------------------------------------------------------------------------------------------        |
|      The Wild Rider (No. 8)                                                                0:38        |
|      ------------------------------------------------------------------------------------------        |
|      ...                                                                                               |
|      Tchaikovsky, Album for the Young, Op. 39    (2 rows)                                              |
|      Other pieces                                (1 row: Gymnopédie No. 1)                             |
+--------------------------------------------------------------------------------------------------------+
```

### 3.5 Search active

The pills fold away while a query is typed (they do not apply to a search), the results cover every level, and the same three shapes apply: 26 results are grouped by level and flat inside each; 117 results fold.

360 px, 149 pieces, searching "bach" (2,370 px tall; 26 pieces):

```text
+------------------------------------------------+
| digitus2                                       |
| Finger numbers for piano music. Pick a         |
| piece, press play, and follow the red note.    |
|                                                |
| [[ Start with Twinkle, Twinkle, Little Star ]] |
|                                                |
| [ bach                                     x ] |
| 26 pieces                                      |
|                                                |
| Easy                                           |
| ---------------------------------------------- |
| Minuet in G major                         1:36 |
| Christian Petzold                              |
| ---------------------------------------------- |
| Minuet in G minor                         1:43 |
| Christian Petzold                              |
| ---------------------------------------------- |
| Polonaise in F major                      1:12 |
| ---------------------------------------------- |
|                                                |
| Early intermediate                             |
| ---------------------------------------------- |
| Minuet in F major                         1:36 |
| ---------------------------------------------- |
| ...  (11 rows)                                 |
|                                                |
| Intermediate                         (8 rows)  |
| Late intermediate                    (4 rows)  |
+------------------------------------------------+
```

1280 px, 1,000 pieces, searching "chopin" (1,280 px tall; 117 pieces, so collections fold):

```text
+--------------------------------------------------------------------------------------------------------+
|      digitus2                                                                                          |
|      Finger numbers for piano music. Pick a piece, press play, and follow the red note.                |
|                                                                                                        |
|      [[ Start with Twinkle, Twinkle, Little Star ]]                                                    |
|                                                                                                        |
|      [ chopin                                                                              x ]         |
|      117 pieces                                                                                        |
|                                                                                                        |
|      Intermediate                                                                                      |
|      ------------------------------------------------------------------------------------------        |
|      ▸ Chopin, Preludes, Op. 28                                                        3 pieces        |
|      ------------------------------------------------------------------------------------------        |
|      ▸ Chopin, Waltzes                                                                 6 pieces        |
|      ------------------------------------------------------------------------------------------        |
|      ▸ Chopin, Mazurkas                                                               12 pieces        |
|      ------------------------------------------------------------------------------------------        |
|                                                                                                        |
|      Late intermediate                                                                                 |
|      ------------------------------------------------------------------------------------------        |
|      ▸ Chopin, Nocturnes                                                              10 pieces        |
|      ------------------------------------------------------------------------------------------        |
|      ...                                                                                               |
|                                                                                                        |
|      Advanced                                                                                          |
|      ------------------------------------------------------------------------------------------        |
|      ▸ Chopin, Études, Op. 10 and Op. 25                                              24 pieces        |
|      ------------------------------------------------------------------------------------------        |
|      ...                                                                                               |
+--------------------------------------------------------------------------------------------------------+
```

### 3.6 Empty result

360 px, searching "fur elize" (one screen):

```text
+------------------------------------------------+
| digitus2                                       |
| Finger numbers for piano music. Pick a         |
| piece, press play, and follow the red note.    |
|                                                |
| [[ Start with Twinkle, Twinkle, Little Star ]] |
|                                                |
| [ fur elize                                x ] |
|                                                |
| Nothing matches “fur elize”.                   |
| Search looks in titles, composers and          |
| collections.                                   |
| _Clear the search_                             |
|                                                |
|                                                |
| _Open a MusicXML or MIDI file_                 |
| _About and licences_                           |
+------------------------------------------------+
```

1280 px, searching "fur elize":

```text
+--------------------------------------------------------------------------------------------------------+
|      digitus2                                                                                          |
|      Finger numbers for piano music. Pick a piece, press play, and follow the red note.                |
|                                                                                                        |
|      [[ Start with Twinkle, Twinkle, Little Star ]]                                                    |
|                                                                                                        |
|      [ fur elize                                                                           x ]         |
|                                                                                                        |
|      Nothing matches “fur elize”.                                                                      |
|      Search looks in titles, composers and collections.                                                |
|      _Clear the search_                                                                                |
|                                                                                                        |
|      _Open a MusicXML or MIDI file_     _About and licences_                                           |
+--------------------------------------------------------------------------------------------------------+
```

### 3.7 A dropped file

On a phone the footer line opens the system's file chooser and a chosen file opens straight into the score, as the drop does. The frame below appears only while a file is dragged over the window.

360 px (a narrow desktop window or a tablet; a phone uses the chooser):

```text
+------------------------------------------------+
| +------------------------------------------+   |
| |                                          |   |
| |                                          |   |
| |                                          |   |
| |        Drop the file to open it          |   |
| |                                          |   |
| |                                          |   |
| |                                          |   |
| +------------------------------------------+   |
|    (2 px dashed ink frame, 12 px inset; the    |
|     page under it is covered; no red)          |
+------------------------------------------------+
```

1280 px, a file dragged over the window:

```text
+--------------------------------------------------------------------------------------------------------+
|      +----------------------------------------------------------------------------------------+        |
|      |                                                                                        |        |
|      |                                                                                        |        |
|      |                                Drop the file to open it                                |        |
|      |                                                                                        |        |
|      |                                                                                        |        |
|      +----------------------------------------------------------------------------------------+        |
|      (the frame covers the whole window, not just the column)                                          |
|      On drop: a MusicXML or MIDI file opens straight into the score                                    |
|      (Play is red there); anything else leaves the library as it                                       |
|      was and shows the gray notice at the top of the window.                                           |
+--------------------------------------------------------------------------------------------------------+
```

## 4. The pill filters

### 4.1 Level pills

| Level | Pill, heading and side panel (one name everywhere) | The line under the pills (what the level asks of the hands) | Pieces at 149 | At 1,000 (synthetic) |
| ----: | -------------------------------------------------- | ----------------------------------------------------------- | ------------: | -------------------: |
|     1 | First steps                                        | Each hand stays in one five-finger position.                |            24 |                   96 |
|     2 | Easy                                               | Both hands together, with small moves out of position.      |            43 |                  174 |
|     3 | Early intermediate                                 | Thumb crossings, quicker notes and longer pieces.           |            41 |                  153 |
|     4 | Intermediate                                       | Independent hands, faster runs and wider stretches.         |            27 |                  169 |
|     5 | Late intermediate (was `Stretch`)                  | Whole pieces with fast passages, leaps and full chords.     |            14 |                  190 |
|     6 | Advanced (arrives with L2, T5)                     | Concert pieces that ask for a complete technique.           |             – |                  218 |

- **Single select, never empty.** The pills are a radio group: one level is always chosen, so the list is never longer than one level. A pill does not clear; choosing another level replaces it. The search is the way across levels.
- **Default.** The level of the reader's last opened library piece; on a first visit, First steps. Within a visit the chosen level survives opening a piece and coming back.
- **Width.** One row, never wrapped. Five pills are 605 px wide and six 709 px: one row of the 736 px column from 768 px up. At 360 the row scrolls sideways inside itself (no page scroll, no scroll bar drawn); the last visible pill is cut by the edge, which says there is more, and the chosen pill is scrolled into view on arrival.
- **Look.** 36 px tall with a 44 px hit area, full-radius pill, 15 px text, 1 px gray-2 border, ink text; chosen: ink fill, paper text. Never red. Round means state (pills), square means action (buttons, fields): the red button stays square.

### 4.2 Genre pills

Six genres, five in use at 149 pieces. Every collection maps to one genre; a piece may override its collection's genre (needed for none of the 149).

| Genre id    | Pill      | Collections (`collectionId`)                                                                                |  L1 |  L2 |  L3 |  L4 |  L5 | Total |
| ----------- | --------- | ----------------------------------------------------------------------------------------------------------- | --: | --: | --: | --: | --: | ----: |
| `songs`     | Songs     | `children-songs`, `christmas`, `hymns`, `songs-before-1929`, `folk-songs`, `anthems`, `classical-themes`    |  24 |  31 |   0 |   0 |   0 |    55 |
| `baroque`   | Baroque   | `anna-magdalena`, `handel-aylesford`, `bach-little-preludes`, `bach-inventions`, `bach-wtc`                 |   0 |   4 |  11 |   8 |   4 |    27 |
| `classical` | Classical | `sonatinas`, `dances`, `swedish-folk-dances`                                                                |   0 |   1 |   7 |   7 |   3 |    18 |
| `romantic`  | Romantic  | `burgmuller-op100`, `schumann-op68`, `tchaikovsky-op39`, `schumann-op15`, `chopin-op28`, `character-pieces` |   0 |   6 |  23 |  12 |   4 |    45 |
| `ragtime`   | Ragtime   | `easy-rags`, `ragtime`                                                                                      |   0 |   1 |   0 |   0 |   3 |     4 |
| `modern`    | Modern    | none yet; L2's Debussy, Satie, Bartók and the CC-licensed contemporary lane (T2) land here                  |   0 |   0 |   0 |   0 |   0 |     0 |

23 collections, 149 pieces. Two judgement calls: `classical-themes` (Ode to Joy, Canon in D, Brahms's Lullaby, simplified) counts as Songs because a beginner meets them as tunes, at levels 1 and 2; `swedish-folk-dances` (one polska printed in 1814) counts as Classical by its date, as original keyboard music. Era names are how piano anthologies and exam lists sort original repertoire, and they cut across levels, which is the one thing a second pill row must do to earn its place: at 149 pieces Baroque, Classical and Romantic each run from Easy to Late intermediate, while Songs is all 24 pieces of level 1 and 31 of the 43 of level 2 (the critique's point 7.3). That is also why the genre row stays hidden where it would only repeat the level.

**Where the genre lives.** `content/tools/catalog.json` gains a `genres` table (`[{id, title}]`, the controlled vocabulary in display order, beside `collections`), and each `collections[]` entry gains `genre` (an id from it); a catalog piece may carry `genre` to override its collection's. `tools/build.py` writes `genre` (the id) on every `manifest.json` entry and fails on a collection without a known genre, as it fails today on an unknown collection id. `apps/web/src/library/manifest.ts` gains `type Genre` and `GENRE_NAMES`.

- **When the row appears.** Only when the chosen level holds more than 30 pieces and at least two genres hold 3 or more of them; it shows a pill for each genre with 3 or more pieces in that level, in the table's order. At 149: Easy shows Songs, Baroque, Romantic (31, 4, 6; Classical and Ragtime have 1 each); Early intermediate shows Baroque, Classical, Romantic (11, 7, 23); First steps, Intermediate and Late intermediate show none. At 1,000 (synthetic) every level shows 4 or 5.
- **Single select, optional.** Toggle buttons. Pressing a genre narrows the level to it; pressing it again clears it. Escape inside the row clears it. Choosing another level or typing a search clears it too, so a hidden filter never outlives the level it was chosen in.
- **Nothing selected** (the normal state): the whole level, all genres.
- **Look.** Quieter than the levels: 32 px tall (44 px hit area), 14 px gray-3 text, 1 px gray-2 border; chosen: ink text and a 2 px ink border, drawn as a 1 px border and a 1 px inset shadow so the pill never changes width. Never filled, never red. The level line sits between the two rows, so the rows never read as one group and need no labels.

### 4.3 What the page shows before any pill is pressed

| Library size | What is on the page                                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| up to 60     | No pills, no search. Every level as a section (name, line, rows), flat or grouped per section. Find-in-page reaches every row.                                                         |
| 61 and more  | Search, level pills with the reader's level chosen (First steps on a first visit), its line, genre pills if that level is long, and that level's list. Nothing else from other levels. |

### 4.4 Search

- Matches every word of the query, in any order, as part of the piece's title, composer or collection name, ignoring case, accents and punctuation (`fur elise` finds Für Elise, `burgmuller op 100` finds the set, `christmas` finds the carols). No fuzzy matching.
- Results cover the whole library, grouped by level under level headings, then by the three shapes (2.2) with the fold counted on all results together.
- The count line (`26 pieces`) shows under the field while a query is typed; an empty result shows the empty state (section 7).
- Emptying the field (by hand, with Escape or with `Clear the search`) brings back the pills with the level and genre that were chosen before.

## 5. Disclosure rules and motion

| Element                    | Appears exactly when                                                                                  | At 30 | At 149                              | At 1,000 (synthetic)                     | Motion (tokens: 120, 160, 200 ms, ease-out)                                                                                  | The reader's target that must not move                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ----- | ----------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Every level on one page    | library ≤ 60 pieces                                                                                   | yes   | no                                  | no                                       | none (page load)                                                                                                             | –                                                      |
| Search field               | library > 60 pieces                                                                                   | no    | yes                                 | yes                                      | none (page load)                                                                                                             | –                                                      |
| Level pills and line       | library > 60 pieces, and no query typed                                                               | no    | 5 pills                             | 6 pills                                  | chosen pill: fill and text color 120 ms; the line and the list swap in the same frame, unanimated                            | the pressed pill (everything that changes is below it) |
| Genre pills                | no query, the chosen level > 30 pieces, and ≥ 2 genres with ≥ 3 pieces in it; one pill per such genre | never | Easy (3), Early intermediate (3)    | every level (4 or 5)                     | row height 0 to auto (`grid-template-rows` 0fr to 1fr) with opacity, 160 ms in, 120 ms out; the chosen genre pill: 120 ms    | the level pill pressed (above the row)                 |
| Collection headings        | a section > 12 pieces                                                                                 | never | every level                         | when a genre narrows a level to 13 to 60 | none: they come with new content                                                                                             | –                                                      |
| `Other pieces`             | headings are shown and some collection has exactly 1 piece in the section                             | never | L1 1, L2 6, L3 4, L4 3, L5 1 pieces | most levels                              | none                                                                                                                         | –                                                      |
| Closed collections         | the list in view > 60 pieces; each collection of ≥ 2 pieces                                           | never | never (largest level 43)            | every unnarrowed level; searches over 60 | open 200 ms, close 160 ms (`interpolate-size` on the content's height, or a 0fr to 1fr grid); the marker turns 90° in 160 ms | the line pressed (content opens below it)              |
| Counts                     | only for what is not on screen: a closed collection's `15 pieces`, and the search's count line        | none  | the search only                     | closed collections and the search        | count line: opacity 120 ms                                                                                                   | –                                                      |
| Composer line on a row     | 2.3                                                                                                   | yes   | yes                                 | yes                                      | none                                                                                                                         | –                                                      |
| Search mode (pills hidden) | the field holds at least one character                                                                | –     | yes                                 | yes                                      | the pills block collapses (height and opacity) 160 ms; back 160 ms when the field empties                                    | the field (it sits above the pills)                    |
| `Clear the search`         | a query matches nothing                                                                               | –     | yes                                 | yes                                      | none                                                                                                                         | –                                                      |
| Drop frame                 | a drag carrying files is over the window (`dragenter` with `Files`), until it leaves or drops         | yes   | yes                                 | yes                                      | opacity 120 ms in and out                                                                                                    | –                                                      |
| `Continue with …`          | a library piece was opened before (any visit) and is still in the library                             | yes   | yes                                 | yes                                      | none (decided on load)                                                                                                       | –                                                      |

Why these numbers: 12 rows (about 800 px of two-line rows at 360) is one phone screen, past which a reader needs landmarks; 30 rows with headings is about three phone screens (Easy at 149: 43 rows in 2,960 px); 60 rows is about four to five phone screens, a little more than today's whole 30-piece list (its five level sections take 3,392 px at 360, critique C7). The two 60s are the same budget seen from the library and from the list in view. All five numbers are constants in one module, unit-tested at 12/13, 30/31 and 60/61.

Rules for all of them: the pill row's sideways scroll to the chosen pill is instant (smooth scrolling runs longer than 200 ms, review S14); nothing animates on page load; under `prefers-reduced-motion` every duration is 0 (the tokens already do this); a crossing of a threshold by new content (a level gaining headings, a list folding) is never animated, because the content itself is new.

## 6. The one red element

| State                               | The red element                            | Notes                                                                                                                       |
| ----------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| First visit, any library size       | `Start with Twinkle, Twinkle, Little Star` | The first level-1 piece in manifest order, as today.                                                                        |
| Returning reader                    | `Continue with <title>`                    | The last library piece opened, in the settings (`lastPiece`); its level is chosen. A dropped file is never remembered.      |
| Last piece no longer in the library | `Start with Twinkle, Twinkle, Little Star` | Fallback.                                                                                                                   |
| A level or genre pill pressed       | the same button                            | Chosen pills are ink, never red.                                                                                            |
| A collection opened or closed       | the same button                            |                                                                                                                             |
| Search typed, results shown         | the same button                            | On a phone the soft keyboard and the scrolled results may hide it: allowed (below).                                         |
| Empty result                        | the same button                            | `Clear the search` is a quiet text button.                                                                                  |
| List scrolled past the welcome      | none in view                               | The button is in the DOM, above. Spec section 9 gains: "a scrolled list may show no red" (critique C12). No sticky red bar. |
| A file dragged over the window      | none in view                               | The opaque paper frame covers the page; dropping is the only action. The button stays the one red root in the DOM.          |
| A refused file                      | the same button                            | The notice at the top is gray, as today.                                                                                    |
| A file dropped or chosen            | (score view) Play                          | Unchanged.                                                                                                                  |

The DOM holds exactly one `.is-red` in every library state, so `expectOneRed` and the state walk need no change in their definition; they gain the new states (section 12, task 10).

## 7. Copy

| Where                                        | Exact text                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document title                               | `digitus2`                                                                                                                                                    |
| Heading                                      | `digitus2`                                                                                                                                                    |
| Sentence                                     | `Finger numbers for piano music. Pick a piece, press play, and follow the red note.`                                                                          |
| Red button, first visit                      | `Start with Twinkle, Twinkle, Little Star` (`Start with ` and the recommended piece's title)                                                                  |
| Red button, returning                        | `Continue with <title>`, the title without a closing parenthesis (`Continue with Für Elise`); accessible name `Continue with <full title> by <full composer>` |
| Search field                                 | placeholder `Search pieces and composers`; accessible name `Search the library`                                                                               |
| Search count                                 | `1 piece`, `<n> pieces`                                                                                                                                       |
| Empty result                                 | heading `Nothing matches “<query>”.`, line `Search looks in titles, composers and collections.`, text button `Clear the search`                               |
| Level pills (group name, not shown)          | `Level`; pills `First steps`, `Easy`, `Early intermediate`, `Intermediate`, `Late intermediate`, `Advanced`                                                   |
| Level lines                                  | as in 4.1                                                                                                                                                     |
| Genre pills (group name, not shown)          | `Genre`; pills `Songs`, `Baroque`, `Classical`, `Romantic`, `Ragtime`, `Modern`                                                                               |
| Level headings (up to 60 pieces, and search) | the level's name alone: `First steps`                                                                                                                         |
| List heading with pills (not shown)          | the level, and the genre when one is chosen: `Early intermediate`, `Early intermediate, Romantic`                                                             |
| Collection heading                           | the collection's title from the manifest; the last group `Other pieces`                                                                                       |
| Closed collection                            | its title, and `<n> pieces` (always 2 or more)                                                                                                                |
| Row                                          | title (2.3), composer (2.3), length `m:ss`; accessible name `Open <full title> by <full composer>`, described by the length (as today)                        |
| Footer                                       | `Open a MusicXML or MIDI file`, `About and licences`                                                                                                          |
| Drop frame                                   | `Drop the file to open it`                                                                                                                                    |
| Refused file (existing notice, unchanged)    | `That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).`                                                                     |
| Announcements (live region, not shown)       | `First steps: 24 pieces`; `Early intermediate, Romantic: 23 pieces`; `26 pieces`; `Nothing matches “<query>”.`                                                |
| Score side panel, level row (consistency)    | `Easy` (today `2 · Easy`)                                                                                                                                     |

The page has no other words. 32 words come before the first row at 30 pieces (today 64).

## 8. Keyboard and screen reader

| Part               | Markup                                                                                                                                                                                                                         | Keys                                                                                                                                                                | What a screen reader hears                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Search             | `input type="search"`, `aria-label`, `aria-describedby` the count line                                                                                                                                                         | `/` focuses it from anywhere on the library except a text field; Escape empties it (focus stays); Enter moves focus to the first result (closes a phone's keyboard) | "Search the library, search field"; the count 500 ms after typing stops (one polite `role="status"` region)                       |
| Level pills        | native radios in a `fieldset` with a visually hidden `legend` `Level` (the pattern of today's `Hands` control); the level line is the fieldset's description                                                                   | one Tab stop (the chosen pill); Left and Right (and Up, Down) choose the previous or next level at once; Home and End the first and last                            | "Level, group. Early intermediate, radio button, checked, 3 of 5", then the line; after a change, `Early intermediate: 41 pieces` |
| Genre pills        | `role="toolbar"` named `Genre`, buttons with `aria-pressed`                                                                                                                                                                    | one Tab stop (roving `tabindex`); Left and Right move; Space or Enter toggles; Escape clears                                                                        | "Genre, toolbar. Romantic, toggle button, pressed"; then `Early intermediate, Romantic: 23 pieces`                                |
| Headings           | `h1` the name; `h2` each level (up to 60, and in search results) or, with pills, one visually hidden `h2` naming the list (section 7); `h3` each collection                                                                    | heading navigation lands on levels, then collections                                                                                                                |                                                                                                                                   |
| Closed collections | the accordion pattern: `h3` holding a `button` with `aria-expanded` and `aria-controls`, the rows in a region with `hidden="until-found"`, so the browser's find-in-page opens a collection that holds a match (`beforematch`) | Tab reaches each closed line; Space or Enter opens and closes; focus stays on the line                                                                              | "Burgmüller, 25 Easy and Progressive Studies, Op. 100, 15 pieces, button, collapsed, heading level 3"                             |
| Rows               | whole-row `button` (as today)                                                                                                                                                                                                  | Enter opens the piece                                                                                                                                               | "Open Arabesque by Friedrich Burgmüller, button, 0:43"                                                                            |
| Drop frame         | `aria-hidden`; purely visual                                                                                                                                                                                                   | –                                                                                                                                                                   | A refusal uses the existing notice.                                                                                               |
| Back from a score  | as today, focus on the `h1`; the store restores level, genre, query, open collections and scroll                                                                                                                               | –                                                                                                                                                                   |                                                                                                                                   |

Focus is never moved by a pill, a search keystroke or an opened collection; the list below changes and the live region says how. Pills keep the 2 px ink focus ring with a 2 px offset, outside the pill, so it never reads as the chosen state. Sources: the WAI-ARIA Authoring Practices radio group, toolbar and accordion patterns (https://www.w3.org/WAI/ARIA/apg/patterns/radio/, https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/, https://www.w3.org/WAI/ARIA/apg/patterns/accordion/), `hidden="until-found"` (https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/hidden).

## 9. Rendering at 1,000 pieces

**What is in the DOM.** One level, or one search's results, never the library. Inside a folded list the rows of closed collections stay in the DOM under `hidden="until-found"`, so find-in-page still works within the level and nothing is mounted on open. Measured on the prototype at 1,000 pieces: at most 1,017 elements and 218 rows (Advanced, 22 closed collections); 488 to 1,017 across the six levels; 564 for a search of 117 results. Today's L1 page holds 821 elements for 149 pieces and would hold about 5,500 for 1,000.

| Level at 1,000 (synthetic) | Pieces | Closed collections | Elements | Page at 360 (px) | Page at 1280 (px) | Prototype render (ms) |
| -------------------------- | -----: | -----------------: | -------: | ---------------: | ----------------: | --------------------: |
| First steps                |     96 |                 11 |      488 |            1,236 |             1,146 |                   0.6 |
| Easy                       |    174 |                 22 |      874 |            2,322 |             1,978 |                   0.8 |
| Early intermediate         |    153 |                 19 |      754 |            2,072 |             1,704 |                   0.9 |
| Intermediate               |    169 |                 24 |      843 |            2,248 |             1,881 |                   1.5 |
| Late intermediate          |    190 |                 26 |      939 |            2,143 |             1,869 |                   0.9 |
| Advanced                   |    218 |                 22 |    1,017 |            1,787 |             1,559 |                   1.0 |

(The prototype renders an HTML string; React will take several times longer. The budget below covers it.)

**No virtualization.** Windowing would break find-in-page, the scroll restored on Back (a measured offset needs rendered rows), screen-reader browsing by heading, and `hidden="until-found"`. The design bounds the DOM instead, and about a thousand elements is cheap. No `content-visibility` either: its estimated sizes would move the restored scroll offset.

**The data.** Today `manifest.ts` imports the whole manifest into the library page's entry chunk. Measured on the L1 manifest: 174,240 bytes minified, 26,063 bytes gzip for 149 pieces, 175 bytes gzip per piece, so about 170 KB gzip at 1,000 pieces, more than the page's whole 150 KB budget (93.1 KB today with 30 pieces). The fields the library needs (slug, title, composer, level, collection id, genre, length) are 5,113 bytes gzip at 149, 34 bytes per piece, about 34 KB at 1,000. So `build.py` also writes a slim `content/library.json`: those fields per piece, and the collections table (`id`, `title`, `kind`, `genre`) once instead of a title on every piece. The library imports it; the score view's side panel and the about page load the full manifest lazily in their own chunk. `scripts/check-bundle-size.mjs` gains a check with a synthetic 1,000-piece index fixture.

**Search and grouping.** At load, one normalized string per piece (`title composer collection`, NFD with the marks removed, lower case, punctuation as spaces; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize): about 90 KB of strings at 1,000. A keystroke filters with `every word is a substring`, well under a millisecond; the list renders from `useDeferredValue(query)` (https://react.dev/reference/react/useDeferredValue) so typing never waits for it. The grouping is one pure function of (pieces, level, genre, query, open collections), memoized.

**Budget to test.** On the synthetic 1,000-piece fixture at a 4x CPU slowdown: a pill press or a keystroke paints its new list within 100 ms; the library's largest contentful paint stays under the existing 2 s gate (it is the sentence or the red button, as today).

## 10. T1: the dock at 768 and 1280 px

Today, measured on 5174 with the G major minuet: from 480 px up the practice controls stand open above the score, 96 px tall (180 to 276 px), the score starts at 292 px, and they scroll away as soon as the cursor moves the page; the dock is 121 px tall at 768 and 133 px at 1280, and grows by about 35 px whenever the status line has something to say. At 360 the closed `Practice` line sits at 200 to 244 px and the score starts at 260 px; the dock is 173 px.

**Proposal: one `Practice` disclosure, in the dock, at every width, closed on arrival.** No control is added: the phone's existing disclosure moves into the dock and is used at every width, and the loop's `Clear loop` leaves.

- **From 480 px:** the dock's first row holds `▸ Practice` at the left and the status line at the right (`Loading the piano…`, the count-in, the reason Play is unavailable). Play and Rewind stand stacked beside the keyboard, as today. Opened, the controls appear between that row and Play, inside the dock, in two rows: Tempo with its value and the three hands; then Metronome, Count-in and Loop. The dock grows upward, like the status line does today, and the cursor's scroll already keeps the current system above it (`--dock-h`).
- **Below 480 px:** `▸ Practice` joins the Play and Rewind row (Play 96, Rewind 96, Practice about 110 px: 318 of 328). Opened, the controls stack above that row. The status line keeps its own row, as today.
- **Loop:** one `Loop` checkbox. Checked, `bars [3] to [4]` appear after it, filled with the bar the cursor is in (bar 1 at the start) and the next one, and the loop applies at once; unchecked, the fields go and the loop is cleared. The reversed-range line (`The loop needs "from" before "to".`) is unchanged.
- **Keys:** the summary takes Space itself (today's rule), so Space plays everywhere else; Escape with the focus inside the open panel closes it and returns the focus to `Practice`; the dock's negative `scroll-margin-bottom` extends to the panel.
- **The open state** lasts for the visit (not per piece), so a reader who keeps the controls open keeps them open from piece to piece; every page load starts closed.
- **Red:** unchanged (Play, Pause during the count-in, the cursor).

| Width | Score starts (today → proposed) | Dock, closed (today → proposed) | Dock with a status line    | Controls while playing         |
| ----: | ------------------------------- | ------------------------------- | -------------------------- | ------------------------------ |
|   360 | 260 → about 200 px              | 173 → 173 px                    | +35 px, as today           | one tap away (were: scroll up) |
|   768 | 292 → about 180 px              | 121 → about 161 px              | no change (shares the row) | one tap away (were: gone)      |
|  1280 | 292 → about 180 px              | 133 → about 173 px              | no change                  | one tap away (were: gone)      |

The proposed heights are estimates from today's measurements (a 32 px row and an 8 px gap); the cost is about 40 px of the dock at 768 and 1280 while playing, against 112 px returned to the music on arrival and the controls in reach for the whole piece.

1280 px, closed (the 768 px dock is the same, with a 624 px keyboard):

```text
+--------------------------------------------------------------------------------+
| ... music, scrolled by the cursor ...                                          |
| ------------------------------------------------------------------------------ |
| ▸ Practice                                                  Loading the piano… |
| [[  Play  ]]   | # # | # # # | # # | # # # | # # | # # # | # # | # # # | # # | |
| [  Rewind  ]   |_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_| |
+--------------------------------------------------------------------------------+
```

1280 px, open (two rows; Loop off):

```text
+--------------------------------------------------------------------------------+
| ... music ...                                                                  |
| ------------------------------------------------------------------------------ |
| ▾ Practice                                                                     |
| Tempo [=======o=======] 100 % · ♩ = 120   [#Both hands#|Right hand|Left hand]  |
| [ ] Metronome    [x] Count-in    [ ] Loop                                      |
| [[  Play  ]]   | # # | # # # | # # | # # # | # # | # # # | # # | # # # | # # | |
| [  Rewind  ]   |_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_| |
+--------------------------------------------------------------------------------+
```

1280 px, open, Loop on (the bar fields appear only now, filled with the cursor's bar and the next):

```text
+--------------------------------------------------------------------------------+
| ▾ Practice                                                                     |
| Tempo [=======o=======] 100 % · ♩ = 120   [#Both hands#|Right hand|Left hand]  |
| [ ] Metronome    [x] Count-in    [x] Loop bars [ 3 ] to [ 4 ]                  |
| [[  Play  ]]   | # # | # # # | # # | # # # | # # | # # # | # # | # # # | # # | |
| [  Rewind  ]   |_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_| |
+--------------------------------------------------------------------------------+
```

360 px, closed (Practice joins the Play and Rewind row; the line above the score is gone):

```text
+----------------------------------------------+
| ... music ...                                |
| -------------------------------------------- |
| [[  Play  ]]  [  Rewind  ]  ▸ Practice       |
| | # # | # # # | # # | # # # | # # | # # #    |
| |_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|    |
+----------------------------------------------+
```

360 px, open:

```text
+----------------------------------------------+
| Tempo [=====o=====] 100 % · ♩ = 120          |
| [#Both hands#|Right hand|Left hand]          |
| [ ] Metronome    [x] Count-in                |
| [ ] Loop                                     |
| [[  Play  ]]  [  Rewind  ]  ▾ Practice       |
| | # # | # # # | # # | # # # | # # | # # #    |
| |_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|    |
+----------------------------------------------+
```

### 10.1 The keyboard's hand letters (T11)

The request behind this run is T11: the L and R over the pressed keys only when the hands are close. It belongs to its own task in this batch; the dock design keeps room for it and changes nothing about it. For consistency with this proposal's disclosure rules, the rule I would hold that task to is the critique's (section 8.3): letters on both hands for a whole bar when any onset in it has the hands within a fifth (7 semitones) or interleaved, and on a phone also when the other hand is scrolled out of the keyboard's view; never on one hand alone; no new color. Replayed on the critique's data, the minuet shows letters in 9 of its 32 bars (switching 12 times in about 50 s, against 135 of 135 onset groups today), and Amazing Grace in none.

## 11. Risks, and what is left out on purpose

### 11.1 Risks

| Risk                                                                                                                                                                | Mitigation                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One level at a time hides the rest of the library; a beginner may not see that harder pieces exist.                                                                 | The pills name every level on the first screen; the cut-off pill at 360 shows the row goes on; search covers every level.                                                                       |
| The page changes shape at four thresholds (a library of 60, a section of 12, a level of 30, a list of 60); a library of 61 pieces looks different from one of 60.   | Each shape follows from the list's length, not from a mode; the constants live in one module with boundary tests; at 149 only two shapes ever show (grouped, and flat for small results).       |
| Closed collections at 1,000 add a tap before any row of a long level.                                                                                               | The reader's own collection opens on arrival; open collections are remembered for the visit; a genre narrows most levels below 60, which opens them; find-in-page and search reach closed rows. |
| Era genres are a musician's words; `Baroque` may mean nothing to a beginner, and per-collection genres mislabel outliers (Satie sits in Romantic character pieces). | Genre pills appear only on long levels, where era is the only axis that cuts across them; a piece-level `genre` override exists for outliers (Satie moves to Modern when Modern exists).        |
| The level lines are short claims about technique; a teacher may disagree with them.                                                                                 | Put them through the teacher review (verification spec 3.12) before they ship; they are copy constants.                                                                                         |
| `Late intermediate` is longer than `Stretch` and renames a level users have seen.                                                                                   | Only the name changes; one name everywhere replaces three formats (C5).                                                                                                                         |
| The title shortening and composer hiding are heuristics on free-text fields.                                                                                        | Unit tests over the whole L1 manifest (every shortened title listed in a snapshot reviewed once); the full strings stay in the accessible names and the score view.                             |
| The manifest split touches the score view's side panel and the about page, which then wait for a lazy chunk.                                                        | It is small next to the score and Verovio; it can wait for L2: the 149-piece entry (about 115 KB gzip, estimated) stays under the 150 KB gate.                                                  |
| `hidden="until-found"` is not in every browser.                                                                                                                     | Where it is missing, closed rows are plain `hidden`: find-in-page misses them and the search field covers it. Check support when the task starts.                                               |
| The finger legend leaves the library before the score view shows it on first open.                                                                                  | Ship task 8 with the library tasks, never after.                                                                                                                                                |
| The dock is about 40 px taller at 768 and 1280 while playing; a phone with the panel open loses about 200 px of music.                                              | Closed on every page load; the panel opens only on a tap; Escape and the summary close it.                                                                                                      |
| The red button is out of view for most of a scrolled list.                                                                                                          | Accepted and written into spec section 9 (critique C12); the page is now short enough that the top is one flick away.                                                                           |

### 11.2 Left out on purpose

- Composer pills and collection pills (40 composers and 23 collections today, dozens later): search does this.
- An `All` level, an `All` genre pill, multi-select, counts on pills, sort controls, dropdowns.
- Shelves, carousels, cover art, icons, `New` badges, favourites, a recently-played list beyond the one Continue button.
- Fuzzy or typo-tolerant search, search suggestions, search inside the score view.
- Type-to-search and a search field at 60 pieces or fewer: every row is on the page and the browser's find-in-page does the job.
- The level and genre in the URL: the store restores them within a visit and the last piece's level across visits; deep links to filtered views can come later.
- Two list columns at 1280: an ordered list reads down, not across; one 46rem column is calm.
- A sticky red bar, a red pill, a red drop frame.
- Turning the single search result red: the red stays the welcome's button.

## 12. Implementation tasks

Ten tasks, one agent each, test first. 1 and 2 are content and data, 3 is the pure model the UI tasks share, 4 to 7 are the library, 8 and 9 the score view, 10 the verification.

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                  | Tests first                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Genre vocabulary in `catalog.json` (`genres`, `collections[].genre`, piece override), `build.py` writes `genre` on every manifest entry and fails on an unknown one.                                                                                                                                                                                                                  | pytest on `build.py`: every collection mapped, the 149 entries carry the table's genres, unknown genre fails.                      |
| 2   | The slim `content/library.json` (fields and collections table) for the library, the full manifest lazy for the side panel and about page; the bundle gate with a synthetic 1,000-piece fixture.                                                                                                                                                                                       | vitest on the loader; `check-bundle-size` with the fixture under 150 KB.                                                           |
| 3   | The library model: thresholds, the three shapes, `Other pieces`, row forms (composer and title rules), genre availability, search normalization and matching, the Continue label.                                                                                                                                                                                                     | vitest, test first, on the real L1 manifest and the synthetic 1,000: boundaries 12/13, 30/31, 60/61; snapshot of shortened titles. |
| 4   | The welcome: remove the legend, the link, the card; Start or Continue from `lastPiece` (settings v1, merged with defaults); the default level; `LEVEL_NAMES` (`Late intermediate`, `Advanced`); the side panel shows the level by name.                                                                                                                                               | component tests: one `.is-red`, both labels, fallback when the slug is gone.                                                       |
| 5   | The browse controls: search field, level radios, genre toolbar, level line, live region, `/` and Escape, the store state (level, genre, query, open collections) restored on Back, the motion of section 5.                                                                                                                                                                           | component tests for keys, announcements and restoring; e2e for the motion durations under reduced motion.                          |
| 6   | The list: sections and headings, the accordion with `hidden="until-found"`, rows in their two forms, the 46rem column, no tags, the scroll restored on Back with folded lists.                                                                                                                                                                                                        | component tests per shape; e2e: find-in-page reveals a closed row, Back restores scroll and open collections.                      |
| 7   | Your own file: the drop on the whole window with the frame, the footer line opening the chooser; remove the drop zone and the welcome's link.                                                                                                                                                                                                                                         | e2e: a drop opens the score, a refused file shows the notice, the frame only during a drag, one red throughout.                    |
| 8   | The finger legend in the score view: above the score the first time a piece is opened, folded after; still in the side panel.                                                                                                                                                                                                                                                         | component and e2e: shown once, then folded, on the first screen at 360 and 1280.                                                   |
| 9   | T1: the `Practice` disclosure in the dock at every width; `Loop` as one checkbox with the bar fields only when on; the status line sharing the dock's first row from 480 px.                                                                                                                                                                                                          | e2e at 360, 768, 1280: the dock's height, the score's top, controls reachable while playing, Space, Escape, one red.               |
| 10  | Verification: the state walk gains the library at 30, 149 and 1,000 pieces (fixtures), pills, genre, search, empty result, an open collection and the drag frame, each with one red, axe and no horizontal scroll; the 1,000-piece performance check; new visual baselines; `docs/app.md` and spec section 9 (level names, disclosure thresholds, "a scrolled list may show no red"). | the walk itself.                                                                                                                   |
