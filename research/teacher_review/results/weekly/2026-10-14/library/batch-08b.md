# Batch 08b

You teach piano at a conservatory and prepare fingered editions for intermediate students. The
passages below were fingered by various hands and need your verdict before they are printed.
Take each passage in turn. Play it through in your mind at the given tempo with the given
fingers, hand position by hand position; whenever the hand must move, ask whether the move is
necessary and whether it lands on a comfortable position. Start from the student's point of view
(beginner-friendly, consistent, economical), then check idiom and finally the physical hard rules
from the brief. Score, then write your objections; name the notes precisely.

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
PASSAGE it-ed97
Composer: Pierpont (song, arranged). Meter: 4/4. Tempo: quarter = 120 (estimated). Bars 8-14.
Review: LH fingering (column f). RH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH (context)
R1     8   1     h     D4              -
R2     8   3     h     G4              -
R3     9   1     q     E4              -
R4     9   2     q     E4              -
R5     9   3     h     E4              -
R6     10  1     q     E4              -
R7     10  2     q     E4              -
R8     10  3     h     E4              -
R9     11  1     q     E4              -
R10    11  2     q     G4              -
R11    11  3     q.    C4              -
R12    11  4.5   e     D4              -
R13    12  1     w     E4              -
R14    13  1     q     F4              -
R15    13  2     q     F4              -
R16    13  3     q     F4              -
R17    13  4     q     F4              -
R18    14  1     q     F4              -
R19    14  2     q     E4              -
R20    14  3     q     E4              -
R21    14  4     e     E4              -
R22    14  4.5   e     E4              -
LH
L1     8   1     h     G3              1
L2     8   3     h     D3              4
L3     9   1     h     C3              5
L4     9   3     h     G3              1
L5     10  1     h     C3              5
L6     10  3     h     G3              1
L7     11  1     h     C3              5
L8     11  3     h     G3              1
L9     12  1     h     C3              5
L10    12  3     h     G3              1
L11    13  1     h     F3              2
L12    13  3     h     C3              5
L13    14  1     h     C3              5
L14    14  3     h     G3              1
```

```
PASSAGE it-37a5
Composer: Beethoven (symphonic theme, simplified). Meter: 4/4. Tempo: quarter = 108 (estimated). Bars 3-9.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1     3   1     q     C4              1
R2     3   2     q     C4              1
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
R17    7   2     q     C4              1
R18    7   3     q     D4              2
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
PASSAGE it-c7c7
Composer: Burgmüller (study). Meter: 2/4. Tempo: quarter = 152 (estimated). Bars 11-17.
Review: LH fingering (column f). RH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH (context)
R1     11  1     q     C5              -
R2     11  2     e     C6              -
-      11  2.5   e     rest            -
R3     12  1     q.    E5              -
R4     12  2.5   e     B4              -
R5     13  1     q.    C5              -
R6     13  2.5   e     A4              -
R7     14  1     q.    E5              -
R8     14  2.5   e     B4              -
R9     15  1     q.    C5              -
R10    15  2.5   e     A4              -
R11    16  1     q.    A5              -
R12    16  2.5   e     E5              -
R13    17  1     q.    F5              -
R14    17  2.5   e     E5              -
LH
L1-2   11  1     q.    C4+E4           2+1
-      11  2.5   e     rest            -
L3     12  1     s     G#3             4
L4     12  1.25  s     A3              3
L5     12  1.5   s     B3              2
L6     12  1.75  s     A3              3
L7     12  2     e     G#3             5
-      12  2.5   e     rest            -
L8     13  1     s     A3              5
L9     13  1.25  s     B3              4
L10    13  1.5   s     C4              3
L11    13  1.75  s     D4              2
L12    13  2     e     E4              1
-      13  2.5   e     rest            -
L13    14  1     s     G#3             4
L14    14  1.25  s     A3              3
L15    14  1.5   s     B3              2
L16    14  1.75  s     A3              3
L17    14  2     e     G#3             5
-      14  2.5   e     rest            -
L18    15  1     s     A3              5
L19    15  1.25  s     B3              4
L20    15  1.5   s     C4              3
L21    15  1.75  s     D4              2
L22    15  2     e     E4              1
-      15  2.5   e     rest            -
L23    16  1     s     C#4             3
L24    16  1.25  s     D4              2
L25    16  1.5   s     E4              1
L26    16  1.75  s     D4              4
L27    16  2     e     C#4             5
-      16  2.5   e     rest            -
L28    17  1     s     D4              5
L29    17  1.25  s     E4              4
L30    17  1.5   s     F4              3
L31    17  1.75  s     G4              2
L32    17  2     e     A4              1
L33    17  2.5   e     G4              2
```

```
PASSAGE it-b1fe
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
L19-21 21  2     e     A3+C4+E4        5+3+1
-      21  2.333 q     rest            -
L22-24 22  1     q     A3+C4+E4        5+3+1
L25-27 22  1.667 e     A3+D4+F4        5+2+1
L28-30 22  2     e     A3+C4+E4        4+2+1
-      22  2.333 q     rest            -
L31-33 23  1     q     E3+G#3+B3       5+2+1
L34-36 23  1.667 e     E3+A3+C4        5+2+1
L37-39 23  2     e     E3+G#3+B3       5+2+1
-      23  2.333 q     rest            -
L40-41 24  1     e     A3+C4           2+1
-      24  1.333 e     rest            -
L42-43 24  1.667 e     E3+B3           5+1
L44-45 24  2     e     A3+C4           3+1
```

```
PASSAGE it-761d
Composer: Traditional (children's song, arranged). Meter: 4/4. Tempo: quarter = 104 (estimated). Bars 1-5.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1     1   1     q     E4              3
R2     1   2     q     D4              2
R3     1   3     q     C4              1
R4     1   4     q     D4              2
R5     2   1     q     E4              3
R6     2   2     q     E4              3
R7     2   3     h     E4              3
R8     3   1     q     D4              2
R9     3   2     q     D4              2
R10    3   3     h     D4              2
R11    4   1     q     E4              3
R12    4   2     q     G4              5
R13    4   3     h     G4              5
R14    5   1     q     E4              3
R15    5   2     q     D4              2
R16    5   3     q     C4              1
R17    5   4     q     D4              2
LH (context)
L1     1   1     w     C3              -
L2     2   1     w     E3              -
L3     3   1     w     G3              -
L4     4   1     w     C3              -
L5     5   1     w     C3              -
```

```
PASSAGE it-44c8
Composer: Mozart (minuet). Meter: 3/4. Tempo: quarter = 120 (estimated). Bars 13-18.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1     13  1     e     Bb4             3
R2     13  1.5   e     D5              5
R3     13  2     q     G4              1
R4     13  3     q     G4              1
R5     14  1     e     A4              2
R6     14  1.5   e     C5              4
R7     14  2     q     F4              1
R8     14  3     q     F4              1
R9     15  1     e     G4              2
R10    15  1.5   e     Bb4             4
R11    15  2     q     E4              1
R12    15  3     q     E4              1
R13    16  1     h     E4              1
R14    16  3     q     F4              2
R15    17  1     e     F5              2
R16    17  1.5   e     A5              5
R17    17  2     q     C5              1
R18    17  3     q     C5              1
R19    18  1     e     D5              3
R20    18  1.5   e     F5              5
R21    18  2     q     Bb4             1
R22    18  3     q     Bb4             2
LH (context)
L1     13  1     h.    E3              -
L2     14  1     h.    F3              -
L3     15  1     q     Bb3             -
L4     15  2     q     C4              -
L5     15  3     q     C3              -
L6     16  1     q     F3              -
L7     16  2     q     C3              -
L8     16  3     q     F2              -
L9     17  1     h.    A3              -
L10    18  1     h.    Bb3             -
```

Output file: research/data/teacher_review/weekly/2026-10-14/out/batch-08b.json
