# Play along: the red moves on at the press and travels to the next note

Design for [issue 204](https://github.com/MarchalMaxim/digitus2/issues/204). It changes the waiting walk of issues 182, 184 and 185 (`docs/app.md`, Playing along on a piano) and nothing outside it.

## Intent

A beginner with a digital piano plays a piece with digitus: the red marks the next notes, waits for them, and with one hand left out digitus plays the other. The first version of this (issues 182 and 184) felt like a partner playing along. The hold rule of issue 185 broke that feeling, and the owner has said why: the acknowledgment at the press was gone, digitus's hand felt late, the pace felt imposed, and the timing cue (a key filling on the keyboard drawing) was a second place to look while the eyes were on the notes.

This design restores what the first version had and keeps what issue 185 asked for, which is that the reader sees how long to hold. It does so in the one place the eyes already are, the red on the score, and never as something the walk waits on.

## The principle

One place for the eyes, the ears for timing, acknowledgment at the press.

- The red says: heard, and this is next. It moves the moment the step is played.
- The red's travel says: this is how long. It takes the note's written time to reach the next note.
- Digitus's hand says: here is the pulse. It plays the other hand from the press at the Practice tempo.
- The reader leads. Everything counts from the reader's press; nothing predicts the reader, and nothing holds the red back for a hold.

## Goals

- The red acknowledges every press at once, as in issue 182.
- The written length of a note, and of a rest after it, is visible in the red's own motion on the score.
- Digitus's other hand is heard as following the reader, never as lagging behind a hold.
- The Practice tempo sets the pace of the travel and of the other hand, and nothing else of the walk.
- The change removes more than it adds: a gate, a timer, a status line, a constant.

## Non-goals

- Measuring and cutting the latency chain (Bluetooth, main thread, audio output). `docs/research/play-along-timing.md` holds the method; the owner's sessions do it.
- The timing judge and its rings in the walk (issue 192). They stay as they are; their onsets become the presses, which is what they compare.
- A count-in, a click, or a metronome in the walk.
- Any change to Play, to the cursor during Play, or to the ordinary view.

## Anti-goals

- A second red on any frame, ever.
- A new control, mark or line on the screen.
- A meter the reader must watch to decide when to release.
- Any prediction of the reader's tempo, or any pace derived from an average of their playing. The hand follows; it never guesses.
- A sound for the reader's own notes.
- A disclaimer anywhere.

## Constraints

The house rules bind: black, white and grays with exactly one red element on screen at a time (`docs/app.md`, The red element rule); the motion table and `prefers-reduced-motion`; minimalism; light and dark; 360 px; axe clean. Engine logic is written test first (vitest); e2e uses the fake piano (`apps/web/e2e/helpers/midi.ts`). `pnpm verify --changed` is the loop and one full `pnpm verify` precedes the pull request. The work goes on a branch; the owner merges.

## The behaviour

### The pass

A step passes the moment every pitch of it is held and fresh, the rule of issue 182 (`advance` in `score/playAlong.ts`). A chain of steps whose keys are already held and fresh passes in one settle, as today. A wrong key moves nothing. The hold of issue 185 (`holdSec`) gates nothing any more: no wake-up timer, no four-fifths rule, no `early` state, no "hold longer" line.

### The travel

At the pass, the red leaves the passed step and travels to the next step in walk order, at an even pace, and lands on it. The travel takes the written gap between the two steps at the Practice tempo:

    travelSec = (steps[next].perfSec - steps[last].perfSec) / factor

where `last` is the last step passed in this settle and `next` is `stepAfter(last)`; for the last step of a loop the gap is `loop.to - steps[last].perfSec`. A rest after the note is inside the gap, so the travel shows the rest's length too. The piece's last step has no next step and no travel: the finish runs (below).

The travel is a plan of the red's existing flight (`score/RedFlight.tsx`): the same red shape on the same fixed layer, from the topmost notehead of the passed step (the notes the cue marks now, `.is-red .notehead`) to the topmost notehead of the next step in the hands played. The path is straight or nearly so; the pace along the staff is even (a linear easing on the travel's main axis), because the position of the red at any moment says where the beat is. The shape stays a notehead. The cue (`Playback.cueAt`) is set at the pass as today, so the page turns and the next step's keys show their fingers at once; while the red travels, the cued notes are drawn in ink (the `is-hopping` rule in `base.css`, or a sibling of it), and when it lands they turn red. On every frame exactly one element is red: the travelling shape or the cued notes.

The red jumps instead, as it did in issue 182, when:

- the travel would be shorter than `MIN_FLIGHT_MS` (100 ms);
- either end is not on screen, or the cue scrolls the page (`cursorWouldScroll`), as for a seek's hop;
- the reader prefers reduced motion;
- `element.animate` is missing.

A jump means: no shape, the cued notes red at once.

### A press during the travel

The reader is ahead of the red. The walk acts at once: the travel ends, the pressed step passes, and the next travel starts from the pressed step's notehead. The red is seen to snap to the pressed step and set off again. So the walk is never blocked by its own travel; it waits only for the app's own moves, a seek's hop and the flight home, as it does today (`flightShown`).

### The other hand

As issue 184: at the pass, digitus plays the other hand's notes from the last passed step up to the next step in walk order, at the Practice tempo, counted from the press that completed the step (`runSince`), then waits. After the piece's last step it plays the tail; after a loop's last step, to the loop's end. A press before digitus has started some notes of the stretch drops those notes (a sounding note rings its length). Every move the walk did not make stops it, as today.

The deferred hand-over of issue 185 (a step pressed before the red reached it, handed over when the red arrives, with `elapsedSec`, `heardSec` and `LATE_MS`) goes: a press is always now, because the red moves at the press. The one case left, a press under a seek's hop or the flight home, is kept and handed over when the hop lands, counted from the landing. A change of the Practice tempo during a stretch leaves that stretch as it is; the next press plays at the new tempo.

The travel and the hand count from the same press at the same tempo, so what the eye follows and what the ear hears agree: the hand's note at the next step sounds when the reader presses it, where the red is waiting or has just snapped.

### The key fill

The levels of issue 185 stay as they are: a held key fills over its note's length at the Practice tempo, a key let go early drains (and keeps the outline of issue 200 once that lands). Nothing waits on them. They are the keyboard's own business.

### The status line

"Play the red notes on your piano." stays until the first pass, as today. The "Hold the red note a little longer." line (`holdLonger`, the `hold` hint kind) goes in all five languages. The timing explanation of issue 192 is untouched.

### The timing judge

`useWalkTiming` keeps receiving the walk's taps at every settle that passes steps (`onTiming`), with `early` always false. Its onsets are the presses. `holdSec` stays exported for its hook and for the key fill. Nothing else of it changes in this work.

### The finish

The piece's last step passes at its press: the finish runs as today (`Playback.finish`, the red flies home, the finish's notes rise), and the other hand plays the tail.

### Loops

Inside a loop, the travel from the loop's last step goes to its first step, over the time to the loop's end, and the other hand plays to the loop's end. Rewind and Home idle on the loop's first step as today (issue 196).

### Edges

- **Several steps passed at once** (a chain): the travel goes from the last of them.
- **Chords and both staves:** the topmost notehead of the step, as the hop does.
- **Both hands played by the reader:** there is no other hand; the travel is the only pulse.
- **A hidden tab:** nothing in the walk depends on a timer any more; a press in a hidden tab passes its step; the travel may finish late or at once when the tab returns.
- **StrictMode and the align:** the align effect (`decide(null)`) stays idempotent and never plans a travel; only a pass does.
- **Playwright hooks:** `__digitus2Along.hold()` becomes the travel's length in real ms of the step the red waits on toward the next one (name it `travel()`), 0 when there is none; `target()` and `index()` stay.

## What goes

- The hold gate: the timed rule of `settle` as a gate (`HOLD_TOLERANCE`, `HOLD_SLACK_MS`, `wakeAtMs`, the wake-up timer, the `run` concept for the hand-over).
- `LATE_MS`, `elapsedSec`, `heardSec` and `doneSec` in the hand-over.
- The `early` state, the `hold` hint kind and `holdLonger` in five languages.
- The motion table row for the red waiting for the reader's piano is rewritten; the red element rule gains the travel.

## Verification

- Pure tests first: the travel's length (plain gap, a rest after the note, the loop's last step, the piece's last step, the tempo factor); the pass at the press with chains and wrong keys; `holdSec` unchanged.
- `RedFlight` unit tests: the travel's frames (even pace), its end on a new plan, the jump cases.
- `usePlayAlong` tests: the red moves at the press; a press during the travel passes at once; no timer is set; the hand-over at the pass from the press; a hop keeps a press and hands it over at the landing; the taps to the timing.
- e2e with the fake piano, on Twinkle: the red moves at the press; one red while it travels (a screenshot mid-travel), on landing, and when a press ends the travel; the other hand's notes scheduled from the press at the Practice tempo and dropped by an early next press; reduced motion jumps; 360 px; light and dark; axe. The timing spec of issue 192 still passes with presses as onsets.
- `docs/app.md` (Playing along on a piano, The other hand, Motion, The red element rule, Known limitations), `docs/PROGRESS.md`.
- `pnpm verify` green before the pull request.

## Left to the builder

- The exact easing pair and path of the travel, within "even pace along the staff, one shape, no second red".
- Whether the walk's travel reuses the `is-hopping` class or gets its own.
- How `usePlayAlong` asks the flight for a travel (a callback through `ScoreView`, like `hop`), and how it learns that the flight on screen is its own.
- The fate of `settle`: kept with the hold as information only, or reduced to `advance`; the tests decide.
- Whether a press under a hop is handed over from the landing exactly or from its own press with no dropping; both satisfy the behaviour above.

## For the owner, after it lands

- Does the partner feel back on the GO:PIANO over Bluetooth, at 60 %, 80 % and 100 %?
- Do the rings of issue 192 earn their place now that the travel and the hand carry the timing?
- The latency sessions of `docs/research/play-along-timing.md`.
