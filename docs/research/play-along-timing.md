# Play-along timing: latency, jitter and the judging windows

The timing in the waiting walk ([issue 192](https://github.com/MarchalMaxim/digitus2/issues/192); `docs/app.md`, Playing along on a piano, Timing in the walk) compares each gap between the reader's onsets with the written gap, at the reader's own tempo, and after each bar it rings the note that came clearly early or late. Its windows are provisional. This note says what they must absorb, how to measure it on the owner's own piano over USB and over Bluetooth, and how the constants are then set. The table is empty until those sessions are done.

## What the windows absorb

The judge compares gaps between onsets, so a **steady** latency (USB, Bluetooth, the reader's reaction) moves every onset alike and cancels out; it is not measured for the verdict, and nothing in the page subtracts it.

What matters is **jitter**: how much the delay between a key going down and the page hearing of it varies from key to key. It moves single onsets, and so one gap. Two things make it: the main thread holding a message for a while (arrival minus event time), and the batching of Bluetooth MIDI, which can deliver several messages at once. The page uses the event time of each key rather than its arrival, which takes the first out; what is left is the variation in the link's own time stamp, and the reader's own spread.

The event time is the `timeStamp` of the `MIDIMessageEvent`, a `DOMHighResTimeStamp` on the same clock as `performance.now()`, which the Web MIDI specification says is the time the message was received by the system. `eventTimeMs` in `apps/web/src/midi/parse.ts` keeps it only when it is plausible (positive, not in the future by more than 1 ms and at most 1,000 ms old) and otherwise uses the arrival time. Every note-on carries it as `NoteMessage.atMs`.

## What is measured

| Quantity                        | Where it comes from                                                                                        | Why it matters                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| The deviation of a note         | `__digitus2Timing.judged()`: `offsetMs`, the gap into the note minus the written gap at the reader's tempo | What the tolerance must absorb in a bar the owner calls even. Its median absolute value and 95th percentile set the windows. |
| The tolerance at that note      | the same entries' `tolMs`                                                                                  | What the constants give today for that note, to set against the deviations.                                                 |
| The onsets and their event time | `__digitus2Timing.onsets()`: `ms` is the event time of the key that started each run, `chain` the break-free stretch | The gaps the judge works from, to check a deviation by hand.                                                                |
| The link's jitter               | the spread of the deviations over Bluetooth minus their spread over USB, for the same reader at one tempo  | The part of the spread that only Bluetooth adds, which the tolerance floor must sit above.                                  |

## The method

1. Open the app with `?hooks=1` (for example `https://marchalmaxim.github.io/digitus2/?hooks=1`), connect the piano from the library's line and open Twinkle, Twinkle, Little Star. Practice mode stays on.
2. For each tempo of 60 %, 80 % and 100 % (the Practice panel's Tempo slider): walk the piece from the first step, pressing each step in time and trying to play evenly.
3. In the browser's console, read what the judge saw, for bars the owner calls even:
   - `__digitus2Timing.judged().map((j) => [j.bar, j.index, j.verdict, Math.round(j.offsetMs), Math.round(j.tolMs)])`, the deviation and the tolerance of every judged note since the last clear;
   - `__digitus2Timing.onsets()`, the onsets with their event times.
4. Repeat steps 1 to 3 over USB and over Bluetooth (on Windows with Chrome's `#use-winrt-midi-api` flag set, `docs/app.md`, Known limitations). Three walks per tempo and connection give a spread. Judgements are kept until a clear (Play, a new score, a hands change, Practice mode off, the piano gone), so one console session holds many walks; a Rewind keeps them.

A walk with a deliberate slip (a note pressed clearly early, or a pause to find the next notes) shows how the judge treats it: the early note is rung, the pause is not judged.

## Results

Empty until the owner's sessions. Offsets in milliseconds; a negative deviation means the gap into the note was shorter than the reader's own pulse asks.

| Connection                     | Practice tempo | Deviation median abs (ms) | Deviation p95 (ms) | Suggested `TOLERANCE_FLOOR_MS` | `TOLERANCE_BEATS` | `TOLERANCE_GAP` | `PAUSE_RATIO` |
| ------------------------------ | -------------: | ------------------------: | -----------------: | -----------------------------: | ----------------: | --------------: | ------------: |
| USB                            |           60 % |                           |                    |                                |                   |                 |               |
| USB                            |           80 % |                           |                    |                                |                   |                 |               |
| USB                            |          100 % |                           |                    |                                |                   |                 |               |
| Bluetooth (Chrome, WinRT flag) |           60 % |                           |                    |                                |                   |                 |               |
| Bluetooth (Chrome, WinRT flag) |           80 % |                           |                    |                                |                   |                 |               |
| Bluetooth (Chrome, WinRT flag) |          100 % |                           |                    |                                |                   |                 |               |

## How the constants get set

The constants are exported from `apps/web/src/score/walkTiming.ts`. Their starting values and what each sets are in `docs/app.md` (Timing in the walk).

- **`TOLERANCE_FLOOR_MS`** (120) must sit above what varies from key to key once the steady part is gone: the Bluetooth jitter plus the spread of a careful reader's own taps. It stays above about 100 ms, below which a beginner cannot act on the difference.
- **`TOLERANCE_BEATS`** (0.25) sets how far from the pulse counts as clearly early or late at slow tempos, where the floor is not reached. It is a teaching choice, a quarter of a felt beat (the smallest subdivision a beginner counts), and changes only if the owner finds the rings too eager or too lenient at 60 %.
- **`TOLERANCE_SUBBEAT_BEATS`** (1/3) is the same for a gap shorter than the felt beat in a simple meter; a compound meter keeps `TOLERANCE_BEATS`, because a third of its felt beat is exactly one of its beats. A dotted eighth and sixteenth played as two even notes put the sixteenth exactly `TOLERANCE_BEATS` early, so a few milliseconds decide whether it is rung: with 15 ms of spread in each onset, about 40 % of the bars from 50 to 120 beats a minute. At a third of a beat it is under 3 % up to 120 beats a minute (the seeded test in `walkTiming.test.ts`), and a sixteenth played half a beat early is still rung. It is set with `TOLERANCE_BEATS` from the owner's sessions.
- **`TOLERANCE_GAP`** (0.2) lets the tolerance grow with a long note, because a steady player's spread grows with the interval. At a fifth a half note gets 0.4 beat and a whole note 0.8 beat, against the 0.25 beat of a quarter, so a whole note held a beat too long and a half note cut short by half a beat are still rung. It is set from the deviations of the notes after half and whole notes.
- **`PAUSE_RATIO`** (2), **`PAUSE_FLOOR_MS`** (300) and **`PAUSE_BEATS`** (1) set where a hesitation stops being rhythm and becomes a pause the judge leaves alone. They must stay above the largest deviation an even bar shows and below the gaps a beginner leaves while searching for the next notes.

A change of a constant is checked by `apps/web/src/score/walkTiming.test.ts`, whose cases name their boundaries, and by `apps/web/e2e/play-along-timing.spec.ts`.

## Sources

- Web MIDI API, `MIDIMessageEvent` and its time stamp: https://www.w3.org/TR/webmidi/
- MDN, `MIDIMessageEvent`: https://developer.mozilla.org/en-US/docs/Web/API/MIDIMessageEvent
- MDN, `Event.timeStamp` (a `DOMHighResTimeStamp` on the `performance.now()` clock): https://developer.mozilla.org/en-US/docs/Web/API/Event/timeStamp
