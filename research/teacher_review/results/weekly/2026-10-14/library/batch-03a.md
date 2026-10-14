# Batch 03a

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
PASSAGE it-de2e
Composer: Traditional (folk song, arranged). Meter: 6/8. Tempo: quarter = 96 (estimated). Bars 3-9.
Review: LH fingering (column f). RH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH (context)
R1     3   1     q     C5              -
R2     3   1.667 e     A4              -
R3     3   2     e.    A4              -
R4     3   2.5   s     G#4             -
R5     3   2.667 e     A4              -
R6     4   1     q     B4              -
R7     4   1.667 e     G#4             -
R8     4   2     q     E4              -
R9     4   2.667 e     A4              -
R10    5   1     q     C5              -
R11    5   1.667 e     D5              -
R12    5   2     e.    E5              -
R13    5   2.5   s     F5              -
R14    5   2.667 e     E5              -
R15    6   1     q     D5              -
R16    6   1.667 e     B4              -
R17    6   2     e.    G4              -
R18    6   2.5   s     A4              -
R19    6   2.667 e     B4              -
R20    7   1     e.    C5              -
R21    7   1.5   s     B4              -
R22    7   1.667 e     A4              -
R23    7   2     e.    G#4             -
R24    7   2.5   s     F#4             -
R25    7   2.667 e     G#4             -
R26    8   1     h.    A4              -
R27    9   1     q.    G5              -
R28    9   2     e.    G5              -
R29    9   2.5   s     F#5             -
R30    9   2.667 e     E5              -
LH
L1-2   3   1     h.    A2+E3           3+1
L3-4   4   1     h.    E2+B2           5+1
L5-6   5   1     h.    A2+E3           4+1
L7-8   6   1     h.    G2+D3           5+1
L9-10  7   1     q.    A2+E3           3+1
L11-12 7   2     q.    E2+B2           5+1
L13-14 8   1     h.    A2+E3           5+1
L15-16 9   1     h.    C3+G3           3+1
```

```
PASSAGE it-b7ed
Composer: Traditional (round, arranged). Meter: 4/4. Tempo: quarter = 108 (estimated). Bars 5-8.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1     5   1     e     G4              4
R2     5   1.5   e     A4              5
R3     5   2     e     G4              4
R4     5   2.5   e     F4              3
R5     5   3     q     E4              2
R6     5   4     q     C4              1
R7     6   1     e     G4              4
R8     6   1.5   e     A4              5
R9     6   2     e     G4              4
R10    6   2.5   e     F4              3
R11    6   3     q     E4              2
R12    6   4     q     C4              1
R13    7   1     q     C4              2
R14    7   2     q     G3              1
R15    7   3     h     C4              3
R16    8   1     q     C4              3
R17    8   2     q     G3              1
R18    8   3     h     C4              3
LH (context)
L1     5   1     h     C3              -
L2     5   3     h     G3              -
L3     6   1     h     C3              -
L4     6   3     h     G3              -
L5     7   1     w     C3              -
L6     8   1     w     C3              -
```

```
PASSAGE it-407f
Composer: Mozart (sonata, first movement). Meter: 4/4. Tempo: quarter = 132 (estimated). Bars 53-54.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1-2   53  1     q     C5+E5           1+3
-      53  2     h     rest            -
R3-4   53  4     q     C5+E5           3+5
R5     54  1     s     D5              4
R6     54  1.25  s     D4              1
R7     54  1.5   s     E4              2
R8     54  1.75  s     F4              3
R9     54  2     s     G4              1
R10    54  2.25  s     A4              2
R11    54  2.5   s     B4              3
R12    54  2.75  s     C#5             4
R13    54  3     s     D5              5
R14    54  3.25  s     A4              1
R15    54  3.5   s     B4              2
R16    54  3.75  s     C#5             3
R17    54  4     s     D5              1
R18    54  4.25  s     E5              2
R19    54  4.5   s     F5              1
R20    54  4.75  s     G5              2
LH (context)
L1     53  1     e     C3              -
L2     53  1.5   s     D3              -
L3     53  1.75  s     E3              -
L4     53  2     s     F3              -
L5     53  2.25  s     G3              -
L6     53  2.5   s     A3              -
L7     53  2.75  s     B3              -
L8     53  3     s     C4              -
L9     53  3.25  s     B3              -
L10    53  3.5   s     A3              -
L11    53  3.75  s     G3              -
L12    53  4     s     F3              -
L13    53  4.25  s     E3              -
L14    53  4.5   s     D3              -
L15    53  4.75  s     C3              -
L16-17 54  1     w     F3+A3           -
```

```
PASSAGE it-db83
Composer: Bach (two-part invention). Meter: 4/4. Tempo: quarter = 80 (estimated). Bars 2-3.
Review: LH fingering (column f). RH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH (context)
R1     2   1     s     D5              -
R2     2   1.25  s     G4              -
R3     2   1.5   s     A4              -
R4     2   1.75  s     B4              -
R5     2   2     s     C5              -
R6     2   2.25  s     A4              -
R7     2   2.5   s     B4              -
R8     2   2.75  s     G4              -
R9     2   3     e     D5              -
R10    2   3.5   e     G5              -
R11    2   4     e     F5              -
R12    2   4.5   e     G5              -
R13    3   1     s     E5              -
R14    3   1.25  s     A5              -
R15    3   1.5   s     G5              -
R16    3   1.75  s     F5              -
R17    3   2     s     E5              -
R18    3   2.25  s     G5              -
R19    3   2.5   s     F5              -
R20    3   2.75  s     A5              -
R21    3   3     s     G5              -
R22    3   3.25  s     F5              -
R23    3   3.5   s     E5              -
R24    3   3.75  s     D5              -
R25    3   4     s     C5              -
R26    3   4.25  s     E5              -
R27    3   4.5   s     D5              -
R28    3   4.75  s     F5              -
LH
L1     2   1     e     G3              1
L2     2   1.5   e     G2              5
-      2   2     1.25q rest            -
L3     2   3.25  s     G3              5
L4     2   3.5   s     A3              3
L5     2   3.75  s     B3              2
L6     2   4     s     C4              1
L7     2   4.25  s     A3              3
L8     2   4.5   s     B3              2
L9     2   4.75  s     G3              4
L10    3   1     e     C4              1
L11    3   1.5   e     B3              4
L12    3   2     e     C4              3
L13    3   2.5   e     D4              2
L14    3   3     e     E4              1
L15    3   3.5   e     G3              5
L16    3   4     e     A3              3
L17    3   4.5   e     B3              2
```

```
PASSAGE it-f37f
Composer: Hill (song, arranged). Meter: 3/4. Tempo: quarter = 100 (estimated). Bars 2-8.
Review: LH fingering (column f). RH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH (context)
R1     2   1     h     F#4             -
R2     2   3     e.    D4              -
R3     2   3.75  s     D4              -
R4     3   1     q     E4              -
R5     3   2     q     D4              -
R6     3   3     q     A4              -
R7     4   1     h     G4              -
R8     4   3     e.    D4              -
R9     4   3.75  s     D4              -
R10    5   1     q     D5              -
R11    5   2     q     B4              -
R12    5   3     q     G4              -
R13    6   1     q     F#4             -
R14    6   2     q     E4              -
R15    6   3     e.    C5              -
R16    6   3.75  s     C5              -
R17    7   1     q     B4              -
R18    7   2     q     G4              -
R19    7   3     q     A4              -
R20    8   1     h.    G4              -
LH
L1-2   2   1     h.    D3+A3           5+1
L3-4   3   1     h.    D3+A3           4+1
L5-6   4   1     h.    G2+D3           5+1
L7-8   5   1     h.    G2+D3           5+1
L9-10  6   1     h.    C3+G3           3+1
L11-12 7   1     h     G2+D3           5+1
L13-14 7   3     q     D3+A3           4+1
L15-16 8   1     h.    G2+D3           5+1
```

```
PASSAGE it-9deb
Composer: Mozart (sonata, first movement). Meter: 4/4. Tempo: quarter = 132 (estimated). Bars 49-52.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1     49  1     e     A4              2
R2     49  1.5   s     Bb4             3
R3     49  1.75  s     C5              1
R4     49  2     s     D5              2
R5     49  2.25  s     E5              3
R6     49  2.5   s     F5              1
R7     49  2.75  s     G5              2
R8     49  3     s     A5              3
R9     49  3.25  s     G5              2
R10    49  3.5   s     F5              1
R11    49  3.75  s     E5              3
R12    49  4     s     D5              2
R13    49  4.25  s     C5              1
R14    49  4.5   s     Bb4             2
R15    49  4.75  s     A4              1
R16    50  1     q     A5              5
-      50  2     h     rest            -
R17-18 50  4     q     C5+A5           1+5
R19-20 51  1     q     C5+G5           1+5
-      51  2     h     rest            -
R21-22 51  4     q     C5+G5           1+5
R23-24 52  1     q     C5+F5           1+4
-      52  2     h     rest            -
R25-26 52  4     q     B4+F5           1+4
LH (context)
L1-2   49  1     q     F3+F4           -
-      49  2     h.    rest            -
L3     50  1     e     F3              -
L4     50  1.5   s     G3              -
L5     50  1.75  s     A3              -
L6     50  2     s     Bb3             -
L7     50  2.25  s     C4              -
L8     50  2.5   s     D4              -
L9     50  2.75  s     E4              -
L10    50  3     s     F4              -
L11    50  3.25  s     E4              -
L12    50  3.5   s     D4              -
L13    50  3.75  s     C4              -
L14    50  4     s     Bb3             -
L15    50  4.25  s     A3              -
L16    50  4.5   s     G3              -
L17    50  4.75  s     F3              -
L18    51  1     e     E3              -
L19    51  1.5   s     F3              -
L20    51  1.75  s     G3              -
L21    51  2     s     A3              -
L22    51  2.25  s     B3              -
L23    51  2.5   s     C4              -
L24    51  2.75  s     D4              -
L25    51  3     s     E4              -
L26    51  3.25  s     D4              -
L27    51  3.5   s     C4              -
L28    51  3.75  s     B3              -
L29    51  4     s     A3              -
L30    51  4.25  s     G3              -
L31    51  4.5   s     F3              -
L32    51  4.75  s     E3              -
L33    52  1     e     D3              -
L34    52  1.5   s     E3              -
L35    52  1.75  s     F3              -
L36    52  2     s     G3              -
L37    52  2.25  s     A3              -
L38    52  2.5   s     B3              -
L39    52  2.75  s     C4              -
L40    52  3     s     D4              -
L41    52  3.25  s     C4              -
L42    52  3.5   s     B3              -
L43    52  3.75  s     A3              -
L44    52  4     s     G3              -
L45    52  4.25  s     F3              -
L46    52  4.5   s     E3              -
L47    52  4.75  s     D3              -
```

```
PASSAGE it-2095
Composer: Traditional (folk song, arranged). Meter: 6/8. Tempo: quarter = 96 (estimated). Bars 10-16.
Review: LH fingering (column f). RH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH (context)
R1     10  1     q     D5              -
R2     10  1.667 e     B4              -
R3     10  2     e.    G4              -
R4     10  2.5   s     A4              -
R5     10  2.667 e     B4              -
R6     11  1     q     C5              -
R7     11  1.667 e     A4              -
R8     11  2     e.    A4              -
R9     11  2.5   s     G#4             -
R10    11  2.667 e     A4              -
R11    12  1     q     B4              -
R12    12  1.667 e     G#4             -
R13    12  2     q.    E4              -
R14    13  1     q.    G5              -
R15    13  2     e.    G5              -
R16    13  2.5   s     F#5             -
R17    13  2.667 e     E5              -
R18    14  1     q     D5              -
R19    14  1.667 e     B4              -
R20    14  2     e.    G4              -
R21    14  2.5   s     A4              -
R22    14  2.667 e     B4              -
R23    15  1     e.    C5              -
R24    15  1.5   s     B4              -
R25    15  1.667 e     A4              -
R26    15  2     e.    G#4             -
R27    15  2.5   s     F#4             -
R28    15  2.667 e     G#4             -
R29    16  1     h.    A4              -
LH
L1-2   10  1     h.    G2+D3           5+1
L3-4   11  1     h.    A2+E3           3+1
L5-6   12  1     h.    E2+B2           5+1
L7-8   13  1     h.    C3+G3           3+1
L9-10  14  1     h.    G2+D3           5+1
L11-12 15  1     q.    A2+E3           3+1
L13-14 15  2     q.    E2+B2           5+1
L15-16 16  1     h.    A2+E3           5+1
```

Output file: research/data/teacher_review/weekly/2026-10-14/out/batch-03a.json
