# M1 Engine Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the pnpm monorepo and the pure-TypeScript engine package with the score model, PIG and MusicXML readers and writers, the four PIG metrics, and a CLI, so that later milestones can add the solver and the app on a tested foundation.

**Architecture:** `packages/engine` is a dependency-free-at-runtime (except `@xmldom/xmldom` and `fflate`) TypeScript library with one responsibility per folder: `score` (model and helpers), `io/pig`, `io/musicxml`, `eval`, and `cli`. Every reader produces the same `Score` shape; every writer takes a `Score` plus an optional `Assignment`. No DOM globals are used so the same code runs in Node, vitest and the browser.

**Tech Stack:** pnpm workspaces, TypeScript 5 (strict, ESM, `moduleResolution: bundler`), vitest, eslint 9 flat config with typescript-eslint, prettier, `@xmldom/xmldom` for XML DOM in both Node and browser, `fflate` for `.mxl` zip reading, `tsx` for running TypeScript scripts, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-13-digitus2-design.md` (sections 4, 5, 6, 8.1, 11).

## Global Constraints

- Engine code never touches `window`, `document`, `DOMParser` or Node-only APIs outside `cli/` (spec 4: "pure TypeScript library with no DOM dependency so it runs in the browser, in Node").
- TypeScript strict mode, ESM only, Node 22.
- MIDI pitch range 21..108 (spec 5: `midi: number; // 21..108`); out-of-range pitches are an error in readers.
- `Note.id` is stable within a Score and survives round trips (spec 5).
- Ties are merged into one sounding note; grace notes are kept and flagged (spec 5).
- Hand from staff: staff 1 right, staff 2 left; MusicXML cross-staff notes honored (spec 5).
- PIG format exact, including substitution syntax and negative left-hand finger numbers (spec 6).
- Linear git history on `main`; commit after every task with explicit paths; the coordinator commits (`CLAUDE.md`).
- Windows host: use forward slashes; long files via the Write tool, not heredocs (`CLAUDE.md`).

## Review Focus

1. A MusicXML file whose `<divisions>` changes between measures must still produce correct onset ticks for every note; a reader that assumes one global divisions value silently misplaces every note after the change. Pinned by Task 6 (`divisions change` test).
2. A piano part written with one `<part>` and `<staves>2</staves>` where a note in staff 1 is written cross-staff with `<staff>2</staff>` must land in the left hand; a reader keyed on the measure or voice instead of the note's own `<staff>` assigns the wrong hand. Pinned by Task 6 (`cross-staff note` test).
3. Tied notes that cross a barline (tie `start` in measure 1, `stop` in measure 2) must become one sounding note whose offset is the end of the second note; a reader that merges only within a measure double-counts the note. Pinned by Task 6 (`tie across barline` test).
4. A `.mxl` upload whose container points to a rootfile in a subfolder, or a plain `.xml` that is actually timewise, must still parse; a reader that only handles the happy path turns a user's upload into an opaque error. Pinned by Task 5 (`timewise`) and Task 7 (`mxl rootfile in subfolder`).
5. A PIG line with a substitution such as `-3_-1` or with Windows line endings must round-trip without changing fingers or hands; a parser that splits on `\n` only or ignores the second finger corrupts the ground truth used for every benchmark. Pinned by Task 4 (`substitution` and `CRLF` tests).

## File Structure

```
package.json                      workspace root: scripts test/lint/typecheck/build, devDependencies
pnpm-workspace.yaml               packages: apps/*, packages/*
tsconfig.base.json                shared strict compiler options
eslint.config.js                  flat config: typescript-eslint recommended
.prettierrc                       single quotes, no semicolons? -> keep defaults: semi true, singleQuote true, printWidth 100
.github/workflows/ci.yml          install, typecheck, lint, test
packages/engine/package.json      @digitus2/engine, type module, exports ./src/index.ts via build to dist
packages/engine/tsconfig.json     extends base; rootDir src+cli; outDir dist
packages/engine/vitest.config.ts  include src/**/*.test.ts and cli/**/*.test.ts
packages/engine/src/index.ts      public API re-exports
packages/engine/src/score/pitch.ts        spelling<->midi, black keys, PIG pitch strings
packages/engine/src/score/types.ts        Score, Note, Assignment, TempoEvent, ...
packages/engine/src/score/build.ts        sortNotes, assignChordIds, handEvents, ticksToSeconds, validateScore
packages/engine/src/io/pig/read.ts        parsePig(text) -> { score, assignment }
packages/engine/src/io/pig/write.ts       writePig(score, assignment?) -> string
packages/engine/src/io/musicxml/unpack.ts unpackMusicXml(bytes|string) -> xml string (.mxl aware)
packages/engine/src/io/musicxml/dom.ts    parseXml(text) -> Document, serializeXml(doc) -> string (xmldom)
packages/engine/src/io/musicxml/timewise.ts timewiseToPartwise(doc) -> Document
packages/engine/src/io/musicxml/read.ts   parseMusicXml(input) -> { score, editorial }
packages/engine/src/io/musicxml/write.ts  injectFingerings(xmlText, score, assignment, opts) -> string
packages/engine/src/eval/metrics.ts       matchRate, pigMetrics
packages/engine/src/eval/align.ts         alignByNoteOrder(predScore, goldScore) -> index pairs
packages/engine/cli/main.ts               argv dispatch: inspect, eval
packages/engine/cli/inspect.ts            summary of a score file
packages/engine/cli/evaluate.ts           PIG directory evaluation
packages/engine/fixtures/*.musicxml, *.txt  test fixtures
```

Test files sit next to the code as `*.test.ts`.

---

### Task 1: Monorepo scaffold, engine package, CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.github/workflows/ci.yml`
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/vitest.config.ts`, `packages/engine/src/index.ts`, `packages/engine/src/version.ts`, `packages/engine/src/version.test.ts`

**Interfaces:**
- Produces: workspace scripts `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`; package name `@digitus2/engine`; `ENGINE_VERSION` constant.

- [ ] **Step 1: Write the root workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

`package.json`:
```json
{
  "name": "digitus2-monorepo",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.0.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck",
    "lint": "eslint .",
    "format": "prettier --write .",
    "build": "pnpm -r --if-present build"
  },
  "devDependencies": {
    "@eslint/js": "^9.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0",
    "typescript": "^5.6.0",
    "typescript-eslint": "^8.0.0",
    "vitest": "^3.0.0"
  }
}
```
(After `pnpm install`, replace `"packageManager"` with the exact installed pnpm version printed by `pnpm --version`.)

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`eslint.config.js`:
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'research/**', 'content/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
```

`.prettierrc`:
```json
{ "singleQuote": true, "printWidth": 100, "trailingComma": "all" }
```

`.github/workflows/ci.yml`:
```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 2: Write the engine package files**

`packages/engine/package.json`:
```json
{
  "name": "@digitus2/engine",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/src/index.js",
  "types": "./dist/src/index.d.ts",
  "exports": { ".": { "types": "./dist/src/index.d.ts", "import": "./dist/src/index.js" } },
  "bin": { "digitus2": "./dist/cli/main.js" },
  "files": ["dist"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "build": "tsc"
  },
  "dependencies": {
    "@xmldom/xmldom": "^0.9.0",
    "fflate": "^0.8.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0"
  }
}
```

`packages/engine/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": ".", "types": ["node"] },
  "include": ["src", "cli"],
  "exclude": ["**/*.test.ts", "dist"]
}
```
Add `@types/node` to the engine devDependencies so `types: ["node"]` resolves (`pnpm add -D @types/node --filter @digitus2/engine`).

`packages/engine/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'cli/**/*.test.ts'] },
});
```

`packages/engine/src/version.ts`:
```ts
export const ENGINE_VERSION = '0.1.0';
```

`packages/engine/src/index.ts`:
```ts
export { ENGINE_VERSION } from './version.js';
```

- [ ] **Step 3: Write the first failing test**

`packages/engine/src/version.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from './index.js';

describe('engine package', () => {
  it('exposes a semver version', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 4: Install and run**

Run from the repo root (in the background if it exceeds a minute):
```bash
pnpm install
pnpm add -D @types/node --filter @digitus2/engine
pnpm typecheck && pnpm lint && pnpm test
```
Expected: install succeeds, typecheck clean, lint clean, 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json eslint.config.js .prettierrc .github/workflows/ci.yml packages/engine
git commit -m "feat: monorepo scaffold with engine package and CI"
```

---

### Task 2: Pitch utilities

**Files:**
- Create: `packages/engine/src/score/pitch.ts`, `packages/engine/src/score/pitch.test.ts`

**Interfaces:**
- Produces:
  - `type Step = 'A'|'B'|'C'|'D'|'E'|'F'|'G'`
  - `interface Spelling { step: Step; alter: -2|-1|0|1|2; octave: number }`
  - `spellingToMidi(s: Spelling): number` (C4 = 60)
  - `midiToSpelling(midi: number, prefer?: 'sharp'|'flat'): Spelling`
  - `isBlackKey(midi: number): boolean`
  - `parsePigPitch(text: string): Spelling` accepting `C4`, `C#4`, `Db4`, `B#3`, `Cb4`, `C##4`, `Dbb4`
  - `formatPigPitch(s: Spelling): string` producing `C#4`, `Db4`, `C4`
  - `PIANO_MIN = 21`, `PIANO_MAX = 108`

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/score/pitch.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  formatPigPitch,
  isBlackKey,
  midiToSpelling,
  parsePigPitch,
  spellingToMidi,
} from './pitch.js';

describe('spellingToMidi', () => {
  it('maps middle C and the piano extremes', () => {
    expect(spellingToMidi({ step: 'C', alter: 0, octave: 4 })).toBe(60);
    expect(spellingToMidi({ step: 'A', alter: 0, octave: 0 })).toBe(21);
    expect(spellingToMidi({ step: 'C', alter: 0, octave: 8 })).toBe(108);
  });
  it('handles enharmonics across the octave boundary', () => {
    expect(spellingToMidi({ step: 'B', alter: 1, octave: 3 })).toBe(60);
    expect(spellingToMidi({ step: 'C', alter: -1, octave: 4 })).toBe(59);
    expect(spellingToMidi({ step: 'F', alter: 2, octave: 4 })).toBe(67);
  });
});

describe('midiToSpelling', () => {
  it('prefers sharps by default and flats on request', () => {
    expect(midiToSpelling(61)).toEqual({ step: 'C', alter: 1, octave: 4 });
    expect(midiToSpelling(61, 'flat')).toEqual({ step: 'D', alter: -1, octave: 4 });
    expect(midiToSpelling(60)).toEqual({ step: 'C', alter: 0, octave: 4 });
  });
});

describe('isBlackKey', () => {
  it('matches the five black keys per octave', () => {
    const blacks = [61, 63, 66, 68, 70];
    for (let m = 60; m < 72; m++) expect(isBlackKey(m)).toBe(blacks.includes(m));
  });
});

describe('PIG pitch strings', () => {
  it('parses sharps, flats, doubles and naturals', () => {
    expect(parsePigPitch('C4')).toEqual({ step: 'C', alter: 0, octave: 4 });
    expect(parsePigPitch('C#4')).toEqual({ step: 'C', alter: 1, octave: 4 });
    expect(parsePigPitch('Db4')).toEqual({ step: 'D', alter: -1, octave: 4 });
    expect(parsePigPitch('C##4')).toEqual({ step: 'C', alter: 2, octave: 4 });
    expect(parsePigPitch('Dbb4')).toEqual({ step: 'D', alter: -2, octave: 4 });
    expect(parsePigPitch('B#3')).toEqual({ step: 'B', alter: 1, octave: 3 });
  });
  it('rejects garbage', () => {
    expect(() => parsePigPitch('H4')).toThrow();
    expect(() => parsePigPitch('C')).toThrow();
  });
  it('formats back to the same text', () => {
    for (const t of ['C4', 'C#4', 'Db4', 'C##4', 'Dbb4', 'A0', 'C8']) {
      expect(formatPigPitch(parsePigPitch(t))).toBe(t);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine test -- pitch`
Expected: FAIL, module `./pitch.js` not found.

- [ ] **Step 3: Implement**

`packages/engine/src/score/pitch.ts`:
```ts
export type Step = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export type Alter = -2 | -1 | 0 | 1 | 2;
export interface Spelling {
  step: Step;
  alter: Alter;
  octave: number;
}

export const PIANO_MIN = 21;
export const PIANO_MAX = 108;

const STEP_SEMITONE: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES: ReadonlyArray<[Step, Alter]> = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
  ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];
const FLAT_NAMES: ReadonlyArray<[Step, Alter]> = [
  ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0],
  ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
];
const BLACK = new Set([1, 3, 6, 8, 10]);

export function spellingToMidi(s: Spelling): number {
  return (s.octave + 1) * 12 + STEP_SEMITONE[s.step] + s.alter;
}

export function midiToSpelling(midi: number, prefer: 'sharp' | 'flat' = 'sharp'): Spelling {
  if (!Number.isInteger(midi)) throw new Error(`midi must be an integer, got ${midi}`);
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const [step, alter] = (prefer === 'flat' ? FLAT_NAMES : SHARP_NAMES)[pc]!;
  return { step, alter, octave };
}

export function isBlackKey(midi: number): boolean {
  return BLACK.has(((midi % 12) + 12) % 12);
}

const PIG_PITCH = /^([A-G])(#{1,2}|b{1,2})?(-?\d+)$/;

export function parsePigPitch(text: string): Spelling {
  const m = PIG_PITCH.exec(text.trim());
  if (!m) throw new Error(`invalid pitch string: ${JSON.stringify(text)}`);
  const step = m[1] as Step;
  const acc = m[2] ?? '';
  const alter = (acc.startsWith('#') ? acc.length : -acc.length) as Alter;
  return { step, alter, octave: Number(m[3]) };
}

export function formatPigPitch(s: Spelling): string {
  const acc = s.alter > 0 ? '#'.repeat(s.alter) : 'b'.repeat(-s.alter);
  return `${s.step}${acc}${s.octave}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @digitus2/engine test -- pitch`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/score/pitch.ts packages/engine/src/score/pitch.test.ts
git commit -m "feat(engine): pitch spelling, midi and PIG pitch string utilities"
```

---

### Task 3: Score types and builders

**Files:**
- Create: `packages/engine/src/score/types.ts`, `packages/engine/src/score/build.ts`, `packages/engine/src/score/build.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: `Spelling`, `spellingToMidi`, `PIANO_MIN`, `PIANO_MAX` from Task 2.
- Produces (exact):

```ts
export type Hand = 'L' | 'R';
export type Finger = 1 | 2 | 3 | 4 | 5;
export interface TempoEvent { tick: number; qpm: number }          // quarter notes per minute from tick on
export interface TimeSigEvent { tick: number; beats: number; beatType: number }
export interface KeySigEvent { tick: number; fifths: number; mode?: 'major' | 'minor' }
export interface MeasureInfo { index: number; startTick: number; lengthTicks: number; number: string }
export interface Note {
  id: string; onsetTick: number; offsetTick: number; onsetSec: number; offsetSec: number;
  midi: number; spelling: Spelling; hand: Hand; staff: number; voice: number; measureIndex: number;
  isGrace: boolean; chordId: string; sourceIndices: number[]; velocity?: number;   // velocity: MIDI 0..127 when known
}
export interface Score {
  meta: { title?: string; composer?: string; source?: string };
  divisions: number; tempoMap: TempoEvent[]; timeSignatures: TimeSigEvent[]; keySignatures: KeySigEvent[];
  measures: MeasureInfo[]; notes: Note[];
}
export interface FingerAssignment {
  finger: Finger; substitution?: Finger; confidence?: number;
  alternatives?: Array<{ finger: Finger; cost: number }>; pinned?: boolean;
  source: 'engine' | 'user' | 'editorial';
}
export type Assignment = Record<string, FingerAssignment>;
export interface HandEvent { onsetTick: number; notes: Note[] }      // notes sorted by midi ascending

export function sortNotes(notes: Note[]): Note[]                      // by onsetTick, then hand (R before L), then midi
export function assignChordIds(notes: Note[]): void                   // chordId = `${hand}@${onsetTick}`
export function handEvents(score: Score, hand: Hand): HandEvent[]
export function ticksToSeconds(tempoMap: TempoEvent[], divisions: number, tick: number): number
export function finalizeScore(partial: Omit<Score, 'notes'> & { notes: Note[] }): Score   // sorts, assigns chord ids, fills onsetSec/offsetSec, validates
export function validateScore(score: Score): string[]                 // list of problems; empty when valid
```
`sourceIndices` replaces the spec's `tiedFrom`: it holds the document-order indices of the source elements (XML `<note>` elements or PIG lines) merged into this sounding note; the first entry is the tie start.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/score/build.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { assignChordIds, finalizeScore, handEvents, sortNotes, ticksToSeconds, validateScore } from './build.js';
import type { Note, Score } from './types.js';

function note(p: Partial<Note> & { id: string; midi: number; onsetTick: number }): Note {
  return {
    offsetTick: p.onsetTick + 480, onsetSec: 0, offsetSec: 0,
    spelling: { step: 'C', alter: 0, octave: 4 }, hand: 'R', staff: 1, voice: 1,
    measureIndex: 0, isGrace: false, chordId: '', sourceIndices: [], ...p,
  };
}

const base: Omit<Score, 'notes'> = {
  meta: {}, divisions: 480, tempoMap: [{ tick: 0, qpm: 120 }], timeSignatures: [], keySignatures: [],
  measures: [{ index: 0, startTick: 0, lengthTicks: 1920, number: '1' }],
};

describe('ticksToSeconds', () => {
  it('uses a single tempo', () => {
    expect(ticksToSeconds([{ tick: 0, qpm: 120 }], 480, 480)).toBeCloseTo(0.5);
    expect(ticksToSeconds([{ tick: 0, qpm: 60 }], 480, 960)).toBeCloseTo(2);
  });
  it('integrates across tempo changes', () => {
    const map = [{ tick: 0, qpm: 120 }, { tick: 960, qpm: 60 }];
    expect(ticksToSeconds(map, 480, 960)).toBeCloseTo(1);
    expect(ticksToSeconds(map, 480, 1440)).toBeCloseTo(2);
  });
  it('falls back to 120 qpm when the map is empty', () => {
    expect(ticksToSeconds([], 480, 480)).toBeCloseTo(0.5);
  });
});

describe('sortNotes and assignChordIds', () => {
  it('orders by onset, right hand first, then pitch, and groups chords', () => {
    const notes = [
      note({ id: 'a', midi: 64, onsetTick: 0 }),
      note({ id: 'b', midi: 60, onsetTick: 0 }),
      note({ id: 'c', midi: 48, onsetTick: 0, hand: 'L', staff: 2 }),
      note({ id: 'd', midi: 62, onsetTick: 480 }),
    ];
    const sorted = sortNotes(notes);
    expect(sorted.map((n) => n.id)).toEqual(['b', 'a', 'c', 'd']);
    assignChordIds(sorted);
    expect(sorted[0]!.chordId).toBe('R@0');
    expect(sorted[1]!.chordId).toBe('R@0');
    expect(sorted[2]!.chordId).toBe('L@0');
    expect(sorted[3]!.chordId).toBe('R@480');
  });
});

describe('finalizeScore and handEvents', () => {
  it('fills seconds, groups events per hand', () => {
    const score = finalizeScore({
      ...base,
      notes: [
        note({ id: 'a', midi: 64, onsetTick: 0 }),
        note({ id: 'b', midi: 60, onsetTick: 0 }),
        note({ id: 'c', midi: 48, onsetTick: 0, hand: 'L', staff: 2 }),
        note({ id: 'd', midi: 62, onsetTick: 480 }),
      ],
    });
    expect(score.notes.find((n) => n.id === 'd')!.onsetSec).toBeCloseTo(0.5);
    const right = handEvents(score, 'R');
    expect(right).toHaveLength(2);
    expect(right[0]!.notes.map((n) => n.midi)).toEqual([60, 64]);
    expect(handEvents(score, 'L')).toHaveLength(1);
  });
  it('rejects pitches outside the piano and duplicate ids', () => {
    const bad = finalizeScore({ ...base, notes: [note({ id: 'a', midi: 20, onsetTick: 0 }), note({ id: 'a', midi: 60, onsetTick: 0 })] });
    const problems = validateScore(bad);
    expect(problems.some((p) => p.includes('midi'))).toBe(true);
    expect(problems.some((p) => p.includes('duplicate'))).toBe(true);
  });
  it('rejects offsets before onsets for non-grace notes', () => {
    const bad = finalizeScore({ ...base, notes: [note({ id: 'a', midi: 60, onsetTick: 480, offsetTick: 240 })] });
    expect(validateScore(bad).some((p) => p.includes('offset'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine test -- build`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement types and builders**

`packages/engine/src/score/types.ts`:
```ts
import type { Spelling } from './pitch.js';

export type Hand = 'L' | 'R';
export type Finger = 1 | 2 | 3 | 4 | 5;

export interface TempoEvent { tick: number; qpm: number }
export interface TimeSigEvent { tick: number; beats: number; beatType: number }
export interface KeySigEvent { tick: number; fifths: number; mode?: 'major' | 'minor' }
export interface MeasureInfo { index: number; startTick: number; lengthTicks: number; number: string }

export interface Note {
  id: string;
  onsetTick: number;
  offsetTick: number;
  onsetSec: number;
  offsetSec: number;
  midi: number;
  spelling: Spelling;
  hand: Hand;
  staff: number;
  voice: number;
  measureIndex: number;
  isGrace: boolean;
  chordId: string;
  /** Document-order indices of the source elements merged into this sounding note (tie start first). */
  sourceIndices: number[];
  /** MIDI velocity 0..127 when the source carries one (PIG, MIDI). */
  velocity?: number;
}

export interface Score {
  meta: { title?: string; composer?: string; source?: string };
  divisions: number;
  tempoMap: TempoEvent[];
  timeSignatures: TimeSigEvent[];
  keySignatures: KeySigEvent[];
  measures: MeasureInfo[];
  notes: Note[];
}

export interface FingerAssignment {
  finger: Finger;
  substitution?: Finger;
  confidence?: number;
  alternatives?: Array<{ finger: Finger; cost: number }>;
  pinned?: boolean;
  source: 'engine' | 'user' | 'editorial';
}
export type Assignment = Record<string, FingerAssignment>;

export interface HandEvent { onsetTick: number; notes: Note[] }
```

`packages/engine/src/score/build.ts`:
```ts
import { PIANO_MAX, PIANO_MIN } from './pitch.js';
import type { Hand, HandEvent, Note, Score, TempoEvent } from './types.js';

const DEFAULT_QPM = 120;

export function ticksToSeconds(tempoMap: TempoEvent[], divisions: number, tick: number): number {
  const map = tempoMap.length > 0 ? [...tempoMap].sort((a, b) => a.tick - b.tick) : [{ tick: 0, qpm: DEFAULT_QPM }];
  let seconds = 0;
  let cursor = 0;
  let qpm = map[0]!.tick <= 0 ? map[0]!.qpm : DEFAULT_QPM;
  for (const ev of map) {
    if (ev.tick >= tick) break;
    if (ev.tick > cursor) {
      seconds += ((ev.tick - cursor) / divisions) * (60 / qpm);
      cursor = ev.tick;
    }
    qpm = ev.qpm;
  }
  seconds += ((tick - cursor) / divisions) * (60 / qpm);
  return seconds;
}

export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort(
    (a, b) => a.onsetTick - b.onsetTick || handRank(a.hand) - handRank(b.hand) || a.midi - b.midi || a.id.localeCompare(b.id),
  );
}

function handRank(h: Hand): number {
  return h === 'R' ? 0 : 1;
}

export function assignChordIds(notes: Note[]): void {
  for (const n of notes) n.chordId = `${n.hand}@${n.onsetTick}`;
}

export function handEvents(score: Score, hand: Hand): HandEvent[] {
  const events: HandEvent[] = [];
  let current: HandEvent | undefined;
  for (const n of score.notes) {
    if (n.hand !== hand) continue;
    if (!current || current.onsetTick !== n.onsetTick) {
      current = { onsetTick: n.onsetTick, notes: [] };
      events.push(current);
    }
    current.notes.push(n);
  }
  for (const e of events) e.notes.sort((a, b) => a.midi - b.midi);
  return events;
}

export function finalizeScore(partial: Omit<Score, 'notes'> & { notes: Note[] }): Score {
  const notes = sortNotes(partial.notes);
  assignChordIds(notes);
  for (const n of notes) {
    n.onsetSec = ticksToSeconds(partial.tempoMap, partial.divisions, n.onsetTick);
    n.offsetSec = ticksToSeconds(partial.tempoMap, partial.divisions, n.offsetTick);
  }
  return { ...partial, notes };
}

export function validateScore(score: Score): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  if (!(score.divisions > 0)) problems.push(`divisions must be positive, got ${score.divisions}`);
  for (const n of score.notes) {
    if (seen.has(n.id)) problems.push(`duplicate note id ${n.id}`);
    seen.add(n.id);
    if (n.midi < PIANO_MIN || n.midi > PIANO_MAX) problems.push(`note ${n.id}: midi ${n.midi} outside piano range`);
    if (!n.isGrace && n.offsetTick < n.onsetTick) problems.push(`note ${n.id}: offset ${n.offsetTick} before onset ${n.onsetTick}`);
  }
  return problems;
}
```

Update `packages/engine/src/index.ts`:
```ts
export { ENGINE_VERSION } from './version.js';
export * from './score/types.js';
export * from './score/pitch.js';
export * from './score/build.js';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @digitus2/engine test -- build && pnpm typecheck`
Expected: all pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/score packages/engine/src/index.ts
git commit -m "feat(engine): score model types, sorting, chord grouping, tempo map timing"
```

---

### Task 4: PIG reader and writer

**Files:**
- Create: `packages/engine/src/io/pig/read.ts`, `packages/engine/src/io/pig/write.ts`, `packages/engine/src/io/pig/pig.test.ts`, `packages/engine/fixtures/pig-sample.txt`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: `parsePigPitch`, `formatPigPitch`, `spellingToMidi` (Task 2); `Note`, `Score`, `Assignment`, `Finger`, `finalizeScore`, `validateScore` (Task 3).
- Produces:
  - `parsePig(text: string, opts?: { source?: string }): { score: Score; assignment: Assignment; warnings: string[] }`
  - `writePig(score: Score, assignment?: Assignment): string`
  - `parseFingerField(text: string, hand: Hand): { finger?: Finger; substitution?: Finger; warning?: string }`
  - `PIG_HEADER = '//Version: PianoFingering_v170101'`
  - `PIG_DIVISIONS = 480` and `PIG_QPM = 120` (PIG carries seconds only; ticks are derived at 120 qpm so 1 second = 960 ticks)

PIG format (Nakamura, Saito, Yoshii 2020): one header line starting with `//`, then one note per line, tab separated: `note_id onset_sec offset_sec spelled_pitch onset_velocity offset_velocity channel finger`. Channel 0 is the right hand, 1 the left hand. Finger is `1`..`5` for the right hand and `-1`..`-5` for the left; a substitution is written `a_b` (first finger, then the finger that silently replaces it), for example `3_1` or `-3_-1`. If a real PIG file is available at `research/data/pig/` (another agent downloads it), open one and match its header text and decimal formatting exactly; the tests below check parsed values, not text.

- [ ] **Step 1: Write the fixture and the failing tests**

`packages/engine/fixtures/pig-sample.txt` (tab separated; the editor must keep real tabs):
```
//Version: PianoFingering_v170101
0	0.000000	0.500000	C4	80	80	0	1
1	0.500000	1.000000	D4	80	80	0	2
2	1.000000	1.500000	E4	80	80	0	3_1
3	0.000000	1.000000	C3	80	80	1	-5
4	0.000000	1.000000	E3	80	80	1	-3
5	1.000000	2.000000	G2	80	80	1	-5_-4
```

`packages/engine/src/io/pig/pig.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFingerField, parsePig } from './read.js';
import { writePig } from './write.js';

const fixture = readFileSync(fileURLToPath(new URL('../../../fixtures/pig-sample.txt', import.meta.url)), 'utf8');

describe('parsePig', () => {
  it('reads notes, hands, fingers and substitutions', () => {
    const { score, assignment, warnings } = parsePig(fixture);
    expect(warnings).toEqual([]);
    expect(score.notes).toHaveLength(6);
    const byId = Object.fromEntries(score.notes.map((n) => [n.id, n]));
    expect(byId['0']!.midi).toBe(60);
    expect(byId['0']!.hand).toBe('R');
    expect(byId['3']!.hand).toBe('L');
    expect(byId['3']!.onsetSec).toBe(0);
    expect(byId['3']!.offsetSec).toBe(1);
    expect(byId['1']!.onsetTick).toBe(480);
    expect(byId['0']!.velocity).toBe(80);
    expect(assignment['0']).toEqual({ finger: 1, source: 'editorial' });
    expect(assignment['2']).toEqual({ finger: 3, substitution: 1, source: 'editorial' });
    expect(assignment['3']).toEqual({ finger: 5, source: 'editorial' });
    expect(assignment['5']).toEqual({ finger: 5, substitution: 4, source: 'editorial' });
  });
  it('groups simultaneous notes of one hand into a chord', () => {
    const { score } = parsePig(fixture);
    const c3 = score.notes.find((n) => n.id === '3')!;
    const e3 = score.notes.find((n) => n.id === '4')!;
    expect(c3.chordId).toBe(e3.chordId);
  });
  it('accepts CRLF line endings and spaces instead of tabs', () => {
    const text = fixture.replace(/\n/g, '\r\n').replace(/\t/g, '  ');
    expect(parsePig(text).score.notes).toHaveLength(6);
  });
  it('warns when the finger sign disagrees with the channel and keeps the channel', () => {
    const text = `${fixture.split('\n')[0]}\n0\t0\t0.5\tC4\t80\t80\t0\t-2\n`;
    const { score, assignment, warnings } = parsePig(text);
    expect(score.notes[0]!.hand).toBe('R');
    expect(assignment['0']!.finger).toBe(2);
    expect(warnings).toHaveLength(1);
  });
  it('leaves notes without a usable finger unassigned', () => {
    const text = `${fixture.split('\n')[0]}\n0\t0\t0.5\tC4\t80\t80\t0\t0\n`;
    const { assignment } = parsePig(text);
    expect(assignment['0']).toBeUndefined();
  });
  it('rejects malformed lines with the line number', () => {
    expect(() => parsePig('//h\n0\t0\t0.5\tC4\n')).toThrow(/line 2/);
  });
});

describe('parseFingerField', () => {
  it('parses plain, negative and substitution fields', () => {
    expect(parseFingerField('3', 'R')).toEqual({ finger: 3 });
    expect(parseFingerField('-3', 'L')).toEqual({ finger: 3 });
    expect(parseFingerField('3_1', 'R')).toEqual({ finger: 3, substitution: 1 });
    expect(parseFingerField('-5_-4', 'L')).toEqual({ finger: 5, substitution: 4 });
  });
});

describe('writePig', () => {
  it('round-trips the fixture', () => {
    const first = parsePig(fixture);
    const text = writePig(first.score, first.assignment);
    const second = parsePig(text);
    expect(second.score.notes.map((n) => [n.id, n.midi, n.hand, n.onsetSec, n.offsetSec, n.velocity]))
      .toEqual(first.score.notes.map((n) => [n.id, n.midi, n.hand, n.onsetSec, n.offsetSec, n.velocity]));
    expect(second.assignment).toEqual(first.assignment);
    expect(text.startsWith('//Version: PianoFingering_v170101\n')).toBe(true);
    expect(text.split('\n')[3]).toMatch(/^2\t1(\.0+)?\t1\.5(0+)?\tE4\t80\t80\t0\t3_1$/);
  });
  it('writes left-hand fingers negative and unassigned notes as 0', () => {
    const { score } = parsePig(fixture);
    const text = writePig(score, { '3': { finger: 2, source: 'engine' } });
    const lines = text.trim().split('\n');
    expect(lines[4]!.endsWith('\t1\t-2')).toBe(true);
    expect(lines[1]!.endsWith('\t0\t0')).toBe(true);
  });
  it('keeps the original line order', () => {
    const { score, assignment } = parsePig(fixture);
    const ids = writePig(score, assignment).trim().split('\n').slice(1).map((l) => l.split('\t')[0]);
    expect(ids).toEqual(['0', '1', '2', '3', '4', '5']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine test -- pig`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the reader**

`packages/engine/src/io/pig/read.ts`:
```ts
import { finalizeScore, validateScore } from '../../score/build.js';
import { parsePigPitch, spellingToMidi } from '../../score/pitch.js';
import type { Assignment, Finger, Hand, Note, Score } from '../../score/types.js';

export const PIG_HEADER = '//Version: PianoFingering_v170101';
export const PIG_DIVISIONS = 480;
export const PIG_QPM = 120;
const TICKS_PER_SECOND = (PIG_DIVISIONS * PIG_QPM) / 60; // 960

export interface ParsedPig {
  score: Score;
  assignment: Assignment;
  warnings: string[];
}

export function parseFingerField(
  text: string,
  hand: Hand,
): { finger?: Finger; substitution?: Finger; warning?: string } {
  const parts = text.trim().split('_');
  const first = toFinger(parts[0] ?? '');
  if (first === undefined) return {};
  const result: { finger: Finger; substitution?: Finger; warning?: string } = { finger: first.finger };
  const second = parts.length > 1 ? toFinger(parts[1]!) : undefined;
  if (second) result.substitution = second.finger;
  const expectedSign = hand === 'L' ? -1 : 1;
  if (first.sign !== 0 && first.sign !== expectedSign) {
    result.warning = `finger ${text} has the wrong sign for hand ${hand}`;
  }
  return result;
}

function toFinger(raw: string): { finger: Finger; sign: -1 | 0 | 1 } | undefined {
  const n = Number(raw);
  if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 5) return undefined;
  return { finger: Math.abs(n) as Finger, sign: n < 0 ? -1 : 1 };
}

export function parsePig(text: string, opts: { source?: string } = {}): ParsedPig {
  const lines = text.split(/\r?\n/);
  const notes: Note[] = [];
  const assignment: Assignment = {};
  const warnings: string[] = [];
  let lineIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (raw === '' || raw.startsWith('//')) continue;
    const cols = raw.split(/\s+/);
    if (cols.length < 8) throw new Error(`PIG line ${i + 1}: expected 8 columns, got ${cols.length}`);
    const [id, onset, offset, pitch, onVel, offVel, channel, fingerText] = cols as [string, string, string, string, string, string, string, string];
    const onsetSec = Number(onset);
    const offsetSec = Number(offset);
    if (!Number.isFinite(onsetSec) || !Number.isFinite(offsetSec)) throw new Error(`PIG line ${i + 1}: bad times`);
    const hand: Hand = channel === '1' ? 'L' : 'R';
    const spelling = parsePigPitch(pitch);
    const note: Note = {
      id,
      onsetTick: Math.round(onsetSec * TICKS_PER_SECOND),
      offsetTick: Math.round(offsetSec * TICKS_PER_SECOND),
      onsetSec,
      offsetSec,
      midi: spellingToMidi(spelling),
      spelling,
      hand,
      staff: hand === 'R' ? 1 : 2,
      voice: 1,
      measureIndex: 0,
      isGrace: false,
      chordId: '',
      sourceIndices: [lineIndex],
      velocity: Number(onVel),
    };
    void offVel;
    notes.push(note);
    const f = parseFingerField(fingerText, hand);
    if (f.warning) warnings.push(`PIG line ${i + 1}: ${f.warning}`);
    if (f.finger !== undefined) {
      assignment[id] = f.substitution !== undefined
        ? { finger: f.finger, substitution: f.substitution, source: 'editorial' }
        : { finger: f.finger, source: 'editorial' };
    }
    lineIndex++;
  }
  const score = finalizeScore({
    meta: opts.source !== undefined ? { source: opts.source } : {},
    divisions: PIG_DIVISIONS,
    tempoMap: [{ tick: 0, qpm: PIG_QPM }],
    timeSignatures: [],
    keySignatures: [],
    measures: [],
    notes,
  });
  // keep the file's exact seconds rather than the tick-derived ones
  for (const n of score.notes) {
    const original = notes.find((o) => o.id === n.id)!;
    n.onsetSec = original.onsetSec;
    n.offsetSec = original.offsetSec;
  }
  const problems = validateScore(score);
  if (problems.length > 0) throw new Error(`invalid PIG score: ${problems.join('; ')}`);
  return { score, assignment, warnings };
}
```
Note: `finalizeScore` returns new sorted array entries that are the same objects, so the seconds fix-up could also be done before finalizing; keep the explicit loop so intent is visible.

- [ ] **Step 4: Implement the writer**

`packages/engine/src/io/pig/write.ts`:
```ts
import { formatPigPitch } from '../../score/pitch.js';
import type { Assignment, Score } from '../../score/types.js';
import { PIG_HEADER } from './read.js';

function seconds(x: number): string {
  return x.toFixed(6);
}

export function writePig(score: Score, assignment: Assignment = {}): string {
  const ordered = [...score.notes].sort(
    (a, b) => (a.sourceIndices[0] ?? 0) - (b.sourceIndices[0] ?? 0) || a.onsetTick - b.onsetTick || a.midi - b.midi,
  );
  const lines = [PIG_HEADER];
  for (const n of ordered) {
    const a = assignment[n.id];
    const sign = n.hand === 'L' ? -1 : 1;
    const finger = a
      ? a.substitution !== undefined
        ? `${sign * a.finger}_${sign * a.substitution}`
        : `${sign * a.finger}`
      : '0';
    const vel = n.velocity ?? 80;
    lines.push(
      [n.id, seconds(n.onsetSec), seconds(n.offsetSec), formatPigPitch(n.spelling), vel, vel, n.hand === 'L' ? 1 : 0, finger].join('\t'),
    );
  }
  return lines.join('\n') + '\n';
}
```

Add to `packages/engine/src/index.ts`:
```ts
export { parsePig, parseFingerField, PIG_HEADER, PIG_DIVISIONS, PIG_QPM } from './io/pig/read.js';
export type { ParsedPig } from './io/pig/read.js';
export { writePig } from './io/pig/write.js';
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @digitus2/engine test -- pig && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/io/pig packages/engine/fixtures/pig-sample.txt packages/engine/src/index.ts
git commit -m "feat(engine): PIG format reader and writer with substitutions"
```

---

### Task 5: MusicXML infrastructure: XML DOM, .mxl unpacking, timewise conversion

**Files:**
- Create: `packages/engine/src/io/musicxml/dom.ts`, `packages/engine/src/io/musicxml/unpack.ts`, `packages/engine/src/io/musicxml/timewise.ts`, `packages/engine/src/io/musicxml/infra.test.ts`

**Interfaces:**
- Produces:
  - `parseXml(text: string): Document` and `serializeXml(doc: Document): string` using `@xmldom/xmldom` (import `DOMParser`, `XMLSerializer` from it; use its exported `Document`/`Element` types. If those types are not exported by the installed version, add `"DOM"` to `lib` in `packages/engine/tsconfig.json` for type-checking only; no runtime DOM global may be referenced).
  - `childElements(el: Element, name?: string): Element[]`, `childText(el: Element, name: string): string | undefined`, `firstChild(el: Element, name: string): Element | undefined`
  - `unpackMusicXml(input: string | Uint8Array): string` — returns XML text; `.mxl` (zip, bytes starting with `PK`) is unzipped with `fflate.unzipSync`, the rootfile is taken from `META-INF/container.xml` (`<rootfile full-path="...">`), falling back to the first `.xml`/`.musicxml` entry outside `META-INF/`. A UTF-8 BOM is stripped.
  - `timewiseToPartwise(doc: Document): Document` — returns the same document when it is already `score-partwise`; otherwise builds a `score-partwise` document.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/io/musicxml/infra.test.ts`:
```ts
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { childElements, childText, parseXml, serializeXml } from './dom.js';
import { timewiseToPartwise } from './timewise.js';
import { unpackMusicXml } from './unpack.js';

const PARTWISE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;

const TIMEWISE = `<?xml version="1.0" encoding="UTF-8"?>
<score-timewise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part><score-part id="P2"><part-name>Left</part-name></score-part></part-list>
<measure number="1"><part id="P1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></part><part id="P2"><note><rest/><duration>1</duration></note></part></measure>
<measure number="2"><part id="P1"><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note></part><part id="P2"><note><rest/><duration>1</duration></note></part></measure>
</score-timewise>`;

describe('dom helpers', () => {
  it('parses, navigates and serializes', () => {
    const doc = parseXml(PARTWISE);
    const root = doc.documentElement!;
    expect(root.tagName).toBe('score-partwise');
    const parts = childElements(root, 'part');
    expect(parts).toHaveLength(1);
    const measure = childElements(parts[0]!, 'measure')[0]!;
    expect(childText(childElements(measure, 'attributes')[0]!, 'divisions')).toBe('1');
    expect(serializeXml(doc)).toContain('<score-partwise');
  });
  it('throws on malformed XML', () => {
    expect(() => parseXml('<score-partwise><part></score-partwise>')).toThrow();
  });
});

describe('unpackMusicXml', () => {
  it('returns text unchanged and strips a BOM', () => {
    expect(unpackMusicXml('﻿<a/>')).toBe('<a/>');
    expect(unpackMusicXml(new TextEncoder().encode('﻿<a/>'))).toBe('<a/>');
  });
  it('unzips an mxl using the container rootfile, even in a subfolder', () => {
    const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="scores/piece.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
    const zip = zipSync({
      'META-INF/container.xml': strToU8(container),
      'scores/piece.xml': strToU8(PARTWISE),
      'scores/other.xml': strToU8('<wrong/>'),
    });
    expect(unpackMusicXml(zip)).toBe(PARTWISE);
  });
  it('falls back to the first xml entry without a container', () => {
    const zip = zipSync({ 'piece.musicxml': strToU8(PARTWISE) });
    expect(unpackMusicXml(zip)).toBe(PARTWISE);
  });
});

describe('timewiseToPartwise', () => {
  it('returns partwise documents untouched', () => {
    const doc = parseXml(PARTWISE);
    expect(timewiseToPartwise(doc)).toBe(doc);
  });
  it('regroups measures under parts', () => {
    const out = timewiseToPartwise(parseXml(TIMEWISE));
    const root = out.documentElement!;
    expect(root.tagName).toBe('score-partwise');
    expect(childElements(root, 'part-list')).toHaveLength(1);
    const parts = childElements(root, 'part');
    expect(parts.map((p) => p.getAttribute('id'))).toEqual(['P1', 'P2']);
    const p1Measures = childElements(parts[0]!, 'measure');
    expect(p1Measures.map((m) => m.getAttribute('number'))).toEqual(['1', '2']);
    expect(childText(childElements(p1Measures[1]!, 'note')[0]!, 'duration')).toBe('1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine test -- infra`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`packages/engine/src/io/musicxml/dom.ts`:
```ts
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Document, Element, Node } from '@xmldom/xmldom';

export type { Document, Element, Node };

export function parseXml(text: string): Document {
  const errors: string[] = [];
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level === 'error' || level === 'fatalError') errors.push(message);
    },
  });
  const doc = parser.parseFromString(text, 'text/xml');
  if (errors.length > 0 || !doc.documentElement) throw new Error(`XML parse error: ${errors[0] ?? 'no document element'}`);
  return doc;
}

export function serializeXml(doc: Document): string {
  return new XMLSerializer().serializeToString(doc);
}

export function childElements(el: Element, name?: string): Element[] {
  const out: Element[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && (name === undefined || (c as Element).tagName === name)) out.push(c as Element);
  }
  return out;
}

export function firstChild(el: Element, name: string): Element | undefined {
  return childElements(el, name)[0];
}

export function childText(el: Element, name: string): string | undefined {
  const c = firstChild(el, name);
  return c ? (c.textContent ?? '').trim() : undefined;
}
```
If the installed `@xmldom/xmldom` version's `DOMParser` options do not accept `onError` (versions before 0.9 use `errorHandler`), use `errorHandler: { error: (m) => errors.push(String(m)), fatalError: (m) => errors.push(String(m)) }` instead; check `node_modules/@xmldom/xmldom/index.d.ts`.

`packages/engine/src/io/musicxml/unpack.ts`:
```ts
import { unzipSync } from 'fflate';

const decoder = new TextDecoder('utf-8');

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function unpackMusicXml(input: string | Uint8Array): string {
  if (typeof input === 'string') return stripBom(input);
  if (input.length >= 2 && input[0] === 0x50 && input[1] === 0x4b) return stripBom(unpackMxl(input));
  return stripBom(decoder.decode(input));
}

function unpackMxl(bytes: Uint8Array): string {
  const entries = unzipSync(bytes);
  const container = entries['META-INF/container.xml'];
  if (container) {
    const m = /<rootfile[^>]*full-path="([^"]+)"/.exec(decoder.decode(container));
    const path = m?.[1];
    if (path && entries[path]) return decoder.decode(entries[path]);
  }
  const candidate = Object.keys(entries).find(
    (name) => !name.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(name),
  );
  if (!candidate) throw new Error('mxl archive contains no MusicXML rootfile');
  return decoder.decode(entries[candidate]!);
}
```

`packages/engine/src/io/musicxml/timewise.ts`:
```ts
import { childElements, parseXml } from './dom.js';
import type { Document, Element } from './dom.js';

export function timewiseToPartwise(doc: Document): Document {
  const root = doc.documentElement;
  if (!root) throw new Error('empty document');
  if (root.tagName === 'score-partwise') return doc;
  if (root.tagName !== 'score-timewise') throw new Error(`not a MusicXML score: <${root.tagName}>`);

  const out = parseXml('<?xml version="1.0" encoding="UTF-8"?><score-partwise/>');
  const outRoot = out.documentElement!;
  for (const attr of Array.from(root.attributes)) outRoot.setAttribute(attr.name, attr.value);

  const partsById = new Map<string, Element>();
  for (const child of childElements(root)) {
    if (child.tagName !== 'measure') {
      outRoot.appendChild(out.importNode(child, true));
      continue;
    }
    for (const part of childElements(child, 'part')) {
      const id = part.getAttribute('id') ?? '';
      let outPart = partsById.get(id);
      if (!outPart) {
        outPart = out.createElement('part');
        outPart.setAttribute('id', id);
        partsById.set(id, outPart);
        outRoot.appendChild(outPart);
      }
      const measure = out.createElement('measure');
      for (const attr of Array.from(child.attributes)) measure.setAttribute(attr.name, attr.value);
      for (const node of Array.from(part.childNodes)) measure.appendChild(out.importNode(node, true));
      outPart.appendChild(measure);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @digitus2/engine test -- infra && pnpm typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/io/musicxml/dom.ts packages/engine/src/io/musicxml/unpack.ts packages/engine/src/io/musicxml/timewise.ts packages/engine/src/io/musicxml/infra.test.ts
git commit -m "feat(engine): MusicXML DOM helpers, mxl unpacking, timewise conversion"
```

---

### Task 6: MusicXML reader: notes, chords, ties, grace notes, voices, staves, divisions

**Files:**
- Create: `packages/engine/src/io/musicxml/read.ts`, `packages/engine/src/io/musicxml/read.test.ts`, `packages/engine/fixtures/two-staff.musicxml`

**Interfaces:**
- Consumes: Task 5 helpers; `finalizeScore`, `validateScore`, `spellingToMidi` and types from Tasks 2 and 3.
- Produces:
  - `parseMusicXml(input: string | Uint8Array, opts?: { source?: string }): { score: Score; editorial: Assignment; warnings: string[] }`
  - Note ids are `n<index>` where `<index>` is the document-order index (0-based) of the `<note>` element that starts the sounding note (counting every `<note>` element in the document, rests and grace notes included). `sourceIndices` lists all merged `<note>` indices.
  - Hand rule: parts with `<staves>` ≥ 2 use the note's own `<staff>` (1 → R, anything else → L); single-staff parts use part order (first part R, later parts L).
  - Divisions: the score's `divisions` is the least common multiple of every `<divisions>` value in the document; each measure's durations are scaled by `divisions / currentDivisions`.
  - Measures: `measures[i].startTick` is the running start; `lengthTicks` is the largest cursor advance any part made in that measure.

- [ ] **Step 1: Write the fixture**

`packages/engine/fixtures/two-staff.musicxml` — one piano part, two staves, three measures in 4/4, with: a right-hand scale fragment, a left-hand chord, a tie across the barline (measure 1 to 2), a chord of two notes, a grace note, a divisions change in measure 3, a cross-staff note, two voices in measure 2, a fingering on the first note, and a metronome marking of 90.
```xml
<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Fixture</work-title></work>
  <identification><creator type="composer">Test Composer</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>1</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>90</per-minute></metronome></direction-type><sound tempo="90"/></direction>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff><notations><technical><fingering>1</fingering></technical></notations></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><tie type="start"/><voice>1</voice><type>quarter</type><staff>1</staff><notations><tied type="start"/></notations></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>8</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
      <note><chord/><pitch><step>D</step><octave>3</octave></pitch><duration>8</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><tie type="stop"/><voice>1</voice><type>quarter</type><staff>1</staff><notations><tied type="stop"/></notations></note>
      <note><grace/><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><rest/><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><rest/><duration>4</duration><voice>2</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>half</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>half</type><staff>2</staff></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>5</voice><type>half</type><staff>2</staff></note>
    </measure>
    <measure number="3">
      <attributes><divisions>4</divisions></attributes>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>B</step><octave>3</octave></pitch><duration>8</duration><voice>5</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>8</duration><voice>5</voice><type>half</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>
```
In measure 3 the note B3 in voice 5 carries `<staff>1</staff>` while its voice otherwise lives on staff 2: it is the cross-staff case and must be assigned to the right hand because the note's own staff wins.

- [ ] **Step 2: Write the failing tests**

`packages/engine/src/io/musicxml/read.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from './read.js';

const xml = readFileSync(fileURLToPath(new URL('../../../fixtures/two-staff.musicxml', import.meta.url)), 'utf8');

describe('parseMusicXml notes', () => {
  const { score, editorial, warnings } = parseMusicXml(xml);
  const byMidiHand = (midi: number, hand: 'L' | 'R') => score.notes.filter((n) => n.midi === midi && n.hand === hand);

  it('parses without warnings and uses the lcm of divisions', () => {
    expect(warnings).toEqual([]);
    expect(score.divisions).toBe(4);
  });
  it('counts sounding notes: ties merged, rests skipped, grace kept', () => {
    // m1: G4 A4 B4 C5(tie) + G2 D3 = 6 ; m2: [C5 merged] F#4(grace) G4 E4 + C3 C4 = 5 ; m3: D5 E5 F5 B3 G2 = 5
    expect(score.notes).toHaveLength(16);
    expect(score.notes.filter((n) => n.isGrace)).toHaveLength(1);
  });
  it('places onsets with the scaled divisions', () => {
    const a4 = byMidiHand(69, 'R')[0]!;
    expect(a4.onsetTick).toBe(4);
    expect(a4.offsetTick).toBe(8);
    const d5 = byMidiHand(74, 'R')[0]!;
    expect(d5.onsetTick).toBe(32); // measure 3 starts at 2 * 16
    expect(d5.offsetTick).toBe(34);
    const f5 = byMidiHand(77, 'R')[0]!;
    expect(f5.offsetTick - f5.onsetTick).toBe(12);
  });
  it('merges the tie across the barline into one note', () => {
    const c5 = byMidiHand(72, 'R');
    expect(c5).toHaveLength(1);
    expect(c5[0]!.onsetTick).toBe(12);
    expect(c5[0]!.offsetTick).toBe(20);
    expect(c5[0]!.sourceIndices).toHaveLength(2);
    expect(c5[0]!.id).toBe('n3');
  });
  it('groups the left-hand chord and assigns hands by staff', () => {
    const g2 = byMidiHand(43, 'L')[0]!;
    const d3 = byMidiHand(50, 'L')[0]!;
    expect(g2.chordId).toBe(d3.chordId);
    expect(g2.staff).toBe(2);
  });
  it('honors the cross-staff note', () => {
    expect(byMidiHand(59, 'R')).toHaveLength(1);
    expect(byMidiHand(59, 'L')).toHaveLength(0);
  });
  it('keeps the second voice at its backup position', () => {
    const e4 = byMidiHand(64, 'R')[0]!;
    expect(e4.voice).toBe(2);
    expect(e4.onsetTick).toBe(16 + 8);
  });
  it('gives the grace note a zero-length onset at the following note', () => {
    const grace = score.notes.find((n) => n.isGrace)!;
    const g4 = score.notes.find((n) => n.midi === 67 && n.hand === 'R' && n.onsetTick >= 16)!;
    expect(grace.midi).toBe(66);
    expect(grace.onsetTick).toBe(g4.onsetTick);
    expect(grace.offsetTick).toBe(grace.onsetTick);
  });
  it('builds measures with running start ticks', () => {
    expect(score.measures.map((m) => m.startTick)).toEqual([0, 16, 32]);
    expect(score.measures.map((m) => m.lengthTicks)).toEqual([16, 16, 16]);
    expect(score.measures[2]!.number).toBe('3');
    expect(score.notes.find((n) => n.midi === 74)!.measureIndex).toBe(2);
  });
  it('reads editorial fingering by note id', () => {
    expect(editorial['n0']).toEqual({ finger: 1, source: 'editorial' });
    expect(Object.keys(editorial)).toHaveLength(1);
  });
  it('reads metadata', () => {
    expect(score.meta.title).toBe('Fixture');
    expect(score.meta.composer).toBe('Test Composer');
  });
});

describe('parseMusicXml edge cases', () => {
  it('assigns hands by part order for two single-staff parts', () => {
    const two = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>RH</part-name></score-part><score-part id="P2"><part-name>LH</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration></note></measure></part>
      <part id="P2"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
    const { score } = parseMusicXml(two);
    expect(score.notes.map((n) => [n.midi, n.hand])).toEqual([[72, 'R'], [48, 'L']]);
  });
  it('rejects a pitch outside the piano', () => {
    const bad = `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>9</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
    expect(() => parseMusicXml(bad)).toThrow(/piano range/);
  });
  it('warns on a tie stop without a start and keeps the note', () => {
    const orphan = `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><tie type="stop"/></note></measure></part></score-partwise>`;
    const { score, warnings } = parseMusicXml(orphan);
    expect(score.notes).toHaveLength(1);
    expect(warnings[0]).toMatch(/tie/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine test -- read`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the reader**

`packages/engine/src/io/musicxml/read.ts`:
```ts
import { finalizeScore, validateScore } from '../../score/build.js';
import { spellingToMidi } from '../../score/pitch.js';
import type { Alter, Spelling, Step } from '../../score/pitch.js';
import type { Assignment, Finger, Hand, KeySigEvent, MeasureInfo, Note, Score, TempoEvent, TimeSigEvent } from '../../score/types.js';
import { childElements, childText, firstChild, parseXml } from './dom.js';
import type { Element } from './dom.js';
import { timewiseToPartwise } from './timewise.js';
import { unpackMusicXml } from './unpack.js';

export interface ParsedMusicXml {
  score: Score;
  editorial: Assignment;
  warnings: string[];
}

interface PendingTie {
  note: Note;
}

const BEAT_UNIT_QUARTERS: Record<string, number> = {
  whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125,
};

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

export function parseMusicXml(input: string | Uint8Array, opts: { source?: string } = {}): ParsedMusicXml {
  const doc = timewiseToPartwise(parseXml(unpackMusicXml(input)));
  const root = doc.documentElement!;
  if (root.tagName !== 'score-partwise') throw new Error('not a MusicXML score');
  const warnings: string[] = [];
  const editorial: Assignment = {};

  // Global divisions = lcm of all <divisions> in the document.
  let divisions = 1;
  for (const d of allDescendants(root, 'divisions')) {
    const v = Number((d.textContent ?? '').trim());
    if (Number.isInteger(v) && v > 0) divisions = lcm(divisions, v);
  }

  const parts = childElements(root, 'part');
  const measureStarts: number[] = [];
  const measureLengths: number[] = [];
  const measureNumbers: string[] = [];
  const notes: Note[] = [];
  const tempoMap: TempoEvent[] = [];
  const timeSignatures: TimeSigEvent[] = [];
  const keySignatures: KeySigEvent[] = [];
  let noteIndex = 0;

  parts.forEach((part, partIndex) => {
    let currentDivisions = 1;
    let staves = 1;
    const pending = new Map<string, PendingTie>();
    let measureStart = 0;
    childElements(part, 'measure').forEach((measure, mIndex) => {
      if (measureStarts[mIndex] === undefined) {
        measureStarts[mIndex] = mIndex === 0 ? 0 : measureStarts[mIndex - 1]! + (measureLengths[mIndex - 1] ?? 0);
        measureNumbers[mIndex] = measure.getAttribute('number') ?? String(mIndex + 1);
      }
      measureStart = measureStarts[mIndex]!;
      let cursor = measureStart;
      let maxCursor = measureStart;
      let lastNote: Note | undefined;
      let lastAdvance = 0;
      for (const el of childElements(measure)) {
        switch (el.tagName) {
          case 'attributes': {
            const d = childText(el, 'divisions');
            if (d) currentDivisions = Number(d);
            const st = childText(el, 'staves');
            if (st) staves = Number(st);
            const key = firstChild(el, 'key');
            if (key && partIndex === 0) {
              const fifths = Number(childText(key, 'fifths') ?? '0');
              const mode = childText(key, 'mode');
              keySignatures.push(mode === 'major' || mode === 'minor' ? { tick: cursor, fifths, mode } : { tick: cursor, fifths });
            }
            const time = firstChild(el, 'time');
            if (time && partIndex === 0) {
              timeSignatures.push({ tick: cursor, beats: Number(childText(time, 'beats') ?? '4'), beatType: Number(childText(time, 'beat-type') ?? '4') });
            }
            break;
          }
          case 'direction':
          case 'sound': {
            const qpm = readTempo(el);
            if (qpm !== undefined && partIndex === 0) tempoMap.push({ tick: cursor, qpm });
            break;
          }
          case 'backup': {
            cursor -= scaled(childText(el, 'duration'), currentDivisions, divisions);
            break;
          }
          case 'forward': {
            cursor += scaled(childText(el, 'duration'), currentDivisions, divisions);
            maxCursor = Math.max(maxCursor, cursor);
            break;
          }
          case 'note': {
            const index = noteIndex++;
            const isChord = firstChild(el, 'chord') !== undefined;
            const isGrace = firstChild(el, 'grace') !== undefined;
            const isRest = firstChild(el, 'rest') !== undefined;
            const duration = isGrace ? 0 : scaled(childText(el, 'duration'), currentDivisions, divisions);
            const onset = isChord && lastNote ? lastNote.onsetTick : cursor;
            if (!isChord && !isGrace) {
              cursor += duration;
              lastAdvance = duration;
              maxCursor = Math.max(maxCursor, cursor);
            }
            if (isRest) {
              lastNote = undefined;
              break;
            }
            const pitch = firstChild(el, 'pitch');
            if (!pitch) {
              warnings.push(`note ${index}: no pitch and no rest, skipped`);
              break;
            }
            const spelling: Spelling = {
              step: (childText(pitch, 'step') ?? 'C') as Step,
              alter: Number(childText(pitch, 'alter') ?? '0') as Alter,
              octave: Number(childText(pitch, 'octave') ?? '4'),
            };
            const staff = Number(childText(el, 'staff') ?? '1');
            const hand: Hand = staves >= 2 ? (staff === 1 ? 'R' : 'L') : partIndex === 0 ? 'R' : 'L';
            const voice = Number(childText(el, 'voice') ?? '1');
            const midi = spellingToMidi(spelling);
            const ties = childElements(el, 'tie').map((t) => t.getAttribute('type'));
            const tied = childElements(firstChild(el, 'notations') ?? el, 'tied').map((t) => t.getAttribute('type'));
            const tieStop = ties.includes('stop') || (ties.length === 0 && tied.includes('stop'));
            const tieStart = ties.includes('start') || (ties.length === 0 && tied.includes('start'));
            const tieKey = `${staff}:${midi}`;
            const offset = isGrace ? onset : onset + (isChord ? lastAdvance : duration);

            if (tieStop) {
              const prev = pending.get(tieKey);
              if (prev) {
                prev.note.offsetTick = Math.max(prev.note.offsetTick, offset);
                prev.note.sourceIndices.push(index);
                if (!tieStart) pending.delete(tieKey);
                if (!isChord) lastNote = prev.note;
                break;
              }
              warnings.push(`note ${index}: tie stop without a start`);
            }
            const note: Note = {
              id: `n${index}`,
              onsetTick: onset,
              offsetTick: offset,
              onsetSec: 0,
              offsetSec: 0,
              midi,
              spelling,
              hand,
              staff,
              voice,
              measureIndex: mIndex,
              isGrace,
              chordId: '',
              sourceIndices: [index],
            };
            notes.push(note);
            if (tieStart) pending.set(tieKey, { note });
            const finger = readFingering(el);
            if (finger !== undefined) editorial[note.id] = { finger, source: 'editorial' };
            if (!isChord) lastNote = note;
            break;
          }
          default:
            break;
        }
      }
      measureLengths[mIndex] = Math.max(measureLengths[mIndex] ?? 0, maxCursor - measureStart);
    });
    if (pending.size > 0) warnings.push(`part ${partIndex}: ${pending.size} tie(s) never closed`);
  });

  // Second pass: measure starts must reflect lengths from all parts; recompute and remap notes.
  const measures: MeasureInfo[] = [];
  let start = 0;
  for (let i = 0; i < measureLengths.length; i++) {
    measures.push({ index: i, startTick: start, lengthTicks: measureLengths[i] ?? 0, number: measureNumbers[i] ?? String(i + 1) });
    start += measureLengths[i] ?? 0;
  }
  for (const n of notes) {
    const delta = measures[n.measureIndex]!.startTick - measureStarts[n.measureIndex]!;
    if (delta !== 0) {
      n.onsetTick += delta;
      n.offsetTick += delta;
    }
  }

  const score = finalizeScore({
    meta: readMeta(root, opts.source),
    divisions,
    tempoMap: tempoMap.length > 0 ? tempoMap : [{ tick: 0, qpm: 120 }],
    timeSignatures,
    keySignatures,
    measures,
    notes,
  });
  const problems = validateScore(score);
  if (problems.length > 0) throw new Error(`invalid score: ${problems.join('; ')}`);
  return { score, editorial, warnings };
}

function scaled(text: string | undefined, current: number, global: number): number {
  const d = Number(text ?? '0');
  return Math.round((d * global) / current);
}

function readTempo(el: Element): number | undefined {
  const sound = el.tagName === 'sound' ? el : allDescendants(el, 'sound')[0];
  const tempoAttr = sound?.getAttribute('tempo');
  if (tempoAttr && Number(tempoAttr) > 0) return Number(tempoAttr);
  const metronome = allDescendants(el, 'metronome')[0];
  if (!metronome) return undefined;
  const unit = childText(metronome, 'beat-unit') ?? 'quarter';
  const dots = childElements(metronome, 'beat-unit-dot').length;
  const perMinute = Number(childText(metronome, 'per-minute') ?? '0');
  if (!(perMinute > 0)) return undefined;
  const quarters = (BEAT_UNIT_QUARTERS[unit] ?? 1) * (dots > 0 ? 1.5 : 1);
  return perMinute * quarters;
}

function readFingering(noteEl: Element): Finger | undefined {
  for (const notations of childElements(noteEl, 'notations')) {
    for (const technical of childElements(notations, 'technical')) {
      for (const f of childElements(technical, 'fingering')) {
        const v = Number((f.textContent ?? '').trim());
        if (Number.isInteger(v) && v >= 1 && v <= 5) return v as Finger;
      }
    }
  }
  return undefined;
}

function readMeta(root: Element, source?: string): Score['meta'] {
  const meta: Score['meta'] = {};
  const work = firstChild(root, 'work');
  const title = (work && childText(work, 'work-title')) || childText(root, 'movement-title');
  if (title) meta.title = title;
  const ident = firstChild(root, 'identification');
  if (ident) {
    const composer = childElements(ident, 'creator').find((c) => c.getAttribute('type') === 'composer');
    if (composer?.textContent?.trim()) meta.composer = composer.textContent.trim();
  }
  if (source !== undefined) meta.source = source;
  return meta;
}

function allDescendants(el: Element, name: string): Element[] {
  const out: Element[] = [];
  const list = el.getElementsByTagName(name);
  for (let i = 0; i < list.length; i++) out.push(list.item(i) as Element);
  return out;
}
```

- [ ] **Step 5: Run the tests and fix until green**

Run: `pnpm --filter @digitus2/engine test -- read && pnpm typecheck && pnpm lint`
Expected: all pass. If a tick in the fixture test disagrees with your reading of the fixture, recompute by hand from the fixture (divisions lcm = 4; measure 1 has divisions 2 so each quarter = 4 ticks; measure 3 has divisions 4 so each quarter = 4 ticks) before changing either.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/io/musicxml/read.ts packages/engine/src/io/musicxml/read.test.ts packages/engine/fixtures/two-staff.musicxml
git commit -m "feat(engine): MusicXML reader with ties, chords, grace notes, voices and cross-staff hands"
```

---

### Task 7: MusicXML reader: tempo map, seconds, repeats ignored, public export, real-file smoke test

**Files:**
- Modify: `packages/engine/src/io/musicxml/read.test.ts`, `packages/engine/src/index.ts`
- Create: `packages/engine/src/io/musicxml/smoke.test.ts`

**Interfaces:**
- Consumes: Task 6 `parseMusicXml`.
- Produces: `parseMusicXml` exported from the package index; `ParsedMusicXml` type exported.

- [ ] **Step 1: Add tempo and timing tests to `read.test.ts`**

Append inside the `parseMusicXml notes` describe block:
```ts
  it('reads the metronome tempo and derives seconds', () => {
    expect(score.tempoMap).toEqual([{ tick: 0, qpm: 90 }]);
    const a4 = score.notes.find((n) => n.midi === 69 && n.hand === 'R')!;
    expect(a4.onsetSec).toBeCloseTo((4 / 4) * (60 / 90));
  });
  it('reads key and time signatures', () => {
    expect(score.keySignatures).toEqual([{ tick: 0, fifths: 1, mode: 'major' }]);
    expect(score.timeSignatures).toEqual([{ tick: 0, beats: 4, beatType: 4 }]);
  });
```
Add a new describe block:
```ts
describe('parseMusicXml tempo variants', () => {
  const wrap = (direction: string) => `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>${direction}<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
  it('converts a dotted-quarter metronome to quarters per minute', () => {
    const { score } = parseMusicXml(wrap('<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>60</per-minute></metronome></direction-type></direction>'));
    expect(score.tempoMap[0]!.qpm).toBeCloseTo(90);
  });
  it('prefers sound tempo over the metronome text', () => {
    const { score } = parseMusicXml(wrap('<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type><sound tempo="120"/></direction>'));
    expect(score.tempoMap[0]!.qpm).toBe(120);
  });
  it('defaults to 120 when nothing is marked', () => {
    const { score } = parseMusicXml(wrap(''));
    expect(score.tempoMap).toEqual([{ tick: 0, qpm: 120 }]);
  });
});
```

- [ ] **Step 2: Write the smoke test over real files**

`packages/engine/src/io/musicxml/smoke.test.ts` parses every `.musicxml`/`.xml`/`.mxl` under `content/scores/` if that directory exists (another agent is filling it); it must not fail when the directory is absent or empty.
```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from './read.js';

const dir = fileURLToPath(new URL('../../../../../content/scores/', import.meta.url));
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(musicxml|xml|mxl)$/i.test(f)) : [];

describe('content library smoke test', () => {
  it.skipIf(files.length === 0)('parses every built-in score', () => {
    for (const f of files) {
      const { score } = parseMusicXml(readFileSync(join(dir, f)));
      expect(score.notes.length, f).toBeGreaterThan(0);
      expect(score.notes.some((n) => n.hand === 'L'), f).toBe(true);
      expect(score.notes.some((n) => n.hand === 'R'), f).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Export from the index**

Add to `packages/engine/src/index.ts`:
```ts
export { parseMusicXml } from './io/musicxml/read.js';
export type { ParsedMusicXml } from './io/musicxml/read.js';
export { unpackMusicXml } from './io/musicxml/unpack.js';
```

- [ ] **Step 4: Run everything**

Run: `pnpm --filter @digitus2/engine test && pnpm typecheck && pnpm lint`
Expected: all pass (smoke test skipped or passing).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/io/musicxml packages/engine/src/index.ts
git commit -m "feat(engine): MusicXML tempo handling, exports and content smoke test"
```

---

### Task 8: MusicXML writer: inject fingerings into the original document

**Files:**
- Create: `packages/engine/src/io/musicxml/write.ts`, `packages/engine/src/io/musicxml/write.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: `parseXml`, `serializeXml`, `childElements`, `firstChild` (Task 5); `unpackMusicXml` (Task 5); `timewiseToPartwise` (Task 5); `parseMusicXml` (Task 6, in tests); `Score`, `Assignment` (Task 3).
- Produces: `injectFingerings(xml: string | Uint8Array, score: Score, assignment: Assignment, opts?: { replace?: boolean }): string`
  - Walks every `<note>` element in document order; the element at index `note.sourceIndices[0]` receives `<notations><technical><fingering placement="above|below">F</fingering></technical></notations>` (above for the right hand, below for the left). A substitution adds a second `<fingering substitution="yes">`.
  - `replace: true` (default `true`) removes existing `<fingering>` elements of that note first; `replace: false` keeps them and appends.
  - Notes with no assignment are untouched. Everything else in the document is preserved. The output starts with the original XML declaration when there was one.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/io/musicxml/write.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from './read.js';
import { injectFingerings } from './write.js';

const xml = readFileSync(fileURLToPath(new URL('../../../fixtures/two-staff.musicxml', import.meta.url)), 'utf8');

describe('injectFingerings', () => {
  const { score } = parseMusicXml(xml);

  it('adds fingerings that the reader gets back, on tie starts only', () => {
    const out = injectFingerings(xml, score, {
      n1: { finger: 2, source: 'engine' },
      n3: { finger: 4, source: 'engine' },
      n4: { finger: 5, source: 'engine' },
    });
    const { editorial } = parseMusicXml(out);
    expect(editorial['n0']).toEqual({ finger: 1, source: 'editorial' });
    expect(editorial['n1']).toEqual({ finger: 2, source: 'editorial' });
    expect(editorial['n3']).toEqual({ finger: 4, source: 'editorial' });
    expect(editorial['n4']).toEqual({ finger: 5, source: 'editorial' });
    expect(Object.keys(editorial).sort()).toEqual(['n0', 'n1', 'n3', 'n4']);
    const fingerings = out.match(/<fingering[^>]*>/g) ?? [];
    expect(fingerings).toHaveLength(4);
    expect(out).toContain('<fingering placement="above">2</fingering>');
    expect(out).toContain('<fingering placement="below">5</fingering>');
  });
  it('replaces an existing fingering by default and keeps it on request', () => {
    const replaced = injectFingerings(xml, score, { n0: { finger: 3, source: 'user' } });
    expect(parseMusicXml(replaced).editorial['n0']!.finger).toBe(3);
    expect((replaced.match(/<fingering[^>]*>/g) ?? []).length).toBe(1);
    const kept = injectFingerings(xml, score, { n0: { finger: 3, source: 'user' } }, { replace: false });
    expect((kept.match(/<fingering[^>]*>/g) ?? []).length).toBe(2);
  });
  it('writes substitutions as a second fingering element', () => {
    const out = injectFingerings(xml, score, { n1: { finger: 3, substitution: 1, source: 'engine' } });
    expect(out).toContain('<fingering placement="above">3</fingering><fingering placement="above" substitution="yes">1</fingering>');
  });
  it('preserves the rest of the document and the declaration', () => {
    const out = injectFingerings(xml, score, { n1: { finger: 2, source: 'engine' } });
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(out).toContain('<work-title>Fixture</work-title>');
    expect(out).toContain('<per-minute>90</per-minute>');
    expect(out).toContain('<backup><duration>8</duration></backup>');
  });
  it('puts notations before lyrics', () => {
    const withLyric = `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><lyric><text>la</text></lyric></note></measure></part></score-partwise>`;
    const parsed = parseMusicXml(withLyric);
    const out = injectFingerings(withLyric, parsed.score, { n0: { finger: 1, source: 'engine' } });
    expect(out.indexOf('<notations>')).toBeLessThan(out.indexOf('<lyric>'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine test -- write`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/engine/src/io/musicxml/write.ts`:
```ts
import type { Assignment, Score } from '../../score/types.js';
import { childElements, firstChild, parseXml, serializeXml } from './dom.js';
import type { Document, Element } from './dom.js';
import { timewiseToPartwise } from './timewise.js';
import { unpackMusicXml } from './unpack.js';

const AFTER_NOTATIONS = new Set(['lyric', 'play', 'listen']);

export function injectFingerings(
  xml: string | Uint8Array,
  score: Score,
  assignment: Assignment,
  opts: { replace?: boolean } = {},
): string {
  const replace = opts.replace ?? true;
  const text = unpackMusicXml(xml);
  const doc = timewiseToPartwise(parseXml(text));
  const byIndex = new Map<number, string>();
  for (const n of score.notes) {
    const first = n.sourceIndices[0];
    if (first !== undefined && assignment[n.id]) byIndex.set(first, n.id);
  }
  const noteEls = doc.getElementsByTagName('note');
  for (let i = 0; i < noteEls.length; i++) {
    const id = byIndex.get(i);
    if (id === undefined) continue;
    const a = assignment[id]!;
    const note = score.notes.find((n) => n.id === id)!;
    const el = noteEls.item(i) as Element;
    const technical = ensureTechnical(doc, el);
    if (replace) {
      for (const f of childElements(technical, 'fingering')) technical.removeChild(f);
    }
    const placement = note.hand === 'L' ? 'below' : 'above';
    technical.appendChild(fingeringEl(doc, a.finger, placement));
    if (a.substitution !== undefined) {
      const sub = fingeringEl(doc, a.substitution, placement);
      sub.setAttribute('substitution', 'yes');
      technical.appendChild(sub);
    }
  }
  let out = serializeXml(doc);
  const decl = /^<\?xml[^>]*\?>/.exec(text)?.[0];
  if (decl && !out.startsWith('<?xml')) out = `${decl}\n${out}`;
  return out;
}

function fingeringEl(doc: Document, finger: number, placement: string): Element {
  const f = doc.createElement('fingering');
  f.setAttribute('placement', placement);
  f.appendChild(doc.createTextNode(String(finger)));
  return f;
}

function ensureTechnical(doc: Document, noteEl: Element): Element {
  let notations = firstChild(noteEl, 'notations');
  if (!notations) {
    notations = doc.createElement('notations');
    const before = childElements(noteEl).find((c) => AFTER_NOTATIONS.has(c.tagName));
    if (before) noteEl.insertBefore(notations, before);
    else noteEl.appendChild(notations);
  }
  let technical = firstChild(notations, 'technical');
  if (!technical) {
    technical = doc.createElement('technical');
    notations.appendChild(technical);
  }
  return technical;
}
```
Add to `packages/engine/src/index.ts`:
```ts
export { injectFingerings } from './io/musicxml/write.js';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @digitus2/engine test -- write && pnpm typecheck && pnpm lint`
Expected: all pass. If xmldom serializes the declaration itself, the `startsWith` test still passes; if it serializes `<?xml` with different quoting, normalize by always stripping any serialized declaration and prepending the original one.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/io/musicxml/write.ts packages/engine/src/io/musicxml/write.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): inject fingerings into MusicXML preserving the document"
```

---

### Task 9: PIG metrics and score alignment

**Files:**
- Create: `packages/engine/src/eval/metrics.ts`, `packages/engine/src/eval/metrics.test.ts`, `packages/engine/src/eval/align.ts`, `packages/engine/src/eval/align.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: `Finger`, `Hand`, `Score`, `Assignment` (Task 3); `parsePig` (Task 4, in tests).
- Produces:
```ts
export type FingerSeq = Array<Finger | undefined>;
export interface PigMetrics { gen: number; high: number; soft: number; rec: number; notes: number; annotators: number }
export function matchRate(pred: FingerSeq, gold: FingerSeq): number
export function pigMetrics(pred: FingerSeq, golds: FingerSeq[], hands?: Hand[]): PigMetrics
export function fingerSeq(score: Score, assignment: Assignment): FingerSeq      // in score.notes order, first finger only
export function alignScores(pred: Score, gold: Score): Array<[string, string]>  // [predId, goldId] pairs in gold order
export function metricsForScores(pred: { score: Score; assignment: Assignment }, golds: Array<{ score: Score; assignment: Assignment }>): PigMetrics
```
Definitions (Nakamura, Saito, Yoshii 2020, section on evaluation measures): with N notes and K ground truths, `M_k` is the fraction of notes whose predicted finger equals ground truth k. General match rate `gen` = mean of `M_k`; highest match rate `high` = max of `M_k`; soft match rate `soft` = fraction of notes whose predicted finger equals at least one ground truth at that note; recombination match rate `rec` (Nakamura et al. 2020, Appendix A) = `(N - E) / N` where `E` is the minimum edit cost of a recombined ground truth: pick one annotator per note; every note where the chosen annotator's finger differs from the prediction costs 1; every switch from one annotator to another costs 1 and is allowed only where the two annotators' fingers coincide at the switch point (otherwise infinite). The switch cost is what makes `rec` smaller than `soft`. Recombination runs along each hand's own note sequence when `hands` is given. Substitutions compare the first finger only. A ground-truth note without a finger never matches. The exact index convention for "coincide at the switch point" (note t-1 or note t) is fixed by the reference implementation: read `research/fingering_eval/metrics.py` (built by the datasets agent and cross-checked with the official C++ evaluator to 5e-7) and replicate its convention; then run both on one real PIG piece (`research/data/pig/FingeringFiles`, one annotator as prediction, the others as gold) and confirm identical numbers. The Python implementation wins any disagreement, and the TypeScript tests are updated to match.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/eval/metrics.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { matchRate, pigMetrics } from './metrics.js';
import type { FingerSeq } from './metrics.js';

describe('matchRate', () => {
  it('counts equal fingers over all notes', () => {
    expect(matchRate([1, 2, 3, 4], [1, 2, 3, 5])).toBe(0.75);
    expect(matchRate([1, undefined], [1, 2])).toBe(0.5);
    expect(matchRate([], [])).toBe(0);
  });
});

describe('pigMetrics', () => {
  const A: FingerSeq = [1, 2, 3, 4, 5];
  const B: FingerSeq = [1, 2, 3, 5, 5];
  it('is perfect when the prediction equals one annotator', () => {
    const m = pigMetrics([1, 2, 3, 5, 5], [A, B]);
    expect(m.high).toBe(1);
    expect(m.gen).toBeCloseTo(0.9);
    expect(m.soft).toBe(1);
    expect(m.rec).toBe(1);
    expect(m.notes).toBe(5);
    expect(m.annotators).toBe(2);
  });
  it('soft exceeds rec when pairs are not from one annotator', () => {
    const m = pigMetrics([1, 1], [[1, 2], [2, 1]]);
    expect(m.soft).toBe(1);
    expect(m.rec).toBe(0.5);
    expect(m.gen).toBe(0.5);
    expect(m.high).toBe(0.5);
  });
  it('charges one point per annotator switch, allowed only where they agree', () => {
    // A and B agree on note 1 (finger 2). Staying with B costs 1 (note 0); A then B costs 1 (the switch).
    const m = pigMetrics([1, 2, 4, 5], [[1, 2, 3, 3], [5, 2, 4, 5]]);
    expect(m.rec).toBe(0.75);
    expect(m.high).toBe(0.75);
    // With the switch made free, this would be 1; the edit cost is what distinguishes rec from soft.
    expect(m.soft).toBe(1);
  });
  it('recombines per hand when hands are given', () => {
    // Right-hand notes at indices 0 and 2, left-hand at 1 and 3.
    const golds: FingerSeq[] = [[1, 5, 2, 4], [3, 1, 2, 2]];
    const hands = ['R', 'L', 'R', 'L'] as const;
    const m = pigMetrics([1, 1, 2, 2], golds, [...hands]);
    // R sequence: pred [1,2]; A gives [1,2] -> both match. L sequence: pred [1,2]; B gives [1,2] -> both match.
    expect(m.rec).toBe(1);
    expect(pigMetrics([1, 1, 2, 2], golds).rec).toBeLessThan(1);
  });
  it('treats unassigned ground truth as a mismatch', () => {
    const m = pigMetrics([1, 2], [[1, undefined]]);
    expect(m.gen).toBe(0.5);
    expect(m.soft).toBe(0.5);
  });
  it('rejects length mismatches', () => {
    expect(() => pigMetrics([1], [[1, 2]])).toThrow(/length/);
  });
});
```

`packages/engine/src/eval/align.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parsePig } from '../io/pig/read.js';
import { alignScores, fingerSeq, metricsForScores } from './align.js';

const gold = `//Version: PianoFingering_v170101
0\t0\t0.5\tC4\t80\t80\t0\t1
1\t0.5\t1\tD4\t80\t80\t0\t2
2\t0\t1\tC3\t80\t80\t1\t-5
`;

describe('alignScores', () => {
  it('pairs notes by id when ids match', () => {
    const g = parsePig(gold);
    const p = parsePig(gold.replace('\t1\n', '\t3\n'));
    expect(alignScores(p.score, g.score)).toEqual([['0', '0'], ['2', '2'], ['1', '1']]);
  });
  it('falls back to onset, hand and pitch order when ids differ', () => {
    const g = parsePig(gold);
    const p = parsePig(gold.replace(/^(\d)\t/gm, (_m, d: string) => `${Number(d) + 10}\t`));
    expect(alignScores(p.score, g.score)).toEqual([['10', '0'], ['12', '2'], ['11', '1']]);
  });
  it('throws when note counts differ', () => {
    const g = parsePig(gold);
    const p = parsePig(gold.split('\n').slice(0, 3).join('\n') + '\n');
    expect(() => alignScores(p.score, g.score)).toThrow(/count/);
  });
});

describe('metricsForScores', () => {
  it('scores a prediction against several annotators', () => {
    const g1 = parsePig(gold);
    const g2 = parsePig(gold.replace('\t2\n', '\t3\n'));
    const pred = parsePig(gold.replace('\t2\n', '\t3\n'));
    const m = metricsForScores(pred, [g1, g2]);
    expect(m.high).toBe(1);
    expect(m.gen).toBeCloseTo((2 / 3 + 1) / 2);
    expect(m.soft).toBe(1);
    expect(fingerSeq(pred.score, pred.assignment)).toEqual([1, 5, 3]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @digitus2/engine test -- eval`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement metrics**

`packages/engine/src/eval/metrics.ts`:
```ts
import type { Finger, Hand } from '../score/types.js';

export type FingerSeq = Array<Finger | undefined>;

export interface PigMetrics {
  gen: number;
  high: number;
  soft: number;
  rec: number;
  notes: number;
  annotators: number;
}

export function matchRate(pred: FingerSeq, gold: FingerSeq): number {
  if (pred.length !== gold.length) throw new Error(`length mismatch: ${pred.length} vs ${gold.length}`);
  if (pred.length === 0) return 0;
  let hits = 0;
  for (let i = 0; i < pred.length; i++) if (gold[i] !== undefined && pred[i] === gold[i]) hits++;
  return hits / pred.length;
}

export function pigMetrics(pred: FingerSeq, golds: FingerSeq[], hands?: Hand[]): PigMetrics {
  if (golds.length === 0) throw new Error('at least one ground truth is required');
  for (const g of golds) if (g.length !== pred.length) throw new Error(`length mismatch: ${pred.length} vs ${g.length}`);
  const n = pred.length;
  const rates = golds.map((g) => matchRate(pred, g));
  const gen = rates.reduce((a, b) => a + b, 0) / rates.length;
  const high = Math.max(...rates);
  let softHits = 0;
  for (let i = 0; i < n; i++) if (golds.some((g) => g[i] !== undefined && g[i] === pred[i])) softHits++;
  const soft = n === 0 ? 0 : softHits / n;

  const groups: number[][] = [];
  if (hands && hands.length === n) {
    const byHand = new Map<Hand, number[]>();
    hands.forEach((h, i) => {
      if (!byHand.has(h)) byHand.set(h, []);
      byHand.get(h)!.push(i);
    });
    groups.push(...byHand.values());
  } else {
    groups.push(Array.from({ length: n }, (_, i) => i));
  }
  let recHits = 0;
  for (const idx of groups) recHits += recombinationHits(pred, golds, idx);
  const rec = n === 0 ? 0 : recHits / n;
  return { gen, high, soft, rec, notes: n, annotators: golds.length };
}

/**
 * Recombination hits along the note indices `idx`: N minus the minimum edit cost of a recombined
 * ground truth (Nakamura et al. 2020, App. A). A mismatch costs C_SUB = 1; switching annotators
 * costs C_REC = 1 and is only allowed where the two annotators agree at the switch point.
 * The switch-point index convention below (note t-1) must be checked against
 * research/fingering_eval/metrics.py, which matches the official evaluator; change it if they differ.
 */
function recombinationHits(pred: FingerSeq, golds: FingerSeq[], idx: number[]): number {
  if (idx.length === 0) return 0;
  const K = golds.length;
  const C_SUB = 1;
  const C_REC = 1;
  const miss = (k: number, t: number): number => {
    const g = golds[k]![idx[t]!];
    return g !== undefined && g === pred[idx[t]!] ? 0 : C_SUB;
  };
  let cost = Array.from({ length: K }, (_, k) => miss(k, 0));
  for (let t = 1; t < idx.length; t++) {
    const next = new Array<number>(K).fill(Number.POSITIVE_INFINITY);
    for (let k = 0; k < K; k++) {
      for (let kp = 0; kp < K; kp++) {
        let trans = 0;
        if (kp !== k) {
          trans = golds[kp]![idx[t - 1]!] === golds[k]![idx[t - 1]!] ? C_REC : Number.POSITIVE_INFINITY;
        }
        const v = cost[kp]! + trans;
        if (v < next[k]!) next[k] = v;
      }
      next[k] = next[k]! + miss(k, t);
    }
    cost = next;
  }
  return idx.length - Math.min(...cost);
}
```

- [ ] **Step 4: Implement alignment**

`packages/engine/src/eval/align.ts`:
```ts
import type { Assignment, Score } from '../score/types.js';
import { pigMetrics } from './metrics.js';
import type { FingerSeq, PigMetrics } from './metrics.js';

export function fingerSeq(score: Score, assignment: Assignment): FingerSeq {
  return score.notes.map((n) => assignment[n.id]?.finger);
}

/** Pairs each gold note with a predicted note: by id when every gold id exists in pred, else by (onsetSec, hand, midi) order. */
export function alignScores(pred: Score, gold: Score): Array<[string, string]> {
  if (pred.notes.length !== gold.notes.length) {
    throw new Error(`note count mismatch: prediction has ${pred.notes.length}, gold has ${gold.notes.length}`);
  }
  const predIds = new Set(pred.notes.map((n) => n.id));
  if (gold.notes.every((n) => predIds.has(n.id))) return gold.notes.map((n) => [n.id, n.id]);
  const key = (s: Score) => [...s.notes].sort((a, b) => a.onsetSec - b.onsetSec || (a.hand === b.hand ? 0 : a.hand === 'R' ? -1 : 1) || a.midi - b.midi);
  const p = key(pred);
  const g = key(gold);
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < g.length; i++) {
    if (p[i]!.midi !== g[i]!.midi) throw new Error(`pitch mismatch at gold note ${g[i]!.id}: ${p[i]!.midi} vs ${g[i]!.midi}`);
    pairs.push([p[i]!.id, g[i]!.id]);
  }
  const order = new Map(gold.notes.map((n, i) => [n.id, i]));
  return pairs.sort((a, b) => order.get(a[1])! - order.get(b[1])!);
}

export function metricsForScores(
  pred: { score: Score; assignment: Assignment },
  golds: Array<{ score: Score; assignment: Assignment }>,
): PigMetrics {
  const reference = golds[0];
  if (!reference) throw new Error('at least one ground truth is required');
  const pairs = alignScores(pred.score, reference.score);
  const predSeq: FingerSeq = pairs.map(([p]) => pred.assignment[p]?.finger);
  const hands = pairs.map(([, g]) => reference.score.notes.find((n) => n.id === g)!.hand);
  const goldSeqs: FingerSeq[] = golds.map((g) => {
    const gp = alignScores(g.score, reference.score);
    const map = new Map(gp.map(([a, b]) => [b, a]));
    return pairs.map(([, refId]) => g.assignment[map.get(refId)!]?.finger);
  });
  return pigMetrics(predSeq, goldSeqs, hands);
}
```
Add to `packages/engine/src/index.ts`:
```ts
export { matchRate, pigMetrics } from './eval/metrics.js';
export type { FingerSeq, PigMetrics } from './eval/metrics.js';
export { alignScores, fingerSeq, metricsForScores } from './eval/align.js';
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @digitus2/engine test -- eval && pnpm typecheck && pnpm lint`
Expected: all pass. If `research/fingering_eval/metrics.py` exists, also run its evaluate CLI on one PIG piece with one annotator as the prediction and compare with `metricsForScores` through a quick `tsx` script; note the result in the commit message.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/eval packages/engine/src/index.ts
git commit -m "feat(engine): PIG metrics (gen, high, soft, rec) and score alignment"
```

---

### Task 10: CLI: inspect and eval

**Files:**
- Create: `packages/engine/cli/main.ts`, `packages/engine/cli/inspect.ts`, `packages/engine/cli/evaluate.ts`, `packages/engine/cli/evaluate.test.ts`
- Modify: `packages/engine/package.json` (add script `"cli": "tsx cli/main.ts"`)

**Interfaces:**
- Consumes: `parseMusicXml`, `parsePig`, `metricsForScores`, `Score` from earlier tasks.
- Produces:
  - `digitus2 inspect <file>` prints title, composer, notes per hand, measures, duration in seconds, tempo, and the first five notes.
  - `digitus2 eval --pred <file|dir> --gold <file|dir> [--json]` prints per-piece and mean metrics.
  - `evaluateDirs(predPath: string, goldPath: string): EvalReport` where
    `interface EvalReport { pieces: Array<{ id: string; predFile: string; goldFiles: string[]; metrics: PigMetrics }>; mean: { gen: number; high: number; soft: number; rec: number }; noteWeighted: { gen: number; high: number; soft: number; rec: number } }`
  - File matching: a prediction file's piece id is the leading digits of its basename (`007_pred.txt` → `007`, `7.txt` → `7`, compared numerically); gold files for a piece are files in the gold directory (or its `FingeringFiles/` subdirectory when present) whose basename matches `^<id>-\d+_fingering\.txt$` with numeric id comparison. A prediction with no gold is reported and skipped.

- [ ] **Step 1: Write the failing test**

`packages/engine/cli/evaluate.test.ts`:
```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateDirs } from './evaluate.js';

const H = '//Version: PianoFingering_v170101\n';
const notes = (f: string[]) => H + f.map((x, i) => `${i}\t${i * 0.5}\t${i * 0.5 + 0.5}\tC4\t80\t80\t0\t${x}`).join('\n') + '\n';

describe('evaluateDirs', () => {
  it('matches predictions to gold files by piece id and averages', () => {
    const root = mkdtempSync(join(tmpdir(), 'digitus2-eval-'));
    const gold = join(root, 'gold', 'FingeringFiles');
    const pred = join(root, 'pred');
    mkdirSync(gold, { recursive: true });
    mkdirSync(pred, { recursive: true });
    writeFileSync(join(gold, '001-1_fingering.txt'), notes(['1', '2', '3', '4']));
    writeFileSync(join(gold, '001-2_fingering.txt'), notes(['1', '2', '3', '5']));
    writeFileSync(join(gold, '002-1_fingering.txt'), notes(['1', '2']));
    writeFileSync(join(pred, '001_pred.txt'), notes(['1', '2', '3', '5']));
    writeFileSync(join(pred, '2.txt'), notes(['1', '1']));
    writeFileSync(join(pred, '003.txt'), notes(['1']));
    const report = evaluateDirs(pred, join(root, 'gold'));
    expect(report.pieces.map((p) => p.id)).toEqual(['1', '2']);
    expect(report.pieces[0]!.goldFiles).toHaveLength(2);
    expect(report.pieces[0]!.metrics.high).toBe(1);
    expect(report.pieces[0]!.metrics.gen).toBeCloseTo(0.875);
    expect(report.pieces[1]!.metrics.gen).toBe(0.5);
    expect(report.mean.gen).toBeCloseTo((0.875 + 0.5) / 2);
    expect(report.noteWeighted.gen).toBeCloseTo((0.875 * 4 + 0.5 * 2) / 6);
    expect(report.skipped).toEqual(['003.txt']);
  });
});
```
(Add `skipped: string[]` to `EvalReport`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @digitus2/engine test -- evaluate`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/engine/cli/evaluate.ts`:
```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { metricsForScores } from '../src/eval/align.js';
import type { PigMetrics } from '../src/eval/metrics.js';
import { parsePig } from '../src/io/pig/read.js';

export interface EvalReport {
  pieces: Array<{ id: string; predFile: string; goldFiles: string[]; metrics: PigMetrics }>;
  skipped: string[];
  mean: { gen: number; high: number; soft: number; rec: number };
  noteWeighted: { gen: number; high: number; soft: number; rec: number };
}

const GOLD_NAME = /^(\d+)-(\d+)_fingering\.txt$/;

function listFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).filter((f) => f.endsWith('.txt')).map((f) => join(path, f)).sort();
}

function pieceId(file: string): string | undefined {
  const m = /^(\d+)/.exec(basename(file));
  return m ? String(Number(m[1])) : undefined;
}

export function evaluateDirs(predPath: string, goldPath: string): EvalReport {
  const goldDir = existsSync(join(goldPath, 'FingeringFiles')) ? join(goldPath, 'FingeringFiles') : goldPath;
  const goldFiles = listFiles(goldDir);
  const goldByPiece = new Map<string, string[]>();
  for (const f of goldFiles) {
    const m = GOLD_NAME.exec(basename(f));
    if (!m) continue;
    const id = String(Number(m[1]));
    if (!goldByPiece.has(id)) goldByPiece.set(id, []);
    goldByPiece.get(id)!.push(f);
  }
  const report: EvalReport = { pieces: [], skipped: [], mean: zero(), noteWeighted: zero() };
  let totalNotes = 0;
  for (const predFile of listFiles(predPath)) {
    const id = pieceId(predFile);
    const golds = id !== undefined ? goldByPiece.get(id) : undefined;
    if (!golds || golds.length === 0) {
      report.skipped.push(basename(predFile));
      continue;
    }
    const pred = parsePig(readFileSync(predFile, 'utf8'));
    const metrics = metricsForScores(pred, golds.map((g) => parsePig(readFileSync(g, 'utf8'))));
    report.pieces.push({ id: id!, predFile, goldFiles: golds, metrics });
    for (const k of ['gen', 'high', 'soft', 'rec'] as const) {
      report.mean[k] += metrics[k];
      report.noteWeighted[k] += metrics[k] * metrics.notes;
    }
    totalNotes += metrics.notes;
  }
  const count = report.pieces.length;
  for (const k of ['gen', 'high', 'soft', 'rec'] as const) {
    report.mean[k] = count ? report.mean[k] / count : 0;
    report.noteWeighted[k] = totalNotes ? report.noteWeighted[k] / totalNotes : 0;
  }
  return report;
}

function zero() {
  return { gen: 0, high: 0, soft: 0, rec: 0 };
}

export function formatReport(r: EvalReport): string {
  const pct = (x: number) => (100 * x).toFixed(2).padStart(6);
  const lines = ['piece    gen    high   soft   rec    notes'];
  for (const p of r.pieces) {
    lines.push(`${p.id.padEnd(6)} ${pct(p.metrics.gen)} ${pct(p.metrics.high)} ${pct(p.metrics.soft)} ${pct(p.metrics.rec)} ${String(p.metrics.notes).padStart(6)}`);
  }
  lines.push(`mean   ${pct(r.mean.gen)} ${pct(r.mean.high)} ${pct(r.mean.soft)} ${pct(r.mean.rec)}`);
  lines.push(`notes  ${pct(r.noteWeighted.gen)} ${pct(r.noteWeighted.high)} ${pct(r.noteWeighted.soft)} ${pct(r.noteWeighted.rec)}`);
  if (r.skipped.length) lines.push(`skipped (no gold): ${r.skipped.join(', ')}`);
  return lines.join('\n');
}
```

`packages/engine/cli/inspect.ts`:
```ts
import { readFileSync } from 'node:fs';
import { parseMusicXml } from '../src/io/musicxml/read.js';
import { parsePig } from '../src/io/pig/read.js';
import type { Score } from '../src/score/types.js';

export function loadScore(file: string): Score {
  if (/\.txt$/i.test(file)) return parsePig(readFileSync(file, 'utf8'), { source: file }).score;
  return parseMusicXml(readFileSync(file), { source: file }).score;
}

export function describeScore(score: Score): string {
  const right = score.notes.filter((n) => n.hand === 'R').length;
  const left = score.notes.length - right;
  const end = score.notes.reduce((m, n) => Math.max(m, n.offsetSec), 0);
  const lines = [
    `title:     ${score.meta.title ?? '-'}`,
    `composer:  ${score.meta.composer ?? '-'}`,
    `notes:     ${score.notes.length} (right ${right}, left ${left})`,
    `measures:  ${score.measures.length}`,
    `duration:  ${end.toFixed(1)} s`,
    `tempo:     ${score.tempoMap.map((t) => `${t.qpm} qpm @${t.tick}`).join(', ')}`,
    'first notes:',
  ];
  for (const n of score.notes.slice(0, 5)) {
    lines.push(`  ${n.id.padEnd(6)} ${n.hand} midi ${n.midi} tick ${n.onsetTick}-${n.offsetTick} (${n.onsetSec.toFixed(3)} s)`);
  }
  return lines.join('\n');
}
```

`packages/engine/cli/main.ts`:
```ts
#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { evaluateDirs, formatReport } from './evaluate.js';
import { describeScore, loadScore } from './inspect.js';

const USAGE = `digitus2 <command>

  inspect <file>                        summarize a MusicXML (.musicxml/.xml/.mxl) or PIG (.txt) file
  eval --pred <path> --gold <path>      score PIG predictions against PIG ground truth [--json]
`;

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (command === 'inspect') {
    const file = rest[0];
    if (!file) {
      process.stderr.write(USAGE);
      return 2;
    }
    process.stdout.write(describeScore(loadScore(file)) + '\n');
    return 0;
  }
  if (command === 'eval') {
    const { values } = parseArgs({ args: rest, options: { pred: { type: 'string' }, gold: { type: 'string' }, json: { type: 'boolean' } } });
    if (!values.pred || !values.gold) {
      process.stderr.write(USAGE);
      return 2;
    }
    const report = evaluateDirs(values.pred, values.gold);
    process.stdout.write((values.json ? JSON.stringify(report, null, 2) : formatReport(report)) + '\n');
    return 0;
  }
  process.stderr.write(USAGE);
  return 2;
}

process.exitCode = main(process.argv.slice(2));
```
Add to `packages/engine/package.json` scripts: `"cli": "tsx cli/main.ts"`.

- [ ] **Step 4: Run the tests and try the CLI**

Run:
```bash
pnpm --filter @digitus2/engine test -- evaluate
pnpm --filter @digitus2/engine cli inspect packages/engine/fixtures/two-staff.musicxml
pnpm --filter @digitus2/engine cli inspect packages/engine/fixtures/pig-sample.txt
pnpm typecheck && pnpm lint && pnpm build
```
Expected: test passes; both inspect commands print summaries; build emits `packages/engine/dist/cli/main.js`. (Paths given to the CLI are relative to the package directory when run through `pnpm --filter`; adjust to `fixtures/...` if needed.)

- [ ] **Step 5: Commit**

```bash
git add packages/engine/cli packages/engine/package.json
git commit -m "feat(engine): CLI with inspect and PIG eval commands"
```

---

### Task 11: Package documentation and foundation wrap-up

**Files:**
- Create: `packages/engine/README.md`
- Modify: `docs/PROGRESS.md` (M1 row and log entry), `README.md` (root: add the CLI example)

- [ ] **Step 1: Write the engine README**

`packages/engine/README.md`:
```markdown
# @digitus2/engine

Pure TypeScript piano-fingering engine: score model, MusicXML and PIG readers and writers, PIG metrics, and a CLI. No DOM dependency; runs in Node 22 and in the browser.

## API

- `parseMusicXml(input, { source? })` → `{ score, editorial, warnings }` — accepts text, bytes, or a `.mxl` archive.
- `injectFingerings(xml, score, assignment, { replace? })` → MusicXML text with `<fingering>` elements.
- `parsePig(text)` / `writePig(score, assignment)` — the PIG text format (Nakamura, Saito, Yoshii 2020).
- `pigMetrics(pred, golds, hands?)` and `metricsForScores(pred, golds)` — general, highest, soft and recombination match rates.
- `handEvents(score, hand)` — notes grouped into simultaneous events per hand (the solver's input).

## CLI

```bash
pnpm --filter @digitus2/engine cli inspect fixtures/two-staff.musicxml
pnpm --filter @digitus2/engine cli eval --pred ../../research/baselines/outputs/<name> --gold ../../research/data/pig
```

## Tests

`pnpm --filter @digitus2/engine test`
```

- [ ] **Step 2: Update the journal**

In `docs/PROGRESS.md` set the M1 row to `done` with the commit range, and append a log line: `YYYY-MM-DD: M1 foundation complete — engine package with score model, PIG and MusicXML IO, metrics, CLI; N tests passing.` (fill in the real date and test count from `pnpm test`).

- [ ] **Step 3: Verify the whole workspace**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/engine/README.md docs/PROGRESS.md README.md
git commit -m "docs: engine README and M1 progress"
```

---

## Self-review notes

- Spec coverage: section 4 (layout, boundaries) → Tasks 1, 3; section 5 (score model) → Task 3 (`tiedFrom` became `sourceIndices`, which also serves the writer; `velocity` added for PIG and MIDI); section 6 MusicXML reader → Tasks 5–7, writer (injection path) → Task 8, PIG → Task 4; generated MusicXML from a Score (needed for MIDI input) is deferred to the M6 plan with the MIDI reader; section 8.1 metrics → Task 9 and the CLI → Task 10; section 11 CI → Task 1.
- Type consistency: `Note.sourceIndices`, `Assignment` as `Record<string, FingerAssignment>`, `ParsedMusicXml`, `ParsedPig`, `PigMetrics`, `EvalReport` are used with the same names in every task.
- Review Focus items 1–5 are pinned by the named tests in Tasks 4, 5, 6 and 7.
- The recombination metric definition is stated in Task 9 and is to be reconciled with the Python implementation cross-checked against the official evaluation code; that reconciliation is an explicit step, not an open question.
