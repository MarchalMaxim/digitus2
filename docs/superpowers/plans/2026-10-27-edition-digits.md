# Edition digits: the readability reduction in the current app (issue 94, part of issue 42)

> For agentic workers: build task by task, tests first for engine logic. Subagents run no git.

**Goal.** At rest the score prints about as many digits as a teaching edition, never more than the
editor prints on the same piece; the bar being played, the bar cued by a click or tap and the bar
under a mouse pointer show every digit, fading in and out. Print shows the edition; export writes
every fingering.

This plan replaces the readability tasks (0 to 2) of `2026-10-14-m5-interaction-readability.md`
and its app task 6 for the printed set. Note editing, pins in the UI, explanations and the side
panel's editor comparison stay in issue 42 and are not built here.

## What changed since the M5 plan

| M5 plan assumed | The app now |
| --- | --- |
| A "Show all fingers" checkbox and a "Printed n of m" line in the side panel | No new permanent control (issue 94). The reveal in the played, cued and hovered bar replaces "show all". |
| Inferability 100 by construction, density gated at 1.5 times the editor | The issue's rule is "never more digits than the editor"; the 8 editorial core30 pieces print 9 to 29 percent while a complete fingering needs 33 to 39 percent for the reader (`readability.md` 5.5). A budget is needed; reconstruction at rest is measured, not forced to 100. The reveal covers the rest: the bar being played always shows every digit. |
| Its own `findRepeats` port of `repeats.py` (transpositions included) | The engine has `fingering/repeats.ts` (identical passages, bar-position aware) and the solver already fingers identical copies alike (`identicalPassages`). R5 uses `repeatPairs` from there; transposed copies are re-read with R0 to R4 (editors re-print transpositions anyway, study section 4). |
| Patching digits only | Pages are windowed (issue 99), digits are patched after a re-solve, a hand switch dims digits (issue 79), play-along cues a step (issues 182, 204), print installs its own copy of the pages. Each needs the spare-digit class. |

## Engine

Files: `packages/engine/src/readability/player.ts`, `reduce.ts`, their `*.test.ts`,
`reduce.library.test.ts`; exports in `src/index.ts`.

### The reader (`player.ts`)

Port of `research/readability/player_model.py` with the definitions of the M5 plan's section "The
player model and the reduction" (R0 printed, R1 repeated pitch, R2 step, R3 position from `ref`,
R4 chord fill / from `ref`, `steps = round_half_away_from_zero(semitones / 2)`, thumb side first
in a slice, `s = +1` right / `-1` left, inferred fingers update `prev` never `ref`). Events are
slices of `buildHandSequence`.

R5 repeat memory: for each later copy `b` of a pair from `repeatPairs(seq, { positions:
barPositions(score, seq) })`, while no slice of that copy has carried a printed digit yet, an
unprinted note takes the finger the reader resolved for the same note of copy `a` and counts as
seen (it may become `ref`). From the first printed digit in the copy to its end, R0 to R4 apply.
Where pairs overlap, the earliest `a` wins.

`readHand(slices, seen, memory)` returns per note `{ finger | null, rule }`. `inferFingering(score,
printed: Assignment)` reads both hands and is what the reduction measures with, so "what a reader
sees" and "what the reduction assumed" never diverge.

Tests first: the study's 23 Python unit cases ported (`research/readability/tests/test_player_model.py`,
`test_reduce.py`), the mirror symmetry (a left-hand sequence equals the mirrored right-hand one),
R5 on a hand-built repeat, black-key `steps` cases.

### The reduction (`reduce.ts`)

```ts
export type PrintReason = 'pinned' | 'first' | 'none' | 'position' | 'chord' | 'step' | 'repeat' | 'memory' | 'lowConfidence';
export interface ReduceOptions {
  level?: number;          // library level 1..6; unknown: the level-3 row
  editorDigits?: number;   // digits the editor prints on this piece, when known: the cap
  confidenceFloor?: number; // default 0.6
}
export interface ReduceResult {
  printed: Set<string>;             // note ids printed at rest
  reasons: Record<string, PrintReason>;
  notes: number;                    // notes with a finger
  budget: number;
  necessary: number;                // what the unbudgeted greedy pass prints
  reconstruction: number;           // percent of notes the reader gets right from `printed`
}
export const DENSITY_TARGET: Record<number, number>; // 1-2: 20, 3: 25, 4-6: 30 (readability.md 7.3)
export function reduceFingering(score: Score, full: Assignment, opts?: ReduceOptions): ReduceResult;
```

1. **Greedy forward pass** (study `reduce.py`, M5 plan Task 1): per hand, slice by slice, print
   `pinned` and `first` (first note of the hand), then read the slice; the first unprinted note
   (thumb side first) whose reading differs from the engine's finger or is none is printed with the
   reason named after the rule that failed (`none`, `position` for R3 and R4-from-ref, `chord` for
   R4 fill, `step` for R2, `repeat` for R1, `memory` for R5), and the slice is read again. One digit
   per chord falls out of this. `lowConfidence` (confidence below the floor) prints too.
2. **Budget** = `min(round(DENSITY_TARGET[level] * notes / 100), editorDigits ?? Infinity)`, never
   below the `pinned` and `first` digits.
3. **Removal by least loss** (replaces tier reruns, which cascade: a suppressed digit leaves a
   wrong or empty `prev`, so a rerun can print more than the full pass and its reasons stop
   meaning anything). While the greedy set N is over the budget, remove the digit whose removal
   costs the fewest correctly read notes. Its loss is the number of notes the reader gets wrong
   or cannot read without it, read from the previous printed event of its hand to the next (the
   state after a printed event does not depend on what came before, so the loss is local). Ties:
   the weaker reason first (`lowConfidence`, `memory`/`repeat`, `step`/`chord`, `position`,
   `none`), then the later note. `pinned` and `first` are never removed. After a removal only the
   two neighbours' losses are recomputed (plus an R5 copy whose source overlaps the changed
   stretch). A heap keyed by (loss, reason rank, −position): deterministic, O(n log n). Each step
   lowers reconstruction by exactly its loss, so the gated metric is what is maximised; reasons
   are labels only.
4. `reconstruction` = 100 × notes whose finger `inferFingering(printed)` gets right / notes.
   `necessary` is reported with and without `lowConfidence`, so it compares with the study's
   33 to 39 percent.

Tests first: budget never exceeded (property over random hands), editor cap respected, removal
keeps the first notes and pins, the loss computed locally equals the global reconstruction drop
(property), an unbudgeted run reconstructs 100 percent (the study's property), level rows.

### Measure before the budget

Steps 1 and 5 are built first, and the unbudgeted pass is run on core30 before any tier code:
notes, editor's digits, `necessary`, reconstruction per piece. If `necessary` sits near or under
the editor's count, the budget machinery shrinks to the editor cap alone; if it sits far above
(the study predicts 33 to 39 percent against the editors' 9 to 29), the budget stands and the PR
says plainly that it extends "the greedy pass decides" with a cap.

### The oracle (`reduce.oracle.test.ts`)

The R0 to R4 reader is cross-checked against the Python reference where the two are defined
alike: the study's unit cases are ported one to one, and the right hand of the editorial core30
pieces without grace notes is compared note for note (`reduce.py` adds the lowest wrong note
first, which is the thumb side in the right hand only; Python has no forced `first` and slices
graces differently). A script under `research/readability/` writes the expected right-hand sets
from a PIG export of the engine's fingering to a committed fixture (a few KB). R5 is a deliberate
divergence (memory applied first, identical bar-aware copies only) and is off in the comparison.

### The gate (`reduce.library.test.ts`, core30 via `benchmarkEntries`)

Each core30 piece is solved as the app solves it (recommended weight set, medium hand, beginner)
and reduced with its manifest level and, for the 8 pieces with `hasEditorialFingering`, the
editor's digit count (editorial fingerings on notes the engine fingers, ties merged, one per
note). The cap and the target make "printed ≤ editor" and "density ≤ floor" true by
construction, so they are asserted as guards only. What can fail and is gated:

- **reconstruction at rest**, the share of the engine's fingers the reader recovers from the
  printed digits, per level group and on the 8 editorial pieces, against a `readability` entry in
  `benchmarks/floor.json` set by the house rule (first measurement minus 0.5, rounded down);
- **the editor comparison as a reader**: on the 8 editorial pieces, the reader's reconstruction
  of the engine's fingering from our printed digits is at least its reconstruction from the
  engine's fingers printed at the editor's places (the same note count, the same truth: only the
  placement differs, so this can fail). Editor places count only notes the engine fingers, ties
  merged, one per note. If the first measurement fails this, it is reported, not loosened.

The editor's digit count per library piece is `editorDigits` in `content/manifest.json` for every
entry with `hasEditorialFingering` (54 pieces), written by a script that counts as the gate does;
a library test asserts the field equals the engine's own count for each. The app reads it from
the manifest because the `.fingered` file loads lazily, only when the editor's view is shown.

The test prints the table (level, notes, editor, necessary, budget, printed, density,
reconstruction) that goes into `readability.md`.

## App

### Worker and document

- `solve` request gains `level?: number` and `editorDigits?: number`; the reply gains `printed:
  string[]`. The embellish reply's `assignments` gain `printed` per hand size the same way.
- `useScoreDocument` passes the library level and, only for library pieces with
  `hasEditorialFingering`, the editor's digit count. Uploads and scans never pass a cap: a file
  with three stray fingerings would otherwise print three digits on the whole piece; they get the
  level-3 target. `DocState` gains `printed: ReadonlySet<string> | null`. Null while the editor's
  fingering is shown: an edition is already an edition.

### Spare digits (`render/dom.ts`, `base.css`)

- `markSpare(root, printed)`: every `g.fing` whose `data-startid` note is not printed gets
  `.is-spare`, the others lose it; null removes all. Called when a page enters the DOM (the page
  window's build hook, where the patches are re-applied), after a re-solve patch, and on the
  print root.
- Hidden by `.score-sheet svg g.measure:not(.is-open) g.fing.is-spare { fill-opacity: 0 }`
  (specificity 0,5,3, above the muted digit's 0,4,2 `fill-opacity: 1; opacity: 0.4`). Inside an
  open bar nothing is set, so the normal cascade (muted gray, sweep, red) applies unchanged.
  Shape-level fill opacity on text: no compositor layer, no layout (issue 79 holds).
- The fade is declared only on
  `g.measure.is-open g.fing.is-spare` and on a short-lived `g.measure.is-closing g.fing.is-spare`
  (removed at `transitionend` of its last digit, or after `--dur`; never added under reduced
  motion), with the same transition shorthand as `.is-sweeping`, never on every spare digit: a
  re-solve that flips hundreds of digits must start no transition and fire no transition events
  (issue 79 measured 25,000 bubbling events from exactly that). `--dur` is 0 under reduced motion
  (tokens), so nothing fades there. The muted spare digit, once open, shows at its gray
  (`opacity: 0.4`, fill 1) like any muted digit.
- **The hand switch must not resurrect spare digits.** `.is-returning` runs `digit-back` (`from {
  fill-opacity: 0.4 }`) and an animation beats normal declarations, so every spare digit on screen
  would flash at 40 % on a switch; `.is-sweeping` transitions fill opacity too. Spare digits
  outside an open bar are excluded from `.is-returning` and `.is-sweeping` (`:not(.is-spare)` in
  those selectors, or `sweepDimming` skipping them). A unit test computes the style of a digit for
  every combination of spare, muted, open, sweeping and returning (jsdom cannot cascade
  animations, so this is an e2e check on a real page: after a switch, no spare digit outside an
  open bar ever has a computed `fill-opacity` above 0, sampled during the sweep).
- `useOpenBars(host, bars)`: one effect that diffs the set of open bar indices and toggles
  `.is-open` on their `g.measure` elements (found through the page index the sheet already keeps),
  touching only the bars that change. It is keyed on `doc.pages` too (a re-layout keeps the set
  but drops the classes), and `decorate` (ScoreView, where patches are re-applied to a windowed
  page entering the DOM) re-applies `.is-spare` and `.is-open` from refs.
- The re-solve (hand size) and the embellished version's guarded assignments carry `printed`,
  published in the same state update as the digit changes; `markSpare` re-runs over the built
  pages. `flash` skips spare digits. The embellished version gets the level target only (the
  editor cap counts the plain notes).

### Which bars open

Bars are identified by the drawn `g.measure` (BarSeek's ordinal), never by `measureIndex`, which
can differ.

- The cursor's bar: `closest('g.measure')` of the `.is-red` elements, while a note is marked and
  no hop is under way (`!hopping`: during a hop the target is already marked). Playing, paused, a
  cue after a click, tap or arrow key, the play-along walk's waiting step.
- While playing, the next bar opens from the last onset group of the current one, so the
  downbeat's digit is in full ink when it sounds (the fade takes `--dur`).
- The hovered bar from `BarSeek` (mouse only), exposed through an `onHover(bar | null)` prop.
  Hovering while playing opens that bar too: a reader looking ahead.
- A touch tap cues the bar, which opens it through the cursor rule.

### Print and export

- Print: `preparePaper` engraves with the assignment filtered to `printed` (`fingeredXml`), and
  `printed` joins the paper cache's dependencies. Verovio lays out the edition's digits only, so
  paper has no gaps where spare digits sat, and both print paths (the button and Ctrl+P) get it.
  Printing the editor's view prints the editor's digits as now.
- Export MusicXML writes every engine fingering, as today (the issue's default).

### Design questions, defaults taken

- A reader cannot ask for every digit at rest: the edition is the default and no control is added
  (issue 94). Stated in the PR.
- Export writes every digit (issue 94's default). Stated in the PR.

## e2e (`apps/web/e2e/edition.spec.ts`)

- Digit counts per level: one core30 piece per level 1 to 5 (Twinkle, Schumann Melody, Arabesque,
  K.545, Moonlight): visible digits at rest (`g.fing` without `.is-spare`, nothing open) equal the
  worker's `printed.length` exactly (exposed through the test hooks) and are above 0; every note's
  `g.fing` is still in the SVG; on the editorial ones `printed.length` ≤ the editor's count from
  the engine (the gate's number, one per note), not a count of `g.fing` in the editor's engraving.
- No transition storm: across a hand-size re-solve, `transitionrun` events on `g.fing` are 0
  outside the open bars.
- The hand switch: sampled during a sweep, no spare digit outside an open bar has a computed
  `fill-opacity` above 0.
- Print: the print root holds exactly `printed.length` digits.
- The reveal: hover a bar → every digit in it has computed `fill-opacity` 1 after `--dur`; leave →
  0. Click a bar (cue) → its digits show; Play → the cursor's bar shows all its digits and the
  previous bar returns to the edition.
- One red at every step (`expectOneRed`).
- Reduced motion: computed `transition-duration` of a spare digit is `0s`.
- Issue 79 guard: no translucent group holds a transformed shape after a reveal (the helper in
  `hand-switch.spec.ts`).
- Existing specs that count digits (`score.spec.ts`, `export.spec.ts`, ...) keep counting the
  `g.fing` elements, which stay in the SVG; specs that assert a visible digit target a printed one.

## Docs

- `docs/app.md`: the edition at rest and the reveal, print and export (a section of its own; the
  issue 59 session also edits this file).
- `docs/research/readability.md`: a section on the engine's reduction re-measured on core30 (the
  gate's table: notes, editor, necessary, budget, printed, reconstruction).
- `docs/PROGRESS.md`: the readability decision line updated (budgeted reduction, reveal).

## Order and PRs

1. Engine PR, "Part of issue 94": reader, reduction, gate, readability numbers. Full verify with
   the benchmark and hands gates pointed at the datasets.
2. App PR closing issue 94: worker, spare digits, open bars, print, e2e, docs.
