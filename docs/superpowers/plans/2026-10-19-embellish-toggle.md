# "Add notes between" (light embellishment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers do not run git; the controller commits each task with explicit paths.

**Goal:** A beginner opens a simple piece and, once the app has checked that it works, finds one more tick box in the Practice panel, `Add notes between`. Ticked, the score, the red cursor, the keyboard and playback use a lightly embellished version of the piece: passing notes that fill a third, and an upper neighbour a whole step above a repeated note. There is at most one figure per bar, never in two neighbouring bars, and every note on a strong beat stays where it is. The level, the title and every export stay those of the plain score.

**Issue:** [#67](https://github.com/MarchalMaxim/digitus2/issues/67), the app side of [#38](https://github.com/MarchalMaxim/digitus2/issues/38). Every commit message ends with `(#67)`.

**Spec:** `docs/research/embellishment-spike.md`, section 6 ("Recommendation for the app side"), read with sections 2, 3, 5 and 8. The Python reference is `research/embellish/core.py` (the embellisher), `research/embellish/check.py` (the independent checker, the specification of the gate) and `research/embellish/tests/` (`test_rules.py`, `test_melody.py`, `fixtures.py`). Project rules: `CLAUDE.md`, `docs/PROGRESS.md`, `docs/verification-loop.md`, `docs/app.md`, `docs/superpowers/specs/2026-10-13-digitus2-design.md`.

**Architecture:**

- **Engine.** `packages/engine/src/embellish/` holds a pure TypeScript port of `core.py` at light density. It turns MusicXML text into MusicXML text plus the record of inserted notes, through `@xmldom/xmldom` (the engine's XML library, `io/musicxml/dom.ts`). Beside it:
  - `check.ts`, the port of `check.py`, which reads both scores with the engine's own MusicXML reader;
  - `level.ts`, the port of the frozen level heuristic of `content/tools/level.py`;
  - `guard.ts`, which embellishes, checks, solves and lints at all four hand sizes, and drops the figures of offending bars once.
    The engine index exports them.
- **CLI.** `digitus2 embellish <file>` writes the embellished MusicXML or reports the refusal. `digitus2 embellish --library content/manifest.json` is the library gate that `pnpm verify` runs as the step `embellish`, against a new `embellish.offeredMin` floor in `benchmarks/floor.json`.
- **App.** The engine worker gets an `embellish` request that runs the guard. `useScoreDocument` posts it after the plain score is `ready`. It then lays the embellished score out ahead of time and keeps a second version of the document beside the plain one. The tick box appears only once that version exists.
- **Switching.** Switching swaps the score, the fingering and the pages in one state change. The score view carries the bar, the loop and the play state across the swap. Exports read the plain version.

**Tech stack:** as the repository today: TypeScript strict, `@xmldom/xmldom` 0.9 (engine), React 19.3, zustand 5, Vite 8.3.4, vitest (engine 3, web 5 with happy-dom), @playwright/test 1.59.1, Verovio 6.3.0. Python 3.11, standard library only, for the reference generator under `research/embellish/`. No new dependency, no lockfile change.

## Global Constraints

| What                           | Value                                                                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Density                        | `light` only: rules `passing` and `neighbour-repeated`, at most one figure per bar, never in two neighbouring bars. A figure is one rule applied to one note; at light each figure adds exactly one note.                         |
| Whole-step neighbour           | `neighbour-repeated` only when the upper scale step is 2 semitones above the repeated note (E-E and B-B in C major get nothing; D-D becomes D-E-D).                                                                               |
| Minimum figures                | `EMBELLISH_MIN_FIGURES = 3`, counted after the guard's drops                                                                                                                                                                      |
| Guard profiles                 | `GUARD_PROFILES = ['large', 'medium', 'small', 'child']` (every hand size the app offers)                                                                                                                                         |
| Guard solve                    | `solveFingering(score, { profile, weightSet: RECOMMENDED_WEIGHT_SET })`: no `level` (the app solves at expert) and no pins, as the app's plain solve                                                                              |
| Guard lint                     | `lintFingering(score, assignment, { profile, beginner: true })`. A law error is an issue with severity `error` whose rule has `LINT_RULES[rule].law`. A beginner error is an issue with severity `error` and rule `L06` or `L10`. |
| Guard passes when              | at every profile: zero law errors, and no more beginner errors than the plain score solved and linted the same way                                                                                                                |
| Library eligibility in the app | grade 1 or 2 (`EMBELLISH_MAX_GRADE = 2`, the set the gate verifies). Every dropped MusicXML or MIDI file is tried. Scan imports are never tried.                                                                                  |
| Gate pieces                    | the manifest pieces at levels 1 and 2 (259 today)                                                                                                                                                                                 |
| Gate floor                     | `benchmarks/floor.json` → `embellish.offeredMin`, the count of pieces the guard offers (expected 170, see Measurements; set to the measured count)                                                                                |
| Gate time budget               | under 60 s on the dev machine (measured guard cost: 23 s for 229 pieces at four profiles)                                                                                                                                         |
| Switch label                   | `transport.addNotes`: en `Add notes between`, nl `Noten ertussen toevoegen`, fr `Ajouter des notes intermédiaires`, es `Añadir notas intermedias`, pt `Adicionar notas intermediárias`                                            |
| Control                        | a native checkbox in a `label.check`, like `Metronome`, `Count-in` and `Loop bars`, placed after the loop block and before the seek help line. No icon, no new class, no colour.                                                  |

Rules:

- **No git.** Implementers do not run git. Each task's last step lists the paths and the message, and the controller commits.
- **UI.** Black and white, exactly one red element on screen, no other chromatic colour (`scripts/check-colors.mjs` stays green). Brutal minimalism and progressive disclosure: the tick box is the only visible addition. It is absent (not disabled) until the embellished version exists and on every piece that does not get one. It never appears and then vanishes. It is never red.
- **Tests.** Engine logic is test-first: write the failing vitest test, run it to see it fail, then implement. Web logic gets vitest unit tests. User flows get Playwright specs.
- **Format.** Run `pnpm exec prettier --write <files>` on every new or changed file (CI runs `pnpm format:check`). Run `pnpm lint` before handing back.
- **Purity.** The engine stays DOM-free and Node-free in `src/` (`tsconfig.src.json` has `types: []`). Only tests and `cli/` use `node:` modules.
- **Main thread.** It never imports the engine at runtime (the 150 KB gzip bundle budget). New app modules import only types from `@digitus2/engine`.
- **Docs.** Present tense, no dates, no branch names, no agent credits. Numbers go in tables, sources by URL. `docs/TODO.md` and `docs/PROGRESS.md` are not touched (the controller does that).
- **Windows.** Use the Write tool for files longer than a few lines. Use forward slashes in Git Bash. Run long commands (`pnpm verify`, the e2e suite) in the background.
- **Done.** `pnpm verify` is the definition of done for the last task, and each task runs the steps it touches. Without the PIG dataset the `benchmark` and `hands` steps report SKIP, which is not a pass; say so in the report. The new `embellish` step needs no dataset and never skips once the engine is built.

## Rulings (fixed; do not re-open)

1. Light density only: passing notes and the repeated-note upper neighbour, at most one figure per bar, never in two neighbouring bars. Playful, anticipation and neighbour-long are not built.
2. The upper neighbour on a repeated note is added only when it is a whole step above (section 6's cheap rule change; sections 5 and 8 found the semitone neighbours fussy). Section 5 point 2 (cadences) concerns neighbour-long only, and the long-note rule is not built, so light gets no cadence rule. Cadences are left alone.
3. The three review guards are mandatory:
   - a new note neither starts on nor sounds through a strong position;
   - key changes are followed from their onset, and a bar with a time change inside it is left alone;
   - the serialiser keeps XML comments and processing instructions.
     The port is a pure function from MusicXML text to MusicXML text plus the record of inserted notes, in `packages/engine/src/embellish/`, exported from the engine index, used by the web app and the CLI.
4. A CLI command `embellish <file> --density light` (writes the embellished MusicXML, or reports the refusal), and a `pnpm verify` library gate over the level 1 and 2 pieces:
   - zero law errors;
   - no added beginner errors against the plain score;
   - the level at most one up;
   - strong positions kept (`check.py`'s checks).
5. App behaviour:
   - After the plain solve, the worker embellishes and solves the embellished score in the background.
   - The switch appears in the Practice panel only once that solve exists, passes the lint guard (drop the offending bars' figures and solve once more; if it still fails, no switch) and carries at least three figures.
   - Off by default. Not remembered between pieces: the state lives with the open document and resets on open.
   - On, the sheet, the red cursor, the keyboard and playback use the embellished score. The level shown, the title and every export stay the plain score's.
   - The bar position is kept when switching either way.
   - "Editorial fingerings of the original notes stay pins; added notes get no pin." The app's plain solve uses no pins, so this plan keeps the editorial digits on the original notes and pins nothing in either solve (Decisions, "Editorial fingerings"; the controller may overrule this).
6. The switch is a black-and-white control in the style of the Practice controls, labelled through the i18n dictionaries (all five locales). Nothing else is added to the UI.
7. Tests:
   - The Python rule tests port to vitest as the failing tests written first.
   - Unit tests cover the worker and document state.
   - An e2e spec checks: on, notes are added and one element is red; the red follows an added note; off restores the plain score and the bar; the switch is absent on a piece with fewer than three figures and on a non-eligible import.
   - The colour guard stays green.
8. Docs:
   - a paragraph in `docs/app.md`;
   - the CLI line in `packages/engine/README.md`;
   - a line in `docs/verification-loop.md`;
   - a short note in section 6 of the spike doc.
     `docs/TODO.md` and `docs/PROGRESS.md` are left to the controller.

## Decisions

These are the plan's own decisions. Each one is binding for the tasks below.

- **The port computes light only, and its skip reasons are light's.** Candidates are found for `passing` and `neighbour-repeated` only. `skipped` counts why a melody note got no light candidate. In `core.py`, a note with an anticipation or long-neighbour candidate counted as handled even at light. So the TypeScript expectations below differ from the Python tests in `skipped` and are copied from the light reference, not from `test_rules.py`.
- **The divisions factor is computed over the light split table only.** This means `SPLIT_END`, not `core.py`'s three tables.
  - A file whose quarters already split into eighths keeps its divisions. For example, halves only at divisions 1 keeps `<divisions>1</divisions>`, where `core.py` writes 2.
  - The music is the same either way, and the inserted notes are the same.
- **The light reference is a committed Python file.** `research/embellish/light_reference.py` applies the three changes above to `core.py` and writes the golden file `packages/engine/fixtures/embellish-light-golden.json`. That file holds, for every level 1 and 2 piece, the refusal and each inserted note as `[bar, beat, midi, rule]`. A vitest test holds the port to it exactly. This is the reproduce-not-approximate oracle.
- **Exact arithmetic.** Positions and lengths are exact rationals (`Frac`, `src/embellish/frac.ts`), never floating point, as `core.py` uses `Fraction`. Python's `%` and `//` floor towards minus infinity. The port uses `mod(a, n) = ((a % n) + n) % n` and `Math.floor` wherever `core.py` uses `%` or `//`: the tonic `(7 * fifths) % 12`, the key-alter steps in `spell`, the accidental check `(n.pitch - p) % 12`, and the octave `(midi - alter) // 12 - 1`.
- **The new `<type>` goes in schema order.** When the split note has no `<type>`, the port inserts one after `<voice>`, else after `<duration>` (or a `<tie>` that follows it). `core.py` appends it at the end when there is no `<voice>`. The music is the same and the schema order is kept.
- **The guard runs at all four hand sizes when the piece opens.** The embellished score is then fixed for the open document. A hand-size change only switches to the assignment already solved for that size. The switch can never vanish on a hand-size change, and every hand size is guarded. Cost: about 12 solves of a beginner piece, about 0.1 s in the worker (Measurements). Pieces whose plain score already has a law error at some hand size (11 at `child`) are never offered.
- **Drop and retry, once:**
  - The offending bars are the measure indices of every note named by:
    - every law-error issue;
    - every beginner-error issue, when the beginner errors exceed the plain score's at that profile.
      These are united over the four profiles.
  - An issue that spans two bars puts both bars in the set.
  - Drop means removing the chosen figures in those bars from the figures already selected. There is no new selection: re-selecting with bars excluded would free neighbouring bars under the spacing rule and let unguarded figures in.
  - If no offending bar holds a figure, the piece is not offered. Otherwise the reduced embellishment is checked again and offered only if it still has three figures and passes at all four profiles.
- **The guard runs the independent check first.** An embellishment that fails `checkEmbellishment` is refused with the check's first problem as the reason, as the spike refused a density whose output failed `check.py`.
- **The gate runs the same guard the app runs.** It solves and lints independently on top (law errors, beginner errors against the plain score, strong positions kept, level), so a guard bug cannot pass itself. It runs the guard's configuration, not the spike's (beginner level, large profile), so its numbers are measured here, not copied from the spike.
- **Level.** `level.ts` ports `features`, `score` and `propose` of `content/tools/level.py` over the engine's `Score`, at the manifest's `tempoBpm`.
  - On the 259 level 1 and 2 pieces it gives the recorded proposal level on all 259.
  - It gives the recorded score to three decimals on 254. The five others count fewer notes, because the engine reader drops duplicate notes; their scores differ by at most 0.098.
  - The gate compares the plain and embellished proposals, both computed by `level.ts`.
- **Editorial fingerings.**
  - The embellisher never touches a split note's `<notations>`. A dropped file's `<fingering>` therefore stays on its original notes and the added notes carry none: `parseMusicXml(embellishedXml).editorial` is the editorial fingering of the embellished score.
  - A library piece's `.fingered` editorial is moved onto the embellished score by note identity: onset in quarters, MIDI pitch, staff and voice. Never by index (ids shift after an insertion) or raw tick (scaling the divisions changes `score.divisions`).
  - Neither the plain nor the embellished solve uses pins in the app, so the guard compares like with like.
- **Note ids.** The embellished score is parsed from the embellished text, so its ids are `n0…` in its own document order. `injectNoteIds` writes them into the embellished fingered text, and Verovio keeps them.
  - Checked on the ten light listening files: every note id renders as a `g.note` and every digit carries its note's id (Measurements).
  - Ids of the two versions mean different notes. Nothing keyed by note id may survive a switch, and the score, the assignment and the pages change in one state update.
- **Toggling is instant.** After the guarded result arrives, the hook writes the embellished fingered text and lays it out at the current width before it publishes `embellish: 'offered'`. A later switch takes cached pages in one state change. A width or hand-size change lays out or patches only the version on screen.
  - The pre-layout starts only after `ready`, so it never queues ahead of the first paint.
  - A `SupersededError` on the pre-layout is ignored: the switch still appears, and the first switch lays out like a width change.
- **Switching while playing or looping.** The score view records the bar the position is in, the loop and whether it was playing, then switches. After the new score is in, it re-applies the loop, seeks to the same bar's start (both versions have the same bar starts in seconds), and plays on if it was playing. Stopped at the start, it stays at the start.
- **Exports.** `Export MusicXML` writes the plain score with the plain fingering on screen (the engine's, or the editor's when shown). The side panel's facts and the MIDI import panel's hand counts come from the plain score. `Print` prints the page as shown, which is a print of the screen, not an export of a file. The controller may overrule this.
- **The CLI's file mode** writes the embellisher's output, so `--guard` is opt-in. With `--guard` it runs the app's guard and writes what the app would show. A refusal prints `digitus2: refused: <reason>` and exits 1, with nothing written.

## Measurements (taken while writing this plan)

| What                                                                                                  | Value                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parse, solve (`medium`, `RECOMMENDED_WEIGHT_SET`) and beginner lint of all 259 level 1–2 pieces, Node | 5.1 s in total; solve median 7.2 ms, p90 19.3 ms, max 43.2 ms; parse median 7.2 ms; median 141 notes, max 884                                                                                         |
| Twinkle (64 notes)                                                                                    | parse 13 ms, solve 15 ms, lint 1.7 ms                                                                                                                                                                 |
| Light reference (whole step, light-only, `SPLIT_END` factor) on the 259 pieces                        | 8 refused (the spike's 8); figures 0 / 1 / 2 / 3 or more: 22 / 17 / 26 / 186; 954 passing and 448 neighbour notes; `check.py` fails 0                                                                 |
| Guard at the four profiles on that output, first pass                                                 | 196 pieces pass all four (157 of them with three or more figures); 20 retried after dropping figures; 13 fail with no figure to drop                                                                  |
| After the retry                                                                                       | 13 more offered: **170 offered** (the expected `offeredMin`); the guard over 229 pieces at four profiles took 23 s                                                                                    |
| Plain scores with a law error, per profile                                                            | large 0, medium 1, small 1, child 11                                                                                                                                                                  |
| Level heuristic ported over the engine's `Score` (scratch script)                                     | proposal level equals the record on 259 of 259; score equals the record to 3 decimals on 254                                                                                                          |
| Verovio 6.3.0 on the ten light listening files (parse, solve, `injectFingerings`, `injectNoteIds`)    | every file loads; every note id is a `g.note`; digits with `data-startid` equal the notes fingered (Twinkle 70 of 70)                                                                                 |
| E2E pieces                                                                                            | Twinkle: 6 figures (all whole-step neighbours, bars 1, 3, 5, 7, 9, 11), passes at four profiles, 64 → 70 notes; Mary Had a Little Lamb: 2 figures; Handel's Aylesford Minuet: refused (chords at 55%) |

## Not verified

- That the TypeScript solver gives the same 170 on the TypeScript port's output. The golden test makes the port's insertions identical to the reference, so it should. Task 4 measures it and sets the floor from the measurement.
- Verovio on embellished output written by xmldom rather than ElementTree. The bytes differ (`<x/>` rather than `<x />`); Task 5's render contract test runs it.
- The time the four-profile guard takes in the browser worker on the largest dropped files. Grade 3 and up are not tried for library pieces; a dropped advanced piece pays about 12 solves in the worker.

## Review Focus

The five inputs or conditions most likely to bite a person that no ported Python test covers, each pinned by a test in the owning task:

1. **Flat keys.** Python's floor modulo against JavaScript's truncating `%` in the tonic, the spelling and the accidental check. Expected: a passing B♭4 in F major, and a C♭5 spelled `<step>C</step><alter>-1</alter><octave>5</octave>` in G♭ major. Task 2 tests `f major spells the passing B flat` and `g flat major spells C flat in octave 5`.
2. **A note without `<voice>` or `<type>`** (MuseScore and hand-written files). Expected: the split note gains `<type>eighth</type>` in schema order, the new note is `<voice>1</voice>`, and the file parses with no new warning. Task 2 tests `a note without voice and type is split in schema order`.
3. **Switching while playing with a loop on.** Expected: the loop stays, playback goes on from the same bar's start, and one red element. Task 6 tests `carry keeps the loop, the bar and the play state` (unit), plus the e2e `switching while playing in a loop`.
4. **A hand-size or width change while the embellished version is shown.** Expected: the digits change for the embellished notes and the pages are the embellished ones at the new width; the plain fingering for export follows the new hand size too. Task 5 tests `a hand-size change re-fingers both versions` and `a width change lays out the version on screen`.
5. **Export while switched on.** Expected: the downloaded MusicXML has the plain notes and the plain fingering (Twinkle 64 notes, 64 `<fingering>`), and the plain title. Task 6 e2e `export writes the plain score while notes are added`.

---

## File Map

Task 1, port of the reader, melody and refusals:

- Create `research/embellish/light_reference.py`, `packages/engine/fixtures/embellish-light-golden.json` (generated)
- Modify `.prettierignore`
- Create `packages/engine/src/embellish/frac.ts`, `analyse.ts`, `testing/score.ts`
- Create the tests `packages/engine/src/embellish/frac.test.ts`, `melody.test.ts`, `analyse.test.ts`

Task 2, rules, writer and `embellishMusicXml`:

- Create `packages/engine/src/embellish/rules.ts`, `write.ts`, `embellish.ts`, `index.ts`, `packages/engine/cli/libraryScore.ts`
- Create the tests `packages/engine/src/embellish/embellish.test.ts`, `golden.library.test.ts`
- Modify `packages/engine/src/index.ts`

Task 3, independent checker and level heuristic:

- Create `packages/engine/src/embellish/check.ts`, `level.ts`
- Create the tests `packages/engine/src/embellish/check.test.ts`, `level.test.ts`, `level.library.test.ts`
- Modify `packages/engine/src/embellish/index.ts`, `packages/engine/src/index.ts`

Task 4, guard, CLI and the verify gate:

- Create `packages/engine/src/embellish/guard.ts`, `packages/engine/cli/embellish.ts`
- Create the tests `packages/engine/src/embellish/guard.test.ts`, `packages/engine/cli/embellish.test.ts`
- Modify `packages/engine/cli/run.ts`, `packages/engine/src/embellish/index.ts`, `packages/engine/src/index.ts`, `scripts/verify.mjs`, `benchmarks/floor.json`, `benchmarks/history.md`

Task 5, worker and document state:

- Modify `apps/web/src/engine/protocol.ts`, `handlers.ts`, `client.ts`, `handlers.test.ts`, `client.test.ts`
- Modify `apps/web/src/score/useScoreDocument.ts`, `useScoreDocument.test.ts`, `useScoreDocument.midi.test.ts`
- Modify the `ScoreDocument` literals in `apps/web/src/score/SidePanel.test.tsx`, `score.i18n.test.tsx` and `ScoreView.letters.test.tsx`
- Create `apps/web/src/score/testing/services.ts`, `apps/web/src/score/useScoreDocument.embellish.test.ts`, `apps/web/src/score/render/verovio.embellish.node.test.ts`

Task 6, the switch, texts, carry and e2e:

- Create `apps/web/src/score/carry.ts`, `apps/web/src/score/carry.test.ts`, `apps/web/e2e/embellish.spec.ts`
- Modify `apps/web/src/score/Transport.tsx`, `Transport.test.tsx`, `ScoreView.tsx`, `SidePanel.tsx`, `SidePanel.test.tsx`
- Modify `apps/web/src/i18n/{en,nl,fr,es,pt}/transport.ts`
- Modify `apps/web/e2e/helpers/states.ts` and `apps/web/e2e/states.spec.ts` (`openTwinkle` waits for `data-embellish="offered"`)

Task 7, docs:

- Modify `docs/app.md`, `packages/engine/README.md`, `docs/verification-loop.md`, `docs/research/embellishment-spike.md`

---

## Tasks

### Task 1: Reader, melody and refusals, with the light reference

**Model:** opus

Why: a faithful port of `core.py`'s timeline needs exact arithmetic and Python's iteration order. The golden oracle is built here.

**Files:**

- Create `research/embellish/light_reference.py`
- Generate `packages/engine/fixtures/embellish-light-golden.json`
- Modify `.prettierignore`: add the line `packages/engine/fixtures/embellish-light-golden.json` after `*.xml`, so the generated one-line JSON stays as the generator writes it (today `prettier --file-info` reports it as not ignored, and a 59 KB one-line JSON fails `format:check`).
- Create `packages/engine/src/embellish/frac.ts`, `analyse.ts`, `testing/score.ts`
- Create the tests `frac.test.ts`, `analyse.test.ts`, `melody.test.ts` in `packages/engine/src/embellish/`

**Interfaces:**

- Produces (`frac.ts`):
  - `class Frac { readonly n: number; readonly d: number }`, always normalised (`d > 0`, `gcd(|n|, d) = 1`).
  - `frac(n: number, d = 1): Frac`
  - methods `add`, `sub`, `mul`, `div`, `cmp(o): -1 | 0 | 1`, `eq`, `lt`, `le`, `isInteger()`, `toString()`. `toString` gives `"9/2"`, or `"1"` for an integer, as Python's `str(Fraction)`.
  - `fracFrom(s: string): Frac` (`"9/2"`, `"3"`)
  - `mod(a: number, n: number): number` (floor modulo)
  - `fmtBeat(b: Frac): string`: an integer as `"2"`, else 3 decimals with trailing zeros and the point stripped (`"1.5"`, `"1.667"`), as `core.fmt_beat`. It rounds the exact rational to 3 decimals half to even, as Python's `:.3f` does on an exact tie. `toFixed(3)` rounds such a tie up (x.0625 at 1/32 positions).
  - `roundHalfEven(x: number): number`
- Produces (`analyse.ts`, internal to `embellish/`):
  - `interface EmbMeasure`: `{ idx; number; el: Element; start: Frac; length: Frac; time: [number, number] | null; fifths: number; offset: Frac; innerTimeChange: boolean }`, with helpers `nominal(m)`, `compound(m)`, `beatQ(m)`, `isStrong(m, metric)` and `soundsThroughStrong(m, start, end)`.
  - `interface EmbNote`: `{ el: Element; measure: EmbMeasure; onset: Frac; rel: Frac; dur: Frac; divisions: number; pitch: number | null; voice: string; staff: string; chord; grace; tie; tuplet; fermata: boolean; fifths: number }` with `end(n)`.
  - `interface Group { notes: EmbNote[] }` with `top(g)` and `single(g)`.
  - `interface Piece { doc: Document; root: Element; measures; notes; staves; parts; melodyVoice: string | null; melody: Group[]; refusal: string | null; ownerShare: number | null; chordShare: number | null }`
  - `analyseDocument(doc: Document): Piece` (the analysis of an already parsed document, used again after the divisions scale-up)
  - `analyseMusicXml(text: string): Piece`
- Produces (`testing/score.ts`): `fixtureScore(rh: Bar[], opts?: FixtureOptions): string`, where
  - `type Bar = FixtureEvent[]`
  - `type FixtureEvent = readonly [pitch: string | readonly string[], quarters: number, opts?: { tie?: 'start' | 'stop'; tuplet?: boolean; fermata?: boolean; voice?: string }]`
  - `FixtureOptions = { lh?: Bar[]; time?: [number, number]; fifths?: number; mode?: 'major' | 'minor'; divisions?: number; rh2?: (Bar | null)[]; staves?: number; pickup?: boolean; title?: string }`

  It is a line-for-line port of `research/embellish/tests/fixtures.py`, with the same strings and element order and no whitespace between elements. A duration is `Math.round(quarters * divisions)`, after checking it is within 1e-9 of an integer. `1/3` is passed as `1 / 3`.

- [ ] **Step 1: Write the light reference.** Create `research/embellish/light_reference.py` verbatim:

```python
"""Light density as the app builds it: the reference for the TypeScript port in
packages/engine/src/embellish/ (issue #67).

It is core.py at density light with the three changes the app makes:
  1. only the light rules are looked for (passing, neighbour-repeated), so `skipped` counts why a
     melody note got no light candidate;
  2. neighbour-repeated only when the upper scale step is a whole step above the repeated note;
  3. the divisions factor is computed over the light split table (SPLIT_END) only.

    python -I research/embellish/light_reference.py --golden packages/engine/fixtures/embellish-light-golden.json

writes, for every manifest piece at levels 1 and 2 in manifest order, the refusal and the inserted
notes as [bar, beat, midi, rule]. Standard library only. License: MIT.
"""
from __future__ import annotations

import argparse
import gzip
import json
import sys
from math import gcd
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "research") not in sys.path:
    sys.path.insert(0, str(ROOT / "research"))
from embellish import core  # noqa: E402


def _candidates_light(piece, skipped):
    out = []
    melody = piece.melody
    last_measure = piece.measures[-1].idx
    others = [n for n in piece.notes if n.pitch is not None and not n.grace and n.dur > 0]
    graces = {n.onset for n in piece.notes if n.grace and n.staff == "1"}
    for i, g in enumerate(melody):
        if not g.single:
            skipped["chord"] += 1
            continue
        a = g.notes[0]
        m = a.measure
        reason = None
        if i == len(melody) - 1 or m.idx == last_measure:
            reason = "last bar"
        elif a.tie:
            reason = "tied"
        elif a.tuplet:
            reason = "tuplet"
        elif a.fermata:
            reason = "fermata"
        elif m.time is None:
            reason = "no time signature"
        elif m.inner_time_change:
            reason = "time change inside the bar"
        if reason:
            skipped[reason] += 1
            continue
        nxt = melody[i + 1]
        b = nxt.top
        contiguous = nxt.onset == a.end and nxt.onset not in graces
        sc = core.scale(a.fifths)
        same_key = b.fifths == a.fifths
        found = []
        if contiguous and same_key and abs(b.pitch - a.pitch) in (3, 4) and a.pitch % 12 in sc and b.pitch % 12 in sc:
            mid = core.between(a.pitch, b.pitch, sc)
            if mid is not None:
                found.append(("passing", core.SPLIT_END[m.compound], [mid]))
        if contiguous and b.pitch == a.pitch:
            up = core.step_above(a.pitch, sc)
            if up is not None and up - a.pitch == 2:
                found.append(("neighbour-repeated", core.SPLIT_END[m.compound], [up]))
        reasons = []
        made = 0
        for rule, table, pitches in found:
            lengths = table.get(a.dur)
            if lengths is None:
                reasons.append("too short or odd length")
                continue
            if any((x * a.divisions).denominator != 1 for x in lengths):
                reasons.append("divisions")
                continue
            t = a.onset + lengths[0]
            why = None
            for length, p in zip(lengths[1:], pitches):
                metric = t - m.start + m.offset
                if m.strong(metric) or m.sounds_through_strong(metric, metric + length):
                    why = "strong beat"
                    break
                sound = [n for n in others if n is not a and n.onset < t + length and n.end > t]
                if any(n.pitch >= p for n in sound):
                    why = "not the top line"
                    break
                bar_notes = [n for n in others if n.measure is m]
                if any(n.pitch % 12 not in sc and (n.pitch - p) % 12 in (1, 11) for n in bar_notes):
                    why = "accidental nearby"
                    break
                t += length
            if why:
                reasons.append(why)
                continue
            roles = {"passing": ["passing"], "neighbour-repeated": ["neighbour"]}[rule]
            parts = [(lengths[0], None, "melody")] + [(ln, p, r) for ln, p, r in zip(lengths[1:], pitches, roles)]
            out.append(core.Candidate(rule, a, parts))
            made += 1
        if not made:
            skipped[reasons[0] if reasons else "no rule fits"] += 1
    return out


def _divisions_factor_light(piece):
    need = 1
    for g in piece.melody:
        if not g.single:
            continue
        a = g.notes[0]
        for x in core.SPLIT_END[a.measure.compound].get(a.dur, ()):
            d = (x * a.divisions).denominator
            need = need * d // gcd(need, d)
    return need if need <= 12 else 0


core._candidates = _candidates_light
core.divisions_factor = _divisions_factor_light


def embellish_light(text: str) -> core.Result:
    return core.embellish(text, "light")


def golden(levels=(1, 2)) -> dict:
    manifest = json.loads((ROOT / "content" / "manifest.json").read_text(encoding="utf-8"))
    rows = []
    for p in manifest:
        if p["level"] not in levels:
            continue
        raw = (ROOT / "content" / p["files"]["score"]).read_bytes()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        res = embellish_light(raw.decode("utf-8-sig"))
        rows.append({"slug": p["slug"], "refusal": res.refusal,
                     "inserted": [[i["bar"], i["beat"], i["midi"], i["rule"]] for i in res.inserted]})
    return {"pieces": rows}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--golden", required=True, type=Path, help="where to write the golden JSON")
    a = ap.parse_args(argv)
    a.golden.write_text(json.dumps(golden(), separators=(",", ":")) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Generate the golden file.** From the repository root, run `python -I research/embellish/light_reference.py --golden packages/engine/fixtures/embellish-light-golden.json`. Any Python 3.11 works, since it is standard library only; `python --version` says 3.11.9 on this machine. Check the result with `node -e "const g=require('./packages/engine/fixtures/embellish-light-golden.json');const r=g.pieces;console.log(r.length, r.filter(p=>p.refusal).length, r.reduce((s,p)=>s+p.inserted.length,0))"`. Expected: `259 8 1402`. The file is about 59 KB.

- [ ] **Step 3: Write the failing tests.**

`frac.test.ts`:

- `frac(6, 4).toString()` is `'3/2'`, `frac(4, 2).toString()` is `'2'`, `frac(-1, 2).toString()` is `'-1/2'`.
- `frac(1, 3).add(frac(1, 3)).add(frac(1, 3)).eq(frac(1))` is true.
- `fracFrom('9/2').eq(frac(9, 2))` is true.
- `mod(-7, 12)` is 5 and `mod(-1, 12)` is 11.
- `fmtBeat(frac(3, 2))` is `'1.5'`, `fmtBeat(frac(5, 3))` is `'1.667'`, `fmtBeat(frac(2))` is `'2'`, `fmtBeat(frac(17, 16))` is `'1.062'` (half to even, as Python).
- `roundHalfEven(0.5)` is 0, `roundHalfEven(1.5)` is 2, `roundHalfEven(-1.5)` is -2.

`melody.test.ts`, ported from `test_melody.py`, all through `analyseMusicXml` (and `embellishMusicXml` from Task 2 for the last two; write those two as `it.todo` now and fill them in Task 2):

| Test                                                             | Fixture (`fixtureScore`)                                                                       | Expect                                                                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| a single-voice right hand is the melody                          | `[[['C4',1],['E4',1],['G4',2]],[['C4',4]]]`                                                    | `refusal` null, `melodyVoice` `'1'`                                                                                            |
| the upper of two right-hand voices is the melody                 | `[[['E5',1],['G5',1],['F5',2]],[['E5',4]]]`, `rh2: [[['C5',4]],[['C5',4]]]`                    | `refusal` null, `melodyVoice` `'1'`                                                                                            |
| two voices that trade the top line are refused                   | `[[C5,C4,C5,C4 quarters],[C5,C4,C5,C4],[['C4',4]]]`, `rh2: [[['E4',4]],[['E4',4]],[['E5',4]]]` | `refusal` contains `'top line'`; `embellishMusicXml` gives the same refusal, `inserted` `[]`, and `xml` identical to the input |
| a chordal right hand is refused                                  | chord `['C4','E4','G4']`: `[[[chord,1],[chord,1],[chord,1],['E4',1]],[[chord,4]]]`             | `refusal` contains `'chord'`                                                                                                   |
| a single-staff score is refused                                  | `[[['C4',1],['E4',1],['G4',2]]]`, `staves: 1`                                                  | `refusal` contains `'staff'`                                                                                                   |
| a melody with a few chords is kept and the chords are left alone | `[[['C4',1],['E4',1],[['C4','G4'],1],['E4',1]],[['C4',1],['E4',1],['G4',2]],[['C4',4]]]`       | `refusal` null; no inserted note at onset `'2'`; `skipped.chord` 1                                                             |

`analyse.test.ts`, new, pinning the timeline:

- `a timewise score is refused`: `refusal` starts with `'not a partwise score (score-timewise)'`.
- `two parts are refused`: hand-written XML with two `<part>`s (`fixtureScore` writes one), refused with `'2 parts: the hands are not one piano part'`.
- `a key change inside a bar applies from its onset`: the key-change fixture of `test_rules.py`. That is `[[C4,D4,E4,G4 quarters],[['A4',4]]]` with `lh: [[['r',4]],[['D3',4]]]`, and `<attributes><key><fifths>1</fifths></key></attributes>` inserted before the third `<note>`. The melody notes' `fifths` are `[0, 0, 1, 1, 1]`.
- `a time change inside a bar marks that bar`: the time-change fixture of `test_rules.py`. Measure 0 has `innerTimeChange` true, and measures 1 and 2 have it false.
- `a pickup bar counts from its end`: the pickup fixture (`[[['C4',1]],[['E4',2],['D4',1]],[['C4',3]]]`, `lh: [[['r',1]],[['C3',3]],[['C3',3]]]`, `time: [3,4]`, `pickup: true`). Measure 0 has `offset` `'2'` and `length` `'1'`.

Run `pnpm --filter @digitus2/engine exec vitest run src/embellish`. It fails because the modules do not exist.

- [ ] **Step 4: Implement `frac.ts`, `testing/score.ts` and `analyse.ts`.**
  - `analyse.ts` ports `core.py` lines 83–321 (`Measure`, `Note`, `Group`, `Piece`, `_int`, `_pitch`, `analyse`, `_find_melody`) over `parseXml` and `childElements` from `../io/musicxml/dom.js`.
  - Copy the refusal texts verbatim from `core.py` (lines 213, 218, 281, 294, 306–307 and 317–318). The percentages are `Math.round` of the share times 100. Python's `:.0f` rounds half to even, and no fixture sits on a half.
  - Keep Python's iteration order exactly:
    - In `_find_melody`, `instants` are the sorted distinct onsets.
    - For each instant, `top` is the first sounding note, in onset order with document order among equals, that is greatest by `(pitch, onset == t)`.
    - The owner is the voice with the most instants; on a tie, the voice counted first.
    - `Group.top` is the first note of highest pitch.
  - `_pitch` adds `roundHalfEven(Number(alter))` (export it from `frac.ts`), as Python's `round` rounds half to even (`round(-1.5)` is -2, `round(0.5)` is 0). `_int` is `Math.trunc(Number(text))`, with the default for a missing or non-numeric value.
  - A note's `fifths` comes from the document-ordered list of key changes, read backwards: the first entry whose onset is at or before the note's onset (`core.py` line 278). It is not a time-sorted search.

- [ ] **Step 5: Run the tests.** Run `pnpm --filter @digitus2/engine exec vitest run src/embellish`. Expected: PASS, with the two `it.todo` reported as todo.

- [ ] **Step 6: Typecheck, format, lint.** Run `pnpm --filter @digitus2/engine typecheck`, then `pnpm exec prettier --write packages/engine/src/embellish`, then `pnpm lint`, then `pnpm format:check`. Prettier has no parser for `.py` or `.prettierignore`, and ignores `research/` and (after Step 1's line) the golden file: leave them out of the command, and keep the Python file in the style of `core.py`. All pass.

- [ ] **Step 7: Commit.** The controller commits these paths: `research/embellish/light_reference.py`, `packages/engine/fixtures/embellish-light-golden.json`, `.prettierignore`, `packages/engine/src/embellish/frac.ts`, `frac.test.ts`, `analyse.ts`, `analyse.test.ts`, `melody.test.ts`, `testing/score.ts`. Message:

```
Embellish: port the reader, melody and refusals; light reference and golden file (#67)
```

### Task 2: Light rules, the writer and `embellishMusicXml`

**Model:** opus

Why: the core of the port, held to the golden file byte for byte in its insertions.

**Files:**

- Create `rules.ts`, `write.ts`, `embellish.ts`, `index.ts`, `embellish.test.ts` and `golden.library.test.ts` in `packages/engine/src/embellish/`
- Create `packages/engine/cli/libraryScore.ts`: `readLibraryScore(path: string): string` reads a file, gunzips it (`node:zlib` `gunzipSync`) when its bytes start `0x1f 0x8b`, and returns `unpackMusicXml(bytes)`. It is the one place that reads a library score; the golden test (here), the level library test (Task 3) and the gate (Task 4) use it.
- Modify `packages/engine/src/index.ts` and `melody.test.ts` (fill in the two todos)

**Interfaces:**

- Consumes: Task 1's `Frac`, `fmtBeat`, `mod`, `analyseDocument`, `analyseMusicXml`, `Piece` and `fixtureScore`.
- Produces (exported from `embellish/index.ts` and the engine index):

```ts
export type EmbellishRule = 'passing' | 'neighbour-repeated';
export interface InsertedNote {
  /** 0-based measure index (document order), the bar the figure is in. */
  measureIndex: number;
  /** The measure's `number` attribute. */
  bar: string;
  /** 1-based beat of the new note's onset, `fmtBeat` (a pickup bar counts from its end). */
  beat: string;
  /** Onset in quarters from the start of the score, exact (`Frac.toString()`, e.g. "9/2"). */
  onset: string;
  /** Spelled from the key signature in force, e.g. "F#4", "Bb4". */
  pitch: string;
  midi: number;
  rule: EmbellishRule;
  role: 'passing' | 'neighbour';
  /** Length in quarters, `fmtBeat` ("0.5", "1"). */
  length: string;
}
export interface EmbellishOptions {
  /** Only 'light' is built; anything else throws. */
  density?: 'light';
  /** Measure indices whose chosen figures are removed after selection (the guard's retry). */
  dropBars?: Iterable<number>;
}
export interface EmbellishResult {
  /** The embellished text; the input text itself when refused or when nothing is added. */
  xml: string;
  inserted: InsertedNote[];
  refusal: string | null;
  /** Why each melody note got no light candidate, by reason, one reason per note. */
  skipped: Record<string, number>;
  melodyVoice: string | null;
}
export function embellishMusicXml(text: string, opts?: EmbellishOptions): EmbellishResult;
```

- [ ] **Step 1: Write the failing tests.** `embellish.test.ts` has three helpers:
  - `rh(xml, voice = 1)`: the notes of `parseMusicXml(xml).score` with `staff === 1`, `voice === voice` and not `isGrace`, as `[onsetTick / divisions, midi, (offsetTick - onsetTick) / divisions]`.
  - `lh(xml)`: the same for `staff === 2`.
  - `rules(res)`: `res.inserted.map(i => i.rule)`.

  `E` is the light result `embellishMusicXml(xml)`. The table ports every `test_rules.py` test at light. The expectations are the light reference's outputs (measured), not the Python tests' playful ones.

| #   | Test name                                                                          | Fixture                                                                                                                                                      | Expect                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | a passing note fills a third on the weak half of the first note                    | `[[C4 1, E4 1, D4 1, C4 1], [C4 4]]`                                                                                                                         | `refusal` null; `rules` `['passing']`; `rh` first 3 `[[0,60,0.5],[0.5,62,0.5],[1,64,1]]`; `inserted[0]` `bar '1'`, `beat '1.5'`, `pitch 'D4'`, `midi 62`, `onset '1/2'`, `length '0.5'`, `role 'passing'`, `measureIndex 0`; `skipped` `{'no rule fits': 2, 'last bar': 1}`                    |
| 2   | passing note on a descending third                                                 | `[[G4 1, E4 1, D4 2], [C4 4]]`                                                                                                                               | `rh` pitches first 3 `[67, 65, 64]`                                                                                                                                                                                                                                                            |
| 3   | no passing note across a fourth or a step                                          | `[[C4 1, F4 1, G4 2], [C4 4]]`                                                                                                                               | `inserted` `[]`; `skipped` `{'no rule fits': 3, 'last bar': 1}`                                                                                                                                                                                                                                |
| 4   | a passing note needs both ends in the key                                          | `[[C4 1, Eb4 1, D4 2], [C4 4]]`                                                                                                                              | `inserted` `[]`; `skipped` `{'no rule fits': 3, 'last bar': 1}`                                                                                                                                                                                                                                |
| 5   | a passing note is spelled from the key signature                                   | `[[E4 1, G4 1, A4 2], [G4 4]]`, `lh [[G2 4],[G2 4]]`, `fifths 1`                                                                                             | `rh[1][1]` 66; `inserted[0].pitch` `'F#4'`; `xml` contains `<alter>1</alter>`                                                                                                                                                                                                                  |
| 6   | a passing note on a half note lands on the weak second beat                        | `[[C4 2, E4 2], [C4 4]]`                                                                                                                                     | `rh` first 2 `[[0,60,1],[1,62,1]]`; `inserted[0]` `beat '2'`, `length '1'`                                                                                                                                                                                                                     |
| 7   | never on a strong beat                                                             | `[[C4 3, E4 1], [F4 4]]`                                                                                                                                     | `inserted` `[]`; `skipped` `{'strong beat': 1, 'no rule fits': 1, 'last bar': 1}`                                                                                                                                                                                                              |
| 8   | a new note never sounds through a strong position                                  | `[[G4 1/2, C4 2, E4 1, D4 1/2], [C4 4]]`                                                                                                                     | `inserted` `[]`; `skipped['strong beat']` 1; `skipped` `{'no rule fits': 3, 'strong beat': 1, 'last bar': 1}`                                                                                                                                                                                  |
| 9   | a minor key uses the key signature's scale                                         | `[[A4 1, C5 1, E4 1, G#4 1], [A4 4]]`, `lh [[A2 4],[A2 4]]`, `mode 'minor'`                                                                                  | passing pitches `['B4']`; no inserted `midi % 12 === 7`                                                                                                                                                                                                                                        |
| 10  | a key change inside a bar is followed                                              | Task 1's key-change fixture                                                                                                                                  | `inserted.map(i => [i.pitch, i.midi])` `[['F#4', 66]]`; `onset '5/2'`                                                                                                                                                                                                                          |
| 11  | a time change inside a bar leaves that bar alone                                   | Task 1's time-change fixture                                                                                                                                 | every `fracFrom(onset) >= 4`; `inserted` one passing `D4` at `'9/2'`, bar `'2'`; `skipped['time change inside the bar']` 4                                                                                                                                                                     |
| 12  | serialisation keeps the declaration, DOCTYPE, comments and processing instructions | fixture 4 of the Python test (`[[C4 1, E4 1, D4 2],[C4 4]]`), with `<!-- a comment --><?app keep="yes"?>` after `<part id="P1">`                             | `inserted` non-empty; `xml.startsWith(input.slice(0, input.indexOf('<score-partwise')))`; contains `<!DOCTYPE score-partwise`, `<!-- a comment -->`, `<?app keep="yes"?>`; `xml` ends with `</score-partwise>\n`                                                                               |
| 13  | the divisions scale-up covers attack and release                                   | `[[C4 1, E4 1, D4 2],[C4 4]]`, `lh [[C3 4],[C3 4]]`, `divisions 1`; the first `<note><pitch><step>C</step><octave>3</octave>` gets `attack="1" release="-1"` | `xml` contains `<note attack="2" release="-2">`. Also add `<direction placement="above"><direction-type><words>x</words></direction-type><offset>1</offset></direction>` before the first note of bar 1: `xml` contains `<offset>2</offset>` (the third element name `scale_divisions` scales) |
| 14  | a compound-meter dotted quarter splits into a quarter and an eighth                | `[[C4 3/2, E4 3/2],[C4 3]]`, `lh [[C3 3],[C3 3]]`, `time [6,8]`                                                                                              | `rh` first 2 `[[0,60,1],[1,62,0.5]]`; `inserted[0].beat` `'1.667'`                                                                                                                                                                                                                             |
| 15  | the neighbour on a repeated note is the upper whole step and returns               | `[[D4 1, D4 1, C4 2],[C4 4]]`                                                                                                                                | `rules` `['neighbour-repeated']`; `rh` pitches first 3 `[62, 64, 62]`; `inserted[0]` `pitch 'E4'`, `role 'neighbour'`; `skipped` `{'no rule fits': 1, 'last bar': 1}`                                                                                                                          |
| 16  | no neighbour a semitone above a repeated note                                      | `[[E4 1, E4 1, D4 2],[C4 4]]`, and also `[[B4 1, B4 1, A4 2],[G4 4]]`                                                                                        | `inserted` `[]` for both; `skipped` `{'no rule fits': 3, 'last bar': 1}` for both                                                                                                                                                                                                              |
| 17  | the long-note neighbour is not a light rule                                        | `[[G4 2, A4 1, G4 1],[G4 4]]`                                                                                                                                | `inserted` exactly one: `rule 'neighbour-repeated'`, `bar '1'`, `beat '4.5'`, `pitch 'A4'`, `midi 69`                                                                                                                                                                                          |
| 18  | the anticipation is not a light rule                                               | `[[C4 2, D4 1, E4 1],[A4 4]]` and `[[C4 2, D4 2],[G4 4]]`                                                                                                    | `inserted` `[]` for both                                                                                                                                                                                                                                                                       |
| 19  | the left hand is untouched and the checker agrees                                  | `[[C4 1, E4 1, E4 1, C4 1],[D4 2, F4 2],[C4 4]]`, `lh [[C3 2, G3 2],[G2 4],[C3 4]]`                                                                          | `lh(E.xml)` equals `lh(input)`; one passing `D4` at `'1/2'`. In Task 3 add: `checkEmbellishment(...)` ok, with `strongKept === strongTotal === 6`                                                                                                                                              |
| 20  | a pitch class next to an accidental in the bar is skipped                          | `[[E4 1, G4 1, A4 2],[C4 4]]`, `lh [[D3 2, F#3 2],[C3 4]]`                                                                                                   | `inserted` `[]`; `skipped['accidental nearby']` 1                                                                                                                                                                                                                                              |
| 21  | tied, tuplet, fermata and last notes are not embellished                           | the Python fixture (tie start/stop C4, fermata E4, G4; tuplet E4 F4 G4 thirds, E4 1, C4 2; C4 4)                                                             | no onset in [0, 3) or [4, 5); all onsets < 8; `inserted` one passing `F4` at `'7/2'`; `skipped` `{tied: 2, fermata: 1, tuplet: 3, 'last bar': 1}`                                                                                                                                              |
| 22  | an inserted note stays above every other sounding note                             | `[[C4 1, E4 1, G4 2],[C4 4]]`, `lh [[D4 2, C3 2],[C3 4]]`, `rh2 [[A3 4],[r 4]]`                                                                              | pitches `['F4']`; `skipped['not the top line']` 1; `rh(E.xml, 2)` equals `rh(input, 2)`                                                                                                                                                                                                        |
| 23  | a pickup bar counts beats from the end                                             | Task 1's pickup fixture                                                                                                                                      | `inserted[0]` `bar '0'`, `beat '3.5'`, `measureIndex 0`. In Task 3 add: the check is ok                                                                                                                                                                                                        |
| 24  | coarse divisions are scaled up without changing any note                           | `[[C4 1, E4 1, D4 2],[C4 4]]`, `lh [[C3 2, G3 2],[C3 4]]`, `divisions 1`                                                                                     | `rules` `['passing']`; `xml` contains `<divisions>2</divisions>`; `lh` unchanged. In Task 3 add: the check is ok                                                                                                                                                                               |
| 25  | the light factor leaves divisions that already split into eighths                  | `[[C4 2, C4 2],[C4 4]]`, `lh [[C3 4],[C3 4]]`, `divisions 1`                                                                                                 | one `neighbour-repeated` `D4`, `beat '2'`, `length '1'`; `xml` contains `<divisions>1</divisions>` and not `<divisions>2</divisions>` (`core.py` writes 2)                                                                                                                                     |
| 26  | every melody note gets at most one skip reason                                     | `[[C4 1, D4 1, E4 1/2, G4 1/2, A4 1],[G4 4]]`                                                                                                                | `skipped` exactly `{'no rule fits': 4, 'too short or odd length': 1, 'last bar': 1}` (the Python test says 3: A–G was an anticipation candidate)                                                                                                                                               |
| 27  | light adds at most one figure per bar, never in two neighbouring bars              | bar `[C4 1, E4 1, E4 1, C4 1]` three times, then `[C4 4]`                                                                                                    | at most 1 per bar; the bars with a figure are `['1','3']`; rules within `{passing, neighbour-repeated}`; `skipped` `{'no rule fits': 3, 'last bar': 1}`                                                                                                                                        |
| 28  | deterministic                                                                      | bar `[C4 1, E4 1, E4 1, C4 1]` twice, then `[C4 4]`                                                                                                          | two runs give identical `xml` and `inserted`                                                                                                                                                                                                                                                   |
| 29  | only light is built                                                                | any fixture                                                                                                                                                  | `embellishMusicXml(x, { density: 'playful' as never })` throws `/light/`                                                                                                                                                                                                                       |

New tests (Review Focus 1 and 2, and the guard's retry):

| #   | Test name                                                    | Fixture                                                                                                                                                                                           | Expect                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 30  | f major spells the passing B flat                            | `[[A4 1, C5 1, D5 2],[C5 4]]`, `lh [[F3 4],[F3 4]]`, `fifths -1`                                                                                                                                  | one passing, `pitch 'Bb4'`, `midi 70`; `xml` contains `<note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>6</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>`                                                                       |
| 31  | g flat major spells C flat in octave 5                       | `[[Bb4 1, Db5 1, Eb5 2],[Db5 4]]`, `lh [[Gb2 4],[Gb2 4]]`, `fifths -6`                                                                                                                            | one passing, `pitch 'Cb5'`, `midi 71`; `xml` contains `<step>C</step><alter>-1</alter><octave>5</octave>`                                                                                                                                                                            |
| 32  | e flat major repeats a whole step up                         | `[[Eb4 1, Eb4 1, D4 2],[Eb4 4]]`, `lh [[Eb3 4],[Eb3 4]]`, `fifths -3`                                                                                                                             | one `neighbour-repeated`, `pitch 'F4'`, `midi 65`                                                                                                                                                                                                                                    |
| 33  | a note without voice and type is split in schema order       | fixture 4, with the first `<voice>1</voice><type>quarter</type>` removed                                                                                                                          | one passing `D4`. The first note is exactly `<note><pitch><step>C</step><octave>4</octave></pitch><duration>6</duration><type>eighth</type><staff>1</staff></note>` (type before staff). The new note has `<voice>1</voice>`. `parseMusicXml(xml).warnings` equals that of the input |
| 34  | the split note keeps its notations and the new note has none | fixture 4, with `<notations><technical><fingering>1</fingering></technical></notations>` added to the first note                                                                                  | `parseMusicXml(E.xml).editorial` has exactly one entry, on the note at onset 0 with midi 60; the inserted note has none                                                                                                                                                              |
| 35  | dropped bars lose their figure and no new figure appears     | the fixture of test 27                                                                                                                                                                            | `dropBars: [0]` gives exactly one inserted note, in bar `'3'`, the same as without the drop (bar 2 does not gain a figure)                                                                                                                                                           |
| 36  | a file with nothing to add comes back unchanged              | `[[C4 1, D4 1, E4 2],[D4 4]]` at `divisions 1`                                                                                                                                                    | `inserted` `[]` and `xml === input` (the light factor is 2, so this pins that no scale-up is written when nothing is inserted); `skipped` `{'no rule fits': 3, 'last bar': 1}`                                                                                                       |
| 37  | a key change later in the document applies from its onset    | `[[C4 1, D4 1, E4 1, G4 1],[A4 4]]`, `lh [[C3 2, D3 2],[D3 4]]`, with `<attributes><key><fifths>1</fifths></key></attributes>` inserted before the left hand's D3 in bar 1 (after the `<backup>`) | `inserted.map(i => [i.pitch, i.midi])` `[['F#4', 66]]` at onset `'5/2'`; `analyseMusicXml(input)` melody fifths `[0, 0, 1, 1, 1]` (verified on the light reference)                                                                                                                  |

`golden.library.test.ts` (one test, 60 s timeout):

```ts
it('matches the light reference on every level 1 and 2 piece', () => {
  // For every row of packages/engine/fixtures/embellish-light-golden.json: look up the row's slug in
  // content/manifest.json, read content/<files.score> with readLibraryScore (../../cli/libraryScore.js),
  // run embellishMusicXml, and compare refusal and
  // inserted.map(i => [i.bar, i.beat, i.midi, i.rule]) with the row, exactly.
  // Afterwards: 259 rows, 8 refused, 1402 inserted (954 passing, 448 neighbour-repeated).
});
```

Fill in `melody.test.ts`'s two todos: the trading-voices refusal through `embellishMusicXml`, and no insertion at onset `'2'` for the few-chords fixture.

Run `pnpm --filter @digitus2/engine exec vitest run src/embellish`. It fails because `embellishMusicXml` does not exist.

- [ ] **Step 2: Implement `rules.ts`.**
  - It ports `scale`, `key_alters`, `spell`, `pitch_name`, `step_above`, `between` and the split tables `SPLIT_END` and `TYPE_OF`, with `mod` and `Math.floor` for Python's `%` and `//` (Decisions).
  - `findCandidates(piece, skipped)` is `_candidates_light` of `light_reference.py`, line for line.
  - `selectLight(cands, dropBars)`:
    - sort by `(rule priority: passing 0, neighbour-repeated 1; then onset)`;
    - skip a candidate whose note already has a figure, whose bar has one, or whose neighbouring bar has one;
    - then remove the chosen figures in `dropBars`;
    - return them in onset order.
  - `divisionsFactorLight(piece)` is `_divisions_factor_light`.

- [ ] **Step 3: Implement `write.ts`.**
  - `scaleDivisions(root, factor)` ports `core.scale_divisions`. An integer is written as an integer. A fractional result is written as JavaScript's shortest `String(n / d)`, where Python writes `str(float)`; it never happens at the factors the light table asks for.
  - `setLength(el, length, divisions)` ports `_set_length`, with `<type>` placed by the schema-order decision.
  - `newNote(doc, a, midi, length, fifths)` ports `_new_note`: pitch (with `<alter>` only when non-zero), duration, voice, type, dots, stem (copied when the split note has one), and staff (when the split note has one).
  - The new note is inserted right after the split note. When the split note's next sibling is a whitespace-only text node, a copy of it goes before the new note, as ElementTree's tail does.
  - `serialise(original, root)` ports `core.serialise`: the input up to `<score-partwise` (else `<?xml version="1.0" encoding="UTF-8"?>\n`), then `new XMLSerializer().serializeToString(root)` (`import { XMLSerializer } from '@xmldom/xmldom'`: the global is banned in `packages/engine/src` by `eslint.config.js`), then the input after the last `</score-partwise>` (else `\n`).

- [ ] **Step 4: Implement `embellish.ts` and `index.ts`.** `embellishMusicXml` follows `core.embellish` (lines 580–614):
  1. Throw unless the density is light.
  2. Analyse; a refusal returns the input text.
  3. Scale the divisions when `divisionsFactorLight > 1`, then run `analyseDocument` again on the same document.
  4. Find, select and drop the candidates, then write. For each chosen figure, the record is `{ measureIndex, bar: m.number, beat: fmtBeat(metric / beatQ + 1), onset, pitch: pitchName(midi, a.fifths), midi, rule, role, length: fmtBeat(length) }`, with `metric = t - m.start + m.offset`.
  5. Return `serialise(text, root)` when anything was inserted, else `text`.

  `index.ts` exports `embellishMusicXml` and its types. Add `export * from './embellish/index.js';` to `packages/engine/src/index.ts`.

- [ ] **Step 5: Run the tests.** Run `pnpm --filter @digitus2/engine exec vitest run src/embellish`. All pass; the golden test reports 259 rows, 8 refused and 1,402 inserted notes.

- [ ] **Step 6: Typecheck, format, lint, the engine suite.** Run `pnpm --filter @digitus2/engine typecheck`, then `pnpm exec prettier --write packages/engine/src/embellish packages/engine/src/index.ts`, then `pnpm lint`, then `pnpm --filter @digitus2/engine test`. All pass.

- [ ] **Step 7: Commit.** The controller commits these paths: `packages/engine/src/embellish/rules.ts`, `write.ts`, `embellish.ts`, `index.ts`, `embellish.test.ts`, `golden.library.test.ts`, `melody.test.ts`, `packages/engine/cli/libraryScore.ts`, and `packages/engine/src/index.ts`. Message:

```
Embellish: light rules, writer and embellishMusicXml, matched to the light reference (#67)
```

### Task 3: The independent checker and the level heuristic

**Model:** opus

Why: these are the specification of the gate. They must read the scores independently of the embellisher's own timeline.

**Files:**

- Create `check.ts`, `level.ts`, `check.test.ts`, `level.test.ts` and `level.library.test.ts` in `packages/engine/src/embellish/`
- Modify `embellish.test.ts` (rows 19, 23 and 24 gain their check assertions), `embellish/index.ts` and `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `parseMusicXml` (`../io/musicxml/read.js`), `parseXml` and `childElements` (`../io/musicxml/dom.js`), `Score`, and `InsertedNote` from Task 2.
- Produces:

```ts
export interface EmbellishCheck {
  ok: boolean;
  problems: string[];
  /** (strong position, melody pitch) pairs sounding in the plain score, and how many are kept. */
  strongTotal: number;
  strongKept: number;
}
export function checkEmbellishment(
  plainXml: string,
  embellishedXml: string,
  inserted: readonly Pick<InsertedNote, 'onset' | 'midi' | 'length'>[],
  melodyVoice: string,
): EmbellishCheck;

export interface LevelFeatures {
  nps: number;
  shifts: number;
  span: number;
  chord: number;
  fifths: number;
  accidentals: number;
  seconds: number;
  leaps: number;
}
export const LEVEL_CUTS: readonly number[]; // [1.76, 4.09, 9.11, 12.68]
export function levelFeatures(score: Score, tempoQpm: number): LevelFeatures;
export function levelScore(f: LevelFeatures): number;
/** 1 + the number of cuts below `score`, for the score rounded to 3 decimals as level.py records it. */
export function proposeLevel(score: number): number;
/** Math.round(x * 1000) / 1000: the score as level.py records it. */
export function round3(x: number): number;
```

- [ ] **Step 1: Write the failing tests.**

`check.test.ts`:

- `the left hand is untouched and the checker agrees`: row 19's fixture, embellished. `ok` is true and `strongKept === strongTotal === 6`.
- `catches a moved left-hand note and a displaced strong beat` (from `test_rules.py`):
  - Embellish `[[C4 1, E4 1, D4 1, C4 1],[C4 4]]`, then replace the first `<step>C</step><octave>3</octave>` with `D` in the output. `ok` is false.
  - `checkEmbellishment(plain, fixtureScore([[D4 1, E4 1, D4 1, C4 1],[C4 4]]), [], '1')` gives `ok` false and `strongKept < strongTotal`.
- `rejects a new note that sounds through a strong position` (from `test_tools.py`):
  - plain `[[G4 1/2, C4 2, E4 1, D4 1/2],[C4 4]]`;
  - embellished by hand `[[G4 1/2, C4 1, D4 1, E4 1, D4 1/2],[C4 4]]`;
  - inserted `[{ onset: '3/2', midi: 62, length: '1' }]`.
    Expected: `ok` false, and a problem contains `'sounds through a strong position'`.
- `rejects an unrecorded insertion`: an embellished file with an extra melody note and `inserted` `[]`. A problem starts with `'unrecorded or missing insertions'`.
- `the pickup and coarse-divisions fixtures check out`: rows 23 and 24 give `ok` true.
- `ignores warnings that differ only in their note indices`:
  - Use fixture 4 (`[[C4 1, E4 1, D4 2],[C4 4]]`) with `lh: [[['C3', 4]], [[['C3', 'C3'], 4]]]`. The second bar's chord of two C3s makes the engine reader warn `note N: duplicate of note M (same hand, onset and pitch), dropped`.
  - After the passing note in bar 1, both N and M shift by one.
  - `checkEmbellishment` of the light result is `ok`. Without the normalisation, it would report a new reader problem and the guard would refuse two of the five library pieces with duplicate notes.

`level.test.ts`:

- `proposeLevel(1.76)` is 1 and `proposeLevel(1.761)` is 2. `proposeLevel(12.69)` is 5.
- `levelScore` of the features recorded for `twinkle-twinkle-little-star` in `content/verification.json` gives the recorded score to 3 decimals.

`level.library.test.ts` (60 s timeout): for every manifest piece at levels 1 and 2, read the score with `readLibraryScore` (`../../cli/libraryScore.js`, Task 2), parse it, and compute `s = round3(levelScore(levelFeatures(score, tempoBpm)))`. Then:

- `proposeLevel(s)` equals `verification[slug].levelProposal.level` on all 259 pieces;
- `|s - record.score| <= 0.1` on all of them;
- `s === record.score` except for the five pieces where the engine reader counts fewer notes: `schumann-op68-no1-melody`, `schumann-op68-no3-humming-song`, `pdmx-minuet-in-g-major-2c1f15aa`, `pdmx-minuet-in-g-major-bmv-114-j-s-bach-da5cac7a` and `pdmx-alan-walker-faded-253f3eb9`.

Run `pnpm --filter @digitus2/engine exec vitest run src/embellish`. It fails.

- [ ] **Step 2: Implement `check.ts`.** It ports `check.verify` (`check.py` lines 77–140) over two `parseMusicXml` reads.
  - **Quarters.** A tick becomes `tick / score.divisions` (equal rationals divide to equal doubles). Inserted onsets and lengths are read with `fracFrom` and compared as `n / d`.
  - **Measures.** Compare `(startTick / divisions, lengthTicks / divisions)` per measure.
  - **New reader problems.** Normalise each warning by replacing every `note \d+` with `note #`: the prefix, and the second index inside `duplicate of note M`. The new problems are the embellished warnings, normalised, that are not among the plain warnings, normalised.
  - **Melody notes.** `staff === 1 && voice === Number(melodyVoice) && !isGrace`.
  - **Non-melody notes.** Compare as the multiset of `onset|midi|dur|staff|voice|isGrace` (the engine merges ties, so `check.py`'s tie flags fold into the duration).
  - **Strong positions.** Port `strong_positions` (`check.py` lines 50–66). The time in force for measure _i_ is the last `timeSignatures` event with a tick before the next measure's start, as `xmlcheck` keys times by measure index (so an inner `<time>` governs its whole bar, as in `check.py`). The pickup offset applies to measure 0, or to a measure whose `<measure implicit="yes">` is set in the first part. Read those flags with a small `parseXml` pass over the plain text (the `Score` does not carry them).
  - Copy the problem texts verbatim from `check.py`.

- [ ] **Step 3: Implement `level.ts`.** It ports `level.py`'s `features`, `score`, `propose` and `CUTS`.
  - Hands: all notes are right hand when the largest `staff` is 1, else right is staff 1 and left is every other staff.
  - Skip grace notes. Merged ties are already one strike each.
  - Slices are keyed by `onsetTick`.
  - `seconds = sum(lengthTicks) / divisions * 60 / tempoQpm`.
  - The key is `score.keySignatures[0]?.fifths ?? 0`, and the tonic is `mod(7 * key, 12)`. The feature `fifths` is `Math.abs(key)`, as `level.py` returns `abs(fifths)`.
  - `accidentals` counts `mod(midi, 12)` outside the major scale.
  - Everything else follows `level.py` lines 72–109.

- [ ] **Step 4: Fill in rows 19, 23 and 24 of `embellish.test.ts`** with their `checkEmbellishment` assertions. Export the new functions from `embellish/index.ts`.

- [ ] **Step 5: Run the tests.** Run `pnpm --filter @digitus2/engine exec vitest run src/embellish`. PASS.

- [ ] **Step 6: Typecheck, format, lint.** Run `pnpm --filter @digitus2/engine typecheck`, `pnpm exec prettier --write packages/engine/src/embellish` and `pnpm lint`. All pass.

- [ ] **Step 7: Commit.** The controller commits these paths: `packages/engine/src/embellish/check.ts`, `check.test.ts`, `level.ts`, `level.test.ts`, `level.library.test.ts`, `embellish.test.ts`, `index.ts`, and `packages/engine/src/index.ts`. Message:

```
Embellish: independent checker and the level heuristic over the engine's reader (#67)
```

### Task 4: The guard, the `embellish` command and the verify gate

**Model:** opus

Why: one function decides what the app offers and what the gate verifies; the floor makes the gate positive.

**Files:**

- Create `packages/engine/src/embellish/guard.ts` and `guard.test.ts`
- Create `packages/engine/cli/embellish.ts` and `embellish.test.ts`
- Modify `packages/engine/cli/run.ts`, `packages/engine/src/embellish/index.ts` and `packages/engine/src/index.ts`
- Modify `scripts/verify.mjs`, `benchmarks/floor.json` and `benchmarks/history.md`

**Interfaces:**

- Consumes: Tasks 2 and 3, plus `parseMusicXml`, `solveFingering`, `lintFingering`, `LINT_RULES`, `RECOMMENDED_WEIGHT_SET` and `HandProfileId`.
- Produces:

```ts
export const EMBELLISH_MIN_FIGURES = 3;
export const GUARD_PROFILES: readonly HandProfileId[]; // ['large', 'medium', 'small', 'child']
export interface GuardOptions {
  profiles?: readonly HandProfileId[];
  weightSet?: WeightSetId | WeightSetFile; // default RECOMMENDED_WEIGHT_SET
  minFigures?: number; // default EMBELLISH_MIN_FIGURES
  /** @internal Tests only. */
  lint?: typeof lintFingering;
  /** @internal Tests only. */
  check?: typeof checkEmbellishment;
}
export interface Embellishment {
  xml: string;
  score: Score;
  /** The embellished file's own <fingering>s: on original notes only. */
  editorial: Assignment;
  inserted: InsertedNote[];
  figures: number;
  /** Measure indices whose figures the retry removed; [] when the first pass passed. */
  droppedBars: number[];
  /** The guarded fingering at each profile, as the app solves it. */
  assignments: Record<HandProfileId, Assignment>;
  melodyVoice: string;
}
export type GuardOutcome =
  { offered: Embellishment; reason: null } | { offered: null; reason: string };
export function guardEmbellishment(plainXml: string, opts?: GuardOptions): GuardOutcome;
/** Law errors and beginner errors (L06, L10 at error severity) of one lint report. */
export function guardErrors(report: LintReport): { law: LintIssue[]; beginner: LintIssue[] };
```

- CLI (`cli/embellish.ts`):
  - `embellishFile(o: { file: string; out?: string; inserted?: string; guard?: boolean }): { xml: string | null; inserted: InsertedNote[]; refusal: string | null }`
  - `runEmbellishGate(o: { library: string; levels?: number[]; floor?: string; out?: string }): { scorecard: EmbellishScorecard; failures: string[] }`
  - `formatEmbellishScorecard(s): string`
  - It reads library scores with `readLibraryScore` from `cli/libraryScore.ts` (Task 2).

- [ ] **Step 1: Write the failing tests.**

`guard.test.ts`, on `fixtureScore` pieces of a few bars, with a 20 s timeout:

- `offers an embellishment with three figures that passes at every profile`: bar `[C4 1, E4 1, D4 1, C4 1]` six times, then `[C4 4]`, with `lh` whole-bar `C3`. Expect:
  - `offered` non-null;
  - `figures` 3 (bars 1, 3 and 5);
  - `droppedBars` `[]`;
  - `Object.keys(assignments)` equals `GUARD_PROFILES`;
  - `guardErrors(lintFingering(score, assignments.child, { profile: 'child', beginner: true })).law` `[]`.
- `refuses fewer than three figures`: test 1's fixture of Task 2 gives `offered` null and a `reason` that matches `/1 figure/`.
- `passes the embellisher's refusal through`: the single-staff fixture gives a `reason` that contains `'staff'`.
- `drops the figures of an offending bar and checks again`: stub the lint through the `GuardOptions` field `lint?: typeof lintFingering`. It and `check?` are internal test seams, marked `/** @internal Tests only. */` and left out of the docs. The stub returns the real report for the plain score (it tells the scores apart by note count), and adds one L06 error on a bar-2 note of the embellished score on the first `evaluate` only. The fixture is the bar of the first guard test eight times, then `[C4 4]`, which has figures in bars 0, 2, 4 and 6. Expect `droppedBars` `[2]`, `figures` 3, and an `inserted` with no `measureIndex` 2.
- `refuses when the offending bar has no figure`: the stub reports an L01 law error on a bar without a figure. `offered` is null and `reason` matches `/no figure/`.
- `refuses when the retry still fails`: the stub fails on both passes. `offered` is null and `reason` matches `/after dropping/`.
- `refuses when the retry leaves fewer than three figures`: the stub fails on two of three bars. `offered` is null.
- `a failing independent check refuses`: pass `check` in `GuardOptions`, returning `{ ok: false, problems: ['x'] }`. `reason` is `'check: x'`.

`cli/embellish.test.ts`, with `capture()` as in `run.test.ts`:

- `main(['embellish', <twinkle path>, '--out', <tmp>])` exits 0. The out file parses to 70 notes, and stderr says `light: 6 notes added`.
- `main(['embellish', <handel-aylesford path>])` exits 1. stderr starts `digitus2: refused: the melody voice plays chords`.
- `main(['embellish', <twinkle path>, '--density', 'playful'])` exits 2 (usage).
- `main(['embellish', <twinkle path>, '--guard', '--inserted', <tmp.json>])` writes the six `InsertedNote` records.
- `reads an archive score through gzip`: `readLibraryScore` of the first `.musicxml.gz` level 1 or 2 piece in the manifest gives text that starts with `<?xml` or `<score-partwise`.
- `runEmbellishGate` on a two-piece manifest written to a temporary directory (Twinkle, and Mary Had a Little Lamb, with `files.score` set to the absolute path of each score under `content/`), with a floor file `{ "embellish": { "offeredMin": 1 } }`. Expect `failures` `[]`, `scorecard.offered` 1, and Mary counted under fewer than three figures. With `offeredMin: 2`, `failures` has one line matching `/offered 1 < 2/`.

Run `pnpm --filter @digitus2/engine exec vitest run src/embellish/guard.test.ts cli/embellish.test.ts`. It fails.

- [ ] **Step 2: Implement `guard.ts`.** The algorithm, in order:
  1. `r = embellishMusicXml(plainXml)`. A refusal returns that refusal as the reason.
  2. Fewer than `minFigures` figures returns `` `${n} figure${n === 1 ? '' : 's'} (at least ${min})` ``.
  3. `checkEmbellishment(plainXml, r.xml, r.inserted, r.melodyVoice)`, with `r.melodyVoice` narrowed to `string` after the refusal check (it is `string | null` in `EmbellishResult`). When it is not ok, return `` `check: ${problems[0]}` ``.
  4. Parse the plain score. At each profile, solve it and lint it beginner-style, and keep that profile's beginner-error count.
  5. `evaluate(r)` parses `r.xml`. At each profile it solves (`{ profile, weightSet }`, no `level`, no pins) and lints (`{ profile, beginner: true }`). It collects the measure indices of the notes of every law-error issue, and of every beginner-error issue when the beginner errors exceed the plain score's at that profile. It returns `{ score, editorial, assignments, offending }`.
  6. When nothing offends, offer `r`.
  7. Otherwise `drop` is the offending bars that hold a figure (the `measureIndex` of `r.inserted`). When `drop` is empty, return `'lint errors in bars with no figure'`.
  8. `r2 = embellishMusicXml(plainXml, { dropBars: drop })`, then the figure count and the check again. `evaluate(r2)` must have no offending bar, else return `'lint errors after dropping the figures of bars ...'`.
  9. Offer `r2` with `droppedBars` set to the sorted `drop`.

- [ ] **Step 3: Implement `cli/embellish.ts` and wire it in `run.ts`.**
  - Add to `USAGE`:
    `  embellish <file> [--density light] [--out f.musicxml] [--inserted f.json] [--guard]   write the light embellishment (stdout without --out), or report the refusal`
    `  embellish --library manifest.json [--levels 1,2] [--floor floor.json] [--out f.json] [--json]   the library gate: guard, check, lint and level on every piece`
  - `dispatch` gets `if (command === 'embellish') return embellish(rest, io);`.
  - Use `oneOf('density', values.density, ['light'] as const)` for the density.
  - **File mode.** stderr gets `light: <n> notes added\n` (or `nothing to add` when there are none). The out file, or stdout, gets the XML.
  - `--json` prints the scorecard as JSON on stdout instead of the formatted text, as `evalhands --json` does.
  - **Gate mode.** For every manifest piece in `levels` (default 1 and 2), run `guardEmbellishment(readLibraryScore(...))`. Score paths resolve against the manifest's directory (`resolve(dirname(manifest), e.files.score)`, as `bench.ts` and `evalhands.ts` do). For each offered piece it re-verifies independently, adding a failure line `<slug>: <what>` for each of:
    - `checkEmbellishment` not ok, or `strongKept < strongTotal`;
    - at each `GUARD_PROFILES` profile: `guardErrors(lintFingering(offered.score, offered.assignments[p], { profile: p, beginner: true }))` has law errors, or more beginner errors than the plain score solved and linted afresh at `p`;
    - `proposeLevel(round3(levelScore(levelFeatures(emb, tempoBpm)))) > plainLevel + 1`.
  - The scorecard holds `pieces`, `refused`, `tooFew`, `guardRefused`, `offered`, `figures`, `passing`, `neighbour`, `retried`, `levelChange` (counts of −1, 0 and +1: adding notes can lower the shifts and leaps per 100 onsets), `seconds` and per-piece rows `{ slug, offered, figures, droppedBars, reason, plainLevel, level }`. It is written to `--out`.
  - A floor file gives `embellish.offeredMin`. `offered < offeredMin` adds the failure `` `offered ${offered} < ${offeredMin}` ``. A named floor file that is missing is an error, as in `evalhands`.
  - Exit 1 when `failures` is non-empty, printing each as `floor breach: ...` or `gate: ...` on stderr. The formatted scorecard goes to stdout.

- [ ] **Step 4: Run the tests.** Run `pnpm --filter @digitus2/engine exec vitest run src/embellish cli/embellish.test.ts`. PASS.

- [ ] **Step 5: Measure, then set the floor.**
  1. Run `pnpm --filter @digitus2/engine build`.
  2. Run `node packages/engine/dist/cli/main.js embellish --library content/manifest.json --out benchmarks/runs/verify-embellish.json` in the background. Expected: about 170 offered, no gate failure, under 60 s. Record the measured seconds in the scorecard and in `history.md`. If the run takes over 60 s, reuse the guard's plain lint counts for the beginner comparison and keep only the embellished re-lint independent.
  3. Add a block to `benchmarks/floor.json` after `hands`:

```json
"embellish": {
  "levels": [1, 2],
  "offeredMin": <the measured offered count>,
  "note": "Light embellishment (\"Add notes between\", docs/research/embellishment-spike.md section 6): the pieces at levels 1 and 2 that the guard offers (packages/engine/src/embellish/guard.ts: the light embellisher, the independent check, then solve with learned-open at the large, medium, small and child profiles and lint with beginner: true; zero law errors and no more beginner errors than the plain score at every profile, the figures of offending bars dropped once, at least three figures). digitus2 embellish --library also fails on any offered piece whose independent check, lint or level proposal (at most one up) fails. offeredMin is the measured count: the run is deterministic, so a drop is a change to explain, not noise. Measured <n> of 259 (<passing> passing and <neighbour> neighbour notes, <r> retried)."
}
```

4. Add a section `## Embellishment` to `benchmarks/history.md`. It needs one sentence on what is counted, and a table with the columns `Date | Commit | Label | Offered | Refused | Fewer than three figures | Guard refused | Retried | Notes added | Level change (−1 / 0 / +1) | Seconds`, with one row for this measurement (label `embellish-light`). Leave the `Commit` cell as `(controller)`: implementers run no git, and the controller fills the hash in when it commits.

- [ ] **Step 6: Wire the verify step.** In `scripts/verify.mjs`, first hoist one helper above the `benchmark` block, and use it in the bench and hands probes too, in place of their two copies of the same `spawnSync` code:

```js
const CLI = 'packages/engine/dist/cli/main.js';
/** The built engine CLI's usage text (it prints usage without a command), or null when not built. */
function cliUsage() {
  if (!existsSync(CLI)) return null;
  const r = spawnSync('node', [CLI], { encoding: 'utf8', shell: true });
  return `${r.stdout}${r.stderr}`;
}
```

Then, after the `hands` block:

```js
// The light embellishment gate ("Add notes between"): the guard, the independent check, the lint
// at every hand profile and the level heuristic on the library's level 1 and 2 pieces, against
// benchmarks/floor.json `embellish.offeredMin`. Needs only the committed library and the build.
if (want('embellish')) {
  const cli = CLI;
  const usage = cliUsage();
  if (usage === null) skip('embellish', 'engine not built (run the build step first)');
  else if (!/\bembellish\b/.test(usage))
    skip('embellish', 'engine CLI has no embellish command yet');
  else
    run('embellish', 'node', [
      cli,
      'embellish',
      '--library',
      LIBRARY_MANIFEST,
      '--floor',
      'benchmarks/floor.json',
      '--out',
      `${RUNS}/verify-embellish.json`,
    ]);
}
```

Move `LIBRARY_MANIFEST` and `RUNS` above the `benchmark` block if they are not in scope. Add `embellish` to the header comment's step list.

- [ ] **Step 7: Run the step and the engine suite.** Run `pnpm verify build embellish`: build passes and embellish passes. Then run `pnpm --filter @digitus2/engine test`, `pnpm typecheck` and `pnpm lint`, and `pnpm exec prettier --write` on the changed files. All pass.

- [ ] **Step 8: Commit.** The controller commits these paths: `packages/engine/src/embellish/guard.ts`, `guard.test.ts`, `index.ts`, `packages/engine/src/index.ts`, `packages/engine/cli/embellish.ts`, `embellish.test.ts`, `run.ts`, `scripts/verify.mjs`, `benchmarks/floor.json`, `benchmarks/history.md`. Message:

```
Embellish: the guard, digitus2 embellish and the library gate in pnpm verify (#67)
```

### Task 5: The worker request and the document's two versions

**Model:** opus

Why: async state with superseded renders, cached pages and note ids that change meaning between versions.

**Files:**

- Modify `protocol.ts`, `handlers.ts`, `client.ts`, `handlers.test.ts` and `client.test.ts` in `apps/web/src/engine/`
- Modify `useScoreDocument.ts` and `useScoreDocument.test.ts` in `apps/web/src/score/`
- Create `apps/web/src/score/testing/services.ts`: the inline engine (with `embellish`) and the fake renderer, moved out of `useScoreDocument.test.ts` and shared by the hook's tests.
- Modify `apps/web/src/score/useScoreDocument.midi.test.ts`: use the shared inline engine of `testing/services.ts` (its own `EngineClient` literal lacks the new required `embellish` method).
- Modify `SidePanel.test.tsx`, `score.i18n.test.tsx` and `ScoreView.letters.test.tsx` in `apps/web/src/score/`: their `ScoreDocument` literals gain `embellish: 'none', embellished: false, shownVersion: 'plain', plain: null, setEmbellished: () => {}` (otherwise `pnpm typecheck` fails). Task 6 edits `SidePanel.test.tsx` again afterwards.
- Create `apps/web/src/score/useScoreDocument.embellish.test.ts` and `apps/web/src/score/render/verovio.embellish.node.test.ts`

**Interfaces:**

- Consumes: `guardEmbellishment` and its types from `@digitus2/engine` (in the worker handler only).
- Produces, in the protocol:

```ts
// EngineRequest
| { id: number; type: 'embellish'; xml: string }
// EngineResponse
| {
    id: number; ok: true; type: 'embellish';
    offered: {
      xml: string; score: Score; editorial: Assignment;
      assignments: Record<HandSize, Assignment>; figures: number;
    } | null;
    reason: string | null; ms: number;
  }
```

- Produces, on the client: `embellish(xml: string): Promise<{ offered: EmbellishedDoc | null; reason: string | null; ms: number }>`, with `export type EmbellishedDoc = NonNullable<Extract<EngineResponse, { type: 'embellish'; ok: true }>['offered']>` exported from `protocol.ts`.
- Produces, on `ScoreDocument` (in addition to today's fields):

```ts
/** "Add notes between": 'pending' until decided, 'offered' once the guarded version is laid
 *  out (the switch shows), 'none' for a piece that does not get one. */
embellish: 'pending' | 'offered' | 'none';
/** The switch: on or off, for this open document only (off on every open). */
embellished: boolean;
/** Which version `score`, `assignment`, `editorial` and `pages` show. */
shownVersion: 'plain' | 'embellished';
/** The plain document, for export and the side panel's facts: its score and the fingering the
 *  plain pages show or would show (the engine's for the hand size, or the editor's when shown). */
plain: { score: Score; assignment: Assignment | null } | null;
setEmbellished(on: boolean): void;
```

- Produces, in `useScoreDocument.ts`:
  - `export const EMBELLISH_MAX_GRADE = 2;`
  - `export function embellishEligible(grade: number | null, scan: boolean): boolean`, which is `!scan && (grade === null || grade <= EMBELLISH_MAX_GRADE)`.
  - `export function carryAssignment(from: Score, a: Assignment, onto: Score): Assignment | null`. It matches notes by onset in quarters (`onsetTick / divisions`), `midi`, `staff` and `voice`, and gives `null` when nothing matches.
- `xml` keeps its meaning: the plain source text.

- [ ] **Step 1: Write the failing tests.**

`handlers.test.ts` additions:

- `embellish offers Twinkle with six figures and four fingerings`: `handle({ id: 1, type: 'embellish', xml: <twinkle text> })` is ok. `offered.figures` is 6, `offered.score.notes` has length 70, `Object.keys(offered.assignments)` are the four hand sizes, and `ms` is a number.
- `embellish says why Mary gets nothing`: `offered` is null and `reason` matches `/2 figures/`.

`client.test.ts` addition: `embellish` posts `{ type: 'embellish', xml }` and resolves `{ offered, reason, ms }` (fake worker, as the file's other cases).

`render/verovio.embellish.node.test.ts` (node environment, 30 s timeout), modelled on `verovio.node.test.ts`:

- Embellish `content/scores/twinkle-twinkle-little-star.musicxml` with `guardEmbellishment`.
- Run `injectNoteIds(injectFingerings(xml, score, assignments.medium), score)` and lay it out with `verovioOptions(900)`.
- Expect every `score.notes` id to match a `g.note` id, and 70 `g.fing` elements with `data-startid` equal to their notes.

`useScoreDocument.embellish.test.ts`, with the inline engine and fake renderer of `useScoreDocument.test.ts` (move them to a shared `apps/web/src/score/testing/services.ts` and add `embellish` to the inline engine). Twinkle's and Mary's library bytes are given as file sources (`{ kind: 'file', name: 'twinkle.musicxml', bytes }`):

- `offers the embellished version after the plain score is ready`:
  - The statuses walk to `ready` with `embellish: 'pending'`.
  - Then `embellish` becomes `'offered'`.
  - `engine.calls` shows `embellish` after the first `fingeredXml`.
  - The renderer was asked to lay out a text with 70 `<note id=`.
  - `embellished` is false, and `shownVersion` is `'plain'`.
- `switching on shows the embellished score and pages at once`:
  - Call `act(() => result.current.setEmbellished(true))`.
  - In the next render, `shownVersion` is `'embellished'`, `score.notes` has length 70, `pages` are the pre-laid-out ones, and `renderer.renders` is unchanged.
  - `plain.score.notes` has length 64, and `xml` is still the plain text.
- `switching off restores the plain pages without a layout`: `pages` equal the first ready pages, and `renderer.renders` is unchanged.
- `a piece with fewer than three figures is never offered`: Mary gives `embellish` `'none'`, and `setEmbellished(true)` changes nothing (`shownVersion` stays `'plain'`).
- `a new source starts with the switch off`: rerender with another source, and `embellished` is false again.
- `a MIDI hand-split reopen withdraws the switch until the new import is guarded`: open `packages/engine/fixtures/twinkle.mid` as a file, wait for `embellish` to leave `'pending'`, call `setSplitMidi(60)`; in the first render after, `embellish` is `'pending'`, `shownVersion` `'plain'` and `plain` null.
- `a hand-size change re-fingers both versions`:
  - Switch on, then set `handSize: 'child'`.
  - `digitChanges` patches embellished ids from `offered.assignments.child`, and no new layout runs.
  - The solve count rises by one: the plain re-solve.
  - `plain.assignment` is the new plain fingering.
- `a width change lays out the version on screen`: switched on, a rerender at 1200 px gives a render whose text has 70 `<note id=`.
- `the editor's fingering carries onto the original notes`: `carryAssignment` from a plain score with an editorial on note 0 onto the embellished score gives the entry on the embellished note at the same onset and pitch, and no entry on any added note.
- `embellishEligible`: `(2, false)` is true, `(3, false)` false, `(null, false)` true and `(1, true)` false.

Adjust the existing tests in `useScoreDocument.test.ts` that count renders or solves: wait until `embellish !== 'pending'` before taking `before` counts. `short-piano.musicxml` is a dropped file, so it is tried.

Run `pnpm --filter @digitus2/web exec vitest run src/engine src/score/useScoreDocument src/score/render/verovio.embellish.node.test.ts`. It fails.

- [ ] **Step 2: Implement the protocol, handler and client.**
  - The handler is `case 'embellish'`: time `guardEmbellishment(req.xml, { weightSet: RECOMMENDED_WEIGHT_SET })`, then return `{ offered: o ? { xml, score, editorial, assignments, figures } : null, reason, ms }`.
  - The client's `embellish` follows the `fingeredXml` pattern.

- [ ] **Step 3: Implement the two versions in `useScoreDocument.ts`.**
  - **Versions.** `OpenDoc` becomes `{ plain: Version; embellished: Version | null; grade: number | null; fingeredPath; editorialLoad; embellishAsked: boolean; pages: Map<string, { pages: string[]; assignment: Assignment; ms: number }> }`, with `Version = { score; xml; engine: Assignment | null; editorial: Assignment | null; laidOut: WeakMap<Assignment, string>; assignments?: Record<HandSize, Assignment> }`.
  - **Initial state.** `initialDoc` publishes `embellish: 'pending'`, `embellished: false`, `shownVersion: 'plain'` and `plain: null`.
  - **Load.** Effect 1 records `grade` from the loaded `LibraryPiece` (`piece.level`) and `null` for files. Effect 1's reopen branch (a MIDI hand-split change) also sets `embellish: 'pending'`, `shownVersion: 'plain'` and `plain: null`, so the switch goes away while the new import is guarded and never acts on a document with no embellished version.
  - **Switch state.** The switch state lives beside `splitMidi`: `useState({ source: `${sourceKey}|${splitMidi}`, on: false })`. `embellished` is true only while that key is current, so every open, new source and new hand split starts off.
  - **Effect 5, new, after effect 4.**
    - On `status === 'ready'` and `!doc.embellishAsked`: set `embellishAsked`. When `!embellishEligible(doc.grade, scanImport)`, publish `embellish: 'none'`. Otherwise call `engine.embellish(doc.plain.xml)`.
    - Offered:
      - build `doc.embellished`, with `engine = assignments[current handSize]`;
      - write `fingeredXml` and `injectNoteIds` for its engine fingering;
      - lay it out at `widthRef.current` with its own sequence number (it never touches `renderSeqRef`);
      - store the pages under the key `embellished|<bucket>|engine`, then publish `embellish: 'offered'`.
    - A `SupersededError` or a render failure on this pre-layout still publishes `'offered'` (the first switch lays out). Any other failure publishes `'none'`.
    - Every step checks the session.
  - **Effect 3, the layout.** It picks `v = embellishedOn && doc.embellished ? doc.embellished : doc.plain`. Its key gains the version. The editorial for `v`:
    - plain: `loadEditorial` as today;
    - embellished from a dropped file: `v.editorial` from the guard;
    - embellished from a library piece: `carryAssignment(doc.plain.score, plainEditorial, v.score)`.

    It looks up `doc.pages` by `version|bucket|engine-or-editorial` with a matching `assignment`. On a hit it publishes those pages in the same `setState` as `score: v.score`, `assignment`, `editorial` and `shownVersion`, with no render. Otherwise it lays out as today and stores the result. `plain` is published on every ready publish as `{ score: doc.plain.score, assignment: the plain shown fingering }`.

  - **Effect 4, the hand size.** The plain branch is unchanged: re-solve, and patch when plain is shown. In addition:
    - `doc.embellished.engine = doc.embellished.assignments[handSize]` (no solve);
    - when the embellished version is shown, its digits are patched through `diffDigits` exactly as the plain branch does;
    - `plain.assignment` is updated whichever version is shown.
  - **`setEmbellished(on)`** sets the state only while `embellish === 'offered'`; otherwise it does nothing.

- [ ] **Step 4: Run the tests.** Run `pnpm --filter @digitus2/web exec vitest run src/engine src/score`. PASS.

- [ ] **Step 5: Typecheck, lint, format, the web suite.** Run `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --write` on the changed files, and `pnpm --filter @digitus2/web test`. All pass.

- [ ] **Step 6: Commit.** The controller commits these paths:
  - in `apps/web/src/engine/`: `protocol.ts`, `handlers.ts`, `client.ts`, `handlers.test.ts`, `client.test.ts`;
  - in `apps/web/src/score/`: `useScoreDocument.ts`, `useScoreDocument.test.ts`, `useScoreDocument.midi.test.ts`, `useScoreDocument.embellish.test.ts`, `testing/services.ts`, `SidePanel.test.tsx`, `score.i18n.test.tsx`, `ScoreView.letters.test.tsx`, `render/verovio.embellish.node.test.ts`.

  Message:

```
Embellish: the worker's guarded embellishment and the document's two versions (#67)
```

### Task 6: The switch, its texts, the carry across a switch, and the e2e flows

**Model:** opus

Why: user-facing; the one-red rule, the loop and the play state across a score swap.

**Files:**

- Create `apps/web/src/score/carry.ts`, `carry.test.ts` and `apps/web/e2e/embellish.spec.ts`
- Modify `Transport.tsx`, `Transport.test.tsx`, `ScoreView.tsx`, `SidePanel.tsx` and `SidePanel.test.tsx` in `apps/web/src/score/`
- Modify `apps/web/src/i18n/{en,nl,fr,es,pt}/transport.ts`
- Modify `apps/web/e2e/helpers/states.ts` (the new state; `twinkleReady` waits for `data-embellish="offered"`) and `apps/web/e2e/states.spec.ts` (`openTwinkle` waits the same way, so the panel stops growing before its geometry checks; its `practiceControls` list stays unchanged, because the 360 px check iterates it and the box arrives asynchronously)
  **Interfaces:**

- Consumes: Task 5's `ScoreDocument` fields, plus `Playback`, `LoopRange`, `barIndexAt` and `barStartSecs`.
- Produces (`carry.ts`):

```ts
export interface Carry {
  bar: number;
  loop: LoopRange | null;
  playing: boolean;
  cued: boolean;
}
/** Where the reader is: the bar of the position (playing) or of where Play starts (stopped). */
export function captureCarry(playback: Playback, barStarts: readonly number[]): Carry;
/** After the new score is in: the loop again, the same bar's start, and playing on if it was. */
export function applyCarry(carry: Carry, playback: Playback, barStarts: readonly number[]): void;
```

- Produces: `PracticeControlsProps.embellish?: { on: boolean; set(on: boolean): void } | null`.

- [ ] **Step 1: Write the failing tests.**

`carry.test.ts`, with a fake `Playback` that records calls, and `barStarts = [0, 2.4, 4.8, 7.2]`:

- `captureCarry` while playing at 5.0 s gives `bar 2`, `playing true`.
- Stopped and cued at 2.4 gives `bar 1`, `cued true`.
- At the start gives `cued false`, `bar 0`.
- `applyCarry` with `{ bar: 2, loop: { from: 1, to: 3 }, playing: true, cued: true }` calls `setLoop({ from: 1, to: 3 })`, then `seek(4.8)`, then `play()`, in that order.
- `applyCarry` with `{ bar: 0, loop: null, playing: false, cued: false }` calls nothing.
- `carry keeps the loop, the bar and the play state` (Review Focus 3): playing in a loop from bar 2 to bar 3 at 5.0 s, capture then apply gives `setLoop({ from: 1, to: 2 })`, then `seek(4.8)`, then `play()`.

`Transport.test.tsx` additions:

- `PracticeControls without embellish shows no Add notes between`: there is no checkbox named `Add notes between`.
- `with embellish it shows an unticked Add notes between that calls set`: the checkbox is unticked, and a click calls `set(true)`. It sits after `Loop bars` in DOM order and has the `label.check` structure, like `Metronome`.

`SidePanel.test.tsx` addition: `export writes the plain document while notes are added`. Given a doc with `shownVersion 'embellished'` and `plain` set, the export click calls `services.engine.fingeredXml(doc.xml, doc.plain.score, doc.plain.assignment)`. Spy on `services.engine`.

`e2e/embellish.spec.ts`, using `?audio=silent`, Twinkle, the helpers of `e2e/helpers/seek.ts` and `expectOneRed` from `e2e/helpers/red.ts` (checked at each step, not sampled over a time window). `addNotes(page)` gets `page.getByRole('checkbox', { name: 'Add notes between' })` inside the open Practice panel. `panel(page)` is `page.locator('.practice-panel')`. No spec uses a timed wait: they wait on `data-embellish`.

- `the switch appears on Twinkle, adds notes and keeps one red`:
  - Open Twinkle and wait for 64 `g.fing`.
  - Open Practice. `await expect(panel(page)).toHaveAttribute('data-embellish', 'offered', { timeout: 20_000 })`, then `addNotes` is visible and unticked.
  - Tick it. Expect 70 `g.fing` and 70 `.score-sheet g.note`, and `expectOneRed(page)`.
- `the red follows an added note`:
  - Switch on, untick `Count-in`, and Play.
  - `waitForFunction` (raf polling) until `__digitus2.cursorSec()` is within 1e-6 of 0.3, the added D4 at bar 1 beat 1.5 (Twinkle at 100 qpm).
  - Then `expectOneRed(page, 'added note')`.
- `switching back restores the plain score and the bar`:
  - Seek to bar 3 (`seekBar(page, 2)`) and wait for `redSettled`.
  - Tick: `redBars` is `[2]` with 70 `g.fing`.
  - Untick: 64 `g.fing` and `redBars` `[2]`. `expectOneRed(page)` holds after each switch.
- `switching while playing in a loop` (Review Focus 3):
  - `setLoopBars(page, '3', '4')`, then switch on, Play, and wait for the position to pass the bar 3 start.
  - Untick. Wait with `data-embellish` still `'offered'` and 64 `g.fing`. Then `expect.poll(() => positionSec(page))` passes the bar 3 start plus 0.6 s (playback goes on). `positionSec` is below the bar 5 start, the `Loop bars` box is still ticked, and `expectOneRed(page)` holds at each of these points. The waits are on events, never on a fixed time.
- `export writes the plain score while notes are added` (Review Focus 5): switch on, then `Export MusicXML`. The download has 64 `<fingering` and no 70th `<note>` with a pitch. Count `<pitch>` against the library file's count.
- `the switch is absent on a piece with fewer than three figures`:
  - Open `mary-had-a-little-lamb` (through `/#/piece/mary-had-a-little-lamb`) and open Practice.
  - `await expect(panel(page)).toHaveAttribute('data-embellish', 'none', { timeout: 20_000 })`, then `await expect(addNotes(page)).toHaveCount(0)`. Assert `none` explicitly, not "not `pending`": an error would leave `pending` and the spec would wait rather than pass falsely.
- `the switch is absent on a scan import` (ruling 7's non-eligible import):
  - `mockWorker(page, <Twinkle's library text>)` and `scanOnePage(page)` (`e2e/helpers/scan.ts`), then click `Use for fingerings`, as `e2e/scan.spec.ts` does, and wait for the first `.score-sheet g.fing`.
  - Open Practice. `data-embellish` becomes `'none'` and `addNotes` has count 0, with the same two assertions. Twinkle's text would be offered if it were eligible, so this proves the scan exclusion.
- `the switch is absent on a refused import`: drop `libraryScore('handel-aylesford-minuet-d-minor')` as `aylesford.musicxml` through `Open your own score`. Its right hand plays chords, so the guard refuses it: `data-embellish` becomes `'none'` and `addNotes` has count 0.

`e2e/helpers/states.ts`: add the state `score-embellished` after `score-practice-open`. It is `twinkleReady`, then `openPractice`, then tick `Add notes between`, then wait for 70 `g.fing`, with `expectTag: 'button'`. `twinkleReady` also waits for `.practice-panel` to have `data-embellish="offered"`, and `openTwinkle` in `e2e/states.spec.ts` does the same, so the panel does not grow by one row while `states.spec.ts` measures it. Leave `practiceControls` in `states.spec.ts` unchanged.
Run `pnpm --filter @digitus2/web exec vitest run src/score/carry.test.ts src/score/Transport.test.tsx src/score/SidePanel.test.tsx`. It fails.

- [ ] **Step 2: Add the texts.** In each `apps/web/src/i18n/<locale>/transport.ts`, after `loopTo`, add `addNotes` with the Global Constraints value. In `en`, add the comment `/** The Practice switch that plays and shows the piece with passing and neighbour notes added (docs/app.md). */`.

- [ ] **Step 3: Implement.**
  - **`carry.ts`.**
    - `captureCarry` takes `at = playback.playing ? positionSec() : startSec()` and `bar = barIndexAt(barStarts, at)`.
    - `cued` is `!playback.atStart`.
    - `applyCarry` sets the loop when there is one. When `playing || cued`, it seeks to `barStarts[bar]` when that is above 0 (else it rewinds when playing). It calls `play()` when it was playing.
  - **`Transport.tsx` (`PracticeControls`).** Build the box, and render `{addNotes}` after the `div.loop` and before `p.seek-help`:

```tsx
const addNotes = embellish && (
  <label className="check">
    <input
      type="checkbox"
      checked={embellish.on}
      onChange={(e) => embellish.set(e.currentTarget.checked)}
    />{' '}
    {t.transport.addNotes}
  </label>
);
```

- **`ScoreView.tsx`.**
  - `carryRef = useRef<Carry | null>(null)`.
  - `toggleEmbellish(on)` does `carryRef.current = captureCarry(playback, barStarts); doc.setEmbellished(on)`.
  - A `useEffect` with deps `[score, doc.shownVersion, playback, barStarts]`, declared after `usePlayback` so that its halt has run, does: if `carryRef.current` is set and `doc.shownVersion` is the one asked for, call `applyCarry(carryRef.current, playback, barStarts)` and clear the ref. `carryRef` makes the extra runs no-ops, and the full deps keep `react-hooks/exhaustive-deps` (an error in `apps/web/src`) green.
  - Pass `embellish={doc.embellish === 'offered' ? { on: doc.embellished, set: toggleEmbellish } : null}` to `PracticeControls`.
  - Put `data-embellish={doc.embellish}` on the `div.practice-panel`: the e2e specs wait on it. It is a data attribute, not a visible control.
- **`SidePanel.tsx`.**
  - `const plainScore = doc.plain?.score ?? doc.score;` `const plainAssignment = doc.plain ? doc.plain.assignment : doc.assignment;`.
  - The export uses `fingeredXml(xml, plainScore, plainAssignment)`, and `canExport` tests `plainScore !== null && plainAssignment !== null` in place of `doc.score` and `doc.assignment`.
  - `measures` and the hand counts use `plainScore`.

- [ ] **Step 4: Run the unit tests.** Run `pnpm --filter @digitus2/web exec vitest run src/score src/i18n`. PASS.

- [ ] **Step 5: Run the e2e specs and the colour guard.** Run `pnpm --filter @digitus2/web exec playwright test e2e/embellish.spec.ts e2e/states.spec.ts e2e/seek.spec.ts e2e/score.spec.ts e2e/export.spec.ts` in the background, after `pnpm --filter @digitus2/web build`. Then run `node scripts/check-colors.mjs`. All pass at desktop and 360 px, light and dark.

- [ ] **Step 6: Typecheck, lint, format.** Run `pnpm typecheck`, `pnpm lint`, and `pnpm exec prettier --write` on the changed files. All pass.

- [ ] **Step 7: Commit.** The controller commits these paths:
  - in `apps/web/src/score/`: `carry.ts`, `carry.test.ts`, `Transport.tsx`, `Transport.test.tsx`, `ScoreView.tsx`, `SidePanel.tsx`, `SidePanel.test.tsx`;
  - `apps/web/src/i18n/{en,nl,fr,es,pt}/transport.ts`;
  - `apps/web/e2e/embellish.spec.ts`, `apps/web/e2e/helpers/states.ts` and `apps/web/e2e/states.spec.ts`.

  Message:

```
Embellish: the Add notes between switch, the carry across a switch, and its e2e flows (#67)
```

### Task 7: Docs, then `pnpm verify`

**Model:** sonnet

Why: prose against fixed facts, then the full loop.

**Files:**

- Modify `docs/app.md`, `packages/engine/README.md`, `docs/verification-loop.md` and `docs/research/embellishment-spike.md`

- [ ] **Step 1: `docs/app.md`.**
  - **Engine worker.** Add the bullet `embellish`. It runs `guardEmbellishment`:
    - the light embellisher;
    - the independent check;
    - a solve with `learned-open` and a beginner lint at each hand size;
    - the figures of offending bars dropped once;
    - at least three figures.
      It returns the embellished score with a fingering for every hand size, or the reason it is not offered.
  - **Open pipeline.** Add a paragraph, in present tense, saying that:
    - after the plain score is ready, a library piece at grade 1 or 2, or any dropped file except a scan, is embellished in the worker;
    - the embellished score is laid out ahead of time, so the switch changes the pages at once;
    - the two versions share the bar starts, so the bar, the loop and the play state carry across a switch;
    - a hand-size change takes the embellished fingering already solved for that size;
    - the editor's fingering carries onto the original notes by onset, pitch, staff and voice.
  - **The dock and Practice.** Add a bullet **Add notes between**. It is a checkbox after the loop, present only on a piece the guard offers. It is unticked on every open and kept for the open piece only.
    - Ticked, the sheet, the red cursor, the keyboard and playback use the embellished score: passing notes in thirds, and an upper neighbour a whole step above a repeated note, at most one per bar and never in neighbouring bars.
    - The level, the title, the facts and `Export MusicXML` stay the plain score's.
    - `Print` prints the page as shown.
  - **The red element rule's "Never red" list.** Add `Add notes between`.
  - **Testing.** Add the `embellish` spec and the `score-embellished` state to the state table.

- [ ] **Step 2: `packages/engine/README.md`.**
  - Add to API: `embellishMusicXml(text, { density?, dropBars? })` → `{ xml, inserted, refusal, skipped, melodyVoice }`, and `guardEmbellishment(plainXml, opts?)` → `{ offered, reason }`.
  - Add to CLI: `pnpm --filter @digitus2/engine cli embellish ../../content/scores/twinkle-twinkle-little-star.musicxml --out twinkle-light.musicxml`, and the `--library` gate line.

- [ ] **Step 3: `docs/verification-loop.md`.**
  - Add the row `| embellish | digitus2 embellish --library | an offered level 1–2 piece fails the independent check, the lint at a hand size (a law error, or more beginner errors than the plain score) or the level (more than one up), or fewer pieces are offered than embellish.offeredMin |` to the steps table.
  - Add the row `| embellish | the library's level 1 and 2 pieces (259) | offered below embellish.offeredMin (<n>) |` to the floors table.
  - Add `verify-embellish.json` to the scorecards sentence.
  - Add `pnpm verify build embellish` to "Running steps individually".
  - Note that `embellish` needs only the build and the committed library, so it never reports SKIP after the build.

- [ ] **Step 4: `docs/research/embellishment-spike.md`, section 6.** After its first paragraph, add one short note in present tense:

  > The app builds this as the Practice switch `Add notes between` (`docs/app.md`): light only, the upper neighbour only a whole step up, guarded at every hand size, and gated by `pnpm verify` (`embellish`).

- [ ] **Step 5: Format and run the full loop.** Run `pnpm exec prettier --write` on the four docs, then `pnpm verify` in the background. Every step passes. `benchmark`, `benchmark:mutopia` and `hands` report SKIP without the PIG dataset; say so in the report, because a run with those skipped has not checked their floors.

- [ ] **Step 6: Commit.** The controller commits these paths: `docs/app.md`, `packages/engine/README.md`, `docs/verification-loop.md`, `docs/research/embellishment-spike.md`. Message:

```
Docs: Add notes between in the app, the engine and the verification loop (#67)
```
