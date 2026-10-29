# Whistle a tune: plan (issue 237)

Goal: the reader presses **Whistle a tune** in the library, whistles or hums, presses **Stop**, and lands in the scanning review with the melody as notes beside a player for their recording. There they correct notes exactly as for a scan, then **Use for fingerings**. The recording and its notes are saved to My scores at once.

Copy this file to `docs/superpowers/plans/2026-10-29-whistle-a-tune.md` in the worktree.

## Design in one paragraph

A recording becomes a `ScanSession` (`src/scan/model.ts`) whose `file` is the recording as a WAV and whose `xml` is the transcription, with `recognizer: 'digitus2-whistle/1'` and `recognizedAt` set.

- `openScan(session)` then opens the existing review directly, because a session with `xml` starts in `'review'`.
- The review provides the corrections, undo, verdict, downloads, **Use for fingerings** and Back.
- My scores saves it on the view change (`library/local/library.ts`, `capture`) with no new code. Check that `storeSession` / `restoreSession` and the IndexedDB write round-trip an audio `File`.
- The review only needs to learn that a session's source can be audio. Everything else is a new, lazily loaded `src/whistle/` module and one library line.

## 1. Pure transcription, tests first (`src/whistle/`, vitest)

All pure, no DOM. Test with synthetic signals made in the test: sine plus harmonics, vibrato of ±30 cents at 5 Hz, a pitch glide into a note, white noise at -25 dB, breath gaps.

- **`pitch.ts`: YIN** (de Cheveigné and Kahan 2002).
  - Signature: `yin(frame: Float32Array, sampleRate, { minHz: 150, maxHz: 3000, threshold: 0.12 }) → { hz: number | null; clarity: number }`, with parabolic interpolation.
  - Also `pitchTrack(samples, sampleRate, hop = 10 ms, frame ≈ 46 ms)`, giving frames `{ t, hz | null, clarity, rms }`.
  - Tests: within 5 cents on pure tones from 200 to 2500 Hz; null on silence and on noise.
- **`notes.ts`: track to notes.**
  - Gate frames by clarity and RMS, relative to the recording's own level.
  - Median-filter the MIDI value over 5 frames.
  - Start a note at a voiced onset or at a pitch change of 0.75 semitone or more that holds for 50 ms or more. End it at 40 ms or more of unvoiced frames.
  - Drop notes shorter than 70 ms, and glides into a note: use the note's median of its stable middle.
  - Round to semitones.
  - Octave-fold the whole melody by whole octaves so its median lies in MIDI 64 to 76 (whistling sounds an octave or two above the written melody).
  - Output `{ midi, start, end }` in seconds.
  - Tests: a C major scale, Ode to Joy's first phrase and Twinkle's first phrase come back with the right pitches under vibrato, noise and glides; a repeated note with a breath between counts as two notes.
- **`rhythm.ts`.**
  - Estimate the beat from onsets: try quarter-note periods from 0.33 to 1.2 s and pick the one with the least quantisation error, preferring 60 to 140 bpm.
  - Quantise onsets and durations to eighths, or sixteenths when the error is clearly lower.
  - Fill gaps with rests. Use 4/4. A pickup is not needed: leading silence is dropped.
  - The key by Krumhansl–Schmuckler on note durations, giving fifths and major or minor.
  - Tests: steady and slightly rubato (±8 %) renditions of the melodies above quantise to their written rhythm.
- **`musicxml.ts`.**
  - One part, `Piano`, one treble staff, `<divisions>`, key, 4/4 time and a tempo `<sound tempo>`.
  - Notes spelled by the key (sharps or flats), ties across barlines, rests, and a final barline.
  - It must pass the app's strict import: the same import the scan review runs (`importXml`).
  - Test: parse with the engine's MusicXML reader (see how `scan/*.test.ts` or `src/app/build.ts` import), and the notes, pitches and durations come back as written.

## 2. The recorder (`src/whistle/recorder.ts`, browser only)

- `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })`.
- An `AudioWorklet` (`src/whistle/capture.worklet.ts`; Vite: `new URL('./capture.worklet.ts', import.meta.url)` with `audioWorklet.addModule`) posts PCM blocks. The main thread keeps them, and feeds a live trace from `yin` on the latest 46 ms every animation frame.
- On stop: stop the tracks, build the full pitch track, notes, rhythm and MusicXML. Downsample to 16 kHz and encode a mono 16-bit WAV (`wav.ts`, pure, tested), named `Whistled tune HH.MM.SS.wav` (same clock style as the camera's `photo HH.MM.SS`).
- Limit: 60 s. Stop by itself at 60 s.
- Errors, each as a plain line, in the five languages:
  - permission denied: `The browser blocked the microphone. Allow it in the site settings, then press again.`
  - no microphone found
  - no notes heard: `No notes were heard. Whistle a little louder or closer to the microphone.`

## 3. The library line (`src/library/`)

- One quiet line next to **Open your own score** (`OwnFileLine.tsx`), in the same style as the camera's line: `Whistle a tune`. Show it only where `navigator.mediaDevices?.getUserMedia` and `AudioWorkletNode` exist.
- Pressed, it lazily imports the whistle module and the line becomes the recording state, in place:
  - a live pitch trace: a small canvas in ink, `--ink` read from the CSS tokens, never red
  - an elapsed time
  - **Stop** (a plain button in ink)
  - one line: `Whistle or hum, then press Stop.`
- Escape cancels. Leaving the library cancels and releases the microphone.
- **One red element:** the library keeps its own red; nothing added here is red. Run the red-rule checks (`e2e/helpers/states.ts`) with the recording state shown.
- On stop with notes: `openScan(session)`.
- **Bundle:** the library page's first load must stay under 150 KB gzip (`node scripts/check-bundle-size.mjs`; main is at about 149.8 KB). Only the line and its strings may be in the first load; the recorder, YIN, notes, rhythm, MusicXML, WAV and worklet are a lazy chunk. If the strings tip the budget, keep the line's own text in the entry and move the recording-state strings into the lazy chunk's own module, as the scan view's strings are, if they are lazy. Measure and report.

## 4. The review learns an audio source (`src/scan/ScanView.tsx`)

- `isImage` today is `type !== 'application/pdf'`. Add `isAudio = session.file.type.startsWith('audio/')`, and make `isImage` exclude audio.
- **Original** pane for audio: the heading reads `Recording`, with an `<audio controls>` of the file. No photo marks, no crops, no retake, no rotation.
- **Scan again** is not shown for audio: there is no scanner to ask. Instead, `Whistle again` goes back to the library's line, starting a new recording; the old one stays in My scores.
- The verdict line reads naturally for one page (for example `12 bars · right hand`): check `verdict.ts` with a one-staff recognition.
- Downloads: **Download everything** must handle an audio source file (`bundle.ts`).
- My scores lists it by the WAV's name. Sharing to the shared library (issue 132): the eligibility check must say an audio session cannot be shared (it is not a page of music). Check `library/shared/eligibility.ts`.
- Reopening from My scores opens the review with corrections, as a scan does.

## 5. e2e and the video

- **The fake microphone.** Chromium flags `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>`.
  - Generate the WAV at test time into the test's output folder: a synthetic whistle of Ode to Joy's first two bars, sine plus a little second harmonic, vibrato, 2 % noise, 100 bpm, starting after 0.5 s of silence. Use a small node helper in `e2e/helpers/whistle.ts`, reusing the same synthesis as the unit tests if it can be shared without importing browser code.
  - The flags are per browser, so give the spec its own worker-scoped browser, as `play-along-sound.spec.ts` does.
  - Chrome loops the file: stop after one pass.
- **`e2e/whistle.spec.ts`, desktop:**
  1. The line shows; a press starts recording; the trace draws; Stop.
  2. The review shows `Recording` with an audio player.
  3. The notes are Ode to Joy's pitches (E E F G G F E D …, octave-folded); read them from the review's rendered notation, or from the corrected MusicXML through the existing download or a hook.
  4. A correction works.
  5. **Use for fingerings** opens the score with a digit on every note.
  6. Back to the library: My scores lists `Whistled tune …`, and reopening goes to the review.
  7. One red element at each stage; axe clean.
- **360 px:** the line, the recording state and the review with the audio player, with no horizontal overflow.
- **The video.**
  - A separate spec, `e2e/whistle-demo.spec.ts`, skipped unless `DIGITUS2_E2E_DEMO=1`.
  - Run the same flow with `recordVideo` at 1280 × 800, with short pauses on each stage so a person can follow it.
  - Save the `.webm` to the scratchpad given in the brief.
  - Not in CI, and never a gate.

## 6. Docs

- `docs/app.md`:
  - a section, Whistle a tune, describing the library line, recording, the review with a recording, saving and limits
  - the testing bullets
  - the bundle row with the new number
- `docs/whistle.md`:
  - how the transcription works: YIN, segmentation, octave fold, rhythm, key, with sources and URLs
  - the synthetic measurement table: melodies × conditions → pitch accuracy, onset error and corrections needed
  - the limits: real whistles and hums on the owner's phone and laptop are the device check; fast passages; legato without breaks between repeated notes
- `docs/PROGRESS.md`: one line in Where things are, linking the issue.

## Rules

- Black and white, one red element. Present-tense docs. "issue 237" in source comments, never "#237".
- Tests wait on conditions, not on a clock.
- Five languages for every string.
