# Timing feedback after a run of Play (issue 192): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers do not run git; the controller commits each task with explicit paths.

**Goal:** a beginner with a piano connected and Practice mode on presses Play and plays along. Digitus listens. When the run stops, it shows how the timing went, without punishing:

- The status line says `12 of 16 notes on time. The rings show the others.`, or `Every note on time.` when all were on time (with `Try it a little faster.` added when the Practice tempo is below 100 %).
- Only the notes that came clearly early, clearly late or not at all get a thin gray ring on the sheet: beside the note on the side the key went down, or dashed around a note not played.
- A steady lag is not judged. What the reader only listened to (a hand they did not play, the bars before they joined, a stretch they sat out, the passes after they stopped) is not judged. A run in which the reader barely played shows nothing.
- The rings stay until the next Play. The line goes as soon as anything else needs it.

During Play nothing new appears. No control is added. What Play sounds does not change.

The product goal, in the owner's words: "It's important that we give good feedback to the user about their timing, but not in a frustrating way. We want them to learn how to play well."

**Issue:** [issue 192](https://github.com/MarchalMaxim/digitus2/issues/192). The owner's choices are its last comment. Every commit message ends with `(issue 192)`. The pull request says "Part of issue 192", not "Closes": the latency table and the windows wait for the owner's piano (section 4).

**Read first:**

- `CLAUDE.md` and `docs/PROGRESS.md`.
- `docs/app.md`, these sections:
  - Audio;
  - MIDI input;
  - Playing along on a piano (including the table of states, "Paused after a note was heard");
  - The dock and Practice;
  - The red element rule;
  - Light and dark;
  - Testing.
- `docs/superpowers/plans/2026-10-23-hold-cue.md` and `2026-10-23-practice-mode.md`. Their rulings still hold.
- `docs/verification-loop.md`. A new worktree needs the benchmark datasets linked in, or the benchmark gates report SKIP, which is not a pass. It also needs `apps/web/public/piano` copied in, or the piano sounds do not load.

**Files that must not be edited:** `score/usePlayAlong.ts`, `score/Keyboard.tsx` and `score/keyLevels.ts`. Another session owns them. This plan needs none of them:

- The recorder is a new hook with its own `subscribeNotes` listener.
- The walk's hint is read from `usePlayAlong`'s existing return value, and the red's moves from `useCursor`'s `currentGroup`.

`score/ScoreView.tsx` is edited in the integration task only, in four small blocks. Tell the coordinator before that task starts, because the other session may also touch `ScoreView.tsx`.

**Architecture:**

- **`midi/types.ts`, `midi/parse.ts`, `midi/access.ts`:** `NoteMessage` gains optional `atMs` and `velocity`. `atMs` is the message's event time, checked against `performance.now()`.
- **`audio/timeline.ts`** (new, types only): the shared shapes of the run log. The controller creates it first, verbatim from section 1.1.
- **`audio/transport.ts`:**
  - Every segment carries a pass number, from a module-level counter.
  - New `heardAt(nowMs)`: the performance second heard at an instant, with its pass, not clamped and not folded.
  - New `runPasses()`: the passes of the current or last run, each saying whether it was counted in.
- **`score/usePlayback.ts`:** two optional `Playback` members, `heardAt` and `runPasses`, plus `outputLatency()` on the existing `__digitus2Keys` test hook.
- **`score/playAlong.ts`:** additive only. A sibling of `alongPlan` returns, for each step, its notes per hand, its beat and its bar in seconds. `alongPlan`'s output is unchanged.
- **`score/timing.ts`** (new, pure): the steps as the judge sees them (per hand), the hearings, the bias, the matcher, what counts and the judgement.
- **`score/render/timingMarks.ts`** (new): the ring geometry (pure), the one function that draws the shape, and draw and clear over the Verovio SVG.
- **`design/base.css`:** the ring's rules. No new token.
- **`i18n/{en,es,fr,nl,pt}/score.ts`:** three strings.
- **`score/useTimingRun.ts`** (new): the recorder. It arms, listens, maps each press to the timeline, judges at the stop, keeps the result and installs the timing log hook.
- **`score/ScoreView.tsx`:** it calls the recorder, draws and redraws the rings (in a layout effect and in `decorate`), keeps the summary's lifetime, and the status line gains the summary.
- **Not touched:**
  - `usePlayAlong.ts`, `Keyboard.tsx`, `keyLevels.ts` and `PianoKeyboard.tsx`;
  - `useCursor.ts` and `render/dom.ts`;
  - `Transport.tsx` (no control is added) and `app/store.ts`.

**Tech stack:** as the repository today. No new dependency, no lockfile change.

## Global constraints

| What                   | Value                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time axis of the judge | Performance seconds, the order heard (`audio/performance.ts`), on one "run axis" built from the pass log (R6). Tempo-free: a tempo change mid-run moves nothing. Milliseconds appear only where a tolerance, a window floor or an offset is reported: `ms = perfSec * 1000 / factor`, an offset with the factor of its own press.         |
| Time of a press        | `NoteMessage.atMs`: `e.timeStamp` when it is plausible, else arrival `performance.now()` (R3). The press is mapped to the timeline **live**, inside the `subscribeNotes` listener. The transport prunes segments 2 s after they end (`SEGMENT_KEEP_SEC`, `audio/transport.ts:55`, `:464-466`), so a press cannot be mapped after the run. |
| Colour                 | Rings are stroked with the existing `--gray-3` (`#767676` light, `#8c8c8c` dark). There is no new token and no hex anywhere outside `tokens.css`. The rings are never red, have no `opacity`, have no filter and sit in no translucent group.                                                                                             |
| Comments               | Never a hash followed by digits; write `issue 192`.                                                                                                                                                                                                                                                                                       |
| Strings                | `score.view.timingSummary(onTime, total)`, `score.view.timingAllOnTime` and `score.view.timingAllOnTimeFaster` in en, es, fr, nl and pt, built with `plural()` of `i18n/format.ts`. No disclaimers (`i18n/noDisclaimers.test.ts` already reads these files).                                                                              |
| Budget                 | `timing.ts`, `timingMarks.ts` and `useTimingRun.ts` are static and small. The transport additions live in the lazy transport chunk. The library page's initial JS stays under 150 KB gzip.                                                                                                                                                |
| React                  | A MIDI message re-renders nothing in the score view through the recorder: presses go into refs. Only the end of a run (one `setState`) and a clear re-render.                                                                                                                                                                             |

Rules:

- **No git.** Implementers do not run git. Each task ends by listing its paths, and the controller commits.
- **UI.** Black, white and grays, and exactly one red element on screen. No new control. A ring appears only after a run stops.
- **Tests first** for the matcher and judge (`timing.ts`), the plan sibling (`playAlong.ts`), the transport accessors, the ring geometry and the summary's lifetime. Watch them fail before implementing.
- **Fixtures.** `short-piano.musicxml` is 4/4 at 96 qpm. Expected seconds on a fixture come from the `audio/beats.ts` helpers (`buildBeats`, `beatTicksAt`, `measureStartSec`, `measureEndSec`, `countInBar`) and `ticksToSeconds`, never from literals.
- **Format.** Run `pnpm exec prettier --write <files>` and `pnpm lint` before handing back.
- **Docs** in present tense, with no dates, branch names or agent credits.
- **Windows.** Use the Write tool for long files. Run long commands in the background.
- **Done.**
  - Iterate with `pnpm verify --changed`.
  - Before the pull request: one full `pnpm verify`, then green CI.

## Rulings (fixed; do not re-open)

Settled against the code. A builder who finds one wrong stops and reports.

### R1. The behaviour

1. **Armed.** The recorder is armed while every one of these holds:
   - `settings.playAlong` is on and the piano is `connected`;
   - `settings.practiceMode` is on;
   - the document is `ready`;
   - the selection is `playable`;
   - a score is open.

   These are exactly the walk's gates (`usePlayAlong.ts:203`, `:217`), without "not playing".

2. **A run** is one stretch of the transport playing. It starts when `playback.playing` turns true while armed: the transport has started, after any sample load. It ends when `playback.playing` turns false. That covers Pause, the end of the piece (the transport's `onEnd` sets `playing` false in the same render as `ended + 1`), and a selection becoming unplayable, which pauses.
   - Resume after Pause is a new `play()`, and so a new run. It counts in when the count-in setting is on and it starts from a bar start (`usePlayback.ts:650-657` passes no `countIn: false`; `transport.ts:231-243` counts in only when `measureStartingAt(start)` finds a bar). Resuming at the cue mid-bar has no count-in. `PassSpan.countedIn` records which (R2.4).
   - A play carried across "Add notes between" swaps the score. The new score clears everything (item 5), and the carried play is a new run (`resume`: no count-in).
3. **At the start of a run** the previous result (rings and summary) is cleared. The judge takes only the presses whose pass is in `runPasses()`, so no press is lost to the effect that sees `playing` turn true after the listener has already recorded one. The press list has one rule (A13):
   - it is emptied on every discard (item 5);
   - after each judgement, the presses whose pass is at most the judged run's highest pass are dropped. Pass numbers are unique across transports (R2.2), so the presses of an earlier score can never feed a later run.
4. **At the end of a run**, if still armed and the run was armed from its start:
   - the recorder reads `playback.runPasses()`;
   - it judges (R4);
   - it stores the result in one `setState`.

   A judgement of `null` (barely played, R4.8) stores nothing, so nothing shows.

5. **Discard and clear.** Each of these clears any result shown and discards a run in progress (nothing is judged at its end):
   - a new score, including the "Add notes between" swap;
   - a change of the hands played (the mute key, as `usePlayAlong.ts:212`);
   - Practice mode turned off;
   - the piano going away (status not `connected`, or the setting off);
   - the document leaving `ready`.

   Practice mode turned **on** mid-run does not start recording mid-run. That run was not armed at its start, so it is not judged.

6. **No live feedback.** During a run nothing is drawn and the status line is unchanged (count-in, loading). A loop goes straight into its next pass, so rings are never drawn per pass.
7. **What counts as the run's notes.** The judged unit is a step's part on one staff, one hand (R4.1). Its hearings come from the steps of the hands Play plays: the steps `alongPlan(perf, mutedHandsFor(hands))` gives, the same steps the walk uses. Of those hearings, only the ones the reader played along to are counted (R4.5):
   - only hearings at or after where their pass started (a loop pass runs from `loop.from` to `loop.to`);
   - only between the first and the last matched hearing of each continuous stretch of the run axis, so the bars before the reader joined and the passes after they stopped are not judged; inside, a long unplayed stretch is listening and is not judged either;
   - not a hand the reader did not play;
   - not a note answered by a wrong key on its beat (the walk deals with note errors);
   - not a late or missed note in the first beat of a pass Play started without a count-in (reaction time is not judged);
   - in a pass cut by a seek or by the stop, only the hearings whose late window closed before the cut, so a note heard just before Pause is never marked.
8. **Seek mid-run** (a click on a bar, the arrow keys, Rewind while playing, a loop change that seeks): the run goes on. The transport starts a new pass at the target (R2). Hearings on both sides count, each side in its own stretch.
9. **Tempo change mid-run:** the run goes on. The judge's axis is performance seconds and does not care. Each press's offset converts to ms with the factor in force when it was heard; tolerances and window floors use the factor at the end of the run.
10. **The end of the piece:** the finish (`EndBurst.tsx`) and the rings appear in the same render, and the burst is ink only. The summary takes the status line. The red then flies home and the first note is cued, and the page scrolls back to it (`docs/app.md`, the last step played), so rings near the end may be out of view. That is accepted for this iteration: `docs/app.md` says so, and the pull request lists it as a decision for the owner.
11. **The red after the stop.** After Pause with a piano connected, the last group heard stays red and becomes the cue (`docs/app.md:349`, "Paused after a note was heard"); after the end it is the first note. Rings sit in the `g.staff`, never inside a `g.note` or `g.chord`, so the `.is-red` rules (`svg .is-red *`) never reach a ring, and the red stays one element.
12. **A run with no presses**, or with fewer matched hearings than the threshold (R4.8), shows nothing. The previous run's rings were already cleared at its start.

### R2. The timeline accessor (Transport and Playback)

1. **What exists does not fit.**
   - `Transport.positionSec` (`audio/transport.ts:385-387`) is written seconds, so it cannot tell the hearings of a repeat apart.
   - `perfPositionSec` (`:389-405`) is private, and it is wrong for timing in three ways:
     - it clamps before the first segment (`:394`, during the start delay and the count-in);
     - it folds loop passes with a modulo (`:400-403`);
     - it clamps at `endSec` (`:404`).
2. **New on `Segment`** (`:41-45`): `pass: number`.
   - The counter is module-level in `transport.ts` (`let passSeq = 0`), not a field: the transport is rebuilt per score, and a pass number must be unique across every `Transport` of the page's life. It is never reset.
   - `play()` (`:224-256`) and `seekPerformance()` while playing (`:283-302`) create a segment with a new pass (`++passSeq`). `resyncTempo` (`:338-356`) does too, because it goes through `seekPerformance` (item 5).
   - A loop wrap in `step()` (`:450-459`) creates a segment with a new pass.
   - `setTempoFactor` (`:334`) appends a segment with the current segment's pass.
3. **New public `heardAt(nowMs?: number): HeardAt | null`.** `nowMs` is a `performance.now()` millisecond, as `audibleTime`'s `now` (`audio/clock.ts:18`).
   - It is null while stopped or with no segment.
   - Otherwise, with `now = performance.now()`, `t = audibleTime(this.ctx, now) - (now - (nowMs ?? now)) / 1000`. It is not `audibleTime(ctx, nowMs)`: without a usable output timestamp `audibleTime` returns `currentTime` and ignores its `now` (`audio/clock.ts:28`), so every press would map to the moment it is handled. That covers Chromium before output starts and headless e2e. The subtraction is right on both paths.
   - The segment is the last one with `ctx <= t`. When there is none (the start delay, the count-in, a seek's lead) it is `segments[0]`.
   - It returns `{ pass: seg.pass, perfSec: seg.score + (t - seg.ctx) * seg.factor, factor: seg.factor }`, with no clamp and no modulo.

   So a press 300 ms into a 4-beat count-in at 100 qpm reads `perfSec = start - (2.4 - 0.3)`.

4. **New public `runPasses(): PassSpan[]`**, a copy of `runLog`. `runLog` is rebuilt by:
   - **`play()`:** `runLog = [{ pass, fromSec: start, toSec: null, wrapped: false, countedIn }]`, with `countedIn = this.countInClicks.length > 0` (true exactly when `play()` scheduled count-in clicks).
   - **A wrap in `step()`:** the open pass gets `toSec = range.to` and `wrapped = true`. Then `{ pass: newPass, fromSec: range.from, toSec: null, wrapped: false, countedIn: <the wrapped pass's countedIn> }` is pushed: a wrap carries the flag on.
   - **`seekPerformance` while playing,** before the segments are replaced: `closeRunAt(this.heardAt())`. Then `{ pass: newPass, fromSec: target, toSec: null, wrapped: false, countedIn: false }` is pushed.
   - **`resyncTempo`** goes through the same path, except that the open pass is closed at the very second the new pass starts from (`toSec = target`, after dropping unheard passes as `closeRunAt` does), so the next pass's `fromSec` equals it and the axis stays continuous (R6). The new pass has `countedIn: false`.
   - **`pause()`,** before `halt()`: `closeRunAt(this.heardAt())`.
   - **The end in `step()`** (`:473-481`): the open pass gets `toSec = endSec`, before `halt()`.
   - **`dispose()` while playing:** `closeRunAt(this.heardAt())`.

   `closeRunAt(h)`:
   - drops every pass with `pass > h.pass` (a wrap or seek scheduled but never heard);
   - then sets the pass `h.pass` to `toSec = max(fromSec, h.perfSec)` and `wrapped = false`. A wrap marks its pass wrapped when it is scheduled, up to the look-ahead plus the output latency before it is heard. A stop in that gap cut the pass short, and the cut guard must apply to it.

   A pause during the count-in leaves an empty pass. The log survives `halt()` and is replaced by the next `play()`.

5. **A resync** splits a pass in two at the heard position with no gap: `toSec` of the first equals `fromSec` of the second, so the pass is _continued_ (R6). Hearings at the split go to the second pass (`fromSec - ALONG_EPS`). No cut guard applies at a continued pass end, and the reaction rule (R4.5) does not apply at the start of a pass that continues the previous one.
6. **`Playback`** (`score/usePlayback.ts:88-216`) gains two members:

   ```ts
   heardAt?: (atMs?: number) => HeardAt | null;
   runPasses?: () => readonly PassSpan[];
   ```

   - `heardAt` is `transportRef.current?.heardAt(atMs) ?? null`.
   - `runPasses` is `transportRef.current?.runPasses() ?? []`.

   Both are optional only so the hand-made `Playback` fakes need not change: `ScoreView.status.test.tsx:48`, `ScoreView.letters.test.tsx:53`, the `useCursor` and `usePlayAlong` test fakes. `usePlayback` always sets them, and the recorder treats a missing member as "not armed".

7. **The test hook** `__digitus2Keys` (`usePlayback.ts:504-527`) gains `outputLatency(): number | null`, which is `ctxRef.current?.outputLatency ?? null`. The research note reads it.

### R3. The event time

1. **`ParsedNote`** (`midi/parse.ts`) gains `velocity: number`. It is 0 for a note-off: `0x8n`, or `0x9n` with velocity 0. The parser already reads it (`parse.ts:68`).
2. **`NoteMessage`** (`midi/types.ts:4-12`) gains two optional fields:
   - `atMs?: number`: the key's time in `performance.now()` ms;
   - `velocity?: number`: 1..127 on a note-on.

   `lost` offs (`midi/piano.ts:162-167`) carry neither. The listener sets `atMs` on every note it reports and `velocity` on note-ons only.

3. **New pure `eventTimeMs(timeStamp: number | undefined, nowMs: number): number`** in `midi/parse.ts`. It returns `timeStamp` when `Number.isFinite(timeStamp)`, `timeStamp > 0`, `timeStamp <= nowMs + 1` and `nowMs - timeStamp <= EVENT_MAX_AGE_MS`. Otherwise it returns `nowMs`.
   - `EVENT_MAX_AGE_MS = 1000`. A busy main thread can hold a message for tens to hundreds of milliseconds, which is when the event time matters. More than a second means another time base (some backends report 0 or an epoch time).
4. **`HeldKeys.apply(inputId, n, atMs?)`** adds `atMs` to the message it returns when it is given, and `velocity` on an `on` message when `n.velocity > 0`.
   - `dropInput(inputId, atMs?)` and `clear(atMs?)` add `atMs` to the offs they make when given.
   - Without the argument the messages are exactly as today, so the existing `HeldKeys` `toEqual` checks stand.
   - The parser's own `toEqual` checks gain `velocity`. That is an expectation update, not a behaviour change.
5. **`access.ts`** (`onmidimessage`, `access.ts:76-83`): `const atMs = eventTimeMs(e.timeStamp, performance.now())` is taken once per event and passed to `held.apply(input.id, n, atMs)`. `release(id)` passes `performance.now()`.
6. **The recorder's log** keeps both times, arrival (its own `performance.now()` in the listener) and `atMs`. So `e.timeStamp` against arrival can be measured on the owner's piano.

### R4. The judging rule

All constants are exported from `score/timing.ts`. They are provisional until the owner's sessions set them (section 4). `beatSec` is the step's beat in performance seconds (R5.1); `factor` without a qualifier is the run's end factor (`RunInput.factor`).

| Constant              | Start | Why                                                                                                                                                                                                              |
| --------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOLERANCE_FLOOR_MS`  | 120   | Below roughly 100 ms a beginner cannot act on the difference. Bluetooth MIDI jitter is tens of ms, and the median takes away only the steady part.                                                               |
| `TOLERANCE_BEATS`     | 0.25  | "Clearly early" means off by more than the smallest subdivision a beginner counts. It scales with the real tempo, so a slow Practice tempo is not judged in tighter ms than a fast one.                          |
| `BIAS_SEARCH_BEATS`   | 1     | The coarse pass looks a beat either side of each hearing for the reader's steady offset, so a 350 to 450 ms Bluetooth and reaction lag is found before matching.                                                 |
| `BIAS_SEARCH_MIN_MS`  | 500   | At a fast real tempo a beat is shorter than such a lag (at 100 qpm and factor 1.5 the beat is 400 ms real), so the search reaches at least half a second.                                                        |
| `MATCH_WINDOW_BEATS`  | 0.75  | Centred on the bias, a press further than three quarters of a beat from any hearing of its pitch belongs to no note (an extra or a wrong note); a note 0.6 beat late is still found and called late, not missed. |
| `MATCH_WINDOW_MIN_MS` | 250   | At fast tempos the beat window would be narrower than the floor tolerance plus jitter.                                                                                                                           |
| `JUDGE_LAST_HEARINGS` | 3     | One slip in three is forgiven (owner's choice). Counted hearings only.                                                                                                                                           |
| `MIN_PLAYED_SHARE`    | 0.4   | Below 40 % of a hand's counted hearings matched, the reader listened to that hand; below 40 % overall, the run was listened to (owner: "a run in which the reader barely played shows nothing").                 |
| `MIN_MATCHED`         | 4     | A median of fewer than four offsets says nothing about a steady lag, and fewer than four matched hearings judge nothing.                                                                                         |
| `LISTEN_MIN_STEPS`    | 4     | A stretch of at least four consecutive unmatched hearings that also spans a full bar is listening, not missing.                                                                                                  |
| `REACTION_MIN_MS`     | 500   | Without a count-in, the reader reacts to the first sound: the first `max(beatSec, 0.5 s real)` of such a pass judges no lateness.                                                                                |
| `SEEK_GAP_SEC`        | 3600  | The run-axis gap after a pass a seek cut: no press is matched across a seek.                                                                                                                                     |

1. **Units.** A _step_ is `AlongStep` (one onset of the hands played). A step's _part_ is its notes in one hand, which is one staff (`StepPart`, R5): a chord in one hand is one part. A _hearing_ is one occurrence of a step in the run (a loop or a repeat hears a step several times); a _part-hearing_ is a part within a hearing. A _judged unit_ is a written part: all part-hearings whose written note ids are the same set (`StepPart.key`; ids are per hand, so the key names the hand too). The summary's N and M count judged units, and so do the rings: one verdict and one ring per judged unit. So a step in both hands is two units, and hands that are not together show.
2. **The hearings.** For each pass of the log, its hearings are the steps with `fromSec - ALONG_EPS <= perfSec < toSec - ALONG_EPS` (for the last pass `toSec` is its closed end). Every one of them takes part in the bias and in matching, including those the cut guard later leaves out (A14): a press for a note just before the stop is that note's, never a neighbour's.
3. **The bias (coarse pass).** For each press (note-on) whose pass is in the log, find the hearing of the same pitch whose search window holds it: centred at the hearing, half-width `max(BIAS_SEARCH_BEATS * beatSec, BIAS_SEARCH_MIN_MS / 1000 * factor)`, cut at the midpoints to that pitch's previous and next hearing. Its offset is `axis(press) - axis(hearing)`. `biasSec` is the median of these offsets when at least `MIN_MATCHED` exist, else 0.
4. **Matching (one pass, per pitch).** Each hearing and required pitch has a window centred at `axis(hearing) + biasSec`, of half-width `W = max(MATCH_WINDOW_BEATS * beatSec, MATCH_WINDOW_MIN_MS / 1000 * factor)`, cut at the midpoints to the previous and the next hearing of the same pitch (midpoints taken around the centres, so on the shifted grid). The windows of one pitch never overlap, and each press falls in at most one.
   - In each window the press nearest the centre is matched. Any other press in it is an extra and is ignored. A press in no window is _unmatched_: a wrong note or an extra.
   - So a press belongs to the hearing of its pitch nearest to `press - biasSec`. Of the same pitch repeated quickly, a press nearer the second repetition is the second's, even when that leaves the first missed.
   - A part-hearing is _matched_ when at least one of its pitches matched. Its offset is the median of its matched pitches' `(press - hearing) - biasSec`, each converted to ms with its own press's `factor` (`TimedPress.factor`). Two pitches give the mean. A rolled or unevenly landed chord is judged on its middle. A pitch of the part not matched does not make it missed: that is a note error, which the walk deals with.
   - A part-hearing with no pitch matched is _missed_.
   - A pitch in both hands' parts of a step (a unison across the hands) is one pitch, matched once, and feeds both parts.
5. **What is counted.** Only counted part-hearings feed the verdicts, the summary and the thresholds. In order:
   1. **The cut guard.** A pass that is not _continued_ (R6: it did not end by a wrap, and the next pass does not start where it ended) counts a hearing only if `axis(hearing) + max(0, biasSec) + W <= axis(pass end)`.
   2. **The played span.** The run axis splits into _stretches_ at the seek gaps (R6). In each stretch only the hearings between its first and its last matched hearing (inclusive) count; a hearing is matched here when any of its part-hearings is, whether or not the cut guard counts it. Inside that span, a run of consecutive unmatched hearings is _listening_ and does not count when it holds at least `LISTEN_MIN_STEPS` hearings and spans a full bar: `axis(the next matched hearing) - axis(its first hearing) >= barSec - ALONG_EPS`, with the `barSec` of its first hearing.
   3. **The reaction rule.** In a pass with `countedIn` false that did not begin with a wrap and does not continue the previous pass (R2.5), a part-hearing with onset `perfSec < fromSec + max(beatSec, REACTION_MIN_MS / 1000 * factor)` counts only when its own verdict (item 6, on that one hearing) is `onTime` or `early`.
   4. **A wrong key on the beat.** A part-hearing with no matched pitch, but with an unmatched press of another pitch inside its window (centred at `axis(hearing) + biasSec`, half-width `W`, with no midpoint cut), does not count: neither missed nor in the total.
   5. **A hand listened to.** For each hand, when its matched part-hearings are less than `MIN_PLAYED_SHARE` of its part-hearings still counted, the reader listened to that hand: none of its part-hearings count, so a step only in that hand counts for nothing.
6. **Tolerance** of a judged unit: `tolMs = max(TOLERANCE_FLOOR_MS, TOLERANCE_BEATS * beatSec * 1000 / factor)`. A single offset's verdict: `early` when `offsetMs < -tolMs`, `late` when `offsetMs > tolMs`, otherwise `onTime`.
7. **Verdict of a judged unit,** from its last `min(JUDGE_LAST_HEARINGS, n)` counted part-hearings in run order (a unit with none is not judged):
   - It is `missed` when more than half of them are missed: 1 of 1, 2 of 2, 2 of 3 or 3 of 3.
   - Otherwise `offsetMs` is the median of the matched ones' offsets, and the verdict is item 6's on it.
   - With 3 hearings one slip is forgiven. With 2, the matched pair's mean decides.
8. **The summary and barely played.** `total` is the number of judged units, and `onTime` is how many are `onTime`. The rings are the judged units that are not `onTime`. `judgeRun` returns `null` when the counted part-hearings number 0, when the matched ones among them number fewer than `MIN_MATCHED`, or when they are less than `MIN_PLAYED_SHARE` of them (`playedShare`).
9. **Edge cases**, each a unit test (section 2, Task 2):
   - **Chords:** pitch-level matching. One pitch of a chord pressed is enough for its part.
   - **The same pitch repeated quickly:** the midpoint cut. A press nearer to the second of two eighths is the second's, and the first is missed.
   - **Ornaments:** the required pitch is `alongPlan`'s (upper start of a trill). The later attacks of the trill are extras.
   - **Grace notes:** never a step, so their presses are extras.
   - **Ties:** the tied continuation is no step.
   - **Presses during the count-in:** they map before the pass start (R2.3), so an early press for the first note is judged early. A press more than `W` early (tapping the count-in) is ignored.
   - **Notes before where the run started:** not hearings.
   - **Unisons:** one pitch in the step, matched once.
   - **Two hands in one step:** two parts, two units, each with its own offset. Only the hands Play plays are steps. A hand played but not played along to is listened to (item 5.5).
   - **Wrong and extra notes:** ignored; a wrong key on a note's beat leaves that note out (item 5.4).
   - **The reader joins late, sits out a stretch or stops early:** not judged (item 5.2).

### R5. The judge's steps

1. **New in `playAlong.ts`:** `alongPlanNotes(perf, mutedHands)`. It returns `{ steps, times, notes }`, where `steps` and `times` are exactly `alongPlan`'s. `notes[i]` is `{ parts, beatSec, barSec }` for `steps[i]`:
   - `parts`: one entry per hand that has notes at the step, `'L'` before `'R'`, each `{ hand, ids, pitches }`: `ids` are the performance ids of that hand's non-grace notes starting at that tick, in score order, and `pitches` are their required pitches by `alongPlan`'s own rule (an ornament's upper start), distinct and ascending. The union of the parts' pitches is `steps[i].pitches`;
   - `beatSec`: the beat at that tick in performance seconds, `ticksToSeconds(tempoMap, divisions, tick + beatTicks) - ticksToSeconds(tempoMap, divisions, tick)`, with `beatTicks = beatTicksAt(perf.score, tick)`;
   - `barSec`: the length in performance seconds of the performance measure that holds the tick (`ticksToSeconds` of its start and of its start plus `lengthTicks`).

   `alongPlan` becomes `({ steps, times }) = alongPlanNotes(...)` built in the same pass, and its 80-odd `toEqual` checks stand.

2. **New in `timing.ts`:** `timingSteps(perf, mutedHands): TimingStep[]`. It maps each part's ids to written ids (`writtenNoteId`): a performance note id is `${id}@${p}` when `perf.identity` is false (`audio/performance.ts:280`), and the id itself otherwise. Strip only a final `@` followed by digits. A part's `key` is its sorted unique written ids joined by a space. Each part also gets `prev` and `next`: the nearest earlier and later step, in performance order, with a part in the same hand, as `{ ids, dSec }` (its written ids and the onset distance in performance seconds), or null. The rings use them for the local time scale (R7.3).

### R6. The run axis

`passOffsets(passes)` maps `(pass, perfSec)` to one monotone axis in performance seconds:

- `offset[0] = 0`.
- `axis(p, x) = offset[p] + (x - passes[p].fromSec)`.
- A pass is _continued_ when it is `wrapped`, or when the next pass's `fromSec` equals its `toSec` within `ALONG_EPS` (a resync).
- `offset[p+1] = offset[p] + (toSec[p] - fromSec[p]) + (continued[p] ? 0 : SEEK_GAP_SEC)`.
- A _stretch_ is a maximal run of passes joined by continued ends; stretches are separated by the seek gaps.

So a press 200 ms early for the loop's first note of pass 2, heard while pass 1's segment is in force at `x = loop.to - 0.2·factor`, lands 200 ms·factor before pass 2's first hearing.

A press whose pass is not in the log is dropped.

### R7. The rings

1. **What is marked:** each judged unit whose verdict is not `onTime`, at its written notes (`ids`), in the `g.staff` they are in (one ring per `g.staff`; a part's notes are on one staff, a cross-staff part gets one ring per staff).
2. **The shape.** A thin gray ring the size of the notehead:
   - **early and late:** a ring centred where the key went down, displaced horizontally from the notehead: to the left for early, to the right for late, because left on the sheet is earlier;
   - **missed:** a thin dashed ring centred on the notehead.

   No parentheses, brackets, chevrons, dots, x-heads or horizontal strokes: those are engraving vocabulary. The status line teaches what a ring means (R8). The shape lives in one function, `markShape` in `render/timingMarks.ts`, so the owner can swap it without touching the geometry.

3. **The geometry,** in the measure's user units, from boxes `getBBox()` returns. Let `heads` be the union box of the `g.notehead` of the unit's notes in that staff and `w` the width of one notehead (the first one's box):
   - `cy` is the middle of `heads` vertically (a chord's middle), and `cx0` its middle horizontally;
   - `r = RING_SCALE * w` with `RING_SCALE = 0.6`, one notehead for a chord too;
   - **missed:** `cx = cx0`, dashed;
   - **early and late:** the local time scale is `|cx0 - x(neighbour)| / neighbour.dSec` px per performance second, where the neighbour is `prev` for early and `next` for late, else the other one, and `x(neighbour)` is the middle of the neighbour's noteheads on that staff. A neighbour is usable only when it is drawn in the same `g.system`, on its expected side (`prev` left, `next` right). The displacement is `d = |offsetSec| * scale`, clamped to at least `w` (the side is always visible) and at most half the gap to the neighbour on that side (`|cx0 - x(neighbour on that side)| / 2`) when there is one; when the two bounds cross, `w` wins. With no usable neighbour, `d = w`. Then `cx = cx0 - d` for early and `cx0 + d` for late.

   At 360 px (Verovio scale 40) a notehead is about 9 px wide, so a ring is about 11 px across. `RING_SCALE` is the e2e's to settle: no ring may touch a fingering digit (Task 4).

4. **The stroke:** `stroke: var(--gray-3); stroke-width: 1.5px; vector-effect: non-scaling-stroke; fill: none`; the missed ring adds `stroke-dasharray: 2px 2px`. It is the same 1.5 px at every width. `--gray-3` is 4.5:1 on white and 5.6:1 on the dark paper, above the 3:1 a graphic needs. It is darker than the dimmed hand (40 % ink) in light and lighter than it in dark, so a ring never reads as a dimmed note.
5. **The DOM:**
   - `<g class="timing-mark" data-timing="early|late|missed" aria-hidden="true"><circle cx cy r/></g>` (the element `markShape` returns), appended as the last child of the `g.staff`. Never inside a `g.layer` (so no `.is-muted` dims it) and never inside `g.note` or `g.chord` (so `.is-red` never reaches it).
   - `pointer-events: none`, so hover and bar clicks pass through.
   - No `opacity` and no filter on any group (issue 79): solid gray strokes.
   - `@media print { .timing-mark { display: none } }`, so a print stays clean.
   - Reduced motion needs nothing: rings appear without motion.
6. **Drawing:**
   - `drawTimingMarks(root, marks)` draws on the pages built in `root` only. It never calls `ensureNotes`, which would build far pages and move the window's `redPage` pin (`render/pageWindow.ts:153-166`).
   - `clearTimingMarks(root)` removes every `.timing-mark`.
   - ScoreView redraws in a layout effect on `[host, doc.pages, timing.marks]` (clear, then draw), and in `decorate` (`ScoreView.tsx:292-302`) for each page built later, because a torn page is rebuilt from markup (`pageWindow.ts:185-191`).
7. **The pure part** `ringFor(input: RingInput): Ring` takes the notehead middle, `w`, the verdict, `offsetSec` and the neighbours' x and `dSec`, so the geometry is unit-tested without layout. The DOM part takes an optional `boxOf(el)` (default `el.getBBox()`), because jsdom has none.

### R8. The status line

1. **The strings,** under `score.view`, built with `plural()` from `i18n/format.ts` (numbers written by it as the other counts are). In en, es, nl and pt the first sentence pluralises on the total; in fr on the on-time count (French agrees the noun with the number before it). The second sentence appears only when `onTime < total` and names the rings: one or several, and "the other(s)" when some note was on time, "it / them" when none was. `timingSummary(1, 1)` is the first sentence alone: `1 of 1 note on time.`, `1 de 1 nota a tiempo.`, `1 note sur 1 en rythme.`, `1 van 1 noot op tijd.`, `1 de 1 nota no tempo.` (the line itself shows `timingAllOnTime` then).

   | Key                            | en                                                                                                                                                                                                                                             |
   | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `timingSummary(onTime, total)` | `${onTime} of ${total} notes on time. The rings show the others.`; total 1: `0 of 1 note on time. The ring shows it.`; one ring: `1 of 2 notes on time. The ring shows the other.`; none on time: `0 of 2 notes on time. The rings show them.` |
   | `timingAllOnTime`              | `Every note on time.`                                                                                                                                                                                                                          |
   | `timingAllOnTimeFaster`        | `Every note on time. Try it a little faster.`                                                                                                                                                                                                  |

   | Lang         | First sentence (one / other)                           | Rings: it / them / the other / the others                                                                                        | All on time / faster                                                                    |
   | ------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
   | es (total)   | `N de # nota a tiempo.` / `N de # notas a tiempo.`     | `El círculo la señala.` / `Los círculos las señalan.` / `El círculo señala la otra.` / `Los círculos señalan las demás.`         | `Todas las notas a tiempo.` / `Todas las notas a tiempo. Pruébalo un poco más rápido.`  |
   | fr (on time) | `# note sur M en rythme.` / `# notes sur M en rythme.` | `Le cercle la montre.` / `Les cercles les montrent.` / `Le cercle montre l’autre.` / `Les cercles montrent les autres.`          | `Toutes les notes en rythme.` / `Toutes les notes en rythme. Essayez un peu plus vite.` |
   | nl (total)   | `N van # noot op tijd.` / `N van de # noten op tijd.`  | `De cirkel wijst hem aan.` / `De cirkels wijzen ze aan.` / `De cirkel wijst de andere aan.` / `De cirkels wijzen de andere aan.` | `Elke noot op tijd.` / `Elke noot op tijd. Probeer het iets sneller.`                   |
   | pt (total)   | `N de # nota no tempo.` / `N de # notas no tempo.`     | `O círculo a mostra.` / `Os círculos as mostram.` / `O círculo mostra a outra.` / `Os círculos mostram as outras.`               | `Todas as notas no tempo.` / `Todas as notas no tempo. Tente um pouco mais rápido.`     |

   `timingAllOnTime` is used when `onTime === total`, and `timingAllOnTimeFaster` instead when the run ended below 100 % Practice tempo (`summary.belowFullTempo`, factor < 1). No music puns.

2. **`StatusInputs`** (`ScoreView.tsx:94-116`) gains `timing: { onTime: number; total: number; belowFullTempo: boolean } | null`.
3. **Precedence** in `scoreStatusLine` (`ScoreView.tsx:137-158`), highest first:
   1. the document busy;
   2. nothing to play;
   3. loading;
   4. count-in;
   5. the walk's sound line;
   6. the walk's `hold` hint;
   7. **the timing summary**;
   8. the walk's `play` hint.
   - The summary beats `play`: after a Pause the walk's first-step hint returns (`played === 0`) and would hide the result. A reader who just played along knows how.
4. **The summary's lifetime.** The summary leaves the line for good, and does not come back, at the first of:
   - anything above it in the precedence taking the line (a `hold` hint, a sound line, loading, a count-in, busy, nothing to play);
   - the red moving while stopped: a walk pass or a seek, seen as a change of `useCursor`'s `currentGroup` from the group it was on when the summary arrived. When the run ended at the piece's end, that baseline is the first note the red lands on after the flight home (the end's flight and cue are not a move);
   - anything that clears the rings (R1.3, R1.5).

   ScoreView keeps this with a pure reducer `summaryLifetime` (section 1.9) fed by `usePlayAlong`'s returned `hint` and `soundWaits`, the other status inputs and `currentGroup`, so `usePlayAlong` is not edited. The rings stay until the next Play or a clear (R1.5).

### R9. The timing log (test hooks)

The recorder installs `window.__digitus2Timing` when `?audio=silent` or `?hooks=1` is in the URL, with the same check and cleanup as `__digitus2Along`:

```ts
interface TimingLogEntry {
  midi: number;
  /** The recorder's own performance.now() in the listener. */
  arrivalMs: number;
  /** NoteMessage.atMs (the event time, or arrival when implausible). */
  atMs: number;
  /** Where the press was heard; null when the transport was not playing. */
  pass: number | null;
  perfSec: number | null;
  factor: number | null;
}
interface TimingHook {
  /**
   * The last 2000 note-ons heard while armed, oldest first. The cap is the log's alone: the
   * judge's own list of timed presses follows R1.3.
   */
  presses(): TimingLogEntry[];
  /** The current run's passes (`Playback.runPasses`). */
  passes(): PassSpan[];
  /** The steps of the hands played (`timingSteps`): onset, pitches and parts. */
  steps(): {
    perfSec: number;
    pitches: number[];
    parts: { hand: 'L' | 'R'; pitches: number[]; key: string }[];
  }[];
  /** `Playback.heardAt(performance.now())`. */
  heardNow(): HeardAt | null;
  /** The last run's judgement, null when none or barely played. */
  judgement(): RunJudgement | null;
}
```

## 1. Interfaces (fixed before the tasks start)

### 1.1 `apps/web/src/audio/timeline.ts` (new, types only; the controller writes it before dispatch)

```ts
/**
 * Where the transport is, as the listener hears it (issue 192): the pass of the run and the
 * performance second, never clamped or folded, so a press in the count-in reads before the pass
 * start and a press just before a loop wrap reads past the loop's end of the pass in force.
 */
export interface HeardAt {
  pass: number;
  perfSec: number;
  /** The tempo factor of the segment in force. */
  factor: number;
}

/**
 * One pass of a run of Play, in performance seconds: from Play, a seek, a resync or a loop wrap,
 * to the next of those, the stop or the end. `toSec` is null while the pass is still being heard.
 */
export interface PassSpan {
  pass: number;
  fromSec: number;
  toSec: number | null;
  /** True when it ended by a loop wrap (the next pass follows on without a gap). */
  wrapped: boolean;
  /**
   * True when play() scheduled count-in clicks before it; a wrap carries it on to the next pass,
   * and a seek or a resync starts a pass with it false. Without a count-in the reader reacts to
   * the first sound, so the first beat of such a pass judges no lateness.
   */
  countedIn: boolean;
}
```

### 1.2 `midi/types.ts` and `midi/parse.ts`

```ts
export interface NoteMessage {
  on: boolean;
  midi: number;
  lost?: true;
  /** The key's time in performance.now() ms: the event time when plausible, else arrival (issue 192). */
  atMs?: number;
  /** 1..127, on a note-on from the piano (issue 192). */
  velocity?: number;
}

export interface ParsedNote {
  on: boolean;
  channel: number;
  midi: number;
  velocity: number;
}
export const EVENT_MAX_AGE_MS = 1000;
export function eventTimeMs(timeStamp: number | undefined, nowMs: number): number;
// HeldKeys.apply(inputId, n, atMs?), dropInput(inputId, atMs?), clear(atMs?)
```

### 1.3 `audio/transport.ts`

```ts
import type { HeardAt, PassSpan } from './timeline.js';
let passSeq = 0; // module-level: unique across every Transport (issue 192)
class Transport {
  heardAt(nowMs?: number): HeardAt | null;
  runPasses(): PassSpan[];
}
```

### 1.4 `score/usePlayback.ts`

```ts
export interface Playback {
  // ...existing members...
  /** Issue 192: the transport's `heardAt`, null while stopped. Always set by usePlayback. */
  heardAt?: (atMs?: number) => HeardAt | null;
  /** Issue 192: the current or last run's passes; empty before the first Play. */
  runPasses?: () => readonly PassSpan[];
}
```

### 1.5 `score/playAlong.ts` (additive)

```ts
export interface PartNotes {
  hand: Hand;
  /** Performance ids of this hand's non-grace notes starting at the step's tick, in score order. */
  ids: readonly string[];
  /** Their required pitches (alongPlan's rule), distinct and ascending. */
  pitches: readonly number[];
}
export interface StepNotes {
  /** One per hand with notes at the step, 'L' before 'R'. */
  parts: readonly PartNotes[];
  /** The beat at the step's tick, in performance seconds (tempo map and time signature). */
  beatSec: number;
  /** The length of the performance measure holding the tick, in performance seconds. */
  barSec: number;
}
export function alongPlanNotes(
  perf: Performance,
  mutedHands: readonly Hand[],
): { steps: AlongStep[]; times: StepTime[]; notes: StepNotes[] };
```

### 1.6 `score/timing.ts` (new, pure)

```ts
import type { Hand } from '@digitus2/engine';
import type { Performance } from '../audio/performance.js';
import type { PassSpan } from '../audio/timeline.js';

export const TOLERANCE_FLOOR_MS = 120;
export const TOLERANCE_BEATS = 0.25;
export const BIAS_SEARCH_BEATS = 1;
export const BIAS_SEARCH_MIN_MS = 500;
export const MATCH_WINDOW_BEATS = 0.75;
export const MATCH_WINDOW_MIN_MS = 250;
export const JUDGE_LAST_HEARINGS = 3;
export const MIN_PLAYED_SHARE = 0.4;
export const MIN_MATCHED = 4;
export const LISTEN_MIN_STEPS = 4;
export const REACTION_MIN_MS = 500;
export const SEEK_GAP_SEC = 3600;

export interface Neighbour {
  /** Written note ids of the neighbouring onset in the same hand. */
  ids: readonly string[];
  /** Onset distance in performance seconds (positive). */
  dSec: number;
}

/** A step's notes in one hand (one staff): the judged unit (issue 192). */
export interface StepPart {
  hand: Hand;
  /** Required pitches of this hand, distinct and ascending. */
  pitches: readonly number[];
  /** Written note ids (the SVG ids). */
  ids: readonly string[];
  /** The written part: sorted unique ids joined by a space. */
  key: string;
  prev: Neighbour | null;
  next: Neighbour | null;
}

export interface TimingStep {
  perfSec: number;
  /** Required pitches of every part, distinct and ascending (AlongStep.pitches). */
  pitches: readonly number[];
  beatSec: number;
  barSec: number;
  parts: readonly StepPart[];
}

/** A note-on mapped live to the timeline. */
export interface TimedPress {
  pass: number;
  perfSec: number;
  midi: number;
  /** The factor of its HeardAt: its offset converts to ms with it. */
  factor: number;
}

export type Verdict = 'onTime' | 'early' | 'late' | 'missed';

export interface UnitVerdict {
  key: string;
  hand: Hand;
  ids: readonly string[];
  verdict: Verdict;
  /** Median offset after the bias, in ms; null when missed. */
  offsetMs: number | null;
  /** The same in performance seconds (for the ring's displacement); null when missed. */
  offsetSec: number | null;
  tolMs: number;
  /** How many counted hearings the verdict was taken from (at most JUDGE_LAST_HEARINGS). */
  hearings: number;
  prev: Neighbour | null;
  next: Neighbour | null;
}

export interface RunJudgement {
  /** One per judged unit, in the order of their first counted hearing. */
  verdicts: UnitVerdict[];
  onTime: number;
  total: number;
  /** The median signed offset subtracted, in ms (end factor). */
  biasMs: number;
  /** Matched / counted part-hearings. */
  playedShare: number;
}

export interface RunInput {
  steps: readonly TimingStep[];
  passes: readonly PassSpan[];
  presses: readonly TimedPress[];
  /** The Practice tempo factor at the end of the run: real seconds = performance seconds / factor. */
  factor: number;
}

export function writtenNoteId(perf: Performance, id: string): string;
export function timingSteps(perf: Performance, mutedHands: readonly Hand[]): TimingStep[];
/** Exported for tests: the axis offset of each pass (R6). */
export function passOffsets(passes: readonly PassSpan[]): number[];
/** Exported for tests: the coarse bias in performance seconds (R4.3). */
export function estimateBias(input: RunInput): number;
export function judgeRun(input: RunInput): RunJudgement | null;
```

### 1.7 `score/render/timingMarks.ts` (new)

```ts
export type MarkVerdict = 'early' | 'late' | 'missed';
/** The shape of timing.ts's Neighbour, declared here so this file stands alone. */
export interface MarkNeighbour {
  ids: readonly string[];
  dSec: number;
}
export interface TimingMark {
  ids: readonly string[];
  verdict: MarkVerdict;
  /** Signed offset in performance seconds (negative early); null when missed. */
  offsetSec: number | null;
  prev: MarkNeighbour | null;
  next: MarkNeighbour | null;
}
export const MARK_CLASS = 'timing-mark';
export const RING_SCALE = 0.6;
export interface RingInput {
  /** Middle of the unit's noteheads on this staff, and one notehead's width. */
  cx0: number;
  cy: number;
  w: number;
  verdict: MarkVerdict;
  offsetSec: number | null;
  /** Middle x of the neighbours' noteheads on this staff, when usable (same system, right side). */
  prev: { x: number; dSec: number } | null;
  next: { x: number; dSec: number } | null;
}
export interface Ring {
  cx: number;
  cy: number;
  r: number;
  dashed: boolean;
}
export function ringFor(input: RingInput): Ring;
/** The one place that knows the mark is a ring: swap this to change the shape. */
export function markShape(doc: Document, ring: Ring): SVGElement;
export function drawTimingMarks(
  root: Element,
  marks: readonly TimingMark[],
  boxOf?: (
    el: SVGGraphicsElement,
  ) => DOMRect | { x: number; y: number; width: number; height: number },
): number; // rings drawn
export function clearTimingMarks(root: Element): void;
```

### 1.8 `score/useTimingRun.ts` (new; integration task)

```ts
export interface TimingRunOptions {
  score: Score | null;
  ready: boolean;
  playable: boolean;
  playback: Playback;
  mutedHands: readonly Hand[];
}
export interface TimingSummary {
  onTime: number;
  total: number;
  belowFullTempo: boolean;
}
export interface TimingRun {
  /** The rings of the last run, null when none are shown. */
  marks: readonly TimingMark[] | null;
  /** The last run's summary (a new object per judgement), null when none is shown. */
  summary: TimingSummary | null;
}
export function useTimingRun(o: TimingRunOptions): TimingRun;
```

### 1.9 `score/ScoreView.tsx` (exported for tests; integration task)

```ts
export interface SummaryLife {
  /** The summary object on the line, or null once it has left. */
  shown: TimingSummary | null;
  /** The red's group the summary arrived on (or landed on after the end's flight); null while it waits for the landing. */
  baseline: number | null;
}
export function summaryLifetime(
  prev: SummaryLife,
  input: {
    summary: TimingSummary | null;
    /** A line above the summary would show (busy, nothing to play, loading, count-in, sound, hold). */
    higherLine: boolean;
    currentGroup: number;
    playing: boolean;
    /** The red is flying home after the end. */
    flyingHome: boolean;
    /** The run that gave `summary` ended at the piece's end. */
    endedAtEnd: boolean;
  },
): SummaryLife;
```

## 2. Tasks

Tasks 1, 2 and 3 run in parallel. Their paths are disjoint, and each one compiles against section 1 alone. Task 4 integrates after all three.

### Task 0 (controller, before dispatch)

- [ ] Write `apps/web/src/audio/timeline.ts`, verbatim from section 1.1.
- [ ] Check with the other session that it is not editing `score/ScoreView.tsx`. If it is, stack Task 4 after it.
- [ ] Link the benchmark datasets and copy `apps/web/public/piano` into the worktree.

### Task 1: the press time and the timeline (midi, transport, playback)

**Files:**

- `apps/web/src/midi/types.ts`
- `apps/web/src/midi/parse.ts`
- `apps/web/src/midi/parse.test.ts`
- `apps/web/src/midi/access.ts`
- `apps/web/src/midi/access.test.ts`
- `apps/web/src/audio/transport.ts`
- `apps/web/src/audio/transport.timeline.test.ts` (new)
- `apps/web/src/score/usePlayback.ts`
- `apps/web/src/score/usePlayback.timeline.test.ts` (new)

**Steps:**

- [ ] **Tests first, `parse.test.ts`:**
  - `eventTimeMs`: a plausible stamp is kept; 0, NaN, undefined, a future stamp (> now + 1) and one older than 1000 ms fall back to now.
  - The parser reports `velocity` (100 on `90 3C 64`; 0 on `80 3C 40` and on `90 3C 00`).
  - `HeldKeys.apply(id, n, 1234.5)` returns `{ on: true, midi, atMs: 1234.5, velocity: 100 }`, and an off returns `{ on: false, midi, atMs }`.
  - Without `atMs` the result is exactly as today.
  - Update the parser's existing `toEqual` expectations with `velocity`.
- [ ] **Tests first, `access.test.ts`:** a fake input's event with `timeStamp` 1000 at `performance.now()` 1010 reports `atMs: 1000`. One with no `timeStamp` (or 0) reports the stubbed now. Existing `toEqual` checks on `events.note` messages use `expect.objectContaining` or get `atMs` and `velocity` added, whichever keeps them tightest.
- [ ] Implement R3.
- [ ] **Tests first, `transport.timeline.test.ts`,** with the fake context pattern of `transport.test.ts` on `short-piano.musicxml` (4/4 at 96 qpm). Every expected second comes from the `beats.ts` helpers and `ticksToSeconds` (see `transport.test.ts:391` for the count-in), never a literal:
  - `heardAt` while stopped is null.
  - After `play()` with no count-in, at audible time `t0 + 0.3`, it is `{ pass, perfSec: start + 0.3, factor: 1 }`.
  - With a count-in, during the clicks, `perfSec < start`, linear in time, with the same pass.
  - With a loop, after the wrap is heard, `pass` is one more and `perfSec` restarts at `loop.from`. 50 ms before the wrap it is still the old pass at `loop.to - 0.05`, not folded.
  - `setTempoFactor(1.5)` mid-run keeps the pass and changes `factor` after the boundary.
  - `seekPerformance` while playing starts a new pass. During the seek's lead `perfSec < target`.
  - `runPasses()` after play, two wraps and `pause()`: three passes, the first two `wrapped` with `toSec = loop.to`, the last closed at the paused position.
  - A pause before a scheduled wrap is heard drops that pass, and leaves the last pass `wrapped: false`, closed at the heard position.
  - With a fake ctx that has no `getOutputTimestamp`, `heardAt(now - 100).perfSec` equals `heardAt(now).perfSec - 0.1 * factor`. The event time counts on the fallback path too.
  - A pause in the count-in leaves one empty pass (`toSec === fromSec`).
  - At the end, the last pass is closed at `endSec`.
  - `runPasses()` survives the stop and is replaced by the next `play()`.
  - **Pass numbers:** they never repeat across plays, and two `Transport` instances (the second built after the first is disposed, as on a new score) never share one.
  - **`countedIn`:** true after `play()` with the count-in on from a bar start (clicks scheduled); false with the count-in off, and false with it on from mid-bar (no clicks); a Play after Pause from a bar start with the setting on is true; the pass after a wrap carries the flag of the one before; a seek's pass is false.
  - **A resync** (`resyncTempo` after a tempo change): the new pass is `countedIn: false` and starts exactly where the old one was closed (`next.fromSec === prev.toSec`).
- [ ] Implement R2.2 to R2.5 in `transport.ts`. Keep `perfPositionSec` exactly as it is: the cursor's behaviour must not change.
- [ ] **Tests first, `usePlayback.timeline.test.ts`,** with the pattern of `usePlayback.along.test.ts` (stubbed `AudioContext`, mocked instrument):
  - `heardAt()` is null before Play and while stopped.
  - After Play it returns the transport's value.
  - `runPasses()` is `[]` before the first Play and the transport's log after a Pause.
- [ ] Implement R2.6 and R2.7.

**Done when:** the new tests pass, all existing midi, transport and usePlayback tests pass (expectations updated only where R3.4 says), and `pnpm verify --changed` is green for these paths.

### Task 2: the judge (pure, tests first)

**Files:**

- `apps/web/src/score/playAlong.ts`
- `apps/web/src/score/playAlong.test.ts` (additions only)
- `apps/web/src/score/timing.ts` (new)
- `apps/web/src/score/timing.test.ts` (new)

**Steps:**

- [ ] **Tests first, `playAlong.test.ts`:**
  - `alongPlanNotes(perf, muted).steps` and `.times` `toEqual` `alongPlan`'s on the fixtures already used there (repeat, voltas, grace, trill, tie, unison).
  - `notes[i].parts` lists, per hand, the non-grace notes of the played hands at that tick: graces are absent, a muted hand has no part, both voices of a unison are present, a step in both hands has an `'L'` and an `'R'` part, and the union of the parts' pitches is `steps[i].pitches`.
  - `beatSec` and `barSec` equal what `beatTicksAt`, the measure's `lengthTicks` and `ticksToSeconds` give at that tick, on a 3/4, a 4/4 and a 6/8 fixture (in 6/8 `beatTicksAt` gives an eighth, as the metronome does). Expected values are computed with those helpers, not written as literals.
  - A tempo change at a tick gives that tick's tempo.
- [ ] Implement `alongPlanNotes` (R5.1), with `alongPlan` delegating to it.
- [ ] **Tests first, `timing.test.ts`.** Synthetic steps, built by hand as `TimingStep[]` with a small builder: quarter notes at 100 qpm (`beatSec` 0.6, `barSec` 2.4, 4/4), one right-hand part per step unless stated, pitches cycling 60, 62, 64, 65, 67 so neighbours differ, factor 1 unless stated. One pass `{ pass: 1, fromSec: 0, toSec: <after the last step>, wrapped: false, countedIn: true }` unless stated. Presses are `{ pass, perfSec, midi, factor }`. "Off by x ms" means `perfSec = onset + x / 1000 * factor`. No value sits on a window, tolerance or guard boundary unless the case says it tests that boundary.
  1. Every note pressed at its onset: every verdict is `onTime`, `onTime === total`, and `biasMs` is about 0.
  2. **Steady lags (A1):** every press +200 ms, every press +350 ms and every press +450 ms: all `onTime`, `biasMs` about the lag. The same three at factor 1.5 (the search reaches `BIAS_SEARCH_MIN_MS`): all `onTime`. Every press -150 ms: all `onTime` (a steady lead is absorbed too).
  3. Twelve presses on time, one at +250 ms and one at -250 ms: exactly one `late` and one `early`, with `offsetMs` within 1 ms of ±250.
  4. **One note +0.6 beat late** (+360 ms) among on-time notes is `late`, not `missed`.
  5. Tolerance edges at 100 qpm (`tolMs = max(120, 150) = 150`), one note among on-time ones: +149 is `onTime` and +151 is `late`. At factor 0.5 (`tolMs = 300`): +290 is `onTime`. At factor 1.5 (beat 400 ms real, `tolMs = max(120, 100) = 120`): +130 is `late`.
  6. A skipped note among on-time ones is `missed`, with `offsetMs` null.
  7. **A wrong key on the beat (A5):** at one step a wrong pitch is pressed on time and the right one not: that unit is neither `missed` nor in `total`; every other verdict is unchanged. A wrong pitch pressed 0.5 s away from any onset changes nothing.
  8. Extra presses (a second press of the same pitch 100 ms after a matched one) are ignored. The nearest press to the centre wins.
  9. **Repeated eighths (A12):** on-time quarters of other pitches before and after; in between, the same pitch in eighths at `t`, `t + 0.3`, `t + 0.6`, with presses only at `t + 0.2` and `t + 0.6`. The `t + 0.2` press is the second eighth's (the cut is at `t + 0.15`): the second eighth is `onTime` with `offsetMs` about -100; the first eighth is `missed`.
  10. **A pause right after repeated eighths (A14):** on-time quarters, then eighths of one pitch at `t` and `t + 0.3`, the stop at `t + 0.6` (with `W` 0.45 s the first eighth is clear of the cut guard and the second is inside it), one press at `t + 0.2`. The first eighth is `missed`, not `late`; the second is not counted (the cut guard) yet took the press.
  11. A chord `[60, 64, 67]` in one hand with presses at 0, +20 and +40 ms: one unit, offset 20 ms, `onTime`. Only `[60]` pressed: matched, judged on it alone.
  12. **Hands not together (A4):** steps with an `'L'` part `[48]` and an `'R'` part `[60]`; the right hand on time throughout, the left hand +300 ms at one step: that step's left unit is `late`, its right unit `onTime`; `total` counts both units of every step.
  13. **A hand not played (A3):** a fixture under both hands with some steps that have only a left part, and presses only on right-hand pitches: no verdict has `hand: 'L'`, and `total` counts only the right-hand units.
  14. Barely played: 10 steps with presses at steps 0, 4 and 9 gives `null` (3 matched); 10 steps with presses at 0, 3, 6 and 9 gives a judgement (4 of 10 is exactly `MIN_PLAYED_SHARE`, and the rule is "less than"); 20 steps with presses at 0, 3, 6, 9, 12, 15 and 19 (7 of 20, no unmatched run of 4) gives `null`; no presses gives `null`.
  15. **Listening (A2):**
      - a loop of 5 passes (four wrapped, then closed), played on time in passes 1 to 3 and silent in 4 and 5: the verdicts equal those of passes 1 to 3 alone, and there is no `missed`;
      - 20 steps with the first 8 pressed on time, then silence: `total` is about 8 (the units of steps 0 to 7) and nothing is `missed`;
      - pressing from step 6 on: steps 0 to 5 are not in `total`;
      - 5 passes played only in the last 2: a judgement, from those passes;
      - 8 on time, then 2 unplayed before the stop: every note `onTime`;
      - inside the played span, an unplayed run of 5 quarters (more than a full bar) is not counted; an unplayed run of 3 is `missed`.
  16. **Loop, three passes** (wrapped, wrapped, closed, presses on time after the note in every pass): a note on time in two passes and missed in one is `onTime` (one slip forgiven). Missed in two of three is `missed`. Late (+250) in passes 2 and 3 and on time in pass 1 is `late`. With 5 passes only the last 3 count.
  17. **The wrap:** a press 200 ms early for the loop's first note in pass 2, given as `{ pass: 1, perfSec: loop.to - 0.2 }`, is matched to pass 2's first hearing and is `early` when the rest are on time (R6).
  18. **A repeat:** two steps with the same part `key` (a repeated bar in performance order) are one judged unit with two hearings.
  19. **Count-in** (`countedIn: true`): a press at `start - 0.2` s for the first note is `early`. With the first note pressed only at `start - 0.7` s (beyond both the search and the window), that press is ignored and the first note is not counted (it lies before the first matched hearing).
  20. **No count-in (A6):** `countedIn: false`, the first note pressed +300 ms: not counted (reaction), the rest judged. The first note pressed -200 ms: `early`. The same +300 ms first note in a pass that began with a wrap: `late`. The rule's `<` is strict; every other note is pressed on time, so the case rests on the first note alone.
  21. **A pass cut by a stop:** the last note pressed +300 ms and closer than `max(0, bias) + W` to the stop is not counted (no `late`); the same press on a note further than that from the stop is `late`.
  22. **A seek:** pass 1 cut at 2.0 s, pass 2 from 10.0 s. A press at pass 2 `perfSec` 9.9 matches pass 2's first hearing (`onTime`, inside the reaction window but on time), and no press matches across the gap.
  23. **A resync:** pass 1 closed at 3.0 s and pass 2 from 3.0 s (`countedIn: false`, not wrapped): `passOffsets` adds no gap, a note just before 3.0 s is not cut, and a late first note of pass 2 is `late`.
  24. **Notes before the pass start** are not hearings: pass from 1.2 s, so steps at 0 and 0.6 are not in `total`.
  25. **A press with an unknown pass** is dropped.
  26. **Offsets in ms use the press's factor (A16):** a press +0.15 perf s late at factor 0.75 reports `offsetMs` 200.
  27. `writtenNoteId`: `n12@3` gives `n12` for a non-identity performance; for an identity performance the id is kept as it is, even `a@b`. `timingSteps` on `form-repeat` gives the same part `key` for the two hearings of bar 1, and each part's `prev` and `next` are the neighbouring onsets in its hand.
  28. `passOffsets`: wrapped passes are contiguous, a resync is contiguous, and a cut pass adds `SEEK_GAP_SEC`. `estimateBias` is 0 with fewer than `MIN_MATCHED` offsets.
- [ ] Implement `timing.ts` (R4, R5.2, R6). Keep it a few small functions: `passOffsets`, `hearings`, `estimateBias`, `matchPitches(bias)`, `partHearings`, `counted` (R4.5, in its order), `verdictOf`, `judgeRun`.

**Done when:** the tests pass, the existing `playAlong.test.ts` and `usePlayAlong*.test.tsx` pass untouched, and `timing.ts` imports nothing that is not already in the static bundle.

### Task 3: the rings and the words

**Files:**

- `apps/web/src/score/render/timingMarks.ts` (new)
- `apps/web/src/score/render/timingMarks.test.ts` (new)
- `apps/web/src/design/base.css`
- `apps/web/src/i18n/en/score.ts`, `es/score.ts`, `fr/score.ts`, `nl/score.ts`, `pt/score.ts`
- `apps/web/src/i18n/timing.test.ts` (new)

`timingMarks.ts` imports nothing from `score/timing.ts`: its `MarkNeighbour` has the same shape as `Neighbour` (section 1.7), so Task 4 passes a verdict's neighbours straight through and Task 3 compiles on its own.

**Steps:**

- [ ] **Tests first, `timingMarks.test.ts`:**
  - **`ringFor`**, with `cx0: 100, cy: 50, w: 10`:
    - late, `offsetSec: 0.2`, `next: { x: 160, dSec: 0.6 }` (100 px per second): `cx` 120, `cy` 50, `r` 6, not dashed;
    - late `0.05`: the floor gives `cx` 110; late `0.4`: the ceiling (half the gap) gives `cx` 130;
    - early `-0.2` with `prev: { x: 40, dSec: 0.6 }`: `cx` 80;
    - a tight gap (`next.x` 112): half the gap is 6, below `w`, so `cx` 110;
    - late with only `prev: { x: 40, dSec: 0.6 }`: the scale from `prev`, no ceiling: `cx` 120;
    - no neighbour: `cx` 110 (late) and 90 (early);
    - missed: `cx` 100, dashed.
  - **`markShape`** returns one `circle` with `cx`, `cy`, `r` and, when dashed, the class or attribute the CSS dashes.
  - **The DOM**, with a jsdom page shaped like Verovio's (`g.system > g.measure > g.staff > g.layer > g.chord? > g.note > g.notehead | g.accid | g.dots`) and a `boxOf` stub:
    - one ring per staff per `TimingMark`, centred per `ringFor` from the stubbed boxes (a chord: the middle of its noteheads);
    - appended as the last child of `g.staff`;
    - never inside `g.layer`, `g.note` or `g.chord`;
    - `class="timing-mark"`, `data-timing`, `aria-hidden="true"`;
    - a neighbour in another `g.system`, or on the wrong side, is not used;
    - ids not on the page are skipped (returns the count drawn);
    - `clearTimingMarks` removes all;
    - drawing twice after a clear leaves one set.
  - **The CSS** (read `base.css` as text, as `Keyboard.test.tsx` does):
    - `.timing-mark` uses `var(--gray-3)` and `vector-effect: non-scaling-stroke`;
    - the missed ring is dashed;
    - it is hidden in print;
    - it has no `opacity` and no `filter`.
- [ ] Implement R7.2 to R7.7.
- [ ] Add the CSS:

  ```css
  /* The timing rings after a run of Play (issue 192): thin gray rings beside or around a note,
     never red, never translucent (issue 79: shape by shape), the same 1.5 px at every width. */
  .score-sheet svg .timing-mark,
  .score-sheet svg .timing-mark circle {
    fill: none;
    stroke: var(--gray-3);
    stroke-width: 1.5px;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .score-sheet svg .timing-mark[data-timing='missed'] circle {
    stroke-dasharray: 2px 2px;
  }
  ```

  Add `.timing-mark { display: none; }` in the existing `@media print` block of `base.css`. If there is none for the sheet, add one next to the other print rules.

- [ ] Add the three strings in five languages (R8.1), with `plural()` and a doc comment in en like the others (`/** The status line after a run of Play with the piano: how many notes came on time; the rings show the others (issue 192). */`).
- [ ] **Tests first, `i18n/timing.test.ts`:** in all five languages, `timingSummary` for (on time, total) = (0, 1), (1, 1), (0, 2) and (1, 2) gives the exact strings of R8.1, and `timingAllOnTime` and `timingAllOnTimeFaster` are as written. Then run `i18n.test.ts` and `noDisclaimers.test.ts`.

**Done when:** the tests pass, `checkColors.test.ts` and `tokens.test.ts` pass (no new hex), and the typecheck passes in every language.

### Task 4 (integration, after tasks 1 to 3): the recorder, the wiring, e2e and docs

**Files:**

- `apps/web/src/score/useTimingRun.ts` (new)
- `apps/web/src/score/useTimingRun.test.tsx` (new)
- `apps/web/src/score/ScoreView.tsx`
- `apps/web/src/score/ScoreView.status.test.tsx`
- `apps/web/e2e/helpers/midi.ts`
- `apps/web/e2e/play-along-timing.spec.ts` (new)
- `apps/web/e2e/helpers/states.ts`
- `docs/app.md`
- `docs/PROGRESS.md`
- `docs/research/play-along-timing.md` (new)

**Steps:**

- [ ] **Tests first, `useTimingRun.test.tsx`.** Use the piano store pattern of `usePlayAlong.test.tsx` (`resetPianoForTests`, a fake access feeding notes), and a fake `Playback` whose `playing`, `playingNow`, `heardAt` and `runPasses` the test drives:
  - Not armed (no piano, Practice mode off, not ready, not playable): presses are not recorded, and `marks` stays null.
  - Armed: Play, presses mapped with `heardAt(atMs)` (the test asserts the `atMs` it receives is the message's, and that each `TimedPress` carries its `HeardAt`'s factor), then stop gives `marks` and `summary` equal to `judgeRun` on the same input.
  - All on time: `summary.onTime === summary.total` and `marks` is empty or null; `belowFullTempo` follows the end factor.
  - Barely played: both null.
  - The next Play clears both at once.
  - Each of these clears and discards (the stop after it judges nothing): new score, hands change, Practice mode off, piano gone, document not ready.
  - **No leak (A13):** run, new score, run: the second judgement sees none of the first run's presses, and after a judgement the presses of its passes are gone from the judge's list.
  - Practice mode turned on mid-run: that run is not judged.
  - A `lost` off and a note-off are not presses. A note-on while `playingNow()` is false is logged with no pass and not judged.
  - The hook object (`?hooks=1` via `history.replaceState`) reads `presses`, `passes`, `steps`, `heardNow` and `judgement`, and is removed on unmount.
- [ ] Implement `useTimingRun` (R1, R9). Presses go into a ref, and the result into one `useState`. The arming state lives in a `liveRef` read by the listener, as `usePlayAlong` does. The steps are memoised on `[armed, score, muteKey]`, with `timingSteps(performanceFor(score), muted)`. The marks are built from the verdicts that are not `onTime` (`ids`, `verdict`, `offsetSec`, `prev`, `next`).
- [ ] **ScoreView,** four blocks:
  - (a) `const timing = useTimingRun({ score, ready: doc.status === 'ready', playable, playback, mutedHands })`, placed after `usePlayAlong`.
  - (b) A `timingRef` mirror, plus a layout effect on `[host, doc.pages, timing.marks]` that calls `clearTimingMarks(host)` and then `drawTimingMarks(host, marks)` when there are marks. `decorate` also calls `drawTimingMarks(page, timingRef.current ?? [])`.
  - (c) The summary's lifetime: `summaryLifetime` (section 1.9, R8.4) in a reducer fed each render with `timing.summary`, whether a higher line would show (`scoreStatusLine` with `timing: null` returns a line other than the `play` hint), `currentGroup`, `playback.playing`, `red.hopping` after an end, and whether the run ended at the end (`playback.ended` moved with the judgement).
  - (d) `timing: life.shown` in `StatusInputs`, with the precedence of R8.3 in `scoreStatusLine`.
- [ ] **`ScoreView.status.test.tsx`,** tests first:
  - the summary text in en, with one ring and with several;
  - `Every note on time.` and, below 100 %, `Every note on time. Try it a little faster.`;
  - the summary beats `play`;
  - `hold` beats the summary;
  - count-in and loading beat the summary;
  - one case in another language;
  - **`summaryLifetime`:** the summary shows; a `hold` hint takes the line; the hint goes after a walk pass (the group moved): the line is empty, not the summary again. A group change while stopped alone also ends it. At the piece's end the flight home and the first-note cue do not end it, and a move after the landing does. A new summary object shows again.
- [ ] **`e2e/helpers/midi.ts`:**
  - Add the `__digitus2Timing` type to `Windowed`.
  - **`FakeHost.send(bytes, input?, atMs?)`:** with `atMs`, the event's `timeStamp` is set to it (`Object.defineProperty(e, 'timeStamp', { value: atMs })`); without it, as today.
  - **`playAlongTimed(page, plan)`** with `plan: { hearings: { pass: number; index: number; offsetMs?: number; skip?: boolean }[]; passes: { fromSec: number; toSec: number | null }[]; holdMs?: number; pauseAt?: { pass: number; perfSec: number } }`:
    - `pass` is the pass's ordinal in the run (0 first), `index` the step's index in `__digitus2Timing.steps()`; `passes` are the passes the run is expected to go through (a loop's `fromSec`/`toSec` per pass, or the piece's span), from which the helper builds the run axis as R6 does;
    - each hearing's target is on the run axis, `axis(pass, step.perfSec) + offsetMs / 1000 * factor`, so an early press across a wrap fires while the previous pass is heard;
    - it runs in the page with a `requestAnimationFrame` loop reading `heardNow()`: on the first frame at or after a target it sends the step's note-ons stamped with the exact target instant (`now - (axisNow - target) / factor * 1000`), and the note-offs `holdMs` later (default 150);
    - `pauseAt` (performance seconds, in pass ordinal `pass`): on the first frame at or after it, the helper clicks Pause from inside the page;
    - timed in the page, never by Playwright round trips, like `tap` and `playRedTimed`.
- [ ] **`e2e/play-along-timing.spec.ts`,** on Twinkle, `?audio=silent`, the fake piano connected, `settings: { countIn: false }` and `tempo: { [TWINKLE]: 0.75 }`.
  - At 0.75 the beat is 800 ms real: `tolMs` is 200, the window's half-width is 600 ms real (cut to 400 ms at a same-pitch neighbour), and the bias search reaches 800 ms. Offsets of ±300 ms are 100 ms clear of the tolerance and of every window edge.
  - Twinkle's steps are `[48 60] [60] [67] [67] [53 69] [69] [48 67] [53 65] [65] [48 64] …`; the left hand plays 48 and 53.
  1. **Rings and summary:**
     - Press Play and run `playAlongTimed` through step 10 with step 2 at -300 ms (`[67]`, right hand only, its previous 67 is none), step 5 at +300 ms (`[69]`, a single-staff step) and step 7 skipped (`[53 65]`, both hands), `pauseAt` step 10's onset plus 0.6 s.
     - Assert through `__digitus2Timing.judgement()`: one `early` unit (step 2, right hand), one `late` (step 5, right hand), two `missed` (step 7, one per hand), every other unit `onTime`, and `biasMs` within ±60.
     - Assert in the DOM: one `[data-timing="early"]`, one `late` and two `missed`, the missed ones on different `g.staff`; the status line matches `^(\d+) of (\d+) notes on time\. The rings show the others\.$` with N = M - 4 and M equal to `judgement().total`.
     - The early ring's centre is left of its notehead's centre and the late ring's right of its notehead's, each by at least a notehead width.
     - Every logged press's `atMs` is before its `arrivalMs` (`presses()`).
     - One red (`expectOneRed`), and axe has no serious issues.
  2. **Every note on time:** offsets all 0 through step 8, then `pauseAt`. The line is `Every note on time. Try it a little faster.` (tempo 0.75) and there is no `.timing-mark`.
  3. **Barely played:** Play, press nothing for three steps, Pause. No rings and no summary. The walk's hint line is as before.
  4. **Clears:** after case 1, Play clears the rings and the line at once (before any note). The second run replays case 1's plan; after its Pause the rings and the line are present again. Toggling the Hands control removes them. Then a third run with the same plan, and turning Practice mode off removes them.
  5. **Loop, one slip:** with Loop bars 1 to 1, three passes with one note late in the first pass only. After Pause it is `onTime` (one slip forgiven).
  6. **Loop, the reader stops:** with Loop bars 1 to 1, the reader plays passes 1 and 2 on time and nothing in passes 3 and 4, then Pause: no `missed` ring, and the summary counts the units of passes 1 and 2.
  7. **Light and dark, 360 px:** case 1 at 360 x 800 in both themes:
     - no horizontal overflow (`horizontalOverflow`);
     - exactly one red;
     - axe passes;
     - every ring's computed stroke is the `--gray-3` of the theme;
     - no ring's box intersects any fingering digit's box (`g.fing`).
  8. **Screenshots for the owner (A17):** case 1's end state saved as `build/timing-marks/light-360.png`, `dark-360.png`, `light-1280.png` and `dark-1280.png` (`build/` is ignored by git). The step is skipped in CI (`test.skip(!!process.env.CI)`) if it slows the run.
- [ ] **`e2e/helpers/states.ts`:** add `score-timing-marks`. It reaches case 1's end state. After the Pause the last group heard stays red as the cue (`docs/app.md`, "Paused after a note was heard"); set its `expectTag` to what `states.spec.ts` shows for that red (the paused cursor's group, `'cursor'` or `'note'`), confirmed by running it. `states.spec.ts` then checks one red, axe and no overflow, on desktop and mobile.
- [ ] **Docs** (section 4).
- [ ] The controller sends the four screenshots to the owner with SendUserFile, and the pull request says what they show.

**Done when:**

- `pnpm verify --changed` is green;
- one full `pnpm verify` is green, with the benchmark datasets linked so no gate shows SKIP;
- CI is green.

## 3. Behaviour summary for reviewers

| Situation                                              | What happens                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Play with piano and Practice mode on                   | Recording starts as the transport plays. Last run's rings and line clear.                                                                  |
| Count-in                                               | Presses map before the start. Only one inside the first note's window counts (as early).                                                   |
| No count-in (the setting off, or a resume mid-bar)     | A late or missed note in the first beat is not judged: the reader reacts to the first sound.                                               |
| Loop pass                                              | Hearings per pass. A unit's verdict uses its last 3 counted hearings. Nothing is shown between passes.                                     |
| The reader joins late, sits out a bar or stops early   | Those notes are listening: not counted, not marked.                                                                                        |
| A hand the reader did not play                         | Not judged.                                                                                                                                |
| Both hands played                                      | Each hand's part of a step is its own unit: hands not together show.                                                                       |
| A wrong key on the beat                                | That note is left out of the count.                                                                                                        |
| Seek / Rewind while playing                            | A new pass. Both sides count. No matching across the seek.                                                                                 |
| Tempo change while playing                             | No effect on matching. Each offset uses its own press's factor; tolerances use the factor at the stop.                                     |
| Pause / end of piece                                   | Judged at once. Rings and one line, or nothing when barely played. At the end the red goes home and rings near the end may be out of view. |
| Hands change, Practice mode off, piano lost, new score | Clears rings and line, and discards a run in progress.                                                                                     |
| After the run                                          | The line goes for good when anything else takes it or the red moves; the rings stay until the next Play.                                   |
| Print                                                  | Rings hidden.                                                                                                                              |

## 4. Docs changes and the pull request

- **`docs/app.md`:**
  - Under "Playing along on a piano", a new paragraph "Timing after a run" with:
    - when a run is judged and when the rings and the line clear (R8.4);
    - the rule (the coarse bias, the window, the tolerance, the last three counted hearings, what is listening and not counted, a hand not played, a wrong key on the beat, the reaction rule without a count-in, barely played) and its constants by name, as provisional;
    - what the rings look like and where they sit;
    - the precedence of the line;
    - that at the end of the piece the red goes home and the page scrolls to the first note, so rings near the end may be out of view (a decision for the owner).

    Name the code: `score/timing.ts`, `score/useTimingRun.ts`, `score/render/timingMarks.ts` (`markShape`), `Transport.heardAt` and `runPasses` (`PassSpan.countedIn`), and `NoteMessage.atMs`.

  - Under "MIDI input": the event time and velocity.
  - Under "The red element rule": the rings are gray, sit outside the notes and never carry the red.
  - Under "Light and dark": the rings use `--gray-3`.
  - Under "Testing": the `play-along-timing` line, the `__digitus2Timing` hook, `FakeHost.send`'s `atMs` and the screenshots in `build/timing-marks/`.
  - Under "Known limitations": rests, lengths and steadiness are not judged (link issue 192).
- **`docs/PROGRESS.md`:** the current state of play-along gains the timing feedback. Under Decisions > App and UI, the decision:
  - the run is Play, with no new control;
  - the feedback comes at the stop, as gray rings and one line;
  - a steady lag is not judged, and neither is what the reader only listened to;
  - the windows are provisional (link issue 192).
- **`docs/research/play-along-timing.md`** (new):
  - **The method:** `?hooks=1`, connect the piano, then in the console `__digitus2Timing.presses()` for `arrivalMs - atMs` (the event time against arrival), `__digitus2Keys.outputLatency()`, and a run of 8 to 16 taps on the clicks at 60 %, 80 % and 100 % tempo, reading `judgement().biasMs` (the reader's natural offset).
  - **A loopback check** through the piano for Bluetooth latency and jitter.
  - **An empty table** with the columns Connection (USB, Bluetooth with the WinRT flag), event time minus arrival (median, p95), `outputLatency`, the reader's natural offset at 60 / 80 / 100 %, and the suggested `TOLERANCE_FLOOR_MS`, `TOLERANCE_BEATS`, `BIAS_SEARCH_MIN_MS` and `MATCH_WINDOW_BEATS`.
  - **How the constants get set** from it.
  - Sources with URLs: the Web MIDI `timeStamp` definition and `AudioContext.outputLatency` on MDN.
- **The pull request description:**
  - Lists what it removes or adds on screen: nothing during Play, no control, gray rings and one line only after a run.
  - Says "Part of issue 192".
  - Lists the decisions for the owner: the ring shape (swappable in `markShape`); rings near the end of the piece may be out of view after the red goes home; one ring per hand's part of a step.
  - Has the four screenshots and the checklist of issue 192, as follows:
    - [ ] Try each app's timed mode (left, not part of this pull request).
    - [x] Carry `e.timeStamp` and velocity in `NoteMessage`.
    - [ ] Measure the latency table over Bluetooth and over USB (method and empty table in `docs/research/play-along-timing.md`; needs the owner's piano).
    - [x] Write a pure onset matcher, test first.
    - [x] Add a Playwright MIDI simulation that plays with set offsets, as the oracle.
    - [x] Iteration 1: replaced by the owner's choice, Play is the timing run (no "Keep time" control).
    - [x] Iteration 2: the rings. Shape, chords, both hands and the 360 px floor are settled provisionally; owner feedback pending.
    - [ ] Iteration 3: rests and lengths (left).
    - [x] Checked for one red, light and dark, reduced motion and 360 px.
    - [ ] Set the windows from the owner's sessions (left: constants named and provisional).
  - Ends with the attribution line the session's reminder gives.
