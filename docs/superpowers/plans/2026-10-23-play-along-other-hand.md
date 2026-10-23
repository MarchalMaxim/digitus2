# Digitus plays the other hand (issue 184), and the piano line while Windows looks for the piano (issue 182): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan track by track. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers do not run git; the controller commits each track with explicit paths.

**Goal.**

1. **Issue 184.** With a piano connected, the Practice panel's Hands control also chooses which hand digitus plays:
   - `Right hand`: the reader plays the right hand on their piano, and digitus plays the left.
   - `Left hand`: the mirror.
   - `Both hands`: digitus plays nothing.

   Digitus plays the other hand in rhythm between the reader's steps, counted from each press, and then waits for the reader. Play (the transport) is unchanged. No control is added.

2. **Issue 182's open finding.** On Windows with Chrome's WinRT MIDI backend, `requestMIDIAccess` can stay pending for 20 s or more while a Bluetooth piano is off. The home line then says something useful instead of `Allow the browser to use your piano.`, and a later visit's silent resume does not leave the line stale.

**Issues.**

- [issue 184](https://github.com/MarchalMaxim/digitus2/issues/184): its agreed approach is binding. Commit messages for this work end with `(issue 184)`.
- [issue 182](https://github.com/MarchalMaxim/digitus2/issues/182): commit messages for the piano line end with `(issue 182)`.

**Read first:**

- `CLAUDE.md`
- `docs/superpowers/plans/2026-10-23-play-along.md`, including "Where the build departs"
- `docs/app.md`, the sections Audio, MIDI input, Library (Play along), Playing along on a piano, The dock and Practice (Status line, Hands), Testing, Known limitations
- `docs/verification-loop.md`

**Architecture:**

- **`audio/events.ts`** is new and static. It holds the transport's note list, `buildEvents`, moved out of `transport.ts` unchanged: graces, rolls, ornaments, pedal and `noteVelocity`. The accompaniment sounds a note exactly as Play does, and `transport.ts` imports the list from here. Everything it needs is already static (`@digitus2/engine/ornaments`, `performance.ts`, `instrument.ts`), so the lazy transport chunk is not pulled into the entry chunk.
- **`score/accompaniment.ts`** is new and pure. From the steps, the step the reader passed last and the walk's move, it gives the stretches of the performance digitus plays. It then gives the other hand's notes in those stretches, as offsets in performance seconds after the press.
- **`audio/accompanist.ts`** is new and static. It is a just-in-time scheduler with a 150 ms look-ahead and a 25 ms tick, like `transport.ts`. Notes enter the instrument only when they are due. Every note handed to the instrument keeps its own stop, so a note that has not started can be cancelled without touching a note that sounds.
- **`audio/instrument.ts`.**
  - `start` returns that note's own stop, and each start gets a unique smplr `stopId`.
  - The silent instrument records what was cancelled.
- **`score/usePlayback.ts`** gets five `Playback` members:
  - `prepare` and `preparing`: the samples load with no gesture, without `loading`;
  - `soundWaits`: the browser holds the AudioContext until a click;
  - `accompany` and `stopAccompaniment`: an `Accompanist` over the opened audio.
- **`score/playAlong.ts`.** `advance` also returns `last`, the index of the last step it passed.
- **`score/usePlayAlong.ts`** (the walk):
  - it calls `accompany` after each pass;
  - it calls `stopAccompaniment` on every move it did not make itself and when it goes inactive;
  - it asks for `prepare` while it is active with a hand left out.
- **`midi/piano.ts` and `library/PianoLine.tsx`** get a new status, `searching`.
- **Not touched:**
  - `useCursor.ts`, `RedFlight.tsx`, `EndBurst.tsx`, `BarSeek.tsx`, `Keyboard.tsx`, `PianoKeyboard.tsx`
  - `audio/performance.ts`, `carry.ts`, `App.tsx`, `main.tsx`, `tokens.css`, `scripts/check-colors.mjs`
  - `midi/access.ts`, `midi/parse.ts`

**Tech stack:** as the repository today. There is no new dependency and no lockfile change. smplr is 1.1.0 (`node_modules/.pnpm/smplr@1.1.0`).

## Global Constraints

| What               | Value                                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who plays what     | The hands digitus plays are `mutedHandsFor(handsFor(score, hands))`: the hand the walk leaves out. `Both hands` and a one-hand piece play nothing.                                                                                                                  |
| The reader's notes | Never sounded. Nothing calls `strike` from MIDI input, and `__digitus2Keys.strikes()` stays empty. An other-hand note that has the pitch and onset of a note of the reader's hand is left out (ruling 7).                                                           |
| Library budget     | The library page's initial JS and CSS stay under 150 KB gzip. `events.ts`, `accompaniment.ts` and `accompanist.ts` are static and small, and they import nothing from `transport.ts`. The bundle step re-measures, and `docs/app.md` Performance budget records it. |
| Colours            | No new token, and no colour literal anywhere.                                                                                                                                                                                                                       |
| Comments           | Never `#` followed by digits: write `issue 184`.                                                                                                                                                                                                                    |
| Strings            | Every new string in en, es, fr, nl and pt. No disclaimer wording. `noDisclaimers.test.ts` already covers `library.ts` and `score.ts`.                                                                                                                               |
| UI                 | Exactly one red at every moment. The status line and the piano line are never red. The score view gets no new control.                                                                                                                                              |

Rules:

- **No git.** Each track ends by listing its paths, and the controller commits them.
- **Tests first** for pure logic: `events.ts` (moved, guarded by the existing transport tests), `accompaniment.ts`, `accompanist.ts` and `advance`'s `last`. Write the failing vitest test, run it and see it fail, then implement.
- **Iterating.** Run only the touched tests: `pnpm --filter @digitus2/web exec vitest run <paths relative to apps/web>`. A 5 s timeout under load is noise only if a rerun passes.
- **Before handing back.** Run `pnpm exec prettier --write <files>` and `pnpm exec eslint <files>`.
- **Docs.** Present tense, with no dates, branch names or agent credits.
- **Windows.** Use the Write tool for long files, forward slashes in Bash, and run long commands in the background.
- **Playwright.**
  1. Build first: `pnpm --filter @digitus2/web build`.
  2. Check that the port is free: `netstat -ano | grep LISTEN | grep :<port>`. 4173 is the controller's; use 4591, 4593 or 4597.
  3. From `apps/web`, run `DIGITUS2_E2E_PORT=<port> pnpm exec playwright test <spec> --project=desktop --reporter=line`.

## Rulings (fixed; do not re-open)

These are settled against the code. A builder who finds one wrong stops and reports; they do not simplify it away.

### 1. Cancelling: a just-in-time queue, plus each handed note's own stop

The instrument has only `start`, `strike` and `stopAll`, and `start` returns nothing. smplr 1.1.0 rules out both simple answers:

- **smplr's StopFn stops by `stopId`, and `stopId` defaults to the pitch.** `SmplrImpl.start` returns `(time) => { schedulerStop(); voices.stopById(normalized.stopId, time) }`. Cancelling a pending E2 would therefore also cut an E2 that is ringing, and an accompaniment repeats bass pitches all the time. The issue says ringing notes ring.
- **`stopAll` does not clear smplr's own queue.** smplr queues in JavaScript every note more than 200 ms ahead (`SchedulerImpl`, `LOOKAHEAD_MS_DEFAULT = 200`). `piano.stop()`, which is our `stopAll`, stops voices but not that queue. A whole interval handed over at the press would survive a `stopAll`, and it would also cut the transport's notes and a struck key.
- **`stopAll` also stops what is not ours.** It would cut the first notes of a Play pressed during the accompaniment.

So:

- **`Accompanist` keeps its own queue.** A note is handed to the instrument only when it is due within the look-ahead: 150 ms ahead, on a 25 ms tick, the transport's numbers. 150 ms is under smplr's 200 ms, so nothing of ours ever enters smplr's queue. Dropping a note that has not been handed over is removing it from our queue.
- **Each handed note keeps its own stop.** `Instrument.start` returns the note's own stop. `createPiano` gives every `start`, the transport's too, a unique `stopId` (`` `n${++seq}` ``), so that stop touches that voice alone.
  - Called before the note's time, smplr's `SampleVoice.stop` sees `t <= startAt` and calls `source.stop(t)`: the note never sounds.
  - Called after, it applies the release.
- **An early arrival** clears the queue and calls the stop of every handed note whose `time` is still after `ctx.currentTime`. Notes that have started ring for their length.
- **An external move** (`stop()`) clears the queue, cancels what has not started and releases what sounds, with smplr's release envelope. It never calls `stopAll`.
- **Why not a cancellable start alone**, with every note of the interval handed over at the press? It would work in smplr with unique `stopId`s. But a tempo change could not reach the queued notes, and the silent instrument and the e2e would need smplr's queue semantics to tell "dropped" from "played".

### 2. When digitus plays: between the reader's steps

The rule is the issue's: digitus plays from a step the reader played to the next step of the walk, and then waits. It applies the same way everywhere.

- **The stretch.** When a pass ends with `last` (the last step passed) and the move:

  | Move                                                                 | Stretches, in performance seconds, with `offset` (where the stretch starts after the press)                     |
  | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
  | `cue j`, no wrap                                                     | `[steps[last].perfSec, steps[j].perfSec)`, offset 0                                                             |
  | `cue j`, a loop wrap (`last` is the loop's last step, `j` its first) | `[steps[last].perfSec, loop.to)`, offset 0, then digitus waits (the issue: "plays to the loop's end and waits") |
  | `finish`                                                             | `[steps[last].perfSec, scoreEndSec(perf.score))`, offset 0: the piece's tail                                    |
  | `stay`                                                               | none                                                                                                            |

- **A chain counts from its last step.** Several steps passed in one decision play only from `last`. Notes left unstarted from the interval before are dropped (ruling 1).
- **Before the first step: not played.** This covers the other hand's notes between where the walk starts waiting and the step it waits on, when no step was played before:
  - the opening: a pickup, or an introduction in the other hand;
  - after any external move: a seek, Rewind, a loop or hands change, Play then Pause, the piano connecting;
  - a loop's opening, on every lap: the wrap stretch ends at `loop.to`.

  There is no press to count them from, and the reader leads. A piece whose other hand begins alone starts silent at the reader's first note; Play plays the introduction. Whether a loop's wrap should go on through the loop's opening, up to its first step, is a question the controller puts to the owner on issue 184. It is not built here.

- **The end.** After the piece's last step, the tail plays while the burst rises and the red flies home. The finish and the re-cue of step 0 are the walk's own moves, so they do not stop the tail. A press of step 0 during the tail is an early arrival.
- **The loop.** It plays to the loop's end, then waits.

### 3. Which notes: `onset` decides the stretch, `sec` decides the offset

- **The notes** are the events of `playEventsFor(perf.score)` (ruling 6) whose hand is one digitus plays, with `stretch.from - EPS <= e.onset < stretch.to - EPS`.
- **Offset** is `stretch.offset + (e.sec - stretch.from)`, clamped at 0. A grace's `sec` lies before its principal's onset, and a rolled note's after it. A grace whose principal opens a stretch therefore sounds with its principal at the press.
- **Duration** is `e.duration`. Inside a loop it is clipped at `loop.to - e.sec`, as in the transport. Otherwise the stretch's end never shortens a note: a note rings its length, pedal included, as in Play.
- **Tempo.** The offsets and durations are performance seconds. `Accompanist.play` divides them by the Practice tempo factor read at the press (`tempoFactorOf(useAppStore.getState())`). A tempo change applies from the next press.

### 4. Velocity: as Play

Each note plays at `noteVelocity(note)`, the score's own velocity, through the `PIANO_SOFTEST` floor. Ornaments are realised as the transport realises them: the shared event list makes this free. The reader's key velocity does not change the other hand.

### 5. Samples: `prepare`, not `loading`

`active` requires `!loading`. A preload that set `loading` would turn the walk off, spend its keys and cut its own trigger. So:

- **`prepare()`** opens the audio (`openAudio`, with no gesture; see ruling 8) and, when the loaded samples do not cover the score, loads them under a state of its own, **`preparing`**. `loading` is untouched.
  - It uses `loadSeqRef` like Play, so a Play or a struck key started meanwhile wins.
  - `preparing` is cleared when its load settles, whoever won.
  - It runs once per score: a second call while covered, or while its own load runs, does nothing.
- **The status line** says `Loading the piano…` while `loading || preparing`. The walk stays active meanwhile. Presses move the red, and `accompany` is a no-op until the samples cover the score.
- **A failed load** leaves the walk working, without sound. It shows the existing `SAMPLES_FAILED_NOTICE` once, and `prepare` is not tried again for that score. A later Play loads again as today, and once its samples arrive the accompaniment sounds.
- **The trigger.** `usePlayAlong` calls `prepare()` in an effect while `active && accompanying` (one hand left out).

### 6. The shared event list

`buildEvents` and `PlayEvent` move verbatim from `transport.ts` to `audio/events.ts` as `playEvents(score)`, together with the constants `GRACE_LEAD_SEC`, `GRACE_DURATION_SEC` and `MIN_DURATION_SEC`. A `WeakMap` cache `playEventsFor(score)` sits beside them.

- `transport.ts` imports `playEvents` and the `PlayEvent` type. Behaviour is unchanged, and the whole `transport.test.ts` passes untouched.
- The accompaniment reads `playEventsFor(performanceFor(score).score)`.

### 7. Unisons

An other-hand event whose `midi` and `onset` (within 1e-9 s) equal those of an event of a hand the reader plays is left out. That pitch comes from the reader's piano at that moment. With this rule, "only the other hand's notes" is exact in the e2e.

### 8. Autoplay: the walk works, and sound asks for one click

- **A MIDI message is not a user activation.** HTML's activation-triggering events are `keydown` (not Escape), `mousedown`, `pointerdown` from a mouse, `pointerup` from touch or pen, and `touchend`. Chrome's autoplay policy (`document-user-activation-required`) lets an AudioContext run only after one of them in this document, or after sticky activation.
- **After an in-app navigation** (a click on a piece in the library), the document has sticky activation. The context that `prepare()` makes in an effect runs.
- **A fresh load straight onto a score URL** has none. `new AudioContext()` is allowed but stays `suspended`, and `resume()` without a gesture stays pending. It is never awaited.
- **Meanwhile:**
  - The walk works fully; the red moves on every pass.
  - `accompany` is a no-op while `ctx.state !== 'running'`, so nothing piles up to sound at once later.
  - The samples load: `decodeAudioData` works on a suspended context.
- **The resume listener.** Whenever the context exists and is `suspended`, for any reason, `usePlayback` listens on `document`, in the capture phase, for `pointerdown`, `pointerup` and `keydown`, and calls `ctx.resume()` from the handler. `ctx.onstatechange` follows the state. The listeners go when the state turns `running`, and on unmount.
- **`soundWaits`**, which only drives the sentence, is true while the context is `suspended` and `navigator.userActivation?.hasBeenActive` is not true. The second condition keeps the sentence from flashing during the instant a permitted context takes to start. A browser without `userActivation` counts as not active.
- **The status line** says one sentence while the walk is active, digitus has a hand to play, and `soundWaits`:
  - `Click the page once to hear the other hand.`
  - On a touch screen (`TOUCH_QUERY`, as for `seekHelpTouch`): `Tap the page once to hear the other hand.`

  It ranks under the count-in and above the hint. The click may land anywhere: a click on a bar also seeks, which is an ordinary external move. Pressing a key on the computer works too, but the sentence does not say so: Space is Play.

- **Verification.** The e2e suite passes `--autoplay-policy=no-user-gesture-required` to every project, so no ordinary spec ever sees a suspended context. That case gets its own spec, `play-along-sound.spec.ts` (section 3.3), with worker-scoped launch arguments. The authoritative check is the controller's real Chrome with real audio (section 3.4).

### 9. What stops the accompaniment

`stopAccompaniment()` (ruling 1's `stop`) is called:

- by `usePlayAlong`:
  - in `decide` when `moved` is true and `atRef` was not null before (a real external move: a seek, the arrow keys, Rewind, a loop change, a hands change, which brings new steps, Play then Pause, a new score);
  - in the `!o.active` branch: playing, loading, the piano disconnected, Turn off, not ready;
  - in its unmount cleanup, when the view is left;
- by `usePlayback`:
  - at the start of `play()`, in the click, before the transport schedules anything;
  - in `halt` (a new score);
  - in `release` (unmount).

It is idempotent. It never calls `stopAll`, so a struck key and the transport's notes are untouched.

### 10. What the tests can read: the accompaniment's own record, and hooks without the silent instrument

- **The silent instrument.** `start` still pushes to `events`, and the stop it returns pushes the event to `cancelled`, once per event.
- **The accompaniment's own record.** `events` also receives every note Play sounds, so the e2e does not read it. When the test hooks are on, `usePlayback` gives the `Accompanist` a recording wrapper around the instrument. The wrapper logs only what the accompaniment hands over and what it cancels, with the silent instrument or the real one.
- **The hooks.** Today `__digitus2Keys` (usePlayback.ts) and `__digitus2Along` (usePlayAlong.ts) exist only with `?audio=silent`. A real-instrument flow (samples loading, the autoplay spec) needs them too. Both are installed when `?audio=silent` **or** `?hooks=1` is in the URL. `?hooks=1` changes nothing else: the real instrument loads and plays. Track A gates `__digitus2Keys`, and Track C gates `__digitus2Along`.
- **The new `__digitus2Keys` members** are `accompanied()`, `accompCancelled()` and `audioState()` (section 2.5).
- **Exact offsets.** The times recorded are `base + offset / factor`, where `base` is `ctx.currentTime` at the press. Differences within one stretch are therefore exact, and e2e asserts offsets to 1 ms.

### 11. The piano line while Windows looks for the piano (issue 182)

- **The new status is `searching`.** Access is granted, but `requestMIDIAccess` has not answered (Chrome's WinRT backend while a Bluetooth piano is off).
  - Sentence (en): `Looking for your piano. Make sure it is turned on.`
  - Button: `Turn off`, enabled and not busy. Turn off works through the existing generation bump, and a late answer is closed unused.
- **The press path** (`connect(true)`): the status goes to `asking` as today, and a watcher starts.
  - After `SEARCHING_AFTER_MS = 2000`, and then every 1000 ms while the same request is pending and live, it runs `midiPermission()`. When that answers `granted`, the status goes to `searching`.
  - With the prompt open, the query says `prompt`, so the line keeps asking.
  - When the reader allows, the query turns `granted`. If the request then hangs, the line moves on to `searching`.
- **The silent resume** (`connect(false)`) only runs when the permission is `granted`. The same watcher moves `off` to `searching` after 2000 ms.
- **A press while a request is pending** (`if (pending)`): when the status is `off` (a silent resume is pending, so the permission is granted), the status goes to `searching` at once, then the shared promise is returned. Today it returns before anything changes, and the line stays stale.
- **The timer** is cleared on settle, on Turn off and in `resetPianoForTests`. A watcher of an old generation does nothing.
- **When the request resolves**, the existing `applyInputs` path applies. The guard after the open treats `searching` as it treats `asking` and `off`.

### Where the build departs from this plan

The build and its reviews found these places where the plan was wrong or silent. The code and `docs/app.md` follow the build. The sections below are kept as they were written, except ruling 7, whose example is dropped, and the string table in section 2.11, which holds the strings as shipped.

- **Section 2.3.** `AccompanistDeps` gained `onDrop`, called for each note dropped from the queue (a new stretch, a stop). With the test hooks on, `usePlayback` uses it to log the note as cancelled.
- **Ruling 10.** `accompCancelled()` holds the notes dropped from the queue before they were handed over, then those cancelled or released after them, not only the stops of handed notes.
- **Section 1.1.** `accompanimentNotes` takes four arguments, as section 2.7 fixes: `(events, hands, stretches, loop)`. The reader's hands are not passed: the events of the hands digitus does not play give the unisons.
- **Ruling 3.** `accompanimentNotes` also leaves out a note that would only sound at or after the loop's end, as the transport never schedules it.
- **Ruling 5.** `prepare` also steps aside while a Play's or a struck key's load is running (`loadsRunningRef`), not only when theirs is newer: a second load would make the instrument drop theirs.
- **Ruling 7.** The example is dropped: Twinkle has no unison between its hands, so the rule is tested only in `accompaniment.test.ts` and `usePlayAlong.accompany.test.tsx`.
- **Ruling 8.**
  - The Accompanist is also stopped when the context leaves `running` (`onstatechange`) and by an `accompany` call while the context is not running. A stretch queued before the audio was held would otherwise sound out of step when it came back.
  - `soundWaits` is false once `prepare` could not load the samples for the open score: the click would sound nothing, and the status line falls back to the hint.
- **Section 3.3.**
  - The time differences of cases 1 and 2 (a stretch at 100 %, then at 50 %) run with Left hand chosen. With Right hand chosen every left-hand note falls on a step of the right hand, so a stretch holds at most one note and has no differences to compare. Case 1 itself keeps the Right hand and checks the notes and their durations.
  - `play-along-sound.spec.ts` reads the page through `quietly` (helpers/midi.ts) and records no trace: Playwright's `evaluate`, locators and trace all give the page a user activation, which would spoil a flow about a page that has had none. Case 2 reaches the piece with a real mouse click on the library's red button under `quietly`, and a recorder shows the sentence never flashed.
- **Section 2.11.**
  - French uses the typographic apostrophe, like the rest of `fr`.
  - Dutch writes `aanstaat` as one word.
  - The click and tap sentences of `es`, `fr`, `nl` and `pt` leave out `on the page` (`Haz clic una vez para oír la otra mano.`, `Toca una vez para oír la otra mano.`). The longer ones wrapped to two lines in the dock between 480 px and 520 px and grew it by 3 px; these stay on one line from 480 px, as the English ones do.

## 1. Decisions

### 1.1 The flow of one press, with `Right hand` chosen

1. A note-on arrives. `decide(event)` applies it, and `advance(steps, here, keys, stretch)` passes steps and returns `{ move, passed, last }`.
2. When `passed > 0` and digitus has a hand to play:
   - `stretches = accompanimentStretches(steps, last, move, stretch, scoreEndSec(perf.score))`;
   - `notes = accompanimentNotes(events, accompHands, stretches, stretch, readerHands)`;
   - `playback.accompany(notes)`.
3. `accompany` is a no-op without covered samples or with a context that is not running. Otherwise it calls `accompanist.play(notes, tempoFactor)`:
   - the queue is cleared;
   - handed notes not yet started are cancelled;
   - each new note is queued at `ctx.currentTime + offset / factor`;
   - what falls in the look-ahead is handed over at once, so an offset of 0 sounds now.
4. Then, as today, the `cueAt` or `finish`.

### 1.2 What the reader sees and hears, by state, with a piano connected and one hand left out

| State                                                    | Red                   | Status line                                   | Digitus                                                          |
| -------------------------------------------------------- | --------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| Opened, samples loading                                  | the first step (cue)  | `Loading the piano…`                          | nothing; presses move the red                                    |
| Ready, context running, nothing played yet               | the first step        | `Play the red note on your piano.`            | nothing (ruling 2)                                               |
| Ready, context suspended (a fresh load on the score URL) | the first step        | `Click the page once to hear the other hand.` | nothing until one click or key                                   |
| A step played                                            | the next step         | (none after the first pass)                   | the other hand from that step to the next, at the Practice tempo |
| The next step played early                               | the step after        | unchanged                                     | the unstarted notes dropped; the new stretch from now            |
| The last step played                                     | burst, flight, step 0 | unchanged                                     | the piece's tail                                                 |
| A loop's last step                                       | the loop's first step | unchanged                                     | to the loop's end, then waits                                    |
| A seek, Rewind, a loop or hands change                   | as issue 182          | unchanged                                     | stopped: queue cleared, sounding notes released                  |
| Play                                                     | Play's cursor         | as today                                      | stopped in the click; the transport plays as today               |
| `Both hands`                                             | as issue 182          | as issue 182                                  | nothing, and no `prepare`                                        |
| Sample load failed                                       | the walk works        | the existing notice once                      | nothing                                                          |

There is exactly one red throughout: the accompaniment draws nothing.

### 1.3 Latency (known limitation)

The notes at offset 0, which start with the reader's step, sound at `ctx.currentTime` when the message is handled. The lag the reader hears is therefore:

- the MIDI transport (USB about 1 ms, Bluetooth MIDI 10 to 30 ms);
- the main-thread handling;
- the output latency of the audio device: 40 ms on the spike machine, 150 to 250 ms over Bluetooth audio.

Notes later in the stretch keep their spacing from the press. `docs/app.md` Known limitations says this.

## 2. Interfaces (fixed before the tracks start)

### 2.1 Track 0 (the controller writes this verbatim into `apps/web/src/audio/instrument.ts`, after `NoteEvent`, before the tracks start)

```ts
/**
 * One note of the accompaniment (issue 184): when it sounds after the press that starts its
 * stretch, and for how long, both in performance seconds (the scheduler divides by the tempo).
 */
export interface AccNote {
  offsetSec: number;
  durationSec: number;
  midi: number;
  velocity: number;
  hand: Hand;
}
```

### 2.2 `apps/web/src/audio/instrument.ts` (Track A)

```ts
export interface Instrument {
  load(midis: number[], velocities: number[]): Promise<void>;
  /**
   * Schedules a note; returns its own stop (issue 184): called before `e.time` the note never
   * sounds, called later it is released. Other notes of the same pitch are untouched.
   */
  start(e: NoteEvent): () => void;
  strike(midi: number, velocity: number, maxSec: number): () => void;
  stopAll(): void;
}

// createSilentInstrument() also has:
cancelled: NoteEvent[]; // each event whose stop was called, once
```

In `createPiano.start`, the call is `piano.start({ note, velocity, time, duration, stopId: `n${++seq}` })`, and the stop it returns is `() => stop?.()`. `strike` is unchanged.

### 2.3 `apps/web/src/audio/accompanist.ts` (Track A, static, new)

```ts
import type { AudioClock } from './clock.js';
import type { AccNote, Instrument } from './instrument.js';

export interface AccompanistDeps {
  ctx: AudioClock;
  instrument: Instrument;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}

/**
 * The other hand (issue 184): a just-in-time queue over the instrument. Notes enter the
 * instrument only within `lookAheadSec` of their time (150 ms, under smplr's own 200 ms queue),
 * each keeping its own stop. The timer runs only while the queue holds notes.
 */
export class Accompanist {
  constructor(deps: AccompanistDeps, opts?: { lookAheadSec?: number; tickMs?: number });
  /**
   * A new stretch from now: clears the queue, cancels each handed note whose time is after
   * `ctx.currentTime` (sounding ones ring), queues `notes` at `currentTime + offsetSec / factor`
   * for `durationSec / factor`, and hands over at once what falls within the look-ahead.
   */
  play(notes: readonly AccNote[], tempoFactor: number): void;
  /** Clears the queue, cancels what has not started and releases what sounds. Idempotent. */
  stop(): void;
  /** The tick: hands over the queued notes due within the look-ahead. */
  step(): void;
  /** How many notes wait in the queue (tests). */
  pending(): number;
  /** stop() and the timer gone. */
  dispose(): void;
}
```

A handed note is forgotten once `time + duration` has passed, so the list of stops stays short.

### 2.4 `apps/web/src/audio/events.ts` (Track B, static, new)

```ts
import type { Hand, Score } from '@digitus2/engine';

/** A note ready to schedule: `sec` is when it sounds (graces moved earlier, rolls later). Moved from transport.ts. */
export interface PlayEvent {
  sec: number;
  onset: number;
  duration: number;
  midi: number;
  hand: Hand;
  velocity: number;
  ornamentEnd?: number;
}
/** transport.ts's former buildEvents, unchanged: sorted by `sec`, stable. */
export function playEvents(score: Score): PlayEvent[];
/** playEvents, kept per score (the score is never edited). */
export function playEventsFor(score: Score): PlayEvent[];
```

### 2.5 `apps/web/src/score/usePlayback.ts`: new `Playback` members (Track A)

```ts
/**
 * Issue 184: the samples for the other hand, loaded while the walk is active and before any
 * press, with no gesture: the AudioContext is made (suspended where the browser waits for a
 * click) and the piece's samples load under `preparing`, never `loading`. Once per score; a
 * failure shows SAMPLES_FAILED_NOTICE and is not tried again for that score.
 */
prepare(): void;
/** `prepare` is loading the samples: the status line says Loading the piano…; the walk goes on. */
preparing: boolean;
/**
 * The AudioContext exists and the browser holds it suspended until a click or key on the page
 * (autoplay, no user activation yet). Meanwhile a capture listener resumes it on the first
 * pointerdown, pointerup or keydown.
 */
soundWaits: boolean;
/**
 * Plays the other hand's notes from now (Accompanist.play at the Practice tempo factor). A no-op
 * while the samples do not cover the score or the context is not running.
 */
accompany(notes: readonly AccNote[]): void;
/** Stops the accompaniment (Accompanist.stop). Idempotent; never touches Play's notes or a struck key. */
stopAccompaniment(): void;
```

Internals:

- **The `Accompanist`** is made lazily over `openAudio()`'s context and instrument, and dropped in `release`.
- **`play()`** calls `stopAccompaniment()` first.
- **`halt`** calls `stopAccompaniment()`. The `prepare` failure flag is per score (`WeakSet<Score>`).
- **The hook** is installed under `?audio=silent` or `?hooks=1` (ruling 10). The `Accompanist` then gets a recording wrapper around the instrument, and `__digitus2Keys` gains:

  ```ts
  /** What the accompaniment handed to the instrument, in order (never Play's notes). */
  accompanied(): { midi: number; hand: Hand; time: number; duration: number; velocity: number }[];
  /** What the accompaniment cancelled or released, in order. */
  accompCancelled(): { midi: number; time: number }[];
  audioState(): AudioContextState | 'none';
  ```

### 2.6 `apps/web/src/score/playAlong.ts` (Track B)

`advance`'s result gains a field:

```ts
{
  keys: Keys;
  move: AlongMove;
  passed: number;
  last: number;
} // last: the index of the last step passed, -1 when none
```

### 2.7 `apps/web/src/score/accompaniment.ts` (Track B, pure, new)

```ts
import type { Hand } from '@digitus2/engine';
import type { PlayEvent } from '../audio/events.js';
import type { AccNote } from '../audio/instrument.js';
import type { AlongMove, AlongStep, PerfRange } from './playAlong.js';

/** A stretch of the performance digitus plays, and where it starts after the press. */
export interface Stretch {
  from: number;
  to: number;
  offset: number;
}
/** Ruling 2's table. Empty for `stay` or `last < 0`. */
export function accompanimentStretches(
  steps: readonly AlongStep[],
  last: number,
  move: AlongMove,
  loop: PerfRange | null,
  endSec: number,
): Stretch[];
/**
 * Rulings 3 and 7: the events of `hands` whose onset lies in a stretch, as notes after the press,
 * ascending by offset; unisons with the other hands' events left out; durations clipped at
 * `loop.to` inside a loop.
 */
export function accompanimentNotes(
  events: readonly PlayEvent[],
  hands: readonly Hand[],
  stretches: readonly Stretch[],
  loop: PerfRange | null,
): AccNote[];
```

### 2.8 `apps/web/src/score/usePlayAlong.ts` (Track C)

```ts
export interface PlayAlong {
  active: boolean;
  atFirst: boolean;
  hint: number | null;
  /** Active, digitus plays a hand, and the browser waits for a click to sound it (issue 184). */
  soundWaits: boolean;
}
```

- **The options are unchanged.** The hands digitus plays are `mutedHands`, and the reader's are the others.
- **Events:** `useMemo(() => connected && score && mutedHands.length > 0 ? playEventsFor(performanceFor(score).score) : [], …)`.
- **In `decide`:**
  - `moved && atRef.current !== null` (read before it is overwritten): `pb.stopAccompaniment()`;
  - in `!o.active`: `pb.stopAccompaniment()` when the hook had accompanied since it was last active (a ref, so an idle walk calls nothing);
  - after `advance`, with `passed > 0` and hands to play: `pb.accompany(accompanimentNotes(…accompanimentStretches(…)))`, before the `cueAt` or `finish`.
- **An effect** calls `playback.prepare()` while `active && mutedHands.length > 0`.
- **The unmount cleanup** calls `stopAccompaniment()`.

### 2.9 `apps/web/src/score/ScoreView.tsx` (Track C)

- `StatusInputs` gains `alongSound: 'click' | 'tap' | null`, set from `along.soundWaits` and `useMediaQuery(TOUCH_QUERY)`.
- `loading` is passed as `playback.loading || playback.preparing`.
- The order in `scoreStatusLine` becomes: busy, nothing to play, loading, count-in, **alongSound**, alongHint.

### 2.10 `apps/web/src/midi/types.ts` and `piano.ts` (Track B)

```ts
export type PianoStatus =
  'unsupported' | 'off' | 'asking' | 'searching' | 'connected' | 'none' | 'denied';
```

```ts
// piano.ts
/** How long a granted request may stay pending before the line says it is looking for the piano. */
export const SEARCHING_AFTER_MS = 2000;
```

`PianoLine` treats `searching` like `connected` and `none` for the button (`Turn off`), with the sentence `text.searching`.

### 2.11 i18n (Track B owns all ten files)

`library.ts`, under `piano`:

```ts
searching: 'Looking for your piano. Make sure it is turned on.',
```

`score.ts`, under `view`:

```ts
/** The status line while the browser waits for a click before digitus can sound the other hand (issue 184). */
playAlongSound: {
  click: 'Click the page once to hear the other hand.',
  tap: 'Tap the page once to hear the other hand.',
},
```

| key       | es                                               | fr                                                   | nl                                                  | pt                                                  |
| --------- | ------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| searching | Buscando tu piano. Comprueba que está encendido. | Recherche de votre piano. Vérifiez qu’il est allumé. | Je piano wordt gezocht. Controleer of hij aanstaat. | Procurando seu piano. Verifique se ele está ligado. |
| click     | Haz clic una vez para oír la otra mano.          | Cliquez une fois pour entendre l’autre main.         | Klik één keer om de andere hand te horen.           | Clique uma vez para ouvir a outra mão.              |
| tap       | Toca una vez para oír la otra mano.              | Touchez une fois pour entendre l’autre main.         | Tik één keer om de andere hand te horen.            | Toque uma vez para ouvir a outra mão.               |

## 3. Tests

### 3.1 Vitest (failing test first for the pure modules)

**`audio/events.test.ts`** (new):

- `playEvents` spreads graces 50 ms before the principal;
- it rolls a marked chord;
- it holds a pedalled note to the lift;
- it realises a trill into attacks;
- it gives each note `noteVelocity`;
- `playEventsFor` returns the same array for the same score.

The whole of `audio/transport.test.ts` passes unchanged after the move.

**`score/playAlong.test.ts`:**

- `advance` reports `last`;
- `last` is `span.last` when a loop wraps;
- it is the final step on `finish`;
- it is the end of a chain;
- it is -1 on `stay`.

**`score/accompaniment.test.ts`** (new). Scores are built the way `performance.test.ts` builds them.

`accompanimentStretches`:

- one pass;
- a chain counts from its last step;
- the loop wrap gives one stretch, to `loop.to`, and nothing of the loop's opening;
- `finish` runs to the performance end;
- `stay` and `last < 0` give none.

`accompanimentNotes`:

- only the hands asked;
- by onset, half-open, so a note at the next step's onset belongs to the next stretch;
- offsets from `sec`, with a rolled note late and a grace clamped at 0;
- durations are not cut at the stretch's end, but are clipped at `loop.to` in a loop;
- a unison with the reader's hand is left out;
- a repeat's second hearing gives the notes of that hearing;
- the velocity is each note's `noteVelocity`;
- ornament attacks appear as the transport has them.

**`audio/accompanist.test.ts`** (new). It uses a fake clock, `createSilentInstrument` and manual timers.

- only the notes within 150 ms are handed over at `play`;
- `step` hands over the rest as time advances, each at `base + offset / factor` and lasting `duration / factor`;
- tempo factor 0.5 doubles the offsets;
- a second `play` clears the queue and cancels the handed notes not yet started, while a started note is not cancelled;
- `stop` cancels and releases every handed note still sounding, and a finished one is not touched;
- the timer stops when the queue empties;
- `stop` twice is harmless;
- `stopAll` is never called.

**`audio/instrument.test.ts`:**

- the silent stop records in `cancelled` once;
- `createPiano.start` passes a unique `stopId` per call, and its stop calls that voice's own StopFn (a mocked smplr, as in `transport.test.ts`);
- `strike` still uses no `stopId`.

**`score/usePlayback.accompany.test.ts`** (new). It uses the fakes of `usePlayback.strike.test.ts`.

- `prepare` makes the context and loads once: `preparing` goes true then false, and `loading` stays false;
- a second `prepare` does nothing;
- a Play during `prepare` wins the load;
- a failed `prepare` sets the notice once and is not retried for the score;
- `accompany` before the samples arrive does nothing;
- `accompany` with a suspended context does nothing;
- `accompany` with a running context starts the notes;
- `play()` stops the accompaniment before the transport starts;
- a new score stops it;
- `soundWaits` follows `statechange` and `userActivation.hasBeenActive`;
- the capture listener is there whenever the context is suspended, also with `hasBeenActive` true; it calls `resume()` on `pointerdown` and goes once the context runs;
- with `?hooks=1` and no `?audio=silent`, `__digitus2Keys` exists and the real instrument is chosen;
- `accompanied()` holds the accompaniment's notes and none of Play's.

**`score/usePlayAlong.accompany.test.tsx`** (new, Track C, `<StrictMode>`). It uses a copy of the fake `Playback` builder of `usePlayAlong.test.tsx`, which Track A owns, with the five new members as `vi.fn()`s.

- with `mutedHands ['L']`, one pass calls `accompany` once with left-hand notes only;
- with `[]`, it never calls `accompany` or `prepare`;
- a chain calls `accompany` once, from the last step;
- the loop's last step accompanies to the loop's end and no further;
- the last step accompanies the tail, and the re-cue of step 0 after the flight does not stop it;
- a seek, a hands change, a loop change and going inactive each call `stopAccompaniment`;
- the walk's own `cueAt` does not;
- `prepare` is called once while active;
- `soundWaits` follows `playback.soundWaits` only when active with a hand to play;
- running the align twice calls nothing twice.

**`score/ScoreView.test.ts`** (`scoreStatusLine`):

- `alongSound` click and tap;
- it ranks under the count-in and over the hint;
- `loading` from `preparing` says `Loading the piano…`.

**`midi/piano.test.ts`** (fake timers):

- a press with a granted query and a pending request: `asking`, then `searching` after 2000 ms;
- with the query on `prompt` it stays `asking`, and once the query turns `granted` it moves to `searching` on the next poll;
- a resume with the request pending moves `off` to `searching` after 2000 ms;
- a press during a pending resume goes to `searching` at once;
- the request resolving from `searching` gives `connected`, or `none`;
- Turn off during `searching` gives `off` with the setting false, and a late resolve is closed;
- no timer is left after settle, Turn off or `resetPianoForTests` (`vi.getTimerCount()`).

**`library/PianoLine.test.tsx`:**

- `searching` shows the sentence and `Turn off`, not busy;
- the focus stays on the one button through `asking`, `searching` and `connected`;
- nothing is `.is-red`.

**Playback fakes:** add the five members as stubs to `carry.test.ts`, `ScoreView.letters.test.tsx`, `useCursor.test.ts`, `Transport.test.tsx` and `usePlayAlong.test.tsx`, and nothing else.

### 3.2 E2E helper changes (`apps/web/e2e/helpers/midi.ts`, Track C)

- `FakeMidiOptions.hang?: boolean`: `requestMIDIAccess` stays pending whatever the permission, until `resolve('allow' | 'block' | 'dismiss')` (WinRT with the piano off).
- `accompanied()`, `accompCancelled()` and `audioState()` read `__digitus2Keys`.
- `FakeMidiOptions.settings?: Record<string, unknown>` is merged into the stored settings on a test's first load, like `playAlong`. It is how a spec chooses `hands: 'R'` with no click: a click on the Practice panel is a user activation and would spoil the fresh-load case.
- `pressStep()` presses the pitches of the current step without releasing them, for early-arrival timing.

### 3.3 E2E

**`apps/web/e2e/play-along.spec.ts`**, new cases. These run on Twinkle, `?audio=silent`, desktop, with `expectOneRed` at every checkpoint. The expected offsets come from the Twinkle fixture's left hand and its tempo, worked out by the builder and written as constants with a comment.

1. **Right hand: digitus plays the left.**
   - Before the first press, `accompanied()` is empty and stays empty for 500 ms.
   - `playRed` once: every record has `hand === 'L'`. The time differences from the first record match the fixture's left-hand onsets in that stretch at 100 % (±1 ms), and `strikes()` is empty.
2. **The tempo.** At 50 % in the Practice panel, the same stretch's differences double.
3. **Left hand** is the mirror: only `'R'` is scheduled. **Both hands:** nothing is ever scheduled after several steps.
4. **An early arrival.**
   - `pressStep` on a step whose stretch holds notes more than 150 ms ahead, then at once the next step.
   - `accompCancelled()` holds the first stretch's notes not yet due, and none that had started.
   - The next stretch's notes are scheduled after the second press.
5. **A seek drops them.** After `playRed`, a click on bar 3 adds the stretch's pending notes to `accompCancelled()`, and nothing more is scheduled until the next press.
6. **Play stops it.** After `playRed`, Play: the pending notes are in `accompCancelled()`, nothing new enters `accompanied()` while Play's cursor runs as before, and Pause gives the walk back.
7. **The end.** The last step of the piece schedules the tail. One red is sampled on every frame through the finish (the burst helper), and the tail is not cancelled by the re-cue of step 0.
8. **A loop over bars 2 to 3.** After bar 3's last step, the records reach the loop's end and nothing of bar 2 is scheduled until bar 2's first step is played.
9. **Unplugged** mid-stretch: the accompaniment is cancelled, and the red and the cue stay.
10. **Samples loading.** This uses `?hooks=1` (the real instrument, with the hooks) and `delayPianoSamples`.
    - `Loading the piano…` shows on the status line while `__digitus2Along.target()` is non-empty and Play is not busy.
    - `playRed` moves the red during the load.
    - **A failed load** (the samples answered with the app's page): the walk still moves, and the samples notice shows once.

**The piano line**, new cases in `play-along.spec.ts`, on desktop and mobile:

11. **The press with `hang`** (permission granted): `asking`, then within 4 s `Looking for your piano. Make sure it is turned on.` with `Turn off`. The focus is still on the button. `resolve('allow')` then gives the connected sentence.
12. **A later visit with `hang`** (granted, `playAlong` stored): the searching sentence appears with no press. Turn off gives the plain line. A late `resolve('allow')` does not connect, and a reload does not ask.
13. **The prompt open** (`permission: 'prompt'`, `answer: 'manual'`) for 4 s: still `Allow the browser to use your piano.`

**`apps/web/e2e/play-along-sound.spec.ts`** (new, desktop only) uses `?hooks=1` (the real instrument, with the hooks, so `playRed` works), with the samples answered by `silentWav`, `hands: 'R'` seeded through `installFakeMidi`'s `settings` (never a click), and:

```ts
test.use({
  launchOptions: { args: ['--autoplay-policy=document-user-activation-required', '--mute-audio'] },
});
```

An init script counts `AudioBufferSourceNode.prototype.start` calls and keeps the page's `AudioContext` instances, so the real voices smplr starts are observed with no app hook.

1. **A fresh load straight onto the score URL** (the piano granted, `playAlong` and `hands: 'R'` seeded in storage, no click before the check):
   - the context's state is `suspended`;
   - the status line says `Click the page once to hear the other hand.`;
   - `playRed` moves the red, and no source starts;
   - one `page.mouse.click` on the title: the sentence goes and the state is `running`;
   - the next `playRed` starts sources;
   - one red throughout, and no horizontal overflow at 360 px.
2. **From the library** (sticky activation): a click on Twinkle in the list. There is no sentence, and the first `playRed` starts sources.

### 3.4 The controller's check in real Chrome with real audio

1. Build and preview. Run `play-along-sound.spec.ts` with `DIGITUS2_E2E_CHROME=1`, which the spec reads as `test.use({ channel: 'chrome', headless: false })` and which drops `--mute-audio`.
2. In the controller's own Chrome, use a fresh tab and type the preview's score URL into the address bar, with the setting stored and MIDI granted. Use the real GO:PIANO or a virtual MIDI port.
3. Press the red note on the piano. The red moves on, and the sentence asks for one click.
4. Click once, and press the next note. The left hand is heard.
5. Record the result on issue 184. The owner's own run (the right hand of a piece on the GO:PIANO while digitus plays the left) stays on the issue's checklist.

## 4. Build tracks

**Track 0 (the controller, before the builders start):** add `AccNote` (section 2.1) to `apps/web/src/audio/instrument.ts`. Tracks A and B then run in parallel against section 2. Track C runs **last**.

### Track A: the instrument, the accompanist, the playback (parallel)

- [ ] `apps/web/src/audio/instrument.ts`, `apps/web/src/audio/instrument.test.ts`
- [ ] `apps/web/src/audio/accompanist.ts`, `apps/web/src/audio/accompanist.test.ts`
- [ ] `apps/web/src/score/usePlayback.ts`, plus the new file `apps/web/src/score/usePlayback.accompany.test.ts`
- [ ] The five new `Playback` members as stubs, and nothing else:
  - `apps/web/src/score/carry.test.ts`
  - `apps/web/src/score/ScoreView.letters.test.tsx`
  - `apps/web/src/score/useCursor.test.ts`
  - `apps/web/src/score/Transport.test.tsx`
  - `apps/web/src/score/usePlayAlong.test.tsx`

### Track B: the pure planning, the piano line, every string (parallel)

- [ ] `apps/web/src/audio/events.ts`, `apps/web/src/audio/events.test.ts`, `apps/web/src/audio/transport.ts` (only the move of `buildEvents` out to `events.ts`; `transport.test.ts` unchanged and green)
- [ ] `apps/web/src/score/playAlong.ts`, `apps/web/src/score/playAlong.test.ts` (`last`)
- [ ] `apps/web/src/score/accompaniment.ts`, `apps/web/src/score/accompaniment.test.ts`
- [ ] `apps/web/src/midi/types.ts`, `apps/web/src/midi/piano.ts`, `apps/web/src/midi/piano.test.ts`
- [ ] `apps/web/src/library/PianoLine.tsx`, `apps/web/src/library/PianoLine.test.tsx`
- [ ] `apps/web/src/i18n/{en,es,fr,nl,pt}/library.ts`, `apps/web/src/i18n/{en,es,fr,nl,pt}/score.ts`

### Track C: wiring, e2e, docs (runs last, after A and B are in)

- [ ] `apps/web/src/score/usePlayAlong.ts`, plus the new file `apps/web/src/score/usePlayAlong.accompany.test.tsx`
- [ ] `apps/web/src/score/ScoreView.tsx`, `apps/web/src/score/ScoreView.test.ts`
- [ ] `apps/web/e2e/helpers/midi.ts`, `apps/web/e2e/play-along.spec.ts`, plus the new file `apps/web/e2e/play-along-sound.spec.ts`
- [ ] `docs/app.md`, `docs/PROGRESS.md`
- [ ] `pnpm verify --changed`, then one full `pnpm verify`. Record the entry chunk's gzip size in `docs/app.md`, under Performance budget.

## 5. Docs (Track C)

### `docs/app.md`

- **Audio.**
  - The scheduler bullet names `events.ts` as the note list shared by the transport and the accompaniment.
  - A new bullet, **Accompaniment**, covers:
    - the `Accompanist` (just-in-time, 150 ms, 25 ms, each note's own stop, never `stopAll`);
    - why: smplr's `stopId` defaults to the pitch, and its 200 ms queue is not cleared by `stop()`;
    - `prepare` and `preparing`;
    - `soundWaits` and the gesture listener.
- **MIDI input.** "Nothing calls `strike` or the instrument from MIDI input" becomes: MIDI input never sounds the reader's notes, `strikes()` stays empty, and the other hand is played through `Playback.accompany` (Playing along on a piano).
- **Library, Play along.** Add the `searching` row with its English, and the rule: a granted request still pending after 2 s, from a press or from the silent resume.
- **Playing along on a piano.** A new part, **The other hand**:
  - the Hands control as the toggle;
  - the stretches (ruling 2's table);
  - a chain;
  - the rule for notes before the step the walk waits on;
  - the end and the loop;
  - onset against sec, and graces at the press;
  - velocities and ornaments as in Play;
  - unisons;
  - tempo from the press;
  - what stops it.

  Also update the table in 1.2 and the sentence `The app makes no sound for the reader's notes`.

- **The dock and Practice.**
  - Status line: `Loading the piano…` also while the samples load for the other hand, and the click or tap sentence.
  - Hands: with a piano connected it also chooses the hand digitus plays.
- **Testing.**
  - `play-along-sound.spec.ts` and its own autoplay policy;
  - the new `__digitus2Keys` members;
  - the fake's `hang`.
- **Performance budget.** The entry chunk, re-measured.
- **Known limitations:**
  - the lag of the notes that start with the reader's (1.3);
  - the other hand's notes before the first step the walk waits on are not played: a pickup, an introduction, a bar entered by a seek;
  - a grace of the other hand at a stretch's start sounds with its principal;
  - a tempo change applies from the next press;
  - a fresh load onto a score URL needs one click before digitus is heard.

### `docs/PROGRESS.md`

- **The current-state line** for playing along gains: with one hand chosen, digitus plays the other in rhythm between the reader's steps (issue 184).
- **Decisions:**
  - the just-in-time accompanist with each note's own stop;
  - not playing what lies before the first step;
  - `prepare` beside `loading`;
  - one click on a fresh load.

The owner's GO:PIANO run stays on issue 184's checklist.

## 6. Risks and guards

| Risk                                                                                         | Guard                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cancelling a note cuts a ringing note of the same pitch                                      | A unique `stopId` per `start`; `instrument.test`; `accompanist.test` (a started note is not cancelled by an early arrival)                                                                                                                                                                                                                               |
| A dropped note sounds anyway after a seek (smplr's 200 ms queue survives `stop()`)           | Our look-ahead is 150 ms, so nothing of ours enters smplr's queue; we never use `stopAll`; e2e 5                                                                                                                                                                                                                                                         |
| The accompaniment's stop cuts Play's first notes or a struck key                             | No `stopAll`; `play()` stops the accompaniment before the transport schedules; e2e 6                                                                                                                                                                                                                                                                     |
| The preload turns the walk off                                                               | `preparing`, never `loading`; the `usePlayback` test asserts `loading` stays false; e2e 10                                                                                                                                                                                                                                                               |
| Notes piled up on a suspended context sound together on the first click                      | `accompany` is a no-op unless the context runs; `play-along-sound` 1                                                                                                                                                                                                                                                                                     |
| The click sentence flashes during a permitted context's start                                | `soundWaits` also needs `userActivation.hasBeenActive` false; `play-along-sound` 2                                                                                                                                                                                                                                                                       |
| Headless Chromium does not apply the autoplay policy                                         | The spec sets `--autoplay-policy=document-user-activation-required` explicitly; the controller's real-Chrome run (3.4) is authoritative                                                                                                                                                                                                                  |
| The AudioContext warning in the console on a fresh load fails a spec that checks the console | Only the sound spec loads a score fresh with the real instrument; a spec that asserts a clean console allows that one warning by its text                                                                                                                                                                                                                |
| The library budget, with the event list now static                                           | `events.ts` imports nothing from `transport.ts`; the bundle step; the size recorded. `rollDelays` and `pedalStops` may be tree-shaken out of the entry chunk today and come in with `events.ts`. If the bundle step fails, `usePlayAlong` reaches `events.ts` and `accompaniment.ts` through `import()`, fetched with the transport chunk on score open. |
| The move of `buildEvents` changes playback                                                   | A verbatim move; `transport.test.ts` unchanged and green; `ornaments.test.ts`, `performance.test.ts`, `playback.spec.ts`, `ornaments.spec.ts` in verify                                                                                                                                                                                                  |
| The walk's own moves (finish, the re-cue of step 0, a loop wrap) stop the tail               | `stopAccompaniment` only on `moved` with a previous `atRef`, or when inactive; `usePlayAlong.accompany.test`; e2e 7 and 8                                                                                                                                                                                                                                |
| e2e timing under load                                                                        | Offsets are asserted as differences of scheduled times, which are exact; early arrival uses `pressStep` with a stretch more than 150 ms long; `expect.poll`, never a sleep                                                                                                                                                                               |
| The searching timer leaks into tests or outlives a Turn off                                  | Cleared on settle, Turn off and `resetPianoForTests`; generation-checked; `vi.getTimerCount()` in `piano.test`                                                                                                                                                                                                                                           |
| Twinkle's left hand has too few notes per stretch for the early-arrival case                 | The builder picks the step from the fixture whose stretch holds a note more than 150 ms after it, else uses a fixture of `playback.spec.ts`, and writes the choice in the test                                                                                                                                                                           |
