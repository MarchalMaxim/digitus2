# M2 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the defects the M2 whole-milestone review found in the rule-based solver before the learned weights (M3) are fitted on top of it: chords must never receive a physically impossible fingering when a legal one exists, notated holds beyond any hand's reach must not block fingers, leaps after a rest or a release must not be priced as stretches, thumb crossings must not be priced as impossible, and the lint laws must check every held pair. Then re-measure, raise the floors and record the ablation on the train split.

**Architecture:** Changes stay inside `packages/engine/src/fingering/solve.ts`, `rules.ts`, `src/lint/rules.ts`, the weight file's provenance and the floor/history/notebook files. The decoder (`viterbi.ts`) is unchanged; chord constraints are enforced by charging every pair of a slice (through the triple hook for pairs two steps apart) and by a post-decode chord check that forbids a violating configuration and decodes again, like the held-note loop. A shared helper decides when a held note is "out of reach" so the solver and lint agree.

**Tech Stack:** as M2. No new dependencies.

**Spec:** product spec 7.1 (span costs between every pair of fingers in a configuration; impossible chord shapes are infinite), verification spec section 1 rows "Avoid real mistakes", "Know the textbook", "Be physically possible" and section 3.8 (a rule whose removal improves the target is a bug or a wrong weight), section 4 (tune on PIG train and the textbook only; the test split is reported, never tuned on). Source of the findings: the M2 workflow's final review, quoted in each task below.

## Global Constraints

- M2's Global Constraints hold (engine code never touches DOM or Node APIs; within a slice fingers strictly increase with mirrored pitch; pins are hard; costs are sums of named weighted terms; determinism; 2000 notes under 500 ms).
- Never tune on PIG test pieces 001 to 030: every decision in Tasks 1 and 2 is made on the textbook oracle and PIG train (031 to 150); the test split is scored once at the end (Task 3) and reported.
- The identity "solver cost equals weights times path features" that M3 Task 0 will test must remain achievable: every charge the solver applies on a finite path must be a weighted term from `rules.ts` (unary, pair or triple), except the pin, held-note and chord-law penalties, which are infinite (or `SOFT_PENALTY` in a soft decode) and never weighted.
- Floors are raised in the same commit as the improvement and never lowered.
- `pnpm verify hygiene design typecheck lint unit build benchmark` stays green after every task (e2e is skipped in this worktree because the Playwright port is shared with another workflow); implementers do not run git.

## Review Focus

1. A triad whose outer notes exceed the practical span of the chosen fingers (C4 E4 C5 with 1 2 3) must cost infinity, not 30 per semitone, so the solver picks 1 2 5. Pinned by Task 1 (`outer pairs of a chord are priced`).
2. A bass held for a bar two octaves below a chord must not steal a finger from the chord (Satie, Moonlight); lint must report it as a warning, not a law. Pinned by Tasks 1 and 2 (`a notated hold beyond reach is released`).
3. A right-hand two-octave C major arpeggio must come out 1 2 3 1 2 3 5 ascending and 5 3 2 1 3 2 1 descending; the thumb-under crossing over a fourth must not pay beyondPractical. Pinned by Task 1 (`right-hand two-octave arpeggio`).
4. Chromatic scales must use the standard fingering (textbook oracle exact matches for `chromatic` rise from 0 of 48). Pinned by Task 1 (`chromatic scale`).
5. The post-decode chord loop must terminate and must not forbid the only legal configuration. Pinned by Task 1 (`chord loop terminates on a six-note slice and on an infeasible chord`).

## File Structure

```
packages/engine/src/fingering/reach.ts          outOfReach(profile tables, heldPitch, newPitch): boolean (shared by solver and lint)
packages/engine/src/fingering/solve.ts          chord pairs priced through triple(); chord law infinite; post-decode chord check loop; held notes beyond reach released
packages/engine/src/fingering/rules.ts          thumb-crossing exemption for beyondPractical; melodic beyondPractical skipped after a rest or a release
packages/engine/src/fingering/solve.test.ts     new goldens and loop tests
packages/engine/src/fingering/rules.test.ts     new term tests
packages/engine/src/lint/rules.ts               held non-neighbour span check in the L03 active loop; release beyond reach as warning L07
packages/engine/src/lint/rules.test.ts
packages/engine/src/fingering/params/weights-parncutt.json   provenance sentence corrected
content/tools/check_spans.py + content/verification.json      report of library slices no single hand can play (flagged, not fixed here)
benchmarks/floor.json, benchmarks/history.md, benchmarks/latest.json, docs/experiments.md, docs/PROGRESS.md
```

---

### Task 1: Solver and rule fixes (engine)

**Files:** create `reach.ts`; modify `solve.ts`, `rules.ts`, `solve.test.ts`, `rules.test.ts`, `weights-parncutt.json`.

Findings to fix (from the review, verbatim where useful):

- Blocker: "Chord span terms are only charged between neighbouring notes of a slice. pair() gets the slice neighbours i-1 and i, and triple() returns only the doubled-finger penalty, because tripleTerms() returns [] when notes share a slice. So the outer pair of a triad, and every pair two or more steps apart in a 4- or 5-note chord, has no cost at all. A chord beyond its practical span costs a finite 30 per semitone." Fix: (a) in `triple()`, when a, b and c share a slice, add the weighted chord terms of `pairTerms(ctx, a, h, c, f)` (chordStretch, chordSmallSpan, chordLargeSpan, chordBeyondPractical only; no handPositionShift); expose this as a named triple term source so `pathFeatures` can mirror it (for example `chordTerms2(ctx, a, h, c, f)` exported from `rules.ts` and called from both places). (b) After the decode, check every slice: for every pair of notes in the slice (any distance), if the interval exceeds `maxPrac`/falls below `minPrac` for their fingers, the configuration is illegal; if the slice has at least one legal configuration (enumerate the C(5,k) increasing assignments against the tables), forbid the decoded configuration for that slice (a set of forbidden configurations per slice, checked in `unary`/`pair`/`triple` through a slice-local lookup or by adding the whole configuration to a `forbiddenConfigs` map consulted when the slice's last note is placed) and decode again; stop when no slice violates or after `maxChordIterations` (default 8); slices with no legal configuration are left as decoded and reported as `infeasibleSlices` in `HandSolution`. (c) Chord pairs beyond practical cost `penalty` (infinite, or `SOFT_PENALTY` in a soft decode) instead of 30 per semitone **when the slice has a legal configuration**; keep the finite price for slices that have none, so the decode stays finite.
- Minor: "Notated holds that no hand can span are treated as physical holds." Fix: `reach.ts` exports `outOfReach(tables, heldPitch, newPitch)` = true when `|newPitch - heldPitch|` exceeds `maxPrac(1,5)` of the profile (or the mirrored equivalent); `sounding()`/`forEachSounding` in `solve.ts` ignore a held note that is out of reach of the new note (it is treated as released, so its finger is free). Lint uses the same helper (Task 2).
- Minor: "Melodic beyondPractical charges 10 points per semitone even after a rest or a release." Fix: in the melodic branch of `pairTerms`, skip `beyondPractical` (keep stretch/smallSpan/largeSpan as they are) when `b.restBefore` is true or when a's offset is before b's onset minus 1 ms (a released note); expose the release test as part of `NoteView` (`a.offsetSec <= b.onsetSec - 0.001`).
- Minor: "Right-hand 2-octave arpeggios fail in every white-key major and minor key ... the thumb-under 3 to 1 over a fourth pays beyondPractical, stretch and largeSpan." Fix: in the melodic branch, when the pair is a thumb crossing (`g === 1 || f === 1`, and `(f - g) * i < 0`) and `|i| <= 5`, do not charge `beyondPractical`; measure on the textbook oracle and PIG train whether also waiving `largeSpan` for that case helps, and keep the variant with the better textbook exact rate that does not lower PIG train gen.
- Chromatic scales: with the textbook oracle's chromatic entries (standard fingering 1 3 1 3 1 2 3 1 3 ... in the right hand), find why 0 of 48 pass (likely the same crossing pricing, or the template bonus not covering chromatic runs; `templates.ts` from M2 Task 8 detects scale and arpeggio runs, so add chromatic runs to the template detector if that is the cause) and fix it on the oracle.
- Provenance: correct the sentence in `weights-parncutt.json` ("Jacobs variant (weakFifth 0, threeFourFive 0) is not applied; both weights stay at 1").

Tests to add (write them first, run to red, then implement):

```ts
it('outer pairs of a chord are priced: C4 E4 C5 gets 1 2 5, never 1 2 3', ...)   // right hand; also the mirrored left-hand case
it('a five-note chord with a legal configuration never gets an impossible span', ...) // enumerate a few chords from the content library (Chopin 28/4 final chords excluded) and assert lint L05 count 0 on the solver's output
it('chord loop terminates on a six-note slice and on an infeasible chord', ...)  // six notes: finite result, infeasibleSlices lists it; a chord spanning 24 semitones in one hand: finite, listed
it('a notated hold beyond reach is released: a bass held a bar under a chord two octaves up leaves finger 5 free', ...)
it('a leap after a rest is not a stretch: beyondPractical absent when restBefore', ...)  // rules.test.ts
it('a thumb crossing over a fourth pays no beyondPractical', ...)                        // rules.test.ts
it('right-hand two-octave C major arpeggio: 1231235 up and 5321321 down at quarter = 120', ...)
it('chromatic scale from C, right hand, two octaves, standard fingering', ...)
```

Measure after the implementation (record in the report): `evaluateTextbook` exact counts by family (scales, arpeggios, chromatic) and per hand; lint errors per 1000 on the solver's output over the 30 **library** pieces and over PIG **train**; PIG train macro gen before and after (`bench --subset train`); timing per 1000 notes. Do not run the test split.

Verification: `pnpm --filter @digitus2/engine test`, tsc, lint, prettier, then `pnpm verify hygiene design typecheck lint unit build` (the benchmark step is Task 3's).

---

### Task 2: Lint laws for held pairs, release beyond reach, content span report

**Files:** modify `src/lint/rules.ts`, `src/lint/rules.test.ts`; create `content/tools/check_spans.py` and a pytest under `content/tools/tests/`; modify `content/verification.json` (add the span report).

- In the L03 active-list loop, also check `|cur.pitch - held.pitch|` against `maxPrac`/`minPrac` for `(held.finger, cur.finger)` when the fingers differ (law L05), **unless** `outOfReach(...)` says the held note is beyond any hand's reach, in which case the pair is reported as warning `L07` with the message "notated hold beyond reach: pedal or release"; use the shared `reach.ts` helper so lint and solver agree. Tests: a bass held under a chord two octaves up gives 0 errors and one L07 warning; a held note within reach with an impossible span is an L05 error.
- `content/tools/check_spans.py`: for every library score, list the slices of one hand whose span exceeds `maxPrac(1,5)` = 15 semitones (the large profile), with piece, bar, hand and pitches; write the list into `content/verification.json` under `spanFlags` and print it. The review named Satie Gymnopedie No. 1 (right hand [B3 D4 F#4 F#5]), Moonlight left hand [F#3 F#2 F#1], Chopin Op. 28 No. 7 and No. 4. Do not change the scores in this task; the report is the input for a content follow-up.
- Verification as Task 1 plus the pytest.

---

### Task 3: Re-measure, floors, history, notebook

**Files:** `benchmarks/floor.json`, `benchmarks/history.md`, `benchmarks/latest.json`, `docs/experiments.md`, `docs/PROGRESS.md`, `docs/superpowers/specs/2026-10-13-verification-design.md` (the measured note).

- Run `pnpm build`, then the official benchmark with ablation: `node packages/engine/dist/cli/main.js bench --gold research/data/pig --split research/data/splits/pig_official.json --floor benchmarks/floor.json --label m2-hardened --ablate`; also `--subset train --label m2-hardened-train` (no floor). Record both scorecards.
- Raise `engine` floors to the new test numbers minus 0.5 (never lower any), raise the textbook floors to the measured values minus 0.01, set `lint.errorsPer1000Max` to the new measurement rounded up (expected far below 8.32; if 0, write 0) and rewrite the lint note with the measured breakdown (the review found the old note blamed the wrong cause). Append the rows to `benchmarks/history.md` and the hypothesis/outcome entry to `docs/experiments.md` ("pricing every chord pair, releasing holds beyond reach, waiving beyondPractical after rests and on thumb crossings raises textbook exact matches and removes chord-law violations; expected gen on PIG train +1 or more"), including the ablation table on **train** and whether any rule still has a positive removal delta (if so, say which and leave it for M3).
- `pnpm verify hygiene design typecheck lint unit build benchmark` must pass against the new floors.

---

## Self-review notes

- Each review finding maps to a task: blocker → Task 1 (a, b, c); held beyond reach → Tasks 1 and 2; melodic beyondPractical → Task 1; arpeggios and chromatic → Task 1; lint held pairs → Task 2; content spans → Task 2 (report only); floor note and floors → Task 3; provenance → Task 1.
- The M3 plan's Task 0 identity test is kept achievable by requiring every finite charge to be a named weighted term, with the chord-pair triple terms exposed as a function `pathFeatures` can call.
