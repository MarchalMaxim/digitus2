# Batch batch-04

# Melody listening brief

You are a piano teacher listening, in your mind's ear, to short passages from easy piano pieces
for a beginner. Each passage is four bars in a compact text notation: the right hand (RH) carries
the melody, and the left hand (LH) is the accompaniment. Some passages are printed as published.
Others have been edited. You are not told which ones, so do not try to guess. Judge each passage
on its own merits, as music a beginner would play.

## How to read a passage block

- There is one line per note, chord or rest. Each hand has its own section, in time order.
- `id` is the hand letter plus the note number (R1, R2, ... for the right hand; L1, L2, ... for
  the left).
  - A chord shows a range (R3-5), and its pitches are listed low to high.
  - Rests have no id.
  - Refer to notes by these ids.
- `bar` / `beat` give the bar number and the beat within the bar, counting from 1. A value of 2.5
  means half-way through beat 2. The beat is a quarter note in x/4 meters, a dotted quarter in 6/8
  and 12/8, and an eighth in 3/8.
- `dur` is the note value:
  - w h q e s t mean whole, half, quarter, eighth, 16th and 32nd;
  - a trailing dot means dotted (q. is a dotted quarter);
  - e3 is a triplet eighth;
  - otherwise the value is a multiple of a quarter (2.5q).
- `pitch` uses scientific pitch names, with C4 as middle C and sharps except Eb and Bb.
- The tempo is given in quarter notes per minute.

## What you must do for every passage

1. Score three criteria from 0 to 3 (integers):
   - `musical`: the melody line is shapely and sounds like a real tune. 3 = natural throughout;
     2 = one spot sounds odd; 1 = several; 0 = it does not sound like music.
   - `fits_harmony`: the melody notes sit well over the left hand: no clash a teacher would mark,
     and no note that sounds outside the key. 3 = no clash; 2 = one mild clash; 1 = a clear clash;
     0 = several.
   - `beginner_friendly`: the rhythm and the number of notes suit a beginner at this tempo.
     3 = suitable as is; 2 = one busy spot; 1 = several; 0 = too busy for a beginner.
2. Give an overall verdict:
   - `natural`: you would teach it as is;
   - `acceptable`: one small thing;
   - `awkward`: you would rewrite part of it;
   - `wrong`: it contains notes that do not belong.
3. List specific objections. Each objection has:
   - the note ids it concerns;
   - a kind: `wrong_note`, `clash`, `rhythm`, `clutter`, `repetitive`, `phrase` or `other`;
   - a severity: `error` (a note that does not belong), `warning` (sounds poor) or `info` (a
     matter of taste);
   - a problem statement of at most 25 words.

   Raise only objections you would defend to a colleague. An empty list is a perfectly good
   answer.
4. Add one or two sentences of overall comment. This is optional.

## Output

Return one JSON document with this shape and nothing else:

```json
{
  "batch": "<batch id from the input file>",
  "started_at": "<ISO-8601 UTC timestamp taken before you read the passages>",
  "finished_at": "<ISO-8601 UTC timestamp taken after you wrote the last item>",
  "items": [
    {
      "item": "<passage id>",
      "scores": {"musical": 3, "fits_harmony": 2, "beginner_friendly": 3},
      "verdict": "acceptable",
      "objections": [
        {"notes": ["R7"], "kind": "clash", "severity": "warning",
         "problem": "The F against the left hand's E in bar 3 rubs on the beat."}
      ],
      "comment": "A plain, singable line; bar 3 is the only rough spot."
    }
  ]
}
```

Every item in the input must appear exactly once in `items`, in the same order. Use only note ids
that exist in the passage.


## Passages

```
PASSAGE em-801a
Composer: Unknown (classical). Meter: 3/4. Tempo: quarter = 100. Bars 9-12.
id     bar beat  dur   pitch
RH (melody)
R1     9   1     e     C5
R2     9   1.5   e     B4
R3     9   2     q     A4
R4     9   3     e     D5
R5     9   3.5   e     C5
R6     10  1     e     B4
R7     10  1.5   e     A4
R8     10  2     e     G4
R9     10  2.5   e     A4
R10    10  3     q     B4
R11    11  1     e     C5
R12    11  1.5   e     B4
R13    11  2     q     A4
R14    11  3     e     D5
R15    11  3.5   e     C5
R16    12  1     e     B4
R17    12  1.5   e     A4
R18    12  2     q     G4
-      12  3     q     rest
LH (accompaniment)
L1     9   1     q     A3
L2     9   2     q     C4
L3     9   3     q     A3
L4     10  1     q     G3
L5     10  2     q     B3
L6     10  3     q     G3
L7     11  1     q     A3
L8     11  2     q     C4
L9     11  3     q     A3
L10    12  1     q     G3
L11    12  2     q     B3
-      12  3     q     rest
```

```
PASSAGE em-a7f4
Composer: Stephen Foster (songs). Meter: 4/4. Tempo: quarter = 100. Bars 5-8.
id     bar beat  dur   pitch
RH (melody)
R1     5   1     q     G4
R2     5   2     e     G4
R3     5   2.5   e     F4
R4     5   3     q     E4
R5     5   4     q     G4
R6     6   1     q     A4
R7     6   2     q     G4
R8     6   3     q     E4
-      6   4     q     rest
R9     7   1     h     D4
R10    7   3     q     E4
R11    7   4     q     D4
R12    8   1     h     C4
-      8   3     q     rest
R13    8   4     q     G4
LH (accompaniment)
L1     5   1     w     C3
L2     6   1     h     F3
L3     6   3     h     C3
L4     7   1     w     G3
L5-6   8   1     w     C3+G3
```

```
PASSAGE em-165d
Composer: Traditional (carols). Meter: 4/4. Tempo: quarter = 112. Bars 4-7.
id     bar beat  dur   pitch
RH (melody)
R1     4   1     w     G4
-      5   1     q     rest
R2     5   2     e     C4
R3     5   2.5   e     D4
R4     5   3     q     E4
R5     5   4     q     F4
R6     6   1     h     G4
R7     6   3     h     E4
R8     7   1     q     C4
R9     7   2     q     D4
R10    7   3     h     E4
LH (accompaniment)
L1-2   4   1     w     C3+G3
L3     5   1     w     C3
L4     6   1     h     C3
L5     6   3     h     G3
L6     7   1     h     E3
L7     7   3     h     C3
```

```
PASSAGE em-481a
Composer: Alexander Reinagle (classical). Meter: 2/4. Tempo: quarter = 100. Bars 2-5.
id     bar beat  dur   pitch
RH (melody)
R1     2   1     e     F5
R2     2   1.5   e     E5
R3     2   2     e     D5
R4     2   2.5   e     C5
R5     3   1     q     D5
R6     3   2     q     E5
R7     4   1     h     F5
R8     5   1     e     E5
R9     5   1.5   e     F5
R10    5   2     q     G5
LH (accompaniment)
L1     2   1     h     C4
L2     3   1     h     B3
L3     4   1     h     B3
L4     5   1     h     C4
```

```
PASSAGE em-7e2e
Composer: Unknown (songs). Meter: 4/4. Tempo: quarter = 100. Bars 1-4.
id     bar beat  dur   pitch
RH (melody)
-      1   1     h     rest
R1     1   3     q     C4
R2     1   4     q     E4
R3     2   1     q     G4
-      2   2     e     rest
R4     2   2.5   e     G4
R5     2   3     q     F4
R6     2   4     q     E4
R7     3   1     q     D4
R8     3   2     q     C4
R9     3   3     q     E4
R10    3   4     q     C4
-      4   1     w     rest
LH (accompaniment)
-      1   1     12q   rest
L1     4   1     q.    G3
L2     4   2.5   e     G3
L3     4   3     q     A3
L4     4   4     e     G3
L5     4   4.5   e     F3
```

```
PASSAGE em-bfb2
Composer: Unknown (folk). Meter: 4/4. Tempo: quarter = 100. Bars 10-13.
id     bar beat  dur   pitch
RH (melody)
R1     10  1     h.    C5
R2     10  4     q     B4
R3     11  1     q     C5
R4     11  2     q     D5
R5     11  3     q     E5
R6     11  4     q     E5
R7     12  1     h     D5
R8     12  3     e     B4
R9     12  3.5   e     C5
R10    12  4     q     D5
R11    13  1     q.    C5
R12    13  2.5   e     B4
R13    13  3     q     A4
R14    13  4     q     A4
LH (accompaniment)
L1     10  1     q     C3
L2     10  2     q     G2
L3     10  3     q     C2
L4     10  4     e     G3
L5     10  4.5   e     F3
L6     11  1     q     E3
L7     11  2     q     B2
L8     11  3     e     C3
L9     11  3.5   e     D3
L10    11  4     e     E3
L11    11  4.5   e     F3
L12    12  1     q     G3
L13    12  2     q     D3
L14    12  3     q     G2
L15    12  4     q     E3
L16    13  1     q     A3
L17    13  2     q     E3
L18    13  3     q     F3
L19    13  4     q     E3
```
