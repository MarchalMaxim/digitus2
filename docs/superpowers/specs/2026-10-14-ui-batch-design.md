# UI design: the landing page, the dock, pause and the hand letters

- Scope: the landing page (TODO T6), the Practice controls in the dock (T1), the paused state (T10) and the hand letters on the keyboard (T11). The owner's requests are [GitHub issues](https://github.com/MarchalMaxim/digitus2/issues).
- Ownership: the library page's levels, shelves, thresholds and list shapes are specified in `2026-10-16-library-shelves-design.md`: four levels (Easy, Medium, Harder, Challenging) with style shelves replace six level pills, level lines, genre pills and folded collections. This document keeps everything else about the landing page (rows, the one red element, motion, keyboard and screen reader, the drop frame, the end line) and the three score-view decisions. Where a section below points to the shelves spec, the shelves spec is the definition.
- Brief, in the owner's words: "the landing page is a bit cluttered. Please divide into more easily parsable units"; "Make it easier to parse the overview of songs. Maybe add pill filters (for difficulty / genre). Keep the brutal simplicity though"; "some UI elements only appear when they are needed"; "Do not overclutter it with features and be brutal with this"; and, for T11, "Only when the L and R notes are close to each other, it is good to show the hand indicator."

## 1. The page in one paragraph

A first-time visitor reads the name, one sentence ("Finger numbers for piano. Pick a piece, press play, and follow the red note.") and one red button that names the first piece ("Start with Twinkle, Twinkle, Little Star"). A reader who has played a library piece before sees "Continue with" and that piece instead. Next to the button, once the library holds 100 pieces or more, sits a search field. Below them, once the library holds more than 40 pieces, one row of four level pills shows one level at a time, and inside the level the pieces sit on style shelves (shelves spec). A row is the title with its length on the right, plus a composer line only when the composer says something the heading does not. Opening your own score is one quiet line at the end, and a file dropped anywhere on the window opens. The page carries no finger legend (it lives in the score view), no file link above the button, no Start-here box, no "editor's fingering" tags, no "Traditional" or "Anonymous" on rows, no dashed drop zone and no "Level N:" prefixes.

## 2. Decisions that bind

- The red button is the whole welcome: name, sentence, button. "Continue" is set by the first Play of a library piece.
- The search field comes after the red button, in reading and tab order, so the primary action is read first.
- "Clear" in the search is a text button, with no glyph.
- Level pills wrap onto a second row rather than scroll sideways (at 320 px the last of the four pills wraps; from 360 px they share one row).
- No grade number appears on screen: one level name everywhere (pill, heading, search result heading, side panel).
- A level that is chosen keeps a minimum list height, so a shorter level never pulls the page up under the reader's finger.
- While a file is dragged over the window, a red frame covers a page set to `visibility: hidden`.
- The dock keeps the keyboard at its full width; Practice shares the first row with the status line from 480 px.
- Title shortening and composer hiding (section 5) are pinned by a test over the whole library.

## 3. Units

### 3.1 In reading order

The units of the library page, in reading order, are the table in shelves spec section 5. Three more appear only in their moment:

| Unit             | What it is for                              | Shown when                                   |
| ---------------- | ------------------------------------------- | -------------------------------------------- |
| The empty result | Says nothing matched and where search looks | Search text matches nothing                  |
| The drop frame   | Says the window takes the file              | Only while a file is dragged over the window |
| The notice       | Says why a file was refused                 | After a refusal, until dismissed             |

### 3.2 Where things live

| Not on the library page                                | Lives in                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| The finger legend                                      | The score view: above the music on score views opened before the reader's first Play; always in the side panel      |
| A file link above the red button                       | The end line                                                                                                        |
| "Editor's fingering" tags on rows                      | Nowhere; the score view says when it shows the editor's digits                                                      |
| The dashed drop zone with its extension list           | Nowhere; the window takes a dropped file, and the end line opens the file chooser                                   |
| Nine practice controls standing open in the score view | One "Practice" toggle in the dock at every width; the loop fields only after "Loop bars" is ticked; no "Clear loop" |
| An L or R over every pressed key                       | Only in bars where the hands come within a fifth (section 15)                                                       |

## 4. Levels and genres

### 4.1 Levels

Four levels, Easy, Medium, Harder and Challenging, group the manifest's grades 1 to 6 (shelves spec section 3). A level has a name and no grade number or description on the page.

### 4.2 Genres

A piece's genre is a controlled vocabulary kept in the content tools: the eight ids `songs`, `carols`, `baroque`, `classical`, `romantic`, `ragtime`, `modern` and `folk`, in that display order. The shelves fold them into six (shelves spec section 4).

- A genre belongs to a collection; a catalog piece may override it. The one override is `beethoven-fur-elise-woo-59` (in `character-pieces`, written 1810): `classical`, so the Romantic shelf's dates hold for every piece on it.
- One rule for arrangements: a simplified arrangement is Songs, whatever its source, because a beginner meets it as a tune. That covers the classical themes (Ode to Joy, Canon in D, Brahms's Lullaby) and "The Entertainer, A strain (simplified)". The early library's folk songs and the Swedish folk dances (`folk-songs`, `swedish-folk-dances`) are Songs too; the `folk` genre holds the folk and traditional pieces of the MuseScore archive (`pdmx-folk`). A search for "Joplin" or "polska" still finds the pieces a shelf name would hide.
- `content/tools/catalog.json` holds a `genres` table (`[{id, title}]`) beside `collections`; every collection names a `genre`, and a piece may carry `genre`. `build.py` refuses a collection without a known genre and a piece override that is not a known genre, as it refuses an unknown collection id, and writes `genre` (the id) on every manifest entry after `collectionId`. The app's labels live in `apps/web/src/library/levels.ts`, with a test that the app's ids equal the catalog's.

## 5. Rows

| Part            | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line 1          | The title (16 px, 600) at the left; the length (`m:ss`, gray, tabular figures) at the right of the first line at every width, also when the title wraps. No tags.                                                                                                                                                                                                                                                                                                       |
| Line 2          | The composer (16 px, gray), cut at the first " (" ("Lowell Mason (tune Antioch)" reads "Lowell Mason"). Left out when the composer is "Traditional…" or "Anonymous". Left out under a collection heading when every row of that group has the same composer and the heading names that composer's last name ("Schumann, Album for the Young, Op. 68"). Shown in full (cut at " (") whenever two rows in view would otherwise read the same title, "Anonymous" included. |
| Short title     | Under its own collection heading only, a title that ends in a parenthesis whose first comma-separated part is made of words that all appear in the heading loses that part: "Melody (Album for the Young, No. 1)" reads "Melody (No. 1)"; "Canon in D (simplified)" under "Classical themes, simplified" reads "Canon in D". "Progrès (Progress)" keeps its parenthesis. Flat lists, "Other pieces" and search results show full titles.                                |
| Accessible name | `Open {full title} by {full composer}`, described by the length.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Target          | The whole row is one button, at least 44 px tall.                                                                                                                                                                                                                                                                                                                                                                                                                       |

## 6. Disclosure

### 6.1 Thresholds

Constants in `apps/web/src/library/disclosure.ts`, each unit-tested at its boundary.

| Constant              | Rule                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PILLS_ABOVE = 40`    | Level pills (and shelves) replace the all-levels list when the library holds more than 40 pieces                                                                  |
| `SEARCH_FROM = 100`   | The search field stands in the start row when the library holds 100 pieces or more                                                                                |
| `HEADINGS_ABOVE = 12` | A list section (a level, a shelf, or one level of search results) of more than 12 pieces groups its rows under collection headings                                |
| `OTHER_BELOW = 3`     | With headings, collections with fewer than 3 pieces in the section gather in a last group, "Other pieces"; if no collection has 3 or more, the section stays flat |

The shelves spec adds `SAMPLES`, `PAGE_SIZE`, `SECTION_ROWS` and `LENGTH_ABOVE` (its sections 2 to 4).

Counts are never shown on pills or collection headings. A shelf shows its count (shelves spec 4.1); the screen-reader status speaks counts.

A threshold is crossed only by a new build of the library or by the reader's own choice. Nothing appears or vanishes while the reader looks, except the Clear button when the field gets text, the empty result, and the drop frame during a drag.

### 6.2 The list's shapes

| Shape          | When                                 | Looks like                                                                                            |
| -------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| All levels     | the library holds 40 pieces or fewer | each level a visible `h2` with its rows (flat, or grouped when that level has more than 12); no pills |
| One level      | more than 40 pieces, no search text  | the shelves of the chosen level, or one open shelf (shelves spec 4.1 and 4.2)                         |
| Search results | search text typed                    | the sections of shelves spec 4.4                                                                      |
| Empty result   | search text matches nothing          | "No piece matches “{query}”." and the gray line                                                       |

The list region has `min-height: 100vh` in the one-level shape, so a shorter level never shortens the page under the reader's finger (the scroll position is kept on a level change).

### 6.3 Selection

- **Levels:** a radio group; exactly one level is always chosen; no "All levels". The chosen level is, in order: the one chosen earlier in this visit; else the level of the last piece played (`lastPlayed`), if it is still in the library; else the lowest level present. Choosing another level replaces the list.
- **Search:** typing filters from the first character across every level. Each query word must be the start of a word of the title, the composer or the collection, ignoring case, accents and punctuation ("fur elise" finds Für Elise; "burgmuller" finds the Burgmüller studies; "minuet" finds Wanhal's Rondo through its collection "Minuets, dances and rondos"). Shelf names match too (shelves spec 4.4). While the field holds text the pills leave; emptying it brings back the same level.

### 6.4 Motion

Existing tokens: 120 ms `--dur-fast`, 160 ms `--dur`, `--ease`; all 0 under reduced motion; heights never animate.

| Change                             | Motion                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A level is chosen                  | The pill's fill and text colour change over 120 ms; the list swaps in one frame and fades in over 120 ms (opacity)           |
| The first character of a search    | The pills leave in one frame; the results fade in over 120 ms; later keystrokes swap without motion                          |
| The search is emptied              | The level view returns, faded in over 120 ms                                                                                 |
| A file is dragged over the window  | The frame fades in over 120 ms; it leaves in one frame on leave or drop                                                      |
| Practice opens in the dock (T1)    | The panel fades in over 160 ms with a 4 px rise; the dock grows upward in one frame; the toggle's marker turns 90° in 160 ms |
| Hand letters appear or leave (T11) | No motion, like the pressed keys                                                                                             |

## 7. The drop frame and a refused file

- While a file is dragged over the window, a frame 16 px inside the window edge, 2 px dashed in red, shows "Drop to open this file" (ink, 18 px, 600) and, in gray, "MusicXML, MIDI, photo or PDF". It is the screen's one red element: the page beneath, the start button included, is `visibility: hidden`. The frame is `aria-hidden`.
- It looks the same at 360 px (a tablet or a split-screen phone); a phone reaches its files through the end line. The page never mentions dropping.
- A refused file shows the existing gray notice, sticky at the top of the viewport, with a Dismiss button: "That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi)." The red stays on the start button.

## 8. Library scale

The library holds thousands of pieces. The genre row and the folded collections that were planned for that size are not built; style shelves, pages of 40 and length pills replace them (shelves spec). `content/library-index.json`, a compact columnar file, carries what the library page needs; the full manifest loads on demand only (shelves spec 6).

## 9. The one red element, in every state

| State                                                    | The red element                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Library, first visit, any size                           | "Start with {first piece of the lowest level}"                                     |
| Library, returning (a library piece played before)       | "Continue with {title}"                                                            |
| A level chosen; a shelf open; search results; empty      | The same button                                                                    |
| The list scrolled past the button                        | None in view; the DOM still holds exactly one                                      |
| A file dragged over the window                           | The drop frame; the page beneath, start button included, is `visibility: hidden`   |
| A refused file                                           | The start button; the notice is gray                                               |
| Score, ready or rewound or at the end                    | Play                                                                               |
| Score, loading the piano                                 | Play (busy)                                                                        |
| Score, count-in and lead-in                              | Pause                                                                              |
| Score, playing                                           | The cursor's notes                                                                 |
| Score, paused after a note was heard (T10)               | The cursor's notes of the last group heard; Play is plain                          |
| Score, paused before any note was heard (in the lead-in) | Play                                                                               |
| Score, Practice open or closed (T1)                      | Unchanged by Practice; the toggle is a disclosure (a marker that turns), never red |
| About; error states                                      | "Back to the library"                                                              |

Chosen pills are ink-filled, never red. The hand letters, the Clear button, the search field, the notice and the end line are never red.

**Note selection (M5, not built).** A click that selects a note while playback is paused must not create a second red root. The rule: a note selected while paused takes the red, and the paused cursor's marks and pressed keys clear. When the selection is cleared, the paused group is marked again, because the position to resume is unchanged. Play is primary only when nothing is selected and no resume point is shown (`!playing && !selectionActive && !resumeShown`).

## 10. Exact copy

| Element                                                                                                                                         | Text                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Document title, `h1`                                                                                                                            | digitus2                                                                                                                            |
| Sentence                                                                                                                                        | Finger numbers for piano. Pick a piece, press play, and follow the red note.                                                        |
| Red button, first visit                                                                                                                         | Start with {title} (the first piece of the lowest level, in manifest order: Twinkle, Twinkle, Little Star)                          |
| Red button, returning                                                                                                                           | Continue with {title without a trailing parenthesis} ("Continue with Für Elise")                                                    |
| Search field                                                                                                                                    | placeholder "Search pieces and composers"; accessible name "Search the library"                                                     |
| Clear button                                                                                                                                    | "Clear"; accessible name "Clear the search"                                                                                         |
| Level group (visually hidden legend)                                                                                                            | Level                                                                                                                               |
| Level pills, shelf names, lines and buttons                                                                                                     | shelves spec sections 3, 4 and 9                                                                                                    |
| Collection heading (h3)                                                                                                                         | the collection's title from the manifest                                                                                            |
| Leftover group (h3)                                                                                                                             | Other pieces                                                                                                                        |
| Row                                                                                                                                             | {title}, {m:ss}, the composer line when shown; accessible name "Open {full title} by {full composer}"                               |
| Library announcement (visually hidden `aria-live="polite"` paragraph, not `role="status"`, which the notice uses; 500 ms after the last change) | shelves spec 7; "No piece matches “{query}”." for an empty search                                                                   |
| Empty result, line 1 (ink)                                                                                                                      | No piece matches “{query}”.                                                                                                         |
| Empty result, line 2 (gray)                                                                                                                     | Search looks in titles, composers and collections.                                                                                  |
| End line                                                                                                                                        | Open your own score                                                                                                                 |
| Footer                                                                                                                                          | About and licences                                                                                                                  |
| Drop frame, line 1 (ink, 18 px, 600)                                                                                                            | Drop to open this file                                                                                                              |
| Drop frame, line 2 (gray)                                                                                                                       | MusicXML, MIDI, photo or PDF                                                                                                        |
| Refusal notice                                                                                                                                  | That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).                                             |
| Score, finger legend                                                                                                                            | Finger numbers: 1 is the thumb and 5 the little finger, in both hands. The upper staff is the right hand, the lower staff the left. |
| Score side panel, level                                                                                                                         | the level name alone ("Easy")                                                                                                       |
| Dock toggle                                                                                                                                     | Practice                                                                                                                            |
| Loop                                                                                                                                            | checkbox "Loop bars"; then two fields named "Loop from bar" and "Loop to bar" with "to" between them                                |
| Reversed loop                                                                                                                                   | The loop needs "from" before "to".                                                                                                  |

## 11. Keyboard and screen reader

- **Order and landmarks.** `main` holds the page. Tab order follows reading order: the red button, the search field, Clear (while shown), the level pills (one stop), the rows, the end line's file input, the footer. The `h1` takes the focus on arrival and on Back and is not a tab stop.
- **Level pills.** A `fieldset` with the visually hidden legend "Level"; each pill a `label` around a native `input type="radio"` that covers it (the `.segmented` technique). Tab enters on the chosen pill; the arrow keys move and select, wrapping. The focus stays on the pill while the list changes; the library announcement speaks the new level's count once, 500 ms after the last change. The focus ring is 2 px ink with a 2 px offset, outside the pill.
- **Search.** A `div role="search"` holding `input type="search"` named "Search the library". Escape with text empties it (the focus stays); the native clear glyph is hidden by CSS so "Clear" is the only clear control. Clear puts the focus back in the field. The announcement speaks the count or "No piece matches “{query}”."
- **Rows.** A `button` in an `li`.
- **Headings.** `h1` the name; `h2` the shelves, and the level sections of search results; `h3` the collections and "Other pieces".
- **Own file.** The end line is a `label` styled as a text button around a visually hidden `input type="file"`, so its accessible name is "Open your own score"; the label shows the focus ring while the input has the keyboard focus. The drop frame is `aria-hidden`; a refusal uses the notice.
- **Dock (T1).** "Practice" is a `button` with `aria-expanded` and `aria-controls`; Space and Enter toggle it. Escape with the focus inside the open panel closes it and returns the focus to the toggle. The status line stays the dock's only live region.
- **Contrast and targets.** Gray text is `--gray-3` (4.54:1 on white); rows turn their gray text ink on hover and focus. Every control is at least 44 px tall to the touch.

## 12. The score view's reading aids

The finger legend appears in exactly one place at a time. It shows under the score header's credit line, in the 14 px `.finger-legend` style, on every score view opened while `legendSeen` is false, below 900 px, with the side panel's copy hidden; from 900 px only the side panel's copy shows. The first Play anywhere sets `legendSeen`; after it the side panel's copy shows at every width and the header's never again. The decision is taken when the score view mounts, so the legend never vanishes under a playing cursor. The side panel's level reads the level name alone.

## 13. T1: the dock and Practice at every width

One "Practice" toggle in the dock at every width; nothing stands between the title and the music. The panel's controls: Tempo with its value; the Hands control; Metronome; Count-in; "Loop bars". The open state lasts for the visit (every page load starts closed).

| Width | Practice                           | Status line                         | Keyboard        |
| ----: | ---------------------------------- | ----------------------------------- | --------------- |
|   360 | in the Play and Rewind row         | its own row above, when it has text | full width      |
|   768 | first row of the dock, at the left | first row, at the right             | keeps its width |
|  1280 | first row of the dock, at the left | first row, at the right             | keeps its width |

- **Loop.** Ticking "Loop bars" shows the two fields, filled with the bar the cursor is in (bar 1 when nothing is marked) and the next bar, both clamped to the piece's last bar, and the loop applies at once. Unticking hides the fields and turns the loop off; the bars typed come back if it is ticked again in the same score view. A range typed in reverse says "The loop needs "from" before "to"." and is not applied.
- **The toggle's look.** A 44 px text button in ink, 600 weight, with a small triangle marker drawn in CSS before the word (pointing right when closed, turned 90° down when open), the look of the side panel's "Details" summary. It is a disclosure, not a state: it is never filled and never red.
- **Keys and focus.** As section 11. The dock's negative `scroll-margin-bottom` covers the panel, so focusing a control in it never scrolls the page.
- **Layout.** The dock grows upward when the panel opens or the status line speaks below 480 px; from 480 px the status line shares the toggle's row, so it adds no height. `--dock-h` (measured by `useDockHeight`) keeps the cursor above the taller dock.

## 14. T10: the paused state

- While playing, the cursor is red.
- **Pause after a note was heard:** the last group heard keeps the red, its keys stay pressed on the keyboard with their fingers (and the muted hand's keys stay dimmed), and Play is plain. Pressing Play resumes from where the music stopped.
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
6. **Size.** 10 px on white keys and 9 px on black keys, 600 weight, ink, never red; dimmed with the muted hand (opacity 0.4). The letters show less often; larger letters would make them more prominent, which works against the owner's "a bit distracting".

**Why there is no phone exception.** Lettering the visible keys whenever one hand is scrolled out of a phone's keyboard, decided per onset, letters exactly the far-apart notes the owner asked to leave plain, and it switches on and off within a bar: Amazing Grace was lettered at single onsets at 14.25 s, 16.50 s and 18.00 s (bars 7 and 8), which is 6 switches where this rule gives none; the G major minuet got 11 more onsets and 10 more switches. A bar-stable latch would fix the flicker but keep the first problem. The reader still finds the hand in the score: the right hand is the upper staff and the left hand the lower one, and each red note at the cursor sits on its hand's staff. The periodic UI review looks at a phone keyboard with one hand scrolled away (the G major minuet and Amazing Grace at 360 px, in bars the rule leaves plain). If a reader is lost there, the fallback is the bar-stable version: a hand out of view during a bar keeps the letters to the bar's end, keyed by the cursor group's measure index, with the same one-bar bridge.

**Why a fifth and not an octave.** In this repertoire the hands sit about an octave apart most of the time (median gap 15 semitones in the G major minuet) and are never confusable there. An octave per onset letters 34 % of the minuet's onsets and switches 41 times in 50 s, and an octave with hysteresis still letters 53 %. That fails "only when the L and R notes are close to each other". A fifth, decided per bar with the one-bar bridge, letters 44 of the minuet's 137 onset groups (table below), where the hands really do meet (bar 26: left C4 E4 against right F#4), and never letters Amazing Grace.

**Replayed on the library (engine parse of `content/scores/`, this rule):**

| Piece                            | Bars | Bars lettered (0-based measure index) | Onset groups lettered | Switches |
| -------------------------------- | ---: | ------------------------------------- | --------------------: | -------: |
| Twinkle, Twinkle, Little Star    |   12 | 3 to 7, 11                            |              20 of 42 |        3 |
| Amazing Grace                    |   15 | none                                  |               0 of 35 |        0 |
| Happy Birthday                   |    9 | 2, 3                                  |               6 of 25 |        2 |
| Ode to Joy                       |   16 | 1 to 10, 13 to 15                     |              51 of 62 |        3 |
| Minuet in G major (BWV Anh. 114) |   32 | 0, 6, 7, 11, 14, 24 to 27, 31         |             44 of 137 |       11 |
| Arabesque (Burgmüller)           |   33 | 2, 3, 17 to 20, 23 to 27              |             45 of 140 |        6 |
| Mozart, K. 545, 1st movement     |   73 | 36 bars close, 38 lettered            |            514 of 990 |       20 |

Without the bridge (rule 3) Twinkle switches 7 times and Ode to Joy 11 times in 36 s; with it, 3 and 3. Without any rule, every one of these pieces would show letters on every pressed key. The table holds at every width, phones included, because rule 5 adds nothing on a phone.

## 16. Persisted and visit state

| Field                                | Kept                                                                  | Set by                                                              | Fallback                                                                       |
| ------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `lastPlayed`                         | persisted in the settings (`digitus2.settings.v1`, validated on load) | every Play of a library piece (`markPlayed`); never a dropped file  | a slug no longer in the library acts as none: "Start with …", the lowest level |
| `legendSeen`                         | persisted in the settings                                             | the first Play anywhere                                             | false                                                                          |
| `libraryLevel`                       | the visit                                                             | a level pill                                                        | `lastPlayed`'s level, else the lowest level                                    |
| `libraryQuery`                       | the visit                                                             | the search field                                                    | empty                                                                          |
| Open shelf, pages shown, length pill | the visit                                                             | a shelf's "All" button, "Show more", a length pill (shelves spec 4) | no shelf open, one page, any length                                            |
| `practiceOpen`                       | the visit                                                             | the Practice toggle                                                 | closed                                                                         |
| `libraryScrollY`                     | the visit                                                             | leaving the library                                                 | 0                                                                              |

Back from a score restores the level, the query, the open shelf with its pages and then the scroll (within 50 px). The settings keep their storage key and version; the merge validates every field, so older payloads load with new fields at their defaults.

## 17. Budgets

Held by the end-to-end tests (`e2e/states.spec.ts`, `library.spec.ts`, `playback.spec.ts`, `hand-letters.spec.ts`), on the desktop (1280 x 900) and mobile (360 x 740) projects:

- Exactly one red root in every library state: first visit, a level chosen, returning, search, empty, drag, notice.
- No horizontal page scroll at 360, 768 and 1280 in every library state.
- First visit: the red button's top at most 160 px at 360 and 130 px at 1280; the first row on the first screen; the four level pills on one row and wholly inside the viewport from 360 px.
- At most 37 visible words before the first piece: the name 1, the sentence 14, the red button 6, the four pills 4, the first shelf's name 1, count 2 and line 9. The budget may not grow.
- The red button comes before the search field in the tab order.
- Back restores the level and the scroll within 50 px.
- Library LCP under 2 s; the entry chunk under 150 KB gzip; zero serious or critical axe violations in every state.
- Score view, with the legend already seen: the first system's top at most 240 px at 360 and 220 px at 768 and 1280; from 480 px the dock's height does not change when the status line gets text; the keyboard keeps its width.
- Paused: one red root, the cursor's group; keys still pressed; Rewind gives Play the red.
- Letters: none in Amazing Grace from its first bar to its last (sampled past 19 s, through bars 7 and 8); none in Twinkle's bars 1 to 3, both L and R in its bar 4.

## Sources

- WAI-ARIA Authoring Practices, radio group: https://www.w3.org/WAI/ARIA/apg/patterns/radio/
- WAI-ARIA Authoring Practices, disclosure: https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
- WCAG 2.2, Understanding focus order: https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html
- WCAG 2.2, Understanding target size (minimum): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- Apple Human Interface Guidelines, search fields: https://developer.apple.com/design/human-interface-guidelines/search-fields
