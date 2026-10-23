# Play along on your own piano (issue 182): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan track by track. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers do not run git; the controller commits each track with explicit paths.

**Goal:** A beginner connects a digital piano (USB or Bluetooth MIDI) and the red waits for them. One quiet text line under `Open your own score` on the library page turns it on, and only where the browser has Web MIDI. In the score view, while a piano is connected and the score is not playing, the red marks the next group of notes to play. This is the existing cue look: the notes are red, Play is plain, and the keys are pressed with their fingers. When the reader holds every pitch of that group, the red moves on to the next group, and the page turns as it does for the playing cursor. The reader's held keys show on the on-screen keyboard in a gray look of their own. The app makes no sound for the reader's notes. Play still plays the piece. The score view gets no new control.

**Issue:** [issue 182](https://github.com/MarchalMaxim/digitus2/issues/182). Every commit message ends with `(issue 182)`.

**Read first:**

- `CLAUDE.md`
- `docs/app.md`, the sections Audio, Library, Score view (Cursor and keyboard; Moving through the piece; The dock and Practice), The red element rule, Motion, Light and dark, Languages, Testing, and Performance budget
- `docs/verification-loop.md`

**Architecture:**

- **`apps/web/src/midi/`**, new. It is Web MIDI input only: there is no output and no sound.
  - `types.ts` holds the shared types. The controller writes it before the tracks start.
  - `parse.ts` is the pure byte parser plus the held-key bookkeeping.
  - `access.ts` opens `MIDIAccess` and follows hot-plug.
  - `parse.ts` and `access.ts` form the **lazy chunk**, reached only through `import('./access.js')`.
  - `piano.ts` is static and tiny. It does the feature test and the permission query, keeps the module-level piano store (status, names, held pitches, note listeners) with its React hooks, and handles the press, Turn off and the silent resume on a later visit.
- **`score/playAlong.ts`**, new and pure. It builds the steps to play from the _performance_ score (repeats, voltas, D.C., D.S. and Coda in the order they are heard). It also holds the key bookkeeping and the advance rule.
- **`score/usePlayAlong.ts`**, new. It is the glue between the piano store and `Playback`. It moves the red only through two new `Playback` members:
  - `cueAt(perfSec)`, a cue in **performance seconds**;
  - `finish()`, which is the transport's own end.
- **What already exists and is reused:**
  - **The cue state.** `useCursor`'s cued branch marks the first group of the played hands at or after the cue. It presses the group's keys with fingers and turns the page.
  - **Play is plain** while a group is marked (`resumeShown`).
  - **Play from a cue** starts at the red note.
  - **The finish.** `EndBurst`, and the red's flight home on the `atStart` edge.
  - **Seeks.** BarSeek, the arrow keys and the hop.
  - **Performance order.** `performanceFor`, `toWrittenSec` and `performanceLoop` in `audio/performance.ts`.
- **Not touched:**
  - `useCursor.ts`, `onsetGroups.ts`, `BarSeek.tsx`, `EndBurst.tsx` and `RedFlight.tsx`
  - `audio/performance.ts`, `carry.ts`, `App.tsx` and `main.tsx`
  - `LibraryView.tsx` and `scripts/check-colors.mjs`

**Tech stack:** as the repository today. No new dependency, no lockfile change. The Web MIDI types come from TypeScript's `lib.dom`: `MIDIAccess`, `MIDIInput` and `MIDIMessageEvent`.

## Global Constraints

| What                        | Value                                                                                                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the home line shows   | Only where `typeof navigator.requestMIDIAccess === 'function'` (`midiSupported()`). WebKit, Safari and iOS render nothing.                                                                                                                                                    |
| When the browser is asked   | Only in the press of the home line. A later visit opens MIDI silently, and only when the setting is on **and** `navigator.permissions.query({ name: 'midi' })` answers `granted`. A missing or throwing query counts as `prompt`.                                             |
| `requestMIDIAccess` options | `{ sysex: false }`                                                                                                                                                                                                                                                            |
| Inputs                      | Every connected input, except `/^midi through\b/i` (Linux's loopback). All 16 channels. A pitch is held while any input and channel holds it.                                                                                                                                 |
| Ignored                     | Pedal (CC 64) and every other controller, program change, pitch bend, aftertouch, realtime bytes 0xF8 to 0xFF (Roland's active sensing every 300 ms). Note-on at velocity 0 is a note-off.                                                                                    |
| Library budget              | The library page's initial JS and CSS stay under 150 KB gzip. `ScoreView` is in the entry chunk, so everything it imports statically counts. `piano.ts`, `playAlong.ts`, `usePlayAlong.ts` and `PianoKeyboard.tsx` are static and small. `parse.ts` and `access.ts` are lazy. |
| Colours                     | Two new pure-gray tokens in `tokens.css` only, written identically in both dark blocks. No hex literal anywhere else.                                                                                                                                                         |
| Comments                    | Never `#` followed by digits (the colour guard reads it as a hex colour): write `issue 182`. `chrome://flags/#use-winrt-midi-api` is safe because `u` is not a hex digit.                                                                                                     |
| Strings                     | Every new string in en, es, fr, nl and pt. No disclaimers ("may not work", "not accurate"). `noDisclaimers.test.ts` is extended to `library.ts` and `score.ts`. Connection instructions are not disclaimers.                                                                  |
| Sound                       | Nothing calls `strike` or the instrument from MIDI input. `__digitus2Keys.strikes()` stays empty while the reader plays.                                                                                                                                                      |

Rules:

- **No git.** Implementers do not run git. Each track ends by listing its paths, and the controller commits.
- **UI.** Black and white, with exactly one red element on screen at a time. Never red:
  - the home line and its button;
  - the reader's held keys;
  - the cued keys, hover and hand letters;
  - the status line.

  The score view gets no new control.

- **Tests.**
  - For pure modules (`parse.ts`, `playAlong.ts`), write the failing vitest test first.
  - The hooks and components get vitest unit tests.
  - User flows get Playwright specs, driven by a fake `requestMIDIAccess` that `addInitScript` injects.
- **Format.** Run `pnpm exec prettier --write <files>` and `pnpm lint` before handing back.
- **Docs.** Present tense, with no dates, branch names or agent credits.
- **Windows.** Use the Write tool for long files. Run long commands in the background.
- **Done.**
  - While iterating: `pnpm verify --changed`.
  - Before the pull request: one full `pnpm verify` and green CI.
  - The bundle step must show the library page under 150 KB gzip, with `parse.ts` and `access.ts` in their own chunk.

## Rulings (fixed; do not re-open)

These are settled against the code. A builder who finds one wrong stops and reports; they do not "simplify" it away.

1. **The red waiting for the piano is the existing cue.** `cueAt(perfSec)` sets `cue` to the written second and `atStart` to false, also at second 0, so the cued branch of `useCursor` marks the first group.
   - **Why no `useCursor` change is needed.** At position 0, `resumes` holds and `next = groupIndexAt(active, -1e-9) + 1 = 0`.
   - **Why Play does not fly out.** `play()` sees `atStartRef` false, so `travels` is false. `fromPlayRef` is false because `currentGroup >= 0`.
   - **Rewind is idle on the first note.** While the red waits on the first step, Rewind is idle through a new `Transport` prop. The bar-1 click and the Home key are no-ops there too.
2. **The walk moves in performance seconds.** `Transport.seek(writtenSec)` enters a bar _going back_ at its last hearing at or before the music. So an advance from the last bar of a repeat's first pass to bar 1, done with `seek`, would land on the first hearing again and loop forever. The walk therefore uses `cueAt` and `Transport.seekPerformance`, never `seek`. The steps come from `performanceFor(score).score`.
3. **A cue before the first Play keeps its hearing.** `usePlayback` gets `pendingPerfRef` beside the existing `pendingSecRef`, which is unchanged so that today's seek before the first Play behaves exactly as now.
   - `cueAt` without a transport sets `pendingPerfRef` and clears `pendingSecRef`.
   - `seek`, `rewind`, `halt` and `finish` clear `pendingPerfRef`.
   - A new transport takes `seekPerformance(pendingPerf)` when it is set, else `seek(pendingSec)` as today.
4. **Grace notes.** The MusicXML reader gives a grace note duration 0 and its principal's onset (`packages/engine/src/io/musicxml/read.ts`, the comment above the duplicate filter). Grace notes are never required, and a step whose played notes are all graces is no step.
5. **Ornaments.** The pitch required for an ornamented note is the pitch the cued keyboard shows at the group's onset: `ornamentAttacks(n)[0].midi` when that attack starts at the note's onset (within 1e-9 s), else `n.midi`. This is the same rule as `useCursor`'s `pressedKeys(…, g.sec, …)`. What the reader is asked to press then always matches the key shown, so an upper-start trill asks for the upper neighbour. `@digitus2/engine/ornaments` is already in the static bundle.
6. **Ties** are one engine `Note` (`sourceIndices`). The continuation has no onset and never asks for a press.
7. **The walk's moves wait while a flight or hop is on screen** (`red.redAway`). There are never two reds. The align step is a passive `useEffect`, declared after `useEmbellishCarry`, so it runs after:
   - RedFlight's and EndBurst's layout effects;
   - the carry's own effect, in the same commit.
8. **The walk never calls `cueAt` while playing, loading samples, or not ready.** That covers `playback.playing`, `playback.playingNow()`, `playback.loading`, a `doc.status` other than `ready`, and `!playable`.

### Where the build departs from this plan

The review found three places where the plan was wrong; the code and `docs/app.md` follow the corrections.

- **Ruling 3.** A seek made while a cue waits keeps the cue's hearing: with `pendingPerfRef` set, `seek` stores `toPerformanceSec(perf, sec, startPerformanceSec())`, as `Transport.seek` does. Clearing it, as written below, sent a reader who never pressed Play back to a repeat's first hearing on every bar click.
- **Section 1.4.** The bar of a dimmed key (the hand left out) is drawn beside the key's group, outside its 40 % opacity, with a third token, `--key-held-on-dim`: inside the group it measured 1.5:1.
- **Section 2.13.** The Spanish, French and Portuguese flag sentences keep the verb "set", and the Portuguese button is an infinitive like its neighbours.

## 1. Decisions

### 1.1 Steps (what there is to play)

- **A step** is one onset tick of `performanceFor(score).score`, restricted to the hands played (`mutedHandsFor(handsFor(score, hands))`).
- **Its `pitches`** are the required pitches (rulings 4 to 6) of the non-grace notes _starting_ at that tick, distinct and ascending.
- **Ticks with nothing to press are dropped:** a tick with no required pitch (graces only, or only the muted hand).
- **A held note is not required again.** A held bass under a moving melody is required only at its own onset.
- **A unison** of both hands, or of two voices, is one pitch.
- **Each step** carries `perfSec`, its onset in performance seconds. The written second, `toWrittenSec(perf, perfSec)`, matches the written group's `sec` well inside the cursor's 1e-9 slack.

### 1.2 When a step counts as played

The hook keeps `Keys`: each pitch held on the piano now, with whether its current press is still **fresh**, that is, not yet used by a step.

- **Note-on** makes the pitch held and fresh. A second note-on without a note-off in between (two inputs, or a sloppy keyboard) refreshes it.
- **Note-off** removes the pitch once no input or channel holds it any more.
- **A step passes** when every one of its pitches is held and fresh at once. Its pitches are then marked used. Extra keys stay as they are.
- **Chain.** After a pass, the next step is checked against the keys still held and fresh, and so on. The chain is bounded by the number of steps, and one `cueAt` (or `finish`) goes to where it ends. It follows that:
  - a key pressed a moment early counts for its step and never leaves the reader stuck;
  - a key used by one step never counts again, so a repeated pitch (Twinkle's C C) needs a release and a fresh press.
- **A chord** passes on its last key while the others are still held. A key released before the last one is down must be pressed again.
- **Wrong notes** and extra held keys are ignored: the red stays where it is.
- **Notes of the hand left out** never count.
- **Pitch** is exact, with no octave folding.
- **An external move uses up every held key** (all become not fresh). An external move is any change of where Play starts that the walk did not make: a seek, the arrow keys, Rewind, a loop change, a hands change, a new score, Play then Pause, or the piano connecting.
  - The hook recognises its own moves because it remembers the performance second it last left the playback at (`atRef`).
  - The check runs on every note event and on every align, before the event is applied. So a key pressed during a seek's hop counts for the step the hop lands on.
- **Mouse presses** on the on-screen keyboard sound as today and never advance the red.

### 1.3 What is red, by state, with a piano connected

The walk is **active** when all of these hold:

- the setting is on and the status is `connected`;
- `doc.status === 'ready'` and the score is playable;
- there is at least one step;
- it is not playing (`playing` and `playingNow()` both false) and not loading.

The walk **may move** the red when it is active and `!red.redAway`.

| State                                                                  | Red                                                                                                                                                                                                                                                                                        | How                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Score opened, or the piano just connected, at the start                | the first step's notes; Play plain; their keys pressed with fingers                                                                                                                                                                                                                        | align: `cueAt(steps[0].perfSec)`                                     |
| A step played                                                          | the next step's notes; an instant class swap (no hop), the page turned by `followCursor`                                                                                                                                                                                                   | `cueAt(next)`                                                        |
| Cued after a seek (bar click, arrow keys)                              | the hop as today, then the first step at or after the bar's position, in the hearing the seek chose                                                                                                                                                                                        | align re-anchors when the bar starts with a rest in the hands played |
| Playing                                                                | the playing cursor, unchanged; Pause in the lead-in; the reader's keys still show                                                                                                                                                                                                          | the walk is inactive                                                 |
| Paused after a note was heard                                          | the group the paused cursor already marks stays red (nothing moves at Pause); it becomes the cue, so Play restarts at its onset                                                                                                                                                            | align: `cueAt(last step at or before startPerformanceSec())`         |
| Paused in a lead-in (nothing heard, the cue kept)                      | the cued step                                                                                                                                                                                                                                                                              | align: no-op                                                         |
| The last step played, no loop                                          | `finish()`: `ended + 1`, `atStart`. The burst rises from the last group and the red flies home to Play. Once landed (`redAway` false), align cues the first step and the page scrolls back to it. Under reduced motion there is no flight: Play is red for one frame, then the first note. |                                                                      |
| Rewind, Home or bar 1 while waiting away from the first step           | the flight home, then the first step                                                                                                                                                                                                                                                       | the existing paths                                                   |
| Rewind, Home or bar 1 while waiting on the first step                  | nothing happens: Rewind is `aria-disabled`, and Home and bar 1 are no-ops                                                                                                                                                                                                                  | `along.atFirst`                                                      |
| A loop set                                                             | the loop's first step when where Play starts falls outside the loop's stretch, else unchanged; after the stretch's last step, its first step again (a loop never ends: no finish)                                                                                                          | stretch = `playback.performanceLoop()`                               |
| A loop where the played hands have no step                             | Play (red), as today                                                                                                                                                                                                                                                                       | the walk does nothing                                                |
| Hands switched                                                         | the first step of the hands now played at or after where Play starts                                                                                                                                                                                                                       | new steps: external move                                             |
| `Add notes between` switched                                           | after the carry, the first step at or after the carried bar                                                                                                                                                                                                                                | the passive align runs after the carry's effect                      |
| Re-solve or re-layout                                                  | the same step, re-marked with the new digits                                                                                                                                                                                                                                               | unchanged `useCursor` behaviour                                      |
| Piano disconnected while waiting                                       | the cue stays where it is (Play plain, Play starts there), like after a seek; Rewind becomes available again                                                                                                                                                                               | the walk becomes inactive                                            |
| Loading, fingering, error, nothing playable, samples loading, count-in | as today                                                                                                                                                                                                                                                                                   | the walk is inactive                                                 |

- **No breathing while waiting.** `ScoreSheet`'s `resting` gets `&& !along.active`. Otherwise every advance would restart the 4.8 s breathe.
- **The status line.** One new lowest-priority `info` entry, shown only when stopped. The text is `Play the red note on your piano.`, or `Play the red notes on your piano.` when the current step has more than one pitch. It shows while the walk is active and no step has been played yet in this score view. It goes after the first pass and does not come back in this view. There is no per-step announcement.

### 1.4 The reader's keys on the on-screen keyboard

Each held pitch within the drawn range gets a **gray bar along the key's front edge**.

- It is drawn in its own layer above the keys and below the hand letters, with `pointer-events: none` and `aria-hidden`.
- **Sizes**, where `x`, `w` and `h` are the key's own:

  | Key   | x       | y       | Width   | Height | rx  |
  | ----- | ------- | ------- | ------- | ------ | --- |
  | White | `x + 3` | `h − 8` | `w − 6` | 5      | 1   |
  | Black | `x + 2` | `h − 6` | `w − 4` | 4      | 1   |

- **Pitches outside the drawn range** are not drawn, and the view never scrolls to follow them. `barKeys` still choose the view.
- **It is additive.** It never changes `pressed`, `muted`, `downRef` or the hover. A cued key held on the piano shows the cue's fill and finger plus the bar.
- **The bar moves with its key.** It goes down and up with the key's existing travel, because it sits in the key's group transform.

**Tokens** (`tokens.css`; light `:root`, then both dark blocks identically):

| Token                 | Light     | Dark      | Drawn on                                  |
| --------------------- | --------- | --------- | ----------------------------------------- |
| `--key-held`          | `#666666` | `#3d3d3d` | a white key, or any pressed or dimmed key |
| `--key-held-on-black` | `#666666` | `#666666` | an unpressed black key                    |

**Contrast.** All of these are at least 3:1 (WCAG 1.4.11, non-text):

| Pair                                        | Light | Dark |
| ------------------------------------------- | ----- | ---- |
| `--key-held` against `--key-white`          | 5.7   | 7.8  |
| `--key-held` against `--key-down`           | 3.6   | 3.4  |
| `--key-held-on-black` against `--key-black` | 3.7   | 3.3  |

**CSS** (`base.css`, next to the keyboard rules):

```css
/* The reader's keys (issue 182): a gray bar along the front edge of each key held on the piano. */
.keyboard-svg .key-held {
  fill: var(--key-held);
  pointer-events: none;
}
.keyboard-svg .key-held.is-on-black {
  fill: var(--key-held-on-black);
}
```

`is-on-black` is set only on a black key that is neither pressed nor dimmed.

### 1.5 The home line

- **Place.** The home line is the last row of `.library-end`: under `Open your own score`, and under `Take a photo` on touch-only devices.
- **Structure.** It is one `<div className="piano-line">` holding two elements:
  - `<p className="muted small" role="status">`, visually hidden while empty;
  - one `<button type="button" className="text-button">`.

  The button is the **same element in every state**, so the focus survives every label change.

- **No Web MIDI.** The line returns `null`.

| Status                                                                                         | Sentence (en)                                                                                                                                                                                                   | Button                                                   |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `off` (never asked, turned off, dismissed, or a later visit whose permission is not `granted`) | (none)                                                                                                                                                                                                          | `Play along on your piano`                               |
| `asking` (the press; the browser's prompt is open)                                             | `Allow the browser to use your piano.`                                                                                                                                                                          | `Play along on your piano`, `aria-disabled`, `aria-busy` |
| `connected`                                                                                    | `{name} is connected. Open a piece and play the red note.`                                                                                                                                                      | `Turn off`                                               |
| `none` (access granted, no input)                                                              | `No piano found. Connect it with a USB cable, or pair it over Bluetooth and turn it on.` On Windows Chromium only, a second sentence follows: `On Windows, a Bluetooth piano also needs {flag} set to Enabled.` | `Turn off`                                               |
| `denied` (the request rejected and `permissions.query` now answers `denied`)                   | `The browser blocked MIDI for this site. Allow it in the site settings, then press again.`                                                                                                                      | `Play along on your piano`                               |

- **`{name}`** is the first connected input's `name`, or `Your piano` when it is empty.
- **`{flag}`** is `bluetoothFlag()`:
  - `chrome://flags/#use-winrt-midi-api` on Windows Chrome;
  - `edge://flags/#use-winrt-midi-api` on Windows Edge;
  - null elsewhere, including Firefox.

  It is detected with `navigator.userAgentData?.platform === 'Windows'` and the brands, falling back to `/Windows/`, `/Edg\//` and `/Chrome\//` in the user agent. It is plain text, not a link: pages cannot navigate to these schemes. It wraps with `overflow-wrap: anywhere`.

- **A rejection** from `requestMIDIAccess` gives `denied` when the query then says `denied`; otherwise it is a dismissal and gives `off`.
- **The setting.** `settings.playAlong` becomes true when access resolves (`connected` or `none`), and false on Turn off, `denied` or a dismissal.
- **Turn off:**
  - every input's `onmidimessage` is set to null and the input is `close()`d;
  - `access.onstatechange` is set to null;
  - the held keys are released, so listeners get the note-offs;
  - the status goes to `off`.

  The browser's permission is left as it is.

- **Hot-plug.** `onstatechange` lists the connected inputs again:
  - a new input gets its handler (by property assignment, so attaching it again is harmless) and its own parser;
  - an input that left is detached and its keys released;
  - the status moves between `connected` and `none` with no reload, both on the library line and in the score view.
- **StrictMode.** The connection is a module singleton. Concurrent opens share one pending request, and a Turn off during a pending request discards the access when it resolves.

## 2. Interfaces (fixed before the tracks start)

### 2.1 `apps/web/src/midi/types.ts` (the controller writes this verbatim first)

```ts
/** Shared types of the piano connection (issue 182). */

/** One key going down (`on`) or up, merged over every input and channel. */
export interface NoteMessage {
  on: boolean;
  midi: number;
}

/** Where the piano connection stands. */
export type PianoStatus = 'unsupported' | 'off' | 'asking' | 'connected' | 'none' | 'denied';

export interface PianoSnapshot {
  status: PianoStatus;
  /** The connected inputs' names, in MIDIAccess order (Midi Through left out); empty unless connected. */
  names: readonly string[];
}

/** What the lazy access module reports to the static store. */
export interface AccessEvents {
  /** The connected inputs changed (also once right after opening). */
  inputs(names: readonly string[]): void;
  /** A merged note-on or note-off, after `held` was updated. */
  note(e: NoteMessage, held: readonly number[]): void;
}

export interface OpenedAccess {
  close(): void;
}

/** Why opening failed: `denied` (the permission now says denied) or `dismissed`. */
export type AccessRefusal = 'denied' | 'dismissed';
```

### 2.2 `apps/web/src/midi/parse.ts` (pure; lazy, imported only by `access.ts`)

```ts
export interface ParsedNote {
  on: boolean;
  channel: number; // 0..15
  midi: number;
}

/**
 * A byte parser for one input (issue 182).
 * - Running status is kept across calls.
 * - Realtime bytes (0xF8..0xFF) are dropped wherever they appear, without touching running status
 *   or a partial message.
 * - SysEx (0xF0 .. 0xF7) is skipped whole, across calls too, and clears running status.
 * - System common (0xF1..0xF6) is skipped with its data bytes and clears running status.
 * - Data bytes with no status are ignored.
 * - Channel messages have known lengths: 0x8n, 0x9n, 0xAn, 0xBn and 0xEn take 2 data bytes;
 *   0xCn and 0xDn take 1.
 * - Only note on and note off produce output (velocity 0 is off).
 * - An incomplete message completes on the next call.
 */
export function createMidiParser(): (data: ArrayLike<number>) => ParsedNote[];

/** Keys held per input and channel; a pitch is held while any of them holds it. */
export class HeldKeys {
  /** A note from `inputId`: the merged message to report, or null (an off for a key still held elsewhere, or not down). A note-on always reports `on`, also when already held. */
  apply(inputId: string, n: ParsedNote): NoteMessage | null;
  /** That input went away: the note-offs of the pitches no longer held. */
  dropInput(inputId: string): NoteMessage[];
  /** Turned off: a note-off for every held pitch. */
  clear(): NoteMessage[];
  /** The held pitches, ascending; the same array until they change. */
  held(): readonly number[];
}
```

### 2.3 `apps/web/src/midi/access.ts` (the lazy chunk)

```ts
import type { AccessEvents, AccessRefusal, OpenedAccess } from './types.js';

export interface OpenOptions {
  /** Default `(o) => navigator.requestMIDIAccess(o)`. */
  request?: (opts: { sysex: false }) => Promise<MIDIAccess>;
  /** Default `navigator.permissions.query({ name: 'midi' })`, guarded. */
  queryPermission?: () => Promise<PermissionState>;
}

/**
 * Calls `request({ sysex: false })`, attaches to every connected input but Midi Through, and
 * follows `onstatechange`. Resolves the connection, or rejects with an `AccessRefusal` string.
 */
export function openMidiAccess(events: AccessEvents, opts?: OpenOptions): Promise<OpenedAccess>;
```

### 2.4 `apps/web/src/midi/piano.ts` (static; no Web MIDI call but the feature test and the permission query)

```ts
import type { NoteMessage, PianoSnapshot } from './types.js';

export function midiSupported(nav?: Navigator): boolean;
/** 'granted' | 'prompt' | 'denied'; a missing or throwing query answers 'prompt'. */
export function midiPermission(nav?: Navigator): Promise<PermissionState>;

export function pianoSnapshot(): PianoSnapshot;
/** useSyncExternalStore over the snapshot; the first use anywhere runs `resumePiano()` once. */
export function usePianoSnapshot(): PianoSnapshot;
export function heldPitches(): readonly number[];
/** useSyncExternalStore over the held pitches (ascending, same array until a change). */
export function useHeldPitches(): readonly number[];
/** Every merged note-on and note-off, synchronously as messages arrive. Returns the unsubscribe. */
export function subscribeNotes(listener: (e: NoteMessage) => void): () => void;

/** The home line's press: 'asking', then import('./access.js') and open; sets settings.playAlong. */
export function askForPiano(): Promise<void>;
/** Closes the access, releases the keys, sets settings.playAlong false; status 'off'. */
export function turnOffPiano(): void;
/** Once per page: with settings.playAlong true and the permission 'granted', opens silently. */
export function resumePiano(): Promise<void>;
/** Windows Chromium's flag for Bluetooth MIDI, or null. */
export function bluetoothFlag(nav?: Navigator): string | null;
/** Tests only: forgets the connection, the store and the resume. */
export function resetPianoForTests(): void;
```

`piano.ts` imports `./access.js` only through `import()`. A source test checks that there is no static import of it.

### 2.5 `apps/web/src/app/store.ts`

- `Settings.playAlong: boolean`, with the doc comment: "The reader turned on playing along on their own piano (issue 182). The browser's MIDI permission is separate; a later visit opens MIDI silently only when it is already granted."
- `DEFAULT_SETTINGS.playAlong = false`.
- `pickSettings` keeps it only when it is a boolean.

### 2.6 `apps/web/src/score/playAlong.ts` (pure; imports only types and `@digitus2/engine/ornaments`)

```ts
import type { Hand } from '@digitus2/engine';
import type { Performance } from '../audio/performance.js';

export const ALONG_EPS = 1e-9;

/** One step to play (issue 182): where it starts in the performance, and the pitches it needs. */
export interface AlongStep {
  perfSec: number;
  /** Distinct, ascending (section 1.1 of the plan; ornaments as in ruling 5). */
  pitches: readonly number[];
}
export function alongSteps(perf: Performance, mutedHands: readonly Hand[]): AlongStep[];

/** A loop stretch in performance seconds, `to` exclusive. */
export interface PerfRange {
  from: number;
  to: number;
}

/**
 * The step the red waits on for a stopped position, -1 when there is none.
 * - 'next': the first step at or after `perfSec - ALONG_EPS`.
 * - 'marked': the last step at or before `perfSec + ALONG_EPS`, else the first.
 * Within `loop` (the steps with `from - EPS <= perfSec < to - EPS`): a position outside it gives
 * the loop's first step; past its last step, its first step. Without a loop, past the last step
 * gives step 0. -1 when the loop holds no step, or there are no steps.
 */
export function anchorStep(
  steps: readonly AlongStep[],
  perfSec: number,
  loop: PerfRange | null,
  mode: 'next' | 'marked',
): number;

/** The keys held on the piano now, each with whether its press is still fresh (unused). */
export type Keys = ReadonlyMap<number, boolean>;
export const NO_KEYS: Keys;
export function pressKey(keys: Keys, midi: number): Keys; // held, fresh
export function releaseKey(keys: Keys, midi: number): Keys;
/** Every held key no longer fresh (an external move). */
export function spendAll(keys: Keys): Keys;

export type AlongMove = { kind: 'stay' } | { kind: 'cue'; index: number } | { kind: 'finish' };

/**
 * From step `index`: while the current step's pitches are all held and fresh, mark them used and
 * go to the next step (inside `loop`, after its last step back to its first; without a loop,
 * after the last step: finish, and stop). At most `steps.length` passes. `passed` counts them.
 */
export function advance(
  steps: readonly AlongStep[],
  index: number,
  keys: Keys,
  loop: PerfRange | null,
): { keys: Keys; move: AlongMove; passed: number };
```

### 2.7 `apps/web/src/audio/transport.ts`

These are renames and visibility changes. Behaviour is unchanged.

```ts
/** `seek` to a performance second (the order heard). Stopped: where play() starts. Formerly the private seekPerf. */
seekPerformance(perfSec: number, opts?: { leadSec?: number }): void;
/** Where play() starts, in performance seconds. Formerly the private perfStartSec. */
performanceStartSec(): number;
/** The loop's stretch in performance seconds, or null (what loopRange() returns). */
performanceLoop(): { from: number; to: number } | null;
```

Internal callers (`seek`, `rewind`, `resyncTempo`, `setLoop`, `startSec`, `play`) call the new names.

### 2.8 `apps/web/src/score/usePlayback.ts`: new `Playback` members

```ts
/**
 * Stopped only (a no-op while the transport plays): moves the position to `perfSec`, a
 * performance second, and cues it: `cue` becomes `toWrittenSec(perf, perfSec)` and `atStart`
 * false, at 0 too. Play starts there, on that hearing. Before the first Play the position waits
 * in `pendingPerfRef`. Calling it again with the same second changes nothing (React bails out).
 */
cueAt(perfSec: number): void;
/** Where Play starts, in performance seconds (loop-aware), stopped or before the first Play. */
startPerformanceSec(): number;
/** The loop's stretch in performance seconds, the one the transport plays, or null. */
performanceLoop(): { from: number; to: number } | null;
/**
 * Stopped only: the reader played the last step (issue 182). What the transport's end does:
 * position to the top, `cue` null, `atStart` true, `ended + 1`.
 */
finish(): void;
```

Internals:

- **`positionSec()`:** `transport?.positionSec() ?? (pendingPerf !== null ? toWrittenSec(perf, pendingPerf) : pendingSec ?? 0)`.
- **`startSec()`** without a transport: when `pendingPerf` is set, it is `toWrittenSec` of `pendingPerf`, or of the loop stretch's start when `pendingPerf` lies outside it. Otherwise it is unchanged.
- **`startPerformanceSec()`** without a transport:
  - `base = pendingPerf ?? (pendingSec !== null ? toPerformanceSec(perf, pendingSec, 0) : 0)`;
  - `range = performanceLoop(perf, loop, base)`;
  - the result is `range.from` when `base` lies outside `range`, else `base`.

  With a transport it is `t.performanceStartSec()`.

- **`performanceLoop()`:** `t?.performanceLoop() ?? performanceLoop(perf, loopRef.current, base)`.
- **At transport creation:** `pendingPerf !== null ? transport.seekPerformance(pendingPerf) : pendingSec !== null && transport.seek(pendingSec)`. Both are then cleared.

### 2.9 `apps/web/src/score/Keyboard.tsx`

```ts
export interface KeyboardProps {
  /* …existing… */
  /** The keys held on the reader's piano (issue 182): a gray bar along each key's front edge, never red, never pressed. Default none. */
  held?: readonly number[];
}
```

### 2.10 `apps/web/src/score/Transport.tsx`

```ts
/** The red waits on the piece's first note for the piano (issue 182): Rewind is idle. Default false. */
atFirstNote?: boolean;
```

`rewindIdle = !playing && (playback.atStart || atFirstNote)`.

### 2.11 `apps/web/src/score/usePlayAlong.ts` and `PianoKeyboard.tsx` (static)

```ts
export interface PlayAlongOptions {
  score: Score | null;
  ready: boolean; // doc.status === 'ready'
  playable: boolean;
  playback: Playback;
  mutedHands: readonly Hand[];
  /** useCursor's currentGroup: >= 0 when a group is marked. */
  currentGroup: number;
  /** red.redAway: a flight or hop is on screen; the walk does not move meanwhile. */
  flightShown: boolean;
}
export interface PlayAlong {
  /** Section 1.3's "active": connected, ready, playable, steps, stopped, not loading. */
  active: boolean;
  /** Active and the red waits on step 0. */
  atFirst: boolean;
  /** The status hint: the current step's pitch count, or null when the hint is not shown. */
  hint: number | null;
}
export function usePlayAlong(o: PlayAlongOptions): PlayAlong;

// apps/web/src/score/PianoKeyboard.tsx: reads useHeldPitches(), so a MIDI message re-renders the keyboard only.
export function PianoKeyboard(props: Omit<KeyboardProps, 'held'>): JSX.Element;
```

Inside the hook:

- **Steps.** `steps = useMemo(() => score ? alongSteps(performanceFor(score), mutedHands) : [], [score, muteKey])`. The refs are `keysRef`, `atRef: number | null`, `indexRef` and `played: number` (state, used for the hint).
- **`canMove()`** reads refs and the synchronous getters (`playingNow()`) on every call: active && !flightShown.
- **`decide(event: NoteMessage | null)`** is one procedure, used for note events and for the align:
  1. Read `start = playback.startPerformanceSec()`. When `atRef` is not null and `|start - atRef| > ALONG_EPS`, or the steps or the loop stretch changed since `atRef` was set, treat it as an external move: `keys = spendAll(keys)` and `atRef = start`.
  2. Apply the event: `pressKey` or `releaseKey`. A release returns here.
  3. If `!canMove()`, return. Presses are kept.
  4. Pick the mode. It is `'marked'` when `cue === null && !atStart && currentGroup >= 0` (paused after a note). Otherwise it is `'next'`, and an `atStart` position counts as 0.
  5. Anchor: `i = anchorStep(steps, start, playback.performanceLoop(), mode)`. If `i < 0`, return.
  6. Advance: `advance(steps, i, keys, loop)`.
     - `finish` calls `playback.finish()` and sets `atRef = 0`.
     - Otherwise the final index `j` is the cue. When `cue === null || |start - steps[j].perfSec| > ALONG_EPS`, call `playback.cueAt(steps[j].perfSec)`. Set `atRef = steps[j].perfSec` and `indexRef = j`.
     - `played += passed`.
- **Align.** It is a passive `useEffect` that calls `decide(null)`. Its deps are `[active, flightShown, playing, loading, atStart, cue, loop, steps, currentGroup >= 0]`. It is idempotent: a second run issues no call, so StrictMode is safe.
- **Notes.** A `useEffect` subscribes to `subscribeNotes` and calls `decide(e)`. It reads `playback` and the options through refs updated in a layout effect.
- **Becoming inactive** (playing, disconnected) resets `atRef` to null. Becoming active again starts with `spendAll`.
- **Silent-run hook** (`?audio=silent` only): `window.__digitus2Along = { target(): number[]; index(): number }`. These are the current step's pitches (`[]` when not active) and `indexRef`.

### 2.12 `apps/web/src/score/ScoreView.tsx` wiring

- **`StatusInputs`** gains `alongHint: number | null`. In `scoreStatusLine` it comes last, only when the hint is set, as `info(t.score.view.playAlongHint(count))`.
- **The hook.** `const along = usePlayAlong({ score, ready: doc.status === 'ready', playable, playback, mutedHands, currentGroup, flightShown: red.redAway })`, declared **after** `useEmbellishCarry`.
- **The keyboard.** `<PianoKeyboard … />` replaces `<Keyboard … />`, with the same props.
- **Transport.** `<Transport atFirstNote={along.atFirst} … />`.
- **ScoreSheet.** `resting` gets `&& !along.active`.
- **`seekToBar`.** Its `sec <= 0` branch and the Home key's `start` branch do nothing when `along.atFirst`.

### 2.13 i18n keys (Track B owns all ten files)

**`library.ts`:**

```ts
piano: {
  start: 'Play along on your piano',
  asking: 'Allow the browser to use your piano.',
  connected: (name: string) => `${name} is connected. Open a piece and play the red note.`,
  yourPiano: 'Your piano',
  none: 'No piano found. Connect it with a USB cable, or pair it over Bluetooth and turn it on.',
  bluetoothFlag: (flag: string) => `On Windows, a Bluetooth piano also needs ${flag} set to Enabled.`,
  denied: 'The browser blocked MIDI for this site. Allow it in the site settings, then press again.',
  turnOff: 'Turn off',
},
```

**`score.ts`**, under `view`:

```ts
playAlongHint: (count: number) =>
  count > 1 ? 'Play the red notes on your piano.' : 'Play the red note on your piano.',
```

| key               | es                                                                                                    | fr                                                                                                              | nl                                                                                                | pt                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| start             | Toca junto con tu piano                                                                               | Jouer avec votre piano                                                                                          | Speel mee op je piano                                                                             | Toque junto no seu piano                                                                   |
| asking            | Permite que el navegador use tu piano.                                                                | Autorisez le navigateur à utiliser votre piano.                                                                 | Sta de browser toe je piano te gebruiken.                                                         | Permita que o navegador use seu piano.                                                     |
| connected(n)      | {n} está conectado. Abre una pieza y toca la nota roja.                                               | {n} est connecté. Ouvrez un morceau et jouez la note rouge.                                                     | {n} is verbonden. Open een stuk en speel de rode noot.                                            | {n} está conectado. Abra uma peça e toque a nota vermelha.                                 |
| yourPiano         | Tu piano                                                                                              | Votre piano                                                                                                     | Je piano                                                                                          | Seu piano                                                                                  |
| none              | No se encontró ningún piano. Conéctalo con un cable USB, o emparéjalo por Bluetooth y enciéndelo.     | Aucun piano trouvé. Branchez-le avec un câble USB, ou associez-le en Bluetooth et allumez-le.                   | Geen piano gevonden. Sluit hem aan met een USB-kabel, of koppel hem via Bluetooth en zet hem aan. | Nenhum piano encontrado. Conecte-o com um cabo USB, ou pareie por Bluetooth e ligue-o.     |
| bluetoothFlag(f)  | En Windows, un piano Bluetooth también necesita {f} en Enabled.                                       | Sous Windows, un piano Bluetooth demande aussi {f} sur Enabled.                                                 | Op Windows heeft een Bluetooth-piano ook {f} op Enabled nodig.                                    | No Windows, um piano Bluetooth também precisa de {f} em Enabled.                           |
| denied            | El navegador bloqueó MIDI para este sitio. Permítelo en la configuración del sitio y vuelve a pulsar. | Le navigateur a bloqué le MIDI pour ce site. Autorisez-le dans les paramètres du site, puis appuyez de nouveau. | De browser blokkeert MIDI voor deze site. Sta het toe in de site-instellingen en druk opnieuw.    | O navegador bloqueou o MIDI neste site. Permita nas configurações do site e toque de novo. |
| turnOff           | Desactivar                                                                                            | Désactiver                                                                                                      | Uitzetten                                                                                         | Desativar                                                                                  |
| playAlongHint(1)  | Toca la nota roja en tu piano.                                                                        | Jouez la note rouge sur votre piano.                                                                            | Speel de rode noot op je piano.                                                                   | Toque a nota vermelha no seu piano.                                                        |
| playAlongHint(>1) | Toca las notas rojas en tu piano.                                                                     | Jouez les notes rouges sur votre piano.                                                                         | Speel de rode noten op je piano.                                                                  | Toque as notas vermelhas no seu piano.                                                     |

`Enabled` stays in English: it is the label Chrome shows on the flag page.

## 3. Tests

### 3.1 Vitest (failing test first for every pure module)

**`midi/parse.test.ts`:**

- note on and note off on all 16 channels;
- velocity 0 is an off, also under running status;
- running status within one call and across two calls;
- realtime bytes F8, FA, FE and FF inside a message change nothing;
- SysEx is skipped whole, across calls, and clears running status;
- system common bytes (F1, F2, F3, F6, F4, F5) clear running status;
- data bytes with no status are ignored;
- CC 64, program change (1 data byte), pitch bend and channel pressure give no output;
- `HeldKeys`:
  - the same pitch on two channels or two inputs gives one off, when the last lets go;
  - a second on reports `on` again;
  - `dropInput` and `clear` report the offs;
  - `held()` is stable until a change.

**`midi/access.test.ts`** (fake `MIDIAccess` objects):

- `{ sysex: false }` is requested;
- the inputs' names are reported, with Midi Through left out;
- a note on yields one `note` event;
- an input plugged in later is attached and reported;
- an input unplugged is detached, and its keys give offs;
- `close` detaches every handler and `onstatechange`, and later messages are ignored;
- a rejection gives `'denied'` when the query says denied, `'dismissed'` otherwise.

**`midi/piano.test.ts`** (`vi.mock('./access.js')`):

- `midiSupported` is false without the API;
- `midiPermission` answers 'prompt' when `query` throws;
- `resumePiano` opens only when the setting is on and the permission is `granted`;
- with `prompt`, the access module is never imported;
- `askForPiano` goes through `asking` to `connected`, then `none` on unplug;
- the setting is set only on success;
- a dismissal leaves `off`, and a denial leaves `denied`;
- `turnOffPiano` closes the access, releases the keys and clears the setting;
- `bluetoothFlag` gives Chrome and Edge on Windows, and null elsewhere;
- the source of `piano.ts` has no static import of `./access.js`.

**`score/playAlong.test.ts`.** Scores are built the way `performance.test.ts` and `onsetGroups.test.ts` build them, with `MeasureInfo.form` for repeats.

`alongSteps`:

- one step per onset of the played hands, with pitches distinct and ascending;
- a held bass is not required again at the melody's next onset;
- with the right hand muted, only the left hand's pitches, and a right-hand-only onset is no step;
- grace notes are never required, and a grace-only onset is no step;
- a trill starting on the upper note requires the upper note, and one starting on the principal requires the principal;
- a tied note is one step;
- a unison of both hands is one pitch;
- a backward repeat over bars 1 and 2 gives the steps of bars 1 2 1 2 3, with `perfSec` rising;
- voltas;
- D.C. al Fine.

`anchorStep`:

- `'next'` and `'marked'` at an exact onset, between onsets, and past the last;
- outside the loop, past the loop's last step, and a loop with no step (-1).

`advance` (table driven):

- a single key fresh passes;
- a wrong key: stay;
- a chord with two of three keys: stay, then the third passes;
- a chord played apart while held passes;
- a key released before the last: stay;
- C C: the held C does not pass the second C, and released and pressed again it does;
- an early press of the next step chains, giving one cue to the end of the chain;
- the last step without a loop: finish;
- the loop's last step wraps;
- a one-step loop needs a fresh press every lap;
- `spendAll` makes held keys need a fresh press;
- the chain is bounded by the step count.

**`audio/transport.test.ts`:**

- `seekPerformance` while stopped sets where `play()` starts, on the second hearing of a repeat;
- `performanceStartSec` with a loop;
- `performanceLoop` is the stretch chosen at `setLoop`.

**`score/usePlayback.along.test.ts`** (the fakes of `usePlayback.loop.test.ts`):

- `cueAt(0)` before the first Play: `cue` is 0, `atStart` is false, and nothing rewinds;
- `cueAt` on a repeat's second hearing before the first Play:
  - `positionSec()` is the written second;
  - `startPerformanceSec()` is the performance second;
  - Play calls `seekPerformance` and starts there;
- `cueAt` while playing does nothing;
- `seek`, `rewind` and a new score clear a pending `cueAt`;
- `finish()`: `ended + 1`, `atStart`, `cue` null;
- regression: a written seek before the first Play still lands on the first hearing.

**`score/usePlayAlong.test.ts`** (renderHook under `<StrictMode>`, a fake `Playback`, the piano store driven through a mocked `access.js`):

- connected at the start: one `cueAt(steps[0])`;
- one note on advances once;
- a wrong note does nothing;
- the last step calls `finish`, and the re-cue waits while `flightShown`;
- paused with `currentGroup >= 0`: `cueAt` of the marked step, with nothing moving;
- a hands change re-anchors and needs fresh presses;
- nothing happens while playing, loading or flying;
- a press during a flight counts once it lands;
- disconnected: no calls, and the cue is kept;
- `hint` until the first pass, with the pitch count;
- `atFirst`;
- running align twice issues one `cueAt`.

**`score/Keyboard.test.tsx`:**

- `held` draws one `rect.key-held` per held pitch in range;
- `is-on-black` appears only on an unpressed, undimmed black key;
- a held key that is also pressed keeps its digit and pressed class;
- out of range is ignored;
- there is no `.is-red`.

**`score/Transport.test.tsx`:** `atFirstNote` makes Rewind `aria-disabled`.

**`score/ScoreView.test.ts`** (`scoreStatusLine`):

- the hint comes after the busy, nothing-to-play, loading and count-in lines;
- singular and plural;
- nothing when `alongHint` is null.

**`library/PianoLine.test.tsx`:**

- absent without the API;
- each status's exact English;
- the flag sentence only on Windows;
- the focus stays on the one button through `asking` and `connected` and back;
- the sentence is the `role="status"` element;
- nothing is `.is-red`;
- `LibraryView.test` still finds exactly one `.is-red`.

**`library/OwnFileLine.test.tsx`:** the piano line stands under `Open your own score`.

**`app/store.test.ts`:** `playAlong` defaults to false, persists, and is dropped when it is not a boolean.

**`design/tokens.test.ts`:** the pairs from 1.4 at 3:1 in light and dark. The two dark blocks stay identical (the existing check).

**`i18n/noDisclaimers.test.ts`:** the file list grows to `library.ts` and `score.ts` in all five languages, each with its own anchor key (`piano`, `playAlongHint`).

### 3.2 E2E helper: `apps/web/e2e/helpers/midi.ts`

```ts
export interface FakeMidiOptions {
  permission?: 'prompt' | 'granted' | 'denied'; // what permissions.query({ name: 'midi' }) answers; default 'prompt'
  answer?: 'allow' | 'block' | 'dismiss' | 'manual'; // the prompt's answer; default 'allow'
  inputs?: string[]; // connected at access time; default ['GO:PIANO MIDI 1']
  platform?: 'Windows' | 'Linux'; // overrides userAgentData.platform and the user agent's platform part
  unsupported?: boolean; // deletes navigator.requestMIDIAccess
  playAlong?: boolean; // merged into the stored settings before load
}
export function installFakeMidi(page: Page, o?: FakeMidiOptions): Promise<void>; // addInitScript, before goto
export function fakeMidi(page: Page): {
  requests(): Promise<number>;
  resolve(answer: 'allow' | 'block' | 'dismiss'): Promise<void>; // for answer 'manual'
  plug(name: string): Promise<void>;
  unplug(name?: string): Promise<void>;
  send(bytes: number[], input?: string): Promise<void>;
  noteOn(midi: number, o?: { channel?: number; velocity?: number; input?: string }): Promise<void>;
  noteOff(midi: number, o?: { channel?: number; input?: string }): Promise<void>;
  /** Presses every pitch of the current step (__digitus2Along.target()), holds 60 ms, releases. */
  playRed(): Promise<void>;
};
```

- **Permissions.** The fake patches `navigator.permissions.query` for `midi`. With `allow`, a `prompt` permission becomes `granted` and is kept in `sessionStorage` across reloads within one test.
- **Inputs** are `EventTarget`s with `id`, `name`, `state`, `connection`, `onmidimessage`, `open()` and `close()`.
- **Messages** arrive as `{ data: Uint8Array, timeStamp }`.
- **Waiting.** Every helper call waits for the subscription to exist (`__digitus2Along`, or the line's text). Assertions use `expect.poll`, never a sleep.

### 3.3 `apps/web/e2e/play-along.spec.ts` (desktop; the line tests also on `mobile`)

Every score test runs on Twinkle with `?audio=silent`, and `expectOneRed` is checked at every checkpoint.

1. **The line asks only when pressed:**
   - 0 requests on load;
   - with `manual`, the asking sentence shows and the button is busy;
   - `allow` leads to the connected sentence, the focus is still on the button, and the button reads `Turn off`;
   - axe.
2. **No piano.** The help sentence shows. The flag sentence appears with `platform: 'Windows'` and not with `'Linux'`. `plug` switches the line to connected without a reload.
3. **Blocked and dismissed.** A block shows the denied sentence. A dismissal leaves the plain line.
4. **Turn off is kept across a reload.** The plain line shows and `requests` stays 0.
5. **A later visit.** With `granted` and `playAlong`, it connects with no press. With `prompt`, `requests` stays 0.
6. **Twinkle waits:**
   - the first group is red (`cursorSec() === 0`), Play is plain, Rewind is `aria-disabled`, and the hint shows;
   - one pitch of a two-pitch step does not move it;
   - the whole step does, and the hint goes;
   - the repeated C needs a fresh press.
7. **A wrong note.** The red stays. `.key-held` is shown on that key and is never red. `strikes()` stays empty.
8. **Raw bytes.** Running status with FE between messages, and velocity-0 offs, drive the walk.
9. **Right hand only.** Left-hand pitches never move the red.
10. **Seek.** A click on bar 3 hops there, its first group waits, and `playRed` moves on within bar 3.
11. **Loop.** With a loop over bars 2 to 3, after bar 3's last group the red is on bar 2's first group, and there is no finish.
12. **Play from the red:**
    - after three steps, Play (count-in off) starts the playing cursor at that group;
    - the reader's held key shows while it plays;
    - Pause leaves the red on the marked group;
    - `playRed` moves on.
13. **Unplugged mid-wait.** The red and the cue stay, and Play is plain. `plug` and `playRed` move on.
14. **The end.** `playRed` runs until `ended`. The burst holds notes, the red flies home, then the first group is red and Rewind is `aria-disabled`. Exactly one red is sampled on every frame through the finish, with `burst.spec.ts`'s frame sampler.
15. **A repeat is walked as heard.** It uses the repeat fixture from `playback.spec.ts` (issue 50). After the last step of the first pass the red is on bar 1 again, and Play from there plays the second ending.
16. **The page turns.** At 1280 by 600, and again at 360 px wide, `scrollY` changes once as the red enters the next system, and never between steps within a system that fits. If a system taller than the band scrolls on every step at 360 px, see risk 3.
17. **`Add notes between`** keeps the red in its bar.
18. **No Web MIDI.** With `unsupported: true` in Chromium, there is no line and no request.

**`apps/web/e2e/play-along-home.spec.ts`** holds one test: "the library shows no piano line without Web MIDI". It runs in the `iphone` (WebKit) project on CI and Linux, and through `node scripts/e2e-webkit.mjs` on Windows.

**`apps/web/playwright.config.ts`:** `mobile`'s `testMatch` gains `play-along`, and `iphone`'s gains `play-along-home`.

**New rows in `apps/web/e2e/helpers/states.ts`.** Each runs in light and dark, at desktop and 360 px, and checks one red, axe and no overflow:

| State                | Reached by                                                                                                | Red          |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ------------ |
| `library-piano`      | `/`, granted, a piano, `playAlong` stored: the connected sentence and `Turn off`                          | start button |
| `library-piano-none` | `/`, granted, no input, Windows: the help and the flag (the longest copy at 360 px)                       | start button |
| `score-along`        | Twinkle, silent, connected: the first group red, the hint, its C4 also held on the piano (cued plus held) | cursor       |
| `score-along-moved`  | `score-along`, then `playRed` twice and one key held                                                      | cursor       |

## 4. Build tracks

**Track 0 (the controller, before the builders start):** write `apps/web/src/midi/types.ts` verbatim from 2.1. Tracks A to C then run in parallel against section 2. Track D runs **last**.

### Track A: the pure and lazy modules (parallel)

- [ ] `apps/web/src/midi/parse.ts`, `apps/web/src/midi/parse.test.ts`
- [ ] `apps/web/src/midi/access.ts`, `apps/web/src/midi/access.test.ts`
- [ ] `apps/web/src/score/playAlong.ts`, `apps/web/src/score/playAlong.test.ts`

Write the tests first. Run them and see them fail before implementing.

### Track B: the setting, the store of the piano, the home line, every string (parallel)

- [ ] `apps/web/src/app/store.ts`, `apps/web/src/app/store.test.ts`
- [ ] `apps/web/src/midi/piano.ts`, `apps/web/src/midi/piano.test.ts` (mocks `./access.js`; the typecheck goes green once Track A lands)
- [ ] `apps/web/src/library/PianoLine.tsx`, `apps/web/src/library/PianoLine.test.tsx`
- [ ] `apps/web/src/library/OwnFileLine.tsx`, `apps/web/src/library/OwnFileLine.test.tsx`, `apps/web/src/library/library.css` (`.piano-line { display: grid; justify-items: start; }`, `.piano-line p { overflow-wrap: anywhere; }`)
- [ ] `apps/web/src/i18n/{en,es,fr,nl,pt}/library.ts` and `apps/web/src/i18n/{en,es,fr,nl,pt}/score.ts`, including `score.view.playAlongHint`
- [ ] `apps/web/src/i18n/noDisclaimers.test.ts`

### Track C: playback, the keyboard's look, Rewind (parallel)

- [ ] `apps/web/src/audio/transport.ts`, `apps/web/src/audio/transport.test.ts`
- [ ] `apps/web/src/score/usePlayback.ts`, plus the new file `apps/web/src/score/usePlayback.along.test.ts`
- [ ] Add the four new `Playback` members as stubs to the hand-built fakes, and nothing else, so the typecheck stays green:
  - `apps/web/src/score/carry.test.ts` (`fakePlayback`);
  - `apps/web/src/score/ScoreView.letters.test.tsx`;
  - `apps/web/src/score/useCursor.test.ts`.

  `carry.switch.test.ts` uses the real `usePlayback` and needs nothing.

- [ ] `apps/web/src/score/Transport.tsx`, `apps/web/src/score/Transport.test.tsx` (`atFirstNote`, plus the stubs in its fake)
- [ ] `apps/web/src/score/Keyboard.tsx`, `apps/web/src/score/Keyboard.test.tsx`
- [ ] `apps/web/src/design/tokens.css`, `apps/web/src/design/tokens.test.ts`, `apps/web/src/design/base.css`

### Track D: wiring, e2e, docs (runs last, after A, B and C are in)

The e2e helper may be written while A to C build.

- [ ] `apps/web/src/score/usePlayAlong.ts`, `apps/web/src/score/usePlayAlong.test.tsx`
- [ ] `apps/web/src/score/PianoKeyboard.tsx`
- [ ] `apps/web/src/score/ScoreView.tsx`, `apps/web/src/score/ScoreView.test.ts`
- [ ] `apps/web/e2e/helpers/midi.ts`, `apps/web/e2e/play-along.spec.ts`, `apps/web/e2e/play-along-home.spec.ts`
- [ ] `apps/web/e2e/helpers/states.ts`, `apps/web/playwright.config.ts`
- [ ] `docs/app.md`, `docs/PROGRESS.md`
- [ ] `pnpm verify --changed`, then one full `pnpm verify`. Record the new chunk's gzip size and the library's initial KB in `docs/app.md`, under Performance budget.

## 5. Docs (Track D)

### `docs/app.md`

- **Architecture.** A short "MIDI input" paragraph covering:
  - `midi/` (static `piano.ts`; lazy `access.ts` and `parse.ts`);
  - `{ sysex: false }`, all channels, Midi Through ignored, pedal ignored;
  - no output and no sound.
- **Store.** `playAlong` in the settings list.
- **Library.** Unit 7 becomes the end line `Open your own score` and, where the browser has Web MIDI, the play-along line. A **Play along** paragraph gives:
  - every state's English text;
  - the press as consent;
  - the later visit (`granted` against `prompt`);
  - hot-plug and Turn off;
  - the Windows flag sentence.
- **Score view.** A new `#### Playing along on a piano` after "Moving through the piece", covering:
  - steps (performance order, hands, graces, ornaments, ties, unisons);
  - when a step passes (held and fresh, chords, repeated pitches, the chain, wrong notes, external moves);
  - every row of the table in 1.3;
  - the status hint;
  - no sound;
  - no breathing while waiting.
- **Cursor and keyboard.** The reader's keys: the front-edge bar, the two tokens, and cued plus held.
- **The red element rule.**
  - Add the row "Score, a piano waiting (stopped, connected)": the step's notes, with Play plain.
  - In the finish row, add that with a piano connected the red goes on to the first note after landing.
  - Add the piano line and the reader's keys to "Never red".
- **Motion.** The waiting red moves by a class swap, with no hop and no breathing.
- **Light and dark.** `--key-held` and `--key-held-on-black`, with their contrasts.
- **Testing.**
  - the two specs and the fake MIDI helper;
  - `__digitus2Along` under the test hook;
  - the four new state rows;
  - the `mobile` and `iphone` `testMatch` lists.
- **Performance budget.** The MIDI chunk and the library's initial size, re-measured.
- **Known limitations:**
  - no Web MIDI in Safari, on iPhone or on iPad, so the line is absent;
  - on Windows, a Bluetooth piano needs the WinRT MIDI flag, while USB works as is;
  - pitches are exact, so a step outside a 61-key piano's range is passed by clicking the next bar;
  - held keys outside the drawn range are not shown;
  - Firefox asks through its own site-permission prompt.

### `docs/PROGRESS.md`

- **The current-state line.** Playing along on the reader's own piano over Web MIDI, linking issue 182.
- **The decisions entry:**
  - the red waits as a cue in performance seconds;
  - held-and-fresh matching;
  - the press as consent;
  - the Windows Bluetooth flag.

There is no open-work list. The owner's on-device check (the GO:PIANO 61P over Bluetooth in Chrome with the flag) stays on issue 182's checklist.

## 6. Risks and guards

| Risk                                                                                                                                                                       | Guard                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The walk loops a repeat's first pass (a written seek goes back to the last hearing)                                                                                        | `cueAt` and `seekPerformance` only; `pendingPerfRef`; the repeat tests in `playAlong`, `transport` and `usePlayback`; e2e 15                                                                          |
| Two reds: the flight home or a hop plus a re-cue                                                                                                                           | Moves wait for `!redAway`; the align is a passive effect after RedFlight's and EndBurst's layout effects; e2e 14 samples every frame                                                                  |
| Scroll ping-pong: the cued branch resets `followRef` on every cue, which is harmless for systems that fit the band but can scroll on every step in a system taller than it | e2e 16 at 360 px. If it reproduces, the minimal fix is in `useCursor.ts`: keep `followRef` when the previous render was also cued. A three-line change, its own commit, with a `useCursor.test` case. |
| An align that re-triggers itself                                                                                                                                           | Idempotent (`                                                                                                                                                                                         | start - perfSec | <= EPS`and`cue !== null` mean no call); the StrictMode hook test counts the calls |
| A cue during the sample load moves where the pending Play starts                                                                                                           | The walk is inactive while `loading`                                                                                                                                                                  |
| The pending-position change breaks today's seek before the first Play or the carry                                                                                         | `pendingSecRef` is untouched; the regression test; `seek.spec` and `embellish.spec` in verify                                                                                                         |
| A MIDI message re-renders all of ScoreView                                                                                                                                 | Held keys are read only in `PianoKeyboard`; notes are handled in a subscription, outside render                                                                                                       |
| The library budget, with ScoreView eager                                                                                                                                   | `parse.ts` and `access.ts` only through `import()`; the source test in `piano.test.ts`; the bundle step                                                                                               |
| A permission prompt on load                                                                                                                                                | Only `permissions.query` runs on load; e2e counts `requestMIDIAccess` calls                                                                                                                           |
| Active sensing or clock bytes churn state or break running status                                                                                                          | The parser drops realtime bytes; the store notifies only on real changes                                                                                                                              |
| Stuck keys after an unplug or Turn off                                                                                                                                     | `dropInput` and `clear` emit note-offs; tests                                                                                                                                                         |
| Double note-ons (StrictMode, hot-plug, two channels)                                                                                                                       | A singleton access, handlers by property, `HeldKeys` merging                                                                                                                                          |
| Linux lists Midi Through as a piano                                                                                                                                        | The name filter; `access.test`                                                                                                                                                                        |
| Colour guard or disclaimer gate                                                                                                                                            | Grays only in `tokens.css`; "issue 182" in comments; `noDisclaimers` extended                                                                                                                         |
| Notes lost in e2e under load                                                                                                                                               | The helper waits for the subscription; `expect.poll`; keys held 60 ms                                                                                                                                 |
| Real Bluetooth on the owner's PC                                                                                                                                           | The owner's on-device check stays on issue 182's checklist                                                                                                                                            |
