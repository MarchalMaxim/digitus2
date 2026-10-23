# A Practice mode switch: keep the piano connected and play the song as normal (issue 191)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers do not run git; the controller commits each task with explicit paths.

## Goal

A reader with a piano connected can stop the walk without disconnecting the piano.

- A `Practice mode` switch heads the dock's Practice panel. It shows only while a piano is connected, and it is on by default.
- **On:** the walk runs as in issues 182, 184 and 185.
- **Off:** the score page behaves exactly as with no piano. Play plays the piece, the red follows the music, and nothing waits. There is no hold cue, no hint and no accompaniment.
- **Either way,** the keys the reader presses show on the on-screen keyboard.
- The choice is remembered per browser.

The owner chose "A switch, Play as normal. In the Practice panel." Commit messages end with `(issue 191)`.

**Read first:**

- `CLAUDE.md` and `docs/PROGRESS.md`.
- `docs/app.md`, these sections:
  - Store;
  - Playing along on a piano, including The other hand;
  - The dock and Practice;
  - The red element rule;
  - Testing (the `play-along` line).
- The plans `2026-10-23-play-along.md`, `2026-10-23-play-along-other-hand.md` and `2026-10-23-hold-cue.md`. Their rulings all still hold while Practice mode is on.

## Architecture

**One gate.** Everything Off does already exists: the walk's inactive path, the `!o.active` branch of `decide` in `score/usePlayAlong.ts`. Today that path runs when the piano goes. This plan adds one boolean to it, and no new code path.

| File                                       | Change                                                                                                                                                                                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/store.ts`                             | New setting `practiceMode: boolean`, default `true`, persisted in `digitus2.settings.v1` through `safeStorage`. `merge` starts from `DEFAULT_SETTINGS`, so an old payload reads `true`.                                                        |
| `score/usePlayAlong.ts`                    | `walking = connected && practiceMode` replaces `connected` in the `alongPlan` memo, the accompaniment memo and `active`. The hook also returns `pianoConnected`: the setting is on and the status is `connected`, whatever Practice mode says. |
| `score/Transport.tsx` (`PracticeControls`) | New optional prop `practiceMode?: { on: boolean; set(on: boolean): void } \| null`, shaped like `embellish`. When present, the switch is rendered first in the panel.                                                                          |
| `score/ScoreView.tsx`                      | Passes `practiceMode={along.pianoConnected ? { on, set } : null}`, memoised.                                                                                                                                                                   |
| `i18n/{en,es,fr,nl,pt}/transport.ts`       | One string, `practiceMode`.                                                                                                                                                                                                                    |
| `design/base.css`                          | One rule for the drawn switch (ruling 5).                                                                                                                                                                                                      |

**Not touched:**

- `score/playAlong.ts`, `score/accompaniment.ts`, `score/keyLevels.ts` and `score/useKeyLevels.ts`;
- `PianoKeyboard.tsx` and `Keyboard.tsx`;
- `usePlayback.ts`, `audio/*` and `midi/*`;
- `library/PianoLine.tsx`;
- `tokens.css`.

## Rulings (fixed)

1. **Off is "no piano" for the walk, and nothing else.**
   - `walking = setting && practiceMode && status === 'connected'` gates `alongPlan`, the accompaniment plan and `active`.
   - The piano store, `subscribeNotes`, `useHeldPitches` and the home line are untouched. The piano stays connected, and `PianoKeyboard` still draws every held key's gray bar.
   - No level is drawn while Off: the level store is cleared, and only the walk writes it.
2. **Turning it off ends the walk as an external move does.** The existing `!o.active` branch, reached through the align effect, already does this:
   - it stops the accompaniment (`stopAccompaniment`, only if the walk started one);
   - it clears the levels, the early flag and the wake-up timer;
   - it sets `index` to -1 and `atRef` to null.

   The cue stays where the walk left it, Play is plain and starts there, as on an unplug. Turning it off while Play plays changes nothing visible.

3. **Turning it on again resumes from where the red stands, with the keys spent.**
   - `atRef` is null, so the first `decide` is a `moved` and runs `spendAll`. A key held through the switch, or pressed while Off, never counts; a fresh press does.
   - `anchorStep` picks the step.
   - The play hint follows its existing rule.
4. **Where it sits: first in the Practice panel, before Tempo.**
   - It decides what Hands means and what the red does with the reader's playing.
   - The panel opens upward from Play, so a row added at the top when the piano connects moves no other control.
5. **The control: a drawn switch, the owner's "slider".**
   - **Markup:** `<label className="check switch"><input type="checkbox" role="switch" …/> {t.transport.practiceMode}</label>`.
   - **The drawing:** `base.css` draws `input[role='switch']` with `appearance: none`.
     - A track about 36 × 20 px with a 1 px `var(--ink)` border, and a 14 px round thumb.
     - Off: the track is `var(--paper)` and the thumb `var(--gray-3)`, at left.
     - On: the track is `var(--ink)` and the thumb `var(--paper)`, at right.
     - The thumb slides over `var(--dur-fast)`. It is instant under reduced motion, since the tokens are 0 there.
     - Focus shows the app's focus ring.
     - Use only existing tokens; never red; correct in both themes.
   - **Size:** the row stays 44 px high.
   - **Name and announcement:** the label is the accessible name, so a screen reader says "Practice mode, switch, on" and Space toggles it.
   - **Scope:** the other tick boxes in the panel stay as they are.
6. **Focus when it goes.** If the piano is unplugged while the switch has focus, focus moves to the Tempo slider. It uses the ref-cleanup pattern of `addNotesRef`.
7. **Hands stays, with its plain meaning while Off.** Hands means "Play plays this hand", which a reader with a piano still needs. Only issue 184's extra meaning goes while Off.
8. **The status line gets no new line.** Off, the along, hold and sound hints are all null through `active`. The switch announces its own state.
9. **The home page does not change.** `PianoLine` stays at the bottom of the home page.
10. **When it shows:** while `settings.playAlong` is on and the status is `connected`.
    - It does not show for any other status.
    - It shows on a piece where the walk has no steps too: while Off no steps are computed, so the switch cannot know.
    - It shows on a one-hand piece.
    - It shows while loading or playing, so it never jumps under the pointer.

## Interfaces

**`store.ts`.** Add `practiceMode: boolean` to `Settings`, with a doc comment, `DEFAULT_SETTINGS.practiceMode = true`, and a `pickSettings` that keeps it only when it is a boolean.

**`usePlayAlong.ts`.**

- Read `const practiceMode = useAppStore((s) => s.settings.practiceMode)`.
- Set `const connected = setting && piano.status === 'connected'` and `const walking = connected && practiceMode`.
- `walking` replaces `connected` in the plan memo, the accompaniment memo and `active`.
- `PlayAlong` gains `pianoConnected: boolean`.
- Update the file's top comment.

**`Transport.tsx`.** `practiceMode?: { on: boolean; set(on: boolean): void } | null`. The switch is the first child of `.transport`, before the tempo label.

**`ScoreView.tsx`.** Memoise the prop object on `along.pianoConnected` and `practiceMode`, with `set: (on) => setSettings({ practiceMode: on })`.

**Strings:**

| Locale | `transport.practiceMode` |
| ------ | ------------------------ |
| en     | Practice mode            |
| es     | Modo práctica            |
| fr     | Mode exercice            |
| nl     | Oefenmodus               |
| pt     | Modo de prática          |

The `en` doc comment is "The Practice switch shown while a piano is connected: on, the red waits for the reader's piano (issue 191)."

## Tasks

### Task 1: the setting, tests first

Files: `app/store.ts` and `store.test.ts`.

- [ ] Add `practiceMode: true` to the full-settings `toEqual` literals.
- [ ] Write the tests:
  - the default is `true`;
  - `setSettings({ practiceMode: false })` persists, and a rehydrate reads `false`;
  - an old payload with no field reads `true`;
  - junk (`'no'`, `0`, `null`, `{}`) reads `true`;
  - a storage whose `setItem` throws still lets `setSettings` work.

### Task 2: the gate, tests first

Files: `usePlayAlong.ts`, `usePlayAlong.test.tsx` and `usePlayAlong.accompany.test.tsx`. The tests toggle the setting with `act(() => useAppStore.getState().setSettings({ practiceMode }))`, then `s.refresh()`.

**In a new `describe('Practice mode (issue 191)')`:**

- [ ] **Off at mount:** the walk is inactive, no `cueAt` is made, the hint is null, and `pianoConnected` is true.
- [ ] **Off while a step runs:**
  - the walk becomes inactive;
  - the cue stays;
  - `levels.get().size` is 0;
  - the timer count is back to idle;
  - holding longer makes no cue.
- [ ] **Off after an early release:** the hold hint goes.
- [ ] **On again:**
  - the walk is active at the red's step;
  - a key held through the switch passes nothing;
  - a fresh press and a hold pass.
- [ ] **A key pressed while Off** does not count after On.
- [ ] **Play then Pause while Off:** the walk resumes at the paused group.
- [ ] **Off:** the test hook's `target()` is `[]`.

**In `usePlayAlong.accompany.test.tsx`:**

- [ ] Off stops the accompaniment once, and `prepare` is not called again while Off.
- [ ] On again does not stop it for its own first cue.

### Task 3: the strings and the switch, tests first

Files: the five `i18n/*/transport.ts`, `Transport.tsx`, `Transport.test.tsx`, `ScoreView.tsx` and `base.css`.

- [ ] **There is no switch** without the prop or with `null`.
- [ ] **With `{ on: true }`,** there is one `switch` named Practice mode, checked, and it is the first focusable control, before Tempo.
- [ ] **A click or Space** calls `set(false)`, and with `on: false` a click calls `set(true)`.
- [ ] **The prop going null while the switch is focused** moves the focus to Tempo.
- [ ] **Hands** is present in every case.
- [ ] **A per-locale render check** of the switch's name.

### Task 4: e2e

File: `e2e/play-along.spec.ts`, in `the score with a piano`, desktop project. Seed Off with `twinkle(page, { settings: { practiceMode: false } })`.

- [ ] **It shows only while connected, and is on by default:**
  - unplug removes it, and focus moves to Tempo;
  - plug brings it back;
  - with no piano there is none.
- [ ] **Off:**
  - `target()` is `[]`, no `rect.key-level`, and the status line is empty;
  - Play is plain and the cued notes are red (`expectOneRed`);
  - a pressed key shows `.key-held`, and the cursor does not move;
  - Play plays past the cue;
  - Pause keeps the red;
  - `strikes()` is `[]`.
- [ ] **On again:**
  - the walk continues from the red;
  - a key held through the switch does not count;
  - `playRed` moves it.
- [ ] **Off stops digitus,** with `hands: 'R'`: `accompCancelled()` grows, and nothing more is handed over.
- [ ] **Off is remembered** across a reload.
- [ ] **At 1280 and 360 px, in light and dark, with the panel open,** switch on and off:
  - `expectOneRed` and `expectNoSeriousA11y`;
  - at 360 px in `fr`: no horizontal overflow, and the row is at least 44 px with its label on one row.
- [ ] **Check the existing specs** that count `.practice-panel` checkboxes.

### Task 5: docs

**`docs/app.md`:**

- [ ] **Store:** the `practiceMode` setting.
- [ ] **Playing along on a piano:**
  - replace "The score view gets no new control" with the switch;
  - the walk is active when … and Practice mode is on;
  - a short "Practice mode" paragraph;
  - two rows in the walk table: turned off, turned on again;
  - The other hand: "With a piano connected and Practice mode on …", plus a row.
- [ ] **The dock and Practice:**
  - the switch heads the panel while a piano is connected;
  - say why it comes first and how it is drawn;
  - focus moves to Tempo when it goes;
  - the Hands bullet.
- [ ] **The red element rule:** add the switch to the never-red list.
- [ ] **Testing:** add the play-along e2e above.

**`docs/PROGRESS.md`:**

- [ ] The summary.
- [ ] The play-along decision bullet: one control, the switch, which gates the walk alone.

**The controller then:**

- [ ] Runs a full `pnpm verify`.
- [ ] Opens the PR, which closes issue 191.

## Risks and guards

| Risk                                                       | Guard                                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Off leaves a timer, a level or the accompaniment behind    | Off reuses the unplug path; unit tests on the timers, the levels and `stopAccompaniment`; e2e `accompCancelled()` |
| On again counts a key held through the switch              | `atRef` is null, so the walk sees a `moved` and runs `spendAll`; a unit test and an e2e                           |
| The switch vanishing drops the focus to the page           | The ref-cleanup moves it to Tempo; a unit test and an e2e                                                         |
| `role="switch"` on a checkbox trips axe                    | Allowed by ARIA in HTML; axe runs in both themes at both widths                                                   |
| An old payload turns the walk off                          | `merge` starts from the defaults; a store test                                                                    |
| The switch re-renders the score view on every MIDI message | The prop is memoised on two booleans                                                                              |
