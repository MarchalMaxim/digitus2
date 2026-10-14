import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePig } from '../io/pig/read.js';
import { parseMusicXml } from '../io/musicxml/read.js';
import { isPenaltyRule, makeContext, PARNCUTT_WEIGHTS, RULE_IDS } from './rules.js';
import { HAND_PROFILES } from './spans.js';
import { buildHandSequence } from './sequence.js';
import { solveFingering, solveHand } from './solve.js';
import { pathFeatures } from '../learn/features.js';
import parncutt from './params/weights-parncutt.json' with { type: 'json' };

// The plan reads the weight ids as the file's top-level keys minus `_`-prefixed comments; the
// weight files of the engine keep them under `weights`, next to `provenance`.
const weightIds = (file: unknown): string[] =>
  Object.keys((file as { weights: Record<string, number> }).weights).sort();

describe('rule id consistency', () => {
  it('every rule id produced by the term functions is a key of every weight file, and vice versa', () => {
    const { score } = parsePig(
      readFileSync(
        fileURLToPath(new URL('../../fixtures/pig-sample.txt', import.meta.url)),
        'utf8',
      ),
    );
    const ctx = makeContext(HAND_PROFILES.large);
    const produced = new Set<string>();
    for (const hand of ['R', 'L'] as const) {
      const seq = buildHandSequence(score, hand);
      for (let trial = 0; trial < 5; trial++) {
        const fingers = seq.notes.map(
          (_, i) => (((i * 7 + trial * 3) % 5) + 1) as 1 | 2 | 3 | 4 | 5,
        );
        for (const [k, v] of Object.entries(pathFeatures(seq, ctx, fingers)))
          if (v !== 0) produced.add(k);
      }
    }
    for (const id of produced) expect(RULE_IDS).toContain(id);
    expect(weightIds(parncutt)).toEqual([...RULE_IDS]);
    expect(RULE_IDS.length).toBeGreaterThanOrEqual(24 + 10 + 50 + 10 + 2 + 3);
  });
  it('the Parncutt set gives every new feature weight 0 and marks penalty rules', () => {
    for (const id of RULE_IDS)
      if (
        id.startsWith('on:') ||
        id.startsWith('tr:') ||
        id.startsWith('ch:') ||
        ['latticeStep', 'levelChange', 'stretchFast', 'shiftFast', 'repeatFast'].includes(id)
      )
        expect(PARNCUTT_WEIGHTS[id]).toBe(0);
    expect(isPenaltyRule('stretch')).toBe(true);
    expect(isPenaltyRule('tr:13:up')).toBe(false);
    expect(isPenaltyRule('template')).toBe(false);
  });
  it('with the Parncutt set the solver output is unchanged (regression against M2)', () => {
    const { score } = parsePig(
      readFileSync(
        fileURLToPath(new URL('../../fixtures/pig-sample.txt', import.meta.url)),
        'utf8',
      ),
    );
    const ctx = makeContext(HAND_PROFILES.large);
    const r = solveHand(buildHandSequence(score, 'R'), ctx);
    expect(r.fingers).toEqual(
      JSON.parse(
        readFileSync(
          fileURLToPath(new URL('../../fixtures/pig-sample.parncutt-R.json', import.meta.url)),
          'utf8',
        ),
      ),
    );
  });
});

// Additional tests (beyond the plan's Step 1).

describe('rule id consistency, every weight file and the whole path', () => {
  it('every weights-*.json under params/ names exactly RULE_IDS, each with a finite weight', () => {
    const dir = fileURLToPath(new URL('./params/', import.meta.url));
    const files = readdirSync(dir).filter((f) => /^weights-.*\.json$/.test(f));
    expect(files).toContain('weights-parncutt.json');
    for (const f of files) {
      const file = JSON.parse(readFileSync(dir + f, 'utf8')) as unknown;
      expect(weightIds(file), f).toEqual([...RULE_IDS]);
      const w = (file as { weights: Record<string, number> }).weights;
      for (const id of RULE_IDS) expect(Number.isFinite(w[id]), `${f} ${id}`).toBe(true);
    }
  });
  it('every M3 feature is produced by some path, so none is a dead id', () => {
    // A two-staff piece with chords, black keys, leaps, a fast repeated key and fast stretches.
    const H = '//Version: PianoFingering_v170101\n';
    const rows = [
      [0, 0.1, 'C4'],
      [0.1, 0.2, 'C4'],
      [0.2, 0.3, 'C#4'],
      [0.3, 0.4, 'G4'],
      [0.4, 0.5, 'C5'],
      [0.5, 1.0, 'E4'],
      [0.5, 1.0, 'G4'],
      [0.5, 1.0, 'B4'],
      [1.0, 1.1, 'D4'],
      [1.1, 1.2, 'F#5'],
      [1.2, 1.5, 'A4'],
      [1.5, 2.0, 'D4'],
    ] as const;
    const text =
      H +
      rows.map(([on, off, n], i) => `${i}\t${on}\t${off}\t${n}\t80\t80\t0\t0`).join('\n') +
      '\n';
    const seq = buildHandSequence(parsePig(text).score, 'R');
    const ctx = makeContext(HAND_PROFILES.large);
    const produced = new Set<string>();
    for (let trial = 0; trial < 400; trial++) {
      let s = trial * 2654435761;
      const fingers = seq.notes.map(() => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return ((s >>> 16) % 5) + 1;
      }) as Array<1 | 2 | 3 | 4 | 5>;
      for (const [k, v] of Object.entries(pathFeatures(seq, ctx, fingers)))
        if (v !== 0) produced.add(k);
    }
    for (const id of produced) expect(RULE_IDS).toContain(id);
    for (const id of ['latticeStep', 'levelChange', 'stretchFast', 'shiftFast', 'repeatFast'])
      expect(produced, id).toContain(id);
    for (const prefix of ['on:', 'tr:', 'ch:'])
      expect(
        [...produced].some((id) => id.startsWith(prefix)),
        prefix,
      ).toBe(true);
  });
  it('with the Parncutt set solveFingering keeps its M2 output on the two-staff fixture', () => {
    // Pinned from the engine before M3 Task 1 (fingers in sequence order, decoded hand costs).
    const xml = readFileSync(
      fileURLToPath(new URL('../../fixtures/two-staff.musicxml', import.meta.url)),
      'utf8',
    );
    const { score } = parseMusicXml(xml);
    const r = solveFingering(score);
    const fingersOf = (hand: 'R' | 'L') =>
      buildHandSequence(score, hand).notes.map((n) => r.assignment[n.noteId]!.finger);
    expect(fingersOf('R')).toEqual([2, 3, 4, 5, 2, 3, 2, 1, 5, 1, 2]);
    expect(fingersOf('L')).toEqual([1, 4, 1, 1, 1]);
    expect(r.hands.map((h) => [h.hand, h.cost, h.iterations, h.relaxed])).toEqual([
      ['R', 71, 1, false],
      ['L', 32, 1, false],
    ]);
  });
});
