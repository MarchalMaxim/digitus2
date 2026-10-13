# M2 Solver v1 and Verification Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rule-based piano fingering solver (Parncutt 1997 ergonomic rules with Jacobs and Balliauw extensions, exact second-order Viterbi with min-sum marginals) for both hands, plus the verification core: lint, the textbook oracle, the metamorphic suite, and a `bench` command that writes scorecards and error galleries and gates against `benchmarks/floor.json`.

**Architecture:** `packages/engine/src/fingering/` holds geometry (left hand mirrored onto the right), span tables and hand profiles, named rule terms, a sequence builder (slices in arpeggiated order), a generic second-order decoder, and `solveFingering` which assembles them with pins and held-note constraints. `src/lint/` re-uses the rule terms as checks. `src/eval/` gains the textbook oracle and metamorphic transforms. `cli/` gains `finger`, `lint` and `bench`. All parameters live in JSON under `src/fingering/params/`.

**Tech Stack:** as M1 (TypeScript strict, vitest, pnpm). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-13-digitus2-design.md` (section 7) and `docs/superpowers/specs/2026-10-13-verification-design.md` (sections 1, 2, 3.2 to 3.8, 4). Source of the formulas: `docs/research/literature.md` sections 2.1, 4.3, 5.2, 6.3, 6.4, 6.6 (read them; the tables below are copied from there).

## Global Constraints

- Engine code never touches DOM or Node-only APIs outside `cli/` (spec section 4).
- Fingers are 1..5 for both hands; the left hand is solved in the mirrored right-hand view and fingers are output unchanged (literature 6.3 item 4: `p' = 124 - p`).
- Within a slice (notes of one hand with the same onset) fingers strictly increase with mirrored pitch; same finger on two simultaneous notes is forbidden (verification spec 2.4, lint L01 and L02 are laws).
- Pinned fingers (user, or editorial when requested) are hard constraints (spec 7.1).
- Every cost is a sum of named rule terms with a weight from a JSON parameter file, so any rule can be switched off by setting its weight to 0 (spec 7.3).
- The solver is deterministic: identical input gives byte-identical output (verification spec 3.4).
- A 2000-note piece must solve in under 500 ms in Node (verification spec goals table; target 200 ms).
- PIG official test split pieces 001 to 030 are never used for tuning (verification spec section 4 item 5). Weights in this milestone are the literature defaults, not fitted.
- Linear history on `main`; implementers do not run git; `pnpm verify` must stay green after every task.

## Review Focus

1. A held left-hand note (a whole-note bass under a moving voice) must keep its finger reserved until it ends; if the solver re-uses that finger for a later note while it still sounds, the fingering is physically impossible. Pinned by Task 5 (`held note keeps its finger reserved beyond two steps`).
2. A grace note shares its onset tick with the following note in MusicXML; if it lands in the same slice, the solver treats it as a chord and forces distinct ascending fingers on two notes that are played one after the other. Pinned by Task 3 (`grace note gets its own slice before the principal`).
3. A user pin that makes the rest of the passage impossible (pin finger 5 on a note in the middle of an ascending run) must still produce a finite solution rather than an all-infinite path with garbage back-pointers. Pinned by Task 5 (`pins never produce an infinite cost; soft beyond-practical keeps a finite path`).
4. A left-hand descending scale must come out as 5 4 3 2 1 3 2 1 (the mirror of the right hand ascending); a sign error in the mirror makes every left-hand fingering wrong while all right-hand tests pass. Pinned by Task 5 (`left hand C major descending`) and Task 7 (textbook, both hands).
5. The benchmark must never silently score a piece against the wrong gold file or skip pieces without saying so; a benchmark that drops two pieces reports a higher number that looks like progress. Pinned by Task 10 (`bench reports every test piece or lists it under skipped with a reason`).

## File Structure

```
packages/engine/src/fingering/geometry.ts         mirrorPitch, whiteColumn, x14, isBlack (re-export)
packages/engine/src/fingering/spans.ts            Parncutt tables, span lookup with reversed pairs and Min=-Max, profiles
packages/engine/src/fingering/params/profiles.json hand-size profiles (scale factors) with provenance
packages/engine/src/fingering/params/weights-parncutt.json rule weights (literature defaults) with provenance
packages/engine/src/fingering/rules.ts            unary, pair, triple rule terms (unweighted points) and weighting
packages/engine/src/fingering/sequence.ts         Score + hand -> HandSequence (slices, arpeggiated order, mirrored pitch, IOI, rests)
packages/engine/src/fingering/viterbi.ts          second-order decoder with min-sum forward-backward marginals
packages/engine/src/fingering/solve.ts            solveFingering: constraints, pins, held notes, confidence, alternatives, explanations
packages/engine/src/fingering/templates.ts        scale and arpeggio run detection + textbook template bonus
packages/engine/src/fingering/params/textbook/    copied textbook tables used as templates (+ provenance.json)
packages/engine/src/lint/rules.ts                 L01..L14 lint checks over Score + Assignment
packages/engine/src/lint/index.ts                 lintFingering(score, assignment, opts) -> LintReport
packages/engine/src/eval/textbook.ts              load textbook JSON, build scores, evaluate exact-match accuracy
packages/engine/src/eval/metamorphic.ts           transforms and the metamorphic runner
packages/engine/src/eval/hardErrors.ts            unanimous-note hard-error rate
packages/engine/cli/finger.ts                     digitus2 finger <file> [--out] [--format pig|musicxml] [--profile] [--hand]
packages/engine/cli/lint.ts                       digitus2 lint <file> [--fingering <pigfile>]
packages/engine/cli/bench.ts                      digitus2 bench --gold --split [--floor] [--out] [--label] [--ablate]
packages/engine/cli/main.ts                       dispatch additions
packages/engine/fixtures/metrics-reference.json   Python-computed metrics for one PIG piece (Task 0)
benchmarks/runs/, benchmarks/latest.json, benchmarks/errors/   written by bench (runs and errors gitignored except latest.json)
```

---

### Task 0: Reconcile the TypeScript metrics with the Python reference

**Files:**

- Modify: `packages/engine/src/eval/metrics.ts`, `packages/engine/src/eval/metrics.test.ts`, `packages/engine/src/eval/align.ts` (only if needed)
- Create: `packages/engine/fixtures/metrics-reference.json`, `packages/engine/src/eval/metrics.reference.test.ts`

**Interfaces:**

- Consumes: `pigMetrics`, `metricsForScores` (M1 Task 9), `parsePig` (M1 Task 4); the Python package `research/fingering_eval` (venv at `research/.venv`, run from the repo root with `research/.venv/Scripts/python -m fingering_eval.evaluate ...`).
- Produces: unchanged signatures; `rec` and `high` now match the official evaluator's conventions. The file `fixtures/metrics-reference.json` has the shape `{ "piece": "001", "predAnnotation": "1", "goldAnnotations": ["2","5","8"], "python": { "gen": number, "high": number, "soft": number, "rec": number }, "command": string }`.

- [ ] **Step 1: Produce the reference numbers with Python**

Run from the repo root (the datasets agent documented the CLI in `research/fingering_eval/evaluate.py`; read its docstring first):

```bash
research/.venv/Scripts/python -m fingering_eval.evaluate --gold research/data/pig --split test --pred research/data/pig --pred-annotation 1 --gold-annotations 2,5,8
```

If the CLI prints only aggregates, write a five-line Python script in your temp directory that imports `fingering_eval.metrics` and calls `evaluate_piece` for piece `001` with annotation 1 as the estimate and annotations 2, 5, 8 as ground truths (read `research/fingering_eval/metrics.py` for the exact signatures and the `mode` argument; use the mode the datasets report says matches the official evaluator, named `official` in the split file's verification note). Record the four numbers with full precision in `packages/engine/fixtures/metrics-reference.json` together with the exact command.

- [ ] **Step 2: Write the failing reference test**

`packages/engine/src/eval/metrics.reference.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePig } from '../io/pig/read.js';
import { metricsForScores } from './align.js';

const root = new URL('../../../../', import.meta.url);
const ref = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('fixtures/metrics-reference.json', new URL('../../', import.meta.url))),
    'utf8',
  ),
) as {
  piece: string;
  predAnnotation: string;
  goldAnnotations: string[];
  python: { gen: number; high: number; soft: number; rec: number };
};
const dir = fileURLToPath(new URL('research/data/pig/FingeringFiles/', root));
const load = (a: string) => parsePig(readFileSync(`${dir}${ref.piece}-${a}_fingering.txt`, 'utf8'));

describe('metrics agree with the Python reference (official evaluator conventions)', () => {
  it.skipIf(!existsSyncSafe(dir))(
    'matches gen, high, soft and rec to 1e-6 on a real PIG piece',
    () => {
      const pred = load(ref.predAnnotation);
      const golds = ref.goldAnnotations.map(load);
      const m = metricsForScores(pred, golds);
      expect(m.gen).toBeCloseTo(ref.python.gen, 6);
      expect(m.high).toBeCloseTo(ref.python.high, 6);
      expect(m.soft).toBeCloseTo(ref.python.soft, 6);
      expect(m.rec).toBeCloseTo(ref.python.rec, 6);
    },
  );
});

function existsSyncSafe(p: string): boolean {
  try {
    return readFileSync(`${p}001-1_fingering.txt`).length > 0;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Run it and read the Python implementation**

Run: `pnpm --filter @digitus2/engine exec vitest run src/eval/metrics.reference.test.ts`
Expected: FAIL on `rec` (the M1 implementation had no switch cost) and possibly on `high` (the Python `highest_match_rate` has a `per_hand` option; check which setting the `official` mode uses and whether the official evaluator takes the best annotator per hand or per piece).
Read `research/fingering_eval/metrics.py` fully: `_dp_cost`, `multi_gt_error`, `recombination_match_rate`, `highest_match_rate`, and the `mode` handling (`press` versus `official`: how substitutions and the first finger are treated).

- [ ] **Step 4: Make the TypeScript match**

Edit `recombinationHits` in `packages/engine/src/eval/metrics.ts` so that it implements the same edit-cost DP as the Python (`C_SUB = 1`, `C_REC = 1`, switches allowed only where the two annotators agree at the switch point, using the same index convention as `_dp_cost`), and compute `rec = (N - minCost) / N` over the same note grouping the Python uses (whole piece or per hand; follow the Python). If `high` differs, implement the Python's convention (per-hand best annotator or per-piece) and document it in the docstring. Update `metrics.test.ts` expectations only where the definition changed (the `charges one point per annotator switch` case expects 0.75; the per-hand case stays 1).

- [ ] **Step 5: Run all metrics tests**

Run: `pnpm --filter @digitus2/engine exec vitest run src/eval && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: all pass including the reference test.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/eval packages/engine/fixtures/metrics-reference.json
git commit -m "fix(engine): recombination and highest match rates match the official evaluator"
```

---

### Task 1: Keyboard geometry, span tables and hand profiles

**Files:**

- Create: `packages/engine/src/fingering/geometry.ts`, `packages/engine/src/fingering/geometry.test.ts`, `packages/engine/src/fingering/spans.ts`, `packages/engine/src/fingering/spans.test.ts`, `packages/engine/src/fingering/params/profiles.json`

**Interfaces:**

- Consumes: `isBlackKey` from `score/pitch.ts`; `Finger` from `score/types.ts`.
- Produces:

```ts
// geometry.ts
export const MIRROR_SUM = 124; // p' = 124 - p reflects about D4 (midi 62); the keyboard's black/white layout is symmetric about D
export function mirrorPitch(midi: number): number; // 124 - midi
export function whiteColumn(midi: number): number; // 7 * floor(midi/12) + [0,0,1,1,2,3,3,4,4,5,5,6][pc]
export function x14(midi: number): number; // 14 * floor(midi/12) + [0,1,2,3,4,6,7,8,9,10,11,12][pc]
export { isBlackKey as isBlack } from '../score/pitch.js';

// spans.ts
export type SpanMatrix = number[][]; // [f-1][g-1], right hand, semitones, f = first finger, g = second
export interface SpanTables {
  maxPrac: SpanMatrix;
  maxComf: SpanMatrix;
  maxRel: SpanMatrix;
}
export type SpanKind = 'minPrac' | 'minComf' | 'minRel' | 'maxRel' | 'maxComf' | 'maxPrac';
export const PARNCUTT_TABLES: SpanTables; // the three 5x5 matrices below
export function span(t: SpanTables, kind: SpanKind, f: Finger, g: Finger): number; // Min kinds are -Max(g, f)
export function scaleTables(t: SpanTables, factor: number): SpanTables; // Math.round(v * factor) per entry
export type HandProfileId = 'child' | 'small' | 'medium' | 'large';
export interface HandProfile {
  id: HandProfileId;
  label: string;
  scale: number;
  tables: SpanTables;
}
export const HAND_PROFILES: Record<HandProfileId, HandProfile>; // from params/profiles.json
export function resolveProfile(p: HandProfileId | HandProfile | undefined): HandProfile; // default 'large'
```

The Parncutt matrices (literature 2.1, Appendix of Parncutt et al. 1997; rows f = 1..5, columns g = 1..5):

```
maxPrac: [[0,10,12,14,15],[5,0,5,7,10],[4,-1,0,4,7],[3,-1,-1,0,5],[1,-2,-1,-1,0]]
maxComf: [[0,8,10,12,13],[3,0,3,5,8],[2,-1,0,2,5],[1,-1,-1,0,3],[-1,-2,-1,-1,0]]
maxRel:  [[0,5,7,9,10],[-1,0,2,4,6],[-3,-1,0,2,4],[-5,-3,-1,0,2],[-7,-5,-3,-1,0]]
```

Min kinds: `minX(f, g) = -maxX(g, f)`. The diagonal is 0 for every kind.

`params/profiles.json`:

```json
{
  "provenance": "Parncutt et al. 1997 Table 1 semitone spans (adult male pianist). Scale factors: Parncutt suggests about 0.9 for smaller hands; 'small' and 'child' are placeholders to calibrate with teachers (literature 4.4). Written 2026-10-13.",
  "profiles": {
    "large": { "label": "Large hand (over 22 cm thumb to fifth)", "scale": 1.0 },
    "medium": { "label": "Medium hand (20 to 22 cm)", "scale": 0.9 },
    "small": { "label": "Small hand (under 20 cm)", "scale": 0.8 },
    "child": { "label": "Child (roughly ages 6 to 10)", "scale": 0.7 }
  }
}
```

Import JSON with `import profiles from './params/profiles.json' with { type: 'json' };` (Node 22 and Vite both support import attributes; add `"resolveJsonModule": true` to `tsconfig.base.json` if tsc complains).

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/fingering/geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isBlack, mirrorPitch, whiteColumn, x14 } from './geometry.js';

describe('geometry', () => {
  it('mirrors about D4 and preserves key colour', () => {
    expect(mirrorPitch(62)).toBe(62);
    expect(mirrorPitch(60)).toBe(64);
    expect(mirrorPitch(61)).toBe(63);
    for (let p = 21; p <= 108; p++) expect(isBlack(mirrorPitch(p))).toBe(isBlack(p));
  });
  it('computes white-key columns and 14-unit coordinates', () => {
    expect(whiteColumn(60)).toBe(35);
    expect(whiteColumn(61)).toBe(35);
    expect(whiteColumn(62)).toBe(36);
    expect(whiteColumn(72) - whiteColumn(60)).toBe(7);
    expect(x14(60)).toBe(70);
    expect(x14(64) - x14(60)).toBe(4);
    expect(x14(65) - x14(64)).toBe(2);
  });
});
```

`packages/engine/src/fingering/spans.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Finger } from '../score/types.js';
import { HAND_PROFILES, PARNCUTT_TABLES, resolveProfile, scaleTables, span } from './spans.js';

const F: Finger[] = [1, 2, 3, 4, 5];

describe('Parncutt span tables', () => {
  it('reproduces Table 1 for the 1-2 and 2-3 pairs', () => {
    expect([
      span(PARNCUTT_TABLES, 'minPrac', 1, 2),
      span(PARNCUTT_TABLES, 'minComf', 1, 2),
      span(PARNCUTT_TABLES, 'minRel', 1, 2),
      span(PARNCUTT_TABLES, 'maxRel', 1, 2),
      span(PARNCUTT_TABLES, 'maxComf', 1, 2),
      span(PARNCUTT_TABLES, 'maxPrac', 1, 2),
    ]).toEqual([-5, -3, 1, 5, 8, 10]);
    expect([
      span(PARNCUTT_TABLES, 'minPrac', 2, 3),
      span(PARNCUTT_TABLES, 'minComf', 2, 3),
      span(PARNCUTT_TABLES, 'minRel', 2, 3),
      span(PARNCUTT_TABLES, 'maxRel', 2, 3),
      span(PARNCUTT_TABLES, 'maxComf', 2, 3),
      span(PARNCUTT_TABLES, 'maxPrac', 2, 3),
    ]).toEqual([1, 1, 1, 2, 3, 5]);
  });
  it('reverses pairs by negating and swapping min and max', () => {
    expect(span(PARNCUTT_TABLES, 'maxPrac', 2, 1)).toBe(5);
    expect(span(PARNCUTT_TABLES, 'minPrac', 2, 1)).toBe(-10);
    expect(span(PARNCUTT_TABLES, 'maxComf', 4, 1)).toBe(1);
    expect(span(PARNCUTT_TABLES, 'minComf', 4, 1)).toBe(-12);
  });
  it('satisfies the published relations between columns for every ascending pair', () => {
    for (const f of F)
      for (const g of F) {
        if (f >= g) continue;
        const t = PARNCUTT_TABLES;
        expect(span(t, 'maxComf', f, g)).toBe(span(t, 'maxPrac', f, g) - 2);
        if (f === 1) {
          expect(span(t, 'minComf', f, g)).toBe(span(t, 'minPrac', f, g) + 2);
          expect(span(t, 'maxRel', f, g)).toBe(span(t, 'maxComf', f, g) - 3);
          expect(span(t, 'minRel', f, g)).toBe(2 * (g - f) - 1);
        } else {
          expect(span(t, 'minComf', f, g)).toBe(span(t, 'minPrac', f, g));
          expect(span(t, 'maxRel', f, g)).toBe(2 * (g - f));
          expect(span(t, 'minRel', f, g)).toBe(2 * (g - f) - 1);
        }
      }
  });
  it('has a zero diagonal', () => {
    for (const f of F) expect(span(PARNCUTT_TABLES, 'maxComf', f, f)).toBe(0);
  });
  it('scales tables and resolves profiles', () => {
    const s = scaleTables(PARNCUTT_TABLES, 0.9);
    expect(span(s, 'maxPrac', 1, 5)).toBe(14);
    expect(span(s, 'minPrac', 1, 2)).toBe(-5);
    expect(resolveProfile(undefined).id).toBe('large');
    expect(resolveProfile('child').scale).toBe(0.7);
    expect(span(HAND_PROFILES.child.tables, 'maxPrac', 1, 5)).toBe(11);
    expect(resolveProfile(HAND_PROFILES.small)).toBe(HAND_PROFILES.small);
  });
});
```

(`Math.round(-4.5)` is `-4` in JavaScript, so `minPrac(1,2)` scaled by 0.9 is `-(Math.round(5*0.9)) = -5` because Min is derived from the scaled Max of the reversed pair: `maxPrac(2,1) = 5 → round(4.5) = 5`. The test pins exactly that.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine exec vitest run src/fingering`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`packages/engine/src/fingering/geometry.ts`:

```ts
export { isBlackKey as isBlack } from '../score/pitch.js';

export const MIRROR_SUM = 124;
const WHITE_COL = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const X14 = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];

function pc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function mirrorPitch(midi: number): number {
  return MIRROR_SUM - midi;
}

export function whiteColumn(midi: number): number {
  return 7 * Math.floor(midi / 12) + WHITE_COL[pc(midi)]!;
}

export function x14(midi: number): number {
  return 14 * Math.floor(midi / 12) + X14[pc(midi)]!;
}
```

`packages/engine/src/fingering/spans.ts`:

```ts
import type { Finger } from '../score/types.js';
import profilesJson from './params/profiles.json' with { type: 'json' };

export type SpanMatrix = number[][];
export interface SpanTables {
  maxPrac: SpanMatrix;
  maxComf: SpanMatrix;
  maxRel: SpanMatrix;
}
export type SpanKind = 'minPrac' | 'minComf' | 'minRel' | 'maxRel' | 'maxComf' | 'maxPrac';

export const PARNCUTT_TABLES: SpanTables = {
  maxPrac: [
    [0, 10, 12, 14, 15],
    [5, 0, 5, 7, 10],
    [4, -1, 0, 4, 7],
    [3, -1, -1, 0, 5],
    [1, -2, -1, -1, 0],
  ],
  maxComf: [
    [0, 8, 10, 12, 13],
    [3, 0, 3, 5, 8],
    [2, -1, 0, 2, 5],
    [1, -1, -1, 0, 3],
    [-1, -2, -1, -1, 0],
  ],
  maxRel: [
    [0, 5, 7, 9, 10],
    [-1, 0, 2, 4, 6],
    [-3, -1, 0, 2, 4],
    [-5, -3, -1, 0, 2],
    [-7, -5, -3, -1, 0],
  ],
};

export function span(t: SpanTables, kind: SpanKind, f: Finger, g: Finger): number {
  switch (kind) {
    case 'maxPrac':
      return t.maxPrac[f - 1]![g - 1]!;
    case 'maxComf':
      return t.maxComf[f - 1]![g - 1]!;
    case 'maxRel':
      return t.maxRel[f - 1]![g - 1]!;
    case 'minPrac':
      return -t.maxPrac[g - 1]![f - 1]!;
    case 'minComf':
      return -t.maxComf[g - 1]![f - 1]!;
    case 'minRel':
      return -t.maxRel[g - 1]![f - 1]!;
  }
}

export function scaleTables(t: SpanTables, factor: number): SpanTables {
  const scale = (m: SpanMatrix): SpanMatrix =>
    m.map((row) => row.map((v) => Math.round(v * factor)));
  return { maxPrac: scale(t.maxPrac), maxComf: scale(t.maxComf), maxRel: scale(t.maxRel) };
}

export type HandProfileId = 'child' | 'small' | 'medium' | 'large';
export interface HandProfile {
  id: HandProfileId;
  label: string;
  scale: number;
  tables: SpanTables;
}

const raw = profilesJson as { profiles: Record<HandProfileId, { label: string; scale: number }> };
export const HAND_PROFILES: Record<HandProfileId, HandProfile> = Object.fromEntries(
  (Object.keys(raw.profiles) as HandProfileId[]).map((id) => {
    const p = raw.profiles[id];
    return [
      id,
      {
        id,
        label: p.label,
        scale: p.scale,
        tables: p.scale === 1 ? PARNCUTT_TABLES : scaleTables(PARNCUTT_TABLES, p.scale),
      },
    ];
  }),
) as Record<HandProfileId, HandProfile>;

export function resolveProfile(p: HandProfileId | HandProfile | undefined): HandProfile {
  if (p === undefined) return HAND_PROFILES.large;
  return typeof p === 'string' ? HAND_PROFILES[p] : p;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @digitus2/engine exec vitest run src/fingering && pnpm --filter @digitus2/engine exec tsc --noEmit`
Expected: all pass. If tsc rejects the JSON import, add `"resolveJsonModule": true` to `tsconfig.base.json` (that file is shared; mention it in your report).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/fingering tsconfig.base.json
git commit -m "feat(engine): keyboard geometry, Parncutt span tables and hand profiles"
```

---

### Task 2: Rule terms (Parncutt 1997, Jacobs, Balliauw) with golden tests

**Files:**

- Create: `packages/engine/src/fingering/rules.ts`, `packages/engine/src/fingering/rules.test.ts`, `packages/engine/src/fingering/params/weights-parncutt.json`

**Interfaces:**

- Consumes: `span`, `SpanTables`, `HandProfile` (Task 1); `Finger`.
- Produces:

```ts
export interface NoteView {
  pitch: number;
  black: boolean;
  onsetSec: number;
  offsetSec: number;
  slice: number;
  restBefore: boolean;
  ioi: number;
}
// pitch is already mirrored for the left hand; ioi = seconds since the previous slice's onset (0 inside a slice)

export type RuleId =
  | 'weakFinger'
  | 'weakFifth'
  | 'thumbOnBlack'
  | 'fiveOnBlack' // unary
  | 'stretch'
  | 'smallSpan'
  | 'largeSpan'
  | 'beyondPractical'
  | 'threeToFour'
  | 'fourOnBlack'
  | 'thumbPassing'
  | 'hop'
  | 'repeatedNoteSameFinger'
  | 'repeatedNoteFingerChange' // pair, melodic
  | 'chordStretch'
  | 'chordSmallSpan'
  | 'chordLargeSpan'
  | 'chordBeyondPractical' // pair, within a slice
  | 'handPositionShift' // pair, every case (five-finger-position model)
  | 'positionChangeCount'
  | 'positionChangeSize'
  | 'threeFourFive'
  | 'sameFingerPivot' // triple
  | 'template'; // Task 8 (unary bonus)
export type RuleWeights = Record<RuleId, number>;
export const PARNCUTT_WEIGHTS: RuleWeights; // from params/weights-parncutt.json
export interface Term {
  rule: RuleId;
  points: number;
}
export interface RuleContext {
  tables: SpanTables;
  weights: RuleWeights;
  hopFastSec: number;
  repeatFastSec: number;
} // defaults 0.25 and 0.18
export function makeContext(profile: HandProfile, weights?: Partial<RuleWeights>): RuleContext;
export function unaryTerms(
  ctx: RuleContext,
  n: NoteView,
  f: Finger,
  prev: NoteView | undefined,
  next: NoteView | undefined,
): Term[];
export function pairTerms(ctx: RuleContext, a: NoteView, g: Finger, b: NoteView, f: Finger): Term[]; // a before b in sequence order
export function tripleTerms(
  ctx: RuleContext,
  a: NoteView,
  h: Finger,
  b: NoteView,
  g: Finger,
  c: NoteView,
  f: Finger,
): Term[];
export function weightedSum(ctx: RuleContext, terms: Term[]): number;
```

Rules, with `i = b.pitch - a.pitch`, `over(v, M) = max(0, v - M)`, `under(v, m) = max(0, m - v)`, `theta = 1` when the thumb is in the pair else `2` (literature 2.1 and 6.4):

Unary (`prev`/`next` are the sequence neighbours; a missing neighbour counts as not white):

- weakFinger: 1 point if f = 4; weakFifth: 1 point if f = 5 (weight 1 for Parncutt, 0 for Jacobs).
- thumbOnBlack: if f = 1 and n.black: 1 + 2·[prev white] + 2·[next white].
- fiveOnBlack: if f = 5 and n.black: 2·[prev white] + 2·[next white].

Pair, same slice (`a.slice === b.slice`, chord; the decoder guarantees f > g): chordStretch = stretch points, chordSmallSpan = small-span points, chordLargeSpan = large-span points, chordBeyondPractical = beyond-practical points (weights 2, 2, 2, 10: Balliauw rule 14).

Pair, melodic (different slices):

- if g = f and i ≠ 0: only `hop`: 0 points if b.restBefore, else 2 if b.ioi < hopFastSec, else 0.5. No span terms.
- if i = 0 (repeated key): only `repeatedNoteSameFinger` (2 points when g = f and b.ioi < repeatFastSec) or `repeatedNoteFingerChange` (1 point when g ≠ f and b.ioi ≥ repeatFastSec). Nothing else.
- otherwise: stretch = over(i, maxComf(g,f)) + under(i, minComf(g,f)); smallSpan = theta·under(i, minRel(g,f)); largeSpan = theta·over(i, maxRel(g,f)); beyondPractical = over(i, maxPrac(g,f)) + under(i, minPrac(g,f)); threeToFour = 1 if g = 3 and f = 4; fourOnBlack = 1 if {g,f} = {3,4} and the note played by 3 is white and the note played by 4 is black; thumbPassing: if the thumb is in the pair and (f − g)·i < 0 (a crossing): let lower be the lower-pitched note and upper the other, with their fingers; 1 point if lower.black === upper.black (same level), 3 points if lower is white and played by a non-thumb finger and upper is black and played by the thumb, else 0.

Pair, every case (chord, repeated key, hop and melodic alike), added after the branch-specific terms: handPositionShift = |anchor(b, f) − anchor(a, g)| where `anchor(n, f) = x14(n.pitch) / 2 − (f − 1)` is the implied five-finger-position anchor in white-key units (literature 6.6 item 1; x14 is symmetric under the mirror, so it is valid for both hands); halve the points when b.restBefore. It makes 1-3-5 cheaper than 1-2-4 on a C major triad (0 versus 1) and leaves a scale's standard fingering unchanged.

Triple (only when a, b, c are in three different slices; `i13 = c.pitch - a.pitch`):

- positionChangeCount and positionChangeSize: if c.pitch = a.pitch: count 1 when h ≠ f, size 0. Else if i13 > maxComf(h,f) or i13 < minComf(h,f): count 2 when g = 1 and b.pitch lies strictly between a.pitch and c.pitch and i13 lies outside [minPrac(h,f), maxPrac(h,f)], otherwise count 1; size = over(i13, maxComf(h,f)) + under(i13, minComf(h,f)). (The diagonal spans are 0, so h = f with i13 ≠ 0 is a position change.)
- threeFourFive: 1 if {h,g,f} = {3,4,5}.
- sameFingerPivot: 1 if h = f, a.pitch ≠ c.pitch and b.pitch strictly between them.
- Only emit terms with non-zero points.

`params/weights-parncutt.json`:

```json
{
  "provenance": "Parncutt et al. 1997 rule weights (rules 1-12), Balliauw et al. 2017 chord rules (2x span terms, 10 beyond practical), hop and repeated-note terms from literature.md 6.4. Jacobs variant: weakFifth 0, threeFourFive 0. Written 2026-10-13, not fitted to data.",
  "weights": {
    "weakFinger": 1,
    "weakFifth": 1,
    "thumbOnBlack": 1,
    "fiveOnBlack": 1,
    "stretch": 2,
    "smallSpan": 1,
    "largeSpan": 1,
    "beyondPractical": 10,
    "threeToFour": 1,
    "fourOnBlack": 1,
    "thumbPassing": 1,
    "hop": 3,
    "repeatedNoteSameFinger": 1,
    "repeatedNoteFingerChange": 1,
    "chordStretch": 2,
    "chordSmallSpan": 2,
    "chordLargeSpan": 2,
    "chordBeyondPractical": 10,
    "handPositionShift": 1,
    "positionChangeCount": 1,
    "positionChangeSize": 1,
    "threeFourFive": 1,
    "sameFingerPivot": 1,
    "template": 0
  }
}
```

Two deliberate deviations from the literature defaults, both to be re-tuned by data in M3: `hop` is 3 (so a slow same-finger hop costs 1.5 points and a fast one 6) because at 1 the solver prefers hopping finger 5 up a slow scale to passing the thumb; `handPositionShift` is new (weight 1).

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/fingering/rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Finger } from '../score/types.js';
import { isBlack } from './geometry.js';
import {
  PARNCUTT_WEIGHTS,
  makeContext,
  pairTerms,
  tripleTerms,
  unaryTerms,
  weightedSum,
} from './rules.js';
import type { NoteView, Term } from './rules.js';
import { HAND_PROFILES } from './spans.js';

const ctx = makeContext(HAND_PROFILES.large);
const note = (pitch: number, slice: number, extra: Partial<NoteView> = {}): NoteView => ({
  pitch,
  black: isBlack(pitch),
  onsetSec: slice * 0.5,
  offsetSec: slice * 0.5 + 0.5,
  slice,
  restBefore: false,
  ioi: 0.5,
  ...extra,
});
const pts = (terms: Term[], rule: string) =>
  terms.filter((t) => t.rule === rule).reduce((s, t) => s + t.points, 0);
const parncuttOnly = (terms: Term[]) => terms.filter((t) => t.rule !== 'handPositionShift');

describe('pair terms', () => {
  it('reproduces Parncutt Table 2: falling fifth with 1-2 costs 10 (stretch 4 + small span 6)', () => {
    const t = pairTerms(ctx, note(65, 0), 1, note(60, 1), 2);
    expect(pts(t, 'stretch')).toBe(2);
    expect(pts(t, 'smallSpan')).toBe(6);
    expect(weightedSum(ctx, parncuttOnly(t))).toBe(10);
    expect(pts(t, 'handPositionShift')).toBe(4);
  });
  it('uses theta = 2 for non-thumb pairs', () => {
    const t = pairTerms(ctx, note(60, 0), 2, note(67, 1), 5); // 7 semitones with 2-5: maxRel 6 -> over 1, theta 2
    expect(pts(t, 'largeSpan')).toBe(2);
    expect(weightedSum(ctx, parncuttOnly(t))).toBe(2);
  });
  it('charges the thumb-passing rule for crossings only', () => {
    expect(pts(pairTerms(ctx, note(64, 0), 3, note(65, 1), 1), 'thumbPassing')).toBe(1); // 3 to thumb ascending, white to white
    expect(pts(pairTerms(ctx, note(64, 0), 3, note(66, 1), 1), 'thumbPassing')).toBe(3); // white non-thumb below, black thumb above
    expect(pts(pairTerms(ctx, note(60, 0), 1, note(62, 1), 2), 'thumbPassing')).toBe(0); // no crossing
  });
  it('treats same finger on a different key as a hop, with no span terms', () => {
    const noShift = (t: Term[]) => t.filter((x) => x.rule !== 'handPositionShift');
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(62, 1, { ioi: 0.1 }), 2))).toEqual([
      { rule: 'hop', points: 2 },
    ]);
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(62, 1, { ioi: 0.5 }), 2))).toEqual([
      { rule: 'hop', points: 0.5 },
    ]);
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(62, 1, { restBefore: true }), 2))).toEqual(
      [],
    );
  });
  it('handles repeated keys', () => {
    const noShift = (t: Term[]) => t.filter((x) => x.rule !== 'handPositionShift');
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(60, 1, { ioi: 0.1 }), 2))).toEqual([
      { rule: 'repeatedNoteSameFinger', points: 2 },
    ]);
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(60, 1, { ioi: 0.5 }), 2))).toEqual([]);
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(60, 1, { ioi: 0.5 }), 3))).toEqual([
      { rule: 'repeatedNoteFingerChange', points: 1 },
    ]);
    expect(noShift(pairTerms(ctx, note(60, 0), 2, note(60, 1, { ioi: 0.1 }), 3))).toEqual([]);
    expect(
      pts(pairTerms(ctx, note(60, 0), 2, note(60, 1, { ioi: 0.5 }), 3), 'handPositionShift'),
    ).toBe(1);
  });
  it('doubles span terms inside a chord', () => {
    const t = pairTerms(ctx, note(60, 0), 1, note(72, 0), 5); // octave with 1-5: maxRel 10 -> large 2 (theta 1), maxComf 13 -> 0
    expect(t.filter((x) => x.rule !== 'handPositionShift')).toEqual([
      { rule: 'chordLargeSpan', points: 2 },
    ]);
    expect(pts(t, 'handPositionShift')).toBe(3); // 1 on C4 anchors at 35, 5 on C5 at 42 - 4 = 38
    expect(weightedSum(ctx, t)).toBe(7);
  });
  it('charges hand-position shifts so that 1-3-5 beats 1-2-4 on a triad', () => {
    const c = note(60, 0),
      e = note(64, 0),
      g = note(67, 0);
    const cost = (fs: Finger[]) =>
      weightedSum(ctx, pairTerms(ctx, c, fs[0]!, e, fs[1]!)) +
      weightedSum(ctx, pairTerms(ctx, e, fs[1]!, g, fs[2]!));
    expect(
      pts([...pairTerms(ctx, c, 1, e, 3), ...pairTerms(ctx, e, 3, g, 5)], 'handPositionShift'),
    ).toBe(0);
    expect(
      pts([...pairTerms(ctx, c, 1, e, 2), ...pairTerms(ctx, e, 2, g, 4)], 'handPositionShift'),
    ).toBe(1);
    expect(cost([1, 3, 5])).toBeLessThan(cost([1, 2, 4]));
    expect(pts(pairTerms(ctx, note(60, 0), 1, note(65, 1), 1), 'handPositionShift')).toBe(3); // thumb hop C to F shifts the hand 3 columns
    expect(
      pts(
        pairTerms(ctx, note(60, 0), 1, note(65, 1, { restBefore: true }), 1),
        'handPositionShift',
      ),
    ).toBe(1.5);
  });
  it('charges three-to-four and four-on-black', () => {
    expect(pts(pairTerms(ctx, note(60, 0), 3, note(62, 1), 4), 'threeToFour')).toBe(1);
    expect(pts(pairTerms(ctx, note(60, 0), 3, note(61, 1), 4), 'fourOnBlack')).toBe(1);
    expect(pts(pairTerms(ctx, note(61, 0), 4, note(60, 1), 3), 'fourOnBlack')).toBe(1);
    expect(pts(pairTerms(ctx, note(61, 0), 3, note(62, 1), 4), 'fourOnBlack')).toBe(0);
  });
});

describe('unary terms', () => {
  it('weak fingers, thumb on black, five on black', () => {
    expect(unaryTerms(ctx, note(60, 1), 4, note(59, 0), note(62, 2))).toEqual([
      { rule: 'weakFinger', points: 1 },
    ]);
    expect(unaryTerms(ctx, note(60, 1), 5, undefined, undefined)).toEqual([
      { rule: 'weakFifth', points: 1 },
    ]);
    expect(unaryTerms(ctx, note(61, 1), 1, note(60, 0), note(62, 2))).toEqual([
      { rule: 'thumbOnBlack', points: 5 },
    ]);
    expect(unaryTerms(ctx, note(61, 1), 1, note(63, 0), undefined)).toEqual([
      { rule: 'thumbOnBlack', points: 1 },
    ]);
    expect(unaryTerms(ctx, note(61, 1), 5, note(60, 0), note(63, 2))).toEqual([
      { rule: 'weakFifth', points: 1 },
      { rule: 'fiveOnBlack', points: 2 },
    ]);
  });
});

describe('triple terms', () => {
  it('reproduces the Parncutt worked example A4 C4 A4 E5 fingered 4 1 2 5 with total 15', () => {
    const n = [note(69, 0), note(60, 1), note(69, 2), note(76, 3)];
    const f: Finger[] = [4, 1, 2, 5];
    let total = 0;
    for (let k = 0; k < 4; k++)
      total += weightedSum(ctx, unaryTerms(ctx, n[k]!, f[k]!, n[k - 1], n[k + 1]));
    for (let k = 1; k < 4; k++)
      total += weightedSum(ctx, parncuttOnly(pairTerms(ctx, n[k - 1]!, f[k - 1]!, n[k]!, f[k]!)));
    const t1 = tripleTerms(ctx, n[0]!, 4, n[1]!, 1, n[2]!, 2);
    const t2 = tripleTerms(ctx, n[1]!, 1, n[2]!, 2, n[3]!, 5);
    expect(pts(t1, 'positionChangeCount')).toBe(1);
    expect(pts(t1, 'positionChangeSize')).toBe(0);
    expect(pts(t2, 'positionChangeCount')).toBe(1);
    expect(pts(t2, 'positionChangeSize')).toBe(3);
    total += weightedSum(ctx, t1) + weightedSum(ctx, t2);
    expect(total).toBe(15);
  });
  it('counts a full change of 2 when the thumb is in the middle and the span is impractical', () => {
    const t = tripleTerms(ctx, note(60, 0), 2, note(64, 1), 1, note(79, 2), 5); // 19 semitones 2->5, thumb between
    expect(pts(t, 'positionChangeCount')).toBe(2);
  });
  it('charges three-four-five and the same-finger pivot', () => {
    expect(
      pts(tripleTerms(ctx, note(60, 0), 3, note(62, 1), 4, note(64, 2), 5), 'threeFourFive'),
    ).toBe(1);
    expect(
      pts(tripleTerms(ctx, note(60, 0), 2, note(64, 1), 3, note(67, 2), 2), 'sameFingerPivot'),
    ).toBe(1);
  });
  it('emits nothing when the three notes are not in three different slices', () => {
    expect(tripleTerms(ctx, note(60, 0), 1, note(64, 0), 3, note(67, 1), 5)).toEqual([]);
  });
});

describe('weights', () => {
  it('loads the Parncutt defaults and lets a rule be switched off', () => {
    expect(PARNCUTT_WEIGHTS.stretch).toBe(2);
    const off = makeContext(HAND_PROFILES.large, { smallSpan: 0, handPositionShift: 0 });
    expect(weightedSum(off, pairTerms(off, note(65, 0), 1, note(60, 1), 2))).toBe(4);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine exec vitest run src/fingering/rules`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/engine/src/fingering/rules.ts`:

```ts
import type { Finger } from '../score/types.js';
import { x14 } from './geometry.js';
import weightsJson from './params/weights-parncutt.json' with { type: 'json' };
import { span } from './spans.js';
import type { HandProfile, SpanTables } from './spans.js';

export interface NoteView {
  pitch: number;
  black: boolean;
  onsetSec: number;
  offsetSec: number;
  slice: number;
  restBefore: boolean;
  ioi: number;
}

export type RuleId =
  | 'weakFinger'
  | 'weakFifth'
  | 'thumbOnBlack'
  | 'fiveOnBlack'
  | 'stretch'
  | 'smallSpan'
  | 'largeSpan'
  | 'beyondPractical'
  | 'threeToFour'
  | 'fourOnBlack'
  | 'thumbPassing'
  | 'hop'
  | 'repeatedNoteSameFinger'
  | 'repeatedNoteFingerChange'
  | 'chordStretch'
  | 'chordSmallSpan'
  | 'chordLargeSpan'
  | 'chordBeyondPractical'
  | 'positionChangeCount'
  | 'positionChangeSize'
  | 'threeFourFive'
  | 'sameFingerPivot'
  | 'template';
export type RuleWeights = Record<RuleId, number>;
export interface Term {
  rule: RuleId;
  points: number;
}
export interface RuleContext {
  tables: SpanTables;
  weights: RuleWeights;
  hopFastSec: number;
  repeatFastSec: number;
}

export const PARNCUTT_WEIGHTS: RuleWeights = (weightsJson as { weights: RuleWeights }).weights;

export function makeContext(profile: HandProfile, weights: Partial<RuleWeights> = {}): RuleContext {
  return {
    tables: profile.tables,
    weights: { ...PARNCUTT_WEIGHTS, ...weights },
    hopFastSec: 0.25,
    repeatFastSec: 0.18,
  };
}

const over = (v: number, max: number): number => Math.max(0, v - max);
const under = (v: number, min: number): number => Math.max(0, min - v);
const white = (n: NoteView | undefined): boolean => n !== undefined && !n.black;

function push(terms: Term[], rule: RuleId, points: number): void {
  if (points !== 0) terms.push({ rule, points });
}

export function unaryTerms(
  ctx: RuleContext,
  n: NoteView,
  f: Finger,
  prev: NoteView | undefined,
  next: NoteView | undefined,
): Term[] {
  const terms: Term[] = [];
  if (f === 4) push(terms, 'weakFinger', 1);
  if (f === 5) push(terms, 'weakFifth', 1);
  if (f === 1 && n.black)
    push(terms, 'thumbOnBlack', 1 + (white(prev) ? 2 : 0) + (white(next) ? 2 : 0));
  if (f === 5 && n.black) push(terms, 'fiveOnBlack', (white(prev) ? 2 : 0) + (white(next) ? 2 : 0));
  return terms;
}

function spanPoints(
  ctx: RuleContext,
  i: number,
  g: Finger,
  f: Finger,
): { stretch: number; small: number; large: number; beyond: number } {
  const t = ctx.tables;
  const theta = g === 1 || f === 1 ? 1 : 2;
  return {
    stretch: over(i, span(t, 'maxComf', g, f)) + under(i, span(t, 'minComf', g, f)),
    small: theta * under(i, span(t, 'minRel', g, f)),
    large: theta * over(i, span(t, 'maxRel', g, f)),
    beyond: over(i, span(t, 'maxPrac', g, f)) + under(i, span(t, 'minPrac', g, f)),
  };
}

function anchor(n: NoteView, f: Finger): number {
  return x14(n.pitch) / 2 - (f - 1);
}

export function pairTerms(
  ctx: RuleContext,
  a: NoteView,
  g: Finger,
  b: NoteView,
  f: Finger,
): Term[] {
  const terms = pairTermsWithoutPosition(ctx, a, g, b, f);
  const shift = Math.abs(anchor(b, f) - anchor(a, g));
  push(terms, 'handPositionShift', b.restBefore ? shift / 2 : shift);
  return terms;
}

function pairTermsWithoutPosition(
  ctx: RuleContext,
  a: NoteView,
  g: Finger,
  b: NoteView,
  f: Finger,
): Term[] {
  const terms: Term[] = [];
  const i = b.pitch - a.pitch;
  if (a.slice === b.slice) {
    const s = spanPoints(ctx, i, g, f);
    push(terms, 'chordStretch', s.stretch);
    push(terms, 'chordSmallSpan', s.small);
    push(terms, 'chordLargeSpan', s.large);
    push(terms, 'chordBeyondPractical', s.beyond);
    return terms;
  }
  if (i === 0) {
    if (g === f && b.ioi < ctx.repeatFastSec) push(terms, 'repeatedNoteSameFinger', 2);
    if (g !== f && b.ioi >= ctx.repeatFastSec) push(terms, 'repeatedNoteFingerChange', 1);
    return terms;
  }
  if (g === f) {
    if (!b.restBefore) push(terms, 'hop', b.ioi < ctx.hopFastSec ? 2 : 0.5);
    return terms;
  }
  const s = spanPoints(ctx, i, g, f);
  push(terms, 'stretch', s.stretch);
  push(terms, 'smallSpan', s.small);
  push(terms, 'largeSpan', s.large);
  push(terms, 'beyondPractical', s.beyond);
  if (g === 3 && f === 4) push(terms, 'threeToFour', 1);
  if ((g === 3 && f === 4) || (g === 4 && f === 3)) {
    const noteOf3 = g === 3 ? a : b;
    const noteOf4 = g === 4 ? a : b;
    if (!noteOf3.black && noteOf4.black) push(terms, 'fourOnBlack', 1);
  }
  if ((g === 1 || f === 1) && (f - g) * i < 0) {
    const lower = i < 0 ? b : a;
    const upper = i < 0 ? a : b;
    const lowerFinger = i < 0 ? f : g;
    const upperFinger = i < 0 ? g : f;
    if (lower.black === upper.black) push(terms, 'thumbPassing', 1);
    else if (!lower.black && lowerFinger !== 1 && upper.black && upperFinger === 1)
      push(terms, 'thumbPassing', 3);
  }
  return terms;
}

export function tripleTerms(
  ctx: RuleContext,
  a: NoteView,
  h: Finger,
  b: NoteView,
  g: Finger,
  c: NoteView,
  f: Finger,
): Term[] {
  const terms: Term[] = [];
  if (a.slice === b.slice || b.slice === c.slice || a.slice === c.slice) return terms;
  const t = ctx.tables;
  const i13 = c.pitch - a.pitch;
  const between = b.pitch > Math.min(a.pitch, c.pitch) && b.pitch < Math.max(a.pitch, c.pitch);
  if (c.pitch === a.pitch) {
    if (h !== f) push(terms, 'positionChangeCount', 1);
  } else {
    const maxC = span(t, 'maxComf', h, f);
    const minC = span(t, 'minComf', h, f);
    if (i13 > maxC || i13 < minC) {
      const outsidePrac = i13 > span(t, 'maxPrac', h, f) || i13 < span(t, 'minPrac', h, f);
      push(terms, 'positionChangeCount', g === 1 && between && outsidePrac ? 2 : 1);
      push(terms, 'positionChangeSize', over(i13, maxC) + under(i13, minC));
    }
  }
  if (new Set([h, g, f]).size === 3 && h + g + f === 12 && Math.min(h, g, f) === 3)
    push(terms, 'threeFourFive', 1);
  if (h === f && a.pitch !== c.pitch && between) push(terms, 'sameFingerPivot', 1);
  return terms;
}

export function weightedSum(ctx: RuleContext, terms: Term[]): number {
  let s = 0;
  for (const t of terms) s += t.points * ctx.weights[t.rule];
  return s;
}
```

(`{h,g,f} = {3,4,5}` is tested as "three distinct fingers summing to 12 with minimum 3": the only such set is {3,4,5}.)

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @digitus2/engine exec vitest run src/fingering && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: all pass, including the 15-point worked example.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/fingering/rules.ts packages/engine/src/fingering/rules.test.ts packages/engine/src/fingering/params/weights-parncutt.json
git commit -m "feat(engine): Parncutt, Jacobs and Balliauw rule terms with golden tests"
```

---

### Task 3: Hand sequences: slices in arpeggiated order with mirrored pitch, timing and rests

**Files:**

- Create: `packages/engine/src/fingering/sequence.ts`, `packages/engine/src/fingering/sequence.test.ts`

**Interfaces:**

- Consumes: `handEvents`, `Score`, `Note`, `Hand` (M1); `mirrorPitch`, `isBlack` (Task 1); `NoteView` (Task 2).
- Produces:

```ts
export interface SeqNote extends NoteView {
  index: number;
  noteId: string;
  midi: number;
  isGrace: boolean;
}
export interface HandSequence {
  hand: Hand;
  notes: SeqNote[];
  sliceCount: number;
}
export const GRACE_IOI_SEC = 0.05;
export function buildHandSequence(score: Score, hand: Hand): HandSequence;
```

Rules (literature 6.3): notes of one hand with the same onset tick form a slice; inside a slice notes are ordered by ascending mirrored pitch (`pitch = mirrorPitch(midi)` for the left hand, `midi` for the right), so "fingers increase with pitch" holds for both hands in the same code. Grace notes that share an onset tick with their principal get their own slice placed before the principal's slice; the principal's `ioi` is then `GRACE_IOI_SEC`. `ioi` is the time in seconds since the previous slice's onset (0 for the first slice and inside a slice); `restBefore` is true when no note of this hand was still sounding when the slice starts (previous maximum offset is more than 1 ms before this onset) and it is not the first slice. `black` comes from the real midi.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/fingering/sequence.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../io/musicxml/read.js';
import { parsePig } from '../io/pig/read.js';
import { buildHandSequence, GRACE_IOI_SEC } from './sequence.js';

const H = '//Version: PianoFingering_v170101\n';
const pig = (rows: Array<[number, number, string, number]>) =>
  H +
  rows.map(([on, off, p, ch], i) => `${i}\t${on}\t${off}\t${p}\t80\t80\t${ch}\t0`).join('\n') +
  '\n';

describe('buildHandSequence', () => {
  it('orders right-hand chords by ascending pitch and left-hand chords by ascending mirrored pitch', () => {
    const { score } = parsePig(
      pig([
        [0, 1, 'C4', 0],
        [0, 1, 'G4', 0],
        [0, 1, 'E4', 0],
        [0, 1, 'C3', 1],
        [0, 1, 'G3', 1],
        [0, 1, 'E3', 1],
      ]),
    );
    const r = buildHandSequence(score, 'R');
    expect(r.notes.map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(r.notes.map((n) => n.pitch)).toEqual([60, 64, 67]);
    const l = buildHandSequence(score, 'L');
    expect(l.notes.map((n) => n.midi)).toEqual([55, 52, 48]);
    expect(l.notes.map((n) => n.pitch)).toEqual([69, 72, 76]);
    expect(l.notes.every((n) => n.slice === 0)).toBe(true);
    expect(l.sliceCount).toBe(1);
  });
  it('computes inter-onset intervals and rests', () => {
    const { score } = parsePig(
      pig([
        [0, 0.5, 'C4', 0],
        [0.5, 1, 'D4', 0],
        [1, 1.25, 'E4', 0],
        [2, 2.5, 'F4', 0],
        [2, 3, 'A4', 0],
      ]),
    );
    const s = buildHandSequence(score, 'R');
    expect(s.notes.map((n) => n.slice)).toEqual([0, 1, 2, 3, 3]);
    expect(s.notes.map((n) => n.ioi)).toEqual([0, 0.5, 0.5, 1, 1]);
    expect(s.notes.map((n) => n.restBefore)).toEqual([false, false, false, true, true]);
  });
  it('does not flag a rest when an earlier note is still sounding', () => {
    const { score } = parsePig(
      pig([
        [0, 3, 'C3', 0],
        [1, 1.5, 'E4', 0],
        [2.5, 3, 'G4', 0],
      ]),
    );
    const s = buildHandSequence(score, 'R');
    expect(s.notes.map((n) => n.restBefore)).toEqual([false, false, false]);
  });
  it('gives a grace note its own slice before the principal', () => {
    const xml = readFileSync(
      fileURLToPath(new URL('../../fixtures/two-staff.musicxml', import.meta.url)),
      'utf8',
    );
    const { score } = parseMusicXml(xml);
    const s = buildHandSequence(score, 'R');
    const grace = s.notes.find((n) => n.isGrace)!;
    const principal = s.notes[grace.index + 1]!;
    expect(grace.midi).toBe(66);
    expect(principal.midi).toBe(67);
    expect(principal.slice).toBe(grace.slice + 1);
    expect(principal.ioi).toBe(GRACE_IOI_SEC);
    expect(new Set(s.notes.map((n) => n.slice)).size).toBe(s.sliceCount);
  });
  it('mirrors black keys onto black keys', () => {
    const { score } = parsePig(
      pig([
        [0, 1, 'C#3', 1],
        [1, 2, 'D3', 1],
      ]),
    );
    const s = buildHandSequence(score, 'L');
    expect(s.notes.map((n) => n.black)).toEqual([true, false]);
    expect(s.notes.map((n) => n.pitch)).toEqual([75, 74]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine exec vitest run src/fingering/sequence`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/engine/src/fingering/sequence.ts`:

```ts
import { handEvents } from '../score/build.js';
import type { Hand, Note, Score } from '../score/types.js';
import { isBlack, mirrorPitch } from './geometry.js';
import type { NoteView } from './rules.js';

export interface SeqNote extends NoteView {
  index: number;
  noteId: string;
  midi: number;
  isGrace: boolean;
}

export interface HandSequence {
  hand: Hand;
  notes: SeqNote[];
  sliceCount: number;
}

export const GRACE_IOI_SEC = 0.05;
const EPS = 1e-3;

export function buildHandSequence(score: Score, hand: Hand): HandSequence {
  const view = (n: Note): number => (hand === 'L' ? mirrorPitch(n.midi) : n.midi);
  const notes: SeqNote[] = [];
  let slice = 0;
  let prevOnset: number | undefined;
  let prevWasGrace = false;
  let maxOffset = Number.NEGATIVE_INFINITY;
  for (const ev of handEvents(score, hand)) {
    const groups: Array<{ notes: Note[]; grace: boolean }> = [];
    const graces = ev.notes.filter((n) => n.isGrace);
    const mains = ev.notes.filter((n) => !n.isGrace);
    if (graces.length > 0) groups.push({ notes: graces, grace: true });
    if (mains.length > 0) groups.push({ notes: mains, grace: false });
    for (const group of groups) {
      const ordered = [...group.notes].sort(
        (a, b) => view(a) - view(b) || a.id.localeCompare(b.id),
      );
      const onset = ordered[0]!.onsetSec;
      let ioi = 0;
      if (prevOnset !== undefined)
        ioi = prevWasGrace ? GRACE_IOI_SEC : Math.max(0, onset - prevOnset);
      const restBefore = notes.length > 0 && maxOffset < onset - EPS;
      for (const n of ordered) {
        notes.push({
          index: notes.length,
          noteId: n.id,
          midi: n.midi,
          pitch: view(n),
          black: isBlack(n.midi),
          onsetSec: n.onsetSec,
          offsetSec: n.offsetSec,
          slice,
          restBefore,
          ioi,
          isGrace: n.isGrace,
        });
      }
      for (const n of ordered) maxOffset = Math.max(maxOffset, n.offsetSec);
      prevOnset = onset;
      prevWasGrace = group.grace;
      slice++;
    }
  }
  return { hand, notes, sliceCount: slice };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @digitus2/engine exec vitest run src/fingering && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: all pass. (The grace note in the fixture has `onsetSec === offsetSec`; after its slice `maxOffset` equals its onset, so the principal is not a rest.)

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/fingering/sequence.ts packages/engine/src/fingering/sequence.test.ts
git commit -m "feat(engine): hand sequences with slices, mirrored pitch, inter-onset intervals and rests"
```

---

### Task 4: Second-order Viterbi decoder with min-sum marginals

**Files:**

- Create: `packages/engine/src/fingering/viterbi.ts`, `packages/engine/src/fingering/viterbi.test.ts`

**Interfaces:**

- Produces:

```ts
export interface DecodeProblem {
  n: number; // number of notes
  unary(i: number, f: number): number; // f in 0..4 (finger - 1); +Infinity forbids
  pair(i: number, g: number, f: number): number; // i >= 1: cost of finger g on note i-1 followed by f on note i
  triple(i: number, h: number, g: number, f: number): number; // i >= 2: fingers on notes i-2, i-1, i
}
export interface DecodeResult {
  fingers: number[]; // 0..4 per note; empty when n = 0
  cost: number; // total cost of the returned path, +Infinity when no finite path exists
  marginals: number[][]; // marginals[i][f] = minimum total cost over complete paths with finger f on note i
}
export function decode(p: DecodeProblem): DecodeResult;
```

State at note i is (f_{i-1}, f_i), 25 states. Forward: `D[i][g][f] = unary(i,f) + pair(i,g,f) + min_h (D[i-1][h][g] + triple(i,h,g,f))` with `D[1][g][f] = unary(0,g) + unary(1,f) + pair(1,g,f)`. Backward: `B[n-1] = 0`, `B[i][g][f] = min_e (unary(i+1,e) + pair(i+1,f,e) + triple(i+1,g,f,e) + B[i+1][f][e])`. Marginal for i ≥ 1: `min_g D[i][g][f] + B[i][g][f]`; for i = 0: `min_f D[1][g][f] + B[1][g][f]` indexed by g. n = 1: everything is the unary. Ties are broken by the lowest finger index, deterministically. When the best cost is infinite, still return the back-traced path from the lowest-index final state (callers relax constraints and retry).

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/fingering/viterbi.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decode } from './viterbi.js';
import type { DecodeProblem } from './viterbi.js';

// Deterministic pseudo-random costs (LCG) so the brute-force comparison is reproducible.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomProblem(n: number, seed: number, infRate = 0): DecodeProblem {
  const rnd = lcg(seed);
  const u = Array.from({ length: n }, () =>
    Array.from({ length: 5 }, () => (rnd() < infRate ? Infinity : Math.round(rnd() * 10))),
  );
  const p = Array.from({ length: n }, () =>
    Array.from({ length: 25 }, () => Math.round(rnd() * 10)),
  );
  const t = Array.from({ length: n }, () =>
    Array.from({ length: 125 }, () => Math.round(rnd() * 10)),
  );
  return {
    n,
    unary: (i, f) => u[i]![f]!,
    pair: (i, g, f) => p[i]![g * 5 + f]!,
    triple: (i, h, g, f) => t[i]![h * 25 + g * 5 + f]!,
  };
}

function bruteForce(p: DecodeProblem): { cost: number; fingers: number[]; marginals: number[][] } {
  const n = p.n;
  const marginals = Array.from({ length: n }, () => Array.from({ length: 5 }, () => Infinity));
  let best = Infinity;
  let bestPath: number[] = [];
  const path: number[] = [];
  const walk = (i: number, acc: number): void => {
    if (i === n) {
      for (let k = 0; k < n; k++) marginals[k]![path[k]!] = Math.min(marginals[k]![path[k]!]!, acc);
      if (acc < best) {
        best = acc;
        bestPath = [...path];
      }
      return;
    }
    for (let f = 0; f < 5; f++) {
      let c = p.unary(i, f);
      if (i >= 1) c += p.pair(i, path[i - 1]!, f);
      if (i >= 2) c += p.triple(i, path[i - 2]!, path[i - 1]!, f);
      path.push(f);
      walk(i + 1, acc + c);
      path.pop();
    }
  };
  walk(0, 0);
  return { cost: best, fingers: bestPath, marginals };
}

describe('decode', () => {
  it('matches brute force on random problems, including marginals', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const p = randomProblem(6, seed);
      const d = decode(p);
      const b = bruteForce(p);
      expect(d.cost).toBe(b.cost);
      expect(d.fingers).toEqual(b.fingers);
      expect(d.marginals).toEqual(b.marginals);
    }
  });
  it('respects infinite unary costs and reports an infinite cost when nothing is feasible', () => {
    const p = randomProblem(5, 7, 0.3);
    const d = decode(p);
    const b = bruteForce(p);
    expect(d.cost).toBe(b.cost);
    if (Number.isFinite(b.cost)) expect(d.fingers).toEqual(b.fingers);
    const none: DecodeProblem = {
      n: 3,
      unary: (i, f) => (i === 1 ? Infinity : f),
      pair: () => 0,
      triple: () => 0,
    };
    const r = decode(none);
    expect(r.cost).toBe(Infinity);
    expect(r.fingers).toHaveLength(3);
  });
  it('handles n = 0, 1 and 2', () => {
    expect(decode({ n: 0, unary: () => 0, pair: () => 0, triple: () => 0 })).toEqual({
      fingers: [],
      cost: 0,
      marginals: [],
    });
    const one = decode({
      n: 1,
      unary: (_i, f) => [3, 1, 2, 5, 4][f]!,
      pair: () => 0,
      triple: () => 0,
    });
    expect(one.fingers).toEqual([1]);
    expect(one.cost).toBe(1);
    expect(one.marginals).toEqual([[3, 1, 2, 5, 4]]);
    const two = decode({
      n: 2,
      unary: () => 0,
      pair: (_i, g, f) => (g === 2 && f === 4 ? 0 : 1),
      triple: () => 0,
    });
    expect(two.fingers).toEqual([2, 4]);
    expect(two.cost).toBe(0);
  });
  it('breaks ties by the lowest finger index', () => {
    const r = decode({ n: 3, unary: () => 0, pair: () => 0, triple: () => 0 });
    expect(r.fingers).toEqual([0, 0, 0]);
  });
  it('is fast: 2000 notes in well under 500 ms', () => {
    const p = randomProblem(2000, 11);
    const t0 = performance.now();
    decode(p);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine exec vitest run src/fingering/viterbi`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/engine/src/fingering/viterbi.ts`:

```ts
export interface DecodeProblem {
  n: number;
  unary(i: number, f: number): number;
  pair(i: number, g: number, f: number): number;
  triple(i: number, h: number, g: number, f: number): number;
}

export interface DecodeResult {
  fingers: number[];
  cost: number;
  marginals: number[][];
}

const F = 5;
const S = F * F;
const INF = Number.POSITIVE_INFINITY;

export function decode(p: DecodeProblem): DecodeResult {
  const n = p.n;
  if (n === 0) return { fingers: [], cost: 0, marginals: [] };
  if (n === 1) {
    const u = Array.from({ length: F }, (_, f) => p.unary(0, f));
    let best = 0;
    for (let f = 1; f < F; f++) if (u[f]! < u[best]!) best = f;
    return { fingers: [best], cost: u[best]!, marginals: [u] };
  }

  // Forward pass. D[i] holds the cost of the best path ending in state (g, f) at note i, for i >= 1.
  const D: Float64Array[] = new Array(n);
  const back: Int8Array[] = new Array(n);
  const u0 = Array.from({ length: F }, (_, f) => p.unary(0, f));
  const d1 = new Float64Array(S);
  for (let g = 0; g < F; g++) {
    for (let f = 0; f < F; f++) d1[g * F + f] = u0[g]! + p.unary(1, f) + p.pair(1, g, f);
  }
  D[1] = d1;
  for (let i = 2; i < n; i++) {
    const prev = D[i - 1]!;
    const cur = new Float64Array(S).fill(INF);
    const bp = new Int8Array(S).fill(-1);
    for (let g = 0; g < F; g++) {
      for (let f = 0; f < F; f++) {
        const local = p.unary(i, f) + p.pair(i, g, f);
        if (local === INF) continue;
        let best = INF;
        let arg = -1;
        for (let h = 0; h < F; h++) {
          const base = prev[h * F + g]!;
          if (base === INF) continue;
          const v = base + p.triple(i, h, g, f);
          if (v < best) {
            best = v;
            arg = h;
          }
        }
        if (arg >= 0) {
          cur[g * F + f] = best + local;
          bp[g * F + f] = arg;
        }
      }
    }
    D[i] = cur;
    back[i] = bp;
  }

  // Backward pass. B[i] holds the cost of the best completion after state (g, f) at note i.
  const B: Float64Array[] = new Array(n);
  B[n - 1] = new Float64Array(S);
  for (let i = n - 2; i >= 1; i--) {
    const next = B[i + 1]!;
    const cur = new Float64Array(S).fill(INF);
    for (let g = 0; g < F; g++) {
      for (let f = 0; f < F; f++) {
        let best = INF;
        for (let e = 0; e < F; e++) {
          const rest = next[f * F + e]!;
          if (rest === INF) continue;
          const v = p.unary(i + 1, e) + p.pair(i + 1, f, e) + p.triple(i + 1, g, f, e) + rest;
          if (v < best) best = v;
        }
        cur[g * F + f] = best;
      }
    }
    B[i] = cur;
  }

  // Marginals.
  const marginals: number[][] = Array.from({ length: n }, () => new Array<number>(F).fill(INF));
  for (let i = 1; i < n; i++) {
    const d = D[i]!;
    const b = B[i]!;
    for (let g = 0; g < F; g++) {
      for (let f = 0; f < F; f++) {
        const v = d[g * F + f]! + b[g * F + f]!;
        if (v < marginals[i]![f]!) marginals[i]![f] = v;
        if (i === 1 && v < marginals[0]![g]!) marginals[0]![g] = v;
      }
    }
  }

  // Best final state and back-trace (lowest index wins ties).
  const last = D[n - 1]!;
  let bi = 0;
  for (let k = 1; k < S; k++) if (last[k]! < last[bi]!) bi = k;
  const fingers = new Array<number>(n).fill(0);
  fingers[n - 1] = bi % F;
  fingers[n - 2] = Math.floor(bi / F);
  for (let i = n - 1; i >= 2; i--) {
    const h = back[i]![fingers[i - 1]! * F + fingers[i]!]!;
    fingers[i - 2] = h < 0 ? 0 : h;
  }
  return { fingers, cost: last[bi]!, marginals };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @digitus2/engine exec vitest run src/fingering/viterbi && pnpm --filter @digitus2/engine exec tsc --noEmit`
Expected: all pass. If the brute-force marginals differ at i = 0, check that the i = 0 marginal is indexed by g (the finger of note 0 in state (g, f) at note 1).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/fingering/viterbi.ts packages/engine/src/fingering/viterbi.test.ts
git commit -m "feat(engine): second-order Viterbi decoder with min-sum marginals"
```

---

### Task 5: solveFingering: constraints, pins, held notes, confidence, alternatives, explanations

**Files:**

- Create: `packages/engine/src/fingering/solve.ts`, `packages/engine/src/fingering/solve.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: Tasks 1 to 4; `Assignment`, `FingerAssignment`, `Score`, `Hand`, `Finger` (M1).
- Produces:

```ts
export interface SolveOptions {
  profile?: HandProfileId | HandProfile; // default 'large'
  weights?: Partial<RuleWeights>;
  pins?: Assignment; // entries with pinned === true are hard constraints
  respectEditorial?: boolean; // also pin entries with source 'editorial' (default false)
  hands?: Hand[]; // default ['R', 'L']
  maxHeldIterations?: number; // default 5
  confidenceTemperature?: number; // default 2 (cost points per e-fold)
}
export interface ExplainedTerm extends Term {
  weighted: number;
}
export interface NoteExplanation {
  terms: ExplainedTerm[];
  total: number;
}
export interface HandSolution {
  hand: Hand;
  cost: number;
  iterations: number;
  relaxed: boolean;
  notes: number;
}
export interface SolveResult {
  assignment: Assignment;
  explanations: Record<string, NoteExplanation>;
  hands: HandSolution[];
}
export interface HandConstraints {
  pinned: Map<number, Finger>;
  forbidden: Map<number, Set<Finger>>;
  soft: boolean;
}
export function solveHand(
  seq: HandSequence,
  ctx: RuleContext,
  constraints?: HandConstraints,
): { fingers: Finger[]; cost: number; marginals: number[][] };
export function solveFingering(score: Score, opts?: SolveOptions): SolveResult;
```

Problem construction for a hand (fingers are 0-based inside the decoder, 1-based everywhere else):

- `unary(i, f)` = weighted unary terms (neighbours i-1 and i+1 in the sequence) + pin penalty (if note i is pinned to another finger: +Infinity, or 1000 when `soft`) + forbid penalty (same values).
- `pair(i, g, f)`: same slice → `f < g` is +Infinity; `f === g` is +Infinity unless the slice has more than 5 notes (then 0, and lint will flag it); otherwise weighted chord terms. Different slices → if note i-1 is still sounding at note i's onset (offset > onset + 1 ms) and `g === f`: +Infinity (or 1000 when soft); otherwise weighted melodic terms.
- `triple(i, h, g, f)`: if note i-2 is still sounding at note i's onset, is in a different slice than note i, and `h === f`: +Infinity (or 1000 when soft); otherwise weighted triple terms.
- After decoding, scan for held-note conflicts farther than two steps back: for every pair m < i in different slices with `offset_m > onset_i + 1 ms` and equal fingers, add `f_m` to `forbidden[i]` and decode again; stop when there is no conflict or after `maxHeldIterations`.
- If the final cost is infinite, decode once more with `soft = true` and mark the hand `relaxed`.
- Per note: `finger`; `confidence = exp(-(m_f - m_min)/T) / Σ_f' exp(-(m_f' - m_min)/T)` over finite marginals; `alternatives` = up to two other fingers with finite marginals, ascending by `cost = m_f' - m_min`; `source: 'engine'`, except pinned notes which keep the pin's `source` and `pinned: true`.
- Explanations: for note i, the weighted unary terms at i, the pair terms (i-1 → i) and the triple terms (i-2, i-1, i) on the solved path.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/fingering/solve.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsePig } from '../io/pig/read.js';
import { lintFingering } from '../lint/index.js'; // Task 6; until then, comment this import and the L03 assertion out, and restore them in Task 6
import { solveFingering } from './solve.js';

const H = '//Version: PianoFingering_v170101\n';
const line = (i: number, on: number, off: number, p: string, ch: number) =>
  `${i}\t${on}\t${off}\t${p}\t80\t80\t${ch}\t0`;
const melody = (pitches: string[], ch: number, dur = 0.5) =>
  H + pitches.map((p, i) => line(i, i * dur, (i + 1) * dur, p, ch)).join('\n') + '\n';
const fingersOf = (text: string, hand: 'R' | 'L', opts = {}) => {
  const { score } = parsePig(text);
  const { assignment } = solveFingering(score, { hands: [hand], ...opts });
  return score.notes.map((n) => assignment[n.id]!.finger);
};

describe('solveFingering on textbook cases', () => {
  it('fingers the right-hand C major scale 1 2 3 1 2 3 4 5', () => {
    expect(fingersOf(melody(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'], 0), 'R')).toEqual([
      1, 2, 3, 1, 2, 3, 4, 5,
    ]);
  });
  it('fingers the left-hand C major scale ascending 5 4 3 2 1 3 2 1 (mirror of the right hand)', () => {
    expect(fingersOf(melody(['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4'], 1), 'L')).toEqual([
      5, 4, 3, 2, 1, 3, 2, 1,
    ]);
  });
  it('fingers a right-hand C major triad 1 3 5 and a left-hand triad 5 3 1', () => {
    const r = parsePig(
      H +
        [line(0, 0, 1, 'C4', 0), line(1, 0, 1, 'E4', 0), line(2, 0, 1, 'G4', 0)].join('\n') +
        '\n',
    );
    const ra = solveFingering(r.score, { hands: ['R'] }).assignment;
    expect(r.score.notes.map((n) => ra[n.id]!.finger)).toEqual([1, 3, 5]);
    const l = parsePig(
      H +
        [line(0, 0, 1, 'C3', 1), line(1, 0, 1, 'E3', 1), line(2, 0, 1, 'G3', 1)].join('\n') +
        '\n',
    );
    const la = solveFingering(l.score, { hands: ['L'] }).assignment;
    expect(l.score.notes.map((n) => la[n.id]!.finger)).toEqual([5, 3, 1]);
  });
  it('reproduces the Parncutt worked example under Parncutt-only weights: 4 1 2 5 with cost 15', () => {
    // Parncutt forbids the same finger on consecutive notes; a hop weight of 100 approximates that.
    const text = melody(['A4', 'C4', 'A4', 'E5'], 0);
    const { score } = parsePig(text);
    const parncutt = solveFingering(score, {
      hands: ['R'],
      weights: { handPositionShift: 0, hop: 100 },
    });
    expect(score.notes.map((n) => parncutt.assignment[n.id]!.finger)).toEqual([4, 1, 2, 5]);
    expect(parncutt.hands[0]!.cost).toBe(15);
    // Under the default weights a slow thumb hop (C4 to A4) is allowed and may win; only sanity is asserted.
    const f = fingersOf(text, 'R');
    expect(f).toHaveLength(4);
    expect(f.every((x) => x >= 1 && x <= 5)).toBe(true);
    expect(f[1]).toBe(1);
  });
});

describe('constraints', () => {
  it('held note keeps its finger reserved beyond two steps', () => {
    // C4 held for 4 s under G4 A4 B4 C5 D5 E5: the thumb must stay on C4.
    const rows = [line(0, 0, 4, 'C4', 0)];
    ['G4', 'A4', 'B4', 'C5', 'D5', 'E5'].forEach((p, k) =>
      rows.push(line(k + 1, 0.5 * (k + 1), 0.5 * (k + 2), p, 0)),
    );
    const { score } = parsePig(H + rows.join('\n') + '\n');
    const { assignment, hands } = solveFingering(score, { hands: ['R'] });
    const held = assignment[score.notes[0]!.id]!.finger;
    for (const n of score.notes.slice(1)) expect(assignment[n.id]!.finger).not.toBe(held);
    expect(hands[0]!.relaxed).toBe(false);
    expect(lintFingering(score, assignment).counts.L03 ?? 0).toBe(0);
  });
  it('honors pins and completes around them', () => {
    const text = melody(['C4', 'D4', 'E4', 'F4', 'G4'], 0);
    const { score } = parsePig(text);
    const pins = {
      [score.notes[0]!.id]: { finger: 2 as const, source: 'user' as const, pinned: true },
    };
    const { assignment, hands } = solveFingering(score, { hands: ['R'], pins });
    expect(assignment[score.notes[0]!.id]).toMatchObject({
      finger: 2,
      pinned: true,
      source: 'user',
    });
    const rest = score.notes.slice(1).map((n) => assignment[n.id]!.finger);
    expect(rest.every((f) => f >= 1 && f <= 5)).toBe(true);
    expect(hands[0]!.relaxed).toBe(false);
    // The completion is the solver's own optimum given the pin: re-solving with the result pinned changes nothing.
    const all: Record<string, { finger: 1 | 2 | 3 | 4 | 5; source: 'user'; pinned: true }> = {};
    for (const n of score.notes)
      all[n.id] = { finger: assignment[n.id]!.finger, source: 'user', pinned: true };
    const again = solveFingering(score, { hands: ['R'], pins: all });
    expect(score.notes.map((n) => again.assignment[n.id]!.finger)).toEqual(
      score.notes.map((n) => assignment[n.id]!.finger),
    );
  });
  it('pins never produce an infinite cost; the solver relaxes instead', () => {
    const r = parsePig(
      H +
        [line(0, 0, 1, 'C4', 0), line(1, 0, 1, 'E4', 0), line(2, 0, 1, 'G4', 0)].join('\n') +
        '\n',
    );
    const top = r.score.notes[2]!.id;
    const { assignment, hands } = solveFingering(r.score, {
      hands: ['R'],
      pins: { [top]: { finger: 1, source: 'user', pinned: true } },
    });
    expect(Number.isFinite(hands[0]!.cost)).toBe(true);
    expect(hands[0]!.relaxed).toBe(true);
    expect(assignment[top]!.finger).toBe(1);
  });
  it('uses editorial fingerings only when asked', () => {
    const { score, assignment: editorial } = parsePig(
      melody(['C4', 'D4', 'E4'], 0).replace(/\t0\n/g, '\t4\n'),
    );
    expect(Object.keys(editorial)).toHaveLength(3);
    const free = solveFingering(score, { hands: ['R'], pins: editorial });
    expect(score.notes.map((n) => free.assignment[n.id]!.finger)).not.toEqual([4, 4, 4]);
    const pinned = solveFingering(score, { hands: ['R'], pins: editorial, respectEditorial: true });
    expect(score.notes.map((n) => pinned.assignment[n.id]!.finger)).toEqual([4, 4, 4]);
  });
});

describe('outputs', () => {
  it('solves both hands, gives confidences, alternatives and explanations', () => {
    const text =
      H +
      [
        line(0, 0, 0.5, 'C4', 0),
        line(1, 0.5, 1, 'D4', 0),
        line(2, 0, 1, 'C3', 1),
        line(3, 0, 1, 'G3', 1),
      ].join('\n') +
      '\n';
    const { score } = parsePig(text);
    const { assignment, explanations, hands } = solveFingering(score);
    expect(hands.map((h) => h.hand).sort()).toEqual(['L', 'R']);
    for (const n of score.notes) {
      const a = assignment[n.id]!;
      expect(a.confidence).toBeGreaterThan(0);
      expect(a.confidence).toBeLessThanOrEqual(1);
      expect(a.source).toBe('engine');
      expect(explanations[n.id]!.total).toBeGreaterThanOrEqual(0);
    }
    const d4 = assignment[score.notes.find((n) => n.midi === 62)!.id]!;
    expect(d4.alternatives!.length).toBeGreaterThan(0);
    expect(d4.alternatives![0]!.cost).toBeGreaterThanOrEqual(0);
    expect(d4.alternatives!.every((alt) => alt.finger !== d4.finger)).toBe(true);
  });
  it('is deterministic and fast on a 2000-note random walk', () => {
    let p = 60;
    const rows: string[] = [];
    let s = 12345;
    for (let i = 0; i < 2000; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      p = Math.max(48, Math.min(84, p + ((s % 7) - 3)));
      const name =
        ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][p % 12]! +
        (Math.floor(p / 12) - 1);
      rows.push(line(i, i * 0.25, (i + 1) * 0.25, name, 0));
    }
    const { score } = parsePig(H + rows.join('\n') + '\n');
    const t0 = performance.now();
    const a = solveFingering(score, { hands: ['R'] });
    const ms = performance.now() - t0;
    const b = solveFingering(score, { hands: ['R'] });
    expect(JSON.stringify(a.assignment)).toBe(JSON.stringify(b.assignment));
    expect(ms).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine exec vitest run src/fingering/solve`
Expected: FAIL, module not found. (Until Task 6 exists, comment out the `lintFingering` import and the `L03` assertion; Task 6 restores them.)

- [ ] **Step 3: Implement**

`packages/engine/src/fingering/solve.ts`:

```ts
import type { Assignment, Finger, FingerAssignment, Hand, Score } from '../score/types.js';
import { makeContext, pairTerms, tripleTerms, unaryTerms, weightedSum } from './rules.js';
import type { RuleContext, RuleWeights, Term } from './rules.js';
import { buildHandSequence } from './sequence.js';
import type { HandSequence, SeqNote } from './sequence.js';
import { resolveProfile } from './spans.js';
import type { HandProfile, HandProfileId } from './spans.js';
import { decode } from './viterbi.js';

export interface SolveOptions {
  profile?: HandProfileId | HandProfile;
  weights?: Partial<RuleWeights>;
  pins?: Assignment;
  respectEditorial?: boolean;
  hands?: Hand[];
  maxHeldIterations?: number;
  confidenceTemperature?: number;
}
export interface ExplainedTerm extends Term {
  weighted: number;
}
export interface NoteExplanation {
  terms: ExplainedTerm[];
  total: number;
}
export interface HandSolution {
  hand: Hand;
  cost: number;
  iterations: number;
  relaxed: boolean;
  notes: number;
}
export interface SolveResult {
  assignment: Assignment;
  explanations: Record<string, NoteExplanation>;
  hands: HandSolution[];
}
export interface HandConstraints {
  pinned: Map<number, Finger>;
  forbidden: Map<number, Set<Finger>>;
  soft: boolean;
}

const INF = Number.POSITIVE_INFINITY;
const SOFT_PENALTY = 1000;
const HELD_EPS = 1e-3;
const FINGERS: Finger[] = [1, 2, 3, 4, 5];

function sounding(a: SeqNote, b: SeqNote): boolean {
  return a.slice !== b.slice && a.offsetSec > b.onsetSec + HELD_EPS;
}

export function solveHand(
  seq: HandSequence,
  ctx: RuleContext,
  constraints: HandConstraints = { pinned: new Map(), forbidden: new Map(), soft: false },
) {
  const v = seq.notes;
  const penalty = constraints.soft ? SOFT_PENALTY : INF;
  const sliceSize = new Map<number, number>();
  for (const n of v) sliceSize.set(n.slice, (sliceSize.get(n.slice) ?? 0) + 1);
  const result = decode({
    n: v.length,
    unary: (i, f0) => {
      const f = (f0 + 1) as Finger;
      const pin = constraints.pinned.get(i);
      if (pin !== undefined && pin !== f) return penalty;
      if (constraints.forbidden.get(i)?.has(f)) return penalty;
      return weightedSum(ctx, unaryTerms(ctx, v[i]!, f, v[i - 1], v[i + 1]));
    },
    pair: (i, g0, f0) => {
      const g = (g0 + 1) as Finger;
      const f = (f0 + 1) as Finger;
      const a = v[i - 1]!;
      const b = v[i]!;
      if (a.slice === b.slice) {
        if (f < g) return INF;
        if (f === g) return (sliceSize.get(b.slice) ?? 0) > 5 ? 0 : INF;
      } else if (g === f && sounding(a, b)) {
        return penalty;
      }
      return weightedSum(ctx, pairTerms(ctx, a, g, b, f));
    },
    triple: (i, h0, g0, f0) => {
      const h = (h0 + 1) as Finger;
      const g = (g0 + 1) as Finger;
      const f = (f0 + 1) as Finger;
      const a = v[i - 2]!;
      if (h === f && sounding(a, v[i]!)) return penalty;
      return weightedSum(ctx, tripleTerms(ctx, a, h, v[i - 1]!, g, v[i]!, f));
    },
  });
  return {
    fingers: result.fingers.map((f) => (f + 1) as Finger),
    cost: result.cost,
    marginals: result.marginals,
  };
}

function heldConflicts(seq: HandSequence, fingers: Finger[]): Array<[number, Finger]> {
  const out: Array<[number, Finger]> = [];
  const v = seq.notes;
  for (let i = 0; i < v.length; i++) {
    for (let m = i - 3; m >= 0; m--) {
      if (v[m]!.offsetSec <= v[i]!.onsetSec + HELD_EPS) continue;
      if (fingers[m] === fingers[i] && v[m]!.slice !== v[i]!.slice) out.push([i, fingers[m]!]);
    }
  }
  return out;
}

export function solveFingering(score: Score, opts: SolveOptions = {}): SolveResult {
  const profile = resolveProfile(opts.profile);
  const ctx = makeContext(profile, opts.weights);
  const hands = opts.hands ?? ['R', 'L'];
  const T = opts.confidenceTemperature ?? 2;
  const maxIter = opts.maxHeldIterations ?? 5;
  const assignment: Assignment = {};
  const explanations: Record<string, NoteExplanation> = {};
  const solutions: HandSolution[] = [];

  for (const hand of hands) {
    const seq = buildHandSequence(score, hand);
    const v = seq.notes;
    const pinned = new Map<number, Finger>();
    for (const n of v) {
      const pin = opts.pins?.[n.noteId];
      if (pin && (pin.pinned || (opts.respectEditorial && pin.source === 'editorial')))
        pinned.set(n.index, pin.finger);
    }
    const constraints: HandConstraints = { pinned, forbidden: new Map(), soft: false };
    let solved = solveHand(seq, ctx, constraints);
    let iterations = 1;
    while (iterations < maxIter) {
      const conflicts = heldConflicts(seq, solved.fingers);
      if (conflicts.length === 0) break;
      for (const [i, f] of conflicts) {
        if (!constraints.forbidden.has(i)) constraints.forbidden.set(i, new Set());
        constraints.forbidden.get(i)!.add(f);
      }
      solved = solveHand(seq, ctx, constraints);
      iterations++;
    }
    let relaxed = false;
    if (!Number.isFinite(solved.cost)) {
      solved = solveHand(seq, ctx, { ...constraints, soft: true });
      relaxed = true;
    }
    const fingers = solved.fingers;
    for (let i = 0; i < v.length; i++) {
      const n = v[i]!;
      const m = solved.marginals[i]!;
      const best = Math.min(...m.filter(Number.isFinite));
      const weights = m.map((x) => (Number.isFinite(x) ? Math.exp(-(x - best) / T) : 0));
      const z = weights.reduce((a, b) => a + b, 0);
      const f = fingers[i]!;
      const alternatives = FINGERS.filter((k) => k !== f && Number.isFinite(m[k - 1]!))
        .map((k) => ({ finger: k, cost: m[k - 1]! - best }))
        .sort((a, b) => a.cost - b.cost)
        .slice(0, 2);
      const pin = opts.pins?.[n.noteId];
      const entry: FingerAssignment = {
        finger: f,
        confidence: z > 0 ? weights[f - 1]! / z : 0,
        alternatives,
        source: pinned.has(i) && pin ? pin.source : 'engine',
      };
      if (pinned.has(i)) entry.pinned = true;
      assignment[n.noteId] = entry;

      const terms: Term[] = [...unaryTerms(ctx, n, f, v[i - 1], v[i + 1])];
      if (i >= 1) terms.push(...pairTerms(ctx, v[i - 1]!, fingers[i - 1]!, n, f));
      if (i >= 2)
        terms.push(
          ...tripleTerms(ctx, v[i - 2]!, fingers[i - 2]!, v[i - 1]!, fingers[i - 1]!, n, f),
        );
      const explained = terms.map((t) => ({ ...t, weighted: t.points * ctx.weights[t.rule] }));
      explanations[n.noteId] = {
        terms: explained,
        total: explained.reduce((s, t) => s + t.weighted, 0),
      };
    }
    solutions.push({ hand, cost: solved.cost, iterations, relaxed, notes: v.length });
  }
  return { assignment, explanations, hands: solutions };
}
```

Add to `packages/engine/src/index.ts`:

```ts
export { solveFingering, solveHand } from './fingering/solve.js';
export type {
  SolveOptions,
  SolveResult,
  HandSolution,
  NoteExplanation,
  ExplainedTerm,
  HandConstraints,
} from './fingering/solve.js';
export { buildHandSequence } from './fingering/sequence.js';
export type { HandSequence, SeqNote } from './fingering/sequence.js';
export { HAND_PROFILES, PARNCUTT_TABLES, resolveProfile, span } from './fingering/spans.js';
export type { HandProfile, HandProfileId, SpanTables } from './fingering/spans.js';
export {
  PARNCUTT_WEIGHTS,
  makeContext,
  pairTerms,
  tripleTerms,
  unaryTerms,
  weightedSum,
} from './fingering/rules.js';
export type { RuleContext, RuleId, RuleWeights, Term, NoteView } from './fingering/rules.js';
export { decode } from './fingering/viterbi.js';
export type { DecodeProblem, DecodeResult } from './fingering/viterbi.js';
export { mirrorPitch, whiteColumn, x14 } from './fingering/geometry.js';
```

- [ ] **Step 4: Run the tests and reconcile any golden mismatch honestly**

Run: `pnpm --filter @digitus2/engine exec vitest run src/fingering && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: all pass. If a textbook case returns a different fingering, do not change the rules: compute the total cost of the expected path and of the returned path with `unaryTerms`/`pairTerms`/`tripleTerms` (write a tiny tsx script in your temp directory), and report both numbers with the per-rule breakdown in your report. Change the test only if the returned path is genuinely cheaper under the plan's rules and the plan's rule text matches the literature; otherwise fix the rule implementation.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/fingering/solve.ts packages/engine/src/fingering/solve.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): solveFingering with pins, held-note constraints, confidence, alternatives and explanations"
```

---

### Task 6: Fingering lint (L01 to L14)

**Files:**

- Create: `packages/engine/src/lint/rules.ts`, `packages/engine/src/lint/index.ts`, `packages/engine/src/lint/lint.test.ts`
- Modify: `packages/engine/src/index.ts`, `packages/engine/src/fingering/solve.test.ts` (restore the `lintFingering` import and the L03 assertion)

**Interfaces:**

- Consumes: `buildHandSequence` (Task 3), `span`, `resolveProfile` (Task 1), `Assignment`, `Score`, `Hand`, `Finger`.
- Produces:

```ts
export type LintRuleId =
  | 'L01'
  | 'L02'
  | 'L03'
  | 'L04'
  | 'L05'
  | 'L06'
  | 'L07'
  | 'L08'
  | 'L09'
  | 'L10'
  | 'L11'
  | 'L12'
  | 'L13'
  | 'L14';
export type LintSeverity = 'error' | 'warning' | 'info';
export interface LintIssue {
  rule: LintRuleId;
  severity: LintSeverity;
  hand: Hand;
  noteIds: string[];
  message: string;
}
export interface LintOptions {
  profile?: HandProfileId | HandProfile;
  hopFastSec?: number;
  repeatFastSec?: number;
  beginner?: boolean;
}
export interface LintReport {
  issues: LintIssue[];
  counts: Partial<Record<LintRuleId, number>>;
  errors: number;
  warnings: number;
  infos: number;
  notes: number;
}
export const LINT_RULES: Record<LintRuleId, { title: string; law: boolean }>; // law = true for L01..L05 (and L06, L10 when beginner)
export function lintFingering(score: Score, assignment: Assignment, opts?: LintOptions): LintReport;
```

Rules (literature 4.3; intervals are in the mirrored right-hand view; "consecutive" means consecutive notes of one hand's sequence in different slices; notes without a finger in the assignment are skipped and never produce issues):

- L01 error: two notes in the same slice share a finger. Exception: thumb on two adjacent white keys (interval 1 or 2 semitones, both white) is `info`.
- L02 error: within a slice, fingers are not strictly increasing with mirrored pitch (crossed chord fingers).
- L03 error: a finger plays a new key while it still holds an earlier key (earlier note in another slice with offset > this onset + 1 ms, same finger, different pitch) and the earlier note has no `substitution`.
- L04 error: more than 5 notes in one slice.
- L05 error: consecutive melodic interval with different fingers, or any pair inside a slice, outside [minPrac, maxPrac] of the finger pair.
- L06 warning (error when `beginner`): non-thumb crossing: consecutive, neither finger is 1, i ≠ 0 and (f − g)·i < 0.
- L07 warning: consecutive interval with different fingers outside [minComf, maxComf].
- L08 warning: thumb on a black key; message includes the Parncutt points 1 + 2·[prev white] + 2·[next white].
- L09 warning: finger 5 on a black key with a white neighbour.
- L10 warning (error when `beginner`): thumb passes onto a black key from a white key played by another finger (the crossing case where the lower note is white and not the thumb, the upper is black and played by the thumb).
- L11 warning: hop: same finger on consecutive different keys with ioi < hopFastSec (default 0.25) and no rest before.
- L12 warning: fast repeated key (ioi < repeatFastSec, default 0.18) on the same finger.
- L13 info: slow repeated key (ioi ≥ repeatFastSec) with a finger change.
- L14 warning: agility: 3 followed by 4; or 3, 4, 5 in any order on three consecutive notes; or 3 on white and 4 on black consecutive.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/lint/lint.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsePig } from '../io/pig/read.js';
import { lintFingering } from './index.js';

const H = '//Version: PianoFingering_v170101\n';
type Row = [number, number, string, number, number | string]; // onset, offset, pitch, channel, finger
const pig = (rows: Row[]) =>
  H +
  rows
    .map(([on, off, p, ch, f], i) => `${i}\t${on}\t${off}\t${p}\t80\t80\t${ch}\t${f}`)
    .join('\n') +
  '\n';
const lint = (rows: Row[], opts = {}) => {
  const { score, assignment } = parsePig(pig(rows));
  return lintFingering(score, assignment, opts);
};
const rules = (rows: Row[], opts = {}) =>
  lint(rows, opts)
    .issues.map((i) => i.rule)
    .sort();

describe('lint laws', () => {
  it('L01 same finger in a chord, with the adjacent-white-thumb exception', () => {
    expect(
      rules([
        [0, 1, 'C4', 0, 2],
        [0, 1, 'E4', 0, 2],
      ]),
    ).toContain('L01');
    const r = lint([
      [0, 1, 'C4', 0, 1],
      [0, 1, 'D4', 0, 1],
    ]);
    expect(r.issues.find((i) => i.rule === 'L01')!.severity).toBe('info');
  });
  it('L02 crossed chord fingers', () => {
    expect(
      rules([
        [0, 1, 'C4', 0, 3],
        [0, 1, 'E4', 0, 2],
      ]),
    ).toContain('L02');
    expect(
      rules([
        [0, 1, 'C3', 1, -3],
        [0, 1, 'E3', 1, -5],
      ]),
    ).toContain('L02'); // left hand: lower note needs the higher finger number
    expect(
      rules([
        [0, 1, 'C3', 1, -5],
        [0, 1, 'E3', 1, -3],
      ]),
    ).not.toContain('L02');
  });
  it('L03 finger reused while holding a key', () => {
    expect(
      rules([
        [0, 2, 'C4', 0, 1],
        [1, 1.5, 'G4', 0, 1],
      ]),
    ).toContain('L03');
    expect(
      rules([
        [0, 2, 'C4', 0, '1_2'],
        [1, 1.5, 'G4', 0, 1],
      ]),
    ).not.toContain('L03');
    expect(
      rules([
        [0, 1, 'C4', 0, 1],
        [1, 1.5, 'G4', 0, 1],
      ]),
    ).not.toContain('L03');
  });
  it('L04 more than five notes in one hand at once', () => {
    expect(
      rules([
        [0, 1, 'C4', 0, 1],
        [0, 1, 'D4', 0, 2],
        [0, 1, 'E4', 0, 3],
        [0, 1, 'F4', 0, 4],
        [0, 1, 'G4', 0, 5],
        [0, 1, 'A4', 0, 5],
      ]),
    ).toContain('L04');
  });
  it('L05 span beyond the practical maximum', () => {
    expect(
      rules([
        [0, 1, 'C4', 0, 1],
        [1, 2, 'E6', 0, 5],
      ]),
    ).toContain('L05'); // 16 semitones with 1-5, maxPrac 15
    expect(
      rules([
        [0, 1, 'C4', 0, 1],
        [1, 2, 'D5', 0, 5],
      ]),
    ).not.toContain('L05'); // 14 semitones with 1-5 is within practical
    expect(
      rules([
        [0, 1, 'C4', 0, 2],
        [0, 1, 'C5', 0, 3],
      ]),
    ).toContain('L05'); // octave with 2-3 inside a chord
  });
});

describe('lint preferences', () => {
  it('L06 non-thumb crossing is a warning, an error for beginners', () => {
    const rows: Row[] = [
      [0, 0.5, 'E4', 0, 3],
      [0.5, 1, 'D4', 0, 4],
    ];
    expect(lint(rows).issues.find((i) => i.rule === 'L06')!.severity).toBe('warning');
    expect(lint(rows, { beginner: true }).issues.find((i) => i.rule === 'L06')!.severity).toBe(
      'error',
    );
    expect(
      rules([
        [0, 0.5, 'E4', 0, 3],
        [0.5, 1, 'F4', 0, 1],
      ]),
    ).not.toContain('L06');
  });
  it('L07 uncomfortable span', () => {
    expect(
      rules([
        [0, 0.5, 'C4', 0, 1],
        [0.5, 1, 'A4', 0, 2],
      ]),
    ).toContain('L07'); // 9 semitones 1-2, maxComf 8
  });
  it('L08, L09, L10 black-key rules', () => {
    expect(
      rules([
        [0, 0.5, 'C4', 0, 2],
        [0.5, 1, 'C#4', 0, 1],
        [1, 1.5, 'D4', 0, 2],
      ]),
    ).toContain('L08');
    expect(
      rules([
        [0, 0.5, 'C4', 0, 4],
        [0.5, 1, 'D#4', 0, 5],
      ]),
    ).toContain('L09');
    expect(
      rules([
        [0, 0.5, 'E4', 0, 3],
        [0.5, 1, 'F#4', 0, 1],
      ]),
    ).toContain('L10');
    expect(
      rules([
        [0, 0.5, 'E4', 0, 3],
        [0.5, 1, 'F4', 0, 1],
      ]),
    ).not.toContain('L10');
  });
  it('L11, L12, L13 same-finger and repeated-key rules', () => {
    expect(
      rules([
        [0, 0.1, 'C4', 0, 2],
        [0.1, 0.2, 'D4', 0, 2],
      ]),
    ).toContain('L11');
    expect(
      rules([
        [0, 0.5, 'C4', 0, 2],
        [0.5, 1, 'D4', 0, 2],
      ]),
    ).not.toContain('L11');
    expect(
      rules([
        [0, 0.1, 'C4', 0, 2],
        [0.1, 0.2, 'C4', 0, 2],
      ]),
    ).toContain('L12');
    expect(
      rules([
        [0, 0.5, 'C4', 0, 2],
        [0.5, 1, 'C4', 0, 3],
      ]),
    ).toContain('L13');
  });
  it('L14 agility', () => {
    expect(
      rules([
        [0, 0.5, 'C4', 0, 3],
        [0.5, 1, 'D4', 0, 4],
      ]),
    ).toContain('L14');
    expect(
      rules([
        [0, 0.5, 'C4', 0, 4],
        [0.5, 1, 'D4', 0, 5],
        [1, 1.5, 'E4', 0, 3],
      ]),
    ).toContain('L14');
    expect(
      rules([
        [0, 0.5, 'C4', 0, 4],
        [0.5, 1, 'C#4', 0, 3],
      ]),
    ).not.toContain('L14');
    expect(
      rules([
        [0, 0.5, 'C4', 0, 3],
        [0.5, 1, 'C#4', 0, 4],
      ]),
    ).toContain('L14');
  });
});

describe('report', () => {
  it('counts by rule and severity and ignores unfingered notes', () => {
    const r = lint([
      [0, 1, 'C4', 0, 2],
      [0, 1, 'E4', 0, 2],
      [1, 2, 'G4', 0, 0],
    ]);
    expect(r.notes).toBe(3);
    expect(r.counts.L01).toBe(1);
    expect(r.errors).toBeGreaterThanOrEqual(1);
    expect(r.issues.every((i) => !i.noteIds.includes('2'))).toBe(true);
  });
  it('is clean on a textbook scale', () => {
    const scale: Row[] = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'].map((p, i) => [
      i * 0.5,
      i * 0.5 + 0.5,
      p,
      0,
      [1, 2, 3, 1, 2, 3, 4, 5][i]!,
    ]);
    const r = lint(scale);
    expect(r.errors).toBe(0);
    // Two agility warnings: 3 to 4 at A-B, and the 3-4-5 run on A-B-C. Both are preferences, not laws.
    expect(r.issues.filter((i) => i.severity === 'warning').map((i) => i.rule)).toEqual([
      'L14',
      'L14',
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine exec vitest run src/lint`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`packages/engine/src/lint/rules.ts`:

```ts
import type { Finger, Hand } from '../score/types.js';
import type { SeqNote } from '../fingering/sequence.js';
import { span } from '../fingering/spans.js';
import type { SpanTables } from '../fingering/spans.js';

export type LintRuleId =
  | 'L01'
  | 'L02'
  | 'L03'
  | 'L04'
  | 'L05'
  | 'L06'
  | 'L07'
  | 'L08'
  | 'L09'
  | 'L10'
  | 'L11'
  | 'L12'
  | 'L13'
  | 'L14';
export type LintSeverity = 'error' | 'warning' | 'info';
export interface LintIssue {
  rule: LintRuleId;
  severity: LintSeverity;
  hand: Hand;
  noteIds: string[];
  message: string;
}

export const LINT_RULES: Record<LintRuleId, { title: string; law: boolean }> = {
  L01: { title: 'Two simultaneous notes share a finger', law: true },
  L02: { title: 'Crossed fingers inside a chord', law: true },
  L03: { title: 'Finger reused while it holds a key', law: true },
  L04: { title: 'More than five simultaneous notes in one hand', law: true },
  L05: { title: 'Span beyond the practical maximum', law: true },
  L06: { title: 'Non-thumb crossing', law: false },
  L07: { title: 'Uncomfortable span', law: false },
  L08: { title: 'Thumb on a black key', law: false },
  L09: { title: 'Fifth finger on a black key next to a white key', law: false },
  L10: { title: 'Thumb passes onto a black key from a white key', law: false },
  L11: { title: 'Fast hop with the same finger', law: false },
  L12: { title: 'Fast repeated key with the same finger', law: false },
  L13: { title: 'Slow repeated key with a finger change', law: false },
  L14: { title: 'Agility: 3 to 4, 3-4-5 run, or 3 white with 4 black', law: false },
};

export interface LintContext {
  tables: SpanTables;
  hopFastSec: number;
  repeatFastSec: number;
  beginner: boolean;
}
interface Fingered {
  note: SeqNote;
  finger: Finger;
  substitution: Finger | undefined;
}

const EPS = 1e-3;

export function lintHand(hand: Hand, notes: Fingered[], ctx: LintContext): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (rule: LintRuleId, severity: LintSeverity, ids: string[], message: string): void => {
    issues.push({ rule, severity, hand, noteIds: ids, message });
  };
  const sev = (rule: 'L06' | 'L10'): LintSeverity => (ctx.beginner ? 'error' : 'warning');
  const t = ctx.tables;

  // Slices.
  const slices = new Map<number, Fingered[]>();
  for (const x of notes) {
    if (!slices.has(x.note.slice)) slices.set(x.note.slice, []);
    slices.get(x.note.slice)!.push(x);
  }
  for (const group of slices.values()) {
    if (group.length > 5)
      add(
        'L04',
        'error',
        group.map((x) => x.note.noteId),
        `${group.length} simultaneous notes`,
      );
    for (let a = 0; a < group.length; a++) {
      for (let b = a + 1; b < group.length; b++) {
        const lo = group[a]!;
        const hi = group[b]!;
        const i = hi.note.pitch - lo.note.pitch;
        if (lo.finger === hi.finger) {
          const adjacentWhiteThumb = lo.finger === 1 && !lo.note.black && !hi.note.black && i <= 2;
          add(
            'L01',
            adjacentWhiteThumb ? 'info' : 'error',
            [lo.note.noteId, hi.note.noteId],
            `finger ${lo.finger} on two simultaneous keys`,
          );
          continue;
        }
        if (hi.finger < lo.finger)
          add(
            'L02',
            'error',
            [lo.note.noteId, hi.note.noteId],
            `fingers ${lo.finger} and ${hi.finger} crossed in a chord`,
          );
        if (
          i > span(t, 'maxPrac', lo.finger, hi.finger) ||
          i < span(t, 'minPrac', lo.finger, hi.finger)
        ) {
          add(
            'L05',
            'error',
            [lo.note.noteId, hi.note.noteId],
            `chord span ${i} semitones with ${lo.finger}-${hi.finger}`,
          );
        }
      }
    }
  }

  // Held keys (L03).
  for (let i = 0; i < notes.length; i++) {
    const cur = notes[i]!;
    for (let m = i - 1; m >= 0; m--) {
      const held = notes[m]!;
      if (held.note.slice === cur.note.slice) continue;
      if (held.note.offsetSec <= cur.note.onsetSec + EPS) continue;
      if (
        held.finger === cur.finger &&
        held.note.pitch !== cur.note.pitch &&
        held.substitution === undefined
      ) {
        add(
          'L03',
          'error',
          [held.note.noteId, cur.note.noteId],
          `finger ${cur.finger} moves to a new key while holding another`,
        );
      }
    }
  }

  // Consecutive notes in different slices.
  const consecutive: Array<[Fingered, Fingered]> = [];
  for (let i = 1; i < notes.length; i++) {
    const a = notes[i - 1]!;
    const b = notes[i]!;
    if (a.note.slice !== b.note.slice) consecutive.push([a, b]);
  }
  for (const [a, b] of consecutive) {
    const g = a.finger;
    const f = b.finger;
    const i = b.note.pitch - a.note.pitch;
    const ids = [a.note.noteId, b.note.noteId];
    if (g === f) {
      if (i !== 0 && !b.note.restBefore && b.note.ioi < ctx.hopFastSec)
        add('L11', 'warning', ids, `finger ${f} hops ${i} semitones in ${b.note.ioi.toFixed(2)} s`);
      if (i === 0 && b.note.ioi < ctx.repeatFastSec)
        add('L12', 'warning', ids, `fast repeated key with finger ${f}`);
    } else {
      if (i === 0 && b.note.ioi >= ctx.repeatFastSec)
        add('L13', 'info', ids, `slow repeated key changes finger ${g} to ${f}`);
      if (i !== 0) {
        if (i > span(t, 'maxPrac', g, f) || i < span(t, 'minPrac', g, f))
          add('L05', 'error', ids, `${i} semitones with ${g}-${f} is beyond practical`);
        else if (i > span(t, 'maxComf', g, f) || i < span(t, 'minComf', g, f))
          add('L07', 'warning', ids, `${i} semitones with ${g}-${f} is uncomfortable`);
        if (g !== 1 && f !== 1 && (f - g) * i < 0)
          add('L06', sev('L06'), ids, `finger ${g} crosses ${f}`);
        if ((g === 1 || f === 1) && (f - g) * i < 0) {
          const lowerIsA = i > 0;
          const lower = lowerIsA ? a : b;
          const upper = lowerIsA ? b : a;
          if (!lower.note.black && lower.finger !== 1 && upper.note.black && upper.finger === 1)
            add('L10', sev('L10'), ids, 'thumb passes onto a black key from a white key');
        }
      }
      if (g === 3 && f === 4) add('L14', 'warning', ids, '3 followed by 4');
      if ((g === 3 && f === 4) || (g === 4 && f === 3)) {
        const of3 = g === 3 ? a : b;
        const of4 = g === 4 ? a : b;
        if (!of3.note.black && of4.note.black)
          add('L14', 'warning', ids, '3 on white with 4 on black');
      }
    }
  }
  for (let k = 2; k < notes.length; k++) {
    const trio = [notes[k - 2]!, notes[k - 1]!, notes[k]!];
    if (new Set(trio.map((x) => x.note.slice)).size !== 3) continue;
    const fs = trio
      .map((x) => x.finger)
      .sort()
      .join('');
    if (fs === '345')
      add(
        'L14',
        'warning',
        trio.map((x) => x.note.noteId),
        '3, 4 and 5 on three consecutive notes',
      );
  }

  // Unary black-key rules.
  for (let i = 0; i < notes.length; i++) {
    const x = notes[i]!;
    if (!x.note.black) continue;
    const prev = notes[i - 1];
    const next = notes[i + 1];
    const whitePrev = prev !== undefined && !prev.note.black;
    const whiteNext = next !== undefined && !next.note.black;
    if (x.finger === 1)
      add(
        'L08',
        'warning',
        [x.note.noteId],
        `thumb on a black key (${1 + (whitePrev ? 2 : 0) + (whiteNext ? 2 : 0)} points)`,
      );
    if (x.finger === 5 && (whitePrev || whiteNext))
      add('L09', 'warning', [x.note.noteId], 'fifth finger on a black key next to a white key');
  }
  return issues;
}
```

`packages/engine/src/lint/index.ts`:

```ts
import { buildHandSequence } from '../fingering/sequence.js';
import { resolveProfile } from '../fingering/spans.js';
import type { HandProfile, HandProfileId } from '../fingering/spans.js';
import type { Assignment, Hand, Score } from '../score/types.js';
import { LINT_RULES, lintHand } from './rules.js';
import type { LintIssue, LintRuleId } from './rules.js';

export { LINT_RULES } from './rules.js';
export type { LintIssue, LintRuleId, LintSeverity } from './rules.js';

export interface LintOptions {
  profile?: HandProfileId | HandProfile;
  hopFastSec?: number;
  repeatFastSec?: number;
  beginner?: boolean;
}
export interface LintReport {
  issues: LintIssue[];
  counts: Partial<Record<LintRuleId, number>>;
  errors: number;
  warnings: number;
  infos: number;
  notes: number;
}

export function lintFingering(
  score: Score,
  assignment: Assignment,
  opts: LintOptions = {},
): LintReport {
  const profile = resolveProfile(opts.profile);
  const ctx = {
    tables: profile.tables,
    hopFastSec: opts.hopFastSec ?? 0.25,
    repeatFastSec: opts.repeatFastSec ?? 0.18,
    beginner: opts.beginner ?? false,
  };
  const issues: LintIssue[] = [];
  for (const hand of ['R', 'L'] as Hand[]) {
    const seq = buildHandSequence(score, hand);
    const fingered = seq.notes
      .filter((n) => assignment[n.noteId] !== undefined)
      .map((n) => ({
        note: n,
        finger: assignment[n.noteId]!.finger,
        substitution: assignment[n.noteId]!.substitution,
      }));
    issues.push(...lintHand(hand, fingered, ctx));
  }
  const counts: Partial<Record<LintRuleId, number>> = {};
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const i of issues) {
    counts[i.rule] = (counts[i.rule] ?? 0) + 1;
    if (i.severity === 'error') errors++;
    else if (i.severity === 'warning') warnings++;
    else infos++;
  }
  void LINT_RULES;
  return { issues, counts, errors, warnings, infos, notes: score.notes.length };
}
```

Add to `packages/engine/src/index.ts`:

```ts
export { lintFingering, LINT_RULES } from './lint/index.js';
export type { LintReport, LintOptions, LintIssue, LintRuleId, LintSeverity } from './lint/index.js';
```

Restore in `solve.test.ts` the `lintFingering` import and the `L03` assertion.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @digitus2/engine exec vitest run src/lint src/fingering/solve && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: all pass. The scale case must produce exactly one warning (L14 for the 3→4 at A–B); if a different rule fires on the scale, that rule has a bug.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/lint packages/engine/src/index.ts packages/engine/src/fingering/solve.test.ts
git commit -m "feat(engine): fingering lint L01-L14 with laws and preferences"
```

---

### Task 7: Textbook oracle evaluation

**Files:**

- Create: `packages/engine/src/eval/textbook.ts`, `packages/engine/src/eval/textbook.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `solveFingering`, `SolveOptions` (Task 5); `Score`, `Note`, `finalizeScore`, `midiToSpelling` (M1).
- Produces:

```ts
export interface TextbookEntry {
  id: string;
  family: string;
  key?: string;
  mode?: string;
  hand: Hand;
  direction: string;
  octaves?: number;
  midi: number[];
  fingers: number[];
  source?: { name: string; url?: string };
  alternatives?: Array<{ fingers: number[]; source?: { name: string; url?: string } }>;
}
export function normalizeTextbookEntries(raw: unknown): TextbookEntry[]; // accepts an array or { entries: [...] }; hand 'R'|'L'|'RH'|'LH'|'right'|'left' (case-insensitive) -> 'R'|'L'; skips entries whose midi and fingers lengths differ, collecting them in a warnings list (second return) — see below
export function scoreFromTextbookEntry(e: TextbookEntry, opts?: { qpm?: number }): Score; // quarter notes at 120 qpm, divisions 480, ids `t0`, `t1`, ...
export interface TextbookFamilyStats {
  entries: number;
  exact: number;
  noteAccuracy: number;
}
export interface TextbookReport {
  entries: number;
  exact: number;
  exactRate: number;
  noteAccuracy: number;
  byFamily: Record<string, TextbookFamilyStats>;
  failures: Array<{
    id: string;
    family: string;
    hand: Hand;
    expected: number[];
    got: number[];
    alternatives: number[][];
  }>;
}
export function evaluateTextbook(
  entries: TextbookEntry[],
  solveOpts?: SolveOptions,
): TextbookReport;
```

Make `normalizeTextbookEntries` return `{ entries: TextbookEntry[]; warnings: string[] }`. An entry is exact when the solved fingers equal the primary fingers or any alternative's fingers; note accuracy is the best per-note match rate over primary and alternatives, averaged over entries. The engine never reads files: tests and the CLI load the JSON (`benchmarks/textbook/*.json`) and pass it in.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/eval/textbook.test.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateTextbook, normalizeTextbookEntries, scoreFromTextbookEntry } from './textbook.js';

const dir = fileURLToPath(new URL('../../../../benchmarks/textbook/', import.meta.url));
const files = existsSync(dir)
  ? readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('provenance'))
  : [];

describe('textbook entries', () => {
  it('normalizes hands and shapes', () => {
    const { entries, warnings } = normalizeTextbookEntries({
      entries: [
        {
          id: 'a',
          family: 'scale',
          hand: 'RH',
          direction: 'ascending',
          midi: [60, 62],
          fingers: [1, 2],
        },
        {
          id: 'b',
          family: 'scale',
          hand: 'left',
          direction: 'desc',
          midi: [60, 62, 64],
          fingers: [1, 2],
        },
      ],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.hand).toBe('R');
    expect(warnings).toHaveLength(1);
  });
  it('builds a playable score', () => {
    const [e] = normalizeTextbookEntries([
      {
        id: 'a',
        family: 'scale',
        hand: 'L',
        direction: 'asc',
        midi: [48, 50, 52],
        fingers: [5, 4, 3],
      },
    ]).entries;
    const s = scoreFromTextbookEntry(e!);
    expect(s.notes.map((n) => [n.midi, n.hand, n.onsetSec])).toEqual([
      [48, 'L', 0],
      [50, 'L', 0.5],
      [52, 'L', 1],
    ]);
  });
  it('scores exact matches and alternatives', () => {
    const { entries } = normalizeTextbookEntries([
      {
        id: 'c',
        family: 'scale',
        hand: 'R',
        direction: 'asc',
        midi: [60, 62, 64, 65, 67, 69, 71, 72],
        fingers: [1, 2, 3, 1, 2, 3, 4, 5],
      },
      {
        id: 'd',
        family: 'chord',
        hand: 'R',
        direction: 'asc',
        midi: [60, 64, 67],
        fingers: [9, 9, 9],
        alternatives: [{ fingers: [1, 3, 5] }],
      },
    ]);
    const r = evaluateTextbook(entries);
    expect(r.entries).toBe(2);
    expect(r.byFamily.scale!.exact).toBe(1);
    expect(r.byFamily.chord!.exact).toBe(1);
    expect(r.exactRate).toBe(1);
  });
});

describe('textbook oracle (benchmarks/textbook)', () => {
  it.skipIf(files.length === 0)('reports accuracy per family and keeps a sanity floor', () => {
    const all = files.flatMap(
      (f) => normalizeTextbookEntries(JSON.parse(readFileSync(join(dir, f), 'utf8'))).entries,
    );
    expect(all.length).toBeGreaterThan(0);
    const r = evaluateTextbook(all);
    // eslint-disable-next-line no-console
    console.info(
      'textbook oracle:',
      JSON.stringify({
        entries: r.entries,
        exactRate: r.exactRate,
        noteAccuracy: r.noteAccuracy,
        byFamily: r.byFamily,
      }),
    );
    expect(r.noteAccuracy).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine exec vitest run src/eval/textbook`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/engine/src/eval/textbook.ts`:

```ts
import { solveFingering } from '../fingering/solve.js';
import type { SolveOptions } from '../fingering/solve.js';
import { finalizeScore } from '../score/build.js';
import { midiToSpelling } from '../score/pitch.js';
import type { Hand, Note, Score } from '../score/types.js';

export interface TextbookEntry {
  id: string;
  family: string;
  key?: string;
  mode?: string;
  hand: Hand;
  direction: string;
  octaves?: number;
  midi: number[];
  fingers: number[];
  source?: { name: string; url?: string };
  alternatives?: Array<{ fingers: number[]; source?: { name: string; url?: string } }>;
}

function hand(v: unknown): Hand | undefined {
  const s = String(v ?? '').toLowerCase();
  if (s === 'r' || s === 'rh' || s === 'right') return 'R';
  if (s === 'l' || s === 'lh' || s === 'left') return 'L';
  return undefined;
}

export function normalizeTextbookEntries(raw: unknown): {
  entries: TextbookEntry[];
  warnings: string[];
} {
  const list = Array.isArray(raw) ? raw : ((raw as { entries?: unknown[] })?.entries ?? []);
  const entries: TextbookEntry[] = [];
  const warnings: string[] = [];
  list.forEach((item, k) => {
    const e = item as Record<string, unknown>;
    const h = hand(e.hand);
    const midi = Array.isArray(e.midi) ? (e.midi as number[]) : [];
    const fingers = Array.isArray(e.fingers) ? (e.fingers as number[]) : [];
    const id = String(e.id ?? `entry-${k}`);
    if (!h || midi.length === 0 || midi.length !== fingers.length) {
      warnings.push(
        `${id}: skipped (hand ${String(e.hand)}, ${midi.length} notes, ${fingers.length} fingers)`,
      );
      return;
    }
    const alternatives = Array.isArray(e.alternatives)
      ? (
          e.alternatives as Array<{ fingers: number[]; source?: { name: string; url?: string } }>
        ).filter((a) => Array.isArray(a.fingers) && a.fingers.length === midi.length)
      : [];
    const entry: TextbookEntry = {
      id,
      family: String(e.family ?? 'unknown'),
      hand: h,
      direction: String(e.direction ?? ''),
      midi,
      fingers,
      alternatives,
    };
    if (typeof e.key === 'string') entry.key = e.key;
    if (typeof e.mode === 'string') entry.mode = e.mode;
    if (typeof e.octaves === 'number') entry.octaves = e.octaves;
    if (e.source && typeof e.source === 'object')
      entry.source = e.source as TextbookEntry['source'];
    entries.push(entry);
  });
  return { entries, warnings };
}

export function scoreFromTextbookEntry(e: TextbookEntry, opts: { qpm?: number } = {}): Score {
  const qpm = opts.qpm ?? 120;
  const divisions = 480;
  const notes: Note[] = e.midi.map((midi, i) => ({
    id: `t${i}`,
    onsetTick: i * divisions,
    offsetTick: (i + 1) * divisions,
    onsetSec: 0,
    offsetSec: 0,
    midi,
    spelling: midiToSpelling(midi),
    hand: e.hand,
    staff: e.hand === 'R' ? 1 : 2,
    voice: 1,
    measureIndex: 0,
    isGrace: false,
    chordId: '',
    sourceIndices: [i],
  }));
  return finalizeScore({
    meta: { title: e.id },
    divisions,
    tempoMap: [{ tick: 0, qpm }],
    timeSignatures: [],
    keySignatures: [],
    measures: [],
    notes,
  });
}

export interface TextbookFamilyStats {
  entries: number;
  exact: number;
  noteAccuracy: number;
}
export interface TextbookReport {
  entries: number;
  exact: number;
  exactRate: number;
  noteAccuracy: number;
  byFamily: Record<string, TextbookFamilyStats>;
  failures: Array<{
    id: string;
    family: string;
    hand: Hand;
    expected: number[];
    got: number[];
    alternatives: number[][];
  }>;
}

export function evaluateTextbook(
  entries: TextbookEntry[],
  solveOpts: SolveOptions = {},
): TextbookReport {
  const byFamily: Record<string, TextbookFamilyStats> = {};
  const failures: TextbookReport['failures'] = [];
  let exact = 0;
  let accSum = 0;
  for (const e of entries) {
    const score = scoreFromTextbookEntry(e);
    const { assignment } = solveFingering(score, { ...solveOpts, hands: [e.hand] });
    const got = score.notes.map((n) => assignment[n.id]!.finger as number);
    const candidates = [e.fingers, ...(e.alternatives ?? []).map((a) => a.fingers)];
    const rate = (c: number[]) => c.reduce((s, f, i) => s + (f === got[i] ? 1 : 0), 0) / c.length;
    const best = Math.max(...candidates.map(rate));
    const isExact = best === 1;
    const fam = (byFamily[e.family] ??= { entries: 0, exact: 0, noteAccuracy: 0 });
    fam.entries++;
    fam.noteAccuracy += best;
    if (isExact) {
      exact++;
      fam.exact++;
    } else {
      failures.push({
        id: e.id,
        family: e.family,
        hand: e.hand,
        expected: e.fingers,
        got,
        alternatives: (e.alternatives ?? []).map((a) => a.fingers),
      });
    }
    accSum += best;
  }
  for (const fam of Object.values(byFamily))
    fam.noteAccuracy = fam.entries ? fam.noteAccuracy / fam.entries : 0;
  const n = entries.length;
  return {
    entries: n,
    exact,
    exactRate: n ? exact / n : 0,
    noteAccuracy: n ? accSum / n : 0,
    byFamily,
    failures,
  };
}
```

Add to `packages/engine/src/index.ts`:

```ts
export {
  evaluateTextbook,
  normalizeTextbookEntries,
  scoreFromTextbookEntry,
} from './eval/textbook.js';
export type { TextbookEntry, TextbookReport, TextbookFamilyStats } from './eval/textbook.js';
```

- [ ] **Step 4: Run the tests and record the numbers**

Run: `pnpm --filter @digitus2/engine exec vitest run src/eval/textbook && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: all pass. Copy the printed `textbook oracle:` line (per-family exact and note accuracy, before templates) into your report; Task 8 and Task 11 use it.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/eval/textbook.ts packages/engine/src/eval/textbook.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): textbook oracle evaluation (scales, arpeggios, chromatic)"
```

---

### Task 8: Standard-fingering templates (scale and arpeggio runs)

**Files:**

- Create: `packages/engine/src/fingering/templates.ts`, `packages/engine/src/fingering/templates.test.ts`, `packages/engine/src/fingering/params/textbook/scales.json`, `packages/engine/src/fingering/params/textbook/arpeggios.json`, `packages/engine/src/fingering/params/textbook/chromatic.json`, `packages/engine/src/fingering/params/textbook/provenance.json`
- Modify: `packages/engine/src/fingering/solve.ts` (template bonus in the unary cost; option `templates?: boolean`, default true), `packages/engine/src/fingering/params/weights-parncutt.json` (`template` weight 2), `packages/engine/src/eval/textbook.test.ts` (raise the floor)

**Interfaces:**

- Consumes: `HandSequence`, `SeqNote` (Task 3); `TextbookEntry`, `normalizeTextbookEntries` (Task 7); `Finger`.
- Produces:

```ts
export interface Run {
  start: number;
  end: number;
  kind: 'scale' | 'arpeggio' | 'chromatic';
  direction: 1 | -1;
} // inclusive sequence indices
export function detectRuns(seq: HandSequence): Run[];
export interface TemplateMatch {
  start: number;
  end: number;
  fingers: Finger[];
  entryId: string;
}
export function matchTemplates(
  seq: HandSequence,
  runs: Run[],
  entries: TextbookEntry[],
): TemplateMatch[];
export function templateFingerAt(matches: TemplateMatch[], i: number): Finger | undefined;
export const TEXTBOOK_TEMPLATES: Record<Hand, TextbookEntry[]>; // loaded from params/textbook/*.json, entries with octaves <= 2
```

Run detection (literature 6.6 item 2): consider maximal stretches of consecutive single-note slices (one note per slice, no grace notes) in one direction with every step of 1 or 2 semitones; a stretch of at least 4 notes whose steps are all 1 is `chromatic`, otherwise with any 2-semitone step it is `scale`; stretches of at least 3 notes with every step in 3..5 semitones are `arpeggio`. Matching: an entry of the same hand matches a run when the run's midi list (in sequence order) appears as a contiguous subsequence of the entry's `midi` list in the same direction after transposing by a whole number of octaves (compare `midi - 12 * k`); the template fingers are the entry's fingers over that subsequence. Prefer the longest run, then the first matching entry in file order (scales before arpeggios before chromatic). Overlapping matches: a later run never overrides fingers already assigned by an earlier (longer) match. Copy the three JSON files from `benchmarks/textbook/` and write `provenance.json` with the source paths, the file hashes (sha256 from `shasum -a 256` or `certutil -hashfile`), and the date; keep only entries with `octaves <= 2` to limit bundle size (filter at load time, not by editing the files).

Solver integration: `solveHand` takes an optional `templates?: TemplateMatch[]`; `unary(i, f)` adds `-weights.template` when `templateFingerAt(templates, i) === f`. `solveFingering` computes the matches per hand when `opts.templates !== false`. Set `"template": 2` in `weights-parncutt.json` and add to its provenance note: "template bonus added with Task 8; to be tuned in M3".

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/fingering/templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsePig } from '../io/pig/read.js';
import { solveFingering } from './solve.js';
import { buildHandSequence } from './sequence.js';
import { detectRuns, matchTemplates, TEXTBOOK_TEMPLATES } from './templates.js';

const H = '//Version: PianoFingering_v170101\n';
const melody = (pitches: string[], ch: number, dur = 0.5) =>
  H +
  pitches.map((p, i) => `${i}\t${i * dur}\t${(i + 1) * dur}\t${p}\t80\t80\t${ch}\t0`).join('\n') +
  '\n';

describe('detectRuns', () => {
  it('finds scale, arpeggio and chromatic runs', () => {
    const { score } = parsePig(
      melody(['C4', 'D4', 'E4', 'F4', 'G4', 'E4', 'C4', 'A3', 'C4', 'C#4', 'D4', 'D#4', 'E4'], 0),
    );
    const runs = detectRuns(buildHandSequence(score, 'R'));
    expect(runs.map((r) => [r.kind, r.start, r.end, r.direction])).toEqual([
      ['scale', 0, 4, 1],
      ['arpeggio', 4, 7, -1],
      ['chromatic', 8, 12, 1],
    ]);
  });
  it('ignores chords and short fragments', () => {
    const { score } = parsePig(
      H +
        [
          '0\t0\t1\tC4\t80\t80\t0\t0',
          '1\t0\t1\tE4\t80\t80\t0\t0',
          '2\t1\t2\tD4\t80\t80\t0\t0',
          '3\t2\t3\tE4\t80\t80\t0\t0',
        ].join('\n') +
        '\n',
    );
    expect(detectRuns(buildHandSequence(score, 'R'))).toEqual([]);
  });
});

describe('matchTemplates', () => {
  it('matches a B-flat major scale in the right hand at any octave', () => {
    expect(TEXTBOOK_TEMPLATES.R.length).toBeGreaterThan(0);
    const { score } = parsePig(melody(['Bb4', 'C5', 'D5', 'Eb5', 'F5', 'G5', 'A5', 'Bb5'], 0));
    const seq = buildHandSequence(score, 'R');
    const m = matchTemplates(seq, detectRuns(seq), TEXTBOOK_TEMPLATES.R);
    expect(m).toHaveLength(1);
    expect(m[0]!.fingers).toEqual([2, 1, 2, 3, 1, 2, 3, 4]);
  });
  it('matches a left-hand arpeggio', () => {
    const { score } = parsePig(melody(['C3', 'E3', 'G3', 'C4', 'E4', 'G4', 'C5'], 1));
    const seq = buildHandSequence(score, 'L');
    const m = matchTemplates(seq, detectRuns(seq), TEXTBOOK_TEMPLATES.L);
    expect(m.length).toBeGreaterThan(0);
    expect(m[0]!.fingers[0]).toBe(5);
  });
});

describe('solver with templates', () => {
  it('fingers the B-flat major scale like the textbook and can be switched off', () => {
    const { score } = parsePig(melody(['Bb4', 'C5', 'D5', 'Eb5', 'F5', 'G5', 'A5', 'Bb5'], 0));
    const on = solveFingering(score, { hands: ['R'] });
    expect(score.notes.map((n) => on.assignment[n.id]!.finger)).toEqual([2, 1, 2, 3, 1, 2, 3, 4]);
    const off = solveFingering(score, { hands: ['R'], templates: false });
    expect(off.hands[0]!.cost).toBeGreaterThanOrEqual(on.hands[0]!.cost);
  });
});
```

If the textbook oracle's B-flat major right-hand ascending fingering differs from `[2, 1, 2, 3, 1, 2, 3, 4]` (check `benchmarks/textbook/scales.json`), use the oracle's primary fingering in both expectations and say so in the report.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine exec vitest run src/fingering/templates`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/engine/src/fingering/templates.ts`:

```ts
import { normalizeTextbookEntries } from '../eval/textbook.js';
import type { TextbookEntry } from '../eval/textbook.js';
import type { Finger, Hand } from '../score/types.js';
import arpeggios from './params/textbook/arpeggios.json' with { type: 'json' };
import chromatic from './params/textbook/chromatic.json' with { type: 'json' };
import scales from './params/textbook/scales.json' with { type: 'json' };
import type { HandSequence } from './sequence.js';

export interface Run {
  start: number;
  end: number;
  kind: 'scale' | 'arpeggio' | 'chromatic';
  direction: 1 | -1;
}
export interface TemplateMatch {
  start: number;
  end: number;
  fingers: Finger[];
  entryId: string;
}

function load(): Record<Hand, TextbookEntry[]> {
  const all = [scales, arpeggios, chromatic]
    .flatMap((raw) => normalizeTextbookEntries(raw).entries)
    .filter((e) => (e.octaves ?? 1) <= 2);
  return { R: all.filter((e) => e.hand === 'R'), L: all.filter((e) => e.hand === 'L') };
}
export const TEXTBOOK_TEMPLATES: Record<Hand, TextbookEntry[]> = load();

export function detectRuns(seq: HandSequence): Run[] {
  const notes = seq.notes;
  const sliceSize = new Map<number, number>();
  for (const n of notes) sliceSize.set(n.slice, (sliceSize.get(n.slice) ?? 0) + 1);
  const single = (i: number): boolean => sliceSize.get(notes[i]!.slice) === 1 && !notes[i]!.isGrace;
  const runs: Run[] = [];
  let i = 0;
  while (i < notes.length) {
    if (!single(i)) {
      i++;
      continue;
    }
    // Extend a stretch of consistent direction with steps in 1..5 semitones.
    let j = i;
    let dir: 1 | -1 | 0 = 0;
    const steps: number[] = [];
    while (j + 1 < notes.length && single(j + 1)) {
      const step = notes[j + 1]!.midi - notes[j]!.midi;
      const d: 1 | -1 | 0 = step > 0 ? 1 : step < 0 ? -1 : 0;
      if (d === 0 || Math.abs(step) > 5 || (dir !== 0 && d !== dir)) break;
      const kindOf = (s: number): 'step' | 'leap' => (Math.abs(s) <= 2 ? 'step' : 'leap');
      if (steps.length > 0 && kindOf(steps[0]!) !== kindOf(step)) break;
      dir = d;
      steps.push(step);
      j++;
    }
    const len = j - i + 1;
    if (steps.length > 0 && Math.abs(steps[0]!) <= 2 && len >= 4) {
      runs.push({
        start: i,
        end: j,
        kind: steps.every((s) => Math.abs(s) === 1) ? 'chromatic' : 'scale',
        direction: dir as 1 | -1,
      });
    } else if (steps.length > 0 && Math.abs(steps[0]!) >= 3 && len >= 3) {
      runs.push({ start: i, end: j, kind: 'arpeggio', direction: dir as 1 | -1 });
    }
    i = len > 1 ? j : i + 1;
  }
  return runs;
}

export function matchTemplates(
  seq: HandSequence,
  runs: Run[],
  entries: TextbookEntry[],
): TemplateMatch[] {
  const matches: TemplateMatch[] = [];
  const taken = new Set<number>();
  const ordered = [...runs].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  for (const run of ordered) {
    const midi = seq.notes.slice(run.start, run.end + 1).map((n) => n.midi);
    let found: TemplateMatch | undefined;
    for (const e of entries) {
      const at = findShifted(e.midi, midi);
      if (at < 0) continue;
      found = {
        start: run.start,
        end: run.end,
        fingers: e.fingers.slice(at, at + midi.length) as Finger[],
        entryId: e.id,
      };
      break;
    }
    if (!found) continue;
    if (midiRange(found.start, found.end).some((k) => taken.has(k))) continue;
    for (const k of midiRange(found.start, found.end)) taken.add(k);
    matches.push(found);
  }
  return matches.sort((a, b) => a.start - b.start);
}

function midiRange(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, k) => a + k);
}

/** Index in `haystack` where `needle` occurs contiguously up to an octave shift, or -1. */
function findShifted(haystack: number[], needle: number[]): number {
  if (needle.length > haystack.length) return -1;
  for (let at = 0; at + needle.length <= haystack.length; at++) {
    const shift = haystack[at]! - needle[0]!;
    if (shift % 12 !== 0) continue;
    let ok = true;
    for (let k = 1; k < needle.length; k++) {
      if (haystack[at + k]! - needle[k]! !== shift) {
        ok = false;
        break;
      }
    }
    if (ok) return at;
  }
  return -1;
}

export function templateFingerAt(matches: TemplateMatch[], i: number): Finger | undefined {
  for (const m of matches) if (i >= m.start && i <= m.end) return m.fingers[i - m.start];
  return undefined;
}
```

In `solve.ts`: add `templates?: boolean` to `SolveOptions`; give `solveHand` a fourth parameter `templates: TemplateMatch[] = []` and in `unary` add `if (templateFingerAt(templates, i) === f) cost -= ctx.weights.template;` (compute the rule cost first, then subtract). In `solveFingering`, when `opts.templates !== false`, compute `matchTemplates(seq, detectRuns(seq), TEXTBOOK_TEMPLATES[hand])` once per hand and pass it to every `solveHand` call for that hand. Include the bonus in explanations as a term `{ rule: 'template', points: -1, weighted: -weights.template }` when it applies. Set `"template": 2` in the weights file.

- [ ] **Step 4: Run the tests, then raise the textbook floor**

Run: `pnpm --filter @digitus2/engine exec vitest run src/fingering src/eval/textbook && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: all pass. Read the new `textbook oracle:` line; in `src/eval/textbook.test.ts` replace `expect(r.noteAccuracy).toBeGreaterThan(0.5)` by assertions on the measured values rounded down to two decimals (for example `expect(r.byFamily.scale!.exactRate ...)` is not available; use `r.byFamily.scale!.noteAccuracy` ≥ measured − 0.01 and `r.noteAccuracy` ≥ measured − 0.01). Report the before and after numbers. If scales are below 1.0 after templates, list the failing entry ids from `r.failures` in your report: the final task decides whether the oracle data or the matcher is wrong.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/fingering/templates.ts packages/engine/src/fingering/templates.test.ts packages/engine/src/fingering/params packages/engine/src/fingering/solve.ts packages/engine/src/eval/textbook.test.ts
git commit -m "feat(engine): textbook templates for scale and arpeggio runs"
```

---

### Task 9: Metamorphic suite

**Files:**

- Create: `packages/engine/src/eval/metamorphic.ts`, `packages/engine/src/eval/metamorphic.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `solveFingering`, `SolveOptions` (Task 5); `lintFingering` (Task 6); `Score`, `Note`, `finalizeScore`, `midiToSpelling`, `mirrorPitch`.
- Produces:

```ts
export type MetamorphicId = 'DET' | 'MR1' | 'MR2' | 'MR6' | 'MR7' | 'MR8' | 'MR10';
export interface MetamorphicCheck {
  id: MetamorphicId;
  title: string;
  passed: boolean;
  agreement: number;
  threshold: number;
  details: string;
}
export interface MetamorphicReport {
  checks: MetamorphicCheck[];
  passed: boolean;
}
export function transposeScore(score: Score, semitones: number): Score; // all notes; spelling recomputed with midiToSpelling
export function mirrorScore(score: Score): Score; // midi -> 124 - midi, hand R<->L, staff 1<->2
export function duplicateScore(score: Score, gapTicks?: number): Score; // the piece followed by a copy of itself (ids suffixed "'"), gap default one quarter
export function perturbLastNote(score: Score): Score; // last note (by onset) moved by +2 semitones (or -2 when out of range)
export function runMetamorphic(
  score: Score,
  opts?: SolveOptions & { thresholds?: Partial<Record<MetamorphicId, number>> },
): MetamorphicReport;
```

Checks and default thresholds (agreement is the share of compared notes whose fingers agree):

- DET determinism: two solves are identical (1.0).
- MR1 octave transposition: transpose by +12 if every note stays ≤ 108, else by −12; fingers identical (1.0).
- MR2 mirror symmetry: mirror the score; the mirrored score's right-hand fingering must equal the original left-hand fingering note for note and vice versa (1.0; the engine is symmetric by construction).
- MR10 enharmonic respelling: replace each spelling by `midiToSpelling(midi, 'flat')`; identical fingers (1.0).
- MR6 duplicated passage: in the duplicated score, the copy's fingers agree with the original's fingers on at least 0.9 of notes (boundary effects allowed).
- MR7 locality: after `perturbLastNote`, fingers of notes whose onset is in the first half of the piece agree on at least 0.98.
- MR8 smaller hand: solving with the `small` profile yields no more lint errors (under the small profile) than the `large` solution linted under the small profile; agreement reported as 1.0 when the condition holds, else 0.
  Thresholds are overridable per check. `passed` is true when every check meets its threshold.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/eval/metamorphic.test.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../io/musicxml/read.js';
import { parsePig } from '../io/pig/read.js';
import {
  duplicateScore,
  mirrorScore,
  perturbLastNote,
  runMetamorphic,
  transposeScore,
} from './metamorphic.js';

const H = '//Version: PianoFingering_v170101\n';
const melody = (pitches: string[], ch: number) =>
  H +
  pitches.map((p, i) => `${i}\t${i * 0.5}\t${(i + 1) * 0.5}\t${p}\t80\t80\t${ch}\t0`).join('\n') +
  '\n';
const fixture = readFileSync(
  fileURLToPath(new URL('../../fixtures/two-staff.musicxml', import.meta.url)),
  'utf8',
);
const scoresDir = fileURLToPath(new URL('../../../../content/scores/', import.meta.url));
const library = existsSync(scoresDir)
  ? readdirSync(scoresDir)
      .filter((f) => f.endsWith('.musicxml') && !f.includes('.fingered.'))
      .slice(0, 6)
  : [];

describe('transforms', () => {
  it('transposes, mirrors, duplicates and perturbs', () => {
    const { score } = parsePig(melody(['C4', 'E4', 'G4'], 0) + '3\t0\t1\tC3\t80\t80\t1\t0\n');
    expect(transposeScore(score, 12).notes.map((n) => n.midi)).toEqual(
      score.notes.map((n) => n.midi + 12),
    );
    const m = mirrorScore(score);
    expect(m.notes.map((n) => [n.midi, n.hand])).toEqual(
      score.notes.map((n) => [124 - n.midi, n.hand === 'R' ? 'L' : 'R']),
    );
    const d = duplicateScore(score);
    expect(d.notes).toHaveLength(score.notes.length * 2);
    expect(Math.min(...d.notes.slice(score.notes.length).map((n) => n.onsetTick))).toBeGreaterThan(
      Math.max(...score.notes.map((n) => n.offsetTick)),
    );
    const p = perturbLastNote(score);
    const last = [...score.notes].sort((a, b) => b.onsetTick - a.onsetTick)[0]!;
    expect(p.notes.find((n) => n.id === last.id)!.midi).toBe(last.midi + 2);
  });
});

describe('runMetamorphic', () => {
  it('passes on a scale in both hands', () => {
    const { score } = parsePig(
      melody(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'], 0) +
        ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4']
          .map((p, i) => `${i + 8}\t${i * 0.5}\t${(i + 1) * 0.5}\t${p}\t80\t80\t1\t0`)
          .join('\n') +
        '\n',
    );
    const r = runMetamorphic(score);
    expect(r.checks.map((c) => c.id)).toEqual(['DET', 'MR1', 'MR2', 'MR10', 'MR6', 'MR7', 'MR8']);
    expect(r.checks.filter((c) => !c.passed)).toEqual([]);
  });
  it('passes on the two-staff fixture', () => {
    const { score } = parseMusicXml(fixture);
    const r = runMetamorphic(score);
    expect(r.checks.filter((c) => !c.passed).map((c) => `${c.id}:${c.details}`)).toEqual([]);
  });
  it.skipIf(library.length === 0)('passes on built-in library pieces', () => {
    for (const f of library) {
      const { score } = parseMusicXml(readFileSync(join(scoresDir, f)));
      const r = runMetamorphic(score);
      expect(r.checks.filter((c) => !c.passed).map((c) => `${f} ${c.id}: ${c.details}`)).toEqual(
        [],
      );
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine exec vitest run src/eval/metamorphic`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/engine/src/eval/metamorphic.ts`:

```ts
import { mirrorPitch } from '../fingering/geometry.js';
import { solveFingering } from '../fingering/solve.js';
import type { SolveOptions } from '../fingering/solve.js';
import { lintFingering } from '../lint/index.js';
import { finalizeScore } from '../score/build.js';
import { midiToSpelling, PIANO_MAX, PIANO_MIN } from '../score/pitch.js';
import type { Assignment, Note, Score } from '../score/types.js';

export type MetamorphicId = 'DET' | 'MR1' | 'MR2' | 'MR6' | 'MR7' | 'MR8' | 'MR10';
export interface MetamorphicCheck {
  id: MetamorphicId;
  title: string;
  passed: boolean;
  agreement: number;
  threshold: number;
  details: string;
}
export interface MetamorphicReport {
  checks: MetamorphicCheck[];
  passed: boolean;
}

const DEFAULT_THRESHOLDS: Record<MetamorphicId, number> = {
  DET: 1,
  MR1: 1,
  MR2: 1,
  MR10: 1,
  MR6: 0.9,
  MR7: 0.98,
  MR8: 1,
};

function rebuild(score: Score, notes: Note[]): Score {
  return finalizeScore({ ...score, notes });
}

export function transposeScore(score: Score, semitones: number): Score {
  return rebuild(
    score,
    score.notes.map((n) => ({
      ...n,
      midi: n.midi + semitones,
      spelling: midiToSpelling(n.midi + semitones),
    })),
  );
}

export function mirrorScore(score: Score): Score {
  return rebuild(
    score,
    score.notes.map((n) => ({
      ...n,
      midi: mirrorPitch(n.midi),
      spelling: midiToSpelling(mirrorPitch(n.midi)),
      hand: n.hand === 'R' ? 'L' : 'R',
      staff: n.staff === 1 ? 2 : 1,
    })),
  );
}

export function duplicateScore(score: Score, gapTicks = score.divisions): Score {
  const end = Math.max(...score.notes.map((n) => n.offsetTick));
  const shift = end + gapTicks;
  const copy = score.notes.map((n) => ({
    ...n,
    id: `${n.id}'`,
    onsetTick: n.onsetTick + shift,
    offsetTick: n.offsetTick + shift,
    sourceIndices: [],
  }));
  return rebuild(score, [...score.notes, ...copy]);
}

export function perturbLastNote(score: Score): Score {
  const last = [...score.notes].sort((a, b) => b.onsetTick - a.onsetTick || b.midi - a.midi)[0];
  if (!last) return score;
  const delta = last.midi + 2 <= PIANO_MAX ? 2 : -2;
  return rebuild(
    score,
    score.notes.map((n) =>
      n.id === last.id
        ? { ...n, midi: n.midi + delta, spelling: midiToSpelling(n.midi + delta) }
        : n,
    ),
  );
}

function fingers(score: Score, a: Assignment): Map<string, number> {
  return new Map(score.notes.map((n) => [n.id, a[n.id]?.finger ?? 0]));
}

function agreement(
  a: Map<string, number>,
  b: Map<string, number>,
  ids: Iterable<string>,
  mapId: (id: string) => string = (x) => x,
): number {
  let total = 0;
  let same = 0;
  for (const id of ids) {
    total++;
    if (a.get(id) === b.get(mapId(id))) same++;
  }
  return total === 0 ? 1 : same / total;
}

export function runMetamorphic(
  score: Score,
  opts: SolveOptions & { thresholds?: Partial<Record<MetamorphicId, number>> } = {},
): MetamorphicReport {
  const { thresholds, ...solveOpts } = opts;
  const th = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const base = fingers(score, solveFingering(score, solveOpts).assignment);
  const ids = score.notes.map((n) => n.id);
  const checks: MetamorphicCheck[] = [];
  const add = (id: MetamorphicId, title: string, value: number, details: string): void => {
    checks.push({
      id,
      title,
      passed: value >= th[id] - 1e-12,
      agreement: value,
      threshold: th[id],
      details,
    });
  };

  add(
    'DET',
    'Determinism',
    agreement(base, fingers(score, solveFingering(score, solveOpts).assignment), ids),
    'two solves compared',
  );

  const up = score.notes.every((n) => n.midi + 12 <= PIANO_MAX);
  const down = score.notes.every((n) => n.midi - 12 >= PIANO_MIN);
  if (up || down) {
    const t = transposeScore(score, up ? 12 : -12);
    add(
      'MR1',
      'Octave transposition',
      agreement(base, fingers(t, solveFingering(t, solveOpts).assignment), ids),
      `transposed by ${up ? '+12' : '-12'}`,
    );
  } else {
    add('MR1', 'Octave transposition', 1, 'skipped: piece spans the whole keyboard');
  }

  const m = mirrorScore(score);
  add(
    'MR2',
    'Mirror symmetry',
    agreement(base, fingers(m, solveFingering(m, solveOpts).assignment), ids),
    'mirrored about D4 with hands swapped',
  );

  const flat = rebuild(
    score,
    score.notes.map((n) => ({ ...n, spelling: midiToSpelling(n.midi, 'flat') })),
  );
  add(
    'MR10',
    'Enharmonic respelling',
    agreement(base, fingers(flat, solveFingering(flat, solveOpts).assignment), ids),
    'all spellings flattened',
  );

  const d = duplicateScore(score);
  const dupFingers = fingers(d, solveFingering(d, solveOpts).assignment);
  add(
    'MR6',
    'Repeated passage',
    agreement(dupFingers, dupFingers, ids, (id) => `${id}'`),
    'second copy versus first copy',
  );

  const p = perturbLastNote(score);
  const half =
    (Math.min(...score.notes.map((n) => n.onsetTick)) +
      Math.max(...score.notes.map((n) => n.onsetTick))) /
    2;
  const early = score.notes.filter((n) => n.onsetTick < half).map((n) => n.id);
  add(
    'MR7',
    'Locality',
    agreement(base, fingers(p, solveFingering(p, solveOpts).assignment), early),
    `${early.length} notes in the first half compared after moving the last note`,
  );

  const smallSolution = solveFingering(score, { ...solveOpts, profile: 'small' }).assignment;
  const largeSolution = solveFingering(score, { ...solveOpts, profile: 'large' }).assignment;
  const smallErrors = lintFingering(score, smallSolution, { profile: 'small' }).errors;
  const largeUnderSmall = lintFingering(score, largeSolution, { profile: 'small' }).errors;
  add(
    'MR8',
    'Smaller hand',
    smallErrors <= largeUnderSmall ? 1 : 0,
    `lint errors under the small profile: small solution ${smallErrors}, large solution ${largeUnderSmall}`,
  );

  return { checks, passed: checks.every((c) => c.passed) };
}
```

Add to `packages/engine/src/index.ts`:

```ts
export {
  runMetamorphic,
  transposeScore,
  mirrorScore,
  duplicateScore,
  perturbLastNote,
} from './eval/metamorphic.js';
export type { MetamorphicCheck, MetamorphicId, MetamorphicReport } from './eval/metamorphic.js';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @digitus2/engine exec vitest run src/eval/metamorphic && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint`
Expected: all pass. If MR6 or MR7 fail on a library piece, inspect which notes differ: template matches that straddle the duplicate boundary or the perturbed note are legitimate; a difference far from any boundary is a solver bug (non-local behaviour) and must be reported, not thresholded away.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/eval/metamorphic.ts packages/engine/src/eval/metamorphic.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): metamorphic suite (determinism, octave, mirror, respelling, repetition, locality, hand size)"
```

---

### Task 10: CLI: finger, lint, bench with scorecards, error galleries, floors and ablation

**Files:**

- Create: `packages/engine/src/eval/hardErrors.ts`, `packages/engine/src/eval/hardErrors.test.ts`, `packages/engine/cli/finger.ts`, `packages/engine/cli/lint.ts`, `packages/engine/cli/bench.ts`, `packages/engine/cli/bench.test.ts`
- Modify: `packages/engine/cli/main.ts`, `packages/engine/src/index.ts`, `.gitignore` (add `benchmarks/runs/` and `benchmarks/errors/`; keep `benchmarks/latest.json` tracked)

**Interfaces:**

- Consumes: everything above; `parsePig`, `writePig`, `parseMusicXml`, `injectFingerings`, `metricsForScores`, `fingerSeq`, `alignScores` (M1).
- Produces:

```ts
// src/eval/hardErrors.ts
export function hardErrors(
  pred: FingerSeq,
  golds: FingerSeq[],
): { unanimous: number; hardErrors: number; rate: number };
// notes where at least two golds exist and all golds agree; rate = hardErrors / unanimous (0 when unanimous is 0)

// cli/bench.ts
export interface BenchOptions {
  gold: string;
  split: string;
  splitName?: string;
  subset?: 'test' | 'train';
  floor?: string;
  out?: string;
  label?: string;
  profile?: HandProfileId;
  ablate?: boolean;
  limit?: number;
}
export interface PieceResult {
  id: string;
  notes: number;
  annotators: number;
  gen: number;
  high: number;
  soft: number;
  rec: number;
  hardErrorRate: number;
  lintErrors: number;
  lintWarnings: number;
  ms: number;
}
export interface Scorecard {
  version: 1;
  engineVersion: string;
  gitSha: string;
  label: string;
  timestamp: string;
  split: { file: string; name: string; subset: string };
  profile: string;
  weightsHash: string;
  macro: { gen: number; high: number; soft: number; rec: number; hardErrorRate: number };
  noteWeighted: { gen: number; high: number; soft: number; rec: number };
  lint: { errorsPer1000: number; warningsPer1000: number };
  timing: { totalMs: number; msPerPiece: number; msPer1000Notes: number };
  pieces: PieceResult[];
  skipped: Array<{ id: string; reason: string }>;
}
export function runBench(opts: BenchOptions): {
  scorecard: Scorecard;
  floorBreaches: string[];
  galleryDir: string;
};
export function formatScorecard(card: Scorecard, previous?: Scorecard, floor?: unknown): string;
```

Behaviour:

- Split: read `opts.split` JSON; take `splits[splitName ?? json.default_split][subset ?? 'test'].pieces` (strings like `001`). For each id, gold files are every file in `<gold>/FingeringFiles/` (or `<gold>` itself when it has no such subfolder) named `<id>-<k>_fingering.txt`. The first gold file's notes are the score; every other gold must have the same note count, otherwise the piece is skipped with the reason recorded. Solve with `solveFingering(score, { profile })`, score with `metricsForScores`, `hardErrors` (built from `fingerSeq` of the prediction and of each gold in the reference order), lint counts, and wall time. Every piece in the split appears either in `pieces` or in `skipped`.
- Macro averages are unweighted over pieces (percent, two decimals in the printout); note-weighted averages weight by note count.
- Scorecard files: `<out ?? 'benchmarks/runs'>/<gitSha7>-<label>.json` and `benchmarks/latest.json`. `gitSha` from `git rev-parse HEAD` through `child_process.execSync`, `'unknown'` on failure (CLI code may use Node). `weightsHash` = sha256 of the weights JSON text (`node:crypto`).
- Error gallery: `benchmarks/errors/<label>/<id>.md` for every scored piece with at least one mismatch: a header with the piece's metrics, then a table sorted hard errors first: `#`, onset (s), hand, pitch (PIG spelling), engine finger with confidence (percent) and the top two explanation terms, each annotator's finger, and `hard` when all annotators agree and differ from the engine.
- Floor: when `opts.floor` is given and the floor JSON has `engine` not null, compare `macro.gen/high/soft/rec` (percent) with `engine.gen/high/soft/rec`; every value below its floor by more than 0.005 is a breach string; the CLI exits 1 on any breach. When `engine` is null, print "no floor set".
- Deltas: when `benchmarks/latest.json` exists before the run, print each macro metric with the delta against it.
- `--ablate`: after the main run, for each rule id whose weight is non-zero, re-run the whole subset with that weight set to 0 and print a table of macro deltas (gen, high, soft, rec) per rule; write `benchmarks/ablation-<label>.json`. `--limit n` scores only the first n pieces (for quick checks; the scorecard records it in `label` as `-limit<n>` and never updates `latest.json` or floors).
- `digitus2 finger <file> [--out <path>] [--format pig|musicxml] [--profile child|small|medium|large] [--hand R|L|both] [--editorial]`: reads MusicXML (`.musicxml`, `.xml`, `.mxl`) or PIG (`.txt`), solves (pinning editorial fingerings when `--editorial`), writes PIG text or MusicXML with injected fingerings (default: PIG for PIG input, MusicXML for MusicXML input) to `--out` or stdout.
- `digitus2 lint <file> [--fingering <pig file>] [--beginner] [--json]`: lints the file's own fingering (PIG fingers or MusicXML editorial fingering), or a PIG prediction file aligned by note id; prints counts per rule and the issues; exit code 1 when there is any error-severity issue.
- `main.ts` dispatches `finger`, `lint`, `bench` and lists them in `USAGE` (the word `bench` must appear in the usage text because `scripts/verify.mjs` detects it).

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/eval/hardErrors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hardErrors } from './hardErrors.js';

describe('hardErrors', () => {
  it('counts mismatches only on unanimous notes', () => {
    const r = hardErrors(
      [1, 2, 3, 4],
      [
        [1, 2, 3, 5],
        [1, 2, 4, 5],
      ],
    );
    expect(r.unanimous).toBe(3); // notes 0, 1, 3
    expect(r.hardErrors).toBe(1); // note 3: all say 5, we say 4
    expect(r.rate).toBeCloseTo(1 / 3);
  });
  it('is zero with a single annotator or no unanimous notes', () => {
    expect(hardErrors([1, 2], [[1, 3]]).unanimous).toBe(0);
    expect(
      hardErrors(
        [1, 2],
        [
          [1, 3],
          [2, 2],
        ],
      ).rate,
    ).toBe(0);
  });
});
```

`packages/engine/cli/bench.test.ts` (synthetic gold set in a temp directory; the real PIG run is Task 11):

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBench } from './bench.js';

const H = '//Version: PianoFingering_v170101\n';
const scale = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const file = (fingers: number[]) =>
  H +
  scale
    .map((p, i) => `${i}\t${i * 0.5}\t${(i + 1) * 0.5}\t${p}\t80\t80\t0\t${fingers[i]}`)
    .join('\n') +
  '\n';

describe('runBench', () => {
  it('scores every piece in the split or reports it as skipped, writes a scorecard and galleries, and checks floors', () => {
    const root = mkdtempSync(join(tmpdir(), 'digitus2-bench-'));
    const gold = join(root, 'gold', 'FingeringFiles');
    mkdirSync(gold, { recursive: true });
    writeFileSync(join(gold, '001-1_fingering.txt'), file([1, 2, 3, 1, 2, 3, 4, 5]));
    writeFileSync(join(gold, '001-2_fingering.txt'), file([1, 2, 3, 1, 2, 3, 4, 5]));
    writeFileSync(join(gold, '002-1_fingering.txt'), file([1, 2, 3, 4, 1, 2, 3, 4]));
    writeFileSync(
      join(gold, '003-1_fingering.txt'),
      file([1, 2, 3, 4, 1, 2, 3, 4]).replace(/\n7\t.*\n$/, '\n'),
    ); // 7 notes
    writeFileSync(join(gold, '003-2_fingering.txt'), file([1, 2, 3, 4, 1, 2, 3, 4])); // 8 notes: mismatch -> skipped
    const split = join(root, 'split.json');
    writeFileSync(
      split,
      JSON.stringify({
        default_split: 'toy',
        splits: { toy: { test: { pieces: ['001', '002', '003', '004'] } } },
      }),
    );
    const floor = join(root, 'floor.json');
    writeFileSync(floor, JSON.stringify({ engine: { gen: 99, high: 0, soft: 0, rec: 0 } }));
    const out = join(root, 'runs');
    const { scorecard, floorBreaches, galleryDir } = runBench({
      gold: join(root, 'gold'),
      split,
      floor,
      out,
      label: 'toy',
      profile: 'large',
    });
    expect(scorecard.pieces.map((p) => p.id)).toEqual(['001', '002']);
    expect(scorecard.skipped.map((s) => s.id).sort()).toEqual(['003', '004']);
    expect(scorecard.pieces[0]!.gen).toBe(100);
    expect(scorecard.pieces[0]!.annotators).toBe(2);
    expect(scorecard.macro.gen).toBeCloseTo((100 + scorecard.pieces[1]!.gen) / 2);
    expect(floorBreaches.some((b) => b.includes('gen'))).toBe(true);
    expect(existsSync(join(out, `${scorecard.gitSha.slice(0, 7)}-toy.json`))).toBe(true);
    expect(existsSync(join(galleryDir, '002.md'))).toBe(true);
    expect(readFileSync(join(galleryDir, '002.md'), 'utf8')).toMatch(/\| *# *\|/);
    expect(scorecard.timing.totalMs).toBeGreaterThanOrEqual(0);
  });
});
```

(The gallery for piece 002 exists because the engine's scale fingering differs from the gold `1 2 3 4 1 2 3 4`; if the engine happens to match, make the second gold file more different, such as `5 4 3 2 1 2 3 4`.) Make `runBench` accept `galleryRoot` through `out`: galleries go to `<dirname(out)>/errors/<label>/`, so the test's `galleryDir` sits inside the temp root.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine exec vitest run src/eval/hardErrors cli/bench`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement hardErrors**

`packages/engine/src/eval/hardErrors.ts`:

```ts
import type { FingerSeq } from './metrics.js';

export function hardErrors(
  pred: FingerSeq,
  golds: FingerSeq[],
): { unanimous: number; hardErrors: number; rate: number } {
  let unanimous = 0;
  let errors = 0;
  if (golds.length >= 2) {
    for (let i = 0; i < pred.length; i++) {
      const first = golds[0]![i];
      if (first === undefined) continue;
      if (!golds.every((g) => g[i] === first)) continue;
      unanimous++;
      if (pred[i] !== first) errors++;
    }
  }
  return { unanimous, hardErrors: errors, rate: unanimous === 0 ? 0 : errors / unanimous };
}
```

Export it from `src/index.ts`.

- [ ] **Step 4: Implement the CLI commands**

`packages/engine/cli/bench.ts` (the shape below is complete; keep helper names):

```ts
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { hardErrors } from '../src/eval/hardErrors.js';
import { alignScores, fingerSeq, metricsForScores } from '../src/eval/align.js';
import { formatPigPitch } from '../src/score/pitch.js';
import { PARNCUTT_WEIGHTS } from '../src/fingering/rules.js';
import type { RuleId } from '../src/fingering/rules.js';
import { solveFingering } from '../src/fingering/solve.js';
import type { HandProfileId } from '../src/fingering/spans.js';
import { parsePig } from '../src/io/pig/read.js';
import { lintFingering } from '../src/lint/index.js';
import { ENGINE_VERSION } from '../src/version.js';

export interface BenchOptions {
  gold: string;
  split: string;
  splitName?: string;
  subset?: 'test' | 'train';
  floor?: string;
  out?: string;
  label?: string;
  profile?: HandProfileId;
  ablate?: boolean;
  limit?: number;
}
export interface PieceResult {
  id: string;
  notes: number;
  annotators: number;
  gen: number;
  high: number;
  soft: number;
  rec: number;
  hardErrorRate: number;
  lintErrors: number;
  lintWarnings: number;
  ms: number;
}
export interface Scorecard {
  version: 1;
  engineVersion: string;
  gitSha: string;
  label: string;
  timestamp: string;
  split: { file: string; name: string; subset: string };
  profile: string;
  weightsHash: string;
  macro: { gen: number; high: number; soft: number; rec: number; hardErrorRate: number };
  noteWeighted: { gen: number; high: number; soft: number; rec: number };
  lint: { errorsPer1000: number; warningsPer1000: number };
  timing: { totalMs: number; msPerPiece: number; msPer1000Notes: number };
  pieces: PieceResult[];
  skipped: Array<{ id: string; reason: string }>;
}

const METRICS = ['gen', 'high', 'soft', 'rec'] as const;

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

function goldDir(gold: string): string {
  return existsSync(join(gold, 'FingeringFiles')) ? join(gold, 'FingeringFiles') : gold;
}

function readSplit(
  file: string,
  name: string | undefined,
  subset: string,
): { name: string; pieces: string[] } {
  const json = JSON.parse(readFileSync(file, 'utf8')) as {
    default_split?: string;
    splits: Record<string, Record<string, { pieces: string[] }>>;
  };
  const n = name ?? json.default_split ?? Object.keys(json.splits)[0]!;
  const part = json.splits[n]?.[subset];
  if (!part) throw new Error(`split ${n}/${subset} not found in ${file}`);
  return { name: n, pieces: part.pieces };
}

export function scorePiece(
  id: string,
  dir: string,
  profile: HandProfileId,
  weights?: Partial<Record<RuleId, number>>,
): { result?: PieceResult; skipped?: string; gallery?: string } {
  const files = readdirSync(dir)
    .filter((f) => new RegExp(`^${id}-\\d+_fingering\\.txt$`).test(f))
    .sort();
  if (files.length === 0) return { skipped: 'no gold files' };
  const golds = files.map((f) => parsePig(readFileSync(join(dir, f), 'utf8')));
  const n = golds[0]!.score.notes.length;
  const bad = golds.find((g) => g.score.notes.length !== n);
  if (bad) return { skipped: `annotation note counts differ (${n} vs ${bad.score.notes.length})` };
  const score = golds[0]!.score;
  const t0 = performance.now();
  const { assignment, explanations } = solveFingering(
    score,
    weights ? { profile, weights } : { profile },
  );
  const ms = performance.now() - t0;
  const pred = { score, assignment };
  const m = metricsForScores(pred, golds);
  const predSeq = fingerSeq(score, assignment);
  const goldSeqs = golds.map((g) => {
    const pairs = alignScores(g.score, score);
    const map = new Map(pairs.map(([gid, sid]) => [sid, gid]));
    return score.notes.map((note) => g.assignment[map.get(note.id)!]?.finger);
  });
  const he = hardErrors(predSeq, goldSeqs);
  const lint = lintFingering(score, assignment, { profile });
  const result: PieceResult = {
    id,
    notes: n,
    annotators: golds.length,
    gen: 100 * m.gen,
    high: 100 * m.high,
    soft: 100 * m.soft,
    rec: 100 * m.rec,
    hardErrorRate: 100 * he.rate,
    lintErrors: lint.errors,
    lintWarnings: lint.warnings,
    ms,
  };
  // Gallery rows: every mismatch against the majority of annotators, hard errors first.
  const rows: string[] = [];
  score.notes.forEach((note, i) => {
    const ours = predSeq[i];
    const theirs = goldSeqs.map((g) => g[i]);
    if (theirs.every((f) => f === ours)) return;
    const hard =
      theirs.length >= 2 &&
      theirs.every((f) => f !== undefined && f === theirs[0]) &&
      theirs[0] !== ours;
    const a = assignment[note.id]!;
    const terms = [...(explanations[note.id]?.terms ?? [])]
      .sort((x, y) => Math.abs(y.weighted) - Math.abs(x.weighted))
      .slice(0, 2)
      .map((t) => `${t.rule} ${t.weighted.toFixed(1)}`)
      .join(', ');
    rows.push(
      `| ${i} | ${note.onsetSec.toFixed(2)} | ${note.hand} | ${formatPigPitch(note.spelling)} | ${ours ?? '-'} (${Math.round(100 * (a.confidence ?? 0))}%) ${terms} | ${theirs.map((f) => f ?? '-').join(' ')} | ${hard ? 'hard' : ''} |`,
    );
  });
  const gallery =
    rows.length === 0
      ? undefined
      : [
          `# Piece ${id}`,
          '',
          `gen ${result.gen.toFixed(2)} high ${result.high.toFixed(2)} soft ${result.soft.toFixed(2)} rec ${result.rec.toFixed(2)} hard-error ${result.hardErrorRate.toFixed(2)} notes ${n} annotators ${golds.length}`,
          '',
          '| # | onset s | hand | pitch | engine (confidence) top terms | annotators | hard |',
          '|---|---|---|---|---|---|---|',
          ...rows.sort((x, y) => Number(y.endsWith('hard |')) - Number(x.endsWith('hard |'))),
        ].join('\n') + '\n';
  return gallery ? { result, gallery } : { result };
}

export function runBench(opts: BenchOptions): {
  scorecard: Scorecard;
  floorBreaches: string[];
  galleryDir: string;
} {
  const subset = opts.subset ?? 'test';
  const split = readSplit(opts.split, opts.splitName, subset);
  const profile = opts.profile ?? 'large';
  const label = (opts.label ?? 'bench') + (opts.limit ? `-limit${opts.limit}` : '');
  const dir = goldDir(opts.gold);
  const out = opts.out ?? 'benchmarks/runs';
  const galleryDir = join(dirname(out), 'errors', label);
  mkdirSync(out, { recursive: true });
  mkdirSync(galleryDir, { recursive: true });
  const pieces: PieceResult[] = [];
  const skipped: Scorecard['skipped'] = [];
  const t0 = performance.now();
  for (const id of split.pieces.slice(0, opts.limit ?? split.pieces.length)) {
    const r = scorePiece(id, dir, profile);
    if (r.result) pieces.push(r.result);
    else skipped.push({ id, reason: r.skipped ?? 'unknown' });
    if (r.gallery) writeFileSync(join(galleryDir, `${id}.md`), r.gallery);
  }
  const totalMs = performance.now() - t0;
  const mean = (k: keyof PieceResult) =>
    pieces.length ? pieces.reduce((s, p) => s + (p[k] as number), 0) / pieces.length : 0;
  const notes = pieces.reduce((s, p) => s + p.notes, 0);
  const weighted = (k: keyof PieceResult) =>
    notes ? pieces.reduce((s, p) => s + (p[k] as number) * p.notes, 0) / notes : 0;
  const scorecard: Scorecard = {
    version: 1,
    engineVersion: ENGINE_VERSION,
    gitSha: gitSha(),
    label,
    timestamp: new Date().toISOString(),
    split: { file: opts.split, name: split.name, subset },
    profile,
    weightsHash: createHash('sha256')
      .update(JSON.stringify(PARNCUTT_WEIGHTS))
      .digest('hex')
      .slice(0, 16),
    macro: {
      gen: mean('gen'),
      high: mean('high'),
      soft: mean('soft'),
      rec: mean('rec'),
      hardErrorRate: mean('hardErrorRate'),
    },
    noteWeighted: {
      gen: weighted('gen'),
      high: weighted('high'),
      soft: weighted('soft'),
      rec: weighted('rec'),
    },
    lint: {
      errorsPer1000: notes ? (1000 * pieces.reduce((s, p) => s + p.lintErrors, 0)) / notes : 0,
      warningsPer1000: notes ? (1000 * pieces.reduce((s, p) => s + p.lintWarnings, 0)) / notes : 0,
    },
    timing: {
      totalMs,
      msPerPiece: pieces.length ? totalMs / pieces.length : 0,
      msPer1000Notes: notes ? (1000 * pieces.reduce((s, p) => s + p.ms, 0)) / notes : 0,
    },
    pieces,
    skipped,
  };
  writeFileSync(
    join(out, `${scorecard.gitSha.slice(0, 7)}-${label}.json`),
    JSON.stringify(scorecard, null, 2),
  );
  if (!opts.limit)
    writeFileSync(join(dirname(out), 'latest.json'), JSON.stringify(scorecard, null, 2));
  const floorBreaches: string[] = [];
  if (opts.floor && existsSync(opts.floor)) {
    const floor = JSON.parse(readFileSync(opts.floor, 'utf8')) as {
      engine: null | Record<string, number>;
    };
    if (floor.engine)
      for (const k of METRICS)
        if (scorecard.macro[k] < floor.engine[k]! - 0.005)
          floorBreaches.push(
            `${k} ${scorecard.macro[k].toFixed(2)} below floor ${floor.engine[k]!.toFixed(2)}`,
          );
  }
  return { scorecard, floorBreaches, galleryDir };
}

export function formatScorecard(
  card: Scorecard,
  previous?: Scorecard,
  floor?: { engine: null | Record<string, number> },
): string {
  const lines = [
    `bench ${card.label} @ ${card.gitSha.slice(0, 7)} engine ${card.engineVersion} profile ${card.profile} split ${card.split.name}/${card.split.subset}: ${card.pieces.length} pieces, ${card.skipped.length} skipped`,
  ];
  lines.push('metric   macro   delta   note-weighted   floor');
  for (const k of METRICS) {
    const d = previous ? (card.macro[k] - previous.macro[k]).toFixed(2).padStart(7) : '      -';
    const f = floor?.engine ? floor.engine[k]!.toFixed(2) : 'none';
    lines.push(
      `${k.padEnd(8)} ${card.macro[k].toFixed(2).padStart(6)} ${d}   ${card.noteWeighted[k].toFixed(2).padStart(13)}   ${f}`,
    );
  }
  lines.push(
    `hard-error rate ${card.macro.hardErrorRate.toFixed(2)}   lint errors/1000 ${card.lint.errorsPer1000.toFixed(2)}   warnings/1000 ${card.lint.warningsPer1000.toFixed(2)}   ms/1000 notes ${card.timing.msPer1000Notes.toFixed(1)}`,
  );
  for (const s of card.skipped) lines.push(`skipped ${s.id}: ${s.reason}`);
  return lines.join('\n');
}

export function runAblation(
  opts: BenchOptions,
): Array<{ rule: RuleId; gen: number; high: number; soft: number; rec: number }> {
  const subset = opts.subset ?? 'test';
  const split = readSplit(opts.split, opts.splitName, subset);
  const dir = goldDir(opts.gold);
  const profile = opts.profile ?? 'large';
  const ids = split.pieces.slice(0, opts.limit ?? split.pieces.length);
  const run = (weights?: Partial<Record<RuleId, number>>) => {
    const rs = ids
      .map((id) => scorePiece(id, dir, profile, weights).result)
      .filter((r): r is PieceResult => r !== undefined);
    const mean = (k: 'gen' | 'high' | 'soft' | 'rec') =>
      rs.reduce((s, p) => s + p[k], 0) / rs.length;
    return { gen: mean('gen'), high: mean('high'), soft: mean('soft'), rec: mean('rec') };
  };
  const base = run();
  const rows: Array<{ rule: RuleId; gen: number; high: number; soft: number; rec: number }> = [];
  for (const rule of Object.keys(PARNCUTT_WEIGHTS) as RuleId[]) {
    if (PARNCUTT_WEIGHTS[rule] === 0) continue;
    const r = run({ [rule]: 0 });
    rows.push({
      rule,
      gen: r.gen - base.gen,
      high: r.high - base.high,
      soft: r.soft - base.soft,
      rec: r.rec - base.rec,
    });
  }
  return rows.sort((a, b) => a.gen - b.gen);
}
```

`packages/engine/cli/finger.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { solveFingering } from '../src/fingering/solve.js';
import type { HandProfileId } from '../src/fingering/spans.js';
import { parseMusicXml } from '../src/io/musicxml/read.js';
import { injectFingerings } from '../src/io/musicxml/write.js';
import { parsePig } from '../src/io/pig/read.js';
import { writePig } from '../src/io/pig/write.js';
import type { Hand } from '../src/score/types.js';

export interface FingerOptions {
  file: string;
  out?: string;
  format?: 'pig' | 'musicxml';
  profile?: HandProfileId;
  hand?: 'R' | 'L' | 'both';
  editorial?: boolean;
}

export function fingerFile(o: FingerOptions): string {
  const isPig = /\.txt$/i.test(o.file);
  const hands: Hand[] = o.hand === 'R' ? ['R'] : o.hand === 'L' ? ['L'] : ['R', 'L'];
  const solveOpts = {
    hands,
    ...(o.profile ? { profile: o.profile } : {}),
    respectEditorial: o.editorial ?? false,
  };
  let text: string;
  if (isPig) {
    const { score, assignment: editorial } = parsePig(readFileSync(o.file, 'utf8'), {
      source: o.file,
    });
    const { assignment } = solveFingering(score, { ...solveOpts, pins: editorial });
    text =
      (o.format ?? 'pig') === 'pig'
        ? writePig(score, assignment)
        : (() => {
            throw new Error('musicxml output needs MusicXML input');
          })();
  } else {
    const bytes = readFileSync(o.file);
    const { score, editorial } = parseMusicXml(bytes, { source: o.file });
    const { assignment } = solveFingering(score, { ...solveOpts, pins: editorial });
    text =
      (o.format ?? 'musicxml') === 'pig'
        ? writePig(score, assignment)
        : injectFingerings(bytes, score, assignment);
  }
  if (o.out) writeFileSync(o.out, text);
  return text;
}
```

`packages/engine/cli/lint.ts`:

```ts
import { readFileSync } from 'node:fs';
import { lintFingering } from '../src/lint/index.js';
import type { LintReport } from '../src/lint/index.js';
import { parseMusicXml } from '../src/io/musicxml/read.js';
import { parsePig } from '../src/io/pig/read.js';
import type { Assignment, Score } from '../src/score/types.js';

export function lintFile(file: string, fingering?: string, beginner = false): LintReport {
  let score: Score;
  let assignment: Assignment;
  if (/\.txt$/i.test(file)) ({ score, assignment } = parsePig(readFileSync(file, 'utf8')));
  else {
    const r = parseMusicXml(readFileSync(file));
    score = r.score;
    assignment = r.editorial;
  }
  if (fingering) assignment = parsePig(readFileSync(fingering, 'utf8')).assignment;
  return lintFingering(score, assignment, { beginner });
}

export function formatLint(r: LintReport): string {
  const lines = [`${r.notes} notes: ${r.errors} errors, ${r.warnings} warnings, ${r.infos} infos`];
  for (const [rule, n] of Object.entries(r.counts)) lines.push(`${rule}: ${n}`);
  for (const i of r.issues)
    lines.push(`${i.severity.padEnd(7)} ${i.rule} ${i.hand} [${i.noteIds.join(',')}] ${i.message}`);
  return lines.join('\n');
}
```

Extend `cli/main.ts`: parse `finger`, `lint`, `bench` with `parseArgs` (`bench` options: `gold`, `split`, `split-name`, `subset`, `floor`, `out`, `label`, `profile`, `ablate` (boolean), `limit`); print `formatScorecard` with the previous `latest.json` (read before the run) and the floor; on `--ablate` print the ablation table and write `benchmarks/ablation-<label>.json`; exit 1 on floor breaches. Keep the existing `inspect` and `eval`. Add to USAGE:

```
  finger <file> [--out p] [--format pig|musicxml] [--profile child|small|medium|large] [--hand R|L|both] [--editorial]
  lint <file> [--fingering pig.txt] [--beginner] [--json]
  bench --gold <dir> --split <json> [--split-name n] [--subset test|train] [--floor f.json] [--out dir] [--label l] [--profile p] [--ablate] [--limit n]
```

Add `benchmarks/runs/` and `benchmarks/errors/` to `.gitignore` (keep `benchmarks/latest.json`, `benchmarks/floor.json`, `benchmarks/textbook/`, `benchmarks/history.md`).

- [ ] **Step 5: Run the tests and try the commands**

Run:

```bash
pnpm --filter @digitus2/engine exec vitest run src/eval/hardErrors cli/bench && pnpm --filter @digitus2/engine exec tsc --noEmit && pnpm lint && pnpm build
node packages/engine/dist/cli/main.js finger packages/engine/fixtures/two-staff.musicxml --format pig | head -5
node packages/engine/dist/cli/main.js lint packages/engine/fixtures/pig-sample.txt
node packages/engine/dist/cli/main.js bench --gold research/data/pig --split research/data/splits/pig_official.json --limit 3 --label smoke
```

Expected: tests pass; `finger` prints PIG lines with fingers; `lint` prints counts; `bench --limit 3` prints a scorecard for three pieces and writes a gallery (the real run is Task 11). Run from the repository root.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/eval/hardErrors.ts packages/engine/src/eval/hardErrors.test.ts packages/engine/cli packages/engine/src/index.ts .gitignore
git commit -m "feat(engine): finger, lint and bench commands with scorecards, error galleries, floors and ablation"
```

---

### Task 11: First real benchmark, floors, history, lab notebook

**Files:**

- Modify: `benchmarks/floor.json`, `docs/experiments.md`, `docs/PROGRESS.md`, `docs/superpowers/specs/2026-10-13-verification-design.md` (goals table: fill in the measured M2 numbers in a new "measured" column or a note under the table)
- Create: `benchmarks/history.md`, `benchmarks/latest.json` (written by the run)

- [ ] **Step 1: Run the official benchmark**

From the repository root (background it if it takes more than a minute):

```bash
pnpm build
node packages/engine/dist/cli/main.js bench --gold research/data/pig --split research/data/splits/pig_official.json --floor benchmarks/floor.json --label m2-rules --ablate
```

Record the printed scorecard and the ablation table. Expected: no floor breach because `engine` is null; 30 pieces scored, 0 skipped (if any piece is skipped, say why in the report).

- [ ] **Step 2: Run the textbook and metamorphic suites once more and read the numbers**

Run: `pnpm --filter @digitus2/engine exec vitest run src/eval` and copy the `textbook oracle:` line.

- [ ] **Step 3: Set the floors**

Edit `benchmarks/floor.json`: set `engine` to the measured macro `gen`, `high`, `soft`, `rec` each minus 0.5 (one decimal), and add `"textbook": { "scaleNoteAccuracy": <measured minus 0.01>, "noteAccuracy": <measured minus 0.01> }` and `"lint": { "errorsPer1000Max": 0 }` if the measured lint error rate is 0, otherwise the measured value with a dated note explaining why it is not 0 yet. Append a dated line to the `_comment` explaining that these are the M2 rule-based floors.

- [ ] **Step 4: History and lab notebook**

Create `benchmarks/history.md`:

```markdown
# Benchmark history

| Date       | Commit | Label    | gen | high | soft | rec | hard-error | lint err/1000 | ms/1000 notes | Notes                                                                                  |
| ---------- | ------ | -------- | --- | ---- | ---- | --- | ---------- | ------------- | ------------- | -------------------------------------------------------------------------------------- |
| YYYY-MM-DD | <sha7> | m2-rules | ..  | ..   | ..   | ..  | ..         | ..            | ..            | Parncutt + Jacobs + Balliauw rules, hand-position term, templates; literature defaults |
```

Append to `docs/experiments.md` a row for M2: hypothesis "exact rule-based Viterbi reaches at least the rule-based baselines (about 59) and approaches HMM3 (64.5)", the measured numbers, the three largest ablation effects, outcome.

- [ ] **Step 5: Verify and record**

Run: `pnpm verify` — the benchmark step must now run (not SKIP) and pass against the new floors. Update `docs/PROGRESS.md`: M2 row to `done` with the numbers; log entry. In the verification spec's goals table add a "Measured (M2)" note under the table with gen/high/soft/rec, hard-error rate, textbook accuracy, lint errors, ms per 1000 notes.

- [ ] **Step 6: Commit**

```bash
git add benchmarks/floor.json benchmarks/history.md benchmarks/latest.json docs/experiments.md docs/PROGRESS.md docs/superpowers/specs/2026-10-13-verification-design.md
git commit -m "bench: first rule-based scorecard, floors set, history started"
```

---

## Self-review notes

- Spec coverage: product spec 7.1 (events, configurations, exact DP, posteriors, k-best alternatives, pins, explanations) → Tasks 3, 4, 5 (alternatives come from min-sum marginals instead of k-best paths, which is sufficient for the UI's "alternatives" and cheaper; k-best paths can be added in M5 if needed); 7.2 (parameters in JSON, profiles) → Tasks 1, 2 (the `beginner` profile of the product spec is represented by lint's `beginner` flag and the `child`/`small` hand profiles; level-dependent weight sets are M3); 7.3 (rule set) → Task 2; verification spec 3.2 bench → Task 10, 3.3 galleries → Task 10, 3.4 metamorphic → Task 9, 3.5 lint → Task 6, 3.8 ablation → Task 10, 2.3 textbook → Tasks 7 and 8, 3.11 cross-implementation → Task 0, 4 iteration protocol → Task 11.
- Type consistency: `NoteView` (Task 2) is extended by `SeqNote` (Task 3) and consumed by `solveHand` and lint; `Term`/`RuleId` are shared by rules, solve explanations and ablation; `FingerSeq` from M1 feeds `hardErrors`; `TextbookEntry` is shared by Tasks 7 and 8.
- Review Focus items 1 to 5 are pinned in Tasks 5, 3, 5, 5/7 and 10 respectively.
- Known open numbers: the exact textbook accuracy before and after templates, the PIG scorecard, and the ablation effects are measured by Tasks 7, 8 and 11 and recorded in the repo; the plan sets no expectations it cannot justify.
