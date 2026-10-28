# Hear the other hand: plan

Issue 231. The accompaniment of issue 184, which PR 210 removed, is restored in the first commit of this branch, unchanged. This plan gates it behind a saved switch in the Practice panel, off by default.

## What exists after the restore

- `audio/accompanist.ts`: the just-in-time queue that hands the instrument the other hand's notes, with a per-note stop.
- `score/accompaniment.ts`: pure. The stretches between steps (`accompanimentStretches`), and the notes of the hands left out inside them (`accompanimentNotes`).
- `score/usePlayback.ts`: `prepare` loads the samples with no gesture, under `preparing`. `accompany` and `stopAccompaniment` start and stop the other hand. `soundWaits` is true while the AudioContext is suspended and waits for a gesture. A capture listener on `pointerdown`, `pointerup` and `keydown` resumes the context.
- `score/usePlayAlong.ts`: the `accompaniment` memo (non-null when `walking && score && muteKey !== ''`), `accompaniedRef`, and the calls to `accompany` and `stopAccompaniment` in `decide`. `accompanying = active && accompaniment !== null` drives `prepare` and `soundWaits`.
- `ScoreView.tsx`: the status line's `alongSound` entry, `Click the page once to hear the other hand.` (`tap` on touch screens).
- Tests: `accompaniment.test.ts`, `accompanist.test.ts`, `usePlayAlong.accompany.test.tsx`, `usePlayback.accompany.test.ts` and `e2e/play-along-sound.spec.ts`. The restore also changed `play-along.spec.ts` and `play-along-halo.spec.ts`.

## Tasks

### 1. The setting

`app/store.ts`: `hearOtherHand: boolean` in `Settings`, with a doc comment in the style of `practiceMode`. It is false in `DEFAULT_SETTINGS` and kept by `pickSettings` when it is a boolean. Add a test to the store's test file that it round-trips and defaults to false.

### 2. The gate in the walk

`score/usePlayAlong.ts`:

- Read `hearOtherHand` from the store.
- The `accompaniment` memo returns null unless the setting is true. `accompanying`, `prepare` and `soundWaits` then follow by themselves.
- When `accompaniment` turns null while `accompaniedRef.current` is true (the switch turned off mid-stretch), stop at once: set the ref false and call `liveRef.current.playback.stopAccompaniment()` in an effect on `accompaniment`.
- Update the header comment: digitus plays the hand left out only when the reader turns on `Hear the left hand` or `Hear the right hand` (issue 231).

Tests first, in `usePlayAlong.accompany.test.tsx`:

- The existing tests seed `hearOtherHand: true` in the store wherever they expect sound.
- New: with the setting off and one hand chosen, passing steps never calls `accompany` or `prepare`.
- New: turning the setting off after a pass calls `stopAccompaniment` once, and a later pass calls no `accompany`.

### 3. The switch

`score/Transport.tsx`, `PracticeControls`:

- A new prop, `hearOtherHand?: { on: boolean; set(on: boolean): void; hand: 'L' | 'R' } | null`, shaped like `practiceMode`. `hand` is the hand that would sound. Absent or null, there is no switch.
- Markup: the same `label.check.switch` with `input type="checkbox" role="switch"` as Practice mode. It is never red.
- Placement: stacked directly on top of the Hands control. Wrap the Hands `fieldset.segmented` in a `div.hands`, and put the switch inside it first. The wrapper is a flex column (`align-items: flex-start`, gap `0.5rem`, the panel's row gap). The switch's left edge sits on the Hands control's left edge. The wrapper is there whenever Hands is: not on a one-handed piece. Check that no CSS or test relied on the fieldset being a direct child of `.transport`.
- Label: `t.transport.hearLeft` or `t.transport.hearRight`.
- Focus: when the switch leaves while it has the focus (the piano disconnects, or Practice mode turns off), move the focus to the Hands control's checked radio. Use the same ref-cleanup pattern as `practiceRef`.

`score/ScoreView.tsx`: build the prop memoised, next to `practiceMode`. It is non-null only when all of these hold:

- `along.pianoConnected`
- `practiceOn`
- `!oneHanded(score)`
- the saved `hands` is `'R'` or `'L'`

`hand` is the other one: `'L'` for `'R'`. `set` writes `setSettings({ hearOtherHand: on })`. Memoise on the booleans and the hand, so a MIDI message never renders the panel.

Strings, `i18n/*/transport.ts`:

| Language | hearLeft                | hearRight               |
| -------- | ----------------------- | ----------------------- |
| en       | Hear the left hand      | Hear the right hand     |
| es       | Oír la mano izquierda   | Oír la mano derecha     |
| fr       | Entendre la main gauche | Entendre la main droite |
| nl       | Linkerhand horen        | Rechterhand horen       |
| pt       | Ouvir a mão esquerda    | Ouvir a mão direita     |

The English entry carries a doc comment that says what the switch does (issue 231).

Tests in `Transport.test.tsx`:

- No switch without the prop.
- With the prop there is a switch named `Hear the left hand`, placed before the Hands group in the DOM. A click calls `set(true)`.
- `hand: 'R'` reads `Hear the right hand`.

### 4. The layout: Hands must not move

The panel grows upward from Play, and `.transport` is a wrapping flex row. When the reader picks `Right hand`, the switch appears, and the Hands control must stay under their pointer.

- Measure it in e2e: Minuet in G (`bach-minuet-g-major-bwv-anh-114`), piano connected, panel open. Read the Hands fieldset's `boundingBox()` with `Both hands`, click `Right hand`, then read it again once the switch is visible.
- Do this at 1280 × 900 and at 360 × 740.
What the probe of today's panel measured:

| Width | Line 1                           | Line 2                                   |
| ----- | -------------------------------- | ---------------------------------------- |
| 1280  | Practice mode, Tempo, Hands      | Metronome, Count-in, Loop bars, Add notes between |
| 360   | One control per line, Hands third | Metronome, Count-in                     |

The panel's content box is 832 px wide at 1280 and 328 px at 360.

- **Inline before Hands** wraps Hands to the next line at 1280, so Hands moves.
- **Inline after Hands** adds a line at 360, which lifts Hands.
- **Stacked in `div.hands`:** the wrapper keeps its width, so the panel does not rewrap. The line that holds Hands grows upward, and every line after it stays the same.

The one more CSS rule this needs is that the items sharing a line with the wrapper sit at the line's bottom. Without it, Practice mode and Tempo float at mid-height of the taller line at 1280.

- Add `align-self: flex-end` on `.transport > .check.switch`, `.transport > .tempo` and `.transport > .hands`.
- It is a no-op while every item of a line is 44 px high.
- Do not change `.transport`'s `align-items`. The Metronome and Loop line must keep `center` for the taller reversed-loop message.

Fade the switch in with the panel's own `practice-in` animation, which is already 0 under reduced motion. Do not reserve empty space for a hidden control.

Measure in English and in French (`Entendre la main gauche` against `Les deux | Droite | Gauche`). If the switch is wider than the Hands control in a language, the wrapper widens and may rewrap: shorten that string or report it.

Screenshot the open panel at 1280 and 360, with the switch on and off, in light and dark, into the scratchpad given in the brief.

### 5. e2e

- `play-along.spec.ts`: restore, unchanged, the test `with one hand chosen and the steps passing, the app makes no sound: no AudioContext exists`. Take it from `git show HEAD~1:apps/web/e2e/play-along.spec.ts`, around line 919, with its comment.
- Every restored test that expects digitus to sound seeds `hearOtherHand: true` through `installFakeMidi({ settings })`, in `play-along.spec.ts`, `play-along-halo.spec.ts` and `play-along-sound.spec.ts`.
- New, in `play-along-sound.spec.ts`, on Minuet in G with `hands: 'R'` seeded and the switch off:
  1. Open Practice.
  2. The switch `Hear the left hand` is off.
  3. Turn it on with a real click. The click is the user activation.
  4. The AudioContext runs, with no `Click the page once` line.
  5. Play a few steps with `midi.playRed()`.
  6. `accompanied(page)` holds only left-hand pitches of the stretches passed.
  7. Turn the switch off: what sounds is cancelled (`accompCancelled`), and a later press hands over no new notes.
- New: with `Both hands` there is no switch; with Practice mode off there is no switch.
- The layout test from task 4.
- Use Minuet in G, not Twinkle, for the new tests. The owner's rule is that Twinkle's sparse left hand misleads.

### 6. Docs

These describe the current state, in present tense, with no dates or branch names.

- `docs/app.md`. The issue 184 text is in `git show cb63531:docs/app.md`; lift it and add the switch. The passages to lift:

  | Line in cb63531 | Passage                                               |
  | --------------- | ----------------------------------------------------- |
  | 92              | Audio, Accompaniment                                  |
  | 113             | MIDI input                                            |
  | 292             | Playing along on a piano, opening paragraph           |
  | 371, 376        | Practice mode off, and the Status line rows           |
  | 418 to 447      | **The other hand**, with its bullets and state table  |
  | 466, 470        | The dock's Status line and Hands bullets              |
  | 625 to 628      | Testing: `play-along`, `play-along-sound`, `play-along-halo` |

  - MIDI input, around line 110 today: "Playing along makes no sound at all" becomes "it makes no sound for the reader's notes; the hand left out sounds only with `Hear the left hand` on".
  - Playing along on a piano: the opening paragraph.
  - **One hand** becomes **The other hand**: the issue 184 section, with the switch as its one control and Hands choosing which hand the switch would sound. Keep the 89 ms table as the measured lag, and say the switch is off by default because of it. No UI disclaimer.
  - The Practice panel list: a bullet for the switch, saying where it is, when it shows, that it is above Hands so the Hands control stays still, that it is saved, and its focus rule.
  - Known limitations: the lag of notes that start with the reader's.
- `docs/PROGRESS.md`:
  - Line 11: playing along makes no sound unless the reader turns on `Hear the left hand` or `Hear the right hand` (issue 231).
  - The decision near line 170, "Digitus does not play the hand left out": rewrite it as a decision. Digitus plays the hand left out only when the reader turns the switch on, off by default. The 89 ms lag is why it is off by default. The owner's words: "I kinda liked the idea … implement this as a toggle".

## Verification

- `pnpm exec vitest run` on the touched test files.
- `pnpm typecheck` and `pnpm lint` in `apps/web`.
- The e2e specs `play-along*.spec.ts` with `DIGITUS2_E2E_PORT` set to a free port. The default 4173 may be another worktree's server.
- The colour guard. A source comment must say "issue 231", never "#231".
