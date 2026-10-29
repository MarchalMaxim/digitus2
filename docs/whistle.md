# Whistle a tune

A beginner who knows a tune by ear and has no sheet music whistles or hums it into the microphone, and the app writes the melody down. The notes open in the scanning review ([docs/scanning.md](scanning.md)) beside a player for the recording, where the reader corrects them note by note exactly as for a scanned page, then presses **Use for fingerings**. The screens and their texts: [docs/app.md](app.md#whistle-a-tune).

Everything runs in the browser. The microphone opens only on a press and is released on Stop, on Escape and when the page is left. The sound is kept in memory while recording; nothing is sent anywhere. What the reader keeps is the recording as a small WAV file, saved with its notes in My scores on this device.

## How the notes are found

The recording becomes a `ScanSession` (`scan/model.ts`) whose `file` is the WAV and whose `xml` is the transcription, so the review, its corrections, My scores, **Download everything** and **Use for fingerings** need no code of their own for it. `whistle/session.ts` builds it; `whistle/transcribe.ts` is the path from samples to score, and every step of it is a pure function with tests (`whistle/*.test.ts`).

| Step           | Where                               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture        | `recorder.ts`, `capture.worklet.ts` | `getUserMedia` with echo cancellation, noise suppression and gain control off (they are made for speech and would clip a held whistle), read by an `AudioWorklet` that posts blocks of 2,048 samples. The page keeps them; the live trace asks YIN for the pitch of the latest 46 ms on every animation frame. A recording stops by itself at 60 s.                                                                                                                                                       |
| Resample       | `wav.ts`                            | Down to 16 kHz by the mean of each stretch of input it replaces; a whistle tops out near 3 kHz. The same samples are the WAV that is kept (mono, 16-bit, about 2 MB for 60 s).                                                                                                                                                                                                                                                                                                                            |
| Pitch          | `pitch.ts`                          | YIN every 10 ms on 46 ms frames, 150 to 3,000 Hz, threshold 0.12. The lag of the dip is refined with the exact form of a tone's difference function, 1 − cos(w (lag − period)), which three lags fix; a parabola there is up to 16 cents off for a period of six samples, this is under 5 cents from 200 to 2,500 Hz.                                                                                                                                                                                     |
| Notes          | `notes.ts`                          | A frame sounds when it has a pitch and is not 20 dB under the recording's own loud level. 40 ms of silence ends a note. Inside a stretch a note changes where the pitch moves three quarters of a semitone and settles for 50 ms (80 ms in all, which a glide does not), so vibrato and a glide into a note do not split it. The pitch is the median of the note's steady middle, in whole semitones; notes under 70 ms are dropped.                                                                      |
| Octave         | `notes.ts`                          | The melody is moved by whole octaves to where the median of its notes is from E4 up to, not including, E5: a whistle sounds one or two octaves above the tune.                                                                                                                                                                                                                                                                                                                                            |
| Pulse and grid | `rhythm.ts`                         | Of the quarter-note periods from 0.33 to 1.2 s, the one whose grid of eighths (or, at a small cost, sixteenths) the onsets sit closest to. A grid twice as fine, or a third as coarse, fits a plain melody just as well, so three leanings decide between them: 60 to 140 beats a minute, the usual 100, and gaps of one, two, four or eight steps over three, six or odd ones. Onsets and lengths snap to the grid; a silence of three quarters of a step or more is a rest. Leading silence is dropped. |
| Key            | `rhythm.ts`                         | Krumhansl and Schmuckler: the pitch classes weighted by length, correlated with the profiles of the 24 keys, marked down for the share of the melody outside the key's scale and a little for each sharp or flat in its signature.                                                                                                                                                                                                                                                                        |
| Score          | `musicxml.ts`                       | One part, Piano, one treble staff, 4/4, the key, the tempo, rests for the gaps, ties across barlines, spelled with sharps or flats by the key, an accidental written where a note is not what the key and the bar have in force (Verovio draws a natural against the key's own sharp or flat only when the file says so), and a final barline. The same file the strict import and the review's own reader take.                                                                                          |

Sources:

- A. de Cheveigné and H. Kawahara, "YIN, a fundamental frequency estimator for speech and music", _Journal of the Acoustical Society of America_ 111 (2002): https://doi.org/10.1121/1.1458024
- C. L. Krumhansl, _Cognitive Foundations of Musical Pitch_, Oxford University Press (1990), for the key profiles: https://doi.org/10.1093/acprof:oso/9780195148367.001.0001
- `AudioWorklet`: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet; `getUserMedia`: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- Chromium's fake microphone, which the end-to-end specs play a WAV through: https://webrtc.org/getting-started/testing

## Measurements

`whistle/measure.test.ts` whistles synthetic melodies at the transcription and counts what a reader would have to correct to reach the written tune (`whistle/testing/synth.ts` makes the sound, `whistle/testing/measure.ts` aligns the notes found with the notes written). The signal goes through the whole path from 48 kHz samples: resampling, pitch, notes, rhythm, key and score. A melody is whistled two octaves above its written pitch with a 60 ms breath between notes and a 0.5 s silence before the first. The table's columns:

- **Pitches right**: the share of the written notes whose pitch was found, in an alignment that allows missing and extra notes.
- **Onset error**: the mean distance of a found note's start from the sound's start, before the grid.
- **Corrections**: notes to change, add or remove, and notes whose place or length on the grid is wrong.
- **Tempo error**: beats a minute found against played.

The conditions: vibrato of 30 cents at 5 Hz; a slide into each note of 80 ms (30 ms in the sixteenths); white noise 25 dB under the tone, also in the silences; each onset straying up to 8 % of a beat (3 % in the sixteenths, where 8 % is a third of a note) as a slow swell of the tempo and some jitter; and all of them together. The test asserts every cell below: 100 % of the pitches, onsets within 30 ms, no correction and a tempo within 6 %.

| Melody        | Condition        | Pitches right | Onset error | Corrections | Tempo error |
| ------------- | ---------------- | ------------- | ----------- | ----------- | ----------- |
| C major scale | clean            | 100 %         | 2 ms        | 0           | 0.0 %       |
| Ode to Joy    | clean            | 100 %         | 2 ms        | 0           | 0.0 %       |
| Twinkle       | clean            | 100 %         | 4 ms        | 0           | 0.0 %       |
| With a rest   | clean            | 100 %         | 5 ms        | 0           | 0.0 %       |
| Sixteenths    | clean            | 100 %         | 5 ms        | 0           | 0.0 %       |
| C major scale | vibrato 30 cents | 100 %         | 2 ms        | 0           | 0.0 %       |
| Ode to Joy    | vibrato 30 cents | 100 %         | 2 ms        | 0           | 0.0 %       |
| Twinkle       | vibrato 30 cents | 100 %         | 4 ms        | 0           | 0.0 %       |
| With a rest   | vibrato 30 cents | 100 %         | 5 ms        | 0           | 0.0 %       |
| Sixteenths    | vibrato 30 cents | 100 %         | 5 ms        | 0           | 0.0 %       |
| C major scale | glide            | 100 %         | 2 ms        | 0           | 0.0 %       |
| Ode to Joy    | glide            | 100 %         | 2 ms        | 0           | 0.0 %       |
| Twinkle       | glide            | 100 %         | 4 ms        | 0           | 0.0 %       |
| With a rest   | glide            | 100 %         | 5 ms        | 0           | 0.0 %       |
| Sixteenths    | glide            | 100 %         | 5 ms        | 0           | 0.0 %       |
| C major scale | noise -25 dB     | 100 %         | 2 ms        | 0           | 0.0 %       |
| Ode to Joy    | noise -25 dB     | 100 %         | 2 ms        | 0           | 0.0 %       |
| Twinkle       | noise -25 dB     | 100 %         | 4 ms        | 0           | 0.0 %       |
| With a rest   | noise -25 dB     | 100 %         | 5 ms        | 0           | 0.0 %       |
| Sixteenths    | noise -25 dB     | 100 %         | 5 ms        | 0           | 0.0 %       |
| C major scale | rubato           | 100 %         | 8 ms        | 0           | 1.7 %       |
| Ode to Joy    | rubato           | 100 %         | 6 ms        | 0           | 0.0 %       |
| Twinkle       | rubato           | 100 %         | 7 ms        | 0           | 0.0 %       |
| With a rest   | rubato           | 100 %         | 7 ms        | 0           | 0.0 %       |
| Sixteenths    | rubato           | 100 %         | 6 ms        | 0           | 1.3 %       |
| C major scale | all together     | 100 %         | 8 ms        | 0           | 1.7 %       |
| Ode to Joy    | all together     | 100 %         | 6 ms        | 0           | 0.0 %       |
| Twinkle       | all together     | 100 %         | 7 ms        | 0           | 0.0 %       |
| With a rest   | all together     | 100 %         | 8 ms        | 0           | 0.0 %       |
| Sixteenths    | all together     | 100 %         | 7 ms        | 0           | 1.3 %       |

Past those conditions (the same run, nothing asserted):

| Melody     | Condition                                   | Pitches right | Onset error | Corrections | Tempo error |
| ---------- | ------------------------------------------- | ------------- | ----------- | ----------- | ----------- |
| Ode to Joy | noise -15 dB                                | 100 %         | 2 ms        | 0           | 0.0 %       |
| Ode to Joy | noise -6 dB                                 | 0 %           | none found  | 15          | 100.0 %     |
| Ode to Joy | no breath between notes                     | 67 %          | 273 ms      | 10          | 0.0 %       |
| Ode to Joy | fast: 160 beats a minute                    | 100 %         | 4 ms        | 15          | 50.0 %      |
| Ode to Joy | slow: 50 beats a minute                     | 100 %         | 2 ms        | 15          | 100.0 %     |
| Ode to Joy | rubato of 20 %                              | 100 %         | 7 ms        | 8           | 6.0 %       |
| Twinkle    | a hum: low, rich in harmonics, wide vibrato | 100 %         | 5 ms        | 0           | 0.0 %       |
| Ode to Joy | whistled one octave up                      | 100 %         | 2 ms        | 0           | 0.0 %       |
| Ode to Joy | whistled three octaves up                   | 100 %         | 2 ms        | 0           | 0.0 %       |

A tune at 160 or at 50 beats a minute is written at 80 or at 100 with every length doubled or halved: the same sound in other note values, so every note counts as a correction here that a reader would not make.

To print the tables again: `DIGITUS2_WHISTLE_TABLE=1 pnpm --filter @digitus2/web exec vitest run src/whistle/measure.test.ts --reporter=verbose`.

## Limits

- **Real whistles and hums are the device check.** Every number above is a synthetic tone. A real whistle breathes, cracks, slides and drifts out of tune, and a real hum has a voice's roughness. The owner's own whistling and humming on the phone and the laptop, through the same line, is the measure that matters, and the corrections a reader makes in the review are the record of where it fails.
- **Fast passages.** A note under 70 ms is dropped, a note that runs on into another pitch is a note from 100 ms, and the grid goes no finer than sixteenths.
- **Legato without breaks.** A repeated note is a new note only where there is a breath of 40 ms or more or a pitch that moves; two equal notes sung as one sound are one note, as the no-breath row shows.
- **One voice, one staff.** The melody is written for the right hand in 4/4. A different meter, a pickup bar or a second voice is corrected in the review (the meter has its own correction), and a chord is not heard.
- **Noise.** A room louder than the tone, as the noise -6 dB row, leaves nothing to find. The recording says so: `No notes were heard. Whistle a little louder or closer to the microphone.`
- **Sixty seconds.** A recording stops by itself at 60 s.

## Testing

- The unit tests next to the code: `pitch` (a tone from 200 to 2,500 Hz within 5 cents at 16, 24 and 48 kHz, silence and noise give no pitch), `notes` (three melodies under five conditions, onsets, a repeated note with a breath, a click, silence and noise), `rhythm` (five melodies steady and uneven, tempo, rests, the key of six tunes), `musicxml` (the strict import and the review's reader read back what was written), `wav`, `session` (My scores' storage, **Download everything**), `measure` (the table above) and `WhistleLine` (the line, Escape, the errors, releasing the microphone).
- `e2e/whistle.spec.ts`: Chromium plays a generated WAV as its microphone (`e2e/helpers/whistle.ts`), the page records it for real, and the flow runs through Stop, the review with its player, the notes read back from the downloaded MusicXML, a correction, **Use for fingerings**, My scores after a reload, Escape and Whistle again, one red element and axe at each stage, and the 360 px width. `states` holds the recording and the review (a steady tone, no launch argument) in both themes and both widths.
- `e2e/whistle-demo.spec.ts` records the walk-through as a video and a screenshot of each stage; it runs only with `DIGITUS2_E2E_DEMO=1` and is never a gate.
