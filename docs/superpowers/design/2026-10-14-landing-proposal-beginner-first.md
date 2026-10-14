# Landing page proposal: beginner first

- Date: 2026-10-14
- Angle: beginner first. Every element is judged by the moment a first-time visitor needs it. The first ten seconds hold one sentence and one obvious place to start; the shortest path to hearing a fingered piece is two taps (the red button, then the red Play). Everything else earns its place later, and only once the library is long enough to need it.
- Scope: the library view (the landing page) of the UI batch (T6), the Practice controls in the score view's dock (T1, section 10), and a short note on the hand letters (T11, the request that started this run, section 10.5).
- Status: a proposal, one of three. No product code was changed.
- Inputs read: the design critique `docs/reviews/design-2026-10-14.md` and its screenshots; the product spec `docs/superpowers/specs/2026-10-13-digitus2-design.md` sections 3, 5, 9 and 12; `docs/TODO.md` (T1, T6, T8; T10 and T11 as recorded on `main`); `docs/reviews/ui-2026-10-14.md`; `docs/app.md`; `apps/web/src/library/LibraryView.tsx`, `apps/web/src/app/App.tsx`, `Transport.tsx`, `ScoreView.tsx`, `store.ts`, `tokens.css`, `base.css`; the L1 manifest (`thingamajig-wt/library-150/content/manifest.json`, 149 pieces), its `manifest.ts`, and `content/tools/catalog.json` (the `collections` table with `kind: set | genre`).
- Method: a throwaway HTML mock of this design, using the app's tokens and font stack, filled with the real 30-piece and 149-piece manifests and with a synthetic 1,000-piece library shaped like L1 (levels 1 to 6, 93 collections, 100 to 240 pieces per level). Playwright's Chromium measured it at 360 x 780 and 1280 x 800 by reading the DOM: boxes, row counts and element counts. The numbers for today's page come from the critique. The current score view's dock was measured on `http://localhost:5174`. The mock and its scripts stay in the session's scratch folder and are not part of the repository.

## 1. The page in one paragraph

A first-time visitor reads three things: the name, one sentence ("Pick a piece, press play, and follow the red note.") and one red button that names the first piece ("Start with Twinkle, Twinkle, Little Star"). Two taps later they hear a fingered piece. Below the button is the library, and once it is too long to scroll (more than 40 pieces) it shows one level at a time. A row of level pills opens on First steps, one gray line says what that level asks of the hands, and the level's pieces sit under their collection names. Each row is a title with its length on the right; a composer line appears only when it tells the reader something. A returning reader's red button reads "Continue with" and the piece they last played, and the pills open on that piece's level. From 100 pieces a search field sits on the name's line. Genre pills and collapsed collections appear only inside a level of more than 60 pieces, which no level reaches at 149, so the next build adds only level pills, collection headings and search. Opening your own file is one quiet line at the end, plus a drop anywhere on the window. The page drops the finger legend (it moves to the score), the top file link, the Start-here box with its repeated lines, the "editor's fingering" tags, "Traditional" and "Anonymous" on rows, the dashed drop zone with its extension list, and the "Level N:" prefixes.

## 2. Information architecture

### 2.1 The units, in reading order

| #   | Unit                                                  | What it is for                                                                            | Shown when                                                                                   |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Title line: the name `digitus2`, and the search field | Where am I; find a piece I already know by name                                           | Name: always. Field: from 100 pieces, or once a key is typed (section 5)                     |
| 2   | The sentence                                          | What this is and how it works, in 15 words; it teaches the red rule                       | Always                                                                                       |
| 3   | The red button                                        | The one next step: the first piece, or the piece being practised                          | Always (its label changes for a returning reader)                                            |
| 4   | Level pills and the level line                        | Choose difficulty; one gray line says what the chosen level asks of the hands             | More than 40 pieces. At 40 or fewer: each level is a heading with its line, all levels shown |
| 5   | Genre pills and the genre line                        | Narrow a big level by kind of music                                                       | The chosen level holds more than 60 pieces and at least two genres                           |
| 6   | The list                                              | The pieces: plain rows, rows under collection headings, or collapsed collections, by size | Always; its form follows section 5                                                           |
| 7   | "Open your own MusicXML or MIDI file"                 | The rare own-file path, found once, at the end                                            | Always, as one quiet line                                                                    |
| 8   | "About and licences"                                  | Licences and attributions                                                                 | Always, last                                                                                 |
| -   | Search results or the empty result                    | Replace units 4 to 6 while the field holds text                                           | While searching                                                                              |
| -   | Drop overlay                                          | Says the window takes the file                                                            | Only while a file is dragged over the window                                                 |
| -   | Notice                                                | Says why a file was refused (existing, unchanged)                                         | After a refusal, until dismissed                                                             |

A row has two parts: line 1 is the title, with the length right-aligned (tabular figures, gray); line 2 is the composer, in gray, shown only when it says something. The composer is cut at the first " (": "Lowell Mason (tune Antioch)" reads "Lowell Mason". It is left out for "Traditional" and "Anonymous" (42 of 149 rows) and under the heading of a one-composer set such as "Schumann, Album for the Young, Op. 68" (10 collections). Under its own collection heading, a title drops a trailing parenthesis whose first part, of two words or more, repeats the heading. "Melody (Album for the Young, No. 1)" becomes "Melody" (20 titles qualify at 149). If two rows under one heading would then read the same, both keep the full title. The score view always shows the full title and the full attribution.

### 2.2 What disappears from today's page

| Today (critique section 1.1, numbers at 360 px)                                                                     | Where it goes                                                                                                                                                       | Critique |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Finger legend, 26 words, 61 px                                                                                      | Off the library. In the score view it shows above the music until the reader first presses Play, and it stays in the side panel                                     | C1       |
| "Open your own MusicXML file" link above the red button, 44 px                                                      | Gone. One quiet line at the end replaces it                                                                                                                         | C2       |
| Start-here box: heading "Start here", "Twinkle, Twinkle, Little Star by Traditional", "First steps · 0:29" (206 px) | Gone. The red button stays, unboxed. Twinkle is named twice on a phone's first screen (button and first row), not three times                                       | C3       |
| "Level 1: First steps" headings, "2 · Easy" in the side panel                                                       | One name everywhere: "First steps", "Easy" and so on, followed by one line that says what the level asks of the hands                                               | C5       |
| Composer line on every row, "Traditional (…)" attributions                                                          | Composer only when it says something (section 2.1); the collection heading says it once                                                                             | C6       |
| Length on its own line below 480 px (rows of 103 px)                                                                | Length at the right of the title line at every width: 76 of 149 rows are one line (48 px), 41 two lines, 29 three, 3 four (today 52 rows run to four lines or more) | C7       |
| Rows 1,120 px wide at 1280                                                                                          | A 44 rem (704 px) reading column, left-aligned with the score view's edge                                                                                           | C8       |
| "editor's fingering" tags (8 of 30 rows, 33 of 149)                                                                 | Gone from the list. The score view already says when it shows the editor's digits                                                                                   | C9       |
| One flat list (17,477 px at 360 with 149 pieces)                                                                    | One level at a time, with collections inside it (section 5)                                                                                                         | C10      |
| Dashed drop zone listing five extensions, "Drop" wording on phones (140 px)                                         | Gone. The whole window takes a dropped file; the frame appears only while a file is dragged over it                                                                 | C2       |
| Score view: 9 practice controls standing open from 480 px, "Clear loop" disabled before any loop                    | Folded into the dock's Practice toggle at every width; the loop fields appear only after "Loop bars" is ticked; "Clear loop" is gone (section 10)                   | C13      |

### 2.3 Before the first piece, measured

| Measure                              | Today, 30 pieces (critique) | Proposal, 30 pieces |     Proposal, 149 pieces |
| ------------------------------------ | --------------------------: | ------------------: | -----------------------: |
| Units before the first row           |                           8 |                   5 |                        6 |
| Words before the first row           |                          64 |                  30 |                       36 |
| Red button top at 360 / 1280 (px)    |                   385 / 318 |           130 / 107 |                130 / 107 |
| First row top at 360 / 1280 (px)     |             about 509 / 441 |           265 / 241 |                325 / 301 |
| Rows fully on the first screen, 360  |                           2 |                   7 |                        8 |
| Rows fully on the first screen, 1280 |                           4 |                   8 |                       10 |
| Page height at 360 (screens of 780)  |                 4,233 (5.4) |         2,959 (3.8) | 2,030 (2.6), First steps |

The 149-piece page height is that of the level shown. The longest level, Easy, is 3,846 px at 360 (4.9 screens); today all 149 pieces make 17,477 px (22.4 screens).

## 3. Wireframes

Conventions: `[Start with …]` is the red button (the page's one red element); `( Easy )` is a pill and `(*Easy*)` the chosen pill, ink-filled; `[ Search ]` is a field; `----` is a 1 px gray-2 rule; the numbers on the right are measured tops in CSS pixels. The type in the frames is wider than the real type: at 1280, lines that run past the 44 rem column are drawn wider than they render. Positions are measured and the drawing is schematic. At 360 the level pill row is cut by the screen edge on purpose (it scrolls sideways, section 4.4).

### 3.1 First visit, 30 pieces (no pills, no search field)

```
360 x 780, 30 pieces, first visit
+------------------------------------------+
| digitus2                                 |  16  h1
|                                          |
| Finger numbers for piano music. Pick a   |  68  sentence, gray
| piece, press play, and follow the red    |
| note.                                    |
|                                          |
|[Start with Twinkle, Twinkle, Little Star]|  130  the one red (293 x 44 px)
|                                          |
| First steps                              |  206  h2
| Each hand stays in one place.            |       level line, gray
| ---------------------------------------- |
| Twinkle, Twinkle, Little Star       0:29 |  265  first row
| ---------------------------------------- |
| Mary Had a Little Lamb              0:18 |
| ---------------------------------------- |
| Ode to Joy (simplified)             0:36 |
| Ludwig van Beethoven                     |
| ---------------------------------------- |
| Frère Jacques                       0:18 |
| ---------------------------------------- |
| Jingle Bells (chorus)               0:32 |
| James Lord Pierpont                      |
| ---------------------------------------- |
|                                          |
| Easy                                     |  ~590
| The hands begin to move. Grades 1 and 2. |
+------------------------------------------+
```

```
1280 x 800, 30 pieces, first visit (column 44 rem = 704 px, left edge at 80 px)
+------------------------------------------------------------------------------------------------+
|      digitus2                                                                                  |  16
|      Finger numbers for piano music. Pick a piece, press play, and follow the red note.        |  68
|                                                                                                |
|      [Start with Twinkle, Twinkle, Little Star]                                                |  107  red
|                                                                                                |
|      First steps                                                                               |  183
|      Each hand stays in one place.                                                             |
|      --------------------------------------------------------                                  |
|       Twinkle, Twinkle, Little Star                      0:29                                  |  241  first row
|      --------------------------------------------------------                                  |
|       Mary Had a Little Lamb                             0:18                                  |
|      --------------------------------------------------------                                  |
|       Ode to Joy (simplified)                            0:36                                  |
|       Ludwig van Beethoven                                                                     |
|      --------------------------------------------------------                                  |
|       Frère Jacques                                      0:18                                  |
|      --------------------------------------------------------                                  |
|       Jingle Bells (chorus)                              0:32                                  |
|       James Lord Pierpont                                                                      |
|      --------------------------------------------------------                                  |
|                                                                                                |
|      Easy                                                                                      |  ~565
+------------------------------------------------------------------------------------------------+
```

Below the fold: Easy (10), Moderate (7), Intermediate (5), Challenging (3), each a heading with its line, then the end line and the footer. The page is 2,959 px at 360 (3.8 screens; today 4,233) and 2,797 px at 1280 (3.5; today 3,166).

### 3.2 First visit, 149 pieces (level pills and search field; headings inside the level)

```
360 x 780, 149 pieces, first visit
+------------------------------------------+
| digitus2       [ Search              ]   |  16  h1 + search field
|                                          |
| Finger numbers for piano music. Pick a   |  68
| piece, press play, and follow the red    |
| note.                                    |
|                                          |
|[Start with Twinkle, Twinkle, Little Star]|  130  red
|                                          |
| (*First steps*) ( Easy ) ( Moderate ) ( I|  190  level pills, scroll sideways
| Each hand stays in one place.            |  234  level line
|                                          |
| Children's songs                         |  290  h3 collection
| ---------------------------------------- |
| Twinkle, Twinkle, Little Star       0:29 |  325  first row
| ---------------------------------------- |
| Mary Had a Little Lamb              0:18 |
| ---------------------------------------- |
| Frère Jacques                       0:18 |
| ---------------------------------------- |
| Hot Cross Buns                      0:10 |
| ---------------------------------------- |
| Alle meine Entchen (All My Little   0:12 |
| Ducklings)                               |
| ---------------------------------------- |
| Lightly Row (Hänschen klein)        0:19 |
| ---------------------------------------- |
| Au clair de la lune                 0:34 |
| ---------------------------------------- |
| ...  8 rows on this screen               |
+------------------------------------------+
```

```
1280 x 800, 149 pieces, first visit
+------------------------------------------------------------------------------------------------+
|      digitus2                            [ Search          ]                                   |  16
|      Finger numbers for piano music. Pick a piece, press play, and follow the red note.        |  68
|                                                                                                |
|      [Start with Twinkle, Twinkle, Little Star]                                                |  107  red
|                                                                                                |
|      (*First steps*) ( Easy ) ( Moderate ) ( Intermediate ) ( Challenging )                    |  167  level pills
|      Each hand stays in one place.                                                             |  211
|                                                                                                |
|      Children's songs                                                                          |  266  h3
|      --------------------------------------------------------                                  |
|       Twinkle, Twinkle, Little Star                      0:29                                  |  301  first row
|      --------------------------------------------------------                                  |
|       Mary Had a Little Lamb                             0:18                                  |
|      --------------------------------------------------------                                  |
|       Frère Jacques                                      0:18                                  |
|      --------------------------------------------------------                                  |
|       Hot Cross Buns                                     0:10                                  |
|      --------------------------------------------------------                                  |
|       ...  10 rows on this screen; then Songs before 1929 (4), Other pieces (5)                |
+------------------------------------------------------------------------------------------------+
```

First steps holds Children's songs (15), Songs before 1929 (4) and Other pieces (5: two Christmas songs, two spirituals and Ode to Joy). That is 2,030 px at 360 (2.6 screens) and 1,938 px at 1280.

### 3.3 First visit, 1,000 pieces (genre pills, collapsed collections)

```
360 x 780, 1,000 pieces (synthetic, levels 1 to 6), first visit
+------------------------------------------+
| digitus2       [ Search              ]   |  16
|                                          |
| Finger numbers for piano music. Pick a   |
| piece, press play, and follow the red    |
| note.                                    |
|                                          |
|[Start with Twinkle, Twinkle, Little Star]|  130  red
|                                          |
| (*First steps*) ( Easy ) ( Moderate ) ( I|  190  6 level pills
| Each hand stays in one place.            |
| ( Songs ) ( Carols and hymns )           |  266  genre pills: level 1 holds 120
|                                          |
| ---------------------------------------- |
| Children's songs               30 pieces |  327  collapsed collection
| ---------------------------------------- |
| Hymns and spirituals            6 pieces |
| ---------------------------------------- |
| Songs before 1929               4 pieces |
| ---------------------------------------- |
| Children's songs, book 2       15 pieces |
| ---------------------------------------- |
| Christmas carols, book 2        4 pieces |
| ---------------------------------------- |
| ...  13 rows for 120 pieces, 1.5 screens |
+------------------------------------------+
```

```
1280 x 800, 1,000 pieces, first visit
+------------------------------------------------------------------------------------------------+
|      digitus2                            [ Search          ]                                   |  16
|      Finger numbers for piano music. Pick a piece, press play, and follow the red note.        |
|                                                                                                |
|      [Start with Twinkle, Twinkle, Little Star]                                                |  107  red
|                                                                                                |
|      (*First steps*) ( Easy ) ( Moderate ) ( Intermediate ) ( Challenging ) ( Advanced )       |  167
|      Each hand stays in one place.                                                             |
|      ( Songs ) ( Carols and hymns )                                                            |  242
|                                                                                                |
|      --------------------------------------------------------                                  |
|       Children's songs                              30 pieces                                  |  303
|      --------------------------------------------------------                                  |
|       Hymns and spirituals                           6 pieces                                  |
|      --------------------------------------------------------                                  |
|       Songs before 1929                              4 pieces                                  |
|      --------------------------------------------------------                                  |
|       Children's songs, book 2                      15 pieces                                  |
|      --------------------------------------------------------                                  |
|       ...  13 rows, 1,074 px: the whole level on 1.3 screens                                   |
+------------------------------------------------------------------------------------------------+
```

The collection names and counts come from the synthetic library and are placeholders for L2's real collections. Tapping a collection opens its rows in place, indented 16 px under it (section 5). Every level of the synthetic 1,000 fits in 1.5 to 3.0 phone screens while collapsed (table 9.1).

### 3.4 Pills active

149 pieces, Easy chosen. The level holds 43 pieces, not more than 60, so there is no genre row and rows show under 9 collection headings:

```
360 x 780, 149 pieces: Easy chosen (43 pieces, 9 headings, no genre row)
+------------------------------------------+
| digitus2       [ Search              ]   |  16
|                                          |
| Finger numbers for piano music. Pick a   |
| piece, press play, and follow the red    |
| note.                                    |
|                                          |
|[Start with Twinkle, Twinkle, Little Star]|  130  red
|                                          |
| ( First steps ) (*Easy*) ( Moderate ) ( I|  190  Easy ink-filled
| The hands begin to move. Grades 1 and 2. |  234
|                                          |
| Christmas carols and songs               |  290  h3
| ---------------------------------------- |
| Silent Night (Stille Nacht)         0:26 |  325  first row
| Franz Xaver Gruber                       |
| ---------------------------------------- |
| Joy to the World                    0:25 |
| Lowell Mason                             |
| ---------------------------------------- |
| O Come, All Ye Faithful (Adeste     0:54 |
| Fideles)                                 |
| John Francis Wade                        |
| ---------------------------------------- |
| Deck the Halls                      0:44 |
| ---------------------------------------- |
| Good King Wenceslas                 0:41 |
| ---------------------------------------- |
+------------------------------------------+
```

```
1280 x 800, 149 pieces: Easy chosen (43 pieces, 9 headings, no genre row)
+------------------------------------------------------------------------------------------------+
|      digitus2                            [ Search          ]                                   |  16
|      Finger numbers for piano music. Pick a piece, press play, and follow the red note.        |
|                                                                                                |
|      [Start with Twinkle, Twinkle, Little Star]                                                |  107  red
|                                                                                                |
|      ( First steps ) (*Easy*) ( Moderate ) ( Intermediate ) ( Challenging )                    |  167
|      The hands begin to move. Grades 1 and 2.                                                  |
|                                                                                                |
|      Christmas carols and songs                                                                |  266
|      --------------------------------------------------------                                  |
|       Silent Night (Stille Nacht)                        0:26                                  |
|       Franz Xaver Gruber                                                                       |
|      --------------------------------------------------------                                  |
|       Joy to the World                                   0:25                                  |
|       Lowell Mason                                                                             |
|      --------------------------------------------------------                                  |
|       O Come, All Ye Faithful (Adeste Fideles)           0:54                                  |
|       John Francis Wade                                                                        |
|      --------------------------------------------------------                                  |
|       Deck the Halls                                     0:44                                  |
|      --------------------------------------------------------                                  |
|       ...  then Hymns and spirituals, Songs before 1929, Classical themes, Folk songs, ...     |
+------------------------------------------------------------------------------------------------+
```

1,000 pieces, Moderate (240 pieces, so genre pills show) and Classical chosen (31 pieces, so the collections expand into headings with rows):

```
360 x 780, 1,000 pieces: Moderate and Classical chosen (31 pieces, so rows show)
+------------------------------------------+
| digitus2       [ Search              ]   |  16
|                                          |
| Finger numbers for piano music. Pick a   |
| piece, press play, and follow the red    |
| note.                                    |
|                                          |
|[Start with Twinkle, Twinkle, Little Star]|  130  red stays
|                                          |
| ( First steps ) ( Easy ) (*Moderate*) ( I|  190
| More notes, wider reaches. Grades 2 to 4.|
| ( Baroque ) (*Classical*) ( Romantic )   |  266
| Mozart, Clementi and others, 1750–1820.  |  310  genre line
|                                          |
| Sonatinas and sonatas                    |  365  h3
| ---------------------------------------- |
| Sonatina in C major, 1st            2:18 |
| movement (Spiritoso)                     |
| Muzio Clementi                           |
| ---------------------------------------- |
| Sonatina in C major, 1st            1:51 |
| movement                                 |
| Johann Anton André                       |
| ---------------------------------------- |
+------------------------------------------+
```

```
1280 x 800, 1,000 pieces: Moderate and Classical chosen (31 pieces, so rows show)
+------------------------------------------------------------------------------------------------+
|      digitus2                            [ Search          ]                                   |  16
|      Finger numbers for piano music. Pick a piece, press play, and follow the red note.        |
|                                                                                                |
|      [Start with Twinkle, Twinkle, Little Star]                                                |  107  red
|                                                                                                |
|      ( First steps ) ( Easy ) (*Moderate*) ( Intermediate ) ( Challenging ) ( Advanced )       |  167
|      More notes, wider reaches. Grades 2 to 4.                                                 |  211
|      ( Baroque ) (*Classical*) ( Romantic )                                                    |  242
|      Mozart, Clementi and others, 1750–1820.                                                   |  286
|                                                                                                |
|      Sonatinas and sonatas                                                                     |  342  h3
|      --------------------------------------------------------                                  |
|       Sonatina in C major, 1st movement (Spiritoso)      2:18                                  |  377  first row
|       Muzio Clementi                                                                           |
|      --------------------------------------------------------                                  |
|       Sonatina in C major, 1st movement                  1:51                                  |
|       Johann Anton André                                                                       |
|      --------------------------------------------------------                                  |
|       Sonatina in C major, 2nd movement (Andante)        0:51                                  |
|       Muzio Clementi                                                                           |
|      --------------------------------------------------------                                  |
|       Sonatina in C major, 3rd movement (Vivace)         1:19                                  |
|       Muzio Clementi                                                                           |
|      --------------------------------------------------------                                  |
+------------------------------------------------------------------------------------------------+
```

### 3.5 Search active

```
360 x 780, 149 pieces, "minuet" typed (9 results)
+------------------------------------------+
| digitus2       [ minuet            (x) ] |  16  field keeps its place
|                                          |
| Finger numbers for piano music. Pick a   |
| piece, press play, and follow the red    |
| note.                                    |
|                                          |
|[Start with Twinkle, Twinkle, Little Star]|  130  red
|                                          |
| Easy                                     |  206  pills gone; levels head the results
| ---------------------------------------- |
| Minuet in G major                   1:36 |  241  first result
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
|                                          |
| Moderate                                 |
| ---------------------------------------- |
| Minuet in F major                   1:36 |
+------------------------------------------+
```

```
1280 x 800, 149 pieces, "minuet" typed
+------------------------------------------------------------------------------------------------+
|      digitus2                            [ minuet      (x) ]                                   |  16
|      Finger numbers for piano music. Pick a piece, press play, and follow the red note.        |
|                                                                                                |
|      [Start with Twinkle, Twinkle, Little Star]                                                |  107  red
|                                                                                                |
|      Easy                                                                                      |  183
|      --------------------------------------------------------                                  |
|       Minuet in G major                                  1:36                                  |  218
|       Christian Petzold                                                                        |
|      --------------------------------------------------------                                  |
|       Minuet in G minor                                  1:43                                  |
|       Christian Petzold                                                                        |
|      --------------------------------------------------------                                  |
|       Minuet in D minor (Aylesford Pieces)               0:48                                  |
|       George Frideric Handel                                                                   |
|      --------------------------------------------------------                                  |
|       Minuet in F major                                  0:48                                  |
|       Wolfgang Amadeus Mozart                                                                  |
|      --------------------------------------------------------                                  |
|                                                                                                |
|      Moderate                                                                                  |
|      --------------------------------------------------------                                  |
|       Minuet in F major                                  1:36                                  |
|      --------------------------------------------------------                                  |
|       Minuet in G major                                  1:55                                  |
|      --------------------------------------------------------                                  |
+------------------------------------------------------------------------------------------------+
```

Results come from every level, grouped under the level names, at most 60 in the DOM, then "Show 60 more". The two "Minuet in G major" rows are told apart by their level and by Petzold's name; the anonymous one has no composer line.

### 3.6 An empty result

```
360 x 780, "fur elize" typed, no match
+------------------------------------------+
| digitus2       [ fur elize         (x) ] |  16
|                                          |
| Finger numbers for piano music. Pick a   |
| piece, press play, and follow the red    |
| note.                                    |
|                                          |
|[Start with Twinkle, Twinkle, Little Star]|  130  red
|                                          |
| No piece matches "fur elize".            |  190
| Search for part of a title or a          |
| composer's name.                         |
|                                          |
|                                          |
| Open your own MusicXML or MIDI file      |    end line follows
| About and licences                       |
+------------------------------------------+
```

```
1280 x 800, "fur elize" typed, no match
+------------------------------------------------------------------------------------------------+
|      digitus2                            [ fur elize   (x) ]                                   |  16
|      Finger numbers for piano music. Pick a piece, press play, and follow the red note.        |
|                                                                                                |
|      [Start with Twinkle, Twinkle, Little Star]                                                |  107  red
|                                                                                                |
|      No piece matches "fur elize".                                                             |  167
|      Search for part of a title or a composer's name.                                          |
|                                                                                                |
|                                                                                                |
|      Open your own MusicXML or MIDI file                                                       |
|      About and licences                                                                        |
+------------------------------------------------------------------------------------------------+
```

### 3.7 A dropped file

While a file is dragged over the window, the overlay covers the page and its dashed frame is the red element. Dropping a MusicXML or MIDI file opens it in the score view, as today. A refused file brings back the page with the existing notice.

```
1280 x 800, a file dragged over the window
+------------------------------------------------------------------------------------------------+
|                                                                                                |
| . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .  |
| .                                                                                           .  |
| .                                                                                           .  |
| .                                                                                           .  |
| .                                   Drop to open this file                                  .  |  red dashed frame, 16 px inset
| .                                      MusicXML or MIDI                                     .  |
| .                                                                                           .  |
| .                                                                                           .  |
| .                                                                                           .  |
| . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .  |
|                                                                                                |
+------------------------------------------------------------------------------------------------+
```

```
360 x 780, a file dragged over the window (a tablet, or a phone in split view)
+------------------------------------------+
|                                          |
| . . . . . . . . . . . . . . . . . . . .  |
| .                                     .  |
| .                                     .  |
| .        Drop to open this file       .  |  red dashed frame
| .           MusicXML or MIDI          .  |
| .                                     .  |
| .                                     .  |
| . . . . . . . . . . . . . . . . . . . .  |
|                                          |
+------------------------------------------+
```

```
360 x 780, the wrong kind of file dropped or chosen
+------------------------------------------+
| +--------------------------------------+ |  0  notice, sticky, gray (unchanged)
| | That does not look like a MusicXML   | |
| | or MIDI file (.musicxml, .xml, .mxl, | |
| | .mid or .midi).          [ Dismiss ] | |
| +--------------------------------------+ |
| digitus2       [ Search              ]   |
| ...                                      |
|[Start with Twinkle, Twinkle, Little Star]|  red, unchanged
+------------------------------------------+
```

On a phone the path is the end line, "Open your own MusicXML or MIDI file", which opens the system file chooser (the `accept` list keeps the five extensions). The page never mentions dropping.

### 3.8 Returning reader

```
360 x 780, 149 pieces, returning (last played: Minuet in G major, Petzold)
+------------------------------------------+
| digitus2       [ Search              ]   |  16
|                                          |
| Finger numbers for piano music. Pick a   |
| piece, press play, and follow the red    |
| note.                                    |
|                                          |
| [Continue with Minuet in G major]        |  130  red
|                                          |
| ( First steps ) (*Easy*) ( Moderate ) ( I|  190  level of the last piece
| The hands begin to move. Grades 1 and 2. |
|                                          |
| Christmas carols and songs               |
| ---------------------------------------- |
| Silent Night (Stille Nacht)         0:26 |
| Franz Xaver Gruber                       |
| ---------------------------------------- |
+------------------------------------------+
```

At 1280 the same: "Continue with Minuet in G major" at 107 px, Easy chosen.

## 4. The pill filters

### 4.1 Difficulty pills (levels)

| Level | Pill label   | Today's name       | The line under the pills (gray)           | Pieces at 149 | Median length (critique) | Synthetic 1,000 |
| ----: | ------------ | ------------------ | ----------------------------------------- | ------------: | -----------------------: | --------------: |
|     1 | First steps  | First steps        | Each hand stays in one place.             |            24 |                     0:19 |             120 |
|     2 | Easy         | Easy               | The hands begin to move. Grades 1 and 2.  |            43 |                     0:44 |             230 |
|     3 | Moderate     | Early intermediate | More notes, wider reaches. Grades 2 to 4. |            41 |                     1:01 |             240 |
|     4 | Intermediate | Intermediate       | Reaches of an octave. Grades 5 and 6.     |            27 |                     1:34 |             180 |
|     5 | Challenging  | Stretch            | Fast runs and leaps. Grades 6 and 7.      |            14 |                     1:35 |             130 |
|     6 | Advanced     | (arrives with L2)  | Concert pieces. Grade 8 and beyond.       |             0 |                        - |             100 |

- Why these words: each is a plain adjective a beginner already uses, no two share a stem ("Early intermediate" and "Intermediate" did, and differed only by a prefix a skimming eye drops), and the row reads easy to hard from left to right. "Stretch" (critique C5) did not say what level 5 is, and a sixth level in today's scheme would add a third "intermediate". The rename is for meaning, not room: the six proposed pills measure 591 px and today's names with "Late intermediate" and "Advanced" would measure 685 px, and both fit one row from 768 px.
- The lines come from the level heuristic's median features (`content/tools/level.py`, `verification.json`). Level 1 barely moves (at most 7 position shifts per 100 onsets, no hand spanning more than a fifth). Level 2's median is 32 shifts per 100 onsets. Level 3 has about twice the notes per second (6.6 against 3.2) and wider reaches (median span 10 semitones). Level 4's median span is an octave. Level 5 has 55 shifts and 8.8 leaps per 100 onsets. The grades are the ABRSM ranges in `catalog.json`'s comment (level 5 "about 6 to 7") and T5 for level 6. Level 1 has no grade line: it comes before grade 1. "No sharps or flats" would be false: 9 of the 24 level-1 pieces are in F or G major.
- One name everywhere: the pill, the level heading at 40 pieces or fewer, the search result headings and the score's side panel ("Easy", no longer "2 · Easy").

### 4.2 Genre pills

Seven genres, named by what a beginner would call the music. Two are for tunes arranged for beginners and five are periods of original piano music. A period is the one axis that scales to L2's thousand pieces, because every piano piece has one, and it is how teachers and exam lists group repertoire. Each pill's line names the composers, so "Baroque" teaches itself the first time it is chosen.

| Genre id    | Pill label       | The line when chosen                      | Pieces at 149 (by level)              |
| ----------- | ---------------- | ----------------------------------------- | ------------------------------------- |
| `songs`     | Songs            | Well-known tunes, arranged for the piano. | 40 (L1 20, L2 20)                     |
| `carols`    | Carols and hymns | Christmas carols, hymns and spirituals.   | 15 (L1 4, L2 11)                      |
| `baroque`   | Baroque          | Bach, Handel and others, 1600–1750.       | 27 (L2 4, L3 11, L4 8, L5 4)          |
| `classical` | Classical        | Mozart, Clementi and others, 1750–1820.   | 18 (L2 1, L3 7, L4 7, L5 3)           |
| `romantic`  | Romantic         | Schumann, Chopin and others, 1820–1900.   | 45 (L2 6, L3 23, L4 12, L5 4)         |
| `ragtime`   | Ragtime          | Scott Joplin and others, around 1900.     | 4 (L2 1, L5 3)                        |
| `modern`    | Modern           | Music written since 1900.                 | 0 (for L2: Debussy, Bartók, CC works) |

The mapping, by collection id, in `catalog.json` display order:

| Collection id          | Collection                                                     | Pieces | Levels                 | Genre            |
| ---------------------- | -------------------------------------------------------------- | -----: | ---------------------- | ---------------- |
| `children-songs`       | Children's songs                                               |     16 | 1: 15, 2: 1            | Songs            |
| `folk-songs`           | Folk songs                                                     |      9 | 2: 9                   | Songs            |
| `christmas`            | Christmas carols and songs                                     |      9 | 1: 2, 2: 7             | Carols and hymns |
| `hymns`                | Hymns and spirituals                                           |      6 | 1: 2, 2: 4             | Carols and hymns |
| `anthems`              | National anthems                                               |      3 | 2: 3                   | Songs            |
| `songs-before-1929`    | Songs before 1929                                              |      7 | 1: 4, 2: 3             | Songs            |
| `easy-rags`            | Ragtime, simplified                                            |      1 | 2: 1                   | Ragtime          |
| `classical-themes`     | Classical themes, simplified                                   |      5 | 1: 1, 2: 4             | Songs            |
| `anna-magdalena`       | Notebook for Anna Magdalena Bach (1725)                        |     11 | 2: 3, 3: 7, 4: 1       | Baroque          |
| `handel-aylesford`     | Handel, Aylesford Pieces                                       |      1 | 2: 1                   | Baroque          |
| `bach-little-preludes` | Bach, Little Preludes                                          |      7 | 3: 3, 4: 4             | Baroque          |
| `dances`               | Minuets, dances and rondos                                     |      2 | 2: 1, 3: 1             | Classical        |
| `swedish-folk-dances`  | Swedish folk dances (Traditioner af Swenska Folk-Dansar, 1814) |      1 | 3: 1                   | Classical        |
| `burgmuller-op100`     | Burgmüller, 25 Easy and Progressive Studies, Op. 100           |     18 | 2: 1, 3: 15, 4: 2      | Romantic         |
| `schumann-op68`        | Schumann, Album for the Young, Op. 68                          |     12 | 2: 4, 3: 5, 4: 3       | Romantic         |
| `tchaikovsky-op39`     | Tchaikovsky, Album for the Young, Op. 39                       |      3 | 3: 2, 4: 1             | Romantic         |
| `sonatinas`            | Sonatinas and sonatas                                          |     15 | 3: 5, 4: 7, 5: 3       | Classical        |
| `bach-inventions`      | Bach, Inventions, BWV 772–786                                  |      7 | 4: 3, 5: 4             | Baroque          |
| `bach-wtc`             | Bach, The Well-Tempered Clavier                                |      1 | 3: 1                   | Baroque          |
| `schumann-op15`        | Schumann, Scenes from Childhood, Op. 15                        |      3 | 4: 2, 5: 1             | Romantic         |
| `chopin-op28`          | Chopin, Preludes, Op. 28                                       |      3 | 4: 3                   | Romantic         |
| `character-pieces`     | Romantic character pieces                                      |      6 | 2: 1, 3: 1, 4: 1, 5: 3 | Romantic         |
| `ragtime`              | Ragtime                                                        |      3 | 5: 3                   | Ragtime          |

Two judgement calls: the classical themes ("Ode to Joy (simplified)", "Canon in D (simplified)") are Songs, because they are well-known tunes arranged for beginners, and Pachelbel, Haydn, Brahms and Mozart in one collection would otherwise split over three periods. The Swedish polska (1814) is Classical by its date.

**Where the genre lives.** `content/tools/catalog.json` gains a `genres` table, `[{id, title}]` in display order (the seven ids above), next to `collections`. Every collection gains `genre`, one of those ids. `build.py` refuses an unknown or missing genre, as it already refuses an unknown collection id, and writes `genre` on every manifest entry next to `collectionId` (the manifest stays a flat array). `manifest.ts` gains `genre: GenreId`. The pill labels and lines live in the app beside `LEVEL_NAMES` (a `GENRES` table), with a unit test that its ids equal the catalog's. A genre is per collection. A per-piece override is left out until a mixed collection needs one (section 11).

### 4.3 Selection, clearing, and the empty selection

- **Levels: single select, and exactly one is always chosen.** They behave like a segmented control, not a filter. The first visit opens on First steps; a returning reader's visit opens on the level of the last piece they played. Choosing another level replaces the list. A level cannot be cleared, and there is no "All levels": at 149 that view is 22 phone screens, and a beginner never needs it. Search is the way across levels.
- **Genres: single select, zero or one chosen.** With none chosen (the default) the list shows the whole level, collections in catalog order. Tapping a genre shows only its collections. Tapping the chosen genre again clears it, as does Escape while the focus is in the genre row. Choosing another level clears it too, because genres differ by level and a carried-over genre could empty the list.
- **No pill can lead to an empty list.** A genre gets a pill only if the chosen level holds at least one of its pieces, and the row appears only when at least two genres qualify.
- **Search overrides both.** While the field holds text, the pills and their lines leave and results come from every level. Clearing the field brings back the same level, genre, opened collections and scroll position.

### 4.4 How a pill looks

Pills are the page's only rounded shape: a full capsule (radius 999 px). Everything square acts (opens, plays), and everything round filters what is shown, so the shape carries meaning without a legend. A pill is 36 px tall, with 15 px text and 12 px side padding. Unchosen: 1 px `--gray-2` border, ink text, `--gray-1` on hover. Chosen: ink fill and paper text, like the hands control's checked segment. Never red. Pills sit 8 px apart. The hit area is extended to 44 px tall by an invisible pseudo-element; WCAG 2.2's minimum is 24 px (sources). Below 480 px each pill row stays on one line and scrolls sideways inside itself, bleeding to the screen edge so the cut pill shows there is more. It never wraps and never scrolls the page. From 480 px the row wraps, and from 768 px it fits one line (591 px for six levels, 680 px for all seven genres, inside the 704 px column). A pill row scrolls a pill into view only when it is chosen with the keyboard or is the starting choice (a returning reader's Challenging). A tapped pill never moves under the finger.

## 5. Disclosure rules

### 5.1 Thresholds

The constants live in one module (`library/disclosure.ts`), each with a unit test at its boundary.

| Constant              | Rule                                                                                                                                                                                                                      | 30 pieces | 149 pieces                         | 1,000 pieces (synthetic)                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------- | ------------------------------------------- |
| `PILLS_ABOVE = 40`    | Level pills replace the all-levels list when the library holds more than 40 pieces (about four phone screens of rows)                                                                                                     | no        | yes, 5 pills                       | yes, 6 pills                                |
| `SEARCH_FROM = 100`   | The search field stands on the name's line from 100 pieces. Below that it appears when a printable key is typed with the focus outside a field (keyboards only)                                                           | on typing | yes                                | yes                                         |
| `HEADINGS_ABOVE = 12` | In pill mode, collection headings group the list when the list in view (the level, or the level and genre) holds more than 12 pieces. Collections with fewer than 3 pieces in view gather at the end under "Other pieces" | no        | yes, every level (3 to 9 headings) | when a level and genre hold 13 to 60        |
| `SCALE_ABOVE = 60`    | Genre pills appear when the chosen level holds more than 60 pieces and at least two genres. Collections collapse to one row each ("Burgmüller, … 18 pieces") while the list in view holds more than 60 pieces             | no        | no (largest level 43)              | yes, every level (13 to 32 collection rows) |
| `RESULTS_PAGE = 60`   | Search shows at most 60 result rows, then "Show 60 more" (or the remainder)                                                                                                                                               | n/a       | never reached for most words       | reached by common words                     |
| Counts                | Only where something is hidden: on a collapsed collection ("18 pieces"), on "Show 60 more", and in the screen-reader status ("43 pieces"). Never on pills or on headings whose rows are shown                             | none      | none visible                       | on collapsed rows                           |

Two rules compose: choosing a genre in a big level usually brings the list to 60 or fewer, and the collections then open into headings with rows (Moderate and Classical at 1,000: 31 pieces). A threshold is crossed only by the library growing (a new build) or by a choice the reader makes. Nothing appears while the reader is looking, except the field on typing, the drop overlay on dragging, and a genre row after a level change.

### 5.2 Motion

All on the existing tokens (`--dur-fast` 120 ms, `--dur` 160 ms, `--ease`), and 0 ms under reduced motion. Heights never animate. Every change lands below the control the reader just used, or leaves it in place.

| Change                                                | Motion                                                                                                               | The reader's target                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A level or genre is chosen                            | The list is replaced in one frame, and the new list fades in over 120 ms (opacity only). The scroll position is kept | The pill stays where it is; only content below it changes                                 |
| The genre row appears or leaves on a level change     | Fades in over 160 ms, or leaves in one frame                                                                         | Below the level pills, which stay put                                                     |
| A level or genre line changes length                  | The text swaps in place                                                                                              | Content below moves by a line at most; the pills above do not                             |
| A collapsed collection opens                          | Its rows fade in over 160 ms under it; closing removes them in one frame                                             | The collection row stays where it is                                                      |
| The search field appears on typing (under 100 pieces) | Fades in over 120 ms on the name's line, which is always 44 px tall                                                  | Nothing moves; the typed letter is in the field                                           |
| The first character of a search                       | The pills, lines and list leave and the results fade in over 120 ms; later keystrokes swap results without motion    | The field stays where it is                                                               |
| The search is cleared                                 | The browse view returns, faded in over 120 ms, with its previous choices and scroll                                  | The field stays where it is                                                               |
| A file is dragged over the window                     | The overlay fades in over 120 ms, and out over 120 ms on leave or drop                                               | The whole window is the target                                                            |
| Practice opens in the dock (T1)                       | The panel fades in over 160 ms with a 4 px rise; the dock grows upward in one frame                                  | Practice, Play and the keyboard stay at the bottom; the dock grows upward, over the music |

## 6. The one red element, in every state

| State                                        | Red element                                                                                  | Note                                                                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First visit, any library size                | "Start with Twinkle, Twinkle, Little Star"                                                   | 130 px at 360, 107 px at 1280                                                                                                                                         |
| Returning reader                             | "Continue with <last piece played>"                                                          | Same place; the label changes, nothing else                                                                                                                           |
| A level or genre chosen, a collection opened | The same button                                                                              | Chosen pills are ink-filled, never red                                                                                                                                |
| Search typed, results or an empty result     | The same button                                                                              | Above the results; the field and the results carry no accent                                                                                                          |
| Scrolled past the button                     | None in view                                                                                 | Allowed. Spec section 9 gains the sentence "A scrolled list may show no red element; the red element is never made sticky." The DOM still holds exactly one `.is-red` |
| A file dragged over the window               | The overlay's dashed frame                                                                   | The start button drops `.is-red` while the overlay is up, so the DOM holds one; the red follows the next action (the spec's "the dropped file's … button" case)       |
| A file refused                               | The start button                                                                             | The notice is gray, as today                                                                                                                                          |
| Score view, Practice open or closed (T1)     | Unchanged: Play while stopped, the cursor while playing, the resume point while paused (T10) | The Practice toggle is ink-filled while open, never red                                                                                                               |

The state walk (`e2e/helpers/states.ts`) gains library states for 149 pieces, a level and a genre chosen (with a 1,000-piece fixture), search results, the empty result and the drag overlay, plus the score view with Practice open at 1280. Each is checked with `expectOneRed`.

## 7. Copy

Every text on the landing page, exactly. Curly quotes and apostrophes as shown.

| Element                                     | Text                                                                                    | Notes                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Document title                              | digitus2                                                                                | Unchanged                                                                                 |
| `h1`                                        | digitus2                                                                                | Takes the focus on arrival, as today                                                      |
| Sentence                                    | Finger numbers for piano music. Pick a piece, press play, and follow the red note.      | Unchanged                                                                                 |
| Red button, first visit                     | Start with Twinkle, Twinkle, Little Star                                                | `Start with {title}` of the recommended piece (the first level-1 piece in manifest order) |
| Red button, returning                       | Continue with Minuet in G major                                                         | `Continue with {title}`; accessible name `Continue with {title} by {composer}`            |
| Search field                                | Placeholder: Search                                                                     | Accessible name "Search the library"; inside a `search` landmark                          |
| Level group name (visually hidden)          | Level                                                                                   | The `legend` of the pill group                                                            |
| Level pills                                 | First steps, Easy, Moderate, Intermediate, Challenging, Advanced                        | One pill each                                                                             |
| Level lines                                 | Section 4.1                                                                             |                                                                                           |
| List heading in pill mode (visually hidden) | {Level}, {n} pieces                                                                     | For example "First steps, 24 pieces"; an `h2` for heading navigation                      |
| Level headings at 40 pieces or fewer        | First steps, Easy, …                                                                    | Visible `h2`, each followed by its line                                                   |
| Genre group name (visually hidden)          | Kind of music                                                                           |                                                                                           |
| Genre pills and lines                       | Section 4.2                                                                             |                                                                                           |
| Collection heading                          | The collection's title from the manifest                                                | `h3`                                                                                      |
| Leftover group                              | Other pieces                                                                            | Collections with fewer than 3 pieces in view                                              |
| Collapsed collection                        | {collection title}, then "{n} pieces" (or "1 piece")                                    | A button inside the `h3`                                                                  |
| Row                                         | {title}, {m:ss}, and the composer line when shown (section 2.1)                         | Accessible name `Open {full title} by {full composer}`, described by the length, as today |
| Search results heading                      | The level's name                                                                        | Visible `h2`                                                                              |
| More results                                | Show 60 more                                                                            | Or "Show {n} more" for fewer than 60 left                                                 |
| Screen-reader status (visually hidden)      | {n} pieces, or 1 piece, or No piece matches {query}                                     | Polite; sent 300 ms after the last change                                                 |
| Empty result, first line                    | No piece matches “{query}”.                                                             | Ink                                                                                       |
| Empty result, second line                   | Search for part of a title or a composer’s name.                                        | Gray                                                                                      |
| End line                                    | Open your own MusicXML or MIDI file                                                     | A text button that opens the file chooser                                                 |
| Footer                                      | About and licences                                                                      | Unchanged                                                                                 |
| Drop overlay                                | Drop to open this file                                                                  | Ink, 18 px, semibold                                                                      |
| Drop overlay, second line                   | MusicXML or MIDI                                                                        | Gray                                                                                      |
| Refusal notice                              | That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi). | Unchanged, with its "Dismiss" button: a refused file is when the extensions help          |

Score view text this proposal touches: the finger legend line, unchanged, now above the music until the first Play. The side panel's level reads "Easy" (was "2 · Easy"). In the dock, "Practice" (the toggle) and "Loop bars" (now a checkbox), then "from" and "to" when ticked; their accessible names stay "Loop from bar" and "Loop to bar". "Clear loop" is gone.

## 8. Keyboard and screen reader

**Level pills (a radio group).**

- Markup: a `fieldset` with the visually hidden legend "Level". Each pill is a `label` around a native `input type="radio"` that covers it, the technique the hands control already uses (`base.css` `.segmented input`).
- Tab enters the group once, on the chosen pill. The arrow keys move the choice and select as they go, as native radios do, wrapping at the ends.
- The focus stays on the pill while the list below changes. Below 480 px a pill chosen with the keyboard scrolls into view inside its row.
- Each radio is described (`aria-describedby`) by the level line, so a screen reader reads "Easy, radio button, 2 of 5, checked, The hands begin to move. Grades 1 and 2."
- After a change, the polite status says "43 pieces". It is sent 300 ms after the last change, so arrowing through five levels speaks once.

**Genre pills (toggle buttons).**

- Markup: a `div role="group"` named "Kind of music", holding `button type="button" aria-pressed`.
- Each pill is a tab stop (seven at most). Enter or Space presses it; pressing the pressed pill clears it, and pressing another moves the choice.
- Escape inside the group clears the choice. The status speaks the new count.

**Collapsed collections.**

- `h3 > button aria-expanded aria-controls`, named "{title}, {n} pieces".
- Enter or Space opens and closes it. The focus stays on the button, and the opened rows follow it in DOM order, so the next Tab enters them.

**Search.**

- `search > input type="search"`, named "Search the library".
- Typing filters from the first character. Words match the start of any word in the title, the composer or the collection, ignoring case and accents ("fur elise" finds "Für Elise", "burgmuller" finds Burgmüller).
- Arrow Down moves to the first result. Escape clears the text and brings back the browse view; a second Escape leaves the field.
- Type-to-search: a printable key with no modifier, typed while the focus is not in a field, focuses the field and enters the key. Space keeps its own job.
- The status speaks the count, or "No piece matches {query}".

**Rows.** Unchanged: a `button` in a `li`, with its full title and composer in the accessible name and the length as its description.

**Order and landmarks.** `main` holds the page. The tab order follows the reading order: search, the red button, the level pills (one stop), the genre pills, the list, the end line, the footer. Headings: `h1` the name, `h2` the level (visible at 40 pieces or fewer, in search results, or visually hidden in pill mode), and `h3` the collections.

**Contrast and targets.** Gray text is `--gray-3` (4.54:1 on white). On hover and focus the rows' gray text turns ink, as today. Every control is at least 44 px tall to the touch.

## 9. Rendering at 1,000 pieces

### 9.1 What is in the DOM

Measured on the mock (elements in the whole page, the `main` included):

| View                                                          | Rows (pieces) | Collection rows | Elements | Height at 360 (screens) | Height at 1280 |
| ------------------------------------------------------------- | ------------: | --------------: | -------: | ----------------------: | -------------: |
| 149, First steps                                              |            24 |               0 |      143 |             2,030 (2.6) |          1,938 |
| 149, Easy (the largest level)                                 |            43 |               0 |      251 |             3,846 (4.9) |          3,608 |
| 149, Moderate                                                 |            41 |               0 |      222 |             3,388 (4.3) |          3,009 |
| 149, Intermediate                                             |            27 |               0 |      169 |             2,830 (3.6) |          2,409 |
| 149, Challenging                                              |            14 |               0 |      111 |             1,826 (2.3) |          1,640 |
| 1,000, First steps (120 pieces)                               |             0 |              13 |      100 |             1,167 (1.5) |          1,074 |
| 1,000, Easy (230)                                             |             0 |              32 |      199 |             2,337 (3.0) |          1,989 |
| 1,000, Moderate (240)                                         |             0 |              23 |      151 |             2,112 (2.7) |          1,556 |
| 1,000, Advanced (100)                                         |             0 |              15 |      112 |             1,379 (1.8) |          1,170 |
| 1,000, Moderate and Classical (31)                            |            31 |               0 |      199 |             3,400 (4.4) |          2,887 |
| 1,000, Moderate with every collection opened (the worst case) |           240 |              23 |    1,192 |           17,109 (21.9) |         14,025 |
| 1,000, search "bach" (capped)                                 |            60 |               0 |      291 |             4,097 (5.3) |          3,935 |

The DOM never holds more than one level, and stays at about 1,200 elements even when a reader opens every collection of the largest level. There is no virtual list: it would break the browser's find-in-page, Back's scroll restore and screen-reader list navigation, and these sizes do not need one.

### 9.2 What the first load carries

`manifest.ts` imports the whole `manifest.json` into the entry bundle today. That does not scale:

| File                                                                         | At 149 pieces (measured)                    | At 1,000 (scaled)          |
| ---------------------------------------------------------------------------- | ------------------------------------------- | -------------------------- |
| `manifest.json` (all fields: sources, notes, licences)                       | 207 KB raw, 26.7 KB gzip                    | about 1.39 MB, 180 KB gzip |
| A library index (slug, title, composer, level, collection id, genre, length) | 26 KB raw, 5.1 KB gzip                      | about 176 KB, 34 KB gzip   |
| Entry bundle budget (`check-bundle-size.mjs`)                                | 150 KB gzip, 93.1 KB used today (30 pieces) | -                          |

(The index was measured with six fields; `genre` adds about 2.4 KB raw at 149.) At 1,000 the full manifest alone would exceed the entry budget. So `build.py` also writes `content/library-index.json` (the seven fields, plus a small collections table: id, title, genre, one composer or not). The library view imports only that file. The full manifest moves into a lazy chunk, loaded by the score view and the about page, which need sources, notes and licences. The bundle gate keeps the entry under 150 KB.

Search builds its index on the first keystroke: each piece's title, composer and collection, lowercased and stripped of accents, split into words, about a dozen words per piece. A keystroke is then one pass over 1,000 entries with prefix tests, far under a frame. LCP stays the name and the sentence: no images, no web font.

## 10. T1: the dock and the Practice controls

### 10.1 Today (measured on 5174, Minuet in G major)

| Width | Practice controls                                         | First system top | Dock height | Keyboard           |
| ----: | --------------------------------------------------------- | ---------------: | ----------: | ------------------ |
|   360 | a closed `Practice` line above the score, 44 px at 200 px |           278 px |      173 px | 328 px, full width |
|   768 | 9 controls standing open, 96 px, at 180 px                |           310 px |      121 px | 624 x 94 px        |
|  1280 | the same, 832 px wide                                     |           309 px |      133 px | 720 x 108 px       |

### 10.2 Proposal: one Practice toggle in the dock, at every width

The phone's Practice disclosure moves into the dock and becomes the only practice control at every width. That is the existing control in a new place, not a new one. It sits at the right end of the dock: Play and Rewind stay at the left, so transport is at one end and practice at the other. Nothing stands above the music any more.

```
1280 x 800, score view, Practice closed (proposal)
+------------------------------------------------------------------------------------------------+
|  [ Back to the library ]                                                                       |  16
|  Minuet in G major                                                                             |  72
|  Christian Petzold                                                                             |
|  Engraving by Allen Garvin for the Mutopia Project, public domain                              |
|                                                                          |  Finger numbers: 1  |
|  (first system of the music)                                             |  is the thumb ...   |  ~198 (309 today)
|  ...                                                                     |  Level   Easy       |
|  ...                                                                     |  Key     G major    |
|  ----------------------------------------------------------------------  |                     |
|  [Play  ]   | keyboard, about 608 px wide              |   [ Practice ]  |                     |  dock, sticky; Play red while stopped
|  [Rewind]   |                                          |                 |                     |  about 121 px tall (133 today)
+------------------------------------------------------------------------------------------------+
```

```
1280 x 800, Practice open: the dock grows upward, nothing it holds moves
+------------------------------------------------------------------------------------------------+
|  (music)                                                                 |                     |
|  ----------------------------------------------------------------------  |                     |
|  Tempo  ----o----  100 % · ♩ = 120     [Both hands|Right hand|Left hand] |                     |  panel row 1
|  [ ] Metronome    [x] Count-in    [ ] Loop bars                          |                     |  panel row 2
|  ----------------------------------------------------------------------  |                     |
|  [Play  ]   | keyboard                                 | [##Practice##]  |                     |  Practice ink-filled while open
|  [Rewind]   |                                          |                 |                     |
+------------------------------------------------------------------------------------------------+
```

```
1280 x 800, Practice open, Loop bars ticked: the two fields appear, prefilled
+------------------------------------------------------------------------------------------------+
|  ----------------------------------------------------------------------  |                     |
|  Tempo  ----o----  100 % · ♩ = 120     [Both hands|Right hand|Left hand] |                     |
|  [ ] Metronome    [x] Count-in    [x] Loop bars  from [ 3 ]  to [ 6 ]    |                     |  no "Clear loop": untick to clear
|  ----------------------------------------------------------------------  |                     |
|  [Play  ]   | keyboard                                 | [##Practice##]  |                     |
|  [Rewind]   |                                          |                 |                     |
+------------------------------------------------------------------------------------------------+
```

```
768 x 1024, Practice closed (side panel below the score at this width)
+----------------------------------------------------------+
|  [ Back to the library ]                                 |  16
|  Minuet in G major                                       |  72
|  Christian Petzold                                       |
|                                                          |
|  (first system of the music)                             |  ~199 (310 today)
|  ...                                                     |
|  ------------------------------------------------------  |
|  [Play  ]  | keyboard, about 512 px  |  [ Practice ]     |  dock, about 121 px
|  [Rewind]  |                         |                   |
+----------------------------------------------------------+
```

```
360 x 780, Practice closed: the line above the score moves into the dock
+------------------------------------------+
| [ Back to the library ]                  |  16
| Minuet in G major                        |  72
| Christian Petzold                        |
|                                          |
| (first system of the music)              |  ~218 (278 today)
| ...                                      |
| ---------------------------------------- |
| [Play ] [Rewind]           [ Practice ]  |  dock, 173 px as today
| keyboard, full width, scrolls sideways   |
+------------------------------------------+
```

```
360 x 780, Practice open
+------------------------------------------+
| (music)                                  |
| ---------------------------------------- |
| Tempo ----o---- 100 % · ♩ = 120          |  panel, about 200 px
| [Both hands|Right hand|Left hand]        |
| [ ] Metronome   [x] Count-in             |
| [ ] Loop bars                            |
| ---------------------------------------- |
| [Play ] [Rewind]         [##Practice##]  |
| keyboard                                 |
+------------------------------------------+
```

| Width | First system top (estimate)  | Dock closed                                                                           | Keyboard (estimate)           | Practice open                       |
| ----: | ---------------------------- | ------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------- |
|   360 | about 218 px (60 px higher)  | 173 px: Play, Rewind and Practice in one row (302 of 328 px)                          | unchanged, full width         | dock grows by about 200 px (4 rows) |
|   768 | about 199 px (111 px higher) | about 121 px (unchanged)                                                              | about 512 px wide, 77 px tall | grows by 2 rows, about 108 px       |
|  1280 | about 198 px (111 px higher) | about 121 px (12 px lower: the narrower keyboard is shorter than the stacked buttons) | about 608 px wide, 91 px tall | grows by 2 rows, about 108 px       |

(Estimates: the measured boxes with the 96 px block and its 16 px gap removed, and a 96 px Practice column plus a 16 px gap taken from the keyboard; the keyboard keeps its aspect ratio.)

### 10.3 Behaviour

- **The toggle.** "Practice" is a square button like Rewind, with `aria-expanded` and `aria-controls`. While open it is ink-filled with paper text, the same "chosen" look as a pill or the hands control, and never red.
- **Opening.** The panel becomes the dock's first row, above the status line, separated by a gray-2 rule. The dock grows upward over the music, so Play, Rewind, Practice and the keyboard do not move. `useDockHeight` already republishes `--dock-h`, so the cursor stays above the taller dock.
- **State.** Closed when a piece opens; open or closed as the reader leaves it within that piece. Escape inside the panel closes it and returns the focus to Practice. Space still plays and pauses: Practice is a button, and the existing `TAKES_SPACE` list already leaves Space to a focused button.
- **Loop.** "Loop bars" becomes a checkbox. Ticking it reveals "from [ ] to [ ]", prefilled from the bar at the cursor or resume point to three bars later (clamped to the piece), and the loop takes effect at once. Unticking turns the loop off and hides the fields; the bars typed are kept for the visit. "Clear loop" is gone. The message for a reversed range stays.
- **Counted.** At 768 and 1280 the first screen loses 9 standing controls and gains 1 toggle. The phone keeps 1 toggle in a new place. "Clear loop" leaves everywhere. Open, the panel holds 7 controls instead of 9 (from, to and Clear loop become one checkbox, with from and to only after it is ticked).

### 10.4 The finger legend in the score view

The legend line leaves the library (C1) and shows above the music, in gray at 14 px, until the reader first presses Play in any piece. A persisted `legendSeen` flag records that. After that it lives only in the side panel, where it is today. One line, once, at the moment the digits are first on screen.

### 10.5 T11, the hand letters (the request that started this run)

The user asked that L and R show only when the two hands' notes are close. The critique's replay (section 8.3) settles the threshold, and it is not an octave. An octave per onset still letters 34 % of the minuet's onsets and switches the letters 41 times in 50 s; with hysteresis it letters 53 % and switches 26 times. Proposal, one rule with no setting:

- Letters show for a whole bar when, in any onset of that bar, the nearest keys of the two hands are within a fifth (7 semitones) or the hands interleave.
- Both hands are lettered together, never one. One hand alone gets no letter.
- On a phone, a hand scrolled out of the keyboard's visible part counts as close, so the visible hand keeps its letter (the critique's `keyboard-far-360` case).

Replayed by the critique: the minuet gets letters in 9 of 32 bars (where the hands really meet, bar 26: left C4 E4 against right F#4), with 12 switches in 50 s; Amazing Grace gets none. Unit tests pin one hand, far apart, a fifth, a sixth, interleaved, a muted hand and the phone case.

## 11. Risks, and what is deliberately left out

### 11.1 Risks

1. **The user asked for genre pills and will not see them at 149.** No level passes 60 pieces before L2. If the user wants to judge them in this batch, set `SCALE_ABOVE` to 40: Easy (43) and Moderate (41) would then show genre pills (Easy: Songs, Carols and hymns, Baroque, Classical, Romantic, Ragtime) and collapsed collections. That is a one-constant change, but at 149 it hides Easy's pieces behind one more tap. The 1,000-piece fixture and its visual baseline show the genre row either way.
2. **Period names are teacher vocabulary.** "Classical" can read as "classical music". Mitigations: the pill sits between Baroque and Romantic, its line names Mozart and Clementi, and genres appear only at scale. If L2's review finds beginners stumbling, the period pills could fall back to "Piano pieces".
3. **A genre per collection is coarse.** "Romantic character pieces" holds Für Elise (1810) and Satie (1888). A per-piece `genre` override in the catalog is the remedy, left out until needed.
4. **The level renames** ("Early intermediate" to "Moderate", "Stretch" to "Challenging") touch the spec, `docs/app.md`, the side panel, tests and the user's own vocabulary. The user may prefer the old names. Keeping them costs no room (685 px for six, one row from 768 px); it costs clarity.
5. **Levels 4 to 6 sit off the right edge of a phone** until the pill row is scrolled. That is the price of one row instead of two. The level a beginner needs next is always in view.
6. **The search field is the first Tab stop**, before the red button, because it sits on the name's line. Keyboard users reach the red button with a second Tab.
7. **Rows of mixed height.** Dropping Traditional and Anonymous makes 76 of 149 rows one line and the rest two to four. The rhythm is uneven by design: the gray line now carries information wherever it appears.
8. **"Continue with" depends on Play.** It is set when Play is pressed in a library piece, not when a piece is opened, so a piece opened by mistake does not take over the red button. A reader who opens a piece and never plays it keeps the old target. Dropped files are never remembered (they cannot be restored).
9. **The drag overlay moves the red.** The start button must drop `.is-red` during the drag, and the e2e walk needs synthetic drag events with a `DataTransfer`. If that proves fragile, the fallback is an ink frame and a start button hidden with `visibility: hidden` under the overlay, which leaves no red on screen while a file is dragged.
10. **T1 narrows the keyboard** at 768 and 1280 by the Practice column (about 112 px). Wide pieces at 768 may scroll sideways inside the keyboard, as they already do on a phone.
11. **At 1,000 the first screen of a level shows collection names, not pieces.** That is one more tap before any title, though the red button still starts at once. The synthetic library's collection sizes are invented; L2's real collections decide how well 60 works.
12. **Moving the full manifest to a lazy chunk** adds one request (27 KB gzip at 149) when the first score or the about page opens. Warming it on idle, as the engine already is, hides it.
13. **The spec changes.** Section 9 gains the disclosure thresholds, the sentence on scrolled red, and the level names; the critique's 30-piece facts in `docs/app.md` need updating after the batch.

### 11.2 Deliberately left out

- **Autoplay from the red button** (one tap to sound). It would skip "press play", the moment that teaches the red rule; it fights browser autoplay policy and hands a beginner a moving score before they have looked at it. Two taps stays.
- **An "All levels" pill, sort controls, composer pills and era pills across levels.** Search covers names, and the level is always the first axis.
- **Counts on pills and on open headings, difficulty dots or stars, thumbnails, icons.** None of them help a choice that the level line and the length do not already help.
- **A sticky red bar or sticky pills.** The short lists make them unnecessary (C12).
- **A "next level" link at the end of a level, a recently-played list, favourites and recommendations** beyond the one Continue.
- **The level, genre or search in the URL.** Back returns to the same state within a visit through the store, as the scroll position already does.
- **Two columns of rows at 1280.** One reading column scans top to bottom, the order of difficulty, and lines up with the score view's left edge.
- **A virtual list** (section 9.1).
- **A filter for pieces with an editor's fingering** (C9: it belongs to the score view).
- **A demo video in the welcome** (M11 allows one, folded). Not now.

## 12. Implementation tasks

Ten tasks, one agent each, test-first. T10 and T11 are separate tasks of the batch and are not counted here.

| #   | Task                                                                                                                                                                                                                               | Files (main)                                                     | Tests first                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Genres in the catalog: the `genres` table, `collections[].genre` for the 23 collections, `genre` on every manifest entry, refusal of unknown or missing genres; write `content/library-index.json`                                 | `content/tools/catalog.json`, `build.py`, `tests/`               | pytest: every collection has a known genre; the index has the seven fields and matches the manifest |
| 2   | App data layer: `Level` 1 to 6, the new level names and lines, `GENRES` (labels and lines), the library index for the library view, the full manifest as a lazy chunk for the score and about views                                | `library/manifest.ts`, `library/index.ts`, `score/`, `about/`    | vitest: names and lines per level; `GENRES` ids equal the catalog's; the bundle gate                |
| 3   | The pure library model: thresholds (`disclosure.ts`), grouping into headings, "Other pieces" and collapsed collections, the composer and short-title rules, the search matcher; fixtures of 30, 149 and a generated 1,000          | `library/disclosure.ts`, `library/model.ts`, `library/search.ts` | vitest at every threshold boundary (40/41, 99/100, 12/13, 60/61), collisions, accents               |
| 4   | Library view, browse: the name line, the red Start or Continue button, level pills and line, genre pills and line, headings, rows, collapsed collections, end line, footer; the card, legend, tags, link and drop-zone box removed | `library/LibraryView.tsx`, `library/Pills.tsx`, `base.css`       | Testing Library: one `.is-red`, the units per library size, the radio and toggle semantics, Escape  |
| 5   | Store: `lastPlayed` (persisted, set on the first Play of a library piece), `libraryLevel`, genre, query and opened collections for the visit, restored on Back                                                                     | `app/store.ts`, `score/ScoreView.tsx`                            | vitest: Continue label, level preselection, a missing slug falling back to Start                    |
| 6   | Search: the field from 100 pieces, type-to-search below, results grouped by level, 60 per page, the empty result, the polite status, Arrow Down and Escape                                                                         | `library/Search.tsx`, `LibraryView.tsx`                          | Testing Library and one e2e: "fur elise", "burgmuller", no match, Escape restores the browse view   |
| 7   | Own files: a window-wide drop with the red-framed overlay (the start button plain while it shows), the end line opening the chooser, `DropZone` reduced to its logic                                                               | `library/DropZone.tsx`, `library/FileDrop.tsx`                   | Testing Library with drag events; e2e drag state with `expectOneRed`                                |
| 8   | Score view reading aids: the legend above the music until the first Play (`legendSeen`), the side panel's level without its number                                                                                                 | `score/ScoreView.tsx`, `score/SidePanel.tsx`, `app/store.ts`     | vitest and Testing Library                                                                          |
| 9   | T1: the Practice toggle in the dock at every width, the panel above the status line, "Loop bars" as a checkbox revealing prefilled fields, "Clear loop" removed                                                                    | `score/Transport.tsx`, `ScoreView.tsx`, `base.css`               | Testing Library; e2e states with Practice open at 360 and 1280; visual baselines                    |
| 10  | Verification and docs: the state walk and visual baselines for the new library states (149, a 1,000-piece fixture build, search, empty, drag), axe, LCP, the bundle gate; spec section 9 and `docs/app.md` updated                 | `e2e/`, `docs/`                                                  | `pnpm verify` green                                                                                 |

## Sources

- Design critique, 2026-10-14: `docs/reviews/design-2026-10-14.md` (today's measurements, the library facts, the T11 replay).
- WAI-ARIA Authoring Practices, radio group: https://www.w3.org/WAI/ARIA/apg/patterns/radio/
- WAI-ARIA Authoring Practices, button (toggle buttons with `aria-pressed`): https://www.w3.org/WAI/ARIA/apg/patterns/button/
- WAI-ARIA Authoring Practices, disclosure: https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
- WCAG 2.2, Understanding target size (minimum): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- Apple Human Interface Guidelines, search fields: https://developer.apple.com/design/human-interface-guidelines/search-fields
- Apple Human Interface Guidelines, disclosure controls: https://developer.apple.com/design/human-interface-guidelines/disclosure-controls
