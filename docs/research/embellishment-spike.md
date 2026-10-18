# Embellishing simple melodies with passing and neighbour notes: research spike

*Research report for [issue #38](https://github.com/MarchalMaxim/digitus2/issues/38). The code is
in `research/embellish/`: the embellisher, an independent checker, the scoring run, the report and
the listening material. Scores generated in bulk go to `research/data/embellish/`, which is not
committed. The listening files are committed in `research/embellish/listening/`.*

## 1. Question and answer in brief

**Question.** Can a fixed set of rules embellish the library's simplest pieces (all 259 at levels
1 and 2) the way a person who whistles a tune fills it in? Every result must also meet three
conditions:

- the engine's fingering stays free of lint law errors;
- the level heuristic rises by at most one;
- every melody note on a strong beat stays where it is.

**Answer.** Mechanically, yes. All three conditions hold on every piece the rules touch.

| | light | playful |
|---|---:|---:|
| Pieces embellished | 230 of 259 | 242 of 259 |
| Pieces refused (no clear melody voice) | 8 | 8 |
| Notes added, median share of the piece | 4.3% | 14.4% |
| Embellished pieces with zero law errors (L01-L05) | 230 of 230 (100%) | 242 of 242 (100%) |
| Melody pitches on strong positions kept | 9,441 of 9,441 | 9,887 of 9,887 |
| Level proposal one up | 2 (1%) | 11 (5%) |
| Level proposal two or more up | 0 | 0 |
| Pieces with more beginner errors (L06, L10) than the plain score | 3 | 6 |

The open question is whether it sounds good. That is for the owner's listening test and the
blinded teacher batch (section 5). On inspection, light sounds natural. Playful sounds busy and
sometimes mannered.

## 2. Method

1. **Reading.** The embellisher reads a library score as partwise MusicXML, unzipping `.gz`
   archive scores in memory. It builds the timeline of every note: onset, length, voice, staff,
   and the key and meter in force. The library file is only read.
2. **Melody.** The melody is the voice of staff 1 (the right hand) that holds the highest sounding
   note at the most right-hand onsets. A piece is refused when:
   - it is not one piano part on two staves;
   - that voice holds the top line at fewer than 90% of the onsets;
   - more than a quarter of its onsets are chords.

   Chords inside an accepted melody are left alone.
3. **Rules.** Candidates are found for every melody note (section 3). Each new note must meet
   five conditions:
   - it is in the key signature's scale;
   - it starts after the note it splits, never on a strong position;
   - it is higher than every other note sounding while it lasts;
   - it is not a semitone from an accidental elsewhere in the bar;
   - it is at least an eighth long.
4. **Densities.** A density picks among the candidates, deterministically, in rule order and then
   in time order.
5. **Writing.** The embellisher edits the XML in place:
   - the chosen note keeps its onset and pitch, and its length and note type are shortened;
   - the new notes follow it as `<note>` elements in the same voice and staff;
   - beams are removed from the edited notes only;
   - nothing else in the file is touched.

   When the file's `<divisions>` cannot express an eighth (one division per quarter in 26 of the
   259 pieces, 25 of them from the archive), every `<divisions>`, `<duration>` and `<offset>` is first multiplied by the same
   factor. The numbers change; the music does not.
6. **Independent check** (`check.py`). The check reads both files with the content pipeline's own
   reader (`content/tools/xmlcheck.py`) and derives the strong positions again. It verifies that:
   - the measure lengths are the same;
   - every note outside the melody voice is unchanged, compared as onset, pitch, length, staff,
     voice and grace;
   - every plain melody note still starts at its onset with its pitch;
   - every extra note is a recorded insertion;
   - no insertion starts on a strong position;
   - each melody pitch that sounds on a strong position still sounds there, and is still struck
     there if it was struck in the plain score ("strong kept").
7. **Engine.** The built CLI runs on each file: `inspect`, then
   `finger <file> --level beginner --format pig`, then `lint <file> --fingering <pig> --beginner --json`.
   This uses the default hand profile (large) for the span tables.
   - Law errors are L01 to L05.
   - Beginner errors are L06 and L10, which the beginner lint raises to errors (see
     `packages/engine/src/lint/rules.ts`).
   - The plain score goes through the same pipeline (density `none`), so every count is compared
     with the plain score.
8. **Level.** The level comes from the frozen heuristic of `content/tools/level.py`: `features`,
   `score`, `propose` with its CUTS, at the manifest tempo. "Before" is the proposal for the plain
   score, not the catalogue level, so before and after are measured the same way.

The full run over 259 pieces and 3 densities takes about six minutes with four workers. To
reproduce it, build the engine with `pnpm --filter @digitus2/engine build`, then run:

```bash
research/.venv/Scripts/python.exe -m pytest research/embellish/tests -q -p no:cacheprovider   # 30 tests
research/.venv/Scripts/python.exe -I research/embellish/run.py          # research/data/embellish/results.json
research/.venv/Scripts/python.exe -I research/embellish/report.py       # the tables below
research/.venv/Scripts/python.exe -I research/embellish/listening.py    # research/embellish/listening/
```

## 3. The rules as implemented

Musically, these are the unaccented non-chord tones: passing tones, neighbour tones and
anticipations ([Nonchord tone](https://en.wikipedia.org/wiki/Nonchord_tone);
[Passing tones, Puget Sound Music Theory](https://musictheory.pugetsound.edu/mt21c/PassingTones.html)).
They are used here as diminution, which divides a long note into shorter melodic values
([Diminution](https://en.wikipedia.org/wiki/Diminution)). In the table, A is the note that is split
and B is the next melody note, which starts where A ends.

| Rule | When | What is played | Example |
|---|---|---|---|
| passing | A and B a third apart (3 or 4 semitones), both in the key | the weak end of A becomes the scale step between them | C-E becomes C-D-E |
| neighbour-repeated | B repeats A's pitch | the weak end of A becomes the upper scale step; B is the return | E-E becomes E-F-E |
| anticipation | A is a quarter or dotted quarter; B is on the next downbeat, a different pitch within a fifth, in the key | the last eighth of A sounds B early | E \| A becomes E-A \| A |
| neighbour-long | A is a half note or longer | A, its upper scale step, A again | G (half) becomes G (quarter)-A-G (eighths) |

**How a note is split.** The table gives the length of A, then how it is divided:

| A's length | Divided into |
|---|---|
| quarter | two eighths |
| dotted quarter | quarter and eighth |
| half | two quarters |
| dotted half | half and quarter |
| whole | dotted half and quarter |

- In compound meters, only the quarter and the dotted quarter are split.
- neighbour-long divides a half into quarter, eighth, eighth; a dotted half into three quarters;
  a whole into dotted half, eighth, eighth.
- A split that would put a new note on a strong position is not made.

**Strong positions.** These are the downbeat, and the middle of the bar in 4/4, 2/2, 4/2, 6/4,
4/8, 6/8 and 12/8. A pickup bar is counted from its end.

**Notes the rules never touch:**

- tied notes, tuplets, fermatas and grace notes;
- chords;
- notes in the last bar, and the last melody note;
- notes shorter than a quarter, so nothing new is shorter than an eighth.

**Key.** The key is the scale of the key signature in force. A minor key therefore uses natural
minor, and a passing note between a raised leading tone and its neighbour is never written.
Spelling follows the signature, so E-G in G major gives F#.

**Densities.**

| Density | Rules | At most |
|---|---|---|
| none | none: the plain score, byte for byte | - |
| light | passing, neighbour-repeated | one figure per bar, never in two neighbouring bars |
| playful | all four, in the priority passing, neighbour-repeated, anticipation, neighbour-long | two figures per bar |

A figure is one rule applied to one note. A neighbour-long figure adds two notes.

## 4. Results

The numbers in this section come from `research/embellish/report.py` on the run of all 259
level 1 and level 2 pieces. Under the beginner solve, no plain score has a law error, and 21 plain
scores have a beginner error (L06 or L10).

### 4.1 Summary per density

| Measure | light | playful |
|---|---:|---:|
| Pieces embellished (at least one note added) | 230 of 259 | 242 of 259 |
| Pieces accepted with nothing to add | 21 | 9 |
| Pieces refused | 8 | 8 |
| Notes added, total | 1,496 | 6,105 |
| Figures per embellished piece, median | 5 | 18 |
| Notes added as a share of the piece's notes, median | 4.3% | 14.4% |
| Own check passes (untouched notes, strong positions) | 230 of 230 | 242 of 242 |
| Melody pitches on strong positions kept | 9,441 of 9,441 | 9,887 of 9,887 |
| Engine reads the file (`inspect`) | 230 of 230 | 242 of 242 |
| Zero law errors (L01-L05) | 230 of 230 (100%) | 242 of 242 (100%) |
| More law errors than the plain score | 0 | 0 |
| Zero beginner errors (L06, L10) | 213 of 230 | 219 of 242 |
| More beginner errors than the plain score | 3 | 6 |
| Lint warnings per 1,000 notes, plain to embellished | 135 to 147 | 136 to 148 |
| Level proposal unchanged | 228 (99%) | 231 (95%) |
| Level proposal one up | 2 (1%) | 11 (5%) |
| Level proposal two or more up | 0 | 0 |
| Level score change, median | +0.02 | +0.08 |

### 4.2 Figures per rule

| Rule | light | playful | Candidates found |
|---|---:|---:|---:|
| passing | 954 | 1,450 | 1,468 |
| neighbour-repeated | 542 | 1,357 | 1,497 |
| anticipation | 0 | 1,164 | 1,609 |
| neighbour-long | 0 | 1,067 | 1,627 |

### 4.3 Melody notes left alone

Each melody note that gets no candidate is counted once, under its first reason in rule order.
The counts are over all pieces.

| Reason | Notes |
|---|---:|
| no rule fits (steps, leaps, or a note too short for neighbour-long) | 11,004 |
| too short or odd length (an eighth or less, or a length outside the split table) | 5,035 |
| tied | 1,430 |
| last bar or last note | 404 |
| chord in the melody | 385 |
| the new note would start on a strong position | 212 |
| tuplet | 212 |
| a semitone from an accidental in the bar | 82 |
| would not be the top line (equal to or below another sounding note) | 18 |
| fermata | 9 |

### 4.4 Refusals

| Reason | Level 1 | Level 2 |
|---|---:|---:|
| the melody voice plays chords (more than 25% of its onsets) | 0 | 5 |
| two right-hand voices share the top line (the leading voice has it at under 90% of the onsets) | 0 | 3 |

The eight refused pieces:

| Piece | Reason |
|---|---|
| `handel-aylesford-minuet-d-minor` | chords at 55% of onsets |
| `schumann-op68-no2-soldiers-march` | chords at 72% |
| `pdmx-erik-satie-enfantillages-pittoresques-be-639ad423` | chords at 41% |
| `pdmx-implicit-demand-for-proof-ea632f7a` | chords at 36% |
| `pdmx-octobre-francis-cabrel-a63d76bf` | chords at 28% |
| `pdmx-03-marche-in-gmajor-c-p-e-bach-d37a4e6b` | top line at 89% |
| `pdmx-new-world-03542b71` | top line at 82% |
| `pdmx-angeles-de-dios-73309069` | top line at 74% |

Of the 21 pieces accepted with nothing to add at light, most are melodies in eighths or in steps,
such as the Hanon exercise and the *Surprise Symphony* theme. `pdmx-duet-for-pipes` has only
triplets and tied notes.

### 4.5 Level proposal before and after (embellished pieces)

| Catalogue level | Proposal for the plain score | light: proposals after | playful: proposals after |
|---|---|---|---|
| 1 | 1 | 1: 41, 2: 1 | 1: 38, 2: 5 |
| 1 | 2 | 2: 3 | 2: 4 |
| 2 | 2 | 2: 159, 3: 1 | 2: 160, 3: 6 |
| 2 | 3 | 3: 25 | 3: 29 |

Most rises in the proposal are small rises in the score of a piece that sits just under a cut
point (1.76, 4.09). *See-Saw, Margery Daw*, for example, goes from 1.735 to 1.804 at light with 3
notes added. The largest rises in the score are:

- *Warum betrübst du dich, mein Herz*, playful: 2.18 to 2.82, with 53 notes added. The proposal
  stays at 2.
- *When the Saints*, playful: 1.23 to 1.83.
- The Bartók *For Children* II/1, playful: 3.90 to 4.49. At light it goes from 3.90 to 4.39 with
  only 11 notes, because the added notes open new five-finger windows, which the heuristic counts
  as position shifts.

### 4.6 Lint counts on the 230 pieces embellished at both densities

| Rule | plain | light | playful |
|---|---:|---:|---:|
| L06 non-thumb crossing (beginner error) | 29 | 28 | 34 |
| L07 uncomfortable span or shift | 873 | 865 | 864 |
| L08 thumb on a black key | 259 | 290 | 276 |
| L09 fifth on a black key | 153 | 163 | 179 |
| L10 thumb onto a black key (beginner error) | 2 | 7 | 7 |
| L11 fast hop with the same finger | 6 | 11 | 24 |
| L12 fast repeated key with the same finger | 42 | 43 | 61 |
| L13 slow repeated key with a finger change | 1,120 | 1,059 | 1,147 |
| L14 agility (3 to 4, 3-4-5) | 4,027 | 4,673 | 5,399 |
| L15 thumb crossing inside a position | 3 | 3 | 5 |
| L24 thumb crossing shown to a beginner | 535 | 588 | 549 |
| Notes | 39,623 | 41,119 | 45,628 |

Two warnings grow faster than the notes do:

- **L14** goes from 102 to 114 (light) and 118 (playful) per 1,000 notes. A passing note between
  fingers 3 and 5 is fingered 3-4-5.
- **L11** goes from 6 to 24. Playful's eighths after a long note make fast hops.

The beginner errors that rise come from these piece and density pairs:

| Piece | Density | Change |
|---|---|---|
| `schumann-op68-no3-humming-song` | playful | L06 0 to 4 |
| `pdmx-bart-k-b-la-for-children-book-2-01-all-t` | light and playful | L10 0 to 5 |
| `pdmx-sonatina-in-g` | light and playful | L06 0 to 1 |
| `pdmx-tsugaru-jongara-bushi` | light | L06 1 to 2 |
| `pdmx-erik-satie-gnossienne-n1` | playful | L06 1 to 2 |
| `pdmx-a-hat-in-time-ost-welcome-to-mafia-town` | playful | L06 0 to 1 |
| `pdmx-vanishing-grace` | playful | L06 0 to 2 |

No law error is added anywhere.

The per-piece table is in the appendix.

## 5. What sounds right and what sounds wrong, on inspection

This judgement comes from reading the melodies of the ten listening pieces at all three densities
(`research/embellish/listening/`). It is the author's reading of the notes, not a listening test.
In the examples, `*` marks an added note and `|` a bar line.

**Light sounds right.** One figure every other bar keeps the tune in front.

| Piece | Plain | Light |
|---|---|---|
| Twinkle | C C G G | C *D C G G |
| Scarborough Fair | A C D | A *B C D |
| Camptown Races | G G E | G *F E |
| Ode to Joy, bar 9 | D D E C | D D E *D C |

Each sounds like a singer's slide rather than a new tune. Passing notes that fill a third are the
most convincing rule. They are also the most common: 954 of the 1,496 notes added at light.

**Playful works when the tune moves slowly.**

- *When the Saints*: the half notes G-E-C-E become a walking line G-*F-E-*D-C-*D-E, and the held G
  gets G-*A-G at the end of its bar. To the author, this reads like a natural jazz-band
  variation of the tune.
- *Jingle Bells*: the repeated F F F becomes F *G F *G F, a trill-like figure that suits the song.

**Playful sounds wrong or mannered in four ways:**

1. **The same figure in every bar.** Twinkle at playful turns every repeated pair into an upper
   neighbour: C *D C G *A G | A *B A G. The tune survives, but the effect is a mannerism, not a
   variation. The density is per bar, so an even, repetitive tune gets an even, repetitive
   embellishment.
2. **Cadences lose their rest.** neighbour-long fills the final long note of a phrase, as in
   Twinkle bar 4 (C becomes C *D *C) and Camptown Races (C becomes C *D *C). A cadence wants
   stillness. The anticipation rule leaves out half notes and longer for this reason (section 3);
   neighbour-long has no such exclusion and still fills cadences.
3. **Upper neighbour a semitone up.** E-F-E and B-C-B are correct in the key but sound fussier
   than the whole-step figures. A lower neighbour, or the upper neighbour only when it is a whole
   step, may sound better. The listening test should say.
4. **Harmony is not analysed.** The rules treat every strong-beat melody note as a chord tone and
   keep it. They do not check that a passing or neighbour note fits the left hand's chord on its
   weak half. Over a held left-hand chord the clash is brief and usual for a non-chord tone. The
   82 "accidental nearby" skips remove the worst cases: a natural against a sharp in the bar.

**Formatting.** The added eighths carry no beams in the file, so the score shows flags. Verovio
6.3.0, the app's renderer, does not beam them itself: on the 30 listening files it reports the same
number of beams as in the plain files. Verovio 6.3.0 loads and renders all 30 files without an
error, and its note counts differ from the plain files by exactly the recorded insertions. Lyrics
stay on the first part of a split note, so the new notes form a melisma.

## 6. Recommendation for the app side

Build the app side only if the owner likes the listening test. If so, keep it small.

**One choice.** "Add notes between" is a single on/off switch in the Practice panel, next to the
hands, loop and speed controls.

- It is off by default, and is not remembered across pieces.
- It appears only on pieces the embellisher accepts that get at least three light figures. That is
  195 of the 259 level 1 and 2 pieces, and the switch is hidden on the rest.
- On, it plays and shows the **light** density. Playful is not offered, because two densities
  would need a second control and playful's mannerisms are the main risk. If the owner prefers
  playful in the test, the switch gives playful instead; it should not offer both.
- The piece's level, title and export stay those of the plain score. Export writes the plain
  score unless the user asks otherwise.

**The pipeline**, all in the browser:

1. **Embellish the MusicXML text.** Port `research/embellish/core.py` (about 600 lines with its
   documentation) to
   TypeScript as a pure function from text to text, with the record of inserted notes. The app
   renders MusicXML with Verovio and parses it with the engine's reader, so text in and text out
   fits both. It needs the same refusals, the divisions scale-up and the per-note guards.
2. **Re-solve.** The worker solves the embellished score as it solves any score. The solver needs
   nothing new: the added notes are ordinary notes, and no law error appeared in 472
   piece-densities. Editorial fingerings of the original notes stay pins; added notes get no pin.
3. **Guard with the lint.** Lint the new fingering at the user's level. If it has a law error, or
   more beginner errors than the plain score, drop the figures in the bars of the offending notes
   and solve again. If that still fails, do not offer the switch on that piece. On this run, that
   applies to 3 pieces at light.
4. **The red follows the new notes.** The cursor, the keyboard and the playback use the
   embellished score, so the one red element marks the added notes like any other.

**What the solver and engine need:**

- nothing in the cost model;
- a TypeScript embellisher in `packages/engine` (beside `io/`), so the web app and the CLI share
  it;
- a CLI command (`digitus2 embellish <file> --density light`), so `pnpm verify` can run a library
  gate over the level 1 and 2 pieces: zero law errors, no added beginner errors, level at most one
  up, strong positions kept.

The checks in `research/embellish/check.py` are the specification for that gate's tests.

**Before building:**

- Act on the listening test's answers on semitone neighbours (point 3 in section 5) and on
  cadences (point 2).
- Consider two cheap rule changes: no neighbour-long on the last long note before a rest or a
  phrase-final bar, and an upper neighbour only when it is a whole step.

## 7. Listening material

`research/embellish/listening/` holds the material for the issue's second step:

- ten pieces, six curated arrangements and four MuseScore-archive pieces, in plain, light and
  playful versions, ready to drop into the app (30 files, 1.2 MB in total, each under 60 kB);
- the questions for the owner;
- a blinded teacher batch in the shape of `research/teacher_review`: 30 four-bar passages in five
  batches, a listening brief and the key.

The batch reuses `teacher_review`'s data model and text renderer without the fingering column.
No collector or scorer is built for it. The listening README says what one would need.

## 8. Limits

- **The heuristic is crude.** The level proposal is the frozen heuristic, fitted on 30 labelled
  pieces. It counts density, shifts and leaps, not musical difficulty, so a rise of zero is not
  proof that a piece is no harder to learn.
- **One profile.** The lint uses the large hand profile, and the app lets the user choose a
  smaller hand. The spike does not run the beginner solve at `child` or `small`.
- **No harmony.** The rules know the key and the meter, not the chords. In particular, they cannot
  tell that a downbeat melody note is itself a non-chord tone (an appoggiatura); it is kept as if it
  were a chord tone, which is safe.
- **No phrases.** The density counts bars, not phrases, and nothing detects a phrase end other
  than the anticipation's half-note rule and the last bar.
- **No XSD validation.** The embellished files are checked by the content pipeline's reader, the
  engine's `inspect` and, for the 30 listening files, Verovio 6.3.0. They are not checked against
  the MusicXML 4.0 XSD. The new `<note>` elements follow the schema's child order (pitch, duration,
  voice, type, dot, stem, staff).
- **Nobody has listened yet.** The judgements in section 5 come from reading the notes. The
  listening test decides.

## 9. Sources

- Nonchord tone (passing, neighbour, anticipation): https://en.wikipedia.org/wiki/Nonchord_tone
- Diminution: https://en.wikipedia.org/wiki/Diminution
- Passing tones, *Music Theory for the 21st-Century Classroom*, University of Puget Sound:
  https://musictheory.pugetsound.edu/mt21c/PassingTones.html
- MusicXML 4.0 `<divisions>`: https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/divisions/
- PDMX, the source of the MuseScore archive pieces: https://zenodo.org/records/15571083
- The blinded review protocol reused here: `docs/research/teacher-review.md`, sections 2 and 6.

## Appendix: per piece

In the table below:

- **Cat.** is the catalogue level.
- **Proposal** is the level heuristic for the plain, light and playful versions.
- `=` means nothing was added at that density.
- `-` means the piece was refused.
- **Strong kept** is the number of strong-position melody pitches kept out of the total. One
  value is shown when both densities agree.

| Piece | Cat. | Proposal plain / light / playful | Added light / playful | Law errors plain / light / playful | Beginner errors plain / light / playful | Strong kept | Note |
|---|---:|---|---|---|---|---|---|
| alle-meine-entchen | 1 | 1 / 1 / 1 | 2 / 8 | 0 / 0 / 0 | 0 / 0 / 0 | 10/10 |  |
| au-clair-de-la-lune | 1 | 1 / 1 / 1 | 7 / 35 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| camptown-races | 1 | 1 / 1 / 1 | 4 / 23 | 0 / 0 / 0 | 0 / 0 / 0 | 31/31 |  |
| frere-jacques | 1 | 1 / 1 / 1 | 4 / 11 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| hot-cross-buns | 1 | 1 / 1 / 1 | 1 / 2 | 0 / 0 / 0 | 0 / 0 / 0 | 8/8 |  |
| jingle-bells | 1 | 1 / 1 / 1 | 7 / 29 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| jolly-old-saint-nicholas | 1 | 2 / = / 2 | 0 / 10 | 0 / = / 0 | 0 / = / 0 | 16/16 |  |
| kuckuck | 1 | 1 / 1 / 1 | 4 / 18 | 0 / 0 / 0 | 0 / 0 / 0 | 12/12 |  |
| lightly-row | 1 | 1 / 1 / 1 | 2 / 9 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| little-bo-peep | 1 | 1 / 1 / 1 | 2 / 5 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| little-brown-jug | 1 | 1 / 1 / 1 | 2 / 12 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| little-jack-horner | 1 | 1 / 1 / 1 | 3 / 5 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| london-bridge | 1 | 1 / 1 / 1 | 2 / 5 | 0 / 0 / 0 | 0 / 0 / 0 | 8/8 |  |
| long-long-ago | 1 | 2 / 2 / 2 | 2 / 4 | 0 / 0 / 0 | 0 / 0 / 0 | 15/15 |  |
| mary-had-a-little-lamb | 1 | 1 / 1 / 1 | 3 / 12 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| michael-row-the-boat-ashore | 1 | 1 / 1 / 1 | 3 / 19 | 0 / 0 / 0 | 0 / 0 / 0 | 17/17 |  |
| ode-to-joy | 1 | 1 / 1 / 1 | 7 / 25 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| oh-susanna | 1 | 2 / 2 / 2 | 12 / 44 | 0 / 0 / 0 | 0 / 0 / 0 | 43/43 |  |
| old-macdonald-had-a-farm | 1 | 2 / 2 / 2 | 8 / 30 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-allegro-414d6ff6 | 1 | 1 / 1 / 1 | 8 / 21 | 0 / 0 / 0 | 0 / 0 / 0 | 24/24 |  |
| pdmx-andantino-096f28b3 | 1 | 1 / 1 / 1 | 11 / 28 | 0 / 0 / 0 | 0 / 0 / 0 | 22/22 |  |
| pdmx-bayernhymne-07ef6e69 | 1 | 1 / 1 / 1 | 3 / 13 | 0 / 0 / 0 | 0 / 0 / 0 | 18/18 |  |
| pdmx-beginner-piano-dc51f191 | 1 | 1 / 1 / 1 | 8 / 16 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-berceuse-de-brahms-9ad717da | 1 | 1 / 1 / 1 | 4 / 15 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| pdmx-beyer-nro-10-02272a85 | 1 | 1 / 1 / 1 | 7 / 33 | 0 / 0 / 0 | 0 / 0 / 0 | 24/24 |  |
| pdmx-can-can-offenbach-6c01ac29 | 1 | 1 / 1 / 1 | 2 / 5 | 0 / 0 / 0 | 0 / 0 / 0 | 10/10 |  |
| pdmx-cicha-noc-31962ed7 | 1 | 1 / 1 / 1 | 6 / 27 | 0 / 0 / 0 | 0 / 0 / 0 | 23/23 |  |
| pdmx-himne-a-l-alegria-beethoven-1f4b23de | 1 | 1 / 1 / 1 | 7 / 44 | 0 / 0 / 0 | 0 / 0 / 0 | 46/46 |  |
| pdmx-je-commence-a337dd8b | 1 | 1 / 1 / 1 | 9 / 32 | 0 / 0 / 0 | 0 / 0 / 0 | 36/36 |  |
| pdmx-just-a-closer-walk-with-thee-easy-piano-9f3090af | 1 | 1 / 1 / 1 | 4 / 14 | 0 / 0 / 0 | 0 / 0 / 0 | 25/25 |  |
| pdmx-marxa-turca-beethoven-28ea5063 | 1 | 1 / 1 / 1 | 6 / 24 | 0 / 0 / 0 | 0 / 0 / 0 | 27/27 |  |
| pdmx-menanam-jagung-5d68911c | 1 | 1 / 1 / 2 | 6 / 29 | 0 / 0 / 0 | 0 / 0 / 0 | 28/28 |  |
| pdmx-minuet-40400689 | 1 | 1 / 1 / 1 | 3 / 7 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| pdmx-misbehavin-14476f2a | 1 | 1 / 1 / 2 | 4 / 17 | 0 / 0 / 0 | 0 / 0 / 0 | 24/24 |  |
| pdmx-old-german-dance-ea7b2669 | 1 | 1 / 1 / 2 | 6 / 32 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-piva-piva-0e465703 | 1 | 1 / 1 / 1 | 11 / 38 | 0 / 0 / 0 | 0 / 0 / 0 | 25/25 |  |
| pdmx-runaway-river-29f61517 | 1 | 1 / = / 1 | 0 / 22 | 0 / = / 0 | 0 / = / 0 | 16/16 |  |
| pdmx-sorry-6a810b33 | 1 | 1 / 1 / 1 | 13 / 24 | 0 / 0 / 0 | 0 / 0 / 0 | 41/41 |  |
| pdmx-swans-on-the-lake-73763b69 | 1 | 1 / 1 / 1 | 12 / 50 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-th-me-du-1er-mouvement-de-la-sonate-k-33-30916241 | 1 | 1 / 1 / 1 | 6 / 30 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| pdmx-the-circle-of-life-9229cac1 | 1 | 1 / 1 / 1 | 11 / 53 | 0 / 0 / 0 | 0 / 0 / 0 | 80/80 |  |
| pdmx-you-re-a-grand-old-flag-ffa207fd | 1 | 1 / 1 / 1 | 4 / 8 | 0 / 0 / 0 | 0 / 0 / 0 | 26/26 |  |
| schlaf-kindlein-schlaf | 1 | 1 / 1 / 1 | 1 / 2 | 0 / 0 / 0 | 0 / 0 / 0 | 10/10 |  |
| see-saw-margery-daw | 1 | 1 / 2 / 2 | 3 / 10 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| three-little-kittens | 1 | 1 / 1 / 1 | 3 / 8 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| twinkle-twinkle-little-star | 1 | 1 / 1 / 1 | 6 / 27 | 0 / 0 / 0 | 0 / 0 / 0 | 24/24 |  |
| when-the-saints-go-marching-in | 1 | 1 / 1 / 2 | 6 / 29 | 0 / 0 / 0 | 0 / 0 / 0 | 27/27 |  |
| a-mighty-fortress | 2 | 3 / 3 / 3 | 4 / 19 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| amazing-grace | 2 | 3 / 3 / 3 | 6 / 26 | 0 / 0 / 0 | 0 / 0 / 0 | 14/14 |  |
| auld-lang-syne | 2 | 3 / 3 / 3 | 8 / 24 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| austrian-hymn | 2 | 3 / 3 / 3 | 2 / 17 | 0 / 0 / 0 | 0 / 0 / 0 | 41/41 |  |
| bach-minuet-b-flat-major-bwv-anh-118 | 2 | 2 / 2 / 2 | 6 / 20 | 0 / 0 / 0 | 0 / 0 / 0 | 26/26 |  |
| bach-minuet-g-major-bwv-anh-114 | 2 | 2 / 2 / 2 | 5 / 22 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| bach-minuet-g-minor-bwv-anh-115 | 2 | 2 / 2 / 2 | 6 / 23 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| bach-polonaise-f-major-bwv-anh-117a | 2 | 3 / = / 3 | 0 / 6 | 0 / = / 0 | 0 / = / 0 | 16/16 |  |
| behr-in-may | 2 | 2 / 2 / 2 | 10 / 55 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| brahms-lullaby | 2 | 3 / 3 / 3 | 5 / 14 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| burgmuller-op100-no1-la-candeur | 2 | 3 / = / 3 | 0 / 2 | 0 / = / 0 | 0 / = / 0 | 52/52 |  |
| daisy-bell | 2 | 3 / 3 / 3 | 8 / 38 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| deck-the-halls | 2 | 3 / 3 / 3 | 6 / 22 | 0 / 0 / 0 | 0 / 0 / 0 | 40/40 |  |
| eine-kleine-nachtmusik-theme | 2 | 2 / = / = | 0 / 0 | 0 / = / = | 0 / = / = | - |  |
| god-save-the-king | 2 | 3 / 3 / 3 | 4 / 17 | 0 / 0 / 0 | 0 / 0 / 0 | 14/14 |  |
| good-king-wenceslas | 2 | 3 / 3 / 3 | 7 / 33 | 0 / 0 / 0 | 0 / 0 / 0 | 34/34 |  |
| greensleeves | 2 | 3 / 3 / 3 | 4 / 8 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| handel-aylesford-minuet-d-minor | 2 | 3 / - / - | - / - | 0 / - / - | 0 / - / - | - | refused: the melody voice plays chords |
| happy-birthday | 2 | 3 / 3 / 3 | 3 / 9 | 0 / 0 / 0 | 0 / 0 / 0 | 8/8 |  |
| holy-holy-holy | 2 | 3 / 3 / 3 | 7 / 33 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| in-the-good-old-summertime | 2 | 3 / 3 / 3 | 9 / 59 | 0 / 0 / 0 | 2 / 2 / 2 | 32/32 |  |
| joy-to-the-world | 2 | 2 / 2 / 2 | 2 / 5 | 0 / 0 / 0 | 0 / 0 / 0 | 20/20 |  |
| korobeiniki | 2 | 3 / 3 / 3 | 4 / 8 | 0 / 0 / 0 | 0 / 0 / 0 | 24/24 |  |
| la-cucaracha | 2 | 3 / 3 / 3 | 8 / 27 | 0 / 0 / 0 | 0 / 0 / 0 | 24/24 |  |
| la-marseillaise | 2 | 3 / 3 / 3 | 6 / 32 | 0 / 0 / 0 | 0 / 0 / 0 | 43/43 |  |
| loch-lomond | 2 | 3 / 3 / 3 | 6 / 19 | 0 / 0 / 0 | 2 / 2 / 2 | 32/32 |  |
| mozart-minuet-f-major-k2 | 2 | 2 / 2 / 2 | 11 / 40 | 0 / 0 / 0 | 0 / 0 / 0 | 24/24 |  |
| o-christmas-tree | 2 | 3 / 3 / 3 | 3 / 7 | 0 / 0 / 0 | 0 / 0 / 0 | 12/12 |  |
| o-come-all-ye-faithful | 2 | 3 / 3 / 3 | 4 / 45 | 0 / 0 / 0 | 0 / 0 / 0 | 40/40 |  |
| old-hundredth | 2 | 3 / 3 / 3 | 4 / 33 | 0 / 0 / 0 | 0 / 0 / 0 | 26/26 |  |
| pachelbel-canon-in-d | 2 | 2 / 2 / 2 | 1 / 31 | 0 / 0 / 0 | 0 / 0 / 0 | 18/18 |  |
| pdmx-01-marche-in-d-major-c-p-e-bach-1fe58298 | 2 | 2 / 2 / 2 | 4 / 7 | 0 / 0 / 0 | 0 / 0 / 0 | 45/45 |  |
| pdmx-03-marche-in-gmajor-c-p-e-bach-d37a4e6b | 2 | 2 / - / - | - / - | 0 / - / - | 0 / - / - | - | refused: two right-hand voices share the top line |
| pdmx-10-minutos-de-piano-hanon-1-g-tutorial-4db2f2cd | 2 | 2 / = / = | 0 / 0 | 0 / = / = | 0 / = / = | - |  |
| pdmx-50-easy-piano-pieces-no-1-b41a9aca | 2 | 2 / 2 / 2 | 5 / 6 | 0 / 0 / 0 | 0 / 0 / 0 | 45/45 |  |
| pdmx-a-hat-in-time-ost-welcome-to-mafia-town-d3741a9a | 2 | 2 / 2 / 2 | 10 / 65 | 0 / 0 / 0 | 0 / 0 / 1 | 111/111 |  |
| pdmx-a-las-barricadas-f0b8e3fd | 2 | 2 / 2 / 2 | 7 / 20 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-a-mi-manera-my-way-e2eb5c79 | 2 | 2 / 2 / 2 | 4 / 48 | 0 / 0 / 0 | 0 / 0 / 0 | 46/46 |  |
| pdmx-a-song-of-ice-and-fire-easy-cbebd15e | 2 | 2 / 2 / 2 | 24 / 77 | 0 / 0 / 0 | 0 / 0 / 0 | 93/93 |  |
| pdmx-a-tender-feeling-140a9d7a | 2 | 2 / 2 / 2 | 5 / 32 | 0 / 0 / 0 | 1 / 1 / 1 | 47/47 |  |
| pdmx-a7-12859f5a | 2 | 2 / 2 / 2 | 12 / 36 | 0 / 0 / 0 | 0 / 0 / 0 | 62/62 |  |
| pdmx-air-on-the-g-string-882b91a7 | 2 | 2 / 2 / 2 | 3 / 7 | 0 / 0 / 0 | 0 / 0 / 0 | 38/38 |  |
| pdmx-alan-walker-faded-253f3eb9 | 2 | 2 / 2 / 2 | 14 / 43 | 0 / 0 / 0 | 0 / 0 / 0 | 113/113 |  |
| pdmx-and-so-the-story-began-16d91bb7 | 2 | 2 / 2 / 2 | 6 / 13 | 0 / 0 / 0 | 0 / 0 / 0 | 33/33 |  |
| pdmx-angeles-de-dios-73309069 | 2 | 2 / - / - | - / - | 0 / - / - | 0 / - / - | - | refused: two right-hand voices share the top line |
| pdmx-aria-in-f-major-0b78d04f | 2 | 2 / 2 / 2 | 2 / 27 | 0 / 0 / 0 | 0 / 0 / 0 | 31/31 |  |
| pdmx-asphyxia-1521364b | 2 | 2 / 2 / 2 | 9 / 14 | 0 / 0 / 0 | 0 / 0 / 0 | 35/35 |  |
| pdmx-b-bartok-for-children-vol-1-nr-1-childre-ead72fee | 2 | 2 / 2 / 2 | 8 / 17 | 0 / 0 / 0 | 0 / 0 / 0 | 24/24 |  |
| pdmx-b-bartok-for-children-vol-1-nr-10-childr-52ea61f7 | 2 | 2 / 2 / 2 | 8 / 14 | 0 / 0 / 0 | 0 / 0 / 0 | 47/47 |  |
| pdmx-b-bartok-for-children-vol-1-nr4-pillow-d-87302324 | 2 | 2 / 2 / 2 | 8 / 11 | 0 / 0 / 0 | 0 / 0 / 0 | 30/30 |  |
| pdmx-bach-2nd-menuet-for-a-m-bach-easy-024ed2fe | 2 | 2 / 2 / 2 | 5 / 20 | 0 / 0 / 0 | 0 / 0 / 0 | 34/34 |  |
| pdmx-bart-k-b-la-for-children-book-2-01-all-t-3c02b35f | 2 | 2 / 3 / 3 | 11 / 25 | 0 / 0 / 0 | 0 / 5 / 5 | 30/30 |  |
| pdmx-basis-for-variations-on-feliz-navidad-ea201701 | 2 | 2 / 2 / 2 | 3 / 7 | 0 / 0 / 0 | 0 / 0 / 0 | 22/22 |  |
| pdmx-before-thy-throne-i-now-appear-bodo-von-27c558af | 2 | 2 / 2 / 2 | 5 / 32 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| pdmx-bike-rides-the-green-orbs-503d2954 | 2 | 2 / = / 2 | 0 / 8 | 0 / = / 0 | 1 / = / 1 | 52/52 |  |
| pdmx-both-ways-43f3ead6 | 2 | 2 / 2 / 2 | 3 / 31 | 0 / 0 / 0 | 0 / 0 / 0 | 34/34 |  |
| pdmx-canci-n-de-cuna-caf887a3 | 2 | 2 / 2 / 2 | 6 / 18 | 0 / 0 / 0 | 0 / 0 / 0 | 18/18 |  |
| pdmx-canon-in-d-by-pachelbel-498d54de | 2 | 2 / 2 / 2 | 9 / 88 | 0 / 0 / 0 | 0 / 0 / 0 | 150/150 |  |
| pdmx-carol-of-the-bells-03861c66 | 2 | 2 / 2 / 2 | 6 / 13 | 0 / 0 / 0 | 0 / 0 / 0 | 39/39 |  |
| pdmx-chanson-bretonne-dea1e5b4 | 2 | 2 / 2 / 2 | 6 / 10 | 0 / 0 / 0 | 0 / 0 / 0 | 29/29 |  |
| pdmx-christian-petzold-minuet-in-g-major-bwv-d8c1282c | 2 | 2 / 2 / 2 | 5 / 22 | 0 / 0 / 0 | 0 / 0 / 0 | 34/34 |  |
| pdmx-chromatic-invention-1-29a53a71 | 2 | 2 / = / = | 0 / 0 | 0 / = / = | 0 / = / = | - |  |
| pdmx-cicha-noc-silent-night-4458070f | 2 | 2 / 2 / 2 | 6 / 20 | 0 / 0 / 0 | 0 / 0 / 0 | 18/18 |  |
| pdmx-cimpoiul-8fad8f9d | 2 | 2 / = / 2 | 0 / 1 | 0 / = / 0 | 0 / = / 0 | 24/24 |  |
| pdmx-colors-of-the-rainbow-leo-rojas-0f71261f | 2 | 2 / 2 / 2 | 20 / 73 | 0 / 0 / 0 | 0 / 0 / 0 | 148/148 |  |
| pdmx-colors-of-the-wind-pocahontas-2715ac47 | 2 | 2 / 2 / 2 | 1 / 1 | 0 / 0 / 0 | 0 / 0 / 0 | 40/40 |  |
| pdmx-come-and-get-your-love-les-gardiens-de-l-118e38bc | 2 | 2 / 2 / 2 | 8 / 18 | 0 / 0 / 0 | 0 / 0 / 0 | 25/25 |  |
| pdmx-come-let-us-all-with-fervour-2ea30690 | 2 | 2 / 2 / 2 | 7 / 20 | 0 / 0 / 0 | 0 / 0 / 0 | 31/31 |  |
| pdmx-composition-2-043fb920 | 2 | 2 / 2 / 2 | 6 / 18 | 0 / 0 / 0 | 0 / 0 / 0 | 50/50 |  |
| pdmx-croonin-0a15ada0 | 2 | 2 / 2 / 2 | 5 / 6 | 0 / 0 / 0 | 0 / 0 / 0 | 28/28 |  |
| pdmx-dance-monkey-by-tones-and-i-easy-b17747a7 | 2 | 2 / 2 / 2 | 14 / 38 | 0 / 0 / 0 | 0 / 0 / 0 | 145/145 |  |
| pdmx-dancing-queen-7404569f | 2 | 2 / 2 / 2 | 4 / 7 | 0 / 0 / 0 | 1 / 1 / 1 | 74/74 |  |
| pdmx-deck-the-halls-59f4d18b | 2 | 2 / 2 / 2 | 5 / 18 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-demons-imagine-dragons-easy-version-abd3aa26 | 2 | 2 / 2 / 2 | 22 / 67 | 0 / 0 / 0 | 1 / 1 / 1 | 64/64 |  |
| pdmx-dil-diyan-gallan-57f13cbc | 2 | 2 / 2 / 2 | 17 / 56 | 0 / 0 / 0 | 0 / 0 / 0 | 83/83 |  |
| pdmx-dolgaja-doroga-v-djunah-b77d7bf0 | 2 | 2 / 2 / 2 | 2 / 9 | 0 / 0 / 0 | 0 / 0 / 0 | 46/46 |  |
| pdmx-doric-nikolaus-herman-1838befa | 2 | 2 / 2 / 2 | 7 / 42 | 0 / 0 / 0 | 0 / 0 / 0 | 18/18 |  |
| pdmx-dragon-how-to-train-you-dragon-77291c9b | 2 | 2 / 2 / 2 | 8 / 34 | 0 / 0 / 0 | 0 / 0 / 0 | 56/56 |  |
| pdmx-duet-for-pipes-e68bce02 | 2 | 2 / = / = | 0 / 0 | 0 / = / = | 0 / = / = | - |  |
| pdmx-dusk-f9016f99 | 2 | 2 / 2 / 2 | 6 / 18 | 0 / 0 / 0 | 0 / 0 / 0 | 23/23 |  |
| pdmx-easy-piano-elton-john-can-you-feel-the-l-933fc3a3 | 2 | 2 / 2 / 2 | 12 / 31 | 0 / 0 / 0 | 0 / 0 / 0 | 100/100 |  |
| pdmx-el-condor-pasa-if-i-could-af1850b5 | 2 | 2 / 2 / 2 | 2 / 35 | 0 / 0 / 0 | 0 / 0 / 0 | 60/60 |  |
| pdmx-elementary-studies-op-176-etude-10-by-je-d679afd0 | 2 | 2 / 2 / 2 | 5 / 30 | 0 / 0 / 0 | 0 / 0 / 0 | 48/48 |  |
| pdmx-elementary-studies-op-176-etude-15-by-je-c602e25f | 2 | 2 / 2 / 2 | 4 / 22 | 0 / 0 / 0 | 0 / 0 / 0 | 48/48 |  |
| pdmx-elementary-studies-op-176-etude-19-by-je-7c9b92bf | 2 | 2 / = / 2 | 0 / 2 | 0 / = / 0 | 4 / = / 4 | 88/88 |  |
| pdmx-elementary-studies-op-176-etude-2-by-jea-6c4bde5d | 2 | 2 / 2 / 2 | 8 / 31 | 0 / 0 / 0 | 0 / 0 / 0 | 48/48 |  |
| pdmx-elementary-studies-op-176-etude-3-by-jea-95eb4bab | 2 | 2 / 2 / 2 | 4 / 66 | 0 / 0 / 0 | 0 / 0 / 0 | 46/46 |  |
| pdmx-elementary-studies-op-176-etude-4-by-jea-5999adce | 2 | 2 / 2 / 2 | 3 / 25 | 0 / 0 / 0 | 0 / 0 / 0 | 63/63 |  |
| pdmx-elementary-studies-op-176-etude-5-by-jea-72d15a2e | 2 | 2 / = / = | 0 / 0 | 0 / = / = | 2 / = / = | - |  |
| pdmx-elementary-studies-op-176-etude-6-by-jea-19db319e | 2 | 2 / 2 / 2 | 4 / 17 | 0 / 0 / 0 | 0 / 0 / 0 | 40/40 |  |
| pdmx-elementary-studies-op-176-etude-9-by-jea-ad80d7f3 | 2 | 2 / = / = | 0 / 0 | 0 / = / = | 0 / = / = | - |  |
| pdmx-erik-satie-enfantillages-pittoresques-be-639ad423 | 2 | 2 / - / - | - / - | 0 / - / - | 0 / - / - | - | refused: the melody voice plays chords |
| pdmx-erik-satie-gnossienne-n1-1c4165eb | 2 | 2 / = / 2 | 0 / 36 | 0 / = / 0 | 1 / = / 2 | 56/56 |  |
| pdmx-fado-choradinho-d90458d8 | 2 | 2 / 2 / 2 | 1 / 1 | 0 / 0 / 0 | 0 / 0 / 0 | 18/18 |  |
| pdmx-fado-da-mouraria-513a0f83 | 2 | 2 / 2 / 2 | 1 / 1 | 0 / 0 / 0 | 0 / 0 / 0 | 17/17 |  |
| pdmx-feded-baef7a45 | 2 | 2 / 2 / 2 | 8 / 38 | 0 / 0 / 0 | 0 / 0 / 0 | 57/57 |  |
| pdmx-first-snow-080c9353 | 2 | 2 / 2 / 2 | 5 / 33 | 0 / 0 / 0 | 0 / 0 / 0 | 35/35 |  |
| pdmx-frosty-the-snowman-walter-rollins-9972767b | 2 | 2 / 2 / 2 | 13 / 31 | 0 / 0 / 0 | 0 / 0 / 0 | 101/101 |  |
| pdmx-geometry-dash-easy-73271a98 | 2 | 2 / 2 / 2 | 1 / 2 | 0 / 0 / 0 | 0 / 0 / 0 | 14/14 |  |
| pdmx-ghostbuster-a33b6fce | 2 | 2 / 2 / 2 | 1 / 1 | 0 / 0 / 0 | 0 / 0 / 0 | 24/24 |  |
| pdmx-girls-generation-oh-gg-oh-gg-lil-touch-c46ba18a | 2 | 2 / 2 / 2 | 1 / 2 | 0 / 0 / 0 | 0 / 0 / 0 | 39/39 |  |
| pdmx-god-rest-you-merry-gentlemen-59cfe4eb | 2 | 2 / 2 / 2 | 6 / 27 | 0 / 0 / 0 | 0 / 0 / 0 | 41/41 |  |
| pdmx-greensleeves-46683be3 | 2 | 2 / 2 / 2 | 8 / 43 | 0 / 0 / 0 | 0 / 0 / 0 | 35/35 |  |
| pdmx-greensleeves-6210b667 | 2 | 2 / 2 / 2 | 12 / 46 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-gurenge-demon-slayer-d6ac1780 | 2 | 2 / 2 / 2 | 5 / 20 | 0 / 0 / 0 | 0 / 0 / 0 | 75/75 |  |
| pdmx-hail-to-the-queen-who-reigns-above-21d18924 | 2 | 2 / 2 / 2 | 3 / 50 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-hallelujah-easy-745eaa57 | 2 | 2 / 2 / 2 | 8 / 21 | 0 / 0 / 0 | 0 / 0 / 0 | 57/57 |  |
| pdmx-hanter-x-hanter99-end-song-of-the-wind-p-080a4e07 | 2 | 2 / 2 / 2 | 4 / 14 | 0 / 0 / 0 | 0 / 0 / 0 | 82/82 |  |
| pdmx-happy-birthday-piano-cbb0dc38 | 2 | 2 / 2 / 2 | 8 / 28 | 0 / 0 / 0 | 0 / 0 / 0 | 21/21 |  |
| pdmx-happy-bithday-lullaby-minuet-1ae73364 | 2 | 2 / 2 / 2 | 17 / 61 | 0 / 0 / 0 | 0 / 0 / 0 | 48/48 |  |
| pdmx-heigh-ho-dans-blanche-neige-7144c4fc | 2 | 2 / 2 / 2 | 2 / 18 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-himno-atl-tico-de-madrid-da1ad8d9 | 2 | 2 / 2 / 2 | 7 / 23 | 0 / 0 / 0 | 0 / 0 / 0 | 46/46 |  |
| pdmx-i-h-c-v-piano-e7e43ed9 | 2 | 2 / 2 / 2 | 5 / 14 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| pdmx-ich-steh-an-deiner-krippen-hier-b9731727 | 2 | 2 / 2 / 2 | 9 / 30 | 0 / 0 / 0 | 0 / 0 / 0 | 62/62 |  |
| pdmx-implicit-demand-for-proof-ea632f7a | 2 | 2 / - / - | - / - | 0 / - / - | 0 / - / - | - | refused: the melody voice plays chords |
| pdmx-inno-alla-gioia-b5488120 | 2 | 2 / 2 / 2 | 12 / 41 | 0 / 0 / 0 | 0 / 0 / 0 | 52/52 |  |
| pdmx-invention-1-1207a91b | 2 | 2 / 2 / 2 | 2 / 6 | 0 / 0 / 0 | 0 / 0 / 0 | 34/34 |  |
| pdmx-jay-chou-won-t-cry-easy-piano-melody-onl-5ce299a0 | 2 | 2 / 2 / 2 | 31 / 109 | 0 / 0 / 0 | 0 / 0 / 0 | 245/245 |  |
| pdmx-jesus-of-nazareth-theme-piano-bc682940 | 2 | 2 / 2 / 2 | 2 / 10 | 0 / 0 / 0 | 0 / 0 / 0 | 28/28 |  |
| pdmx-joyeux-anniversaire-9037c755 | 2 | 2 / 2 / 2 | 4 / 8 | 0 / 0 / 0 | 0 / 0 / 0 | 11/11 |  |
| pdmx-just-struttin-along-in-f-minor-martha-mi-4a5f0678 | 2 | 2 / 2 / 2 | 6 / 8 | 0 / 0 / 0 | 4 / 2 / 2 | 44/44 |  |
| pdmx-knocking-on-heavens-door-bob-dylan-a3edc605 | 2 | 2 / 2 / 2 | 2 / 17 | 0 / 0 / 0 | 0 / 0 / 0 | 24/24 |  |
| pdmx-komm-lieber-mai-33a00eb6 | 2 | 2 / 2 / 2 | 6 / 7 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-lacie-s-melody-easy-version-6007ac3f | 2 | 2 / 2 / 2 | 18 / 59 | 0 / 0 / 0 | 0 / 0 / 0 | 48/48 |  |
| pdmx-lago-dos-cisnes-7bf2d875 | 2 | 2 / 2 / 2 | 5 / 22 | 0 / 0 / 0 | 0 / 0 / 0 | 48/48 |  |
| pdmx-les-embruns-7d3f83fb | 2 | 2 / = / = | 0 / 0 | 0 / = / = | 0 / = / = | - |  |
| pdmx-lettre-elise-d-butants-34556a42 | 2 | 2 / 2 / 2 | 7 / 24 | 0 / 0 / 0 | 1 / 1 / 1 | 60/60 |  |
| pdmx-lightly-row-2de5cc73 | 2 | 2 / 2 / 2 | 7 / 28 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-linkin-park-numb-cf6fbd42 | 2 | 2 / 2 / 3 | 17 / 68 | 0 / 0 / 0 | 1 / 1 / 1 | 149/149 |  |
| pdmx-little-star-variation-in-a-minor-130d13a0 | 2 | 2 / 2 / 2 | 5 / 25 | 0 / 0 / 0 | 2 / 2 / 2 | 24/24 |  |
| pdmx-los-pollitos-d76867eb | 2 | 2 / 2 / 2 | 6 / 22 | 0 / 0 / 0 | 0 / 0 / 0 | 24/24 |  |
| pdmx-love-theme-from-flashdance-9eac4a29 | 2 | 2 / = / = | 0 / 0 | 0 / = / = | 0 / = / = | - |  |
| pdmx-m-sao-piano-8b032b49 | 2 | 2 / 2 / 2 | 6 / 28 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| pdmx-marche-slave-76568681 | 2 | 2 / 2 / 2 | 4 / 16 | 0 / 0 / 0 | 0 / 0 / 0 | 38/38 |  |
| pdmx-menuet-in-g-8d4f42aa | 2 | 2 / 2 / 2 | 5 / 22 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-minecraft-theme-3d8e10f0 | 2 | 2 / 2 / 2 | 14 / 75 | 0 / 0 / 0 | 0 / 0 / 0 | 112/112 |  |
| pdmx-minion-song-dtb-ed3ae5e7 | 2 | 2 / 2 / 2 | 14 / 31 | 0 / 0 / 0 | 0 / 0 / 0 | 60/60 |  |
| pdmx-minuet-in-f-major-beethoven-255cdbcd | 2 | 2 / 2 / 3 | 10 / 31 | 0 / 0 / 0 | 0 / 0 / 0 | 42/42 |  |
| pdmx-minuet-in-g-07c49c7d | 2 | 2 / 2 / 2 | 2 / 10 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| pdmx-minuet-in-g-17f19374 | 2 | 2 / 2 / 2 | 5 / 22 | 0 / 0 / 0 | 0 / 0 / 0 | 34/34 |  |
| pdmx-minuet-in-g-major-2c1f15aa | 2 | 2 / 2 / 2 | 2 / 17 | 0 / 0 / 0 | 0 / 0 / 0 | 24/24 |  |
| pdmx-minuet-in-g-major-bmv-114-j-s-bach-da5cac7a | 2 | 2 / 2 / 2 | 5 / 22 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-minuet-in-g-major-bwv-anh-114-145c7d66 | 2 | 2 / 2 / 2 | 5 / 22 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-minuet-in-g-minor-bach-piano-f0603ec6 | 2 | 2 / 2 / 2 | 3 / 12 | 0 / 0 / 0 | 0 / 0 / 0 | 18/18 |  |
| pdmx-minuetto-2c768463 | 2 | 2 / = / 2 | 0 / 4 | 0 / = / 0 | 0 / = / 0 | 24/24 |  |
| pdmx-mister-softee-e42758e6 | 2 | 2 / 2 / 2 | 8 / 12 | 0 / 0 / 0 | 0 / 0 / 0 | 28/28 |  |
| pdmx-morituri-te-salutant-13603719 | 2 | 2 / 2 / 2 | 5 / 12 | 0 / 0 / 0 | 1 / 1 / 1 | 36/36 |  |
| pdmx-mr-buckets-strikes-again-06cbca46 | 2 | 2 / 2 / 2 | 3 / 12 | 0 / 0 / 0 | 0 / 0 / 0 | 19/19 |  |
| pdmx-my-soul-awake-and-tender-017f99b3 | 2 | 2 / 2 / 2 | 5 / 34 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| pdmx-my-way-a314948b | 2 | 2 / 2 / 2 | 14 / 53 | 0 / 0 / 0 | 0 / 0 / 0 | 111/111 |  |
| pdmx-new-world-03542b71 | 2 | 2 / - / - | - / - | 0 / - / - | 0 / - / - | - | refused: two right-hand voices share the top line |
| pdmx-ng-y-u-ti-n-i-h-c-piano-6fa917f7 | 2 | 2 / 2 / 2 | 14 / 61 | 0 / 0 / 0 | 0 / 0 / 0 | 34/34 |  |
| pdmx-noche-de-paz-4a562ba9 | 2 | 2 / 2 / 2 | 12 / 37 | 0 / 0 / 0 | 0 / 0 / 0 | 27/27 |  |
| pdmx-octobre-francis-cabrel-a63d76bf | 2 | 2 / - / - | - / - | 0 / - / - | 0 / - / - | - | refused: the melody voice plays chords |
| pdmx-ode-an-die-freude-c797dd76 | 2 | 2 / 2 / 2 | 7 / 26 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-om-shanti-om-theme-music-of-a-famous-ind-cf1c88d3 | 2 | 2 / = / 2 | 0 / 2 | 0 / = / 0 | 0 / = / 0 | 56/56 |  |
| pdmx-piano-24-la-coronaci-n-5d24a01c | 2 | 2 / 2 / 2 | 4 / 13 | 0 / 0 / 0 | 0 / 0 / 0 | 25/25 |  |
| pdmx-polyushko-polye-1ad6edad | 2 | 2 / 2 / 2 | 2 / 8 | 0 / 0 / 0 | 0 / 0 / 0 | 60/60 |  |
| pdmx-rondo-sonatine-n1-t-latour-024fe1f5 | 2 | 2 / 2 / 2 | 11 / 26 | 0 / 0 / 0 | 0 / 0 / 0 | 31/31 |  |
| pdmx-rudolph-the-red-noised-reindeer-ccea3d7f | 2 | 2 / 2 / 2 | 7 / 20 | 0 / 0 / 0 | 0 / 0 / 0 | 48/48 |  |
| pdmx-rurouni-kenshin-departure-wip-544f9db7 | 2 | 2 / 2 / 2 | 4 / 11 | 0 / 0 / 0 | 0 / 0 / 0 | 110/110 |  |
| pdmx-russian-dance-a887fb40 | 2 | 2 / 2 / 2 | 8 / 33 | 0 / 0 / 0 | 0 / 0 / 0 | 45/45 |  |
| pdmx-russian-folk-song-op-107-no-3-by-ludwig-25358239 | 2 | 2 / 2 / 2 | 3 / 5 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| pdmx-scarborough-fair-0cc6d221 | 2 | 2 / 2 / 2 | 4 / 26 | 0 / 0 / 0 | 0 / 0 / 0 | 17/17 |  |
| pdmx-schwabisch-259b1484 | 2 | 2 / 2 / 2 | 5 / 18 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| pdmx-shallow-easy-solo-piano-062bf92b | 2 | 2 / 2 / 2 | 14 / 36 | 0 / 0 / 0 | 0 / 0 / 0 | 175/175 |  |
| pdmx-silent-night-a35aafb8 | 2 | 2 / 2 / 2 | 11 / 37 | 0 / 0 / 0 | 0 / 0 / 0 | 24/24 |  |
| pdmx-simfonia-n-5-beethoven-0a561ae4 | 2 | 2 / 2 / 2 | 1 / 12 | 0 / 0 / 0 | 0 / 0 / 0 | 27/27 |  |
| pdmx-simple-gifts-2-part-round-635ec3e2 | 2 | 2 / 2 / 2 | 7 / 17 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-solanum-s-piano-outer-wilds-2-cycles-69768be8 | 2 | 2 / 2 / 2 | 2 / 6 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-solanum-s-theme-outer-wilds-2d8efa9e | 2 | 2 / 2 / 2 | 1 / 3 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| pdmx-sonatina-en-sol-major-beethoven-0f7373a0 | 2 | 2 / 2 / 2 | 2 / 8 | 0 / 0 / 0 | 0 / 0 / 0 | 28/28 |  |
| pdmx-sonatina-in-g-c2397698 | 2 | 2 / 2 / 2 | 7 / 15 | 0 / 0 / 0 | 0 / 1 / 1 | 52/52 |  |
| pdmx-song-without-words-9a27e3ab | 2 | 2 / 2 / 2 | 6 / 11 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-star-wars-51ffa6bb | 2 | 2 / 2 / 2 | 1 / 25 | 0 / 0 / 0 | 0 / 0 / 0 | 45/45 |  |
| pdmx-summer-wine-c4baeabc | 2 | 2 / 2 / 2 | 12 / 73 | 0 / 0 / 0 | 6 / 6 / 6 | 62/62 |  |
| pdmx-sunmi-siren-29e4daa4 | 2 | 2 / 2 / 2 | 5 / 8 | 0 / 0 / 0 | 1 / 0 / 1 | 64/64 |  |
| pdmx-swan-lake-theme-tchaikovsky-74ff725c | 2 | 2 / 2 / 2 | 5 / 22 | 0 / 0 / 0 | 5 / 5 / 5 | 46/46 |  |
| pdmx-the-drunken-sailor-cello-2-voices-9bb01ea9 | 2 | 2 / 2 / 2 | 8 / 29 | 0 / 0 / 0 | 0 / 0 / 0 | 40/40 |  |
| pdmx-the-entertainer-0af422e7 | 2 | 2 / 2 / 2 | 3 / 10 | 0 / 0 / 0 | 1 / 1 / 1 | 69/69 |  |
| pdmx-the-meadow-harry-poter-easy-piano-3f55c499 | 2 | 2 / 2 / 2 | 16 / 62 | 0 / 0 / 0 | 0 / 0 / 0 | 155/155 |  |
| pdmx-the-song-00e7c740 | 2 | 2 / 2 / 2 | 3 / 9 | 0 / 0 / 0 | 0 / 0 / 0 | 20/20 |  |
| pdmx-the-sound-of-silence-89720241 | 2 | 2 / 2 / 2 | 2 / 5 | 0 / 0 / 0 | 0 / 0 / 0 | 124/124 |  |
| pdmx-the-sound-of-silence-piano-287be700 | 2 | 2 / 2 / 2 | 4 / 15 | 0 / 0 / 0 | 0 / 0 / 0 | 36/36 |  |
| pdmx-thee-lord-i-love-with-sacred-awe-martin-139bb429 | 2 | 2 / 2 / 2 | 15 / 140 | 0 / 0 / 0 | 1 / 1 / 1 | 110/110 |  |
| pdmx-ticaem-a2-victorhugoayresdefreitas-minue-0e5c27b3 | 2 | 2 / 2 / 2 | 14 / 33 | 0 / 0 / 0 | 0 / 0 / 0 | 40/40 |  |
| pdmx-to-god-let-all-the-human-race-phillip-me-19bcb037 | 2 | 2 / 2 / 2 | 5 / 55 | 0 / 0 / 0 | 0 / 0 / 0 | 17/17 |  |
| pdmx-tsugaru-jongara-bushi-63012656 | 2 | 2 / 2 / 3 | 39 / 147 | 0 / 0 / 0 | 1 / 2 / 0 | 142/142 |  |
| pdmx-untitled-47d379b3 | 2 | 2 / 2 / 2 | 4 / 19 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
| pdmx-vanishing-grace-d8a33eee | 2 | 2 / 2 / 2 | 6 / 20 | 0 / 0 / 0 | 0 / 0 / 2 | 38/38 |  |
| pdmx-vivaldi-spring-simple-arrangement-7af5f049 | 2 | 2 / 2 / 2 | 4 / 31 | 0 / 0 / 0 | 0 / 0 / 0 | 50/50 |  |
| pdmx-w-a-mozart-allegro-in-b-major-k3-f774683f | 2 | 2 / = / = | 0 / 0 | 0 / = / = | 0 / = / = | - |  |
| pdmx-warum-betr-bst-du-dich-mein-herz-barthol-05b0e922 | 2 | 2 / 2 / 2 | 6 / 53 | 0 / 0 / 0 | 0 / 0 / 0 | 38/38 |  |
| pdmx-white-christmas-irving-berlin-443eb670 | 2 | 2 / 2 / 2 | 4 / 25 | 0 / 0 / 0 | 0 / 0 / 0 | 43/43 |  |
| pdmx-wilhelmus-ec9a208d | 2 | 2 / 2 / 2 | 3 / 25 | 0 / 0 / 0 | 0 / 0 / 0 | 24/24 |  |
| pdmx-william-tell-theme-beginner-piano-19c94964 | 2 | 2 / 2 / 2 | 5 / 10 | 0 / 0 / 0 | 0 / 0 / 0 | 25/25 |  |
| pdmx-wind-change-11b502a8 | 2 | 2 / 2 / 2 | 12 / 55 | 0 / 0 / 0 | 0 / 0 / 0 | 148/148 |  |
| pdmx-ye-christians-pluck-your-courage-up-0232e42e | 2 | 2 / 2 / 2 | 11 / 65 | 0 / 0 / 0 | 0 / 0 / 0 | 57/57 |  |
| pdmx-young-men-and-maids-your-praises-join-je-01e5641b | 2 | 2 / 2 / 2 | 3 / 4 | 0 / 0 / 0 | 0 / 0 / 0 | 22/22 |  |
| pease-porridge-hot | 2 | 3 / 3 / 3 | 1 / 3 | 0 / 0 / 0 | 0 / 0 / 0 | 16/16 |  |
| red-river-valley | 2 | 2 / 2 / 3 | 8 / 10 | 0 / 0 / 0 | 0 / 0 / 0 | 31/31 |  |
| sakura-sakura | 2 | 3 / 3 / 3 | 4 / 30 | 0 / 0 / 0 | 0 / 0 / 0 | 27/27 |  |
| scarborough-fair | 2 | 3 / 3 / 3 | 4 / 31 | 0 / 0 / 0 | 0 / 0 / 0 | 15/15 |  |
| schumann-op68-no1-melody | 2 | 2 / 2 / 2 | 3 / 9 | 0 / 0 / 0 | 0 / 0 / 0 | 44/44 |  |
| schumann-op68-no2-soldiers-march | 2 | 3 / - / - | - / - | 0 / - / - | 4 / - / - | - | refused: the melody voice plays chords |
| schumann-op68-no3-humming-song | 2 | 2 / 2 / 3 | 6 / 36 | 0 / 0 / 0 | 0 / 0 / 4 | 49/49 |  |
| schumann-op68-no5-little-piece | 2 | 2 / 2 / 2 | 8 / 43 | 0 / 0 / 0 | 0 / 0 / 0 | 48/48 |  |
| silent-night | 2 | 3 / 3 / 3 | 5 / 11 | 0 / 0 / 0 | 0 / 0 / 0 | 24/24 |  |
| surprise-symphony-theme | 2 | 3 / = / 3 | 0 / 4 | 0 / = / 0 | 0 / = / 0 | 16/16 |  |
| the-entertainer-easy | 2 | 3 / = / 3 | 0 / 3 | 0 / = / 0 | 0 / = / 0 | 30/30 |  |
| the-first-noel | 2 | 3 / 3 / 3 | 3 / 27 | 0 / 0 / 0 | 0 / 0 / 0 | 24/24 |  |
| yankee-doodle | 2 | 2 / 2 / 2 | 5 / 24 | 0 / 0 / 0 | 0 / 0 / 0 | 32/32 |  |
