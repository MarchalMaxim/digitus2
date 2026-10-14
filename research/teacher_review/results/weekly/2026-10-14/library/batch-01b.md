# Batch 01b

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
PASSAGE it-c8d4
Composer: Traditional (hymn, arranged). Meter: 3/4. Tempo: quarter = 80 (estimated). Bars 1-6.
Review: LH fingering (column f). RH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH (context)
R1     1   1     h     G4              -
R2     1   3     e     B4              -
R3     1   3.5   e     G4              -
R4     2   1     h     B4              -
R5     2   3     q     A4              -
R6     3   1     h     G4              -
R7     3   3     q     E4              -
R8     4   1     h     D4              -
R9     4   3     q     D4              -
R10    5   1     h     G4              -
R11    5   3     e     B4              -
R12    5   3.5   e     G4              -
R13    6   1     h     B4              -
R14    6   3     q     A4              -
LH
L1-2   1   1     h.    G2+D3           5+1
L3-4   2   1     h     G2+D3           5+1
L5-6   2   3     q     D3+A3           4+1
L7-8   3   1     h.    C3+G3           3+1
L9-10  4   1     h.    G2+D3           5+1
L11-12 5   1     h.    G2+D3           5+1
L13-14 6   1     h     G2+D3           5+1
L15-16 6   3     q     D3+A3           4+1
```

```
PASSAGE it-6d50
Composer: Traditional (folk song, arranged). Meter: 3/4. Tempo: quarter = 96 (estimated). Bars 4-10.
Review: LH fingering (column f). RH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH (context)
R1     4   1     h.    D4              -
-      5   1     q     rest            -
R2     5   2     q     A4              -
R3     5   3     q     C5              -
R4     6   1     h     D5              -
R5     6   3     q     C5              -
R6     7   1     q     A4              -
R7     7   2     q     B4              -
R8     7   3     q     G4              -
R9     8   1     h     A4              -
R10    8   3     q     D5              -
R11    9   1     h     D5              -
R12    9   3     q     D5              -
R13    10  1     h     C5              -
R14    10  3     q     A4              -
LH
L1-2   4   1     h.    D3+A3           3+1
L3-4   5   1     h.    A2+E3           5+1
L5-6   6   1     h.    D3+A3           5+1
L7-8   7   1     q     D3+A3           4+1
L9-10  7   2     h     G2+D3           5+1
L11-12 8   1     h.    D3+A3           5+1
L13-14 9   1     h.    D3+A3           3+1
L15-16 10  1     h.    A2+E3           5+1
```

```
PASSAGE it-d71b
Composer: Clementi (sonatina, first movement). Meter: 2/2. Tempo: quarter = 132 (estimated). Bars 7-8.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1     7   1     e     D5              2
R2     7   1.25  e     B4              1
R3     7   1.5   e     C5              4
R4     7   1.75  e     A4              2
R5     7   2     e     B4              3
R6     7   2.25  e     G4              1
R7     7   2.5   e     A4              3
R8     7   2.75  e     F#4             2
R9     8   1     e     G4              1
R10    8   1.25  e     A4              2
R11    8   1.5   e     B4              3
R12    8   1.75  e     C5              1
R13    8   2     e     D5              2
R14    8   2.25  e     E5              3
R15    8   2.5   e     F#5             4
R16    8   2.75  e     G5              5
LH (context)
L1     7   1     q     G3              -
L2     7   1.5   q     C3              -
L3     7   2     q     D3              -
L4     7   2.5   q     D2              -
L5     8   1     q     G2              -
```

```
PASSAGE it-39bc
Composer: Beethoven (bagatelle). Meter: 3/8. Tempo: quarter = 72 (estimated). Bars 74-76.
Review: LH fingering (column f). RH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH (context)
R1-2   74  1     q     G4+Eb5          -
R3-4   74  3     s     F4+D5           -
R5-6   74  3.5   s     Eb4+C5          -
R7-9   75  1     q     D4+F4+Bb4       -
R10-12 75  3     e     D4+F4+A4        -
R13-15 76  1     q     D4+F4+G#4       -
R16-18 76  3     e     D4+F4+G#4       -
LH
L1     74  1     s     Bb2             3
L2     74  1.5   s     Bb2             3
L3     74  2     s     Bb2             3
L4     74  2.5   s     Bb2             3
L5     74  3     s     Bb2             3
L6     74  3.5   s     Bb2             3
L7     75  1     s     Bb2             3
L8     75  1.5   s     Bb2             3
L9     75  2     s     Bb2             3
L10    75  2.5   s     Bb2             3
L11    75  3     s     Bb2             3
L12    75  3.5   s     Bb2             3
L13    76  1     s     B2              2
L14    76  1.5   s     B2              2
L15    76  2     s     B2              2
L16    76  2.5   s     B2              2
L17    76  3     s     B2              2
L18    76  3.5   s     B2              2
```

```
PASSAGE it-d02b
Composer: Chopin (prelude). Meter: 3/4. Tempo: quarter = 72 (estimated). Bars 2-4.
Review: RH fingering (column f). LH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH
R1-3   2   1     h     D4+G#4+B4       1+2+4
R4-5   2   3     q     D5+F#5          1+3
R6-7   3   1     e.    C5+Eb5          1+2
R8-9   3   1.75  s     C#5+E5          1+2
R10-11 3   2     q     C#5+A5          1+5
R12-13 3   3     q     C#5+A5          1+5
R14-15 4   1     h     C#5+A5          1+5
R16-17 4   3     q     E4+C#5          1+5
LH (context)
L1-2   2   1     h     E3+E4           -
-      2   3     q     rest            -
L3     3   1     q     A2              -
L4-5   3   2     q     A3+E4           -
L6-7   3   3     q     A3+E4           -
L8-9   4   1     h     A3+E4           -
```

```
PASSAGE it-d098
Composer: Traditional (hymn, arranged). Meter: 3/4. Tempo: quarter = 80 (estimated). Bars 8-14.
Review: LH fingering (column f). RH shown for context, without fingering.
id     bar beat  dur   pitch           f
RH (context)
R1     8   1     q.    D5              -
R2     8   2.5   e     B4              -
R3     8   3     e     D5              -
R4     8   3.5   e     B4              -
R5     9   1     h     G4              -
R6     9   3     q     D4              -
R7     10  1     q.    E4              -
R8     10  2.5   e     G4              -
R9     10  3     e     G4              -
R10    10  3.5   e     E4              -
R11    11  1     h     D4              -
R12    11  3     q     D4              -
R13    12  1     h     G4              -
R14    12  3     e     B4              -
R15    12  3.5   e     G4              -
R16    13  1     h     B4              -
R17    13  3     q     A4              -
R18    14  1     h.    G4              -
LH
L1-2   8   1     h.    G2+D3           5+1
L3-4   9   1     h.    G2+D3           5+1
L5-6   10  1     h.    C3+G3           3+1
L7-8   11  1     h.    G2+D3           5+1
L9-10  12  1     h.    G2+D3           5+1
L11-12 13  1     h     D3+G3           4+1
L13-14 13  3     q     D3+A3           4+1
L15-16 14  1     h.    G2+D3           5+1
```

Output file: research/data/teacher_review/weekly/2026-10-14/out/batch-01b.json
