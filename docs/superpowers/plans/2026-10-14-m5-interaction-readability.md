# M5 Interaction and Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the score readable and editable. The engine gains the validated player model of the readability study (rules R0 to R5, including a memory for repeated passages) and a minimal-sufficient reduction that prints only the finger numbers that reader cannot infer (density under a floor per library level and at most 1.5 times the editor's density (reported ratio; target 1.0) on the same piece, inferability exactly 100 percent, both gated by the bench), a repeat-consistency metric, plain-English explanations for every cost term and every lint rule, and a readability report that compares the engine with the editor. The app lets a beginner click a digit or a notehead, see why the engine chose that finger, pick another one, and keep it: the pin is re-solved in the worker, shown underlined, saved per piece, honored by export, and undone by "Reset my changes". The side panel shows how many digits are printed, a "Show all fingers" toggle, the level and hand size, and, for pieces with an editor's fingering, the agreement rate with buttons that walk through the differences.

**Architecture:** `packages/engine/src/readability/` holds the repeat detector (`repeats.ts`: segments of at least four events of one hand with the same intervals and rhythm, found with a hash of four-event windows, a TypeScript port of `research/readability/repeats.py`), the player model (`playerModel.ts`: one pure function `readSlice` that applies R0 to R4 to a slice given the digits it sees and a small state, and `readHand`/`inferFingering` that run it over a hand with the R5 repeat memory; a port of `research/readability/player_model.py`) and the reduction (`reduce.ts`: a greedy forward pass that prints a digit wherever the reader would infer a different finger or none, plus the first note of each hand, pinned notes and notes under the confidence floor; when a chord needs a digit, one is printed on the thumb side and R4 fills the rest). Because the reduction and the inference call the same `readSlice` with the same seen digits and the same state, inferability is 100 by construction, and a test checks it on every library piece, on the PIG fixture and on random fingerings. `src/eval/readability.ts` turns a fingering into a report; `cli/bench.ts` adds a library readability row gated by `benchmarks/floor.json`. `src/fingering/explain.ts` and `src/lint/messages.ts` are leaf modules of text tables (type imports only), so the app's main thread can import them for a few kilobytes. In the app the engine worker's `solve` returns, in one round trip, the fingering with pins, the explanations, the printed set, and the lint laws broken in a relaxed hand. A small per-piece zustand store holds pins and two toggles and writes them to `localStorage` under a key that includes a content hash. `useScoreDocument` renders only the printed digits; when a re-solve leaves the set of printed notes unchanged it patches digits in place, otherwise it re-renders. The selected note is the one red element while stopped; the cursor takes over (and clears the selection) during playback.

**Tech Stack:** as M4 (TypeScript strict, React 19.3, zustand 5.0.15, Verovio 6.3.0 in a worker, vitest 3 + happy-dom + Testing Library, @playwright/test 1.59.1, @axe-core/playwright). No new dependencies.

**Depends on:** M2 (all tasks: `solveFingering` with `SolveOptions.pins`, `SolveResult.explanations` of `ExplainedTerm`s, `HandSolution.relaxed`, confidence and alternatives; `buildHandSequence`; `lintFingering`, `LINT_RULES`, `LintIssue` L01 to L14; `bench` and its scorecard), M3 (Task 1 `RULE_IDS` and the indicator families `on:`, `tr:`, `ch:` and the five named features; Task 4 `SolveOptions.weightSet` and `RECOMMENDED_WEIGHT_SET`; Task 6 calibrated `confidence`; Task 8 `SolveOptions.level`), and M4 (all tasks: store, routes, engine worker and client, renderer adapter with `setDigits` and `setCurrent`, `useScoreDocument`, `ScoreView`, `SidePanel`, `Transport`, `Keyboard`, the red element rule, `expectOneRed`, `expectNoSeriousA11y`, `check-bundle-size.mjs`). Engine Tasks 0 to 3 run first; app Tasks 4 to 9 consume the names they export through `@digitus2/engine`.

**Spec:** `docs/superpowers/specs/2026-10-13-digitus2-design.md` section 9 view 2 (editing, "why", editorial comparison) and the State paragraph (persistence per piece), section 5 (`Assignment`, `FingerAssignment.pinned` and `source`); `docs/superpowers/specs/2026-10-13-verification-design.md` section 1 rows "Be easy to read" and "Honor the design brief", section 3.6 **with its 2026-10-14 amendment, which is the binding definition of the player model, the reduction and the per-level density floors**, and section 3.9 (application checks). The amendment's source and the reference implementation: `docs/research/readability.md` sections 5.1 (the rule set), 5.5 (the reduction measured), 7.1 to 7.3 (recommendations and targets), `research/readability/player_model.py`, `reduce.py`, `repeats.py`. Principles: `docs/research/literature.md` section 4.2 (P1 five-finger positions, P2 position changes, P4 legal crossings, P5 standard fingerings, P7 repeated notes, P11 consistency) and section 6.6 items 1 and 3 (hand position, consistency across repeats). Editor data: `docs/research/content-library.md` "Editorial fingering" (8 `.fingered` pieces) and `docs/research/datasets.md` section 4.4 (editors print only the non-obvious notes; median coverage 30 percent of notes per part).

## Global Constraints

- Everything in the M4 Global Constraints still holds: black, white, grays and one red `#e3000f` used only by `.is-red`; exactly one red element in every state; motion 120 to 200 ms ease-out, zero under `prefers-reduced-motion`; layout from 360 px; LCP under 2 s; no serious or critical axe violations; parsing, solving, reduction and layout run in workers; no network calls beyond static assets and samples; the app depends only on `@digitus2/engine`'s public API.
- The red element while stopped is the Play button, **unless a note is selected**: then the selected note's `g.note` is the only red element and the Play button is plain. During playback the cursor is the only red element; pressing Play clears the selection. Finger digits, the popover, pinned digits, the notice and the side panel are never red.
- Pinned digits are distinguished by an underline (`.is-pinned`), never by color. `scripts/check-colors.mjs` must stay green.
- Bundle: the M5 app code (popover, selection, per-piece store, explanation and lint message tables) may add at most 10 KB gzip to the library page's initial JavaScript. Task 4 records the M4 baseline in `apps/web/bundle-baseline.json` and teaches `scripts/check-bundle-size.mjs` to enforce `baseline + 10240` bytes; the 150 KB absolute budget stays. The reduction and the player model run only in the engine worker.
- Engine code under `packages/engine/src/` never touches DOM or Node APIs; tests may read files. `explain.ts` and `messages.ts` import only types (`import type`), so the main thread pulls in nothing but their tables.
- Determinism: the reduction is a pure function of the score, the fingering and the options; two runs give identical sets. The player model uses integer arithmetic only (`steps` rounds half away from zero with `Math.floor((|d| + 1) / 2)`), so it gives the same answer as the Python reference.
- The engine solves with `weightSet: RECOMMENDED_WEIGHT_SET` in the app and in the readability gate. Hand profile and level come from the settings.
- `pnpm verify` stays green after every task; implementers do not run git (CLAUDE.md). If an engine or app name below differs from what M2, M3 or M4 actually exported, read `packages/engine/src/index.ts` or the app file and use the real name; never add a second copy of an existing function.
- Windows host: long commands in the background; the Write tool for files longer than a few lines (CLAUDE.md).

## Review Focus

1. **Two pins that cannot both be played** (the same finger on two notes of one chord, or a pin that forces a span beyond the hand) must give a finite, relaxed fingering that keeps both pins, a readable notice naming the broken law, and no crash or blank score. Pinned by Task 4 (`two pins with one finger in a chord: relaxed, both kept, L01 reported`) and Task 7 (`a pin that breaks a law shows the notice and keeps both pins`).
2. **Selection and cursor both red.** A selected note left red while the playback cursor runs is two red elements. Pinned by Task 7 (`playing clears the selection: the cursor is the only red`, end to end) and Task 7 (`Play is plain while a note is selected`, Testing Library).
3. **Persistence collisions.** Two different dropped files called `etude.musicxml` with the same byte length must not share pins. Pinned by Task 5 (`two different files with the same name and size get different keys`); stale pins on note ids that no longer exist are dropped (`prunes pins whose notes are gone`).
4. **The reduction hides a digit the player needs** (a leap out of the position, a crossing inside a run, a finger change on a repeated key, a repeat the engine fingered differently), so the printed fingering silently misleads. Pinned by inferability 100 and no unresolved note on every library piece (Task 2, `the reader resolves every unprinted note of every library piece to the engine's finger`), on the PIG fixture and on 300 random fingerings (Task 1, `inferability is 100 on random fingerings, even nonsensical ones`), and by Task 1 (`a repeat fingered differently gets a digit where it differs, and the reader continues normally after it`).
5. **The popover off-screen at 360 px** (a digit near the right edge pushes it past the viewport, so the finger buttons cannot be tapped). Pinned by Task 7 (`placePopover keeps the box inside the viewport at 360 px`) and Task 9 (`states on mobile: the popover is inside the viewport`).

## File Structure

```
packages/engine/src/readability/repeats.ts       handSlices, Occurrence, findRepeats, rootMap, occurrenceIndex, repeatConsistency (port of repeats.py)
packages/engine/src/readability/repeats.test.ts
packages/engine/src/readability/playerModel.ts   steps, readSlice (R0-R4), memoryFor (R5), readHand, inferFingering (port of player_model.py)
packages/engine/src/readability/playerModel.test.ts
packages/engine/src/readability/reduce.ts        ReduceReason, ReduceOptions, ReduceResult, reduceFingering
packages/engine/src/readability/reduce.test.ts
packages/engine/src/readability/library.test.ts  every library piece: inferability 100, nothing unresolved, density under the level floor, at most 1.5 times the editor's density
packages/engine/src/eval/readability.ts          readabilityReport, rekeyAssignment
packages/engine/src/eval/readability.test.ts
packages/engine/src/fingering/explain.ts         describeTerm, explainNote, confidenceLabel, TERM_FALLBACK
packages/engine/src/fingering/explain.test.ts
packages/engine/src/lint/messages.ts             ISSUE_TEXT, describeIssue
packages/engine/src/lint/messages.test.ts
packages/engine/src/index.ts                     (modify) export the names above
packages/engine/cli/bench.ts                     (modify) PieceResult density/inferability, Scorecard.readability, libraryReadability(), readability floor
packages/engine/cli/bench.test.ts                (modify) library readability row and floor breach
benchmarks/floor.json                            (modify) "readability": per-level density floors, inferability 100, at most 1.5 times the editor's density

apps/web/bundle-baseline.json                    M4 entry gzip size and the 10240-byte M5 allowance
scripts/check-bundle-size.mjs                    (modify) enforce the baseline allowance
apps/web/src/engine/protocol.ts                  (modify) SolveRequestOptions, SolveReply; solve carries level and pins
apps/web/src/engine/handlers.ts                  (modify) solve: weight set, level, explanations, reduction, law issues
apps/web/src/engine/client.ts                    (modify) solve(score, opts) -> SolveReply
apps/web/src/app/store.ts                        (modify) Settings.level (SkillLevel), default 'beginner'
apps/web/src/app/pieceStore.ts                   PieceState, pieceStorageKey (name, size and FNV-1a hash), usePieceStore
apps/web/src/app/pieceStore.test.ts
apps/web/src/score/printedSet.ts                 shownAssignment, exportAssignment, sameKeys, digitChanges
apps/web/src/score/printedSet.test.ts
apps/web/src/score/useScoreDocument.ts           (modify) printed set, pins, re-solve vs re-render, busy flag, eager editorial
apps/web/src/score/render/dom.ts                 (modify) digitNoteIdAt, targetNoteId, setSelected, markPinned, anchorRectOf
apps/web/src/score/edit/placePopover.ts          placePopover (pure)
apps/web/src/score/edit/FingerPopover.tsx        the popover
apps/web/src/score/edit/useScoreKeys.ts          1-5, Escape, Space, arrows
apps/web/src/score/edit/neighbors.ts             neighborNote (same hand, score order), noteLabel
apps/web/src/score/edit/notices.ts               relaxedNotice, handSizeNotice
apps/web/src/score/edit/editor.ts                compareWithEditor, nextDifference
apps/web/src/score/ScoreView.tsx                 (modify) selection, popover, keys, notices, data-status/data-busy
apps/web/src/score/SidePanel.tsx                 (modify) level, show all, printed count, editor agreement and differences, reset
apps/web/src/score/Transport.tsx                 (modify) selectionActive prop
apps/web/src/design/base.css                     (modify) popover, is-pinned underline, side panel rows
apps/web/e2e/helpers/score.ts                    openScore, waitSettled, firstDigit, chordPair
apps/web/e2e/edit.spec.ts                        select, change, pinned style, keyboard, relaxed notice, cursor vs selection
apps/web/e2e/panel.spec.ts                       printed/all counts, reset, level, editor differences
apps/web/e2e/persistence.spec.ts                 reload keeps pins and toggles; per-piece isolation
apps/web/e2e/{score,playback,export,states,visual}.spec.ts   (modify) reduced default, new states
docs/app.md                                      (modify) editing, readability, persistence, known limitations
```

## Engine API consumed (M2 and M3 names; check `packages/engine/src/index.ts`)

```ts
import {
  buildHandSequence, // (score, hand) -> { hand, notes: SeqNote[], sliceCount }; SeqNote: index, noteId, midi, pitch (mirrored for L), black, onsetSec, offsetSec, slice, restBefore, ioi, isGrace; grace notes get their own slice
  solveFingering, // (score, { profile, weightSet, level, pins }) -> { assignment, explanations, hands: HandSolution[] }
  lintFingering, // (score, assignment, { profile, beginner }) -> { issues: LintIssue[], ... }
  LINT_RULES, // Record<LintRuleId, { title; law }>
  RULE_IDS, // readonly RuleId[] (M3 Task 1), sorted
  RECOMMENDED_WEIGHT_SET, // 'learned-open' (M3 Task 4)
  parsePig,
  parseMusicXml,
  injectFingerings,
} from '@digitus2/engine';
import type {
  Assignment,
  FingerAssignment,
  Finger,
  Hand,
  Score,
  Note,
  SolveResult,
  NoteExplanation,
  ExplainedTerm,
  HandSolution,
  RuleId,
  LintIssue,
  LintRuleId,
  HandProfileId,
} from '@digitus2/engine';
```

Pins are hard in every decode mode in the implemented solver (`solveHand`: "Pins are hard in every mode"); the chord-order and held-note rules cost +Infinity in a hard decode and 1000 in the soft decode, so a soft decode keeps every pin and reports `relaxed: true`. Task 4's relaxed test relies on this.

Fixture facts used below (measured in M4): `apps/web/fixtures/short-piano.musicxml` has 67 sounding notes (41 right, 26 left) and 67 editorial fingerings; Twinkle has 64 notes (42 right, 22 left); the Burgmüller Arabesque `.fingered` file has 26 editorial fingerings; `packages/engine/fixtures/pig-sample.txt` is a 6-note PIG fixture with fingers (one chord in the left hand). PIG files are read at 120 quarter notes per minute with 480 divisions, so one beat is 0.5 s and 480 ticks. Every other number is measured by the tests below, which assert properties rather than guessed values.

## The player model and the reduction (the definitions every test uses)

Binding source: verification spec section 3.6, amendment of 2026-10-14; the rules are those of `docs/research/readability.md` sections 5.1 and 7.1, and `research/readability/player_model.py`, `reduce.py` and `repeats.py` are the reference implementations (their docstrings and 23 unit tests are worth reading before Task 0).

Notation, per hand: an **event** is a slice of `buildHandSequence` (the notes of one hand with the same onset; a grace note is its own slice). Inside a slice, notes are in sequence order: ascending pitch for the right hand, descending for the left, so the **thumb side comes first** in both hands. Pitches in the rules are real MIDI numbers. `s = +1` for the right hand, `−1` for the left (in the left hand, rising pitch moves toward the thumb, to a lower finger number). `steps(a, b) = round_half_away_from_zero((b − a) / 2)`: 0 for a repeat, ±1 for a second, ±2 a third, ±3 a fourth or tritone, ±4 a fifth or minor sixth, ±5 a major sixth or minor seventh, ±6 a major seventh or octave (the study measured the white-key-column variant as worse). `nearest(pairs, q)` is the pair with the smallest `|pitch − q|`, ties to the lower pitch.

**State** before a slice: `ref`, the seen notes `(pitch, finger)` of the last slice that had a seen digit (the position anchor), and `prev`, the notes of the previous slice whose finger is known (none when that slice was not resolved). A note is **seen** when its digit is printed (R0) or recalled from a repeat (R5).

**Rules** for an unseen note `q` (the first that applies wins):

| Rule              | Where                                                                                                             | Finger                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| R1 repeated pitch | single-note slice, `q` equals the nearest `prev` pitch                                                            | that `prev` finger                                                                                   |
| R2 step           | single-note slice, one or two semitones from `p`, the nearest `prev` pitch                                        | `prev.finger + s · sign(q − p)`; outside 1..5 falls through to R3                                    |
| R3 position       | single-note slice, `ref` known                                                                                    | `ref.finger + s · steps(ref.pitch, q)` from the nearest `ref` note; outside 1..5 the reader gives up |
| R4 chord fill     | slice of two or more notes with a seen note                                                                       | `f_v + s · steps(p_v, q)` from the nearest seen chord note                                           |
| R4 from `ref`     | chord without a seen note, `ref` known                                                                            | every note placed from `ref` as in R3                                                                |
| none              | otherwise; a chord finger outside 1..5; two unseen chord notes sharing a finger (or sharing one with a seen note) | not inferable: the reader needs a digit                                                              |

After a slice: `ref` becomes the slice's seen notes if it has any, else it stays; `prev` becomes the slice's resolved notes (none if nothing was resolved). Inferred fingers propagate through `prev` and never become `ref`. The reader only reads forward.

**R5, repeat memory.** `findRepeats` (port of `repeats.find_repeats`) finds later occurrences of segments of at least four events of one hand that match the earlier segment up to one constant transposition: same pitch shape per event, same note durations and same inter-onset intervals (on a 1/48-quarter grid), same steps between events; greedy left to right with a hash of four-event windows, at most 64 candidates per key, occurrences never overlapping. `rootMap` maps every event of a later occurrence to the event of the earliest statement. While the reader is inside a later occurrence and no slice of that occurrence has carried a printed digit yet, every unprinted note of a slice without a printed digit takes the finger the reader resolved for the note of the same rank in the root event, and counts as seen (it can become `ref`, like a printed digit). From the first slice of the occurrence that carries a printed digit to the end of the occurrence, R0 to R4 apply as usual.

Port decision: in the study's `reduce.py`, R5 is a last resort used only where R1 to R4 would give a wrong finger or none; "wrong" needs the engine's finger, which a reader of the printed page does not have, so a reduction built that way could not be reproduced by `inferFingering`. This plan applies the memory first, which is how a pianist reads a repeat. It prints the same digits as the study's reader whenever the engine fingers a repeat identically (the assumption R5 is built on, measured by the repeat-consistency metric); where the engine does not, the first differing note gets a digit and the rest of that occurrence is read with R0 to R4.

**`reduceFingering(score, full)`** walks each hand slice by slice. The digits it prints before reading a slice: `pinned` (`full[id].pinned`), `first` (the first note of the hand in sequence order), `lowConfidence` (`confidence` below the floor, default 0.6), `requested` (`opts.alwaysPrint`, empty by default). It then reads the slice with those digits seen (and R5 as above, from the state the reader itself produced for the earlier slices); the first unprinted note in sequence order whose reading differs from the engine's finger or is none is printed with reason `mismatch`, and the slice is read again, until every unprinted note reads right. So a chord that needs a digit gets one, on the thumb side, and R4 fills the rest; more are printed only where R4 still fails. Precedence when several reasons apply: `pinned`, `first`, `lowConfidence`, `requested`, `mismatch`. The amendment drops "after a rest", "on a leap", "at a crossing", "after a position change" and "chord outer voices" as triggers (as a predictor of editorial printing that list scores below chance and would print 60 percent of notes); the mechanism already prints leaps out of the position, crossings and position choices the reader would get wrong.

Because `inferFingering` calls the same `readSlice` with the same seen digits and the same state, slice after slice, it reconstructs every unprinted finger: inferability is 100 by construction, no unprinted note is left unresolved, and `reduceFingering` measures both anyway. `density = 100 × printed / notes`; `inferability = 100 × correctly inferred / unprinted` (100 when nothing is unprinted). Notes without an entry in `full` are removed from the score before both the reduction and the check.

**Density floors per library level** (verification spec goals table, amended 2026-10-14; percent of notes; gated per piece with the app defaults: medium hand, beginner level, recommended weight set):

| Level                                   | Floor (gate)                                                                                                                                                     | Target                | Editor level (stretch) |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------- |
| 1 and 2                                 | 30                                                                                                                                                               | 20                    | 15                     |
| 3                                       | 35                                                                                                                                                               | 25                    | 15                     |
| 4 and 5                                 | 40                                                                                                                                                               | 30                    | 25                     |
| the 8 pieces with an editor's fingering | at or below 1.5 times the editor's density on the same piece (M5 first-run floor; the study's 1.0 becomes the floor once the engine fingers repeats identically) | at or below 0.8 times | at or below 0.5 times  |

Measured facts the tests may rely on (`docs/research/readability.md` sections 0, 5.5, 7.3): the median editorial density of the 8 fingered library pieces is 18 percent (range 9 to 29); on fully fingered parts the greedy reader needs digits on 32 to 39 percent of notes (32.8 with the repeat memory, 38.9 without); editors print 2.3 to 2.9 times what this reader needs.

**Repeat consistency** (reported, not gated, in M5): the share of later occurrences (`findRepeats`, per hand) whose every note the engine fingers like the corresponding note of the occurrence's direct first statement; 100 when a piece has no repeats.

## The red element rule, extended

M4's definition is unchanged; M5 adds one state. **Stopped with a selection:** the selected note's `g.note` carries `.is-red` and `data-selected`; the Play button is plain; that note is the only red root. `expectOneRed` already accepts this (one root). **Playing:** the cursor (all `g.note`/`g.chord` sharing one `data-onset-tick`) is the only red; Play clears the selection first. `clearCurrent` (M4) removes every `.is-red` inside the sheet, which is safe because a selection never coexists with the cursor.

## Exact UI copy (the implementer does not invent prose)

| Where                                      | Copy                                                                                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Popover dialog label                       | `Finger for <note>, <right\|left> hand` (for example `Finger for F♯4, right hand`)                                                                                                                               |
| Popover title line                         | `<note>, <right\|left> hand`                                                                                                                                                                                     |
| Finger buttons                             | text `1`..`5`; `aria-label` `Finger 1`..`Finger 5`; `aria-pressed="true"` on the current finger; group label `Choose a finger`                                                                                   |
| Summary (from `explainNote`)               | `Finger <f> is the clear choice here.` / `Finger <f> is the likely choice here.` / `Finger <f> is one of several good choices here.` / `Finger <f> is your choice.` (pinned)                                     |
| Confidence line                            | `Confidence: Sure` / `Confidence: Likely` / `Confidence: Unsure`; for a pinned note `Pinned by you` instead                                                                                                      |
| Editor line (note has an editorial finger) | `The editor's finger: <f>`                                                                                                                                                                                       |
| Alternatives                               | list labelled `Other good fingers`, items `<f> · +<cost with one decimal>` (for example `3 · +2.0`); omitted when there are none                                                                                 |
| Why                                        | list labelled `Why`, the top three lines `<description> · +<points>` (negative points print as `-0.5`); when there are none: `Nothing makes this finger hard here.`                                              |
| Popover buttons                            | `Unpin` (pinned notes only), `Close`                                                                                                                                                                             |
| Side panel                                 | `Level` select with `Beginner`, `Expert`; `Hand size` (M4); checkbox `Show all fingers`; line `Printed <n> of <total> fingers`; button `Reset my changes`, which turns into `Reset?` with buttons `Yes` and `No` |
| Side panel, editor                         | line `Agrees with the editor on <p> % of the notes the editor fingered`; buttons `Previous difference`, `Next difference`; when nothing differs: `No differences from the editor.`                               |
| Relaxed notice                             | the `describeIssue` texts of the broken laws, joined by a space, then ` Your choice is kept.`; fallback body `That finger makes this passage very hard to play.`                                                 |
| Hand size notice                           | `Your changes to this piece were made for a <Large\|Medium\|Small\|Child> hand.`                                                                                                                                 |

---

### Task 0: The repeat detector and the validated player model (engine)

**Files:**

- Create: `packages/engine/src/readability/repeats.ts`, `packages/engine/src/readability/repeats.test.ts`, `packages/engine/src/readability/playerModel.ts`, `packages/engine/src/readability/playerModel.test.ts`
- Modify: `packages/engine/src/index.ts` (exports)

**Interfaces:**

- Consumes: `buildHandSequence`, `SeqNote` (M2 Task 3), `parsePig` (M1, tests only), `Assignment`, `Finger`, `Hand`, `Score`. Reference: `research/readability/repeats.py` (`event_tokens`, `find_repeats`, `root_map`) and `research/readability/player_model.py` (`steps`, `_single`, `_rules`).
- Produces:

```ts
// readability/repeats.ts
export const MIN_REPEAT_EVENTS: number; // 4
export const REPEAT_GRID: number; // 48 steps per quarter note
export const MAX_REPEAT_CANDIDATES: number; // 64
export interface Occurrence {
  first: number; // event index of the direct earlier statement
  later: number; // event index where the later occurrence starts
  length: number; // events
  shift: number; // semitones, later minus first (lowest pitches)
}
export function handSlices(notes: readonly SeqNote[]): SeqNote[][]; // groups consecutive notes by slice
export function eventTokens(
  score: Score,
  slices: readonly (readonly SeqNote[])[],
): { shape: number[]; link: number[]; low: number[] };
export function findRepeats(
  score: Score,
  slices: readonly (readonly SeqNote[])[],
  minLen?: number,
  maxCandidates?: number,
): Occurrence[];
export function rootMap(nEvents: number, occs: readonly Occurrence[]): number[]; // earliest statement of every event
export function occurrenceIndex(nEvents: number, occs: readonly Occurrence[]): number[]; // index into occs of the later occurrence containing the event, else -1
export function repeatConsistency(
  score: Score,
  assignment: Assignment,
): { segments: number; identical: number; percent: number };

// readability/playerModel.ts
export type ReaderRule = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R4ref' | 'R5' | 'none';
export interface Pitched {
  pitch: number;
  finger: Finger;
} // real MIDI pitch
export interface PlayerState {
  ref: readonly Pitched[] | null;
  prev: readonly Pitched[] | null;
}
export const INITIAL_PLAYER_STATE: PlayerState; // { ref: null, prev: null }
export interface Seen {
  finger: Finger;
  rule: 'R0' | 'R5';
}
export interface SliceReading {
  fingers: Array<Finger | null>;
  rules: ReaderRule[];
  state: PlayerState;
}
export function steps(a: number, b: number): number; // round half away from zero of (b - a) / 2
export function handSign(hand: Hand): 1 | -1;
export function nearest(pairs: readonly Pitched[], pitch: number): Pitched; // ties to the lower pitch
export function readSlice(
  midis: readonly number[], // one slice in sequence order (thumb side first)
  seen: ReadonlyMap<number, Seen>, // slice rank -> printed (R0) or remembered (R5) finger
  s: 1 | -1,
  state: PlayerState,
): SliceReading;
export function memoryFor(
  e: number,
  size: number,
  hasPrinted: boolean,
  root: readonly number[],
  occ: readonly number[],
  broken: Set<number>, // occurrences that already carried a printed digit; updated here
  resolved: ReadonlyArray<ReadonlyArray<Finger | null>>,
): ReadonlyArray<Finger | null> | null; // the R5 memory for event e, or null
export interface HandReading {
  fingers: Map<string, Finger | null>;
  rules: Map<string, ReaderRule>;
}
export function readHand(score: Score, hand: Hand, printed: Partial<Assignment>): HandReading;
export function inferFingering(
  score: Score,
  hand: Hand,
  printed: Partial<Assignment>, // only the printed digits
): { assignment: Assignment; inferred: Set<string>; unresolved: Set<string> };
// printed entries are copied; inferred ones are { finger, source: 'engine' }; notes the reader cannot infer are in `unresolved` and absent from `assignment`
```

`inferFingering` returns one more field than the brief's signature (`unresolved`): the validated reader can give up, and the tests must be able to say so.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/readability/repeats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildHandSequence } from '../fingering/sequence.js';
import { parsePig } from '../io/pig/read.js';
import type { Assignment, Score } from '../score/types.js';
import { findRepeats, handSlices, occurrenceIndex, repeatConsistency, rootMap } from './repeats.js';

const H = '//Version: PianoFingering_v170101\n';
type Row = [number, number, string, 0 | 1, number];
const pig = (rows: Row[]) =>
  H +
  [...rows]
    .sort((a, b) => a[0] - b[0])
    .map(([on, off, p, ch, f], i) => `${i}\t${on}\t${off}\t${p}\t80\t80\t${ch}\t${f}`)
    .join('\n') +
  '\n';
const melody = (pitches: string[], fingers: number[], dur = 0.5, start = 0): Row[] =>
  pitches.map((p, i) => [start + i * dur, start + (i + 1) * dur, p, 0, fingers[i]!]);
const slicesOf = (score: Score) => handSlices(buildHandSequence(score, 'R').notes);

describe('findRepeats', () => {
  it('finds an exact repeat of four events and maps it to its root', () => {
    const { score } = parsePig(
      pig(melody(['C4', 'D4', 'E4', 'F4', 'C4', 'D4', 'E4', 'F4'], [1, 2, 3, 4, 1, 2, 3, 4])),
    );
    const occs = findRepeats(score, slicesOf(score));
    expect(occs).toEqual([{ first: 0, later: 4, length: 4, shift: 0 }]);
    expect(rootMap(8, occs)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(occurrenceIndex(8, occs)).toEqual([-1, -1, -1, -1, 0, 0, 0, 0]);
  });
  it('finds a transposed repeat and extends it as far as it matches', () => {
    const { score } = parsePig(
      pig(
        melody(
          ['C4', 'D4', 'E4', 'F4', 'G4', 'D4', 'E4', 'F#4', 'G4', 'A4'],
          [1, 2, 3, 4, 5, 1, 2, 3, 4, 5],
        ),
      ),
    );
    expect(findRepeats(score, slicesOf(score))).toEqual([
      { first: 0, later: 5, length: 5, shift: 2 },
    ]);
  });
  it('needs the same rhythm and at least four events', () => {
    const rhythm = parsePig(
      pig([
        ...melody(['C4', 'D4', 'E4', 'F4'], [1, 2, 3, 4]),
        ...melody(['C4', 'D4', 'E4', 'F4'], [1, 2, 3, 4], 0.25, 2),
      ]),
    );
    expect(findRepeats(rhythm.score, slicesOf(rhythm.score))).toEqual([]);
    const short = parsePig(pig(melody(['C4', 'D4', 'E4', 'C4', 'D4', 'E4'], [1, 2, 3, 1, 2, 3])));
    expect(findRepeats(short.score, slicesOf(short.score))).toEqual([]);
  });
  it('maps a third statement to the first', () => {
    const notes = ['C4', 'D4', 'E4', 'F4'];
    const { score } = parsePig(
      pig(melody([...notes, ...notes, ...notes], [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4])),
    );
    const occs = findRepeats(score, slicesOf(score));
    expect(occs.map((o) => [o.first, o.later, o.length])).toEqual([
      [0, 4, 4],
      [0, 8, 4],
    ]);
    expect(rootMap(12, occs)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
  });
});

describe('repeatConsistency', () => {
  it('reports the share of repeats the fingering plays identically', () => {
    const { score, assignment } = parsePig(
      pig(melody(['C4', 'D4', 'E4', 'F4', 'C4', 'D4', 'E4', 'F4'], [1, 2, 3, 4, 1, 2, 3, 4])),
    );
    expect(repeatConsistency(score, assignment)).toEqual({
      segments: 1,
      identical: 1,
      percent: 100,
    });
    const lastF = slicesOf(score)[7]![0]!.noteId;
    const changed: Assignment = { ...assignment, [lastF]: { finger: 5, source: 'engine' } };
    expect(repeatConsistency(score, changed)).toEqual({ segments: 1, identical: 0, percent: 0 });
    const plain = parsePig(pig(melody(['C4', 'D4', 'E4'], [1, 2, 3])));
    expect(repeatConsistency(plain.score, plain.assignment)).toEqual({
      segments: 0,
      identical: 0,
      percent: 100,
    });
  });
});
```

`packages/engine/src/readability/playerModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildHandSequence } from '../fingering/sequence.js';
import { parsePig } from '../io/pig/read.js';
import type { Assignment, Finger, Hand, Score } from '../score/types.js';
import { inferFingering, INITIAL_PLAYER_STATE, readHand, readSlice, steps } from './playerModel.js';
import type { PlayerState, Seen } from './playerModel.js';

const H = '//Version: PianoFingering_v170101\n';
type Row = [number, number, string, 0 | 1, number]; // onset s, offset s, pitch, channel (0 R, 1 L), finger (negative for L)
const pig = (rows: Row[]) =>
  H +
  [...rows]
    .sort((a, b) => a[0] - b[0])
    .map(([on, off, p, ch, f], i) => `${i}\t${on}\t${off}\t${p}\t80\t80\t${ch}\t${f}`)
    .join('\n') +
  '\n';
const melody = (pitches: string[], fingers: number[], ch: 0 | 1 = 0, dur = 0.5): Row[] =>
  pitches.map((p, i) => [i * dur, (i + 1) * dur, p, ch, ch === 1 ? -fingers[i]! : fingers[i]!]);
const ids = (score: Score, hand: Hand) => buildHandSequence(score, hand).notes.map((n) => n.noteId);
const pick = (full: Assignment, which: string[]): Assignment =>
  Object.fromEntries(which.map((id) => [id, full[id]!]));
const fingers = (score: Score, hand: Hand, a: Assignment) =>
  ids(score, hand).map((id) => a[id]?.finger ?? null);
const R0 = (finger: Finger): Seen => ({ finger, rule: 'R0' });
const st = (
  ref: Array<[number, Finger]> | null,
  prev: Array<[number, Finger]> | null,
): PlayerState => ({
  ref: ref && ref.map(([pitch, finger]) => ({ pitch, finger })),
  prev: prev && prev.map(([pitch, finger]) => ({ pitch, finger })),
});
const none = new Map<number, Seen>();

describe('steps', () => {
  it('rounds semitones / 2 half away from zero', () => {
    const pairs: Array<[number, number]> = [
      [60, 60],
      [60, 61],
      [60, 62],
      [60, 64],
      [60, 65],
      [60, 66],
      [60, 67],
      [60, 69],
      [60, 70],
      [60, 71],
      [60, 72],
      [72, 60],
      [62, 60],
      [61, 60],
    ];
    expect(pairs.map(([a, b]) => steps(a, b))).toEqual([
      0, 1, 1, 2, 3, 3, 4, 5, 5, 6, 6, -6, -1, -1,
    ]);
  });
});

describe('readSlice, single notes', () => {
  it('R0: a printed digit is taken and becomes the anchor', () => {
    expect(readSlice([62], new Map([[0, R0(4)]]), 1, INITIAL_PLAYER_STATE)).toEqual({
      fingers: [4],
      rules: ['R0'],
      state: st([[62, 4]], [[62, 4]]),
    });
  });
  it('R1: a repeated pitch keeps the finger', () => {
    expect(readSlice([60], none, 1, st([[60, 1]], [[60, 3]])).fingers).toEqual([3]);
  });
  it('R2: a step of one or two semitones moves to the next finger, mirrored in the left hand', () => {
    expect(readSlice([62], none, 1, st(null, [[60, 1]]))).toMatchObject({
      fingers: [2],
      rules: ['R2'],
    });
    expect(readSlice([61], none, 1, st(null, [[60, 1]])).fingers).toEqual([2]);
    expect(readSlice([58], none, 1, st(null, [[60, 2]])).fingers).toEqual([1]);
    expect(readSlice([62], none, -1, st(null, [[60, 3]])).fingers).toEqual([2]);
  });
  it('R2 falls through to R3 when the next finger does not exist', () => {
    expect(readSlice([66], none, 1, st([[65, 1]], [[64, 5]]))).toMatchObject({
      fingers: [2],
      rules: ['R3'],
    });
  });
  it('R3: other motion follows the anchor by scale steps, in both hands', () => {
    expect(readSlice([67], none, 1, st([[60, 1]], [[60, 1]])).fingers).toEqual([5]);
    expect(readSlice([65], none, 1, st([[60, 1]], [[60, 1]])).fingers).toEqual([4]);
    expect(readSlice([55], none, -1, st([[48, 5]], [[48, 5]])).fingers).toEqual([1]);
  });
  it('gives up without a position or outside 1..5, and inferred fingers never become the anchor', () => {
    expect(readSlice([60], none, 1, INITIAL_PLAYER_STATE)).toEqual({
      fingers: [null],
      rules: ['none'],
      state: INITIAL_PLAYER_STATE,
    });
    expect(readSlice([74], none, 1, st([[60, 1]], null)).fingers).toEqual([null]);
    expect(readSlice([62], none, 1, st([[60, 1]], [[60, 1]])).state).toEqual(
      st([[60, 1]], [[62, 2]]),
    );
  });
});

describe('readSlice, chords', () => {
  it('R4 fills a chord from its printed note', () => {
    expect(readSlice([60, 64, 67], new Map([[0, R0(1)]]), 1, INITIAL_PLAYER_STATE)).toEqual({
      fingers: [1, 3, 5],
      rules: ['R0', 'R4', 'R4'],
      state: st(
        [[60, 1]],
        [
          [60, 1],
          [64, 3],
          [67, 5],
        ],
      ),
    });
    // left hand in sequence order G3, E3, C3 with the C3 pinky printed
    expect(
      readSlice([55, 52, 48], new Map([[2, R0(5)]]), -1, INITIAL_PLAYER_STATE).fingers,
    ).toEqual([1, 3, 5]);
  });
  it('R4 places a chord without a printed note from the anchor', () => {
    const r = readSlice([60, 64, 67], none, 1, st([[60, 1]], null));
    expect(r.fingers).toEqual([1, 3, 5]);
    expect(r.rules).toEqual(['R4ref', 'R4ref', 'R4ref']);
    expect(r.state.ref).toEqual([{ pitch: 60, finger: 1 }]);
  });
  it('gives up on duplicated fingers and on fingers outside 1..5', () => {
    expect(readSlice([61, 62], none, 1, st([[60, 1]], null)).fingers).toEqual([null, null]);
    expect(readSlice([60, 72], new Map([[0, R0(1)]]), 1, INITIAL_PLAYER_STATE).fingers).toEqual([
      1,
      null,
    ]);
  });
});

describe('inferFingering and readHand', () => {
  it('a C major scale printed at the start and at the thumb crossing reconstructs 1 2 3 1 2 3 4 5', () => {
    const { score, assignment: full } = parsePig(
      pig(melody(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'], [1, 2, 3, 1, 2, 3, 4, 5])),
    );
    const r = ids(score, 'R');
    const { assignment, inferred, unresolved } = inferFingering(
      score,
      'R',
      pick(full, [r[0]!, r[3]!]),
    );
    expect(fingers(score, 'R', assignment)).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
    expect(inferred.size).toBe(6);
    expect(unresolved.size).toBe(0);
  });
  it('repeated keys keep the finger and steps use the neighbour (Twinkle opening)', () => {
    const { score, assignment: full } = parsePig(
      pig(melody(['C4', 'C4', 'G4', 'G4', 'A4', 'A4', 'G4'], [1, 1, 4, 4, 5, 5, 4])),
    );
    const r = ids(score, 'R');
    const { assignment } = inferFingering(score, 'R', pick(full, [r[0]!, r[2]!]));
    expect(fingers(score, 'R', assignment)).toEqual([1, 1, 4, 4, 5, 5, 4]);
  });
  it('one digit per triad, on the thumb side, in both hands', () => {
    const { score, assignment: full } = parsePig(
      pig([
        [0, 1, 'C4', 0, 1],
        [0, 1, 'E4', 0, 3],
        [0, 1, 'G4', 0, 5],
        [0, 1, 'C3', 1, -5],
        [0, 1, 'E3', 1, -3],
        [0, 1, 'G3', 1, -1],
      ]),
    );
    const r = ids(score, 'R');
    const l = ids(score, 'L'); // sequence order G3, E3, C3: the thumb side first
    expect(fingers(score, 'R', inferFingering(score, 'R', pick(full, [r[0]!])).assignment)).toEqual(
      [1, 3, 5],
    );
    expect(fingers(score, 'L', inferFingering(score, 'L', pick(full, [l[0]!])).assignment)).toEqual(
      [1, 3, 5],
    );
  });
  it('left hand: the C major scale up from C3, printed at the start and at the crossing, gives 5 4 3 2 1 3 2 1', () => {
    const { score, assignment: full } = parsePig(
      pig(melody(['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4'], [5, 4, 3, 2, 1, 3, 2, 1], 1)),
    );
    const l = ids(score, 'L');
    const { assignment } = inferFingering(score, 'L', pick(full, [l[0]!, l[5]!]));
    expect(fingers(score, 'L', assignment)).toEqual([5, 4, 3, 2, 1, 3, 2, 1]);
  });
  it('reports the notes it cannot infer', () => {
    const { score } = parsePig(pig(melody(['C4', 'D5'], [1, 5])));
    const { assignment, unresolved } = inferFingering(score, 'R', {});
    expect(assignment).toEqual({});
    expect(unresolved.size).toBe(2);
  });
  it('R5: a repeated segment is read from memory after the position moved', () => {
    // E F G A (1 2 3 4), C5 printed 3, then E F G A again: R3 from C5 would give up on E, the memory does not.
    const pitches = ['E4', 'F4', 'G4', 'A4', 'C5', 'E4', 'F4', 'G4', 'A4'];
    const { score, assignment: full } = parsePig(pig(melody(pitches, [1, 2, 3, 4, 3, 1, 2, 3, 4])));
    const r = ids(score, 'R');
    const printed = pick(full, [r[0]!, r[4]!]);
    expect(fingers(score, 'R', inferFingering(score, 'R', printed).assignment)).toEqual([
      1, 2, 3, 4, 3, 1, 2, 3, 4,
    ]);
    const rules = readHand(score, 'R', printed).rules;
    expect(r.slice(5).map((id) => rules.get(id))).toEqual(['R5', 'R5', 'R5', 'R5']);
  });
  it('R5: a printed digit inside a repeat ends the memory for the rest of it', () => {
    const pitches = ['E4', 'F4', 'G4', 'A4', 'C5', 'E4', 'F4', 'G4', 'A4'];
    const { score, assignment: full } = parsePig(pig(melody(pitches, [1, 2, 3, 4, 3, 2, 3, 4, 5])));
    const r = ids(score, 'R');
    const printed = pick(full, [r[0]!, r[4]!, r[5]!]);
    expect(fingers(score, 'R', inferFingering(score, 'R', printed).assignment)).toEqual([
      1, 2, 3, 4, 3, 2, 3, 4, 5,
    ]);
    const rules = readHand(score, 'R', printed).rules;
    expect(r.slice(6).map((id) => rules.get(id))).toEqual(['R2', 'R2', 'R2']);
  });
  it('a printed digit is kept and the next guesses continue from it, for the requested hand only', () => {
    const { score } = parsePig(
      pig([...melody(['C4', 'D4', 'E4'], [1, 2, 3]), [0, 1, 'C3', 1, -5]]),
    );
    const r = ids(score, 'R');
    const printed: Assignment = {
      [r[0]!]: { finger: 1, source: 'engine' },
      [r[1]!]: { finger: 4, source: 'user', pinned: true },
    };
    const { assignment, inferred } = inferFingering(score, 'R', printed);
    expect(assignment[r[1]!]).toEqual({ finger: 4, source: 'user', pinned: true });
    expect(assignment[r[2]!]!.finger).toBe(5);
    expect([...inferred]).toEqual([r[2]!]);
    expect(Object.keys(assignment).sort()).toEqual([...r].sort());
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @digitus2/engine exec vitest run src/readability`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the repeat detector**

`packages/engine/src/readability/repeats.ts`:

```ts
import { buildHandSequence } from '../fingering/sequence.js';
import type { SeqNote } from '../fingering/sequence.js';
import type { Assignment, Score } from '../score/types.js';

/**
 * Repeated segments of one hand (port of research/readability/repeats.py, readability study
 * section 4): at least MIN_REPEAT_EVENTS consecutive events matching an earlier segment up to one
 * constant transposition, with the same note durations and inter-onset intervals.
 */
export const MIN_REPEAT_EVENTS = 4;
export const REPEAT_GRID = 48;
export const MAX_REPEAT_CANDIDATES = 64;

export interface Occurrence {
  first: number;
  later: number;
  length: number;
  shift: number;
}

export function handSlices(notes: readonly SeqNote[]): SeqNote[][] {
  const out: SeqNote[][] = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && last[0]!.slice === n.slice) last.push(n);
    else out.push([n]);
  }
  return out;
}

export function eventTokens(
  score: Score,
  slices: readonly (readonly SeqNote[])[],
): { shape: number[]; link: number[]; low: number[] } {
  const byId = new Map(score.notes.map((n) => [n.id, n]));
  const q = (ticks: number) => Math.round((ticks / score.divisions) * REPEAT_GRID);
  const ids = new Map<string, number>();
  const id = (key: string) => {
    let v = ids.get(key);
    if (v === undefined) {
      v = ids.size;
      ids.set(key, v);
    }
    return v;
  };
  const shape: number[] = [];
  const link: number[] = [];
  const low: number[] = [];
  let prevLow: number | null = null;
  let prevOnset = 0;
  for (const slice of slices) {
    const notes = slice.map((s) => byId.get(s.noteId)!).sort((a, b) => a.midi - b.midi);
    const lo = notes[0]!.midi;
    const onset = notes[0]!.onsetTick;
    const sid = id(
      `s|${notes.map((n) => n.midi - lo).join(',')}|${notes.map((n) => q(n.offsetTick - n.onsetTick)).join(',')}`,
    );
    link.push(prevLow === null ? -1 : id(`l|${sid}|${lo - prevLow}|${q(onset - prevOnset)}`));
    shape.push(sid);
    low.push(lo);
    prevLow = lo;
    prevOnset = onset;
  }
  return { shape, link, low };
}

export function findRepeats(
  score: Score,
  slices: readonly (readonly SeqNote[])[],
  minLen = MIN_REPEAT_EVENTS,
  maxCandidates = MAX_REPEAT_CANDIDATES,
): Occurrence[] {
  const n = slices.length;
  if (n < 2 * minLen) return [];
  const { shape, link, low } = eventTokens(score, slices);
  const table = new Map<string, number[]>();
  const out: Occurrence[] = [];
  let j = 0;
  while (j + minLen <= n) {
    const key = [shape[j]!, ...link.slice(j + 1, j + minLen)].join(' ');
    let bestLen = 0;
    let bestI = -1;
    for (const i of (table.get(key) ?? []).slice(0, maxCandidates)) {
      if (i + minLen > j) break;
      const limit = Math.min(j - i, n - j);
      let len = minLen;
      while (len < limit && link[i + len] === link[j + len]) len++;
      if (len > bestLen) {
        bestLen = len;
        bestI = i;
      }
    }
    if (bestLen >= minLen) {
      out.push({ first: bestI, later: j, length: bestLen, shift: low[j]! - low[bestI]! });
      j += bestLen;
    } else {
      const list = table.get(key);
      if (list) list.push(j);
      else table.set(key, [j]);
      j++;
    }
  }
  return out;
}

export function rootMap(nEvents: number, occs: readonly Occurrence[]): number[] {
  const root = Array.from({ length: nEvents }, (_, i) => i);
  for (const o of [...occs].sort((a, b) => a.later - b.later))
    for (let t = 0; t < o.length; t++) root[o.later + t] = root[o.first + t]!;
  return root;
}

export function occurrenceIndex(nEvents: number, occs: readonly Occurrence[]): number[] {
  const occ = new Array<number>(nEvents).fill(-1);
  occs.forEach((o, k) => {
    for (let t = 0; t < o.length; t++) occ[o.later + t] = k;
  });
  return occ;
}

export function repeatConsistency(
  score: Score,
  assignment: Assignment,
): { segments: number; identical: number; percent: number } {
  let segments = 0;
  let identical = 0;
  for (const hand of ['R', 'L'] as const) {
    const slices = handSlices(buildHandSequence(score, hand).notes);
    for (const o of findRepeats(score, slices)) {
      segments++;
      let same = true;
      for (let t = 0; t < o.length && same; t++) {
        const a = slices[o.first + t]!;
        const b = slices[o.later + t]!;
        same =
          a.length === b.length &&
          a.every((x, i) => assignment[x.noteId]?.finger === assignment[b[i]!.noteId]?.finger);
      }
      if (same) identical++;
    }
  }
  return { segments, identical, percent: segments === 0 ? 100 : (100 * identical) / segments };
}
```

- [ ] **Step 4: Implement the player model**

`packages/engine/src/readability/playerModel.ts`:

```ts
import { buildHandSequence } from '../fingering/sequence.js';
import type { Assignment, Finger, Hand, Score } from '../score/types.js';
import { findRepeats, handSlices, occurrenceIndex, rootMap } from './repeats.js';

/**
 * The validated forward reader of the readability study (docs/research/readability.md 5.1, 7.1;
 * port of research/readability/player_model.py) plus the R5 repeat memory. Verification spec 3.6,
 * amendment of 2026-10-14. readSlice is shared with the reduction, which makes inferability 100
 * by construction.
 */
export type ReaderRule = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R4ref' | 'R5' | 'none';
export interface Pitched {
  pitch: number;
  finger: Finger;
}
export interface PlayerState {
  ref: readonly Pitched[] | null;
  prev: readonly Pitched[] | null;
}
export const INITIAL_PLAYER_STATE: PlayerState = { ref: null, prev: null };
export interface Seen {
  finger: Finger;
  rule: 'R0' | 'R5';
}
export interface SliceReading {
  fingers: Array<Finger | null>;
  rules: ReaderRule[];
  state: PlayerState;
}

export function steps(a: number, b: number): number {
  const d = b - a;
  const m = Math.floor((Math.abs(d) + 1) / 2);
  return d >= 0 ? m : -m;
}

export function handSign(hand: Hand): 1 | -1 {
  return hand === 'R' ? 1 : -1;
}

export function nearest(pairs: readonly Pitched[], pitch: number): Pitched {
  let best = pairs[0]!;
  for (const p of pairs) {
    const d = Math.abs(p.pitch - pitch);
    const bd = Math.abs(best.pitch - pitch);
    if (d < bd || (d === bd && p.pitch < best.pitch)) best = p;
  }
  return best;
}

function asFinger(f: number): Finger | null {
  return Number.isInteger(f) && f >= 1 && f <= 5 ? (f as Finger) : null;
}

function readSingle(q: number, v: Seen | undefined, s: 1 | -1, state: PlayerState): SliceReading {
  if (v) {
    const me = [{ pitch: q, finger: v.finger }];
    return { fingers: [v.finger], rules: [v.rule], state: { ref: me, prev: me } };
  }
  let f: Finger | null = null;
  let rule: ReaderRule = 'none';
  if (state.prev) {
    const p = nearest(state.prev, q);
    const d = q - p.pitch;
    if (d === 0) {
      f = p.finger;
      rule = 'R1';
    } else if (Math.abs(d) <= 2) {
      const g = asFinger(p.finger + s * Math.sign(d));
      if (g) {
        f = g;
        rule = 'R2';
      }
    }
  }
  if (f === null && state.ref) {
    const r = nearest(state.ref, q);
    const g = asFinger(r.finger + s * steps(r.pitch, q));
    if (g) {
      f = g;
      rule = 'R3';
    }
  }
  return {
    fingers: [f],
    rules: [rule],
    state: { ref: state.ref, prev: f === null ? null : [{ pitch: q, finger: f }] },
  };
}

function readChord(
  midis: readonly number[],
  seen: ReadonlyMap<number, Seen>,
  s: 1 | -1,
  state: PlayerState,
): SliceReading {
  const vis: Pitched[] = [];
  seen.forEach((v, i) => vis.push({ pitch: midis[i]!, finger: v.finger }));
  const fingers: Array<Finger | null> = [];
  const rules: ReaderRule[] = [];
  midis.forEach((q, i) => {
    const v = seen.get(i);
    if (v) {
      fingers.push(v.finger);
      rules.push(v.rule);
      return;
    }
    const from = vis.length > 0 ? nearest(vis, q) : state.ref ? nearest(state.ref, q) : null;
    const g = from ? asFinger(from.finger + s * steps(from.pitch, q)) : null;
    fingers.push(g);
    rules.push(g === null ? 'none' : vis.length > 0 ? 'R4' : 'R4ref');
  });
  const count = new Map<Finger, number>();
  for (const f of fingers) if (f !== null) count.set(f, (count.get(f) ?? 0) + 1);
  fingers.forEach((f, i) => {
    if (f !== null && !seen.has(i) && count.get(f)! > 1) {
      fingers[i] = null;
      rules[i] = 'none';
    }
  });
  const known: Pitched[] = [];
  midis.forEach((q, i) => {
    const f = fingers[i];
    if (f) known.push({ pitch: q, finger: f });
  });
  return {
    fingers,
    rules,
    state: { ref: vis.length > 0 ? vis : state.ref, prev: known.length > 0 ? known : null },
  };
}

export function readSlice(
  midis: readonly number[],
  seen: ReadonlyMap<number, Seen>,
  s: 1 | -1,
  state: PlayerState,
): SliceReading {
  return midis.length === 1
    ? readSingle(midis[0]!, seen.get(0), s, state)
    : readChord(midis, seen, s, state);
}

export function memoryFor(
  e: number,
  size: number,
  hasPrinted: boolean,
  root: readonly number[],
  occ: readonly number[],
  broken: Set<number>,
  resolved: ReadonlyArray<ReadonlyArray<Finger | null>>,
): ReadonlyArray<Finger | null> | null {
  const k = occ[e]!;
  if (k < 0) return null;
  if (hasPrinted) {
    broken.add(k);
    return null;
  }
  if (broken.has(k)) return null;
  const r = root[e]!;
  const remembered = resolved[r];
  return r !== e && remembered && remembered.length === size ? remembered : null;
}

export interface HandReading {
  fingers: Map<string, Finger | null>;
  rules: Map<string, ReaderRule>;
}

export function readHand(score: Score, hand: Hand, printed: Partial<Assignment>): HandReading {
  const slices = handSlices(buildHandSequence(score, hand).notes);
  const occs = findRepeats(score, slices);
  const root = rootMap(slices.length, occs);
  const occ = occurrenceIndex(slices.length, occs);
  const s = handSign(hand);
  const broken = new Set<number>();
  const resolved: Array<Array<Finger | null>> = [];
  const out: HandReading = { fingers: new Map(), rules: new Map() };
  let state = INITIAL_PLAYER_STATE;
  slices.forEach((slice, e) => {
    const seen = new Map<number, Seen>();
    slice.forEach((n, i) => {
      const p = printed[n.noteId];
      if (p) seen.set(i, { finger: p.finger, rule: 'R0' });
    });
    const memory = memoryFor(e, slice.length, seen.size > 0, root, occ, broken, resolved);
    memory?.forEach((f, i) => {
      if (f !== null && !seen.has(i)) seen.set(i, { finger: f, rule: 'R5' });
    });
    const reading = readSlice(
      slice.map((n) => n.midi),
      seen,
      s,
      state,
    );
    slice.forEach((n, i) => {
      out.fingers.set(n.noteId, reading.fingers[i]!);
      out.rules.set(n.noteId, reading.rules[i]!);
    });
    resolved.push(reading.fingers);
    state = reading.state;
  });
  return out;
}

export function inferFingering(
  score: Score,
  hand: Hand,
  printed: Partial<Assignment>,
): { assignment: Assignment; inferred: Set<string>; unresolved: Set<string> } {
  const assignment: Assignment = {};
  const inferred = new Set<string>();
  const unresolved = new Set<string>();
  for (const [id, f] of readHand(score, hand, printed).fingers) {
    const p = printed[id];
    if (p) assignment[id] = p;
    else if (f === null) unresolved.add(id);
    else {
      assignment[id] = { finger: f, source: 'engine' };
      inferred.add(id);
    }
  }
  return { assignment, inferred, unresolved };
}
```

(`reading.fingers[i]!` is `Finger | null`; the non-null assertion only removes `undefined` from the indexed access.)

Add to `packages/engine/src/index.ts`:

```ts
export {
  eventTokens,
  findRepeats,
  handSlices,
  MAX_REPEAT_CANDIDATES,
  MIN_REPEAT_EVENTS,
  occurrenceIndex,
  repeatConsistency,
  REPEAT_GRID,
  rootMap,
} from './readability/repeats.js';
export type { Occurrence } from './readability/repeats.js';
export {
  handSign,
  inferFingering,
  INITIAL_PLAYER_STATE,
  memoryFor,
  nearest,
  readHand,
  readSlice,
  steps,
} from './readability/playerModel.js';
export type {
  HandReading,
  Pitched,
  PlayerState,
  ReaderRule,
  Seen,
  SliceReading,
} from './readability/playerModel.js';
```

- [ ] **Step 5: Cross-check against the Python reference**

Write a throwaway script in your temp directory (not in the repo) that builds, for the C major scale, the Twinkle opening, the two triads and the R5 motif above, the `NoteRec` lists `research/readability/player_model.py` expects, and prints `infer_hand(notes, visible)` with the same visible digits; run it with `research/.venv-readability/Scripts/python.exe -X utf8` from `research/`. Every finger and rule must agree with the TypeScript tests, except the R5 cases, which the Python reader does not model on the reading side (its R5 lives in `reduce.py`). Report the comparison in one line per case.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @digitus2/engine exec vitest run src/readability && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: PASS. A failing hand-computed case is checked against the rule table in "The player model and the reduction" and the Python reference before any code change; the table is the contract.

- [ ] **Step 7: Run the whole loop**

Run: `pnpm verify`
Expected: all PASS.

---

### Task 1: The minimal-sufficient reduction (engine)

**Files:**

- Create: `packages/engine/src/readability/reduce.ts`, `packages/engine/src/readability/reduce.test.ts`
- Modify: `packages/engine/src/index.ts` (exports)

**Interfaces:**

- Consumes: Task 0 (`readSlice`, `memoryFor`, `handSign`, `INITIAL_PLAYER_STATE`, `inferFingering`, `findRepeats`, `rootMap`, `occurrenceIndex`, `handSlices`), `buildHandSequence`, `solveFingering` and `RECOMMENDED_WEIGHT_SET` (tests only). Reference: `research/readability/reduce.py` (`minimal_sufficient`).
- Produces:

```ts
export type ReduceReason = 'pinned' | 'first' | 'lowConfidence' | 'requested' | 'mismatch';
export const REDUCE_REASONS: readonly ReduceReason[]; // the precedence order above
export const DEFAULT_CONFIDENCE_FLOOR: number; // 0.6
export interface ReduceOptions {
  confidenceFloor?: number;
  alwaysPrint?: ReadonlySet<string>; // note ids a caller wants printed (reason 'requested'); empty by default, unused by the app
}
export interface ReduceResult {
  printed: Set<string>;
  reasons: Record<string, ReduceReason>; // one entry per printed note
  notes: number; // notes with an entry in `full`
  density: number; // percent printed
  inferability: number; // percent of unprinted fingers inferFingering reconstructs
  unresolved: number; // unprinted notes the reader cannot infer at all (0 by construction)
  fromMemory: number; // unprinted notes the reader takes from an earlier statement (R5)
}
export function reduceFingering(score: Score, full: Assignment, opts?: ReduceOptions): ReduceResult;
```

The reduction prints, before reading a slice, the `pinned`, `first`, `lowConfidence` and `requested` notes, then the first note in sequence order (thumb side first) that the reader gets wrong or cannot infer (`mismatch`), slice by slice, until every unprinted note reads right. There are no other triggers (verification spec 3.6, amendment of 2026-10-14). One difference from `reduce.py`: the study adds "the lowest wrong note" by note index, which is the lowest pitch in both hands; this port takes the first wrong note in sequence order, which is the thumb side in both hands, as the study's section 7.2 recommends for chords.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/readability/reduce.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RECOMMENDED_WEIGHT_SET } from '../fingering/params/weightSets.js';
import { buildHandSequence } from '../fingering/sequence.js';
import { solveFingering } from '../fingering/solve.js';
import { parsePig } from '../io/pig/read.js';
import type { Assignment, Hand, Score } from '../score/types.js';
import { inferFingering } from './playerModel.js';
import { reduceFingering } from './reduce.js';

const H = '//Version: PianoFingering_v170101\n';
type Row = [number, number, string, 0 | 1, number];
const pig = (rows: Row[]) =>
  H +
  [...rows]
    .sort((a, b) => a[0] - b[0])
    .map(([on, off, p, ch, f], i) => `${i}\t${on}\t${off}\t${p}\t80\t80\t${ch}\t${f}`)
    .join('\n') +
  '\n';
const melody = (pitches: string[], fingers: number[], ch: 0 | 1 = 0, dur = 0.5): Row[] =>
  pitches.map((p, i) => [i * dur, (i + 1) * dur, p, ch, ch === 1 ? -fingers[i]! : fingers[i]!]);
const ids = (score: Score, hand: Hand) => buildHandSequence(score, hand).notes.map((n) => n.noteId);
const SCALE = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];

describe('reduceFingering on hand-made passages', () => {
  it('prints only the first note and the thumb crossing of a C major scale, up and down', () => {
    const up = parsePig(pig(melody(SCALE, [1, 2, 3, 1, 2, 3, 4, 5])));
    const ru = ids(up.score, 'R');
    const a = reduceFingering(up.score, up.assignment);
    expect(a.reasons).toEqual({ [ru[0]!]: 'first', [ru[3]!]: 'mismatch' });
    expect(a).toMatchObject({
      notes: 8,
      density: 25,
      inferability: 100,
      unresolved: 0,
      fromMemory: 0,
    });

    const down = parsePig(pig(melody([...SCALE].reverse(), [5, 4, 3, 2, 1, 3, 2, 1])));
    const rd = ids(down.score, 'R');
    expect(reduceFingering(down.score, down.assignment).reasons).toEqual({
      [rd[0]!]: 'first',
      [rd[5]!]: 'mismatch',
    });
  });

  it('prints where the reader would guess another finger or none, and nowhere else', () => {
    const cases: Array<[string[], number[], number[]]> = [
      [['C4', 'D5'], [1, 5], [1]], // a leap out of the position: R3 gives up
      [['C4', 'D4', 'E4', 'G4'], [1, 2, 3, 2], [3]], // a position choice the reader makes differently
      [['C4', 'C4'], [1, 2], [1]], // a finger change on a repeated key
    ];
    for (const [pitches, fingers, expected] of cases) {
      const { score, assignment } = parsePig(pig(melody(pitches, fingers)));
      const r = ids(score, 'R');
      expect(reduceFingering(score, assignment).reasons, pitches.join(' ')).toEqual({
        [r[0]!]: 'first',
        ...Object.fromEntries(expected.map((k) => [r[k]!, 'mismatch'])),
      });
    }
  });

  it('a rest is not a trigger: the reader keeps the position across it', () => {
    const { score, assignment } = parsePig(
      pig([
        [0, 0.5, 'C4', 0, 1],
        [2.5, 3, 'E4', 0, 3],
      ]),
    );
    expect([...reduceFingering(score, assignment).printed]).toEqual([ids(score, 'R')[0]!]);
  });

  it('prints one digit per chord, on the thumb side, and more only where chord fill fails', () => {
    const twice = parsePig(
      pig([
        [0, 1, 'C4', 0, 1],
        [0, 1, 'E4', 0, 3],
        [0, 1, 'G4', 0, 5],
        [1, 2, 'C4', 0, 1],
        [1, 2, 'E4', 0, 3],
        [1, 2, 'G4', 0, 5],
      ]),
    );
    const rt = ids(twice.score, 'R');
    const t = reduceFingering(twice.score, twice.assignment);
    expect(t.reasons).toEqual({ [rt[0]!]: 'first' });
    expect(t.density).toBeCloseTo(100 / 6, 9);

    const moved = parsePig(
      pig([
        [0, 1, 'G4', 0, 5],
        [1, 2, 'D4', 0, 1],
        [1, 2, 'F4', 0, 3],
        [1, 2, 'A4', 0, 5],
      ]),
    );
    const rm = ids(moved.score, 'R');
    expect(reduceFingering(moved.score, moved.assignment).reasons).toEqual({
      [rm[0]!]: 'first',
      [rm[1]!]: 'mismatch',
    });

    const fchord = parsePig(
      pig([
        [0, 1, 'C4', 0, 1],
        [0, 1, 'F4', 0, 2],
        [0, 1, 'A4', 0, 4],
      ]),
    );
    const rf = ids(fchord.score, 'R');
    expect(reduceFingering(fchord.score, fchord.assignment).reasons).toEqual({
      [rf[0]!]: 'first',
      [rf[1]!]: 'mismatch',
    });

    const left = parsePig(
      pig([
        [0, 1, 'C3', 1, -5],
        [0, 1, 'E3', 1, -3],
        [0, 1, 'G3', 1, -1],
      ]),
    );
    const l = ids(left.score, 'L'); // G3 first: the left thumb side
    expect(reduceFingering(left.score, left.assignment).reasons).toEqual({ [l[0]!]: 'first' });
  });

  it('prints pinned, low-confidence and requested notes, with pinned taking precedence over first', () => {
    const { score, assignment: full } = parsePig(pig(melody(SCALE, [1, 2, 3, 1, 2, 3, 4, 5])));
    const r = ids(score, 'R');
    const edited: Assignment = {
      ...full,
      [r[0]!]: { ...full[r[0]!]!, pinned: true, source: 'user' },
      [r[1]!]: { ...full[r[1]!]!, pinned: true, source: 'user' },
      [r[2]!]: { ...full[r[2]!]!, confidence: 0.5 },
      [r[4]!]: { ...full[r[4]!]!, confidence: 0.7 },
    };
    const a = reduceFingering(score, edited, { alwaysPrint: new Set([r[5]!]) });
    expect(a.reasons).toEqual({
      [r[0]!]: 'pinned',
      [r[1]!]: 'pinned',
      [r[2]!]: 'lowConfidence',
      [r[3]!]: 'mismatch',
      [r[5]!]: 'requested',
    });
    expect(reduceFingering(score, edited, { confidenceFloor: 0.8 }).reasons[r[4]!]).toBe(
      'lowConfidence',
    );
  });

  it('takes a repeated segment from memory', () => {
    const pitches = ['E4', 'F4', 'G4', 'A4', 'C5', 'E4', 'F4', 'G4', 'A4'];
    const { score, assignment } = parsePig(pig(melody(pitches, [1, 2, 3, 4, 3, 1, 2, 3, 4])));
    const r = ids(score, 'R');
    const red = reduceFingering(score, assignment);
    expect(red.reasons).toEqual({ [r[0]!]: 'first', [r[4]!]: 'mismatch' });
    expect(red.fromMemory).toBe(4);
    expect(red.inferability).toBe(100);
  });

  it('a repeat fingered differently gets a digit where it differs, and the reader continues normally after it', () => {
    const pitches = ['E4', 'F4', 'G4', 'A4', 'C5', 'E4', 'F4', 'G4', 'A4'];
    const { score, assignment } = parsePig(pig(melody(pitches, [1, 2, 3, 4, 3, 2, 3, 4, 5])));
    const r = ids(score, 'R');
    const red = reduceFingering(score, assignment);
    expect(red.reasons).toEqual({ [r[0]!]: 'first', [r[4]!]: 'mismatch', [r[5]!]: 'mismatch' });
    expect(red.fromMemory).toBe(0);
    expect(red.inferability).toBe(100);
  });

  it('is deterministic and ignores notes without a finger', () => {
    const { score, assignment: full } = parsePig(pig(melody(SCALE, [1, 2, 3, 1, 2, 3, 4, 5])));
    const a = reduceFingering(score, full);
    const b = reduceFingering(score, full);
    expect([...a.printed].sort()).toEqual([...b.printed].sort());
    expect(a.reasons).toEqual(b.reasons);
    const r = ids(score, 'R');
    const partial: Assignment = Object.fromEntries(
      Object.entries(full).filter(([id]) => id !== r[6]),
    );
    const c = reduceFingering(score, partial);
    expect(c.notes).toBe(7);
    expect(c.printed.has(r[6]!)).toBe(false);
    expect(c.inferability).toBe(100);
  });
});

/** A seeded generator so the property test is reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nameOf = (m: number) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

/** Both hands, single notes and chords of 2 to 4 notes, rests, repeated motifs, random (often absurd) fingers. */
function randomPiece(seed: number): string {
  const rnd = lcg(seed);
  const rows: Row[] = [];
  for (const ch of [0, 1] as const) {
    let t = 0;
    let p = ch === 0 ? 67 : 48;
    const motif: Array<{ pitches: number[]; dur: number }> = [];
    for (let s = 0; s < 40; s++) {
      let event: { pitches: number[]; dur: number };
      if (motif.length >= 4 && rnd() < 0.2) {
        event = motif[s % motif.length]!; // re-use earlier material so repeats occur
      } else {
        const size = rnd() < 0.7 ? 1 : 2 + Math.floor(rnd() * 3);
        const dur = [0.25, 0.5, 1][Math.floor(rnd() * 3)]!;
        p = Math.max(
          ch === 0 ? 55 : 31,
          Math.min(ch === 0 ? 84 : 60, p + Math.floor(rnd() * 15) - 7),
        );
        const pitches: number[] = [];
        let q = p;
        while (pitches.length < size) {
          pitches.push(q);
          q += 1 + Math.floor(rnd() * 4);
        }
        event = { pitches, dur };
        if (motif.length < 6) motif.push(event);
      }
      for (const m of event.pitches) {
        const f = 1 + Math.floor(rnd() * 5);
        rows.push([+t.toFixed(4), +(t + event.dur).toFixed(4), nameOf(m), ch, ch === 1 ? -f : f]);
      }
      t += event.dur + (rnd() < 0.15 ? 1 + rnd() * 2 : 0);
    }
  }
  return pig(rows);
}

describe('inferability by construction', () => {
  it('inferability is 100 on random fingerings, even nonsensical ones', () => {
    const wrong: string[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const { score, assignment: full } = parsePig(randomPiece(seed));
      const r = reduceFingering(score, full);
      if (r.inferability !== 100 || r.unresolved !== 0)
        wrong.push(`seed ${seed}: inferability ${r.inferability}, unresolved ${r.unresolved}`);
      const printed = Object.fromEntries([...r.printed].map((id) => [id, full[id]!]));
      for (const hand of ['R', 'L'] as const) {
        const { assignment, unresolved } = inferFingering(score, hand, printed);
        if (unresolved.size > 0)
          wrong.push(`seed ${seed}: ${unresolved.size} unresolved in ${hand}`);
        for (const n of score.notes)
          if (n.hand === hand && assignment[n.id]?.finger !== full[n.id]!.finger)
            wrong.push(`seed ${seed}: note ${n.id}`);
      }
      for (const id of r.printed)
        if (!r.reasons[id]) wrong.push(`seed ${seed}: no reason for ${id}`);
    }
    expect(wrong).toEqual([]);
  });

  it('PIG fixture: inferability 100 with the annotator fingering and with the engine fingering', () => {
    const text = readFileSync(
      fileURLToPath(new URL('../../fixtures/pig-sample.txt', import.meta.url)),
      'utf8',
    );
    const { score, assignment } = parsePig(text);
    const human = reduceFingering(score, assignment);
    expect(human.inferability).toBe(100);
    expect(human.notes).toBe(score.notes.length);
    const engine = solveFingering(score, { weightSet: RECOMMENDED_WEIGHT_SET });
    const r = reduceFingering(score, engine.assignment);
    expect(r.inferability).toBe(100);
    expect(r.unresolved).toBe(0);
    expect(r.density).toBeGreaterThan(0);
    expect(r.density).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @digitus2/engine exec vitest run src/readability/reduce.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`packages/engine/src/readability/reduce.ts`:

```ts
import { buildHandSequence } from '../fingering/sequence.js';
import type { Assignment, Finger, Score } from '../score/types.js';
import {
  handSign,
  inferFingering,
  INITIAL_PLAYER_STATE,
  memoryFor,
  readSlice,
} from './playerModel.js';
import type { Seen, SliceReading } from './playerModel.js';
import { findRepeats, handSlices, occurrenceIndex, rootMap } from './repeats.js';

export type ReduceReason = 'pinned' | 'first' | 'lowConfidence' | 'requested' | 'mismatch';
export const REDUCE_REASONS: readonly ReduceReason[] = [
  'pinned',
  'first',
  'lowConfidence',
  'requested',
  'mismatch',
];
export const DEFAULT_CONFIDENCE_FLOOR = 0.6;

export interface ReduceOptions {
  confidenceFloor?: number;
  alwaysPrint?: ReadonlySet<string>;
}
export interface ReduceResult {
  printed: Set<string>;
  reasons: Record<string, ReduceReason>;
  notes: number;
  density: number;
  inferability: number;
  unresolved: number;
  fromMemory: number;
}

/**
 * Minimal-sufficient reduction (verification spec 3.6, amendment of 2026-10-14; port of
 * research/readability/reduce.py): a greedy forward pass that prints a digit only where the
 * reader of playerModel.ts, with the digits printed so far, would infer another finger or none.
 */
export function reduceFingering(
  score: Score,
  full: Assignment,
  opts: ReduceOptions = {},
): ReduceResult {
  const floor = opts.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR;
  const scored: Score = { ...score, notes: score.notes.filter((n) => full[n.id] !== undefined) };
  const printed = new Set<string>();
  const reasons: Record<string, ReduceReason> = {};
  let fromMemory = 0;

  for (const hand of ['R', 'L'] as const) {
    const slices = handSlices(buildHandSequence(scored, hand).notes);
    const occs = findRepeats(scored, slices);
    const root = rootMap(slices.length, occs);
    const occ = occurrenceIndex(slices.length, occs);
    const s = handSign(hand);
    const broken = new Set<number>();
    const resolved: Finger[][] = [];
    let state = INITIAL_PLAYER_STATE;
    slices.forEach((slice, e) => {
      const midis = slice.map((n) => n.midi);
      const truth = slice.map((n) => full[n.noteId]!.finger);
      const forced = new Map<number, ReduceReason>();
      const force = (i: number, why: ReduceReason) => {
        const cur = forced.get(i);
        if (cur === undefined || REDUCE_REASONS.indexOf(why) < REDUCE_REASONS.indexOf(cur))
          forced.set(i, why);
      };
      slice.forEach((n, i) => {
        const a = full[n.noteId]!;
        if (a.pinned) force(i, 'pinned');
        if (a.confidence !== undefined && a.confidence < floor) force(i, 'lowConfidence');
        if (opts.alwaysPrint?.has(n.noteId)) force(i, 'requested');
      });
      if (e === 0) force(0, 'first');
      let reading: SliceReading;
      for (;;) {
        const seen = new Map<number, Seen>();
        for (const i of forced.keys()) seen.set(i, { finger: truth[i]!, rule: 'R0' });
        const memory = memoryFor(e, slice.length, forced.size > 0, root, occ, broken, resolved);
        memory?.forEach((f, i) => {
          if (f !== null && !seen.has(i)) seen.set(i, { finger: f, rule: 'R5' });
        });
        reading = readSlice(midis, seen, s, state);
        const miss = reading.fingers.findIndex((f, i) => !forced.has(i) && f !== truth[i]);
        if (miss < 0) break;
        forced.set(miss, 'mismatch');
      }
      for (const [i, why] of forced) {
        printed.add(slice[i]!.noteId);
        reasons[slice[i]!.noteId] = why;
      }
      fromMemory += reading.rules.filter((r) => r === 'R5').length;
      resolved.push(truth);
      state = reading.state;
    });
  }

  // Measure what the construction promises: the printed digits reconstruct every other finger.
  const subset: Assignment = {};
  for (const id of printed) subset[id] = full[id]!;
  let unprinted = 0;
  let correct = 0;
  let unresolved = 0;
  for (const hand of ['R', 'L'] as const) {
    const inferredHand = inferFingering(scored, hand, subset);
    unresolved += inferredHand.unresolved.size;
    for (const n of scored.notes) {
      if (n.hand !== hand || printed.has(n.id)) continue;
      unprinted++;
      if (inferredHand.assignment[n.id]?.finger === full[n.id]!.finger) correct++;
    }
  }
  const notes = scored.notes.length;
  return {
    printed,
    reasons,
    notes,
    density: notes === 0 ? 0 : (100 * printed.size) / notes,
    inferability: unprinted === 0 ? 100 : (100 * correct) / unprinted,
    unresolved,
    fromMemory,
  };
}
```

The reduction must build the seen digits exactly as `readHand` does (printed first, then the R5 memory for the remaining ranks, through the same `memoryFor`) and must carry the reader's own `state` forward, never a state rebuilt from the true fingers: `ref` only moves on seen digits, so the two differ.

Add to `packages/engine/src/index.ts`:

```ts
export { DEFAULT_CONFIDENCE_FLOOR, REDUCE_REASONS, reduceFingering } from './readability/reduce.js';
export type { ReduceOptions, ReduceReason, ReduceResult } from './readability/reduce.js';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @digitus2/engine exec vitest run src/readability && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: PASS. If the random test reports a seed, it is a real defect in the symmetry between `reduceFingering` and `readHand` (same seen digits, same memory, same state); fix the code, never the seed range.

- [ ] **Step 5: Run the whole loop**

Run: `pnpm verify`
Expected: all PASS.

---

### Task 2: Readability report, the library gate, the bench row and the floors (engine)

**Files:**

- Create: `packages/engine/src/eval/readability.ts`, `packages/engine/src/eval/readability.test.ts`, `packages/engine/src/readability/library.test.ts`
- Modify: `packages/engine/cli/bench.ts`, `packages/engine/cli/bench.test.ts`, `packages/engine/src/index.ts`, `benchmarks/floor.json`, `docs/verification-loop.md` (one paragraph), `docs/experiments.md` (dated M5 entry)

**Interfaces:**

- Consumes: `reduceFingering` (Task 1), `repeatConsistency`, `readHand`-based `inferFingering` (Task 0), `solveFingering` with `weightSet`, `level`, `profile`; `parseMusicXml`; `content/manifest.json` (array of `{ slug, level, files: { score, fingered } }`, paths relative to `content/`).
- Produces:

```ts
// src/eval/readability.ts
export interface ReadabilityReport {
  notes: number;
  printed: number;
  density: number; // percent of notes printed after the reduction
  inferability: number; // percent of unprinted fingers the player model reconstructs
  unresolved: number; // unprinted notes the reader cannot infer (0 by construction)
  repeatSegments: number; // later occurrences of repeated segments, both hands
  repeatConsistency: number; // percent of them the fingering plays like their first statement (100 when none)
  editorNotes?: number; // notes the editor fingered (when an editorial assignment is given and non-empty)
  editorDensity?: number; // 100 * editorNotes / notes
  agreementWithEditor?: number; // percent of editor-fingered notes where the engine's finger equals the editor's
}
export function readabilityReport(
  score: Score,
  assignment: Assignment,
  editorial?: Assignment,
  opts?: ReduceOptions,
): ReadabilityReport;
export function rekeyAssignment(from: Score, a: Assignment, to: Score): Assignment | null;
// maps a's note ids from `from` onto `to` by note index; null when the note counts, pitches or onsets differ

// cli/bench.ts additions
export const READABILITY_PROFILE: HandProfileId; // 'medium': the app's default hand
export const READABILITY_LEVEL: 'beginner'; // the app's default level
export interface LibraryPieceReadability {
  slug: string;
  level: number;
  notes: number;
  density: number;
  inferability: number;
  unresolved: number;
  repeatSegments: number;
  repeatConsistency: number;
  editorDensity?: number;
  agreementWithEditor?: number;
}
export interface LibraryReadability {
  corpus: string;
  profile: HandProfileId;
  level: 'beginner' | 'expert';
  pieces: number;
  density: number; // mean over pieces (reported)
  inferability: number; // mean over pieces
  repeatConsistency: number; // mean over pieces (reported, not gated in M5)
  byLevel: Record<string, number>; // mean density per library level '1'..'5'
  editor: { pieces: number; editorDensity: number; agreementWithEditor: number } | null;
  perPiece: LibraryPieceReadability[];
}
export function libraryReadability(
  content: string,
  weightSet: WeightSetId | WeightSetFile,
): LibraryReadability | null; // null when <content>/manifest.json is missing
export interface BenchOptions {
  /* M2 and M3 fields */ content?: string;
} // default 'content'
export interface PieceResult {
  /* M2 fields */ density: number;
  inferability: number;
} // the PIG piece's own reduction, reported only
export interface Scorecard {
  /* M2 and M3 fields */ readability?: LibraryReadability;
}
```

The gated readability row is computed on the built-in library, not on the PIG pieces: the floors are per library level, the library is the app's audience, it ships with the repo (no dataset needed) and it is licence-clean. It uses the app's defaults (medium hand, beginner level) and the run's weight set. The gate is per piece: each piece's density at or under its level's floor, inferability 100 with nothing unresolved, and, for the 8 pieces with an editor's fingering, density at or under the editor's density on that piece. PIG pieces carry their own `density` and `inferability` in `PieceResult`, reported only.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/eval/readability.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildHandSequence } from '../fingering/sequence.js';
import { parsePig } from '../io/pig/read.js';
import type { Assignment } from '../score/types.js';
import { readabilityReport, rekeyAssignment } from './readability.js';

const H = '//Version: PianoFingering_v170101\n';
const scale = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const text =
  H +
  scale
    .map(
      (p, i) =>
        `${i}\t${i * 0.5}\t${(i + 1) * 0.5}\t${p}\t80\t80\t0\t${[1, 2, 3, 1, 2, 3, 4, 5][i]}`,
    )
    .join('\n') +
  '\n';

describe('readabilityReport', () => {
  it('reports density, inferability and repeats, and compares with an editor on the notes the editor fingered', () => {
    const { score, assignment } = parsePig(text);
    const ids = buildHandSequence(score, 'R').notes.map((n) => n.noteId);
    const editorial: Assignment = {
      [ids[0]!]: { finger: 1, source: 'editorial' },
      [ids[3]!]: { finger: 2, source: 'editorial' },
    };
    expect(readabilityReport(score, assignment, editorial)).toEqual({
      notes: 8,
      printed: 2,
      density: 25,
      inferability: 100,
      unresolved: 0,
      repeatSegments: 0,
      repeatConsistency: 100,
      editorNotes: 2,
      editorDensity: 25,
      agreementWithEditor: 50,
    });
    expect(readabilityReport(score, assignment, {})).not.toHaveProperty('editorDensity');
  });
  it('re-keys an assignment by note index and refuses scores that differ', () => {
    const { score, assignment } = parsePig(text);
    const renamed = { ...score, notes: score.notes.map((n) => ({ ...n, id: `x${n.id}` })) };
    const moved = rekeyAssignment(score, assignment, renamed)!;
    expect(Object.keys(moved).sort()).toEqual(renamed.notes.map((n) => n.id).sort());
    expect(moved[`x${score.notes[3]!.id}`]!.finger).toBe(assignment[score.notes[3]!.id]!.finger);
    expect(
      rekeyAssignment(score, assignment, { ...score, notes: score.notes.slice(1) }),
    ).toBeNull();
    const transposed = { ...score, notes: score.notes.map((n) => ({ ...n, midi: n.midi + 1 })) };
    expect(rekeyAssignment(score, assignment, transposed)).toBeNull();
  });
});
```

`packages/engine/src/readability/library.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { readabilityReport, rekeyAssignment } from '../eval/readability.js';
import { RECOMMENDED_WEIGHT_SET } from '../fingering/params/weightSets.js';
import type { SolveOptions } from '../fingering/solve.js';
import { solveFingering } from '../fingering/solve.js';
import { parseMusicXml } from '../io/musicxml/read.js';
import type { Assignment, Score } from '../score/types.js';
import { reduceFingering } from './reduce.js';
import type { ReduceResult } from './reduce.js';
import { repeatConsistency } from './repeats.js';

const content = new URL('../../../../content/', import.meta.url);
interface Entry {
  slug: string;
  level: number;
  files: { score: string; fingered: string | null };
}
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('manifest.json', content)), 'utf8'),
) as Entry[];
const load = (rel: string) => parseMusicXml(readFileSync(fileURLToPath(new URL(rel, content))));

/** Verification spec goals table, "Be easy to read", amended 2026-10-14 (percent of notes). */
const FLOOR: Record<number, number> = { 1: 30, 2: 30, 3: 35, 4: 40, 5: 40 };

const APP: SolveOptions = {
  weightSet: RECOMMENDED_WEIGHT_SET,
  level: 'beginner',
  profile: 'medium',
};
const ENGINE: SolveOptions = {
  weightSet: RECOMMENDED_WEIGHT_SET,
  level: 'expert',
  profile: 'large',
};

interface Solved {
  entry: Entry;
  file: string;
  config: 'app' | 'engine';
  score: Score;
  assignment: Assignment;
  editorial: Assignment;
  reduced: ReduceResult;
}
const solved: Solved[] = [];
const plainOf = (entry: Entry, config: Solved['config']) =>
  solved.find((x) => x.entry === entry && x.config === config && x.file === entry.files.score)!;

beforeAll(() => {
  for (const [config, opts] of [
    ['app', APP],
    ['engine', ENGINE],
  ] as const)
    for (const entry of manifest)
      for (const file of [entry.files.score, entry.files.fingered]) {
        if (!file) continue;
        const { score, editorial } = load(file);
        const { assignment } = solveFingering(score, opts);
        solved.push({
          entry,
          file,
          config,
          score,
          assignment,
          editorial,
          reduced: reduceFingering(score, assignment),
        });
      }
}, 240_000);

describe('readability on the built-in library', () => {
  it('covers all 30 pieces and the 8 fingered copies in both configurations', () => {
    expect(manifest).toHaveLength(30);
    expect(manifest.filter((e) => e.files.fingered)).toHaveLength(8);
    expect(solved).toHaveLength(2 * 38);
  });

  it("the reader resolves every unprinted note of every library piece to the engine's finger", () => {
    const bad = solved
      .filter((s) => s.reduced.inferability !== 100 || s.reduced.unresolved !== 0)
      .map(
        (s) =>
          `${s.file} (${s.config}): inferability ${s.reduced.inferability}, unresolved ${s.reduced.unresolved}`,
      );
    expect(bad).toEqual([]);
  });

  it('density stays at or under the floor of its level on every piece (app defaults)', () => {
    const bad = manifest
      .map((e) => ({ e, d: plainOf(e, 'app').reduced.density }))
      .filter(({ e, d }) => d > FLOOR[e.level]!)
      .map(({ e, d }) => `${e.slug} (level ${e.level}): ${d.toFixed(1)} > ${FLOOR[e.level]}`);
    expect(bad).toEqual([]);
  });

  it("density is at most 1.5 times the editor's density on the 8 fingered pieces (app defaults); the ratio is reported", () => {
    const bad: string[] = [];
    for (const e of manifest.filter((x) => x.files.fingered)) {
      const plain = plainOf(e, 'app');
      const copy = solved.find(
        (x) => x.entry === e && x.config === 'app' && x.file === e.files.fingered,
      )!;
      const editorial = rekeyAssignment(copy.score, copy.editorial, plain.score);
      expect(
        editorial,
        `${e.slug}: the fingered copy must match the stripped score`,
      ).not.toBeNull();
      const r = readabilityReport(plain.score, plain.assignment, editorial!);
      if (r.density > 1.5 * r.editorDensity!)
        bad.push(
          `${e.slug}: engine ${r.density.toFixed(1)} > editor ${r.editorDensity!.toFixed(1)}`,
        );
      if (e.slug === 'burgmuller-op100-no2-arabesque') expect(r.editorNotes).toBe(26);
    }
    expect(bad).toEqual([]);
  });

  it("the editors' densities match the readability study: median about 18 percent, range 9 to 29", () => {
    const densities = manifest
      .filter((e) => e.files.fingered)
      .map((e) => {
        const plain = plainOf(e, 'app');
        const copy = solved.find(
          (x) => x.entry === e && x.config === 'app' && x.file === e.files.fingered,
        )!;
        return readabilityReport(
          plain.score,
          plain.assignment,
          rekeyAssignment(copy.score, copy.editorial, plain.score)!,
        ).editorDensity!;
      })
      .sort((a, b) => a - b);
    const median = (densities[3]! + densities[4]!) / 2;
    expect(median).toBeGreaterThan(16);
    expect(median).toBeLessThan(20);
    expect(densities[0]!).toBeGreaterThanOrEqual(8);
    expect(densities[7]!).toBeLessThanOrEqual(30);
  });

  it('reports repeat consistency for every piece', () => {
    let segments = 0;
    for (const e of manifest) {
      const plain = plainOf(e, 'app');
      const r = repeatConsistency(plain.score, plain.assignment);
      expect(r.percent, e.slug).toBeGreaterThanOrEqual(0);
      expect(r.percent, e.slug).toBeLessThanOrEqual(100);
      segments += r.segments;
    }
    expect(segments).toBeGreaterThan(0);
  });
});
```

Append to `packages/engine/cli/bench.test.ts` (it reuses the `file()` helper the M2 test defines at the top; merge the two new imports into the file's import block):

```ts
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatScorecard } from './bench.js';

describe('readability row', () => {
  it('adds a library readability row, reports PIG readability per piece, and gates the row per piece', () => {
    const root = mkdtempSync(join(tmpdir(), 'digitus2-read-'));
    const gold = join(root, 'gold', 'FingeringFiles');
    mkdirSync(gold, { recursive: true });
    writeFileSync(join(gold, '001-1_fingering.txt'), file([1, 2, 3, 1, 2, 3, 4, 5]));
    const split = join(root, 'split.json');
    writeFileSync(
      split,
      JSON.stringify({ default_split: 'toy', splits: { toy: { test: { pieces: ['001'] } } } }),
    );
    const content = join(root, 'content');
    mkdirSync(join(content, 'scores'), { recursive: true });
    copyFileSync(
      fileURLToPath(new URL('../fixtures/two-staff.musicxml', import.meta.url)),
      join(content, 'scores', 'two-staff.musicxml'),
    );
    writeFileSync(
      join(content, 'manifest.json'),
      JSON.stringify([
        {
          slug: 'two-staff',
          level: 1,
          files: { score: 'scores/two-staff.musicxml', fingered: null },
        },
      ]),
    );
    const floor = join(root, 'floor.json');
    writeFileSync(
      floor,
      JSON.stringify({
        engine: null,
        readability: { inferabilityMin: 100, densityMaxByLevel: { '1': 0 }, editorRatioMax: 1.5 },
      }),
    );
    const out = join(root, 'runs');
    const { scorecard, floorBreaches } = runBench({
      gold: join(root, 'gold'),
      split,
      floor,
      out,
      label: 'read',
      profile: 'large',
      content,
    });
    const row = scorecard.readability!;
    expect(row).toMatchObject({
      pieces: 1,
      profile: 'medium',
      level: 'beginner',
      inferability: 100,
    });
    expect(row.density).toBeGreaterThan(0);
    expect(row.byLevel['1']).toBe(row.density);
    expect(row.perPiece[0]).toMatchObject({ slug: 'two-staff', level: 1, unresolved: 0 });
    expect(row.editor).toBeNull();
    expect(scorecard.pieces[0]!.inferability).toBe(100);
    expect(scorecard.pieces[0]!.density).toBeGreaterThan(0);
    expect(floorBreaches.some((b) => b.startsWith('readability density two-staff'))).toBe(true);
    expect(floorBreaches.some((b) => b.startsWith('readability inferability'))).toBe(false);
    expect(formatScorecard(scorecard)).toMatch(
      /readability \(library, 1 pieces\): density \d+\.\d\d/,
    );

    const missing = runBench({
      gold: join(root, 'gold'),
      split,
      out,
      label: 'read2',
      profile: 'large',
      content: join(root, 'nope'),
    });
    expect(missing.scorecard.readability).toBeUndefined();
  });
});
```

(If `runBench` takes the weight set through `weights` since M3 Task 5, the default is `RECOMMENDED_WEIGHT_SET`, which is what this test expects.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @digitus2/engine exec vitest run src/eval/readability.test.ts src/readability/library.test.ts cli/bench.test.ts`
Expected: FAIL (modules and fields missing).

- [ ] **Step 3: Implement the report**

`packages/engine/src/eval/readability.ts`:

```ts
import { reduceFingering } from '../readability/reduce.js';
import type { ReduceOptions } from '../readability/reduce.js';
import { repeatConsistency } from '../readability/repeats.js';
import type { Assignment, Score } from '../score/types.js';

export interface ReadabilityReport {
  notes: number;
  printed: number;
  density: number;
  inferability: number;
  unresolved: number;
  repeatSegments: number;
  repeatConsistency: number;
  editorNotes?: number;
  editorDensity?: number;
  agreementWithEditor?: number;
}

export function readabilityReport(
  score: Score,
  assignment: Assignment,
  editorial?: Assignment,
  opts?: ReduceOptions,
): ReadabilityReport {
  const r = reduceFingering(score, assignment, opts);
  const repeats = repeatConsistency(score, assignment);
  const report: ReadabilityReport = {
    notes: r.notes,
    printed: r.printed.size,
    density: r.density,
    inferability: r.inferability,
    unresolved: r.unresolved,
    repeatSegments: repeats.segments,
    repeatConsistency: repeats.percent,
  };
  if (editorial) {
    const fingered = score.notes.filter((n) => editorial[n.id] !== undefined);
    if (fingered.length > 0) {
      const agree = fingered.filter(
        (n) => assignment[n.id]?.finger === editorial[n.id]!.finger,
      ).length;
      report.editorNotes = fingered.length;
      report.editorDensity = (100 * fingered.length) / score.notes.length;
      report.agreementWithEditor = (100 * agree) / fingered.length;
    }
  }
  return report;
}

export function rekeyAssignment(from: Score, a: Assignment, to: Score): Assignment | null {
  if (from.notes.length !== to.notes.length) return null;
  const out: Assignment = {};
  for (let i = 0; i < from.notes.length; i++) {
    const f = from.notes[i]!;
    const t = to.notes[i]!;
    if (f.midi !== t.midi || f.onsetTick !== t.onsetTick) return null;
    const e = a[f.id];
    if (e) out[t.id] = e;
  }
  return out;
}
```

Export both functions and the type from `src/index.ts`.

- [ ] **Step 4: Implement the bench row and the floors**

In `packages/engine/cli/bench.ts`:

1. Constants `READABILITY_PROFILE: HandProfileId = 'medium'` and `READABILITY_LEVEL = 'beginner' as const`.
2. `libraryReadability(content, weightSet)`: return `null` when `join(content, 'manifest.json')` does not exist. Otherwise, for each manifest entry in order: `parseMusicXml(readFileSync(join(content, entry.files.score)))`; `solveFingering(score, { profile: READABILITY_PROFILE, level: READABILITY_LEVEL, weightSet })`; when `entry.files.fingered` is set, parse it and `rekeyAssignment(fingered.score, fingered.editorial, score)` (a `null` re-key leaves the editor fields out of that row and prints `editor copy of <slug> does not match its score` once); `readabilityReport(score, assignment, editorial ?? undefined)`; push a `perPiece` row. Means: `density`, `inferability` and `repeatConsistency` over all rows, `byLevel[String(level)]` over the rows of each level, `editor` over the rows that have editor fields (or `null` when none).
3. `scorePiece` adds `density` and `inferability` from `reduceFingering(score, assignment)` to its `PieceResult`.
4. `runBench`: after the PIG pieces, `const readability = libraryReadability(opts.content ?? 'content', <the weight set this run resolved from opts.weights>)`; put it on the scorecard when not `null`. Floor, when the floor JSON has `readability` and the scorecard has the row, per piece: `readability density <slug> <d.toFixed(2)> above the level <level> floor <max.toFixed(2)>` when `density > densityMaxByLevel[level] + 0.005` (levels missing from the map are not gated); `readability inferability <slug> <i.toFixed(2)> below floor <min.toFixed(2)>` when `inferability < inferabilityMin - 0.005` or `unresolved > 0`; and, when `editorRatioMax` is true, `readability density <slug> <d.toFixed(2)> above the editor's <e.toFixed(2)>` when the piece has `editorDensity` and `density > editorDensity + 0.005`. A floor with `readability` but a scorecard without the row adds no breach (the row is reported as skipped).
5. `formatScorecard`: one line `readability (library, <n> pieces): density <d.toFixed(2)>  inferability <i.toFixed(2)>  repeat consistency <r.toFixed(1)>  by level <1:x.x 2:x.x ...>` plus, when present, `  editor density <x.x> agreement <y.y> over <k> pieces`; then one line per piece over its level's floor or above its editor; when the row is missing, `readability: skipped (no <content>/manifest.json)`.

`benchmarks/floor.json`: add

```json
"readability": {
  "inferabilityMin": 100,
  "densityMaxByLevel": { "1": 30, "2": 30, "3": 35, "4": 40, "5": 40 },
  "densityTargetByLevel": { "1": 20, "2": 20, "3": 25, "4": 30, "5": 30 },
  "densityEditorLevelByLevel": { "1": 15, "2": 15, "3": 15, "4": 25, "5": 25 },
  "editorRatioMax": 1.5,
  "editorRatioTarget": 1.0,
  "_comment": "Library readability, gated per piece at the app defaults (medium hand, beginner level, recommended weight set): printed-digit density of the minimal-sufficient reduction at or under its level's floor, inferability 100 with nothing unresolved, and at most 1.5 times the editor's density (reported ratio; target 1.0) on the 8 fingered pieces. Targets and editor levels are reported, not gated. Source: verification spec section 1 and 3.6, amendment of 2026-10-14; docs/research/readability.md section 7.3."
}
```

`docs/verification-loop.md`, section "Levels", item 3: add: "The bench also writes a library readability row (the minimal-sufficient reduction of verification spec 3.6 over `content/`) and fails when any piece prints more digits than its level's floor in `readability.densityMaxByLevel`, more than the editor on a piece with an editor's fingering, or leaves a finger the player model cannot reconstruct; repeat consistency is reported. The unit tests in `packages/engine/src/readability/library.test.ts` gate the same properties in CI, where the PIG data is absent."

- [ ] **Step 5: Run the tests and the real bench**

Run: `pnpm --filter @digitus2/engine test`
Expected: PASS. First-run policy for these new floors (coordinator decision, 2026-10-14): if a piece exceeds its level's density floor or the 1.5 times editor ratio, do not weaken the test logic; set that number in `benchmarks/floor.json` to the measured maximum for that level (rounded up to the next whole percent) with a dated `_comment` naming the piece, record the gap to the study's target in `docs/experiments.md` as an engine hypothesis (fingering repeated segments identically), and report it as a deviation. Floors are never lowered afterwards. Print the failing pieces with their reason counts (`Object.values(reduced.reasons)` tallied), their `fromMemory` and their repeat consistency, record them in `docs/experiments.md`, and stop and report: the remedy (for example fingering repeats identically, literature 6.6 item 3) is an engine change outside this plan.

Run (background if slow): `pnpm build && node packages/engine/dist/cli/main.js bench --gold research/data/pig --split research/data/splits/pig_official.json --floor benchmarks/floor.json --label m5-readability`
Expected: the readability line with every piece under its floor, inferability 100, and no breach. Append to `docs/experiments.md` a dated M5 entry: hypothesis "with the validated reader and the repeat memory, the engine's complete fingering reduces to at most the per-level floors and to at most the editor's density on the 8 fingered pieces; the study measured 32.8 percent on complete exercise fingerings with the repeat memory and an editor median of 18 percent on the library"; outcome with the per-level means, the editor comparison per fingered piece, and the mean repeat consistency.

- [ ] **Step 6: Run the whole loop**

Run: `pnpm verify`
Expected: all PASS; the benchmark step (when the PIG data is present) shows the readability line.

---

### Task 3: Explanations and lint messages for humans (engine)

**Files:**

- Create: `packages/engine/src/fingering/explain.ts`, `packages/engine/src/fingering/explain.test.ts`, `packages/engine/src/lint/messages.ts`, `packages/engine/src/lint/messages.test.ts`
- Modify: `packages/engine/src/index.ts` (exports)

**Interfaces:**

- Consumes (types only): `ExplainedTerm`, `NoteExplanation`, `SolveResult`, `RuleId` (M2, M3), `LintIssue`, `LintRuleId` (M2 Task 6), `Finger`, `Hand`. Tests also use `RULE_IDS` (M3 Task 1), `LINT_RULES`, `lintFingering`, `solveFingering`.
- Produces:

```ts
// fingering/explain.ts
export type ConfidenceLabel = 'sure' | 'likely' | 'unsure';
export const SURE_MIN: number; // 0.85
export const LIKELY_MIN: number; // 0.6
export const TERM_FALLBACK: string; // 'another fingering habit' (never used for a known id; a test enforces it)
export function confidenceLabel(confidence: number): ConfidenceLabel;
export function describeTerm(
  term: { rule: RuleId | string; points: number },
  ctx?: { hand?: Hand },
): string;
export interface NoteExplainView {
  finger: Finger;
  summary: string;
  terms: Array<{ text: string; points: number }>; // weighted points summed per description, non-zero, largest magnitude first
  confidenceLabel: ConfidenceLabel;
}
export function explainNote(
  result: Pick<SolveResult, 'assignment' | 'explanations'>,
  noteId: string,
  hand?: Hand, // default 'R'; 'L' turns "up" and "down" of the mirrored transition features into real directions
): NoteExplainView;

// lint/messages.ts
export const ISSUE_TEXT: Record<LintRuleId, string>;
export function describeIssue(issue: Pick<LintIssue, 'rule'>): string;
```

`explainNote` takes an optional `hand` (the brief's signature plus one optional argument): the transition features `tr:<g><f>:up|down` are defined on mirrored pitch, so "up" for the left hand is a falling melody on the keyboard. Both files import types only, so the app's main thread can use them without pulling solver code into its entry chunk.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/fingering/explain.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePig } from '../io/pig/read.js';
import { confidenceLabel, describeTerm, explainNote, TERM_FALLBACK } from './explain.js';
import { RECOMMENDED_WEIGHT_SET } from './params/weightSets.js';
import { RULE_IDS } from './rules.js';
import type { SolveResult } from './solve.js';
import { solveFingering } from './solve.js';

describe('describeTerm', () => {
  it('describes every rule id in plain words, for both hands', () => {
    const bad: string[] = [];
    for (const rule of RULE_IDS)
      for (const hand of ['R', 'L'] as const) {
        const text = describeTerm({ rule, points: 1 }, { hand });
        if (text === TERM_FALLBACK) bad.push(`${rule}: no description`);
        if (text.length === 0 || text.length > 60) bad.push(`${rule}: length ${text.length}`);
        if (/[a-z][A-Z]/.test(text) || text.includes(':'))
          bad.push(`${rule}: id-like text "${text}"`);
        if (/\b(parncutt|maxcomf|maxprac|minrel|maxrel|weight|penalty)\b/i.test(text))
          bad.push(`${rule}: jargon "${text}"`);
        if (text.endsWith('.')) bad.push(`${rule}: ends with a period`);
      }
    expect(bad).toEqual([]);
  });
  it('uses the plan wording for the examples and families', () => {
    expect(describeTerm({ rule: 'stretch', points: 2 })).toBe('a stretch wider than comfortable');
    expect(describeTerm({ rule: 'thumbPassing', points: 3 })).toBe(
      'the thumb passes under on a black key',
    );
    expect(describeTerm({ rule: 'thumbPassing', points: 1 })).toBe(
      'the thumb passes under, or a finger crosses over it',
    );
    expect(describeTerm({ rule: 'tr:13:up', points: 1 })).toBe('finger 1 then 3 going up');
    expect(describeTerm({ rule: 'tr:13:up', points: 1 }, { hand: 'L' })).toBe(
      'finger 1 then 3 going down',
    );
    expect(describeTerm({ rule: 'tr:42:down', points: 1 })).toBe('finger 4 then 2 going down');
    expect(describeTerm({ rule: 'on:1:black', points: 1 })).toBe('finger 1 on a black key');
    expect(describeTerm({ rule: 'on:5:white', points: 1 })).toBe('finger 5 on a white key');
    expect(describeTerm({ rule: 'ch:25', points: 1 })).toBe('fingers 2 and 5 together in a chord');
    expect(describeTerm({ rule: 'no-such-rule', points: 1 })).toBe(TERM_FALLBACK);
  });
});

describe('confidenceLabel', () => {
  it('maps confidence to sure, likely and unsure at 0.85 and 0.6', () => {
    expect([1, 0.85, 0.849, 0.6, 0.599, 0].map(confidenceLabel)).toEqual([
      'sure',
      'sure',
      'likely',
      'likely',
      'unsure',
      'unsure',
    ]);
  });
});

describe('explainNote', () => {
  const result: Pick<SolveResult, 'assignment' | 'explanations'> = {
    assignment: {
      a: { finger: 3, confidence: 0.9, alternatives: [{ finger: 2, cost: 2 }], source: 'engine' },
      b: { finger: 1, confidence: 0.7, source: 'engine' },
      c: { finger: 5, confidence: 1, pinned: true, source: 'user' },
      d: { finger: 2, confidence: 0.3, source: 'engine' },
    },
    explanations: {
      a: {
        total: 5,
        terms: [
          { rule: 'stretch', points: 2, weighted: 4 },
          { rule: 'tr:13:up', points: 1, weighted: -0.5 },
          { rule: 'weakFinger', points: 0, weighted: 0 },
          { rule: 'handPositionShift', points: 1, weighted: 1 },
          { rule: 'handPositionShift', points: 0.5, weighted: 0.5 },
        ],
      },
      b: {
        total: 3.25,
        terms: [
          { rule: 'tr:31:up', points: 1, weighted: 0.25 },
          { rule: 'thumbPassing', points: 3, weighted: 3 },
        ],
      },
      c: { total: 0, terms: [] },
    },
  };

  it('explains three notes: a clear choice, a likely left-hand choice, and a pinned one', () => {
    expect(explainNote(result, 'a')).toEqual({
      finger: 3,
      summary: 'Finger 3 is the clear choice here.',
      confidenceLabel: 'sure',
      terms: [
        { text: 'a stretch wider than comfortable', points: 4 },
        { text: 'moving the hand to a new position', points: 1.5 },
        { text: 'finger 1 then 3 going up', points: -0.5 },
      ],
    });
    expect(explainNote(result, 'b', 'L')).toEqual({
      finger: 1,
      summary: 'Finger 1 is the likely choice here.',
      confidenceLabel: 'likely',
      terms: [
        { text: 'the thumb passes under on a black key', points: 3 },
        { text: 'finger 3 then 1 going down', points: 0.25 },
      ],
    });
    expect(explainNote(result, 'c')).toEqual({
      finger: 5,
      summary: 'Finger 5 is your choice.',
      confidenceLabel: 'sure',
      terms: [],
    });
  });
  it('says when the engine is unsure, tolerates a missing explanation, and rejects unknown notes', () => {
    expect(explainNote(result, 'd')).toEqual({
      finger: 2,
      summary: 'Finger 2 is one of several good choices here.',
      confidenceLabel: 'unsure',
      terms: [],
    });
    expect(() => explainNote(result, 'zzz')).toThrow(/no fingering/);
  });
  it('explains every note of a real solve', () => {
    const { score } = parsePig(
      readFileSync(
        fileURLToPath(new URL('../../fixtures/pig-sample.txt', import.meta.url)),
        'utf8',
      ),
    );
    const solved = solveFingering(score, { weightSet: RECOMMENDED_WEIGHT_SET });
    for (const n of score.notes) {
      const v = explainNote(solved, n.id, n.hand);
      expect(v.summary).toMatch(/^Finger [1-5] /);
      expect(['sure', 'likely', 'unsure']).toContain(v.confidenceLabel);
      const mags = v.terms.map((t) => Math.abs(t.points));
      expect(mags).toEqual([...mags].sort((x, y) => y - x));
      expect(v.terms.every((t) => t.text !== TERM_FALLBACK)).toBe(true);
    }
  });
});
```

`packages/engine/src/lint/messages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsePig } from '../io/pig/read.js';
import { LINT_RULES, lintFingering } from './index.js';
import { describeIssue, ISSUE_TEXT } from './messages.js';

describe('lint messages', () => {
  it('has one plain sentence for every lint rule', () => {
    expect(Object.keys(ISSUE_TEXT).sort()).toEqual(Object.keys(LINT_RULES).sort());
    for (const [rule, text] of Object.entries(ISSUE_TEXT)) {
      expect(text, rule).toMatch(/^[A-Z][^]*\.$/);
      expect(text, rule).not.toMatch(/L\d\d|MaxPrac|MaxComf|Parncutt/);
      expect(text.length, rule).toBeLessThanOrEqual(90);
    }
  });
  it('uses the plan wording for L01 and L05', () => {
    expect(describeIssue({ rule: 'L01' })).toBe(
      'Two notes played together cannot use the same finger.',
    );
    expect(describeIssue({ rule: 'L05' })).toBe(
      'That finger forces a stretch beyond the chosen hand size.',
    );
  });
  it('describes an issue that lintFingering really reports', () => {
    const { score, assignment } = parsePig(
      '//Version: PianoFingering_v170101\n0\t0\t1\tC4\t80\t80\t0\t2\n1\t0\t1\tE4\t80\t80\t0\t2\n',
    );
    const issue = lintFingering(score, assignment).issues.find((i) => i.rule === 'L01')!;
    expect(describeIssue(issue)).toBe(ISSUE_TEXT.L01);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @digitus2/engine exec vitest run src/fingering/explain.test.ts src/lint/messages.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`packages/engine/src/fingering/explain.ts`:

```ts
import type { Finger, Hand } from '../score/types.js';
import type { RuleId } from './rules.js';
import type { SolveResult } from './solve.js';

/** Plain-English descriptions of the cost terms, for the app's "why" (spec section 9, view 2). */
export type ConfidenceLabel = 'sure' | 'likely' | 'unsure';
export const SURE_MIN = 0.85;
export const LIKELY_MIN = 0.6;
export const TERM_FALLBACK = 'another fingering habit';

const TEXT: Readonly<Record<string, string>> = {
  weakFinger: 'the fourth finger, which is weaker',
  weakFifth: 'the fifth finger, which is weaker',
  thumbOnBlack: 'the thumb on a black key',
  fiveOnBlack: 'the fifth finger on a black key',
  stretch: 'a stretch wider than comfortable',
  smallSpan: 'fingers squeezed closer than relaxed',
  largeSpan: 'fingers spread wider than relaxed',
  beyondPractical: 'a stretch wider than the hand can reach',
  threeToFour: 'finger 3 followed by finger 4',
  fourOnBlack: 'finger 3 on white next to finger 4 on black',
  hop: 'the same finger jumps to the next key',
  repeatedNoteSameFinger: 'the same finger repeats a key quickly',
  repeatedNoteFingerChange: 'a finger change on a slow repeated key',
  chordStretch: 'a chord wider than comfortable',
  chordSmallSpan: 'chord fingers squeezed closer than relaxed',
  chordLargeSpan: 'chord fingers spread wider than relaxed',
  chordBeyondPractical: 'a chord wider than the hand can reach',
  handPositionShift: 'moving the hand to a new position',
  positionChangeCount: 'a change of hand position',
  positionChangeSize: 'a big jump of the hand',
  threeFourFive: 'fingers 3, 4 and 5 in a row',
  sameFingerPivot: 'the same finger before and after a turn',
  template: 'the standard scale or arpeggio fingering',
  latticeStep: 'fingers that skip keys or bunch up',
  levelChange: 'moving between black and white keys',
  stretchFast: 'a stretch played fast',
  shiftFast: 'a quick move of the whole hand',
  repeatFast: 'a fast repeated key',
};

export function confidenceLabel(confidence: number): ConfidenceLabel {
  if (confidence >= SURE_MIN) return 'sure';
  if (confidence >= LIKELY_MIN) return 'likely';
  return 'unsure';
}

export function describeTerm(
  term: { rule: RuleId | string; points: number },
  ctx: { hand?: Hand } = {},
): string {
  const id = term.rule;
  if (id === 'thumbPassing')
    return term.points >= 3
      ? 'the thumb passes under on a black key'
      : 'the thumb passes under, or a finger crosses over it';
  const fixed = TEXT[id];
  if (fixed) return fixed;
  let m = /^on:([1-5]):(black|white)$/.exec(id);
  if (m) return `finger ${m[1]} on a ${m[2]} key`;
  m = /^tr:([1-5])([1-5]):(up|down)$/.exec(id);
  if (m) {
    const up = (m[3] === 'up') !== (ctx.hand === 'L');
    return `finger ${m[1]} then ${m[2]} going ${up ? 'up' : 'down'}`;
  }
  m = /^ch:([1-5])([1-5])$/.exec(id);
  if (m) return `fingers ${m[1]} and ${m[2]} together in a chord`;
  return TERM_FALLBACK;
}

export interface NoteExplainView {
  finger: Finger;
  summary: string;
  terms: Array<{ text: string; points: number }>;
  confidenceLabel: ConfidenceLabel;
}

export function explainNote(
  result: Pick<SolveResult, 'assignment' | 'explanations'>,
  noteId: string,
  hand: Hand = 'R',
): NoteExplainView {
  const a = result.assignment[noteId];
  if (!a) throw new Error(`no fingering for note ${noteId}`);
  const label = a.pinned ? 'sure' : confidenceLabel(a.confidence ?? 0);
  const sums = new Map<string, number>();
  for (const t of result.explanations[noteId]?.terms ?? []) {
    const text = describeTerm(t, { hand });
    sums.set(text, (sums.get(text) ?? 0) + t.weighted);
  }
  const terms = [...sums]
    .map(([text, points]) => ({ text, points }))
    .filter((t) => Math.abs(t.points) > 1e-9)
    .sort(
      (x, y) =>
        Math.abs(y.points) - Math.abs(x.points) || (x.text < y.text ? -1 : x.text > y.text ? 1 : 0),
    );
  const f = a.finger;
  const summary = a.pinned
    ? `Finger ${f} is your choice.`
    : label === 'sure'
      ? `Finger ${f} is the clear choice here.`
      : label === 'likely'
        ? `Finger ${f} is the likely choice here.`
        : `Finger ${f} is one of several good choices here.`;
  return { finger: f, summary, terms, confidenceLabel: label };
}
```

If `RULE_IDS` contains ids beyond the ones above (M3 Task 7 may have kept new features such as `tr:<g><f>:<up|down>:black` or `pivotAfterRest`), the first test lists them; add a description for each in the same style (a regular expression for a family, a `TEXT` entry for a named id).

`packages/engine/src/lint/messages.ts`:

```ts
import type { LintIssue, LintRuleId } from './index.js';

/** One plain sentence per lint rule, for notices in the app (spec section 9, view 2). */
export const ISSUE_TEXT: Readonly<Record<LintRuleId, string>> = {
  L01: 'Two notes played together cannot use the same finger.',
  L02: 'In a chord, the fingers must go in the same order as the keys.',
  L03: 'A finger is still holding a key when it is needed for the next one.',
  L04: 'One hand cannot play more than five notes at once.',
  L05: 'That finger forces a stretch beyond the chosen hand size.',
  L06: 'Two fingers cross over each other without the thumb.',
  L07: 'That finger makes a stretch wider than comfortable for the chosen hand size.',
  L08: 'The thumb lands on a black key.',
  L09: 'The fifth finger lands on a black key next to white keys.',
  L10: 'The thumb passes under onto a black key.',
  L11: 'The same finger jumps quickly to a different key.',
  L12: 'The same finger repeats a key quickly.',
  L13: 'A slow repeated key changes finger.',
  L14: 'Fingers 3, 4 and 5 follow each other awkwardly.',
};

export function describeIssue(issue: Pick<LintIssue, 'rule'>): string {
  return ISSUE_TEXT[issue.rule];
}
```

(If `LintRuleId` and `LintIssue` are declared in `lint/rules.ts` rather than `lint/index.ts`, import the types from where they live.)

Add to `packages/engine/src/index.ts`:

```ts
export {
  confidenceLabel,
  describeTerm,
  explainNote,
  LIKELY_MIN,
  SURE_MIN,
  TERM_FALLBACK,
} from './fingering/explain.js';
export type { ConfidenceLabel, NoteExplainView } from './fingering/explain.js';
export { describeIssue, ISSUE_TEXT } from './lint/messages.js';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @digitus2/engine exec vitest run src/fingering/explain.test.ts src/lint/messages.test.ts && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Run the whole loop**

Run: `pnpm verify`
Expected: all PASS.

---

### Task 4: The engine worker solves with pins, level and weight set, and returns explanations, the printed set and the broken laws (app)

**Files:**

- Create: `apps/web/bundle-baseline.json`, `apps/web/src/design/checkBundle.test.ts`
- Modify: `scripts/check-bundle-size.mjs`, `apps/web/src/app/store.ts`, `apps/web/src/app/store.test.ts`, `apps/web/src/engine/protocol.ts`, `apps/web/src/engine/handlers.ts`, `apps/web/src/engine/handlers.test.ts`, `apps/web/src/engine/client.ts`, `apps/web/src/engine/client.test.ts`, `apps/web/src/score/useScoreDocument.ts`, `apps/web/src/score/useScoreDocument.test.ts`

**Interfaces:**

- Consumes: `solveFingering`, `RECOMMENDED_WEIGHT_SET`, `lintFingering`, `reduceFingering` (Task 1), `parsePig` (tests), `NoteExplanation`, `LintIssue`, `Hand`.
- Produces:

```ts
// app/store.ts
export type SkillLevel = 'beginner' | 'expert';
export interface Settings {
  /* M4 fields */ level: SkillLevel;
} // DEFAULT_SETTINGS.level = 'beginner'

// engine/protocol.ts
export interface SolveRequestOptions {
  profile: HandSize;
  level: SkillLevel;
  pins?: Assignment;
}
export interface SolveReply {
  assignment: Assignment; // every note; pinned notes carry pinned: true and source 'user'
  explanations: Record<string, NoteExplanation>;
  printed: string[]; // reduceFingering(score, assignment).printed, in insertion order
  density: number;
  inferability: number;
  relaxed: Hand[]; // hands the solver had to relax to keep the pins
  lawIssues: LintIssue[]; // error-severity lint issues in the relaxed hands (empty when nothing is relaxed)
  ms: number;
}
export type EngineRequest =
  | { id: number; type: 'load'; input: string | Uint8Array; source: string }
  | ({ id: number; type: 'solve'; score: Score } & SolveRequestOptions)
  | { id: number; type: 'fingeredXml'; xml: string; score: Score; assignment: Assignment };
export type EngineResponse =
  | {
      id: number;
      ok: true;
      type: 'load';
      score: Score;
      editorial: Assignment;
      warnings: string[];
      xml: string;
    }
  | ({ id: number; ok: true; type: 'solve' } & SolveReply)
  | { id: number; ok: true; type: 'fingeredXml'; xml: string }
  | { id: number; ok: false; error: string };

// engine/client.ts
export interface EngineClient {
  load(
    input: string | Uint8Array,
    source: string,
  ): Promise<{ score: Score; editorial: Assignment; warnings: string[]; xml: string }>;
  solve(score: Score, opts: SolveRequestOptions): Promise<SolveReply>;
  fingeredXml(xml: string, score: Score, assignment: Assignment): Promise<string>;
  dispose(): void;
}

// scripts/check-bundle-size.mjs
export function allowanceProblem(
  totalBytes: number,
  baseline: { label: string; entryGzipBytes: number; allowanceBytes: number } | null,
): string | null;
```

- [ ] **Step 1: Record the bundle baseline before any M5 app code**

Run: `pnpm --filter @digitus2/web build && node scripts/check-bundle-size.mjs`
Note the total gzip size of the library page's initial JavaScript and CSS that the script prints (M4 Task 10). Create `apps/web/bundle-baseline.json`:

```json
{
  "label": "M4",
  "entryGzipBytes": 0,
  "allowanceBytes": 10240,
  "_comment": "Initial JS+CSS of the library page, gzip bytes, measured by scripts/check-bundle-size.mjs at the end of M4. M5 (popover, selection, per-piece store, explanation and lint text tables) may add at most allowanceBytes. Replace entryGzipBytes only with a dated note in docs/PROGRESS.md."
}
```

with `entryGzipBytes` set to the measured number (not 0).

- [ ] **Step 2: Write the failing tests**

`apps/web/src/design/checkBundle.test.ts` (type the `.mjs` import the same way `checkColors.test.ts` types `check-colors.mjs`):

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { allowanceProblem } from '../../../../scripts/check-bundle-size.mjs';

describe('bundle allowance', () => {
  const baseline = { label: 'M4', entryGzipBytes: 100_000, allowanceBytes: 10_240 };
  it('passes without a baseline and within the allowance', () => {
    expect(allowanceProblem(500_000, null)).toBeNull();
    expect(allowanceProblem(110_240, baseline)).toBeNull();
  });
  it('fails one byte over the allowance, naming the baseline', () => {
    expect(allowanceProblem(110_241, baseline)).toBe(
      'entry JavaScript and CSS is 110241 B gzip, more than M4 (100000 B) plus the 10240 B allowance',
    );
  });
});
```

Append to `apps/web/src/app/store.test.ts`:

```ts
describe('level setting', () => {
  it('defaults to beginner, persists a change, and ignores an unknown stored level', async () => {
    expect(DEFAULT_SETTINGS.level).toBe('beginner');
    useAppStore.getState().setSettings({ level: 'expert' });
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!).state.settings.level).toBe(
      'expert',
    );
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { settings: { level: 'wizard' } }, version: 1 }),
    );
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().settings.level).toBe('beginner');
  });
});
```

In `apps/web/src/engine/handlers.test.ts`: add `level: 'expert'` to every existing `type: 'solve'` request literal (three places), then append:

```ts
import { parsePig } from '@digitus2/engine';
import type { Assignment } from '@digitus2/engine';

function solved(r: ReturnType<typeof handle>) {
  if (!r.ok || r.type !== 'solve') throw new Error('solve failed');
  return r;
}

describe('engine handlers, M5 solve reply', () => {
  it('returns explanations for every note, the printed set and an inferability of 100', () => {
    const { score } = load();
    const r = solved(
      handle({ id: 10, type: 'solve', score, profile: 'medium', level: 'beginner' }),
    );
    expect(Object.keys(r.explanations)).toHaveLength(67);
    expect(r.printed.length).toBeGreaterThan(0);
    expect(r.printed.length).toBeLessThan(67);
    expect(r.printed.every((id) => r.assignment[id] !== undefined)).toBe(true);
    expect(r.inferability).toBe(100);
    expect(r.density).toBeCloseTo((100 * r.printed.length) / 67, 9);
    expect(r.relaxed).toEqual([]);
    expect(r.lawIssues).toEqual([]);
  });
  it('prints a pinned note and keeps its finger', () => {
    const { score } = load();
    const free = solved(
      handle({ id: 11, type: 'solve', score, profile: 'medium', level: 'expert' }),
    );
    const target = score.notes[5]!;
    const finger = free.assignment[target.id]!.finger === 5 ? 4 : 5;
    const pins: Assignment = { [target.id]: { finger, pinned: true, source: 'user' } };
    const r = solved(
      handle({ id: 12, type: 'solve', score, profile: 'medium', level: 'expert', pins }),
    );
    expect(r.assignment[target.id]).toMatchObject({ finger, pinned: true, source: 'user' });
    expect(r.printed).toContain(target.id);
    expect(r.inferability).toBe(100);
  });
  it('two pins with one finger in a chord: relaxed, both kept, L01 reported', () => {
    const { score } = parsePig(
      '//Version: PianoFingering_v170101\n' +
        '0\t0\t1\tC4\t80\t80\t0\t1\n1\t0\t1\tE4\t80\t80\t0\t3\n2\t0\t1\tG4\t80\t80\t0\t5\n',
    );
    const [c, e] = score.notes;
    const pins: Assignment = {
      [c!.id]: { finger: 2, pinned: true, source: 'user' },
      [e!.id]: { finger: 2, pinned: true, source: 'user' },
    };
    const r = solved(
      handle({ id: 13, type: 'solve', score, profile: 'medium', level: 'expert', pins }),
    );
    expect(r.relaxed).toEqual(['R']);
    expect(r.assignment[c!.id]).toMatchObject({ finger: 2, pinned: true });
    expect(r.assignment[e!.id]).toMatchObject({ finger: 2, pinned: true });
    expect(r.lawIssues.map((i) => i.rule)).toContain('L01');
    expect(r.lawIssues.every((i) => i.severity === 'error' && i.hand === 'R')).toBe(true);
    expect(r.inferability).toBe(100);
  });
});
```

Append to `apps/web/src/engine/client.test.ts`:

```ts
import type { EngineRequest } from './protocol.js';

it('passes solve options through and resolves the reply without the envelope', async () => {
  const seen: EngineRequest[] = [];
  const reply = {
    assignment: {},
    explanations: {},
    printed: [],
    density: 0,
    inferability: 100,
    relaxed: [],
    lawIssues: [],
    ms: 1,
  };
  const c = createEngineClient(
    fakeWorker((req) => {
      seen.push(req);
      return { id: req.id, ok: true, type: 'solve', ...reply };
    }),
  );
  await expect(
    c.solve({ notes: [] } as never, { profile: 'small', level: 'beginner' }),
  ).resolves.toEqual(reply);
  expect(seen[0]).toMatchObject({ type: 'solve', profile: 'small', level: 'beginner' });
  expect(seen[0]).not.toHaveProperty('pins');
});
```

In `apps/web/src/score/useScoreDocument.test.ts` replace the `solve` member of `inlineEngine()` with:

```ts
    solve: (score, opts) =>
      run({ id: ++id, type: 'solve', score, ...opts }).then((r) => r as never),
```

and append:

```ts
it('re-solves when the level changes', async () => {
  const engine = inlineEngine();
  const renderer = fakeRenderer();
  const { result } = renderHook(() =>
    useScoreDocument({ kind: 'file', name: 'x.musicxml', bytes }, 800, { engine, renderer }),
  );
  await waitFor(() => expect(result.current.status).toBe('ready'));
  const before = engine.calls.filter((c) => c === 'solve').length;
  act(() => useAppStore.getState().setSettings({ level: 'expert' }));
  await waitFor(() => expect(engine.calls.filter((c) => c === 'solve').length).toBe(before + 1));
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `pnpm --filter @digitus2/web test`
Expected: FAIL (the new fields and the allowance function are missing; the existing handler tests fail type-checking until the protocol changes).

- [ ] **Step 4: Implement**

`scripts/check-bundle-size.mjs`: add and export

```js
export function allowanceProblem(totalBytes, baseline) {
  if (!baseline) return null;
  const limit = baseline.entryGzipBytes + baseline.allowanceBytes;
  if (totalBytes <= limit) return null;
  return `entry JavaScript and CSS is ${totalBytes} B gzip, more than ${baseline.label} (${baseline.entryGzipBytes} B) plus the ${baseline.allowanceBytes} B allowance`;
}
```

and in the command-line part (guarded by the same `process.argv[1]` check `check-colors.mjs` uses, so importing the module runs nothing): read `apps/web/bundle-baseline.json` when it exists, call `allowanceProblem(total, baseline)` with the total the script already computes, print the problem and set exit code 1 when it returns a string; print `allowance ok: <total> B of <limit> B` otherwise. The 150 KB absolute budget and the Verovio laziness check stay as they are.

`store.ts`: `SkillLevel`, `level` in `Settings` and `DEFAULT_SETTINGS` (`'beginner'`), and in `pickSettings`: `if (isOneOf(['beginner', 'expert'] as const, raw.level)) out.level = raw.level;`.

`protocol.ts`: as in Interfaces.

`handlers.ts`, the `solve` case:

```ts
      case 'solve': {
        const t0 = performance.now();
        const result = solveFingering(req.score, {
          profile: req.profile,
          level: req.level,
          weightSet: RECOMMENDED_WEIGHT_SET,
          ...(req.pins ? { pins: req.pins } : {}),
        });
        const relaxed = result.hands.filter((h) => h.relaxed).map((h) => h.hand);
        const lawIssues =
          relaxed.length === 0
            ? []
            : lintFingering(req.score, result.assignment, {
                profile: req.profile,
                beginner: req.level === 'beginner',
              }).issues.filter((i) => i.severity === 'error' && relaxed.includes(i.hand));
        const reduced = reduceFingering(req.score, result.assignment);
        return {
          id: req.id,
          ok: true,
          type: 'solve',
          assignment: result.assignment,
          explanations: result.explanations,
          printed: [...reduced.printed],
          density: reduced.density,
          inferability: reduced.inferability,
          relaxed,
          lawIssues,
          ms: performance.now() - t0,
        };
      }
```

`client.ts`: `solve(score, opts)` posts `{ id, type: 'solve', score, ...opts }` (no `pins` key when `opts.pins` is undefined) and resolves with the response minus `id`, `ok` and `type`.

`useScoreDocument.ts`: every `engine.solve(score, settings.handSize)` call becomes `engine.solve(score, { profile: settings.handSize, level: settings.level })` reading `.assignment` from the reply; the re-solve effect depends on `[settings.handSize, settings.level]`. Nothing else changes in this task.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @digitus2/web test && node scripts/check-bundle-size.mjs`
Expected: PASS; the bundle script prints `allowance ok` (the worker grew, the entry did not).

- [ ] **Step 6: Run the whole loop**

Run: `pnpm verify`
Expected: all PASS, including `bundle` and `e2e` (the digits shown are unchanged in this task).

---

### Task 5: Per-piece state and persistence (app)

**Files:**

- Create: `apps/web/src/app/pieceStore.ts`, `apps/web/src/app/pieceStore.test.ts`

**Interfaces:**

- Consumes: `PieceSource`, `HandSize` (M4 store), `Assignment`, `Finger`, zustand.
- Produces:

```ts
export interface PieceState {
  pins: Assignment; // user pins only: { finger, pinned: true, source: 'user' }
  showAllDigits: boolean;
  showEditorial: boolean;
  handSize?: HandSize; // the hand size in force when the pins were last changed
}
export const PIECE_STORAGE_PREFIX = 'digitus2.piece.v1.';
export function fnv1a32(bytes: Uint8Array): string; // 8 lowercase hex digits
export function pieceStorageKey(source: PieceSource): string;
// library: 'digitus2.piece.v1.<slug>'
// file:    'digitus2.piece.v1.file.<encodeURIComponent(name)>.<byte length>.<fnv1a32(bytes)>'
export function parsePieceState(
  text: string | null,
  defaults: { showEditorial: boolean },
): PieceState;
export interface PieceStore {
  key: string | null;
  piece: PieceState;
  open(key: string, defaults: { showEditorial: boolean }): void;
  prunePins(validIds: ReadonlySet<string>): void;
  setPin(noteId: string, finger: Finger, handSize: HandSize): void;
  unpin(noteId: string): void;
  resetPins(): void;
  setShowAllDigits(on: boolean): void;
  setShowEditorial(on: boolean): void;
}
export const usePieceStore: UseBoundStore<StoreApi<PieceStore>>;
```

The brief's key is "slug, or file name plus size"; a content hash is added for files because two different files can share a name and a size (Review Focus 3). Settings (hand size, level, tempo, hands, metronome, count-in) stay global in `digitus2.settings.v1`; only pins and the two toggles are per piece. `showEditorial` starts from the global setting the first time a piece is opened, so M4 behaviour is unchanged for pieces without a stored state. Opening a piece writes nothing; the first change does.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/app/pieceStore.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fnv1a32,
  parsePieceState,
  PIECE_STORAGE_PREFIX,
  pieceStorageKey,
  usePieceStore,
} from './pieceStore.js';

const enc = (s: string) => new TextEncoder().encode(s);
const S = () => usePieceStore.getState();

beforeEach(() => {
  localStorage.clear();
  usePieceStore.setState({
    key: null,
    piece: { pins: {}, showAllDigits: false, showEditorial: false },
  });
});
afterEach(() => vi.restoreAllMocks());

describe('piece keys', () => {
  it('keys library pieces by slug', () => {
    expect(pieceStorageKey({ kind: 'library', slug: 'ode-to-joy' })).toBe(
      'digitus2.piece.v1.ode-to-joy',
    );
  });
  it('hashes with FNV-1a', () => {
    expect(fnv1a32(new Uint8Array())).toBe('811c9dc5');
    expect(fnv1a32(enc('a'))).toBe('e40c292c');
  });
  it('two different files with the same name and size get different keys', () => {
    const a = pieceStorageKey({
      kind: 'file',
      name: 'etude.musicxml',
      bytes: enc('<score-partwise>A</score-partwise>'),
    });
    const b = pieceStorageKey({
      kind: 'file',
      name: 'etude.musicxml',
      bytes: enc('<score-partwise>B</score-partwise>'),
    });
    expect(a).not.toBe(b);
    expect(a.startsWith(`${PIECE_STORAGE_PREFIX}file.etude.musicxml.34.`)).toBe(true);
    expect(
      pieceStorageKey({
        kind: 'file',
        name: 'etude.musicxml',
        bytes: enc('<score-partwise>A</score-partwise>'),
      }),
    ).toBe(a);
  });
});

describe('piece state', () => {
  it('opening writes nothing; a pin is saved and survives a reload', () => {
    S().open('k1', { showEditorial: false });
    expect(localStorage.getItem('k1')).toBeNull();
    S().setPin('n3', 4, 'small');
    expect(JSON.parse(localStorage.getItem('k1')!)).toEqual({
      pins: { n3: { finger: 4, pinned: true, source: 'user' } },
      showAllDigits: false,
      showEditorial: false,
      handSize: 'small',
    });
    usePieceStore.setState({
      key: null,
      piece: { pins: {}, showAllDigits: false, showEditorial: false },
    });
    S().open('k1', { showEditorial: false });
    expect(S().piece.pins).toEqual({ n3: { finger: 4, pinned: true, source: 'user' } });
  });
  it('keeps the two toggles per piece and seeds showEditorial from the global setting', () => {
    S().open('a', { showEditorial: false });
    S().setShowAllDigits(true);
    S().open('b', { showEditorial: true });
    expect(S().piece.showAllDigits).toBe(false);
    expect(S().piece.showEditorial).toBe(true);
    S().open('a', { showEditorial: true });
    expect(S().piece.showAllDigits).toBe(true);
    expect(S().piece.showEditorial).toBe(false);
  });
  it('unpins, resets and prunes pins whose notes are gone', () => {
    S().open('k', { showEditorial: false });
    S().setPin('n1', 2, 'medium');
    S().setPin('n2', 3, 'medium');
    S().unpin('n1');
    expect(Object.keys(S().piece.pins)).toEqual(['n2']);
    S().setPin('n9', 5, 'medium');
    S().prunePins(new Set(['n2']));
    expect(Object.keys(S().piece.pins)).toEqual(['n2']);
    expect(Object.keys(JSON.parse(localStorage.getItem('k')!).pins)).toEqual(['n2']);
    S().resetPins();
    expect(S().piece.pins).toEqual({});
    expect(JSON.parse(localStorage.getItem('k')!)).toEqual({
      pins: {},
      showAllDigits: false,
      showEditorial: false,
    });
  });
  it('reads corrupted or partial stored state safely', () => {
    expect(parsePieceState('{not json', { showEditorial: true })).toEqual({
      pins: {},
      showAllDigits: false,
      showEditorial: true,
    });
    expect(
      parsePieceState(
        JSON.stringify({
          pins: { n1: { finger: 9 }, n2: { finger: 3, source: 'engine' }, n3: null },
          showAllDigits: 'yes',
          handSize: 'giant',
          bogus: 1,
        }),
        { showEditorial: false },
      ),
    ).toEqual({
      pins: { n2: { finger: 3, pinned: true, source: 'user' } },
      showAllDigits: false,
      showEditorial: false,
    });
  });
  it('never throws when localStorage refuses writes, and keeps the change in memory', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    S().open('q', { showEditorial: false });
    expect(() => S().setPin('n1', 1, 'medium')).not.toThrow();
    expect(S().piece.pins.n1!.finger).toBe(1);
    usePieceStore.setState({
      key: null,
      piece: { pins: {}, showAllDigits: false, showEditorial: false },
    });
    S().open('q', { showEditorial: false });
    expect(S().piece.pins.n1!.finger).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @digitus2/web test`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/web/src/app/pieceStore.ts`:

```ts
import type { Assignment, Finger } from '@digitus2/engine';
import { create } from 'zustand';
import type { HandSize, PieceSource } from './store.js';

export interface PieceState {
  pins: Assignment;
  showAllDigits: boolean;
  showEditorial: boolean;
  handSize?: HandSize;
}
export const PIECE_STORAGE_PREFIX = 'digitus2.piece.v1.';
const HAND_SIZES: readonly string[] = ['large', 'medium', 'small', 'child'];

export function fnv1a32(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function pieceStorageKey(source: PieceSource): string {
  if (source.kind === 'library') return `${PIECE_STORAGE_PREFIX}${source.slug}`;
  return `${PIECE_STORAGE_PREFIX}file.${encodeURIComponent(source.name)}.${source.bytes.length}.${fnv1a32(source.bytes)}`;
}

function emptyPiece(showEditorial: boolean): PieceState {
  return { pins: {}, showAllDigits: false, showEditorial };
}

export function parsePieceState(
  text: string | null,
  defaults: { showEditorial: boolean },
): PieceState {
  const base = emptyPiece(defaults.showEditorial);
  if (!text) return base;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return base;
  }
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const pins: Assignment = {};
  if (typeof r.pins === 'object' && r.pins !== null)
    for (const [id, v] of Object.entries(r.pins as Record<string, unknown>)) {
      const f =
        typeof v === 'object' && v !== null ? (v as { finger?: unknown }).finger : undefined;
      if (typeof f === 'number' && Number.isInteger(f) && f >= 1 && f <= 5)
        pins[id] = { finger: f as Finger, pinned: true, source: 'user' };
    }
  const out: PieceState = {
    pins,
    showAllDigits: r.showAllDigits === true,
    showEditorial: typeof r.showEditorial === 'boolean' ? r.showEditorial : base.showEditorial,
  };
  if (typeof r.handSize === 'string' && HAND_SIZES.includes(r.handSize))
    out.handSize = r.handSize as HandSize;
  return out;
}

/** Writes that localStorage refused (quota, blocked site data) live here for the session. */
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    const v = globalThis.localStorage?.getItem(key) ?? null;
    if (v !== null) return v;
  } catch {
    /* fall through to memory */
  }
  return memory.get(key) ?? null;
}

function write(key: string, state: PieceState): void {
  const text = JSON.stringify(state);
  try {
    globalThis.localStorage.setItem(key, text);
    memory.delete(key);
  } catch {
    memory.set(key, text);
  }
}

export interface PieceStore {
  key: string | null;
  piece: PieceState;
  open(key: string, defaults: { showEditorial: boolean }): void;
  prunePins(validIds: ReadonlySet<string>): void;
  setPin(noteId: string, finger: Finger, handSize: HandSize): void;
  unpin(noteId: string): void;
  resetPins(): void;
  setShowAllDigits(on: boolean): void;
  setShowEditorial(on: boolean): void;
}

export const usePieceStore = create<PieceStore>()((set, get) => {
  const update = (change: (p: PieceState) => PieceState) => {
    const { key, piece } = get();
    const next = change(piece);
    if (next === piece) return;
    set({ piece: next });
    if (key) write(key, next);
  };
  const withoutPins = (p: PieceState, drop: (id: string) => boolean): PieceState => {
    const kept = Object.entries(p.pins).filter(([id]) => !drop(id));
    if (kept.length === Object.keys(p.pins).length) return p;
    return { ...p, pins: Object.fromEntries(kept) };
  };
  return {
    key: null,
    piece: emptyPiece(false),
    open: (key, defaults) => set({ key, piece: parsePieceState(read(key), defaults) }),
    prunePins: (valid) => update((p) => withoutPins(p, (id) => !valid.has(id))),
    setPin: (noteId, finger, handSize) =>
      update((p) => ({
        ...p,
        pins: { ...p.pins, [noteId]: { finger, pinned: true, source: 'user' } },
        handSize,
      })),
    unpin: (noteId) => update((p) => withoutPins(p, (id) => id === noteId)),
    resetPins: () =>
      update((p) => ({ pins: {}, showAllDigits: p.showAllDigits, showEditorial: p.showEditorial })),
    setShowAllDigits: (on) =>
      update((p) => (p.showAllDigits === on ? p : { ...p, showAllDigits: on })),
    setShowEditorial: (on) =>
      update((p) => (p.showEditorial === on ? p : { ...p, showEditorial: on })),
  };
});
```

(`0x811c9dc5` and `0x01000193` are not color literals: the color guard matches `#` followed by hex digits only.)

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @digitus2/web test && node scripts/check-colors.mjs`
Expected: PASS; `colors ok`.

- [ ] **Step 5: Run the whole loop**

Run: `pnpm verify`
Expected: all PASS.

---

### Task 6: The printed set in the score pipeline, pins in the solve, export, and the M4 specs moved to the reduced default (app)

**Files:**

- Create: `apps/web/src/score/printedSet.ts`, `apps/web/src/score/printedSet.test.ts`, `apps/web/e2e/helpers/score.ts`
- Modify: `apps/web/src/score/useScoreDocument.ts`, `apps/web/src/score/useScoreDocument.test.ts`, `apps/web/src/score/ScoreView.tsx` (`data-status`, `data-busy`), `apps/web/src/score/SidePanel.tsx` (printed count line, `Show all fingers`, export of the printed or full set), `apps/web/e2e/score.spec.ts`, `apps/web/e2e/playback.spec.ts`, `apps/web/e2e/export.spec.ts`, `apps/web/e2e/states.spec.ts`, `apps/web/e2e/visual.spec.ts` (and its regenerated baselines)

**Interfaces:**

- Consumes: `EngineClient.solve(score, { profile, level, pins })` and `SolveReply` (Task 4), `usePieceStore`, `pieceStorageKey` (Task 5), `injectFingerings` through `EngineClient.fingeredXml`, M4's `setDigits`, `flash`, `injectNoteIds`, renderer.
- Produces:

```ts
// score/printedSet.ts
export function subset(a: Assignment, ids: Iterable<string>): Assignment;
export function shownAssignment(
  engine: Assignment,
  printed: ReadonlySet<string>,
  view: { showAll: boolean; showEditorial: boolean; editorial: Assignment | null },
): Assignment; // the editorial assignment when showEditorial and it has entries; else engine or its printed subset
export function exportAssignment(
  engine: Assignment,
  printed: ReadonlySet<string>,
  showAll: boolean,
): Assignment;
export function sameKeys(a: Assignment, b: Assignment): boolean;
export function digitChanges(prev: Assignment, next: Assignment): Map<string, string>; // ids in both whose finger differs -> new digit text

// score/useScoreDocument.ts (additions to M4's ScoreDocument)
export interface ScoreDocument {
  /* M4 fields; `assignment` is now the shown digits (editorial, all, or the printed subset) */
  engine: Assignment | null; // the engine's fingering of every note, with the user's pins
  explanations: Record<string, NoteExplanation> | null;
  printed: ReadonlySet<string>; // empty until the first solve
  density: number | null;
  shownCount: number; // Object.keys(assignment).length
  noteCount: number;
  relaxed: Hand[];
  lawIssues: LintIssue[];
  solveSeq: number; // increases by one every time a solve reply is applied
  busy: boolean; // a re-solve or re-render is running after the first 'ready'
}

// e2e/helpers/score.ts
export function waitSettled(page: Page): Promise<void>; // .score-view[data-status="ready"] without data-busy
export function printedCount(page: Page): Promise<{ printed: number; total: number }>; // parses 'Printed <n> of <total> fingers'
export function openScore(page: Page, url: string): Promise<{ printed: number; total: number }>; // goto, settle, assert g.fing count = printed
export function firstDigitNoteId(page: Page): Promise<string>; // data-startid of the first g.fing, without '#'
export function chordPair(page: Page): Promise<[string, string]>; // ids of the first two g.note inside the first g.chord that has two
```

Pipeline (in order; replaces M4's description where they differ):

1. When the source changes: `usePieceStore.getState().open(pieceStorageKey(source), { showEditorial: settings.showEditorial })`, then M4's load. After `load`, `prunePins(new Set(score.notes.map((n) => n.id)))`.
2. Solve: `engine.solve(score, { profile: settings.handSize, level: settings.level, ...(pins non-empty ? { pins } : {}) })`. Every call takes a sequence number from a ref counter; a reply whose number is not the latest is dropped. On an applied reply: `engine`, `explanations`, `printed = new Set(reply.printed)`, `density`, `relaxed`, `lawIssues` are set and `solveSeq` increments.
3. Shown digits: `shownAssignment(engine, printed, { showAll: piece.showAllDigits, showEditorial: piece.showEditorial, editorial })`. On the first open: `fingeredXml(xml, score, shown)`, `injectNoteIds`, render, `ready`. After that, when a reply or a toggle produces a new shown assignment: if `sameKeys(previous, next)` and the width bucket is unchanged, publish `digitChanges(previous, next)` (ScoreView patches with `setDigits(host, changes, flash)`, M4); otherwise re-render.
4. Re-solve triggers after `ready`: `settings.handSize`, `settings.level`, `piece.pins` (object identity). Re-render or patch triggers: `piece.showAllDigits`, `piece.showEditorial`, the width bucket.
5. Library pieces with `files.fingered` load the editorial copy right after the first `ready` (inside `requestIdleCallback`, fallback `setTimeout(…, 0)`), not lazily as in M4, so the side panel can show the agreement; the re-keying by note index is M4's.
6. `busy` is true from a trigger until its reply is applied and any re-render has finished.

`ScoreView` puts `data-status={doc.status}` and `data-busy={doc.busy ? 'true' : undefined}` on its root `.score-view`. `SidePanel` gains, under the hand size select: `<label><input type="checkbox"> Show all fingers</label>` bound to `usePieceStore` `showAllDigits`, and `<p className="small" data-testid="printed-count">Printed {doc.shownCount} of {doc.noteCount} fingers</p>`; its `Export MusicXML` passes `exportAssignment(doc.engine, doc.printed, piece.showAllDigits)` to `fingeredXml` (export always writes the engine's fingering with the pins, never the editor's, which the source file already contains).

- [ ] **Step 1: Write the failing tests**

`apps/web/src/score/printedSet.test.ts`:

```ts
import type { Assignment } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { digitChanges, exportAssignment, sameKeys, shownAssignment, subset } from './printedSet.js';

const engine: Assignment = {
  a: { finger: 1, source: 'engine' },
  b: { finger: 2, source: 'engine' },
  c: { finger: 3, source: 'user', pinned: true },
};
const printed = new Set(['a', 'c']);
const editorial: Assignment = { b: { finger: 4, source: 'editorial' } };

describe('printed set helpers', () => {
  it('shows the printed subset by default, everything with show all, and the editor when asked', () => {
    expect(
      shownAssignment(engine, printed, { showAll: false, showEditorial: false, editorial }),
    ).toEqual(subset(engine, ['a', 'c']));
    expect(
      shownAssignment(engine, printed, { showAll: true, showEditorial: false, editorial }),
    ).toBe(engine);
    expect(
      shownAssignment(engine, printed, { showAll: false, showEditorial: true, editorial }),
    ).toBe(editorial);
    expect(
      shownAssignment(engine, printed, { showAll: false, showEditorial: true, editorial: {} }),
    ).toEqual(subset(engine, printed));
  });
  it('exports the printed set or everything, with pins', () => {
    expect(Object.keys(exportAssignment(engine, printed, false)).sort()).toEqual(['a', 'c']);
    expect(exportAssignment(engine, printed, false).c).toEqual({
      finger: 3,
      source: 'user',
      pinned: true,
    });
    expect(exportAssignment(engine, printed, true)).toBe(engine);
  });
  it('compares key sets and lists changed digits', () => {
    const next: Assignment = {
      a: { finger: 2, source: 'engine' },
      c: { finger: 3, source: 'user', pinned: true },
    };
    expect(sameKeys(subset(engine, printed), next)).toBe(true);
    expect(sameKeys(engine, next)).toBe(false);
    expect(digitChanges(subset(engine, printed), next)).toEqual(new Map([['a', '2']]));
  });
});
```

In `apps/web/src/score/useScoreDocument.test.ts`:

- add `import { pieceStorageKey, usePieceStore } from '../app/pieceStore.js';` and, in `beforeEach`, `localStorage.clear(); usePieceStore.setState({ key: null, piece: { pins: {}, showAllDigits: false, showEditorial: false } });`;
- in `walks loading -> fingering -> rendering -> ready`, replace `expect(Object.keys(result.current.assignment!)).toHaveLength(67);` with `expect(Object.keys(result.current.engine!)).toHaveLength(67);` and `expect(result.current.pages[0]).toContain('data-fings="67"');` with ``expect(result.current.pages[0]).toContain(`data-fings="${result.current.printed.size}"`);``;
- delete `re-solves without re-rendering when the hand size changes` (replaced below);
- append:

```ts
const file = { kind: 'file' as const, name: 'x.musicxml', bytes };
const resetPiece = () =>
  usePieceStore.setState({
    key: null,
    piece: { pins: {}, showAllDigits: false, showEditorial: false },
  });

describe('useScoreDocument, printed digits and pins', () => {
  it('renders only the printed digits by default', async () => {
    const { result } = renderHook(() =>
      useScoreDocument(file, 800, { engine: inlineEngine(), renderer: fakeRenderer() }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const d = result.current;
    expect(d.noteCount).toBe(67);
    expect(d.printed.size).toBeGreaterThan(0);
    expect(d.printed.size).toBeLessThan(67);
    expect(d.shownCount).toBe(d.printed.size);
    expect(Object.keys(d.assignment!).sort()).toEqual([...d.printed].sort());
    expect(d.pages[0]).toContain(`data-fings="${d.printed.size}"`);
    expect(d.busy).toBe(false);
  });

  it('show all fingers re-renders once with every digit', async () => {
    const renderer = fakeRenderer();
    const { result } = renderHook(() =>
      useScoreDocument(file, 800, { engine: inlineEngine(), renderer }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const before = renderer.renders;
    act(() => usePieceStore.getState().setShowAllDigits(true));
    await waitFor(() => expect(result.current.pages[0]).toContain('data-fings="67"'));
    expect(renderer.renders).toBe(before + 1);
    expect(result.current.shownCount).toBe(67);
  });

  it('a pin re-solves, keeps the finger, prints the note and re-renders the new set', async () => {
    const { result } = renderHook(() =>
      useScoreDocument(file, 800, { engine: inlineEngine(), renderer: fakeRenderer() }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const target = result.current.score!.notes[10]!;
    const finger = result.current.engine![target.id]!.finger === 5 ? 4 : 5;
    const seq = result.current.solveSeq;
    act(() => usePieceStore.getState().setPin(target.id, finger, 'medium'));
    await waitFor(() => expect(result.current.solveSeq).toBe(seq + 1));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.engine![target.id]).toMatchObject({
      finger,
      pinned: true,
      source: 'user',
    });
    expect(result.current.printed.has(target.id)).toBe(true);
    expect(result.current.assignment![target.id]!.finger).toBe(finger);
    expect(result.current.pages[0]).toContain(`data-fings="${result.current.printed.size}"`);
  });

  it('applies the pins stored for a piece when it opens', async () => {
    const first = renderHook(() =>
      useScoreDocument(file, 800, { engine: inlineEngine(), renderer: fakeRenderer() }),
    );
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    const target = first.result.current.score!.notes[3]!;
    const finger = first.result.current.engine![target.id]!.finger === 1 ? 2 : 1;
    first.unmount();
    localStorage.setItem(
      pieceStorageKey(file),
      JSON.stringify({
        pins: { [target.id]: { finger } },
        showAllDigits: false,
        showEditorial: false,
      }),
    );
    resetPiece();
    const second = renderHook(() =>
      useScoreDocument(file, 800, { engine: inlineEngine(), renderer: fakeRenderer() }),
    );
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(second.result.current.engine![target.id]).toMatchObject({ finger, pinned: true });
  });

  it('with show all on, a hand size change patches digits without re-rendering', async () => {
    usePieceStore.getState().open(pieceStorageKey(file), { showEditorial: false });
    usePieceStore.getState().setShowAllDigits(true);
    const engine = inlineEngine();
    const renderer = fakeRenderer();
    const { result } = renderHook(() => useScoreDocument(file, 800, { engine, renderer }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const before = engine.calls.filter((c) => c === 'solve').length;
    act(() => useAppStore.getState().setSettings({ handSize: 'child' }));
    await waitFor(() => expect(engine.calls.filter((c) => c === 'solve').length).toBe(before + 1));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(renderer.renders).toBe(1);
  });

  it('applies only the newest of two quick re-solves', async () => {
    const base = inlineEngine();
    let solves = 0;
    const engine: typeof base = {
      ...base,
      solve: (score, opts) => {
        solves++;
        const p = base.solve(score, opts);
        return solves === 2 ? new Promise((r) => setTimeout(() => r(p), 80)) : p;
      },
    };
    const { result } = renderHook(() =>
      useScoreDocument(file, 800, { engine, renderer: fakeRenderer() }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const [a, b] = [result.current.score!.notes[2]!, result.current.score!.notes[20]!];
    const fa = result.current.engine![a.id]!.finger === 5 ? 4 : 5;
    const fb = result.current.engine![b.id]!.finger === 1 ? 2 : 1;
    act(() => usePieceStore.getState().setPin(a.id, fa, 'medium'));
    act(() => usePieceStore.getState().setPin(b.id, fb, 'medium'));
    await waitFor(() => expect(result.current.engine![b.id]?.pinned).toBe(true));
    await new Promise((r) => setTimeout(r, 150));
    expect(result.current.engine![a.id]).toMatchObject({ finger: fa, pinned: true });
    expect(result.current.engine![b.id]).toMatchObject({ finger: fb, pinned: true });
  });
});
```

`apps/web/e2e/helpers/score.ts`:

```ts
import { expect, type Page } from '@playwright/test';

export async function waitSettled(page: Page): Promise<void> {
  await expect(page.locator('.score-view[data-status="ready"]:not([data-busy])')).toBeVisible({
    timeout: 20_000,
  });
}

export async function printedCount(page: Page): Promise<{ printed: number; total: number }> {
  const text = ((await page.getByTestId('printed-count').textContent()) ?? '').trim();
  const m = /^Printed (\d+) of (\d+) fingers$/.exec(text);
  if (!m) throw new Error(`unexpected printed count text: "${text}"`);
  return { printed: Number(m[1]), total: Number(m[2]) };
}

export async function openScore(
  page: Page,
  url: string,
): Promise<{ printed: number; total: number }> {
  await page.goto(url);
  await waitSettled(page);
  const counts = await printedCount(page);
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(counts.printed);
  return counts;
}

export async function firstDigitNoteId(page: Page): Promise<string> {
  const startid = await page.locator('.score-sheet g.fing').first().getAttribute('data-startid');
  if (!startid) throw new Error('no printed digit');
  return startid.replace(/^#/, '');
}

export async function chordPair(page: Page): Promise<[string, string]> {
  const ids = await page.evaluate(() => {
    for (const chord of Array.from(document.querySelectorAll('.score-sheet g.chord'))) {
      const notes = Array.from(chord.querySelectorAll('g.note')).map((n) => n.id);
      if (notes.length >= 2) return [notes[0]!, notes[1]!];
    }
    return null;
  });
  if (!ids) throw new Error('no chord with two notes on this page');
  return ids as [string, string];
}
```

Changes to the M4 end-to-end specs (each replaces a wait for "one digit per note" with the reduced default):

`apps/web/e2e/score.spec.ts`:

- add `import { openScore, printedCount, waitSettled } from './helpers/score.js';`;
- first test: rename to `opens Twinkle from the library: the reduced fingering is printed, one red element, hash set`; replace the two lines `await expect(page.locator('.score-sheet svg').first()).toBeVisible({ timeout: 20_000 });` and `await expect(page.locator('.score-sheet g.fing')).toHaveCount(64);` with:

```ts
await waitSettled(page);
const { printed, total } = await printedCount(page);
expect(total).toBe(64);
expect(printed).toBeGreaterThan(0);
expect(printed).toBeLessThan(64);
await expect(page.locator('.score-sheet g.fing')).toHaveCount(printed);
```

- second test (hand size): replace its `page.goto` and the first `toHaveCount(64, …)` with `await openScore(page, '/#/piece/twinkle-twinkle-little-star');`, and the last `toHaveCount(64)` with `await waitSettled(page); const after = await printedCount(page); await expect(page.locator('.score-sheet g.fing')).toHaveCount(after.printed);`;
- third test (editor's fingering): replace `page.goto(…)` and the `svg` visibility wait with `await openScore(page, '/#/piece/burgmuller-op100-no2-arabesque');`; the rest is unchanged (the count before the toggle is read from the page; 26 with the editor's digits);
- K.545 test: keep the 8 s assertions on the first SVG; replace `await expect(page.locator('.score-sheet g.fing')).toHaveCount(1288);` with `await waitSettled(page); const k = await printedCount(page); expect(k.total).toBe(1288); await expect(page.locator('.score-sheet g.fing')).toHaveCount(k.printed);`.

`apps/web/e2e/playback.spec.ts`: in all three tests, replace `await page.goto(URL); await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });` with `await openScore(page, URL);` (same URL).

`apps/web/e2e/export.spec.ts`: replace the first test with

```ts
import { readFile } from 'node:fs/promises';
import { openScore, waitSettled } from './helpers/score.js';

test('export writes the printed fingering, or every finger with Show all fingers on', async ({
  page,
}) => {
  const { printed } = await openScore(page, '/#/piece/twinkle-twinkle-little-star');
  const exported = async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export MusicXML' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('twinkle-twinkle-little-star.fingered.musicxml');
    const text = await readFile((await download.path())!, 'utf8');
    return (text.match(/<fingering/g) ?? []).length;
  };
  expect(await exported()).toBe(printed);
  await page.getByLabel('Show all fingers').check();
  await waitSettled(page);
  expect(await exported()).toBe(64);
});
```

and in the print test replace the `svg` visibility wait with `await openScore(page, '/#/piece/twinkle-twinkle-little-star');`.

`apps/web/e2e/states.spec.ts` and `apps/web/e2e/visual.spec.ts`: in every `go` function, replace the wait for 64 digits (and the wait for the first SVG of the Arabesque) with `await openScore(page, <the same URL>)`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @digitus2/web test`
Expected: FAIL (helpers missing; the hook has no `engine`, `printed`, `busy`).

- [ ] **Step 3: Implement**

`printedSet.ts`:

```ts
import type { Assignment } from '@digitus2/engine';

export function subset(a: Assignment, ids: Iterable<string>): Assignment {
  const out: Assignment = {};
  for (const id of ids) {
    const e = a[id];
    if (e) out[id] = e;
  }
  return out;
}

export function shownAssignment(
  engine: Assignment,
  printed: ReadonlySet<string>,
  view: { showAll: boolean; showEditorial: boolean; editorial: Assignment | null },
): Assignment {
  if (view.showEditorial && view.editorial && Object.keys(view.editorial).length > 0)
    return view.editorial;
  return view.showAll ? engine : subset(engine, printed);
}

export function exportAssignment(
  engine: Assignment,
  printed: ReadonlySet<string>,
  showAll: boolean,
): Assignment {
  return showAll ? engine : subset(engine, printed);
}

export function sameKeys(a: Assignment, b: Assignment): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] !== undefined);
}

export function digitChanges(prev: Assignment, next: Assignment): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, e] of Object.entries(next)) {
    const p = prev[id];
    if (p && p.finger !== e.finger) out.set(id, String(e.finger));
  }
  return out;
}
```

`useScoreDocument.ts`: implement the six pipeline rules above on top of M4's hook. Keep the solve sequence counter and the "last shown assignment" in refs (not state) so effects compare against what is on screen, not against a stale render. Read the piece store with `usePieceStore((s) => s.piece)`. The re-solve effect must not fire for the initial solve (the open pipeline does that one); guard with the status.

`ScoreView.tsx`: the two data attributes on the root.

`SidePanel.tsx`: the checkbox, the count line and the export change described above.

- [ ] **Step 4: Run the unit tests and the end-to-end suite**

Run: `pnpm --filter @digitus2/web test`
Expected: PASS.

Run: `pnpm --filter @digitus2/web e2e` (background; about two minutes)
Expected: every spec passes on `desktop`; `library` and `states` on `mobile`; `visual` fails only because the baselines show every digit.

Regenerate the visual baselines: `pnpm --filter @digitus2/web exec playwright test --project visual --update-snapshots`. Open each changed PNG next to its old version (`git diff --stat` is the coordinator's job; the implementer compares the files in `apps/web/e2e/visual.spec.ts-snapshots/` against `test-results/`) and confirm that the only differences are fewer digits on the score pages. List the regenerated files in the report.

- [ ] **Step 5: Run the whole loop**

Run: `pnpm verify`
Expected: all PASS, including `bundle` (`allowance ok`).

---

### Task 7: Selection, the finger popover, pins and the keyboard (app)

**Files:**

- Create: `apps/web/src/score/edit/placePopover.ts`, `apps/web/src/score/edit/placePopover.test.ts`, `apps/web/src/score/edit/neighbors.ts`, `apps/web/src/score/edit/neighbors.test.ts`, `apps/web/src/score/edit/notices.ts`, `apps/web/src/score/edit/notices.test.ts`, `apps/web/src/score/edit/FingerPopover.tsx`, `apps/web/src/score/edit/FingerPopover.test.tsx`, `apps/web/src/score/edit/useScoreKeys.ts`, `apps/web/src/score/edit/useScoreKeys.test.ts`, `apps/web/e2e/edit.spec.ts`
- Modify: `apps/web/src/score/render/dom.ts`, `apps/web/src/score/render/dom.test.ts`, `apps/web/src/score/Transport.tsx`, `apps/web/src/score/Transport.test.tsx`, `apps/web/src/score/ScoreView.tsx`, `apps/web/src/design/base.css`, `apps/web/e2e/helpers/score.ts` (three popover helpers shared with Task 8)

**Interfaces:**

- Consumes: `explainNote`, `describeIssue`, `NoteExplainView`, `ConfidenceLabel` (Task 3), `usePieceStore` (Task 5), `ScoreDocument` (Task 6), M4's `noteIdAt`, `Button`, `Playback`.
- Produces:

```ts
// render/dom.ts (additions)
export function digitNoteIdAt(target: EventTarget | null): string | null; // closest g.fing -> data-startid without '#'
export function targetNoteId(target: EventTarget | null): string | null; // a digit's note, else the notehead's note
export function setSelected(host: Element, noteId: string | null): Element | null; // one g.note with .is-red and data-selected; null clears
export function markPinned(host: Element, ids: ReadonlySet<string>): void; // toggles .is-pinned on every g.fing
export function anchorRectOf(host: Element, noteId: string): DOMRect | null; // the digit's box, else the note's

// edit/placePopover.ts
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
export function placePopover(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gap?: number, // 8
): { left: number; top: number; side: 'below' | 'above' };

// edit/neighbors.ts
export function neighborNote(score: Score, noteId: string, dir: 1 | -1): string | null; // same hand, ordered by onset then pitch
export function noteName(note: Note): string; // 'F♯4'
export function noteLabel(note: Note): string; // 'F♯4, right hand'

// edit/notices.ts
export const RELAXED_FALLBACK: string; // 'That finger makes this passage very hard to play.'
export function relaxedNotice(issues: readonly LintIssue[], pinned: ReadonlySet<string>): string;
export function handSizeNotice(piece: PieceState, current: HandSize): string | null;

// edit/FingerPopover.tsx
export interface FingerPopoverProps {
  label: string;
  entry: FingerAssignment;
  view: NoteExplainView;
  editorFinger: Finger | null;
  position: { left: number; top: number };
  onChoose(f: Finger): void;
  onUnpin(): void;
  onClose(): void;
}
export function FingerPopover(props: FingerPopoverProps): JSX.Element;

// edit/useScoreKeys.ts
export interface ScoreKeyHandlers {
  onDigit(f: Finger): void;
  onEscape(): void;
  onSpace(): void;
  onArrow(dir: 1 | -1): void;
}
export function isTypingTarget(target: EventTarget | null): boolean; // input, select, textarea, contenteditable
export function isControlTarget(target: EventTarget | null): boolean; // typing targets plus button and a
export function useScoreKeys(enabled: boolean, handlers: ScoreKeyHandlers): void;

// Transport.tsx
export function Transport(props: {
  playback: Playback;
  measureCount: number;
  selectionActive?: boolean;
}): JSX.Element;

// e2e/helpers/score.ts (additions)
export function digitOf(page: Page, noteId: string): Locator; // g.fing[data-startid="#<id>"] in the sheet
export function popoverOf(page: Page): Locator; // the dialog named /^Finger for /
export function pressedFinger(page: Page): Promise<number>; // the finger whose button has aria-pressed="true"
```

Behaviour in `ScoreView` (exact):

- State: `selected: string | null`, `popoverOpen: boolean`. A click on the sheet while not playing: `targetNoteId(event.target)`; a note with an entry in `doc.engine` becomes selected and opens the popover; a click elsewhere on the sheet clears both. Clicks on the sheet are ignored while playing.
- Effects: after every render or patch, `setSelected(host, selected)` and `markPinned(host, new Set(Object.keys(piece.pins)))`. The popover is `position: fixed`; its position is `placePopover(anchorRectOf(host, selected), measured size, { width: innerWidth, height: innerHeight })`, recomputed on window `resize` and on `scroll` (capture phase).
- Play: ScoreView wraps `playback.play` so that it first clears the selection (state and `setSelected(host, null)`) and closes the popover, then plays; the wrapped playback goes to `Transport` and to the Space key. `Transport` receives `selectionActive={selected !== null}` and renders Play with `primary={!playing && !selectionActive}`.
- Choosing a finger (button or digit key): `usePieceStore.getState().setPin(selected, f, settings.handSize)`; `Unpin`: `unpin(selected)`; `Close`: clears selection and popover and blurs the focused element so Space reaches the page again.
- Keys (`useScoreKeys(doc.status === 'ready', …)`): digits 1 to 5 pin the selected note; Escape closes the popover if open (and blurs the focused element, as `Close` does), else clears the selection; Space toggles play and pause (not when a control has focus: buttons keep their own Space); ArrowLeft and ArrowRight move the selection to `neighborNote(score, selected, ∓1)` and keep the popover state.
- Notices: when `doc.solveSeq` changes and `doc.relaxed` is not empty, `setNotice(relaxedNotice(doc.lawIssues, pinnedIds))`; on the first `ready`, `setNotice(handSizeNotice(piece, settings.handSize))` when it is not null.
- Popover content: `label = noteLabel(note)`, `entry = doc.engine[selected]`, `view = explainNote({ assignment: doc.engine, explanations: doc.explanations }, selected, note.hand)`, `editorFinger = doc.editorial?.[selected]?.finger ?? null`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/score/render/dom.test.ts` (it reuses the file's `host()` fixture):

```ts
import { anchorRectOf, digitNoteIdAt, markPinned, setSelected, targetNoteId } from './dom.js';

describe('selection helpers', () => {
  it('finds the note of a clicked digit or notehead', () => {
    const h = host();
    expect(digitNoteIdAt(h.querySelector('g.fing[data-startid="#n2"] tspan tspan'))).toBe('n2');
    expect(digitNoteIdAt(h.querySelector('#n1 use'))).toBeNull();
    expect(targetNoteId(h.querySelector('#n3 use'))).toBe('n3');
    expect(targetNoteId(h.querySelector('g.fing[data-startid="#n1"] text'))).toBe('n1');
    expect(targetNoteId(h)).toBeNull();
    expect(targetNoteId(null)).toBeNull();
  });
  it('selects exactly one note and clears it', () => {
    const h = host();
    expect(setSelected(h, 'n2')!.id).toBe('n2');
    setSelected(h, 'n3');
    expect(Array.from(h.querySelectorAll('.is-red')).map((e) => e.id)).toEqual(['n3']);
    expect(h.querySelector('#n3')!.hasAttribute('data-selected')).toBe(true);
    expect(h.querySelector('#c1')!.classList.contains('is-red')).toBe(false);
    setSelected(h, null);
    expect(h.querySelectorAll('.is-red, [data-selected]')).toHaveLength(0);
    expect(setSelected(h, 'nope')).toBeNull();
  });
  it('marks pinned digits and finds anchor boxes', () => {
    const h = host();
    markPinned(h, new Set(['n2']));
    expect(h.querySelector('g.fing[data-startid="#n2"]')).toHaveClass('is-pinned');
    expect(h.querySelector('g.fing[data-startid="#n1"]')).not.toHaveClass('is-pinned');
    markPinned(h, new Set());
    expect(h.querySelectorAll('.is-pinned')).toHaveLength(0);
    expect(anchorRectOf(h, 'n1')).not.toBeNull();
    expect(anchorRectOf(h, 'n3')).not.toBeNull();
    expect(anchorRectOf(h, 'zzz')).toBeNull();
  });
});
```

`apps/web/src/score/edit/placePopover.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { placePopover } from './placePopover.js';

const size = { width: 288, height: 220 };

describe('placePopover', () => {
  it('centres the box below the anchor when there is room', () => {
    expect(
      placePopover({ left: 500, top: 100, width: 10, height: 20 }, size, {
        width: 1280,
        height: 900,
      }),
    ).toEqual({ left: 361, top: 128, side: 'below' });
  });
  it('placePopover keeps the box inside the viewport at 360 px', () => {
    const viewport = { width: 360, height: 740 };
    for (let x = 0; x <= 350; x += 10)
      for (let y = 0; y <= 720; y += 40) {
        const p = placePopover({ left: x, top: y, width: 12, height: 20 }, size, viewport);
        expect(p.left, `x ${x} y ${y}`).toBeGreaterThanOrEqual(8);
        expect(p.left + size.width, `x ${x} y ${y}`).toBeLessThanOrEqual(360 - 8);
        expect(p.top, `x ${x} y ${y}`).toBeGreaterThanOrEqual(8);
        expect(p.top + size.height, `x ${x} y ${y}`).toBeLessThanOrEqual(740 - 8);
      }
    expect(placePopover({ left: 340, top: 100, width: 12, height: 20 }, size, viewport).left).toBe(
      64,
    );
  });
  it('flips above near the bottom and clamps when neither side fits', () => {
    expect(
      placePopover({ left: 100, top: 600, width: 10, height: 20 }, size, {
        width: 360,
        height: 740,
      }),
    ).toMatchObject({ top: 372, side: 'above' });
    expect(
      placePopover(
        { left: 100, top: 100, width: 10, height: 20 },
        { width: 288, height: 280 },
        {
          width: 360,
          height: 300,
        },
      ),
    ).toMatchObject({ top: 12, side: 'below' });
  });
});
```

`apps/web/src/score/edit/neighbors.test.ts`:

```ts
import type { Note, Score } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { neighborNote, noteLabel } from './neighbors.js';

const n = (
  id: string,
  hand: 'R' | 'L',
  onsetTick: number,
  midi: number,
  step: Note['spelling']['step'],
  alter: Note['spelling']['alter'],
  octave: number,
) => ({ id, hand, onsetTick, midi, spelling: { step, alter, octave } }) as Note;
const score = {
  notes: [
    n('r1', 'R', 0, 60, 'C', 0, 4),
    n('l1', 'L', 0, 48, 'C', 0, 3),
    n('r2', 'R', 0, 64, 'E', 0, 4),
    n('r3', 'R', 480, 66, 'F', 1, 4),
    n('l2', 'L', 480, 46, 'B', -1, 2),
  ],
} as Score;

describe('neighbors', () => {
  it('moves through one hand in onset then pitch order and stops at the ends', () => {
    expect(neighborNote(score, 'r1', 1)).toBe('r2');
    expect(neighborNote(score, 'r2', 1)).toBe('r3');
    expect(neighborNote(score, 'r3', 1)).toBeNull();
    expect(neighborNote(score, 'r1', -1)).toBeNull();
    expect(neighborNote(score, 'l1', 1)).toBe('l2');
    expect(neighborNote(score, 'zzz', 1)).toBeNull();
  });
  it('labels notes with accidentals and the hand', () => {
    expect(noteLabel(score.notes[3]!)).toBe('F♯4, right hand');
    expect(noteLabel(score.notes[4]!)).toBe('B♭2, left hand');
  });
});
```

`apps/web/src/score/edit/notices.test.ts`:

```ts
import type { LintIssue } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { handSizeNotice, RELAXED_FALLBACK, relaxedNotice } from './notices.js';

const issue = (rule: LintIssue['rule'], noteIds: string[]): LintIssue => ({
  rule,
  severity: 'error',
  hand: 'R',
  noteIds,
  message: 'engine text',
});

describe('notices', () => {
  it('names the laws broken at the pinned notes, once each, and keeps the choice', () => {
    expect(
      relaxedNotice(
        [issue('L01', ['a', 'b']), issue('L01', ['a', 'c']), issue('L07', ['x', 'y'])],
        new Set(['a']),
      ),
    ).toBe('Two notes played together cannot use the same finger. Your choice is kept.');
  });
  it('falls back to every law when none touches a pin, and to a generic sentence when there is none', () => {
    expect(relaxedNotice([issue('L05', ['x', 'y'])], new Set(['a']))).toBe(
      'That finger forces a stretch beyond the chosen hand size. Your choice is kept.',
    );
    expect(relaxedNotice([], new Set(['a']))).toBe(`${RELAXED_FALLBACK} Your choice is kept.`);
  });
  it('mentions the hand size the pins were made for only when it differs', () => {
    const pins = { n1: { finger: 2 as const, pinned: true, source: 'user' as const } };
    expect(
      handSizeNotice(
        { pins: {}, showAllDigits: false, showEditorial: false, handSize: 'small' },
        'large',
      ),
    ).toBeNull();
    expect(
      handSizeNotice(
        { pins, showAllDigits: false, showEditorial: false, handSize: 'small' },
        'small',
      ),
    ).toBeNull();
    expect(
      handSizeNotice(
        { pins, showAllDigits: false, showEditorial: false, handSize: 'small' },
        'large',
      ),
    ).toBe('Your changes to this piece were made for a Small hand.');
  });
});
```

`apps/web/src/score/edit/FingerPopover.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FingerPopover } from './FingerPopover.js';

const view = {
  finger: 3 as const,
  summary: 'Finger 3 is the clear choice here.',
  confidenceLabel: 'sure' as const,
  terms: [
    { text: 'a stretch wider than comfortable', points: 4 },
    { text: 'moving the hand to a new position', points: 1.5 },
    { text: 'finger 1 then 3 going up', points: -0.5 },
    { text: 'the fourth finger, which is weaker', points: 0.25 },
  ],
};
function setup(over: Partial<Parameters<typeof FingerPopover>[0]> = {}) {
  const props = {
    label: 'E4, right hand',
    entry: {
      finger: 3 as const,
      confidence: 0.9,
      alternatives: [
        { finger: 2 as const, cost: 2 },
        { finger: 4 as const, cost: 3.25 },
      ],
      source: 'engine' as const,
    },
    view,
    editorFinger: null,
    position: { left: 10, top: 20 },
    onChoose: vi.fn(),
    onUnpin: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const r = render(<FingerPopover {...props} />);
  return { ...r, props };
}

describe('FingerPopover', () => {
  it('shows the note, five fingers with the current one pressed, the summary, confidence, alternatives and the top three reasons', () => {
    const { container } = setup();
    const dialog = screen.getByRole('dialog', { name: 'Finger for E4, right hand' });
    const group = within(dialog).getByRole('group', { name: 'Choose a finger' });
    expect(within(group).getAllByRole('button')).toHaveLength(5);
    expect(within(group).getByRole('button', { name: 'Finger 3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(group).getByRole('button', { name: 'Finger 2' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(dialog).getByText('Finger 3 is the clear choice here.')).toBeInTheDocument();
    expect(within(dialog).getByText('Confidence: Sure')).toBeInTheDocument();
    expect(
      within(within(dialog).getByRole('list', { name: 'Other good fingers' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['2 · +2.0', '4 · +3.3']);
    expect(
      within(within(dialog).getByRole('list', { name: 'Why' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'a stretch wider than comfortable · +4.0',
      'moving the hand to a new position · +1.5',
      'finger 1 then 3 going up · -0.5',
    ]);
    expect(within(dialog).queryByRole('button', { name: 'Unpin' })).toBeNull();
    expect(dialog).toHaveStyle({ left: '10px', top: '20px' });
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);
  });
  it('focuses the current finger and reports choices, close and unpin', async () => {
    const { props } = setup({
      entry: { finger: 3, pinned: true, source: 'user' },
      editorFinger: 2,
    });
    expect(screen.getByRole('button', { name: 'Finger 3' })).toHaveFocus();
    expect(screen.getByText('Pinned by you')).toBeInTheDocument();
    expect(screen.queryByText(/^Confidence:/)).toBeNull();
    expect(screen.getByText("The editor's finger: 2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Finger 4' }));
    expect(props.onChoose).toHaveBeenCalledWith(4);
    await userEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    expect(props.onUnpin).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalled();
  });
  it('says so when nothing makes the finger hard, and hides an empty alternatives list', () => {
    setup({
      view: { ...view, terms: [] },
      entry: { finger: 3, confidence: 0.5, source: 'engine' },
    });
    expect(screen.getByText('Nothing makes this finger hard here.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Other good fingers' })).toBeNull();
  });
});
```

(`3.25.toFixed(1)` is `'3.3'` in V8 and in happy-dom's runtime; the alternatives line uses `toFixed(1)` exactly.)

`apps/web/src/score/edit/useScoreKeys.test.ts`:

```ts
import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useScoreKeys } from './useScoreKeys.js';

function handlers() {
  return { onDigit: vi.fn(), onEscape: vi.fn(), onSpace: vi.fn(), onArrow: vi.fn() };
}
afterEach(() => {
  document.body.innerHTML = '';
});

describe('useScoreKeys', () => {
  it('maps 1-5, Escape, Space and the arrows', () => {
    const h = handlers();
    renderHook(() => useScoreKeys(true, h));
    fireEvent.keyDown(document.body, { key: '3' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: ' ' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.body, { key: '6' });
    expect(h.onDigit).toHaveBeenCalledTimes(1);
    expect(h.onDigit).toHaveBeenCalledWith(3);
    expect(h.onEscape).toHaveBeenCalledTimes(1);
    expect(h.onSpace).toHaveBeenCalledTimes(1);
    expect(h.onArrow.mock.calls).toEqual([[1], [-1]]);
  });
  it('ignores typing targets, modifier chords, Space on buttons, and a disabled hook', () => {
    const h = handlers();
    const { rerender } = renderHook(({ on }) => useScoreKeys(on, h), {
      initialProps: { on: true },
    });
    const input = document.body.appendChild(document.createElement('input'));
    const select = document.body.appendChild(document.createElement('select'));
    const button = document.body.appendChild(document.createElement('button'));
    fireEvent.keyDown(input, { key: '2' });
    fireEvent.keyDown(select, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: '2', ctrlKey: true });
    fireEvent.keyDown(button, { key: ' ' });
    expect(h.onDigit).not.toHaveBeenCalled();
    expect(h.onArrow).not.toHaveBeenCalled();
    expect(h.onSpace).not.toHaveBeenCalled();
    fireEvent.keyDown(button, { key: '4' });
    expect(h.onDigit).toHaveBeenCalledWith(4);
    rerender({ on: false });
    fireEvent.keyDown(document.body, { key: '5' });
    expect(h.onDigit).toHaveBeenCalledTimes(1);
  });
});
```

Append to `apps/web/src/score/Transport.test.tsx`:

```tsx
it('Play is plain while a note is selected', () => {
  render(<Transport playback={playback(false)} measureCount={12} selectionActive />);
  expect(screen.getByRole('button', { name: 'Play' })).not.toHaveClass('is-red');
});
```

Append to `apps/web/e2e/helpers/score.ts` (and add `type Locator` to its Playwright import):

```ts
export function digitOf(page: Page, noteId: string): Locator {
  return page.locator(`.score-sheet g.fing[data-startid="#${noteId}"]`);
}

export function popoverOf(page: Page): Locator {
  return page.getByRole('dialog', { name: /^Finger for / });
}

export async function pressedFinger(page: Page): Promise<number> {
  const label = await popoverOf(page)
    .locator('button[aria-pressed="true"]')
    .getAttribute('aria-label');
  const m = /^Finger ([1-5])$/.exec(label ?? '');
  if (!m) throw new Error(`no pressed finger button (label "${label}")`);
  return Number(m[1]);
}
```

`apps/web/e2e/edit.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { expectOneRed } from './helpers/red.js';
import {
  chordPair,
  digitOf as digit,
  firstDigitNoteId,
  openScore,
  popoverOf as popover,
  pressedFinger,
  waitSettled,
} from './helpers/score.js';

const TWINKLE = '/?audio=silent#/piece/twinkle-twinkle-little-star';

test('select a digit and choose another finger: red moves to the note, the digit changes and is underlined', async ({
  page,
}) => {
  await openScore(page, TWINKLE);
  const id = await firstDigitNoteId(page);
  await digit(page, id).click();
  await expect(popover(page)).toBeVisible();
  const roots = await expectOneRed(page, 'note selected');
  expect(roots[0]).toMatchObject({ tag: 'g', id, inSheet: true });
  await expect(page.getByRole('button', { name: 'Play' })).not.toHaveClass(/is-red/);
  await expectNoSeriousA11y(page, 'popover open');
  const before = await pressedFinger(page);
  const next = (before % 5) + 1;
  await popover(page)
    .getByRole('button', { name: `Finger ${next}` })
    .click();
  await waitSettled(page);
  await expect(digit(page, id)).toHaveText(String(next));
  await expect(digit(page, id)).toHaveClass(/is-pinned/);
  expect(
    await digit(page, id)
      .locator('text')
      .first()
      .evaluate((t) => getComputedStyle(t).textDecorationLine),
  ).toContain('underline');
  await expect(popover(page).getByRole('button', { name: `Finger ${next}` })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(popover(page).getByText('Pinned by you')).toBeVisible();
  await expectOneRed(page, 'after the pin');
  await popover(page).getByRole('button', { name: 'Unpin' }).click();
  await waitSettled(page);
  await expect(page.locator('.score-sheet g.fing.is-pinned')).toHaveCount(0);
  await expect(digit(page, id)).toHaveText(String(before));
});

test('keyboard: digits set the finger, arrows move the selection, Escape closes then clears, Space plays', async ({
  page,
}) => {
  await openScore(page, TWINKLE);
  const id = await firstDigitNoteId(page);
  await digit(page, id).click();
  const next = ((await pressedFinger(page)) % 5) + 1;
  await page.keyboard.press(String(next));
  await waitSettled(page);
  await expect(digit(page, id)).toHaveText(String(next));
  await page.keyboard.press('ArrowRight');
  const moved = await expectOneRed(page, 'after ArrowRight');
  expect(moved[0]!.id).not.toBe(id);
  expect(moved[0]!.inSheet).toBe(true);
  await page.keyboard.press('Escape');
  await expect(popover(page)).toBeHidden();
  const kept = await expectOneRed(page, 'selection without popover');
  expect(kept[0]!.id).toBe(moved[0]!.id);
  await page.keyboard.press('Escape');
  const play = await expectOneRed(page, 'nothing selected');
  expect(play[0]!.tag).toBe('button');
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('playing clears the selection: the cursor is the only red', async ({ page }) => {
  await openScore(page, TWINKLE);
  await digit(page, await firstDigitNoteId(page)).click();
  await expect(popover(page)).toBeVisible();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.score-sheet [data-onset-tick]').first()).toBeVisible({
    timeout: 5_000,
  });
  await expect(popover(page)).toBeHidden();
  await expect(page.locator('.score-sheet [data-selected]')).toHaveCount(0);
  const roots = await expectOneRed(page, 'playing after a selection');
  expect(roots.every((r) => r.inSheet)).toBe(true);
  await page.locator('.score-sheet g.fing').last().click();
  await expect(popover(page)).toBeHidden();
  await page.getByRole('button', { name: 'Pause' }).click();
});

test('a pin that breaks a law shows the notice and keeps both pins', async ({ page }) => {
  await openScore(page, '/#/piece/burgmuller-op100-no2-arabesque');
  const [a, b] = await chordPair(page);
  await page.locator(`[id="${a}"]`).dispatchEvent('click');
  await expect(popover(page)).toBeVisible();
  await page.keyboard.press('2');
  await waitSettled(page);
  await page.locator(`[id="${b}"]`).dispatchEvent('click');
  await page.keyboard.press('2');
  await waitSettled(page);
  await expect(page.getByRole('status').filter({ hasText: 'Your choice is kept.' })).toContainText(
    'Two notes played together cannot use the same finger.',
  );
  for (const id of [a, b]) {
    await expect(digit(page, id)).toHaveText('2');
    await expect(digit(page, id)).toHaveClass(/is-pinned/);
  }
  await expectOneRed(page, 'relaxed notice');
  await expectNoSeriousA11y(page, 'relaxed notice');
});
```

(Noteheads are clicked with `dispatchEvent('click')` so the event target is the `g.note` itself whatever its geometry; digits are clicked for real, which is what a user does.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @digitus2/web test`
Expected: FAIL (modules and exports missing).

- [ ] **Step 3: Implement the pure parts**

`dom.ts` additions (they reuse the file's `RED`, `escapeId` and `attrValue`):

```ts
const SELECTED = 'data-selected';

export function digitNoteIdAt(target: EventTarget | null): string | null {
  const el = target as Partial<Element> | null;
  if (!el || typeof el.closest !== 'function') return null;
  const id = el.closest('g.fing')?.getAttribute('data-startid');
  return id ? id.replace(/^#/, '') : null;
}

export function targetNoteId(target: EventTarget | null): string | null {
  return digitNoteIdAt(target) ?? noteIdAt(target);
}

export function setSelected(host: Element, noteId: string | null): Element | null {
  for (const el of Array.from(host.querySelectorAll(`[${SELECTED}]`))) {
    el.classList.remove(RED);
    el.removeAttribute(SELECTED);
  }
  if (!noteId) return null;
  const note = host.querySelector(escapeId(noteId));
  if (!note) return null;
  note.classList.add(RED);
  note.setAttribute(SELECTED, '');
  return note;
}

export function markPinned(host: Element, ids: ReadonlySet<string>): void {
  for (const g of Array.from(host.querySelectorAll('g.fing'))) {
    const id = (g.getAttribute('data-startid') ?? '').replace(/^#/, '');
    g.classList.toggle('is-pinned', ids.has(id));
  }
}

export function anchorRectOf(host: Element, noteId: string): DOMRect | null {
  const el =
    host.querySelector(`g.fing[data-startid="#${attrValue(noteId)}"]`) ??
    host.querySelector(escapeId(noteId));
  return el ? el.getBoundingClientRect() : null;
}
```

`placePopover.ts`:

```ts
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function placePopover(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8,
): { left: number; top: number; side: 'below' | 'above' } {
  const centred = anchor.left + anchor.width / 2 - size.width / 2;
  const left = Math.max(gap, Math.min(viewport.width - size.width - gap, centred));
  const below = anchor.top + anchor.height + gap;
  if (below + size.height <= viewport.height - gap) return { left, top: below, side: 'below' };
  const above = anchor.top - gap - size.height;
  if (above >= gap) return { left, top: above, side: 'above' };
  return {
    left,
    top: Math.max(gap, Math.min(below, viewport.height - size.height - gap)),
    side: 'below',
  };
}
```

`neighbors.ts`: `neighborNote` filters `score.notes` to the note's hand, sorts by `onsetTick` then `midi`, and returns the id at index ± 1 or `null`; `noteName` maps `alter` −2, −1, 0, 1, 2 to `𝄫`, `♭`, ``, `♯`, `𝄪`; `noteLabel` is `` `${noteName(n)}, ${n.hand === 'R' ? 'right' : 'left'} hand` ``.

`notices.ts`:

```ts
import { describeIssue } from '@digitus2/engine';
import type { LintIssue } from '@digitus2/engine';
import type { PieceState } from '../../app/pieceStore.js';
import type { HandSize } from '../../app/store.js';

export const RELAXED_FALLBACK = 'That finger makes this passage very hard to play.';
const HAND_LABEL: Record<HandSize, string> = {
  large: 'Large',
  medium: 'Medium',
  small: 'Small',
  child: 'Child',
};

export function relaxedNotice(issues: readonly LintIssue[], pinned: ReadonlySet<string>): string {
  const touching = issues.filter((i) => i.noteIds.some((id) => pinned.has(id)));
  const chosen = touching.length > 0 ? touching : issues;
  const texts = [...new Set(chosen.map((i) => describeIssue(i)))];
  return `${texts.length > 0 ? texts.join(' ') : RELAXED_FALLBACK} Your choice is kept.`;
}

export function handSizeNotice(piece: PieceState, current: HandSize): string | null {
  if (!piece.handSize || piece.handSize === current || Object.keys(piece.pins).length === 0)
    return null;
  return `Your changes to this piece were made for a ${HAND_LABEL[piece.handSize]} hand.`;
}
```

`useScoreKeys.ts`: as specified in Interfaces; one `keydown` listener on `document` while `enabled`; the latest handlers live in a ref updated in `useLayoutEffect`; digits and arrows call `preventDefault()`; Space calls `preventDefault()` only when it acts; `isControlTarget` covers `button` and `a` in addition to the typing targets; keys with Ctrl, Meta or Alt are ignored.

- [ ] **Step 4: Implement the popover, the wiring and the styles**

`FingerPopover.tsx` renders, in order, with the copy from the "Exact UI copy" table: the dialog (`role="dialog"`, `aria-label="Finger for <label>"`, class `finger-popover`, inline `left`/`top`), the title line, the group of five buttons (plain `<button type="button">`, never `Button primary`), the summary, the confidence or `Pinned by you` line (labels `Sure`, `Likely`, `Unsure`), the editor line when `editorFinger` is not null, the `Other good fingers` list from `entry.alternatives` (`<finger> · +<cost.toFixed(1)>`, omitted when empty), the `Why` list of the first three `view.terms` (`<text> · <sign><points.toFixed(1)>`, `+` for non-negative) or the `Nothing makes this finger hard here.` line, then `Unpin` (pinned only) and `Close`. On mount it focuses the pressed finger button. Labelled lists use `<ul aria-label="…">`.

`ScoreView.tsx`: the behaviour list above. `Transport.tsx`: the `selectionActive` prop.

`base.css` (variables only; `node scripts/check-colors.mjs` must stay green):

```css
.finger-popover {
  position: fixed;
  z-index: 10;
  width: 18rem;
  max-width: calc(100vw - 16px);
  background: var(--paper);
  border: 1px solid var(--ink);
  padding: 0.75rem;
  animation: pop-in var(--dur-fast) var(--ease);
}
@keyframes pop-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.finger-buttons {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.25rem;
}
.finger-buttons button[aria-pressed='true'] {
  background: var(--ink);
  color: var(--paper);
}
.score-sheet g.note,
.score-sheet g.fing {
  cursor: pointer;
}
.score-sheet g.fing.is-pinned text {
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @digitus2/web test && node scripts/check-colors.mjs`
Expected: PASS; `colors ok`.

Run: `pnpm --filter @digitus2/web e2e`
Expected: `edit.spec.ts` passes on `desktop`; every earlier spec still passes.

- [ ] **Step 6: Run the whole loop**

Run: `pnpm verify`
Expected: all PASS, including `bundle` (`allowance ok`; if the allowance is exceeded, check that `@digitus2/engine` imports on the main thread are limited to `explainNote`, `describeIssue` and types, and that no solver module reached the entry chunk through a value import).

---

### Task 8: The side panel: level, printed count, editor agreement and differences, reset (app)

**Files:**

- Create: `apps/web/src/score/edit/editor.ts`, `apps/web/src/score/edit/editor.test.ts`, `apps/web/src/score/SidePanel.test.tsx`, `apps/web/e2e/panel.spec.ts`
- Modify: `apps/web/src/score/SidePanel.tsx`, `apps/web/src/score/ScoreView.tsx` (pass `selected` and `onSelect`), `apps/web/src/design/base.css` (panel rows)

**Interfaces:**

- Consumes: `ScoreDocument` (Task 6), `usePieceStore` (Task 5), `useAppStore` settings `level` and `handSize` (Task 4, M4), the e2e helpers (Tasks 6 and 7).
- Produces:

```ts
// edit/editor.ts
export interface EditorComparison {
  fingered: number; // notes with an editorial finger
  agree: number;
  percent: number; // Math.round(100 * agree / fingered); 100 when fingered is 0
  differences: string[]; // note ids where the engine differs, in score order (onset, right hand first, then pitch)
}
export function compareWithEditor(
  score: Score,
  engine: Assignment,
  editorial: Assignment,
): EditorComparison;
export function nextDifference(
  differences: readonly string[],
  current: string | null,
  dir: 1 | -1,
): string | null;
// wraps around; from a note that is not a difference (or no selection) goes to the first (dir 1) or last (dir -1)

// SidePanel.tsx
export function SidePanel(props: {
  doc: ScoreDocument;
  source: PieceSource;
  selected: string | null;
  onSelect(noteId: string): void; // ScoreView selects the note and opens the popover
}): JSX.Element;
```

Panel order and copy (M4 items keep their copy): piece facts; `Level` select (`Beginner`, `Expert`) bound to `settings.level`; `Hand size` (M4); `Show all fingers` and the line `Printed <n> of <total> fingers` (Task 6); `Show the editor's fingering` (M4, now bound to the per-piece `showEditorial`), shown when the piece has an editorial fingering; under it, when `doc.engine` and `doc.editorial` exist: `Agrees with the editor on <percent> % of the notes the editor fingered` and the buttons `Previous difference` and `Next difference`, or `No differences from the editor.`; `Reset my changes` (disabled without pins), which on click is replaced in place by `Reset?` with `Yes` and `No` (Yes calls `resetPins()`, either answer restores the button); the M4 timing line, `Export MusicXML`, `Print`. Nothing in the panel is red.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/score/edit/editor.test.ts`:

```ts
import type { Assignment, Note, Score } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { compareWithEditor, nextDifference } from './editor.js';

const note = (id: string, hand: 'R' | 'L', onsetTick: number, midi: number) =>
  ({ id, hand, onsetTick, midi }) as Note;
const score = {
  notes: [
    note('l1', 'L', 0, 48),
    note('r1', 'R', 0, 60),
    note('r2', 'R', 480, 62),
    note('r3', 'R', 960, 64),
  ],
} as Score;
const engine: Assignment = {
  l1: { finger: 5, source: 'engine' },
  r1: { finger: 1, source: 'engine' },
  r2: { finger: 2, source: 'engine' },
  r3: { finger: 3, source: 'engine' },
};

describe('compareWithEditor', () => {
  it('counts agreement on the notes the editor fingered and lists differences in score order', () => {
    const editorial: Assignment = {
      r3: { finger: 4, source: 'editorial' },
      l1: { finger: 4, source: 'editorial' },
      r1: { finger: 1, source: 'editorial' },
    };
    expect(compareWithEditor(score, engine, editorial)).toEqual({
      fingered: 3,
      agree: 1,
      percent: 33,
      differences: ['l1', 'r3'],
    });
  });
  it('is 100 percent with nothing to compare', () => {
    expect(compareWithEditor(score, engine, {})).toEqual({
      fingered: 0,
      agree: 0,
      percent: 100,
      differences: [],
    });
  });
});

describe('nextDifference', () => {
  const d = ['a', 'b', 'c'];
  it('walks forward and backward with wrap-around', () => {
    expect(nextDifference(d, null, 1)).toBe('a');
    expect(nextDifference(d, 'a', 1)).toBe('b');
    expect(nextDifference(d, 'c', 1)).toBe('a');
    expect(nextDifference(d, 'a', -1)).toBe('c');
    expect(nextDifference(d, 'x', -1)).toBe('c');
    expect(nextDifference([], 'a', 1)).toBeNull();
  });
});
```

(Score order is onset first, so `l1` at tick 0 comes before `r3` at tick 960; at equal onsets the right hand would come first.)

`apps/web/src/score/SidePanel.test.tsx`:

```tsx
import type { Assignment, Note, Score } from '@digitus2/engine';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePieceStore } from '../app/pieceStore.js';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { SidePanel } from './SidePanel.js';
import type { ScoreDocument } from './useScoreDocument.js';

const notes = ['a', 'b', 'c'].map(
  (id, i) => ({ id, hand: 'R', onsetTick: i * 480, midi: 60 + i }) as Note,
);
const engine: Assignment = {
  a: { finger: 1, source: 'engine' },
  b: { finger: 2, source: 'engine' },
  c: { finger: 3, source: 'engine' },
};
function doc(over: Partial<ScoreDocument> = {}): ScoreDocument {
  return {
    status: 'ready',
    error: null,
    score: { notes } as Score,
    xml: '<score-partwise/>',
    assignment: { a: engine.a! },
    editorial: null,
    pages: [],
    solveMs: 12,
    renderMs: 34,
    title: 'Test',
    composer: 'Nobody',
    warnings: [],
    engine,
    explanations: {},
    printed: new Set(['a']),
    density: 100 / 3,
    shownCount: 1,
    noteCount: 3,
    relaxed: [],
    lawIssues: [],
    solveSeq: 1,
    busy: false,
    ...over,
  } as unknown as ScoreDocument;
}
const source = { kind: 'file' as const, name: 't.musicxml', bytes: new Uint8Array([1]) };

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
  });
  usePieceStore.setState({
    key: 'k',
    piece: { pins: {}, showAllDigits: false, showEditorial: false },
  });
});

describe('SidePanel', () => {
  it('shows the printed count and toggles Show all fingers for this piece', async () => {
    const { container } = render(
      <SidePanel doc={doc()} source={source} selected={null} onSelect={vi.fn()} />,
    );
    expect(screen.getByTestId('printed-count')).toHaveTextContent('Printed 1 of 3 fingers');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show all fingers' }));
    expect(usePieceStore.getState().piece.showAllDigits).toBe(true);
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);
  });
  it('writes the level setting', async () => {
    render(<SidePanel doc={doc()} source={source} selected={null} onSelect={vi.fn()} />);
    const level = screen.getByLabelText('Level');
    expect(Array.from((level as HTMLSelectElement).options).map((o) => o.text)).toEqual([
      'Beginner',
      'Expert',
    ]);
    await userEvent.selectOptions(level, 'expert');
    expect(useAppStore.getState().settings.level).toBe('expert');
  });
  it('asks before resetting the pins', async () => {
    const { rerender } = render(
      <SidePanel doc={doc()} source={source} selected={null} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Reset my changes' })).toBeDisabled();
    usePieceStore.getState().setPin('b', 4, 'medium');
    rerender(<SidePanel doc={doc()} source={source} selected={null} onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset my changes' }));
    expect(screen.getByText('Reset?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(Object.keys(usePieceStore.getState().piece.pins)).toEqual(['b']);
    await userEvent.click(screen.getByRole('button', { name: 'Reset my changes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(usePieceStore.getState().piece.pins).toEqual({});
    expect(screen.getByRole('button', { name: 'Reset my changes' })).toBeDisabled();
  });
  it('compares with the editor and walks through the differences', async () => {
    const onSelect = vi.fn();
    const editorial: Assignment = {
      a: { finger: 1, source: 'editorial' },
      b: { finger: 5, source: 'editorial' },
      c: { finger: 5, source: 'editorial' },
    };
    const { rerender } = render(
      <SidePanel doc={doc({ editorial })} source={source} selected={null} onSelect={onSelect} />,
    );
    expect(
      screen.getByText('Agrees with the editor on 33 % of the notes the editor fingered'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next difference' }));
    expect(onSelect).toHaveBeenLastCalledWith('b');
    rerender(
      <SidePanel doc={doc({ editorial })} source={source} selected="b" onSelect={onSelect} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Next difference' }));
    expect(onSelect).toHaveBeenLastCalledWith('c');
    await userEvent.click(screen.getByRole('button', { name: 'Previous difference' }));
    expect(onSelect).toHaveBeenLastCalledWith('c');
  });
  it('says when nothing differs from the editor', () => {
    const editorial: Assignment = { a: { finger: 1, source: 'editorial' } };
    render(
      <SidePanel doc={doc({ editorial })} source={source} selected={null} onSelect={vi.fn()} />,
    );
    expect(screen.getByText('No differences from the editor.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next difference' })).toBeNull();
  });
});
```

(In the walk test, `selected="b"` then `Next` gives `c`; `Previous` from `b` wraps to `c` because the differences are `['b', 'c']`.)

`apps/web/e2e/panel.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { expectOneRed } from './helpers/red.js';
import {
  digitOf,
  firstDigitNoteId,
  openScore,
  popoverOf,
  pressedFinger,
  waitSettled,
} from './helpers/score.js';

const TWINKLE = '/#/piece/twinkle-twinkle-little-star';

async function pinFirstDigit(
  page: import('@playwright/test').Page,
): Promise<{ id: string; finger: number }> {
  const id = await firstDigitNoteId(page);
  await digitOf(page, id).click();
  const finger = ((await pressedFinger(page)) % 5) + 1;
  await page.keyboard.press(String(finger));
  await waitSettled(page);
  await popoverOf(page).getByRole('button', { name: 'Close' }).click();
  return { id, finger };
}

test('Show all fingers prints every digit, and unchecking returns to the printed set', async ({
  page,
}) => {
  const { printed, total } = await openScore(page, TWINKLE);
  expect(total).toBe(64);
  await page.getByLabel('Show all fingers').check();
  await waitSettled(page);
  await expect(page.getByTestId('printed-count')).toHaveText('Printed 64 of 64 fingers');
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64);
  await expectOneRed(page, 'show all');
  await page.getByLabel('Show all fingers').uncheck();
  await waitSettled(page);
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(printed);
});

test('Reset my changes asks first, then clears every pin', async ({ page }) => {
  await openScore(page, TWINKLE);
  await pinFirstDigit(page);
  await expect(page.locator('.score-sheet g.fing.is-pinned')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reset my changes' }).click();
  await expect(page.getByText('Reset?')).toBeVisible();
  await expectOneRed(page, 'reset confirm');
  await expectNoSeriousA11y(page, 'reset confirm');
  await page.getByRole('button', { name: 'No' }).click();
  await expect(page.locator('.score-sheet g.fing.is-pinned')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reset my changes' }).click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await waitSettled(page);
  await expect(page.locator('.score-sheet g.fing.is-pinned')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reset my changes' })).toBeDisabled();
});

test('changing the level or the hand size re-solves and keeps the pins', async ({ page }) => {
  await openScore(page, TWINKLE);
  const { id, finger } = await pinFirstDigit(page);
  await page.getByLabel('Level').selectOption('expert');
  await waitSettled(page);
  await expect(digitOf(page, id)).toHaveText(String(finger));
  await expect(digitOf(page, id)).toHaveClass(/is-pinned/);
  await page.getByLabel('Hand size').selectOption('child');
  await waitSettled(page);
  await expect(digitOf(page, id)).toHaveText(String(finger));
  await expect(digitOf(page, id)).toHaveClass(/is-pinned/);
});

test('editor differences: the agreement rate, and Next or Previous move the red selection', async ({
  page,
}) => {
  await openScore(page, '/#/piece/burgmuller-op100-no2-arabesque');
  const agreement = page.getByText(
    /^Agrees with the editor on \d+ % of the notes the editor fingered$/,
  );
  await expect(agreement).toBeVisible({ timeout: 20_000 });
  // Guarantee at least one difference: pin an editor-fingered note to another finger.
  await page.getByLabel("Show the editor's fingering").check();
  await waitSettled(page);
  const target = await firstDigitNoteId(page);
  const editorFinger = Number(await digitOf(page, target).textContent());
  await page.getByLabel("Show the editor's fingering").uncheck();
  await waitSettled(page);
  await page.locator(`[id="${target}"]`).dispatchEvent('click');
  await page.keyboard.press(String((editorFinger % 5) + 1));
  await waitSettled(page);
  await popoverOf(page).getByRole('button', { name: 'Close' }).click();
  await expect(agreement).not.toHaveText(/on 100 %/);

  await page.getByRole('button', { name: 'Next difference' }).click();
  await expect(popoverOf(page)).toBeVisible();
  const first = await expectOneRed(page, 'editor difference');
  expect(first[0]).toMatchObject({ tag: 'g', inSheet: true });
  const editorLine = await popoverOf(page)
    .getByText(/^The editor's finger: [1-5]$/)
    .textContent();
  expect(await pressedFinger(page)).not.toBe(Number(editorLine!.slice(-1)));
  await expectNoSeriousA11y(page, 'editor difference');
  await page.getByRole('button', { name: 'Next difference' }).click();
  await expectOneRed(page, 'next difference');
  await page.getByRole('button', { name: 'Previous difference' }).click();
  const back = await expectOneRed(page, 'previous difference');
  expect(back[0]!.id).toBe(first[0]!.id);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @digitus2/web test`
Expected: FAIL (`editor.ts` missing; the panel lacks the new controls).

- [ ] **Step 3: Implement**

`editor.ts`:

```ts
import type { Assignment, Score } from '@digitus2/engine';

export interface EditorComparison {
  fingered: number;
  agree: number;
  percent: number;
  differences: string[];
}

export function compareWithEditor(
  score: Score,
  engine: Assignment,
  editorial: Assignment,
): EditorComparison {
  const ordered = [...score.notes].sort(
    (a, b) =>
      a.onsetTick - b.onsetTick ||
      (a.hand === b.hand ? 0 : a.hand === 'R' ? -1 : 1) ||
      a.midi - b.midi,
  );
  let fingered = 0;
  let agree = 0;
  const differences: string[] = [];
  for (const n of ordered) {
    const e = editorial[n.id];
    if (!e) continue;
    fingered++;
    if (engine[n.id]?.finger === e.finger) agree++;
    else differences.push(n.id);
  }
  return {
    fingered,
    agree,
    percent: fingered === 0 ? 100 : Math.round((100 * agree) / fingered),
    differences,
  };
}

export function nextDifference(
  differences: readonly string[],
  current: string | null,
  dir: 1 | -1,
): string | null {
  if (differences.length === 0) return null;
  const i = current === null ? -1 : differences.indexOf(current);
  if (i < 0) return dir === 1 ? differences[0]! : differences[differences.length - 1]!;
  return differences[(i + dir + differences.length) % differences.length]!;
}
```

`SidePanel.tsx`: the order and copy above; `compareWithEditor` is memoised on `[doc.score, doc.engine, doc.editorial]`; the reset confirmation is local state (`confirming: boolean`) and focus moves to `No` when it appears, back to `Reset my changes` when it closes. `ScoreView` passes `selected` and `onSelect={(id) => { select(id); openPopover(); }}`.

`base.css`: `.panel-row { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center }` for the difference buttons and the reset confirmation; nothing else.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @digitus2/web test && node scripts/check-colors.mjs`
Expected: PASS.

Run: `pnpm --filter @digitus2/web e2e`
Expected: `panel.spec.ts` passes on `desktop`; earlier specs still pass.

- [ ] **Step 5: Run the whole loop**

Run: `pnpm verify`
Expected: all PASS.

---

### Task 9: Persistence end to end, the state walk with the new states, the bundle allowance, and the docs (app)

**Files:**

- Create: `apps/web/e2e/persistence.spec.ts`
- Modify: `apps/web/e2e/states.spec.ts`, `apps/web/e2e/helpers/score.ts` (`pinAgainstEditor`), `apps/web/e2e/visual.spec.ts` (new baselines), `docs/app.md`, `docs/superpowers/specs/2026-10-13-verification-design.md` (a "Measured (M5)" note under the goals table; floors unchanged)

**Interfaces:**

- Consumes: everything above.
- Produces: `pinAgainstEditor(page): Promise<string>` (on a piece with an editor's fingering: shows the editor's digits, takes the first one, hides them again, pins that note to another finger, closes the popover, and returns the note id; guarantees at least one difference from the editor).

The new states (added to M4's `STATES` table; `expectTag: 'note'` means exactly one red root, a `g.note` inside `.score-sheet`):

| State                   | Reach it                                                | Red element |
| ----------------------- | ------------------------------------------------------- | ----------- |
| score-popover           | score-ready, click the first printed digit              | note        |
| score-selected          | score-popover, then Escape                              | note        |
| score-pinned            | score-popover, press another finger, then Close         | Play        |
| score-show-all          | score-ready, check `Show all fingers`                   | Play        |
| score-reset-confirm     | score-pinned, click `Reset my changes`                  | Play        |
| score-editor-difference | Arabesque, `pinAgainstEditor`, then `Next difference`   | note        |
| score-relaxed-notice    | Arabesque, the first chord pair both pinned to finger 2 | note        |

- [ ] **Step 1: Write the tests**

Append to `apps/web/e2e/helpers/score.ts`:

```ts
export async function pinAgainstEditor(page: Page): Promise<string> {
  await page.getByLabel("Show the editor's fingering").check();
  await waitSettled(page);
  const id = await firstDigitNoteId(page);
  const editorFinger = Number(await digitOf(page, id).textContent());
  await page.getByLabel("Show the editor's fingering").uncheck();
  await waitSettled(page);
  await page.locator(`[id="${id}"]`).dispatchEvent('click');
  await page.keyboard.press(String((editorFinger % 5) + 1));
  await waitSettled(page);
  await popoverOf(page).getByRole('button', { name: 'Close' }).click();
  return id;
}
```

`apps/web/e2e/persistence.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import {
  digitOf,
  firstDigitNoteId,
  openScore,
  popoverOf,
  pressedFinger,
  waitSettled,
} from './helpers/score.js';

const TWINKLE = '/#/piece/twinkle-twinkle-little-star';
const FIXTURE = fileURLToPath(new URL('../fixtures/short-piano.musicxml', import.meta.url));

async function pinFirst(
  page: import('@playwright/test').Page,
): Promise<{ id: string; finger: number }> {
  const id = await firstDigitNoteId(page);
  await digitOf(page, id).click();
  const finger = ((await pressedFinger(page)) % 5) + 1;
  await page.keyboard.press(String(finger));
  await waitSettled(page);
  await popoverOf(page).getByRole('button', { name: 'Close' }).click();
  return { id, finger };
}

test('a pin and Show all fingers survive a reload; another piece keeps its own toggles', async ({
  page,
}) => {
  await openScore(page, TWINKLE);
  const { id, finger } = await pinFirst(page);
  await page.getByLabel('Show all fingers').check();
  await waitSettled(page);
  await page.reload();
  await waitSettled(page);
  await expect(page.getByTestId('printed-count')).toHaveText('Printed 64 of 64 fingers');
  await expect(page.getByLabel('Show all fingers')).toBeChecked();
  await expect(digitOf(page, id)).toHaveText(String(finger));
  await expect(digitOf(page, id)).toHaveClass(/is-pinned/);
  await page.goto('/#/piece/ode-to-joy');
  await waitSettled(page);
  await expect(page.getByLabel('Show all fingers')).not.toBeChecked();
  await expect(page.locator('.score-sheet g.fing.is-pinned')).toHaveCount(0);
  await page.goto(TWINKLE);
  await waitSettled(page);
  await expect(digitOf(page, id)).toHaveClass(/is-pinned/);
});

test('a dropped file keeps its pins under its own key and gets them back when dropped again', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('choose a file').setInputFiles(FIXTURE);
  await waitSettled(page);
  const { id, finger } = await pinFirst(page);
  await page.reload();
  await expect(page.getByText('Drop the file again to continue.')).toBeVisible();
  await page.getByLabel('choose a file').setInputFiles(FIXTURE);
  await waitSettled(page);
  await expect(digitOf(page, id)).toHaveText(String(finger));
  await expect(digitOf(page, id)).toHaveClass(/is-pinned/);
});
```

`apps/web/e2e/states.spec.ts`: add the seven states of the table to `STATES` (their `go` functions use `openScore`, `firstDigitNoteId`, `digitOf`, `popoverOf`, `pressedFinger`, `chordPair` and `pinAgainstEditor` exactly as the steps in the table say; the relaxed-notice state presses `2` on both notes of `chordPair` as `edit.spec.ts` does), extend the `expectTag` union with `'note'`, and in the loop body add:

```ts
if (s.expectTag === 'note') {
  expect(roots).toHaveLength(1);
  expect(roots[0]!.inSheet).toBe(true);
  expect(roots[0]!.className).toMatch(/\bnote\b/);
}
```

and, after the loop:

```ts
test('states on mobile: the popover is inside the viewport', async ({ page }) => {
  await openScore(page, '/#/piece/twinkle-twinkle-little-star');
  const ids = await page
    .locator('.score-sheet g.fing')
    .evaluateAll((els) => els.map((e) => (e.getAttribute('data-startid') ?? '').slice(1)));
  const viewport = page.viewportSize()!;
  for (const id of [ids[0]!, ids[Math.floor(ids.length / 2)]!, ids[ids.length - 1]!]) {
    await digitOf(page, id).click();
    const box = (await popoverOf(page).boundingBox())!;
    expect(box.x, id).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, id).toBeLessThanOrEqual(viewport.width);
    expect(box.y, id).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, id).toBeLessThanOrEqual(viewport.height);
    await expect(popoverOf(page).getByRole('button', { name: 'Finger 1' })).toBeInViewport();
    await popoverOf(page).getByRole('button', { name: 'Close' }).click();
  }
});
```

(The `mobile` project already runs `states.spec.ts` at 360 x 740, so this test runs at 360 px there and at 1280 px on `desktop`.)

`apps/web/e2e/visual.spec.ts`: it shares `STATES` with `states.spec.ts` (M4 Task 10), so the new states get baselines. Generate only the new ones: `pnpm --filter @digitus2/web exec playwright test --project visual --update-snapshots -g "score-(popover|selected|pinned|show-all|reset-confirm|editor-difference|relaxed-notice)"`; open each new PNG and check: one red note or a red Play, the popover inside the page, underlined pinned digits, no other color. List them in the report.

- [ ] **Step 2: Run the suites**

Run: `pnpm --filter @digitus2/web e2e`
Expected: every spec passes on `desktop`; `library` and `states` (with the new states and the popover test) pass on `mobile`; `visual` matches.

Run: `pnpm --filter @digitus2/web build && node scripts/check-bundle-size.mjs`
Expected: under 150 KB gzip and `allowance ok`; note both numbers.

- [ ] **Step 3: Update the docs**

`docs/app.md`: new sections "Editing fingers" (selection by digit or notehead, the popover and its copy, keys 1 to 5, Escape, Space, arrows; pins, the underline, Unpin, Reset; the relaxed-pin notice), "Readability" (the player model R0 to R5 and the reduction in one paragraph each, with a link to verification spec 3.6 and `docs/research/readability.md`; the printed count and `Show all fingers`; the editor comparison), "Persistence" (`digitus2.settings.v1` for settings, `digitus2.piece.v1.<slug>` and `digitus2.piece.v1.file.<name>.<size>.<fnv1a32>` per piece, what is stored, stale pins pruned); the red element rule gains the selection paragraph from this plan; "Known limitations" drops "fingerings not editable" and "all digits printed" and adds: the reader does not look ahead; the textbook-pattern rule of the study is not used; repeats the engine fingers differently get extra digits (the repeat-consistency number in the bench says how often); pins on a piece survive a hand-size change but the notice only says which hand size they were made for. Record the measured bundle size and allowance.

`docs/superpowers/specs/2026-10-13-verification-design.md`: under the goals table, a dated "Measured (M5)" note with the library readability line of the bench (mean density per level, the largest density per level against its floor, the editor comparison on the 8 pieces, mean repeat consistency, inferability 100) and the one-red-element and axe results for the new states. Do not change floors.

- [ ] **Step 4: Run the whole loop**

Run: `pnpm verify`
Expected: all PASS, including `design`, `bundle`, `e2e` and `benchmark` (when the PIG data is present).

---

## Self-review notes

- Spec coverage. Product spec section 9, view 2: "click a digit to change it; the engine re-solves with the pin and animates changed digits" → Tasks 4 (pins in the worker), 6 (re-solve, patch with `flash` or re-render), 7 (selection, popover, keys); "hover or tap a digit for why: the cost breakdown and the alternatives" → Task 3 (`explainNote`, `describeTerm`) and Task 7 (popover; tap rather than hover, because hover does not exist on touch and the popover must hold the finger buttons); "profile (beginner or expert), hand size" → Tasks 4 and 8; "the editorial comparison when available" → Tasks 2 (report), 6 (editorial loaded eagerly), 8 (agreement and differences); State paragraph "persisted to localStorage per piece (user edits survive reloads)" → Tasks 5 and 9. Spec section 5 `FingerAssignment.pinned`, `source: 'user'` → Tasks 4 to 7. Verification spec section 1 "Be easy to read" (per-level floors, editor relative, inferability 100) and section 3.6 with its 2026-10-14 amendment (R0 to R5, greedy reduction, first note, pins, confidence floor, one digit per chord, repeat memory) → Tasks 0, 1, 2; "Honor the design brief" (one red, axe, LCP) and 3.9 (edit a finger and watch the re-solve, toggle the editor's fingering, export) → Tasks 6 to 9. The study's recommendations not taken in M5, by name: the textbook-pattern rule (optional in the study, plus two points), a look-ahead reader (untested in the study), engine-side enforcement of identical fingering on repeats (literature 6.6 item 3; M5 only measures it), the Mutopia-wide editor-relative check (the bench gates the 8 library pieces).
- Review Focus coverage: 1 → Task 4 handler test and Task 7 `edit.spec.ts`; 2 → Task 7 `edit.spec.ts` and `Transport.test.tsx`; 3 → Task 5 key tests; 4 → Task 1 property and repeat tests, Task 2 library test; 5 → Task 7 `placePopover` tests and Task 9 mobile popover test.
- Type consistency: `PlayerState`, `Seen`, `SliceReading`, `readSlice`, `memoryFor` (Task 0) are consumed only by `reduce.ts` (Task 1), which therefore reads exactly as `readHand` does; `Occurrence`, `findRepeats`, `rootMap`, `occurrenceIndex`, `repeatConsistency` (Task 0) feed Tasks 1 and 2; `ReduceResult` (Task 1) feeds `readabilityReport` (Task 2) and the worker's `SolveReply.printed/density/inferability` (Task 4); `NoteExplainView`, `ConfidenceLabel` (Task 3) are the popover's props (Task 7); `describeIssue` (Task 3) builds `relaxedNotice` (Task 7) from `SolveReply.lawIssues` (Task 4); `SkillLevel` (Task 4) is used by the client, the hook and the panel; `PieceState`, `pieceStorageKey`, `usePieceStore` (Task 5) are used by the hook (Task 6), the popover wiring (Task 7), the panel (Task 8) and the persistence spec (Task 9); `ScoreDocument` additions (Task 6) are read by `ScoreView`, `SidePanel` and its test builder (Task 8); the e2e helpers grow in Tasks 6, 7 and 9 and are imported, never redefined.
- Decisions this plan made that the brief and the study did not settle: R5 is applied before R1 to R4 at later occurrences and a printed digit ends it for the rest of that occurrence (the study's last-resort form needs the true finger, which a reader cannot see, and would break inferability by construction); the chord digit goes to the thumb side (study 7.2) rather than the lowest pitch (`reduce.py`); `inferFingering` also returns `unresolved`; `explainNote` takes an optional `hand`; the per-piece key adds an FNV-1a content hash for files; the app's default level is `beginner`; export always writes the engine's fingering with pins (printed set or all), never the editor's; the gated readability row is computed on the library at the app defaults, PIG pieces report density without a gate.
- Risks the first run may expose (the plan says to stop and report rather than loosen anything): a library piece above its level floor, or above the editor's density on one of the 8 fingered pieces (Arabesque's editor prints 26 digits); either one points at the engine (for example repeats fingered inconsistently), not at the reduction.
- Placeholder scan: every task has complete test code and either complete implementation code or an exact behavioural description with copy; the only measured value written by hand is `entryGzipBytes` in Task 4, read from the script's output.

## Coordinator review notes (2026-10-14)

- Reviewed against the product spec section 9, the verification spec 3.6 amendment and the M4 deviations section: the engine tasks implement the validated reader R0 to R5 and the greedy reduction; the app tasks keep the single-red rule with the selection exception; persistence keys include a content hash; exports carry pins.
- Decisions confirmed from the draft: R5 runs first with a printed digit switching the memory off for the rest of that repeat; the chord digit goes on the thumb side; `inferFingering` returns `unresolved`; `explainNote` takes the hand; the readability gate runs on the library at the app defaults; default level `beginner`; export writes the engine's fingering with pins.
- Changed by the coordinator: the editor comparison gates at 1.5 times the editor's density in this milestone with the ratio reported and 1.0 as the target (the solver does not yet finger repeated segments identically, and the Arabesque editor prints about 9 percent); new floors follow the first-run policy in Task 2 instead of halting the workflow.
- Depends on M3 landing first (weight sets and level); M4-B must be merged (all app tasks build on it).
