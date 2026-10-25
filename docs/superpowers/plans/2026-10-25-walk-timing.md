# Timing inside the waiting walk (issue 192)

This plan replaces the first build of issue 192, in which Play was the timing run. The owner rejected that build: the red must wait for the reader, and timing must come from the reader's own playing. The waiting walk (issues 182, 185, 184) does not change. While the reader walks it, digitus compares each gap between their presses with the written gap, at their own tempo, and after each bar it draws a gray ring at the note that came clearly early or late. Play judges nothing.

Builders follow this plan literally. Every file belongs to exactly one builder (section 9).

## 1. The behaviour

### 1.1 What is judged

- **Onset.** A step's onset is the start of the run that passed it: every pitch of the step held and fresh, counted from the latest press among them (`runSince` in `playAlong.ts`). A rolled chord's onset is therefore its last key. A step pressed before the red reached it counts from its own press. Releases are never judged, so legato overlap changes nothing.
- **Event time.** The walk counts holds from arrival time (`performance.now()` in the listener). The timing uses the decisive press's event time instead: `NoteMessage.atMs`, the MIDI `timeStamp` when it is plausible (section 4.3).
- **Own pulse, no clock.** Each gap between consecutive steps' onsets is compared with the written gap between them, in performance seconds. Performance seconds already include tempo changes, rests and repeats. The reader's tempo is the median ratio of real to written gaps within `TEMPO_WINDOW` gaps of the one judged, so any speed is fine, slow drift is followed, and only an even rhythm counts. Steady latency (USB, Bluetooth, a slow hand) shifts every onset by the same amount, so it cancels out in the gaps.
- **Verdict: gaps, not a grid.** A waiting walk has no clock to return to: after a slip the reader carries on from where they are. So each note is judged by the gap that leads into it. The note is early when that gap is shorter than the written gap at the reader's tempo by more than the tolerance, late when it is longer by more than the tolerance, and on time otherwise. A note played early and then followed by the pulse resuming makes the next gap long by the same amount; that next gap only puts back the previous one and is not rung (the undo rule, section 2.3). So one early note gives one ring, a lasting shift (a short hesitation, a note held too long) gives at most one ring on the note after it, and the notes after it are judged afresh.
- **Tolerance.** `max(TOLERANCE_FLOOR_MS, TOLERANCE_BEATS × the felt beat, TOLERANCE_GAP × the written gap)`, both at the reader's tempo; for a gap shorter than the felt beat in a simple meter `TOLERANCE_SUBBEAT_BEATS` (1/3) takes the place of `TOLERANCE_BEATS` (a compound meter keeps `TOLERANCE_BEATS`: a third of its felt beat is exactly one of its beats). The felt beat is the time signature's beat, except in compound meters (6/8, 9/8, 12/8, 12/16), where it is three of them. The gap term grows with long notes, because a steady player's spread grows with the interval.
- **Gaps the red does not wait out are not judged.** After a note followed by a rest, the red moves on when the note ends (`holdSec = min(gap, shortestSec)`), and a beginner presses at once. The app's own cue causes that, so a link whose written gap is longer than the earlier step's hold is neither judged nor counted in the tempo; the chain goes on through it, and the gap after it may still put it back (a note pressed at the cue and then the count resumed is not late).
- **Sub-beat rhythm.** A dotted eighth and sixteenth played as two even eighths moves the sixteenth by exactly a quarter of a beat. In a simple meter a gap shorter than the felt beat has the tolerance `TOLERANCE_SUBBEAT_BEATS`, a third of a beat, so that shift is clear of the edge (it is not a coin flip of a few milliseconds), and dotted and triplet subdivisions are not judged.
- **Nothing is missed.** A waiting walk has no "missed": a step that is never played is never passed.

### 1.2 When the timing chain breaks

The chain is the run of consecutive passed steps whose gaps may be compared. A break means that the next passed step starts a new chain: the gap into it is not judged, and it serves only as context for the onsets after it.

| Break                                                                                                            | Where it is seen                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A hesitation: a gap longer than the rhythm asks at the reader's tempo by more than a fixed margin                | `judgeBar`: `real − T × written > PAUSE_FLOOR_MS + min((PAUSE_RATIO − 1) × T × written, PAUSE_BEATS × T × felt beat)` |
| A seek, Rewind, Home, a bar click, a loop change, a hands change, Play then Pause, Practice mode turned on again | usePlayAlong's `moved` branch: `break` event                                                                          |
| The walk going inactive (Play, loading, the piano lost, Practice mode off, the score not ready)                  | usePlayAlong's inactive branch: `break` event                                                                         |
| A loop wrap: the walk goes from the loop's last step to its first                                                | useWalkTiming: a passed index that is not the last one + 1, or `at` that is not the last passed + 1                   |
| A release too early (the hold hint): the step is pressed again, and that new press is a correction, not rhythm   | `settled` event with `early: true`: the chain breaks after that event's passed runs                                   |
| The finish (the piece's last step passed)                                                                        | `settled` event with `finished: true`                                                                                 |
| Unmount                                                                                                          | usePlayAlong's unmount cleanup: `break` event                                                                         |
| A run start that is not finite (a key with no press time)                                                        | useWalkTiming skips that run and breaks                                                                               |
| Two onsets out of order, or a written gap of 0                                                                   | `judgeBar` treats the link as broken (defensive)                                                                      |

The pause margin is fixed time for long gaps: a search for the next notes after a whole note, or a fermata held as written (the Score carries no fermata), is a pause, not dragging. For gaps of one beat or less the rule equals `real > PAUSE_RATIO × T × written + PAUSE_FLOOR_MS`.

A gap the red does not wait out (1.1) is not a break: it is skipped by the verdict and the tempo, and the chain continues through it.

The walk's `here < 0` branch (a loop that holds no step) passes nothing. The next pass after it comes after a `moved` break or with an index jump, so no tap is placed there. That branch also lies inside PR 201's hunk.

### 1.3 When a bar is judged, and its rings

- **Bar.** A step's bar is the performance bar that holds its onset: the pass index `p` with `perf.starts[p] <= perfSec`. In a repeat, the second hearing of a written bar is another performance bar. Rings are keyed by the written bar (`perf.written[p]`) and drawn on the written note ids, because the SVG has each written note once.
- **Judged when the walk leaves the bar.** That is the moment the last passed step lies in bar B and the next one is in another bar, or is not the next step (a loop wrap, including a one-bar loop), or the piece finished. One settle can pass steps across a bar line (a flight landing, steps pressed ahead); then B is judged inside that settle from its own onsets only. The rings for B appear in that render. A visit that a break cuts short (a seek or Rewind halfway through the bar) is **not** judged.
- **Enough context.** A bar's notes are judged only within a stretch of at least `MIN_FIT_ONSETS` onsets joined without a break, and a gap is judged only when at least `MIN_TEMPO_GAPS` timed gaps around it give the tempo. The first gap of a stretch (out of a resumption, a re-press after a release too early, the first press after a seek or of the piece) is never rung. So a lone bar after a pause, a bar of one whole note after a break, or a pickup bar alone judges nothing. The pickup does serve as context for bar 1.
- **At most one ring per bar** (`MAX_RINGS_PER_BAR`): of a bar's early or late notes, only the one furthest past its tolerance (`|offsetMs| / tolMs`) gets a ring. The test hook still reports every judgement.
- **The last two bars keep only early.** In the piece's last bar and the bar before it (the last two passes of the performance, so a repeat or a jump counts in the order heard), late verdicts are dropped wherever the bar is judged: moving into the last bar, at the finish, or at the wrap of a loop over the ending (which never finishes): a written `rit.` or `rall.` is text the tempo map does not carry, and a reader who slows down as written must not get late rings.
- **Replayed bars clear.** A bar's rings clear at the **first passed step** of a later visit to the same written bar, not when the red enters it. In a one-bar loop, the rings drawn at the wrap therefore stay while the red waits on the bar's first step, and go when the reader plays that step again. A bar judged earlier in the same settle is not cleared by that settle (a legato wrap of a one-bar loop passes the last step and the first in one settle). The new visit's judgement then sets the bar's rings afresh.
- **Earlier bars keep their rings** until they are replayed or a clear comes.
- **Clears** (all rings, the chain, the onsets): a new score, a hands change, Practice mode off, the piano lost or turned off, the setting turned off, the score leaving `ready`, and **Play pressed**.
- **A seek, Rewind, a loop change or a bar click only break the chain; the rings stay.** A reader seeks to a bar in order to practise it.

### 1.4 The one-time explanation

- The first time a settle leaves at least one ring on screen in this score view (the life of the `useWalkTiming` hook), the status line says the explanation.
- It leaves at the first of these:
  - the `EXPLAIN_BARS`-th (2) bar judged after it appeared;
  - any clear;
  - any `break` event.
- It never shows again in that view, even when later bars get rings, once it has been on the status line. Only bars judged while it is on the line count toward leaving (not while the piano loads, a count-in beat or the sound sentence holds the line), and one that a break or a clear ended before it was on the line is due again at the next ring.
- **Precedence on the status line.** The score busy > nothing playable > `Loading the piano…` > a count-in beat > the sound sentence (issue 184) > the hold hint (issue 185) > **the timing explanation** > the play hint (issue 182) > nothing. The play hint goes for good after the first pass, so in practice the explanation never competes with it.
- The text, with no disclaimer (key `t.score.view.timingExplain`, a plain string):

| Language | `timingExplain`                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| en       | `A ring before a note means it came early; after it, late.`                                                                                                                                                         |
| es       | `Un círculo antes de una nota significa que llegó antes de tiempo; después, tarde.`                                                                                                                                 |
| fr       | `Un cercle avant une note signifie qu’elle a été jouée trop tôt\u00a0; après, trop tard.` (a typographic apostrophe, and a no-break space before the semicolon, written as the escape `\u00a0` as in `fr/about.ts`) |
| nl       | `Een cirkel vóór een noot betekent dat die te vroeg kwam; erna, te laat.`                                                                                                                                           |
| pt       | `Um círculo antes de uma nota significa que ela veio cedo demais; depois, tarde demais.`                                                                                                                            |

### 1.5 The rings

- **Placement.** One thin gray ring per staff for the bar's ringed step, drawn on all the step's notes in the hands played (`drawTimingMarks` groups the notes by `g.staff`, so a step on both staves gets two rings). An early ring sits left of the note and a late ring right of it, using `ringFor` as it is today with the "missed" case removed.
- **Displacement.** The offset in performance seconds is the offset in milliseconds divided by the reader's tempo (ms per performance second), on the local spacing scale. The neighbours are the previous and next steps in plan order.
- **Look.**
  - The stroke is `--gray-3`, never the accent.
  - No opacity or filter on any SVG group (issue 79).
  - `aria-hidden`, with `pointer-events: none`.
  - Hidden in print.
  - No animation, so nothing changes under reduced motion.
  - Exactly one red on screen at all times.

## 2. The pure judge: `apps/web/src/score/walkTiming.ts` (Builder P)

### 2.1 Exports (exact)

```ts
// Pure: the timing of the waiting walk (issue 192). Types only, apart from the steps of
// playAlong.ts (already in the static bundle). The reader's own pulse is the clock: each gap
// between onsets is compared with the written gap, at the reader's tempo, so a steady latency cancels.
import type { Hand } from '@digitus2/engine';
import type { Performance } from '../audio/performance.js';
import { ALONG_EPS, alongPlanNotes, holdSec, type AlongStep, type StepTime } from './playAlong.js';
import type { TimingMark } from './render/timingMarks.js';

// The windows, all provisional until the owner's sessions set them (issue 192).
/** The tolerance never goes below this, in real milliseconds. */
export const TOLERANCE_FLOOR_MS = 120;
/** The tolerance in felt beats at the reader's own tempo. */
export const TOLERANCE_BEATS = 0.25;
/** The tolerance as a share of the written gap at the reader's tempo (long notes spread more). */
export const TOLERANCE_GAP = 0.2;
/** A gap up to one beat is a pause past this many times the expected one plus the floor. */
export const PAUSE_RATIO = 2;
/** The pause test's floor, in real milliseconds. */
export const PAUSE_FLOOR_MS = 300;
/** For longer gaps the pause margin stops growing at this many felt beats (plus the floor). */
export const PAUSE_BEATS = 1;
/** The reader's tempo at a gap is the median of the timed gaps at most this many links away. */
export const TEMPO_WINDOW = 8;
/** A stretch of fewer onsets than this, joined without a break, judges nothing. */
export const MIN_FIT_ONSETS = 4;
/** A gap with fewer timed gaps than this in its tempo window is not judged. */
export const MIN_TEMPO_GAPS = 3;
/** Rings kept per judged bar: the note furthest past its tolerance. */
export const MAX_RINGS_PER_BAR = 1;
/** A logged note-on this close to a run start (arrival times) is the press that started it. */
export const PRESS_MATCH_MS = 20;
/** The explanation leaves at this many bars judged after it appeared. */
export const EXPLAIN_BARS = 2;

/** What the judge needs of a step. */
export interface PlanStep {
  /** The step's onset in performance seconds (AlongStep.perfSec). */
  perfSec: number;
  /** The felt beat at the step, in performance seconds (StepNotes.beatSec). */
  beatSec: number;
  /** The performance bar holding the onset: the pass index into `perf.starts`. */
  bar: number;
  /** How long the walk holds the red on it before moving on, in performance seconds (`holdSec` with no loop). */
  holdSec: number;
}

/** A step of the walk as its timing sees it, aligned with `alongPlan`'s steps. */
export interface WalkPlanStep extends PlanStep {
  /** The written bar of `bar` (`perf.written[bar]`): the key of the rings. */
  writtenBar: number;
  /** The pitches the step asks for (AlongStep.pitches). */
  pitches: readonly number[];
  /** The written ids (SVG ids) of the step's non-grace notes in the hands played, unique, in score order. */
  ids: readonly string[];
}

export interface WalkPlan {
  steps: WalkPlanStep[];
  /** `alongPlan`'s steps and times, for the holds the test hook reports. */
  along: AlongStep[];
  times: StepTime[];
}

/** One passed step, timed: `ms` is the onset in performance.now() milliseconds. */
export interface Onset {
  index: number;
  ms: number;
  /** Onsets of different chains are never compared. */
  chain: number;
}

export type Verdict = 'onTime' | 'early' | 'late';

export interface Judged {
  index: number;
  verdict: Verdict;
  /** The gap into the note minus the written gap at the reader's tempo, in real ms (negative early). */
  offsetMs: number;
  /** The same in performance seconds at the reader's tempo (for the ring's displacement). */
  offsetSec: number;
  tolMs: number;
}

/** A note-on as the timing logs it. */
export interface NotePress {
  midi: number;
  /** performance.now() in the timing's listener. */
  arrivalMs: number;
  /** NoteMessage.atMs, else arrivalMs. */
  atMs: number;
}

export function writtenNoteId(perf: Performance, id: string): string;
export function walkTimingPlan(perf: Performance, mutedHands: readonly Hand[]): WalkPlan;
export function resolveOnset(
  sinceMs: number,
  pitches: readonly number[],
  log: readonly NotePress[],
): number;
export function judgeBar(steps: readonly PlanStep[], onsets: readonly Onset[]): Judged[];
export function marksOf(steps: readonly WalkPlanStep[], judged: readonly Judged[]): TimingMark[];
```

`writtenNoteId` moves here unchanged from `timing.ts`: `return perf.identity ? id : id.replace(/@\d+$/, '');`.

### 2.2 `walkTimingPlan`

```ts
export function walkTimingPlan(perf: Performance, mutedHands: readonly Hand[]): WalkPlan {
  const { steps, times, notes } = alongPlanNotes(perf, mutedHands);
  /** The last pass starting at or before `sec` (binary search on perf.starts), at least 0. */
  const barAt = (sec: number): number => {
    /* last p with perf.starts[p] <= sec + ALONG_EPS; 0 if none */
  };
  return {
    along: steps,
    times,
    steps: steps.map((step, i) => {
      const bar = barAt(step.perfSec);
      return {
        perfSec: step.perfSec,
        beatSec: notes[i]!.beatSec,
        bar,
        holdSec: holdSec(steps, times, i, null),
        writtenBar: perf.written[bar] ?? bar,
        pitches: step.pitches,
        ids: [...new Set(notes[i]!.ids.map((id) => writtenNoteId(perf, id)))],
      };
    }),
  };
}
```

### 2.3 `judgeBar`: the algorithm

`judgeBar(steps, onsets)` judges **the bar of the last onset**, `B = steps[onsets.at(-1).index].bar`. The hook calls it at the moment the walk leaves B, before it appends any onset of the next bar. It returns `[]` when `onsets` is empty. Every onset it uses has already been played, so the tempo window never reaches past the last onset.

```
median(xs): sort a copy ascending; odd length: middle; even: mean of the two middle values.

n = onsets.length; if n === 0 return []
barOf(k) = steps[onsets[k].index].bar
B = barOf(n - 1)

// The visit: the longest suffix whose steps are in B with strictly increasing indices.
v = n - 1
while v > 0 and barOf(v - 1) === B and onsets[v - 1].index < onsets[v].index: v--

// Links: link k joins onsets k-1 and k (k = 1 .. n-1).
for k in 1..n-1:
  a = onsets[k-1], b = onsets[k]
  real[k] = b.ms - a.ms                                          // real ms
  written[k] = steps[b.index].perfSec - steps[a.index].perfSec   // performance seconds
  base[k] = a.chain === b.chain && b.index === a.index + 1 && written[k] > ALONG_EPS && real[k] > 0
  // A gap the red does not wait out (a rest after the note): not judged, not in the tempo.
  timed[k] = base[k] && written[k] <= steps[a.index].holdSec + ALONG_EPS
  if timed[k]: rho[k] = real[k] / written[k]                     // ms per performance second
  link[k] = base[k]

// Pauses, from the timed links only.
for k in 1..n-1 with timed[k]:
  lo = k; while lo - 1 >= 1 and base[lo - 1]: lo--               // the base run holding k
  hi = k; while hi + 1 <= n - 1 and base[hi + 1]: hi++
  near = [rho[l] for l in max(lo, k - TEMPO_WINDOW) .. min(hi, k + TEMPO_WINDOW), l !== k, timed[l]]
  if near is empty: continue
  T = median(near); beat = steps[onsets[k].index].beatSec
  if real[k] - T * written[k] > PAUSE_FLOOR_MS + min((PAUSE_RATIO - 1) * T * written[k], PAUSE_BEATS * T * beat):
    link[k] = false

// Segments: maximal stretches of onsets joined by `link`. Judge the visit's onsets per segment.
out = []
j = v
while j <= n - 1:
  s = j; while s > 0 and link[s]: s--                            // segment start
  e = j; while e + 1 <= n - 1 and link[e + 1]: e++               // segment end (<= n - 1)
  vs = max(v, s)                                                  // first visit onset in this segment
  if e - s + 1 >= MIN_FIT_ONSETS:
    prev = null
    for k in s+1 .. e:
      if !timed[k]: prev = null; continue
      rs = [rho[l] for l in max(s + 1, k - TEMPO_WINDOW) .. min(e, k + TEMPO_WINDOW) with timed[l]]   // k included
      if rs.length < MIN_TEMPO_GAPS: prev = null; continue
      T = median(rs)                                              // ms per performance second
      d = real[k] - T * written[k]
      st = steps[onsets[k].index]
      tol = max(TOLERANCE_FLOOR_MS, TOLERANCE_BEATS * T * st.beatSec, TOLERANCE_GAP * T * written[k])
      verdict = d < -tol ? 'early' : d > tol ? 'late' : 'onTime'
      // The undo rule: this gap only puts back the previous one (the note moved, then the pulse resumed).
      undo = verdict !== 'onTime' && prev !== null && !prev.undo && sign(prev.d) !== sign(d) && |prev.d + d| <= tol
      if undo: verdict = 'onTime'
      if k >= max(vs, s + 2):                                     // never the segment's first gap
        out.push({ index: onsets[k].index, verdict, offsetMs: d, offsetSec: d / T, tolMs: tol })
      prev = { d, undo }
  j = e + 1
return out
```

Notes for the builder:

- `T` is real milliseconds per performance second. `st.beatSec × T` is the felt beat in real milliseconds at the reader's own tempo.
- The segment's first gap (`k = s + 1`) is computed for the undo rule but never pushed.
- The undo rule holds whether or not the previous gap was rung or pushed.
- Keep the function free of allocation tricks. Clarity wins: the onsets are at most a few hundred.

### 2.4 `resolveOnset`

```
for i from log.length - 1 down to 0:
  p = log[i]
  if p.arrivalMs > sinceMs + PRESS_MATCH_MS: continue          // a later press (spent for a later step)
  if !pitches.includes(p.midi): continue
  return p.arrivalMs >= sinceMs - PRESS_MATCH_MS ? p.atMs : sinceMs
return sinceMs
```

The decisive press is the latest press among the step's pitches. Its arrival in the walk's listener equals `sinceMs`. The timing's listener subscribes first (section 4.3), and both listeners run synchronously for the same event, so its arrival precedes the walk's by microseconds; `PRESS_MATCH_MS` absorbs a stall between the two. When the log does not have that press (it was pruned, or it came before the timing listened), the arrival time stands in.

### 2.5 `marksOf`

`judged` is one bar's judgement. Keep the entries with a verdict other than `'onTime'`, sort them by `|offsetMs| / tolMs` descending (ties: lower index first), and keep the first `MAX_RINGS_PER_BAR`. For each, in index order:

```ts
const step = steps[j.index]!;
const before = steps[j.index - 1];
const after = steps[j.index + 1];
mark = {
  ids: step.ids,
  verdict: j.verdict, // 'early' | 'late'
  offsetSec: j.offsetSec,
  prev: before ? { ids: before.ids, dSec: step.perfSec - before.perfSec } : null,
  next: after ? { ids: after.ids, dSec: after.perfSec - step.perfSec } : null,
};
```

### 2.6 `walkTiming.test.ts` (write first; all must pass)

Test helpers, inside the test file:

```ts
/** A plan from note lengths in beats: perfSec cumulative at `secPerBeat`, bars of `beatsPerBar`,
 *  after an optional pickup of `pickup` beats (bar 0), so bar = pickup ? (pos < pickup ? 0 :
 *  1 + floor((pos - pickup) / beatsPerBar)) : floor(pos / beatsPerBar). beatSec = o.beatSec ??
 *  secPerBeat. holdSec = (holds[i] ?? beats[i]) * secPerBeat (no rests unless `holds` says so). */
function planOf(
  beats: number[],
  o?: {
    secPerBeat?: number;
    beatsPerBar?: number;
    pickup?: number;
    beatSec?: number;
    holds?: Record<number, number>;
  },
): PlanStep[];
/** Onsets 0..upTo played at `msPerSec` real ms per performance second from `start` (1000):
 *  ms = start + perfSec * msPerSec + offsets[i] + the sum of extra[k] for k <= i; the chain grows
 *  by one at each index in `breaks`. */
function play(
  plan: PlanStep[],
  msPerSec: number,
  o?: {
    offsets?: Record<number, number>;
    extra?: Record<number, number>;
    breaks?: number[];
    start?: number;
    upTo?: number;
  },
): Onset[];
/** As the hook does: judgeBar at each bar's last onset (the next onset is in another bar, is not
 *  index + 1, or there is none), on the onsets up to it; all the results concatenated. */
function judgeEach(plan: PlanStep[], onsets: Onset[]): Judged[];
/** Onsets from explicit gaps: ms_0 = 1000, ms_k = ms_{k-1} + gaps[k-1], indices 0.., chain 0. */
function fromGaps(gaps: number[]): Onset[];
const off = (r: Judged[]) => r.filter((x) => x.verdict !== 'onTime');
```

The defaults are `secPerBeat = 0.5` and `beatsPerBar = 4`. Below, `QEE` is `[1, 0.5, 0.5, 1, 0.5, 0.5]` repeated 4 times: bars of q e e q e e, six steps per bar. `Q16` is sixteen quarter notes: bar k is steps 4k..4k+3. `TW` is `[1,1,1,1, 1,1,2, 1,1,1,1]` (Twinkle's shape). "off is exactly X" means `off(result)` has exactly those entries in that order; `offsetMs` within 1 and `tolMs` within 0.5 where given. Every expectation below was computed from a transcription of section 2.3.

| Case                                                   | Input                                                                                                                                                                                             | Expected                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| steady q-e-e, slow                                     | `planOf(QEE)`, `judgeBar(plan, play(plan, 2000, { upTo: 11 }))`                                                                                                                                   | judged indices 6..11, all `onTime`                                                                         |
| steady q-e-e, fast                                     | the same at 800                                                                                                                                                                                   | judged 6..11, all `onTime`                                                                                 |
| first bar                                              | `play(plan, 2000, { upTo: 5 })`                                                                                                                                                                   | judged 2..5 (the gap into 1 is the segment's first), all `onTime`                                          |
| one eighth rushed                                      | `play(plan, 2000, { upTo: 11, offsets: { 8: -400 } })`                                                                                                                                            | off is exactly `[8 early]`, `offsetMs` −400, `offsetSec` within 0.001 of −0.2, `tolMs` 250                 |
| rushed in the first bar                                | `play(plan, 2000, { upTo: 5, offsets: { 2: -400 } })`                                                                                                                                             | off is exactly `[2 early]`                                                                                 |
| a half note cut short                                  | `planOf([2,1,1, 2,1,1, 2,1,1])`, `play(plan, 2000, { upTo: 5, offsets: { 4: -500 } })`                                                                                                            | judged 3, 4, 5; off is exactly `[4 early]`, `offsetMs` −500, `tolMs` 400 (the gap term)                    |
| dragged, then back                                     | `planOf(Q16)`, `play(plan, 2000, { upTo: 7, offsets: { 5: 600 } })`                                                                                                                               | judged 4..7; off is exactly `[5 late]`, `offsetMs` 600 (the gap into 6 is undone)                          |
| a short hesitation, carried                            | `planOf(Q16)`, `play(plan, 2000, { upTo: 7, extra: { 5: 1000 } })`                                                                                                                                | off is exactly `[5 late]`, `offsetMs` 1000; 6 and 7 `onTime`                                               |
| a hesitation into the bar                              | the same with `extra: { 4: 1000 }`                                                                                                                                                                | off is exactly `[4 late]`; 5, 6, 7 `onTime`                                                                |
| a hesitation at a fast tempo                           | `planOf(Q16)`, `play(plan, 400, { upTo: 7, extra: { 6: 400 } })`                                                                                                                                  | off is exactly `[6 late]`, `tolMs` 120                                                                     |
| a shift out of the first gap                           | `planOf(Q16)`, `play(plan, 2000, { upTo: 3, extra: { 1: 600 } })`                                                                                                                                 | judged 2, 3, both `onTime` (the first gap is never rung)                                                   |
| a 3 s hesitation is a pause                            | `planOf(Q16)`, `play(plan, 2000, { upTo: 7, extra: { 6: 3000 } })`                                                                                                                                | judged exactly 4 and 5, both `onTime` (6 starts a new segment, and 6..7 is too short)                      |
| …and judges nothing across it                          | the same with `upTo: 11`                                                                                                                                                                          | judged exactly 8, 9, 10, 11, all `onTime`                                                                  |
| every bar at its exit: a carried shift (bar 1)         | `planOf(Q16)`, `judgeEach(plan, play(plan, 2000, { extra: { 5: 600 } }))`                                                                                                                         | judged 2..15; off is exactly `[5 late 600]`                                                                |
| every bar at its exit: a carried shift at a bar's end  | the same with `extra: { 7: 600 }`                                                                                                                                                                 | off is exactly `[7 late 600]`; bar 2 (8..11) all `onTime`                                                  |
| every bar at its exit: an early note at a bar's end    | `planOf(Q16)`, `judgeEach(plan, play(plan, 2000, { offsets: { 7: -400 } }))`                                                                                                                      | off is exactly `[7 early −400]`; bar 2 all `onTime` (the gap into 8 is undone at bar 2's exit)             |
| a one-bar visit, carried                               | `planOf([1,1,1,1])`, `judgeBar(plan, play(plan, 2000, { extra: { 2: 600 } }))`                                                                                                                    | judged 2, 3; off is exactly `[2 late 600]`                                                                 |
| a note after a long one, carried                       | `planOf(TW)`, `judgeEach(plan, play(plan, 2000, { extra: { 7: -500 } }))`                                                                                                                         | off is exactly `[7 early −500]`, `tolMs` 400                                                               |
| short notes lengthened, bars even                      | bars of q e e in 2/4: `planOf([1,0.5,0.5] × 4, { beatsPerBar: 2 })`; each bar 2000 ms, the quarter 1.6 × each eighth (889 ms, 556, 556); `judgeEach`                                              | no off                                                                                                     |
| a bar with too few gaps                                | `planOf(Array(9).fill(1), { beatsPerBar: 3 })`, `play(plan, 2000, { upTo: 2 })`                                                                                                                   | `[]`                                                                                                       |
| slow drift is not punished                             | `planOf(Q16)`; `fromGaps` with gap_k = 1000 × 1.02^(k+1); `judgeBar` on the first 4, 8, 12 and 16 onsets                                                                                          | no off in any call                                                                                         |
| the tempo is local                                     | `planOf(Q16)`; `fromGaps` with gaps 1..8 of 1000 ms and gaps 9..15 of 650 ms; `judgeBar` on all 16                                                                                                | judged 12..15, all `onTime` (with `TEMPO_WINDOW` set huge, a global median, 12..15 come out early at −350) |
| tolerance follows the reader's tempo                   | `planOf(Q16)`, `offsets: { 5: -150 }`, `upTo: 7`, at 2000 and at 400                                                                                                                              | at 2000: no off (tol 250); at 400: off is exactly `[5 early]`, `tolMs` 120 (the floor)                     |
| the tolerance grows with a long note                   | `planOf([1,1,1,1, 4, 1,1,1,1])`, `judgeEach(plan, play(plan, 2000, { extra: { 5: 500 } }))`; then `extra: { 5: 900 }`                                                                             | 500: no off (tol 800); 900: off is exactly `[5 late]`, `tolMs` 800                                         |
| a whole note held one beat long                        | the same plan, `extra: { 5: 1000 }`                                                                                                                                                               | off is exactly `[5 late 1000]`                                                                             |
| a search after a whole note is a pause                 | the same plan, `extra: { 5: 1500 }`, then `extra: { 5: 2000 }`                                                                                                                                    | both: no off; judged 2, 3, 4, 7, 8 (no 5 or 6)                                                             |
| a fermata held as written                              | `planOf(TW)`, `judgeEach(plan, play(plan, 2000, { extra: { 7: 2000 } }))`                                                                                                                         | no off; no entry for 7 or 8                                                                                |
| a slow, steady reader is not pausing                   | `planOf(Q16)`, `judgeEach(plan, play(plan, 6000))` (3 s per quarter)                                                                                                                              | judged 2..15, all `onTime`                                                                                 |
| the felt beat in 6/8                                   | `planOf([2,1,2,1,3,3, 2,1,2,1,3,3], { secPerBeat: 0.25, beatsPerBar: 6, beatSec: 0.75 })`, `judgeEach(plan, play(plan, 2000, { offsets: { 3: 250 } }))`                                           | no off (tol 375); with `beatSec: 0.25` instead, off is exactly `[3 late]`, `tolMs` 200                     |
| rests the red does not wait out are not judged         | bars of q q (q + quarter rest): `planOf([1,1,2] × 4, { holds: { 2: 1, 5: 1, 8: 1, 11: 1 } })`; onsets at 2000 ms per s, but each gap after a 2-beat step is 0.7 × its written length; `judgeEach` | no off; no entry for 3, 6 or 9                                                                             |
| a loop wrap breaks the chain                           | `planOf([1,1,1,1])`; a = `play(plan, 2000)`; b = `play(plan, 2000, { start: a[3].ms + 100 })` with `chain: 1` on every entry; `judgeBar(plan, [...a, ...b])`                                      | judged exactly 2, 3 of the second pass, both `onTime` (the 100 ms wrap gap is never used)                  |
| a forward jump with the same chain id is still a break | `planOf(Q16)`; onsets 0..3 from `play(plan, 2000, { upTo: 3 })`, then indices 8, 9, 10, 11 at `a[3].ms + 100 + j × 1000`, all chain 0                                                             | judged exactly 10, 11, both `onTime`                                                                       |
| a break in the middle of a bar                         | `planOf(Q16)`, `play(plan, 2000, { upTo: 7, breaks: [6] })`                                                                                                                                       | judged exactly 4 and 5                                                                                     |
| a pickup bar alone                                     | `planOf(Array(9).fill(1), { pickup: 1 })`, `upTo: 0`                                                                                                                                              | `[]`                                                                                                       |
| a pickup gives context                                 | the same plan, `upTo: 4, offsets: { 2: -400 }`                                                                                                                                                    | judged 2..4; off is exactly `[2 early]`                                                                    |
| out-of-order onsets                                    | `planOf(Q16)`, `play(plan, 2000, { upTo: 7 })` with onset 6's `ms` set to onset 5's `ms` − 10                                                                                                     | judged exactly 4 and 5; no entry for 6; no exception                                                       |
| two early notes in one bar (input to `marksOf` below)  | `planOf(Q16)`, `play(plan, 2000, { upTo: 7, offsets: { 4: -400, 6: -300 } })`                                                                                                                     | off is exactly `[4 early −400, 6 early −300]`                                                              |

`resolveOnset` cases:

- `resolveOnset(1000, [60], [{ midi: 60, arrivalMs: 1000.002, atMs: 960 }])` → 960.
- A rolled chord counts from its last key: log `[{48, 1000, 990}, {60, 1030, 1020}]`, `sinceMs` 1030, pitches `[48, 60]` → 1020.
- A later re-press is skipped: log `[{60, 1000, 990}, {60, 1600, 1590}]`, `sinceMs` 1000 → 990.
- A stall between the listeners: log `[{60, 1000, 990}]`, `sinceMs` 1012 → 990.
- No match within `PRESS_MATCH_MS`: log `[{60, 900, 890}]`, `sinceMs` 1000 → 1000.
- Another pitch only: log `[{62, 1000, 990}]`, pitches `[60]` → 1000.
- Empty log → `sinceMs`.

`marksOf` cases:

- A plan of three steps with ids `['a']`, `['b', 'c']` and `['d']`, perfSec 0, 0.5 and 1, and judged `[{index:1, verdict:'late', offsetMs:300, offsetSec:0.15, tolMs:250}, {index:2, verdict:'onTime', …}]` → exactly one mark: `{ ids: ['b','c'], verdict: 'late', offsetSec: 0.15, prev: { ids: ['a'], dSec: 0.5 }, next: { ids: ['d'], dSec: 0.5 } }`.
- One bar, two early notes: judged `[{index:4, early, offsetMs:-400, tolMs:250}, {index:6, early, offsetMs:-300, tolMs:250}]` → exactly one mark, on step 4.
- All `onTime` → `[]`.

`walkTimingPlan` cases: use a hand-made Score in the style of `usePlayAlong.test.tsx`. The fixture is 4/4 with divisions 1, qpm 120, two bars, a left-hand whole note 48 at tick 0 and right-hand quarters 60, 62, 64, 65 at ticks 0..3 and 67 at tick 4.

- 5 steps, with bars `[0, 0, 0, 0, 1]` and written bars equal to them (identity).
- `steps[0].ids` holds both notes' ids. With 'L' muted it holds only the 60's.
- `beatSec` is 0.5 everywhere; `holdSec` is 0.5 for steps 0..3.
- A 6/8 fixture at qpm 120 (an eighth is 0.25 s): `beatSec` 0.75 (the dotted quarter).
- A score with a repeat (copy the repeat fixture the `performance` tests use, or build measures with a backward repeat): the second hearing's steps have `bar` > the written bar, `writtenBar` equal to it, and ids without `@`.

## 3. The tap

### 3.1 `apps/web/src/score/playAlong.ts` (Builder P)

1. Add, after `export type AlongMove …` (current line 354):

```ts
/** A step the walk passed (issue 192): its index and when its run started (performance.now ms). */
export interface PassedRun {
  index: number;
  sinceMs: number;
}
```

2. `interface Walked`: add, after `passedSteps: number[];`:

```ts
  /** The same steps, each with the start of the run that passed it (`runSince`). */
  passedRuns: PassedRun[];
```

3. In `walk`:
   - Declare `const passedRuns: PassedRun[] = [];` right after `const passedSteps: number[] = [];`.
   - Add `passedRuns,` after `passedSteps,` in `done`'s object.
   - In the loop, add `passedRuns.push({ index: at, sinceMs: since });` right after `passedSteps.push(at);`.
   - `since` is the value `runSince` returned for that step in the same iteration.
4. `interface Settled`: add, after `passedSteps: number[];`:

```ts
  /**
   * The steps passed, in the order passed, each with the start of the run that passed it (issue
   * 192): a step pressed before the red reached it counts from its own press, a chord from its
   * last key. `passedRuns.map((r) => r.index)` equals `passedSteps`.
   */
  passedRuns: PassedRun[];
```

`settle` already spreads `walked`, so nothing else changes there. `advance` keeps its return type.

5. `alongPlanNotes` and `StepNotes`:
   - Remove the dead `barSec`: the field and its doc line, the `barSecs` map and `barSecAt`, and `barSec: barSecAt(onsetTick),` in the push. Drop `measures` from the `const { tempoMap, divisions, measures } = perf.score;` destructure. `ticksToSeconds` stays, for `beatSec`.
   - Replace `parts: readonly PartNotes[]` with `ids: readonly string[]`: the ids of the step's non-grace notes in the hands played, left hand first, each hand's in the order `parts` had them (`HANDS` order, then `part.ids`). Delete `PartNotes` (nothing reads its `hand` or `pitches` once `timing.ts` is gone).
   - `beatSec` becomes the felt beat. Find the time signature in force at `onsetTick` locally (the last of `perf.score.timeSignatures`, sorted by tick, with `tick <= onsetTick`; common time when there is none; `beats.ts` keeps its helpers private and is not edited). When its `beatType >= 8`, `beats % 3 === 0` and `beats > 3`, the felt beat is `3 × beatTicks`, else `beatTicks`; `beatSec = secAt(onsetTick + feltTicks) − secAt(onsetTick)`. `times.beats` keeps `beatTicks` unchanged.
   - Doc comments: `StepNotes.beatSec` reads "the felt beat at the step in performance seconds: three of the time signature's beats when it counts more than three of an eighth or shorter, a multiple of three (6/8, 9/8, 12/8, 12/16), else the time signature's beat". In the doc comments of `StepNotes` and `alongPlanNotes`, replace "what the timing judge asks of that hand" and "what the timing judge needs" with "what the walk's timing needs (issue 192)", and drop "and its bar" and the sentence about the union of the parts' pitches.

Edits to the existing `alongPlanNotes` tests in `apps/web/src/score/playAlong.test.ts`:

- Remove every `barSec` assertion (current lines 1152–1155, 1163–1164, 1169, 1187 and 1207) and the `measures` lookup in `expectBeatsAndBars`; keep the `beatSec` assertions. Check with `grep -n barSec apps/web/src/score/playAlong.test.ts`, which must print nothing.
- `expectBeatsAndBars` computes the expected beat as the felt beat (the same compound rule as above).
- Rewrite "gives an eighth for the beat in 6/8, as the metronome counts" as "gives a dotted quarter for the felt beat in 6/8": `beatSec` equals `sec(tick + 3) − sec(tick)` at divisions 2.
- Rewrite the `parts` assertions (current lines 1066–1074, 1093–1125, 1131 and 1140) against `ids`: each step's `ids` is non-empty; the both-hands and 'L'-muted cases expect the same ids as before, flattened in hand order; `ticksOf` reads `n.ids[0]`.

New tests, in a new `describe('the runs that passed (issue 192)')`. Use four steps: `[60]` at 0, `[62]` at 0.5, `[48, 64]` at 1 and `[60]` at 1.5. Each has `shortestSec` 0.5, so at factor 1 every hold is 500 ms (the last step holds its note, 0.5 s). Build keys with `pressKey` and presses with `pressAt`.

| Case                                                  | Input                                                                                                                   | Expected                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| a held step                                           | 60 pressed at 0; `settle({ index: 0, nowMs: 500 })`                                                                     | `passedRuns` `[{ index: 0, sinceMs: 0 }]`             |
| no pass                                               | the same at `nowMs: 499`                                                                                                | `passedRuns` `[]`                                     |
| legato: the next step pressed before the first passed | 60 at 0, 62 at 100 (60 still held); `settle` at 600 from index 0                                                        | `[{0, 0}, {1, 100}]`                                  |
| a step pressed ahead counts from its own press        | 62 at 50 and 60 at 200; `settle` at 700 from index 0                                                                    | `[{0, 200}, {1, 50}]`                                 |
| a rolled chord counts from its last key               | with step 1 already passed: 48 at 1000, 64 at 1030; `settle` at 1530 from index 2                                       | `[{ index: 2, sinceMs: 1030 }]`                       |
| a release after four fifths passes at the release     | 60 at 0; `settle({ nowMs: 400, releasing: 60 })`                                                                        | `[{0, 0}]`                                            |
| passes, then a release too early                      | 60 at 0, 62 at 450; `settle({ index: 0, nowMs: 600, releasing: 62 })`                                                   | `passedRuns` `[{0, 0}]`, `early` true, `at` 1         |
| a loop wraps                                          | loop `{ from: 0.5, to: 1.5 }` (steps 1..2), from index 2, 64 and 48 pressed at 0 and 62 pressed at 10, `settle` at 1000 | indices `[2, 1]`, with `sinceMs` 0 and 10             |
| the finish                                            | from index 3, 60 pressed at 0, `settle` at 500                                                                          | `move.kind` `'finish'`, `passedRuns` `[{3, 0}]`       |
| matches passedSteps                                   | each case above                                                                                                         | `passedRuns.map((r) => r.index)` equals `passedSteps` |

If the walk returns something else for one of these, the builder stops and reports: the walk's behaviour is not to be changed.

### 3.2 `apps/web/src/score/usePlayAlong.ts` (Builder H)

Additive lines only, at these anchors (line numbers are those of the file as it is now, before any edit; apply bottom-up so earlier numbers stay valid, or match by the quoted line):

| Anchor (current line)                                                                            | Insert after it                                     |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 68 `  type Keys,` (import block)                                                                 | `  type PassedRun,`                                 |
| 85 `  flightShown: boolean;` (PlayAlongOptions)                                                  | the `onTiming` option below                         |
| 96 `}` (end of `AlongHint`)                                                                      | a blank line, then the `WalkTimingEvent` type below |
| 194 `  flightShown,` (destructuring)                                                             | `  onTiming,`                                       |
| 270 `  const earlyRef = useRef(false);`                                                          | the `onTimingRef` block below                       |
| 345 `        if (accompaniedRef.current) stopAccompaniment();` (inactive branch)                 | `        onTimingRef.current?.({ kind: 'break' });` |
| 376 `        handedRef.current = null;` (moved branch)                                           | `        onTimingRef.current?.({ kind: 'break' });` |
| 494 `      }` (closes `if (plan) {`; the next line, 495, is blank and 496 is the levels comment) | the settled block below                             |
| 567 `      handedRef.current = null;` (unmount cleanup)                                          | `      onTimingRef.current?.({ kind: 'break' });`   |

The option (after line 85):

```ts
  /**
   * Issue 192: told of each settle that passed steps or saw a release too early, and of each
   * break in the walk's own sequence (a move it did not make, going inactive, unmount). Read only:
   * the walk never waits on it, and the listener catches its own errors.
   */
  onTiming?: (e: WalkTimingEvent) => void;
```

The type (after line 96):

```ts
/**
 * What the walk tells its timing (issue 192, useWalkTiming.ts). `settled`: the steps passed in one
 * settle, each from the start of its run; `at`, the step the red is on after it (-1 on the finish);
 * `early`, a release too early ended it; `finished`, the piece's last step passed. `break`: the
 * walk's sequence broke (a move it did not make, inactive, unmount).
 */
export type WalkTimingEvent =
  | { kind: 'settled'; runs: readonly PassedRun[]; at: number; early: boolean; finished: boolean }
  | { kind: 'break' };
```

The ref (after line 270):

```ts
/** The timing's listener (issue 192): the latest `onTiming`, called where the walk passes or breaks. */
const onTimingRef = useRef(onTiming);
useLayoutEffect(() => {
  onTimingRef.current = onTiming;
});
```

The settled block (after line 494, before the blank line 495):

```ts
// Issue 192: the steps passed just now, each from the press that started its run, and a
// release too early (its step is pressed again, and that press starts a new chain).
if (result.passed > 0 || result.early) {
  onTimingRef.current?.({
    kind: 'settled',
    runs: result.passedRuns,
    at: result.at,
    early: result.early,
    finished: result.move.kind === 'finish',
  });
}
```

Nothing else in `usePlayAlong.ts` changes: no header comment edit, and no `Live` change. The inactive branch runs at every decide while the walk is inactive, so it can send several `break`s in a row; the listener treats a break as idempotent.

**PR 201 (issue 200)** edits `usePlayAlong.ts` at old lines 37–45, 50–55 (an import after line 52), 296–301 (a ref after 298), 347–352 (a line after 349), 380–387 (lines after 382), 405–412, 420–431 and 521–526 (a line after 523).

- The tap's lines touch none of those. The exact insertions are after old lines 68, 85, 96, 194, 270, 345, 376, 494 and 567.
- At least one unchanged line separates each tap insertion from each PR 201 change:
  - 345 is 4 lines from 349.
  - 376 is 6 lines from 382.
  - 494 lies between 431 and 521.
  - 567 lies outside all of them.
- After PR 201 merges, the rebase is mechanical. Do not stack on PR 201.

Tests to add to `apps/web/src/score/usePlayAlong.test.tsx`, in a new `describe('the timing tap (issue 192)')` appended at the **end** of the file (PR 201 adds tests at old lines 550 and 846). Use the file's own fixture and helpers, and pass `onTiming: vi.fn()` in the options. The fixture's step 0 is `[48 60]` with both hands played (`setup()` defaults to `mutedHands: []`), so every press of step 0 presses both keys. StrictMode doubles the align on mount, which adds `break` calls; so in every test, call `onTiming.mockClear()` right before the action and assert exact counts after it.

1. `press(48, 60)`, hold 500 ms. Exactly one call: `{ kind: 'settled', runs: [{ index: 0, sinceMs: <the press time> }], at: 1, early: false, finished: false }`.
2. A release too early: `press(48, 60)`, hold 100 ms, `release(60)`. Exactly one call: `{ kind: 'settled', runs: [], at: 0, early: true, finished: false }`.
3. No spurious break: walk steps 0..3 normally (each step's keys pressed, held for its time, released). Zero `break` calls and exactly one `settled` per pass.
4. A seek (the fake's start moved, as the existing "moves the walk did not make" tests do): exactly one `break`.
5. `playing` set true: at least one call, and every call is a `break`. Then `mockClear()`, `playing` set false (Play then Pause): exactly one `break` (the moved branch).
6. A hands change (`refresh({ mutedHands: ['L'] })`): exactly one `break`. A loop being set (`fake.stretch`, as the loop tests do): exactly one `break`. Practice mode off (`useAppStore`): at least one call, all `break`. `turnOffPiano()`: at least one call, all `break`.
7. A loop wrap with the file's `LOOP_BARS` fake: passing the loop's last step gives one `settled` with `runs: [{ index: <last> … }]` and `at: <first>`, and no `break` between it and the next pass.
8. The finish: walking every step to the end gives a last `settled` with `finished: true` and `at: -1`.
9. Unmount: exactly one `break`.
10. A press under a flight (`flightShown`): `press(48, 60)` calls nothing until it lands. At the landing, the `settled` runs carry the press's own time.

## 4. The hook: `apps/web/src/score/useWalkTiming.ts` (Builder H)

### 4.1 API (exact)

```ts
import type { Hand, Score } from '@digitus2/engine';
import type { TimingMark } from './render/timingMarks.js';
import type { WalkTimingEvent } from './usePlayAlong.js';
import type { Playback } from './usePlayback.js';

export interface WalkTimingOptions {
  score: Score | null;
  /** `doc.status === 'ready'`. */
  ready: boolean;
  playback: Playback;
  mutedHands: readonly Hand[];
}

export interface WalkTiming {
  /** Hand to usePlayAlong's `onTiming`; the same function for the life of the hook. */
  tap: (e: WalkTimingEvent) => void;
  /** The rings of every judged bar not replayed or cleared since; null when none. */
  marks: readonly TimingMark[] | null;
  /** The one-time explanation is on the status line (section 1.4). */
  explain: boolean;
}

/** Note-ons kept for `resolveOnset`. */
export const NOTE_LOG_CAP = 512;
/** Onsets kept for `judgeBar` (the tempo window needs TEMPO_WINDOW gaps plus one bar). */
export const ONSET_CAP = 256;
/** Judgements kept for the test hook. */
export const JUDGED_CAP = 512;

export function useWalkTiming(options: WalkTimingOptions): WalkTiming;
```

### 4.2 State

- `walking = settings.playAlong && piano.status === 'connected' && settings.practiceMode` (`useAppStore`, `usePianoSnapshot`, as usePlayAlong reads them). `factor = useAppStore(tempoFactorOf)`.
- `muteKey = [...new Set(mutedHands)].sort().join(',')`.
- `plan = useMemo(() => (walking && score ? walkTimingPlan(performanceFor(score), muteKey ? (muteKey.split(',') as Hand[]) : []) : null), [walking, score, muteKey])`. Its steps are index-aligned with usePlayAlong's, because both come from `alongPlanNotes` with the same arguments.
- `liveRef` holds `{ plan, playback, factor }` and is set in a layout effect each render (as usePlayAlong's `liveRef`).
- Refs:
  - `logRef: NotePress[]`.
  - `entriesRef: { index: number; sinceMs: number; chain: number; ms: number | null }[]`.
  - `chainRef = 0`, `openBarRef: number | null = null`, `lastRef = -1`.
  - `judgedRef: (Judged & { bar: number })[]`.
  - `ringsRef: { plan: WalkPlan | null; byBar: ReadonlyMap<number, readonly TimingMark[]> }` (written bar → its rings), starting from `{ plan: null, byBar: NO_MARKS }` with a module-level empty `NO_MARKS` map. It is the authority; the test hook reads it.
  - `explainedRef = false`, `explainBarsRef = 0`, `explainRef = false`.
- State:
  - `rings`, the same shape as `ringsRef`, set from it once at the end of each `tap` that changed it and in `reset`.
  - `explain: boolean`.

### 4.3 The note-on log

```ts
useEffect(
  () =>
    subscribeNotes((e) => {
      if (!e.on || e.lost || !liveRef.current.plan) return;
      const arrivalMs = performance.now();
      const log = logRef.current;
      log.push({ midi: e.midi, arrivalMs, atMs: e.atMs ?? arrivalMs });
      if (log.length > NOTE_LOG_CAP) log.splice(0, log.length - NOTE_LOG_CAP);
    }),
  [],
);
```

The timing hook must subscribe before usePlayAlong: ScoreView calls `useWalkTiming` before `usePlayAlong`, effects run in declaration order, the piano store calls listeners in subscription order, and this effect has no dependencies, so it is never re-added behind the walk's listener (usePlayAlong's own subscription is re-added whenever its `decide` changes, which keeps it behind). The timing's arrival time therefore precedes the walk's by microseconds. The integration test in 4.8 covers that order. Onsets are resolved lazily at judge time (`resolveOnset`), and each resolved value is cached in its entry's `ms`.

### 4.4 `tap` (a `useCallback` with no changing dependencies)

```
showExplain(v): if explainRef.current !== v: explainRef.current = v; setExplain(v)

tap(e):
  try:
    body(e)
  catch (error):
    console.error(error)
    chainRef.current++; openBarRef.current = null; lastRef.current = -1   // a timing fault never reaches the walk

body(e):
  plan = liveRef.current.plan; if !plan: return
  if e.kind === 'break':
    chainRef.current++; openBarRef.current = null; lastRef.current = -1; showExplain(false); return
  rings = ringsRef.current.plan === plan ? new Map(ringsRef.current.byBar) : new Map()
  judgedNow = new Set<number>()      // written bars judged in this tap
  ringedNow = new Set<number>()      // written bars this tap gave rings
  changed = false

  judge(finishing):
    entries = entriesRef.current; if entries is empty: return
    onsets = entries.map(en => { if en.ms === null: en.ms = resolveOnset(en.sinceMs, plan.steps[en.index].pitches, logRef.current); return { index: en.index, ms: en.ms, chain: en.chain } })
    last = plan.steps[entries.at(-1).index]
    judged = judgeBar(plan.steps, onsets)
    lastPass = plan.steps.at(-1).bar
    if finishing or last.bar >= lastPass - 1: judged = judged.filter(j => j.verdict !== 'late')     // a written rit. at the end: the last two passes heard
    push each judged with bar: last.bar onto judgedRef (keep the last JUDGED_CAP)
    marks = marksOf(plan.steps, judged)
    if marks.length: rings.set(last.writtenBar, marks); ringedNow.add(last.writtenBar)
    else: rings.delete(last.writtenBar); ringedNow.delete(last.writtenBar)
    judgedNow.add(last.writtenBar); changed = true

  for run of e.runs:
    step = plan.steps[run.index]
    if !step or !Number.isFinite(run.sinceMs): chainRef.current++; lastRef.current = -1; continue
    jumped = lastRef.current >= 0 && run.index !== lastRef.current + 1
    if jumped: chainRef.current++
    if openBarRef.current !== null and (jumped or step.bar !== openBarRef.current): judge(false)
    if openBarRef.current === null or jumped or step.bar !== openBarRef.current:
      // A new visit: the bar played again loses its rings, unless this tap just judged it.
      if !judgedNow.has(step.writtenBar) and rings.has(step.writtenBar): rings.delete(step.writtenBar); changed = true
      openBarRef.current = step.bar
    entriesRef.current.push({ index: run.index, sinceMs: run.sinceMs, chain: chainRef.current, ms: null })
    if entriesRef.current.length > ONSET_CAP: drop from the front
    lastRef.current = run.index
  if e.early: chainRef.current++
  open = openBarRef.current
  if open !== null:
    next = e.at >= 0 ? plan.steps[e.at] : undefined
    if e.finished or !next or next.bar !== open or e.at !== lastRef.current + 1:
      judge(e.finished); openBarRef.current = null           // the walk left the bar
  if e.finished: chainRef.current++; lastRef.current = -1

  if changed:
    ringsRef.current = { plan, byBar: rings.size ? rings : NO_MARKS }
    setRings(ringsRef.current)
  // The explanation, decided once per tap from the rings this tap left on screen.
  shown = [...ringedNow].some(w => rings.has(w))
  if shown and !explainedRef.current:
    explainedRef.current = true; explainBarsRef.current = 0; showExplain(true)
  else if explainRef.current and judgedNow.size > 0:
    explainBarsRef.current += judgedNow.size
    if explainBarsRef.current >= EXPLAIN_BARS: showExplain(false)
```

### 4.5 Clears

```
reset = useCallback(() => {
  entriesRef.current = []; chainRef.current++; openBarRef.current = null; lastRef.current = -1
  judgedRef.current = []
  ringsRef.current = { plan: liveRef.current.plan, byBar: NO_MARKS }
  setRings(ringsRef.current)
  showExplain(false)                     // explainedRef stays: once per view
}, [])
useEffect(() => reset(), [reset, plan])                                   // new score, hands, Practice mode off, piano lost, setting off
useEffect(() => { if (!ready) reset() }, [reset, ready])
useEffect(() => { if (playback.playing) reset() }, [reset, playback.playing])  // Play pressed
```

`liveRef` is set in a layout effect, which runs before these passive effects, so `reset` sees the current plan. These effects are declared before ScoreView's usePlayAlong call, so in a commit where Play starts, the reset runs before the walk's inactive `break`.

### 4.6 The test hook `window.__digitus2Timing` (with `?audio=silent` or `?hooks=1`; copy `hooksOn` from usePlayAlong)

```ts
export interface WalkTimingHook {
  /** The steps of the hands played, aligned with __digitus2Along's indices. */
  steps(): {
    perfSec: number;
    pitches: number[];
    bar: number;
    writtenBar: number;
    ids: string[];
    holdMs: number;
  }[];
  /** The onsets since the last clear, resolved (resolving any not yet resolved). */
  onsets(): { index: number; ms: number; chain: number }[];
  /** Every judgement since the last clear, in order, with the performance bar judged. */
  judged(): {
    bar: number;
    index: number;
    verdict: 'onTime' | 'early' | 'late';
    offsetMs: number;
    tolMs: number;
  }[];
  /** TimingMark entries kept now (one per ringed step; the DOM draws one ring per staff). */
  markCount(): number;
}
```

`holdMs` is `holdSec(plan.along, plan.times, i, playback.performanceLoop()) * 1000 / factor`, read live. `markCount` counts the entries of `ringsRef.current.byBar` when its plan is the current one, else 0. Install it in an effect with `[]` dependencies and remove it on unmount when it is still the installed one, as usePlayAlong does.

### 4.7 Return

```ts
// Derived in render: the commit that brings a new plan (score, hands, Practice mode) already has
// no rings, before the reset effect runs, so old rings are never drawn on new pages.
const marks = useMemo(
  () => (rings.plan === plan && rings.byBar.size > 0 ? [...rings.byBar.values()].flat() : null),
  [rings, plan],
);
return useMemo(() => ({ tap, marks, explain }), [tap, marks, explain]);
```

### 4.8 `useWalkTiming.test.tsx` (StrictMode, fake timers and `performance` as in `usePlayAlong.test.tsx`)

- `beforeEach` calls `window.history.replaceState(null, '', '/?hooks=1')`, so `window.__digitus2Timing` is installed.
- Drive the piano store through the fake lazy chunk, as `useTimingRun.test.tsx` does (copy its `access` mock and connect helper into `useWalkTiming.test.tsx` **before** deleting `useTimingRun.test.tsx`). Note-ons come from `events.note({ on: true, midi, atMs }, held)`.
- Call `result.current.tap(...)` directly, except in the integration describe below.
- The playback is a minimal fake cast to `Playback`: `{ playing: false, performanceLoop: () => null }` plus whatever the type needs as no-op functions.
- The score is two bars of four right-hand quarters: 60 62 64 65 | 67 65 64 62, divisions 1, qpm 120, so steps 0..7 sit at 0, 0.5, … 3.5 s and bars are `[0,0,0,0,1,1,1,1]`. The three-bar cases extend it to 12 steps (a third bar 60 62 64 65), bars `[0,0,0,0,1,1,1,1,2,2,2,2]`, and the five-bar cases to 20 (a fourth bar 67 65 64 62 and a fifth 60 62 64 65).
- Helper `walk(indices, msPerStep, offsets?)`: for each index, it advances fake time to t, sends a note-on of its pitch at `atMs = t`, then calls `tap({ kind: 'settled', runs: [{ index, sinceMs: performance.now() }], at: index + 1 (or -1 past the end), early: false, finished: index === last step })`. The pass would come a hold later in the app; the hook does not care.

At 1000 ms per step (2000 ms per performance second), a bar is judged from its third gap on: bar 0 gives indices 2 and 3, a later bar all four.

| Case                                                         | Expected                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| an even walk of both bars at 1000 ms per step                | `marks` null; `explain` false; `judged()` has 2 entries for bar 0 (indices 2, 3) and 4 for bar 1 (4..7), all `onTime`                                                                                                                                                                                |
| step 2 rushed by 400 ms (sent at `t − 400`)                  | before the tap whose `at` is 4 (the walk still in bar 0), `marks` null; after it, `marks` has one mark with `verdict` `'early'` and `ids` the 64's id; `explain` true                                                                                                                                |
| two early notes in one bar give one ring                     | walk 0..7, step 5 sent 400 ms early and step 7 sent 300 ms early: `marks` is one mark, on step 5; `judged()` has both early entries (5 and 7)                                                                                                                                                        |
| the explanation leaves after two more bars judged            | three-bar score, step 2 rushed: after bar 1 is judged it is still true; after bar 2, false                                                                                                                                                                                                           |
| a later rushed bar does not bring it back                    | three-bar score: walk 0..11 with step 2 rushed (the explanation shows at bar 0's exit and leaves at bar 2's); `tap({ kind: 'break' })`; walk 0..4 with step 2 rushed, the tap for index 3 with `at: 4`: `marks` present, `explain` false                                                             |
| a break ends the explanation and keeps the rings             | after the rush: `tap({ kind: 'break' })` gives `explain` false and `markCount()` 1                                                                                                                                                                                                                   |
| replaying the bar clears its rings at its first pass         | after the rush: `break`, then the settled tap for index 0 gives `marks` null at once                                                                                                                                                                                                                 |
| a settle that crosses a bar line                             | runs 0 and 1 tapped singly; then one tap with `runs: [{2},{3},{4}]`, `at: 5`, step 2 rushed: `judged()` has bar 0 with indices 2 and 3 and no entry for 4; `marks` has bar 0's mark; bar 1 is open                                                                                                   |
| a legato wrap of a one-bar loop keeps the rings              | one bar walked 0..2 singly with step 2 rushed, then one tap with `runs: [{3},{0}]`, `at: 1`: `marks` has one mark (bar 0's), `explain` true                                                                                                                                                          |
| the event time is used                                       | note-ons with `atMs` 40 ms before arrival: `onsets()` gives `ms` equal to each `atMs`                                                                                                                                                                                                                |
| the arrival time stands in                                   | a tap with no logged note-on: `onsets()[0].ms` equals its `sinceMs`                                                                                                                                                                                                                                  |
| a loop wrap judges the bar and breaks the chain              | one bar walked 0..3 with the last tap's `at: 0`: bar 0 judged at that tap; a following run with index 0 gets a new `chain`                                                                                                                                                                           |
| a release too early breaks the chain                         | a tap with `early: true` after index 1: the next run's `chain` is one more                                                                                                                                                                                                                           |
| the finish judges the last bar                               | the tap for index 7 with `finished: true, at: -1` judges bar 1                                                                                                                                                                                                                                       |
| the finish drops late                                        | steps 0..7 with the gap into 7 30 % long (step 7 sent 300 ms late, carried): `finished` tap gives `marks` null and no `late` entry in `judged()`                                                                                                                                                     |
| the bar before the last drops late                           | five-bar score (20 steps), steps 0..15 with step 15 sent 300 ms late: bar 3 is judged at the tap for 15 with indices 12, 13, 14 only; `marks` null, no `late` entry in `judged()`                                                                                                                    |
| the bar before the last keeps early                          | the same with step 14 sent 400 ms early: `marks` has one mark, `'early'`, on step 14                                                                                                                                                                                                                 |
| the third bar from the end keeps late                        | five-bar score, steps 0..11 with step 11 sent 300 ms late: `judged()` has the `late` entry for index 11 in bar 2, and `marks` has its mark                                                                                                                                                           |
| a loop over the ending drops late in the bar before the last | three-bar score, a loop over bars 1 and 2 wrapping at step 7 with step 7 sent 300 ms late: bar 1 is judged at the wrap with index 6 only, no `late` entry, `marks` null                                                                                                                              |
| a repeated piece counts the passes heard                     | bars A B (repeated back to the top) C, 20 steps with bars `[0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4]`: step 15 sent 300 ms late (pass 3, the second hearing of written bar 1) gives no `late` entry; step 7 sent 300 ms late (pass 1, the first hearing) gives the `late` entry for bar 1 and a mark |
| a non-finite run start is skipped                            | `runs: [{ index: 3, sinceMs: -Infinity }]` gives no onset for 3, and the next run gets a new chain                                                                                                                                                                                                   |
| a fault in the judge stays in the hook                       | a `settled` tap with `runs: [{ index: 99, sinceMs: 0 }]` and `at: 100` throws nothing, and a following normal walk still judges                                                                                                                                                                      |
| Play clears everything                                       | rerender with `playing: true` gives `marks` null, `explain` false and `judged()` empty                                                                                                                                                                                                               |
| after Play, the explanation stays gone                       | then rerender with `playing: false`, walk a rushed bar 0 again: `marks` present, `explain` false                                                                                                                                                                                                     |
| a fresh view explains again                                  | unmount, mount a new hook, walk a rushed bar 0: `explain` true                                                                                                                                                                                                                                       |
| a new score clears in the same render                        | the wrapper pushes `{ score, marks }` into a render log on every render; after a rushed bar, rerender with another Score: the first logged render with the new score already has `marks === null` (RTL's `rerender` flushes effects, so `result.current` alone cannot tell)                          |
| the score leaving ready clears                               | rerender with `ready: false`: `marks` null, `judged()` empty                                                                                                                                                                                                                                         |
| Practice mode off clears                                     | `useAppStore.setState(settings.practiceMode false)` gives `marks` null                                                                                                                                                                                                                               |
| the setting off clears                                       | `settings.playAlong` false gives `marks` null                                                                                                                                                                                                                                                        |
| the piano turned off clears                                  | `turnOffPiano()` gives `marks` null                                                                                                                                                                                                                                                                  |
| a hands change clears                                        | rerender with `mutedHands: ['L']` gives `marks` null                                                                                                                                                                                                                                                 |
| a seek does not clear                                        | a `break` keeps `marks`                                                                                                                                                                                                                                                                              |
| MIDI messages render nothing                                 | count renders: 20 note-ons with no tap leave the render count unchanged                                                                                                                                                                                                                              |

**`describe('the walk and its timing together')`**, in the same file. One `renderHook` under StrictMode calls `useWalkTiming` first and then `usePlayAlong({ ..., onTiming: timing.tap })`, with a copy of `usePlayAlong.test.tsx`'s `makeFake` playback and score fixture helpers, the fake access chunk and fake timers. Steps are pressed 1000 ms apart, each with `link.events.note({ on: true, midi, atMs: now − 30 })`, and each is released 900 ms after its press (its hold is 500 ms), except where a row says otherwise.

- Walk two bars, with step 2 pressed at 1600 ms (400 ms ahead) and step 1, pressed at 1000, released at 1650, after step 2's press (legato).
- Run it with `mutedHands: []` and with `mutedHands: ['L']`.
- Assert: `judged()` has bars 0 and 1; exactly one early mark, whose `ids` are step 2's; for every k, `onsets()[k].ms` equals the `atMs` sent for that step's decisive key; and `explain` turns true at the tap that leaves bar 0.

## 5. ScoreView wiring (Builder H)

Restore `apps/web/src/score/ScoreView.tsx` and `apps/web/src/score/ScoreView.status.test.tsx` to their state before PR 202 (the first build of issue 192). Never use a PowerShell redirect to do it: it writes CRLF. Then add the following.

1. Imports: `import { clearTimingMarks, drawTimingMarks, type TimingMark } from './render/timingMarks.js';` (after the `pageWindow` import) and `import { useWalkTiming } from './useWalkTiming.js';` (after the `useScoreDocument` import).
2. `StatusInputs`: add, after `alongSound`:

```ts
  /**
   * The one-time explanation of the timing rings (issue 192, useWalkTiming): shown the first time
   * rings appear in this view, until two more bars are judged, a break or a clear. Left out: false.
   */
  timingExplain?: boolean;
```

3. `scoreStatusLine`:
   - Destructure `timingExplain`.
   - Replace the block `if (alongHint !== null) { return info(alongHint.kind === 'hold' ? … : …); }` with:

```ts
if (alongHint?.kind === 'hold') return info(t.score.view.holdLonger(alongHint.count));
if (timingExplain) return info(t.score.view.timingExplain);
if (alongHint !== null) return info(t.score.view.playAlongHint(alongHint.count));
```

- Add one sentence to its doc comment: "The explanation of the timing rings (issue 192) comes after the walk's `hold` hint and before its `play` hint."

4. `timingMarksRef` and `decorate`, exactly as the first build had them:
   - `const timingMarksRef = useRef<readonly TimingMark[] | null>(null);` goes before `const decorate = useCallback(...)`, with the comment "The timing rings (issue 192), for a page built later: a torn page is rebuilt from markup, without them."
   - Inside `decorate`, after `redim(...)`: `const marks = timingMarksRef.current; if (marks) { clearTimingMarks(page); drawTimingMarks(page, marks); }`.
5. Right before the `usePlayAlong` call (keep that call's comment above it), add:

```ts
// How the reader's own rhythm went (issue 192): after the walk leaves a bar, a gray ring at the
// note that came clearly early or late against the reader's own pulse. The walk tells it what it
// passed (`onTiming`); the rings stay until the bar is played again or a clear, on new pages too.
// It must come before usePlayAlong: its note listener has to hear each key first.
const timing = useWalkTiming({
  score,
  ready: doc.status === 'ready',
  playback,
  mutedHands,
});
```

Add `onTiming: timing.tap,` as the last property of the `usePlayAlong({...})` options. Right after the `usePlayAlong` call, add:

```ts
useLayoutEffect(() => {
  timingMarksRef.current = timing.marks;
  if (!host) return;
  clearTimingMarks(host);
  if (timing.marks) drawTimingMarks(host, timing.marks);
}, [host, doc.pages, timing.marks]);
```

6. In the `scoreStatusLine({...}, t)` call, add `timingExplain: timing.explain,` after `alongSound`.

`ScoreView.status.test.tsx` (after the restore): add `describe('the timing explanation on the status line (issue 192)')` using the exported `scoreStatusLine` directly: change the dynamic import to `const { ScoreView, scoreStatusLine } = await import('./ScoreView.js');`, import `type StatusInputs` from `./ScoreView.js`, `en` from `../i18n/en/index.js` and `messages as fr` from `../i18n/fr/index.js`. The `ready` inputs are: docStatus `ready`, playable, hands `both`, loading false, countIn null, alongHint null, alongSound null.

- `{ timingExplain: true }` → `A ring before a note means it came early; after it, late.`
- With `alongHint: { kind: 'hold', count: 1 }` → `Hold the red note a little longer.` (the hold wins).
- With `alongHint: { kind: 'play', count: 1 }` → the explanation (it wins over the play hint).
- With `countIn: { beatInBar: 2, … }` → `2`. With `loading: true` → `Loading the piano…`. With `alongSound: 'click'` → the sound sentence.
- `{ timingExplain: false }` and the field left out → `null`.
- In French (`messages as fr` from `../i18n/fr/index.js`) → `Un cercle avant une note signifie qu’elle a été jouée trop tôt\u00a0; après, trop tard.`

i18n:

- Restore the five `apps/web/src/i18n/{en,es,fr,nl,pt}/score.ts` to their state before PR 202, the same way.
- Then add `timingExplain` right after `holdLonger` in each, with the strings of section 1.4. In `en`, give it the doc comment `/** The status line the first time the timing rings appear in a score view (issue 192): what a ring before and after a note means. */`.
- Rewrite `apps/web/src/i18n/timing.test.ts`: one `it.each` over the five languages checking `view.timingExplain` against the table's exact string.

`apps/web/src/design/base.css`:

- Delete the `.score-sheet svg .timing-mark[data-timing='missed'] circle { stroke-dasharray … }` rule and its comment.
- Change the first comment's "The timing rings after a run of Play (issue 192, render/timingMarks.ts): thin gray rings beside or around a note" to "The timing rings of the waiting walk (issue 192, render/timingMarks.ts): thin gray rings beside a note".
- Keep the print rule.

## 6. Removal list

### 6.1 Files deleted

| File                                                                                                                                 | Builder |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `apps/web/src/score/timing.ts`, `apps/web/src/score/timing.test.ts`                                                                  | P       |
| `apps/web/src/audio/timeline.ts`, `apps/web/src/audio/transport.timeline.test.ts`, `apps/web/src/score/usePlayback.timeline.test.ts` | R       |
| `apps/web/src/score/useTimingRun.ts`, `apps/web/src/score/useTimingRun.test.tsx`                                                     | H       |
| `docs/superpowers/plans/2026-10-24-timing-feedback.md`                                                                               | E       |

### 6.2 Files restored to their state before PR 202

| File                                                            | Builder | What goes with it                                                                                                                       |
| --------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/audio/transport.ts`                               | R       | `Segment.pass`, `passSeq`, `runLog`, `heardAt`, `runPasses`, `wrapRun`, `closeRunAt`, the timeline import                               |
| `apps/web/src/score/usePlayback.ts`                             | R       | `heardAt`, `runPasses`, `playId`, `setPlayId`, the timeline import, `outputLatency` in `__digitus2Keys`                                 |
| `apps/web/src/score/ScoreView.tsx`, `ScoreView.status.test.tsx` | H       | `summaryLifetime`, `SummaryLife`, `NO_SUMMARY_LIFE`, `timingText`, `TimingSummary`, the `timing` status input (then section 5 is added) |
| `apps/web/src/i18n/{en,es,fr,nl,pt}/score.ts`                   | H       | `timingSummary`, `timingAllOnTime`, `timingAllOnTimeFaster` (then `timingExplain` is added)                                             |

After each restore, the file matches its state before PR 202 (before section 5 is added).

### 6.3 Symbols removed in kept files

- `render/timingMarks.ts` (P):
  - Remove `'missed'` from `MarkVerdict`, `MISSED_RING_SCALE`, `Ring.dashed`, the missed branch of `ringFor`, and the `data-timing="missed"` line in `markShape`. `TimingMark.offsetSec` and `RingInput.offsetSec` become `number`.
  - Rewrite the header's first sentence to "The timing rings of the waiting walk (issue 192), over the Verovio SVG: a thin gray ring about the size of a notehead beside each judged note that came clearly early or late." Drop "or not at all" and the sentence about the dashed ring around a missed note.
  - Change the `MarkNeighbour` doc to "The shape of walkTiming.ts's neighbours, declared here so this file stands alone", and drop "null when missed" from the `offsetSec` doc.
- `render/timingMarks.test.ts` (P): delete every missed-ring test (the dashed ring around the notehead, the `data-timing='missed'` attribute and its base.css check, "draws a missed note as a dashed ring around it", the missed entries in the mixed-marks cases, and "dashes the missed ring"). In "never makes a ring translucent or filtered (issue 79)", change `rules.length >= 3` to `>= 2` (the main rule and the print rule). Add no assertion that base.css lacks the missed rule: P runs before H.
- `playAlong.ts` (P): `StepNotes.barSec` and `PartNotes` (section 3.1).
- `e2e/helpers/midi.ts` (E): `HeardAt`, `PassSpan`, `TimingLogEntry`, `TimingStepView`, `UnitVerdictView`, `JudgementView`, the old `TimingHook`, `outputLatency` in `Windowed`, `timingHook`, `TimedHearing`, `TimedPlan`, `TimedReport`, `playAlongTimed`, `timedHearings` (`playRedTimed` stays: `playRed` uses it).
- Kept from the first build: `NoteMessage.atMs` and `velocity`, `eventTimeMs` and `EVENT_MAX_AGE_MS`, the parse and access changes and their tests, `FakeHost.send(bytes, input, atMs)` stamping `timeStamp`, the `.timing-mark` CSS and its print rule, and `drawTimingMarks` / `clearTimingMarks` / `ringFor` / `markShape`.

### 6.4 The dead-code grep (integration gate)

```bash
cd C:/Users/maxim/Desktop/projects/github/thingamajig/.claude/worktrees/ui-issues-7ded6a
grep -rn --exclude=2026-10-25-walk-timing.md "heardAt\|HeardAt\|heardNow\|runPasses\|playId\|countedIn\|PassSpan\|summaryLifetime\|timingSummary\|timingAllOnTime\|audio/timeline\|passSeq\|useTimingRun\|outputLatency\|Timing after a run\|a run of Play\|judgeRun\|timingSteps\|playAlongTimed\|timedHearings\|MISSED_RING_SCALE\|'missed'\|2026-10-24-timing-feedback\|TimingLogEntry\|TimingStepView\|UnitVerdictView\|JudgementView\|TimedHearing\|TimedPlan\|TimedReport\|timingHook\|RunJudgement\|biasMs\|playedShare\|beforeFirstNote\|pausedAxis\|barSecAt\|barSec:\|dashed:\|BIAS_SEARCH\|MATCH_WINDOW\|JUDGE_LAST_HEARINGS\|MIN_PLAYED_SHARE\|MIN_MATCHED\|LISTEN_MIN_STEPS\|REACTION_MIN_MS\|SEEK_GAP_SEC\|CONTEXT_STEPS\|PAUSE_WINDOW\|PartNotes" apps/web/src apps/web/e2e docs
```

It must print nothing. This plan file names the removed symbols on purpose and is excluded. `apps/web/dist` and `node_modules` are build output and are not searched. Do not add `TOLERANCE_FLOOR_MS` or `TOLERANCE_BEATS` (walkTiming.ts uses them), `StepNotes` (kept), bare `barSec` (audio/beats.ts at base) or bare `missed` / `dashed` (scan and drop-frame prose at base).

## 7. e2e (Builder E)

### 7.1 Helpers in `apps/web/e2e/helpers/midi.ts`

- Replace the old timing types with `WalkTimingHook` (section 4.6), and add it to `Windowed` as `__digitus2Timing?: WalkTimingHook`.
- Add a reader:

```ts
/** The walk's timing hook (issue 192), read through the page. */
export function walkTiming(page: Page) {
  return {
    steps: () =>
      page.evaluate(() => (window as unknown as Windowed).__digitus2Timing?.steps() ?? []),
    judged: () =>
      page.evaluate(() => (window as unknown as Windowed).__digitus2Timing?.judged() ?? []),
    onsets: () =>
      page.evaluate(() => (window as unknown as Windowed).__digitus2Timing?.onsets() ?? []),
    markCount: () =>
      page.evaluate(() => (window as unknown as Windowed).__digitus2Timing?.markCount() ?? 0),
  };
}
```

- Add `walkRhythm`, which walks steps on the fake piano in set rhythms, entirely in the page:

```ts
export interface RhythmPlan {
  /** The first step (the red must be waiting on it) and the last, inclusive, in walk order. */
  from: number;
  to: number;
  /** The reader's tempo: real milliseconds per performance second. */
  msPerSec: number;
  /** Signed ms added to a step's press (negative: early). */
  offsets?: Record<number, number>;
  /** Extra ms before a step's press (a hesitation), carried to every later step. */
  pauses?: Record<number, number>;
  /** Gives up after this many real ms; default 60 000. */
  timeoutMs?: number;
}

export interface RhythmReport {
  /** One per step pressed: the stamped time, when it went out, and the page at that moment. */
  sent: {
    index: number;
    pitches: number[];
    atMs: number;
    sentMs: number;
    marks: number;
    status: string;
  }[];
}

export async function walkRhythm(page: Page, plan: RhythmPlan): Promise<RhythmReport>;
```

Inside `page.evaluate`:

1. Read `steps = __digitus2Timing.steps()`. Throw unless `__digitus2Along.index() === from`.
2. Set `t0 = performance.now() + 50`.
3. For i in from..to, set `P_i = t0 + (steps[i].perfSec − steps[from].perfSec) × msPerSec + (offsets[i] ?? 0) + Σ_{from<k≤i} (pauses[k] ?? 0)`. Throw unless P is strictly increasing.
4. Releases: `R_i = max(P_{i+1} − 100, P_i + steps[i].holdMs + 200)` for i < to, and `R_to = P_to + steps[to].holdMs + 200`. So every step is held past its hold by at least 200 ms (the walk counts holds from arrival, and the margin absorbs Playwright's jitter), and a step before a rushed one is held legato.
5. Throw "the plan presses `<midi>` again before it comes up" when a pitch of step i appears in a later step j with `P_j < R_i + 30`.
6. Merge the events (ons at P, offs at R) and sort them by time, offs before ons at the same time.
7. Loop with `setTimeout(tick, 2)`. When `performance.now() >= event.t`, send each pitch with `__fakeMidi.send([0x90 | 0x80, midi, 100 | 0], undefined, event.t)`. The stamp is the scheduled time, which is never later than now, so `eventTimeMs` keeps it unchanged (it returns a plausible `timeStamp` as is). Before sending an on, record `marks` (`document.querySelectorAll('.timing-mark').length`, DOM rings) and `status` (`document.querySelector('.dock [role="status"]')?.textContent ?? ''`) in the report, and record `atMs` as `event.t`.
8. After the last event, wait (rAF polling) until `__digitus2Along.index() !== to`, or the timeout. Then return the report.

Consecutive `walkRhythm` calls are one continuous chain unless a seek or Rewind comes between them. The gap between two calls is the hold plus a round trip, not the reader's rhythm, so it would be judged. Start a second call only after a real break (Rewind, a seek), as tests 6 and 7 do.

Keep `fakeMidi`, `installFakeMidi`, `waitForStep`, `tap` and `playRed` as they are.

### 7.2 `apps/web/e2e/play-along-timing.spec.ts` (rewrite)

**Setup.**

- Twinkle at 75 % (`TEMPO = 0.75`), the fake piano connected, Practice mode on (default), `?audio=silent`, `embellishDecided(page, 'offered')`, and the walk on its first step (`fakeMidi(page).waitForStep()`).
- Assert:
  - `walkTiming(page).steps()` pitches start with `FIRST_STEPS` (the same eleven groups as the first build).
  - Their `bar`s start `[0,0,0,0,1,1,1,2,2,2,2]`.
  - Step 1's `holdMs` is within 1 of 800.
- Constants:
  - `MS_PER_SEC = 2500`: a quarter (0.6 performance seconds) is 1,500 ms real at the reader's tempo, 700 ms more than the 800 ms hold, so the page has time to render a judgement before the next press.
  - `RUSH_MS = 600`, 225 ms clear of the 375 ms tolerance (`0.25 × 1500`).
  - `PAUSE_MS = 3000`: the gap of 4,500 ms is past the pause line of `1500 + 300 + 1500 = 3300`.
- The explanation text: `EXPLAIN = 'A ring before a note means it came early; after it, late.'`
- Tests 2, 4, 5, 6 and 8 call `test.setTimeout(120_000)`.

The rushed steps share no pitch with the step before them: step 2 (`[67]` after `[60]`, one staff) and step 6 (`[48 67]` after `[69]`, both staves). Never rush step 3 or step 5.

**Tests**, each ending with `expectOneRed(page, label)`:

1. **The first step needs every key, held; a tap asks for a longer hold** (the owner's report).
   - Fresh load, Hands both: `fakeMidi(page).noteOn(60)` alone and wait 1,600 ms (twice the hold). `index()` is still 0, and the status reads `Play the red notes on your piano.`
   - Then `noteOn(48)` while 60 is still held: after the hold, `index()` becomes 1. Release both.
   - Rewind (the dock's Rewind button, then `waitForStep()` and `index() === 0`). `fakeMidi(page).tap([48, 60], 100)` leaves `index()` at 0, and the status reads `Hold the red notes a little longer.`
   - `playRed()` returns 0, and `index()` becomes 1.
2. **An even walk leaves no ring, and onsets carry the event time.**
   - `walkRhythm({ from: 0, to: 10, msPerSec: MS_PER_SEC })`.
   - `judged()` has entries for indices 2..10 (bars 0, 1 and 2), all `onTime`.
   - For every k, `onsets().find((o) => o.index === sent[k].index).ms === sent[k].atMs` exactly.
   - `.timing-mark` count 0. No `sent[].status` equals `EXPLAIN`.
3. **A rushed note gets one ring before it once the bar is left.**
   - `walkRhythm({ from: 0, to: 4, msPerSec: MS_PER_SEC, offsets: { 2: -RUSH_MS } })`.
   - `sent[3].marks` is 0 (bar 0 not left yet) and `sent[4].marks` is 1 (bar 0 was judged at step 3's pass, at least 700 ms before step 4's press).
   - Exactly one `.timing-mark[data-timing="early"]`, and `walkTiming(page).markCount()` is 1.
   - Its circle's bounding box lies left of step 2's notehead: find the note by `steps[2].ids[0]`, then `g.notehead` inside it; assert `ring.right < head.left`.
   - The judgement for index 2 is `early`, with `offsetMs` within 0.5 of −600 and `tolMs` within 0.5 of 375 (`toBeCloseTo`: both come from float arithmetic); `onsets()` for index 2 equals `sent[2].atMs` exactly (the same number, passed through the stamp).
   - The status reads `EXPLAIN`.
4. **The explanation leaves after two more bars, and does not come back.**
   - One call: `walkRhythm({ from: 0, to: 10, msPerSec: MS_PER_SEC, offsets: { 2: -RUSH_MS } })`. Do not split it into two calls: section 7.1 explains why.
   - `sent[4].status === EXPLAIN`: bar 0 was judged at step 3's pass, at least 700 ms before step 4's press.
   - `sent[7].status === EXPLAIN`: bar 1 has been judged (at step 6's pass), one bar after.
   - At the end (bar 2 left), poll until the status is empty; the ring of bar 0 is still there (count 1).
5. **A long hesitation is not judged.**
   - `walkRhythm({ from: 0, to: 10, msPerSec: MS_PER_SEC, pauses: { 5: PAUSE_MS } })`.
   - No ring.
   - `judged()` has no entry with index 5 or 6, and has entries for indices 7, 8, 9 and 10, all `onTime`.
6. **Replaying the bar clears its rings; the explanation stays gone.**
   - Test 3's walk.
   - Rewind (click the dock's Rewind button and wait for `waitForStep()` and `index() === 0`). The ring is still there.
   - `walkRhythm({ from: 0, to: 7, msPerSec: MS_PER_SEC, offsets: { 6: -RUSH_MS } })`. Its `sent[1].marks` is 0 (bar 0's ring went at step 0's pass).
   - At the end, exactly two rings, both `[data-timing="early"]`, in two different `g.staff` elements, each staff holding one of `steps[6].ids`; `walkTiming(page).markCount()` is 1.
   - No `sent[].status` equals `EXPLAIN`, and neither does the status at the end.
7. **Play clears the rings, and a seek keeps them.**
   - Test 3's walk.
   - Click bar 3 (`seekBar` from `helpers/seek.js`). The ring stays.
   - Click Play: the ring count goes to 0 while it plays.
   - Click Pause.
8. **Light and dark, at 360 and 1280, and print.**
   - For each width (`test.use({ viewport })`, 360 × 800 and 1280 × 900) and scheme (`page.emulateMedia({ colorScheme })`): test 3's walk, then check:
     - `horizontalOverflow(page) <= 0`;
     - `expectOneRed`, with every red root in the sheet;
     - `expectNoSeriousA11y`;
     - the ring's computed stroke equals `var(--gray-3)` resolved by a probe circle: `rgb(118, 118, 118)` light, `rgb(140, 140, 140)` dark; `seen.strokes` has length 1;
     - no ring box overlaps a `g.fing` box.
   - After the theme checks: `await page.emulateMedia({ media: 'print' }); await expect(page.locator('.timing-mark')).toBeHidden();` then `await page.emulateMedia({ media: 'screen' })`.
   - Copy the probe and overlap code from the first build's spec, changing its expected stroke count from 4 to 1.
   - Unless `process.env.CI`: scroll the first `g.system` into view, `mkdirSync('build/timing-marks', { recursive: true })`, and `page.screenshot({ path: \`build/timing-marks/${scheme}-${width}.png\` })`. The files are `light-360.png`, `dark-360.png`, `light-1280.png`and`dark-1280.png`in`apps/web/build/timing-marks/`.

The spec runs in the `desktop` project only (the mobile project's pattern does not match it), as before. 360 px is covered by `test.use({ viewport })`.

### 7.3 `apps/web/e2e/helpers/states.ts`

- Keep the state named `score-timing-marks`, rewritten:
  - `installFakeMidi(page, { permission: 'granted', playAlong: true, tempo: { [TWINKLE]: 0.75 } })`;
  - `twinkleReady(page, '?audio=silent')`;
  - `fakeMidi(page).waitForStep()`;
  - `walkRhythm(page, { from: 0, to: 4, msPerSec: 2500, offsets: { 2: -600 } })`.
- Then `expect(page.locator('.timing-mark')).toHaveCount(1)`, and `expect(page.getByRole('status')).toHaveText('A ring before a note means it came early; after it, late.')`.
- `expectTag: 'cursor'` (the red is on step 4).
- Replace the imports `playAlongTimed`, `timedHearings` and `timingHook` with `walkRhythm`.

## 8. Docs (Builder E)

Present tense, current state, no dates, hashes, branch names or credits. Write "issue 192", never a hash sign followed by digits.

### 8.1 `docs/app.md`

| Where (current line)                                                                                                                                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 101 `- Timeline (issue 192): …`                                                                                                                      | Delete the bullet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 102 hooks list                                                                                                                                       | Keep `__digitus2Timing`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 126 `**The time of a key**`                                                                                                                          | Replace its last sentence with: "The walk's timing reads them (Playing along on a piano, Timing in the walk); the walk itself counts holds from the arrival time."                                                                                                                                                                                                                                                                                                                                                                 |
| 371 to the last row of the table whose header starts `\| After a run, with a piano connected` (the whole block that starts `**Timing after a run**`) | Replace with the section in 8.2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| The walk's state table, after its **last** row (`Loading, fingering, an error, …`)                                                                   | Add the row: `\| The red moves into the next bar (or the loop wraps, or the piece ends) \| The bar just left gets a gray ring at the note that came most clearly early (before it) or late (after it) against the reader's own pulse (Timing in the walk). \|`. Do not touch the row `A step let go too early` (PR 201 edits it).                                                                                                                                                                                                  |
| 464 `- **Status line.**`                                                                                                                             | Replace "After a run of Play with the piano the timing summary takes the line between those two (Playing along on a piano, Timing after a run)." with "The first time timing rings appear in the view, `A ring before a note means it came early; after it, late.` takes the line between those two until two more bars are judged (Playing along on a piano, Timing in the walk)."                                                                                                                                                |
| 366 `- **Status line.** Two more lines, the lowest in priority …` (the walk section's own bullet)                                                    | Append: "After a bar with a ring, the first time in the view: `A ring before a note means it came early; after it, late.` (Timing in the walk)."                                                                                                                                                                                                                                                                                                                                                                                   |
| 521 `- The timing rings after a run of Play (issue 192) …`                                                                                           | Rewrite: "The timing rings of the walk (issue 192) are gray (`--gray-3`) and sit in the `g.staff`, outside every `g.note` and `g.chord`, so the `.is-red` rules (`svg .is-red *`) never reach them; the red stays the only red." Drop the sentence about the last group after a Pause.                                                                                                                                                                                                                                             |
| 571 `- **The timing rings**`                                                                                                                         | Keep the contrast numbers. Replace any mention of the dashed missed ring or of a run of Play with the walk.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 624 `- \`play-along-timing\` …`                                                                                                                      | Rewrite to the tests of section 7.2 in one sentence each.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 668 `score-timing-marks` row                                                                                                                         | `\| score-timing-marks \| score-along at 75 %: steps 0 to 4 walked at 2,500 ms per performance second, step 2 pressed 600 ms early: one ring, the explanation \| cursor \|`                                                                                                                                                                                                                                                                                                                                                        |
| 675 (The test hook paragraph)                                                                                                                        | Replace the `__digitus2Timing` sentence with: "It installs `window.__digitus2Timing` (`src/score/useWalkTiming.ts`, issue 192) with `steps()` (the steps of the hands played, aligned with `__digitus2Along`: perfSec, pitches, bar, writtenBar, ids, holdMs), `onsets()` (the timed onsets since the last clear, with their chain), `judged()` (every judgement since the last clear) and `markCount()` (the ringed steps kept; the sheet draws one ring per staff)." Delete the sentence about `__digitus2Keys.outputLatency()`. |
| 677 (fake Web MIDI paragraph)                                                                                                                        | Replace the `playAlongTimed` sentence with one on `walkRhythm`: "presses each step at a set rhythm, stamped with its own time, and holds it past its hold".                                                                                                                                                                                                                                                                                                                                                                        |
| 770 limitation                                                                                                                                       | "Timing in the walk (issue 192) judges when keys go down, against the reader's own pulse: rests, note lengths and releases are not judged, nor are dotted and triplet subdivisions inside a beat, gaps the red does not wait out, or a hesitation. Its windows are provisional until they are set from the owner's piano ([issue 192](https://github.com/MarchalMaxim/digitus2/issues/192))."                                                                                                                                      |

### 8.2 The new section (under Playing along on a piano, where "Timing after a run" was)

```markdown
**Timing in the walk** (issue 192). While the reader walks the piece on their piano, digitus compares their rhythm with the written one, against their own pulse, and after each bar it marks the note that came most clearly early or late. The red still waits; no control is added; Play plays the song and judges nothing. The code is `score/walkTiming.ts` (pure: the plan, the judge, the rings' data), `score/useWalkTiming.ts` (the listener), `score/render/timingMarks.ts` (the rings; their shape is `markShape` alone) and the walk's read-only tap (`Settled.passedRuns` in `playAlong.ts`, `onTiming` in `usePlayAlong.ts`).

- **Onsets.** A step's onset is the start of the run that passed it (`runSince`): its last key down, so a rolled chord counts from its last key and a step pressed early from its own press. The time is the decisive key's event time (`NoteMessage.atMs`, MIDI input), found in the listener's own log of note-ons, which subscribes before the walk's; the arrival time stands in when the log does not have it. Releases are not judged.
- **The reader's pulse.** Each gap between consecutive onsets is compared with the written gap in performance seconds, which carry the tempo marks, the rests and the repeats. The tempo is the median ratio of real to written gaps within `TEMPO_WINDOW` gaps, so any speed works and slow drift is followed; a steady latency moves every onset alike and cancels in the gaps.
- **The verdict.** A waiting walk has no clock to return to, so a note is judged by the gap into it: early when that gap is shorter than the written one at the reader's tempo by more than the tolerance, late when longer. A gap that only puts back the one before it (a note moved, then the pulse resumed) is not rung, so one early note gives one ring and a lasting shift gives at most one, on the note after it. The tolerance is the largest of `TOLERANCE_FLOOR_MS`, `TOLERANCE_BEATS` of the felt beat (`TOLERANCE_SUBBEAT_BEATS` for a gap shorter than the beat in a simple meter; the felt beat is three of the time signature's beats when it counts more than three of an eighth or shorter, a multiple of three, as in 6/8, 9/8, 12/8 and 12/16, else the time signature's beat) and `TOLERANCE_GAP` of the written gap, both at the reader's tempo. Dotted and triplet subdivisions inside a beat stay within it and are not judged: a dotted eighth and sixteenth played as two even notes move the sixteenth by a quarter of a beat, short of the third of a beat a gap inside a beat allows. A compound meter keeps `TOLERANCE_BEATS`: its felt beat is three of its beats, and a third of that would be exactly one of them.
- **Pauses and breaks.** A gap longer than the rhythm asks by more than `PAUSE_FLOOR_MS` plus the smaller of (`PAUSE_RATIO` − 1) times the expected gap and `PAUSE_BEATS` felt beats is a pause: the walk doing its job, not judged. So a search for the next notes after a whole note, or a fermata held as written, is a pause. The chain also breaks at every move the walk did not make (a seek, Rewind, a loop or hands change, Play then Pause), when the walk goes inactive, at a loop's wrap, at the finish and at a release too early (the step is pressed again). The first gap after a break or a pause is never rung, and a stretch of fewer than `MIN_FIT_ONSETS` onsets judges nothing. After a note followed by a rest the red moves on when the note ends, so that gap is neither judged nor counted in the tempo.
- **When.** A bar is judged when the walk leaves it: the red moves into the next bar, the loop wraps, or the piece ends. A visit a seek cuts short is not judged. In the last two bars of the piece (as heard, after repeats) only early notes are marked, wherever the bar is judged (moving into the last bar, at the finish, at the wrap of a loop over the ending), because a written `rit.` or `rall.` is not in the tempo map.
- **The rings.** At most `MAX_RINGS_PER_BAR` ringed step per bar, the one furthest past its tolerance, with one thin gray ring per staff on its notes, before them when it came early and after them when late, as far as the local spacing says (`ringFor`: at least `RING_MIN_SHIFT` noteheads, at most half the gap to the neighbour). They are keyed by the written bar, so a repeat's second hearing marks the same notes. A bar's rings go at the first step passed when it is played again; the others stay. A new score, a hands change, Practice mode off, the piano gone and Play clear them all; a seek, Rewind or a loop change keep them.
- **The explanation.** The first time rings appear in the view the status line says `A ring before a note means it came early; after it, late.` (all five languages) until two more bars are judged, a break or a clear, and never again in that view. It ranks under the hold hint and above the play hint. Only bars judged while it is on the line count, so the loading of the piano, a count-in beat or the sound sentence (which rank above it) do not spend it; one a break or a clear ended before it was on the line comes again at the next ring.

  The constants are exported from `score/walkTiming.ts` and are provisional until the owner's sessions on the piano set them (`docs/research/play-along-timing.md`):

  | Constant                  | Value | What it sets                                                                    |
  | ------------------------- | ----- | ------------------------------------------------------------------------------- |
  | `TOLERANCE_FLOOR_MS`      | 120   | the tolerance never goes below it                                               |
  | `TOLERANCE_BEATS`         | 0.25  | the tolerance in felt beats at the reader's own tempo                           |
  | `TOLERANCE_SUBBEAT_BEATS` | 1/3   | the same for a gap shorter than the felt beat in a simple meter (subdivisions)  |
  | `TOLERANCE_GAP`           | 0.2   | the tolerance as a share of the written gap (long notes spread more)            |
  | `PAUSE_RATIO`             | 2     | a gap up to a beat this many times the expected one (plus the floor) is a pause |
  | `PAUSE_FLOOR_MS`          | 300   | the pause test's floor                                                          |
  | `PAUSE_BEATS`             | 1     | the pause margin for longer gaps stops growing at this many felt beats          |
  | `TEMPO_WINDOW`            | 8     | the gaps on each side the reader's tempo is taken from                          |
  | `MIN_FIT_ONSETS`          | 4     | fewer onsets in a stretch judge nothing                                         |
  | `MIN_TEMPO_GAPS`          | 3     | fewer timed gaps around a gap leave it unjudged                                 |
  | `MAX_RINGS_PER_BAR`       | 1     | ringed steps per bar                                                            |
  | `PRESS_MATCH_MS`          | 20    | how close a logged note-on is to a run start to be its press                    |
  | `EXPLAIN_BARS`            | 2     | bars judged after it before the explanation leaves                              |

| In the walk, with a piano connected and Practice mode on             | The sheet                             | The status line                      |
| -------------------------------------------------------------------- | ------------------------------------- | ------------------------------------ |
| The red moves into the next bar, an even bar behind it               | nothing new                           | as before                            |
| …a note in it clearly early or late                                  | a gray ring before or after that note | the explanation, the first time only |
| The reader hesitates, then plays on                                  | nothing for the gap                   | as before                            |
| The bar is played again                                              | its rings go at its first step        | as before                            |
| A seek, Rewind, a loop change                                        | the rings stay                        | the explanation goes                 |
| Play, a new score, a hands change, Practice mode off, the piano gone | all rings go                          | the explanation goes                 |
```

### 8.3 `docs/PROGRESS.md`

- Line 11: replace the sentence that starts "With Practice mode on, a run of Play is the reader's turn …" with: "While the reader walks a piece on the piano, digitus compares their rhythm with the written one against their own pulse, and after each bar a thin gray ring marks the note that came most clearly early (before it) or late (after it); a hesitation is not judged, and Play only plays ([#192](https://github.com/MarchalMaxim/digitus2/issues/192); `docs/app.md`, Timing in the walk; the plan is `docs/superpowers/plans/2026-10-25-walk-timing.md`)." Keep the latency sentence, reworded to "The windows wait for the owner's piano (`docs/research/play-along-timing.md`)."
- Line 171 (Decisions > App and UI): replace the bullet with: "- **Timing in the waiting walk ([#192](https://github.com/MarchalMaxim/digitus2/issues/192)).** The red still waits; no control is added and Play judges nothing. Onsets are the run starts of the steps the walk passed, at the key's event time; each gap is compared with the written gap at the reader's own tempo (a local median ratio), so any speed works and steady latency cancels; a hesitation, and every move the walk did not make, breaks the chain and is not judged. A bar is judged when the walk leaves it: one gray ring before (early) or after (late) its most uneven note; a bar's rings go when it is played again, and all go at Play, a new score, a hands change, Practice mode off or the piano gone. The windows are provisional."
- Line 211: replace it with: "- Timing in the walk ([#192](https://github.com/MarchalMaxim/digitus2/issues/192)) judges onsets against the reader's own pulse only (not rests, lengths, releases or subdivisions inside a beat), skips hesitations, and its windows are provisional."
- Keep PROGRESS's existing issue-link style. The colour guard scans only `apps/web/src` and `apps/web/index.html`.

### 8.4 `docs/research/play-along-timing.md`

Rewrite it. Same title idea, "Play-along timing: latency, jitter and the judging windows".

- The judge compares gaps between the reader's onsets, so a **steady** latency (USB, Bluetooth, the reader's reaction) cancels out and is not measured for the verdict.
- What matters is **jitter**: the spread of arrival minus event time, and of Bluetooth batching, because it moves single onsets.
- The method keeps reading `__digitus2Timing.onsets()`. Note-ons carry `atMs`, so the jitter is the spread of `atMs` against the intended rhythm.
- The session is: walk Twinkle at 60, 80 and 100 % trying to play evenly, over USB and over Bluetooth, and record the deviations the judge reports (`__digitus2Timing.judged()`, `offsetMs`) for bars the owner calls even.
- The table's columns:

| Connection | Practice tempo | Deviation median abs (ms) | Deviation p95 (ms) | Suggested `TOLERANCE_FLOOR_MS` | `TOLERANCE_BEATS` | `TOLERANCE_GAP` | `PAUSE_RATIO` |
| ---------- | -------------- | ------------------------- | ------------------ | ------------------------------ | ----------------- | --------------- | ------------- |

- Leave the table empty until those sessions happen.
- Remove every mention of `outputLatency`, the run axis, the bias search and the match window.
- Keep the sources that still apply: the Web MIDI `timeStamp` reference. Drop the MDN `outputLatency` line.
- Point to `apps/web/src/score/walkTiming.ts` and `walkTiming.test.ts`.

### 8.5 Delete `docs/superpowers/plans/2026-10-24-timing-feedback.md`

This plan replaces it.

## 9. Work split

Order:

1. **P** and **R** in parallel.
2. Then **H**.
3. Then **E**.

Every file is in exactly one set. A builder writes nowhere else. If a builder needs a change outside its set, it stops and reports.

| Builder          | Files (create, edit or delete)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P (pure)         | `apps/web/src/score/walkTiming.ts` (new), `apps/web/src/score/walkTiming.test.ts` (new), `apps/web/src/score/playAlong.ts`, `apps/web/src/score/playAlong.test.ts`, `apps/web/src/score/render/timingMarks.ts`, `apps/web/src/score/render/timingMarks.test.ts`, delete `apps/web/src/score/timing.ts` and `apps/web/src/score/timing.test.ts`                                                                                                                                                                                                                                                            |
| R (removal)      | `apps/web/src/audio/transport.ts` (restore), `apps/web/src/score/usePlayback.ts` (restore), delete `apps/web/src/audio/timeline.ts`, `apps/web/src/audio/transport.timeline.test.ts`, `apps/web/src/score/usePlayback.timeline.test.ts`                                                                                                                                                                                                                                                                                                                                                                   |
| H (hook and UI)  | `apps/web/src/score/useWalkTiming.ts` (new), `apps/web/src/score/useWalkTiming.test.tsx` (new), delete `apps/web/src/score/useTimingRun.ts` and `apps/web/src/score/useTimingRun.test.tsx`, `apps/web/src/score/usePlayAlong.ts`, `apps/web/src/score/usePlayAlong.test.tsx`, `apps/web/src/score/ScoreView.tsx`, `apps/web/src/score/ScoreView.status.test.tsx`, `apps/web/src/i18n/en/score.ts`, `apps/web/src/i18n/es/score.ts`, `apps/web/src/i18n/fr/score.ts`, `apps/web/src/i18n/nl/score.ts`, `apps/web/src/i18n/pt/score.ts`, `apps/web/src/i18n/timing.test.ts`, `apps/web/src/design/base.css` |
| E (e2e and docs) | `apps/web/e2e/play-along-timing.spec.ts`, `apps/web/e2e/helpers/midi.ts`, `apps/web/e2e/helpers/states.ts`, `docs/app.md`, `docs/PROGRESS.md`, `docs/research/play-along-timing.md`, delete `docs/superpowers/plans/2026-10-24-timing-feedback.md`; the screenshots under `apps/web/build/timing-marks/` (build output, not committed)                                                                                                                                                                                                                                                                    |

**The API between P and H** is section 2.1 (`walkTiming.ts`, exact), plus:

- `PassedRun` and `Settled.passedRuns` in `playAlong.ts` (section 3.1);
- `StepNotes` as `{ ids: readonly string[]; beatSec: number }` (section 3.1);
- `TimingMark` in `render/timingMarks.ts`, which becomes `{ ids: readonly string[]; verdict: 'early' | 'late'; offsetSec: number; prev: MarkNeighbour | null; next: MarkNeighbour | null }`;
- unchanged `drawTimingMarks(root, marks, boxOf?)`, `clearTimingMarks(root)` and `MARK_CLASS`.

H codes against these names only.

**The API between H and E** is `window.__digitus2Timing` (section 4.6, with `markCount()`), plus the status text, the `.timing-mark` class and its `data-timing="early" | "late"` attribute.

## 10. Verification

Run everything from the worktree root, in Git Bash. Under load, vitest's 5 s timeout can drop a random test: rerun that file once before calling it a failure. Each Bash call starts a fresh shell, so environment variables are written inline in the command that uses them. Commands that take more than about two minutes (the build, e2e, verify) run with `run_in_background`.

- **P:** `pnpm --filter @digitus2/web exec vitest run src/score/walkTiming.test.ts src/score/playAlong.test.ts src/score/render/timingMarks.test.ts`. All tests must pass, with the walkTiming tests written first and seen failing. `grep -n barSec apps/web/src/score/playAlong.test.ts` prints nothing. Do not run tsc while R and H are mid-flight: `useTimingRun.ts` still imports `timing.ts` until H deletes it.
- **R:**
  - `apps/web/src/audio/transport.ts` and `apps/web/src/score/usePlayback.ts` match their state before PR 202.
  - `pnpm --filter @digitus2/web exec vitest run src/audio/transport.test.ts src/score/usePlayback.accompany.test.ts src/score/usePlayback.strike.test.ts` passes.
- **H:**
  - `pnpm --filter @digitus2/web exec vitest run src/score/useWalkTiming.test.tsx src/score/usePlayAlong.test.tsx src/score/ScoreView.status.test.tsx src/i18n/timing.test.ts src/score/render/timingMarks.test.ts` passes (the last file checks the base.css change against P's test).
  - Then, since P and R are done, `pnpm --filter @digitus2/web typecheck` is clean.
- **E:**
  - Pick a free port from 4517–4530 (never 5173, 5174 or 4173): `curl -sf http://localhost:4521 >/dev/null && echo BUSY` must print nothing; otherwise try the next port.
  - `pnpm --filter @digitus2/web build` (background).
  - `DIGITUS2_E2E_PORT=4521 pnpm --filter @digitus2/web exec playwright test e2e/play-along-timing.spec.ts e2e/states.spec.ts --project=desktop` (background), then `DIGITUS2_E2E_PORT=4521 pnpm --filter @digitus2/web exec playwright test e2e/states.spec.ts --project=mobile` (background). Everything passes.
  - The four screenshots exist in `apps/web/build/timing-marks/`.
- **Integration gate** (the coordinator, after E), in order:
  1. `pnpm typecheck`
  2. `pnpm lint`
  3. `pnpm test` (all unit tests)
  4. `pnpm format:check`
  5. `node scripts/check-colors.mjs`
  6. The dead-code grep of 6.4: nothing printed.
  7. The full e2e, `DIGITUS2_E2E_PORT=<free port> pnpm --filter @digitus2/web exec playwright test` (background).
  8. `DIGITUS2_E2E_PORT=<free port> pnpm verify --changed` (background).

  Then one full `DIGITUS2_E2E_PORT=<free port> pnpm verify` (background) before the pull request is marked ready. Benchmark gates that report SKIP without the PIG dataset are not a pass; say so in the PR.
