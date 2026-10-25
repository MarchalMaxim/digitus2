# Play along: the red moves on at the press, and a halo closes in on the next note

Design for [issue 204](https://github.com/MarchalMaxim/digitus2/issues/204). It changes the waiting walk of issues 182, 184 and 185 (`docs/app.md`, Playing along on a piano) and nothing outside it. A first draft had the red travel from note to note; four independent critiques (a teacher, the house rules, an engineer, a devil's advocate) found that the travel took the red off the next note for the whole note, snapped on every note for a reader faster than the Practice tempo, and flew backwards across line breaks, repeats and loop wraps. The halo below keeps what the travel was for and none of that.

## Intent

A beginner with a digital piano plays a piece with digitus: the red marks the next notes, waits for them, and with one hand left out digitus plays the other. The first version of this (issues 182 and 184) felt like a partner playing along. The hold rule of issue 185 broke that feeling, and the owner has said why: the acknowledgment at the press was gone, digitus's hand felt late, the pace felt imposed, and the timing cue (a key filling on the keyboard drawing) was a second place to look while the eyes were on the notes.

This design restores what the first version had and keeps what issue 185 asked for, which is that the reader sees how long until the next note. It does so in the one place the eyes already are, the red note on the score, and never as something the walk waits on.

## The principle

One place for the eyes, the ears for timing, acknowledgment at the press.

- The red says: heard, and this is next. At the press it leaves the step played and marks the next step, at once, as in issue 182.
- The halo says: this is how long until it. A thin red ring around the next note closes in on it over the time to it, and is gone when the note is due.
- Digitus's hand says: here is the pulse. It plays the other hand from the press at the Practice tempo.
- The reader leads. Everything counts from the reader's press; nothing predicts the reader, and nothing holds the red back.

## Goals

- The red acknowledges every press at once and marks the next step at once, exactly as in issue 182.
- The time until the next note, when it is longer than a beat, is visible at the red note itself.
- Digitus's other hand is heard as following the reader, never as lagging behind a hold.
- The Practice tempo sets the pace of the halo and of the other hand, and nothing else of the walk.
- The change removes more than it adds: a gate, a timer, a status line, a constant and a deferred hand-over go; one ring on long notes comes.

## Non-goals

- Measuring and cutting the latency chain (Bluetooth, main thread, audio output). `docs/research/play-along-timing.md` holds the method; the owner's sessions do it.
- The timing judge and its gray rings in the walk (issue 192). They stay as they are; their onsets become the presses, which is what they compare.
- A count-in, a click, or a metronome in the walk.
- Any change to Play, to the cursor during Play, to the red's flights (`RedFlight.tsx`), or to the ordinary view.
- Showing how long a note is held in polyphony: that stays the key fill's business.

## Anti-goals

- A second red root on any frame, ever. The halo is part of the red note, never a root of its own.
- A new control, line or mark anywhere but at the red note.
- A meter the reader must watch to decide when to release. Nothing waits on the halo.
- Any prediction of the reader's tempo, or any pace derived from an average of their playing. The hand follows; it never guesses.
- A sound for the reader's own notes.
- A disclaimer anywhere.

## Constraints

The house rules bind: black, white and grays with exactly one red element on screen at a time (`docs/app.md`, The red element rule, whose test definition treats a `g.note` or `g.chord` with `.is-red` as one root and never inspects its descendants); the motion table and `prefers-reduced-motion`; minimalism; light and dark; 360 px; axe clean. The halo is motion the reader's own press starts and that reduced motion turns into beat steps, so WCAG 2.2.2 holds. Engine logic is written test first (vitest); e2e uses the fake piano (`apps/web/e2e/helpers/midi.ts`). `pnpm verify --changed` is the loop and one full `pnpm verify` precedes the pull request. The work goes on a branch; the owner merges.

## The behaviour

### The pass

A step passes the moment every pitch of it is held and fresh, the rule of issue 182. A chain of steps whose keys are already held and fresh passes in one settle, as today. A wrong key moves nothing. The hold of issue 185 gates nothing any more: no wake-up timer, no four-fifths rule, no `early` state, no "hold longer" line. The cue (`Playback.cueAt`) moves to the next step at the pass, the page turns, the next step's keys show their fingers and its notes are red, all in the same commit, as in issue 182.

The pure rule is `advance(steps, index, keys, presses, loop)`: `walk` with no hold. It returns what `settle` returned less the hold (`keys`, `presses`, `move`, `passed`, `passedSteps`, `passedRuns`, `last`, `at`); `wakeAtMs`, `run`, `early`, `releasing`, `HOLD_SLACK_MS` and the four-fifths rule go. `runSince` stays inside `walk` to fill `passedRuns` for the timing judge. `holdSec` and `HOLD_TOLERANCE` stay exported: the judge's hook and its "a gap longer than the note" rule read `holdSec`, and the key levels' forgiven-release rule of issue 200 reads `HOLD_TOLERANCE`. Neither gates the walk.

### The halo

At a pass whose move is a cue, when the gap from the last passed step to the cued step is longer than a felt beat, a thin red ring, the halo, appears around the cued step's topmost notehead and closes in on it at an even rate over the gap at the Practice tempo:

    gapSec  = steps[cued].perfSec - steps[last].perfSec     (the loop's last step: loop.to - steps[last].perfSec)
    haloMs  = gapSec * 1000 / factor
    shown   = gapSec > beatSec(last) + ALONG_EPS  and  haloMs >= HALO_MIN_MS

`beatSec` is the felt beat at the step in performance seconds (`StepNotes.beatSec` from `alongPlanNotes`: the time signature's beat, the dotted beat in compound meters). `HALO_MIN_MS` is 400. A quarter in 4/4 has no halo: the pulse and digitus's hand carry it. A half note, a dotted quarter, a whole note, and a note followed by a rest have one. The halo starts at `HALO_FROM` staff spaces from the notehead's centre and ends at `HALO_TO`, just outside the marked notehead, where it is gone; the exact radii, the stroke width (about the stem's) and the rate (linear in radius) are the builder's within those words. A rest after the note is inside the gap, so the halo shows when the next note comes, not how long the note is held: the key fill, which stops at the note's end, shows that, and `docs/app.md` says so.

The halo is a child of the cued `g.note` (the topmost marked notehead's group in the hands played), so under the red element rule it is part of the one red root and not a root of its own. It draws with `fill: none` and its stroke in the accent through the `.is-red` rules only (`scripts/check-colors.mjs` allows the red only there); `aria-hidden`, `pointer-events: none`, hidden in print. It is placed and sized in the SVG's own units from the notehead's box, so it scrolls with the page and survives a resize. A step on both staves gets one halo, on the topmost notehead. Its clock is the press that passed the step (`performance.now()` at the pass): a layout effect that draws it a few milliseconds later starts it a few milliseconds smaller, and one `requestAnimationFrame` loop, like the key levels', runs while a halo is live. When the gap is up the halo is gone and the red note waits, as in issue 182.

The halo goes, at once and in the same commit, when:

- the cued step passes (a press before the halo closes: the next step's halo, if any, starts);
- any move the walk did not make: a seek, Rewind, Home, a loop or hands change, a new score, Play, Practice mode off, the piano gone, the setting off;
- the walk goes inactive for any reason.

No halo is drawn when the cued note is not in the DOM at the pass (a page the window has not rendered yet, `render/pageWindow.ts`); the cue scrolls and the note is red when its page comes, and that is all. Under `prefers-reduced-motion` the halo does not shrink: it steps once per felt beat of the gap (a half note: two steps), the rule the key levels follow, and vanishes when the gap is up. A change of the Practice tempo while a halo is live leaves it as it is; the next pass uses the new tempo, like the other hand.

### The other hand

As issue 184: on every settle with `passed > 0`, digitus plays the other hand's notes from `result.last` up to the next step in walk order (`stepAfter`; after the piece's last step, the tail to the performance's end; after a loop's last step, to `loop.to`), at the Practice tempo, counted from now, the moment of the pass, at offset 0. Then it waits. A press before digitus has started some notes of the stretch drops those notes (a sounding note rings its length). Every move the walk did not make stops it, as today, and so does going inactive.

The deferred hand-over of issue 185 goes whole: a step pressed before the red reached it cannot happen, because the red moves at the press. The one case left, a press under a seek's hop or the flight home (the app's own moves, `flightShown`), is kept as today and passes when the hop lands, in the align's `decide(null)`, handed over from that moment at offset 0. A change of the Practice tempo during a stretch leaves that stretch as it is; the next pass plays at the new tempo.

The halo and the hand count from the same pass at the same tempo, so what the eye sees close and what the ear hears agree: the hand's note at the next step sounds when the reader presses it.

### The key fill

The levels of issue 185 stay as they are: a held key fills over its own note's length (`times[i].lengthSec`) at the Practice tempo, a key let go early drains, and the correcting outline of issue 200 comes with that pull request. Nothing waits on them. They are the keyboard's business, and the one place that shows how long a note is held in polyphony.

### The status line

"Play the red notes on your piano." stays until the first pass, as today. The "Hold the red note a little longer." line (`holdLonger`, the `hold` hint kind) goes in all five languages; `AlongHint` keeps only what the play hint needs. The timing explanation of issue 192 is untouched, and the status line's order is now: busy, nothing playable, loading the piano, a count-in beat, the sound sentence, the timing explanation, the play hint.

### The timing judge

`useWalkTiming` keeps receiving the walk's taps at every settle that passes steps (`onTiming`, `passedRuns` with each step's own press); the `early` field of `WalkTimingEvent` and the chain bump that read it go, since a release no longer stops the walk. The judge's own rules are not touched; the comment in `walkTiming.ts` that justifies skipping a gap longer than the note ("a gap the red does not wait out") is reworded to what is still true: a beginner presses when the note ends, so a rest after it is neither judged nor counted in the tempo.

### The finish

The piece's last step passes at its press: the finish runs as in issue 182 (`Playback.finish`, the red flies home, the finish's notes rise) and the other hand plays the tail. The last step has no next step and no halo.

### Loops

Inside a loop, the loop's last step cues the loop's first; its halo, when the time to the loop's end is longer than a beat, runs over that time; the other hand plays to the loop's end. Rewind and Home idle on the loop's first step as today (issue 196).

### Edges

- **Several steps passed at once** (a chain): the halo belongs to the cued step and its gap is counted from the last passed step.
- **A press under a seek's hop or the flight home:** kept, as today; the step passes at the landing, found by the align (`decide(null)`), with its halo and its hand-over from that moment. The align stays idempotent under StrictMode: its second look finds the keys spent and passes nothing, draws nothing, hands nothing over.
- **Both hands played by the reader:** there is no other hand; the halo is the only timing cue, and only on gaps longer than a beat.
- **A hidden tab:** nothing in the walk depends on a timer any more; a press in a hidden tab passes its step; the halo's frame loop resumes at the right radius, or finds the gap up and removes it.
- **Playwright hooks:** `__digitus2Along.hold()` becomes `halo()`: the live halo's whole length in real ms for the cued step, 0 when there is none; `target()` and `index()` stay. The halo element carries a stable class for the e2e to read its radius.

## What goes

- The hold gate: `settle`, `HOLD_SLACK_MS`, `wakeAtMs`, `run`, `releasing`, `early`, the wake-up timer (`timerRef` and its cleanups), and `factor` in the align effect's dependencies (it only moved the wake-up).
- The deferred hand-over: `LATE_MS`, `handedRef` with `doneSec`, the `result.run` branch, the `elapsedSec` and `heardSec` parameters of `accompanimentStretches`, `Stretch.heard` and the negative-offset path of `accompanimentNotes` (the `Math.max(0, …)` clamp stays for graces), and their tests.
- The `early` state, `markEarly`, the `hold` hint kind, `holdLonger` in five `score.ts` files and the `hold` branch of `scoreStatusLine`.
- The `early` field of `WalkTimingEvent` and the chain bump in `useWalkTiming` that read it.
- In `docs/app.md`: the walk's "A step held, its time not up" and "A step let go too early" rows and the other-hand table's "The step let go too early" row; "held for its time" becomes "played".

## Verification

- Pure tests first: `advance` with presses passes at the press, chains, wrong keys, the loop wrap and the finish, and fills `passedRuns`; the halo's gap and `shown` rule (a quarter in 4/4 none; a half, a dotted quarter, a 3/4 dotted half, a 6/8 dotted quarter against its dotted beat, a quarter followed by a quarter rest, the loop's last step with `loop.to`, the piece's last step none, the `HALO_MIN_MS` floor at a fast tempo); `holdSec` unchanged; `accompanimentStretches` without the deferred parameters.
- `usePlayAlong` tests: the red moves at the press and no timer is ever set; a chain; the hand-over on every pass from `result.last` at offset 0 and exactly once; a press under a hop passes at the landing with one hand-over; a tempo change hands nothing over again; the taps to the timing without `early`; going inactive and every external move stop the hand and clear the halo.
- Halo tests (jsdom): the ring is a child of the cued `g.note` with `fill: none`; its radius at 0, half and the end of the gap; removal at the pass, at an external move and when the gap is up; the beat steps under reduced motion; none when the note is not in the DOM.
- `useWalkTiming` tests: the `early` cases removed; the rest unchanged.
- Existing tests built on the hold are rewritten or deleted in the same change: in `apps/web/e2e/play-along.spec.ts` the `HOLD_MANY` and short-hold cases, the level tests that wait for the hold hint, `staysAt` and every wait on `hold()` (now `halo()`); in `play-along-timing.spec.ts` the tap that asks for a longer hold; in `helpers/midi.ts` `AlongHook.hold`, `playRedTimed`'s `ms`, and the `tempo` comment; in `helpers/states.ts` the `score-along*` states' texts; the `hold(ms)` timer harness in `usePlayAlong.test.tsx` and `usePlayAlong.accompany.test.tsx`; the timed `settle` cases in `playAlong.test.ts`; the `scoreStatusLine` hold-hint cases and the i18n parity for `holdLonger`.
- e2e with the fake piano, on Twinkle (quarters and halves at quarter = 100): an in-page `requestAnimationFrame` recorder (as `playback.spec.ts` does, with the red-root definition of `helpers/red.ts`) asserts exactly one red root on every frame from a press through the halo's life, a press before the halo closes, and the last step's pass into the finish; the halo appears on the half notes and not on the quarters; its radius shrinks between two reads; it is gone after its length; it is gone at once on a seek and when Practice mode goes off; the other hand's notes are scheduled from the press at the Practice tempo and the next press drops the unstarted ones; `emulateMedia({ reducedMotion: 'reduce' })` gives beat steps; 360 px; light and dark; axe mid-halo. The timing spec of issue 192 still passes with presses as onsets.
- `docs/app.md`, site by site: the Motion intro (the playing cursor never animates; the halo's length is the music's, like the key level, and under reduced motion it steps); the Motion row "The red waiting for the reader's piano" (a class swap per step as in issue 182, and the halo); The red element rule (the "Score, a piano waiting" row: the cued notes, with the halo as part of them); Playing along on a piano, its state tables, The other hand and Timing in the walk; the Testing section's play-along paragraphs (`playRed`, `walkRhythm`, `halo()`); Known limitations (no halo on a page not yet rendered); and `docs/PROGRESS.md`.
- `pnpm verify` green before the pull request.

## Left to the builder

- `HALO_FROM`, `HALO_TO` and the stroke width, within "thin, from about two and a half staff spaces to just outside the marked notehead".
- Whether the halo hook lives inside `usePlayAlong` or beside it; the pure part (gap, `shown`, radius at a time) is a module of its own with tests.
- The name of the halo's class and how `ScoreView` passes the halo its host.
- How `AlongHint` is simplified once `hold` is gone.

## For the owner, after it lands

- Does the partner feel back on the GO:PIANO over Bluetooth, at 60 %, 80 % and 100 %, with one hand and with both?
- Does the halo read as "the next note is coming" without a word of explanation, and is it calm enough? It is one module and one CSS rule, removed in minutes if not.
- Do the gray rings of issue 192 and the key fill of issue 185 still earn their place now that the halo carries the timing at the note?
- The latency sessions of `docs/research/play-along-timing.md`.
