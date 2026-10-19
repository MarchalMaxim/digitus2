# Listening test: embellished library pieces (issue #38)

These are ten pieces from the built-in library. Each comes in three versions: the plain score and
the two embellished versions, **light** and **playful**. The title inside each file says which
version it is ("Twinkle, Twinkle, Little Star (embellished, light)"). The suffix goes on the work
and movement titles and on the title printed on the page (`<credit-words>`). A file with no title
gets a movement title.

To listen:

1. Open the app.
2. Drop a file on the window, or open it from "My scores".
3. Play the three versions one after the other.

`NN-<slug>.inserted.json` lists every added note: bar, beat, pitch, rule and length. The method,
the rules and the numbers are in [`docs/research/embellishment-spike.md`](../../../docs/research/embellishment-spike.md).
The files are rebuilt with:

```bash
research/.venv/Scripts/python.exe -I research/embellish/run.py         # the scoring run (needs the built engine)
research/.venv/Scripts/python.exe -I research/embellish/listening.py   # this folder
node research/embellish/render_check.mjs                              # Verovio check of this folder
```

## The pieces

| # | Piece | Library level | Notes added, light / playful | Level proposal, plain / light / playful | Source and licence |
|---:|---|---:|---|---|---|
| 1 | Twinkle, Twinkle, Little Star (Traditional) | 1 | 6 / 27 | 1 / 1 / 1 | digitus2 arrangement, CC0 1.0 |
| 2 | Jingle Bells, chorus (Pierpont) | 1 | 7 / 29 | 1 / 1 / 1 | digitus2 arrangement, CC0 1.0 |
| 3 | When the Saints Go Marching In (Traditional) | 1 | 6 / 29 | 1 / 1 / 2 | digitus2 arrangement, CC0 1.0 |
| 4 | Camptown Races (Foster) | 1 | 4 / 23 | 1 / 1 / 1 | digitus2 arrangement, CC0 1.0 |
| 5 | Ode to Joy, simplified (Beethoven) | 1 | 7 / 25 | 1 / 1 / 1 | digitus2 arrangement, CC0 1.0 |
| 6 | Scarborough Fair (Traditional) | 2 | 4 / 31 | 3 / 3 / 3 | digitus2 arrangement, CC0 1.0 |
| 7 | Allegro (Reinagle) | 1 | 8 / 21 | 1 / 1 / 1 | MuseScore via [PDMX](https://zenodo.org/records/15571083), CC0 1.0 |
| 8 | Bayernhymne | 1 | 3 / 13 | 1 / 1 / 1 | MuseScore via [PDMX](https://zenodo.org/records/15571083), CC0 1.0 |
| 9 | Come Let Us All with Fervour (folk tune) | 2 | 7 / 20 | 2 / 2 / 2 | MuseScore via [PDMX](https://zenodo.org/records/15571083), public domain |
| 10 | Andantino | 1 | 11 / 28 | 1 / 1 / 1 | MuseScore via [PDMX](https://zenodo.org/records/15571083), CC0 1.0 |

The digitus2 arrangements are built by
[`content/tools/arrange.py`](https://github.com/MarchalMaxim/digitus2/blob/main/content/tools/arrange.py).

**How the ten were chosen.** Each piece meets all of these conditions at both densities:

- it was embellished;
- it passed the embellisher's own check;
- its fingering has no law error;
- it has no more beginner errors than the plain score;
- its level proposal rose by at most one.

The pieces come from the catalogue in order: six curated pieces and four from the MuseScore
archive, at most one per collection, with a second piece from a collection only where a lane runs
short. The archive's jazz and blues collection is left out, because its modern melodies may still
be under copyright. Andantino also tests the divisions scale-up. Its file uses one division per
quarter note, so the embellisher first rewrites every duration in eighths. The rhythm sounds the
same.

`node research/embellish/render_check.mjs` loads all 30 files in Verovio 6.3.0, the app's renderer,
from `apps/web/node_modules`. It checks three things:
- each file renders with no error;
- each embellished version has exactly the recorded number of notes more than the plain one;
- the beam counts are unchanged.

Run `pnpm install --frozen-lockfile` first. The files are not validated against the MusicXML XSD.

## Questions for the owner

For each piece, play plain, then light, then playful.

1. **Does it sound musical?** Do the added notes sound like something a person would whistle, or
   like a machine filling gaps? Note any spot that sounds wrong (bar and beat).
2. **Does it get in the way?**
   - Is the tune still easy to recognise?
   - Does the extra motion hide the phrase ends?
   - Would a beginner still want to play it?
3. **Which density?** Light, playful, or neither, for this piece. And overall: should the one
   "Add notes between" choice give light, playful, or something in between?
4. **Which rule sounds best and which worst?**
   - passing notes that fill a third;
   - upper neighbours on repeated notes;
   - neighbour figures on long notes;
   - anticipations before a downbeat.

   Each added note's rule is in the `.inserted.json`.

## Teacher review batch (blinded)

`teacher/` holds a blinded review in the shape of
[`research/teacher_review`](../../teacher_review/README.md):

- **Passages.** Each of the ten pieces gives one four-bar passage, in three conditions (plain,
  light, playful). That makes 30 passages.
- **Bars.** The bars are the window with the most playful insertions.
- **Format.** The passages are rendered with `teacher_review.render` (`model.Passage`,
  `render_passage`) without the fingering column.
- **Batches.** There are five batches of six. A batch never holds the same piece twice, and the
  conditions are mixed in random order (seed 38).
- **Blinding.** Item ids are random hex (`em-xxxx`). The header names the composer and a genre
  word, not the title.
- **Key.** `teacher/key.json` maps each item to piece, condition, bars and the ids of the inserted
  notes. Reviewers must not read it.
- **Brief.** `teacher/brief.md` is a listening brief, not the fingering brief. It asks for three
  scores, a verdict and objections by note id.

Dispatch one fresh reviewer per batch with the wrapper of `docs/research/teacher-review.md`
section 6.3. Replace "piano fingerings" with "melodies", and keep the rule to read only the batch
file. Each reviewer's JSON goes to `teacher/results/batch-NN.json`.

Two scripts collect and score the results:

- **`research/embellish/collect.py`** checks every results file against the brief's schema:
  - every input item appears exactly once, in the batch file's order;
  - the scores are integers 0 to 3, and the verdict is one of the four;
  - each objection's kind and severity come from the brief, and its problem is at most 25 words;
  - every note id an objection names exists in that passage.

  It reports the problems per batch and exits 1 if there are any. It joins the key and each
  inserted id's rule from `NN-<slug>.inserted.json`, and writes `teacher/results/judgements.json`.
- **`research/embellish/score.py`** writes `teacher/results/summary.json` and `summary.md`. Per
  condition, it gives:
  - the mean scores and the verdicts;
  - objections per 100 notes, by kind and by severity;
  - hits (objections that name an inserted note) against false positives (objections that name
    only original right-hand notes);
  - the share of inserted and of original notes that objections name, and the same per rule.

  Per piece, it gives the condition that scores highest, and a paired sign test of plain against
  light and against playful.

```bash
research/.venv/Scripts/python.exe -I research/embellish/collect.py
research/.venv/Scripts/python.exe -I research/embellish/score.py
research/.venv/Scripts/python.exe -I -m pytest research/embellish/tests -q
```

The result is in section 8 of
[`docs/research/embellishment-spike.md`](../../../docs/research/embellishment-spike.md).
