# Batch 02a

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

## Passages (7)

```
PASSAGE it-5a8b
Composer: Bach (prelude). Meter: 4/4. Tempo: quarter = 60 (estimated). Bars 29-32.
Review: LH fingering (column f). RH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH (context)
R1     29  1.5   s     G3              -
R2     29  1.75  s     C4              -
R3     29  2     s     G4              -
R4     29  2.25  s     G3              -
R5     29  2.5   s     C4              -
R6     29  2.75  s     G4              -
-      29  3     e     rest            -
R7     29  3.5   s     G3              -
R8     29  3.75  s     C4              -
R9     29  4     s     G4              -
R10    29  4.25  s     G3              -
R11    29  4.5   s     C4              -
R12    29  4.75  s     G4              -
-      30  1     e     rest            -
R13    30  1.5   s     G3              -
R14    30  1.75  s     C4              -
R15    30  2     s     F4              -
R16    30  2.25  s     G3              -
R17    30  2.5   s     C4              -
R18    30  2.75  s     F4              -
-      30  3     e     rest            -
R19    30  3.5   s     G3              -
R20    30  3.75  s     C4              -
R21    30  4     s     F4              -
R22    30  4.25  s     G3              -
R23    30  4.5   s     C4              -
R24    30  4.75  s     F4              -
-      31  1     e     rest            -
R25    31  1.5   s     G3              -
R26    31  1.75  s     B3              -
R27    31  2     s     F4              -
R28    31  2.25  s     G3              -
R29    31  2.5   s     B3              -
R30    31  2.75  s     F4              -
-      31  3     e     rest            -
R31    31  3.5   s     G3              -
R32    31  3.75  s     B3              -
R33    31  4     s     F4              -
R34    31  4.25  s     G3              -
R35    31  4.5   s     B3              -
R36    31  4.75  s     F4              -
-      32  1     e     rest            -
R37    32  1.5   s     G3              -
R38    32  1.75  s     Bb3             -
R39    32  2     s     E4              -
R40    32  2.25  s     G3              -
R41    32  2.5   s     Bb3             -
R42    32  2.75  s     E4              -
-      32  3     e     rest            -
R43    32  3.5   s     G3              -
R44    32  3.75  s     Bb3             -
R45    32  4     s     E4              -
R46    32  4.25  s     G3              -
R47    32  4.5   s     Bb3             -
R48    32  4.75  s     E4              -
LH
L1     29  1     h     G2              5
L2     29  1.25  1.75q E3              1
L3     29  3     h     G2              5
L4     29  3.25  1.75q E3              1
L5     30  1     h     G2              5
L6     30  1.25  1.75q D3              1
L7     30  3     h     G2              5
L8     30  3.25  1.75q D3              1
L9     31  1     h     G2              5
L10    31  1.25  1.75q D3              1
L11    31  3     h     G2              4
L12    31  3.25  1.75q D3              1
L13    32  1     h     C2              5
L14    32  1.25  1.75q C3              1
L15    32  3     h     C2              5
L16    32  3.25  1.75q C3              1
```

```
PASSAGE it-2415
Composer: Bach (two-part invention). Meter: 4/4. Tempo: quarter = 80 (estimated). Bars 6-7.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1     6   1     s     G4              3
R2     6   1.25  s     B4              5
R3     6   1.5   s     A4              1
R4     6   1.75  s     C5              2
R5     6   2     s     B4              1
R6     6   2.25  s     D5              3
R7     6   2.5   s     C5              2
R8     6   2.75  s     E5              4
R9     6   3     s     D5              3
R10    6   3.25  t     B4              1
R11    6   3.375 t     C5              2
R12    6   3.5   s     D5              3
R13    6   3.75  s     G5              5
R14    6   4     e     B4              1
R15    6   4.5   s     A4              2
R16    6   4.75  s     G4              1
R17    7   1     e     G4              1
-      7   1.5   1.75q rest            -
R18    7   3.25  s     G4              1
R19    7   3.5   s     A4              2
R20    7   3.75  s     B4              4
R21    7   4     s     C5              5
R22    7   4.25  s     A4              3
R23    7   4.5   s     B4              4
R24    7   4.75  s     G4              2
LH (context)
L1     6   1     e     E3              -
L2     6   1.5   e     F#3             -
L3     6   2     e     G3              -
L4     6   2.5   e     E3              -
L5     6   3     e.    B2              -
L6     6   3.75  s     C3              -
L7     6   4     e     D3              -
L8     6   4.5   e     D2              -
L9     7   1.25  s     G2              -
L10    7   1.5   s     A2              -
L11    7   1.75  s     B2              -
L12    7   2     s     C3              -
L13    7   2.25  s     A2              -
L14    7   2.5   s     B2              -
L15    7   2.75  s     G2              -
L16    7   3     e     D3              -
L17    7   3.5   e     G3              -
L18    7   4     e     F#3             -
L19    7   4.5   e     G3              -
```

```
PASSAGE it-91ce
Composer: Joplin (rag). Meter: 2/4. Tempo: quarter = 72 (estimated). Bars 78-79.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1-2   78  1     e     E4+G4           1+3
R3-4   78  1.5   s     Eb4+F#4         1+2
R5-6   78  1.75  e     E4+G4           1+3
R7-8   78  2.25  s     Eb4+F#4         1+2
R9-10  78  2.5   e     E4+G4           1+3
R11    79  1.25  s     C5              3
R12-13 79  1.5   s     G4+E5           1+5
R14    79  1.75  s     C5              2
R15    79  2     s     D5              3
R16    79  2.25  s     E5              4
R17    79  2.5   s     D5              3
R18    79  2.75  s     C5              2
LH (context)
L1     78  1     e     C3              -
L2-4   78  1.5   e     E3+G3+C4        -
L5     78  2     e     G2              -
L6-8   78  2.5   e     E3+G3+C4        -
L9     79  1     e     C3              -
L10-12 79  1.5   e     E3+G3+C4        -
L13    79  2     e     G2              -
L14-16 79  2.5   e     E3+G3+C4        -
```

```
PASSAGE it-b69f
Composer: Clementi (sonatina, first movement). Meter: 2/2. Tempo: quarter = 132 (estimated). Bars 23-28.
Review: LH fingering (column f). RH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH (context)
R1-2   23  1     q     B4+G5           -
-      23  1.5   h.    rest            -
R3     24  1     q     C4              -
R4     24  1.5   e     E4              -
R5     24  1.75  e     C4              -
R6     24  2     q     G3              -
R7     24  2.5   q     G3              -
R8     25  1     q     C4              -
R9     25  1.5   e     E4              -
R10    25  1.75  e     C4              -
R11    25  2     q     G3              -
R12    25  2.5   q     G4              -
R13    26  1     e     F4              -
R14    26  1.25  e     E4              -
R15    26  1.5   e     D4              -
R16    26  1.75  e     C4              -
R17    26  2     e     B3              -
R18    26  2.25  e     C4              -
R19    26  2.5   e     B3              -
R20    26  2.75  e     C4              -
R21    27  1     e     D4              -
R22    27  1.25  e     C4              -
R23    27  1.5   e     B3              -
R24    27  1.75  e     A3              -
R25    27  2     q     G3              -
-      27  2.5   q     rest            -
R26    28  1     q     C4              -
R27    28  1.5   e     G3              -
R28    28  1.75  e     C4              -
R29    28  2     q     E4              -
R30    28  2.5   q     E4              -
LH
L1     23  1     q     G3              1
L2     23  1.5   q     G2              5
L3     23  2     e     G3              1
L4     23  2.25  e     F3              2
L5     23  2.5   e     E3              3
L6     23  2.75  e     D3              4
L7     24  1     q     C3              5
-      24  1.5   h.    rest            -
L8     25  1     q     C3              1
-      25  1.5   h.    rest            -
L9     26  1     q     C3              1
-      26  1.5   q     rest            -
L10    26  2     q     C3              1
-      26  2.5   q     rest            -
L11    27  1     q     G2              2
-      27  1.5   q     rest            -
L12    27  2     e     G2              2
L13    27  2.25  e     F2              1
L14    27  2.5   e     E2              3
L15    27  2.75  e     D2              4
L16    28  1     q     C2              5
```

```
PASSAGE it-4b1b
Composer: Schumann (character piece for children). Meter: 6/8. Tempo: quarter = 152 (estimated). Bars 13-15.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1-3   13  1     e     C4+F4+A4        1+3+5
-      13  1.333 q     rest            -
R4-6   13  2     e     C4+F4+A4        1+3+5
-      13  2.333 q     rest            -
R7-8   14  1     q     F4+A4           2+4
R9-10  14  1.667 e     F4+A4           1+3
R11-12 14  2     e     F4+A4           1+3
-      14  2.333 q     rest            -
R13-15 15  1     q     E4+G4+C5        1+2+5
R16-18 15  1.667 e     E4+G4+C5        1+2+5
R19-21 15  2     e     E4+G4+C5        1+2+5
LH (context)
L1     13  1     e     F3              -
L2     13  1.333 e     C3              -
L3     13  1.667 e     F3              -
L4     13  2     e     A3              -
L5     13  2.333 e     F3              -
L6     13  2.667 e     A3              -
L7     14  1     e     C4              -
L8     14  1.333 e     A3              -
L9     14  1.667 e     D4              -
L10    14  2     e     C4              -
L11    14  2.333 e     A3              -
L12    14  2.667 e     F3              -
L13    15  1     e     G3              -
L14    15  1.333 e     E3              -
L15    15  1.667 e     A3              -
L16    15  2     e     G3              -
L17    15  2.333 e     E3              -
L18    15  2.667 e     C3              -
```

```
PASSAGE it-4972
Composer: Joplin (rag). Meter: 2/4. Tempo: quarter = 72 (estimated). Bars 86-87.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1-2   86  1     e     E4+G4           1+3
R3-4   86  1.5   s     Eb4+F#4         1+2
R5-6   86  1.75  e     E4+G4           1+3
R7-8   86  2.25  s     Eb4+F#4         1+2
R9-10  86  2.5   e     E4+G4           1+3
R11    87  1.25  s     C5              3
R12-13 87  1.5   s     G4+E5           1+5
R14    87  1.75  s     C5              3
R15    87  2     s     D5              4
R16    87  2.25  s     E5              5
R17    87  2.5   s     D5              4
R18    87  2.75  s     C5              3
LH (context)
L1     86  1     e     C3              -
L2-4   86  1.5   e     E3+G3+C4        -
L5     86  2     e     G2              -
L6-8   86  2.5   e     E3+G3+C4        -
L9     87  1     e     C3              -
L10-12 87  1.5   e     E3+G3+C4        -
L13    87  2     e     G2              -
L14-16 87  2.5   e     E3+G3+C4        -
```

```
PASSAGE it-a84f
Composer: Traditional (children's song, arranged). Meter: 4/4. Tempo: quarter = 100 (estimated). Bars 8-12.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1     8   1     q     E4              3
R2     8   2     q     E4              3
R3     8   3     h     D4              2
R4     9   1     q     C4              1
R5     9   2     q     C4              1
R6     9   3     q     G4              3
R7     9   4     q     G4              3
R8     10  1     q     A4              4
R9     10  2     q     A4              4
R10    10  3     h     G4              3
R11    11  1     q     F4              2
R12    11  2     q     F4              2
R13    11  3     q     E4              1
R14    11  4     q     E4              1
R15    12  1     q     D4              2
R16    12  2     q     D4              2
R17    12  3     h     C4              1
LH (context)
L1     8   1     h     C3              -
L2     8   3     h     G3              -
L3     9   1     w     C3              -
L4     10  1     h     F3              -
L5     10  3     h     C3              -
L6     11  1     h     F3              -
L7     11  3     h     C3              -
L8     12  1     h     G3              -
L9     12  3     h     C3              -
```

Output file: research/data/teacher_review/weekly/2026-10-14/out/batch-02a.json
