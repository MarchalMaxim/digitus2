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
