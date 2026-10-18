# Batch batch-05

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
PASSAGE em-4ac4
Composer: Unknown (folk). Meter: 4/4. Tempo: quarter = 100. Bars 10-13.
id     bar beat  dur   pitch
RH (melody)
R1     10  1     h.    C5
R2     10  4     e     B4
R3     10  4.5   e     C5
R4     11  1     q     C5
R5     11  2     q     D5
R6     11  3     e     E5
R7     11  3.5   e     F5
R8     11  4     e     E5
R9     11  4.5   e     D5
R10    12  1     q     D5
R11    12  2     q     C5
R12    12  3     e     B4
R13    12  3.5   e     C5
R14    12  4     e     D5
R15    12  4.5   e     C5
R16    13  1     q.    C5
R17    13  2.5   e     B4
R18    13  3     e     A4
R19    13  3.5   e     B4
R20    13  4     e     A4
R21    13  4.5   e     B4
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

```
PASSAGE em-dba8
Composer: Traditional (songs). Meter: 4/4. Tempo: quarter = 100. Bars 1-4.
id     bar beat  dur   pitch
RH (melody)
R1     1   1     e     C4
R2     1   1.5   e     D4
R3     1   2     q     C4
R4     1   3     q     G4
R5     1   4     q     G4
R6     2   1     q     A4
R7     2   2     q     A4
R8     2   3     h     G4
R9     3   1     e     F4
R10    3   1.5   e     G4
R11    3   2     q     F4
R12    3   3     q     E4
R13    3   4     q     E4
R14    4   1     q     D4
R15    4   2     q     D4
R16    4   3     h     C4
LH (accompaniment)
L1     1   1     w     C3
L2     2   1     h     F3
L3     2   3     h     C3
L4     3   1     h     F3
L5     3   3     h     C3
L6     4   1     h     G3
L7     4   3     h     C3
```

```
PASSAGE em-2b32
Composer: Traditional (songs). Meter: 3/4. Tempo: quarter = 96. Bars 5-8.
id     bar beat  dur   pitch
RH (melody)
-      5   1     q     rest
R1     5   2     e     A4
R2     5   2.5   e     B4
R3     5   3     e     C5
R4     5   3.5   e     D5
R5     6   1     q     D5
R6     6   2     e     E5
R7     6   2.5   e     D5
R8     6   3     e     C5
R9     6   3.5   e     B4
R10    7   1     q     A4
R11    7   2     e     B4
R12    7   2.5   e     A4
R13    7   3     e     G4
R14    7   3.5   e     A4
R15    8   1     q     A4
R16    8   2     e     B4
R17    8   2.5   e     A4
R18    8   3     e     D5
R19    8   3.5   e     E5
LH (accompaniment)
L1-2   5   1     h.    A2+E3
L3-4   6   1     h.    D3+A3
L5-6   7   1     q     D3+A3
L7-8   7   2     h     G2+D3
L9-10  8   1     h.    D3+A3
```

```
PASSAGE em-bb98
Composer: James Lord Pierpont (carols). Meter: 4/4. Tempo: quarter = 120. Bars 5-8.
id     bar beat  dur   pitch
RH (melody)
R1     5   1     e     F4
R2     5   1.5   e     G4
R3     5   2     q     F4
R4     5   3     q.    F4
R5     5   4.5   e     F4
R6     6   1     q     F4
R7     6   2     q     E4
R8     6   3     q     E4
R9     6   4     e     E4
R10    6   4.5   e     E4
R11    7   1     q     E4
R12    7   2     q     D4
R13    7   3     q     D4
R14    7   4     q     E4
R15    8   1     h     D4
R16    8   3     q     G4
R17    8   4     q     F4
LH (accompaniment)
L1     5   1     h     F3
L2     5   3     h     C3
L3     6   1     h     C3
L4     6   3     h     G3
L5     7   1     h     G3
L6     7   3     h     D3
L7     8   1     h     G3
L8     8   3     h     D3
```

```
PASSAGE em-fa1d
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
R8     5   1     q     E5
R9     5   2     q     G5
LH (accompaniment)
L1     2   1     h     C4
L2     3   1     h     B3
L3     4   1     h     B3
L4     5   1     h     C4
```

```
PASSAGE em-a8b1
Composer: Ludwig van Beethoven (songs). Meter: 4/4. Tempo: quarter = 108. Bars 7-10.
id     bar beat  dur   pitch
RH (melody)
R1     7   1     q     C4
R2     7   2     q     C4
R3     7   3     q     D4
R4     7   4     q     E4
R5     8   1     q.    D4
R6     8   2.5   e     C4
R7     8   3     h     C4
R8     9   1     q     D4
R9     9   2     q     D4
R10    9   3     q     E4
R11    9   4     q     C4
R12    10  1     q     D4
R13    10  2     e     E4
R14    10  2.5   e     F4
R15    10  3     q     E4
R16    10  4     q     C4
LH (accompaniment)
L1     7   1     w     C3
L2     8   1     h     G3
L3     8   3     h     C3
L4     9   1     h     G3
L5     9   3     h     C3
L6     10  1     h     G3
L7     10  3     h     C3
```
