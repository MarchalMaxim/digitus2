# Play along: the red moves on at the press, and a halo closes in on the next note (issue 204)

This plan builds the design in `docs/superpowers/specs/2026-10-25-play-along-red-travels-design.md` for [issue 204](https://github.com/MarchalMaxim/digitus2/issues/204). The waiting walk of issues 182, 184 and 185 loses its hold gate. A step passes at the press, as in issue 182. The other hand plays from that press. When the time to the next note is longer than a felt beat, a thin ring around the next note closes in on it over that time. The change removes more than it adds: the hold gate, the wake-up timer, the `early` state and its status line, `LATE_MS` and the deferred hand-over all go, and one ring comes.

The plan is written against the code on this branch, which builds on issue 192's work (`useWalkTiming`, `walkTiming`). Builders follow it literally. Every file belongs to exactly one builder (section 12). A builder that needs a change outside its files stops and reports.

Two rules hold for every builder:

- A source comment writes "issue 204", never a hash and a number: the colour guard reads `#204` as a colour.
- A `.css` line never contains the bare word "red" between spaces, comments included: the colour guard's named-colour rule flags it. Write "accent" or "the cued note". `.is-red` is fine.

## 1. The behaviour

### 1.1 The pass

- A step passes the moment every pitch of it is held and fresh, the rule of issue 182. A wrong key moves nothing. A chain of steps whose keys are already held and fresh passes in one look, as today.
- At the pass the cue (`Playback.cueAt`) moves to the next step in the same synchronous MIDI callback: its notes turn red, its keys show their fingers, the page turns. React commits all of it together.
- Nothing waits on a hold. A release never passes a step and never stops one: there is no wake-up timer, no four-fifths rule, no `early` state and no "hold longer" line.
- The press time of each key is still kept (`pressesRef`). The timing judge of issue 192 reads it through `passedRuns`, and the key levels read it as each level's start.
- `holdSec` stays exported. The judge reads it (`walkTiming.ts`, `useWalkTiming.ts`). `HOLD_TOLERANCE` stays exported with its value 0.8 for the forgiven-release rule of issue 200's pull request. The walk reads neither.

### 1.2 The halo

- **When.** At a pass whose move is a cue, the halo is drawn when the gap from the last step passed to the cued step is longer than a felt beat and lasts at least `HALO_MIN_MS` (400) at the Practice tempo:

  ```
  gapSec = stepGapSec(steps, last, loop)        // steps[last + 1].perfSec - steps[last].perfSec;
                                                // at the loop's last step: loop.to - steps[last].perfSec
  ms     = gapSec * 1000 / factor
  shown  = gapSec > notes[last].beatSec + ALONG_EPS  and  ms >= HALO_MIN_MS
  beats  = gapSec / notes[last].beatSec           // for reduced motion
  ```

  `beatSec` is `StepNotes.beatSec` from `alongPlanNotes`: the time signature's beat, or the dotted beat in 6/8, 9/8 and 12/8.

- **Where.** The halo rings the step **after** the long note, the step the reader presses next. In Twinkle with both hands, passing step 6 (the half note G, `[48 67]` at 3.6 s) draws a halo of 1200 ms at 100 % around step 7's topmost notehead (`[53 65]`, the F). Passing any of steps 0 to 5 (quarters) draws none. With the left hand chosen, passing step 0 (`[48]`, a whole note) draws a halo of 2400 ms around step 1 (`[53]` at 2.4 s); at 50 % it lasts 4800 ms.
- **Which notes get one.** A quarter in 4/4 gets none: the pulse and digitus's hand carry it. A half note, a dotted quarter in 4/4, a dotted half in 3/4, a dotted half in 6/8, a whole note, and a quarter followed by a quarter rest get one. A 6/8 dotted quarter gets none, because it is one felt beat. A rest after the note lies inside the gap, so the halo shows when the next note comes, not how long the note is held. The key fill shows how long a note is held.
- **What it looks like.** A thin circle around the cued step's topmost marked notehead. It is a child of that notehead's `g.note`, so under the red element rule it is part of the one red root and never a root of its own.
  - It starts at radius `HALO_FROM` noteheads (2.1 notehead widths, about two and a half staff spaces) from the notehead's centre.
  - It shrinks linearly in radius toward `HALO_TO` (`RED_HEAD_SCALE / 2 + 0.15` = 0.85 notehead widths, just outside the marked notehead at its 1.4 scale) and is gone when the gap is up.
  - The stroke is 2 px at every width (`vector-effect: non-scaling-stroke`). It has no fill. It takes the accent only through the `.is-red` rules of `tokens.css`. It is `aria-hidden`, has `pointer-events: none`, and is hidden in print.
  - It is placed in the SVG's own user units, from the notehead's `getBBox()`, so it scrolls with the page and survives a resize.
  - A step on both staves gets one halo, on the topmost notehead.
- **Its clock.** It counts from `performance.now()` at the pass (`Halo.startMs`). A layout effect that draws it a few milliseconds later starts it a few milliseconds smaller. One `requestAnimationFrame` loop runs while a halo is drawn and stops when it is gone. When the gap is up the halo is gone and the red note waits, as in issue 182.

### 1.3 What removes the halo

The halo goes at once, in the same commit, when:

- the cued step passes: the next step's halo, if any, starts;
- any move the walk did not make happens: a seek, a bar click, the arrow keys, Rewind, Home, a loop change, a hands change, a new score, Play, Practice mode off, the piano gone, or the setting off;
- the walk goes inactive for any reason.

`usePlayAlong` returns the halo only behind a check made in each render. The check passes only when the playback is cued at the halo's step, in the same steps and loop, with no flight on screen (section 5.5). So a move that changes the cue removes the halo in the commit that moves the cue. It does not wait for the align, which runs a commit later.

Nothing else removes it. A wrong key, a release, and the align's second look (StrictMode, or a landing that passes nothing) leave a live halo as it is. Rewind and Home on a loop's first step idle (issue 196): they move nothing, so the walk sees no move, and a halo on the loop's first step (after the loop's last step passed) stays as it is. The halo is honest there: the red is already where Rewind would put it. Nothing in `usePlayAlong` sees an idle Rewind, so no unit test names it; the docs table states it.

No halo is drawn when no notehead of the cue is in the DOM (a page the window has not built: `render/pageWindow.ts`). The cue's own marking builds the page of its notes first (`setCurrent` calls `ensureNotes`), so this is rare.

Under `prefers-reduced-motion` the halo does not shrink. It steps once per felt beat of the gap, `floor(f × beats) / beats` of the way in, the rule the key levels follow, and it vanishes when the gap is up. A half note gives two radii, a whole note four.

A change of the Practice tempo while a halo is live leaves that halo as it is. The next pass uses the new tempo.

### 1.4 The other hand

- On every look that passes at least one step, digitus plays the other hand's notes from `result.last` up to the next step in walk order (`stepAfter`). After the piece's last step it plays the tail to the performance's end; after a loop's last step it plays to `loop.to`.
- The stretch plays at the Practice tempo, counted from now, the moment of the pass, at offset 0. Then digitus waits.
- A new stretch drops what the stretch before left unstarted, as today: a press before digitus has started some notes of the stretch drops those notes. A sounding note rings its length.
- Every move the walk did not make stops the hand, as today, and so does going inactive.
- A change of the Practice tempo during a stretch leaves the stretch as it is. The next pass plays at the new tempo.
- The halo and the hand count from the same pass at the same tempo. The hand's note at the next step is due when the halo closes.

### 1.5 A press under a hop or the flight home

- A press made while a seek's hop or the flight home is on screen (`flightShown`), or in the frame before the flight home shows (`homeRef`), is kept, as today.
- When the hop lands, the align calls `decide(null)`, and the step passes there.
- The halo and the hand-over count from that moment, at offset 0.
- The align stays idempotent: its second look finds the keys spent, passes nothing, draws nothing and hands nothing over.

### 1.6 The finish

The piece's last step passes at its press. The finish runs as in issue 182 (`Playback.finish`, the red flies home, the finish's notes rise), and the other hand plays the tail. The last step has no next step and no halo, and a pass into the finish clears any halo.

### 1.7 Loops

Inside a loop the loop's last step cues the loop's first. Its halo, when the time to the loop's end is longer than a beat (and at least 400 ms), runs over `loop.to - steps[last].perfSec`. The other hand plays to the loop's end. Rewind and Home idle on the loop's first step as today (issue 196).

### 1.8 The status line

- "Play the red note(s) on your piano." stays until the first pass, as today.
- "Hold the red note(s) a little longer." goes in all five languages, with the `hold` hint kind.
- `AlongHint` becomes `{ count: number }`.
- The line's order becomes: busy, nothing playable, loading the piano, a count-in beat, the sound sentence, the timing explanation, the play hint.

### 1.9 The timing judge

`useWalkTiming` keeps receiving a tap at every look that passes steps (`onTiming`, `passedRuns` with each step's own press). The `early` field of `WalkTimingEvent` and the chain bump that read it go. The judge's rules do not change. Its comments that say "a gap the red does not wait out" are reworded to what is still true: a beginner presses when the note ends, so a rest after a note is neither judged nor counted in the tempo.

### 1.10 What goes

| Goes                                                                                                                                  | Where                                 |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `settle`, `SettleInput`, `Settled`, `walk`, `Walked`, `HOLD_SLACK_MS`, `wakeAtMs`, `run`, `releasing`, `early` in the walk            | `playAlong.ts`                        |
| the wake-up timer (`timerRef`, its `clearTimeout`s and the `setTimeout` at the end of `decide`), `factor` in the align's dependencies | `usePlayAlong.ts`                     |
| `LATE_MS`, `handedRef` with `doneSec`, the `result.run` branch and its `elapsedSec` / `heardSec` / `since` / `started` locals         | `usePlayAlong.ts`                     |
| `early` state, `earlyRef`, `markEarly`, the `hold` hint kind, `AlongHint.kind`, the `lost` local, the `hold()` Playwright hook        | `usePlayAlong.ts`                     |
| `WalkTimingEvent.early`, and `if (e.early) chainRef.current++`                                                                        | `usePlayAlong.ts`, `useWalkTiming.ts` |
| the `elapsedSec` and `heardSec` parameters of `accompanimentStretches`, `Stretch.heard` and its filter in `accompanimentNotes`        | `accompaniment.ts`                    |
| `holdLonger` in five languages, the `hold` branch of `scoreStatusLine`                                                                | `i18n/*/score.ts`, `ScoreView.tsx`    |
| `AlongHook.hold`, `hold()`, `playRedTimed`, `tap()`, `HOLD_MANY`                                                                      | e2e                                   |

## 2. Pure: `apps/web/src/score/playAlong.ts` (Builder P)

### 2.1 Exports after the change (exact)

Kept as they are: `ALONG_EPS`, `AlongStep`, `StepTime`, `StepNotes`, `alongPlan`, `alongPlanNotes`, `alongSteps`, `PerfRange`, `loopSpan`, `anchorStep`, `stepAfter`, `Keys`, `NO_KEYS`, `pressKey`, `releaseKey`, `spendAll`, `Presses`, `NO_PRESSES`, `pressAt`, `liftAt`, `runSince`, `AlongMove`, `PassedRun`.

Changed or new:

```ts
/**
 * A release after this fraction of a key's own note is one the key levels forgive (issue 200). The
 * walk does not read it: a release never passes a step (issue 204).
 */
export const HOLD_TOLERANCE = 0.8;

/**
 * The gap from step `index` to the next step in walk order, in performance seconds (issue 204): the
 * next step's onset minus this one's; for the last step of `loop`, `loop.to` minus its onset (the
 * time it sounds before Play would loop back). Null after the piece's last step (no loop holds it)
 * and for an index outside the steps. A loop that holds no step counts as no loop.
 */
export function stepGapSec(
  steps: readonly AlongStep[],
  index: number,
  loop: PerfRange | null,
): number | null;

/**
 * Unchanged in what it returns: the gap (`stepGapSec`, Infinity when null) never longer than the
 * step's shortest note, never below 0, and 0 for an index outside the steps. The timing
 * judge's "note length up to the next step".
 */
export function holdSec(
  steps: readonly AlongStep[],
  times: readonly StepTime[],
  index: number,
  loop: PerfRange | null,
): number;

/** What `advance` leaves behind. */
export interface Advanced {
  keys: Keys;
  /** The press times, as given: a pass spends keys, it never lifts them. */
  presses: Presses;
  move: AlongMove;
  passed: number;
  /** The indices of the steps passed, in the order passed. */
  passedSteps: number[];
  /**
   * The same steps, each with the start of the run that passed it (`runSince`, issue 192): a step
   * pressed before the walk reached it counts from its own press, a chord from its last key.
   * `passedRuns.map((r) => r.index)` equals `passedSteps`.
   */
  passedRuns: PassedRun[];
  /** The last of `passedSteps`, -1 when none passed. */
  last: number;
  /** The step the walk is on after it: the cue's index; `index` when it stays; -1 on finish. */
  at: number;
}

/**
 * The walk's one rule (issues 182 and 204). From step `index`: while the step's pitches are all held
 * and fresh, mark them used and go to the next step (inside `loop`, after its last step back to its
 * first; without a loop, after the last step: finish, and stop). At most `steps.length` passes. A
 * step that does not pass leaves the keys as they are, so a chord can be played apart. Each step
 * passed is recorded with `runSince` from `presses`; a key with no press time counts as held since
 * forever.
 */
export function advance(
  steps: readonly AlongStep[],
  index: number,
  keys: Keys,
  presses: Presses,
  loop: PerfRange | null,
): Advanced;
```

Implementation:

- `advance` is today's `walk` with `nowMs`, `holdMsAt`, `releasing` and `early` taken out. It keeps the same `done` shape, less `early`, and returns `presses` unchanged. Inline it into `advance` and delete `walk` and `Walked`.
- `holdSec` becomes `Math.max(0, Math.min(stepGapSec(steps, index, loop) ?? Infinity, time.shortestSec))`, returning 0 first when `steps[index]` or `times[index]` is missing.
- `stepGapSec` begins with its own guard, which `holdSec`'s gap logic never needed (holdSec returns 0 before it): `const step = steps[index]; if (!step) return null;`. Then `holdSec`'s current gap logic: `span && index === span.last` gives `loop.to - step.perfSec`, else `index + 1 < steps.length` gives the next onset minus this one, else null. Without the guard, index -1 reads `steps[-1].perfSec` and throws. `holdSec` keeps its own early `return 0`.
- Delete `HOLD_SLACK_MS`, `SettleInput`, `Settled` and `settle` with their doc comments.
- The `runSince` doc loses "Issue 184's accompaniment starts here" and "which makes the untimed rule the timed one with no presses". It reads: "When the step's run started: every pitch held and fresh, counted from the latest press among them; null while it does not run. A key with no press time counts as held since forever."
- The `StepTime` doc keeps "(issue 185)". `PassedRun`'s doc becomes "A step the walk passed (issue 192): its index and when its run started (performance.now ms)", which is unchanged.

### 2.2 `playAlong.test.ts` (write the new cases first, see them fail, then change the code)

Mechanical edits:

- Every existing `advance(steps, index, keys, loop)` call gets `NO_PRESSES` as its fourth argument: `advance(steps, index, keys, NO_PRESSES, loop)`. Find them with `grep -n "advance(" apps/web/src/score/playAlong.test.ts`. They are in `describe('advance')`, its nested `describe('last, …')`, and the deleted `settle` block.
- Delete the test "is the untimed settle: times of zero, no presses, the clock at infinity (issue 185)" (current line 746).
- Delete `describe('settle')` (current lines 1341 to the end of the file). Keep its `describe('runSince')` (current lines 1495–1521) as a top-level `describe('runSince')`, with its local `down` helper copied in.
- Remove `settle`, `type Settled` and the now unused imports. Keep `HOLD_TOLERANCE`, which the new test below uses.

New cases, in a new `describe('advance with presses (issue 204)')`. Use four steps: `[60]` at 0, `[62]` at 0.5, `[48, 64]` at 1 and `[60]` at 1.5 (the `four()` plan of the old runs block). Build keys and presses with `pressKey` and `pressAt`.

| Case                                                     | Input                                                            | Expected                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| passes at the press, with no clock                       | 60 pressed at 1000; `advance(…, 0, …, null)`                     | `move` `{cue, 1}`, `passed` 1, `passedRuns` `[{0, 1000}]`, `last` 0, `at` 1        |
| a wrong key moves nothing                                | 61 pressed at 0, from 0                                          | `move` stay, `passed` 0, `at` 0, `keys` the same map, `passedRuns` `[]`, `last` -1 |
| a chain from keys pressed ahead, each from its own press | 62 at 50 then 60 at 200, from 0                                  | `passedRuns` `[{0, 200}, {1, 50}]`, `at` 2                                         |
| a rolled chord counts from its last key                  | 48 at 1000, 64 at 1030, from 2                                   | `passedRuns` `[{2, 1030}]`                                                         |
| a chord with one key missing stays                       | 48 at 1000 alone, from 2                                         | stay, `at` 2, 48 still fresh                                                       |
| the loop wraps                                           | loop `{0.5, 1.5}` (steps 1..2), from 2, 64 and 48 at 0, 62 at 10 | `passedRuns` indices `[2, 1]` with `sinceMs` 0 and 10, `move` `{cue, 2}`           |
| the finish                                               | from 3, 60 at 0                                                  | `move` finish, `at` -1, `last` 3, `passedRuns` `[{3, 0}]`                          |
| presses come back as given                               | any case above                                                   | `result.presses` is the same object as the input                                   |
| passedRuns names passedSteps                             | every case above                                                 | `passedRuns.map((r) => r.index)` equals `passedSteps`                              |
| an index outside the steps                               | from -1 and from 9                                               | stay, `at` the index, nothing passed                                               |
| never changes the maps it was given                      | a chain                                                          | the input `keys` and `presses` are unchanged                                       |
| HOLD_TOLERANCE stays for the key levels (issue 200)      | none                                                             | `HOLD_TOLERANCE` is 0.8                                                            |

New cases, in a new `describe('stepGapSec (issue 204)')` on quarters `[60] [62] [64] [65] [67]` at 0, 0.5, 1, 1.5 and 2:

| Case                                        | Expected                             |
| ------------------------------------------- | ------------------------------------ |
| the gap to the next step                    | `stepGapSec(steps, 1, null)` is 0.5  |
| a rest after the note is in the gap         | on `[60]@0, [62]@1`: 1               |
| the loop's last step runs to the loop's end | loop `{0, 1.25}`: index 2 gives 0.25 |
| the piece's last step has none              | index 4, no loop: null               |
| inside a loop ending at the last step       | loop `{0, 2.5}`: index 4 gives 0.5   |
| an index outside the steps                  | -1 and 5: null                       |
| a loop that holds no step is no loop        | loop `{0.1, 0.2}`: index 1 gives 0.5 |

`describe('the hold of a step')` stays as it is and must pass unchanged: it proves `holdSec` did not move.

## 3. Pure: the halo

### 3.1 `apps/web/src/score/halo.ts` (new, Builder P)

```ts
// Pure: the halo of the waiting walk (issue 204). Types and arithmetic only.
import {
  ALONG_EPS,
  stepAfter,
  stepGapSec,
  type AlongStep,
  type PerfRange,
  type StepNotes,
} from './playAlong.js';
import { RED_HEAD_SCALE } from './render/timingMarks.js';

/** A halo shorter than this in real time is not drawn: the pulse carries it. */
export const HALO_MIN_MS = 400;

/** The halo's radius when it appears, in notehead widths (about two and a half staff spaces). */
export const HALO_FROM = 2.1;

/** The radius it closes in on, in notehead widths: just outside the marked notehead. */
export const HALO_TO = RED_HEAD_SCALE / 2 + 0.15;

/** One halo: the step it rings, when it started, how long it lasts. */
export interface Halo {
  /** The cued step's index into the steps: the step after the one passed, in walk order. */
  index: number;
  /** performance.now() ms of the pass that started it. */
  startMs: number;
  /** Its whole length in real ms: the gap at the Practice tempo. */
  ms: number;
  /** The gap in felt beats of the step passed; above 1 (reduced motion steps by it). */
  beats: number;
}

export interface HaloInput {
  steps: readonly AlongStep[];
  /** `alongPlanNotes`' notes, aligned with `steps`; only `beatSec` is read. */
  notes: readonly Pick<StepNotes, 'beatSec'>[];
  /** The last step passed. */
  last: number;
  loop: PerfRange | null;
  /** The tempo factor: real seconds = performance seconds / factor. */
  factor: number;
  /** performance.now() ms of the pass. */
  nowMs: number;
}

/**
 * The halo a pass starts, or null when it shows none: the gap from `last` to the next step in walk
 * order (`stepGapSec`) must be longer than the felt beat at `last` by more than ALONG_EPS, and last
 * at least HALO_MIN_MS at the tempo. Null too for an index outside the steps, the piece's last
 * step, a beat or a factor that is not above 0.
 */
export function haloFor(input: HaloInput): Halo | null;

/**
 * How far into its gap the halo is at `nowMs`, 0 to below 1; null from its end on, and for a halo
 * of no length. A clock before the start counts as 0. Under reduced motion it steps a felt beat at a
 * time: floor(f * beats + 1e-9) / beats.
 */
export function haloProgress(halo: Halo, nowMs: number, reduced: boolean): number | null;

/** The radius at `progress` for a notehead `w` wide: linear from HALO_FROM to HALO_TO widths. */
export function haloRadius(w: number, progress: number): number;
```

`haloFor`:

1. If `!(input.factor > 0)` return null.
2. `gap = stepGapSec(steps, last, loop)`. If null, return null.
3. `beat = notes[last]?.beatSec`. If not `beat > 0`, return null.
4. `ms = gap * 1000 / factor`. If `!(gap > beat + ALONG_EPS) || ms < HALO_MIN_MS`, return null.
5. `index = stepAfter(steps, last, loop)`. If `index < 0`, return null (defensive; `stepGapSec` is null there already).
6. Return `{ index, startMs: nowMs, ms, beats: gap / beat }`.

### 3.2 `apps/web/src/score/halo.test.ts` (new, write first, Builder P; `// @vitest-environment node`)

Plans are plain arrays: `steps` from `(perfSec, ...pitches)` and `notes` as `{ beatSec }`. Factor 1 unless the case says otherwise; `nowMs` 1000.

| Case                                               | Input (gap, beatSec at `last`)                        | Expected                                          |
| -------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| a quarter in 4/4 has none                          | 0.5, 0.5                                              | null                                              |
| a half note rings the next step                    | 1.0, 0.5; `last` 0                                    | `{ index: 1, startMs: 1000, ms: 1000, beats: 2 }` |
| a dotted quarter in 4/4                            | 0.75, 0.5                                             | `ms` 750, `beats` 1.5                             |
| a dotted half in 3/4                               | 1.5, 0.5                                              | `beats` 3                                         |
| a 6/8 dotted quarter is one felt beat: none        | 0.75, 0.75                                            | null                                              |
| a 6/8 dotted half                                  | 1.5, 0.75                                             | `beats` 2                                         |
| a whole note                                       | 2.0, 0.5                                              | `beats` 4                                         |
| a quarter and a quarter rest                       | `[60]@0, [62]@1.0`, 0.5                               | `ms` 1000                                         |
| a chain counts from its last step                  | steps at 0, 0.5, 1, 2; `last` 2                       | `index` 3, `ms` 1000                              |
| the loop's last step runs to the loop's end, wraps | steps at 0, 0.5, 1; loop `{0, 2}`; `last` 2           | `index` 0, `ms` 1000                              |
| the loop's last step a beat before the end: none   | loop `{0, 1.5}`; `last` 2                             | null                                              |
| the piece's last step: none                        | `last` = last index, no loop                          | null                                              |
| the tempo scales it                                | half note at factor 1.5, and at 0.5                   | `ms` 666.67 (to 2 places), and 2000               |
| the floor at a fast tempo                          | gap 0.5, beat 0.25: factor 1.5, and factor 1          | null (333 ms), and `ms` 500                       |
| a gap within ALONG_EPS of the beat is the beat     | gap 0.5 + 1e-12, beat 0.5                             | null                                              |
| nothing to ring                                    | `last` -1, `last` past the end, `beatSec` 0, factor 0 | null each                                         |

`haloProgress`, on `{ index: 1, startMs: 1000, ms: 1000, beats: 2 }`:

| Case                                  | Expected                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------- |
| linear                                | 0 at 1000, 0.25 at 1250, 0.5 at 1500, 0.999 at 1999                         |
| gone at its end and after             | null at 2000 and at 5000                                                    |
| a clock before the start              | 0 at 900                                                                    |
| reduced: two beats, two radii         | 0 at 1000 and 1499, 0.5 at 1500 and 1999, null at 2000                      |
| reduced: a dotted quarter (1.5 beats) | `beats: 1.5`, `ms: 750`: 0 until 1000 + 500, then 2/3 until 1750, then null |
| reduced: a whole note                 | `beats: 4`, `ms: 2000`: 0, 0.25, 0.5, 0.75 at 1000, 1500, 2000, 2500        |
| float slack does not cost a step      | `beats: 3`, `ms: 300`, at 1100: 1/3                                         |
| no length                             | `ms: 0`: null                                                               |

`haloRadius`, with `w` 10:

| Case                           | Expected                                  |
| ------------------------------ | ----------------------------------------- |
| it starts at HALO_FROM widths  | `haloRadius(10, 0)` is 21                 |
| linear                         | `haloRadius(10, 0.5)` is `(21 + 8.5) / 2` |
| it closes in on HALO_TO widths | `haloRadius(10, 1)` is 8.5                |
| it clears the marked notehead  | `HALO_TO > RED_HEAD_SCALE / 2`            |

### 3.3 `apps/web/src/score/render/halo.ts` (new, Builder P)

The DOM side, with an injectable `boxOf` as `drawTimingMarks` has, so the tests run in happy-dom.

```ts
/**
 * The halo of the waiting walk (issue 204), over the Verovio SVG: one thin circle in the `g.note` of
 * the topmost notehead the cue marks, so the accent reaches it only through the `.is-red` rules and
 * it is part of the one red root. Its look is base.css's (`.along-halo`). This file never builds a
 * page.
 */

export const HALO_CLASS = 'along-halo';

type Box = { x: number; y: number; width: number; height: number };

/** Where a halo goes: the note it is drawn in, the notehead's centre and width, in SVG user units. */
export interface HaloAnchor {
  note: Element;
  cx: number;
  cy: number;
  w: number;
}

/**
 * The topmost of the noteheads the cue marks (`.is-red .notehead` in `host`), by the smallest box
 * `y`, measured with `boxOf` (`getBBox()`: the user units of the notehead's SVG, which ignore the
 * marked notehead's CSS scale). Null when none is marked, when none has a box wider than 0 (a page
 * not laid out; a throw counts as none), or when the notehead has no `g.note` ancestor.
 */
export function haloAnchor(
  host: Element,
  boxOf?: (el: SVGGraphicsElement) => DOMRect | Box,
): HaloAnchor | null;

/** Appends the halo, an SVG `circle.along-halo` with `aria-hidden="true"`, as the note's last child. */
export function drawHalo(anchor: HaloAnchor, r: number): SVGCircleElement;

/** Sets the circle's radius, to a hundredth of a user unit (written only when it changes). */
export function setHaloRadius(circle: SVGCircleElement, r: number): void;

/** Removes every halo inside `root`. */
export function clearHalos(root: Element): void;
```

- `boxOf` defaults to `(el) => el.getBBox()`.
- Attributes are written to a hundredth, as `timingMarks.ts`' `num` does: `cx`, `cy` and `r`.
- `setHaloRadius` compares the rounded string with the current attribute and writes only on a change.

### 3.4 `apps/web/src/score/render/halo.test.ts` (new, write first, Builder P)

The host is built from markup: an `svg` holding `g.note#a > g.notehead`, and `g.chord.is-red` holding `g.note#b > g.notehead` and `g.note#c > g.notehead`. A `boxOf` map gives `b` the box `{x: 0, y: 30, width: 10, height: 8}` and `c` the box `{x: 0, y: 20, width: 10, height: 8}`.

| Case                              | Expected                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| finds the topmost marked notehead | `note` is `#c`, `cx` 5, `cy` 24, `w` 10                                                  |
| ignores notes that are not marked | `#a` with a smaller `y` is never chosen                                                  |
| none marked                       | no `.is-red`: null                                                                       |
| none laid out                     | every box 0 wide, or `boxOf` throws: null                                                |
| a lone marked note                | `g.note.is-red > g.notehead`: that note                                                  |
| draws a circle in the note, last  | `drawHalo` gives `circle.along-halo`, `aria-hidden` "true", last child of `#c`, `r` "21" |
| rounds to a hundredth             | `r` 21.456 is written "21.46"                                                            |
| sets the radius                   | `setHaloRadius(circle, 9)` gives `r` "9"                                                 |
| clears every halo                 | two drawn, `clearHalos(host)` leaves none                                                |

## 4. Pure: `apps/web/src/score/accompaniment.ts` (Builder P)

### 4.1 Changes (exact)

```ts
/** A stretch of the performance digitus plays, and where it starts after the pass. */
export interface Stretch {
  from: number;
  to: number;
  /** Performance seconds after the moment the stretch is handed over at which `from` sounds (0 or more). */
  offset: number;
}

/**
 * The stretches to play from the step `last`, the last step the walk passed (issue 204: at the
 * press, or at a hop's landing for a press made under it), and the move the walk makes after it
 * (`stepAfter`: `cue j`, or `finish` after the piece's last step; -1 when `last` names no step).
 * Digitus plays from that step to the next step of the walk, then waits:
 * - `cue j`: from `steps[last]` to `steps[j]`; when the move wraps a loop (`j` is not after
 *   `last`) from `steps[last]` to the loop's end, and nothing of the loop's opening is played;
 * - `finish`: from `steps[last]` to `endSec`, the piece's tail;
 * - `stay`, or no step: none.
 * Every stretch starts at the pass (offset 0). A stretch with no length is no stretch.
 */
export function accompanimentStretches(
  steps: readonly AlongStep[],
  last: number,
  move: AlongMove,
  loop: PerfRange | null,
  endSec: number,
): Stretch[];
```

- The body returns `[{ from, to, offset: 0 }]`.
- In `accompanimentNotes`, delete the line `if (stretch.heard !== undefined && …) continue;`.
- Keep `offsetSec: Math.max(0, stretch.offset + (e.sec - stretch.from))`: the clamp keeps a grace of the opening principal at the pass.
- Doc of `accompanimentNotes`: replace "A stretch handed over after its press (`heard`) leaves out the notes that already sounded, and strikes at once a note that is due by now and did not sound." with nothing, and "never before the press" with "never before the pass".
- File header: "from the step the reader's press started running and the walk's move after it" becomes "from the last step the walk passed and its move after it", and "as offsets in performance seconds after the press that starts the stretch" becomes "as offsets in performance seconds after the pass".

### 4.2 `accompaniment.test.ts`

- Delete "starts a stretch handed over after its press that much earlier, and keeps what sounded" (current line 148).
- Delete "leaves out the notes that already sounded in a stretch handed over after its press" (current line 404).
- Add (write first, see it fail on the `heard` field and the old signature, then do 4.1) "gives every stretch at offset 0, with no field beyond from, to and offset": for a cue, a loop wrap and a finish, `Object.keys(stretch).sort()` equals `['from', 'offset', 'to']` and `offset` is 0.
- Every other test passes unchanged. Positive offsets in `range(…, offset)` still exercise `accompanimentNotes`.

## 5. The walk: `apps/web/src/score/usePlayAlong.ts` (Builder H1)

Builder H1 changes only the parts named here. The levels block (`const wanted = …` through the end of its `for` loop, current lines 532–556), `drop()`, and the line `if (letGo !== undefined) levels.release(letGo, now);` (current line 434) stay verbatim and in place. Issue 200's pull request rebases onto exactly those lines.

### 5.1 Types and exports (exact)

```ts
import { haloFor, type Halo } from './halo.js';

/**
 * The status line's hint while the red waits (issue 182): shown until the first step is played.
 * `count` is the step's pitch count.
 */
export interface AlongHint {
  count: number;
}

/**
 * What the walk tells its timing (issue 192, useWalkTiming.ts). `settled`: the steps passed in one
 * look, each from the start of its run; `at`, the step the red is on after it (-1 on the finish);
 * `finished`, the piece's last step passed. `break`: the walk's sequence broke (a move it did not
 * make, inactive, unmount).
 */
export type WalkTimingEvent =
  | { kind: 'settled'; runs: readonly PassedRun[]; at: number; finished: boolean }
  | { kind: 'break' };

export interface PlayAlong {
  active: boolean;
  pianoConnected: boolean;
  atFirst: boolean;
  hint: AlongHint | null;
  levels: LevelStore;
  soundWaits: boolean;
  /**
   * The halo to draw around the cued step's note (issue 204), or null: only while the playback is
   * cued at its step, in the steps and loop it was made for, with no flight on screen. Drawn by
   * useAlongHalo.ts; it may already be over (`haloProgress` says so).
   */
  halo: Halo | null;
}

/** What the Playwright check reads (installed with `?audio=silent` or `?hooks=1`). */
interface AlongHook {
  target(): number[];
  index(): number;
  /**
   * The whole length in real ms of the halo of the step `target()` names (issue 204), while the
   * clock is inside it; 0 when there is none or it is over.
   */
  halo(): number;
}
```

The `onTiming` option's doc: "Issue 192: told of each look that passed steps, and of each break in the walk's own sequence (a move it did not make, going inactive, unmount). Read only: the walk never waits on it, and the listener catches its own errors."

### 5.2 State

- Imports: drop `alongPlan`, `holdSec`, `runSince`, `settle`. Add `advance`, `alongPlanNotes`, `type StepNotes`.
- `const NO_NOTES: StepNotes[] = [];` and `const NO_PLAN = { steps: NO_STEPS, times: NO_TIMES, notes: NO_NOTES };`. The plan memo calls `alongPlanNotes(…)` and destructures `{ steps, times, notes }`.
- `Live` gains `notes: readonly StepNotes[];`, set in both places `liveRef` is written.
- Delete `LATE_MS`, the `early` state, `earlyRef`, `markEarly`, `timerRef` and `handedRef`, with their doc comments.
- Add:

```ts
/** The halo the last pass made, with the steps and loop it was made against (issue 204). */
interface HaloShown {
  halo: Halo;
  steps: readonly AlongStep[];
  /** `stretchKey` of the loop at the pass. */
  loop: string;
}
```

and, after `const [levels] = useState(…)`:

```ts
/** The halo of the last pass (issue 204): state, so the render hands it to the drawing. */
const [haloShown, setHaloShown] = useState<HaloShown | null>(null);
const haloRef = useRef<HaloShown | null>(null);
```

and, beside `moveIndex`:

```ts
const showHalo = useCallback((next: HaloShown | null) => {
  if (haloRef.current === next) return;
  haloRef.current = next;
  setHaloShown(next);
}, []);
```

`decide`'s dependencies become `[levels, moveIndex, showHalo]`.

### 5.3 `decide`, in order

1. `o`, `pb`, `now`, `stopAccompaniment` as today. Delete the two `clearTimeout(timerRef…)` lines.
2. `const letGo = event && !event.on ? event.midi : undefined;`. Delete `lost` and its comment. `drop()` stays verbatim.
3. Inactive branch: as today, less `markEarly(false)` and `handedRef.current = null`, plus `showHalo(null);`.
4. `moved` branch: as today, less `handedRef.current = null` and `markEarly(false)`, plus `showHalo(null);`.
5. `if (event?.on) …applyNote…` as today.
6. Replace `if (lost && letGo !== undefined) { … }` with:

```ts
// A key that comes up leaves the books here: a release never passes a step (issue 204).
if (letGo !== undefined) {
  keys = releaseKey(keys, letGo);
  presses = liftAt(presses, letGo);
}
```

7. `keysRef` / `pressesRef` assignment, and the `homeRef || flightShown || playingNow` gate with `drop()`, as today, plus `showHalo(null);` before `drop()` in that gate: a seek's hop, the flight home and Play end the halo for good, also a hop that lands on the step the red already waits on, which is no external move. The align runs when `flightShown` turns true, so the halo goes as the hop starts. The gate's comment becomes: "A press during a flight or hop is kept and passes when it lands (the align), counted from then; a release then is a plain one. A flight ends the halo (issue 204)."
8. `mode`, `here`, and the `here < 0` branch as today, plus `showHalo(null);` before `moveIndex(-1)`.
9. Keep `if (letGo !== undefined) levels.release(letGo, now);` verbatim. Its comment becomes "The key comes up now: its level drains."
10. The pass:

```ts
const result = advance(o.steps, here, keys, presses, stretch);
keysRef.current = result.keys;
pressesRef.current = result.presses;
if (result.passed > 0) {
  setPlayed((n) => n + result.passed);
  // The halo of the step cued now (issue 204), from this moment, or none; a look that passes
  // nothing leaves the halo as it is.
  const halo =
    result.move.kind === 'cue'
      ? haloFor({
          steps: o.steps,
          notes: o.notes,
          last: result.last,
          loop: stretch,
          factor: o.factor,
          nowMs: now,
        })
      : null;
  showHalo(halo ? { halo, steps: o.steps, loop: stretchKey(stretch) } : null);
}
```

11. The hand-over replaces the whole `if (plan) { … }` block (current lines 457–519):

```ts
// Digitus plays the other hand (issue 184) from the step passed last to the next step of the
// walk, from now: the press that passed it, or the landing of a hop for a press made under
// it (issue 204). A new stretch drops what the one before left unstarted. Before the cue or
// the finish, which do not stop it.
const plan = o.accompaniment;
if (plan && result.passed > 0) {
  const next = stepAfter(o.steps, result.last, stretch);
  accompaniedRef.current = true;
  pb.accompany(
    accompanimentNotes(
      plan.events,
      plan.hands,
      accompanimentStretches(
        o.steps,
        result.last,
        next < 0 ? { kind: 'finish' } : { kind: 'cue', index: next },
        stretch,
        plan.endSec,
      ),
      stretch,
    ),
  );
}
```

12. The timing tap:

```ts
// Issue 192: the steps passed just now, each from the press that started its run.
if (result.passed > 0) {
  onTimingRef.current?.({
    kind: 'settled',
    runs: result.passedRuns,
    at: result.at,
    finished: result.move.kind === 'finish',
  });
}
```

13. The levels block, verbatim.
14. The finish branch: delete `handedRef.current = null;`. The rest stays.
15. The cue as today (`placed`, `cueAt`, `atRef`, `loopAtRef`, `moveIndex`). Delete the wake-up block (current lines 581–591).

### 5.4 Effects

- The note subscription's cleanup: delete `handedRef.current = null;` and the two timer lines. `onTimingRef…break` and `levels.dispose()` stay.
- The align effect: delete `factor` from its dependency list. Delete the comment's last sentence ("A change of the Practice tempo (`factor`) looks again too, …").
- The Playwright hook: replace `hold` with:

```ts
      halo: () => {
        const at = named();
        const shown = haloRef.current;
        if (at < 0 || !shown || shown.halo.index !== at || shown.steps !== liveRef.current.steps) return 0;
        const { startMs, ms } = shown.halo;
        return performance.now() < startMs + ms ? ms : 0;
      },
```

### 5.5 The return

```ts
const stretch = playback.performanceLoop();
const stretchNow = stretchKey(stretch);
const first = stretch ? (loopSpan(steps, stretch)?.first ?? -1) : 0;
return useMemo(() => {
  const hint: AlongHint | null =
    cuedHere && step && played === 0 ? { count: step.pitches.length } : null;
  const halo =
    cuedHere &&
    !flightShown &&
    haloShown !== null &&
    haloShown.steps === steps &&
    haloShown.loop === stretchNow &&
    haloShown.halo.index === index
      ? haloShown.halo
      : null;
  return {
    active,
    pianoConnected,
    atFirst: cuedHere && index === first,
    hint,
    levels,
    soundWaits,
    halo,
  };
}, [
  active,
  pianoConnected,
  cuedHere,
  index,
  first,
  step,
  played,
  levels,
  soundWaits,
  flightShown,
  haloShown,
  steps,
  stretchNow,
]);
```

This replaces the current lines from `const stretch = playback.performanceLoop();` (line 700) to the end of the hook; `step`, `cuedHere`, `soundWaits` and `pianoConnected` above them stay. `cuedHere` already requires `active`, a cue, `!atStart`, and the playback at the step's second.

### 5.6 Header comment

Rewrite lines 1–41 in the present tense. The facts to state:

- While a piano is connected, Practice mode is on and the score is stopped, the red waits on the next step. When the reader presses every pitch of it, the red moves on at that press (issue 204). At the end of the piece the transport's own finish runs.
- The walk moves the red only through `Playback.cueAt` and `Playback.finish`, in performance seconds.
- With one hand left out, every look that passes a step hands `Playback.accompany` the other hand's notes from the last step passed to the next step of the walk, from that moment. It stops them on every move it did not make and when it goes inactive.
- A pass whose gap to the next step is longer than a felt beat makes a halo (halo.ts), which the render hands to useAlongHalo.ts only while the cue is at its step.
- Keep the active, `flightShown`, presses (`keysRef`, `pressesRef`), external move (`atRef`) and levels paragraphs, less every mention of the hold, the timer, `early` and the hint for a longer hold.
- No timer: nothing in the walk waits on time.

### 5.7 `usePlayAlong.test.tsx` (Builder H1)

Harness:

- Rename `hold(ms)` to `wait(ms)` everywhere: the `Setup` member, its doc ("Lets `ms` go by, then renders with the fake's state"), and every call (`sed -i 's/s\.hold(/s.wait(/g'`). Time still matters for the levels and the halo. Keep `elapse` and the fake timers.
- Delete `holdMs()` and its imports if nothing uses them any more.
- The file's header: "The clock is fake (issue 185): a step passes once its keys have been held for its time, so a test presses, lets the time go by with `hold`, and looks." becomes "The clock is fake: the levels and the halo run on it. A step passes at the press (issue 204)."
- `seen()` keeps reading `hint`. Every `{ kind: 'play', count: n }` becomes `{ count: n }` (current lines 343, 485, 497, 499, 609, 650, 1163, 1182, 1439).

Deleted or rewritten (current line, name → what replaces it):

| Line             | Test                                                                                                                               | Becomes                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 386              | moves on when every pitch of the step is held for its time, and not before                                                         | "moves on at the press of every pitch of the step, and sets no timer": 48 alone moves nothing; 60 cues step 1's second at once; `vi.getTimerCount()` is 0 after each press                                                                                                                                                                                                                                                                |
| 440              | chains an early press: one cue to where the chain ends                                                                             | same name: the keys of steps 1 and 2 held first, then step 0's: one `cueAt`, at step 3's second, at the last press                                                                                                                                                                                                                                                                                                                        |
| 523              | `describe('the hold')`, whole                                                                                                      | deleted, except the two tests below, which move to `describe('the walk')` with `wait` for `hold`                                                                                                                                                                                                                                                                                                                                          |
| 695              | never keeps a key that was let go where the walk had no step                                                                       | kept (moved)                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 717              | never keeps a key that was let go while the playback plays now                                                                     | kept (moved)                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 768, 779         | the next step's pitch gets its own length when pressed early; levels when the red arrives                                          | rewritten to the press rule with the same point: each key's level counts from its own press                                                                                                                                                                                                                                                                                                                                               |
| 912, 929         | looks again a frame after the position went home; does not wait a frame when shown                                                 | kept; `s.hold(500)` → `s.wait(500)`                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1252             | `describe('the Playwright check')`: `hold()` cases                                                                                 | `Check` type gets `halo()` for `hold()`; "names the step the red waits on, only in a silent run" expects `halo()` 0 at the first step; "reports the hold at the Practice tempo" becomes "reports the halo's length at the Practice tempo, 0 when it is over" (half-note score, factor 1.5: 666.67 right after the pass, 0 after `wait(700)`); "names a step only while the playback is cued at it" expects `halo()` 0 after the cue moves |
| 1638             | an unplugged piano passes no step                                                                                                  | "a lost key leaves the books and drains, and moves nothing": a key of a two-key step pressed, the piano unplugged, the other key pressed after it returns: the step does not pass                                                                                                                                                                                                                                                         |
| 1650             | Turn off passes no step either                                                                                                     | deleted                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1660             | an unplug on the last step does not finish the piece                                                                               | deleted                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1679             | a key the reader lets go after four fifths still passes the step                                                                   | deleted                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1688, 1704       | keys pressed under a flight get their levels when the step passes on landing                                                       | kept, with `wait`; the step passes at the landing, the level counts from the press                                                                                                                                                                                                                                                                                                                                                        |
| 1737             | a faster Practice tempo set in the middle of a hold moves the wake-up                                                              | "a tempo change sets no timer and moves nothing": `vi.getTimerCount()` 0 and no `cueAt` after the change                                                                                                                                                                                                                                                                                                                                  |
| 1758             | spends no key for a tempo change                                                                                                   | kept: a key of the step held through a tempo change still counts with its partner                                                                                                                                                                                                                                                                                                                                                         |
| 1811             | ends the walk when it goes off with a step running: no timer                                                                       | "ends the walk when it goes off: the cue stays, no level, no halo"                                                                                                                                                                                                                                                                                                                                                                        |
| 1828             | takes the hold hint away when it goes off after an early release                                                                   | deleted                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1945             | tells a release too early, with no step passed                                                                                     | deleted                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1932             | tells the steps a settle passed …                                                                                                  | the expected event has no `early` field                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2057, 2086, 2116 | "tells a loop's wrap as a pass", "tells the finish", "tells nothing for a press under a flight, and the press time at the landing" | kept; remove `early: false` from the expected events (lines 1940, 2057, 2086 and 2116 in all), or `toEqual` fails on the missing field                                                                                                                                                                                                                                                                                                    |

Every other test is kept with `wait` for `hold`. A test that still fails was asserting the hold: rewrite it to the press rule, keeping what it is about.

New `describe('the halo (issue 204)')` (write first, see it fail on the missing `halo` field, then do 5.1 to 5.5). The score is `scoreOf([{ midi: 60, tick: 0, ticks: 2 }, { midi: 62, tick: 2 }, { midi: 64, tick: 3 }, { midi: 65, tick: 4, ticks: 4 }])`: steps `[60]@0` (a half), `[62]@1`, `[64]@1.5`, `[65]@2`, with a 0.5 s beat.

| Case                                                                                   | Expected                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rings the step after a half note, from the press, for the gap at the Practice tempo    | after `press(60)`: `halo` `{ index: 1, startMs: <performance.now() at the press>, ms: 1000, beats: 2 }`                                                                                                                                                                                                                                        |
| none after a quarter                                                                   | then `press(62)`: `halo` null                                                                                                                                                                                                                                                                                                                  |
| twice as long at half the Practice tempo                                               | factor 0.5 in the store: `ms` 2000                                                                                                                                                                                                                                                                                                             |
| none at the finish                                                                     | the last step pressed: `halo` null                                                                                                                                                                                                                                                                                                             |
| stays through a wrong key, a release and the align's second look                       | after `press(60)`: `press(70)`, `release(60)`, `refresh()`: the same `halo` object                                                                                                                                                                                                                                                             |
| goes in the render that moves the cue, before the align                                | the `renderHook` callback pushes each render's `halo` into a log, as `useWalkTiming.test` does with `log`; after `press(60)`: `fake.start` set to another step's second and `refresh()`: the first render logged after the change already has `halo` null (reading `result.current` after `act` would not prove it: the align has run by then) |
| a tempo change leaves a live halo as it is                                             | after `press(60)`: the factor changed in the store: the same `halo` object                                                                                                                                                                                                                                                                     |
| a hop to the step the red already waits on ends it                                     | after `press(60)`: `fake.flight` true and `refresh()`: `halo` null; `fake.flight` false and `refresh()`: still null                                                                                                                                                                                                                            |
| goes on a hands change, a loop change, Practice mode off, the piano unplugged and Play | one sub-case each: `halo` null after it                                                                                                                                                                                                                                                                                                        |
| a press under a hop passes at the landing, with its halo from the landing              | `fake.flight` true, `press(60)`: `halo` null, and `cues()` is still `[0]` (the mount's align cued step 0); `wait(300)`; `fake.flight` false and `refresh()`: `cues()` is `[0, 1]`, `halo.startMs` is the landing time; `refresh()` again: the same object                                                                                      |
| the loop's last step rings the loop's first step, to the loop's end                    | `fake.stretch = { from: 0, to: 3 }` on the same score: the loop holds all four steps, its last the whole note `[65]@2`. Press 60, 62, 64 and 65, each followed by `refresh()`: `halo` `{ index: 0, ms: 1000, beats: 2 }` (gap `3 - 2` = 1 s against the 0.5 s beat), and the wrap adds one `cueAt(0)`                                          |

### 5.8 `usePlayAlong.accompany.test.tsx` (Builder H1)

- Header: "when a step starts running (every pitch of it held and fresh, at the press) the walk hands the playback the notes digitus plays, and stops them on every move it did not make. A step passes a note's length later (issue 185), by the fake clock (`hold`), and the pass hands over nothing." becomes "at every pass (the press that plays every pitch of a step, issue 204) the walk hands the playback the notes digitus plays, from that moment, and stops them on every move it did not make."
- `hold` → `wait` as in 5.7.

| Line | Test                                                                                   | Becomes                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 320  | hands the notes over at the press and not at the pass, which comes a note later        | "hands the notes over once, at the press, which is the pass"                                                                            |
| 337  | keeps playing when the reader lets go early, and a new press of the step counts afresh | "keeps playing when the reader lets go: a release stops nothing and hands nothing over"                                                 |
| 355  | hands nothing over again when a release after four fifths passes the step              | deleted                                                                                                                                 |
| 367  | hands a step pressed early over when the red reaches it, counted from its press        | "the next step's press drops the notes not started and hands its own stretch over from that press"                                      |
| 418  | hands over the last step of a chain that passes unseen, from its pass                  | kept: keys of step 1 held, then step 0 pressed: one `accompany`, from step 1, at offset 0                                               |
| 722  | `describe('what was handed over decides what is handed over')`, whole                  | replaced by: "a press under a flight is handed over once, at the landing, at offset 0" and "the align's second look hands nothing over" |
| 802  | `describe('a step pressed before the red reaches it')`                                 | deleted                                                                                                                                 |
| 822  | `describe('a step pressed a little before the red reaches it')`, three tests           | deleted                                                                                                                                 |
| 857  | `describe('a change of the Practice tempo in the middle of a run')`, four tests        | replaced by one test: "a tempo change hands nothing over again; the next pass plays at the new tempo"                                   |
| 344  | the `{ kind: 'hold', count: 1 }` assertion                                             | gone with its test                                                                                                                      |

Every stretch handed over in these tests has offset 0 in the notes' times: no note is left out for being late.

## 6. The drawing: `apps/web/src/score/useAlongHalo.ts` (new, Builder H2)

### 6.1 API (exact)

```ts
import { useLayoutEffect } from 'react';
import { prefersReducedMotion } from '../design/motion.js';
import { haloProgress, haloRadius, type Halo } from './halo.js';
import { clearHalos, drawHalo, haloAnchor, setHaloRadius } from './render/halo.js';

/**
 * Draws the walk's halo (issue 204) around the topmost notehead the cue marks in `host`, and closes
 * it in frame by frame, straight on the SVG: no React state per frame. A layout effect, declared in
 * ScoreView after useCursor and usePlayAlong, so it runs after the cursor has marked the cued notes
 * in the same commit, and the ring and the new marks reach the screen in one paint. One
 * `requestAnimationFrame` loop runs while the ring is drawn; it reads `performance.now()` and the
 * reduced-motion query each frame, writes the radius only when it changes, and removes the ring
 * when the gap is up. A hidden tab gets no frames and is right again at the next one, because the
 * radius is a function of the time. `layoutKey` (the pages) draws it again on new pages.
 */
export function useAlongHalo(host: Element | null, halo: Halo | null, layoutKey: unknown): void;
```

### 6.2 The effect (deps `[host, halo, layoutKey]`)

```ts
useLayoutEffect(() => {
  if (!host) return;
  clearHalos(host);
  if (!halo) return;
  const progress = haloProgress(halo, performance.now(), prefersReducedMotion());
  if (progress === null) return;
  const anchor = haloAnchor(host);
  if (!anchor) return; // the cued notes are not in the DOM: no halo
  const circle = drawHalo(anchor, haloRadius(anchor.w, progress));
  let frame = 0;
  const step = () => {
    frame = 0;
    if (!circle.isConnected) return; // its page was rebuilt: no halo until the next pass
    const p = haloProgress(halo, performance.now(), prefersReducedMotion());
    if (p === null) {
      circle.remove();
      return;
    }
    setHaloRadius(circle, haloRadius(anchor.w, p));
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    circle.remove();
  };
}, [host, halo, layoutKey]);
```

### 6.3 `useAlongHalo.test.tsx` (new, write first, Builder H2)

The environment is happy-dom under StrictMode, with fake `performance`, `requestAnimationFrame` and `cancelAnimationFrame` as in `usePlayAlong.test.tsx`. The host markup is the one in 3.4. `getBBox` is stubbed on `SVGElement.prototype` with `Object.defineProperty(…, 'getBBox', { configurable: true, value() { … } })`: it gives a box by the closest note's id and is removed in `afterEach`. Reduced motion is `vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)`. The halo is `{ index: 1, startMs: performance.now(), ms: 1000, beats: 2 }`.

| Case                                                        | Expected                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| draws one ring in the g.note of the topmost marked notehead | one `.along-halo`, child of `#c`, `aria-hidden` "true", `r` `haloRadius(10, 0)`                                                                                                                                                                                                                                                                |
| closes in linearly                                          | after about 250, 500 and 750 ms (each `advanceTimersByTime` then `advanceTimersToNextFrame`; the fake frames are 16 ms, so the clock lands a few ms past each mark): `r` is `String(Math.round(haloRadius(10, (performance.now() - halo.startMs) / 1000) * 100) / 100)`, read right after each advance, and the three values strictly decrease |
| is gone when the gap is up, and the loop stops              | after 1000 ms and a frame: no `.along-halo`; `vi.getTimerCount()` 0                                                                                                                                                                                                                                                                            |
| draws nothing for a halo already over                       | `startMs` 2000 ms ago: none                                                                                                                                                                                                                                                                                                                    |
| steps once per beat under reduced motion                    | `r` is `haloRadius(10, 0)` at 0 and 499 ms, `haloRadius(10, 0.5)` at 500 and 999 ms, gone at 1000                                                                                                                                                                                                                                              |
| goes when the halo goes                                     | rerender with `null`: none                                                                                                                                                                                                                                                                                                                     |
| moves to the next note for the next halo                    | `.is-red` moved to `#a`, rerender with a new halo: one ring, in `#a`                                                                                                                                                                                                                                                                           |
| draws nothing when no notehead is marked                    | no `.is-red` in the host: none, and no frame requested                                                                                                                                                                                                                                                                                         |
| one ring under StrictMode, none after unmount               | after mount: one `.along-halo`; after `unmount()`: none                                                                                                                                                                                                                                                                                        |
| stops when its page is rebuilt                              | `#c` removed from the DOM: the next frame requests no other                                                                                                                                                                                                                                                                                    |

### 6.4 `apps/web/src/design/base.css` (Builder H2)

After the `.timing-mark` rule (current lines 787–794), add:

```css
/* The halo of the waiting walk (issue 204, score/useAlongHalo.ts): a thin ring that closes in on
   the cued note over the time to it. It is a child of that note's g.note, so the accent reaches
   it only through the .is-red rules (tokens.css) and it is part of the one accent element;
   anywhere else it is hidden, so it never shows in ink beside the music. No fill, 2 px at every
   width, and clicks and hovers pass through it to the bar. */
.score-sheet svg .along-halo,
.score-sheet.is-hopping svg .is-red .along-halo {
  fill: none;
  stroke-width: 2px;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
  visibility: hidden;
}

.score-sheet svg .is-red .along-halo {
  visibility: visible;
}
```

- The first selector (0,2,1) beats `svg .is-red *` (0,1,1) for `fill`. The second (0,4,1) beats `.score-sheet.is-hopping svg .is-red *` (0,3,1), so a hop never fills it in ink and hides it meanwhile.
- `stroke` is never set here: it comes from `svg .is-red *` in `tokens.css`, the accent.
- In the `@media print` block, next to `.timing-mark { display: none; }` (current line 1940), add `.along-halo` to that rule: `.timing-mark, .along-halo { display: none; }`.
- Run `node scripts/check-colors.mjs` after the edit. It must print `colors ok`.

### 6.5 `apps/web/src/score/noteKey.ts` and `noteKey.test.ts` (Builder H2)

`noteBoxes` measures each `g.note` with `getBoundingClientRect()`, which takes in the halo, about 2.1 noteheads wider on every side. useHoveredNote caches those boxes once per page and layout and is on in the walk (`enabled: ready && !playing`), so a page first measured while a halo is live would name the cued note under a neighbour until the layout changes.

- Write first, in `describe('noteBoxes and noteAt')`: "a note holding a halo keeps its own box (issue 204)": `g.note#n1` holds a `<use/>` stubbed at `(110, 60, 10, 8)` and a `circle.along-halo` stubbed at `(80, 30, 70, 70)`; the note's own rect is stubbed to the union `(80, 30, 70, 70)`. Expect `{ id: 'n1', left: 8, top: 8, right: 22, bottom: 20 }`.
- In `noteBoxes`: when no direct child of the note has the class `HALO_CLASS` (imported from `./render/halo.js`; check `child.classList`, not `:scope`), measure the note as today. Otherwise measure the union of the rects of its element children that do not have it, skipping a rect 0 wide or 0 high. The doc gains: "A halo inside a note (issue 204) is left out of its box."
- The two existing tests pass unchanged.

## 7. The timing judge (Builder H2)

### 7.1 `apps/web/src/score/useWalkTiming.ts`

- Delete the two lines `// A release too early: …` and `if (e.early) chainRef.current++;` (current lines 276–278).
- Header (lines 1–15): "The red still waits; Play judges nothing." becomes "Play judges nothing." The break list "(a seek, going inactive, a loop's wrap, a release too early, the finish)" loses "a release too early".
- The note-log comment (current line 173), "the walk passes a step a hold after the press, and the event time of the press is needed then", becomes "the walk passes a step at its press, and the event time of the decisive key is looked up then".

### 7.2 `useWalkTiming.test.tsx`

- Remove `early: false,` from every tap literal (current lines 246, 362, 385, 399, 463, 480, 503, 522, 540).
- Delete "starts a new chain after a release too early" (current line 412).
- The `walk` doc, "then tells the tap it passed, as the walk would a hold later", becomes "then tells the tap it passed, as the walk does at the press".

### 7.3 `apps/web/src/score/walkTiming.ts` and `walkTiming.test.ts` (wording only)

- `PlanStep.holdSec` doc (current line 43): "The step's note length up to the next step, in performance seconds (`holdSec` with no loop): a longer gap is a rest after the note."
- `judgeBar`'s doc (current line 166): "a gap the red does not wait out (a rest after the note)" becomes "a gap longer than the note (a rest after it: a beginner presses when the note ends)".
- The comment at current line 201 becomes "// A rest after the note: a beginner presses when the note ends, so the gap is not judged and not in the tempo."
- In `walkTiming.test.ts`, rename `describe('pauses and gaps the red does not wait out')` to `describe('pauses and rests after a note')`, and "does not judge a rest the red does not wait out" to "does not judge a rest after a note". Its comment "the red leaves the third step after one beat, and" becomes "the third note lasts one beat, and".

## 8. ScoreView, the status line and the words (Builder H2)

### 8.1 `apps/web/src/score/ScoreView.tsx`

- Import `useAlongHalo` from `./useAlongHalo.js`.
- `StatusInputs.alongHint` doc: "The red waits for the reader's piano (issue 182): how many pitches the step in front of them has, or null when the hint is not shown (usePlayAlong)."
- `scoreStatusLine`'s doc ends: "…then what to play on their piano while the red waits (issue 182). The explanation of the timing rings (issue 192) comes before the walk's play hint. Null when …". Delete "after the walk's `hold` hint and".
- Delete the line `if (alongHint?.kind === 'hold') return info(t.score.view.holdLonger(alongHint.count));`.
- Right after `const along = usePlayAlong({ … });`, add:

```ts
// The halo (issue 204): a ring that closes in on the cued note over the time to it. After the
// cursor and the walk, so its layout effect runs once the cued notes are marked.
useAlongHalo(host, along.halo, doc.pages);
```

Nothing else in ScoreView changes. `flightShown: red.redAway` stays. The status order is already busy, nothing playable, loading, count-in, sound, timing explanation, play hint once the `hold` line goes.

### 8.2 `ScoreView.status.test.tsx`

- The comment above `describe('the timing explanation on the status line (issue 192)')`: "ranks below the walk's `hold` hint and above its `play` hint" becomes "ranks above the walk's play hint".
- "gives way to the hold hint, and wins over the play hint" becomes "wins over the play hint": only the `{ count: 1 }` assertion, expecting `EXPLAIN`.

### 8.3 `ScoreView.test.ts`

- Every `alongHint: { kind: 'play', count: n }` becomes `alongHint: { count: n }` (current lines 109, 131, 147, 150, 165).
- Delete `describe('the hold hint')` with its comment (current lines ~183–227).

### 8.4 The five `apps/web/src/i18n/{en,es,fr,nl,pt}/score.ts`

Delete `holdLonger` and, in `en`, its doc comment. `messages.ts` derives its type from `en`, so no type edit is needed. `i18n.test.ts`' parity ("every language has every text") and `noDisclaimers.test.ts` pass unchanged.

## 9. e2e (Builder E)

E needs only the names fixed here: `__digitus2Along.halo()`, the class `along-halo`, the status texts, and the behaviour of section 1.

### 9.1 `apps/web/e2e/helpers/midi.ts`

- `FakeMidiOptions.tempo` doc: "The Practice tempo of pieces, by library slug: merged into the stored settings as `tempoByPiece`, like `playAlong`. It sets the halo's length and the other hand's pace (issue 204). It is the reader's own setting."
- `AlongHook`: replace `hold(): number` with `halo(): number;` and its doc "The whole length in real ms of the halo of the step `target()` names while it runs, 0 when there is none (issue 204)."
- Replace `api.hold()` with `async halo(): Promise<number>`, reading `__digitus2Along?.halo() ?? 0`.
- `pressStep` doc: "Presses every pitch of the step the red waits on and holds them: the step passes at the press (issue 204) and the other hand starts there (issue 184). With `wait` false …".
- Delete `playRedTimed`. `playRed` takes its body and returns the index: "Presses every pitch of the step the red waits on, waits in the page (on animation frames, up to 10 s) until the walk has moved on, which it does at the press, and lets go. Waits for a step first, so it also serves the moment after a finish or a seek. Returns the index of the step it played."
- Delete `tap()`; nothing calls it once section 9.4 and 9.5 are done.
- `walkRhythm` doc: replace "A step is let go once it has been held past its hold by 200 ms (the walk counts holds from arrival, and the margin absorbs timer jitter), or 100 ms before the next press when that is later, so a step before a rushed one is held legato." with "A step is let go 200 ms after its note's length up to the next step (`holdMs`), or 100 ms before the next press when that is later; the walk passes each step at its press, so the releases only shape the keys' levels." In the second paragraph, "the hold plus a round trip" becomes "the last step's release (its note length plus 200 ms) plus a round trip": `walkRhythm` sends every event, the last release included, before it resolves. The code does not change.

### 9.2 `apps/web/e2e/helpers/red.ts` (additions only)

```ts
/** One animation frame as the in-page recorder saw it. */
export interface RedFrame {
  t: number;
  /** Red roots, by the definition of `redRoots`. */
  roots: number;
  /** Every root is a cursor note (`g.note` / `g.chord` in the sheet) with one `data-onset-tick`. */
  cursor: boolean;
  /** `.along-halo` elements in the page. */
  halos: number;
  /** Halos visible outside every `.is-red` element. */
  halosOutside: number;
}

/** Starts recording every animation frame in the page (issue 204), until `redFrames` stops it. */
export function recordRedFrames(page: Page): Promise<void>;

/** Stops the recorder and returns its frames. */
export function redFrames(page: Page): Promise<RedFrame[]>;

/** Exactly one red root (or one cursor) on every frame, at most one halo, none outside the red. */
export function expectOneRedEveryFrame(frames: readonly RedFrame[], label: string): void;
```

- `recordRedFrames` installs `window.__redFrames = []` and a `requestAnimationFrame` loop that runs until `window.__redFramesStop` is set. Each frame pushes one `RedFrame`, computed in the page with the same props and rules as `redRoots` (copy the walker into the evaluated function: `page.evaluate` cannot share closures) and the cursor rule of `expectOneRed`. `halosOutside` counts `.along-halo` elements with no `.is-red` ancestor whose computed `visibility` is not `hidden`.
- `redFrames` sets the stop flag, waits two frames, and returns the array.
- `expectOneRedEveryFrame` expects `frames.length > 0`, and for every frame `roots === 1 || cursor`, `halos <= 1` and `halosOutside === 0`, with the frame in the message.

### 9.3 `apps/web/e2e/helpers/states.ts`

Add after `score-along-moved`:

```ts
  {
    // The halo (issue 204): the reader plays the left hand at 50 %, and the whole note of step 0
    // passes at its press; a thin ring closes in on step 1's note for 4.8 s, part of the cued
    // note, the one red. 4.8 s outlasts the sweep's checks as score-count-in's 4.8 s count-in at
    // 50 % does; go() ends with the ring live.
    name: 'score-along-halo',
    go: async (page) => {
      await installFakeMidi(page, {
        permission: 'granted',
        playAlong: true,
        settings: { hands: 'L' },
        tempo: { [TWINKLE]: 0.5 },
      });
      await twinkleReady(page, '?audio=silent');
      const midi = fakeMidi(page);
      expect(await midi.waitForStep()).toEqual([48]);
      await midi.playRed();
      await expect(page.locator('.score-sheet .is-red .along-halo')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Play' })).not.toHaveClass(/is-red/);
      expect(await midi.halo()).toBeGreaterThan(0);
    },
    expectTag: 'cursor',
  },
```

The states sweep then checks it at 1280 and 360 px, in light and dark, with axe and no overflow. The state starts with a live ring; on a loaded machine axe can outlast it, so 9.6's theme test is the one that proves an axe run while the ring is live. The other `score-along*` states keep their texts: none of them passes a long note.

### 9.4 `apps/web/e2e/play-along.spec.ts`

| Current line / name                                                                              | Change                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20–28, the header comment                                                                        | "moves on when the reader holds them all" → "moves on at the press of them all"; "counted from the press that starts each step running" → "counted from the press that passes each step"                                                                                                                                                                   |
| 50, `HOLD_MANY`                                                                                  | deleted                                                                                                                                                                                                                                                                                                                                                    |
| 375, "the first group waits, red, and moves on only when every note of it is held"               | renamed "… moves on at the press of every note of it"; the comments at 405–406 and 417 lose "for the step's time" and "and then its time"                                                                                                                                                                                                                  |
| 864, "the page scrolls once as the red enters the next system …"                                 | the tempo check reads `(await walkTiming(page).steps())[0]!.holdMs` `toBeCloseTo(400, 0)` instead of `midi.hold()` (import `walkTiming`); the rects read `.score-sheet .is-red .notehead`, so a halo inside the cued note does not grow the box; `system` still reads `marked[0].closest('g.system')`                                                      |
| 918–931, the other hand's section comment                                                        | "counted from the press that starts each step running" → "counted from the press that passes each step"                                                                                                                                                                                                                                                    |
| 1045, "a step pressed again drops the notes that have not started and counts from the new press" | rewritten as "the next press drops the notes that have not started and counts from its own press": with `HALF`, `pressStep()` on step 0 (`[48]`): 60 sounds; at once `pressStep()` on step 1 (`[53]`): `accompCancelled()` midis `[60, 67, 67]` at 1200, 2400 and 3600 ms after the first note; the next note is 69, and the second 69 is 1200 ms after it |
| 1076, "a step pressed early has its stretch counted from its press …"                            | deleted                                                                                                                                                                                                                                                                                                                                                    |
| 1346, "a short hold does not pass and asks for a longer one; a held note passes at its time"     | replaced by "a step passes at its press, in the same task as the note, and a release asks for nothing": in one `page.evaluate`, send note-ons 48 and 60 and read `__digitus2Along.index()` right after: 1; then note-offs: the status line is empty, `index()` still 1, `expectOneRed`, axe                                                                |
| 1378, "a key fills over its note's length, is full, and drains when let go early"                | the in-page watch ends at `performance.now() - started > 700` (a quarter at 100 qpm is 600 ms) instead of when `index()` changes; `was` goes; drop `expect(watched.numbers[48])`, because 48 is no longer cued after the pass at the press; the other assertions stay                                                                                      |
| 1512, "in the {scheme} theme the level and its number take their tokens, one red throughout"     | delete the hold-hint leg (`hold`, `tap`, `HOLD_MANY`, its `expectOneRed` and axe); the colour read waits for `copy(60)` only and drops `text48` and its expectation; `level48` stays                                                                                                                                                                       |
| 1767, "on again the walk goes on from the red, and a key held through the switch does not count" | `const hold = await midi.hold(); await page.waitForTimeout(hold + 600);` → `await page.waitForTimeout(1_200);`; "a fresh press and its hold move it" → "a fresh press moves it"                                                                                                                                                                            |
| 1916, `staysAt`                                                                                  | waits a fixed `STAY_MS = 700` (`const` beside it) instead of `hold() + 300`; doc: "Waits a moment and checks that the walk is still on `index`: a key that does not count (the wrong one, one held through a move, a key without its partner) leaves the red where it is however long it is held."                                                         |

Run `grep -n "hold\|held for its time" apps/web/e2e/play-along.spec.ts` after the edits. What remains is about keys held, not about a hold that gates the walk.

### 9.5 `apps/web/e2e/play-along-timing.spec.ts`

- Delete `HOLD_MANY` (current line 57).
- Test "the first step needs every key, held; a tap asks for a longer hold" (current line 138) becomes "the first step needs every key; the second key passes it at its press":
  - one key of `[48 60]`, held for 1.6 s (`waitForTimeout(1_600)`), moves nothing, and the line still says `HINT_MANY`;
  - the other key moves the red at once (`expect.poll(() => midi.index()).toBe(1)`);
  - both keys up; `expectOneRed`.
- Delete the tap-and-rewind leg. `rewind()` stays: line 267 uses it.
- Every other test is unchanged. They must pass with presses as onsets.
- `apps/web/e2e/play-along-sound.spec.ts` is not edited (it is in no builder's set) and must pass unchanged: it drives the walk with `playRed` (lines 137, 163 and 214) and leans on the hand-over.

### 9.6 `apps/web/e2e/play-along-halo.spec.ts` (new)

Desktop project (the mobile project's `testMatch` does not match it; the 360 px cases set their viewport). Twinkle with `?audio=silent`, the fake piano granted and `playAlong` on, as `twinkle()` in `play-along.spec.ts`. Copy into this file, from `play-along.spec.ts`: `TWINKLE`, `FAST`, `HALF`, `twinkle()` (line 323), `soundReady` and `dockStatus`, `flipPractice` (line 1686) and `playToTheEnd` (line 1953), with every local constant and helper `twinkle()` and those helpers use (the status texts and the cursor helpers among them); imports from `helpers/` stay imports. No new helper file. The steps with both hands are `[48 60] [60] [67] [67] [53 69] [69] [48 67] [53 65] [65] …`; step 6 is the half note G and step 7 the F after it.

| Test                                                                                                                                        | What it checks                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no halo after a quarter; after the half note one ring on the next note, part of the red note                                                | `playRed()` six times: after each, `halo()` 0 and no `.along-halo`. The seventh: `waitForStep()` is `[53, 65]`; one `.along-halo`; `halo()` within 1 ms of 1200; in the page, the ring's parent matches `g.note`, has an `.is-red` ancestor, and holds the topmost of the `.score-sheet .is-red .notehead` (by `getBoundingClientRect().top`); `expectOneRed`                                                                                                 |
| it closes in, and is gone when the next note is due; the red note waits                                                                     | at the halo: `r` read twice 300 ms apart, the second smaller; `.along-halo` count 0 within `halo() + 500` ms; `index()` still 7; `.score-sheet .is-red` still there; `expectOneRed`                                                                                                                                                                                                                                                                           |
| one red on every frame: a press, the ring's life, a press before it closes, and the finish                                                  | at 150 % (`tempo: FAST`): `recordRedFrames`; `playRed()` seven times; 300 ms; `playRed()` on step 7 (before its 800 ms halo closes): no `.along-halo` after it; `playToTheEnd`; `redFrames`; `expectOneRedEveryFrame`; some frame had `halos === 1`                                                                                                                                                                                                           |
| a seek and Practice mode off take the ring away at once                                                                                     | at the halo on step 7: `recordRedFrames`; `seekBar(page, 3)`; `.along-halo` count 0; `redSettled`; `expectOneRedEveryFrame(await redFrames(page))`. Then `playRed()` on steps 11, 12 and 13 (13 is the half note C): one `.along-halo`; `flipPractice(page, false)`: none, and `midi.target()` is `[]`                                                                                                                                                        |
| the ring and the other hand count from the same press at the Practice tempo                                                                 | `settings: { hands: 'L', tempoByPiece: { 'piece:<TWINKLE>': 0.5 } }`, audio running as `soundReady` in play-along.spec: `playRed()` on step 0: `halo()` within 1 ms of 4800; `accompanied()` midis `[60, 60, 67, 67]` at gaps `[0, 1200, 2400, 3600]`; the stretch ends at 4800 ms, where the halo closes                                                                                                                                                     |
| under reduced motion the ring steps once per beat and is gone at the end                                                                    | `emulateMedia({ reducedMotion: 'reduce' })`; six `playRed()`; the seventh press (the half note G) is made in the page, so the test's round trips do not count against the ring, and `r` is sampled every frame from that press until the ring is gone: two distinct values (rounded to a hundredth), the first the larger, and gone 1200 ms ± 200 after the press                                                                                             |
| at {1280, 360} px in the {light, dark} theme the ring is drawn in the accent with no fill, one red, axe clean, no overflow, hidden in print | `emulateMedia({ colorScheme })`, the viewport; hands L at 50 %, `playRed()` on step 0; the ring's computed `stroke` is `ACCENT_RGB`, `fill` is `none`, `stroke-width` is `2px`; `expectOneRed` with every root in the sheet; `expectNoSeriousA11y`, then `.along-halo` count 1 (so this axe run is proven to happen while the ring is live); `horizontalOverflow(page) <= 0`; `emulateMedia({ media: 'print' })`: computed `display` `none`; back to `screen` |

## 10. Docs (Builder D)

D writes only `docs/app.md`, `docs/PROGRESS.md` and `docs/research/play-along-timing.md`, in the present tense, with no dates, hashes, branch names or credits. Issue links use the file's existing style.

### 10.1 `docs/app.md`, site by site

1. **Playing along on a piano, first paragraph.** "When the reader has held every pitch of that group for its time, the red moves on to the next one" becomes "When the reader presses every pitch of that group, the red moves on to the next one at that press". Add: "When the time to the next note is longer than a beat, a thin ring around it closes in on it over that time (The halo, below)." To the code list add `score/halo.ts` (pure: when a halo shows, its length and radius), `score/render/halo.ts` (the ring on the SVG) and `score/useAlongHalo.ts` (its frame loop).
2. **Practice mode paragraph.** "there is no hold cue, no hint and no accompaniment" becomes "there is no halo, no hint and no accompaniment". "the levels, the early flag and the wake-up timer clear" becomes "the levels and the halo clear".
3. **"When a step passes" (issue 185), whole subsection.** Rewrite it as **When a step passes** (issues 182 and 204). Keep the bullets on note-on and note-off, the press stamp, chords played apart, keys held at open, external moves, and presses under a flight. Replace "The run", "The hold" with its table, "On its time", "A release near the end", the timer half of "Chains" and "The timer" with:
   - A step passes the moment every pitch of it is held and fresh (`advance`). A wrong note does nothing, and extra keys stay as they are.
   - A release never passes a step and never stops one.
   - A chain of steps whose keys are already held and fresh passes in one look, with one `cueAt` (or `finish`) to where it ends.
   - Each passed step is recorded with the latest press among its keys (`runSince`), which the timing reads.
   - Nothing in the walk counts time and no timer is set.
   - "A flight on screen" becomes: a press under a flight or hop is kept, and the step passes when the red lands, at that moment.
4. **The keys fill.** "or when the red arrives for a key already held" stays. "(to the end of the run it lies in, as the hold does)" becomes "(to the end of the run it lies in)". "for the hold and for the level" becomes "for the level". Add one sentence: the key fill shows how long a note is held, the halo when the next note comes.
5. **New subsection "The halo" (issue 204)**, after The keys fill. State: when it shows (the formula, `HALO_MIN_MS`, the felt beat), that it rings the step after the long note, its look (2.1 to 0.85 notehead widths, linear, 2 px, no fill, a child of the cued `g.note` so part of the one red root, accent through `.is-red` only, hidden elsewhere, `aria-hidden`, `pointer-events: none`, hidden in print), its clock (from the pass, one `requestAnimationFrame` loop while drawn, right again after a hidden tab), what removes it (1.3), reduced motion (a step per felt beat), a tempo change, and that a rest after the note is inside the gap. Add a table:

   | In the walk                                                                     | The halo                                                    |
   | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
   | A step passed, the next one a beat or less away                                 | none                                                        |
   | A step passed, the next one more than a beat away                               | a ring around the next note, closing in over the time to it |
   | The next note pressed before it closes                                          | gone; the next note's halo, if any, starts                  |
   | The time is up                                                                  | gone; the red note waits                                    |
   | A seek, Rewind, a loop or hands change, Play, Practice mode off, the piano gone | gone at once                                                |
   | Rewind or Home on a loop's first step (they idle, issue 196)                    | as it was                                                   |
   | Reduced motion                                                                  | one step per felt beat, then gone                           |

6. **The walk.** "It moves the red only when no flight or hop is on screen (`red.redAway`)" stays.
7. **The walk's state table.** "A step held for its time" becomes "A step played", with "The next step's notes, by a class swap with no hop, at the press; the page is turned as for the playing cursor; the halo when the next step is more than a beat away." Delete the rows "A step held, its time not up" and "A step let go too early".
8. **Status line bullet.** Delete from "After a release that came too early the line reads …" through "re-renders nothing." The rest stays.
   8b. **The dock and Practice, Status line bullet** (around line 458). "then `Play the red note on your piano.` or, after a release that came too early, `Hold the red note a little longer.` (Playing along on a piano)" becomes "then `Play the red note on your piano.` until the first step is played (Playing along on a piano)". "takes the line between those two" becomes "takes the line before the play hint".
9. **Timing in the walk.** "The red still waits;" becomes "The red moves at the press;". In "Onsets", "a step pressed early from its own press" stays. In "Pauses and breaks", delete "and at a release too early (the step is pressed again)", and "After a note followed by a rest the red moves on when the note ends, so that gap is neither judged nor counted in the tempo" becomes "A beginner presses when a note ends, so the gap of a note followed by a rest is neither judged nor counted in the tempo". In "The explanation", "It ranks under the hold hint and above the play hint" becomes "It ranks above the play hint". The code line's `Settled.passedRuns` becomes `Advanced.passedRuns`.
10. **The other hand, intro and "When it starts".** "counted from the press that starts each step running" becomes "counted from the press that passes each step". Replace "When it starts" whole with: "At every look that passes a step (the press of its last key, or the landing of a hop for a press made under it), the walk hands over the other hand from the last step passed to the next step of the walk, at offset 0, from that moment. A chain plays from its last step." Delete every mention of `handedRef`, `elapsedSec`, `LATE_MS` and a step pressed before the red reached it.
11. **Stretches.** "From the step that starts running" becomes "From the last step passed". "`advance` and `settle` also return the `last` step passed" becomes "`advance` also returns the `last` step passed".
12. **"An early release" bullet.** Replace it with "**A release** stops nothing: the stretch is the piece's rhythm and plays to the next step, then waits."
13. **"Tempo" bullet.** Replace it with: "Offsets and lengths are divided by the Practice tempo factor read at the pass, so a stretch takes twice as long at 50 %. A tempo change during a stretch leaves it as it is; the next pass plays at the new tempo."
14. **The other hand's state table.** "A step starts running (all its keys down)" becomes "A step played (all its keys down)", with "the next step" under The red. Delete "The step held for its time" and "The step let go too early". "The step pressed again before the stretch has ended" becomes "The next step played before the stretch has ended", with "the next step" and "the unstarted notes dropped; the new stretch from this press". Delete "The next step pressed under the one still held". "The last step held for its time" becomes "The last step played", with "the piece's tail (from that press)".
15. **The red element rule.** The row "Score, a piano waiting (stopped, a piano connected)" becomes "the cursor notes of the step to play (the first step when the score opens), with the halo around the topmost of them while it closes in (a child of that `g.note`, so part of the one red root); Play is plain". Add a bullet after the timing rings' bullet: the halo sits inside the cued `g.note`, takes the accent only through `svg .is-red *`, and is hidden wherever it is not inside a red note, so the red stays one root on every frame.
16. **Motion, intro.** "Every duration comes from `tokens.css` and is 0 under `prefers-reduced-motion`; easing is `--ease`. No layout height animates, and the cursor never does" becomes "Every duration comes from `tokens.css` and is 0 under `prefers-reduced-motion`, except two whose length is the music's: a key's level and the walk's halo, which step a beat at a time under reduced motion instead. Easing is `--ease`. No layout height animates, and the playing cursor never does". Keep the following ": a class swap per onset keeps it within a frame of the sound". The last sentence, "A key's level is an SVG attribute inside the keyboard's fixed box, so it moves no layout.", becomes "A key's level and the halo are SVG attributes inside fixed boxes (the keyboard, the score's SVG), so neither moves any layout."
17. **Motion, row "The red waiting for the reader's piano (issue 182)".** It becomes: "A class swap per step at the press, like the playing cursor: no hop, no breathing, the page turned as it is for the cursor. When the next step is more than a beat away (and at least 400 ms), a 2 px ring around its topmost notehead closes in linearly from 2.1 to 0.85 notehead widths over the time to it at the Practice tempo, one `requestAnimationFrame` loop while it is drawn, and is gone when the note is due or the note is pressed. A seek and the finish keep the hop and the flight home they have; the walk waits for them to land." Keep the sentences on the held keys and levels. End with: "Under `prefers-reduced-motion` the level and the halo step a beat at a time and the drain is instant."
18. **Testing, the `play-along` paragraph.** "it moves on only when every note of it has been held for its time (the repeated C needs a fresh press)" becomes "it moves on at the press of every note of it (the repeated C needs a fresh press)". Replace the issue-185 sentences (a short hold, the long walks at 150 %, a release too early) with the press test (the red moves in the same task as the note). "the next step played early drops the notes that have not started and counts from the new press" stays. Delete the sentence about a step pressed again after an early release. Add a `play-along-halo` paragraph listing the seven tests of 9.6. In `play-along-timing`, "a tap of both keys asks for a longer hold, and holding them passes the step" becomes "the other key passes it at its press". In the states table, add this row after `score-along-moved`: "| score-along-halo | score-along's setup with hands L at 50 %, step 0 (the whole note C3) played: a ring closes in on step 1's note for 4.8 s, inside the cued note | cursor |". If the prose before the table names the `score-along*` states, add `score-along-halo` there too.
19. **Testing, the test hook paragraph.** `__digitus2Along` also has `halo()`, the whole length in real ms of the halo of the step `target()` names while it runs, 0 when none.
20. **Testing, the fake Web MIDI paragraph.** "`playRed` presses every pitch of that step, holds them until the red has moved on (a step passes once its keys have been held for its time, issue 185)" becomes "`playRed` presses every pitch of that step, waits until the red has moved on (at the press), and lets go". Delete `playRedTimed`, `tap` and `hold()`. "`tempo`, issue 185" becomes "`tempo`: the halo's length and the other hand's pace". `walkRhythm`'s "holds it past its hold" becomes "lets it go after its note's length".
21. **Known limitations.** Add: "The halo is drawn only on a cued note whose page is in the DOM; the cue builds that page first, so in practice it always is, and when it is not the red note shows with no halo." "gaps the red does not wait out" becomes "a rest after a note".
22. **What the UI review should look at, Playing along** (around line 777). Replace ", and `Hold the red note a little longer.` reads as advice (issue 185)" with "; with the next note more than a beat away, the thin ring around it reads as the time to it without a word, stays calm, and never looks like a second red (issue 204)".

Run `grep -n "held for its time\|hold hint\|Hold the red\|LATE_MS\|handedRef\|wake-up\|early flag\|release too early\|settle" docs/app.md` after the edits. What remains must still be true.

### 10.2 `docs/PROGRESS.md`

- Line 11: "the red waits on the next group of notes and moves on once the reader has held all of them for their time, with the reader's held keys shown on the on-screen keyboard, filling over each note's length (#185)" becomes "the red waits on the next group of notes and moves on at the press of all of them, as a partner would ([#204](https://github.com/MarchalMaxim/digitus2/issues/204)); when the next note is more than a beat away, a thin ring around it closes in over the time to it; the reader's held keys show on the on-screen keyboard, filling over each note's length ([#185](https://github.com/MarchalMaxim/digitus2/issues/185))", keeping the line's existing #185 link URL. In the same line, "counted from the press that starts each step running" becomes "counted from the press that passes each step", and `docs/superpowers/plans/2026-10-25-play-along-halo.md` joins the plans the line names. Keep the rest of the line.
- Line 169 (the other hand, #184): "counted from the press that starts the step running (every pitch of it held and fresh; the step passes a note's length later), at the Practice tempo read at the press" becomes "counted from the press that passes the step, at the Practice tempo read then". Delete the clause about a reader who lets go early, or reduce it to "a release stops nothing".
- Line 171 (#192): "The red still waits;" becomes "The red moves at the press;".
- Add one decision bullet beside them: "**The red moves at the press, and nothing waits on a hold ([#204](https://github.com/MarchalMaxim/digitus2/issues/204)).** The hold gate of #185 is gone: no wake-up timer, no four-fifths rule, no hint for a longer hold, no deferred hand-over. The time until the next note shows at the red note itself, as a halo that is part of the one red element and that nothing waits on."

### 10.3 `docs/research/play-along-timing.md`

- Line 25, the owner's method: "holding each step for its time and trying to play evenly" becomes "pressing each step in time and trying to play evenly". Nothing else changes.

## 11. Removal list and the dead-code grep

### 11.1 Symbols removed

Section 1.10 lists them. No file is deleted.

### 11.2 The dead-code grep (integration gate)

```bash
cd C:/Users/maxim/Desktop/projects/github/thingamajig/.claude/worktrees/score-camera-scan-ux-7716cb
grep -nE "\bsettle\(\{|\bSettled\b|SettleInput|HOLD_SLACK_MS|wakeAtMs|\bmarkEarly\b|\bearlyRef\b|\btimerRef\b|handedRef|\bLATE_MS\b|\bheardSec\b|\belapsedSec\b|\bdoneSec\b|holdLonger|playRedTimed|HOLD_MANY|kind: 'hold'|early: (true|false)|\.hold\(\)|releasing" \
  apps/web/src/score/playAlong.ts apps/web/src/score/playAlong.test.ts \
  apps/web/src/score/usePlayAlong.ts apps/web/src/score/usePlayAlong.test.tsx apps/web/src/score/usePlayAlong.accompany.test.tsx \
  apps/web/src/score/accompaniment.ts apps/web/src/score/accompaniment.test.ts \
  apps/web/src/score/useWalkTiming.ts apps/web/src/score/useWalkTiming.test.tsx \
  apps/web/src/score/ScoreView.tsx apps/web/src/score/ScoreView.test.ts apps/web/src/score/ScoreView.status.test.tsx \
  apps/web/src/i18n/*/score.ts apps/web/e2e/*.ts apps/web/e2e/helpers/*.ts
```

It must print nothing. The walk's `settle` was only ever called with an object literal (`settle({`), so the pattern is `settle\(\{`: `e2e/helpers/midi.ts` has the fake MIDI permission's own `settle(cfg.answer)`, which stays. The search is limited to these files on purpose: `settle` is a name elsewhere (`piano.test.ts`, `carry.switch.test.ts`, ScoreView's `settleSweep` listener), and `useCursor.ts` has `heardSecRef`.

## 12. Work split

Order:

1. **P**, **E** and **D** start at once. E and D code against the names fixed in this plan.
2. **H1** and **H2** start at once too, but run their vitest only after P reports done: their tests import P's modules.
3. A gatekeeper runs section 13's integration gate once, after all five.

Every file is in exactly one set.

| Builder               | Files (create or edit)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P (pure)              | `apps/web/src/score/playAlong.ts`, `apps/web/src/score/playAlong.test.ts`, `apps/web/src/score/halo.ts` (new), `apps/web/src/score/halo.test.ts` (new), `apps/web/src/score/render/halo.ts` (new), `apps/web/src/score/render/halo.test.ts` (new), `apps/web/src/score/accompaniment.ts`, `apps/web/src/score/accompaniment.test.ts`                                                                                                                                                                                                            |
| H1 (the walk)         | `apps/web/src/score/usePlayAlong.ts`, `apps/web/src/score/usePlayAlong.test.tsx`, `apps/web/src/score/usePlayAlong.accompany.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                          |
| H2 (drawing and view) | `apps/web/src/score/useAlongHalo.ts` (new), `apps/web/src/score/useAlongHalo.test.tsx` (new), `apps/web/src/score/ScoreView.tsx`, `apps/web/src/score/ScoreView.status.test.tsx`, `apps/web/src/score/ScoreView.test.ts`, `apps/web/src/design/base.css`, `apps/web/src/i18n/{en,es,fr,nl,pt}/score.ts`, `apps/web/src/score/useWalkTiming.ts`, `apps/web/src/score/useWalkTiming.test.tsx`, `apps/web/src/score/walkTiming.ts`, `apps/web/src/score/walkTiming.test.ts`, `apps/web/src/score/noteKey.ts`, `apps/web/src/score/noteKey.test.ts` |
| E (e2e)               | `apps/web/e2e/helpers/midi.ts`, `apps/web/e2e/helpers/red.ts`, `apps/web/e2e/helpers/states.ts`, `apps/web/e2e/play-along.spec.ts`, `apps/web/e2e/play-along-timing.spec.ts`, `apps/web/e2e/play-along-halo.spec.ts` (new)                                                                                                                                                                                                                                                                                                                      |
| D (docs)              | `docs/app.md`, `docs/PROGRESS.md`, `docs/research/play-along-timing.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

No builder touches `apps/web/src/score/keyLevels.ts`, `useKeyLevels.ts`, `Keyboard.tsx`, `PianoKeyboard.tsx`, `RedFlight.tsx`, `useCursor.ts`, `usePlayback.ts`, `tokens.css` or `scripts/check-colors.mjs`. No builder runs git, `pnpm verify`, the whole test suite, the build or e2e.

**The API between P and H1/H2** is fixed in sections 2.1, 3.1, 3.3 and 4.1: `advance` and `Advanced`, `stepGapSec`, `HOLD_TOLERANCE`, `Halo`, `HaloInput`, `haloFor`, `haloProgress`, `haloRadius`, `HALO_MIN_MS`, `HALO_FROM`, `HALO_TO`, `HALO_CLASS`, `HaloAnchor`, `haloAnchor`, `drawHalo`, `setHaloRadius`, `clearHalos`, and `accompanimentStretches` without its last two parameters.

**The API between H1 and H2** is `PlayAlong.halo: Halo | null`, `AlongHint` as `{ count: number }` and `WalkTimingEvent` without `early` (section 5.1).

**The API toward E** is `__digitus2Along.halo()`, the class `along-halo` inside `.score-sheet .is-red`, and the behaviour of section 1.

## 13. Verification

Run from the worktree root in Git Bash. Under load, vitest's 5 s timeout can drop a random test: rerun that file once before calling it a failure.

- **P:** `pnpm --filter @digitus2/web exec vitest run src/score/playAlong.test.ts src/score/halo.test.ts src/score/render/halo.test.ts src/score/accompaniment.test.ts`. Write the new tables first and see them fail; then everything passes, with `describe('the hold of a step')` unchanged.
- **H1:** after P is done, `pnpm --filter @digitus2/web exec vitest run src/score/usePlayAlong.test.tsx src/score/usePlayAlong.accompany.test.tsx`.
- **H2:** after P is done, `pnpm --filter @digitus2/web exec vitest run src/score/useAlongHalo.test.tsx src/score/ScoreView.status.test.tsx src/score/ScoreView.test.ts src/score/useWalkTiming.test.tsx src/score/walkTiming.test.ts src/score/noteKey.test.ts src/score/score.i18n.test.tsx src/i18n/i18n.test.ts src/i18n/timing.test.ts src/i18n/noDisclaimers.test.ts`, then `node scripts/check-colors.mjs`, which must print `colors ok`.
- **E and D:** no commands beyond `grep`. E reads its specs back against section 9; D runs the greps of 10.1.
- **Integration gate** (the gatekeeper, once, after all five), in order:
  1. `pnpm typecheck`
  2. `pnpm lint`
  3. `pnpm test`
  4. `pnpm format:check` (then `pnpm format` on the files of this change if it fails)
  5. `node scripts/check-colors.mjs`
  6. the dead-code grep of 11.2: nothing printed
  7. `pnpm --filter @digitus2/web build` (background), then on a free port from 4517–4530, `DIGITUS2_E2E_PORT=<port> pnpm --filter @digitus2/web exec playwright test e2e/play-along.spec.ts e2e/play-along-timing.spec.ts e2e/play-along-halo.spec.ts e2e/play-along-sound.spec.ts e2e/states.spec.ts e2e/playback.spec.ts` (background), and `--project=mobile` for `e2e/states.spec.ts`
  8. `DIGITUS2_E2E_PORT=<port> pnpm verify --changed` (background)

  Then one full `DIGITUS2_E2E_PORT=<port> pnpm verify` (background) before the pull request. Benchmark gates that report SKIP without the PIG dataset are not a pass; the PR says so.

## 14. Risks, and the test that catches each

| Risk                                                                                                                                                                                                       | Caught by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A second red root: the halo drawn outside the cued note, or left in a note that lost `.is-red` for a frame                                                                                                 | The halo is a child of the `g.note` (render/halo.test "draws a circle in the note"); CSS hides it outside `.is-red` (`visibility`); the render check drops it in the commit that moves the cue (5.7 "goes in the render that moves the cue, before the align"); e2e `expectOneRedEveryFrame` through a press, the ring's life, a press before it closes, a seek and the finish; the states sweep `score-along-halo`                                                                                                 |
| The accent reaching the page outside `.is-red`                                                                                                                                                             | `stroke` is never set in base.css; `node scripts/check-colors.mjs`; the e2e theme test reads the computed stroke as the accent and the fill as `none`                                                                                                                                                                                                                                                                                                                                                               |
| The halo filled solid: `svg .is-red *` and the hop's ink rule both set `fill`                                                                                                                              | The two selectors of 6.4 and their specificities; the e2e theme test asserts `fill: none`                                                                                                                                                                                                                                                                                                                                                                                                                           |
| The align or StrictMode looking twice: a second halo, a second hand-over, or a live halo cleared                                                                                                           | `showHalo` runs only when `passed > 0`; 5.7 "stays through a wrong key, a release and the align's second look"; 5.8 "the align's second look hands nothing over"; useAlongHalo.test "one ring under StrictMode"                                                                                                                                                                                                                                                                                                     |
| A press under a hop: no halo, a halo counted from the press, or two hand-overs                                                                                                                             | 5.7 "a press under a hop passes at the landing, with its halo from the landing"; 5.8 "a press under a flight is handed over once, at the landing, at offset 0"                                                                                                                                                                                                                                                                                                                                                      |
| The loop's last step: a gap read to the next index instead of `loop.to`, or a halo on the wrong step                                                                                                       | `stepGapSec` tests (loop end, loop at the last step); halo.test "the loop's last step runs to the loop's end, wraps"; 5.7 loop case                                                                                                                                                                                                                                                                                                                                                                                 |
| The page window: the cued note not in the DOM                                                                                                                                                              | `haloAnchor` gives null and nothing is drawn (render/halo.test "none marked", "none laid out"; useAlongHalo.test "draws nothing when no notehead is marked"); a rebuilt page stops the loop ("stops when its page is rebuilt")                                                                                                                                                                                                                                                                                      |
| A hidden tab: a halo frozen, or one never removed                                                                                                                                                          | The radius is a function of `performance.now()` (halo.test `haloProgress`); useAlongHalo.test "is gone when the gap is up, and the loop stops"; the walk sets no timer (5.7 "sets no timer")                                                                                                                                                                                                                                                                                                                        |
| The halo growing the cued note's box: the page-turn test and the band check read `.is-red` rects                                                                                                           | The page-turn test reads `.is-red .notehead` (9.4). In the app, `followCursor` measures the marks in useCursor's layout effect, before useAlongHalo draws in the same commit, so the scroll never sees the ring                                                                                                                                                                                                                                                                                                     |
| The halo growing the cued note's hover box: `noteBoxes` measures each `g.note` with `getBoundingClientRect()`, cached per page and layout, and the hover is on in the walk                                 | 6.5: `noteBoxes` leaves `.along-halo` out of the box; noteKey.test "a note holding a halo keeps its own box"                                                                                                                                                                                                                                                                                                                                                                                                        |
| Issue 200's pull request: its `usePlayAlong.ts` imports `HOLD_TOLERANCE` and reads `settle`, `result.early` and the glass on an early release; its `play-along.spec.ts` edits touch the level tests of 9.4 | `HOLD_TOLERANCE` stays exported with its value, with a test; `keyLevels.ts`, `useKeyLevels.ts`, `Keyboard.tsx` and `PianoKeyboard.tsx` are untouched; the levels block and the `levels.release` line stay verbatim. Whichever pull request merges second rebases: issue 200's glass on a release too soon has no `result.early` to hang on, so it must decide by the key's own fraction (`HOLD_TOLERANCE` of the level's length), which it already computes for the forgiven case. The typecheck catches the rebase |
| The timing judge, now fed presses at the press                                                                                                                                                             | `play-along-timing.spec.ts` unchanged apart from its first test; `useWalkTiming.test.tsx` and `walkTiming.test.ts` pass with only `early` removed                                                                                                                                                                                                                                                                                                                                                                   |
| A level test that waited for the red to move                                                                                                                                                               | 9.4's edits to 1378 and 1512. Where a test needs keys held while the red stays put, it holds an incomplete chord (48 without 60)                                                                                                                                                                                                                                                                                                                                                                                    |

## 15. Decisions this plan makes where the spec leaves room

- **Where the halo is.** It rings the step after the long note, the note pressed next. The spec's "the halo appears on the half notes" is shorthand: the e2e oracles say "after the half note, around the next note".
- **Radii.** These are measured in notehead widths from `getBBox()`, as the timing rings are, because the SVG gives no staff space to measure. `HALO_FROM` is 2.1 widths, about two and a half staff spaces. `HALO_TO` is `RED_HEAD_SCALE / 2 + 0.15` = 0.85 widths, just outside the marked head at its 1.4 scale. The stroke is 2 px, non-scaling.
- **Where the code lives.** The arithmetic is in `score/halo.ts`, the SVG in `score/render/halo.ts`, and the frame loop in `score/useAlongHalo.ts`, beside `usePlayAlong`. ScoreView passes `host`, `along.halo` and `doc.pages`. The class is `along-halo`.
- **`AlongHint`** becomes `{ count: number }`.
- **The halo leaves in the render that moves the cue**, by a check made in each render, not when the align runs. This keeps one red on the frame of a seek.
- **Hidden outside a red note** (`visibility`), so a stale ring can never be painted in ink.
- **`stepGapSec`** is new and exported. `holdSec` and the halo share it, so the two gaps cannot drift apart. `holdSec`'s results do not change.
- **A flight ends the halo**, in `decide`'s flight gate. A seek whose hop lands on the step the red already waits on is no external move to the walk, so without this the halo would come back after the hop with its old clock; the spec says a seek removes it.
- **`playRedTimed` and `tap()` go.** Nothing measures a hold any more.
- **A new spec file, `play-along-halo.spec.ts`**, keeps the halo's tests out of `play-along.spec.ts`, which issue 200's pull request also edits.
