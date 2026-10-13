# M6 MIDI Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a `.mid` file and get a fingered two-staff score: read the MIDI with its tempo map, time signatures and key; quantize onsets to a per-beat grid (16th notes, 16th-note triplets or 32nd notes); separate the hands with a beam-searched pitch-trajectory DP learned from staff-labelled music, with a user override; build a `Score`; engrave it as clean MusicXML that round-trips through our own reader and renders in Verovio; then let the unchanged app pipeline solve, inject and render it. Measure hand-separation accuracy on PIG and on the library and gate it in `pnpm verify`.

**Architecture:** `packages/engine/src/io/midi/` is a pure TypeScript pipeline: `read.ts` (bytes → `MidiData`, through `midi-file` 1.2.4), `quantize.ts` (`MidiData` → `QuantizedNotes` at 480 ticks per quarter), `motion.ts` (the learned statistics in `params/hand-motion.json`), `handSeparation.ts` (`QuantizedNote[]` → `Hand[]`), `key.ts` (Krumhansl–Schmuckler estimate and spelling), `toScore.ts` (→ `Score` with ids `m0, m1, ...`), `engrave.ts` (`Score` → partwise MusicXML 4.0) and `import.ts` (`importMidi`: the whole chain, then re-reads the generated MusicXML so the returned `Score` points into that document). `src/eval/hands.ts` scores hand separation against staff- or channel-labelled truth. `cli/` gains `import` and `evalhands`. Two Python scripts produce the MIDI test fixture (`content/tools/musicxml2midi.py`) and the hand statistics (`research/scripts/make_hand_motion.py`). In `apps/web`, the engine worker's `load` request gains `kind: 'musicxml' | 'midi'`; the drop zone accepts MIDI; the side panel shows the import facts and a `Hand split` control that re-imports through the worker.

**Tech Stack:** as M2 and M4 (TypeScript strict, vitest, pnpm; React 19, Vite, Playwright in `apps/web`), plus `midi-file` 1.2.4 as an engine dependency (MIT, 2.8 KB gzip, synchronous, bundled typings, runs in Node, workers and browsers; rendering spike section 5). Python 3.11, standard library only, for the two scripts and their pytest files.

**Depends on:** M2 (the solver `solveFingering`, `HAND_PROFILES` and `span` from `fingering/spans.ts`, the `bench` patterns in `cli/bench.ts`, `benchmarks/floor.json` with `goldDir` and `split`), M4 (the app: Task 3 `DropZone`, Task 4 the engine worker `protocol.ts`/`handlers.ts`/`client.ts`, Task 5 `injectNoteIds` and the Node Verovio contract test pattern, Task 6 `useScoreDocument`, `SidePanel`, `ScoreView`, Task 9 `exportFilename` and the About page, Task 10 `states.spec.ts` and `visual.spec.ts`), and M3 Task 4 (`RECOMMENDED_WEIGHT_SET`, which the engine worker's `solve` already passes; this plan's Verovio contract test passes it too). M3 Task 2 also provides `research/data/splits/mutopia_split.json` and the `research/weights/` line in `.gitignore`, both used by Task 2 and Task 9. If any of these is missing when a task starts, stop and report; do not stub it.

**Spec:** `docs/superpowers/specs/2026-10-13-digitus2-design.md` sections 5 (Score model), 6 (MIDI reader) and 7.6 (hand separation, user-adjustable split). Method: `docs/research/literature.md` sections 6.7 (pitch-trajectory DP) and 2.9 (Nakamura 2014 merged-output HMM; hand-separation error 7.1 percent overall, Debussy 18.7 percent). Parser and tempo map: `docs/research/rendering-spike.md` sections 5 and 8.5. Data: `docs/research/datasets.md` section 2 (PIG channel = hand; 309 files) and `research/data/README.md`. Read these before Task 0.

## Decisions made while writing this plan (read before Task 0)

These settle questions the design brief left open or got wrong. Each is final for this milestone; Task 9 records the measured consequences.

1. **The hand-separation cost has three terms beyond literature 6.7.** A throwaway Python spike run while writing this plan (not in the repo) implemented the beam DP, fitted every histogram on the 310 Mutopia parts, and scored the 30 library pieces (staff = truth) and the 30 PIG test pieces (first annotation, channel = truth) on exact onsets:

   | Cost                                                                        | Library macro | Library worst | PIG test macro | Twinkle |
   | --------------------------------------------------------------------------- | ------------- | ------------- | -------------- | ------- |
   | literature 6.7 as written (movement, crossing μ, idle ν, start at median)   | 81.8          | 49.2          | 84.7           | 46/64   |
   | + per-hand chord-span prior                                                 | 91.5          | 67.6          | 92.2           | 60/64   |
   | + span prior + hand-pattern prior                                           | 91.8          | 64.5          | 91.6           | 62/64   |
   | + span prior + hand-pattern prior + position prior for a hand's first chord | **91.9**      | 64.3          | **91.6**       | 64/64   |

   The literal formula lets a single melody alternate between the hands (each hand's movement shrinks when they share a line; a 48-note melody in C4–G4 was split 42/6), puts an octave in one hand, and starts badly when both hands are assumed to sit at their median pitch. The plan ships the last row: per slice, cost = −log Q(pattern | previous pattern) + Σ over hands that play [−log P_h(Δ) or, for the hand's first chord, −log Pos_h(centre)] − log S_h(span) + μ·[LH top > RH bottom] + ν·[a silent hand idle longer than T]. All tables are learned by the same script; `--uniform` flattens any of them so Task 9 can re-measure each term's contribution on real quantized input.

2. **The shipped statistics come from permissively licensed music only.** `docs/PROGRESS.md` ("Standing findings") and the M3 plan forbid shipping parameters fitted on PIG (non-profit academic use). `packages/engine/src/io/midi/params/hand-motion.json` is therefore fitted on the 30 library pieces and the Mutopia **train** half (public domain and CC engravings). The PIG train split, which the brief named, is used only for a research variant written to `research/weights/hand-motion-pig.json` (gitignored); Task 9 reports both. The script refuses to write PIG statistics under `packages/` or `apps/`. PIG test pieces 001–030 are never used for fitting or tuning.

3. **"Moved more than a 32nd" is impossible; the share counts notes moved more than a 64th note.** Snapping to the nearest point of a grid moves an onset by at most half a grid unit, so on the 16th grid no onset ever moves more than a 32nd. The UI line reads `… ; 3 % moved more than a 64th note` (threshold 30 ticks at 480 per quarter, about 31 ms at 120 quarter notes per minute).

4. **Grid choice per beat needs a margin, not a strict minimum.** The 32nd grid contains every 16th position, so "lowest displacement wins" picks 32nd notes for any jittered beat and turns a quarter note played 40 ticks late into a syncopated 32nd. A richer grid wins only when it at least halves the beat's total displacement and saves more than 8 ticks per onset (`GRID_GAIN = 2`, `GRID_TOLERANCE_TICKS = 8`); simplicity order 16th, 16th-note triplet, 32nd. A 2000-trial simulation of this rule classified straight 16ths and eighths with ±20 ms jitter as 16th 100 percent of the time, eighth triplets with ±10 ms jitter as triplets 99.4 percent of the time and 32nd runs as 32nd 100 percent of the time.

5. **`importMidi` re-reads its own MusicXML.** The app's `injectFingerings` locates notes by `sourceIndices` (document order of `<note>` elements), which a MIDI-built `Score` cannot know. `importMidi` therefore parses the generated MusicXML with `parseMusicXml`, then gives each parsed note the `m…` id and the velocity of the MIDI-built note with the same hand, onset and pitch. The engraver writes `id="m…"` on the first `<note>` element of every sounding note, `injectNoteIds` keeps existing ids, and Verovio keeps them. So score ids, XML ids, SVG ids and assignment keys are the same strings.

6. **The engraver is general; MIDI scores use one voice per staff.** The round trip runs on all 30 library pieces, which have up to four voices per staff, grace notes, 3:2 triplets, dotted values and pickups. `scoreToMusicXml` therefore allocates up to four voices per staff, writes grace notes, triplets, ties, accidentals and primary beams. A second check while writing this plan confirmed that every note boundary in the 30 library files is either a straight position down to a 64th note or a 3:2-triplet position within its quarter-note window, which is the only rhythm model the engraver supports. `midiToScore` produces one voice per staff (voice 1 upper, voice 5 lower); overlapping notes of one hand are truncated and reported, as the brief says.

7. **The Verovio render contract for generated files lives in `apps/web`.** Verovio is an app dependency; the engine gets no new dependency besides `midi-file`.

8. **Hands crossed at one instant are not representable.** The per-slice split sends the lower notes to the left hand, so a left hand crossing above the right hand at the same onset is always wrong; across onsets the crossing penalty μ makes the DP prefer handing the line over. This is the known weak spot (Nakamura: Debussy 18.7 percent error). The `Hand split` control is the escape hatch; a joint fingering-aware refinement (literature 6.7 option 2) is future work.

9. **The drop zone's refusal text changes** to mention MIDI: `That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).` M4's MIDI refusal notice and its tests are removed.

## Global Constraints

- Engine code under `packages/engine/src` never touches DOM or Node-only APIs; `cli/` may use Node (spec section 4). `midi-file` 1.2.4 (exact pin) is the only new runtime dependency.
- Determinism: the same MIDI bytes and options give byte-identical MusicXML; the same corpora and flags give byte-identical `hand-motion.json` (before prettier formatting). No `Math.random`, no `Date` in engine code.
- Every `Score` produced by this plan passes `validateScore`; every generated MusicXML is read back by `parseMusicXml` with the same notes (onset tick, offset tick, MIDI pitch, hand).
- PIG test pieces 001–030 are never used to fit or tune anything. PIG-derived statistics never go under `packages/` or `apps/` (decision 2).
- Speed: `importMidi` (read, quantize, separate, engrave and read back) on a 2000-note file in under 2 s in Node, a CI-safe bound asserted by Task 6; the target is 500 ms and Task 9 records the measured time. `separateHands` is linear in the number of onsets with a beam of 64.
- App: exactly one red element in every state, no other chromatic color, exact copy as written in Task 8, the app depends only on the engine's public API, parsing and importing run in the engine worker.
- Python: standard library only; open every text file with `encoding="utf-8"` (the Windows default code page is cp1252 and breaks on the Mutopia manifest); run scripts with `-I`.
- Formatting: run `pnpm exec prettier --write` on every TypeScript, JSON, Markdown or CSS file you create or change outside the prettier-ignored folders (`content/`, `research/`, `benchmarks/`); CI runs `pnpm format:check`, `pnpm verify` does not.
- Implementers do not run git (CLAUDE.md); each task ends with a hand-off step listing the exact paths for the coordinator's commit. `pnpm verify` must be green after every task. Long commands (installs, the full library round trip, evalhands on all corpora) run in the background. Use the Write tool for files longer than a few lines.

## Review Focus

1. A MIDI file with overlapping notes on one key (a second note-on before the first note-off, common in exported sustain-pedal performances) must never produce a negative or zero duration or two sounding notes on one key. Pinned by Task 0 (`pairs overlapping notes on one key first-in first-out, so no duration is negative`) and Task 1 (`merges simultaneous notes on one key and shortens a note that overlaps the next on its key`).
2. A tempo change mid-piece must shift every later onset correctly in seconds, after quantization, after engraving and after reading the generated MusicXML back; an off-by-one in the tempo map moves the cursor away from the audio for the rest of the piece. Pinned by Task 0 (`reads the tempo map: bar 5 at 10 s, bar 7 at 18 s, the last right-hand note at 21.5 s`), Task 5 (`keeps the tempo map of tempo-map.mid through quantization, separation, engraving and reading back`) and Task 6 (`keeps the tempo map: bar 5 at 10 s and bar 7 at 18 s`).
3. A dense chord (six or more notes at one onset) must never give one hand more than five notes when a playable split exists, and must still produce an answer with a warning when none does. Pinned by Task 3 (`never gives one hand more than five notes when a playable split exists` and `still answers when no split of a slice is playable`) and Task 4 (`warns about six notes in one hand at one time`).
4. When both hands play in the same register, the DP must not trade a line between the hands from slice to slice (the literal cost of literature 6.7 does, decision 1). Pinned by Task 3 (`keeps a single melody in the middle register in one hand instead of trading it between the hands` and `keeps two lines that converge to a whole tone and part again in their own hands`).
5. A generated MusicXML must never contain a duration that its `<type>`, `<dot>` and `<time-modification>` do not express, or a rhythm Verovio cannot draw; a silently wrong `<type>` renders a plausible but false score. Pinned by Task 5 (`writes awkward lengths as tied standard values and every note value matches its duration` and `refuses a rhythm it cannot write instead of writing a wrong one`) and Task 7 (`renders tuplets, dotted values, ties across barlines and odd lengths written as tied notes`).

## File Structure

```
packages/engine/package.json                         + "midi-file": "1.2.4"
packages/engine/src/io/midi/plural.ts                count(n, one, many) for warnings
packages/engine/src/io/midi/read.ts                  parseMidiFile, midiTickToSeconds, MidiData
packages/engine/src/io/midi/quantize.ts              quantize, chooseGrid, QuantizedNotes (480 ticks per quarter)
packages/engine/src/io/midi/motion.ts                HandMotionParams, HAND_MOTION, motionCounts (shared definition with the Python script)
packages/engine/src/io/midi/params/hand-motion.json  learned tables with provenance (generated by make_hand_motion.py)
packages/engine/src/io/midi/handSeparation.ts        separateHands: beam DP over per-slice splits; splitMidi override
packages/engine/src/io/midi/key.ts                   estimateKey (Krumhansl-Schmuckler), spellMidi, keyName
packages/engine/src/io/midi/toScore.ts               midiToScore: Score with ids m0.., measures, key, one voice per hand
packages/engine/src/io/midi/engrave.ts               scoreToMusicXml: partwise MusicXML 4.0, two staves, round-trip safe
packages/engine/src/io/midi/import.ts                importMidi: the whole chain; Score re-read from the generated MusicXML
packages/engine/src/io/midi/index.ts                 barrel
packages/engine/src/eval/hands.ts                    scoreToMidiData, evaluateHands
packages/engine/src/index.ts                         + exports
packages/engine/cli/import.ts                        digitus2 import <file.mid> [--out] [--split] [--title]
packages/engine/cli/evalhands.ts                     digitus2 evalhands (PIG-format gold sets and the library manifest)
packages/engine/cli/run.ts                           + dispatch and usage for import and evalhands
packages/engine/fixtures/twinkle.mid                 generated from the library Twinkle (tracks RH, LH)
packages/engine/fixtures/tempo-map.mid               copy of research/spikes/render/fixtures/tempo-map.mid
content/tools/musicxml2midi.py                       deterministic MusicXML -> MIDI (fixtures only)
content/tools/tests/test_musicxml2midi.py
research/scripts/make_hand_motion.py                 fits hand-motion.json (library + Mutopia train; PIG only for research/weights/)
research/tests/test_make_hand_motion.py
benchmarks/floor.json                                + "hands": { "accuracyMin" }
benchmarks/latest-hands.json                         written by evalhands (tracked)
scripts/verify.mjs                                   + step "hands"
apps/web/fixtures/twinkle.mid                        same bytes as the engine fixture
apps/web/src/engine/protocol.ts, handlers.ts, client.ts (+ tests)   load gains kind and splitMidi; response gains midiInfo
apps/web/src/score/render/verovio.midi.node.test.ts  Verovio contract for generated MusicXML
apps/web/src/library/DropZone.tsx (+ test)           accepts .mid and .midi
apps/web/src/score/midiCopy.ts (+ test)              the import line, hand counts, note names
apps/web/src/score/MidiImportPanel.tsx (+ test)      import facts and the Hand split select
apps/web/src/score/useScoreDocument.ts (+ new test)  midiInfo, splitMidi, setSplitMidi
apps/web/src/score/SidePanel.tsx                     renders MidiImportPanel for MIDI sources
apps/web/src/about/AboutView.tsx (+ test)            credits midi-file
apps/web/e2e/midi.spec.ts                            drop, split, export, broken file
apps/web/e2e/library.spec.ts, states.spec.ts         MIDI no longer refused; state score-midi
docs/app.md, docs/verification-loop.md, docs/experiments.md, docs/PROGRESS.md, benchmarks/history.md
```

Ownership while this plan runs (record it in `docs/PROGRESS.md` before launching): the files above. `packages/engine/src/index.ts`, `packages/engine/cli/run.ts`, `packages/engine/package.json`, `benchmarks/floor.json` and `scripts/verify.mjs` are shared with other milestones: change only the lines this plan names. Tasks 0 to 6 are engine work and run in order, except that Task 2 can run alongside Task 1. Task 7 needs Task 6 and M4 Task 4; Task 8 needs Task 7 and M4 Tasks 3, 6, 9 and 10; Task 9 needs everything.

## Engine API added by this plan

```ts
// read.ts
parseMidiFile(bytes: Uint8Array): MidiData
midiTickToSeconds(data: Pick<MidiData, 'ppq' | 'tempos'>, tick: number): number
// quantize.ts
quantize(data: MidiData, opts?: QuantizeOptions): QuantizedNotes
// motion.ts
HAND_MOTION: HandMotionParams; loadHandMotion(raw: unknown): HandMotionParams; scoreMotionCounts(score: Score): HandMotionCounts
// handSeparation.ts
separateHands(notes: readonly QuantizedNote[], opts?: { splitMidi?: number; params?: HandMotionParams }): Hand[]
// key.ts
estimateKey(notes: ReadonlyArray<{ midi: number; duration: number }>): KeyEstimate; spellMidi(midi, key): Spelling; keyName(key): string
// toScore.ts
midiToScore(data: MidiData, quantized: QuantizedNotes, hands: readonly Hand[], opts?: MidiToScoreOptions): { score: Score; warnings: string[] }
// engrave.ts
scoreToMusicXml(score: Score, opts?: { title?: string; composer?: string }): string
// import.ts
importMidi(bytes: Uint8Array, opts?: MidiImportOptions): { xml: string; score: Score; info: MidiInfo }
// eval/hands.ts
scoreToMidiData(score: Score): MidiData; evaluateHands(score: Score, opts?: { params?: HandMotionParams }): HandEval
```

---

### Task 0: midi-file, the MIDI fixtures, and the MIDI reader

**Files:**

- Modify: `packages/engine/package.json` (dependency `"midi-file": "1.2.4"`), `pnpm-lock.yaml` (written by pnpm)
- Create: `content/tools/musicxml2midi.py`, `content/tools/tests/test_musicxml2midi.py`, `packages/engine/fixtures/twinkle.mid` (generated), `apps/web/fixtures/twinkle.mid` (same bytes), `packages/engine/fixtures/tempo-map.mid` (copy of `research/spikes/render/fixtures/tempo-map.mid`), `packages/engine/src/io/midi/plural.ts`, `packages/engine/src/io/midi/read.ts`, `packages/engine/src/io/midi/read.test.ts`

**Interfaces:**

- Consumes: `parseMidi` and the event types of `midi-file` (`index.d.ts`: `parseMidi(data: ArrayLike<number>): MidiData` with `header.ticksPerBeat` or `header.framesPerSecond`/`ticksPerFrame`, `tracks: MidiEvent[][]`; a note-on with velocity 0 is already reported as `type: 'noteOff'`; `parseMidi` throws a string, not an `Error`, on bad input); `PIANO_MIN`, `PIANO_MAX` from `score/pitch.ts`.
- Produces:

```ts
// plural.ts
export function count(n: number, one: string, many: string): string; // `${n} ${n === 1 ? one : many}`

// read.ts
export interface MidiTempo {
  tick: number;
  usPerQuarter: number;
}
export interface MidiTimeSignature {
  tick: number;
  beats: number;
  beatType: number;
}
export interface MidiKeySignature {
  fifths: number;
  mode: 'major' | 'minor';
}
export interface MidiNote {
  tick: number;
  endTick: number;
  midi: number;
  velocity: number;
  channel: number; // 0-based; 9 is General MIDI percussion and is dropped
  track: number; // index in the file, conductor track included
}
export interface MidiData {
  ppq: number;
  tempos: MidiTempo[]; // sorted; first entry at tick 0 (500000 us inserted when the file has none)
  timeSignatures: MidiTimeSignature[]; // sorted; first entry at tick 0 (4/4 inserted when missing)
  keySignature?: MidiKeySignature; // the first key signature event in the file
  notes: MidiNote[]; // sorted by tick, midi, track, channel
  warnings: string[];
}
export const DEFAULT_US_PER_QUARTER = 500_000;
export const PERCUSSION_CHANNEL = 9;
export function parseMidiFile(bytes: Uint8Array): MidiData;
export function midiTickToSeconds(data: Pick<MidiData, 'ppq' | 'tempos'>, tick: number): number;
```

Reader rules: format 0, 1 and 2 (format 2 tracks are read as if they played together, with a warning); running status is handled by `midi-file`; note-on/note-off pairing is first-in first-out per track, channel and key, so overlapping notes on one key keep positive durations (the quantizer then shortens the first, Task 1); a note-on that never gets a note-off ends at its track's last tick; percussion (channel index 9) and notes outside 21..108 are dropped and counted; an SMPTE time division is read as `ppq = framesPerSecond * ticksPerFrame / 2` with the single default tempo (120 quarter notes per minute), which keeps seconds exact; any parse failure becomes `Error('not a MIDI file: ...')`. Warning texts (exact): `no tempo in the file; using 120 quarter notes per minute`, `no time signature in the file; using 4/4`, `ignored N percussion note(s) on channel 10`, `ignored N note(s) outside the piano range (A0 to C8)`, `N note(s) had no note-off and end(s) with their track` (singular `1 note had no note-off and ends with its track`), `the file counts time in SMPTE frames, not beats; notes are placed on a 120 quarter-note-per-minute grid`, `format 2 MIDI file: its tracks are read as if they played together`.

`musicxml2midi.py` writes format 1 with 480 ticks per quarter and three tracks: 0 `Conductor` (time signatures, the key signature, tempos), 1 `RH` (staff 1, channel index 0), 2 `LH` (every other staff, channel index 1); note-on velocity 80; note-offs are `0x80` events and are written before note-ons at the same tick; ties are merged; grace and cue notes are skipped; tempo 120 when the score has none. Twinkle facts: 64 notes, 42 on staff 1 and 22 on staff 2, 4/4, C major, 100 quarter notes per minute, 12 measures ending at tick 23040.

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @digitus2/engine add midi-file@1.2.4 --save-exact`
Expected: `packages/engine/package.json` lists `"midi-file": "1.2.4"` under `dependencies`; `pnpm-lock.yaml` changes. Nothing else is installed.

- [ ] **Step 2: Write the failing Python test**

`content/tools/tests/test_musicxml2midi.py`:

```python
"""musicxml2midi.py writes a deterministic format-1 MIDI file whose tracks are the two staves."""
from __future__ import annotations

import struct
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
REPO = TOOLS.parents[1]
sys.path.insert(0, str(TOOLS))
import musicxml2midi  # noqa: E402

TWINKLE = REPO / "content" / "scores" / "twinkle-twinkle-little-star.musicxml"


def parse_smf(data: bytes):
    """A minimal Standard MIDI File reader for files without running status."""
    assert data[:4] == b"MThd"
    fmt, ntrks, division = struct.unpack(">HHH", data[8:14])
    pos = 14
    tracks = []
    for _ in range(ntrks):
        assert data[pos:pos + 4] == b"MTrk"
        length = int.from_bytes(data[pos + 4:pos + 8], "big")
        body = data[pos + 8:pos + 8 + length]
        pos += 8 + length
        events, i, tick = [], 0, 0
        while i < len(body):
            delta = 0
            while True:
                b = body[i]
                i += 1
                delta = (delta << 7) | (b & 0x7F)
                if b < 0x80:
                    break
            tick += delta
            status = body[i]
            i += 1
            if status == 0xFF:
                kind, size = body[i], body[i + 1]
                events.append((tick, "meta", kind, bytes(body[i + 2:i + 2 + size])))
                i += 2 + size
            else:
                events.append((tick, status & 0xF0, status & 0x0F, body[i], body[i + 1]))
                i += 2
        tracks.append(events)
    return fmt, division, tracks


def note_events(track):
    return [e for e in track if e[1] in (0x80, 0x90)]


def test_twinkle_has_a_conductor_and_two_hand_tracks():
    fmt, division, tracks = parse_smf(musicxml2midi.convert(TWINKLE))
    assert (fmt, division, len(tracks)) == (1, 480, 3)
    metas = {e[2]: e[3] for e in tracks[0] if e[1] == "meta"}
    assert metas[0x51] == (600_000).to_bytes(3, "big")  # 100 quarter notes per minute
    assert metas[0x58][:2] == bytes([4, 2])  # 4/4 (denominator as a power of two)
    assert metas[0x59] == bytes([0, 0])  # C major
    rh = [e for e in note_events(tracks[1]) if e[1] == 0x90]
    lh = [e for e in note_events(tracks[2]) if e[1] == 0x90]
    assert (len(rh), len(lh)) == (42, 22)
    assert {e[2] for e in rh} == {0} and {e[2] for e in lh} == {1}
    assert (rh[0][0], rh[0][3]) == (0, 60)
    assert (lh[0][0], lh[0][3]) == (0, 48)
    assert max(e[0] for t in tracks for e in t) == 12 * 4 * 480


def test_note_offs_come_before_note_ons_at_the_same_tick():
    _, _, tracks = parse_smf(musicxml2midi.convert(TWINKLE))
    for track in tracks[1:]:
        notes = note_events(track)
        for a, b in zip(notes, notes[1:]):
            assert not (a[0] == b[0] and a[1] == 0x90 and b[1] == 0x80), f"note-on before note-off at tick {a[0]}"


def test_output_is_deterministic_and_matches_the_committed_fixtures():
    data = musicxml2midi.convert(TWINKLE)
    assert data == musicxml2midi.convert(TWINKLE)
    for fixture in (REPO / "packages/engine/fixtures/twinkle.mid", REPO / "apps/web/fixtures/twinkle.mid"):
        assert fixture.read_bytes() == data, f"{fixture} is stale; regenerate it (M6 plan Task 0 step 4)"


def test_ties_merge_grace_notes_are_skipped_and_tempo_defaults_to_120(tmp_path):
    xml = tmp_path / "tie.musicxml"
    xml.write_text(
        '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">'
        '<part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">'
        '<measure number="1"><attributes><divisions>2</divisions><staves>2</staves>'
        "<time><beats>2</beats><beat-type>4</beat-type></time></attributes>"
        "<note><grace/><pitch><step>B</step><octave>3</octave></pitch><voice>1</voice><staff>1</staff></note>"
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><tie type="start"/>'
        "<voice>1</voice><staff>1</staff></note>"
        "<backup><duration>4</duration></backup>"
        "<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><staff>2</staff></note>"
        '</measure><measure number="2">'
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><tie type="stop"/>'
        "<voice>1</voice><staff>1</staff></note>"
        "<backup><duration>4</duration></backup>"
        "<note><rest/><duration>4</duration><voice>5</voice><staff>2</staff></note>"
        "</measure></part></score-partwise>",
        encoding="utf-8",
    )
    _, _, tracks = parse_smf(musicxml2midi.convert(xml))
    metas = {e[2]: e[3] for e in tracks[0] if e[1] == "meta"}
    assert metas[0x51] == (500_000).to_bytes(3, "big")
    assert [(e[0], e[1], e[3]) for e in note_events(tracks[1])] == [(0, 0x90, 60), (1920, 0x80, 60)]
    assert [(e[0], e[1], e[3]) for e in note_events(tracks[2])] == [(0, 0x90, 48), (960, 0x80, 48)]
```

Run: `content/.venv/Scripts/python.exe -m pytest content/tools/tests/test_musicxml2midi.py -q`
Expected: FAIL (`ModuleNotFoundError: musicxml2midi`).

- [ ] **Step 3: Write the converter**

`content/tools/musicxml2midi.py`:

```python
#!/usr/bin/env python3
"""MusicXML -> Standard MIDI File (format 1), deterministic, standard library only.

Writes test fixtures whose tracks carry the true hands: track 0 'Conductor' (time signatures,
key signature, tempos), track 1 'RH' (staff 1, channel index 0), track 2 'LH' (every other
staff, channel index 1). 480 ticks per quarter note; note-on velocity 80; note-offs are 0x80
events and come before note-ons at the same tick. Ties are merged into one note; grace and cue
notes are skipped; repeats are not expanded; only the first part is read (the library files have
one part with two staves).

Usage (from the repo root):
  content/.venv/Scripts/python.exe -I content/tools/musicxml2midi.py IN.musicxml OUT.mid
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from fractions import Fraction
from math import floor
from pathlib import Path

PPQ = 480
VELOCITY = 80
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def read_score(path: Path):
    """Notes [onset, offset, midi, staff] in quarter notes, tempos, time signatures, key."""
    root = ET.parse(path).getroot()
    if root.tag != "score-partwise":
        raise ValueError(f"{path}: not a partwise MusicXML score")
    part = root.find("part")
    if part is None:
        raise ValueError(f"{path}: no part")
    divisions = 1
    measure_start = Fraction(0)
    notes: list[list] = []
    open_ties: dict[tuple[int, int], list] = {}
    tempos: list[tuple[Fraction, float]] = []
    times: list[tuple[Fraction, int, int]] = []
    key: tuple[int, str] | None = None
    for measure in part.findall("measure"):
        cursor = Fraction(0)
        longest = Fraction(0)
        chord_onset = Fraction(0)
        last_duration = Fraction(0)
        for el in measure:
            at = measure_start + cursor
            if el.tag == "attributes":
                if el.findtext("divisions"):
                    divisions = int(el.findtext("divisions"))
                k = el.find("key")
                if k is not None and key is None:
                    key = (int(k.findtext("fifths") or 0), k.findtext("mode") or "major")
                t = el.find("time")
                if t is not None:
                    times.append((at, int(t.findtext("beats")), int(t.findtext("beat-type"))))
            elif el.tag in ("direction", "sound"):
                sound = el if el.tag == "sound" else el.find(".//sound")
                if sound is not None and sound.get("tempo"):
                    tempos.append((at, float(sound.get("tempo"))))
            elif el.tag == "backup":
                cursor -= Fraction(int(el.findtext("duration")), divisions)
            elif el.tag == "forward":
                cursor += Fraction(int(el.findtext("duration")), divisions)
                longest = max(longest, cursor)
            elif el.tag == "note":
                if el.find("grace") is not None or el.find("cue") is not None:
                    continue
                duration = Fraction(int(el.findtext("duration") or 0), divisions)
                is_chord = el.find("chord") is not None
                onset = chord_onset if is_chord else cursor
                if not is_chord:
                    chord_onset = cursor
                    last_duration = duration
                    cursor += duration
                    longest = max(longest, cursor)
                pitch = el.find("pitch")
                if el.find("rest") is not None or pitch is None:
                    continue
                midi = ((int(pitch.findtext("octave")) + 1) * 12 + STEP[pitch.findtext("step")]
                        + floor(float(pitch.findtext("alter") or 0) + 0.5))
                staff = int(el.findtext("staff") or 1)
                start = measure_start + onset
                end = start + (last_duration if is_chord else duration)
                ties = {t.get("type") for t in el.findall("tie")}
                tie_key = (staff, midi)
                if "stop" in ties and tie_key in open_ties:
                    open_ties[tie_key][1] = end
                    if "start" not in ties:
                        del open_ties[tie_key]
                    continue
                note = [start, end, midi, staff]
                notes.append(note)
                if "start" in ties:
                    open_ties[tie_key] = note
        measure_start += longest
    return notes, tempos, times, key


def vlq(value: int) -> bytes:
    out = [value & 0x7F]
    value >>= 7
    while value:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    return bytes(reversed(out))


def ticks(quarters: Fraction) -> int:
    t = quarters * PPQ
    if t.denominator != 1:
        raise ValueError(f"{quarters} quarter notes is not a whole number of ticks at {PPQ} per quarter")
    return int(t)


def name_event(text: str) -> bytes:
    data = text.encode("ascii")
    return b"\xff\x03" + vlq(len(data)) + data


def track(events: list[tuple[int, int, bytes]]) -> bytes:
    """events: (tick, rank at equal ticks, payload); sorted stably by (tick, rank)."""
    body = bytearray()
    last = 0
    for tick, _rank, payload in sorted(events, key=lambda e: (e[0], e[1])):
        body += vlq(tick - last) + payload
        last = tick
    body += vlq(0) + b"\xff\x2f\x00"
    return b"MTrk" + len(body).to_bytes(4, "big") + bytes(body)


def convert(path: Path) -> bytes:
    notes, tempos, times, key = read_score(Path(path))
    conductor = [(0, 0, name_event("Conductor"))]
    for at, beats, beat_type in times:
        conductor.append((ticks(at), 1, bytes([0xFF, 0x58, 4, beats, beat_type.bit_length() - 1, 24, 8])))
    if key is not None:
        conductor.append((0, 2, bytes([0xFF, 0x59, 2, key[0] & 0xFF, 1 if key[1] == "minor" else 0])))
    for at, qpm in tempos or [(Fraction(0), 120.0)]:
        conductor.append((ticks(at), 3, b"\xff\x51\x03" + round(60_000_000 / qpm).to_bytes(3, "big")))
    out_tracks = [track(conductor)]
    for channel, name, right in ((0, "RH", True), (1, "LH", False)):
        events = [(0, 0, name_event(name))]
        for start, end, midi, staff in notes:
            if (staff == 1) == right:
                events.append((ticks(end), 1, bytes([0x80 | channel, midi, 0])))
                events.append((ticks(start), 2, bytes([0x90 | channel, midi, VELOCITY])))
        out_tracks.append(track(events))
    header = (b"MThd" + (6).to_bytes(4, "big") + (1).to_bytes(2, "big")
              + len(out_tracks).to_bytes(2, "big") + PPQ.to_bytes(2, "big"))
    return header + b"".join(out_tracks)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    Path(argv[1]).write_bytes(convert(Path(argv[0])))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Generate and copy the fixtures, then run the Python tests**

Run from the repo root:

```bash
content/.venv/Scripts/python.exe -I content/tools/musicxml2midi.py content/scores/twinkle-twinkle-little-star.musicxml packages/engine/fixtures/twinkle.mid
cp packages/engine/fixtures/twinkle.mid apps/web/fixtures/twinkle.mid
cp research/spikes/render/fixtures/tempo-map.mid packages/engine/fixtures/tempo-map.mid
content/.venv/Scripts/python.exe -m pytest content/tools/tests/test_musicxml2midi.py -q
```

Expected: 4 passed. The Twinkle file is well under 1 KB (the repo hygiene limit is 1 MB per file).

- [ ] **Step 5: Write the failing reader tests**

`packages/engine/src/io/midi/read.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeMidi, type MidiEvent } from 'midi-file';
import { describe, expect, it } from 'vitest';
import { midiTickToSeconds, parseMidiFile } from './read.js';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url))),
  );

const on = (deltaTime: number, noteNumber: number, channel = 0, velocity = 80): MidiEvent => ({
  deltaTime,
  type: 'noteOn',
  channel,
  noteNumber,
  velocity,
});
const off = (deltaTime: number, noteNumber: number, channel = 0): MidiEvent => ({
  deltaTime,
  type: 'noteOff',
  channel,
  noteNumber,
  velocity: 0,
});
const end = (deltaTime = 0): MidiEvent => ({ deltaTime, meta: true, type: 'endOfTrack' });
const tempo = (deltaTime: number, bpm: number): MidiEvent => ({
  deltaTime,
  meta: true,
  type: 'setTempo',
  microsecondsPerBeat: Math.round(60e6 / bpm),
});

function smf(
  tracks: MidiEvent[][],
  opts: { format?: 0 | 1; ppq?: number; running?: boolean } = {},
): Uint8Array {
  const bytes = writeMidi(
    {
      header: { format: opts.format ?? 1, numTracks: tracks.length, ticksPerBeat: opts.ppq ?? 480 },
      tracks,
    },
    { running: opts.running ?? false, useByte9ForNoteOff: opts.running ?? false },
  );
  return new Uint8Array(bytes);
}

describe('parseMidiFile', () => {
  it('reads the tempo map: bar 5 at 10 s, bar 7 at 18 s, the last right-hand note at 21.5 s', () => {
    const data = parseMidiFile(fixture('tempo-map.mid'));
    expect(data.ppq).toBe(480);
    expect(data.tempos).toEqual([
      { tick: 0, usPerQuarter: 625_000 },
      { tick: 7680, usPerQuarter: 1_000_000 },
      { tick: 11520, usPerQuarter: 500_000 },
    ]);
    expect(data.timeSignatures).toEqual([{ tick: 0, beats: 4, beatType: 4 }]);
    expect(data.notes).toHaveLength(40);
    const rh = data.notes.filter((n) => n.channel === 0);
    expect(rh).toHaveLength(32);
    expect(midiTickToSeconds(data, rh[16]!.tick)).toBeCloseTo(10, 9);
    expect(midiTickToSeconds(data, rh[24]!.tick)).toBeCloseTo(18, 9);
    expect(midiTickToSeconds(data, rh[31]!.tick)).toBeCloseTo(21.5, 9);
    expect(data.warnings).toEqual([]);
  });
  it('pairs overlapping notes on one key first-in first-out, so no duration is negative', () => {
    const data = parseMidiFile(smf([[on(0, 60), on(240, 60), off(240, 60), off(240, 60), end()]]));
    expect(data.notes.map((n) => [n.tick, n.endTick])).toEqual([
      [0, 480],
      [240, 720],
    ]);
    for (const n of data.notes) expect(n.endTick).toBeGreaterThanOrEqual(n.tick);
  });
  it('reads format 0 with running status and note-on velocity 0 as note-off', () => {
    const bytes = smf(
      [
        [
          tempo(0, 90),
          on(0, 48, 1),
          on(0, 64, 0),
          off(96, 64, 0),
          on(0, 67, 0),
          off(96, 67, 0),
          off(0, 48, 1),
          end(),
        ],
      ],
      { format: 0, ppq: 96, running: true },
    );
    const data = parseMidiFile(bytes);
    expect(data.ppq).toBe(96);
    expect(data.notes.map((n) => [n.tick, n.endTick, n.midi, n.channel])).toEqual([
      [0, 192, 48, 1],
      [0, 96, 64, 0],
      [96, 192, 67, 0],
    ]);
    expect(data.tempos).toEqual([{ tick: 0, usPerQuarter: 666_667 }]);
  });
  it('assumes 120 quarter notes per minute and 4/4 when the file says nothing', () => {
    const data = parseMidiFile(smf([[on(0, 60), off(480, 60), end()]]));
    expect(data.tempos).toEqual([{ tick: 0, usPerQuarter: 500_000 }]);
    expect(data.timeSignatures).toEqual([{ tick: 0, beats: 4, beatType: 4 }]);
    expect(midiTickToSeconds(data, 480)).toBeCloseTo(0.5, 12);
    expect(data.warnings).toEqual([
      'no tempo in the file; using 120 quarter notes per minute',
      'no time signature in the file; using 4/4',
    ]);
  });
  it('ignores the percussion channel and notes outside the piano, and says so', () => {
    const data = parseMidiFile(
      smf([
        [on(0, 36, 9), off(120, 36, 9), on(0, 60), off(480, 60), on(0, 12), off(480, 12), end()],
      ]),
    );
    expect(data.notes.map((n) => n.midi)).toEqual([60]);
    expect(data.warnings).toContain('ignored 1 percussion note on channel 10');
    expect(data.warnings).toContain('ignored 1 note outside the piano range (A0 to C8)');
  });
  it('reads the key signature and closes a note that never ends at the end of its track', () => {
    const ks: MidiEvent = { deltaTime: 0, meta: true, type: 'keySignature', key: -3, scale: 1 };
    const data = parseMidiFile(smf([[ks, on(0, 60), on(0, 63), off(480, 60), end(480)]]));
    expect(data.keySignature).toEqual({ fifths: -3, mode: 'minor' });
    expect(data.notes.map((n) => [n.midi, n.tick, n.endTick])).toEqual([
      [60, 0, 480],
      [63, 0, 960],
    ]);
    expect(data.warnings).toContain('1 note had no note-off and ends with its track');
  });
  it('reads SMPTE-timed files at 120 quarter notes per minute so seconds stay right', () => {
    const bytes = smf([[on(0, 60), off(1000, 60), end()]]);
    bytes[12] = 0xe7; // -25 frames per second
    bytes[13] = 0x28; // 40 ticks per frame: 1000 ticks per second
    const data = parseMidiFile(bytes);
    expect(data.ppq).toBe(500);
    expect(midiTickToSeconds(data, data.notes[0]!.endTick)).toBeCloseTo(1, 12);
    expect(data.warnings[0]).toBe(
      'the file counts time in SMPTE frames, not beats; notes are placed on a 120 quarter-note-per-minute grid',
    );
  });
  it('reads the generated Twinkle fixture: 64 notes, 42 on the RH track and 22 on the LH track', () => {
    const data = parseMidiFile(fixture('twinkle.mid'));
    expect(data.notes).toHaveLength(64);
    expect(data.notes.filter((n) => n.track === 1)).toHaveLength(42);
    expect(data.notes.filter((n) => n.track === 2)).toHaveLength(22);
    expect(data.tempos).toEqual([{ tick: 0, usPerQuarter: 600_000 }]);
    expect(data.keySignature).toEqual({ fifths: 0, mode: 'major' });
    expect(data.warnings).toEqual([]);
  });
  it('rejects bytes that are not a MIDI file with a readable message', () => {
    expect(() => parseMidiFile(new TextEncoder().encode('<score-partwise/>'))).toThrow(
      /^not a MIDI file/,
    );
    expect(() => parseMidiFile(new TextEncoder().encode('MThd'))).toThrow(/^not a MIDI file/);
  });
});
```

Run: `pnpm --filter @digitus2/engine exec vitest run src/io/midi`
Expected: FAIL (module `./read.js` not found).

- [ ] **Step 6: Implement**

`packages/engine/src/io/midi/plural.ts`:

```ts
/** `1 note` / `3 notes`: every count in a warning goes through this. */
export function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
```

`packages/engine/src/io/midi/read.ts`:

```ts
import { parseMidi } from 'midi-file';
import { PIANO_MAX, PIANO_MIN } from '../../score/pitch.js';
import { count } from './plural.js';

export interface MidiTempo {
  tick: number;
  usPerQuarter: number;
}
export interface MidiTimeSignature {
  tick: number;
  beats: number;
  beatType: number;
}
export interface MidiKeySignature {
  fifths: number;
  mode: 'major' | 'minor';
}
export interface MidiNote {
  tick: number;
  endTick: number;
  midi: number;
  velocity: number;
  channel: number;
  track: number;
}
export interface MidiData {
  ppq: number;
  tempos: MidiTempo[];
  timeSignatures: MidiTimeSignature[];
  keySignature?: MidiKeySignature;
  notes: MidiNote[];
  warnings: string[];
}

export const DEFAULT_US_PER_QUARTER = 500_000;
export const PERCUSSION_CHANNEL = 9;

export function parseMidiFile(bytes: Uint8Array): MidiData {
  let file: ReturnType<typeof parseMidi>;
  try {
    file = parseMidi(bytes);
  } catch (e) {
    throw new Error(`not a MIDI file: ${e instanceof Error ? e.message : String(e)}`);
  }
  const warnings: string[] = [];
  // midi-file does not throw on a truncated header: it returns NaN fields. Check them here.
  const smpte = file.header.framesPerSecond !== undefined;
  const ppq = smpte
    ? ((file.header.framesPerSecond ?? 0) * (file.header.ticksPerFrame ?? 0)) / 2
    : (file.header.ticksPerBeat ?? Number.NaN);
  if (!(Number.isFinite(ppq) && ppq > 0)) throw new Error('not a MIDI file: no time division');
  if (smpte)
    warnings.push(
      'the file counts time in SMPTE frames, not beats; notes are placed on a 120 quarter-note-per-minute grid',
    );
  if (file.header.format === 2)
    warnings.push('format 2 MIDI file: its tracks are read as if they played together');

  const tempos: MidiTempo[] = [];
  const timeSignatures: MidiTimeSignature[] = [];
  let keySignature: MidiKeySignature | undefined;
  const notes: MidiNote[] = [];
  let percussion = 0;
  let outside = 0;
  let unclosed = 0;
  const push = (n: MidiNote) => {
    if (n.midi < PIANO_MIN || n.midi > PIANO_MAX) outside++;
    else notes.push(n);
  };

  file.tracks.forEach((events, track) => {
    let tick = 0;
    // `${channel}:${key}` -> note-ons waiting for their note-off, oldest first
    const open = new Map<string, Array<{ tick: number; velocity: number }>>();
    for (const e of events) {
      tick += e.deltaTime;
      switch (e.type) {
        case 'setTempo':
          if (!smpte) tempos.push({ tick, usPerQuarter: e.microsecondsPerBeat });
          break;
        case 'timeSignature':
          timeSignatures.push({ tick, beats: e.numerator, beatType: e.denominator });
          break;
        case 'keySignature':
          keySignature ??= { fifths: e.key, mode: e.scale === 1 ? 'minor' : 'major' };
          break;
        case 'noteOn': {
          if (e.channel === PERCUSSION_CHANNEL) {
            percussion++;
            break;
          }
          const key = `${e.channel}:${e.noteNumber}`;
          const list = open.get(key);
          if (list) list.push({ tick, velocity: e.velocity });
          else open.set(key, [{ tick, velocity: e.velocity }]);
          break;
        }
        case 'noteOff': {
          if (e.channel === PERCUSSION_CHANNEL) break;
          const started = open.get(`${e.channel}:${e.noteNumber}`)?.shift();
          if (started)
            push({
              tick: started.tick,
              endTick: tick,
              midi: e.noteNumber,
              velocity: started.velocity,
              channel: e.channel,
              track,
            });
          break;
        }
        default:
          break;
      }
    }
    for (const [key, list] of open) {
      const [channel, midi] = key.split(':').map(Number) as [number, number];
      for (const started of list) {
        unclosed++;
        push({
          tick: started.tick,
          endTick: tick,
          midi,
          velocity: started.velocity,
          channel,
          track,
        });
      }
    }
  });

  tempos.sort((a, b) => a.tick - b.tick);
  if (tempos.length === 0) {
    if (!smpte) warnings.push('no tempo in the file; using 120 quarter notes per minute');
    tempos.push({ tick: 0, usPerQuarter: DEFAULT_US_PER_QUARTER });
  } else if (tempos[0]!.tick > 0) tempos.unshift({ tick: 0, usPerQuarter: DEFAULT_US_PER_QUARTER });
  timeSignatures.sort((a, b) => a.tick - b.tick);
  if (timeSignatures.length === 0) {
    warnings.push('no time signature in the file; using 4/4');
    timeSignatures.push({ tick: 0, beats: 4, beatType: 4 });
  } else if (timeSignatures[0]!.tick > 0)
    timeSignatures.unshift({ tick: 0, beats: 4, beatType: 4 });
  if (percussion > 0)
    warnings.push(
      `ignored ${count(percussion, 'percussion note', 'percussion notes')} on channel 10`,
    );
  if (outside > 0)
    warnings.push(`ignored ${count(outside, 'note', 'notes')} outside the piano range (A0 to C8)`);
  if (unclosed > 0)
    warnings.push(
      unclosed === 1
        ? '1 note had no note-off and ends with its track'
        : `${unclosed} notes had no note-off and end with their track`,
    );
  notes.sort(
    (a, b) => a.tick - b.tick || a.midi - b.midi || a.track - b.track || a.channel - b.channel,
  );
  return {
    ppq,
    tempos,
    timeSignatures,
    ...(keySignature ? { keySignature } : {}),
    notes,
    warnings,
  };
}

/** Seconds at `tick` (fractional ticks allowed), through the tempo map; mirrors ticksToSeconds. */
export function midiTickToSeconds(data: Pick<MidiData, 'ppq' | 'tempos'>, tick: number): number {
  const tempos =
    data.tempos.length > 0 ? data.tempos : [{ tick: 0, usPerQuarter: DEFAULT_US_PER_QUARTER }];
  let seconds = 0;
  let cursor = 0;
  let us = tempos[0]!.tick <= 0 ? tempos[0]!.usPerQuarter : DEFAULT_US_PER_QUARTER;
  for (const t of tempos) {
    if (t.tick >= tick) break;
    if (t.tick > cursor) {
      seconds += ((t.tick - cursor) / data.ppq) * (us / 1e6);
      cursor = t.tick;
    }
    us = t.usPerQuarter;
  }
  return seconds + ((tick - cursor) / data.ppq) * (us / 1e6);
}
```

If tsc rejects the named import from the CommonJS package, use `import midiFile from 'midi-file'; const { parseMidi } = midiFile;` (both forms work in Vite and Node); keep `import { writeMidi, type MidiEvent }` in the test in whichever form compiles.

- [ ] **Step 7: Run the tests and the checks**

Run: `pnpm --filter @digitus2/engine exec vitest run src/io/midi && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: 9 reader tests pass; no type or lint errors.

Run: `pnpm verify`
Expected: all PASS.

- [ ] **Step 8: Hand-off**

Paths for the coordinator's commit: `packages/engine/package.json`, `pnpm-lock.yaml`, `packages/engine/src/io/midi/plural.ts`, `packages/engine/src/io/midi/read.ts`, `packages/engine/src/io/midi/read.test.ts`, `packages/engine/fixtures/twinkle.mid`, `packages/engine/fixtures/tempo-map.mid`, `apps/web/fixtures/twinkle.mid`, `content/tools/musicxml2midi.py`, `content/tools/tests/test_musicxml2midi.py`. Suggested message: `feat(engine): MIDI reader with tempo map, time and key signatures; MIDI fixtures`.

---

### Task 1: Quantization to a per-beat grid

**Files:**

- Create: `packages/engine/src/io/midi/quantize.ts`, `packages/engine/src/io/midi/quantize.test.ts`

**Interfaces:**

- Consumes: `MidiData`, `midiTickToSeconds` (Task 0), `count` (Task 0).
- Produces:

```ts
export const QUANT_DIVISIONS = 480; // ticks per quarter of every quantized position; lcm(4, 6, 8) divides it
export type GridKind = '16th' | '16th-triplet' | '32nd';
export const GRID_KINDS: readonly GridKind[]; // simplicity order: ['16th', '16th-triplet', '32nd']
export const GRID_UNIT: Readonly<Record<GridKind, number>>; // { '16th': 120, '16th-triplet': 80, '32nd': 60 }
export const GRID_GAIN = 2;
export const GRID_TOLERANCE_TICKS = 8;
export const MOVED_THRESHOLD_TICKS = 30; // a 64th note
export interface QuantizedNote {
  onset: number; // QUANT_DIVISIONS ticks
  offset: number;
  onsetSec: number; // seconds of the snapped onset through the file's tempo map
  midi: number;
  velocity: number;
  channel: number;
  track: number;
  sources: number[]; // indices into MidiData.notes merged into this note, ascending
}
export interface QuantizedNotes {
  divisions: number; // QUANT_DIVISIONS
  notes: QuantizedNote[]; // sorted by onset, then midi
  beatGrids: Array<{ beat: number; grid: GridKind }>; // quarter-note beats that contain onsets
  grids: Record<GridKind, number>; // how many of those beats use each grid
  movedShare: number; // share of source notes whose onset moved more than a 64th note (0..1)
  displacementMs: { mean: number; p95: number; max: number }; // onset displacement in milliseconds
  warnings: string[];
}
export interface QuantizeOptions {
  grids?: readonly GridKind[]; // candidate grids in simplicity order; default GRID_KINDS
}
export function snapTo(position: number, grid: GridKind): number;
export function beatOf(position: number): number; // floor((position + 30) / 480): an onset up to a 64th early belongs to the next beat
export function chooseGrid(onsets: readonly number[], grids?: readonly GridKind[]): GridKind;
export function quantize(data: MidiData, opts?: QuantizeOptions): QuantizedNotes;
```

Rules (decisions 3 and 4): positions are MIDI ticks scaled to 480 per quarter. Beats are absolute quarter-note windows (`beatOf`). Per beat with onsets, `chooseGrid` starts from the simplest grid and moves to the next one only when the current one's total displacement exceeds `GRID_GAIN * d_next + n * GRID_TOLERANCE_TICKS`. Onsets snap to their beat's grid; offsets snap to the grid of the beat they fall in (16th when that beat has no onsets) and are at least one grid unit after the onset. Notes with the same snapped onset and key merge (offset and velocity are the maxima, sources are joined). A note whose offset passes the next onset on the same key ends there. Warnings (exact): `merged N duplicate note(s)`, `shortened N note(s) that overlapped the next note on the same key`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/io/midi/quantize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MidiData } from './read.js';
import { chooseGrid, QUANT_DIVISIONS, quantize } from './quantize.js';

function data(notes: Array<[number, number, number]>, ppq = 480): MidiData {
  return {
    ppq,
    tempos: [{ tick: 0, usPerQuarter: 500_000 }],
    timeSignatures: [{ tick: 0, beats: 4, beatType: 4 }],
    notes: notes.map(([tick, endTick, midi], i) => ({
      tick,
      endTick,
      midi,
      velocity: 80,
      channel: 0,
      track: i % 2,
    })),
    warnings: [],
  };
}

describe('quantize', () => {
  it('snaps 16th notes played with up to 20 ms of jitter back onto the grid', () => {
    // ticks at 480 per quarter and 120 quarter notes per minute: 19 ticks = 19.8 ms
    const jitter = [19, -19, 12, -7, 0, 15, -15, 5, -19, 19, 3, -3, 10, -10, 18, -18];
    const q = quantize(data(jitter.map((j, k) => [k * 120 + j, k * 120 + j + 100, 60 + (k % 5)])));
    expect(q.divisions).toBe(QUANT_DIVISIONS);
    expect(q.notes.map((n) => n.onset)).toEqual(jitter.map((_, k) => k * 120));
    expect(q.notes.map((n) => n.offset - n.onset)).toEqual(jitter.map(() => 120));
    expect(q.beatGrids.map((b) => b.grid)).toEqual(['16th', '16th', '16th', '16th']);
    expect(q.grids).toEqual({ '16th': 4, '16th-triplet': 0, '32nd': 0 });
    expect(q.movedShare).toBe(0);
    expect(q.displacementMs.max).toBeGreaterThan(19);
    expect(q.displacementMs.max).toBeLessThanOrEqual(20);
    expect(q.warnings).toEqual([]);
  });
  it('detects a triplet beat next to a straight one', () => {
    const q = quantize(
      data([
        [0, 230, 60],
        [240, 470, 62],
        [486, 636, 64],
        [634, 784, 65],
        [803, 953, 67],
      ]),
    );
    expect(q.notes.map((n) => n.onset)).toEqual([0, 240, 480, 640, 800]);
    expect(q.notes.map((n) => n.offset)).toEqual([240, 480, 640, 800, 960]);
    expect(q.beatGrids).toEqual([
      { beat: 0, grid: '16th' },
      { beat: 1, grid: '16th-triplet' },
    ]);
    expect(q.grids).toEqual({ '16th': 1, '16th-triplet': 1, '32nd': 0 });
  });
  it('chooses the grid a beat really uses', () => {
    expect(chooseGrid([0, 60, 120, 180])).toBe('32nd');
    expect(chooseGrid([0, 120, 240, 360])).toBe('16th');
    expect(chooseGrid([0, 160, 320])).toBe('16th-triplet');
    expect(chooseGrid([0, 60, 120, 180], ['16th'])).toBe('16th');
  });
  it('keeps a quarter note played 40 ticks late on its beat and counts it as moved', () => {
    const q = quantize(
      data([
        [0, 470, 60],
        [520, 950, 62],
        [960, 1430, 64],
        [1440, 1910, 65],
      ]),
    );
    expect(q.notes.map((n) => n.onset)).toEqual([0, 480, 960, 1440]);
    expect(q.movedShare).toBe(0.25);
    expect(q.displacementMs.max).toBeCloseTo((40 * 500) / 480, 6);
  });
  it('merges simultaneous notes on one key and shortens a note that overlaps the next on its key', () => {
    const q = quantize(
      data([
        [0, 470, 60],
        [5, 200, 60],
        [960, 1440, 62],
        [1200, 1680, 62],
      ]),
    );
    expect(q.notes.map((n) => [n.onset, n.offset, n.midi, n.sources])).toEqual([
      [0, 480, 60, [0, 1]],
      [960, 1200, 62, [2]],
      [1200, 1680, 62, [3]],
    ]);
    for (const n of q.notes) expect(n.offset).toBeGreaterThan(n.onset);
    expect(q.warnings).toEqual([
      'merged 1 duplicate note',
      'shortened 1 note that overlapped the next note on the same key',
    ]);
  });
  it('gives a note shorter than the grid one grid unit', () => {
    expect(quantize(data([[480, 490, 60]])).notes[0]).toMatchObject({ onset: 480, offset: 600 });
  });
  it('converts other resolutions and computes seconds through the tempo map', () => {
    const d = data(
      [
        [24, 48, 60],
        [96, 192, 62],
      ],
      96,
    );
    d.tempos = [
      { tick: 0, usPerQuarter: 500_000 },
      { tick: 96, usPerQuarter: 1_000_000 },
    ];
    const q = quantize(d);
    expect(q.notes.map((n) => [n.onset, n.offset])).toEqual([
      [120, 240],
      [480, 960],
    ]);
    expect(q.notes.map((n) => n.onsetSec)).toEqual([0.125, 0.5]);
  });
  it('handles an empty file', () => {
    const q = quantize(data([]));
    expect(q.notes).toEqual([]);
    expect(q.movedShare).toBe(0);
    expect(q.displacementMs).toEqual({ mean: 0, p95: 0, max: 0 });
    expect(q.grids).toEqual({ '16th': 0, '16th-triplet': 0, '32nd': 0 });
  });
});
```

(Arithmetic behind the triplet case: beat 1 onsets 486, 634 and 803 are 77 ticks in total from the 16th grid, 15 from the triplet grid and 55 from the 32nd grid; 77 > 2 × 15 + 3 × 8, so the triplet grid replaces the 16th grid, and 15 is not more than 2 × 55 + 24, so it stays. The late quarter note: 40 ticks from the 16th grid, 20 from the 32nd grid, and 40 is not more than 2 × 20 + 8.)

Run: `pnpm --filter @digitus2/engine exec vitest run src/io/midi/quantize`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

`packages/engine/src/io/midi/quantize.ts`:

```ts
import { count } from './plural.js';
import { midiTickToSeconds, type MidiData } from './read.js';

export const QUANT_DIVISIONS = 480;
export type GridKind = '16th' | '16th-triplet' | '32nd';
export const GRID_KINDS: readonly GridKind[] = ['16th', '16th-triplet', '32nd'];
export const GRID_UNIT: Readonly<Record<GridKind, number>> = {
  '16th': 120,
  '16th-triplet': 80,
  '32nd': 60,
};
export const GRID_GAIN = 2;
export const GRID_TOLERANCE_TICKS = 8;
export const MOVED_THRESHOLD_TICKS = 30;
const BEAT_LEAD = 30;

export interface QuantizedNote {
  onset: number;
  offset: number;
  onsetSec: number;
  midi: number;
  velocity: number;
  channel: number;
  track: number;
  sources: number[];
}
export interface QuantizedNotes {
  divisions: number;
  notes: QuantizedNote[];
  beatGrids: Array<{ beat: number; grid: GridKind }>;
  grids: Record<GridKind, number>;
  movedShare: number;
  displacementMs: { mean: number; p95: number; max: number };
  warnings: string[];
}
export interface QuantizeOptions {
  grids?: readonly GridKind[];
}

export function snapTo(position: number, grid: GridKind): number {
  const unit = GRID_UNIT[grid];
  return Math.round(position / unit) * unit;
}

export function beatOf(position: number): number {
  return Math.floor((position + BEAT_LEAD) / QUANT_DIVISIONS);
}

export function chooseGrid(
  onsets: readonly number[],
  grids: readonly GridKind[] = GRID_KINDS,
): GridKind {
  const displacement = (g: GridKind) => onsets.reduce((s, p) => s + Math.abs(p - snapTo(p, g)), 0);
  let best = grids[0] ?? '16th';
  let bestD = displacement(best);
  for (const g of grids.slice(1)) {
    const d = displacement(g);
    if (bestD > GRID_GAIN * d + onsets.length * GRID_TOLERANCE_TICKS) {
      best = g;
      bestD = d;
    }
  }
  return best;
}

export function quantize(data: MidiData, opts: QuantizeOptions = {}): QuantizedNotes {
  const grids = opts.grids ?? GRID_KINDS;
  const scale = QUANT_DIVISIONS / data.ppq;
  const raw = data.notes.map((n) => ({ on: n.tick * scale, off: n.endTick * scale }));

  const onsetsByBeat = new Map<number, number[]>();
  for (const r of raw) {
    const b = beatOf(r.on);
    const list = onsetsByBeat.get(b);
    if (list) list.push(r.on);
    else onsetsByBeat.set(b, [r.on]);
  }
  const gridOfBeat = new Map<number, GridKind>();
  const counts: Record<GridKind, number> = { '16th': 0, '16th-triplet': 0, '32nd': 0 };
  const beats = [...onsetsByBeat.keys()].sort((a, b) => a - b);
  for (const b of beats) {
    const g = chooseGrid(onsetsByBeat.get(b)!, grids);
    gridOfBeat.set(b, g);
    counts[g]++;
  }
  const fallback = grids[0] ?? '16th';
  const gridAt = (p: number): GridKind => gridOfBeat.get(beatOf(p)) ?? fallback;
  const seconds = (p: number) => midiTickToSeconds(data, p / scale);

  const movedTicks: number[] = [];
  const movedMs: number[] = [];
  const snapped: QuantizedNote[] = data.notes.map((n, i) => {
    const r = raw[i]!;
    const g = gridAt(r.on);
    const onset = snapTo(r.on, g);
    let offset = snapTo(r.off, gridAt(r.off));
    if (offset < onset + GRID_UNIT[g]) offset = onset + GRID_UNIT[g];
    movedTicks.push(Math.abs(onset - r.on));
    movedMs.push(Math.abs(seconds(onset) - seconds(r.on)) * 1000);
    return {
      onset,
      offset,
      onsetSec: seconds(onset),
      midi: n.midi,
      velocity: n.velocity,
      channel: n.channel,
      track: n.track,
      sources: [i],
    };
  });

  snapped.sort((a, b) => a.onset - b.onset || a.midi - b.midi || a.sources[0]! - b.sources[0]!);
  const notes: QuantizedNote[] = [];
  let duplicates = 0;
  for (const n of snapped) {
    const last = notes[notes.length - 1];
    if (last && last.onset === n.onset && last.midi === n.midi) {
      last.offset = Math.max(last.offset, n.offset);
      last.velocity = Math.max(last.velocity, n.velocity);
      last.sources.push(...n.sources);
      duplicates++;
    } else notes.push(n);
  }
  const byKey = new Map<number, QuantizedNote[]>();
  for (const n of notes) {
    const list = byKey.get(n.midi);
    if (list) list.push(n);
    else byKey.set(n.midi, [n]);
  }
  let shortened = 0;
  for (const list of byKey.values())
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i]!;
      const b = list[i + 1]!;
      if (a.offset > b.onset) {
        a.offset = b.onset;
        shortened++;
      }
    }

  const warnings: string[] = [];
  if (duplicates > 0)
    warnings.push(`merged ${count(duplicates, 'duplicate note', 'duplicate notes')}`);
  if (shortened > 0)
    warnings.push(
      `shortened ${count(shortened, 'note that overlapped', 'notes that overlapped')} the next note on the same key`,
    );
  const sortedMs = [...movedMs].sort((a, b) => a - b);
  const n = movedMs.length;
  return {
    divisions: QUANT_DIVISIONS,
    notes,
    beatGrids: beats.map((beat) => ({ beat, grid: gridOfBeat.get(beat)! })),
    grids: counts,
    movedShare: n === 0 ? 0 : movedTicks.filter((t) => t > MOVED_THRESHOLD_TICKS).length / n,
    displacementMs: {
      mean: n === 0 ? 0 : movedMs.reduce((s, x) => s + x, 0) / n,
      p95: n === 0 ? 0 : sortedMs[Math.ceil(0.95 * n) - 1]!,
      max: n === 0 ? 0 : sortedMs[n - 1]!,
    },
    warnings,
  };
}
```

- [ ] **Step 3: Run the tests and the checks**

Run: `pnpm --filter @digitus2/engine exec vitest run src/io/midi && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: all pass.

Run: `pnpm verify`
Expected: all PASS.

- [ ] **Step 4: Hand-off**

Paths: `packages/engine/src/io/midi/quantize.ts`, `packages/engine/src/io/midi/quantize.test.ts`. Message: `feat(engine): quantize MIDI onsets to a per-beat 16th, triplet or 32nd grid`.

---

### Task 2: Hand-motion statistics: the fitting script, the shipped tables, and the TypeScript loader

**Files:**

- Create: `research/scripts/make_hand_motion.py`, `research/tests/test_make_hand_motion.py`, `packages/engine/src/io/midi/params/hand-motion.json` (generated), `packages/engine/src/io/midi/motion.ts`, `packages/engine/src/io/midi/motion.test.ts`

**Interfaces:**

- Consumes: `parseMusicXml` (M1), `Score`, `Hand` (M1); the corpora on disk: `content/manifest.json` (array; `files.score` relative to `content/`), `research/data/mutopia_fingering/FingeringFiles/<part>-0_fingering.txt` with `research/data/splits/mutopia_split.json` (`splits[default_split].train.pieces`, M3 Task 2), and for the research variant only `research/data/pig/FingeringFiles/<id>-<k>_fingering.txt` with `research/data/splits/pig_official.json` (`splits.nakamura2020.train.pieces`). PIG-format files: tab-separated `id onset offset pitch onVel offVel channel finger`, channel `0` = right hand.
- Produces:

```ts
// motion.ts
export const MOVE_RANGE = 24; // movement buckets -24..24 (49 entries, index delta + 24)
export const SPAN_CAP = 24; // span buckets 0..24 (25 entries; 24 means 24 or more)
export const POSITION_MIN = 21; // position buckets MIDI 21..108 (88 entries)
export const POSITION_MAX = 108;
export type HandPattern = 'L' | 'R' | 'LR'; // which hands play at an onset
export const HAND_PATTERNS: readonly HandPattern[];
export interface HandMotionTables {
  moveLeft: number[];
  moveRight: number[];
  spanLeft: number[];
  spanRight: number[];
  positionLeft: number[];
  positionRight: number[];
  pattern: Record<HandPattern, Record<HandPattern, number>>; // row = the previous onset's pattern
}
export type HandMotionCounts = HandMotionTables; // same shapes, raw counts
export interface HandMotionParams extends HandMotionTables {
  mu: number; // crossing penalty, nats
  nu: number; // idle penalty per onset, nats
  idleSec: number; // a silent hand pays nu after this many seconds
}
export function loadHandMotion(raw: unknown): HandMotionParams; // validates; throws naming the bad field
export const HAND_MOTION: HandMotionParams; // params/hand-motion.json
export function roundHalfUp(x: number): number; // Math.floor(x + 0.5)
export function chordCentre(pitches: readonly number[]): number; // (lowest + highest) / 2
export function moveIndex(delta: number): number; // clamp(roundHalfUp(delta), -24, 24) + 24
export function spanIndex(span: number): number; // min(span, 24)
export function positionIndex(centre: number): number; // clamp(roundHalfUp(centre), 21, 108) - 21
export function emptyCounts(): HandMotionCounts;
export function addCounts(into: HandMotionCounts, from: HandMotionCounts): void;
export function motionCounts(
  notes: ReadonlyArray<{ onset: number; midi: number; hand: Hand }>,
): HandMotionCounts;
export function scoreMotionCounts(score: Score): HandMotionCounts; // onset = onsetTick
```

The shared definition (the Python docstring repeats it; `motion.test.ts` checks that both sides count the library identically): group notes by onset; the first onset follows pattern `LR`; at each onset count the pattern transition; for each hand that plays, `centre = (lowest + highest) / 2`, count `span = highest − lowest` (capped), `position = roundHalfUp(centre)` (clamped), and, when the hand played before, `move = roundHalfUp(centre − previous centre)` (clamped). Probabilities are `(count + 0.5) / (total + 0.5 × buckets)`, each pattern row separately. `mu = 5`, `nu = 0.5`, `idleSec = 4` are hand-set defaults (in the spike of decision 1, μ from 2.5 to 10, ν from 0 to 2 and T from 2 to 4 s moved either macro accuracy by at most 0.3 points; μ = 0 cost about one point); Task 9 records a sensitivity check.

- [ ] **Step 1: Write the failing Python tests**

`research/tests/test_make_hand_motion.py`:

```python
"""make_hand_motion.py: movement, span, position and pattern statistics of staff-labelled music."""
from __future__ import annotations

import json
import sys
from fractions import Fraction
from pathlib import Path

import pytest

RESEARCH = Path(__file__).resolve().parents[1]
REPO = RESEARCH.parent
sys.path.insert(0, str(RESEARCH / "scripts"))
import make_hand_motion as mhm  # noqa: E402

XML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><tie type="start"/><voice>1</voice><staff>1</staff></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><tie type="stop"/><voice>1</voice><staff>1</staff></note>
<note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>5</voice><staff>2</staff></note>
<forward><duration>1</duration></forward>
<note><pitch><step>G</step><octave>2</octave></pitch><duration>1</duration><voice>5</voice><staff>2</staff></note>
</measure></part></score-partwise>
"""


def nonzero(xs):
    return {i: v for i, v in enumerate(xs) if v}


def test_counts_follow_the_shared_definition(tmp_path):
    path = tmp_path / "piece.musicxml"
    path.write_text(XML, encoding="utf-8")
    notes = mhm.musicxml_notes(path)
    assert sorted(notes) == sorted([
        (Fraction(0), 60, "R"), (Fraction(0), 64, "R"), (Fraction(1), 62, "R"), (Fraction(3), 67, "R"),
        (Fraction(0), 48, "L"), (Fraction(3), 43, "L"),
    ])
    c = mhm.motion_counts(notes)
    assert nonzero(c["moveRight"]) == {24: 1, 29: 1}  # 62 -> 62, 62 -> 67
    assert nonzero(c["moveLeft"]) == {19: 1}  # 48 -> 43
    assert nonzero(c["spanRight"]) == {0: 2, 4: 1}
    assert nonzero(c["spanLeft"]) == {0: 2}
    assert nonzero(c["positionRight"]) == {41: 2, 46: 1}
    assert nonzero(c["positionLeft"]) == {22: 1, 27: 1}
    assert c["pattern"] == {
        "L": {"L": 0, "R": 0, "LR": 0},
        "R": {"L": 0, "R": 0, "LR": 1},
        "LR": {"L": 0, "R": 1, "LR": 1},
    }


def test_pig_files_use_the_channel_as_the_hand(tmp_path):
    path = tmp_path / "001-1_fingering.txt"
    path.write_text(
        "//Version: PianoFingering_v170101\n"
        "0\t0.0\t0.5\tC4\t64\t64\t0\t1\n"
        "1\t0.0\t1.0\tC3\t64\t64\t1\t-5\n"
        "2\t0.5\t1.0\tEb4\t64\t64\t0\t2\n",
        encoding="utf-8",
    )
    assert sorted(mhm.pig_notes(path)) == sorted([(0, 60, "R"), (0, 48, "L"), (500_000, 63, "R")])


def test_smoothing_adds_one_half_and_normalises():
    counts = mhm.empty_counts()
    counts["moveLeft"][24] = 3
    probs = mhm.smooth(counts, frozenset())
    assert probs["moveLeft"][24] == pytest.approx(3.5 / (3 + 0.5 * 49))
    assert sum(probs["moveLeft"]) == pytest.approx(1.0)
    for row in probs["pattern"].values():
        assert sum(row.values()) == pytest.approx(1.0)
        assert row["L"] == pytest.approx(1 / 3)


def test_the_script_is_deterministic_and_refuses_to_ship_pig_statistics(tmp_path):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    args = ["--library", str(REPO / "content/manifest.json"), "--date", "2026-10-14"]
    assert mhm.main(args + ["--out", str(a)]) == 0
    assert mhm.main(args + ["--out", str(b)]) == 0
    assert a.read_bytes() == b.read_bytes()
    data = json.loads(a.read_text(encoding="utf-8"))
    assert [(s["name"], s["files"]) for s in data["provenance"]["sources"]] == [("library", 30)]
    assert (len(data["moveLeft"]), len(data["spanRight"]), len(data["positionLeft"])) == (49, 25, 88)
    assert sum(data["counts"]["library"]["moveRight"]) > 500
    assert (data["mu"], data["nu"], data["idleSec"]) == (5.0, 0.5, 4.0)
    with pytest.raises(SystemExit) as err:
        mhm.main(["--pig", str(tmp_path), "--pig-split", str(tmp_path / "s.json"),
                  "--out", str(REPO / "packages/engine/x.json")])
    assert "research-only" in str(err.value)


def test_uniform_flattens_tables_for_ablations(tmp_path):
    out = tmp_path / "u.json"
    assert mhm.main(["--library", str(REPO / "content/manifest.json"), "--date", "2026-10-14",
                     "--uniform", "pattern,span", "--out", str(out)]) == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["pattern"]["R"]["L"] == pytest.approx(1 / 3)
    assert data["spanLeft"][0] == pytest.approx(1 / 25)
    assert data["provenance"]["uniform"] == ["pattern", "span"]
    assert data["moveLeft"][24] != pytest.approx(1 / 49)
```

Run: `research/.venv/Scripts/python.exe -m pytest research/tests/test_make_hand_motion.py -q`
Expected: FAIL (`ModuleNotFoundError: make_hand_motion`).

- [ ] **Step 2: Write the script**

`research/scripts/make_hand_motion.py`:

```python
#!/usr/bin/env python3
"""Fit the hand-motion tables used by the MIDI hand separation (packages/engine/src/io/midi).

Definition, shared with motionCounts in packages/engine/src/io/midi/motion.ts (motion.test.ts
checks that both count the library identically): group notes by onset; the first onset follows
pattern LR; at each onset count the transition from the previous onset's pattern (L, R or LR:
which hands play). For each hand that plays: centre = (lowest + highest) / 2; span = highest -
lowest, capped at 24; position = centre rounded half up, clamped to MIDI 21..108; and, when the
hand played before, move = (centre - previous centre) rounded half up, clamped to [-24, 24].
Probabilities: (count + 0.5) / (total + 0.5 * buckets), each pattern row separately.

Sources: the built-in library (content/manifest.json; staff 1 = right hand), the Mutopia train
half (channel = hand) and, for research only, the PIG train split. PIG statistics never go under
packages/ or apps/ (PIG licence: non-profit academic use; docs/PROGRESS.md "Standing findings").

Usage, from the repo root:
  research/.venv/Scripts/python.exe -I research/scripts/make_hand_motion.py \\
      --library content/manifest.json \\
      --mutopia research/data/mutopia_fingering --mutopia-split research/data/splits/mutopia_split.json \\
      --out packages/engine/src/io/midi/params/hand-motion.json
  research/.venv/Scripts/python.exe -I research/scripts/make_hand_motion.py \\
      --library content/manifest.json \\
      --pig research/data/pig --pig-split research/data/splits/pig_official.json \\
      --out research/weights/hand-motion-pig.json
"""
from __future__ import annotations

import argparse
import datetime as _dt
import glob
import hashlib
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path

MOVE_RANGE = 24
SPAN_CAP = 24
POSITION_MIN, POSITION_MAX = 21, 108
PATTERNS = ("L", "R", "LR")
TABLES = {
    "moveLeft": 2 * MOVE_RANGE + 1, "moveRight": 2 * MOVE_RANGE + 1,
    "spanLeft": SPAN_CAP + 1, "spanRight": SPAN_CAP + 1,
    "positionLeft": POSITION_MAX - POSITION_MIN + 1, "positionRight": POSITION_MAX - POSITION_MIN + 1,
}
KINDS = ("move", "span", "position", "pattern")
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
PIG_PITCH = re.compile(r"^([A-G])(#{1,2}|b{1,2})?(-?\d+)$")
REPO = Path(__file__).resolve().parents[2]
SHIPPED_ROOTS = (REPO / "packages", REPO / "apps")
HALF = Fraction(1, 2)


def empty_counts() -> dict:
    counts = {name: [0] * size for name, size in TABLES.items()}
    counts["pattern"] = {a: {b: 0 for b in PATTERNS} for a in PATTERNS}
    return counts


def add_counts(into: dict, other: dict) -> None:
    for name in TABLES:
        into[name] = [x + y for x, y in zip(into[name], other[name])]
    for a in PATTERNS:
        for b in PATTERNS:
            into["pattern"][a][b] += other["pattern"][a][b]


def motion_counts(notes) -> dict:
    """notes: iterable of (onset key, midi, hand). Same definition as motionCounts in motion.ts."""
    counts = empty_counts()
    slices: dict = {}
    for onset, midi, hand in notes:
        slices.setdefault(onset, []).append((midi, hand))
    previous = {"L": None, "R": None}
    previous_pattern = "LR"
    for onset in sorted(slices):
        by_hand = {h: [m for m, hh in slices[onset] if hh == h] for h in ("L", "R")}
        pattern = "LR" if by_hand["L"] and by_hand["R"] else ("L" if by_hand["L"] else "R")
        counts["pattern"][previous_pattern][pattern] += 1
        previous_pattern = pattern
        for hand, side in (("L", "Left"), ("R", "Right")):
            pitches = by_hand[hand]
            if not pitches:
                continue
            centre = Fraction(min(pitches) + max(pitches), 2)
            counts["span" + side][min(max(pitches) - min(pitches), SPAN_CAP)] += 1
            position = min(max(math.floor(centre + HALF), POSITION_MIN), POSITION_MAX)
            counts["position" + side][position - POSITION_MIN] += 1
            if previous[hand] is not None:
                move = min(max(math.floor(centre - previous[hand] + HALF), -MOVE_RANGE), MOVE_RANGE)
                counts["move" + side][move + MOVE_RANGE] += 1
            previous[hand] = centre
    return counts


def smooth(counts: dict, uniform: frozenset) -> dict:
    out: dict = {}
    for name in TABLES:
        xs = counts[name]
        kind = name.replace("Left", "").replace("Right", "")
        if kind in uniform:
            out[name] = [1 / len(xs)] * len(xs)
        else:
            total = sum(xs) + 0.5 * len(xs)
            out[name] = [(x + 0.5) / total for x in xs]
    out["pattern"] = {}
    for a in PATTERNS:
        row = counts["pattern"][a]
        if "pattern" in uniform:
            out["pattern"][a] = {b: 1 / len(PATTERNS) for b in PATTERNS}
        else:
            total = sum(row.values()) + 0.5 * len(PATTERNS)
            out["pattern"][a] = {b: (row[b] + 0.5) / total for b in PATTERNS}
    return out


def musicxml_notes(path: Path) -> list[tuple[Fraction, int, str]]:
    """(onset in quarter notes, midi, hand) of every sounding note, as parseMusicXml sees them:
    tie continuations are not onsets, grace notes sit at their principal's onset, and a second
    non-grace note with the same hand, onset and pitch is dropped."""
    root = ET.parse(path).getroot()
    if root.tag != "score-partwise":
        raise ValueError(f"{path}: not a partwise MusicXML score")
    raw = []
    lengths: dict[int, Fraction] = {}
    for part_index, part in enumerate(root.findall("part")):
        divisions = 1
        staves = 1
        open_ties: set[tuple[int, int]] = set()
        for m_index, measure in enumerate(part.findall("measure")):
            cursor = longest = chord_onset = Fraction(0)
            for el in measure:
                if el.tag == "attributes":
                    if el.findtext("divisions"):
                        divisions = int(el.findtext("divisions"))
                    if el.findtext("staves"):
                        staves = int(el.findtext("staves"))
                elif el.tag == "backup":
                    cursor -= Fraction(int(el.findtext("duration") or 0), divisions)
                elif el.tag == "forward":
                    cursor += Fraction(int(el.findtext("duration") or 0), divisions)
                    longest = max(longest, cursor)
                elif el.tag == "note":
                    is_chord = el.find("chord") is not None
                    is_grace = el.find("grace") is not None
                    duration = Fraction(0) if is_grace else Fraction(int(el.findtext("duration") or 0), divisions)
                    onset = chord_onset if is_chord else cursor
                    if not is_chord:
                        chord_onset = cursor
                        if not is_grace:
                            cursor += duration
                            longest = max(longest, cursor)
                    pitch = el.find("pitch")
                    if el.find("rest") is not None or el.find("cue") is not None or pitch is None:
                        continue
                    midi = ((int(pitch.findtext("octave") or 4) + 1) * 12 + STEP[pitch.findtext("step") or "C"]
                            + math.floor(float(pitch.findtext("alter") or 0) + 0.5))
                    staff = int(el.findtext("staff") or 1)
                    hand = ("R" if staff == 1 else "L") if staves >= 2 else ("R" if part_index == 0 else "L")
                    ties = [t.get("type") for t in el.findall("tie")]
                    tied = [t.get("type") for t in el.findall("notations/tied")]
                    stop = "stop" in ties or (not ties and "stop" in tied)
                    start = "start" in ties or (not ties and "start" in tied)
                    if stop and (staff, midi) in open_ties:
                        if not start:
                            open_ties.discard((staff, midi))
                        continue
                    raw.append((m_index, onset, midi, hand, is_grace))
                    if start:
                        open_ties.add((staff, midi))
            lengths[m_index] = max(lengths.get(m_index, Fraction(0)), longest)
    starts, at = {}, Fraction(0)
    for m_index in sorted(lengths):
        starts[m_index] = at
        at += lengths[m_index]
    notes, seen = [], set()
    for m_index, onset, midi, hand, is_grace in raw:
        absolute = starts[m_index] + onset
        if not is_grace:
            if (hand, absolute, midi) in seen:
                continue
            seen.add((hand, absolute, midi))
        notes.append((absolute, midi, hand))
    return notes


def pig_notes(path: Path) -> list[tuple[int, int, str]]:
    """(onset in microseconds, midi, hand) from a PIG-format file; channel 0 = right hand."""
    notes = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        cols = line.split()
        m = PIG_PITCH.match(cols[3])
        if m is None:
            raise ValueError(f"{path}: bad pitch {cols[3]!r}")
        acc = m.group(2) or ""
        midi = (int(m.group(3)) + 1) * 12 + STEP[m.group(1)] + (len(acc) if acc.startswith("#") else -len(acc))
        notes.append((round(float(cols[1]) * 1_000_000), midi, "R" if cols[6] == "0" else "L"))
    return notes


def library_files(manifest: Path) -> list[Path]:
    entries = json.loads(manifest.read_text(encoding="utf-8"))
    return [manifest.parent / e["files"]["score"] for e in entries]


def split_files(gold: Path, split: Path, subset: str = "train") -> list[Path]:
    """The first annotation file of every piece in the split's subset."""
    data = json.loads(split.read_text(encoding="utf-8"))
    pieces = data["splits"][data["default_split"]][subset]["pieces"]
    folder = gold / "FingeringFiles" if (gold / "FingeringFiles").is_dir() else gold
    files = []
    for piece in pieces:
        found = sorted(folder.glob(f"{glob.escape(piece)}-*_fingering.txt"))
        if not found:
            raise SystemExit(f"no fingering file for {piece} in {folder} (see research/data/README.md)")
        files.append(found[0])
    return files


def file_list_sha(files: list[Path]) -> str:
    names = sorted(f.resolve().relative_to(REPO).as_posix() for f in files)
    return hashlib.sha256("\n".join(names).encode("utf-8")).hexdigest()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Fit hand-motion.json for the MIDI hand separation.")
    ap.add_argument("--library", type=Path)
    ap.add_argument("--mutopia", type=Path)
    ap.add_argument("--mutopia-split", type=Path)
    ap.add_argument("--pig", type=Path)
    ap.add_argument("--pig-split", type=Path)
    ap.add_argument("--mu", type=float, default=5.0)
    ap.add_argument("--nu", type=float, default=0.5)
    ap.add_argument("--idle-sec", type=float, default=4.0)
    ap.add_argument("--uniform", default="", help="comma list of tables to flatten: move,span,position,pattern")
    ap.add_argument("--date", default=_dt.date.today().isoformat())
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)
    out = a.out.resolve()
    if a.pig is not None and any(root in out.parents for root in SHIPPED_ROOTS):
        raise SystemExit("PIG-derived statistics are research-only (PIG licence: non-profit academic use); "
                         "write them under research/weights/")
    uniform = sorted(x for x in a.uniform.split(",") if x)
    if set(uniform) - set(KINDS):
        raise SystemExit(f"--uniform: unknown table(s) {sorted(set(uniform) - set(KINDS))}")
    sources = []
    if a.library:
        sources.append(("library", library_files(a.library), musicxml_notes))
    if a.mutopia:
        if not a.mutopia_split:
            raise SystemExit("--mutopia needs --mutopia-split")
        sources.append(("mutopia-train", split_files(a.mutopia, a.mutopia_split), pig_notes))
    if a.pig:
        if not a.pig_split:
            raise SystemExit("--pig needs --pig-split")
        sources.append(("pig-train", split_files(a.pig, a.pig_split), pig_notes))
    if not sources:
        raise SystemExit("give at least one of --library, --mutopia, --pig")
    total, per_source, described, every_file = empty_counts(), {}, [], []
    for name, files, reader in sources:
        counts = empty_counts()
        for f in files:
            add_counts(counts, motion_counts(reader(f)))
        add_counts(total, counts)
        per_source[name] = counts
        described.append({"name": name, "files": len(files), "fileListSha256": file_list_sha(files)})
        every_file += files
    pig = any(name == "pig-train" for name, _, _ in sources)
    doc = {
        "version": 1,
        "provenance": {
            "script": "research/scripts/make_hand_motion.py",
            "date": a.date,
            "definition": "see the script docstring; shared with motionCounts in packages/engine/src/io/midi/motion.ts",
            "smoothing": "add 0.5 to every count, then normalise; each pattern row separately",
            "uniform": uniform,
            "sources": described,
            "fileListSha256": file_list_sha(every_file),
            "settings": "mu, nu and idleSec are hand-set defaults (M6 plan Task 2); docs/experiments.md records the sensitivity check",
            "licence": ("RESEARCH ONLY: includes PIG statistics (non-profit academic use)" if pig else
                        "statistics of the built-in library (CC0, public domain and CC BY-SA engravings) and the "
                        "Mutopia train half (public domain, CC BY and CC BY-SA engravings); no PIG data"),
        },
        "mu": a.mu,
        "nu": a.nu,
        "idleSec": a.idle_sec,
        **smooth(total, frozenset(uniform)),
        "counts": per_source,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {out}: " + ", ".join(f"{s['name']} {s['files']} files" for s in described))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Run the Python tests**

Run: `research/.venv/Scripts/python.exe -m pytest research/tests/test_make_hand_motion.py -q`
Expected: 5 passed.

- [ ] **Step 4: Generate the shipped tables**

Check first that `research/data/splits/mutopia_split.json` and `research/data/mutopia_fingering/FingeringFiles/` exist (M3 Task 2 and `research/data/README.md`); if not, stop and report. Then, from the repo root:

```bash
research/.venv/Scripts/python.exe -I research/scripts/make_hand_motion.py --library content/manifest.json --mutopia research/data/mutopia_fingering --mutopia-split research/data/splits/mutopia_split.json --out packages/engine/src/io/midi/params/hand-motion.json
pnpm exec prettier --write packages/engine/src/io/midi/params/hand-motion.json
```

Expected: `wrote …: library 30 files, mutopia-train N files` with N about 200 (the train half of the 286 usable parts). Record the printed line in your report.

- [ ] **Step 5: Write the failing TypeScript tests**

`packages/engine/src/io/midi/motion.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../musicxml/read.js';
import raw from './params/hand-motion.json' with { type: 'json' };
import {
  addCounts,
  chordCentre,
  emptyCounts,
  HAND_MOTION,
  loadHandMotion,
  motionCounts,
  moveIndex,
  positionIndex,
  scoreMotionCounts,
  spanIndex,
} from './motion.js';

const repo = new URL('../../../../../', import.meta.url);
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('content/manifest.json', repo)), 'utf8'),
) as Array<{ slug: string; files: { score: string } }>;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('hand-motion statistics', () => {
  it('rounds half up and clamps the same way as the Python script', () => {
    expect(chordCentre([60, 64, 67])).toBe(63.5);
    expect(moveIndex(-0.5)).toBe(24);
    expect(moveIndex(1.5)).toBe(26);
    expect(moveIndex(-1.5)).toBe(23);
    expect(moveIndex(-40)).toBe(0);
    expect(moveIndex(40)).toBe(48);
    expect(spanIndex(30)).toBe(24);
    expect(positionIndex(20)).toBe(0);
    expect(positionIndex(63.5)).toBe(43);
  });
  it('counts a small passage by the shared definition', () => {
    const c = motionCounts([
      { onset: 0, midi: 60, hand: 'R' },
      { onset: 0, midi: 64, hand: 'R' },
      { onset: 0, midi: 48, hand: 'L' },
      { onset: 1, midi: 62, hand: 'R' },
      { onset: 3, midi: 67, hand: 'R' },
      { onset: 3, midi: 43, hand: 'L' },
    ]);
    expect(c.moveRight[24]).toBe(1);
    expect(c.moveRight[29]).toBe(1);
    expect(c.moveLeft[19]).toBe(1);
    expect(c.spanRight[4]).toBe(1);
    expect(c.pattern).toEqual({
      L: { L: 0, R: 0, LR: 0 },
      R: { L: 0, R: 0, LR: 1 },
      LR: { L: 0, R: 1, LR: 1 },
    });
  });
  it('counts the 30 library pieces exactly as make_hand_motion.py recorded them', () => {
    const total = emptyCounts();
    for (const p of manifest) {
      const xml = readFileSync(fileURLToPath(new URL(`content/${p.files.score}`, repo)));
      addCounts(total, scoreMotionCounts(parseMusicXml(xml).score));
    }
    expect(total).toEqual(raw.counts.library);
  });
  it('ships normalised tables fitted without PIG data', () => {
    expect(HAND_MOTION.moveLeft).toHaveLength(49);
    expect(HAND_MOTION.spanRight).toHaveLength(25);
    expect(HAND_MOTION.positionRight).toHaveLength(88);
    for (const t of [
      HAND_MOTION.moveLeft,
      HAND_MOTION.moveRight,
      HAND_MOTION.spanLeft,
      HAND_MOTION.spanRight,
      HAND_MOTION.positionLeft,
      HAND_MOTION.positionRight,
    ])
      expect(sum(t)).toBeCloseTo(1, 9);
    for (const row of Object.values(HAND_MOTION.pattern))
      expect(sum(Object.values(row))).toBeCloseTo(1, 9);
    expect(raw.provenance.sources.map((s) => s.name)).toEqual(['library', 'mutopia-train']);
    expect(HAND_MOTION.moveRight[24]!).toBeGreaterThan(HAND_MOTION.moveRight[48]!);
    expect(HAND_MOTION.spanRight[0]!).toBeGreaterThan(HAND_MOTION.spanRight[24]!);
  });
  it('rejects malformed parameter files and names the field', () => {
    expect(() => loadHandMotion({ ...raw, moveLeft: [1] })).toThrow(/moveLeft/);
    expect(() => loadHandMotion({ ...raw, idleSec: 0 })).toThrow(/idleSec/);
    expect(() => loadHandMotion({ ...raw, pattern: { L: { L: 1 } } })).toThrow(/pattern/);
  });
});
```

Run: `pnpm --filter @digitus2/engine exec vitest run src/io/midi/motion`
Expected: FAIL (module not found).

- [ ] **Step 6: Implement**

`packages/engine/src/io/midi/motion.ts`:

```ts
import type { Hand, Score } from '../../score/types.js';
import handMotionJson from './params/hand-motion.json' with { type: 'json' };

export const MOVE_RANGE = 24;
export const SPAN_CAP = 24;
export const POSITION_MIN = 21;
export const POSITION_MAX = 108;
export type HandPattern = 'L' | 'R' | 'LR';
export const HAND_PATTERNS: readonly HandPattern[] = ['L', 'R', 'LR'];

export interface HandMotionTables {
  moveLeft: number[];
  moveRight: number[];
  spanLeft: number[];
  spanRight: number[];
  positionLeft: number[];
  positionRight: number[];
  pattern: Record<HandPattern, Record<HandPattern, number>>;
}
export type HandMotionCounts = HandMotionTables;
export interface HandMotionParams extends HandMotionTables {
  mu: number;
  nu: number;
  idleSec: number;
}

const TABLE_SIZES = {
  moveLeft: 2 * MOVE_RANGE + 1,
  moveRight: 2 * MOVE_RANGE + 1,
  spanLeft: SPAN_CAP + 1,
  spanRight: SPAN_CAP + 1,
  positionLeft: POSITION_MAX - POSITION_MIN + 1,
  positionRight: POSITION_MAX - POSITION_MIN + 1,
} as const;
type TableName = keyof typeof TABLE_SIZES;
const TABLE_NAMES = Object.keys(TABLE_SIZES) as TableName[];

function fail(field: string, why: string): never {
  throw new Error(`invalid hand-motion parameters: ${field} ${why}`);
}

function distribution(value: unknown, field: string, size: number): number[] {
  if (!Array.isArray(value) || value.length !== size) fail(field, `must have ${size} entries`);
  const xs = value as unknown[];
  if (!xs.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0))
    fail(field, 'must hold positive numbers');
  const total = (xs as number[]).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 1e-6) fail(field, `must sum to 1 (got ${total})`);
  return [...(xs as number[])];
}

export function loadHandMotion(raw: unknown): HandMotionParams {
  if (typeof raw !== 'object' || raw === null) fail('file', 'must be an object');
  const r = raw as Record<string, unknown>;
  const tables = {} as Record<TableName, number[]>;
  for (const name of TABLE_NAMES) tables[name] = distribution(r[name], name, TABLE_SIZES[name]);
  const p = r.pattern as Record<string, unknown> | undefined;
  if (typeof p !== 'object' || p === null) fail('pattern', 'must be an object');
  const pattern = {} as Record<HandPattern, Record<HandPattern, number>>;
  for (const a of HAND_PATTERNS) {
    const row = (p as Record<string, unknown>)[a] as Record<string, unknown> | undefined;
    if (typeof row !== 'object' || row === null) fail(`pattern.${a}`, 'must be an object');
    const values = distribution(
      HAND_PATTERNS.map((b) => (row as Record<string, unknown>)[b]),
      `pattern.${a}`,
      HAND_PATTERNS.length,
    );
    pattern[a] = { L: values[0]!, R: values[1]!, LR: values[2]! };
  }
  const number = (field: 'mu' | 'nu' | 'idleSec', min: number, strict: boolean) => {
    const v = r[field];
    if (typeof v !== 'number' || !Number.isFinite(v) || (strict ? v <= min : v < min))
      fail(field, strict ? `must be greater than ${min}` : `must be at least ${min}`);
    return v;
  };
  return {
    ...tables,
    pattern,
    mu: number('mu', 0, false),
    nu: number('nu', 0, false),
    idleSec: number('idleSec', 0, true),
  };
}

export const HAND_MOTION: HandMotionParams = loadHandMotion(handMotionJson);

export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}
export function chordCentre(pitches: readonly number[]): number {
  return (Math.min(...pitches) + Math.max(...pitches)) / 2;
}
export function moveIndex(delta: number): number {
  return Math.max(-MOVE_RANGE, Math.min(MOVE_RANGE, roundHalfUp(delta))) + MOVE_RANGE;
}
export function spanIndex(span: number): number {
  return Math.min(span, SPAN_CAP);
}
export function positionIndex(centre: number): number {
  return Math.max(POSITION_MIN, Math.min(POSITION_MAX, roundHalfUp(centre))) - POSITION_MIN;
}

export function emptyCounts(): HandMotionCounts {
  const tables = {} as Record<TableName, number[]>;
  for (const name of TABLE_NAMES) tables[name] = new Array<number>(TABLE_SIZES[name]).fill(0);
  return {
    ...tables,
    pattern: { L: { L: 0, R: 0, LR: 0 }, R: { L: 0, R: 0, LR: 0 }, LR: { L: 0, R: 0, LR: 0 } },
  };
}

export function addCounts(into: HandMotionCounts, from: HandMotionCounts): void {
  for (const name of TABLE_NAMES) into[name] = into[name].map((x, i) => x + (from[name][i] ?? 0));
  for (const a of HAND_PATTERNS)
    for (const b of HAND_PATTERNS) into.pattern[a][b] += from.pattern[a][b];
}

function bump(table: number[], index: number): void {
  table[index] = (table[index] ?? 0) + 1;
}

export function motionCounts(
  notes: ReadonlyArray<{ onset: number; midi: number; hand: Hand }>,
): HandMotionCounts {
  const counts = emptyCounts();
  const byOnset = new Map<number, Array<{ midi: number; hand: Hand }>>();
  for (const n of notes) {
    const list = byOnset.get(n.onset);
    if (list) list.push(n);
    else byOnset.set(n.onset, [n]);
  }
  const previous: Record<Hand, number | undefined> = { L: undefined, R: undefined };
  let previousPattern: HandPattern = 'LR';
  for (const onset of [...byOnset.keys()].sort((a, b) => a - b)) {
    const slice = byOnset.get(onset)!;
    const left = slice.filter((n) => n.hand === 'L').map((n) => n.midi);
    const right = slice.filter((n) => n.hand === 'R').map((n) => n.midi);
    const pattern: HandPattern = left.length && right.length ? 'LR' : left.length ? 'L' : 'R';
    counts.pattern[previousPattern][pattern]++;
    previousPattern = pattern;
    for (const [hand, pitches] of [
      ['L', left],
      ['R', right],
    ] as const) {
      if (pitches.length === 0) continue;
      const centre = chordCentre(pitches);
      bump(
        hand === 'L' ? counts.spanLeft : counts.spanRight,
        spanIndex(Math.max(...pitches) - Math.min(...pitches)),
      );
      bump(hand === 'L' ? counts.positionLeft : counts.positionRight, positionIndex(centre));
      const before = previous[hand];
      if (before !== undefined)
        bump(hand === 'L' ? counts.moveLeft : counts.moveRight, moveIndex(centre - before));
      previous[hand] = centre;
    }
  }
  return counts;
}

export function scoreMotionCounts(score: Score): HandMotionCounts {
  return motionCounts(score.notes.map((n) => ({ onset: n.onsetTick, midi: n.midi, hand: n.hand })));
}
```

- [ ] **Step 7: Run the tests and the checks**

Run: `pnpm --filter @digitus2/engine exec vitest run src/io/midi && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: all pass. If the library cross-check fails, print the first differing table and the piece whose counts differ (count piece by piece on both sides); the TypeScript reader is the reference, so fix `musicxml_notes` in the Python script, regenerate (step 4) and rerun both test files. Do not change `parseMusicXml`.

Run: `pnpm verify`
Expected: all PASS.

- [ ] **Step 8: Hand-off**

Paths: `research/scripts/make_hand_motion.py`, `research/tests/test_make_hand_motion.py`, `packages/engine/src/io/midi/params/hand-motion.json`, `packages/engine/src/io/midi/motion.ts`, `packages/engine/src/io/midi/motion.test.ts`. Message: `feat(engine): hand-motion statistics from the library and the Mutopia train half`.

---

### Task 3: Hand separation: the beam-searched pitch-trajectory DP and its evaluation

**Files:**

- Create: `packages/engine/src/io/midi/handSeparation.ts`, `packages/engine/src/io/midi/handSeparation.test.ts`, `packages/engine/src/eval/hands.ts`, `packages/engine/src/eval/hands.test.ts`

**Interfaces:**

- Consumes: `QuantizedNote`, `quantize` (Task 1); `HAND_MOTION`, `HandMotionParams`, `HandPattern`, `HAND_PATTERNS`, `moveIndex`, `spanIndex`, `positionIndex` (Task 2); `HAND_PROFILES`, `span` (M2 `fingering/spans.ts`); `MidiData` (Task 0); `Score`, `Hand` (M1); `parsePig`, `parseMusicXml` (M1).
- Produces:

```ts
// handSeparation.ts
export const MAX_NOTES_PER_HAND = 5;
export const SPAN_TOLERANCE = 2;
export const MAX_HAND_SPAN: number; // maxPrac(1, 5) of the 'large' profile + 2 = 17 semitones
export const BEAM_WIDTH = 64;
export const VIOLATION_PER_EXTRA_NOTE = 100;
export interface SeparateOptions {
  splitMidi?: number; // user override: midi < splitMidi -> 'L', otherwise 'R'; the DP is skipped
  params?: HandMotionParams; // default HAND_MOTION
}
export function splitViolation(pitches: readonly number[], split: number): number; // pitches ascending
export function candidateSplits(pitches: readonly number[]): number[]; // the least-violating splits 0..m
export function separateHands(notes: readonly QuantizedNote[], opts?: SeparateOptions): Hand[]; // aligned with notes

// eval/hands.ts
export function scoreToMidiData(score: Score): MidiData; // ppq = divisions, tempo map in microseconds, channel 0, track 0
export interface HandEval {
  notes: number;
  correct: number;
  accuracy: number; // percent 0..100
}
export function evaluateHands(score: Score, opts?: { params?: HandMotionParams }): HandEval;
```

The DP (decision 1): slices are the distinct quantized onsets; a slice's notes are sorted by pitch and a split `s` sends the lowest `s` to the left hand. Hard constraints: at most 5 notes and a span of at most 17 semitones per hand; when no split satisfies both, only the least-violating splits (violation = 100 per extra note + semitones beyond 17, summed over both hands) are allowed, and `midiToScore` reports the crowded chord (Task 4). State = (left centre, right centre, left top, right bottom, pattern), each centre and extreme `null` until that hand has played; the survivor of a merge keeps its last-played times. Transition cost, in nats: −log `pattern[previous][this]`; for each hand that plays: −log `position…[positionIndex(centre)]` for its first chord, else −log `move…[moveIndex(centre − previous centre)]`, plus −log `span…[spanIndex(top − bottom)]`; for each silent hand: +ν when it has not played for more than `idleSec`; +μ when the left hand's top is above the right hand's bottom. Beam: after each slice keep the 64 cheapest states, ordered by cost, then the state fields, then the predecessor index (deterministic). Back-track from the cheapest final state.

Evaluation: `scoreToMidiData` turns a staff- or channel-labelled score into MIDI-like data (PIG scores have 480 divisions and 120 quarter notes per minute, which is the brief's "ticks from onset seconds at 120 qpm, ppq 480"); `evaluateHands` quantizes it, separates the hands and counts, for every source note, whether its quantized note got its true hand.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/io/midi/handSeparation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Hand } from '../../score/types.js';
import {
  candidateSplits,
  MAX_HAND_SPAN,
  MAX_NOTES_PER_HAND,
  separateHands,
  splitViolation,
} from './handSeparation.js';
import type { QuantizedNote } from './quantize.js';

/** One note per [onset at 480 per quarter, midi], at 120 quarter notes per minute. */
function notes(spec: ReadonlyArray<readonly [number, number]>): QuantizedNote[] {
  return spec.map(([onset, midi], i) => ({
    onset,
    offset: onset + 240,
    onsetSec: onset / 960,
    midi,
    velocity: 80,
    channel: 0,
    track: 0,
    sources: [i],
  }));
}
const agree = (got: Hand[], want: Hand[]) => got.filter((h, i) => h === want[i]).length;
const switches = (hands: Hand[]) => hands.slice(1).filter((h, i) => h !== hands[i]).length;

describe('split constraints', () => {
  it('scores extra notes and over-wide hands', () => {
    expect(MAX_HAND_SPAN).toBe(17);
    expect(splitViolation([60, 62, 64, 65, 67, 69], 0)).toBe(100);
    expect(splitViolation([60, 62, 64, 65, 67, 69], 3)).toBe(0);
    expect(splitViolation([36, 60], 0)).toBe(7);
  });
  it('keeps only playable splits when there are any', () => {
    expect(candidateSplits([60, 62, 64, 65, 67, 69])).toEqual([1, 2, 3, 4, 5]);
    expect(candidateSplits([36, 60])).toEqual([1]);
    expect(candidateSplits([60])).toEqual([0, 1]);
  });
  it('falls back to the least-violating splits when none is playable', () => {
    expect(candidateSplits([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71])).toEqual([5, 6, 7]);
  });
});

describe('separateHands', () => {
  it('separates a melody from a low accompaniment played at the same time', () => {
    const melody = [72, 74, 76, 77, 79, 77, 76, 74, 72, 74, 76, 77];
    const spec: Array<[number, number]> = [];
    const truth: Hand[] = [];
    melody.forEach((m, i) => {
      spec.push([i * 240, m]);
      truth.push('R');
      if (i % 2 === 0) {
        spec.push([i * 240, 36], [i * 240, 43]);
        truth.push('L', 'L');
      }
    });
    expect(separateHands(notes(spec))).toEqual(truth);
  });
  it('keeps a single melody in the middle register in one hand instead of trading it between the hands', () => {
    const line = [60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65, 67, 65, 64, 62];
    const melody = [...line, ...line, ...line];
    const hands = separateHands(notes(melody.map((m, i) => [i * 240, m] as const)));
    expect(hands.filter((h) => h === 'R').length).toBeGreaterThanOrEqual(44);
    expect(switches(hands)).toBeLessThanOrEqual(2);
  });
  it('keeps two lines that converge to a whole tone and part again in their own hands', () => {
    const left = [48, 50, 52, 54, 56, 58, 60, 62, 60, 58, 56, 54, 52];
    const right = [76, 74, 72, 70, 68, 66, 64, 66, 68, 70, 72, 74, 76];
    const spec: Array<[number, number]> = [];
    const truth: Hand[] = [];
    left.forEach((l, k) => {
      spec.push([2 * k * 240, l], [(2 * k + 1) * 240, right[k]!]);
      truth.push('L', 'R');
    });
    expect(agree(separateHands(notes(spec)), truth)).toBeGreaterThanOrEqual(24);
  });
  it('never gives one hand more than five notes when a playable split exists', () => {
    const spec: Array<[number, number]> = [];
    for (let m = 6; m <= 10; m++)
      for (let j = 0; j < m; j++) spec.push([(m - 6) * 480, 48 + 3 * j]);
    const qn = notes(spec);
    const hands = separateHands(qn);
    for (let onset = 0; onset <= 4 * 480; onset += 480) {
      for (const hand of ['L', 'R'] as const) {
        const pitches = qn
          .filter((n, i) => n.onset === onset && hands[i] === hand)
          .map((n) => n.midi);
        expect(pitches.length).toBeLessThanOrEqual(MAX_NOTES_PER_HAND);
        if (pitches.length > 0)
          expect(Math.max(...pitches) - Math.min(...pitches)).toBeLessThanOrEqual(MAX_HAND_SPAN);
      }
    }
  });
  it('still answers when no split of a slice is playable', () => {
    const qn = notes([...Array(12).keys()].map((k) => [0, 60 + k] as const));
    const hands = separateHands(qn);
    expect(hands).toHaveLength(12);
    expect(hands.filter((h) => h === 'L').length).toBeGreaterThanOrEqual(5);
    expect(hands.filter((h) => h === 'R').length).toBeGreaterThanOrEqual(5);
  });
  it('applies a fixed split point without running the DP', () => {
    const qn = notes([
      [0, 59],
      [0, 60],
      [240, 72],
      [240, 40],
    ]);
    expect(separateHands(qn, { splitMidi: 60 })).toEqual(['L', 'R', 'R', 'L']);
  });
  it('is deterministic and does not depend on the input order', () => {
    const spec: Array<[number, number]> = [];
    for (let i = 0; i < 100; i++)
      spec.push([i * 240, 66 + ((i * 7) % 12)], [i * 240, 38 + ((i * 5) % 10)]);
    const forward = separateHands(notes(spec));
    expect(separateHands(notes(spec))).toEqual(forward);
    expect(separateHands([...notes(spec)].reverse())).toEqual([...forward].reverse());
  });
  it('separates 6000 notes in well under two seconds', () => {
    const spec: Array<[number, number]> = [];
    for (let i = 0; i < 4000; i++) {
      spec.push([i * 120, 60 + ((i * 7) % 19)]);
      if (i % 2 === 0) spec.push([i * 120, 36 + ((i * 5) % 17)]);
    }
    const t0 = performance.now();
    expect(separateHands(notes(spec))).toHaveLength(6000);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
```

`packages/engine/src/eval/hands.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../io/musicxml/read.js';
import { parsePig } from '../io/pig/read.js';
import { evaluateHands, scoreToMidiData } from './hands.js';

const repo = new URL('../../../../', import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, repo)));
const manifest = JSON.parse(read('content/manifest.json').toString('utf8')) as Array<{
  slug: string;
  files: { score: string };
}>;
const pigSample = () =>
  parsePig(read('packages/engine/fixtures/pig-sample.txt').toString('utf8')).score;

describe('evaluateHands', () => {
  it('turns a score into MIDI-like data with the score timing', () => {
    const score = pigSample();
    const data = scoreToMidiData(score);
    expect(data.ppq).toBe(score.divisions);
    expect(data.tempos).toEqual([{ tick: 0, usPerQuarter: 500_000 }]);
    expect(data.notes.map((n) => [n.tick, n.endTick, n.midi])).toEqual(
      score.notes.map((n) => [n.onsetTick, n.offsetTick, n.midi]),
    );
  });
  it('scores the PIG sample note by note', () => {
    const r = evaluateHands(pigSample());
    expect(r.notes).toBe(6);
    expect(r.correct).toBeGreaterThanOrEqual(4);
    expect(r.accuracy).toBeCloseTo((100 * r.correct) / 6, 9);
  });
  it('separates Twinkle with at most two notes in the wrong hand', () => {
    const r = evaluateHands(
      parseMusicXml(read('content/scores/twinkle-twinkle-little-star.musicxml')).score,
    );
    expect(r.notes).toBe(64);
    expect(r.correct).toBeGreaterThanOrEqual(62);
  });
  it('reaches at least 85 percent on the built-in library (macro average over 30 simple textures)', () => {
    const rows = manifest.map((p) => ({
      slug: p.slug,
      ...evaluateHands(parseMusicXml(read(`content/${p.files.score}`)).score),
    }));
    const macro = rows.reduce((s, r) => s + r.accuracy, 0) / rows.length;
    expect(
      macro,
      rows.map((r) => `${r.slug} ${r.accuracy.toFixed(1)}`).join('\n'),
    ).toBeGreaterThanOrEqual(85);
  }, 60_000);
});
```

(The library is part of the fitting data, so this gate is in-sample; it catches a broken DP, not overfitting. The out-of-sample numbers are PIG test and Mutopia test in Task 9. The spike in decision 1 measured 91.9 out-of-sample on these pieces and 64 of 64 on Twinkle; the tests leave slack so a refit of the tables cannot break them.)

Run: `pnpm --filter @digitus2/engine exec vitest run src/io/midi/handSeparation src/eval/hands`
Expected: FAIL (modules not found).

- [ ] **Step 2: Implement the DP**

`packages/engine/src/io/midi/handSeparation.ts`:

```ts
import { HAND_PROFILES, span } from '../../fingering/spans.js';
import type { Hand } from '../../score/types.js';
import {
  HAND_MOTION,
  HAND_PATTERNS,
  moveIndex,
  positionIndex,
  spanIndex,
  type HandMotionParams,
  type HandPattern,
} from './motion.js';
import type { QuantizedNote } from './quantize.js';

export const MAX_NOTES_PER_HAND = 5;
export const SPAN_TOLERANCE = 2;
export const MAX_HAND_SPAN = span(HAND_PROFILES.large.tables, 'maxPrac', 1, 5) + SPAN_TOLERANCE;
export const BEAM_WIDTH = 64;
export const VIOLATION_PER_EXTRA_NOTE = 100;

export interface SeparateOptions {
  splitMidi?: number;
  params?: HandMotionParams;
}

interface HandShape {
  centre: number;
  top: number;
  bottom: number;
  span: number;
}
interface Candidate {
  split: number;
  pattern: HandPattern;
  left: HandShape | null;
  right: HandShape | null;
}
interface State {
  cost: number;
  l: number | null;
  r: number | null;
  lTop: number | null;
  rBottom: number | null;
  lastL: number;
  lastR: number;
  pattern: HandPattern;
  prev: number;
  split: number;
}

export function splitViolation(pitches: readonly number[], split: number): number {
  const part = (xs: readonly number[]) =>
    xs.length === 0
      ? 0
      : Math.max(0, xs.length - MAX_NOTES_PER_HAND) * VIOLATION_PER_EXTRA_NOTE +
        Math.max(0, xs[xs.length - 1]! - xs[0]! - MAX_HAND_SPAN);
  return part(pitches.slice(0, split)) + part(pitches.slice(split));
}

export function candidateSplits(pitches: readonly number[]): number[] {
  const all = Array.from({ length: pitches.length + 1 }, (_, s) => ({
    s,
    v: splitViolation(pitches, s),
  }));
  const best = Math.min(...all.map((a) => a.v));
  return all.filter((a) => a.v === best).map((a) => a.s);
}

function shapeOf(pitches: readonly number[]): HandShape | null {
  if (pitches.length === 0) return null;
  const bottom = pitches[0]!;
  const top = pitches[pitches.length - 1]!;
  return { centre: (bottom + top) / 2, top, bottom, span: top - bottom };
}

function candidate(pitches: readonly number[], split: number): Candidate {
  const m = pitches.length;
  return {
    split,
    pattern: split === m ? 'L' : split === 0 ? 'R' : 'LR',
    left: shapeOf(pitches.slice(0, split)),
    right: shapeOf(pitches.slice(split)),
  };
}

function step(P: HandMotionParams, st: State, c: Candidate, t: number): State {
  let cost = st.cost - Math.log(P.pattern[st.pattern][c.pattern]);
  let l = st.l;
  let r = st.r;
  let lTop = st.lTop;
  let rBottom = st.rBottom;
  let lastL = st.lastL;
  let lastR = st.lastR;
  if (c.left) {
    cost -= Math.log(
      l === null
        ? P.positionLeft[positionIndex(c.left.centre)]!
        : P.moveLeft[moveIndex(c.left.centre - l)]!,
    );
    cost -= Math.log(P.spanLeft[spanIndex(c.left.span)]!);
    l = c.left.centre;
    lTop = c.left.top;
    lastL = t;
  } else if (t - lastL > P.idleSec) cost += P.nu;
  if (c.right) {
    cost -= Math.log(
      r === null
        ? P.positionRight[positionIndex(c.right.centre)]!
        : P.moveRight[moveIndex(c.right.centre - r)]!,
    );
    cost -= Math.log(P.spanRight[spanIndex(c.right.span)]!);
    r = c.right.centre;
    rBottom = c.right.bottom;
    lastR = t;
  } else if (t - lastR > P.idleSec) cost += P.nu;
  if (lTop !== null && rBottom !== null && lTop > rBottom) cost += P.mu;
  return { cost, l, r, lTop, rBottom, lastL, lastR, pattern: c.pattern, prev: -1, split: c.split };
}

const orNull = (x: number | null) => (x === null ? -1 : x);
function compareStates(a: State, b: State): number {
  return (
    a.cost - b.cost ||
    orNull(a.l) - orNull(b.l) ||
    orNull(a.r) - orNull(b.r) ||
    orNull(a.lTop) - orNull(b.lTop) ||
    orNull(a.rBottom) - orNull(b.rBottom) ||
    HAND_PATTERNS.indexOf(a.pattern) - HAND_PATTERNS.indexOf(b.pattern) ||
    a.prev - b.prev ||
    a.split - b.split
  );
}

export function separateHands(notes: readonly QuantizedNote[], opts: SeparateOptions = {}): Hand[] {
  if (opts.splitMidi !== undefined) {
    const split = opts.splitMidi;
    return notes.map((n) => (n.midi < split ? 'L' : 'R'));
  }
  const P = opts.params ?? HAND_MOTION;
  const hands: Hand[] = notes.map(() => 'R');
  if (notes.length === 0) return hands;
  const order = notes
    .map((_, i) => i)
    .sort((a, b) => notes[a]!.onset - notes[b]!.onset || notes[a]!.midi - notes[b]!.midi || a - b);
  const slices: number[][] = [];
  for (const i of order) {
    const last = slices[slices.length - 1];
    if (last && notes[last[0]!]!.onset === notes[i]!.onset) last.push(i);
    else slices.push([i]);
  }
  const t0 = notes[slices[0]![0]!]!.onsetSec;
  let beam: State[] = [
    {
      cost: 0,
      l: null,
      r: null,
      lTop: null,
      rBottom: null,
      lastL: t0,
      lastR: t0,
      pattern: 'LR',
      prev: -1,
      split: -1,
    },
  ];
  const history: State[][] = [];
  for (const slice of slices) {
    const pitches = slice.map((i) => notes[i]!.midi);
    const t = notes[slice[0]!]!.onsetSec;
    const candidates = candidateSplits(pitches).map((s) => candidate(pitches, s));
    const next = new Map<string, State>();
    beam.forEach((st, index) => {
      for (const c of candidates) {
        const s = step(P, st, c, t);
        s.prev = index;
        const key = `${s.l}|${s.r}|${s.lTop}|${s.rBottom}|${s.pattern}`;
        const old = next.get(key);
        if (!old || compareStates(s, old) < 0) next.set(key, s);
      }
    });
    beam = [...next.values()].sort(compareStates).slice(0, BEAM_WIDTH);
    history.push(beam);
  }
  let k = 0;
  for (let si = slices.length - 1; si >= 0; si--) {
    const st = history[si]![k]!;
    slices[si]!.forEach((noteIndex, j) => {
      hands[noteIndex] = j < st.split ? 'L' : 'R';
    });
    k = st.prev;
  }
  return hands;
}
```

- [ ] **Step 3: Implement the evaluation helpers**

`packages/engine/src/eval/hands.ts`:

```ts
import { separateHands } from '../io/midi/handSeparation.js';
import type { HandMotionParams } from '../io/midi/motion.js';
import { quantize } from '../io/midi/quantize.js';
import type { MidiData } from '../io/midi/read.js';
import type { Score } from '../score/types.js';

export function scoreToMidiData(score: Score): MidiData {
  return {
    ppq: score.divisions,
    tempos: score.tempoMap.map((t) => ({ tick: t.tick, usPerQuarter: Math.round(60e6 / t.qpm) })),
    timeSignatures:
      score.timeSignatures.length > 0
        ? score.timeSignatures.map((t) => ({ tick: t.tick, beats: t.beats, beatType: t.beatType }))
        : [{ tick: 0, beats: 4, beatType: 4 }],
    notes: score.notes.map((n) => ({
      tick: n.onsetTick,
      endTick: n.offsetTick,
      midi: n.midi,
      velocity: n.velocity ?? 64,
      channel: 0,
      track: 0,
    })),
    warnings: [],
  };
}

export interface HandEval {
  notes: number;
  correct: number;
  accuracy: number;
}

export function evaluateHands(score: Score, opts: { params?: HandMotionParams } = {}): HandEval {
  const quantized = quantize(scoreToMidiData(score));
  const hands = separateHands(quantized.notes, opts.params ? { params: opts.params } : {});
  let correct = 0;
  quantized.notes.forEach((n, i) => {
    for (const s of n.sources) if (score.notes[s]!.hand === hands[i]) correct++;
  });
  const total = score.notes.length;
  return { notes: total, correct, accuracy: total === 0 ? 0 : (100 * correct) / total };
}
```

- [ ] **Step 4: Run the tests and the checks**

Run: `pnpm --filter @digitus2/engine exec vitest run src/io/midi src/eval/hands && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: all pass. Report the library macro accuracy and the three weakest pieces (put a temporary `console.log` of `rows` in your working copy, or read the assertion message after temporarily raising the threshold; remove either before the hand-off). If the macro is below 85, do not lower the gate: check the cost signs (each table term is `-Math.log(p)`, positive), the split direction (lowest `s` notes to the left hand) and the back-tracking (`k = st.prev`), then report.

Run: `pnpm verify`
Expected: all PASS.

- [ ] **Step 5: Hand-off**

Paths: `packages/engine/src/io/midi/handSeparation.ts`, `packages/engine/src/io/midi/handSeparation.test.ts`, `packages/engine/src/eval/hands.ts`, `packages/engine/src/eval/hands.test.ts`. Message: `feat(engine): MIDI hand separation by beam-searched pitch-trajectory DP`.

---

### Task 4: Key estimate, spelling, and the Score built from MIDI

**Files:**

- Create: `packages/engine/src/io/midi/key.ts`, `packages/engine/src/io/midi/key.test.ts`, `packages/engine/src/io/midi/toScore.ts`, `packages/engine/src/io/midi/toScore.test.ts`

**Interfaces:**

- Consumes: `MidiData`, `parseMidiFile` (Task 0); `QuantizedNotes`, `quantize` (Task 1); `MAX_NOTES_PER_HAND`, `MAX_HAND_SPAN` (Task 3); `count` (Task 0); `finalizeScore`, `validateScore`, `Spelling`, `Step`, `Alter`, `formatPigPitch` and the score types (M1).
- Produces:

```ts
// key.ts
export const KK_MAJOR: readonly number[]; // Krumhansl-Kessler 1982 major profile, tonic first
export const KK_MINOR: readonly number[];
export interface KeyEstimate {
  tonic: number; // pitch class 0..11
  mode: 'major' | 'minor';
  fifths: number; // key signature: sharps > 0, flats < 0
  correlation: number;
}
export function keyFifths(tonic: number, mode: 'major' | 'minor'): number;
export function estimateKey(notes: ReadonlyArray<{ midi: number; duration: number }>): KeyEstimate;
export function spellMidi(
  midi: number,
  key: { fifths: number; mode?: 'major' | 'minor' },
): Spelling;
export function keyName(key: { fifths: number; mode?: 'major' | 'minor' }): string; // 'E-flat major', 'F-sharp minor'

// toScore.ts
export const TEMPO_SNAP_TICKS = 60; // tempo changes move to the nearest 32nd note so the engraver can place them
export const MAX_CROWDED_WARNINGS = 5;
export interface MidiToScoreOptions {
  title?: string;
  composer?: string;
  source?: string;
}
export function midiToScore(
  data: MidiData,
  quantized: QuantizedNotes,
  hands: readonly Hand[], // aligned with quantized.notes
  opts?: MidiToScoreOptions,
): { score: Score; warnings: string[] };
```

Key estimate (Krumhansl–Schmuckler): sum note durations (quarter notes) per pitch class, correlate with the 24 rotated profiles (Pearson), keep the first best in the order tonic 0..11, major before minor; no notes gives C major. Key signatures: major tonic pitch class → fifths `[0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]`; a minor key uses its relative major.

Spelling (the brief: sharps for keys with zero or more fifths, flats otherwise; chromatic notes spelled toward the key): place each pitch class on the line of fifths (C = 0, G = 1, …, F = −1, B-flat = −2). A key with `f` fifths owns positions `f − 1 … f + 5`, plus `f + 6` and `f + 8` (the raised sixth and seventh) in minor. A candidate inside that set wins; otherwise the candidate nearest to it wins, and a tie goes to the sharp side when `f ≥ 0` and to the flat side otherwise. In C major this gives C#, E-flat, F#, G#, B-flat; in D minor the leading tone is C#.

`midiToScore` rules: divisions = `quantized.divisions` (480); tempo map from the file with each change snapped to the nearest multiple of 60 ticks (a 32nd note), later events at the same tick replacing earlier ones; measures start at tick 0 and follow the time signatures (a change inside a measure takes effect at the next barline, with a warning) until they cover the last offset; key = the file's key signature, else the estimate; notes sorted by onset, then right hand before left, then pitch, with ids `m0, m1, …`; staff 1 and voice 1 for the right hand, staff 2 and voice 5 for the left; `velocity` kept; `isGrace` false; `sourceIndices` empty (`importMidi` fills them from the engraved document, Task 6). One voice per hand: the notes of one hand that start together end together, at the latest of their ends, cut back to that hand's next onset. Warnings (exact): `N note(s) was/were shortened so each hand has one voice` (`1 note was shortened …`, `3 notes were shortened …`), `N time signature change(s) moved to the next barline`, and for at most five crowded chords `measure M: K notes in the right hand at one time` or `measure M: the left hand spans S semitones at one time`, then `and N more crowded chord(s)`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/io/midi/key.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatPigPitch } from '../../score/pitch.js';
import { estimateKey, keyFifths, keyName, spellMidi } from './key.js';

const notes = (spec: Array<[number, number]>) =>
  spec.map(([midi, duration]) => ({ midi, duration }));
const spell = (midi: number, fifths: number, mode?: 'major' | 'minor') =>
  formatPigPitch(spellMidi(midi, mode ? { fifths, mode } : { fifths }));

describe('estimateKey', () => {
  it('finds C major', () => {
    const k = estimateKey(
      notes([
        [60, 4],
        [64, 2],
        [67, 2],
        [48, 4],
        [55, 2],
        [65, 1],
        [62, 1],
        [59, 1],
        [69, 1],
        [72, 2],
      ]),
    );
    expect(k).toMatchObject({ tonic: 0, mode: 'major', fifths: 0 });
  });
  it('finds A minor', () => {
    const k = estimateKey(
      notes([
        [57, 4],
        [60, 2],
        [64, 2],
        [45, 4],
        [56, 1],
        [59, 1],
        [62, 1],
        [65, 1],
        [69, 2],
      ]),
    );
    expect(k).toMatchObject({ tonic: 9, mode: 'minor', fifths: 0 });
  });
  it('finds E-flat major', () => {
    const k = estimateKey(
      notes([
        [63, 4],
        [67, 2],
        [70, 2],
        [51, 4],
        [68, 1],
        [65, 1],
        [62, 1],
        [60, 1],
        [75, 2],
      ]),
    );
    expect(k).toMatchObject({ tonic: 3, mode: 'major', fifths: -3 });
  });
  it('falls back to C major without notes', () => {
    expect(estimateKey([])).toMatchObject({ tonic: 0, mode: 'major', fifths: 0 });
  });
  it('maps tonics to key signatures', () => {
    expect(keyFifths(7, 'major')).toBe(1);
    expect(keyFifths(1, 'major')).toBe(-5);
    expect(keyFifths(4, 'minor')).toBe(1);
    expect(keyFifths(0, 'minor')).toBe(-3);
  });
});

describe('spellMidi and keyName', () => {
  it('spells chromatic notes in C major toward the key, ties going to sharps', () => {
    expect([61, 63, 66, 68, 70].map((m) => spell(m, 0))).toEqual([
      'C#4',
      'Eb4',
      'F#4',
      'G#4',
      'Bb4',
    ]);
  });
  it('raises the sixth and seventh degrees in minor keys', () => {
    expect(spell(68, 0, 'minor')).toBe('G#4');
    expect(spell(61, -1, 'minor')).toBe('C#4');
    expect(spell(66, -2, 'minor')).toBe('F#4');
    expect(spell(64, -2, 'minor')).toBe('E4');
  });
  it('uses the letters of flat and sharp keys, including B-sharp, E-sharp and C-flat', () => {
    expect([63, 68, 70, 66].map((m) => spell(m, -3))).toEqual(['Eb4', 'Ab4', 'Bb4', 'Gb4']);
    expect(spell(60, 7)).toBe('B#3');
    expect(spell(65, 6)).toBe('E#4');
    expect(spell(71, -6)).toBe('Cb5');
  });
  it('names keys', () => {
    expect(keyName({ fifths: 0, mode: 'major' })).toBe('C major');
    expect(keyName({ fifths: 0, mode: 'minor' })).toBe('A minor');
    expect(keyName({ fifths: -3 })).toBe('E-flat major');
    expect(keyName({ fifths: 3, mode: 'minor' })).toBe('F-sharp minor');
  });
});
```

`packages/engine/src/io/midi/toScore.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatPigPitch } from '../../score/pitch.js';
import type { Hand } from '../../score/types.js';
import { quantize } from './quantize.js';
import { parseMidiFile, type MidiData } from './read.js';
import { midiToScore } from './toScore.js';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url))),
  );

function data(notes: Array<[number, number, number]>, extra: Partial<MidiData> = {}): MidiData {
  return {
    ppq: 480,
    tempos: [{ tick: 0, usPerQuarter: 500_000 }],
    timeSignatures: [{ tick: 0, beats: 4, beatType: 4 }],
    notes: notes.map(([tick, endTick, midi]) => ({
      tick,
      endTick,
      midi,
      velocity: 70,
      channel: 0,
      track: 0,
    })),
    warnings: [],
    ...extra,
  };
}
/** Hands by pitch (below 54 = left), so these tests do not depend on the separation DP. */
function build(d: MidiData) {
  const q = quantize(d);
  return midiToScore(
    d,
    q,
    q.notes.map((n) => (n.midi < 54 ? 'L' : 'R')),
    { title: 'test' },
  );
}

describe('midiToScore', () => {
  it('builds Twinkle from the MIDI fixture: 64 notes, 12 measures, the file key and tempo, one voice per hand', () => {
    const d = parseMidiFile(fixture('twinkle.mid'));
    const q = quantize(d);
    const truth: Hand[] = q.notes.map((n) => (d.notes[n.sources[0]!]!.track === 1 ? 'R' : 'L'));
    const { score, warnings } = midiToScore(d, q, truth, { title: 'twinkle' });
    expect(score.notes).toHaveLength(64);
    expect(score.divisions).toBe(480);
    expect(score.measures).toHaveLength(12);
    expect(score.measures.every((m) => m.lengthTicks === 1920)).toBe(true);
    expect(score.timeSignatures).toEqual([{ tick: 0, beats: 4, beatType: 4 }]);
    expect(score.keySignatures).toEqual([{ tick: 0, fifths: 0, mode: 'major' }]);
    expect(score.tempoMap).toEqual([{ tick: 0, qpm: 100 }]);
    expect(score.notes.map((n) => n.id)).toEqual(score.notes.map((_, i) => `m${i}`));
    expect(score.notes.filter((n) => n.hand === 'R').map((n) => [n.staff, n.voice])).toEqual(
      Array(42).fill([1, 1]),
    );
    expect(score.notes.filter((n) => n.hand === 'L').map((n) => [n.staff, n.voice])).toEqual(
      Array(22).fill([2, 5]),
    );
    expect(score.notes[score.notes.length - 1]!.offsetSec).toBeCloseTo(28.8, 9);
    expect(score.notes.every((n) => n.velocity === 80 && !n.isGrace)).toBe(true);
    expect(score.meta.title).toBe('twinkle');
    expect(warnings).toEqual([]);
  });
  it("shortens a held note of one hand at that hand's next onset and says so", () => {
    const { score, warnings } = build(
      data([
        [0, 1920, 48],
        [960, 1440, 52],
        [0, 480, 72],
      ]),
    );
    expect(score.notes.map((n) => [n.hand, n.midi, n.onsetTick, n.offsetTick])).toEqual([
      ['R', 72, 0, 480],
      ['L', 48, 0, 960],
      ['L', 52, 960, 1440],
    ]);
    expect(warnings).toEqual(['1 note was shortened so each hand has one voice']);
  });
  it('gives the notes of one hand that start together one common end', () => {
    const { score, warnings } = build(
      data([
        [0, 1920, 43],
        [0, 480, 50],
        [960, 1920, 47],
      ]),
    );
    expect(score.notes.map((n) => [n.midi, n.offsetTick])).toEqual([
      [43, 960],
      [50, 960],
      [47, 1920],
    ]);
    expect(warnings).toEqual(['1 note was shortened so each hand has one voice']);
  });
  it('warns about six notes in one hand at one time', () => {
    const { warnings } = build(
      data([60, 62, 64, 65, 67, 69].map((m) => [0, 480, m] as [number, number, number])),
    );
    expect(warnings).toEqual(['measure 1: 6 notes in the right hand at one time']);
  });
  it('warns about a hand stretched beyond 17 semitones', () => {
    const { warnings } = build(
      data([
        [0, 480, 60],
        [0, 480, 79],
      ]),
    );
    expect(warnings).toEqual(['measure 1: the right hand spans 19 semitones at one time']);
  });
  it('estimates the key when the file has none and spells with it', () => {
    const q = 480;
    const { score } = build(
      data([
        [0, 4 * q, 57],
        [4 * q, 6 * q, 60],
        [6 * q, 8 * q, 64],
        [8 * q, 9 * q, 56],
        [9 * q, 10 * q, 59],
        [10 * q, 11 * q, 62],
        [11 * q, 12 * q, 65],
        [12 * q, 14 * q, 69],
        [0, 4 * q, 45],
      ]),
    );
    expect(score.keySignatures).toEqual([{ tick: 0, fifths: 0, mode: 'minor' }]);
    expect(formatPigPitch(score.notes.find((n) => n.midi === 56)!.spelling)).toBe('G#3');
  });
  it('uses the key signature of the file when there is one', () => {
    const { score } = build(
      data(
        [
          [0, 480, 63],
          [480, 960, 68],
        ],
        { keySignature: { fifths: -3, mode: 'major' } },
      ),
    );
    expect(score.keySignatures).toEqual([{ tick: 0, fifths: -3, mode: 'major' }]);
    expect(score.notes.map((n) => formatPigPitch(n.spelling))).toEqual(['Eb4', 'Ab4']);
  });
  it('moves a time signature change that falls inside a measure to the next barline', () => {
    const { score, warnings } = build(
      data(
        [
          [0, 480, 60],
          [4800, 5280, 62],
        ],
        {
          timeSignatures: [
            { tick: 0, beats: 4, beatType: 4 },
            { tick: 2400, beats: 3, beatType: 4 },
          ],
        },
      ),
    );
    expect(score.measures.map((m) => [m.startTick, m.lengthTicks])).toEqual([
      [0, 1920],
      [1920, 1920],
      [3840, 1440],
    ]);
    expect(score.timeSignatures).toEqual([
      { tick: 0, beats: 4, beatType: 4 },
      { tick: 3840, beats: 3, beatType: 4 },
    ]);
    expect(warnings).toEqual(['1 time signature change moved to the next barline']);
  });
  it('snaps tempo changes to the nearest 32nd note and keeps the seconds of the tempo map', () => {
    const { score } = build(
      data(
        [
          [0, 480, 60],
          [960, 1440, 62],
        ],
        {
          tempos: [
            { tick: 0, usPerQuarter: 500_000 },
            { tick: 470, usPerQuarter: 1_000_000 },
          ],
        },
      ),
    );
    expect(score.tempoMap).toEqual([
      { tick: 0, qpm: 120 },
      { tick: 480, qpm: 60 },
    ]);
    expect(score.notes[1]!.onsetSec).toBeCloseTo(1.5, 9);
  });
  it('covers the last note with whole measures that start at tick 0', () => {
    const { score } = build(data([[960, 2000, 60]]));
    expect(score.measures.map((m) => m.startTick)).toEqual([0, 1920]);
    expect(score.notes[0]!.measureIndex).toBe(0);
    expect(score.notes[0]!.offsetTick).toBe(2040);
  });
});
```

Run: `pnpm --filter @digitus2/engine exec vitest run src/io/midi/key src/io/midi/toScore`
Expected: FAIL (modules not found).

- [ ] **Step 2: Implement the key estimate and spelling**

`packages/engine/src/io/midi/key.ts`:

```ts
import type { Alter, Spelling, Step } from '../../score/pitch.js';

export const KK_MAJOR: readonly number[] = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
export const KK_MINOR: readonly number[] = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
const LINE_OF_FIFTHS: readonly Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const STEP_SEMITONE: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_NAMES = [
  'C-flat',
  'G-flat',
  'D-flat',
  'A-flat',
  'E-flat',
  'B-flat',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F-sharp',
  'C-sharp',
];
const MINOR_NAMES = [
  'A-flat',
  'E-flat',
  'B-flat',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F-sharp',
  'C-sharp',
  'G-sharp',
  'D-sharp',
  'A-sharp',
];

export interface KeyEstimate {
  tonic: number;
  mode: 'major' | 'minor';
  fifths: number;
  correlation: number;
}

const pitchClass = (m: number) => ((m % 12) + 12) % 12;

export function keyFifths(tonic: number, mode: 'major' | 'minor'): number {
  return MAJOR_FIFTHS[pitchClass(mode === 'minor' ? tonic + 3 : tonic)]!;
}

function pearson(x: readonly number[], y: readonly number[]): number {
  const mean = (v: readonly number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

export function estimateKey(notes: ReadonlyArray<{ midi: number; duration: number }>): KeyEstimate {
  const weights = new Array<number>(12).fill(0);
  for (const n of notes) weights[pitchClass(n.midi)] = weights[pitchClass(n.midi)]! + n.duration;
  let best: KeyEstimate | undefined;
  for (let tonic = 0; tonic < 12; tonic++)
    for (const mode of ['major', 'minor'] as const) {
      const profile = mode === 'major' ? KK_MAJOR : KK_MINOR;
      const r = pearson(
        weights,
        weights.map((_, p) => profile[pitchClass(p - tonic)]!),
      );
      if (!best || r > best.correlation)
        best = { tonic, mode, fifths: keyFifths(tonic, mode), correlation: r };
    }
  return best!;
}

export function spellMidi(
  midi: number,
  key: { fifths: number; mode?: 'major' | 'minor' },
): Spelling {
  const f = key.fifths;
  const lo = f - 1;
  const hi = f + 5;
  const q0 = (7 * pitchClass(midi)) % 12;
  const candidates = [q0 - 12, q0, q0 + 12].filter((q) => q >= -15 && q <= 19);
  const inKey = (q: number) =>
    (q >= lo && q <= hi) || (key.mode === 'minor' && (q === f + 6 || q === f + 8));
  const distance = (q: number) => (q < lo ? lo - q : q > hi ? q - hi : 0);
  const q =
    candidates.find(inKey) ??
    [...candidates].sort((a, b) => distance(a) - distance(b) || (f >= 0 ? b - a : a - b))[0]!;
  const step = LINE_OF_FIFTHS[(((q + 1) % 7) + 7) % 7]!;
  const alter = Math.floor((q + 1) / 7);
  return { step, alter: alter as Alter, octave: (midi - alter - STEP_SEMITONE[step]) / 12 - 1 };
}

export function keyName(key: { fifths: number; mode?: 'major' | 'minor' }): string {
  const minor = key.mode === 'minor';
  const name = (minor ? MINOR_NAMES : MAJOR_NAMES)[key.fifths + 7];
  return name ? `${name} ${minor ? 'minor' : 'major'}` : `${key.fifths} fifths`;
}
```

- [ ] **Step 3: Implement `midiToScore`**

`packages/engine/src/io/midi/toScore.ts`:

```ts
import { finalizeScore, validateScore } from '../../score/build.js';
import type {
  Hand,
  KeySigEvent,
  MeasureInfo,
  Note,
  Score,
  TempoEvent,
  TimeSigEvent,
} from '../../score/types.js';
import { MAX_HAND_SPAN, MAX_NOTES_PER_HAND } from './handSeparation.js';
import { estimateKey, spellMidi } from './key.js';
import { count } from './plural.js';
import type { QuantizedNotes } from './quantize.js';
import type { MidiData } from './read.js';

export const TEMPO_SNAP_TICKS = 60;
export const MAX_CROWDED_WARNINGS = 5;
export interface MidiToScoreOptions {
  title?: string;
  composer?: string;
  source?: string;
}

interface Draft {
  onset: number;
  offset: number;
  midi: number;
  hand: Hand;
  velocity: number;
}

export function midiToScore(
  data: MidiData,
  quantized: QuantizedNotes,
  hands: readonly Hand[],
  opts: MidiToScoreOptions = {},
): { score: Score; warnings: string[] } {
  if (hands.length !== quantized.notes.length)
    throw new Error(`midiToScore: ${hands.length} hands for ${quantized.notes.length} notes`);
  const D = quantized.divisions;
  const scale = D / data.ppq;
  const warnings: string[] = [];

  const tempoMap: TempoEvent[] = [];
  for (const t of data.tempos) {
    const tick = Math.round((t.tick * scale) / TEMPO_SNAP_TICKS) * TEMPO_SNAP_TICKS;
    const qpm = 60e6 / t.usPerQuarter;
    const last = tempoMap[tempoMap.length - 1];
    if (last && last.tick === tick) last.qpm = qpm;
    else tempoMap.push({ tick, qpm });
  }
  if (tempoMap.length === 0 || tempoMap[0]!.tick > 0) tempoMap.unshift({ tick: 0, qpm: 120 });

  const drafts: Draft[] = quantized.notes.map((n, i) => ({
    onset: n.onset,
    offset: n.offset,
    midi: n.midi,
    hand: hands[i]!,
    velocity: n.velocity,
  }));
  let shortened = 0;
  const crowded: Array<{ onset: number; hand: Hand; notes: number; span: number }> = [];
  for (const hand of ['R', 'L'] as const) {
    const own = drafts
      .filter((d) => d.hand === hand)
      .sort((a, b) => a.onset - b.onset || a.midi - b.midi);
    for (let i = 0; i < own.length;) {
      let j = i;
      while (j < own.length && own[j]!.onset === own[i]!.onset) j++;
      const slice = own.slice(i, j);
      const next = own[j]?.onset;
      let end = Math.max(...slice.map((d) => d.offset));
      if (next !== undefined && end > next) end = next;
      for (const d of slice) {
        if (d.offset > end) shortened++;
        d.offset = end;
      }
      const spread = slice[slice.length - 1]!.midi - slice[0]!.midi;
      if (slice.length > MAX_NOTES_PER_HAND || spread > MAX_HAND_SPAN)
        crowded.push({ onset: slice[0]!.onset, hand, notes: slice.length, span: spread });
      i = j;
    }
  }
  if (shortened > 0)
    warnings.push(
      `${shortened === 1 ? '1 note was' : `${shortened} notes were`} shortened so each hand has one voice`,
    );

  const endTick = Math.max(0, ...drafts.map((d) => d.offset));
  const changes = data.timeSignatures
    .map((t) => ({ tick: Math.round(t.tick * scale), beats: t.beats, beatType: t.beatType }))
    .sort((a, b) => a.tick - b.tick);
  const measures: MeasureInfo[] = [];
  const timeSignatures: TimeSigEvent[] = [];
  let current = changes[0] ?? { tick: 0, beats: 4, beatType: 4 };
  let nextChange = 1;
  let moved = 0;
  let start = 0;
  do {
    while (nextChange < changes.length && changes[nextChange]!.tick <= start) {
      current = changes[nextChange]!;
      if (current.tick !== start) moved++;
      nextChange++;
    }
    const length = Math.round((current.beats * 4 * D) / current.beatType);
    const last = timeSignatures[timeSignatures.length - 1];
    if (!last || last.beats !== current.beats || last.beatType !== current.beatType)
      timeSignatures.push({ tick: start, beats: current.beats, beatType: current.beatType });
    measures.push({
      index: measures.length,
      startTick: start,
      lengthTicks: length,
      number: String(measures.length + 1),
    });
    start += length;
  } while (start < endTick);
  if (moved > 0)
    warnings.push(
      `${count(moved, 'time signature change', 'time signature changes')} moved to the next barline`,
    );
  const measureAt = (tick: number): number => {
    let lo = 0;
    let hi = measures.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (measures[mid]!.startTick <= tick) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const estimate = () => {
    const e = estimateKey(
      drafts.map((d) => ({ midi: d.midi, duration: (d.offset - d.onset) / D })),
    );
    return { fifths: e.fifths, mode: e.mode };
  };
  const key = data.keySignature ?? estimate();
  const keySignatures: KeySigEvent[] = [{ tick: 0, fifths: key.fifths, mode: key.mode }];

  crowded.sort((a, b) => a.onset - b.onset || (a.hand === b.hand ? 0 : a.hand === 'R' ? -1 : 1));
  for (const c of crowded.slice(0, MAX_CROWDED_WARNINGS)) {
    const where = `measure ${measures[measureAt(c.onset)]!.number}`;
    const hand = c.hand === 'R' ? 'right' : 'left';
    warnings.push(
      c.notes > MAX_NOTES_PER_HAND
        ? `${where}: ${c.notes} notes in the ${hand} hand at one time`
        : `${where}: the ${hand} hand spans ${c.span} semitones at one time`,
    );
  }
  if (crowded.length > MAX_CROWDED_WARNINGS)
    warnings.push(
      `and ${count(crowded.length - MAX_CROWDED_WARNINGS, 'more crowded chord', 'more crowded chords')}`,
    );

  const ordered = [...drafts].sort(
    (a, b) =>
      a.onset - b.onset || (a.hand === b.hand ? 0 : a.hand === 'R' ? -1 : 1) || a.midi - b.midi,
  );
  const notes: Note[] = ordered.map((d, i) => ({
    id: `m${i}`,
    onsetTick: d.onset,
    offsetTick: d.offset,
    onsetSec: 0,
    offsetSec: 0,
    midi: d.midi,
    spelling: spellMidi(d.midi, key),
    hand: d.hand,
    staff: d.hand === 'R' ? 1 : 2,
    voice: d.hand === 'R' ? 1 : 5,
    measureIndex: measureAt(d.onset),
    isGrace: false,
    chordId: '',
    sourceIndices: [],
    velocity: d.velocity,
  }));
  const meta: Score['meta'] = {};
  if (opts.title !== undefined) meta.title = opts.title;
  if (opts.composer !== undefined) meta.composer = opts.composer;
  if (opts.source !== undefined) meta.source = opts.source;
  const score = finalizeScore({
    meta,
    divisions: D,
    tempoMap,
    timeSignatures,
    keySignatures,
    measures,
    notes,
  });
  const problems = validateScore(score);
  if (problems.length > 0) throw new Error(`invalid score from MIDI: ${problems.join('; ')}`);
  return { score, warnings };
}
```

- [ ] **Step 4: Run the tests and the checks**

Run: `pnpm --filter @digitus2/engine exec vitest run src/io/midi && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: all pass.

Run: `pnpm verify`
Expected: all PASS.

- [ ] **Step 5: Hand-off**

Paths: `packages/engine/src/io/midi/key.ts`, `packages/engine/src/io/midi/key.test.ts`, `packages/engine/src/io/midi/toScore.ts`, `packages/engine/src/io/midi/toScore.test.ts`. Message: `feat(engine): key estimate, spelling and the Score built from MIDI`.

---

### Task 5: Engraving: Score to two-staff MusicXML that round-trips

**Files:**

- Create: `packages/engine/src/io/midi/engrave.ts`, `packages/engine/src/io/midi/engrave.test.ts`, `packages/engine/src/io/midi/engrave.library.test.ts`

**Interfaces:**

- Consumes: `Score`, `Note`, `MeasureInfo`, `TempoEvent`, `KeySigEvent`, `TimeSigEvent` (M1), `ENGINE_VERSION`; in tests `parseMusicXml`, `finalizeScore`, `midiToSpelling`, the dom helpers of `io/musicxml/dom.ts`, and Tasks 0, 1 and 4.
- Produces:

```ts
export type NoteTypeName = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd' | '64th';
export interface DurationSpec {
  type: NoteTypeName;
  dots: 0 | 1; // no double dots: they are hard for beginners; such lengths become tied notes
  triplet: boolean; // 3:2 time modification
  ticks: number;
}
export interface EngraveOptions {
  title?: string; // default score.meta.title, else 'Untitled'
  composer?: string; // default score.meta.composer
}
export const MAX_VOICES_PER_STAFF = 4;
export function durationTable(divisions: number, triplet: boolean): DurationSpec[]; // longest first, undotted before dotted
export function expressDuration(
  ticks: number,
  divisions: number,
  triplet: boolean,
): DurationSpec[] | null;
export function scoreToMusicXml(score: Score, opts?: EngraveOptions): string;
```

What the engraver writes (decision 6):

- Header: `<?xml …?>`, the partwise 4.0 DOCTYPE, `<work-title>`, a composer `<creator>` when known, `<software>digitus2 <ENGINE_VERSION></software>`, one `<score-part id="P1">` named `Piano`. All text is XML-escaped.
- One `<measure>` per `score.measures` entry (`number` from the entry; `implicit="yes"` on a short first measure). The first measure carries `<attributes>` with `<divisions>` (= `score.divisions`), `<key>` (fifths and mode when known), `<time>`, `<staves>2</staves>`, `<clef number="1">` G on line 2 and `<clef number="2">` F on line 4; later measures carry `<key>`/`<time>` only when they change. The first tempo is a metronome direction with `<sound tempo>` at the start; every later tempo is a bare `<sound tempo="…"/>` at its exact tick in voice 1 (a note held across it is split and tied).
- Voices: the notes of each hand are grouped into chord events (same onset and offset) and given, in onset order (longer first), the lowest voice of their staff that is free: 1–4 upper, 5–8 lower; more than four is an error. Grace notes (and zero-length notes) go to the voice of a note starting at the same onset. Staff order in a measure: voice 1, the other upper voices, then 5 and the other lower voices, each after a `<backup>` of the whole measure. Voices 1 and 5 always exist: their gaps become rests split at quarter-note boundaries, and an empty measure becomes one `<rest measure="yes"/>`; other voices fill gaps with `<forward>`.
- Rhythm: positions are classified per absolute quarter-note window: straight when every boundary inside it is a multiple of a 64th note, triplet when some boundary is not but every boundary is a multiple of a 16th-note-triplet's half (`D / 24`); anything else is an error (`cannot engrave a rhythm at tick T: …`). Notes and rests are split at barlines, at the edges of triplet windows, at grace-note onsets and (voice 1) at tempo changes; each piece's length is written as one value from `durationTable` or, failing that, as the longest values first, tied (notes) or consecutive (rests). Pieces in a triplet window carry `<time-modification>` 3:2, and the first and last piece of the window carry `<tuplet type="start"/>` and `<tuplet type="stop"/>`.
- Every `<note>`: `<pitch>` from `note.spelling`, `<duration>`, `<tie>` and `<tied>` on split pieces, `<voice>`, `<type>`, `<dot/>`, `<accidental>` (shown once per measure, staff, letter and octave as the key signature requires; not on tie continuations), `<staff>`, a primary `<beam number="1">` (eighths and shorter, contiguous, within one beat group: a quarter, or a dotted quarter in 6/8, 9/8 and 12/8), and `id="<note.id>"` on the first `<note>` element of every sounding note.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/io/midi/engrave.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { finalizeScore } from '../../score/build.js';
import { midiToSpelling } from '../../score/pitch.js';
import type { Hand, Note, Score, TempoEvent } from '../../score/types.js';
import { childElements, childText, firstChild, parseXml, type Element } from '../musicxml/dom.js';
import { parseMusicXml } from '../musicxml/read.js';
import { durationTable, expressDuration, scoreToMusicXml } from './engrave.js';
import { quantize } from './quantize.js';
import { parseMidiFile } from './read.js';
import { midiToScore } from './toScore.js';

type Spec = [number, number, number, Hand?, boolean?];
function scoreOf(
  spec: Spec[],
  opts: { time?: [number, number]; key?: number; measures?: number; tempos?: TempoEvent[] } = {},
): Score {
  const D = 480;
  const [beats, beatType] = opts.time ?? [4, 4];
  const length = (beats * 4 * D) / beatType;
  const count = opts.measures ?? Math.ceil(Math.max(1, ...spec.map((s) => s[1])) / length);
  return finalizeScore({
    meta: { title: 'Test' },
    divisions: D,
    tempoMap: opts.tempos ?? [{ tick: 0, qpm: 120 }],
    timeSignatures: [{ tick: 0, beats, beatType }],
    keySignatures: [{ tick: 0, fifths: opts.key ?? 0 }],
    measures: Array.from({ length: count }, (_, i) => ({
      index: i,
      startTick: i * length,
      lengthTicks: length,
      number: String(i + 1),
    })),
    notes: spec.map(([onset, offset, midi, hand = 'R', grace = false], i): Note => ({
      id: `x${i}`,
      onsetTick: onset,
      offsetTick: offset,
      onsetSec: 0,
      offsetSec: 0,
      midi,
      spelling: midiToSpelling(midi),
      hand,
      staff: hand === 'R' ? 1 : 2,
      voice: hand === 'R' ? 1 : 5,
      measureIndex: Math.floor(onset / length),
      isGrace: grace,
      chordId: '',
      sourceIndices: [],
    })),
  });
}

interface XmlNote {
  measure: number;
  id: string | null;
  rest: boolean;
  measureRest: boolean;
  grace: boolean;
  duration: number;
  type: string | null;
  dots: number;
  triplet: boolean;
  staff: number;
  voice: number;
  accidental: string | null;
  ties: string[];
  beam: string | null;
  tuplets: string[];
}
function notesOf(xml: string): XmlNote[] {
  const part = childElements(parseXml(xml).documentElement!, 'part')[0]!;
  return childElements(part, 'measure').flatMap((measure, index) =>
    childElements(measure, 'note').map((el: Element) => {
      const rest = firstChild(el, 'rest');
      const notations = firstChild(el, 'notations');
      return {
        measure: index,
        id: el.getAttribute('id') || null,
        rest: rest !== undefined,
        measureRest: rest?.getAttribute('measure') === 'yes',
        grace: firstChild(el, 'grace') !== undefined,
        duration: Number(childText(el, 'duration') ?? '0'),
        type: childText(el, 'type') ?? null,
        dots: childElements(el, 'dot').length,
        triplet: firstChild(el, 'time-modification') !== undefined,
        staff: Number(childText(el, 'staff')),
        voice: Number(childText(el, 'voice')),
        accidental: childText(el, 'accidental') ?? null,
        ties: childElements(el, 'tie').map((t) => t.getAttribute('type') ?? ''),
        beam: childText(el, 'beam') ?? null,
        tuplets: notations
          ? childElements(notations, 'tuplet').map((t) => t.getAttribute('type') ?? '')
          : [],
      };
    }),
  );
}
const QUARTERS: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
  '64th': 0.0625,
};
const valueTicks = (n: XmlNote) =>
  480 * QUARTERS[n.type!]! * (n.dots ? 1.5 : 1) * (n.triplet ? 2 / 3 : 1);
const noteKey = (n: Note) => `${n.onsetTick}:${n.offsetTick}:${n.midi}:${n.hand}`;
function readBack(original: Score, xml: string): Score {
  const back = parseMusicXml(xml);
  expect(back.score.notes.map(noteKey).sort()).toEqual(original.notes.map(noteKey).sort());
  expect(back.warnings.filter((w) => /tie/.test(w))).toEqual([]);
  return back.score;
}
const sounding = (xml: string) => notesOf(xml).filter((n) => !n.rest);

describe('note values', () => {
  it('expresses lengths with standard values, longest first, without double dots', () => {
    // at 2 divisions: dotted whole, whole, dotted half, half, dotted quarter, quarter, eighth
    expect(durationTable(2, false).map((d) => d.ticks)).toEqual([12, 8, 6, 4, 3, 2, 1]);
    expect(expressDuration(600, 480, false)!.map((d) => [d.type, d.dots])).toEqual([
      ['quarter', 0],
      ['16th', 0],
    ]);
    expect(expressDuration(840, 480, false)!.map((d) => [d.type, d.dots])).toEqual([
      ['quarter', 1],
      ['16th', 0],
    ]);
    expect(expressDuration(160, 480, true)).toEqual([
      { type: 'eighth', dots: 0, triplet: true, ticks: 160 },
    ]);
    expect(expressDuration(7, 480, false)).toBeNull();
  });
});

describe('scoreToMusicXml', () => {
  it('writes one part with two staves, treble and bass clefs, divisions, key, time, tempo and an escaped title', () => {
    const xml = scoreToMusicXml(scoreOf([[0, 480, 60]]), {
      title: 'Fish & Chips <3>',
      composer: 'Anon',
    });
    expect(xml).toContain('<work-title>Fish &amp; Chips &lt;3&gt;</work-title>');
    expect(xml).toContain('<creator type="composer">Anon</creator>');
    expect(xml.match(/<score-part id="P1">/g)).toHaveLength(1);
    expect(xml).toContain('<divisions>480</divisions>');
    expect(xml).toContain('<key><fifths>0</fifths></key>');
    expect(xml).toContain('<time><beats>4</beats><beat-type>4</beat-type></time>');
    expect(xml).toContain('<staves>2</staves>');
    expect(xml).toContain('<clef number="1"><sign>G</sign><line>2</line></clef>');
    expect(xml).toContain('<clef number="2"><sign>F</sign><line>4</line></clef>');
    expect(xml).toContain('<sound tempo="120"/>');
    expect(xml).toContain('<note id="x0">');
  });
  it('fills gaps with rests split at beats and gives an empty staff a whole-measure rest', () => {
    const s = scoreOf([
      [0, 480, 60],
      [960, 1440, 64],
    ]);
    const xml = scoreToMusicXml(s);
    const ns = notesOf(xml);
    expect(
      ns.filter((n) => n.staff === 1).map((n) => (n.rest ? `rest ${n.type}` : n.type)),
    ).toEqual(['quarter', 'rest quarter', 'quarter', 'rest quarter']);
    expect(ns.filter((n) => n.staff === 2)).toMatchObject([
      { measureRest: true, duration: 1920, voice: 5 },
    ]);
    readBack(s, xml);
  });
  it('ties a note across a barline and writes its id once', () => {
    const s = scoreOf([[1440, 2400, 67]], { measures: 2 });
    const xml = scoreToMusicXml(s);
    expect(sounding(xml).map((n) => [n.measure, n.duration, n.type, n.ties, n.id])).toEqual([
      [0, 480, 'quarter', ['start'], 'x0'],
      [1, 480, 'quarter', ['stop'], null],
    ]);
    expect(readBack(s, xml).notes.map((n) => [n.onsetTick, n.offsetTick])).toEqual([[1440, 2400]]);
  });
  it('writes a triplet beat with a time modification, one tuplet and a beam', () => {
    const s = scoreOf([
      [0, 480, 60],
      [480, 640, 62],
      [640, 800, 64],
      [800, 960, 65],
      [960, 1920, 67],
    ]);
    const xml = scoreToMusicXml(s);
    const ns = sounding(xml);
    expect(ns.map((n) => [n.type, n.triplet])).toEqual([
      ['quarter', false],
      ['eighth', true],
      ['eighth', true],
      ['eighth', true],
      ['half', false],
    ]);
    expect(ns.map((n) => n.tuplets)).toEqual([[], ['start'], [], ['stop'], []]);
    expect(ns.map((n) => n.beam)).toEqual([null, 'begin', 'continue', 'end', null]);
    readBack(s, xml);
  });
  it('writes awkward lengths as tied standard values and every note value matches its duration', () => {
    const spec: Spec[] = [];
    let t = 0;
    for (const sixteenths of [5, 7, 9, 11, 13]) {
      spec.push([t, t + sixteenths * 120, 60 + spec.length]);
      t += sixteenths * 120;
    }
    const s = scoreOf(spec);
    const xml = scoreToMusicXml(s);
    const written = notesOf(xml).filter((n) => !n.measureRest && !n.grace);
    expect(written.length).toBeGreaterThan(spec.length);
    for (const n of written) {
      expect(n.type, JSON.stringify(n)).not.toBeNull();
      expect(n.duration).toBeCloseTo(valueTicks(n), 9);
    }
    readBack(s, xml);
  });
  it('prints accidentals once per measure and staff, as the key signature requires', () => {
    const c = scoreOf([
      [0, 480, 66],
      [480, 960, 66],
      [960, 1440, 65],
      [1920, 2400, 66],
    ]);
    expect(sounding(scoreToMusicXml(c)).map((n) => n.accidental)).toEqual([
      'sharp',
      null,
      'natural',
      'sharp',
    ]);
    const g = scoreOf(
      [
        [0, 480, 66],
        [480, 960, 65],
      ],
      { key: 1 },
    );
    expect(sounding(scoreToMusicXml(g)).map((n) => n.accidental)).toEqual([null, 'natural']);
  });
  it('puts notes of one hand that overlap without starting together into a second voice', () => {
    const s = scoreOf([
      [0, 1920, 48, 'L'],
      [0, 480, 55, 'L'],
      [480, 960, 52, 'L'],
      [960, 1920, 55, 'L'],
    ]);
    const xml = scoreToMusicXml(s);
    expect(sounding(xml).map((n) => [n.voice, n.type])).toEqual([
      [5, 'whole'],
      [6, 'quarter'],
      [6, 'quarter'],
      [6, 'half'],
    ]);
    expect(xml.match(/<backup>/g)).toHaveLength(2);
    readBack(s, xml);
  });
  it('writes a grace note before its principal without a duration and reads it back as a grace note', () => {
    const s = scoreOf([
      [480, 480, 61, 'R', true],
      [480, 960, 62],
    ]);
    const xml = scoreToMusicXml(s);
    expect(sounding(xml).map((n) => [n.grace, n.duration, n.id])).toEqual([
      [true, 0, 'x0'],
      [false, 480, 'x1'],
    ]);
    expect(
      readBack(s, xml).notes.map((n) => [n.onsetTick, n.offsetTick, n.midi, n.isGrace]),
    ).toEqual([
      [480, 480, 61, true],
      [480, 960, 62, false],
    ]);
  });
  it('places a tempo change at its exact tick, splitting a held note with a tie', () => {
    const s = scoreOf([[0, 1920, 60]], {
      tempos: [
        { tick: 0, qpm: 120 },
        { tick: 960, qpm: 60 },
      ],
    });
    const xml = scoreToMusicXml(s);
    expect(xml).toContain('<sound tempo="60"/>');
    expect(sounding(xml).map((n) => [n.type, n.ties])).toEqual([
      ['half', ['start']],
      ['half', ['stop']],
    ]);
    const back = readBack(s, xml);
    expect(back.tempoMap).toEqual([
      { tick: 0, qpm: 120 },
      { tick: 960, qpm: 60 },
    ]);
    expect(back.notes[0]!.offsetSec).toBeCloseTo(3, 9);
  });
  it('beams four 16th notes in a beat and leaves a dotted half alone', () => {
    const s = scoreOf([
      [0, 120, 60],
      [120, 240, 62],
      [240, 360, 64],
      [360, 480, 65],
      [480, 1920, 67],
    ]);
    expect(sounding(scoreToMusicXml(s)).map((n) => n.beam)).toEqual([
      'begin',
      'continue',
      'continue',
      'end',
      null,
    ]);
  });
  it('refuses a rhythm it cannot write instead of writing a wrong one', () => {
    expect(() =>
      scoreToMusicXml(
        scoreOf([
          [0, 96, 60],
          [96, 480, 62],
        ]),
      ),
    ).toThrow(/cannot engrave a rhythm at tick 96/);
    expect(() =>
      scoreToMusicXml(
        scoreOf([0, 120, 240, 360, 480].map((on, i) => [on, 1920, 60 + 2 * i] as Spec)),
      ),
    ).toThrow(/more than 4 voices/);
  });
  it('keeps the tempo map of tempo-map.mid through quantization, separation, engraving and reading back', () => {
    const d = parseMidiFile(
      new Uint8Array(
        readFileSync(fileURLToPath(new URL('../../../fixtures/tempo-map.mid', import.meta.url))),
      ),
    );
    const q = quantize(d);
    const truth = q.notes.map((n): Hand => (d.notes[n.sources[0]!]!.channel === 0 ? 'R' : 'L'));
    const back = parseMusicXml(scoreToMusicXml(midiToScore(d, q, truth).score)).score;
    const rh = back.notes.filter((n) => n.hand === 'R');
    expect(rh).toHaveLength(32);
    expect(rh[16]!.onsetSec).toBeCloseTo(10, 6);
    expect(rh[24]!.onsetSec).toBeCloseTo(18, 6);
    expect(rh[31]!.onsetSec).toBeCloseTo(21.5, 6);
    expect(back.tempoMap.map((t) => [t.tick, t.qpm])).toEqual([
      [0, 96],
      [7680, 60],
      [11520, 120],
    ]);
  });
});
```

`packages/engine/src/io/midi/engrave.library.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Note } from '../../score/types.js';
import { parseMusicXml } from '../musicxml/read.js';
import { scoreToMusicXml } from './engrave.js';

const repo = new URL('../../../../../', import.meta.url);
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('content/manifest.json', repo)), 'utf8'),
) as Array<{ slug: string; files: { score: string } }>;
const noteKey = (n: Note) => `${n.onsetTick}:${n.offsetTick}:${n.midi}:${n.hand}`;

describe('engraving round trip on the built-in library', () => {
  it.each(manifest.map((p) => [p.slug, p.files.score] as const))(
    '%s: MusicXML -> Score -> MusicXML -> Score keeps every note',
    (_slug, file) => {
      const first = parseMusicXml(
        readFileSync(fileURLToPath(new URL(`content/${file}`, repo))),
      ).score;
      const { score: second, warnings } = parseMusicXml(scoreToMusicXml(first));
      expect(second.notes.map(noteKey).sort()).toEqual(first.notes.map(noteKey).sort());
      expect(second.divisions).toBe(first.divisions);
      expect(second.measures.map((m) => [m.startTick, m.lengthTicks])).toEqual(
        first.measures.map((m) => [m.startTick, m.lengthTicks]),
      );
      expect(second.tempoMap.map((t) => [t.tick, t.qpm])).toEqual(
        first.tempoMap.map((t) => [t.tick, Number(t.qpm.toFixed(4))]),
      );
      expect(warnings.filter((w) => /tie/.test(w))).toEqual([]);
    },
    20_000,
  );
});
```

Run: `pnpm --filter @digitus2/engine exec vitest run src/io/midi/engrave`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

`packages/engine/src/io/midi/engrave.ts`:

```ts
import type {
  KeySigEvent,
  MeasureInfo,
  Note,
  Score,
  TempoEvent,
  TimeSigEvent,
} from '../../score/types.js';
import { ENGINE_VERSION } from '../../version.js';

export type NoteTypeName = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd' | '64th';
export interface DurationSpec {
  type: NoteTypeName;
  dots: 0 | 1;
  triplet: boolean;
  ticks: number;
}
export interface EngraveOptions {
  title?: string;
  composer?: string;
}
export const MAX_VOICES_PER_STAFF = 4;

const NOTE_TYPES: ReadonlyArray<readonly [NoteTypeName, number, number]> = [
  ['whole', 4, 1],
  ['half', 2, 1],
  ['quarter', 1, 1],
  ['eighth', 1, 2],
  ['16th', 1, 4],
  ['32nd', 1, 8],
  ['64th', 1, 16],
];
const BEAMABLE: ReadonlySet<NoteTypeName> = new Set<NoteTypeName>([
  'eighth',
  '16th',
  '32nd',
  '64th',
]);
const ACCIDENTALS: Readonly<Record<number, string>> = {
  [-2]: 'flat-flat',
  [-1]: 'flat',
  0: 'natural',
  1: 'sharp',
  2: 'double-sharp',
};
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const TIME_MODIFICATION =
  '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';

type Staff = 1 | 2;
interface VoiceEvent {
  notes: Note[];
  onset: number;
  offset: number;
  grace: boolean;
  voice: number;
}
type PieceKind = 'note' | 'rest' | 'grace' | 'measure-rest' | 'forward';
interface Piece {
  kind: PieceKind;
  start: number;
  end: number;
  notes: Note[];
  spec: DurationSpec | null;
  tupletStart: boolean;
  tupletStop: boolean;
  beam: 'begin' | 'continue' | 'end' | null;
  accidentals: Array<string | null>;
  tempos: number[];
}
interface MeasureContext {
  first: boolean;
  last: boolean;
  key: KeySigEvent;
  time: TimeSigEvent;
  keyChanged: boolean;
  timeChanged: boolean;
  initialTempo: TempoEvent | null;
  tempos: TempoEvent[];
}

const tableCache = new Map<string, DurationSpec[]>();

export function durationTable(divisions: number, triplet: boolean): DurationSpec[] {
  const cacheKey = `${divisions}:${triplet}`;
  const cached = tableCache.get(cacheKey);
  if (cached) return cached;
  const out: DurationSpec[] = [];
  for (const [type, qn, qd] of NOTE_TYPES)
    for (const [dots, dn, dd] of [
      [0, 1, 1],
      [1, 3, 2],
    ] as const) {
      const num = divisions * qn * dn * (triplet ? 2 : 1);
      const den = qd * dd * (triplet ? 3 : 1);
      if (num % den === 0) out.push({ type, dots, triplet, ticks: num / den });
    }
  out.sort((a, b) => b.ticks - a.ticks || a.dots - b.dots);
  tableCache.set(cacheKey, out);
  return out;
}

export function expressDuration(
  ticks: number,
  divisions: number,
  triplet: boolean,
): DurationSpec[] | null {
  const table = durationTable(divisions, triplet);
  const exact = table.find((d) => d.ticks === ticks);
  if (exact) return [exact];
  const parts: DurationSpec[] = [];
  let rest = ticks;
  while (rest > 0) {
    const d = table.find((x) => x.ticks <= rest);
    if (!d) return null;
    parts.push(d);
    rest -= d.ticks;
  }
  return parts;
}

export function scoreToMusicXml(score: Score, opts: EngraveOptions = {}): string {
  const D = score.divisions;
  const voices = allocateVoices(score);
  const measures: MeasureInfo[] =
    score.measures.length > 0
      ? score.measures
      : [{ index: 0, startTick: 0, lengthTicks: 4 * D, number: '1' }];
  const tempoMap = score.tempoMap.length > 0 ? score.tempoMap : [{ tick: 0, qpm: 120 }];
  const initial = tempoMap[0]!.tick === 0 ? tempoMap[0]! : null;
  const later = initial ? tempoMap.slice(1) : tempoMap;
  const lines = [headerXml(score, opts)];
  let previousKey: KeySigEvent | null = null;
  let previousTime: TimeSigEvent | null = null;
  measures.forEach((m, i) => {
    const key = activeAt(score.keySignatures, m.startTick) ?? { tick: 0, fifths: 0 };
    const time = activeAt(score.timeSignatures, m.startTick) ?? { tick: 0, beats: 4, beatType: 4 };
    const last = i === measures.length - 1;
    const end = m.startTick + m.lengthTicks;
    lines.push(
      measureXml(m, D, voices, {
        first: i === 0,
        last,
        key,
        time,
        keyChanged:
          previousKey !== null &&
          (previousKey.fifths !== key.fifths || previousKey.mode !== key.mode),
        timeChanged:
          previousTime !== null &&
          (previousTime.beats !== time.beats || previousTime.beatType !== time.beatType),
        initialTempo: i === 0 ? initial : null,
        tempos: later.filter((t) => t.tick >= m.startTick && (t.tick < end || last)),
      }),
    );
    previousKey = key;
    previousTime = time;
  });
  lines.push('</part>', '</score-partwise>');
  return lines.join('\n') + '\n';
}

function activeAt<T extends { tick: number }>(events: readonly T[], tick: number): T | undefined {
  let found: T | undefined;
  for (const e of events) if (e.tick <= tick) found = e;
  return found;
}

function allocateVoices(score: Score): Map<number, VoiceEvent[]> {
  const byVoice = new Map<number, VoiceEvent[]>([
    [1, []],
    [5, []],
  ]);
  for (const [hand, base] of [
    ['R', 1],
    ['L', 5],
  ] as const) {
    const own = score.notes.filter((n) => n.hand === hand);
    const isGrace = (n: Note) => n.isGrace || n.offsetTick <= n.onsetTick;
    const groups = new Map<string, Note[]>();
    for (const n of own) {
      if (isGrace(n)) continue;
      const k = `${n.onsetTick}:${n.offsetTick}`;
      const g = groups.get(k);
      if (g) g.push(n);
      else groups.set(k, [n]);
    }
    const events: VoiceEvent[] = [...groups.values()]
      .map((notes) => ({
        notes: [...notes].sort((a, b) => a.midi - b.midi),
        onset: notes[0]!.onsetTick,
        offset: notes[0]!.offsetTick,
        grace: false,
        voice: base,
      }))
      .sort(
        (a, b) =>
          a.onset - b.onset ||
          b.offset - a.offset ||
          b.notes[b.notes.length - 1]!.midi - a.notes[a.notes.length - 1]!.midi,
      );
    const busyUntil: number[] = [];
    for (const e of events) {
      let v = busyUntil.findIndex((t) => t <= e.onset);
      if (v < 0) {
        if (busyUntil.length >= MAX_VOICES_PER_STAFF)
          throw new Error(
            `cannot engrave: more than ${MAX_VOICES_PER_STAFF} voices needed in the ${hand === 'R' ? 'upper' : 'lower'} staff at tick ${e.onset}`,
          );
        v = busyUntil.length;
        busyUntil.push(e.offset);
      } else busyUntil[v] = e.offset;
      e.voice = base + v;
    }
    const graces: VoiceEvent[] = own
      .filter(isGrace)
      .sort((a, b) => a.onsetTick - b.onsetTick || a.midi - b.midi)
      .map((n) => {
        let voice = events.find((e) => e.onset === n.onsetTick)?.voice;
        for (let v = base; voice === undefined && v < base + MAX_VOICES_PER_STAFF; v++)
          if (!events.some((e) => e.voice === v && e.onset < n.onsetTick && n.onsetTick < e.offset))
            voice = v;
        return {
          notes: [n],
          onset: n.onsetTick,
          offset: n.onsetTick,
          grace: true,
          voice: voice ?? base,
        };
      });
    for (const e of [...events, ...graces]) {
      const list = byVoice.get(e.voice);
      if (list) list.push(e);
      else byVoice.set(e.voice, [e]);
    }
  }
  for (const list of byVoice.values())
    list.sort(
      (a, b) =>
        a.onset - b.onset ||
        Number(b.grace) - Number(a.grace) ||
        a.notes[0]!.midi - b.notes[0]!.midi,
    );
  return byVoice;
}

function piece(
  kind: PieceKind,
  start: number,
  end: number,
  notes: Note[],
  spec: DurationSpec | null,
): Piece {
  return {
    kind,
    start,
    end,
    notes,
    spec,
    tupletStart: false,
    tupletStop: false,
    beam: null,
    accidentals: notes.map(() => null),
    tempos: [],
  };
}

function measureXml(
  m: MeasureInfo,
  D: number,
  voices: Map<number, VoiceEvent[]>,
  c: MeasureContext,
): string {
  const start = m.startTick;
  const end = m.startTick + m.lengthTicks;
  const nominal = (c.time.beats * 4 * D) / c.time.beatType;
  const out = [
    `<measure number="${escapeXml(m.number)}"${c.first && m.lengthTicks < nominal ? ' implicit="yes"' : ''}>`,
  ];
  if (c.first)
    out.push(
      `<attributes><divisions>${D}</divisions>${keyXml(c.key)}${timeXml(c.time)}<staves>2</staves>` +
        '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>',
    );
  else if (c.keyChanged || c.timeChanged)
    out.push(
      `<attributes>${c.keyChanged ? keyXml(c.key) : ''}${c.timeChanged ? timeXml(c.time) : ''}</attributes>`,
    );
  if (c.initialTempo) out.push(metronomeXml(c.initialTempo.qpm));
  const inside = c.tempos.filter((t) => t.tick < end);
  const trailing = c.tempos.filter((t) => t.tick >= end);
  if (m.lengthTicks > 0) {
    const written: Array<{ voice: number; staff: Staff; pieces: Piece[] }> = [];
    for (const voice of [...voices.keys()].sort((a, b) => a - b)) {
      const primary = voice === 1 || voice === 5;
      const events = voices
        .get(voice)!
        .filter((e) =>
          e.grace ? e.onset >= start && e.onset < end : e.onset < end && e.offset > start,
        );
      if (!primary && events.length === 0) continue;
      const pieces = voicePieces(
        events,
        start,
        end,
        D,
        primary,
        voice === 1 ? inside.map((t) => t.tick) : [],
      );
      if (voice === 1) attachTempos(pieces, inside);
      markBeams(pieces, start, D, c.time);
      written.push({ voice, staff: voice <= MAX_VOICES_PER_STAFF ? 1 : 2, pieces });
    }
    for (const staff of [1, 2] as const)
      markAccidentals(
        written.filter((w) => w.staff === staff),
        c.key,
      );
    written.forEach((w, i) => {
      if (i > 0) out.push(`<backup><duration>${m.lengthTicks}</duration></backup>`);
      for (const p of w.pieces) out.push(pieceXml(p, w.voice, w.staff));
      if (w.voice === 1)
        for (const t of trailing) out.push(`<sound tempo="${formatNumber(t.qpm)}"/>`);
    });
  }
  out.push('</measure>');
  return out.join('\n');
}

function voicePieces(
  events: VoiceEvent[],
  start: number,
  end: number,
  D: number,
  primary: boolean,
  extraSplits: number[],
): Piece[] {
  const sounding = events.filter((e) => !e.grace);
  const graces = events.filter((e) => e.grace);
  const inside = (t: number) => t > start && t < end;
  if (primary && sounding.length === 0 && graces.length === 0 && !extraSplits.some(inside))
    return [piece('measure-rest', start, end, [], null)];

  const segments: Array<{ start: number; end: number; event: VoiceEvent | null }> = [];
  let cursor = start;
  for (const e of sounding) {
    const s = Math.max(e.onset, start);
    const t = Math.min(e.offset, end);
    if (s > cursor) segments.push({ start: cursor, end: s, event: null });
    segments.push({ start: s, end: t, event: e });
    cursor = t;
  }
  if (cursor < end) segments.push({ start: cursor, end, event: null });

  // Absolute quarter-note windows: straight when every inner boundary is a 64th-note position,
  // triplet when some is not but all are 16th-triplet half positions (D / 24); otherwise refuse.
  const windowOf = (t: number) => Math.floor(t / D);
  const straight = (t: number) => ((t - windowOf(t) * D) * 16) % D === 0;
  const tripletPosition = (t: number) => ((t - windowOf(t) * D) * 24) % D === 0;
  const refuse = (t: number) =>
    new Error(
      `cannot engrave a rhythm at tick ${t}: only straight values down to 64th notes and triplets within one beat are supported`,
    );
  const boundaries = [
    ...segments.flatMap((s) => [s.start, s.end]),
    ...graces.map((g) => g.onset),
    ...extraSplits,
  ].filter(inside);
  const tripletWindows = new Set<number>();
  for (const b of boundaries) {
    if (straight(b)) continue;
    if (!tripletPosition(b)) throw refuse(b);
    tripletWindows.add(windowOf(b));
  }
  for (const b of boundaries)
    if (tripletWindows.has(windowOf(b)) && !tripletPosition(b)) throw refuse(b);

  const splits = new Set<number>([...graces.map((g) => g.onset), ...extraSplits]);
  for (const k of tripletWindows) {
    splits.add(k * D);
    splits.add((k + 1) * D);
  }
  const pieces: Piece[] = [];
  for (const seg of segments) {
    const cuts = new Set([...splits].filter((t) => t > seg.start && t < seg.end));
    if (seg.event === null && primary)
      for (let t = (windowOf(seg.start) + 1) * D; t < seg.end; t += D) cuts.add(t);
    const bounds = [seg.start, ...[...cuts].sort((a, b) => a - b), seg.end];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const a = bounds[i]!;
      const b = bounds[i + 1]!;
      for (const g of graces) if (g.onset === a) pieces.push(piece('grace', a, a, g.notes, null));
      if (seg.event === null && !primary) {
        pieces.push(piece('forward', a, b, [], null));
        continue;
      }
      const specs = expressDuration(b - a, D, tripletWindows.has(windowOf(a)));
      if (!specs)
        throw new Error(
          `cannot engrave a duration of ${b - a} ticks at tick ${a} (divisions ${D})`,
        );
      let t = a;
      for (const spec of specs) {
        pieces.push(
          piece(
            seg.event ? 'note' : 'rest',
            t,
            t + spec.ticks,
            seg.event ? seg.event.notes : [],
            spec,
          ),
        );
        t += spec.ticks;
      }
    }
  }
  for (const k of tripletWindows) {
    const members = pieces.filter(
      (p) => (p.kind === 'note' || p.kind === 'rest') && p.start >= k * D && p.end <= (k + 1) * D,
    );
    if (members.length > 0) {
      members[0]!.tupletStart = true;
      members[members.length - 1]!.tupletStop = true;
    }
  }
  return pieces;
}

function attachTempos(pieces: Piece[], tempos: readonly TempoEvent[]): void {
  for (const t of tempos) {
    const target = pieces.find((p) => p.start >= t.tick) ?? pieces[pieces.length - 1];
    target?.tempos.push(t.qpm);
  }
}

function markBeams(pieces: Piece[], start: number, D: number, time: TimeSigEvent): void {
  const width = time.beatType === 8 && time.beats % 3 === 0 && time.beats >= 6 ? (3 * D) / 2 : D;
  const group = (t: number) => Math.floor((t - start) / width);
  const beamable = (p: Piece) =>
    p.kind === 'note' &&
    p.spec !== null &&
    BEAMABLE.has(p.spec.type) &&
    group(p.start) === group(p.end - 1);
  let run: Piece[] = [];
  const flush = () => {
    if (run.length >= 2)
      run.forEach((p, i) => {
        p.beam = i === 0 ? 'begin' : i === run.length - 1 ? 'end' : 'continue';
      });
    run = [];
  };
  for (const p of pieces) {
    if (p.kind === 'grace') continue;
    if (beamable(p) && (run.length === 0 || group(run[0]!.start) === group(p.start))) run.push(p);
    else {
      flush();
      if (beamable(p)) run.push(p);
    }
  }
  flush();
}

function keyAlter(fifths: number, step: string): number {
  if (fifths > 0) return SHARP_ORDER.indexOf(step) < fifths ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.indexOf(step) < -fifths ? -1 : 0;
  return 0;
}

function markAccidentals(
  voices: ReadonlyArray<{ voice: number; pieces: Piece[] }>,
  key: KeySigEvent,
): void {
  const items = voices
    .flatMap((w) =>
      w.pieces.flatMap((p) => p.notes.map((note, j) => ({ p, j, note, voice: w.voice }))),
    )
    .sort(
      (a, b) =>
        a.p.start - b.p.start ||
        Number(b.p.kind === 'grace') - Number(a.p.kind === 'grace') ||
        a.voice - b.voice ||
        a.note.midi - b.note.midi,
    );
  const current = new Map<string, number>();
  for (const { p, j, note } of items) {
    if (p.kind !== 'grace' && p.start !== note.onsetTick) continue; // tie continuations show no accidental
    const slot = `${note.spelling.step}${note.spelling.octave}`;
    const expected = current.get(slot) ?? keyAlter(key.fifths, note.spelling.step);
    if (note.spelling.alter !== expected) {
      p.accidentals[j] = ACCIDENTALS[note.spelling.alter] ?? null;
      current.set(slot, note.spelling.alter);
    }
  }
}

function pieceXml(p: Piece, voice: number, staff: Staff): string {
  const tempo = p.tempos.map((q) => `<sound tempo="${formatNumber(q)}"/>`).join('');
  const length = p.end - p.start;
  switch (p.kind) {
    case 'forward':
      return `${tempo}<forward><duration>${length}</duration><voice>${voice}</voice><staff>${staff}</staff></forward>`;
    case 'measure-rest':
      return `${tempo}<note><rest measure="yes"/><duration>${length}</duration><voice>${voice}</voice><staff>${staff}</staff></note>`;
    case 'rest':
      return `${tempo}<note><rest/><duration>${length}</duration><voice>${voice}</voice>${typeXml(p.spec!)}${p.spec!.triplet ? TIME_MODIFICATION : ''}<staff>${staff}</staff>${notationsXml('', p)}</note>`;
    default:
      return tempo + p.notes.map((n, j) => noteXml(p, n, j, voice, staff)).join('');
  }
}

function noteXml(p: Piece, n: Note, j: number, voice: number, staff: Staff): string {
  const grace = p.kind === 'grace';
  const first = grace || p.start === n.onsetTick;
  const last = grace || p.end === n.offsetTick;
  const accidental = p.accidentals[j];
  return [
    first ? `<note id="${escapeXml(n.id)}">` : '<note>',
    grace ? '<grace slash="yes"/>' : '',
    j > 0 ? '<chord/>' : '',
    pitchXml(n),
    grace ? '' : `<duration>${p.end - p.start}</duration>`,
    first ? '' : '<tie type="stop"/>',
    last ? '' : '<tie type="start"/>',
    `<voice>${voice}</voice>`,
    grace ? '<type>eighth</type>' : typeXml(p.spec!),
    accidental ? `<accidental>${accidental}</accidental>` : '',
    !grace && p.spec!.triplet ? TIME_MODIFICATION : '',
    `<staff>${staff}</staff>`,
    j === 0 && p.beam ? `<beam number="1">${p.beam}</beam>` : '',
    notationsXml(
      `${first ? '' : '<tied type="stop"/>'}${last ? '' : '<tied type="start"/>'}`,
      j === 0 ? p : null,
    ),
    '</note>',
  ].join('');
}

function notationsXml(tied: string, p: Piece | null): string {
  const tuplet = p
    ? `${p.tupletStart ? '<tuplet type="start"/>' : ''}${p.tupletStop ? '<tuplet type="stop"/>' : ''}`
    : '';
  return tied || tuplet ? `<notations>${tied}${tuplet}</notations>` : '';
}

function typeXml(spec: DurationSpec): string {
  return `<type>${spec.type}</type>${spec.dots ? '<dot/>' : ''}`;
}

function pitchXml(n: Note): string {
  const s = n.spelling;
  return `<pitch><step>${s.step}</step>${s.alter !== 0 ? `<alter>${s.alter}</alter>` : ''}<octave>${s.octave}</octave></pitch>`;
}

function keyXml(k: KeySigEvent): string {
  return `<key><fifths>${k.fifths}</fifths>${k.mode ? `<mode>${k.mode}</mode>` : ''}</key>`;
}

function timeXml(t: TimeSigEvent): string {
  return `<time><beats>${t.beats}</beats><beat-type>${t.beatType}</beat-type></time>`;
}

function metronomeXml(qpm: number): string {
  const q = formatNumber(qpm);
  return `<direction placement="above"><direction-type><metronome parentheses="no"><beat-unit>quarter</beat-unit><per-minute>${q}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${q}"/></direction>`;
}

function headerXml(score: Score, opts: EngraveOptions): string {
  const title = opts.title ?? score.meta.title ?? 'Untitled';
  const composer = opts.composer ?? score.meta.composer;
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `<work><work-title>${escapeXml(title)}</work-title></work>`,
    `<identification>${composer ? `<creator type="composer">${escapeXml(composer)}</creator>` : ''}<encoding><software>digitus2 ${ENGINE_VERSION}</software></encoding></identification>`,
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>',
    '<part id="P1">',
  ].join('\n');
}

function formatNumber(x: number): string {
  return String(Number(x.toFixed(4)));
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
```

- [ ] **Step 3: Run the unit tests**

Run: `pnpm --filter @digitus2/engine exec vitest run src/io/midi/engrave.test.ts`
Expected: all pass.

- [ ] **Step 4: Run the library round trip**

Run (background it if it takes more than a minute): `pnpm --filter @digitus2/engine exec vitest run src/io/midi/engrave.library.test.ts`
Expected: 30 passed. A check while writing this plan found every note boundary in the 30 files to be a straight or triplet position in its quarter-note window, so a failure is a bug in the engraver, not in the data. For a failing piece, diff the two sorted note-key lists and look at the first missing key: a lost tie (wrong voice on a continuation), an offset cut at a window edge (missing `<tie>`), or a measure-length change (a voice that does not fill its measure). Do not loosen the assertions.

- [ ] **Step 5: Run the checks**

Run: `pnpm --filter @digitus2/engine exec vitest run && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: all pass.

Run: `pnpm verify`
Expected: all PASS.

- [ ] **Step 6: Hand-off**

Paths: `packages/engine/src/io/midi/engrave.ts`, `packages/engine/src/io/midi/engrave.test.ts`, `packages/engine/src/io/midi/engrave.library.test.ts`. Message: `feat(engine): engrave scores as two-staff MusicXML that round-trips through the reader`.

---

### Task 6: `importMidi`, the public exports, `digitus2 import`, `digitus2 evalhands`, and the verify step

**Files:**

- Create: `packages/engine/src/io/midi/import.ts`, `packages/engine/src/io/midi/import.test.ts`, `packages/engine/src/io/midi/index.ts`, `packages/engine/cli/import.ts`, `packages/engine/cli/import.test.ts`, `packages/engine/cli/evalhands.ts`, `packages/engine/cli/evalhands.test.ts`
- Modify: `packages/engine/src/index.ts` (exports), `packages/engine/cli/run.ts` (dispatch and usage), `benchmarks/floor.json` (a `hands` block), `scripts/verify.mjs` (step `hands`), `docs/verification-loop.md` (the new step)

**Interfaces:**

- Consumes: Tasks 0 to 5; `parseMusicXml`, `injectFingerings`, `parsePig`, `ticksToSeconds`, `formatPigPitch`, `midiToSpelling`, `ENGINE_VERSION` (M1); the CLI conventions of `cli/run.ts` (`main(argv, io)`, one `digitus2: …` line on error, exit code 2 on usage errors) and of `cli/bench.ts` (split files, `goldDir` with or without `FingeringFiles/`, `gitSha()`).
- Produces:

```ts
// src/io/midi/import.ts
export interface MidiImportOptions {
  splitMidi?: number;
  title?: string;
  composer?: string;
  params?: HandMotionParams;
}
export interface MidiInfo {
  quantizedMovedShare: number; // 0..1, onsets moved more than a 64th note
  grids: Record<GridKind, number>; // beats per grid
  splitMidi: number | null; // the override in force, null = automatic
  warnings: string[]; // reader, then quantizer, then midiToScore warnings
}
export interface MidiImport {
  xml: string; // generated MusicXML; first <note> of each sounding note has id="m…"
  score: Score; // read back from xml: sourceIndices point into xml; ids and velocities from the MIDI score
  info: MidiInfo;
}
export function importMidi(bytes: Uint8Array, opts?: MidiImportOptions): MidiImport;

// cli/import.ts
export interface ImportOptions {
  file: string;
  out?: string;
  split?: number;
  title?: string;
}
export function importFile(o: ImportOptions): { xml: string; summary: string; warnings: string[] };

// cli/evalhands.ts
export interface EvalHandsOptions {
  gold?: string; // PIG-format gold directory (with or without FingeringFiles/)
  split?: string; // split JSON with splits.<name>.<subset>.pieces
  splitName?: string; // default: the file's default_split
  subset?: 'test' | 'train'; // default 'test'
  library?: string; // content/manifest.json
  params?: string; // a hand-motion JSON; default the shipped HAND_MOTION
  out?: string; // write the scorecard here
  label?: string;
  floor?: string; // benchmarks/floor.json; compares hands.accuracyMin with the PIG macro accuracy
}
export interface HandPieceResult {
  id: string;
  notes: number;
  accuracy: number; // percent
  ms: number;
}
export interface HandSetResult {
  macro: number; // percent, unweighted mean over pieces
  noteWeighted: number;
  pieces: HandPieceResult[];
  skipped: Array<{ id: string; reason: string }>;
}
export interface HandsScorecard {
  version: 1;
  engineVersion: string;
  gitSha: string;
  label: string;
  timestamp: string;
  params: { file: string; sha256: string };
  handSeparation: { accuracy: number | null }; // the PIG macro accuracy, or null when no PIG set ran
  pig: (HandSetResult & { split: string; splitName: string; subset: string }) | null;
  library: (HandSetResult & { manifest: string }) | null;
}
export function runEvalHands(o: EvalHandsOptions): {
  scorecard: HandsScorecard;
  floorBreaches: string[];
};
export function formatHandsScorecard(card: HandsScorecard): string;
```

`evalhands` scores, for each piece of the split's subset, the first annotation file (`<id>-<k>_fingering.txt`, sorted; PIG annotators sometimes move notes between hands, so one file is the truth) with `evaluateHands`; for the library, each manifest entry's `files.score` (relative to the manifest's folder) with staff as truth. Every piece appears in `pieces` or in `skipped` with a reason. `--floor`: when `hands.accuracyMin` is a number and `pig.macro` is more than 0.005 below it, the breach string is `hand accuracy <macro> below floor <min>`; the command exits 1 on any breach. The scorecard is written only with `--out`.

`benchmarks/floor.json` gains (Task 9 sets the number):

```json
  "hands": {
    "accuracyMin": null,
    "note": "Hand separation (digitus2 evalhands): macro accuracy in percent on the PIG test split, first annotation of each piece, channel = truth. Set by M6 Task 9 to the measured value minus 1.0."
  }
```

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/io/midi/import.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeMidi, type MidiEvent } from 'midi-file';
import { describe, expect, it } from 'vitest';
import { ticksToSeconds } from '../../score/build.js';
import type { Assignment } from '../../score/types.js';
import { parseMusicXml } from '../musicxml/read.js';
import { injectFingerings } from '../musicxml/write.js';
import { importMidi } from './import.js';
import { parseMidiFile } from './read.js';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url))),
  );

describe('importMidi', () => {
  it('returns MusicXML and a Score whose ids are the id attributes and whose sources point into that MusicXML', () => {
    const bytes = fixture('twinkle.mid');
    // A split at C4 reproduces the fixture's hands exactly, so this test does not depend on the DP.
    const { xml, score, info } = importMidi(bytes, { title: 'twinkle', splitMidi: 60 });
    expect(score.notes).toHaveLength(64);
    expect(score.notes.filter((n) => n.hand === 'R')).toHaveLength(42);
    expect(new Set(score.notes.map((n) => n.id)).size).toBe(64);
    for (const n of score.notes) expect(xml).toContain(`<note id="${n.id}">`);
    expect(score.meta.title).toBe('twinkle');
    const assignment: Assignment = Object.fromEntries(
      score.notes.map((n) => [n.id, { finger: 1, source: 'engine' } as const]),
    );
    const fingered = injectFingerings(xml, score, assignment);
    expect(fingered.match(/<fingering/g)).toHaveLength(64);
    expect(Object.keys(parseMusicXml(fingered).editorial)).toHaveLength(64);
    expect(info).toMatchObject({ quantizedMovedShare: 0, splitMidi: 60, warnings: [] });
    expect(info.grids['16th-triplet'] + info.grids['32nd']).toBe(0);
  });
  it('separates the hands automatically and agrees with the fixture tracks on at least 62 of 64 notes', () => {
    const bytes = fixture('twinkle.mid');
    const truth = new Map(
      parseMidiFile(bytes).notes.map((n) => [`${n.tick}:${n.midi}`, n.track === 1 ? 'R' : 'L']),
    );
    const { score, info } = importMidi(bytes);
    expect(info.splitMidi).toBeNull();
    const agree = score.notes.filter(
      (n) => truth.get(`${n.onsetTick}:${n.midi}`) === n.hand,
    ).length;
    expect(agree).toBeGreaterThanOrEqual(62);
  });
  it('is deterministic', () => {
    const bytes = fixture('twinkle.mid');
    expect(importMidi(bytes).xml).toBe(importMidi(bytes).xml);
  });
  it('applies a fixed split', () => {
    const { score, info } = importMidi(fixture('twinkle.mid'), { splitMidi: 67 });
    expect(score.notes.filter((n) => n.hand === 'R')).toHaveLength(14);
    expect(info.splitMidi).toBe(67);
  });
  it('keeps the tempo map: bar 5 at 10 s and bar 7 at 18 s in tempo-map.mid', () => {
    const { score } = importMidi(fixture('tempo-map.mid'));
    const at = (m: number) =>
      ticksToSeconds(score.tempoMap, score.divisions, score.measures[m]!.startTick);
    expect(at(4)).toBeCloseTo(10, 6);
    expect(at(6)).toBeCloseTo(18, 6);
    expect(score.notes[score.notes.length - 1]!.onsetSec).toBeCloseTo(21.5, 6); // the last right-hand note
  });
  it('refuses a file without notes', () => {
    const end: MidiEvent = { deltaTime: 0, meta: true, type: 'endOfTrack' };
    const empty = new Uint8Array(
      writeMidi({ header: { format: 1, numTracks: 1, ticksPerBeat: 480 }, tracks: [[end]] }),
    );
    expect(() => importMidi(empty)).toThrow('the MIDI file contains no notes');
  });
  it('imports a 2000-note file in under two seconds (the target is 500 ms)', () => {
    const rh: MidiEvent[] = [];
    const lh: MidiEvent[] = [];
    for (let i = 0; i < 1000; i++) {
      rh.push(
        { deltaTime: 0, type: 'noteOn', channel: 0, noteNumber: 60 + ((i * 7) % 19), velocity: 80 },
        {
          deltaTime: 120,
          type: 'noteOff',
          channel: 0,
          noteNumber: 60 + ((i * 7) % 19),
          velocity: 0,
        },
      );
      lh.push(
        { deltaTime: 0, type: 'noteOn', channel: 1, noteNumber: 36 + ((i * 5) % 17), velocity: 80 },
        {
          deltaTime: 120,
          type: 'noteOff',
          channel: 1,
          noteNumber: 36 + ((i * 5) % 17),
          velocity: 0,
        },
      );
    }
    const end: MidiEvent = { deltaTime: 0, meta: true, type: 'endOfTrack' };
    const bytes = new Uint8Array(
      writeMidi({
        header: { format: 1, numTracks: 2, ticksPerBeat: 480 },
        tracks: [
          [...rh, end],
          [...lh, end],
        ],
      }),
    );
    const t0 = performance.now();
    const { score } = importMidi(bytes);
    const ms = performance.now() - t0;
    expect(score.notes).toHaveLength(2000);
    expect(ms, `${ms.toFixed(0)} ms`).toBeLessThan(2000);
  });
});
```

`packages/engine/cli/import.test.ts`:

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../src/io/musicxml/read.js';
import { main } from './run.js';
import type { CliIo } from './run.js';

const twinkle = fileURLToPath(new URL('../fixtures/twinkle.mid', import.meta.url));
function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, out, err };
}
const outFile = () => join(mkdtempSync(join(tmpdir(), 'digitus2-import-')), 'twinkle.musicxml');

describe('digitus2 import', () => {
  it('writes a MusicXML file that parseMusicXml reads back with every note', () => {
    const out = outFile();
    const c = capture();
    expect(main(['import', twinkle, '--out', out], c.io)).toBe(0);
    const { score } = parseMusicXml(readFileSync(out));
    expect(score.notes).toHaveLength(64);
    expect(score.meta.title).toBe('twinkle');
    expect(c.out.join('')).toMatch(
      /^imported twinkle\.mid: 64 notes \(\d+ right, \d+ left\), 12 measures, key C major; 0 % of notes moved more than a 64th note\n$/,
    );
    expect(c.err).toEqual([]);
  });
  it('prints the MusicXML on stdout and the summary on stderr without --out', () => {
    const c = capture();
    expect(main(['import', twinkle, '--title', 'Twinkle'], c.io)).toBe(0);
    expect(c.out.join('')).toMatch(/^<\?xml/);
    expect(c.out.join('')).toContain('<work-title>Twinkle</work-title>');
    expect(c.err.join('')).toMatch(/^imported twinkle\.mid: 64 notes/);
  });
  it('honours a fixed hand split', () => {
    const out = outFile();
    const c = capture();
    expect(main(['import', twinkle, '--out', out, '--split', '60'], c.io)).toBe(0);
    const { score } = parseMusicXml(readFileSync(out));
    expect(score.notes.filter((n) => n.hand === 'R')).toHaveLength(42);
    expect(c.out.join('')).toContain('(42 right, 22 left)');
    expect(c.out.join('')).toContain('; hand split at C4');
  });
  it('refuses a split outside the keyboard and a missing file name', () => {
    expect(main(['import', twinkle, '--split', 'x'], capture().io)).toBe(2);
    expect(main(['import', twinkle, '--split', '200'], capture().io)).toBe(2);
    expect(main(['import'], capture().io)).toBe(2);
  });
});
```

`packages/engine/cli/evalhands.test.ts`:

```ts
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatHandsScorecard, runEvalHands } from './evalhands.js';
import { main } from './run.js';

const H = '//Version: PianoFingering_v170101\n';
const row = (i: number, on: number, pitch: string, ch: number) =>
  `${i}\t${on}\t${on + 0.5}\t${pitch}\t64\t64\t${ch}\t${ch === 0 ? 1 : -1}`;
const piece = (pitches: Array<[string, number]>) =>
  H + pitches.map(([p, ch], i) => row(i, Math.floor(i / 2) * 0.5, p, ch)).join('\n') + '\n';
const twinkle = fileURLToPath(
  new URL('../../../content/scores/twinkle-twinkle-little-star.musicxml', import.meta.url),
);

function fixtureDir() {
  const root = mkdtempSync(join(tmpdir(), 'digitus2-evalhands-'));
  const gold = join(root, 'gold', 'FingeringFiles');
  mkdirSync(gold, { recursive: true });
  const twoHands: Array<[string, number]> = [
    ['C5', 0],
    ['C3', 1],
    ['D5', 0],
    ['G2', 1],
    ['E5', 0],
    ['C3', 1],
    ['F5', 0],
    ['G2', 1],
  ];
  writeFileSync(join(gold, '001-1_fingering.txt'), piece(twoHands));
  writeFileSync(join(gold, '001-2_fingering.txt'), piece(twoHands.map(([p]) => [p, 0])));
  writeFileSync(join(gold, '002-1_fingering.txt'), piece(twoHands));
  const split = join(root, 'split.json');
  writeFileSync(
    split,
    JSON.stringify({
      default_split: 'toy',
      splits: { toy: { test: { pieces: ['001', '002', '003'] } } },
    }),
  );
  const library = join(root, 'library');
  mkdirSync(join(library, 'scores'), { recursive: true });
  copyFileSync(twinkle, join(library, 'scores', 'twinkle.musicxml'));
  const manifest = join(library, 'manifest.json');
  writeFileSync(
    manifest,
    JSON.stringify([{ slug: 'twinkle', files: { score: 'scores/twinkle.musicxml' } }]),
  );
  const floor = join(root, 'floor.json');
  writeFileSync(floor, JSON.stringify({ hands: { accuracyMin: 101 } }));
  return { root, gold: join(root, 'gold'), split, manifest, floor };
}

describe('digitus2 evalhands', () => {
  it('scores every piece or lists it as skipped, uses the first annotation, and checks the floor', () => {
    const f = fixtureDir();
    const out = join(f.root, 'latest-hands.json');
    const { scorecard, floorBreaches } = runEvalHands({
      gold: f.gold,
      split: f.split,
      library: f.manifest,
      out,
      label: 'toy',
      floor: f.floor,
    });
    expect(scorecard.pig!.pieces.map((p) => p.id)).toEqual(['001', '002']);
    expect(scorecard.pig!.skipped).toEqual([{ id: '003', reason: 'no gold file' }]);
    expect(scorecard.pig!.pieces[0]!.notes).toBe(8);
    expect(scorecard.pig!.pieces[0]!.accuracy).toBeGreaterThanOrEqual(75);
    expect(scorecard.pig!.subset).toBe('test');
    expect(scorecard.library!.pieces).toEqual([
      expect.objectContaining({ id: 'twinkle', notes: 64 }),
    ]);
    expect(scorecard.library!.pieces[0]!.accuracy).toBeGreaterThanOrEqual(95);
    expect(scorecard.handSeparation.accuracy).toBe(scorecard.pig!.macro);
    expect(floorBreaches).toEqual([
      expect.stringMatching(/^hand accuracy [\d.]+ below floor 101\.00$/),
    ]);
    expect(existsSync(out)).toBe(true);
    expect(JSON.parse(readFileSync(out, 'utf8')).label).toBe('toy');
    expect(formatHandsScorecard(scorecard)).toContain('skipped 003: no gold file');
  });
  it('runs from the command line and exits 1 on a floor breach, 2 without a corpus', () => {
    const f = fixtureDir();
    const out: string[] = [];
    const err: string[] = [];
    const io = { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) };
    expect(main(['evalhands', '--library', f.manifest], io)).toBe(0);
    expect(out.join('')).toContain('library: 1 piece');
    expect(main(['evalhands', '--gold', f.gold, '--split', f.split, '--floor', f.floor], io)).toBe(
      1,
    );
    expect(err.join('')).toContain('floor breach: hand accuracy');
    expect(main(['evalhands'], io)).toBe(2);
  });
});
```

Run: `pnpm --filter @digitus2/engine exec vitest run src/io/midi/import cli/import cli/evalhands`
Expected: FAIL (modules not found).

- [ ] **Step 2: Implement `importMidi` and the exports**

`packages/engine/src/io/midi/import.ts`:

```ts
import type { Score } from '../../score/types.js';
import { parseMusicXml } from '../musicxml/read.js';
import { scoreToMusicXml } from './engrave.js';
import { separateHands } from './handSeparation.js';
import type { HandMotionParams } from './motion.js';
import { quantize, type GridKind } from './quantize.js';
import { parseMidiFile } from './read.js';
import { midiToScore } from './toScore.js';

export interface MidiImportOptions {
  splitMidi?: number;
  title?: string;
  composer?: string;
  params?: HandMotionParams;
}
export interface MidiInfo {
  quantizedMovedShare: number;
  grids: Record<GridKind, number>;
  splitMidi: number | null;
  warnings: string[];
}
export interface MidiImport {
  xml: string;
  score: Score;
  info: MidiInfo;
}

export function importMidi(bytes: Uint8Array, opts: MidiImportOptions = {}): MidiImport {
  const data = parseMidiFile(bytes);
  if (data.notes.length === 0) throw new Error('the MIDI file contains no notes');
  const quantized = quantize(data);
  const hands = separateHands(quantized.notes, {
    ...(opts.splitMidi !== undefined ? { splitMidi: opts.splitMidi } : {}),
    ...(opts.params ? { params: opts.params } : {}),
  });
  const built = midiToScore(data, quantized, hands, {
    ...(opts.title !== undefined ? { title: opts.title } : {}),
    ...(opts.composer !== undefined ? { composer: opts.composer } : {}),
  });
  const xml = scoreToMusicXml(built.score);
  // Read our own MusicXML back so sourceIndices point at its <note> elements (injectFingerings
  // needs them), then give every note the id written in its id attribute and its MIDI velocity.
  const parsed = parseMusicXml(xml).score;
  if (parsed.notes.length !== built.score.notes.length)
    throw new Error(
      `engraving lost notes (${built.score.notes.length} written, ${parsed.notes.length} read)`,
    );
  const byKey = new Map(built.score.notes.map((n) => [`${n.hand}:${n.onsetTick}:${n.midi}`, n]));
  for (const n of parsed.notes) {
    const original = byKey.get(`${n.hand}:${n.onsetTick}:${n.midi}`);
    if (!original)
      throw new Error(`engraving moved a note (${n.hand} ${n.midi} at tick ${n.onsetTick})`);
    n.id = original.id;
    if (original.velocity !== undefined) n.velocity = original.velocity;
  }
  return {
    xml,
    score: { ...parsed, meta: built.score.meta },
    info: {
      quantizedMovedShare: quantized.movedShare,
      grids: quantized.grids,
      splitMidi: opts.splitMidi ?? null,
      warnings: [...data.warnings, ...quantized.warnings, ...built.warnings],
    },
  };
}
```

`packages/engine/src/io/midi/index.ts`:

```ts
export {
  DEFAULT_US_PER_QUARTER,
  midiTickToSeconds,
  parseMidiFile,
  PERCUSSION_CHANNEL,
} from './read.js';
export type { MidiData, MidiKeySignature, MidiNote, MidiTempo, MidiTimeSignature } from './read.js';
export {
  chooseGrid,
  GRID_KINDS,
  GRID_UNIT,
  quantize,
  QUANT_DIVISIONS,
  snapTo,
} from './quantize.js';
export type { GridKind, QuantizedNote, QuantizedNotes, QuantizeOptions } from './quantize.js';
export { HAND_MOTION, loadHandMotion, motionCounts, scoreMotionCounts } from './motion.js';
export type { HandMotionCounts, HandMotionParams, HandPattern } from './motion.js';
export {
  candidateSplits,
  MAX_HAND_SPAN,
  MAX_NOTES_PER_HAND,
  separateHands,
} from './handSeparation.js';
export type { SeparateOptions } from './handSeparation.js';
export { estimateKey, keyName, spellMidi } from './key.js';
export type { KeyEstimate } from './key.js';
export { midiToScore } from './toScore.js';
export type { MidiToScoreOptions } from './toScore.js';
export { durationTable, expressDuration, scoreToMusicXml } from './engrave.js';
export type { DurationSpec, EngraveOptions, NoteTypeName } from './engrave.js';
export { importMidi } from './import.js';
export type { MidiImport, MidiImportOptions, MidiInfo } from './import.js';
```

Append to `packages/engine/src/index.ts`:

```ts
export * from './io/midi/index.js';
export { evaluateHands, scoreToMidiData } from './eval/hands.js';
export type { HandEval } from './eval/hands.js';
```

- [ ] **Step 3: Implement the two commands**

`packages/engine/cli/import.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { importMidi } from '../src/io/midi/import.js';
import { keyName } from '../src/io/midi/key.js';
import { formatPigPitch, midiToSpelling } from '../src/score/pitch.js';

export interface ImportOptions {
  file: string;
  out?: string;
  split?: number;
  title?: string;
}

export function importFile(o: ImportOptions): { xml: string; summary: string; warnings: string[] } {
  const bytes = new Uint8Array(readFileSync(o.file));
  const title = o.title ?? basename(o.file, extname(o.file));
  const { xml, score, info } = importMidi(bytes, {
    title,
    ...(o.split !== undefined ? { splitMidi: o.split } : {}),
  });
  if (o.out) writeFileSync(o.out, xml);
  const right = score.notes.filter((n) => n.hand === 'R').length;
  const key = score.keySignatures[0] ?? { tick: 0, fifths: 0 };
  const summary =
    `imported ${basename(o.file)}: ${score.notes.length} notes (${right} right, ${score.notes.length - right} left), ` +
    `${score.measures.length} measures, key ${keyName(key)}; ` +
    `${Math.round(info.quantizedMovedShare * 100)} % of notes moved more than a 64th note` +
    (info.splitMidi !== null
      ? `; hand split at ${formatPigPitch(midiToSpelling(info.splitMidi))}`
      : '');
  return { xml, summary, warnings: info.warnings };
}
```

`packages/engine/cli/evalhands.ts`:

```ts
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { evaluateHands } from '../src/eval/hands.js';
import { HAND_MOTION, loadHandMotion } from '../src/io/midi/motion.js';
import { parseMusicXml } from '../src/io/musicxml/read.js';
import { parsePig } from '../src/io/pig/read.js';
import type { Score } from '../src/score/types.js';
import { ENGINE_VERSION } from '../src/version.js';

export interface EvalHandsOptions {
  gold?: string;
  split?: string;
  splitName?: string;
  subset?: 'test' | 'train';
  library?: string;
  params?: string;
  out?: string;
  label?: string;
  floor?: string;
}
export interface HandPieceResult {
  id: string;
  notes: number;
  accuracy: number;
  ms: number;
}
export interface HandSetResult {
  macro: number;
  noteWeighted: number;
  pieces: HandPieceResult[];
  skipped: Array<{ id: string; reason: string }>;
}
export interface HandsScorecard {
  version: 1;
  engineVersion: string;
  gitSha: string;
  label: string;
  timestamp: string;
  params: { file: string; sha256: string };
  handSeparation: { accuracy: number | null };
  pig: (HandSetResult & { split: string; splitName: string; subset: string }) | null;
  library: (HandSetResult & { manifest: string }) | null;
}

function gitSha(): string {
  try {
    return execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function scoreSet(
  items: Array<{ id: string; load: () => Score | string }>,
  params = HAND_MOTION,
): HandSetResult {
  const pieces: HandPieceResult[] = [];
  const skipped: HandSetResult['skipped'] = [];
  for (const item of items) {
    try {
      const loaded = item.load();
      if (typeof loaded === 'string') {
        skipped.push({ id: item.id, reason: loaded });
        continue;
      }
      const t0 = performance.now();
      const r = evaluateHands(loaded, { params });
      pieces.push({
        id: item.id,
        notes: r.notes,
        accuracy: r.accuracy,
        ms: performance.now() - t0,
      });
    } catch (e) {
      skipped.push({ id: item.id, reason: message(e) });
    }
  }
  const notes = pieces.reduce((s, p) => s + p.notes, 0);
  return {
    macro: pieces.length ? pieces.reduce((s, p) => s + p.accuracy, 0) / pieces.length : 0,
    noteWeighted: notes ? pieces.reduce((s, p) => s + p.accuracy * p.notes, 0) / notes : 0,
    pieces,
    skipped,
  };
}

export function runEvalHands(o: EvalHandsOptions): {
  scorecard: HandsScorecard;
  floorBreaches: string[];
} {
  const paramsText = o.params ? readFileSync(o.params, 'utf8') : JSON.stringify(HAND_MOTION);
  const params = o.params ? loadHandMotion(JSON.parse(paramsText)) : HAND_MOTION;
  let pig: HandsScorecard['pig'] = null;
  if (o.gold && o.split) {
    const json = JSON.parse(readFileSync(o.split, 'utf8')) as {
      default_split?: string;
      splits: Record<string, Record<string, { pieces: string[] }>>;
    };
    const subset = o.subset ?? 'test';
    const splitName = o.splitName ?? json.default_split ?? Object.keys(json.splits)[0]!;
    const ids = json.splits[splitName]?.[subset]?.pieces;
    if (!ids) throw new Error(`split ${splitName}/${subset} not found in ${o.split}`);
    const dir = existsSync(join(o.gold, 'FingeringFiles'))
      ? join(o.gold, 'FingeringFiles')
      : o.gold;
    const files = readdirSync(dir);
    const set = scoreSet(
      ids.map((id) => ({
        id,
        load: () => {
          const first = files
            .filter((f) => new RegExp(`^${escapeRegExp(id)}-\\d+_fingering\\.txt$`).test(f))
            .sort()[0];
          return first ? parsePig(readFileSync(join(dir, first), 'utf8')).score : 'no gold file';
        },
      })),
      params,
    );
    pig = { ...set, split: o.split, splitName, subset };
  }
  let library: HandsScorecard['library'] = null;
  if (o.library) {
    const manifestPath = o.library;
    const entries = JSON.parse(readFileSync(manifestPath, 'utf8')) as Array<{
      slug: string;
      files: { score: string };
    }>;
    const set = scoreSet(
      entries.map((e) => ({
        id: e.slug,
        load: () =>
          parseMusicXml(readFileSync(resolve(dirname(manifestPath), e.files.score))).score,
      })),
      params,
    );
    library = { ...set, manifest: manifestPath };
  }
  const scorecard: HandsScorecard = {
    version: 1,
    engineVersion: ENGINE_VERSION,
    gitSha: gitSha(),
    label: o.label ?? 'evalhands',
    timestamp: new Date().toISOString(),
    params: {
      file: o.params ?? 'packages/engine/src/io/midi/params/hand-motion.json',
      sha256: createHash('sha256').update(paramsText).digest('hex').slice(0, 16),
    },
    handSeparation: { accuracy: pig ? pig.macro : null },
    pig,
    library,
  };
  if (o.out) {
    mkdirSync(dirname(o.out), { recursive: true });
    writeFileSync(o.out, JSON.stringify(scorecard, null, 2) + '\n');
  }
  const floorBreaches: string[] = [];
  if (o.floor && existsSync(o.floor)) {
    const floor = JSON.parse(readFileSync(o.floor, 'utf8')) as {
      hands?: { accuracyMin?: number | null };
    };
    const min = floor.hands?.accuracyMin;
    if (typeof min === 'number') {
      if (!pig || pig.pieces.length === 0)
        floorBreaches.push('no PIG pieces were scored against the hand floor');
      else if (pig.macro < min - 0.005)
        floorBreaches.push(`hand accuracy ${pig.macro.toFixed(2)} below floor ${min.toFixed(2)}`);
    }
  }
  return { scorecard, floorBreaches };
}

export function formatHandsScorecard(card: HandsScorecard): string {
  const lines = [
    `evalhands ${card.label} @ ${card.gitSha.slice(0, 7)} engine ${card.engineVersion} params ${card.params.sha256}`,
  ];
  const describe = (name: string, set: HandSetResult) => {
    const count = `${set.pieces.length} piece${set.pieces.length === 1 ? '' : 's'}`;
    lines.push(
      `${name}: ${count}, ${set.skipped.length} skipped, macro ${set.macro.toFixed(2)} %, note-weighted ${set.noteWeighted.toFixed(2)} %`,
    );
    const worst = [...set.pieces].sort((a, b) => a.accuracy - b.accuracy).slice(0, 3);
    if (worst.length)
      lines.push(`  weakest: ${worst.map((p) => `${p.id} ${p.accuracy.toFixed(1)}`).join(', ')}`);
    for (const s of set.skipped) lines.push(`  skipped ${s.id}: ${s.reason}`);
  };
  if (card.pig) describe(`pig ${card.pig.splitName}/${card.pig.subset}`, card.pig);
  if (card.library) describe('library', card.library);
  return lines.join('\n');
}
```

In `packages/engine/cli/run.ts`, add to `USAGE` (the word `evalhands` must appear: `scripts/verify.mjs` detects it):

```
  import <file.mid> [--out f.musicxml] [--split <midi 21..108>] [--title t]
  evalhands [--gold <dir> --split <json> [--split-name n] [--subset test|train]] [--library manifest.json] [--params hand-motion.json] [--out f.json] [--label l] [--floor floor.json] [--json]
```

and these branches to `dispatch`, next to the existing commands:

```ts
if (command === 'import') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { out: { type: 'string' }, split: { type: 'string' }, title: { type: 'string' } },
  });
  const file = positionals[0];
  const split = values.split === undefined ? undefined : Number(values.split);
  if (!file || (split !== undefined && !(Number.isInteger(split) && split >= 21 && split <= 108))) {
    io.stderr(USAGE);
    return 2;
  }
  const r = importFile({
    file,
    ...(values.out ? { out: values.out } : {}),
    ...(split !== undefined ? { split } : {}),
    ...(values.title ? { title: values.title } : {}),
  });
  const report = [r.summary, ...r.warnings.map((w) => `warning: ${w}`)].join('\n') + '\n';
  if (values.out) io.stdout(report);
  else {
    io.stdout(r.xml);
    io.stderr(report);
  }
  return 0;
}
if (command === 'evalhands') {
  const { values } = parseArgs({
    args: rest,
    options: {
      gold: { type: 'string' },
      split: { type: 'string' },
      'split-name': { type: 'string' },
      subset: { type: 'string' },
      library: { type: 'string' },
      params: { type: 'string' },
      out: { type: 'string' },
      label: { type: 'string' },
      floor: { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  const subset = values.subset;
  if (
    (!values.library && !(values.gold && values.split)) ||
    (subset !== undefined && subset !== 'test' && subset !== 'train')
  ) {
    io.stderr(USAGE);
    return 2;
  }
  const { scorecard, floorBreaches } = runEvalHands({
    ...(values.gold ? { gold: values.gold } : {}),
    ...(values.split ? { split: values.split } : {}),
    ...(values['split-name'] ? { splitName: values['split-name'] } : {}),
    ...(subset ? { subset } : {}),
    ...(values.library ? { library: values.library } : {}),
    ...(values.params ? { params: values.params } : {}),
    ...(values.out ? { out: values.out } : {}),
    ...(values.label ? { label: values.label } : {}),
    ...(values.floor ? { floor: values.floor } : {}),
  });
  io.stdout(
    (values.json ? JSON.stringify(scorecard, null, 2) : formatHandsScorecard(scorecard)) + '\n',
  );
  for (const b of floorBreaches) io.stderr(`floor breach: ${b}\n`);
  return floorBreaches.length > 0 ? 1 : 0;
}
```

with `import { importFile } from './import.js';` and `import { formatHandsScorecard, runEvalHands } from './evalhands.js';` at the top.

- [ ] **Step 4: Wire the floor and the verify step**

Add the `hands` block shown above to `benchmarks/floor.json` (keep every other field). In `scripts/verify.mjs`, add `hands` to the step list in the header comment and this block after the `benchmark` step:

```js
if (want('hands')) {
  const floorPath = 'benchmarks/floor.json';
  const cli = 'packages/engine/dist/cli/main.js';
  const floor = existsSync(floorPath) ? JSON.parse(readFileSync(floorPath, 'utf8')) : null;
  const usage = existsSync(cli)
    ? spawnSync('node', [cli], { encoding: 'utf8', shell: true })
    : null;
  const hasEvalHands = usage && /\bevalhands\b/.test(`${usage.stdout}${usage.stderr}`);
  if (!floor?.hands) skip('hands', 'no hands block in benchmarks/floor.json');
  else if (!hasEvalHands) skip('hands', 'engine CLI has no evalhands command yet');
  else if (!existsSync(floor.goldDir)) skip('hands', `dataset missing: ${floor.goldDir}`);
  else {
    const args = [
      cli,
      'evalhands',
      '--gold',
      floor.goldDir,
      '--split',
      floor.split,
      '--subset',
      'test',
      '--library',
      'content/manifest.json',
      '--out',
      'benchmarks/latest-hands.json',
      '--label',
      'verify',
    ];
    if (typeof floor.hands.accuracyMin === 'number') args.push('--floor', floorPath);
    run('hands', 'node', args);
  }
}
```

In `docs/verification-loop.md`, add to "Levels" after item 3: `3b. Hand-separation gate: \`digitus2 evalhands\` scores the MIDI hand separation on the PIG test split (first annotation per piece, channel = truth) and on the 30 library pieces (staff = truth), writes \`benchmarks/latest-hands.json\`, and fails \`pnpm verify\` (step \`hands\`) when the PIG macro accuracy drops below \`hands.accuracyMin\` in \`benchmarks/floor.json\`.`

- [ ] **Step 5: Run the tests and try the commands**

Run:

```bash
pnpm --filter @digitus2/engine exec vitest run && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint && pnpm build
node packages/engine/dist/cli/main.js import packages/engine/fixtures/twinkle.mid --out "$TEMP/twinkle.musicxml"
node packages/engine/dist/cli/main.js evalhands --library content/manifest.json
```

Expected: all tests pass; `import` prints `imported twinkle.mid: 64 notes (…)`; `evalhands` prints the library line with 30 pieces and their macro accuracy. Record in your report the measured `importMidi` time of the 2000-note case (print it once with a temporary `console.log`, then remove it).

Run: `pnpm verify`
Expected: all PASS; the new `hands` step runs when the PIG data is present (it has no floor yet, so it only reports) and SKIPs with its reason otherwise.

- [ ] **Step 6: Hand-off**

Paths: `packages/engine/src/io/midi/import.ts`, `packages/engine/src/io/midi/import.test.ts`, `packages/engine/src/io/midi/index.ts`, `packages/engine/src/index.ts`, `packages/engine/cli/import.ts`, `packages/engine/cli/import.test.ts`, `packages/engine/cli/evalhands.ts`, `packages/engine/cli/evalhands.test.ts`, `packages/engine/cli/run.ts`, `benchmarks/floor.json`, `benchmarks/latest-hands.json` (if the step wrote it), `scripts/verify.mjs`, `docs/verification-loop.md`. Message: `feat(engine): importMidi, digitus2 import and evalhands, hand-separation gate in verify`.

---

### Task 7: The engine worker loads MIDI; Verovio renders generated MusicXML

**Files:**

- Modify: `apps/web/src/engine/protocol.ts`, `apps/web/src/engine/handlers.ts`, `apps/web/src/engine/handlers.test.ts`, `apps/web/src/engine/client.ts`, `apps/web/src/engine/client.test.ts`, `apps/web/src/score/useScoreDocument.test.ts` (its inline engine builds `load` requests, which now need `kind`)
- Create: `apps/web/src/score/render/verovio.midi.node.test.ts`

**Interfaces:**

- Consumes: `importMidi`, `MidiInfo`, `scoreToMusicXml`, `finalizeScore`, `midiToSpelling`, `injectFingerings`, `solveFingering`, `RECOMMENDED_WEIGHT_SET` from `@digitus2/engine`; M4 Task 4's `EngineRequest`, `EngineResponse`, `handle`, `EngineClient`, `createEngineClient`, `WorkerLike`; M4 Task 5's `injectNoteIds`, `verovioOptions` and its Node render pattern.
- Produces (changes to M4 Task 4's definitions; everything else in those files stays as it is):

```ts
// protocol.ts
import type { MidiInfo } from '@digitus2/engine';
export type SourceKind = 'musicxml' | 'midi';
export function sourceKind(name: string): SourceKind; // '.mid' or '.midi' (any case) -> 'midi', otherwise 'musicxml'
// the load members of the unions become:
//   | { id: number; type: 'load'; kind: SourceKind; input: string | Uint8Array; source: string; splitMidi?: number }
//   | { id: number; ok: true; type: 'load'; score: Score; editorial: Assignment; warnings: string[]; xml: string; midiInfo: MidiInfo | null }

// client.ts
//   load(input: string | Uint8Array, source: string, opts?: { splitMidi?: number }):
//     Promise<{ score: Score; editorial: Assignment; warnings: string[]; xml: string; midiInfo: MidiInfo | null }>;
//   the client sets kind = sourceKind(source) and passes splitMidi only when given.
```

For `kind: 'midi'` the handler runs `importMidi(bytes, { title, splitMidi })` with `title` = the file name without folder and extension, and answers with the generated MusicXML as `xml`, the re-read `score` (ids `m…`, the same strings as the `id` attributes, so `injectNoteIds` keeps them and Verovio draws them), `editorial: {}`, `warnings: info.warnings` and `midiInfo: info`. MusicXML loads answer `midiInfo: null`. The rest of the pipeline (`solve`, `fingeredXml`, render) is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/engine/handlers.test.ts`, putting the new `import` line with the file's other imports, and add `kind: 'musicxml'` to the `load` requests the file already builds:

```ts
import { sourceKind } from './protocol.js';

const midi = new Uint8Array(readFileSync(new URL('../../fixtures/twinkle.mid', import.meta.url)));

describe('engine handlers: MIDI', () => {
  it('loads a MIDI file as generated MusicXML with two hands and 64 notes', () => {
    const r = handle({ id: 11, type: 'load', kind: 'midi', input: midi, source: 'twinkle.mid' });
    if (!r.ok || r.type !== 'load') throw new Error(r.ok ? 'wrong response type' : r.error);
    expect(r.score.notes).toHaveLength(64);
    const right = r.score.notes.filter((n) => n.hand === 'R').length;
    expect(right).toBeGreaterThan(0);
    expect(64 - right).toBeGreaterThan(0);
    expect(Math.abs(right - 42)).toBeLessThanOrEqual(2);
    expect(r.xml).toContain('<work-title>twinkle</work-title>');
    for (const n of r.score.notes) expect(r.xml).toContain(`<note id="${n.id}">`);
    expect(r.editorial).toEqual({});
    expect(r.midiInfo).toMatchObject({ quantizedMovedShare: 0, splitMidi: null });
  });
  it('honours a fixed hand split and runs the rest of the pipeline unchanged', () => {
    const r = handle({
      id: 12,
      type: 'load',
      kind: 'midi',
      input: midi,
      source: 'twinkle.mid',
      splitMidi: 60,
    });
    if (!r.ok || r.type !== 'load') throw new Error(r.ok ? 'wrong response type' : r.error);
    expect(r.score.notes.filter((n) => n.hand === 'R')).toHaveLength(42);
    expect(r.midiInfo?.splitMidi).toBe(60);
    expect(r.warnings).toEqual([]);
    const solved = handle({ id: 13, type: 'solve', score: r.score, profile: 'medium' });
    if (!solved.ok || solved.type !== 'solve') throw new Error('solve failed');
    expect(Object.keys(solved.assignment)).toHaveLength(64);
    const out = handle({
      id: 14,
      type: 'fingeredXml',
      xml: r.xml,
      score: r.score,
      assignment: solved.assignment,
    });
    if (!out.ok || out.type !== 'fingeredXml') throw new Error('inject failed');
    expect(out.xml.match(/<fingering/g)).toHaveLength(64);
  });
  it('answers a MusicXML load with midiInfo null', () => {
    const r = handle({
      id: 15,
      type: 'load',
      kind: 'musicxml',
      input: bytes,
      source: 'short-piano.musicxml',
    });
    if (!r.ok || r.type !== 'load') throw new Error('load failed');
    expect(r.midiInfo).toBeNull();
  });
  it('reports a broken MIDI file as an error response', () => {
    const r = handle({
      id: 16,
      type: 'load',
      kind: 'midi',
      input: new TextEncoder().encode('MThd'),
      source: 'broken.mid',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^not a MIDI file/);
  });
  it('decides the kind from the file name', () => {
    expect(sourceKind('Tune.MID')).toBe('midi');
    expect(sourceKind('a.midi')).toBe('midi');
    expect(sourceKind('a.musicxml')).toBe('musicxml');
    expect(sourceKind('a.mxl')).toBe('musicxml');
  });
});
```

(`bytes` is the short-piano fixture the file already reads.)

Append to `apps/web/src/engine/client.test.ts`:

```ts
it('sends the source kind and the hand split with a load', async () => {
  const sent: EngineRequest[] = [];
  const c = createEngineClient(
    fakeWorker((req) => {
      sent.push(req);
      return { id: req.id, ok: false, error: 'stop' };
    }),
  );
  await expect(c.load(new Uint8Array([1]), 'tune.mid', { splitMidi: 60 })).rejects.toThrow('stop');
  await expect(c.load('<x/>', 'a.musicxml')).rejects.toThrow('stop');
  expect(sent.map((r) => (r.type === 'load' ? [r.kind, r.splitMidi] : null))).toEqual([
    ['midi', 60],
    ['musicxml', undefined],
  ]);
});
```

In `apps/web/src/score/useScoreDocument.test.ts`, the inline engine's `load` becomes:

```ts
    load: (input, source, opts) =>
      run({
        id: ++id,
        type: 'load',
        kind: sourceKind(source),
        input,
        source,
        ...(opts?.splitMidi !== undefined ? { splitMidi: opts.splitMidi } : {}),
      }).then((r) => r as never),
```

with `import { sourceKind } from '../engine/protocol.js';`.

`apps/web/src/score/render/verovio.midi.node.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import {
  finalizeScore,
  importMidi,
  injectFingerings,
  midiToSpelling,
  RECOMMENDED_WEIGHT_SET,
  scoreToMusicXml,
  solveFingering,
} from '@digitus2/engine';
import type { Hand, Note, Score } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { injectNoteIds } from './injectIds.js';
import { verovioOptions } from './options.js';

async function toolkit() {
  const { default: createVerovioModule } = await import('verovio/wasm');
  const { VerovioToolkit } = await import('verovio/esm');
  const tk = new VerovioToolkit(await createVerovioModule());
  tk.setOptions(verovioOptions(900));
  return tk;
}
function render(tk: Awaited<ReturnType<typeof toolkit>>, xml: string): string {
  expect(tk.loadData(xml)).toBe(true);
  return Array.from({ length: tk.getPageCount() }, (_, i) => tk.renderToSVG(i + 1)).join('');
}
const hasNote = (svg: string, id: string) =>
  new RegExp(`<g[^>]*\\bid="${id}"[^>]*class="note"|<g[^>]*class="note"[^>]*\\bid="${id}"`).test(
    svg,
  );

/** Lengths of 5, 7 and 9 sixteenths (the last across a barline), eighth triplets, 32nd notes. */
function awkwardScore(): Score {
  const spec: Array<[number, number, number, Hand]> = [
    [0, 600, 60, 'R'],
    [600, 1440, 62, 'R'],
    [1440, 2520, 64, 'R'],
    [2520, 2640, 65, 'R'],
    [2640, 2880, 67, 'R'],
    [2880, 3040, 69, 'R'],
    [3040, 3200, 71, 'R'],
    [3200, 3360, 72, 'R'],
    [3360, 3420, 74, 'R'],
    [3420, 3480, 72, 'R'],
    [3480, 3840, 71, 'R'],
    [0, 1920, 48, 'L'],
    [1920, 3840, 43, 'L'],
  ];
  return finalizeScore({
    meta: { title: 'awkward' },
    divisions: 480,
    tempoMap: [{ tick: 0, qpm: 90 }],
    timeSignatures: [{ tick: 0, beats: 4, beatType: 4 }],
    keySignatures: [{ tick: 0, fifths: 0 }],
    measures: [0, 1].map((i) => ({
      index: i,
      startTick: i * 1920,
      lengthTicks: 1920,
      number: String(i + 1),
    })),
    notes: spec.map(([onset, offset, midi, hand], i): Note => ({
      id: `a${i}`,
      onsetTick: onset,
      offsetTick: offset,
      onsetSec: 0,
      offsetSec: 0,
      midi,
      spelling: midiToSpelling(midi),
      hand,
      staff: hand === 'R' ? 1 : 2,
      voice: hand === 'R' ? 1 : 5,
      measureIndex: Math.floor(onset / 1920),
      isGrace: false,
      chordId: '',
      sourceIndices: [],
    })),
  });
}

describe('verovio renders generated MusicXML', () => {
  it('keeps every note id of an imported MIDI file and tags every fingering digit with its note', async () => {
    const tk = await toolkit();
    const { xml, score } = importMidi(
      new Uint8Array(readFileSync(new URL('../../../fixtures/twinkle.mid', import.meta.url))),
      { title: 'twinkle' },
    );
    const { assignment } = solveFingering(score, {
      profile: 'medium',
      weightSet: RECOMMENDED_WEIGHT_SET,
    });
    const svg = render(tk, injectNoteIds(injectFingerings(xml, score, assignment), score));
    for (const n of score.notes) expect(hasNote(svg, n.id), n.id).toBe(true);
    const digits =
      svg.match(/class="fing"[^>]*data-startid="#m\d+"|data-startid="#m\d+"[^>]*class="fing"/g) ??
      [];
    expect(digits).toHaveLength(64);
    tk.destroy();
  }, 30_000);
  it('renders tuplets, dotted values, ties across barlines and odd lengths written as tied notes', async () => {
    const tk = await toolkit();
    const score = awkwardScore();
    const svg = render(tk, scoreToMusicXml(score));
    for (const n of score.notes) expect(hasNote(svg, n.id), n.id).toBe(true);
    expect(svg).toMatch(/class="tuplet"/);
    expect(svg).toMatch(/class="tie"/);
    expect(svg).toMatch(/class="dots?"/);
    tk.destroy();
  }, 30_000);
});
```

(If Verovio prints the `class` and `id` attributes in another order, the alternations above already cover both orders. If the dots group is named differently in Verovio 6.3, read one rendered SVG and use its class name; do not drop the assertion.)

Run: `pnpm --filter @digitus2/web test`
Expected: FAIL (type errors on `kind`, missing `sourceKind`, MIDI loads answered as MusicXML parse errors).

- [ ] **Step 2: Implement**

`protocol.ts`: add `SourceKind`, `sourceKind` (`/\.midi?$/i.test(name) ? 'midi' : 'musicxml'`) and the two changed union members shown above.

`handlers.ts`, the `load` case:

```ts
      case 'load': {
        if (req.kind === 'midi') {
          if (typeof req.input === 'string') throw new Error('a MIDI file must be passed as bytes');
          const { xml, score, info } = importMidi(req.input, {
            title: titleOf(req.source),
            ...(req.splitMidi !== undefined ? { splitMidi: req.splitMidi } : {}),
          });
          return { id: req.id, ok: true, type: 'load', score, editorial: {}, warnings: info.warnings, xml, midiInfo: info };
        }
        const xml = unpackMusicXml(req.input);
        const { score, editorial, warnings } = parseMusicXml(xml, { source: req.source });
        return { id: req.id, ok: true, type: 'load', score, editorial, warnings, xml, midiInfo: null };
      }
```

with `importMidi` added to the engine import and, at module level:

```ts
/** 'folder/Twinkle.mid' -> 'Twinkle': the title of a MIDI import. */
function titleOf(source: string): string {
  return source.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
}
```

`client.ts`: `load(input, source, opts)` posts `{ type: 'load', kind: sourceKind(source), input, source, ...(opts?.splitMidi !== undefined ? { splitMidi: opts.splitMidi } : {}) }` and resolves with `{ score, editorial, warnings, xml, midiInfo }`.

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @digitus2/web test && pnpm --filter @digitus2/web typecheck`
Expected: PASS, including both Verovio contract tests (each needs a couple of seconds for the WASM).

Run: `pnpm verify`
Expected: all PASS (the e2e suite is unchanged by this task; the bundle step must still pass: `midi-file` adds about 3 KB to the engine worker chunk, not to the entry).

- [ ] **Step 4: Hand-off**

Paths: `apps/web/src/engine/protocol.ts`, `apps/web/src/engine/handlers.ts`, `apps/web/src/engine/handlers.test.ts`, `apps/web/src/engine/client.ts`, `apps/web/src/engine/client.test.ts`, `apps/web/src/score/useScoreDocument.test.ts`, `apps/web/src/score/render/verovio.midi.node.test.ts`. Message: `feat(web): the engine worker imports MIDI; Verovio contract for generated MusicXML`.

---

### Task 8: The app: drop a MIDI file, see the import, change the hand split, export

**Files:**

- Create: `apps/web/src/score/midiCopy.ts`, `apps/web/src/score/midiCopy.test.ts`, `apps/web/src/score/MidiImportPanel.tsx`, `apps/web/src/score/MidiImportPanel.test.tsx`, `apps/web/src/score/useScoreDocument.midi.test.ts`, `apps/web/e2e/midi.spec.ts`
- Modify: `apps/web/src/library/DropZone.tsx`, `apps/web/src/library/DropZone.test.tsx`, `apps/web/src/score/useScoreDocument.ts`, `apps/web/src/score/SidePanel.tsx`, `apps/web/src/score/ScoreView.tsx` (only to pass `setSplitMidi` to the side panel), `apps/web/src/export/download.test.ts`, `apps/web/src/about/AboutView.tsx`, `apps/web/src/about/AboutView.test.tsx`, `apps/web/src/design/base.css` (`.midi-import` spacing only, no color), `apps/web/e2e/library.spec.ts`, `apps/web/e2e/states.spec.ts`, `docs/app.md`

**Interfaces:**

- Consumes: Task 7's `sourceKind`, `EngineClient.load(input, source, opts?)` with `midiInfo`; `MidiInfo`, `GridKind` from `@digitus2/engine`; M4's `useScoreDocument`, `ScoreDocument`, `SidePanel`, `exportFilename`, `downloadText`, `AboutView`, the e2e helpers `expectOneRed` and `expectNoSeriousA11y`.
- Produces:

```ts
// midiCopy.ts
export const SPLIT_KEYS: readonly number[]; // 36..84 (C2..C6)
export const SPLIT_HELP: string; // 'Keys from the chosen note upward go to the right hand.'
export function noteName(midi: number): string; // 60 -> 'C4', 61 -> 'C#4'
export function gridPhrase(grids: Record<GridKind, number>): string;
export function importLine(info: MidiInfo): string;
export function handCountLine(right: number, left: number): string;

// MidiImportPanel.tsx
export interface MidiImportPanelProps {
  info: MidiInfo;
  right: number;
  left: number;
  splitMidi: number | null;
  onSplitChange(value: number | null): void;
}
export function MidiImportPanel(props: MidiImportPanelProps); // a <section aria-label="MIDI import">, never red

// useScoreDocument.ts (additions to M4 Task 6)
//   ScoreDocument gains   midiInfo: MidiInfo | null;   splitMidi: number | null;
//   useScoreDocument(...) returns ScoreDocument & { reRender(): void; setSplitMidi(value: number | null): void }
```

Exact copy (the implementer does not invent prose):

- Drop zone: `Drop a MusicXML or MIDI file here (.musicxml, .xml, .mxl, .mid or .midi), or` followed by the existing `choose a file` label; the file input's `accept` becomes `.musicxml,.xml,.mxl,.mid,.midi`.
- Refusal for any other extension (the constant `NOT_A_SCORE_REFUSAL`, replacing `NOT_MUSICXML_REFUSAL`; `MIDI_REFUSAL` is deleted): `That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).`
- Side panel, MIDI sources only, at the top of the panel in a `<section aria-label="MIDI import">`:
  - `Imported from MIDI: notes quantized to <grid>; <p> % moved more than a 64th note`, where `<grid>` is `a 16th-note grid`, `a 16th-note grid with triplets`, `a 32nd-note grid` or `a 32nd-note grid with triplets` (32nd when any beat used 32nd notes, "with triplets" when any beat used triplets) and `<p>` is the rounded percentage.
  - `Right hand: <n> notes · left hand: <m> notes` (`1 note` when one).
  - A `<label for="hand-split">Hand split</label>` and `<select id="hand-split">` with the option `Automatic` (value `auto`) and the keys C2 to C6 by name (`C2`, `C#2`, …, `C6`; values `36` … `84`).
  - `Keys from the chosen note upward go to the right hand.`
- About page, in the Licences list after the Verovio line: `MIDI files are read with midi-file (MIT).`, with `midi-file` linking to https://github.com/carter-thaxton/midi-file.
- Nothing in this task is red; the score view keeps its single red element (the Play button, or the cursor while playing).

Behaviour: choosing a key in `Hand split` calls `setSplitMidi(key)`, which re-runs the open pipeline for the same bytes with `engine.load(bytes, name, { splitMidi: key })`, then solves, injects and renders as usual; `Automatic` calls `setSplitMidi(null)` and re-imports without the option. The split is per document and is not persisted. Export of a MIDI source downloads the generated MusicXML with the shown fingerings (M4's export path, unchanged) as `<basename>.fingered.musicxml`.

- [ ] **Step 1: Write the failing unit tests**

`apps/web/src/score/midiCopy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  gridPhrase,
  handCountLine,
  importLine,
  noteName,
  SPLIT_HELP,
  SPLIT_KEYS,
} from './midiCopy.js';

describe('MIDI copy', () => {
  it('names the grid the import used', () => {
    expect(gridPhrase({ '16th': 3, '16th-triplet': 0, '32nd': 0 })).toBe('a 16th-note grid');
    expect(gridPhrase({ '16th': 3, '16th-triplet': 1, '32nd': 0 })).toBe(
      'a 16th-note grid with triplets',
    );
    expect(gridPhrase({ '16th': 3, '16th-triplet': 0, '32nd': 2 })).toBe('a 32nd-note grid');
    expect(gridPhrase({ '16th': 0, '16th-triplet': 1, '32nd': 2 })).toBe(
      'a 32nd-note grid with triplets',
    );
  });
  it('writes the import line with a rounded percentage', () => {
    expect(
      importLine({
        quantizedMovedShare: 0.034,
        grids: { '16th': 8, '16th-triplet': 0, '32nd': 0 },
        splitMidi: null,
        warnings: [],
      }),
    ).toBe(
      'Imported from MIDI: notes quantized to a 16th-note grid; 3 % moved more than a 64th note',
    );
  });
  it('counts notes per hand', () => {
    expect(handCountLine(42, 22)).toBe('Right hand: 42 notes · left hand: 22 notes');
    expect(handCountLine(1, 0)).toBe('Right hand: 1 note · left hand: 0 notes');
  });
  it('offers the keys from C2 to C6 by name and explains the split', () => {
    expect(SPLIT_KEYS).toHaveLength(49);
    expect(SPLIT_KEYS.slice(0, 3).map(noteName)).toEqual(['C2', 'C#2', 'D2']);
    expect(noteName(60)).toBe('C4');
    expect(noteName(SPLIT_KEYS[SPLIT_KEYS.length - 1]!)).toBe('C6');
    expect(SPLIT_HELP).toBe('Keys from the chosen note upward go to the right hand.');
  });
});
```

`apps/web/src/score/MidiImportPanel.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MidiImportPanel } from './MidiImportPanel.js';

afterEach(cleanup);
const info = {
  quantizedMovedShare: 0.03,
  grids: { '16th': 10, '16th-triplet': 0, '32nd': 0 },
  splitMidi: null,
  warnings: [],
};

describe('MidiImportPanel', () => {
  it('shows the import facts, the hand counts and the hand split control', () => {
    render(
      <MidiImportPanel info={info} right={42} left={22} splitMidi={null} onSplitChange={vi.fn()} />,
    );
    expect(
      screen.getByText(
        'Imported from MIDI: notes quantized to a 16th-note grid; 3 % moved more than a 64th note',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Right hand: 42 notes · left hand: 22 notes')).toBeInTheDocument();
    expect(
      screen.getByText('Keys from the chosen note upward go to the right hand.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Hand split')).toHaveValue('auto');
    expect(screen.getAllByRole('option')).toHaveLength(50);
    expect(screen.getByRole('option', { name: 'Automatic' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'MIDI import' })).toBeInTheDocument();
  });
  it('reports a chosen key and a return to Automatic', async () => {
    const onSplitChange = vi.fn();
    const { rerender } = render(
      <MidiImportPanel
        info={info}
        right={42}
        left={22}
        splitMidi={null}
        onSplitChange={onSplitChange}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText('Hand split'), 'G4');
    expect(onSplitChange).toHaveBeenLastCalledWith(67);
    rerender(
      <MidiImportPanel
        info={{ ...info, splitMidi: 67 }}
        right={14}
        left={50}
        splitMidi={67}
        onSplitChange={onSplitChange}
      />,
    );
    expect(screen.getByLabelText('Hand split')).toHaveValue('67');
    await userEvent.selectOptions(screen.getByLabelText('Hand split'), 'Automatic');
    expect(onSplitChange).toHaveBeenLastCalledWith(null);
  });
  it('has no red element', () => {
    const { container } = render(
      <MidiImportPanel info={info} right={1} left={1} splitMidi={null} onSplitChange={vi.fn()} />,
    );
    expect(container.querySelectorAll('.is-red')).toHaveLength(0);
  });
});
```

`apps/web/src/score/useScoreDocument.midi.test.ts`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import type { EngineClient } from '../engine/client.js';
import { handle } from '../engine/handlers.js';
import { sourceKind } from '../engine/protocol.js';
import type { ScoreRenderer } from './render/renderer.js';
import { useScoreDocument } from './useScoreDocument.js';

const twinkle = new Uint8Array(
  readFileSync(new URL('../../fixtures/twinkle.mid', import.meta.url)),
);
const shortPiano = new Uint8Array(
  readFileSync(new URL('../../fixtures/short-piano.musicxml', import.meta.url)),
);

function inlineEngine(): EngineClient & { splits: Array<number | undefined> } {
  let id = 0;
  const splits: Array<number | undefined> = [];
  const run = (req: Parameters<typeof handle>[0]) => {
    const r = handle(req);
    return r.ok ? Promise.resolve(r) : Promise.reject(new Error(r.error));
  };
  return {
    splits,
    load: (input, source, opts) => {
      splits.push(opts?.splitMidi);
      return run({
        id: ++id,
        type: 'load',
        kind: sourceKind(source),
        input,
        source,
        ...(opts?.splitMidi !== undefined ? { splitMidi: opts.splitMidi } : {}),
      }).then((r) => r as never);
    },
    solve: (score, profile, pins) =>
      run({ id: ++id, type: 'solve', score, profile, ...(pins ? { pins } : {}) }).then(
        (r) => r as never,
      ),
    fingeredXml: (xml, score, assignment) =>
      run({ id: ++id, type: 'fingeredXml', xml, score, assignment }).then(
        (r) => (r as { xml: string }).xml,
      ),
    dispose: () => {},
  };
}
function fakeRenderer(): ScoreRenderer {
  return {
    render: vi.fn(async () => ({ pages: ['<svg/>'], ms: 1 })),
    warmUp: () => {},
    dispose: () => {},
  };
}

beforeEach(() =>
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
  }),
);

describe('useScoreDocument with a MIDI file', () => {
  it('imports, exposes the MIDI facts, and re-imports when the hand split changes', async () => {
    const engine = inlineEngine();
    const { result } = renderHook(() =>
      useScoreDocument({ kind: 'file', name: 'twinkle.mid', bytes: twinkle }, 800, {
        engine,
        renderer: fakeRenderer(),
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.score!.notes).toHaveLength(64);
    expect(result.current.title).toBe('twinkle');
    expect(result.current.midiInfo).toMatchObject({ quantizedMovedShare: 0, splitMidi: null });
    expect(result.current.splitMidi).toBeNull();
    act(() => result.current.setSplitMidi(67));
    await waitFor(() => expect(result.current.midiInfo?.splitMidi).toBe(67));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.splitMidi).toBe(67);
    expect(result.current.score!.notes.filter((n) => n.hand === 'R')).toHaveLength(14);
    expect(Object.keys(result.current.assignment!)).toHaveLength(64);
    act(() => result.current.setSplitMidi(null));
    await waitFor(() => expect(result.current.midiInfo?.splitMidi).toBeNull());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(engine.splits).toEqual([undefined, 67, undefined]);
  });
  it('keeps midiInfo null for a MusicXML file', async () => {
    const { result } = renderHook(() =>
      useScoreDocument({ kind: 'file', name: 'short-piano.musicxml', bytes: shortPiano }, 800, {
        engine: inlineEngine(),
        renderer: fakeRenderer(),
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.midiInfo).toBeNull();
    expect(result.current.splitMidi).toBeNull();
  });
});
```

Changes to `apps/web/src/library/DropZone.test.tsx`: replace the test `refuses a MIDI file with a notice` with the one below, change the expected text of `refuses other extensions` to `That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).`, and add the copy test:

```tsx
it('hands a chosen MIDI file to onFile as bytes, whatever the case of its extension', async () => {
  const onFile = vi.fn();
  const onRefuse = vi.fn();
  render(<DropZone onFile={onFile} onRefuse={onRefuse} />);
  await userEvent
    .setup({ applyAccept: false })
    .upload(
      screen.getByLabelText('choose a file'),
      new File([new Uint8Array([77, 84, 104, 100])], 'Tune.MID'),
    );
  await vi.waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
  expect(onRefuse).not.toHaveBeenCalled();
  expect(onFile.mock.calls[0]![0]).toBe('Tune.MID');
  expect(Array.from(onFile.mock.calls[0]![1] as Uint8Array)).toEqual([77, 84, 104, 100]);
});
it('says which files it takes', () => {
  render(<DropZone onFile={vi.fn()} onRefuse={vi.fn()} />);
  expect(screen.getByTestId('drop-zone')).toHaveTextContent(
    'Drop a MusicXML or MIDI file here (.musicxml, .xml, .mxl, .mid or .midi), or choose a file',
  );
  expect(screen.getByLabelText('choose a file')).toHaveAttribute(
    'accept',
    '.musicxml,.xml,.mxl,.mid,.midi',
  );
});
```

Add to `apps/web/src/export/download.test.ts`, inside `names the file after the piece`:

```ts
expect(exportFilename({ kind: 'file', name: 'twinkle.mid', bytes: new Uint8Array() })).toBe(
  'twinkle.fingered.musicxml',
);
```

Add to `apps/web/src/about/AboutView.test.tsx`, inside the first test:

```tsx
expect(screen.getByRole('link', { name: 'midi-file' })).toHaveAttribute(
  'href',
  'https://github.com/carter-thaxton/midi-file',
);
```

Run: `pnpm --filter @digitus2/web test`
Expected: FAIL (new modules missing; DropZone refuses MIDI; no `midiInfo` in the hook; no midi-file link).

- [ ] **Step 2: Implement**

`apps/web/src/score/midiCopy.ts`:

```ts
import type { GridKind, MidiInfo } from '@digitus2/engine';

export const SPLIT_KEYS: readonly number[] = Array.from({ length: 49 }, (_, i) => 36 + i);
export const SPLIT_HELP = 'Keys from the chosen note upward go to the right hand.';
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midi: number): string {
  return `${NAMES[midi % 12]!}${Math.floor(midi / 12) - 1}`;
}

export function gridPhrase(grids: Record<GridKind, number>): string {
  const base = grids['32nd'] > 0 ? 'a 32nd-note grid' : 'a 16th-note grid';
  return grids['16th-triplet'] > 0 ? `${base} with triplets` : base;
}

export function importLine(info: MidiInfo): string {
  return `Imported from MIDI: notes quantized to ${gridPhrase(info.grids)}; ${Math.round(info.quantizedMovedShare * 100)} % moved more than a 64th note`;
}

export function handCountLine(right: number, left: number): string {
  const notes = (n: number) => `${n} note${n === 1 ? '' : 's'}`;
  return `Right hand: ${notes(right)} · left hand: ${notes(left)}`;
}
```

`apps/web/src/score/MidiImportPanel.tsx`:

```tsx
import type { MidiInfo } from '@digitus2/engine';
import { handCountLine, importLine, noteName, SPLIT_HELP, SPLIT_KEYS } from './midiCopy.js';

export interface MidiImportPanelProps {
  info: MidiInfo;
  right: number;
  left: number;
  splitMidi: number | null;
  onSplitChange(value: number | null): void;
}

export function MidiImportPanel({
  info,
  right,
  left,
  splitMidi,
  onSplitChange,
}: MidiImportPanelProps) {
  return (
    <section className="midi-import" aria-label="MIDI import">
      <p className="muted small">{importLine(info)}</p>
      <p className="small">{handCountLine(right, left)}</p>
      <label htmlFor="hand-split">Hand split</label>
      <select
        id="hand-split"
        value={splitMidi === null ? 'auto' : String(splitMidi)}
        onChange={(e) => {
          const value = e.currentTarget.value;
          onSplitChange(value === 'auto' ? null : Number(value));
        }}
      >
        <option value="auto">Automatic</option>
        {SPLIT_KEYS.map((m) => (
          <option key={m} value={String(m)}>
            {noteName(m)}
          </option>
        ))}
      </select>
      <p className="muted small">{SPLIT_HELP}</p>
    </section>
  );
}
```

`DropZone.tsx`: replace the two refusal constants by `export const NOT_A_SCORE_REFUSAL = 'That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).';`, accept the extensions `['.musicxml', '.xml', '.mxl', '.mid', '.midi']` (refuse anything else with `NOT_A_SCORE_REFUSAL`), change the visible text and the input's `accept` as in the copy list, and update the doc comment (`Only MusicXML and MIDI get through`). Search `apps/web/src` for `MIDI_REFUSAL` and `NOT_MUSICXML_REFUSAL` and update every importer.

`useScoreDocument.ts`: add `const [splitMidi, setSplitMidi] = useState<number | null>(null);`; the open pipeline's effect gains `splitMidi` in its dependency list and calls `engine.load(bytes, name, splitMidi === null ? undefined : { splitMidi })`; store the response's `midiInfo` in the document state (null for MusicXML and library pieces); return `splitMidi`, `midiInfo` and `setSplitMidi` with the document. A change of the split is a fresh open of the same bytes (status `loading` → `fingering` → `rendering` → `ready`); the hand-size and editorial effects are unchanged.

`SidePanel.tsx`: render, before the hand-size select:

```tsx
{
  doc.midiInfo && doc.score && (
    <MidiImportPanel
      info={doc.midiInfo}
      right={doc.score.notes.filter((n) => n.hand === 'R').length}
      left={doc.score.notes.filter((n) => n.hand === 'L').length}
      splitMidi={doc.splitMidi}
      onSplitChange={setSplitMidi}
    />
  );
}
```

passing `setSplitMidi` from `ScoreView` the same way the panel already receives the document (M4 Task 6). In `base.css`: `.midi-import { display: grid; gap: 0.25rem; margin-bottom: 1rem }` and `.midi-import select { justify-self: start }`.

`AboutView.tsx`: add the list item `MIDI files are read with <a href="https://github.com/carter-thaxton/midi-file">midi-file</a> (MIT).` after the Verovio item.

- [ ] **Step 3: Run the unit tests**

Run: `pnpm --filter @digitus2/web test && pnpm --filter @digitus2/web typecheck && pnpm lint && node scripts/check-colors.mjs`
Expected: PASS.

- [ ] **Step 4: Write the end-to-end tests**

`apps/web/e2e/midi.spec.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { expectOneRed } from './helpers/red.js';

const twinkle = fileURLToPath(new URL('../fixtures/twinkle.mid', import.meta.url));
const counts = /^Right hand: \d+ notes · left hand: \d+ notes$/;

async function openTwinkleMidi(page: Page) {
  await page.goto('/');
  await page.getByLabel('choose a file').setInputFiles(twinkle);
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
}

test('a dropped MIDI file opens with a finger on every note, the import facts and one red element', async ({
  page,
}) => {
  await openTwinkleMidi(page);
  await expect(page.getByRole('heading', { level: 1, name: 'twinkle' })).toBeVisible();
  await expect(
    page.getByText(
      'Imported from MIDI: notes quantized to a 16th-note grid; 0 % moved more than a 64th note',
    ),
  ).toBeVisible();
  await expect(page.getByText(counts)).toBeVisible();
  await expect(page.getByLabel('Hand split')).toHaveValue('auto');
  await expectOneRed(page, 'score from MIDI');
  await expectNoSeriousA11y(page, 'score from MIDI');
});

test('the hand split re-imports with a fixed split and Automatic restores the separation', async ({
  page,
}) => {
  await openTwinkleMidi(page);
  const automatic = (await page.getByText(counts).textContent())!;
  await page.getByLabel('Hand split').selectOption({ label: 'C4' });
  await expect(page.getByText('Right hand: 42 notes · left hand: 22 notes')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  await page.getByLabel('Hand split').selectOption({ label: 'G4' });
  await expect(page.getByText('Right hand: 14 notes · left hand: 50 notes')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  await expectOneRed(page, 'score from MIDI with a fixed split');
  await page.getByLabel('Hand split').selectOption('auto');
  await expect(page.getByText(automatic, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Hand split')).toHaveValue('auto');
});

test('export of a MIDI source downloads the generated MusicXML with a fingering on every note', async ({
  page,
}) => {
  await openTwinkleMidi(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export MusicXML' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('twinkle.fingered.musicxml');
  const text = await readFile((await download.path())!, 'utf8');
  expect(text.match(/<fingering/g)).toHaveLength(64);
  expect(text).toContain('<work-title>twinkle</work-title>');
});

test('a broken MIDI file shows the error state with a way back', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('choose a file')
    .setInputFiles({ name: 'broken.mid', mimeType: 'audio/midi', buffer: Buffer.from('MThd') });
  await expect(page.getByRole('alert')).toContainText('Could not open broken.mid: not a MIDI file');
  await expectOneRed(page, 'broken MIDI');
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(30);
});
```

In `apps/web/e2e/library.spec.ts`, replace the test `library: a refused MIDI drop shows a notice and keeps one red element` with:

```ts
test('library: an unsupported file shows a notice and keeps one red element', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('choose a file')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect(
    page.getByText(
      'That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).',
    ),
  ).toBeVisible();
  await expectOneRed(page, 'library with notice');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByText(/does not look like/)).toHaveCount(0);
});
```

In `apps/web/e2e/states.spec.ts`, make the `library-notice` state choose `{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }` instead of `x.mid`, and add this state to `STATES` (red element: Play):

```ts
  {
    name: 'score-midi',
    go: async (page) => {
      await page.goto('/');
      await page
        .getByLabel('choose a file')
        .setInputFiles(fileURLToPath(new URL('../fixtures/twinkle.mid', import.meta.url)));
      await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
    },
    expectTag: 'button',
  },
```

(with `import { fileURLToPath } from 'node:url';` if the file does not have it). `visual.spec.ts` derives its list from `STATES`, so it gains a `score-midi` baseline: write it locally with `pnpm --filter @digitus2/web exec playwright test e2e/visual.spec.ts --project visual -g score-midi --update-snapshots` and include the PNG in the hand-off.

- [ ] **Step 5: Run the end-to-end suite and the loop**

Run: `pnpm --filter @digitus2/web e2e`
Expected: `midi.spec.ts`, `library.spec.ts` and `states.spec.ts` pass on `desktop`; `library` and `states` on `mobile`; `visual` matches its baselines.

Update `docs/app.md`: in "Known limitations" replace the MIDI refusal with: MIDI files are imported (quantized per beat to 16th notes, 16th-note triplets or 32nd notes; one voice per hand; hands separated automatically by a learned pitch-trajectory DP that put about 92 percent of notes in the correct hand in the plan-time spike (Task 9 replaces this figure with the measured PIG and Mutopia numbers), with the `Hand split` control as the override; hands crossed at one instant always go by pitch; performance recordings without a tempo map are placed on a 120 quarter-note-per-minute grid). Add `midi.spec.ts` to the list of end-to-end specs.

Run: `pnpm verify`
Expected: all PASS, including `design`, `bundle` and `e2e`.

- [ ] **Step 6: Hand-off**

Paths: every file in this task's list, plus `apps/web/e2e/visual.spec.ts-snapshots/score-midi*.png`. Message: `feat(web): open MIDI files, show the import, adjust the hand split, export fingered MusicXML`.

---

### Task 9: Measure hand separation, set the floor, record the numbers

**Files:**

- Modify: `benchmarks/floor.json` (`hands.accuracyMin`), `benchmarks/latest-hands.json` (written by the run), `benchmarks/history.md` (a "Hand separation" section), `docs/experiments.md`, `docs/PROGRESS.md`, `docs/app.md` (the measured figure), `docs/superpowers/specs/2026-10-13-digitus2-design.md` (a dated note under section 7.6)
- Create (gitignored, not committed): `research/weights/hand-motion-pig.json`, `research/weights/hand-motion-no-<table>.json`, `research/weights/hand-motion-mu<μ>-nu<ν>.json`

**Interfaces:**

- Consumes: `digitus2 evalhands` and `make_hand_motion.py` (Tasks 2 and 6); the PIG test split (evaluation only), the Mutopia split (`piece70_30`; train for tuning, test held out).
- Produces: the first hand-separation scorecard, the floor, and a lab-notebook entry with the ablation and sensitivity tables. This plan sets no accuracy target before measuring; literature 6.7 expects 91–93 percent, and the spike in decision 1 measured 91.6 on PIG test without quantization.

- [ ] **Step 1: The shipped model on the test sets**

From the repo root (background the runs if they take more than a minute):

```bash
pnpm build
node packages/engine/dist/cli/main.js evalhands --gold research/data/pig --split research/data/splits/pig_official.json --subset test --library content/manifest.json --out benchmarks/latest-hands.json --label m6-hands
node packages/engine/dist/cli/main.js evalhands --gold research/data/mutopia_fingering --split research/data/splits/mutopia_split.json --subset test --label m6-mutopia-test
```

Expected: PIG `nakamura2020/test` 30 pieces, 0 skipped; library 30 pieces; Mutopia test about 85 parts (every part either scored or listed as skipped with a reason). Record the macro and note-weighted accuracies and the three weakest pieces of each set.

- [ ] **Step 2: The research variant fitted on PIG (never shipped)**

```bash
research/.venv/Scripts/python.exe -I research/scripts/make_hand_motion.py --library content/manifest.json --pig research/data/pig --pig-split research/data/splits/pig_official.json --out research/weights/hand-motion-pig.json
node packages/engine/dist/cli/main.js evalhands --gold research/data/pig --split research/data/splits/pig_official.json --subset test --library content/manifest.json --params research/weights/hand-motion-pig.json --label m6-hands-pigfit
```

Record the PIG test macro accuracy next to the shipped model's; this says how much the licence restriction of decision 2 costs.

- [ ] **Step 3: Ablation of the cost terms on quantized input (reported, not tuned)**

For each table `move`, `span`, `position`, `pattern`: fit with that table flattened, then score PIG test, the library and Mutopia test with it:

```bash
research/.venv/Scripts/python.exe -I research/scripts/make_hand_motion.py --library content/manifest.json --mutopia research/data/mutopia_fingering --mutopia-split research/data/splits/mutopia_split.json --uniform span --out research/weights/hand-motion-no-span.json
node packages/engine/dist/cli/main.js evalhands --gold research/data/pig --split research/data/splits/pig_official.json --subset test --library content/manifest.json --params research/weights/hand-motion-no-span.json --label m6-no-span
node packages/engine/dist/cli/main.js evalhands --gold research/data/mutopia_fingering --split research/data/splits/mutopia_split.json --subset test --params research/weights/hand-motion-no-span.json --label m6-no-span-mutopia
```

(and the same for `move`, `position` and `pattern`). Expected from decision 1: flattening the span table costs several points; the others less. If flattening a table improves both PIG test and Mutopia test by more than 1 point, report it as a finding; do not change the shipped model on the strength of test-set numbers.

- [ ] **Step 4: Sensitivity of μ and ν on training data only**

For μ in {0, 2.5, 10} with ν = 0.5, and ν in {0, 2} with μ = 5, fit with `--mu`/`--nu` into `research/weights/hand-motion-mu<μ>-nu<ν>.json` and score the Mutopia **train** subset and the library:

```bash
research/.venv/Scripts/python.exe -I research/scripts/make_hand_motion.py --library content/manifest.json --mutopia research/data/mutopia_fingering --mutopia-split research/data/splits/mutopia_split.json --mu 2.5 --out research/weights/hand-motion-mu2.5-nu0.5.json
node packages/engine/dist/cli/main.js evalhands --gold research/data/mutopia_fingering --split research/data/splits/mutopia_split.json --subset train --library content/manifest.json --params research/weights/hand-motion-mu2.5-nu0.5.json --label m6-mu2.5
```

Change the shipped defaults only when one setting beats μ = 5, ν = 0.5 by at least 1.0 point of Mutopia-train macro accuracy without losing more than 0.5 on the library; in that case regenerate `packages/engine/src/io/midi/params/hand-motion.json` with those flags (Task 2 step 4, then prettier), update the defaults and the sentence about them in the script, rerun the engine tests, and repeat steps 1 and 3 so every recorded number belongs to the shipped file.

- [ ] **Step 5: Set the floor**

In `benchmarks/floor.json` set `hands.accuracyMin` to the PIG test macro accuracy of step 1 minus 1.0, rounded down to one decimal, and append to `hands.note`: `Set <date> by M6 Task 9 from <measured> (commit <sha7>).`

- [ ] **Step 6: Record**

- `benchmarks/history.md`: add a section `## Hand separation` with a table `| Date | Commit | Label | PIG test macro | PIG note-weighted | Mutopia test macro | Library macro | Library weakest | Notes |` and one row for `m6-hands` (Notes: `pitch-trajectory beam DP; tables from library + Mutopia train; PIG-fitted variant <x>`).
- `docs/experiments.md`: one entry for M6 with the hypothesis (`a beam-searched pitch-trajectory DP with learned movement, span, position and pattern tables separates the hands of MIDI input as well as the literature's 91–93 percent`), the numbers of steps 1 and 2, the ablation table of step 3, the sensitivity table of step 4, the `importMidi` time for 2000 notes (Task 6), and the outcome.
- `docs/app.md`: replace the plan-time figure in "Known limitations" with the measured PIG and Mutopia accuracies.
- `docs/superpowers/specs/2026-10-13-digitus2-design.md`, under section 7.6, a dated note: `M6 (<date>): implemented as a beam-searched pitch-trajectory DP (one split point per onset) with learned movement, chord-span, position and hand-pattern tables (plan 2026-10-14-m6-midi-import.md, decision 1); measured <x> percent on the PIG test split. The user-adjustable split is the "Hand split" control.`
- `docs/PROGRESS.md`: M6 row `done` with the numbers; a log entry; the standing finding that PIG-derived hand statistics are research-only (decision 2).

- [ ] **Step 7: Verify**

Run: `pnpm verify`
Expected: all PASS; the `hands` step runs with `--floor` and passes.

- [ ] **Step 8: Hand-off**

Paths: `benchmarks/floor.json`, `benchmarks/latest-hands.json`, `benchmarks/history.md`, `docs/experiments.md`, `docs/PROGRESS.md`, `docs/app.md`, `docs/superpowers/specs/2026-10-13-digitus2-design.md`, and `packages/engine/src/io/midi/params/hand-motion.json` plus `research/scripts/make_hand_motion.py` only if step 4 changed the defaults. Message: `bench: first hand-separation scorecard and floor`.

---

## Self-review notes

- **Spec coverage.** Spec section 5 (Score model): `midiToScore` fills every field (ids `m…`, ticks at 480 per quarter, seconds through the tempo map, measures, time and key signatures, spelling, hand, staff, voice, chord ids, velocity) and `importMidi` adds `sourceIndices` (Tasks 4, 6). Section 6, MIDI reader: tempo map and time signatures from the file (Task 0), quantization to a grid derived from the file's beats with a 16th-note minimum, triplets detected per beat, and 32nd notes only where a beat clearly has them (Task 1), hand separation (Task 3), generated MusicXML for rendering (Task 5); the writer's "clean document from the Score" is `scoreToMusicXml`. Section 7.6: the split-point tracker is realised as a per-onset split point chosen by a beam DP over pitch trajectories (literature 6.7, the method the brief chose), the user-adjustable split is the `Hand split` control (Tasks 3, 8); Task 9 adds a dated note to the spec. Section 9: the drop zone takes MIDI and the score view shows the import (Task 8).
- **Brief coverage.** `read.ts` → Task 0. `quantize.ts` with displacement statistics → Task 1 (the share counts moves beyond a 64th note, decision 3; the grid rule has a margin, decision 4). `handSeparation.ts` with constraints, least-violating fallback, beam 64 and the `splitMidi` override → Task 3 (cost extended, decision 1). `params/hand-motion.json` and `make_hand_motion.py` with provenance and a pytest → Task 2 (PIG train only in a research variant, decision 2). `toScore.ts` with the key estimate and one voice per hand → Task 4. `engrave.ts` with ties, tuplets, rests at beat boundaries, ids, the library round trip and the Verovio contract → Tasks 5 and 7 (general voices, decision 6). `index.ts`, `cli/import.ts`, `evalhands` with PIG and library sets, `benchmarks/latest-hands.json`, the floor and the verify step → Tasks 6 and 9. The worker's `kind` and `midiInfo` → Task 7. The app's drop zone, import line, hand split, export name, fixtures and the end-to-end flows including `score-midi` → Tasks 0 and 8. The brief's "Twinkle gives 42 right and 22 left" is asserted exactly where it is deterministic (a split at C4 in Tasks 6, 7 and 8) and within two notes where it depends on the learned tables (Tasks 3, 6, 7), so a refit cannot break the app tests; the spike measured 64 of 64.
- **Review Focus coverage.** Item 1: Task 0 `pairs overlapping notes on one key first-in first-out, so no duration is negative`, Task 1 `merges simultaneous notes on one key and shortens a note that overlaps the next on its key`. Item 2: Task 0 `reads the tempo map: bar 5 at 10 s, bar 7 at 18 s, the last right-hand note at 21.5 s`, Task 4 `snaps tempo changes to the nearest 32nd note and keeps the seconds of the tempo map`, Task 5 `keeps the tempo map of tempo-map.mid through quantization, separation, engraving and reading back` and `places a tempo change at its exact tick`, Task 6 `keeps the tempo map: bar 5 at 10 s and bar 7 at 18 s`. Item 3: Task 3 `never gives one hand more than five notes when a playable split exists` and `still answers when no split of a slice is playable`, Task 4 `warns about six notes in one hand at one time`. Item 4: Task 3 `keeps a single melody in the middle register in one hand instead of trading it between the hands` and `keeps two lines that converge to a whole tone and part again in their own hands`. Item 5: Task 5 `writes awkward lengths as tied standard values and every note value matches its duration`, `refuses a rhythm it cannot write instead of writing a wrong one`, the 30-piece round trip, and Task 7 `renders tuplets, dotted values, ties across barlines and odd lengths written as tied notes`.
- **Type consistency.** `MidiData` (Task 0) feeds `quantize` (Task 1), `midiToScore` (Task 4), `importMidi` (Task 6) and `scoreToMidiData` (Task 3). `QuantizedNote.sources` (Task 1) is how `evaluateHands` (Task 3) and the fixture-truth tests map results back to source notes. `GridKind` and `QuantizedNotes.grids` (Task 1) become `MidiInfo.grids` (Task 6) and `gridPhrase` (Task 8). `HandMotionParams`, `HandPattern` and the index helpers (Task 2) are consumed by `separateHands` (Task 3), `evalhands --params` (Task 6) and the script's `--uniform` ablations (Task 9). `MAX_NOTES_PER_HAND` and `MAX_HAND_SPAN` (Task 3) define both the DP constraint and `midiToScore`'s crowded-chord warnings (Task 4). `MidiInfo` (Task 6) travels unchanged through the worker protocol (Task 7) into `useScoreDocument` and `MidiImportPanel` (Task 8). `sourceKind` (Task 7) is the single place that decides MIDI versus MusicXML. Note ids `m<k>` are created in Task 4, written as `id` attributes in Task 5, restored onto the re-read score in Task 6, kept by `injectNoteIds` and asserted in Verovio's SVG in Task 7.
- **Deviations from the brief, all listed under "Decisions" with their reasons:** the extra cost terms (1), the licence-driven fitting corpora (2), the 64th-note threshold in the import line (3), the grid margin (4), the re-read in `importMidi` (5), the general engraver (6), the Verovio test's location (7), the documented crossing limitation (8), the new refusal text (9). Smaller ones: `separateHands` returns `Hand[]` exactly as specified, so warnings about unplayable chords come from `midiToScore`; the brief's `cli/import.ts` options are kept and nothing else is added; the MIDI fixture generator uses the standard library rather than music21 so its bytes never depend on a library version.
- **Open numbers, measured by Task 9 and nowhere assumed:** PIG test and Mutopia test hand accuracy, the cost of fitting without PIG, the contribution of each table on quantized input, the sensitivity to μ and ν, and the `importMidi` time.
- **Placeholder scan:** every test is complete; implementation code is complete for every engine module, the scripts and the new app modules; the edits to M4 files are given as exact code or exact behaviour with the exact copy.

## Coordinator review notes (2026-10-14)

- Reviewed against product spec sections 5, 6 and 7.6, literature 6.7 and the M4 deviations section. The decisions in the section at the top are confirmed, in particular the three extra priors (chord span, first-chord position, hand-pattern transitions; measured in the drafter's spike at about 92 percent against 82 to 85 for the literal cost), the shipped tables fitted on the library plus the Mutopia train half only, and the 64th-note displacement statistic.
- Dependency correction: `research/data/splits/mutopia_split.json` already exists (written 2026-10-14 by the learning prototype with the method the M3 plan specifies; 112 train and 48 test Mutopia ids), so this plan depends on M2 and M4-B only. If M3 has not landed when Task 7 runs, the engine worker calls `solveFingering(score, { profile })` without a weight set, as M4 does, and M3 switches it later.
- Runs in its own worktree (`wt/m6-midi`) after M2 and M4-B are merged; may run concurrently with M3 (disjoint files: `src/io/midi/**`, `cli/import.ts`, `cli/evalhands.ts`; both touch `src/index.ts`, `cli/main.ts` and `benchmarks/floor.json`, which the later merge rebases).
