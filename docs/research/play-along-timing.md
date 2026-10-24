# Play-along timing: latency and the judging windows

The timing feedback after a run of Play ([issue 192](https://github.com/MarchalMaxim/digitus2/issues/192); `docs/app.md`, Playing along on a piano, Timing after a run) judges each key against the note it belongs to, after taking away the reader's steady offset. Its windows are provisional. This note says how to measure what they must absorb on the owner's own piano, over USB and over Bluetooth, and how the constants are then set. The table is empty until those sessions are done.

## What is measured

| Quantity                              | Where it comes from                                                                                                             | Why it matters                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Arrival minus event time              | `__digitus2Timing.presses()`: `arrivalMs - atMs` for each note-on                                                               | How long the main thread held a message before the app saw it. The judge uses the event time, so this is what it saves. |
| The audio's output latency            | `__digitus2Keys.outputLatency()` (`AudioContext.outputLatency`, seconds)                                                        | How late Play's notes leave the speakers. The transport's clock already counts the latency the browser reports (`audibleTime` follows `getOutputTimestamp()`), so a press is judged against the music as heard. The column is recorded for reference and is not subtracted from the natural offset; only on the `currentTime` fallback, with no usable output timestamp, does the clock miss it. |
| Bluetooth MIDI latency and its jitter | the loopback check below                                                                                                        | The steady part is taken away by the bias; the jitter is not, so the tolerance floor must sit above it.                |
| The reader's natural offset           | `__digitus2Timing.judgement().biasMs` after a short run                                                                         | The sum of everything steady the clock does not already count: the MIDI link, any output latency the browser does not report (all of it when `getOutputTimestamp()` is missing and the clock falls back to `currentTime`), and the reader's own habit of playing behind or ahead. |

The event time is the `timeStamp` of the `MIDIMessageEvent`, a `DOMHighResTimeStamp` on the same clock as `performance.now()`, which the Web MIDI specification says is the time the message was received by the system. `eventTimeMs` in `apps/web/src/midi/parse.ts` keeps it only when it is plausible (positive, not in the future by more than 1 ms and at most 1,000 ms old) and otherwise uses the arrival time, so `arrivalMs - atMs` is 0 for a message whose stamp was refused.

## The method

1. Open the app with `?hooks=1` (for example `https://marchalmaxim.github.io/digitus2/?hooks=1`), connect the piano from the library's line and open Twinkle, Twinkle, Little Star. Practice mode stays on. Turn the metronome and the count-in on in the Practice panel.
2. In the browser's console, read the output latency once: `__digitus2Keys.outputLatency()`. It is `null` until the first Play has made the audio context.
3. For each tempo of 60 %, 80 % and 100 %: press Play and play along the first two bars, 8 to 16 notes, as evenly as possible on the clicks, then Pause. Read:
   - `__digitus2Timing.judgement().biasMs`, the natural offset of that run;
   - the event time against arrival over the run: `__digitus2Timing.presses().filter((p) => p.pass !== null).map((p) => p.arrivalMs - p.atMs)`, for its median and 95th percentile.
4. Repeat steps 1 to 3 over USB and over Bluetooth (on Windows with Chrome's `#use-winrt-midi-api` flag set, `docs/app.md`, Known limitations). Three runs per tempo and connection give a spread.

The hook keeps the last 2,000 note-ons heard while armed, so a console session holds many runs; `presses()` lists them oldest first, each with the pass it was heard in.

## The loopback check for Bluetooth

The bias takes away every steady delay, so what matters for the windows is how much the Bluetooth link's delay varies from key to key. With the piano connected over USB and over Bluetooth at the same time (where the piano allows both links at once), every key arrives twice: the store reports a second note-on without a note-off again (`docs/app.md`, MIDI input). In `presses()` each key then gives a pair of entries close together, and the arrival of the Bluetooth one minus the USB one (about 1 ms) is the Bluetooth latency of that key. Thirty keys struck slowly, one at a time, give its median (the steady part) and its spread (the jitter). Where the piano offers only one link at a time, the spread of `biasMs` over repeated runs at one tempo is the coarse stand-in.

## Results

Empty until the owner's sessions. Offsets in milliseconds; a negative natural offset means the reader plays ahead of the music.

| Connection                     | Arrival minus event time, median | p95 | `outputLatency` (ms) | Natural offset at 60 % | at 80 % | at 100 % | Suggested `TOLERANCE_FLOOR_MS` | `TOLERANCE_BEATS` | `BIAS_SEARCH_MIN_MS` | `MATCH_WINDOW_BEATS` |
| ------------------------------ | -------------------------------: | --: | -------------------: | ---------------------: | ------: | -------: | -----------------------------: | ----------------: | -------------------: | -------------------: |
| USB                            |                                  |     |                      |                        |         |          |                                |                   |                      |                      |
| Bluetooth (Chrome, WinRT flag) |                                  |     |                      |                        |         |          |                                |                   |                      |                      |

## How the constants get set

The constants are exported from `apps/web/src/score/timing.ts`. Their starting values and what each sets are in `docs/app.md` (Timing after a run).

- **`BIAS_SEARCH_MIN_MS`** (500) must reach past the largest natural offset measured, with room: the search finds the steady offset before matching, and a lag beyond its reach would read as every note late. Set it to the largest natural offset in the table plus 100 ms, never below a beat at the fastest Practice tempo.
- **`TOLERANCE_FLOOR_MS`** (120) must sit above what varies from key to key once the steady part is gone: the Bluetooth jitter (its p95 minus its median) plus the spread of a careful reader's own taps. It stays above about 100 ms, below which a beginner cannot act on the difference.
- **`TOLERANCE_BEATS`** (0.25) sets how far from the beat counts as clearly early or late at slow tempos, where the floor is not reached. It is a teaching choice, a quarter of a beat (the smallest subdivision a beginner counts), and changes only if the owner finds the rings too eager or too lenient at 60 %.
- **`MATCH_WINDOW_BEATS`** (0.75) must keep a note played 0.6 of a beat late as late, not missed, and stay short of the next note of the same pitch; it widens only if the sessions show notes that were played being called missed.

A change of a constant is checked by `apps/web/src/score/timing.test.ts`, whose cases name their boundaries, and by `apps/web/e2e/play-along-timing.spec.ts`.

## Sources

- Web MIDI API, `MIDIMessageEvent` and its time stamp: https://www.w3.org/TR/webmidi/
- MDN, `MIDIMessageEvent`: https://developer.mozilla.org/en-US/docs/Web/API/MIDIMessageEvent
- MDN, `Event.timeStamp` (a `DOMHighResTimeStamp` on the `performance.now()` clock): https://developer.mozilla.org/en-US/docs/Web/API/Event/timeStamp
- MDN, `AudioContext.outputLatency`: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency
