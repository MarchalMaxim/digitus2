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
