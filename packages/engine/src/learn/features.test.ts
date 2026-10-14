import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePig } from '../io/pig/read.js';
import { parseMusicXml } from '../io/musicxml/read.js';
import { makeContext, PARNCUTT_WEIGHTS } from '../fingering/rules.js';
import { HAND_PROFILES } from '../fingering/spans.js';
import { buildHandSequence } from '../fingering/sequence.js';
import { solveFingering, solveHand } from '../fingering/solve.js';
import { detectRuns, matchTemplates, TEXTBOOK_TEMPLATES } from '../fingering/templates.js';
import type { Finger, Hand, Score } from '../score/types.js';
import {
  addScaled,
  dot,
  featureIds,
  pathFeatures,
  squaredNorm,
  subtract,
  zeroVector,
} from './features.js';
import { Lcg } from './lcg.js';

const fixture = fileURLToPath(new URL('../../fixtures/pig-sample.txt', import.meta.url));
const ctx = makeContext(HAND_PROFILES.large);

describe('pathFeatures', () => {
  it('the solver cost equals weights · pathFeatures of the solved path, both hands, PIG sample', () => {
    const { score } = parsePig(readFileSync(fixture, 'utf8'));
    for (const hand of ['R', 'L'] as const) {
      const seq = buildHandSequence(score, hand);
      const { fingers, cost } = solveHand(seq, ctx);
      expect(Number.isFinite(cost)).toBe(true);
      expect(dot(ctx.weights, pathFeatures(seq, ctx, fingers))).toBeCloseTo(cost, 9);
    }
  });
  it('the identity also holds on a MusicXML piece with chords and grace notes', () => {
    const xml = readFileSync(
      fileURLToPath(new URL('../../fixtures/two-staff.musicxml', import.meta.url)),
      'utf8',
    );
    const { score } = parseMusicXml(xml);
    for (const hand of ['R', 'L'] as const) {
      const seq = buildHandSequence(score, hand);
      const { fingers, cost } = solveHand(seq, ctx);
      expect(dot(ctx.weights, pathFeatures(seq, ctx, fingers))).toBeCloseTo(cost, 9);
    }
  });
  it('a worse path has a higher dot product than the optimum', () => {
    const { score } = parsePig(readFileSync(fixture, 'utf8'));
    const seq = buildHandSequence(score, 'R');
    const { fingers, cost } = solveHand(seq, ctx);
    const worse = fingers.map((f, i) =>
      i % 7 === 3 ? ((((f + 1) % 5) + 1) as 1 | 2 | 3 | 4 | 5) : f,
    );
    expect(dot(ctx.weights, pathFeatures(seq, ctx, worse))).toBeGreaterThanOrEqual(cost);
  });
  it('featureIds is sorted and stable, and the vector helpers are consistent', () => {
    const ids = featureIds(ctx);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toEqual(Object.keys(PARNCUTT_WEIGHTS).sort());
    const z = zeroVector(ctx);
    expect(Object.values(z).every((v) => v === 0)).toBe(true);
    const a = { ...z, stretch: 2, hop: 1 } as typeof z;
    const b = { ...z, stretch: 0.5 } as typeof z;
    expect(subtract(a, b).stretch).toBe(1.5);
    expect(squaredNorm(subtract(a, b))).toBeCloseTo(1.5 * 1.5 + 1, 12);
  });
});

describe('solveHand unaryExtra', () => {
  it('a large bonus on one finger forces it, and the returned cost excludes the extra', () => {
    const { score } = parsePig(readFileSync(fixture, 'utf8'));
    const seq = buildHandSequence(score, 'R');
    const base = solveHand(seq, ctx);
    const i = 2;
    const want = base.fingers[i] === 5 ? 4 : 5;
    const forced = solveHand(seq, ctx, {
      pinned: new Map(),
      forbidden: new Map(),
      soft: false,
      unaryExtra: (k, f) => (k === i && f === want ? -1000 : 0),
    });
    expect(forced.fingers[i]).toBe(want);
    expect(forced.cost).toBeCloseTo(dot(ctx.weights, pathFeatures(seq, ctx, forced.fingers)), 9);
  });
});

// Additional tests (beyond the plan's Step 1): the identity against the engine as it is after the
// M2 hardening (template bonus, chord-pair triple terms, the penalty-only chord slot, held-note
// penalties on top of the terms) and the vector helpers.

const H = '//Version: PianoFingering_v170101\n';
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nameOf = (midi: number): string => NAMES[midi % 12]! + (Math.floor(midi / 12) - 1);
interface Row {
  on: number;
  off: number;
  midi: number;
  ch: 0 | 1;
}
/** A PIG text from rows (sorted by onset, then channel, then pitch; ids renumbered). */
function pig(rows: Row[]): string {
  const sorted = [...rows].sort((a, b) => a.on - b.on || a.ch - b.ch || a.midi - b.midi);
  return (
    H +
    sorted
      .map((r, i) => `${i}\t${r.on}\t${r.off}\t${nameOf(r.midi)}\t80\t80\t${r.ch}\t0`)
      .join('\n') +
    '\n'
  );
}
/** A legato melody (each note released exactly at the next onset: no holds, no rests). */
const legato = (midis: number[], dur = 0.25, ch: 0 | 1 = 0): Row[] =>
  midis.map((midi, k) => ({ on: k * dur, off: (k + 1) * dur, midi, ch }));

/**
 * A random two-hand piece of `events` onsets per hand: single notes and chords of two or three
 * notes (steps of 3 to 5 semitones), every note released at the hand's next onset, so the
 * optimal path pays no held-note penalty.
 */
function randomPiece(seed: number, events: number): Row[] {
  const rnd = new Lcg(seed);
  const rows: Row[] = [];
  for (const [ch, lo] of [
    [0, 60],
    [1, 40],
  ] as const) {
    let t = 0;
    let p = lo + 7;
    for (let e = 0; e < events; e++) {
      const dur = [0.125, 0.25, 0.5][rnd.int(3)]!;
      p = Math.max(lo, Math.min(lo + 20, p + rnd.int(9) - 4));
      const size = rnd.next() < 0.3 ? 2 + rnd.int(2) : 1;
      let q = p;
      for (let k = 0; k < size; k++) {
        rows.push({ on: t, off: t + dur, midi: q, ch });
        q += 3 + rnd.int(3);
      }
      t += dur;
    }
  }
  return rows;
}

const templatesOf = (score: Score, hand: Hand) => {
  const seq = buildHandSequence(score, hand);
  return { seq, templates: matchTemplates(seq, detectRuns(seq), TEXTBOOK_TEMPLATES[hand]) };
};

/** Every finger path of length n in lexicographic order. */
function* allPaths(n: number): Generator<Finger[]> {
  const path = new Array<Finger>(n).fill(1);
  for (;;) {
    yield [...path];
    let k = n - 1;
    while (k >= 0 && path[k] === 5) path[k--] = 1;
    if (k < 0) return;
    path[k] = (path[k]! + 1) as Finger;
  }
}

describe('pathFeatures against the hardened engine', () => {
  it('counts the template bonus: scale (1 point) and chromatic (chromaticTemplatePoints) runs', () => {
    for (const [midis, points] of [
      [[60, 62, 64, 65, 67, 69, 71, 72], 1],
      [[60, 61, 62, 63, 64, 65, 66, 67], ctx.chromaticTemplatePoints],
    ] as const) {
      const { score } = parsePig(pig(legato([...midis], 0.125)));
      const { seq, templates } = templatesOf(score, 'R');
      expect(templates).toHaveLength(1);
      const m = templates[0]!;
      const { fingers, cost } = solveHand(seq, ctx, undefined, templates);
      const phi = pathFeatures(seq, ctx, fingers, templates);
      expect(dot(ctx.weights, phi)).toBeCloseTo(cost, 9);
      // The textbook path earns the bonus on every note of the match, and only with the matches.
      const textbook = seq.notes.map((_, k) => m.fingers[k - m.start] ?? fingers[k]!);
      expect(pathFeatures(seq, ctx, textbook, templates).template).toBe(
        -points * (m.end - m.start + 1),
      );
      expect(pathFeatures(seq, ctx, textbook).template).toBe(0);
      // Without the matches the solver and the features agree too.
      const plain = solveHand(seq, ctx);
      expect(dot(ctx.weights, pathFeatures(seq, ctx, plain.fingers))).toBeCloseTo(plain.cost, 9);
    }
  });
  it('the decoder minimises weights · pathFeatures over every path of a six-note scale run', () => {
    const { score } = parsePig(pig(legato([60, 62, 64, 65, 67, 69])));
    const { seq, templates } = templatesOf(score, 'R');
    expect(templates).toHaveLength(1);
    const { fingers, cost } = solveHand(seq, ctx, undefined, templates);
    let best = Number.POSITIVE_INFINITY;
    let paths = 0;
    for (const path of allPaths(seq.notes.length)) {
      best = Math.min(best, dot(ctx.weights, pathFeatures(seq, ctx, path, templates)));
      paths++;
    }
    expect(paths).toBe(5 ** 6);
    expect(cost).toBeCloseTo(best, 9);
    expect(dot(ctx.weights, pathFeatures(seq, ctx, fingers, templates))).toBeCloseTo(cost, 9);
  });
  it('holds on random two-hand pieces with chords, templates on, through solveHand', () => {
    for (const seed of [1, 2, 3]) {
      const { score } = parsePig(pig(randomPiece(seed, 120)));
      for (const hand of ['R', 'L'] as const) {
        const { seq, templates } = templatesOf(score, hand);
        expect(seq.notes.some((n, k) => k > 1 && seq.notes[k - 2]!.slice === n.slice)).toBe(true);
        const { fingers, cost } = solveHand(seq, ctx, undefined, templates);
        expect(Number.isFinite(cost)).toBe(true);
        const phi = pathFeatures(seq, ctx, fingers, templates);
        expect(dot(ctx.weights, phi)).toBeCloseTo(cost, 9);
        expect(phi.chordStretch + phi.chordSmallSpan + phi.chordLargeSpan).toBeGreaterThan(0);
      }
    }
  });
  it('holds against solveFingering (templates, chord loop, held-note loop) when no penalty is paid', () => {
    const xml = readFileSync(
      fileURLToPath(new URL('../../fixtures/two-staff.musicxml', import.meta.url)),
      'utf8',
    );
    const scores = [parseMusicXml(xml).score, parsePig(pig(randomPiece(4, 150))).score];
    for (const score of scores) {
      const result = solveFingering(score);
      for (const sol of result.hands) {
        const { seq, templates } = templatesOf(score, sol.hand);
        const fingers = seq.notes.map((n) => result.assignment[n.noteId]!.finger);
        expect(dot(ctx.weights, pathFeatures(seq, ctx, fingers, templates))).toBeCloseTo(
          sol.cost,
          9,
        );
        // The explanations carry the same terms, note by note.
        const explained = seq.notes.reduce(
          (s, n) => s + result.explanations[n.noteId]!.terms.reduce((t, x) => t + x.weighted, 0),
          0,
        );
        expect(explained).toBeCloseTo(sol.cost, 9);
      }
    }
  });
  it('a held-note conflict pays its penalty on top of the terms, which Phi keeps', () => {
    // C4 still sounds when E4 starts; both pinned to finger 2 break the held-note law.
    const { score } = parsePig(
      pig([
        { on: 0, off: 1, midi: 60, ch: 0 },
        { on: 0.5, off: 1, midi: 64, ch: 0 },
      ]),
    );
    const seq = buildHandSequence(score, 'R');
    const pinned = new Map<number, Finger>([
      [0, 2],
      [1, 2],
    ]);
    const { fingers, cost } = solveHand(seq, ctx, { pinned, forbidden: new Map(), soft: false });
    expect(fingers).toEqual([2, 2]);
    const phi = pathFeatures(seq, ctx, fingers);
    expect(phi.hop).toBeGreaterThan(0);
    expect(cost - dot(ctx.weights, phi)).toBeCloseTo(1000, 9);
  });
  it('a soft decode charges the chord-order penalty alone, without terms, on one finger two apart in a chord', () => {
    // C4 E4 G4 pinned 2 3 2: the pair E4-G4 pays the penalty plus its terms, the outer pair C4-G4
    // (one finger on notes two apart) the penalty alone.
    const { score } = parsePig(
      pig([60, 64, 67].map((midi) => ({ on: 0, off: 1, midi, ch: 0 as const }))),
    );
    const seq = buildHandSequence(score, 'R');
    const pinned = new Map<number, Finger>([
      [0, 2],
      [1, 3],
      [2, 2],
    ]);
    const hard = solveHand(seq, ctx, { pinned, forbidden: new Map(), soft: false });
    expect(hard.cost).toBe(Number.POSITIVE_INFINITY);
    const { fingers, cost } = solveHand(seq, ctx, { pinned, forbidden: new Map(), soft: true });
    expect(fingers).toEqual([2, 3, 2]);
    const phi = pathFeatures(seq, ctx, fingers);
    expect(cost - dot(ctx.weights, phi)).toBeCloseTo(2000, 9);
  });
  it('rejects a finger list of the wrong length', () => {
    const { score } = parsePig(readFileSync(fixture, 'utf8'));
    const seq = buildHandSequence(score, 'R');
    expect(() => pathFeatures(seq, ctx, [1, 2])).toThrow(/3 notes/);
  });
});

describe('vector helpers', () => {
  it('addScaled accumulates in place, dot is linear, subtract is a - b', () => {
    const z = zeroVector(ctx);
    const a = { ...z, hop: 2, template: -3 };
    const b = { ...z, hop: 1, stretch: 4 };
    const acc = zeroVector(ctx);
    addScaled(acc, a, 2);
    addScaled(acc, b, -1);
    expect(acc.hop).toBe(3);
    expect(acc.template).toBe(-6);
    expect(acc.stretch).toBe(-4);
    expect(dot(ctx.weights, acc)).toBeCloseTo(2 * dot(ctx.weights, a) - dot(ctx.weights, b), 12);
    expect(subtract(a, b)).toEqual({ ...z, hop: 1, template: -3, stretch: -4 });
    expect(squaredNorm(z)).toBe(0);
    expect(Object.keys(subtract(a, b))).toEqual(featureIds(ctx));
  });
  it('dot fails loudly on a nonzero feature without a weight', () => {
    const phi = { ...zeroVector(ctx), unknownRule: 1 } as unknown as ReturnType<typeof zeroVector>;
    expect(() => dot(ctx.weights, phi)).toThrow(/unknownRule/);
  });
});
