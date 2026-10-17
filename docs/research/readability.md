# Readability: what editors print, and a validated player model

Research report for verification spec section 3.6 ("Be easy to read": printed-digit density and
inferability). Code: `research/readability/` (see its README for the pipeline); every number
below comes from a results file under `research/readability/results/` and the command that
produced it is given with each table. The spec's section 3.6 follows the recommendations of
section 7.

## 0. Summary

* **What editors print.** On the 286 verified Mutopia parts (193,059 notes, 36,183 digits)
  teaching editions print a digit on 32 percent of notes (25 without Clementi's exercise
  lessons; part median 30, IQR 22-39), concert editions on 21, the app's eight fingered library
  pieces on 22 (median 18, range 9-29). The right hand gets 1.5 to 2.5 times the left. Print
  rates by context (teaching): first note of a hand 70 percent, first note of a stepwise run 52,
  downbeat 42, after a rest of a beat 36 (base 32: rests are *not* a trigger), chord inner voice
  17, repeated pitch 14, leaps beyond an octave 22. Black keys make no difference. Among printed
  digits whose previous note is also printed, 39 to 57 percent mark a position change and 6 to
  10 percent a crossing; 63 percent of teaching digits directly follow another digit (editors
  print in runs). Only 55 to 65 percent of the *isolated* digits sit in any score-only context:
  the fingering, not the score, decides where a digit goes.
* **Repeats.** Later occurrences of a repeated segment print at half the rate of first
  statements (13.5 versus 24.3 percent overall, 24 versus 40 teaching); a digit on the first
  statement is re-printed 37 to 52 percent of the time, with the same finger 87 to 93 percent of
  the time on exact repeats; transpositions are re-printed more and changed more often.
* **The player model, validated.** The spec's forward reader (repeat keeps the finger, steps
  use adjacent fingers, position continuation, chord fill), implemented with a semitone-to-step
  rule that resolves the black-key ambiguity, reconstructs 57 percent of hidden editorial digits
  on teaching parts (coverage 80, accuracy 71; hide-20, five seeds) against 11 percent for
  "copy the previous digit"; stepwise motion (81 percent) and chord fill (78) are the reliable
  rules, position continuation is right two times in three, and repeated-note inference is right
  only where editors did not mark a finger change. Textbook patterns add two points. These
  numbers are measured at the places editors chose to mark and understate the reader.
* **The reduction, measured.** Applied to complete editorial fingerings (15 fully fingered
  parts), the spec's minimal-sufficient reduction with this reader prints 39 percent of notes
  (median part 46); a repeat memory brings it to 33, the textbook rule to 32. Editors print 2.3 to
  2.9 times what the reader needs.
* **Predictor.** Score context predicts where an editor prints only weakly (logistic AUC 0.72,
  0.69 on teaching; depth-3 tree 0.68); the spec's context list scores below chance (AUC 0.44)
  and would print 60 percent of notes, because of the chord-outer clause (fires on 39 percent of
  notes that print at 11.5). Right hand, chord size, repeated pitch and downbeat are the strongest
  predictors; rests and long notes are not.
* **Recommendations.** Keep "print only where the reader fails" as the mechanism; drop the
  context clauses as triggers; print one digit per chord; add a repeat rule (do not re-print a
  later occurrence; finger repeats identically); keep the confidence trigger. Density targets by
  level: floor / target / editor level 30 / 20 / 15 at levels 1-2, 35 / 25 / 15 at level 3,
  40 / 30 / 25 at levels 4-5, plus a relative check against the editor's density on the same
  piece. The spec's 40 / 30 / 20 row holds for levels 4-5 and is too loose below.

## 1. Question and method

Editors print a finger number only where a player needs one. The verification spec prints the
same way: a digit is kept only where a simple player model cannot infer it. Its first formulation
listed contexts that trigger a digit (first note, after a rest, after a long note, wide leap, chord
outer voice, run start) and set one row of density goals (at most 40 percent of notes at the floor,
30 target, about 20 "editor level"). This study measures what editors do, to test that list and
those goals, on two sources:

* **Mutopia editorial corpus** (`docs/research/datasets.md` section 4): the 286 verified
  (`status == ok`) two-hand parts, 193,059 notes, 36,183 printed digits, converted from
  Mutopia's LilyPond sources into PIG format with the hand in the channel column and finger 0 =
  nothing printed. Beats and bar positions are not in the PIG files; `enrich_mutopia.py` re-runs
  the project's LilyPond interpreter on each part's source, checks that it reproduces the PIG note
  list exactly (all 286 parts do), and recovers the onset in quarter-note beats, the duration and
  the position in the bar from the `\time` and `\partial` events.
* **Library pieces** with the source edition's fingerings (`docs/research/content-library.md`,
  "Editorial fingering"): 8 pieces, 3,457 notes, 751 printed digits after merging tied
  continuations into the note that starts the tie (the substitution markers of Moonlight and
  Schumann Op. 68/1 sit on the same note as the primary digit, so they do not add digits).

**Levels.** Mutopia parts are grouped by composer: *teaching* = Clementi
Op. 42, Diabelli (Op. 149 duets, Op. 163 sonatinas), Czerny (Op. 821, 840), Burgmüller Op. 100,
Kuhlau, Mozart K545 (203 parts); *concert* = Chopin, Liszt, Rachmaninoff (18 parts); *other* =
everything else (Verdi reductions, Beethoven, Schumann, Bach, Grieg, ..., 65 parts). Because
Clementi's 71 "lessons" are exercise-style and 14 of them are fingered on 90 percent or more of
their notes, tables also give *teaching without Clementi* (132 parts). Library pieces carry the
manifest level (2 to 5).

**Units.** A hand's notes are grouped into *events* (all notes of the hand with the same onset: a
chord or a single note). "Previous event" is the previous event of the same hand; a note's
interval is measured to the nearest pitch of the previous event. Beats are quarter notes.
Seconds come from the source at the score's first `\tempo` (default quarter = 100; 220 of the 286
parts use the default), so "notes per second" is at the score tempo, effectively notes per 0.6 s
of score time for most parts.

**Score-only contexts** (computable without any fingering): first note of the piece and of each
hand; a rest of at least one beat before the note; the previous note lasting two beats or more
with no rest between; melodic interval (repeat 0 st, step 1-2, third 3-4, fourth-fifth 5-7,
sixth-octave 8-12, more); black or white key; chord size and voice (single, bottom, inner, top);
repeated pitch; stepwise runs (at least four single notes moving by 1-2 semitones in one
direction; first, inside, last); note density (notes of the hand within a 1 s window); position
in the bar (downbeat, other beat, off the beat); hand; grace note.

**Printed-derived contexts** (need the digits): where a printed note's previous event is also
printed, the implied hand anchor of literature section 6.6, `anchor = x14(pitch)/2 - (finger - 1)`
for the right hand and `x14/2 + (finger - 1)` for the left (Balliauw's 14-unit octave, half-key
resolution for black keys), its change between the two digits (a position change when the anchor
moves by one white-key column or more; a change of exactly half a column is the black-key
ambiguity of the model, not a shift), and crossings (thumb under: 1 printed after 2-4 moving
outward; finger over: 2-4 printed after 1 moving inward).

**Pipeline** (`research/readability/run_all.py`): `enrich_mutopia.py` ->
`build_features.py` (196,516 rows) -> `stats.py` (sections 2 and 3) -> `repeats.py` (section 4)
-> `eval_player.py` (section 5) -> `predictor.py` (section 6). Tests:
`research/.venv-readability/Scripts/python.exe -X utf8 -m pytest research/readability/tests -q`.

## 2. The corpus

Command: `research/.venv-readability/Scripts/python.exe -X utf8 research/readability/stats.py`
(`results/density.json`).

| Composer | Group | Parts | Notes | Printed | Density | Part median | Part min-max |
|---|---|---|---|---|---|---|---|
| Verdi (Traviata reductions) | other | 20 | 55,842 | 3,373 | 6.0 | 5.4 | 1.1-21.4 |
| Diabelli | teaching | 80 | 22,931 | 7,829 | 34.1 | 35.1 | 17.0-78.3 |
| Clementi Op. 42 | teaching | 71 | 19,791 | 9,655 | 48.8 | 65.5 | 2.3-100.0 |
| Chopin | concert | 14 | 19,581 | 6,166 | 31.5 | 26.2 | 0.6-57.3 |
| Mozart (K545 teaching; K331, K379, K397, K457 other) | other/teaching | 8 | 11,144 | 1,977 | 17.7 | 21.8 | 0.5-32.5 |
| Burgmüller Op. 100 | teaching | 19 | 9,508 | 1,145 | 12.0 | 16.6 | 1.8-40.8 |
| Beethoven | other | 5 | 8,716 | 1,383 | 15.9 | 21.4 | 10.1-26.5 |
| Liszt | concert | 2 | 7,986 | 61 | 0.8 | 0.6 | 0.4-0.8 |
| Czerny | teaching | 28 | 7,821 | 1,809 | 23.1 | 24.1 | 9.8-52.4 |
| Tchaikovsky | other | 2 | 4,398 | 57 | 1.3 | 14.5 | 0.5-28.6 |
| Rachmaninoff | concert | 2 | 4,223 | 354 | 8.4 | 9.3 | 0.3-18.3 |
| Grieg | other | 1 | 3,610 | 613 | 17.0 | 17.0 | 17.0 |
| Rieding | other | 5 | 3,005 | 47 | 1.6 | 2.6 | 0.4-3.9 |
| Schumann | other | 8 | 2,954 | 608 | 20.6 | 18.9 | 1.9-55.9 |
| Kuhlau | teaching | 2 | 2,816 | 72 | 2.6 | 3.1 | 0.8-5.4 |
| Joplin | other | 1 | 1,535 | 22 | 1.4 | 1.4 | 1.4 |
| Bach | other | 3 | 1,358 | 382 | 28.1 | 20.2 | 18.5-37.4 |
| Field | other | 1 | 1,076 | 1 | 0.1 | 0.1 | 0.1 |
| Couperin | other | 4 | 938 | 84 | 9.0 | 14.3 | 1.9-100.0 |
| Martini, Scriabin, Pachelbel, Hanon, Benda, Satie, Alkan, Gobbaerts, Gounod | other | 10 | 3,826 | 545 | 14.2 | | 4.2-36.1 |

All densities are percent of notes with a printed digit. The library pieces are listed in
section 3.1; seven of the eight are also Mutopia parts (same engravings), so the library is not an
independent sample.

## 3. What gets printed

### 3.1 Density per level, hand and part

| Group | Parts | Notes | Printed | Density (note-weighted) | Part median | IQR | p10-p90 | Parts >= 90 % | Parts < 5 % |
|---|---|---|---|---|---|---|---|---|---|
| teaching | 203 | 66,353 | 21,460 | 32.3 | 35.4 | 24.2-53.3 | 17.0-77.8 | 14 | 3 |
| teaching without Clementi | 132 | 46,562 | 11,805 | 25.4 | 30.3 | 22.0-38.5 | 16.6-45.8 | 0 | 2 |
| concert | 18 | 31,790 | 6,581 | 20.7 | 17.8 | 9.3-41.8 | 0.5-47.3 | 0 | 4 |
| other | 65 | 94,916 | 8,142 | 8.6 | 10.2 | 3.8-21.3 | 1.2-30.3 | 1 | 21 |
| library (8 pieces) | 8 | 3,457 | 751 | 21.7 | 18.3 | 13.6-21.5 | 10.1-26.1 | 0 | 0 |

| Group | RH notes | RH density | LH notes | LH density |
|---|---|---|---|---|
| teaching | 38,219 | 37.4 | 28,134 | 25.5 |
| concert | 17,594 | 28.1 | 14,196 | 11.6 |
| other | 44,206 | 12.6 | 50,710 | 5.1 |
| library | 1,671 | 28.0 | 1,786 | 15.9 |

| Library piece | Level | Notes | Printed | Density | RH | LH | Edition |
|---|---|---|---|---|---|---|---|
| burgmuller-op100-no1-la-candeur | 2 | 241 | 46 | 19.1 | 23.6 | 12.4 | Collection Litolff |
| schumann-op68-no1-melody | 2 | 256 | 27 | 10.5 | 20.6 | 3.9 | Peters |
| burgmuller-op100-no2-arabesque | 3 | 283 | 26 | 9.2 | 15.1 | 5.7 | Collection Litolff |
| burgmuller-op100-no3-pastorale | 3 | 355 | 52 | 14.6 | 35.2 | 3.1 | Collection Litolff |
| burgmuller-op100-no5-innocence | 3 | 215 | 44 | 20.5 | 24.2 | 14.9 | Collection Litolff |
| mozart-sonata-k545-mvt1 | 4 | 1,288 | 378 | 29.3 | 32.0 | 27.0 | IMSLP scan |
| beethoven-moonlight-sonata-mvt1 (bars 1-27) | 5 | 478 | 118 | 24.7 | 20.8 | 32.5 | Berners 1908 |
| chopin-waltz-op69-no2 (bars 0-32) | 5 | 341 | 60 | 17.6 | 43.7 | 0.5 | Peters (Scholtz) |

Reading: teaching editions print a digit on roughly one note in three (one in four without
Clementi's lessons), the right hand gets about 1.5 to 2.5 times the density of the left, and the
spread between parts is wide (IQR 22-39 percent even without Clementi). The eight library pieces
sit at 9 to 29 percent, median 18.

### 3.2 Print rate by score-only context

Print rate = printed digits / notes in the context, in percent (number of notes in parentheses).
Command as above (`results/print_rate_by_context.csv`).

| Context | teaching | concert | other | library |
|---|---|---|---|---|
| all notes | 32.3 (66,353) | 20.7 (31,790) | 8.6 (94,916) | 21.7 (3,457) |
| first note of the piece | 71.1 (467) | 58.6 (29) | 32.7 (147) | 50.0 (20) |
| first note of the hand | 69.7 (581) | 48.9 (45) | 30.3 (188) | 56.0 (25) |
| after any rest | 32.0 (8,612) | 10.5 (2,009) | 9.2 (10,421) | 48.1 (189) |
| after a rest of >= 1 beat | 35.9 (3,110) | 10.2 (664) | 12.2 (2,844) | 43.8 (112) |
| after a note >= 2 beats (no rest) | 38.9 (3,193) | 10.4 (1,302) | 13.0 (3,032) | 26.6 (188) |
| repeated pitch (0 st) | 14.2 (14,828) | 9.6 (2,573) | 3.7 (26,387) | 10.6 (578) |
| step (1-2 st) | 35.8 (24,349) | 25.9 (10,362) | 11.2 (27,102) | 17.1 (1,293) |
| third (3-4 st) | 42.4 (11,391) | 25.0 (5,588) | 11.4 (14,254) | 32.3 (705) |
| fourth-fifth (5-7 st) | 38.9 (9,568) | 21.9 (6,133) | 10.6 (13,185) | 27.6 (482) |
| sixth-octave (8-12 st) | 30.9 (5,022) | 14.8 (5,140) | 7.7 (11,266) | 25.1 (287) |
| more than an octave | 21.7 (614) | 6.5 (1,949) | 6.9 (2,534) | 25.3 (87) |
| white key | 31.8 (54,526) | 21.2 (15,450) | 8.7 (60,086) | 21.0 (2,908) |
| black key | 34.6 (11,827) | 20.3 (16,340) | 8.4 (34,830) | 25.3 (549) |
| single note | 38.3 (41,924) | 25.8 (20,235) | 14.0 (38,650) | 25.5 (2,456) |
| chord, bottom | 21.5 (10,329) | 11.9 (4,758) | 5.1 (22,197) | 16.9 (391) |
| chord, inner | 16.8 (3,771) | 3.9 (2,039) | 1.6 (11,872) | 3.2 (219) |
| chord, top | 24.6 (10,329) | 15.2 (4,758) | 6.2 (22,197) | 13.3 (391) |
| stepwise run, first note | 51.9 (1,702) | 44.0 (377) | 25.5 (1,279) | 40.7 (108) |
| stepwise run, inside | 29.8 (5,475) | 17.1 (1,879) | 13.0 (4,177) | 15.0 (467) |
| stepwise run, last note | 43.9 (1,516) | 35.0 (314) | 16.8 (1,145) | 8.1 (74) |
| not in a run | 31.7 (57,660) | 20.5 (29,220) | 8.0 (88,315) | 22.5 (2,808) |
| < 2 notes/s | 48.3 (6,522) | 20.4 (421) | 13.7 (3,588) | 44.6 (74) |
| 2-4 notes/s | 33.1 (24,687) | 11.9 (4,678) | 12.4 (20,955) | 19.4 (912) |
| 4-8 notes/s | 31.6 (27,578) | 19.4 (15,256) | 9.1 (43,575) | 26.1 (1,605) |
| >= 8 notes/s | 18.8 (7,566) | 26.0 (11,435) | 4.1 (26,798) | 14.1 (866) |
| downbeat | 42.2 (15,774) | 19.7 (4,006) | 12.4 (16,806) | 30.5 (679) |
| other beat | 31.3 (22,381) | 17.4 (9,848) | 7.3 (30,366) | 17.4 (1,183) |
| off the beat | 27.6 (28,198) | 22.8 (17,936) | 8.0 (47,744) | 21.2 (1,595) |
| right hand | 37.4 (38,219) | 28.1 (17,594) | 12.6 (44,206) | 27.9 (1,671) |
| left hand | 25.5 (28,134) | 11.5 (14,196) | 5.1 (50,710) | 15.9 (1,786) |
| grace note | 36.9 (609) | 10.5 (190) | 10.2 (1,141) | 26.9 (26) |

What stands out, consistently across groups:

* **Beginnings.** The first note of a hand is printed 2.2 times the base rate in teaching
  editions (70 percent) and the first note of a stepwise run 1.6 times (52 percent); the last
  note of a run is also above base (44 percent: the note after which the hand leaves the position).
* **Rests and long notes do not, by themselves, trigger a digit** in Mutopia editions (36 and 39
  percent in teaching, barely above the 32 base; well *below* base in concert and other). In the
  library pieces, which are complete short pieces rather than exercise collections, a rest of a
  beat doubles the rate (44 versus 22). Editors re-finger at phrase starts, not after every rest.
* **Leaps.** Thirds and fourths-fifths are printed most (42 and 39 percent in teaching); leaps
  wider than an octave are printed *less* (22 percent), presumably because the hand must move
  anyway and the finger is obvious (an octave is 1-5).
* **Repeated notes are the least printed context** (14 percent teaching, 4 percent other):
  nobody prints what does not change.
* **Chords.** Single notes 38 percent, outer chord voices 22-25 percent, inner voices 17 percent
  (teaching) and 2-4 percent elsewhere: the inner voice is inferred from the outer ones.
* **Black keys** make no difference (34.6 vs 31.8).
* **Downbeats** are printed more than off-beat notes (42 vs 28, teaching), and slow passages (< 2
  notes/s, 48 percent) more than fast ones (>= 8 notes/s, 19 percent): in fast passagework the
  editor fingers the pattern once rather than every note. Concert editions invert this (26 percent
  in the fastest bin): Chopin études are fingered in the fast figuration itself.
* **Right hand 1.5 to 2.5 times the left.**

### 3.3 What the printed digits themselves reveal

Among printed digits whose previous event is also printed (an *adjacent pair*, the only case
where a crossing or a position change can be read off the digits), we compute the anchor change
and the crossing type. Command as above (`results/printed_contexts.json`).

| | teaching | concert | other | library |
|---|---|---|---|---|
| printed digits | 21,460 | 6,581 | 8,142 | 751 |
| ... whose previous event is also printed (adjacent pairs) | 13,525 (63.0 %) | 4,198 (63.8 %) | 3,831 (47.0 %) | 297 (39.6 %) |
| adjacent pairs: anchor unchanged | 5,260 (38.9 %) | 681 (16.2 %) | 801 (20.9 %) | 87 (29.3 %) |
| adjacent pairs: anchor moves half a column (black-key ambiguity) | 3,035 (22.4 %) | 1,111 (26.5 %) | 971 (25.4 %) | 39 (13.1 %) |
| adjacent pairs: anchor moves 1 column | 2,431 (18.0 %) | 680 (16.2 %) | 756 (19.7 %) | 107 (36.0 %) |
| adjacent pairs: 1.5 | 842 (6.2 %) | 632 (15.0 %) | 425 (11.1 %) | 19 (6.4 %) |
| adjacent pairs: 2 | 799 (5.9 %) | 347 (8.3 %) | 263 (6.9 %) | 12 (4.0 %) |
| adjacent pairs: 2.5-3.5 | 854 (6.3 %) | 503 (12.0 %) | 377 (9.8 %) | 24 (8.1 %) |
| adjacent pairs: 4 or more | 304 (2.2 %) | 244 (5.8 %) | 238 (6.2 %) | 9 (3.0 %) |
| adjacent pairs: position change (anchor moves >= 1) | 5,230 (38.7 %) | 2,406 (57.3 %) | 2,059 (53.8 %) | 171 (57.6 %) |
| adjacent pairs: thumb under (1 after 2-4, outward) | 353 (2.6 %) | 151 (3.6 %) | 169 (4.4 %) | 14 (4.7 %) |
| adjacent pairs: finger over (2-4 after 1, inward) | 431 (3.2 %) | 192 (4.6 %) | 207 (5.4 %) | 17 (5.7 %) |
| events since the previous digit: median / mean / p90 | 1 / 2.5 / 5 | 1 / 3.1 / 4 | 2 / 6.4 / 11 | 2 / 3.5 / 8 |

Two things follow. First, **editors print in runs**: 63 percent of teaching digits directly
follow another digit, and the median gap between digits is one event. A reduction that prints
only isolated hints would look very different from an edition. Second, **a printed digit that
follows another is a position change about half the time** (39 percent in teaching, 54-57 in the
harder groups) and a crossing in only 6 to 10 percent of pairs: crossings are rare events, while
position changes are the common reason for a second digit.

The next table asks how many printed digits fall in at least one of the contexts named by the
spec's reduction list (first note, after a rest, after a long note, wide leap, chord outer voice,
run start, crossing, position change):

| Context of a printed digit | teaching | concert | other | library |
|---|---|---|---|---|
| first note of the hand | 405 (1.9 %) | 22 (0.3 %) | 57 (0.7 %) | 14 (1.9 %) |
| after a rest >= 1 beat | 1,117 (5.2 %) | 68 (1.0 %) | 346 (4.2 %) | 49 (6.5 %) |
| after a long note | 1,242 (5.8 %) | 135 (2.1 %) | 395 (4.9 %) | 50 (6.7 %) |
| leap of a fourth or more | 5,409 (25.2 %) | 2,228 (33.9 %) | 2,442 (30.0 %) | 227 (30.2 %) |
| outer voice of a chord | 4,765 (22.2 %) | 1,289 (19.6 %) | 2,529 (31.1 %) | 118 (15.7 %) |
| first note of a stepwise run | 883 (4.1 %) | 166 (2.5 %) | 326 (4.0 %) | 44 (5.9 %) |
| crossing (needs the previous digit) | 784 (3.6 %) | 343 (5.2 %) | 376 (4.6 %) | 31 (4.1 %) |
| position change (needs the previous digit) | 5,230 (24.4 %) | 2,406 (36.6 %) | 2,059 (25.3 %) | 171 (22.8 %) |
| in at least one of the above | 12,989 (60.5 %) | 4,515 (68.6 %) | 5,605 (68.8 %) | 467 (62.2 %) |
| in at least one score-only context | 11,031 (51.4 %) | 3,428 (52.1 %) | 4,708 (57.8 %) | 371 (49.4 %) |

And for the *isolated* digits (previous event unprinted: the editor chose to print one digit
alone, 36 percent of teaching digits, 60 percent of library digits), the share in each score-only
context compared with the share of all notes in that context:

| Isolated digits | teaching | concert | other | library |
|---|---|---|---|---|
| isolated digits (share of all printed) | 7,830 (36.5 %) | 2,352 (35.7 %) | 4,200 (51.6 %) | 450 (59.9 %) |
| first note of the hand | 5.2 % (all notes 0.9 %) | 0.9 % (0.1 %) | 1.4 % (0.2 %) | 3.1 % (0.7 %) |
| after a rest >= 1 beat | 9.7 % (4.7 %) | 2.1 % (2.1 %) | 6.7 % (3.0 %) | 9.6 % (3.2 %) |
| after a long note | 3.9 % (4.8 %) | 3.5 % (4.1 %) | 4.3 % (3.2 %) | 3.8 % (5.4 %) |
| leap of a fourth or more | 27.4 % (22.9 %) | 48.0 % (41.6 %) | 36.8 % (28.4 %) | 33.3 % (24.8 %) |
| outer voice of a chord | 26.7 % (31.1 %) | 16.7 % (29.9 %) | 33.2 % (46.8 %) | 17.1 % (22.6 %) |
| first note of a stepwise run | 5.1 % (2.6 %) | 3.3 % (1.2 %) | 4.3 % (1.4 %) | 7.6 % (3.1 %) |
| in at least one score-only context | 59.3 % | 63.0 % | 64.6 % | 55.3 % |

Only 55 to 65 percent of the isolated digits sit in any score-only context, and the enrichment
over the base rate is modest (a rest of a beat: 9.7 versus 4.7 percent; first note of a hand: 5.2
versus 0.9). **The score context does not say where an editor prints; the fingering does.** An
isolated digit typically marks a finger the reader would not have guessed (a position change, a
thumb placed early, 4 instead of 3), which is exactly the "cannot be inferred by the player model"
criterion of the spec, and the reason the predictor in section 6 cannot do much better than this.

## 4. Repeated passages

Command: `cd research && OMP_NUM_THREADS=2 .venv-readability/Scripts/python.exe -X utf8 -m readability.repeats`
(`results/repeats.json`). A repeated segment is at least four consecutive events of one
hand whose pitch tuples match up to one constant semitone shift, with the same per-note
durations and the same inter-onset intervals (1/48-beat grid). Segments are found greedily left
to right by hashing four-event windows and extending matches as far as possible without
overlap; every later note is paired with the note of the same chord rank in the *earliest*
statement (chains of matches are followed to their root). Later occurrences are classified as
exact (shift 0), transposed with the same black/white pattern, or transposed with a different
pattern; "adjacent" means the later occurrence starts right after the first. Caveats: the Mutopia
converter keeps volta repeats in written order (a passage under repeat signs appears once and is
not a repeat here) and expands `\repeat unfold` blocks, which then carry the editor's digits on
every copy (as the engraving does); four-event matches include generic figuration (Alberti
cells, scale fragments), so the rows with at least 8 events are closer to "repeated passage" in
the musical sense.

**All parts** (294; 196,516 notes, print rate 18.8 %; notes in no repeated segment: 51,816,
print rate 25.3 %):

| Category | Later occurrences | Median / p90 / max length (events) | First-statement notes: n, print rate | Later notes: n, print rate | P(later printed given first printed) | P(later printed given first unprinted) | Same digit when both printed |
|---|---|---|---|---|---|---|---|
| all repeats | 8,672 | 5 / 16 / 386 | 39,391, 24.3 | 105,309, 13.5 | 44.1 (26,600) | 3.2 (78,709) | 76.9 (11,722) |
| exact (same pitches) | 4,124 | 6 / 16 / 169 | 25,983, 23.1 | 52,496, 10.0 | 36.8 (12,252) | 1.8 (40,244) | 86.4 (4,504) |
| transposed, same black/white pattern | 1,239 | 4 / 8 / 112 | 5,337, 28.8 | 8,648, 20.0 | 57.6 (2,354) | 5.9 (6,294) | 71.3 (1,355) |
| transposed, different pattern | 1,781 | 4 / 8 / 96 | 7,780, 28.2 | 13,104, 22.3 | 59.1 (3,825) | 7.1 (9,279) | 60.8 (2,262) |
| immediately adjacent to the first statement | 1,947 | 5 / 15 / 377 | 15,715, 21.1 | 23,195, 7.4 | 31.3 (4,835) | 1.1 (18,360) | 82.0 (1,514) |
| not adjacent | 6,725 | 5 / 16 / 386 | 31,575, 25.7 | 82,114, 15.3 | 46.9 (21,765) | 3.9 (60,349) | 76.1 (10,208) |
| at least 8 events | 2,679 | 12 / 35 / 386 | 28,502, 24.2 | 68,857, 11.1 | 39.7 (16,803) | 1.8 (52,054) | 85.7 (6,670) |
| exact and at least 8 events | 1,449 | 12 / 29 / 169 | 17,469, 23.1 | 34,418, 8.5 | 33.7 (7,977) | 0.9 (26,441) | 91.1 (2,685) |

**Teaching parts** (203; print rate 32.3 %; notes in no repeated segment 23,301, print rate 38.2 %):

| Category | Later occurrences | Median / p90 / max length (events) | First-statement notes: n, print rate | Later notes: n, print rate | P(later printed given first printed) | P(later printed given first unprinted) | Same digit when both printed |
|---|---|---|---|---|---|---|---|
| all repeats | 3,172 | 5 / 13 / 288 | 13,103, 40.4 | 29,949, 24.3 | 51.6 (12,152) | 5.7 (17,797) | 74.7 (6,277) |
| exact (same pitches) | 1,730 | 5 / 14 / 82 | 9,585, 39.4 | 17,174, 21.3 | 48.8 (6,612) | 4.1 (10,562) | 87.6 (3,228) |
| transposed, same black/white pattern | 467 | 4 / 8 / 80 | 1,799, 43.0 | 2,822, 32.0 | 60.0 (1,225) | 10.5 (1,597) | 63.0 (735) |
| transposed, different pattern | 580 | 4 / 8 / 39 | 2,245, 47.2 | 3,554, 41.5 | 72.2 (1,737) | 12.2 (1,817) | 55.6 (1,255) |
| immediately adjacent to the first statement | 683 | 4 / 12 / 61 | 4,452, 38.3 | 5,631, 15.6 | 37.0 (2,148) | 2.4 (3,483) | 82.0 (795) |
| not adjacent | 2,489 | 5 / 14 / 288 | 10,842, 40.8 | 24,318, 26.3 | 54.8 (10,004) | 6.5 (14,314) | 73.7 (5,482) |
| at least 8 events | 828 | 12 / 32 / 288 | 8,507, 41.3 | 17,146, 20.2 | 46.8 (6,761) | 2.8 (10,385) | 86.3 (3,162) |
| exact and at least 8 events | 517 | 11 / 28 / 82 | 5,834, 40.1 | 10,101, 19.9 | 48.5 (3,862) | 2.2 (6,239) | 92.7 (1,872) |

The other groups (`results/repeats.json`): concert P(later printed given first printed) 51.0 %
(exact 37.5), other 26.2 % (exact 14.9), library 53.9 % (exact 38.2), each with later-occurrence
print rates well below the first statement's.

Findings:

* **Editors print about half as often on a repeat**: later occurrences print at 13.5 percent
  against 24.3 for first statements overall (teaching 24.3 versus 40.4), and exact repeats of at
  least eight events at 8.5 percent (teaching 19.9).
* **When the first statement carries a digit, the repeat is re-printed 37 to 52 percent of the
  time** (teaching, all repeats: 51.6; exact: 48.8; long exact: 48.5), and when the first
  statement has no digit, the repeat almost never gets one (2 to 6 percent). Where both are
  printed, the digit is the same 87 to 93 percent of the time on exact repeats: editors finger
  repeats consistently (literature P11) and re-print a digit roughly every second time, more often
  when the repeat is far away (46.9 versus 31.3 percent when adjacent).
* **Transpositions are re-printed more** (58 to 72 percent) and with changed digits more often
  (same digit 56 to 71 percent, lowest when the black/white pattern changes): a transposed
  sequence is not treated as a repeat by editors.
* Nearly half of all teaching notes (29,949 of 66,353) lie in a later occurrence of some
  repeated segment, so how repeats are handled is the single largest lever on density.

## 5. The player model, validated

### 5.1 The rule set as implemented (`research/readability/player_model.py`)

A deterministic forward reader of one hand. Fingers are 1..5 for both hands; `s = +1` for the
right hand and `-1` for the left (in the left hand, moving up in pitch moves toward the thumb,
i.e. to a lower finger number). `steps(a, b) = round_half_away_from_zero((b - a) / 2)` turns
semitones into scale steps: 0 for a repeat, +-1 for a second, +-2 for a third, +-3 for a fourth
or tritone, +-4 for a fifth or minor sixth, +-5 for a major sixth or seventh, +-6 for an octave.
On a diatonic pentachord (any mode) this maps the five scale degrees to 1..5, which is where the
half-column ambiguity of the x14/2 anchor model is resolved; on white keys it equals the
white-key column difference except for the diminished fifth (B-F) and the minor sixth (E-C,
A-F, B-G), and the column-based variant measured as a sensitivity check is worse (table
below). State: `ref` = the notes of the last event with a visible digit (pitch, finger), the
position anchor; `prev` = the notes of the previous event whose finger is known (printed or
inferred); both are matched to the current note by nearest pitch (ties to the lower pitch).

For a note `q` the first applicable rule wins:

| Rule | Condition | Finger |
|---|---|---|
| R0 printed | the digit is visible | as printed; the event becomes `ref` |
| R1 repeated note | single note, `q == prev.pitch` | `prev.finger` |
| R2 stepwise | single note, `1 <= abs(q - prev.pitch) <= 2` | `prev.finger + s * sign(q - prev.pitch)`; if outside 1..5, fall through |
| R3 position | single note, `ref` known | `ref.finger + s * steps(ref.pitch, q)`; outside 1..5 = not inferable |
| R4 chord fill | event of two or more notes with a visible digit | `f_vis + s * steps(p_vis, q)` from the nearest visible chord note; two chord notes with the same inferred finger or any outside 1..5 = not inferable |
| R4 from `ref` | chord without a visible digit, `ref` known | every note placed from `ref` as in R3, same checks |
| none | otherwise | not inferable: the reader needs a digit |

Inferred fingers propagate through `prev` but never become `ref`. Grace notes are ordinary
single-note events. The `rules_plus_textbook` variant (`textbook.py`) runs one rule before R1:
if the note lies in a run of at least four single-note events matching a window of a textbook
scale, arpeggio or chromatic pattern (`benchmarks/textbook/*.json`, any octave, main fingering
or an alternative, `agreed` entries first) and the visible digits inside the run agree with the
pattern, the pattern's finger is used. The baseline `copy_previous` gives every unprinted note
the finger of the last visible digit.

### 5.2 Hide-20 and leave-one-out

Command: `OMP_NUM_THREADS=2 research/.venv-readability/Scripts/python.exe -X utf8 research/readability/eval_player.py --seeds 0 1 2 3 4`
(`results/player_model.json`). Hide-20: in each part and hand a random 20 percent of
the printed digits is hidden (`random.Random(seed)`, seeds 0 to 4), the model reads the hand with
the remaining digits visible, and each hidden note is scored. Coverage = inferred / hidden,
accuracy = correct / inferred, reconstruction = correct / hidden. Mean over seeds [min-max]:

| Model | Group | Hidden per seed | Coverage | Accuracy | Reconstruction |
|---|---|---|---|---|---|
| copy_previous | all | 7,385 | 98.1 [98.0-98.2] | 11.3 [11.1-11.6] | 11.1 [10.9-11.3] |
| rules | teaching | 4,295 | 80.0 [79.7-80.6] | 71.4 [70.9-71.7] | 57.1 [56.5-57.6] |
| rules | concert | 1,316 | 68.5 [67.3-69.4] | 43.5 [41.4-46.0] | 29.8 [27.9-31.8] |
| rules | other | 1,625 | 68.2 [67.0-70.5] | 49.4 [48.4-50.7] | 33.7 [32.6-35.8] |
| rules | library | 149 | 68.9 [65.8-72.5] | 46.4 [42.1-50.9] | 31.9 [30.2-36.9] |
| rules | all | 7,385 | 75.1 [74.7-75.5] | 62.0 [61.4-62.6] | 46.6 [46.0-47.2] |
| rules_plus_textbook | teaching | 4,295 | 82.2 [81.6-82.9] | 71.8 [71.4-72.1] | 59.0 [58.3-59.7] |
| rules_plus_textbook | concert | 1,316 | 69.9 [69.0-70.6] | 44.4 [42.2-46.7] | 31.1 [29.1-33.0] |
| rules_plus_textbook | other | 1,625 | 71.1 [69.8-74.0] | 50.8 [50.1-51.4] | 36.1 [34.9-38.0] |
| rules_plus_textbook | library | 149 | 72.2 [69.1-74.5] | 55.0 [50.4-58.2] | 39.7 [37.6-43.0] |
| rules_plus_textbook | all | 7,385 | 77.4 [76.8-78.0] | 62.8 [62.3-63.2] | 48.6 [47.9-49.2] |
| rules with white-key-column steps (sensitivity) | all | 7,385 | 70.3 [69.8-70.8] | 58.8 [58.3-59.5] | 41.3 [41.0-41.8] |

Leave-one-out (each printed digit hidden alone, all others visible; the best case for a reader):

| Model | Group | Digits | Coverage | Accuracy | Reconstruction |
|---|---|---|---|---|---|
| copy_previous | all | 36,934 | 98.5 | 8.8 | 8.6 |
| rules | teaching | 21,460 | 81.4 | 72.9 | 59.3 |
| rules | concert | 6,581 | 70.2 | 46.3 | 32.5 |
| rules | other | 8,142 | 69.9 | 51.4 | 35.9 |
| rules | library | 751 | 72.8 | 48.1 | 35.0 |
| rules | all | 36,934 | 76.7 | 63.8 | 48.9 |
| rules_plus_textbook | teaching | 21,460 | 83.3 | 73.4 | 61.1 |
| rules_plus_textbook | all | 36,934 | 78.7 | 64.6 | 50.9 |

**Read these numbers with the selection bias in mind.** The hidden notes are printed notes, and
editors print precisely where the obvious finger is not the one they want: when two repeated
notes are both printed, the editor changes finger in 303 of 489 teaching pairs and 59 of 64
concert pairs. The accuracies above therefore say how often the reader agrees with the editor
*at the places editors chose to mark*, which understates how well the same reader does on the
notes editors left unmarked. Section 5.5 gives the unbiased measurement on fully fingered parts.

### 5.3 Which rules a reader can be assumed to apply

Per rule (hide-20, counts summed over the five seeds, all groups):

| Rule | Rules model: n | share | accuracy | With textbook: n | share | accuracy |
|---|---|---|---|---|---|---|
| textbook | - | - | - | 2,940 | 8.0 | 71.2 |
| R1 repeated note | 1,613 | 4.4 | 42.0 | 1,533 | 4.2 | 41.2 |
| R2 stepwise | 8,556 | 23.2 | 70.8 | 7,072 | 19.1 | 70.6 |
| R3 position | 10,406 | 28.2 | 54.1 | 9,850 | 26.7 | 54.6 |
| R4 chord fill from a visible chord note | 5,260 | 14.2 | 72.6 | 5,260 | 14.2 | 72.6 |
| R4 chord placed from `ref` | 1,910 | 5.2 | 53.6 | 1,910 | 5.2 | 53.6 |
| none (not inferable) | 9,180 | 24.9 | - | 8,360 | 22.6 | - |

| Rule | teaching n / accuracy | concert | other | library |
|---|---|---|---|---|
| R1 | 1,025 / 53.8 | 89 / 6.7 | 463 / 23.5 | 36 / 30.6 |
| R2 | 5,373 / 81.3 | 1,629 / 51.3 | 1,437 / 56.7 | 117 / 32.5 |
| R3 | 6,405 / 63.5 | 1,907 / 34.6 | 1,808 / 41.8 | 286 / 50.3 |
| R4 | 3,559 / 78.2 | 504 / 54.4 | 1,164 / 63.7 | 33 / 66.7 |
| R4 from `ref` | 825 / 60.9 | 378 / 49.2 | 666 / 47.0 | 41 / 56.1 |
| none | 4,288 / - | 2,073 / - | 2,587 / - | 232 / - |

Accuracy decays with the distance from the last visible digit (rules model, all groups):

| Events since the last visible digit | 0 (same chord) | 1 | 2 | 3 | 4 | 5-8 | 9-16 | 17+ | no digit before |
|---|---|---|---|---|---|---|---|---|---|
| hidden digits | 6,891 | 15,100 | 4,510 | 2,612 | 2,020 | 3,191 | 1,203 | 819 | 579 |
| coverage | 76.3 | 80.6 | 77.0 | 76.8 | 71.7 | 70.2 | 61.9 | 49.0 | 0.0 |
| accuracy | 72.6 | 62.9 | 58.5 | 54.9 | 60.5 | 52.7 | 48.0 | 44.6 | - |

Per context (rules model, hide-20; coverage / accuracy in percent, hidden digits in parentheses):

| Context | teaching | concert | other | library |
|---|---|---|---|---|
| first note of the hand | 29 / 80 (403) | 11 / 50 (19) | 12 / 29 (59) | 15 / 100 (13) |
| repeated pitch | 89 / 64 (2,136) | 77 / 32 (236) | 79 / 34 (986) | 84 / 33 (55) |
| step | 88 / 79 (8,639) | 82 / 50 (2,720) | 75 / 58 (3,040) | 66 / 38 (247) |
| third | 86 / 70 (4,817) | 70 / 41 (1,389) | 71 / 44 (1,631) | 85 / 56 (211) |
| fourth-fifth | 76 / 60 (3,783) | 60 / 33 (1,326) | 67 / 45 (1,388) | 82 / 43 (125) |
| sixth-octave | 32 / 62 (1,566) | 38 / 39 (778) | 40 / 54 (862) | 24 / 76 (71) |
| over an octave | 37 / 52 (131) | 20 / 18 (112) | 17 / 56 (159) | 17 / 50 (23) |
| single note | 80 / 70 (16,092) | 69 / 41 (5,243) | 69 / 45 (5,382) | 71 / 44 (618) |
| chord bottom | 78 / 74 (2,210) | 61 / 49 (591) | 60 / 60 (1,164) | 52 / 38 (56) |
| chord inner | 94 / 69 (610) | 75 / 56 (72) | 89 / 44 (184) | 62 / 60 (8) |
| chord top | 81 / 78 (2,563) | 70 / 54 (674) | 70 / 58 (1,395) | 63 / 78 (63) |
| stepwise run, first | 72 / 76 (899) | 59 / 45 (167) | 59 / 44 (319) | 80 / 38 (46) |
| stepwise run, inside | 82 / 71 (1,616) | 83 / 45 (345) | 72 / 42 (557) | 54 / 7 (78) |
| stepwise run, last | 85 / 86 (703) | 81 / 52 (112) | 73 / 68 (199) | 100 / 0 (10) |
| after a rest >= 1 beat | 81 / 76 (1,140) | 39 / 35 (67) | 53 / 45 (341) | 51 / 48 (45) |
| after a long note | 79 / 71 (1,242) | 39 / 30 (139) | 64 / 43 (416) | 51 / 44 (53) |
| white key | 81 / 72 (17,383) | 71 / 44 (3,303) | 70 / 48 (5,166) | 71 / 48 (610) |
| black key | 78 / 68 (4,092) | 66 / 43 (3,277) | 64 / 52 (2,959) | 57 / 38 (135) |
| < 2 notes/s | 80 / 72 (3,173) | 38 / 53 (89) | 59 / 40 (486) | 50 / 65 (34) |
| >= 8 notes/s | 81 / 74 (1,424) | 75 / 48 (2,981) | 64 / 52 (1,081) | 71 / 53 (129) |
| right hand | 81 / 71 (14,345) | 72 / 44 (4,945) | 70 / 50 (5,550) | 74 / 44 (465) |
| left hand | 78 / 72 (7,130) | 59 / 40 (1,635) | 64 / 47 (2,575) | 60 / 51 (280) |

Confusion of the inferred finger (columns) against the editor's (rows), rules model, hide-20,
inferred digits only:

| editor \ inferred | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| 1 | 2,907 | 770 | 689 | 455 | 243 |
| 2 | 1,323 | 3,737 | 1,097 | 326 | 156 |
| 3 | 277 | 759 | 4,040 | 1,055 | 424 |
| 4 | 108 | 318 | 833 | 3,577 | 722 |
| 5 | 62 | 133 | 316 | 476 | 2,942 |

What this says about the rules, on teaching repertoire (the target of the app):

* **Stepwise motion with adjacent fingers (R2) is the rule a reader applies most and best**: 81
  percent agreement with the editor at marked places, and 86 percent at the end of a stepwise run.
  **Chord fill from a visible digit (R4) is as reliable (78 percent)**; inner voices are
  inferable 94 percent of the time.
* **Position continuation (R3) is right about two thirds of the time** (63.5 percent) and
  carries 28 percent of the inferences; this is the rule editors override most often, which is
  what a printed digit after a skip is for. Large skips are mostly not inferable at all (coverage
  32 percent for a sixth to an octave, 37 percent beyond) and only half right when they are.
* **Repeated notes keep the finger (R1) only about half the time at marked places** (54 percent
  teaching, 7 percent concert), because an editor who prints a digit on a repeated note is
  usually asking for a finger change. On the unmarked repeated notes (86 percent of them) the
  rule is right by definition of the corpus: nobody prints what does not change. Keep R1, but
  the engine should print the digit whenever it changes finger on a repeat.
* **Textbook scale and arpeggio patterns add two points of reconstruction** (57.1 to 59.0 on
  teaching) at 71 percent accuracy on the 8 percent of notes they cover; they also raise coverage
  on the first note of a hand slightly. Worth having, not decisive.
* **Copying the previous digit is useless** (11 percent), so the comparison with the rule set is
  not close: a reader needs geometry, not memory of the last digit.
* The left hand is inferred as well as the right once the mirroring is right (72 versus 71
  percent in teaching); black keys cost 4 points.

### 5.4 Errors the reader makes

The confusion matrix shows the reader's biases: when the editor wants 2 the reader often says
1 (1,323 cases: the editor shifted the thumb early, typically before a scale run) or 3 (1,097:
the editor skipped a finger to prepare a stretch); 3 and 4 are swapped in both directions
(1,055 and 833: the 3-versus-4 choice on a fourth or a black key is exactly what the ergonomic
literature calls a free choice). These are the cases where a digit has information: a reduction
keyed on "would the reader have guessed this" catches them, a reduction keyed on score context
does not.

### 5.5 The minimal-sufficient reduction applied to real fingerings

Command: `research/.venv-readability/Scripts/python.exe -X utf8 research/readability/reduce.py`
(`results/reduction.json`, `results/reduction_by_part.csv`). A greedy forward pass keeps a digit
only where the reader, with the digits kept so far, would infer a different finger or none; by
construction the kept set reconstructs 100 percent of the editor's digits. On the fully fingered
parts (editorial density at least 90 percent: 14 Clementi lessons and one Couperin example,
1,910 notes) this is an unbiased measurement of the density the spec's reduction would print for
a complete fingering. On the other parts the unprinted notes are inferred unchecked, so "kept /
printed" there measures how much of what the editor printed a forward reader could have
inferred.

Four readers: the rule set of 5.1; with the textbook rule; with a *repeat memory* (R5: where
the reader would be wrong or has nothing to say, and the event is a later occurrence of a
repeated segment as defined in section 4 whose first statement the reader has already
reconstructed, it remembers the finger it used there; tried last, so it never overrides a
correct inference); and with both.

| Reader | Parts | Notes | Printed by the editor | Kept by the reduction | Editorial density | Kept density | Median part kept density (min-max) | Kept / printed |
|---|---|---|---|---|---|---|---|---|
| rules | fully fingered parts (>= 90 %): 15 | 1,910 | 1,795 | 743 | 94.0 | **38.9** | 46.1 (18.1-69.0) | 41.4 |
| rules | parts >= 70 %: 32 | 6,030 | 5,002 | 2,151 | 83.0 | 35.7 | 39.2 (4.4-69.0) | 43.0 |
| rules | teaching (all): 203 | 66,353 | 21,460 | 9,278 | 32.3 | 14.0 | 14.5 (0.5-69.0) | 43.2 |
| rules | concert: 18 | 31,790 | 6,581 | 4,527 | 20.7 | 14.2 | 12.4 (0.2-49.3) | 68.8 |
| rules | other: 65 | 94,916 | 8,142 | 5,450 | 8.6 | 5.7 | 6.0 (0.1-42.4) | 66.9 |
| rules | library: 8 | 3,457 | 751 | 492 | 21.7 | 14.2 | 12.3 (5.9-18.0) | 65.5 |
| rules + textbook | fully fingered parts: 15 | 1,910 | 1,795 | 725 | 94.0 | **38.0** | 44.2 (16.9-58.6) | 40.4 |
| rules + textbook | teaching (all): 203 | 66,353 | 21,460 | 9,036 | 32.3 | 13.6 | 14.4 (0.4-58.6) | 42.1 |
| rules + textbook | library: 8 | 3,457 | 751 | 464 | 21.7 | 13.4 | 12.0 (5.9-17.8) | 61.8 |
| rules + repeat memory | fully fingered parts: 15 | 1,910 | 1,795 | 626 | 94.0 | **32.8** | 43.3 (13.2-69.0) | 34.9 |
| rules + repeat memory | parts >= 70 %: 32 | 6,030 | 5,002 | 1,723 | 83.0 | 28.6 | 30.2 (4.4-69.0) | 34.4 |
| rules + repeat memory | teaching (all): 203 | 66,353 | 21,460 | 7,357 | 32.3 | 11.1 | 11.5 (0.5-69.0) | 34.3 |
| rules + repeat memory | concert: 18 | 31,790 | 6,581 | 2,811 | 20.7 | 8.8 | 8.6 (0.2-21.7) | 42.7 |
| rules + repeat memory | other: 65 | 94,916 | 8,142 | 4,325 | 8.6 | 4.6 | 4.5 (0.1-29.4) | 53.1 |
| rules + repeat memory | library: 8 | 3,457 | 751 | 343 | 21.7 | 9.9 | 8.4 (5.5-17.0) | 45.7 |
| rules + textbook + repeat memory | fully fingered parts: 15 | 1,910 | 1,795 | 610 | 94.0 | **31.9** | 41.7 (12.0-58.6) | 34.0 |
| rules + textbook + repeat memory | teaching (all): 203 | 66,353 | 21,460 | 7,181 | 32.3 | 10.8 | 11.1 (0.4-58.6) | 33.5 |
| rules + textbook + repeat memory | library: 8 | 3,457 | 751 | 324 | 21.7 | 9.4 | 7.9 (5.5-17.0) | 43.1 |

Why a digit had to be kept on the fully fingered parts (rules reader, 743 kept digits), and the
share of the editor's digits kept by context:

| Reader outcome without the digit | Kept digits | Share |
|---|---|---|
| not inferable (`none`) | 369 | 49.7 |
| R3 position gave another finger | 163 | 21.9 |
| R2 stepwise gave another finger (a crossing inside a run) | 106 | 14.3 |
| R4 chord placed from `ref` gave another finger | 44 | 5.9 |
| R4 chord fill gave another finger | 42 | 5.7 |
| R1 repeat gave another finger | 19 | 2.6 |

| Context (fully fingered parts) | Kept | Dropped | Kept share |
|---|---|---|---|
| first note of the hand | 35 | 0 | 100.0 |
| step | 226 | 651 | 25.8 |
| third | 110 | 202 | 35.3 |
| fourth-fifth | 193 | 142 | 57.6 |
| sixth-octave | 121 | 11 | 91.7 |
| over an octave | 10 | 0 | 100.0 |
| repeated pitch | 48 | 46 | 51.1 |
| single note | 570 | 1,000 | 36.3 |
| chord bottom | 88 | 19 | 82.2 |
| chord inner | 5 | 2 | 71.4 |
| chord top | 80 | 31 | 72.1 |
| stepwise run, first note | 46 | 36 | 56.1 |
| stepwise run, inside | 60 | 198 | 23.3 |
| stepwise run, last note | 14 | 57 | 19.7 |
| after a rest >= 1 beat | 15 | 7 | 68.2 |
| right hand | 422 | 668 | 38.7 |
| left hand | 321 | 384 | 45.5 |
| white key | 594 | 897 | 39.8 |
| black key | 149 | 155 | 49.0 |

Findings:

* **A forward reader with the spec's rules needs a digit on 39 percent of the notes of a
  complete fingering** (fully fingered Clementi lessons; median part 46 percent, range 18 to 69).
  That is below the spec's floor (40) but above its target (30), and far from "editor level"
  (20). The textbook rule saves one point.
* **Remembering repeats saves six points** (38.9 to 32.8 percent; 117 of the 743 digits are
  recovered from an earlier statement) and is the single most effective addition; on
  partially fingered teaching parts it cuts what the reader needs from 43 to 34 percent of what
  the editor printed.
* **Half of the necessary digits are not inferable at all** (first notes, leaps out of the
  position: a sixth or more is kept 92 to 100 percent of the time), a fifth are position choices
  the reader guessed differently (R3), a seventh are crossings inside stepwise motion (R2).
  Steps and run interiors need a digit only about a quarter of the time; chord notes need one
  72 to 82 percent of the time, because a chord usually starts a new position and the reader's
  chord fill then has nothing to fill from.
* **Editors print more than a forward reader needs**: on teaching parts 43 percent of the
  printed digits are necessary for this reader (34 with repeat memory), the rest confirm what it
  would have inferred, mostly inside fingered runs (section 3.3: 63 percent of digits follow a
  digit). This is the quantitative form of "editors print in runs": an edition is not a minimal
  set, and matching editorial density exactly is not the right goal; matching it from below is.

The table in section 7 turns this into targets.

## 6. A printed-digit predictor

Command: `cd research && OMP_NUM_THREADS=2 .venv-readability/Scripts/python.exe -X utf8 -m readability.predictor`
(`results/predictor.json`, `predictor_coefficients.csv`, `predictor_tree.txt`,
`predictor_library.csv`). Rows: the 193,059 Mutopia notes; target: printed. Inputs: 39
score-only features (the contexts of section 3.2 as numbers and one-hot bins; the
printed-derived columns are excluded because they leak the target). Models: logistic regression
on standardised inputs (C = 1, no class weighting), a depth-3 decision tree (min 200 notes per
leaf), and the spec's reduction list as a binary rule (print if first note of the hand, or a rest
of at least a beat before, or a leap of at least 5 semitones, or an outer chord voice, or the
first note of a stepwise run) with two variants. Validation: 5-fold GroupKFold by part (parts
permuted with seed 0; folds of 38.6k rows and 57-58 parts). "Density-matched" precision and
recall are at the threshold that makes the predicted density equal the group's editorial density
(threshold computed on the training folds).

| Model | Group | Notes | Editorial density | AUC | Average precision | Precision / recall / predicted density at 0.5 | Precision / recall at the density-matched threshold |
|---|---|---|---|---|---|---|---|
| logistic regression | overall | 193,059 | 18.7 | 0.724 | 0.350 | 49.9 / 5.2 / 1.9 | 36.4 / 36.4 |
| logistic regression | teaching | 66,353 | 32.3 | 0.687 | 0.497 | 67.2 / 6.5 / 3.1 | 48.1 / 47.5 |
| logistic regression | concert | 31,790 | 20.7 | 0.679 | 0.336 | 44.0 / 1.6 / 0.8 | 34.1 / 36.4 |
| logistic regression | other | 94,916 | 8.6 | 0.725 | 0.176 | 25.8 / 4.5 / 1.5 | 20.0 / 20.4 |
| logistic, trained on teaching only | teaching | 66,353 | 32.3 | 0.686 | 0.489 | 54.2 / 25.2 / 15.0 | 48.1 / 49.8 |
| depth-3 tree | overall | 193,059 | 18.7 | 0.683 | 0.297 | no leaf reaches 0.5 | 33.8 / 19.5 |
| depth-3 tree | teaching | 66,353 | 32.3 | 0.648 | 0.443 | no leaf reaches 0.5 | 42.2 / 54.6 |
| depth-3 tree | concert | 31,790 | 20.7 | 0.642 | 0.296 | no leaf reaches 0.5 | 28.3 / 38.4 |
| depth-3 tree | other | 94,916 | 8.6 | 0.696 | 0.150 | no leaf reaches 0.5 | 16.1 / 18.4 |
| spec rule list | overall | 193,059 | 18.7 | 0.444 | 0.173 | 15.9 / 50.8 / 59.9 | (binary rule) |
| spec rule list | teaching | 66,353 | 32.3 | 0.479 | 0.315 | 30.6 / 48.8 / 51.6 | (binary rule) |
| spec rule list | concert | 31,790 | 20.7 | 0.426 | 0.187 | 16.9 / 51.4 / 63.1 | (binary rule) |
| spec rule list | other | 94,916 | 8.6 | 0.452 | 0.079 | 7.4 / 55.8 / 64.6 | (binary rule) |
| spec rules without the chord-outer clause | overall | 193,059 | 18.7 | 0.511 | 0.191 | 19.8 / 34.2 / 32.3 | (binary rule) |
| spec rules without the chord-outer clause | teaching | 66,353 | 32.3 | 0.535 | 0.342 | 37.8 / 33.4 / 28.6 | (binary rule) |
| spec rules plus "after a long note" | overall | 193,059 | 18.7 | 0.450 | 0.174 | 16.2 / 53.0 / 61.1 | (binary rule) |

Standardised logistic coefficients (top 16 of 39 by absolute value; some inputs duplicate each
other by construction, e.g. `repeated` and `leap_bin=repeat`, and share their weight):

| Rank | Feature | Standardised coefficient | Odds ratio per SD | Teaching-only model | Mean | SD | Print rate when non-zero |
|---|---|---|---|---|---|---|---|
| 1 | chord_size | -0.629 | 0.53 | -0.284 | 1.780 | 0.944 | 18.7 |
| 2 | leap_abs | -0.539 | 0.58 | -0.396 | 3.514 | 3.992 | 21.8 |
| 3 | hand_R | +0.359 | 1.43 | +0.359 | 0.518 | 0.500 | 24.8 |
| 4 | repeated | -0.243 | 0.78 | -0.283 | 0.227 | 0.419 | 7.6 |
| 5 | leap_bin=repeat | -0.243 | 0.78 | -0.283 | 0.227 | 0.419 | 7.6 |
| 6 | downbeat | +0.179 | 1.20 | +0.204 | 0.190 | 0.392 | 26.1 |
| 7 | leap_bin=sixth_octave | +0.171 | 1.19 | +0.171 | 0.111 | 0.314 | 14.8 |
| 8 | leap_bin=over_octave | +0.168 | 1.18 | +0.098 | 0.026 | 0.160 | 8.5 |
| 9 | after_rest | +0.136 | 1.15 | +0.166 | 0.109 | 0.312 | 18.7 |
| 10 | leap_bin=fourth_fifth | +0.129 | 1.14 | +0.149 | 0.150 | 0.357 | 22.4 |
| 11 | on_beat | +0.126 | 1.13 | +0.186 | 0.514 | 0.500 | 20.6 |
| 12 | leap_bin=step | -0.105 | 0.90 | -0.085 | 0.320 | 0.467 | 23.3 |
| 13 | prev_black | -0.101 | 0.90 | -0.018 | 0.329 | 0.470 | 15.6 |
| 14 | grace | -0.093 | 0.91 | -0.048 | 0.010 | 0.100 | 18.6 |
| 15 | run_pos=mid | -0.073 | 0.93 | -0.093 | 0.060 | 0.237 | 21.6 |
| 16 | notes_per_sec | -0.071 | 0.93 | -0.086 | 5.846 | 3.565 | 18.7 |

Intercept -1.771 (teaching-only model -0.869). The depth-3 tree, fitted on all rows, splits on
chord membership, hand, downbeat, melodic direction, chord size and repeated pitch; its leaves
range from 2.3 percent (left-hand chords of three or more notes) to 44.2 percent (single notes on
a downbeat not moving down), and no leaf reaches 50 percent, which is why it predicts nothing at
the 0.5 threshold:

```
single note, not a downbeat, LH -> 19.4 % (32,359)     chord, LH, size <= 2 -> 9.3 % (22,494)
single note, not a downbeat, RH -> 27.5 % (51,997)     chord, LH, size >= 3 -> 2.3 % (30,670)
single note, downbeat, moving down -> 30.4 % (8,492)   chord, RH, not a repeated pitch -> 20.9 % (26,271)
single note, downbeat, not moving down -> 44.2 % (7,961)   chord, RH, repeated pitch -> 9.5 % (12,815)
```

The spec's clauses one by one, and by stratum (print rate when the clause fires / otherwise):

| Clause | Fires on (share of notes) | Precision (print rate when it fires) | Recall |
|---|---|---|---|
| first note of the hand | 0.4 | 59.5 | 1.3 |
| rest of >= 1 beat before | 3.4 | 23.1 | 4.2 |
| after a long note | 3.9 | 23.5 | 4.9 |
| leap of >= 5 semitones | 28.7 | 18.2 | 27.9 |
| outer voice of a chord | 38.6 | 11.5 | 23.7 |
| first note of a stepwise run | 1.7 | 40.9 | 3.8 |

| Stratum | Notes | Editorial density | Spec rules: predicted density | precision | recall | leap >= 5: fires / otherwise | rest >= 1 beat: fires / otherwise | run start: fires / otherwise |
|---|---|---|---|---|---|---|---|---|
| RH single notes | 60,933 | 29.6 | 28.5 | 33.6 | 32.3 | 32.2 / 28.8 | 45.3 / 29.4 | 39.4 / 29.2 |
| RH chord notes | 39,086 | 17.2 | 87.1 | 18.2 | 92.5 | 18.7 / 16.8 | 26.5 / 16.8 | - |
| LH single notes | 39,876 | 21.6 | 47.2 | 19.8 | 43.1 | 17.8 / 24.6 | 38.9 / 21.1 | 44.8 / 21.1 |
| LH chord notes | 53,164 | 5.2 | 85.4 | 5.8 | 94.8 | 5.3 / 5.2 | 8.0 / 5.1 | - |
| RH single notes, teaching | 26,006 | 39.8 | 26.0 | 48.1 | 31.4 | 46.8 / 37.9 | 59.5 / 39.4 | 48.0 / 39.4 |
| RH single notes, concert | 11,018 | 35.0 | 39.8 | 29.8 | 33.8 | 28.8 / 38.8 | 42.6 / 34.9 | 59.2 / 34.5 |
| RH single notes, other | 23,909 | 16.2 | 26.0 | 20.5 | 32.9 | 19.6 / 15.3 | 33.3 / 15.8 | 25.4 / 15.8 |

Library check (global logistic model fitted on all Mutopia rows; the eight pieces are also in
Mutopia, so this is not a clean hold-out; refitting without the eight overlapping Mutopia parts
MP0202, MP0203, MP0214, MP0218, MP0276f0, MP0511, MP0647, MP0998 changes the pooled AUC from
0.668 to 0.665):

| Library piece | Level | Notes | Editorial density | Mean predicted probability | Predicted density at 0.5 | Predicted density at the teaching density-matched threshold | AUC on the piece |
|---|---|---|---|---|---|---|---|
| beethoven-moonlight-sonata-mvt1 | 5 | 478 | 24.7 | 24.7 | 0.4 | 43.3 | 0.474 |
| burgmuller-op100-no1-la-candeur | 2 | 241 | 19.1 | 28.7 | 5.8 | 53.5 | 0.776 |
| burgmuller-op100-no2-arabesque | 3 | 283 | 9.2 | 19.0 | 5.3 | 27.6 | 0.825 |
| burgmuller-op100-no3-pastorale | 3 | 355 | 14.6 | 17.4 | 2.5 | 31.3 | 0.859 |
| burgmuller-op100-no5-innocence | 3 | 215 | 20.5 | 23.7 | 4.2 | 30.2 | 0.537 |
| chopin-waltz-op69-no2 | 5 | 341 | 17.6 | 18.2 | 2.1 | 30.8 | 0.867 |
| mozart-sonata-k545-mvt1 | 4 | 1,288 | 29.3 | 23.2 | 2.2 | 26.6 | 0.616 |
| schumann-op68-no1-melody | 2 | 256 | 10.5 | 28.0 | 4.3 | 35.5 | 0.836 |
| all eight | | 3,457 | 21.7 | 22.8 | 2.8 | 32.7 | 0.668 |

Findings:

* **Score context predicts where an editor prints only weakly**: cross-validated AUC 0.72
  overall and 0.69 on teaching parts for the logistic model, 0.68 / 0.65 for the tree; at the
  editorial density the logistic model gets 48 percent of its teaching predictions right and finds
  48 percent of the printed digits. A teaching-only model is no better (AUC 0.686). The mean
  predicted probability does track each piece's density (library: 22.8 predicted versus 21.7
  actual), so the model knows *how much* an edition prints, not *where*.
* **The spec's context list scores below chance as a predictor of editorial printing** (AUC
  0.44 overall, 0.48 teaching) and would print 60 percent of all notes (52 percent on teaching
  parts, 45 percent on the library pieces). The culprit is the chord-outer clause: it fires on
  39 percent of all notes, which print at only 11.5 percent (left-hand chord notes at 5.2). Without
  it the list is at chance (AUC 0.51) and prints 32 percent.
* **On right-hand single notes the list is roughly right**: predicted density 28.5 versus 29.6
  actual, and every clause raises the print rate (a rest of a beat: 45 versus 29 percent; a run
  start: 39 versus 29; a leap of a fourth or more: 32 versus 29, and 47 versus 38 in teaching
  music). In the left hand leaps print *less* than other notes (17.8 versus 24.6), and chord
  notes are mostly unprinted whatever the context: the negative pooled `leap_abs` and
  `chord_size` coefficients are a left-hand and chord effect.
* **The strongest single predictors are structural, not contextual**: right hand (+0.36 per
  SD), chord size (-0.63), repeated pitch (-0.24), downbeat (+0.18). None of the spec's phrase
  cues (rest, long note, run start) has a standardised coefficient above 0.14.

## 7. Recommendations

### 7.1 The validated player model

The reader specified for the engine is that of section 5.1 (`research/readability/player_model.py`
is the reference implementation), with one addition (R5) and one option (the textbook patterns):

1. **R0** a printed digit is taken as printed and becomes the position anchor `ref`.
2. **R1** repeated pitch (single note): same finger as the previous event. Measured: 54 percent
   agreement at marked places in teaching music (editors mark repeats when the finger changes),
   right by construction on the 86 percent of repeated notes editors leave unmarked.
3. **R2** step of one or two semitones (single note): previous finger plus or minus one, moving
   away from the thumb with the pitch for the right hand and the mirror for the left; if that
   leaves 1..5, fall through. Measured: 81 percent agreement (teaching), the reader's best rule.
4. **R3** otherwise (single note): `ref.finger + s * steps(ref.pitch, q)` with
   `steps = round_half_away_from_zero(semitones / 2)`; outside 1..5 the reader gives up.
   Measured: 64 percent (teaching); the white-key-column variant is worse (sensitivity row).
5. **R4** chords: from the nearest printed chord note by `steps`; without one, every note from
   `ref`; duplicate fingers or values outside 1..5 give up. Measured: 78 percent from a printed
   chord note, 61 percent from `ref`; inner voices inferable 94 percent of the time.
6. **R5 repeat memory, last resort**: if R1-R4 give up or the engine's complete fingering
   disagrees with them, and the event is a later occurrence of a repeated segment (same hand,
   same intervals and rhythm, at least four events, exact or transposed; `repeats.find_repeats`),
   the reader remembers the finger used at the corresponding note of the first statement.
   Requires the engine to finger repeats identically (literature P11 is already planned). Saves
   six density points on complete fingerings and matches what editors do (section 4).
7. **Optional: textbook patterns before R1** (`textbook.py`): plus two points of reconstruction,
   minus one point of density; low priority.
8. Inferred fingers update `prev`, never `ref`; grace notes are ordinary notes; the reader is
   forward-only. A look-ahead to the next printed digit was not tested and is the obvious next
   improvement (coverage halves when the last digit is 17 or more events back).

### 7.2 The reduction rules

Keep the mechanism, drop the context list as a printing trigger (the spec's section 3.6 now says so):

* **Keep**: "keep a digit only where the player model cannot infer it", implemented as the
  greedy forward pass of `reduce.py` (every kept digit is necessary given the earlier ones, and
  reconstruction is 100 percent by construction). This already prints the first note of each
  hand (nothing precedes it), every leap out of the position, every crossing the reader would not
  make, every position choice the reader would make differently, and every finger change on a
  repeated note. It does not need the context clauses to do so.
* **Drop as triggers**: "after a rest", "after a long note", "on wide leaps", "on chord outer
  voices", "at a crossing", "after a position change". As a predictor of editorial printing the
  list scores below chance (AUC 0.44) and would print 60 percent of all notes (52 on teaching
  parts, 45 on the library pieces) against the editors' 19 to 32; the chord-outer clause alone
  fires on 39 percent of notes that print at 11.5 percent. Editors do not re-finger after every
  rest (36 versus 32 percent base rate in teaching editions), and a reader does not need them to:
  a rest does not change the hand's position. Leaps and crossings are covered by the mechanism
  where they matter (a sixth or more is kept 92 to 100 percent of the time by the reader itself).
* **Chords**: print one digit per chord, the note the position anchors on (usually the thumb
  side), and let R4 fill the rest; print more only where R4 fails. Both outer voices by rule is
  wrong: inner and outer voices are inferred at 69 to 78 percent, and editors print inner voices
  at 17 percent and outer at 22 to 25 (teaching).
* **Add**: a repeat rule, R5 above, on the reduction side (do not re-print on a later
  occurrence of a repeated segment when the first statement's finger applies) and on the engine
  side (finger repeats identically). Editors re-print 37 to 52 percent of the time with the same
  digit 87 to 93 percent of the time on exact repeats; the forward reader with R5 needs 33
  percent instead of 39 on complete fingerings. Transposed sequences should still be re-printed
  (editors do, 58 to 72 percent, with changed digits 30 to 44 percent of the time).
* **Keep "where the engine's confidence is low"** as a separate, additive trigger; it is not
  measurable on editorial data and this study says nothing about it.
* **Add a verification check**: on the Mutopia teaching parts and the eight library pieces the
  engine's reduced density must be at or below the editor's density on the same piece
  (`reduction_by_part.csv` gives the editor's printed and necessary digits per part), and the
  reduction's reconstruction must be 100 percent on the engine's own complete fingering.

### 7.3 Density targets per level

Measured editorial densities (section 3.1) and what the reader needs (section 5.5), in percent
of notes:

| Material | Editorial density: note-weighted | part median | IQR / range | Necessary for the forward reader (+ repeat memory) |
|---|---|---|---|---|
| teaching repertoire, all 203 parts | 32.3 | 35.4 | 24.2-53.3 | 43 (34) % of what the editor printed |
| teaching without Clementi's lessons (132 parts) | 25.4 | 30.3 | 22.0-38.5 | |
| Burgmüller Op. 100 (19 parts) | 12.0 | 16.6 | 1.8-40.8 | |
| Czerny Op. 821, 840 (28 parts) | 23.1 | 24.1 | 9.8-52.4 | |
| Diabelli duets and sonatinas (80 parts) | 34.1 | 35.1 | 17.0-78.3 | |
| Mozart K545 (3 movements, Mutopia parts) | 27.3 | 28.9 | 22.2-32.5 (i 28.9, ii 22.2, iii 32.5) | |
| complete fingerings (15 fully fingered parts) | 94.0 | | | 38.9 (32.8) % of notes |
| library level 2 (Burgmüller 100/1, Schumann 68/1) | 14.7 | 14.8 | 10.5-19.1 | |
| library level 3 (Burgmüller 100/2, 3, 5) | 14.3 | 14.6 | 9.2-20.5 | |
| library level 4 (K545 i) | 29.3 | | | |
| library level 5 (Moonlight i, Chopin 69/2) | 21.7 | 21.1 | 17.6-24.7 | |
| concert (Chopin, Liszt, Rachmaninoff) | 20.7 | 17.8 | 9.3-41.8 | |

Targets for the "Be easy to read" row of the verification spec (printed-digit density after the
reduction of 7.2, per library level; inferability stays 100 percent by construction):

| Level | Floor (never worse) | Target | Editor level (stretch) | Basis |
|---|---|---|---|---|
| 1-2 (five-finger pieces) | 30 | 20 | 15 | editors print 10 to 19 percent on level-2 pieces (median 15); a five-finger position needs one digit per position for this reader |
| 3 | 35 | 25 | 15 | editors 9 to 21 percent (median 15) on Burgmüller; the reader needs more where positions change inside runs |
| 4-5 | 40 | 30 | 25 | editors 18 to 29 percent (K545 29, Moonlight 25, Chopin waltz 18); a complete fingering of exercise material needs 33 percent with repeat memory, 39 without |
| all levels, relative check | at or below the editor's density on the same piece | at or below 0.8 times | at or below 0.5 times | editors print 2.3 to 2.9 times what this reader needs (section 5.5) |

A single row of floor 40, target 30 and editor level about 20 is therefore right for
levels 4 and 5 and too loose for levels 1 to 3, where editors print half as much. The "about 20"
editor level is confirmed for pieces (library median 18, Burgmüller 12 to 17, Czerny 23) but not
for exercise collections (Diabelli 34, Clementi 49), which the app does not ship.

## 8. Limitations

* **Selection bias.** Editors finger what they consider hard or non-obvious, and they finger
  exercise collections more densely than pieces (Clementi's lessons: median 65 percent, 14 parts
  at 90 percent or more; Burgmüller: 12 percent). The print rates by context therefore measure
  editorial attention, not the reader's need; the hide-and-infer protocol of section 5 is the
  measurement that does not depend on it.
* **Staff is not always hand.** The Mutopia converter assigns the upper staff to the right hand
  (as PIG's authors did); in virtuoso scores and reductions (Liszt, Verdi, Mozart K379,
  Rachmaninoff) a staff sometimes holds the other hand's notes. Those parts are mostly in the
  "other" and "concert" groups and have few digits; the teaching group is clean (validator error
  rates in `docs/research/datasets.md` section 4.2).
* **Typesetters.** Some Mutopia contributors add fingerings of their own or transcribe one
  specific edition; the corpus is "published editions as typeset by volunteers", single editor
  per part, and 220 of 286 parts have no `\tempo`, so seconds are at quarter = 100.
* **Chord fingerings written after a chord** were mapped by the converter only when exactly one
  anatomically monotone order fits; 646 ambiguous marks were dropped (datasets report), which
  lowers chord print rates slightly.
* **Coverage of levels.** "Teaching" is dominated by Diabelli duets (80 parts; the secondo parts
  are accompaniments) and Clementi (71); Kuhlau has two parts and 72 digits; there is no level-1
  material in Mutopia at all. The library pieces are the app's own levels 2-5 but seven of the
  eight are the same engravings as their Mutopia parts.
* **Anchor model.** The half-column ambiguity of black keys in the x14/2 anchor means 22-26
  percent of adjacent printed pairs show a "0.5" change that is not a shift; the position-change
  rate is reported with changes of at least one column only.
* **The player model is forward-only** (it uses the previous digit, not the next one); a human
  reader also looks ahead. Its accuracy is therefore a lower bound on what a reader can do with
  the same digits.

## 9. Files

| Path | Content |
|---|---|
| `research/readability/README.md` | pipeline and conventions |
| `research/readability/corpus.py`, `musicxml.py`, `keyboard.py`, `features.py`, `enrich_mutopia.py`, `build_features.py` | data model, loaders, beat recovery, per-note features |
| `research/readability/stats.py` | sections 2 and 3 (`results/density.json`, `print_rate_by_context.csv`, `printed_contexts.json`) |
| `research/readability/repeats.py` | section 4 (`results/repeats.json`) |
| `research/readability/player_model.py`, `textbook.py`, `eval_player.py` | section 5 (`results/player_model.json`, `player_model_by_context.csv`, `player_model_by_rule.csv`) |
| `research/readability/reduce.py` | the minimal-sufficient reduction applied to editorial digits, with the repeat-memory variant (`results/reduction.json`, `reduction_by_part.csv`) |
| `research/readability/predictor.py` | section 6 (`results/predictor.json`, `predictor_coefficients.csv`, `predictor_tree.txt`, `predictor_library.csv`) |
| `research/readability/report_tables.py`, `run_all.py` | every table in this report, generated from the results files; end-to-end run (about one minute) |
| `research/readability/tests/` | unit tests (`test_keyboard`, `test_features`, `test_musicxml`, `test_corpus`, `test_stats`, `test_player_model`, `test_textbook`, `test_reduce`, `test_repeats`, `test_predictor`) |
| `research/readability/requirements.txt`, `research/.venv-readability/` (gitignored) | pinned environment: numpy 2.4.6, scipy 1.17.1, scikit-learn 1.8.0, python-ly 0.9.10, pytest 9.1.1 |
| `research/data/readability/` (gitignored) | `mutopia_beats/*.json`, `features.csv` |

## 10. Sources

* The Mutopia Project, https://www.mutopiaproject.org/ (editions are public domain, CC BY or
  CC BY-SA; per-part licence and Mutopia id in `research/data/mutopia_fingering/manifest.json`;
  attribution for the five CC BY-SA library engravings is in `content/manifest.json`).
* E. Nakamura, Y. Saito, K. Yoshii, "Statistical learning and estimation of piano fingering",
  Information Sciences 517 (2020), https://doi.org/10.1016/j.ins.2019.12.068; PIG format and
  dataset https://beam.kisarazu.ac.jp/~saito/research/PianoFingeringDataset/.
* R. Parncutt, J. A. Sloboda, E. F. Clarke, M. Raekallio, P. Desain, "An ergonomic model of
  keyboard fingering for melodic fragments", Music Perception 14 (1997),
  https://doi.org/10.2307/40285730 (next-note-next-finger, position changes at rests and phrase
  ends; E. Clarke et al., "Talking fingers", 1997, summarised there).
* M. Balliauw, D. Herremans, D. Palhazi Cuervo, K. Sörensen, "A variable neighborhood search
  algorithm to generate piano fingerings for polyphonic sheet music", International Transactions
  in Operational Research 24 (2017), https://doi.org/10.1111/itor.12211 (14-unit keyboard).
* Faber Piano Adventures (five-finger positions in primer and level 1 books),
  https://pianoadventures.com/; Alfred's Pentascale Pro, https://www.alfred.com/.
* Textbook scale and arpeggio fingerings: `benchmarks/textbook/*.json` and
  `docs/research/textbook-oracle.md` (sources cited per entry, e.g. https://www.pianoscales.org/).
* F. Pedregosa et al., "Scikit-learn: Machine learning in Python", JMLR 12 (2011),
  https://scikit-learn.org/ (logistic regression, decision tree, cross-validation).
* Internal: `docs/superpowers/specs/2026-10-13-verification-design.md` (section 3.6),
  `docs/research/literature.md` (sections 4.1-4.3, 6.6), `docs/research/datasets.md` (section
  4), `docs/research/content-library.md` ("Editorial fingering").
