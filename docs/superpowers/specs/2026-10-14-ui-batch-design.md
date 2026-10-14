# UI batch design: the landing page, the dock, pause and the hand letters

- Date: 2026-10-14
- Status: the design the UI batch builds from (plan: `docs/superpowers/plans/2026-10-14-ui-batch.md`). It supersedes the three landing proposals in `docs/superpowers/design/` where they differ.
- Scope: T6 (the landing page), T1 (the Practice controls in the dock), T10 (the paused state), T11 (the hand letters on the keyboard, which replaces T8's bracket idea). TODO entries: `docs/TODO.md` on `main`.
- Brief, in the user's words: "the landing page is a bit cluttered. Please divide into more easily parsable units"; "Make it easier to parse the overview of songs. Maybe add pill filters (for difficulty / genre). Keep the brutal simplicity though"; "some UI elements only appear when they are needed"; "Do not overclutter it with features and be brutal with this"; and, for T11, "Only when the L and R notes are close to each other, it is good to show the hand indicator."
- Built on: the critique `docs/reviews/design-2026-10-14.md`, the three proposals, and the two judges' verdicts. The judges disagreed (one ranked beginner-first first, the other library-at-scale by one point). The brief says to take the proposal that scores better on simplicity and disclosure, which both judges gave to **beginner-first** (8 against 6, and 7.5 against 6.5). This design starts from beginner-first and takes the grafts listed in section 2.
- Library facts: the L1 manifest merged into `main` (b9a29a3): **149 pieces** (the brief's "147" is out of date), 23 collections, levels 1 to 5 holding 24, 43, 41, 27 and 14 pieces. All counts below were recomputed from `content/manifest.json` on `main`.
- Revised after the design review (2026-10-14):
  - T11 has no phone exception, and the letters keep their size (section 15).
  - The Swedish polska and the simplified Entertainer are Songs, by one rule for arrangements (section 4.2).
  - M5's note selection must give way to the paused cursor (section 9).

## 1. The page in one paragraph

A first-time visitor reads the name, one sentence ("Finger numbers for piano music. Pick a piece, press play, and follow the red note.") and one red button that names the first piece ("Start with Twinkle, Twinkle, Little Star"). A reader who has played a library piece before sees "Continue with" and that piece instead. Next to the button, once the library holds 100 pieces or more, sits a search field. Below them, once the library holds more than 40 pieces, one row of level pills shows one level at a time, with one gray line saying what that level asks of the hands. Inside a level of more than 12 pieces, the pieces sit under their collection names, and collections with fewer than 3 pieces in that level share a last group, "Other pieces". A row is the title with its length on the right, plus a composer line only when the composer says something the heading does not. Opening your own file is one quiet line at the end, and a file dropped anywhere on the window opens. Genre pills and folded collections belong to a library of more than 60 pieces per level, which L2 brings; at 149 pieces no level has more than 43, so neither appears, and this batch builds their data and rules but not their controls (section 8). The page loses the finger legend (it moves to the score), the top file link, the Start-here box and its repeated lines, the "editor's fingering" tags, "Traditional" and "Anonymous" on rows, the dashed drop zone with its extension list, and the "Level N:" prefixes.

## 2. Where each decision comes from

| Decision                                                                                                                                      | From                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Name, sentence, red button as the whole welcome; Start or Continue                                                                            | all three; Continue set on the first Play: beginner-first |
| Level names First steps, Easy, Moderate, Intermediate, Challenging, Advanced                                                                  | beginner-first (both judges)                             |
| Thresholds: pills above 40 pieces, search from 100, headings above 12 in view, "Other pieces" below 3                                          | beginner-first, with the "below 3" rule (judge 2)        |
| Genre vocabulary of seven, "Carols and hymns" apart from "Songs", a reserved "Modern"; a per-piece override in the catalog                      | beginner-first; the override from library-at-scale       |
| Pills wrap onto a second row instead of scrolling sideways                                                                                    | least-interface (judge 1)                                |
| A min-height on the list so a shorter level never pulls the page up                                                                           | least-interface (both judges)                            |
| The level line only when the pills show; no grade numbers on screen                                                                           | least-interface (judge 1)                                |
| While a file is dragged: a red frame over a page set to `visibility: hidden`                                                                  | least-interface (judge 1)                                |
| "Clear" as a text button in the search, no glyph                                                                                              | least-interface (both judges)                            |
| The search field after the red button, in reading and tab order                                                                              | both judges' concern about focus order                   |
| The dock: Practice shares the first row with the status line from 480 px; the keyboard keeps its width                                        | library-at-scale (both judges)                           |
| Title shortening and composer hiding pinned by a test over the whole L1 manifest                                                              | library-at-scale (both judges)                           |
| The slim library index and the lazy manifest left for L2                                                                                      | library-at-scale (judge 1)                               |
| Genre pills and folded collections specified now, built when a level first passes 60 pieces (L2), unless the user asks to see them now (open question 2 in the plan) | the judges' budget concern; the critique's section 7.3    |
| T11: letters for a whole bar when the hands come within a fifth; a lone unlettered bar between two lettered bars is lettered too               | the critique's replay (section 8.3), all three proposals; the bridge is this design's hysteresis |
| T11: no exception for a hand scrolled out of a phone's keyboard; the letters keep today's size                                                | the design review (section 15)                           |

## 3. Units

### 3.1 In reading order

| #   | Unit                                    | What it is for                                                       | Shown when                                                                       |
| --- | --------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | The name `digitus2` and the sentence    | What this is, and how it works in one line; it teaches the red rule  | Always                                                                           |
| 2   | The start row: the red button, then the search field | The one next step; finding a piece one already has in mind | The button always; the field when the library holds 100 pieces or more           |
| 3   | Level pills and the level line          | Choosing difficulty; the line says what the chosen level asks         | The library holds more than 40 pieces, and no search text is typed               |
| 4   | The list                                | The pieces                                                           | Always; its shape follows section 6                                              |
| 5   | The end line and the footer             | "Open your own MusicXML or MIDI file"; "About and licences"          | Always                                                                           |
| -   | The empty result                        | Says nothing matched and where search looks                           | Search text matches nothing                                                       |
| -   | The drop frame                          | Says the window takes the file                                        | Only while a file is dragged over the window                                     |
| -   | The notice                              | Says why a file was refused (existing, unchanged)                     | After a refusal, until dismissed                                                 |

### 3.2 What leaves today's page

| Today (critique 1.1)                                                                     | Where it goes                                                                                                     |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Finger legend, 26 words, under the welcome                                               | The score view: above the music on the score views opened before the reader's first Play; always in the side panel |
| "Open your own MusicXML file" link above the red button                                  | Gone; the end line replaces it                                                                                    |
| Start-here box: "Start here", "Twinkle, Twinkle, Little Star by Traditional", "First steps · 0:29" | Gone; the red button stays, unboxed                                                                     |
| "Level 1: First steps" headings; "2 · Easy" in the side panel                            | One name everywhere: "First steps", "Easy"                                                                        |
| A composer line on every row, "Traditional (English street cry)" and the like            | A composer line only when it tells something (section 5)                                                          |
| The length on its own line below 480 px                                                  | At the right of the title line at every width                                                                     |
| Rows 1,120 px wide at 1280                                                               | A 44rem (704 px) reading column, left-aligned with the score view's edge                                         |
| "editor's fingering" tags                                                                | Gone from the list; the score view already says when it shows the editor's digits                               |
| One flat list of 149 rows (17,477 px at 360)                                             | One level at a time                                                                                               |
| The dashed drop zone listing five extensions, "Drop" wording on phones                   | Gone; the window takes a dropped file, and the end line opens the file chooser                                    |
| Score view: 9 practice controls standing open from 480 px, "Clear loop" disabled before any loop | One "Practice" toggle in the dock at every width; the loop fields only after "Loop bars" is ticked; "Clear loop" gone |
| Score view: L and R over every pressed key                                               | Only in bars where the hands come within a fifth (section 15)                                                    |

## 4. Levels and genres

### 4.1 Level pills (one name everywhere: pill, heading, search result heading, side panel)

| Level | Name         | Was                | The level line (gray, under the pills)       | Pieces at 149 |
| ----: | ------------ | ------------------ | -------------------------------------------- | ------------: |
|     1 | First steps  | First steps        | Each hand stays in one place.                |            24 |
|     2 | Easy         | Easy               | The hands begin to move.                     |            43 |
|     3 | Moderate     | Early intermediate | More notes and wider reaches.                |            41 |
|     4 | Intermediate | Intermediate       | Faster runs and reaches of an octave.        |            27 |
|     5 | Challenging  | Stretch            | Fast passages, leaps and full chords.        |            14 |
|     6 | Advanced     | (arrives with L2)  | Concert pieces for a complete technique.     |             0 |

- Why: each is a plain word a beginner already uses, no two share a stem (critique C5: "Early intermediate" and "Intermediate" differ by a prefix a skimming eye drops), and level 6 stays "Advanced" as T5 says.
- A pill exists only for a level that holds a piece: no pill ever leads to an empty list. At 149 there are five pills.
- The lines are copy constants in `apps/web/src/library/levels.ts`. They follow the level heuristic's median features (`content/tools/level.py`) and carry no grade numbers. They go through the next teacher review (verification spec 3.12) before L2.

### 4.2 Genres

Seven genres. Two hold tunes: traditional tunes and arrangements for beginners. Five are periods of original piano music. A genre belongs to a collection; a catalog piece may override it.

| Genre id    | Pill             | The line when chosen                    | Pieces at 149 (by level)             |
| ----------- | ---------------- | --------------------------------------- | ------------------------------------ |
| `songs`     | Songs            | Well-known tunes, arranged for the piano. | 42 (L1 20, L2 21, L3 1)            |
| `carols`    | Carols and hymns | Christmas carols, hymns and spirituals. | 15 (L1 4, L2 11)                     |
| `baroque`   | Baroque          | Bach, Handel and others, 1600–1750.     | 27 (L2 4, L3 11, L4 8, L5 4)         |
| `classical` | Classical        | Mozart, Clementi and others, 1750–1820. | 18 (L2 1, L3 6, L4 8, L5 3)          |
| `romantic`  | Romantic         | Schumann, Chopin and others, 1820–1900. | 44 (L2 6, L3 23, L4 11, L5 4)        |
| `ragtime`   | Ragtime          | Scott Joplin and others, around 1900.   | 3 (L5 3)                             |
| `modern`    | Modern           | Music written since 1900.               | 0 (L2: Debussy, Bartók, the CC lane) |

Total 149. The mapping by collection id, in `catalog.json` display order:

| Collection id          | Collection                                                     | Pieces | Genre            |
| ---------------------- | -------------------------------------------------------------- | -----: | ---------------- |
| `children-songs`       | Children's songs                                               |     16 | songs            |
| `folk-songs`           | Folk songs                                                     |      9 | songs            |
| `christmas`            | Christmas carols and songs                                     |      9 | carols           |
| `hymns`                | Hymns and spirituals                                           |      6 | carols           |
| `anthems`              | National anthems                                               |      3 | songs            |
| `songs-before-1929`    | Songs before 1929                                              |      7 | songs            |
| `easy-rags`            | Ragtime, simplified                                            |      1 | songs            |
| `classical-themes`     | Classical themes, simplified                                   |      5 | songs            |
| `anna-magdalena`       | Notebook for Anna Magdalena Bach (1725)                        |     11 | baroque          |
| `handel-aylesford`     | Handel, Aylesford Pieces                                       |      1 | baroque          |
| `bach-little-preludes` | Bach, Little Preludes                                          |      7 | baroque          |
| `dances`               | Minuets, dances and rondos                                     |      2 | classical        |
| `swedish-folk-dances`  | Swedish folk dances (Traditioner af Swenska Folk-Dansar, 1814) |      1 | songs            |
| `burgmuller-op100`     | Burgmüller, 25 Easy and Progressive Studies, Op. 100           |     18 | romantic         |
| `schumann-op68`        | Schumann, Album for the Young, Op. 68                          |     12 | romantic         |
| `tchaikovsky-op39`     | Tchaikovsky, Album for the Young, Op. 39                       |      3 | romantic         |
| `sonatinas`            | Sonatinas and sonatas                                          |     15 | classical        |
| `bach-inventions`      | Bach, Inventions, BWV 772–786                                  |      7 | baroque          |
| `bach-wtc`             | Bach, The Well-Tempered Clavier                                |      1 | baroque          |
| `schumann-op15`        | Schumann, Scenes from Childhood, Op. 15                        |      3 | romantic         |
| `chopin-op28`          | Chopin, Preludes, Op. 28                                       |      3 | romantic         |
| `character-pieces`     | Romantic character pieces                                      |      6 | romantic         |
| `ragtime`              | Ragtime                                                        |      3 | ragtime          |

One per-piece override: `beethoven-fur-elise-woo-59` (in `character-pieces`, written 1810) is `classical`, so the Romantic line's dates hold for every piece.

One rule for arrangements: a simplified arrangement is Songs, whatever its source, because a beginner meets it as a tune. That covers the classical themes (Ode to Joy, Canon in D, Brahms's Lullaby) and "The Entertainer, A strain (simplified)" (`easy-rags`). The Ragtime genre is left with Joplin's three original rags in Challenging. Traditional folk material is Songs too, as `folk-songs` already is. That includes "Polska from Norrbotten" (`swedish-folk-dances`, Traditional (Swedish)), which a Classical line naming Mozart and Clementi would misname. A search for "Joplin" or "polska" still finds both pieces.

**Where the genre lives.** `content/tools/catalog.json` gains a `genres` table (`[{id, title}]`, the seven ids in the order above) beside `collections`; every collection gains `genre`; a catalog piece may carry `genre` to override its collection's. `build.py` refuses a collection without a known genre and a piece override that is not a known genre, as it already refuses an unknown collection id, and writes `genre` (the id) on every manifest entry after `collectionId`. The app's labels and lines for genres live beside the level names (`apps/web/src/library/levels.ts`), with a test that the app's ids equal the catalog's.

## 5. Rows

| Part           | Rule                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line 1         | The title (16 px, 600) at the left; the length (`m:ss`, gray, tabular figures) at the right of the first line at every width, also when the title wraps. No tags.                                                                                                                                                                                                                                         |
| Line 2         | The composer (16 px, gray), cut at the first " (" ("Lowell Mason (tune Antioch)" reads "Lowell Mason"). Left out when the composer is "Traditional…" or "Anonymous". Left out under a collection heading when every row of that group has the same composer and the heading names that composer's last name ("Schumann, Album for the Young, Op. 68"). Shown in full (cut at " (") whenever two rows in view would otherwise read the same title, "Anonymous" included. |
| Short title    | Under its own collection heading only, a title that ends in a parenthesis whose first comma-separated part is made of words that all appear in the heading loses that part: "Melody (Album for the Young, No. 1)" reads "Melody (No. 1)"; "Canon in D (simplified)" under "Classical themes, simplified" reads "Canon in D". "Progrès (Progress)" keeps its parenthesis. Flat lists, "Other pieces" and search results show full titles. |
| Accessible name | Unchanged: `Open {full title} by {full composer}`, described by the length.                                                                                                                                                                                                                                                                                                                             |
| Target         | The whole row is one button, at least 44 px tall.                                                                                                                                                                                                                                                                                                                                                         |

At 149 pieces exactly 13 titles shorten (all under their own heading): "Canon in D"; Schumann's "Melody (No. 1)", "Humming Song (No. 3)", "Little Piece (No. 5)", "Soldiers' March (No. 2)" (Easy); "The Wild Rider (No. 8)", "Poor Orphan (No. 6)", "Little Folk Song (No. 9)", "The Happy Farmer (No. 10)", "Little Study (No. 14)" (Moderate); "First Loss (No. 16)", "Knecht Ruprecht (No. 12)", "Echoes from the Theatre (No. 25)" (Intermediate). Groups whose rows drop the composer: Schumann Op. 68 (Easy, Moderate, Intermediate), Bach Little Preludes (Moderate, Intermediate), Burgmüller Op. 100 (Moderate), Bach Inventions (Intermediate, Challenging), Chopin Op. 28 (Intermediate). The three colliding title pairs stay apart: the two "Sonatina in C major, 2nd movement (Andante)" rows keep "Muzio Clementi" and "Friedrich Kuhlau"; the "Minuet in G major" and "Minuet in F major" pairs sit in different levels and, when a search shows both, both rows show their composer.

## 6. Disclosure

### 6.1 Thresholds (constants in `apps/web/src/library/disclosure.ts`, each unit-tested at its boundary)

| Constant              | Rule                                                                                                                                  | 30 pieces       | 149 pieces                            | 1,000 pieces (L2)                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------- | ------------------------------------ |
| `PILLS_ABOVE = 40`    | Level pills replace the all-levels list when the library holds more than 40 pieces                                                    | no: all levels  | yes, 5 pills                          | yes, 6 pills                         |
| `SEARCH_FROM = 100`   | The search field stands in the start row when the library holds 100 pieces or more                                                   | no              | yes                                   | yes                                  |
| `HEADINGS_ABOVE = 12` | A list section (a level, or one level of search results) of more than 12 pieces groups its rows under collection headings            | no (3 to 10)    | every level (14 to 43)                | every level                          |
| `OTHER_BELOW = 3`     | With headings, collections with fewer than 3 pieces in the section gather in a last group, "Other pieces"; if no collection has 3 or more, the section stays flat | -  | 5, 6, 6, 7 and 1 pieces in levels 1 to 5 | most levels                       |
| `GENRES_ABOVE = 60`   | The genre row appears when the chosen level holds more than 60 pieces and at least 2 genres hold `GENRE_MIN` pieces of it             | no              | no (largest level 43)                 | yes                                  |
| `GENRE_MIN = 3`       | A genre gets a pill in a level only with 3 or more pieces there                                                                       | -               | -                                     | -                                    |
| `FOLD_ABOVE = 60`     | Collections fold to one line each while the list in view holds more than 60 pieces (built in L2, section 8)                            | no              | no                                    | yes                                  |
| Counts                | Only for what is not on screen: the screen-reader status, and in L2 a folded collection's "{n} pieces". Never on pills or headings     | none visible    | none visible                          | on folded lines                      |

A threshold is crossed only by a new build of the library or by the reader's own choice. Nothing appears or vanishes while the reader looks, except the Clear button when the field gets text, the empty result, and the drop frame during a drag.

### 6.2 The list's shapes

| Shape            | When                                    | Looks like                                                                                                                 |
| ---------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| All levels       | the library holds 40 pieces or fewer    | each level a visible `h2` ("First steps") with its rows (flat, or grouped when that level has more than 12); no level line |
| One level        | more than 40 pieces, no search text     | the chosen level only: visually hidden `h2` with the level name, collection `h3`s with rows, "Other pieces" last           |
| Search results   | search text typed                       | every level with a match, in level order, each a visible `h2`, then flat or grouped by the same rule                       |
| Empty result     | search text matches nothing             | "No piece matches “{query}”." and the gray line                                                                             |

The list region has `min-height: 100vh` in the one-level shape, so a shorter level never shortens the page under the reader's finger (the scroll position is kept on a level change).

### 6.3 Selection

- **Levels:** a radio group; exactly one level is always chosen; no "All levels". The chosen level is, in order: the one chosen earlier in this visit; else the level of the last piece played (`lastPlayed`), if it is still in the library; else the lowest level present. Choosing another level replaces the list.
- **Search:** typing filters from the first character across every level. Each query word must be the start of a word of the title, the composer or the collection, ignoring case, accents and punctuation ("fur elise" finds Für Elise; "burgmuller" finds 18; "minuet" finds 9, Wanhal's Rondo through its collection "Minuets, dances and rondos"). While the field holds text the pills and the line leave; emptying it brings back the same level. No paging: at 149 the longest result list is the library itself.
- **Genres (L2, or now if the user asks):** toggle buttons, zero or one chosen; pressing the chosen one clears it; Escape in the row clears it; a level change or search text clears it.

### 6.4 Motion (existing tokens: 120 ms `--dur-fast`, 160 ms `--dur`, `--ease`; all 0 under reduced motion; heights never animate)

| Change                                    | Motion                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| A level is chosen                         | The pill's fill and text color change over 120 ms; the line and the list swap in one frame and the list fades in over 120 ms (opacity) |
| The first character of a search           | The pills and the line leave in one frame; the results fade in over 120 ms; later keystrokes swap without motion |
| The search is emptied                     | The level view returns, faded in over 120 ms                                               |
| A file is dragged over the window         | The frame fades in over 120 ms; it leaves in one frame on leave or drop                    |
| Practice opens in the dock (T1)           | The panel fades in over 160 ms with a 4 px rise; the dock grows upward in one frame; the toggle's marker turns 90° in 160 ms |
| Hand letters appear or leave (T11)        | No motion, like the pressed keys                                                           |

## 7. Wireframes

Conventions: `[Start with …]` is the red button; `(*Easy*)` a chosen pill (ink fill), `( Easy )` an unchosen one; `[ Search pieces and composers ]` the field; `----` a 1 px `--gray-2` rule; the numbers on the right are estimated tops in CSS px from the beginner-first mock and today's measurements. Task 7 of the plan measures the React build and records the numbers in `docs/app.md`; the gates in section 17 are what must hold.

### 7.1 First visit, 149 pieces

```
360 x 780
+------------------------------------------+
| digitus2                                 |   16  h1
| Finger numbers for piano music. Pick a   |   65  sentence, gray
| piece, press play, and follow the red    |
| note.                                    |
|[Start with Twinkle, Twinkle, Little Star]|  130  the one red
| [ Search pieces and composers          ] |  186  field, full width below 768
|                                          |
| (*First steps*) ( Easy ) ( Moderate )    |  254  level pills, wrapped
| ( Intermediate ) ( Challenging )         |  298
| Each hand stays in one place.            |  342  level line, gray
|                                          |
| Children's songs                         |  390  h3
| ---------------------------------------- |
| Twinkle, Twinkle, Little Star       0:29 |  425  first row
| ---------------------------------------- |
| Mary Had a Little Lamb              0:18 |
| ---------------------------------------- |
| Frère Jacques                       0:18 |
| ---------------------------------------- |
| Hot Cross Buns                      0:10 |
| ---------------------------------------- |
| Alle meine Entchen (All My Little   0:12 |
| Ducklings)                               |
+------------------------------------------+
```

```
1280 x 800 (column 44rem = 704 px, left edge at the page padding)
+------------------------------------------------------------------------------------------------+
| digitus2                                                                                       |   16
| Finger numbers for piano music. Pick a piece, press play, and follow the red note.             |   65
| [Start with Twinkle, Twinkle, Little Star]   [ Search pieces and composers ]                   |  107  red, then the field
| (*First steps*) ( Easy ) ( Moderate ) ( Intermediate ) ( Challenging )                         |  175
| Each hand stays in one place.                                                                  |  219
|                                                                                                |
| Children's songs                                                                               |  266
| --------------------------------------------------------                                       |
| Twinkle, Twinkle, Little Star                         0:29                                     |  301
| --------------------------------------------------------                                       |
| Mary Had a Little Lamb                                0:18                                     |
| --------------------------------------------------------                                       |
| ...  15 rows; then Songs before 1929 (4), Other pieces (5)                                     |
+------------------------------------------------------------------------------------------------+
```

First steps at 149: "Children's songs" (15 rows, one with a composer line: "Schlaf, Kindlein, schlaf" by Johann Friedrich Reichardt), "Songs before 1929" (Camptown Races and Oh! Susanna by Stephen Foster, Long, Long Ago, Little Brown Jug), "Other pieces" (Jingle Bells (chorus), Jolly Old Saint Nicholas, When the Saints Go Marching In, Michael, Row the Boat Ashore, Ode to Joy (simplified) by Ludwig van Beethoven). Then the end line and the footer:

```
| ---------------------------------------- |
|                                          |
| Open your own MusicXML or MIDI file      |  text button, opens the file chooser
| About and licences                       |  text button
+------------------------------------------+
```

### 7.2 A level chosen: Moderate, 149 pieces

```
360 x 780
+------------------------------------------+
| digitus2                                 |
| Finger numbers for piano music. ...      |
|[Start with Twinkle, Twinkle, Little Star]|  130  red unchanged
| [ Search pieces and composers          ] |
| ( First steps ) ( Easy ) (*Moderate*)    |  254  Moderate ink-filled
| ( Intermediate ) ( Challenging )         |
| More notes and wider reaches.            |  342
|                                          |
| Notebook for Anna Magdalena Bach (1725)  |  390  h3
| ---------------------------------------- |
| Minuet in F major                   1:36 |
| ---------------------------------------- |
| Minuet in G major                   1:55 |
| ---------------------------------------- |
| ...                                      |
+------------------------------------------+
```

```
1280 x 800
+------------------------------------------------------------------------------------------------+
| digitus2                                                                                       |
| Finger numbers for piano music. Pick a piece, press play, and follow the red note.             |
| [Start with Twinkle, Twinkle, Little Star]   [ Search pieces and composers ]                   |
| ( First steps ) ( Easy ) (*Moderate*) ( Intermediate ) ( Challenging )                         |
| More notes and wider reaches.                                                                  |
|                                                                                                |
| Notebook for Anna Magdalena Bach (1725)                                                        |
| --------------------------------------------------------                                       |
| Minuet in F major                                     1:36                                     |
| ...  then Bach, Little Preludes (3), Burgmüller, 25 Easy and Progressive Studies, Op. 100 (15),|
|      Schumann, Album for the Young, Op. 68 (5), Sonatinas and sonatas (5), Other pieces (6)    |
+------------------------------------------------------------------------------------------------+
```

### 7.3 Returning reader (last played: Minuet in G major by Christian Petzold, level Easy)

```
360 x 780
+------------------------------------------+
| digitus2                                 |
| Finger numbers for piano music. ...      |
| [Continue with Minuet in G major]        |  130  red: the label changes, nothing else
| [ Search pieces and composers          ] |
| ( First steps ) (*Easy*) ( Moderate )    |  254  the last piece's level
| ( Intermediate ) ( Challenging )         |
| The hands begin to move.                 |
|                                          |
| Folk songs                               |  h3, Easy's first collection
| ---------------------------------------- |
| Scarborough Fair                    0:30 |
+------------------------------------------+
```

At 1280 the same, on the wider rows. Easy at 149: Folk songs (9), Christmas carols and songs (7), Hymns and spirituals (4), National anthems (3), Songs before 1929 (3), Classical themes, simplified (4), Notebook for Anna Magdalena Bach (1725) (3), Schumann, Album for the Young, Op. 68 (4, rows without composer), Other pieces (6).

### 7.4 Search: "minuet" (9 results)

```
360 x 780
+------------------------------------------+
| digitus2                                 |
| Finger numbers for piano music. ...      |
|[Start with Twinkle, Twinkle, Little Star]|  red
| [ minuet                       ] [Clear] |  Clear: a text button, only while there is text
|                                          |
| Easy                                     |  h2; the pills and the line are gone
| ---------------------------------------- |
| Minuet in G major                   1:36 |
| Christian Petzold                        |
| ---------------------------------------- |
| Minuet in G minor                   1:43 |
| Christian Petzold                        |
| ---------------------------------------- |
| Minuet in D minor (Aylesford        0:48 |
| Pieces)                                  |
| George Frideric Handel                   |
| ---------------------------------------- |
| Minuet in F major                   0:48 |
| Wolfgang Amadeus Mozart                  |
| ---------------------------------------- |
| Moderate                                 |
| ---------------------------------------- |
| Minuet in F major                   1:36 |
| Anonymous                                |  shown: the title collides with Mozart's
+------------------------------------------+
```

```
1280 x 800
+------------------------------------------------------------------------------------------------+
| digitus2                                                                                       |
| Finger numbers for piano music. Pick a piece, press play, and follow the red note.             |
| [Start with Twinkle, Twinkle, Little Star]   [ minuet                   ] [Clear]              |
|                                                                                                |
| Easy                                                                                           |
| --------------------------------------------------------                                       |
| Minuet in G major                                     1:36                                     |
| Christian Petzold                                                                              |
| ...  4 rows in Easy, 5 in Moderate (Minuet in F, G, A minor, C minor; Rondo in C major)        |
+------------------------------------------------------------------------------------------------+
```

### 7.5 Empty result: "fur elize"

```
360 x 780                                     1280 x 800
+------------------------------------------+  +----------------------------------------------------------+
| digitus2                                 |  | digitus2                                                 |
| Finger numbers for piano music. ...      |  | Finger numbers for piano music. Pick a piece, ...        |
|[Start with Twinkle, Twinkle, Little Star]|  | [Start with Twinkle, ...]  [ fur elize      ] [Clear]    |
| [ fur elize                    ] [Clear] |  |                                                          |
|                                          |  | No piece matches “fur elize”.                            |
| No piece matches “fur elize”.            |  | Search looks in titles, composers and collections.      |
| Search looks in titles, composers and    |  |                                                          |
| collections.                             |  | Open your own MusicXML or MIDI file                      |
|                                          |  | About and licences                                       |
| Open your own MusicXML or MIDI file      |  +----------------------------------------------------------+
| About and licences                       |
+------------------------------------------+
```

### 7.6 A file dragged over the window, and a refused file

```
1280 x 800, a file dragged over the window        360 x 780, the wrong kind of file dropped or chosen
+--------------------------------------------+    +------------------------------------------+
|                                            |    | +--------------------------------------+ |  notice, sticky, gray
| . . . . . . . . . . . . . . . . . . . . .  |    | | That does not look like a MusicXML   | |  (unchanged)
| .                                       .  |    | | or MIDI file (.musicxml, .xml, .mxl, | |
| .        Drop to open this file         .  |    | | .mid or .midi).          [ Dismiss ] | |
| .           MusicXML or MIDI            .  |    | +--------------------------------------+ |
| .                                       .  |    | digitus2                                 |
| . . . . . . . . . . . . . . . . . . . . .  |    | ...                                      |
|                                            |    |[Start with Twinkle, Twinkle, Little Star]|  red
+--------------------------------------------+    +------------------------------------------+
  red 2 px dashed frame, 16 px inset; the page beneath is visibility: hidden
```

At 360 the frame looks the same (a tablet or a split-screen phone); a phone reaches its files through the end line. The page never mentions dropping.

### 7.7 Thirty pieces (the test fixture of the core 30; all levels, no pills, no search)

```
360 x 780                                     1280 x 800
+------------------------------------------+  +----------------------------------------------------------+
| digitus2                                 |  | digitus2                                                 |
| Finger numbers for piano music. ...      |  | Finger numbers for piano music. Pick a piece, ...        |
|[Start with Twinkle, Twinkle, Little Star]|  | [Start with Twinkle, Twinkle, Little Star]               |
|                                          |  |                                                          |
| First steps                              |  | First steps                                              |
| ---------------------------------------- |  | ----------------------------------------                 |
| Twinkle, Twinkle, Little Star       0:29 |  | Twinkle, Twinkle, Little Star            0:29            |
| Mary Had a Little Lamb              0:18 |  | Mary Had a Little Lamb                   0:18            |
| ...  then Easy, Moderate, Intermediate,  |  | ...                                                      |
|      Challenging, each an h2 with rows   |  |                                                          |
+------------------------------------------+  +----------------------------------------------------------+
```

### 7.8 One thousand pieces (L2, for reference: what the rules give; the genre row and folding are not built in this batch)

```
360 x 780, Moderate (240 pieces), first visit
+------------------------------------------+
| digitus2                                 |
| Finger numbers for piano music. ...      |
|[Start with Twinkle, Twinkle, Little Star]|
| [ Search pieces and composers          ] |
| ( First steps ) ( Easy ) (*Moderate*)    |
| ( Intermediate ) ( Challenging )         |
| ( Advanced )                             |
| More notes and wider reaches.            |
| ( Baroque ) ( Classical ) ( Romantic )   |  genre row: 240 > 60, three genres of 3 or more
|                                          |
| ---------------------------------------- |
| > Burgmüller, 25 Easy and Prog…  15 pieces|  folded collection (240 in view > 60)
| ---------------------------------------- |
| > Notebook for Anna Magdalena …  22 pieces|
+------------------------------------------+
```

## 8. At 1,000 pieces: what L2 builds on this batch

- **Genre row** (`GENRES_ABOVE`, `GENRE_MIN`, `genrePills()` from this batch): toggle buttons in a `div role="group"` named "Kind of music", 32 px tall (44 px hit area), 14 px text; chosen = the same ink fill as a chosen level pill (one chosen look for every pill); the genre's line replaces nothing, it sits under the genre row in gray.
- **Folded collections** (`FOLD_ABOVE`): each collection of 3 or more pieces in view is one line, an `h3` holding a `button aria-expanded aria-controls`, named "{title}, {n} pieces"; its rows stay in the DOM under `hidden="until-found"` (plain `hidden` where the browser lacks it), so find-in-page opens the collection that holds a match; the collection holding the reader's last piece opens on arrival; open collections last for the visit and come back on Back, before the scroll is restored. No virtual list and no `content-visibility`.
- **The slim library index**: `build.py` writes the fields the library needs (slug, title, composer, level, collection id, genre, length) to a small file the library view imports, and the full manifest moves to a lazy chunk for the score view and the about page. At 149 the entry chunk stays under the 150 KB gate (about 115 to 120 KB gzip estimated by the proposals; Task 7 measures it), so this waits.
- **Performance gates** on a generated 1,000-piece build under 4x CPU throttling: a level change paints within 100 ms, a search keystroke within 50 ms, library LCP under 2 s.

## 9. The one red element, in every state

| State                                                      | The red element                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Library, first visit, any size                             | "Start with Twinkle, Twinkle, Little Star"                         |
| Library, returning (a library piece played before)         | "Continue with {title}"                                            |
| A level chosen; search results; empty result              | The same button                                                    |
| The list scrolled past the button                         | None in view; the DOM still holds exactly one (needs the user's approval for the spec wording, plan open question 1) |
| A file dragged over the window                             | The drop frame; the page beneath, start button included, is `visibility: hidden` |
| A refused file                                             | The start button; the notice is gray                               |
| Score, ready or rewound or at the end                      | Play                                                               |
| Score, loading the piano                                   | Play (busy)                                                        |
| Score, count-in and lead-in                                | Pause                                                              |
| Score, playing                                             | The cursor's notes                                                 |
| Score, paused after a note was heard (T10)                 | The cursor's notes of the last group heard; Play is plain          |
| Score, paused before any note was heard (in the lead-in)   | Play                                                               |
| Score, Practice open or closed (T1)                        | Unchanged by Practice; the toggle is a disclosure (a marker that turns), never red |
| About; error states                                        | "Back to the library"                                              |

Chosen pills are ink-filled, never red. The hand letters, the Clear button, the search field, the notice and the end line are never red.

**For M5 (note selection), which is planned against the old paused state.** The M5 plan lets a click select a note whenever playback is not playing. It makes the selected note the one red element and assumes that "a selection never coexists with the cursor". The paused row above breaks that assumption: a click on a note while paused would give two red roots. M5 must pick a rule before it runs. This design proposes the simplest one: a note selected while paused takes the red, and the paused cursor's marks and pressed keys clear. When the selection is cleared, the paused group is marked again, because the position to resume is unchanged. Play is primary only when nothing is selected and no resume point is shown (`!playing && !selectionActive && !resumeShown`). The coordinator carries this into M5 (plan, "Deferred to the coordinator").

## 10. Exact copy

| Element                                       | Text                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Document title, `h1`                          | digitus2                                                                                 |
| Sentence                                      | Finger numbers for piano music. Pick a piece, press play, and follow the red note.       |
| Red button, first visit                       | Start with {title} (the first piece of the lowest level, in manifest order: Twinkle, Twinkle, Little Star) |
| Red button, returning                         | Continue with {title without a trailing parenthesis} ("Continue with Für Elise")          |
| Search field                                  | placeholder "Search pieces and composers"; accessible name "Search the library"          |
| Clear button                                  | "Clear"; accessible name "Clear the search"                                              |
| Level group (visually hidden legend)          | Level                                                                                    |
| Level pills                                   | First steps, Easy, Moderate, Intermediate, Challenging, Advanced                         |
| Level lines                                   | section 4.1                                                                              |
| List heading, one-level shape (visually hidden h2) | {level name}                                                                        |
| Level headings, all-levels shape and search results (visible h2) | {level name}                                                       |
| Collection heading (h3)                       | the collection's title from the manifest                                                 |
| Leftover group (h3)                           | Other pieces                                                                             |
| Row                                           | {title}, {m:ss}, the composer line when shown; accessible name "Open {full title} by {full composer}" |
| Library announcement (visually hidden `aria-live="polite"` paragraph, not `role="status"`, which the notice uses; 500 ms after the last change) | "{level name}: {n} pieces" on a level change; "{n} pieces" or "1 piece" for a search; "No piece matches “{query}”." |
| Empty result, line 1 (ink)                    | No piece matches “{query}”.                                                              |
| Empty result, line 2 (gray)                   | Search looks in titles, composers and collections.                                       |
| End line                                      | Open your own MusicXML or MIDI file                                                      |
| Footer                                        | About and licences                                                                       |
| Drop frame, line 1 (ink, 18 px, 600)          | Drop to open this file                                                                   |
| Drop frame, line 2 (gray)                     | MusicXML or MIDI                                                                         |
| Refusal notice                                | That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi). (unchanged) |
| Score, finger legend                          | Finger numbers: 1 is the thumb and 5 the little finger, in both hands. The upper staff is the right hand, the lower staff the left. (unchanged) |
| Score side panel, level                       | the level name alone ("Easy", was "2 · Easy")                                           |
| Dock toggle                                   | Practice                                                                                 |
| Loop                                          | checkbox "Loop bars"; then two fields named "Loop from bar" and "Loop to bar" with "to" between them |
| Reversed loop                                 | The loop needs "from" before "to". (unchanged)                                           |
| Genre group (L2, visually hidden)             | Kind of music                                                                            |
| Genre pills and lines (L2)                    | section 4.2                                                                              |

"Clear loop" is gone. Every other score-view text is unchanged.

## 11. Keyboard and screen reader

- **Order and landmarks.** `main` holds the page. Tab order follows reading order: the red button, the search field, Clear (while shown), the level pills (one stop), the rows, the end line's file input, the footer. The `h1` takes the focus on arrival and on Back, as today, and is not a tab stop.
- **Level pills.** A `fieldset` with the visually hidden legend "Level"; each pill a `label` around a native `input type="radio"` that covers it (the `.segmented` technique). Tab enters on the chosen pill; the arrow keys move and select, wrapping. Each radio is described (`aria-describedby`) by the level line. The focus stays on the pill while the list changes; the library announcement speaks "{level}: {n} pieces" once, 500 ms after the last change. The focus ring is 2 px ink with a 2 px offset, outside the pill.
- **Search.** A `div role="search"` holding `input type="search"` named "Search the library". Escape with text empties it (the focus stays); the native clear glyph is hidden by CSS so "Clear" is the only clear control. Clear puts the focus back in the field. The announcement speaks the count or "No piece matches “{query}”."
- **Rows.** Unchanged: a `button` in an `li`.
- **Headings.** `h1` the name; `h2` the levels (visible in the all-levels shape and in search results, visually hidden in the one-level shape); `h3` the collections and "Other pieces".
- **Own file.** The end line is a `label` styled as a text button around a visually hidden `input type="file"` (accept `.musicxml,.xml,.mxl,.mid,.midi`), so its accessible name is "Open your own MusicXML or MIDI file"; the label shows the focus ring while the input has the keyboard focus. The drop frame is `aria-hidden`; a refusal uses the existing notice.
- **Dock (T1).** "Practice" is a `button` with `aria-expanded` and `aria-controls`; Space and Enter toggle it (Space is a button's, as `TAKES_SPACE` already says). Escape with the focus inside the open panel closes it and returns the focus to the toggle. The status line stays the dock's only live region.
- **Contrast and targets.** Gray text is `--gray-3` (4.54:1 on white); rows turn their gray text ink on hover and focus, as today. Every control is at least 44 px tall to the touch.

## 12. The score view's reading aids

- **The finger legend** shows under the score header's credit line, in the 14 px `.finger-legend` style, on every score view opened while `legendSeen` is false; the first Play anywhere sets `legendSeen`. The decision is taken when the score view mounts, so the legend never vanishes under a playing cursor; the next score opened after the first Play shows no legend. It stays in the side panel always.
- **The side panel's level** reads the level name alone.

## 13. T1: the dock and Practice at every width

One "Practice" toggle in the dock at every width; nothing stands between the title and the music. The panel's controls: Tempo with its value; the Hands control; Metronome; Count-in; "Loop bars". The open state lasts for the visit (every page load starts closed); a reload closes it.

```
1280 x 800, closed (768 is the same with a narrower keyboard)
+--------------------------------------------------------------------------------+
| ... music, scrolled by the cursor ...                                          |
| ------------------------------------------------------------------------------ |
| > Practice                                                  Loading the piano… |  row 1: toggle left, status line right
| [[  Play  ]]   | # # | # # # | # # | # # # | # # | # # # | # # | # # # | # # | |  Play red while stopped
| [  Rewind  ]   |_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_| |  the keyboard keeps today's width
+--------------------------------------------------------------------------------+
```

```
1280 x 800, open, Loop bars ticked (the fields appear only now, filled with the cursor's bar and the next)
+--------------------------------------------------------------------------------+
| v Practice                                                                     |  the marker turned: open
| Tempo [=======o=======] 100 % · ♩ = 120   [#Both hands#|Right hand|Left hand]  |  panel row 1
| [ ] Metronome    [x] Count-in    [x] Loop bars [ 3 ] to [ 4 ]                  |  panel row 2
| [[  Play  ]]   | keyboard                                                    | |
| [  Rewind  ]   |                                                             | |
+--------------------------------------------------------------------------------+
```

```
360 x 780, closed                              360 x 780, open
+------------------------------------------+  +------------------------------------------+
| ... music ...                            |  | Tempo [====o====] 100 % · ♩ = 120        |
| ---------------------------------------- |  | [#Both hands#|Right hand|Left hand]      |
| Loading the piano…                       |  | [ ] Metronome   [x] Count-in             |
| [[ Play ]] [ Rewind ]  > Practice        |  | [ ] Loop bars                            |
| | # # | # # # | # # | # # # | # # |      |  | [[ Play ]] [ Rewind ]  v Practice        |
| |_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|_|      |  | keyboard                                 |
+------------------------------------------+  +------------------------------------------+
  the status line keeps its own row below 480 px, as today
```

| Width | Practice                                   | Status line                         | Keyboard            | Score's first system (estimate)  |
| ----: | ------------------------------------------ | ----------------------------------- | ------------------- | -------------------------------- |
|   360 | in the Play and Rewind row                 | its own row above, when it has text | full width, as today | about 200 px (260 today)        |
|   768 | first row of the dock, at the left         | first row, at the right             | as today            | about 180 px (292 today)         |
|  1280 | first row of the dock, at the left         | first row, at the right             | as today            | about 180 px (292 today)         |

- **Loop.** Ticking "Loop bars" shows the two fields, filled with the bar the cursor is in (bar 1 when nothing is marked) and the next bar, both clamped to the piece's last bar, and the loop applies at once. Unticking hides the fields and turns the loop off; the bars typed come back if it is ticked again in the same score view. A range typed in reverse says "The loop needs "from" before "to"." and is not applied, as today.
- **The toggle's look.** A 44 px text button in ink, 600 weight, with a small triangle marker drawn in CSS before the word (pointing right when closed, turned 90° down when open), the look of the side panel's "Details" summary. It is a disclosure, not a state: it is never filled and never red.
- **Keys and focus.** As section 11. The dock's negative `scroll-margin-bottom` covers the panel, so focusing a control in it never scrolls the page.
- **Layout.** The dock grows upward when the panel opens or the status line speaks below 480 px; from 480 px the status line shares the toggle's row, so it no longer adds 35 px. `--dock-h` (measured by `useDockHeight`) keeps the cursor above the taller dock.

## 14. T10: the paused state

- While playing, the cursor is red, as today.
- **Pause after a note was heard:** the last group heard keeps the red, its keys stay pressed on the keyboard with their fingers (and the muted hand's keys stay dimmed), and Play is plain. Pressing Play resumes from where the music stopped, as today.
- **Pause in the lead-in** (the count-in, or before the first note of the hands played): nothing was heard, nothing is marked, Play is red.
- **Rewind while paused, or the end of the piece:** the marks and the keys clear, Play is red ("at the start, there is nothing to resume").
- **While paused,** a change of hands re-marks the last group heard of the hands now played at or before that moment (or clears the marks, and Play turns red, when there is none); a re-layout (a resize) or a re-solve (hand size) re-marks the same group with the new digits.
- **The hand letters (T11)** follow the marked group's bar while paused.

## 15. T11: the hand letters

**The rule, one rule with no setting:**

1. **Close.** At each onset group of the score, take each hand's sounding keys: the notes struck there and the ones still held from earlier. The gap is the lowest right-hand key minus the highest left-hand key, in semitones; a negative gap means the hands interleave. An onset where both hands sound and the gap is **7 semitones (a perfect fifth) or less** is close.
2. **Per bar.** A bar is lettered when any of its onsets is close.
3. **Hysteresis.** A bar that is not lettered by itself, between two bars that are, is lettered too, so the letters do not leave for one bar and come back. The decision is taken from the score once per piece (both hands, whatever is muted), so it never flickers between onsets and it is the same on every run. It reads nothing of the screen, so it is also the same at 360, 768 and 1280 px.
4. **What is lettered.** While the cursor's group (playing, or paused under T10) is in a lettered bar, every pressed key and every dimmed key of the muted hand shows its L or R; both hands are lettered together, never one. Otherwise no key shows a letter.
5. **No phone exception.** A phone's keyboard scrolls, and when the hands are far apart it follows the keys struck at the cursor, so one hand can be out of view. Its visible numbers then carry no letter, like every number outside a lettered bar.
6. **Size.** Unchanged: 10 px on white keys and 9 px on black keys, 600 weight, ink, never red; dimmed with the muted hand (opacity 0.4). The change is that the letters show less often. Larger letters would make them more prominent, which works against the user's "a bit distracting".

**Why there is no phone exception.** An earlier draft lettered the visible keys whenever one hand was scrolled out of a phone's keyboard, decided per onset. The design review replayed it against today's scroll-follow (`keysToShow`, a 328 px view, 22 px white keys, as measured at 360 px). It found two problems:

- It lettered exactly the far-apart notes the user asked to leave plain.
- It switched on and off within a bar. Amazing Grace was lettered at single onsets at 14.25 s, 16.50 s and 18.00 s (bars 7 and 8), which is 6 switches where this rule gives none. The G major minuet got 11 more onsets and 10 more switches.

A bar-stable latch would have fixed the flicker but kept the first problem, so the exception is dropped. The reader still finds the hand in the score: the right hand is the upper staff and the left hand the lower one, and each red note at the cursor sits on its hand's staff. The daily UI review looks at a phone keyboard with one hand scrolled away (the G major minuet and Amazing Grace at 360 px, in bars the rule leaves plain). If a reader is lost there, the fallback is the bar-stable version: a hand out of view during a bar keeps the letters to the bar's end, keyed by the cursor group's measure index, with the same one-bar bridge.

**Why a fifth and not the TODO's octave.** `docs/TODO.md` T11 recorded "within an octave with hysteresis". The critique replayed both rules on the G major minuet (BWV Anh. 114) and Amazing Grace: in this repertoire the hands sit about an octave apart most of the time (median gap 15 semitones in the minuet) and are never confusable there; an octave per onset letters 34 % of the minuet's onsets and switches 41 times in 50 s, and an octave with hysteresis still letters 53 %. That fails the user's "only when the L and R notes are close to each other". This design replaces the TODO's threshold; the coordinator updates T11 (plan, "Deferred to the coordinator").

**Replayed on the library (engine parse of `content/scores/`, this design's rule):**

| Piece                                   | Bars | Bars lettered (0-based measure index)                     | Onset groups lettered | Switches |
| --------------------------------------- | ---: | --------------------------------------------------------- | --------------------: | -------: |
| Twinkle, Twinkle, Little Star           |   12 | 3 to 7, 11                                                |            20 of 42   |        3 |
| Amazing Grace                           |   15 | none                                                      |             0 of 35   |        0 |
| Happy Birthday                          |    9 | 2, 3                                                      |             6 of 25   |        2 |
| Ode to Joy                              |   16 | 1 to 10, 13 to 15                                         |            51 of 62   |        3 |
| Minuet in G major (BWV Anh. 114)        |   32 | 0, 6, 7, 11, 14, 24 to 27, 31                             |           44 of 137   |       11 |
| Arabesque (Burgmüller)                  |   33 | 2, 3, 17 to 20, 23 to 27                                  |           45 of 140   |        6 |
| Mozart, K. 545, 1st movement            |   73 | 36 bars close, 38 lettered                                |          514 of 990   |       20 |

Without the bridge (rule 3) Twinkle switches 7 times and Ode to Joy 11 times in 36 s; with it, 3 and 3. Today every one of these pieces shows letters on every pressed key. The table holds at every width, phones included, because rule 5 adds nothing on a phone.

## 16. Persisted and visit state

| Field           | Kept                                   | Set by                                                         | Fallback                                                       |
| --------------- | -------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| `lastPlayed`    | persisted in the settings (`digitus2.settings.v1`, validated on load) | every Play of a library piece (`markPlayed`); never a dropped file | a slug no longer in the library acts as none: "Start with …", the lowest level |
| `legendSeen`    | persisted in the settings              | the first Play anywhere                                        | false                                                          |
| `libraryLevel`  | the visit                              | a level pill                                                   | `lastPlayed`'s level, else the lowest level                    |
| `libraryQuery`  | the visit                              | the search field                                               | empty                                                          |
| `practiceOpen`  | the visit                              | the Practice toggle                                            | closed                                                         |
| `libraryScrollY`| the visit (exists)                     | leaving the library                                            | 0                                                              |

Back from a score restores the level, the query and then the scroll (within 50 px, the existing test). The settings keep their storage key and version; the existing merge validates every field, so older payloads load with the new fields at their defaults.

## 17. Acceptance gates (measured on the React build, desktop 1280 x 900 and mobile 360 x 740 Playwright projects)

| Gate                                                                                                   | Where it is tested               |
| ------------------------------------------------------------------------------------------------------ | -------------------------------- |
| Exactly one red root in every library state: first visit, a level chosen, returning, search, empty, drag, notice | `e2e/states.spec.ts`     |
| No horizontal page scroll at 360, 768 and 1280 in every library state                                  | `e2e/states.spec.ts`, `library.spec.ts` |
| First visit at 149: the red button's top at most 160 px at 360 and 130 px at 1280; the first row's top at most 470 px at 360 and 330 px at 1280 | `e2e/library.spec.ts` |
| Every level pill wholly inside the viewport at 360 (they wrap; none cut off)                           | `e2e/library.spec.ts`            |
| The red button comes before the search field in the tab order                                          | `e2e/library.spec.ts`            |
| Back restores the level and the scroll within 50 px                                                    | `e2e/library.spec.ts`            |
| Library LCP under 2 s; the entry chunk under 150 KB gzip                                                | existing gates                   |
| Zero serious or critical axe violations in every state                                                 | existing helper                  |
| Score view, with the legend already seen: the first system's top at most 240 px at 360 and 220 px at 768 and 1280; from 480 px the dock's height does not change when the status line gets text; the keyboard as wide as before | `e2e/states.spec.ts` (Task 4) |
| Paused: one red root, the cursor's group; keys still pressed; Rewind gives Play the red                | `e2e/playback.spec.ts` (Task 5)  |
| Letters, on the desktop and mobile projects: none in Amazing Grace from its first bar to its last (sampled past 19 s, through bars 7 and 8); none in Twinkle's bars 1 to 3, both L and R in its bar 4 | `e2e/hand-letters.spec.ts` (Task 6) |

## 18. Changes to the product spec (coordinator, after the batch)

Spec section 9 ("Web app"), view 1 and the minimalism paragraph:

- The welcome is the name, one sentence and one red button ("Start with …", or "Continue with …" for a reader who has played a library piece); the Start-here card is gone. The level names are First steps, Easy, Moderate, Intermediate, Challenging and Advanced, one name everywhere.
- The library's disclosure thresholds: level pills above 40 pieces, search from 100 pieces, collection headings in a list section above 12 pieces, genre pills and folded collections above 60 pieces in a level.
- A file dragged over the window is the one red element's moment: the drop frame is red and the page beneath is hidden.
- Pending the user's answer: "A scrolled list may show no red element; the red element is never made sticky." (It is already the case: the red is in view for 12 % of the 30-piece scroll and about 2 % of the 149-piece scroll.)
- Score view: the practice controls fold into one "Practice" toggle in the dock at every width; while paused away from the start the last group heard keeps the red and Play is plain; the keyboard letters the hands only in bars where they come within a fifth.

## Sources

- Design critique, 2026-10-14: `docs/reviews/design-2026-10-14.md` (today's measurements, the library facts, the T11 replay).
- The three proposals in `docs/superpowers/design/` and the judges' verdicts (workflow run, 2026-10-14).
- WAI-ARIA Authoring Practices, radio group: https://www.w3.org/WAI/ARIA/apg/patterns/radio/
- WAI-ARIA Authoring Practices, disclosure: https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
- WAI-ARIA Authoring Practices, accordion (L2 folding): https://www.w3.org/WAI/ARIA/apg/patterns/accordion/
- MDN, `hidden="until-found"` (L2 folding): https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/hidden
- WCAG 2.2, Understanding focus order: https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html
- WCAG 2.2, Understanding target size (minimum): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- Apple Human Interface Guidelines, search fields: https://developer.apple.com/design/human-interface-guidelines/search-fields
