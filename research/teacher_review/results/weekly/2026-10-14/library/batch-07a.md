# Batch 07a

You are an experienced piano teacher. A colleague has sent you a batch of short passages with
proposed fingerings and asks for your honest, specific review before the fingerings go into a
student edition. Work through the passages in order. For each one, first read the notes and the
rhythm, then check the fingering note by note against the criteria in the brief, in the order
they are listed there (possible, idiomatic, economical, consistent, beginner-friendly), then
score and write your objections.

# Fingering review brief

You are reviewing piano fingerings as an experienced piano teacher would, for a student of
beginning-to-intermediate level with a medium-sized adult hand (an octave is comfortable, a ninth
is a stretch, a tenth is out of reach). You will see short passages (two to eight bars) in a
compact text notation, each with a candidate fingering for one or both hands. The fingerings
come from different sources: some were written by expert pianists, some by a computer program,
and some contain deliberately planted mistakes. You are not told which is which, and you should
not try to guess. Judge every passage on its own merits.

## What you must do for every passage

1. Read the passage back. For each reviewed hand, write the fingers in note order (chord notes
   low to high) as a space-separated digit string. This is a reading check; copy exactly.
2. Score five criteria from 0 to 3 (integers):
   - `possible`: physically possible. Hard rules: no two simultaneous notes on one finger (except
     the thumb on two adjacent white keys), chord fingers in pitch order, spans within what a
     medium hand can hold (3-4 or 4-5 no wider than a third, 2-3 a fourth, 2-5 or 1-5 an octave
     to a ninth), no finger re-used on a new key while it still holds another.
     3 = nothing impossible; 2 = one spot that is awkward but playable; 1 = one impossible spot;
     0 = several impossible spots.
   - `idiomatic`: standard scale and arpeggio fingerings where the music is a scale or arpeggio,
     only legal crossings (thumb under 2, 3 or 4, and 2, 3 or 4 over the thumb; never a long
     finger over another long finger), standard chord shapes (right hand root-position triads
     1-3-5, first inversion 1-2-5; left hand 5-3-1 and 5-2-1).
     3 = idiomatic throughout; 2 = one odd choice; 1 = several; 0 = unidiomatic throughout.
   - `economical`: as few position changes as the music allows, shifts placed at rests, long
     notes or phrase ends, no hops (same finger on two consecutive different keys with no rest
     between), no needless stretches.
     3 = economical; 2 = one avoidable shift, hop or stretch; 1 = several; 0 = restless.
   - `consistent`: identical or sequentially repeated figures get the same fingering.
     3 = consistent (or no repeats present); 2 = one inconsistency; 1 = several; 0 = chaotic.
   - `beginner_friendly`: thumb and fifth finger stay off black keys where a white-key finger is
     available, no thumb passing onto a black key, no 3-4-5 runs where 1-2-3 or 2-3-4 would do,
     no spans beyond a comfortable octave, no finger substitutions.
     3 = a student could use it as is; 2 = one or two edits; 1 = several spots need rework;
     0 = unsuitable for a student.
3. Give an overall verdict: `good` (hand it to the student as is), `acceptable` (one or two
   small edits), `flawed` (needs rework), `unplayable` (contains something physically impossible
   at tempo).
4. List specific objections. Each objection names the note ids it concerns (from the passage),
   a kind from the vocabulary below, a severity, a problem statement of at most 25 words, and a
   proposed fix as a mapping from note id to finger. Only raise objections you would defend to a
   colleague; an empty list is a perfectly good answer when the fingering is sound. Do not invent
   notes that are not in the passage. Do not object to the music itself, only to the fingering.
   Severity: `error` = physically impossible or a hard rule above; `warning` = playable but
   ergonomically poor; `info` = a matter of preference.
5. Add one or two sentences of overall comment (optional).

Objection kinds: `same_finger_chord`, `crossed_chord`, `impossible_span`, `nonthumb_crossing`,
`thumb_pass_onto_black`, `hop`, `reversed_run`, `thumb_on_black`, `fifth_on_black`, `stretch`,
`position_change`, `inconsistent`, `weak_finger`, `repeated_note`, `nonstandard_pattern`, `other`.

## Output

Return one JSON document with this shape and nothing else (no prose outside the JSON):

```json
{
  "batch": "<batch id from the input file>",
  "started_at": "<ISO-8601 UTC timestamp taken before you read the passages>",
  "finished_at": "<ISO-8601 UTC timestamp taken after you wrote the last item>",
  "items": [
    {
      "item": "<passage id>",
      "readback": {"R": "1 2 3 1 2 3 4 5", "L": "5 4 3 2 1"},
      "scores": {"possible": 3, "idiomatic": 2, "economical": 2, "consistent": 3, "beginner_friendly": 2},
      "verdict": "acceptable",
      "objections": [
        {"notes": ["R7", "R8"], "kind": "hop", "severity": "warning",
         "problem": "Finger 3 repeated on G4 then A4 at sixteenth-note speed with no rest.",
         "fix": {"R7": 2, "R8": 3}}
      ],
      "comment": "Mostly standard; the shift in bar 3 could wait for the rest."
    }
  ]
}
```

Include `readback` only for the hands whose fingering you were asked to review. Every item in the
input file must appear exactly once in `items`, in the same order.

## Notation

How to read a passage block
- One line per note, chord or rest; both hands in separate sections, each in time order.
- id = hand letter + note number (R1, R2, ... for the right hand; L1, L2, ... for the left). A chord
  shows a range (R3-5): its pitches are listed low to high and its fingers in the same order (1+3+5).
  Rests have no id. Refer to notes by these ids.
- bar / beat: bar number and beat within the bar, 1-based; 2.5 means half-way through beat 2. The beat
  is a quarter note in x/4 meters, a half note in 2/2 and 3/2, a dotted quarter in 6/8, 9/8 and 12/8,
  an eighth in 3/8. Bar 0 is an upbeat (pickup) bar.
- dur: w h q e s t = whole, half, quarter, eighth, 16th, 32nd; a trailing dot = dotted (q. = dotted
  quarter); e3 = triplet eighth; gr = grace note, played just before the note that follows it; otherwise
  a multiple of a quarter (2.5q). A chord's dur is its longest note. dur is the sounding length in the
  source; pianists release early or use the pedal, so a finger may be re-used after a long note unless
  the notes are slurred. Rest lines mark gaps of an eighth or longer in that hand.
- pitch: scientific pitch names, C4 = middle C, sharps except Eb and Bb. Black keys: C# Eb F# G# Bb.
- f: finger, 1 = thumb ... 5 = little finger, for both hands. "-" = no fingering given for that note.
- Tempo is given in quarter notes per minute and is approximate in every passage. In some passages the
  bar numbers were estimated from a recording and may be off by a bar; the order, the rhythm and the
  pitches are exact.

## Passages (6)

```
PASSAGE it-c56b
Composer: Schumann (character piece for children). Meter: 6/8. Tempo: quarter = 152 (estimated). Bars 19-24.
Review: LH fingering (column f). RH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH (context)
R1     19  1     e     B4              -
R2     19  1.333 e     G#4             -
R3     19  1.667 e     C5              -
R4     19  2     e     B4              -
R5     19  2.333 e     G#4             -
R6     19  2.667 e     E4              -
R7     20  1     e     A4              -
R8     20  1.333 e     E4              -
R9     20  1.667 e     C5              -
R10    20  2     e     B4              -
-      20  2.333 e     rest            -
R11    20  2.667 e     E4              -
R12    21  1     e     A4              -
R13    21  1.333 e     E4              -
R14    21  1.667 e     A4              -
R15    21  2     e     C5              -
R16    21  2.333 e     A4              -
R17    21  2.667 e     C5              -
R18    22  1     e     E5              -
R19    22  1.333 e     C5              -
R20    22  1.667 e     F5              -
R21    22  2     e     E5              -
R22    22  2.333 e     C5              -
R23    22  2.667 e     A4              -
R24    23  1     e     B4              -
R25    23  1.333 e     G#4             -
R26    23  1.667 e     C5              -
R27    23  2     e     B4              -
R28    23  2.333 e     G#4             -
R29    23  2.667 e     E4              -
R30    24  1     e     A4              -
R31    24  1.333 e     E4              -
R32    24  1.667 e     G#4             -
R33    24  2     e     A4              -
LH
L1-3   19  1     q     E3+G#3+B3       5+2+1
L4-6   19  1.667 e     E3+A3+C4        5+2+1
L7-9   19  2     e     E3+G#3+B3       5+2+1
-      19  2.333 q     rest            -
L10-11 20  1     e     A3+C4           3+1
-      20  1.333 e     rest            -
L12-13 20  1.667 e     A3+C4           2+1
L14-16 20  2     e     E3+G#3+B3       5+2+1
-      20  2.333 q     rest            -
L17-18 21  1     e     A3+C4           3+1
-      21  1.333 q     rest            -
L19-21 21  2     e     A3+C4+E4        5+5+1
-      21  2.333 q     rest            -
L22-24 22  1     q     A3+C4+E4        5+3+1
L25-27 22  1.667 e     A3+D4+F4        5+2+1
L28-30 22  2     e     A3+C4+E4        4+2+1
-      22  2.333 q     rest            -
L31-33 23  1     q     E3+G#3+B3       5+2+1
L34-36 23  1.667 e     E3+A3+C4        4+3+2
L37-39 23  2     e     E3+G#3+B3       5+2+1
-      23  2.333 q     rest            -
L40-41 24  1     e     A3+C4           2+1
-      24  1.333 e     rest            -
L42-43 24  1.667 e     E3+B3           5+1
L44-45 24  2     e     A3+C4           3+1
```

```
PASSAGE it-32ec
Composer: unknown (piano piece). Meter: 4/4. Tempo: quarter = 104 (estimated). Bars 1-5.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1     1   1     q     Bb4             3
R2     1   2     q     G#4             2
R3     1   3     q     F#4             1
R4     1   4     q     G#4             2
R5     2   1     q     Bb4             3
R6     2   2     q     Bb4             3
R7     2   3     h     Bb4             3
R8     3   1     q     G#4             2
R9     3   2     q     G#4             2
R10    3   3     h     G#4             2
R11    4   1     q     Bb4             3
R12    4   2     q     C#5             5
R13    4   3     h     C#5             5
R14    5   1     q     Bb4             3
R15    5   2     q     G#4             2
R16    5   3     q     F#4             1
R17    5   4     q     G#4             2
LH (context)
L1     1   1     w     F#3             -
L2     2   1     w     Bb3             -
L3     3   1     w     C#4             -
L4     4   1     w     F#3             -
L5     5   1     w     F#3             -
```

```
PASSAGE it-9b42
Composer: unknown (piano piece). Meter: 3/4. Tempo: quarter = 96 (estimated). Bars 1-5.
Review: LH fingering (column f). RH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH (context)
R1     1   1     q     Eb5             -
R2     1   2     q     C#5             -
R3     1   3     q     B4              -
R4     2   1     h.    Bb4             -
R5     3   1     h     G#4             -
R6     3   3     q     Eb5             -
R7     4   1     h     C#5             -
R8     4   3     q     B4              -
R9     5   1     q     Bb4             -
R10    5   2     q     G#4             -
R11    5   3     q     F#4             -
LH
L1-2   1   1     h.    G#3+Eb4         3+1
L3-4   2   1     h.    Eb3+Bb3         5+1
L5-6   3   1     h.    G#3+Eb4         3+1
L7-8   4   1     h.    Eb3+Bb3         5+1
L9-10  5   1     h.    Eb3+Bb3         5+1
```

```
PASSAGE it-a06a
Composer: Beethoven (symphonic theme, simplified). Meter: 4/4. Tempo: quarter = 108 (estimated). Bars 3-9.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1     3   1     q     C4              1
R2     3   2     q     C4              3
R3     3   3     q     D4              2
R4     3   4     q     E4              3
R5     4   1     q.    E4              3
R6     4   2.5   e     D4              2
R7     4   3     h     D4              2
R8     5   1     q     E4              3
R9     5   2     q     E4              3
R10    5   3     q     F4              4
R11    5   4     q     G4              5
R12    6   1     q     G4              5
R13    6   2     q     F4              4
R14    6   3     q     E4              3
R15    6   4     q     D4              2
R16    7   1     q     C4              1
R17    7   2     q     C4              5
R18    7   3     q     D4              4
R19    7   4     q     E4              3
R20    8   1     q.    D4              2
R21    8   2.5   e     C4              1
R22    8   3     h     C4              1
R23    9   1     q     D4              2
R24    9   2     q     D4              2
R25    9   3     q     E4              3
R26    9   4     q     C4              1
LH (context)
L1     3   1     w     C3              -
L2     4   1     w     G3              -
L3     5   1     w     C3              -
L4     6   1     w     G3              -
L5     7   1     w     C3              -
L6     8   1     h     G3              -
L7     8   3     h     C3              -
L8     9   1     h     G3              -
L9     9   3     h     C3              -
```

```
PASSAGE it-1c29
Composer: Burgmüller (study). Meter: 4/4. Tempo: quarter = 152 (estimated). Bars 10-14.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1-2   10  1     w     C5+E5           2+4
R3     11  1     e     F5              5
R4     11  1.5   e     D5              3
R5     11  2     e     C5              2
R6     11  2.5   e     B4              1
R7     11  3     e     F5              5
R8     11  3.5   e     D5              3
R9     11  4     e     C5              2
R10    11  4.5   e     B4              1
R11-12 12  1     w     C5+E5           2+4
R13    13  1     h     G5              5
R14    13  1.5   e     Eb5             3
R15    13  2     e     D5              2
R16    13  2.5   e     C5              1
R17    13  3     h     F#5             5
R18    13  3.5   e     Eb5             3
R19    13  4     e     D5              2
R20    13  4.5   e     C5              1
R21    14  1     e     A5              5
R22    14  1.5   e     G5              4
R23    14  2     e     C5              1
R24    14  2.5   e     D5              2
R25    14  3     e     F5              5
R26    14  3.5   e     E5              4
R27    14  4     e     G4              1
R28    14  4.5   e     A4              2
LH (context)
L1     10  1     e     G3              -
L2     10  1.5   e     A3              -
L3     10  2     e     B3              -
L4     10  2.5   e     C4              -
L5     10  3     e     D4              -
L6     10  3.5   e     C4              -
L7     10  4     e     E4              -
L8     10  4.5   e     C4              -
L9     11  1     e     G3              -
L10    11  1.5   e     B3              -
L11    11  2     e     C4              -
L12    11  2.5   e     D4              -
L13    11  3     e     G3              -
L14    11  3.5   e     B3              -
L15    11  4     e     C4              -
L16    11  4.5   e     D4              -
L17    12  1     e     G3              -
L18    12  1.5   e     A3              -
L19    12  2     e     B3              -
L20    12  2.5   e     C4              -
L21    12  3     e     D4              -
L22    12  3.5   e     C4              -
L23    12  4     e     E4              -
L24    12  4.5   e     C4              -
L25    13  1     h     A3              -
L26-27 13  3     h     A3+C4           -
L28-30 14  1     w     G3+C4+E4        -
```

```
PASSAGE it-5da8
Composer: unknown (piano piece). Meter: 4/4. Tempo: quarter = 60 (estimated). Bars 1-5.
Review: LH fingering (column f). RH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH (context)
R1     1   1.5   s     Bb4             -
R2     1   1.75  s     C#5             -
R3     1   2     s     F#5             -
R4     1   2.25  s     Bb4             -
R5     1   2.5   s     C#5             -
R6     1   2.75  s     F#5             -
-      1   3     e     rest            -
R7     1   3.5   s     Bb4             -
R8     1   3.75  s     C#5             -
R9     1   4     s     F#5             -
R10    1   4.25  s     Bb4             -
R11    1   4.5   s     C#5             -
R12    1   4.75  s     F#5             -
-      2   1     e     rest            -
R13    2   1.5   s     Bb4             -
R14    2   1.75  s     C#5             -
R15    2   2     s     F#5             -
R16    2   2.25  s     Bb4             -
R17    2   2.5   s     C#5             -
R18    2   2.75  s     F#5             -
-      2   3     e     rest            -
R19    2   3.5   s     Bb4             -
R20    2   3.75  s     C#5             -
R21    2   4     s     F#5             -
R22    2   4.25  s     Bb4             -
R23    2   4.5   s     C#5             -
R24    2   4.75  s     F#5             -
-      3   1     e     rest            -
R25    3   1.5   s     G#4             -
R26    3   1.75  s     C5              -
R27    3   2     s     F#5             -
R28    3   2.25  s     G#4             -
R29    3   2.5   s     C5              -
R30    3   2.75  s     F#5             -
-      3   3     e     rest            -
R31    3   3.5   s     G#4             -
R32    3   3.75  s     C5              -
R33    3   4     s     F#5             -
R34    3   4.25  s     G#4             -
R35    3   4.5   s     C5              -
R36    3   4.75  s     F#5             -
-      4   1     e     rest            -
R37    4   1.5   s     G#4             -
R38    4   1.75  s     C#5             -
R39    4   2     s     F5              -
R40    4   2.25  s     G#4             -
R41    4   2.5   s     C#5             -
R42    4   2.75  s     F5              -
-      4   3     e     rest            -
R43    4   3.5   s     G#4             -
R44    4   3.75  s     C#5             -
R45    4   4     s     F5              -
R46    4   4.25  s     G#4             -
R47    4   4.5   s     C#5             -
R48    4   4.75  s     F5              -
-      5   1     e     rest            -
R49    5   1.5   s     Bb4             -
R50    5   1.75  s     C#5             -
R51    5   2     s     G5              -
R52    5   2.25  s     Bb4             -
R53    5   2.5   s     C#5             -
R54    5   2.75  s     G5              -
-      5   3     e     rest            -
R55    5   3.5   s     Bb4             -
R56    5   3.75  s     C#5             -
R57    5   4     s     G5              -
R58    5   4.25  s     Bb4             -
R59    5   4.5   s     C#5             -
R60    5   4.75  s     G5              -
LH
L1     1   1     h     F4              3
L2     1   1.25  1.75q F#4             2
L3     1   3     h     F4              3
L4     1   3.25  1.75q F#4             2
L5     2   1     h     Eb4             4
L6     2   1.25  1.75q F#4             1
L7     2   3     h     Eb4             2
L8     2   3.25  1.75q F#4             1
L9     3   1     h     G#3             5
L10    3   1.25  1.75q Eb4             1
L11    3   3     h     G#3             5
L12    3   3.25  1.75q Eb4             1
L13    4   1     h     C#4             2
L14    4   1.25  1.75q F4              1
L15    4   3     h     C#4             3
L16    4   3.25  1.75q F4              1
L17    5   1     h     C#4             3
L18    5   1.25  1.75q E4              1
L19    5   3     h     C#4             3
L20    5   3.25  1.75q E4              1
```

Output file: research/data/teacher_review/weekly/2026-10-14/out/batch-07a.json
