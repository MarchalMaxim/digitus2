import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../io/musicxml/read.js';
import { parsePig } from '../io/pig/read.js';
import { lintFingering } from '../lint/index.js';
import type { Finger, Hand, Score } from '../score/types.js';
import { forEachHold } from './reach.js';
import {
  chordSpanTerms,
  makeContext,
  pairTerms,
  tripleTerms,
  unaryTerms,
  weightedSum,
} from './rules.js';
import { buildHandSequence } from './sequence.js';
import type { SeqNote } from './sequence.js';
import { solveFingering, solveHand } from './solve.js';
import { HAND_PROFILES, span } from './spans.js';

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

// Scale goldens run in sixteenths at quarter = 120 (IOI 0.125 s) and in quarters (IOI 0.5 s).
// Under the planned rules a slow same-finger hop (IOI >= hopFastSec, 0.25 s) cost only
// 0.5 x 3 = 1.5 and the hop paths won at IOI 0.5 s (right hand 1 2 2 1 1 2 3 4 cost 12 against 18
// for 1 2 3 1 2 3 4 5; left hand 5 4 3 2 2 1 1 2 cost 13 against 21). The M2 review fixed the hop
// rule: weight 10, and a hop within a perfect fourth costs 2 points at any tempo, so each of those
// hops costs 20 and the textbook paths are the optimum at both tempos.
const SIXTEENTH = 0.125;
const RH_C_MAJOR = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const LH_C_MAJOR = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4'];

describe('solveFingering on textbook cases', () => {
  it('fingers the right-hand C major scale 1 2 3 1 2 3 4 5', () => {
    expect(fingersOf(melody(RH_C_MAJOR, 0, SIXTEENTH), 'R')).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
  });
  it('fingers the left-hand C major scale ascending 5 4 3 2 1 3 2 1 (mirror of the right hand)', () => {
    expect(fingersOf(melody(LH_C_MAJOR, 1, SIXTEENTH), 'L')).toEqual([5, 4, 3, 2, 1, 3, 2, 1]);
  });
  // At IOI 0.5 s the planned rules preferred slow hops (see above); the Task 8 template bonus closed
  // the right-hand case, and the left-hand case was an `it.fails` known gap (5 4 3 2 1 1 2 2 cost
  // 16 - 12 = 4 against 21 - 16 = 5). The M2 review hop rule closes both.
  it('right-hand C major scale at IOI 0.5 s is 1 2 3 1 2 3 4 5 (Task 8 templates)', () => {
    expect(fingersOf(melody(RH_C_MAJOR, 0), 'R')).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
  });
  it('left-hand C major scale at IOI 0.5 s is 5 4 3 2 1 3 2 1 (former known gap)', () => {
    expect(fingersOf(melody(LH_C_MAJOR, 1), 'L')).toEqual([5, 4, 3, 2, 1, 3, 2, 1]);
  });
  it('left-hand C major scale over two octaves at quarter = 120, both directions', () => {
    const twoOctaves = ['C2', 'D2', 'E2', 'F2', 'G2', 'A2', 'B2', ...LH_C_MAJOR];
    expect(fingersOf(melody(twoOctaves, 1), 'L')).toEqual([
      5, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1,
    ]);
    expect(fingersOf(melody([...twoOctaves].reverse(), 1), 'L')).toEqual([
      1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 5,
    ]);
  });
  it('left-hand arpeggios over two octaves at quarter = 120 take a textbook fingering', () => {
    // C major: the textbook gives 5 4 2 1 4 2 1 and accepts 5 3 2 1 3 2 1; A minor: 5 4 2 1 4 2 1.
    const cMajor = fingersOf(melody(['C2', 'E2', 'G2', 'C3', 'E3', 'G3', 'C4'], 1), 'L');
    expect([
      [5, 4, 2, 1, 4, 2, 1],
      [5, 3, 2, 1, 3, 2, 1],
    ]).toContainEqual(cMajor);
    expect(fingersOf(melody(['A2', 'C3', 'E3', 'A3', 'C4', 'E4', 'A4'], 1), 'L')).toEqual([
      5, 4, 2, 1, 4, 2, 1,
    ]);
    expect(fingersOf(melody(['A4', 'E4', 'C4', 'A3', 'E3', 'C3', 'A2'], 1), 'L')).toEqual([
      1, 2, 4, 1, 2, 4, 5,
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
  it('the held-note loop removes a conflict the decoder alone cannot see', () => {
    // C4 held for 2 s under G4 A4 B4 C5 D5 E5 in sixteenths. Without the loop the optimum passes the
    // thumb under to C5 (three steps after C4) while C4 still sounds under the thumb.
    const rows = [line(0, 0, 2, 'C4', 0)];
    ['G4', 'A4', 'B4', 'C5', 'D5', 'E5'].forEach((p, k) =>
      rows.push(line(k + 1, SIXTEENTH * (k + 1), SIXTEENTH * (k + 2), p, 0)),
    );
    const { score } = parsePig(H + rows.join('\n') + '\n');
    const heldId = score.notes[0]!.id;
    const reuses = (a: Record<string, { finger: number }>) =>
      score.notes.slice(1).filter((n) => a[n.id]!.finger === a[heldId]!.finger).length;
    // `lawDomains: false` turns off the pass that forbids from the start the fingers no
    // law-keeping fingering can use (M2 hardening fix), so the loop alone has to find this.
    const loopOnly = { hands: ['R'] as Hand[], lawDomains: false };
    const noLoop = solveFingering(score, { ...loopOnly, maxHeldIterations: 1 });
    expect(reuses(noLoop.assignment)).toBeGreaterThan(0); // the fixture really needs the loop
    const { assignment, hands } = solveFingering(score, loopOnly);
    expect(reuses(assignment)).toBe(0);
    expect(hands[0]!.iterations).toBeGreaterThan(1);
    expect(hands[0]!.relaxed).toBe(false);
    // With the pass on (the default) the first decode already keeps the thumb off C5.
    const prepass = solveFingering(score, { hands: ['R'], maxHeldIterations: 1 });
    expect(reuses(prepass.assignment)).toBe(0);
    expect(prepass.hands[0]!.relaxed).toBe(false);
  });
  it('a pin on a later note moves the held note off the pinned finger instead of relaxing', () => {
    // Same held C4; the thumb is pinned on B4, four steps later, while C4 still sounds.
    const rows = [line(0, 0, 4, 'C4', 0)];
    ['G4', 'A4', 'B4', 'C5', 'D5', 'E5'].forEach((p, k) =>
      rows.push(line(k + 1, 0.5 * (k + 1), 0.5 * (k + 2), p, 0)),
    );
    const { score } = parsePig(H + rows.join('\n') + '\n');
    const b4 = score.notes.find((n) => n.midi === 71)!.id;
    const { assignment, hands } = solveFingering(score, {
      hands: ['R'],
      pins: { [b4]: { finger: 1, source: 'user', pinned: true } },
    });
    expect(assignment[b4]).toMatchObject({ finger: 1, pinned: true, source: 'user' });
    const held = assignment[score.notes[0]!.id]!.finger;
    for (const n of score.notes.slice(1)) expect(assignment[n.id]!.finger).not.toBe(held);
    expect(hands[0]!.relaxed).toBe(false);
    expect(Number.isFinite(hands[0]!.cost)).toBe(true);
  });
  it('a bass held a bar under a four-note chord keeps its own finger, bar after bar', () => {
    // M2 review blocker (Satie, Gymnopedie No. 1): forbidding only the later note's finger let the
    // decoder move the bass to that finger's neighbour, which was forbidden next, until the hard
    // decode had no finite path and the solver fell back to a relaxed fingering with L03 errors.
    // Here C3 is held for a bar of 1.5 s; E3 G3 A3 C4 come in on the second beat while it sounds.
    const rows: string[] = [];
    let k = 0;
    for (let bar = 0; bar < 3; bar++) {
      const t = 1.5 * bar;
      rows.push(line(k++, t, t + 1.5, 'C3', 1));
      for (const p of ['E3', 'G3', 'A3', 'C4']) rows.push(line(k++, t + 0.5, t + 1.5, p, 1));
    }
    const { score } = parsePig(H + rows.join('\n') + '\n');
    const { assignment, hands } = solveFingering(score, { hands: ['L'] });
    expect(hands[0]!.relaxed).toBe(false);
    const lint = lintFingering(score, assignment);
    expect(lint.counts.L03 ?? 0).toBe(0);
    expect(lint.errors).toBe(0);
    // Score order per bar: C3, then the chord from E3 up.
    expect(score.notes.map((n) => assignment[n.id]!.finger)).toEqual([
      5, 4, 3, 2, 1, 5, 4, 3, 2, 1, 5, 4, 3, 2, 1,
    ]);
  });
  it('a chord of more than five notes doubles exactly one finger per extra note', () => {
    // M2 review blocker (Chopin Op. 28 No. 4, last chord): with a free doubled finger the whole
    // six-note chord went on finger 1.
    for (const [hand, ch, pitches] of [
      ['R', 0, ['C4', 'D4', 'E4', 'F4', 'G4', 'A4']],
      ['L', 1, ['B1', 'F#2', 'B2', 'D#3', 'F#3', 'B3']],
    ] as const) {
      const { score } = parsePig(H + pitches.map((p, i) => line(i, 0, 1, p, ch)).join('\n') + '\n');
      const { assignment, hands } = solveFingering(score, { hands: [hand] });
      const fingers = score.notes.map((n) => assignment[n.id]!.finger);
      expect(new Set(fingers).size, `${hand} ${fingers.join(' ')}`).toBe(5);
      expect(hands[0]!.relaxed).toBe(false);
      // Fingers never cross: they rise with pitch in the right hand and fall in the left.
      const order = hand === 'R' ? fingers : [...fingers].reverse();
      for (let i = 1; i < order.length; i++)
        expect(order[i]!).toBeGreaterThanOrEqual(order[i - 1]!);
    }
    // Where it can, the double is the thumb on two adjacent white keys, the one lint accepts.
    const { score } = parsePig(
      H + ['C4', 'D4', 'E4', 'F4', 'G4', 'A4'].map((p, i) => line(i, 0, 1, p, 0)).join('\n') + '\n',
    );
    const { assignment } = solveFingering(score, { hands: ['R'] });
    expect(score.notes.map((n) => assignment[n.id]!.finger)).toEqual([1, 1, 2, 3, 4, 5]);
    expect(lintFingering(score, assignment).counts).toEqual({ L01: 1, L04: 1 });
    expect(lintFingering(score, assignment).errors).toBe(1); // L04 only: the double is L01 info
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
  it('finger 5 pinned mid-run keeps a finite path without relaxing (soft beyond-practical)', () => {
    const { score } = parsePig(melody(RH_C_MAJOR, 0, SIXTEENTH));
    const e4 = score.notes[2]!.id;
    const { assignment, hands } = solveFingering(score, {
      hands: ['R'],
      pins: { [e4]: { finger: 5, source: 'user', pinned: true } },
    });
    expect(Number.isFinite(hands[0]!.cost)).toBe(true);
    expect(hands[0]!.relaxed).toBe(false);
    expect(assignment[e4]).toMatchObject({ finger: 5, pinned: true });
    for (const n of score.notes) expect([1, 2, 3, 4, 5]).toContain(assignment[n.id]!.finger);
  });
  it('a relaxed chord still gives each of its notes its own finger', () => {
    const r = parsePig(
      H +
        [line(0, 0, 1, 'C4', 0), line(1, 0, 1, 'E4', 0), line(2, 0, 1, 'G4', 0)].join('\n') +
        '\n',
    );
    const { assignment, hands } = solveFingering(r.score, {
      hands: ['R'],
      pins: { [r.score.notes[2]!.id]: { finger: 1, source: 'user', pinned: true } },
    });
    expect(hands[0]!.relaxed).toBe(true);
    expect(new Set(r.score.notes.map((n) => assignment[n.id]!.finger)).size).toBe(3);
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

// M2 hardening (docs/superpowers/plans/2026-10-14-m2-hardening.md, Task 1).
const LARGE = HAND_PROFILES.large.tables;
const fingersIn = (score: Score, assignment: Record<string, { finger: Finger }>) =>
  score.notes.map((n) => assignment[n.id]!.finger);
const chord = (pitches: string[], ch: number, on = 0, off = 1, first = 0) =>
  pitches.map((p, k) => line(first + k, on, off, p, ch));
/** True when every pair of the slice (pitches ascending, mirrored for the left hand) is practical. */
const legalShape = (pitches: number[], fingers: number[]): boolean =>
  pitches.every((p, a) =>
    pitches.every((q, b) => {
      if (b <= a) return true;
      const i = q - p;
      const g = fingers[a] as Finger;
      const f = fingers[b] as Finger;
      return i <= span(LARGE, 'maxPrac', g, f) && i >= span(LARGE, 'minPrac', g, f);
    }),
  );
const increasing = (k: number, from = 1): number[][] =>
  k === 0
    ? [[]]
    : [1, 2, 3, 4, 5]
        .filter((f) => f >= from)
        .flatMap((f) => increasing(k - 1, f + 1).map((rest) => [f, ...rest]));
const hasLegalShape = (pitches: number[]): boolean =>
  pitches.length <= 5 && increasing(pitches.length).some((c) => legalShape(pitches, c));

describe('chord laws and holds beyond reach (M2 hardening)', () => {
  it('outer pairs of a chord are priced: C4 E4 C5 gets 1 2 5, never 1 2 3', () => {
    // Right hand, and the mirrored left-hand chord E3 C4 E4 (5 2 1 from the bottom).
    for (const [hand, ch, pitches, want] of [
      ['R', 0, ['C4', 'E4', 'C5'], [1, 2, 5]],
      ['L', 1, ['E3', 'C4', 'E4'], [5, 2, 1]],
    ] as const) {
      const { score } = parsePig(H + chord([...pitches], ch).join('\n') + '\n');
      const { assignment, hands } = solveFingering(score, { hands: [hand] });
      expect(fingersIn(score, assignment), hand).toEqual(want);
      // The hand cost includes the outer pair (1-5 over an octave: chordLargeSpan 2 points x 2),
      // not only the neighbouring pairs: weakFifth 1 + shifts 1 + 2 + chordLargeSpan (2-5 over a
      // minor sixth) 4 x 2 + outer 2 x 2 = 16.
      const ctx = makeContext(HAND_PROFILES.large);
      const v = buildHandSequence(score, hand).notes;
      const f = v.map((n) => assignment[n.noteId]!.finger);
      let expected = weightedSum(ctx, chordSpanTerms(ctx, v[0]!, f[0]!, v[2]!, f[2]!));
      for (let i = 0; i < 3; i++) {
        expected += weightedSum(ctx, unaryTerms(ctx, v[i]!, f[i]!, v[i - 1], v[i + 1]));
        if (i > 0) expected += weightedSum(ctx, pairTerms(ctx, v[i - 1]!, f[i - 1]!, v[i]!, f[i]!));
      }
      expect(hands[0]!.cost, hand).toBe(expected);
      expect(hands[0]!.cost, hand).toBe(16);
    }
  });
  it('outer pairs of a chord obey the practical span in context (Joplin, The Entertainer, left hand)', () => {
    // Stride bass: octave, chord, octave, chord. Pricing only neighbouring chord notes gave the
    // G3 C4 E4 chord 5 4 3, whose outer pair (3-5 over a major sixth) is beyond practical (7).
    const steps: string[][] = [
      ['G#2', 'G#3'],
      ['G#3', 'C4', 'F4'],
      ['G2', 'G3'],
      ['G3', 'C4', 'E4'],
      ['G2'],
      ['G3', 'B3'],
    ];
    const rows: string[] = [];
    steps.forEach((ps, k) => rows.push(...chord(ps, 1, 0.4 * k, 0.4 * (k + 1), rows.length)));
    const { score } = parsePig(H + rows.join('\n') + '\n');
    const { assignment, hands } = solveFingering(score, { hands: ['L'] });
    const seq = buildHandSequence(score, 'L');
    for (let s = 0; s < seq.sliceCount; s++) {
      const notes = seq.notes.filter((n) => n.slice === s);
      const fs = notes.map((n) => assignment[n.noteId]!.finger);
      expect(
        legalShape(
          notes.map((n) => n.pitch),
          fs,
        ),
        `${notes.map((n) => n.midi).join(' ')}: ${fs.join(' ')}`,
      ).toBe(true);
    }
    expect(hands[0]!.infeasibleSlices).toEqual([]);
  });
  it('a five-note chord with a legal configuration never gets an impossible span', () => {
    // Library pieces whose solver output broke a chord law although the slice had a legal
    // configuration (Joplin left hand G3 C4 E4 on 3 4 5, Satie left hand on 1 2 3 4, ...). Lint
    // L05 inside a slice is allowed only on the slices the solver reports as infeasible (no legal
    // configuration at all, such as Chopin Op. 28 No. 4's final chords), and those must really be.
    const dir = fileURLToPath(new URL('../../../../content/scores/', import.meta.url));
    for (const slug of [
      'joplin-the-entertainer',
      'satie-gymnopedie-no1',
      'chopin-prelude-op28-no4',
      'chopin-prelude-op28-no7',
      'mozart-sonata-k545-mvt1',
      'beethoven-moonlight-sonata-mvt1',
    ]) {
      const { score } = parseMusicXml(readFileSync(join(dir, `${slug}.musicxml`)));
      const { assignment, hands } = solveFingering(score);
      const lint = lintFingering(score, assignment);
      for (const hand of ['R', 'L'] as Hand[]) {
        const seq = buildHandSequence(score, hand);
        const sliceOf = new Map(seq.notes.map((n) => [n.noteId, n.slice]));
        const solution = hands.find((h) => h.hand === hand)!;
        const infeasible = new Set(solution.infeasibleSlices.map((s) => s.slice));
        for (const s of infeasible) {
          const pitches = seq.notes.filter((n) => n.slice === s).map((n) => n.pitch);
          expect(hasLegalShape(pitches), `${slug} ${hand} slice ${s}`).toBe(false);
        }
        const chordBreaks = lint.issues.filter(
          (x) =>
            x.rule === 'L05' &&
            x.hand === hand &&
            x.noteIds.length === 2 &&
            sliceOf.get(x.noteIds[0]!) === sliceOf.get(x.noteIds[1]!) &&
            !infeasible.has(sliceOf.get(x.noteIds[0]!)!),
        );
        expect(
          chordBreaks.map((x) => x.message),
          `${slug} ${hand}`,
        ).toEqual([]);
      }
    }
  });
  it('chord loop terminates on a six-note slice and on an infeasible chord', () => {
    // Six notes: no configuration of distinct fingers exists.
    const six = parsePig(H + chord(['C4', 'D4', 'E4', 'F4', 'G4', 'A4'], 0).join('\n') + '\n');
    const r6 = solveFingering(six.score, { hands: ['R'] });
    expect(Number.isFinite(r6.hands[0]!.cost)).toBe(true);
    expect(r6.hands[0]!.relaxed).toBe(false);
    expect(r6.hands[0]!.infeasibleSlices).toEqual([
      { slice: 0, noteIds: six.score.notes.map((n) => n.id) },
    ]);
    // A chord spanning 24 semitones in one hand, then a melody that must still be solved.
    const rows = [
      ...chord(['C3', 'C4', 'C5'], 0),
      line(3, 1, 1.5, 'D5', 0),
      line(4, 1.5, 2, 'E5', 0),
    ];
    const wide = parsePig(H + rows.join('\n') + '\n');
    const rw = solveFingering(wide.score, { hands: ['R'] });
    expect(Number.isFinite(rw.hands[0]!.cost)).toBe(true);
    expect(rw.hands[0]!.relaxed).toBe(false);
    expect(rw.hands[0]!.infeasibleSlices).toEqual([
      { slice: 0, noteIds: wide.score.notes.slice(0, 3).map((n) => n.id) },
    ]);
    expect(rw.hands[0]!.iterations).toBeLessThanOrEqual(8);
    // Left-hand mirror of the same chord.
    const lw = parsePig(H + chord(['C2', 'C3', 'C4'], 1).join('\n') + '\n');
    const rl = solveFingering(lw.score, { hands: ['L'] });
    expect(Number.isFinite(rl.hands[0]!.cost)).toBe(true);
    expect(rl.hands[0]!.infeasibleSlices).toHaveLength(1);
  });
  it('the chord loop forbids a configuration that breaks the span only between notes three apart', () => {
    // A3 pinned to the thumb and held under C4 F4 G4 C5. Without the loop the decode keeps the
    // thumb on A3 and plays the chord 2 3 4 5, whose outer pair (2-5 over an octave, practical
    // 10) the second-order decoder cannot see; the loop forbids it and the chord gets a legal
    // configuration (paying for the reused thumb instead, a finite held-note cost).
    const rows = [line(0, 0, 2, 'A3', 0), ...chord(['C4', 'F4', 'G4', 'C5'], 0, 1, 2, 1)];
    const { score } = parsePig(H + rows.join('\n') + '\n');
    const pins = {
      [score.notes[0]!.id]: { finger: 1 as const, source: 'user' as const, pinned: true },
    };
    const pitches = [60, 65, 67, 72];
    // Without the law-domain pass (which forbids the thumb on the chord from the start), so the
    // chord loop has to find it.
    const loopOnly = { hands: ['R'] as Hand[], pins, lawDomains: false };
    const noLoop = solveFingering(score, { ...loopOnly, maxChordIterations: 1 });
    expect(fingersIn(score, noLoop.assignment).slice(1)).toEqual([2, 3, 4, 5]);
    expect(legalShape(pitches, [2, 3, 4, 5])).toBe(false);
    const { assignment, hands } = solveFingering(score, loopOnly);
    expect(legalShape(pitches, fingersIn(score, assignment).slice(1))).toBe(true);
    expect(hands[0]!.iterations).toBeGreaterThan(1);
    expect(hands[0]!.relaxed).toBe(false);
    expect(hands[0]!.infeasibleSlices).toEqual([]);
    expect(Number.isFinite(hands[0]!.cost)).toBe(true);
    // The default solve gives the chord a legal shape too.
    const full = solveFingering(score, { hands: ['R'], pins });
    expect(legalShape(pitches, fingersIn(score, full.assignment).slice(1))).toBe(true);
    expect(full.hands[0]!.relaxed).toBe(false);
  });
  it('a chord with a single legal configuration gets it (the loop never forbids a legal one)', () => {
    // Satie, Gymnopedie No. 1, left hand C3 F#3 A3 D4: only 5 3 2 1 keeps every pair practical.
    const { score } = parsePig(H + chord(['C3', 'F#3', 'A3', 'D4'], 1).join('\n') + '\n');
    const { assignment, hands } = solveFingering(score, { hands: ['L'] });
    expect(fingersIn(score, assignment)).toEqual([5, 3, 2, 1]);
    expect(hands[0]!.infeasibleSlices).toEqual([]);
    expect(hands[0]!.relaxed).toBe(false);
  });
  it('a notated hold beyond reach is released: a bass held a bar under a chord two octaves up leaves finger 5 free', () => {
    // C2 held for a bar of 1.5 s; C4 E4 G4 on the second beat, two octaves up: no hand spans C2 to
    // C4 (24 semitones, maxPrac(1, 5) = 15), so the bass is pedalled or released and its finger is
    // free. With the bass on 5 (pinned, as a player would take it) the chord still gets 5 3 1;
    // before the fix the held 5 pushed the chord to 4 2 1.
    const rows = [line(0, 0, 1.5, 'C2', 1), ...chord(['C4', 'E4', 'G4'], 1, 0.5, 1.5, 1)];
    const { score } = parsePig(H + rows.join('\n') + '\n');
    const bass = score.notes[0]!.id;
    const pins = { [bass]: { finger: 5 as const, source: 'user' as const, pinned: true } };
    const { assignment, explanations, hands } = solveFingering(score, { hands: ['L'], pins });
    expect(fingersIn(score, assignment)).toEqual([5, 5, 3, 1]);
    expect(explanations[score.notes[1]!.id]!.heldBy).toBeUndefined();
    expect(hands[0]!.relaxed).toBe(false);
    expect(hands[0]!.cost).toBeLessThan(1000); // no held-note penalty
    // Unpinned, the chord keeps its natural shape too.
    const free = solveFingering(score, { hands: ['L'] });
    expect(fingersIn(score, free.assignment).slice(1)).toEqual([5, 3, 1]);
    // Within reach (G3 under the same chord, at most an octave) the hold keeps its finger.
    const near = parsePig(
      H +
        [line(0, 0, 1.5, 'G3', 1), ...chord(['C4', 'E4', 'G4'], 1, 0.5, 1.5, 1)].join('\n') +
        '\n',
    );
    const r = solveFingering(near.score, { hands: ['L'] });
    const f = fingersIn(near.score, r.assignment);
    expect(f.slice(1)).not.toContain(f[0]);
    expect(lintFingering(near.score, r.assignment).counts.L03 ?? 0).toBe(0);
  });
  it('right-hand two-octave C major arpeggio: 1231235 up and 5321321 down at quarter = 120', () => {
    const up = ['C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6'];
    expect(fingersOf(melody(up, 0), 'R')).toEqual([1, 2, 3, 1, 2, 3, 5]);
    expect(fingersOf(melody([...up].reverse(), 0), 'R')).toEqual([5, 3, 2, 1, 3, 2, 1]);
  });
  it('chromatic scale from C, right hand, two octaves, standard fingering', () => {
    // 3 on every black key, 1 on the other white keys, 2 on F and C after E and B (going up).
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const up = Array.from({ length: 25 }, (_, k) => `${names[k % 12]}${4 + Math.floor(k / 12)}`);
    const standard = [1, 3, 1, 3, 1, 2, 3, 1, 3, 1, 3, 1, 2, 3, 1, 3, 1, 2, 3, 1, 3, 1, 3, 1, 2];
    expect(fingersOf(melody(up, 0), 'R')).toEqual(standard);
    expect(fingersOf(melody([...up].reverse(), 0), 'R')).toEqual([...standard].reverse());
  });
});

// M2 hardening re-review: a key held under a later note is a law at any distance (as a chord
// partner is), holds are walked once for solver and lint (reach.ts `forEachHold`), a chord with no
// legal configuration breaks the fewest pairs, and every finite charge is a named weighted rule.
const LIBRARY = fileURLToPath(new URL('../../../../content/scores/', import.meta.url));

/**
 * Exact search (the oracle): does a fingering of this hand keep every law lint checks (L01 to
 * L05)? Walks the sequence keeping, as state, the fingers of the notes that still share a law with
 * a later note: chord pairs (any distance in a slice) and held pairs (`forEachHold`). Only states
 * without a broken law survive, so the answer is exact and the search stays small.
 */
function legalFingeringExists(v: SeqNote[]): boolean {
  const laws: Array<Array<{ m: number; chord: boolean }>> = v.map(() => []);
  forEachHold(v, LARGE, (m, i) => laws[i]!.push({ m, chord: false }));
  const bySlice = new Map<number, number[]>();
  v.forEach((n, k) => bySlice.set(n.slice, [...(bySlice.get(n.slice) ?? []), k]));
  for (const ks of bySlice.values()) {
    if (ks.length > 5) return false; // L04
    for (let x = 0; x < ks.length; x++)
      for (let y = x + 1; y < ks.length; y++) laws[ks[y]!]!.push({ m: ks[x]!, chord: true });
  }
  const lastUse = v.map((_, k) => k);
  laws.forEach((list, i) => list.forEach(({ m }) => (lastUse[m] = Math.max(lastUse[m]!, i))));
  let open: number[] = [];
  let states = new Set<string>(['']);
  for (let i = 0; i < v.length; i++) {
    const pos = new Map(open.map((m, k) => [m, k]));
    const nextOpen = [...open, i].filter((m) => lastUse[m]! > i);
    const next = new Set<string>();
    for (const state of states)
      for (const f of [1, 2, 3, 4, 5] as Finger[]) {
        const lawful = laws[i]!.every(({ m, chord }) => {
          const g = Number(state[pos.get(m)!]) as Finger;
          const iv = v[i]!.pitch - v[m]!.pitch;
          // Lint accepts one double only: the thumb on two adjacent white keys of a chord.
          if (g === f) return chord && g === 1 && !v[m]!.black && !v[i]!.black && iv <= 2;
          if (chord && f < g) return false; // L02
          return iv <= span(LARGE, 'maxPrac', g, f) && iv >= span(LARGE, 'minPrac', g, f);
        });
        if (!lawful) continue;
        const full = state + String(f);
        next.add(nextOpen.map((m) => (m === i ? f : full[pos.get(m)!])).join(''));
      }
    if (next.size === 0) return false;
    states = next;
    open = nextOpen;
  }
  return true;
}

describe('held keys are laws at any distance (M2 hardening re-review)', () => {
  it('every library hand that has a fully legal fingering gets one (exact search oracle)', () => {
    // The re-review found held pairs broken where a legal fingering exists: Joplin, The Entertainer,
    // right hand bars 56 and 64 (16 law errors), Chopin Op. 69/2 left hand (3), Moonlight right
    // hand bar 19 (1), Satie left hand bar 37 (1).
    const files = readdirSync(LIBRARY).filter(
      (f) => f.endsWith('.musicxml') && !f.includes('.fingered.'),
    );
    const legal: string[] = [];
    for (const file of files) {
      const { score } = parseMusicXml(readFileSync(join(LIBRARY, file)));
      const { assignment } = solveFingering(score);
      const issues = lintFingering(score, assignment).issues;
      for (const hand of ['R', 'L'] as Hand[]) {
        if (!legalFingeringExists(buildHandSequence(score, hand).notes)) continue;
        const name = `${file.replace('.musicxml', '')} ${hand}`;
        legal.push(name);
        const errors = issues.filter((x) => x.hand === hand && x.severity === 'error');
        expect(
          errors.map((x) => `${x.rule} ${x.message}`),
          name,
        ).toEqual([]);
      }
    }
    for (const name of [
      'joplin-the-entertainer R',
      'chopin-waltz-op69-no2 L',
      'beethoven-moonlight-sonata-mvt1 R',
      'satie-gymnopedie-no1 L',
    ])
      expect(legal, name).toContain(name);
    // 30 pieces: every hand but five (Moonlight L, Chopin Op. 28/4 L and 28/7 R, Joplin L, Satie R).
    expect(legal).toHaveLength(2 * files.length - 5);
  });
  it('a melody under a held chord keeps every span to the held keys (Joplin bar 56 shape)', () => {
    // F5 A#5 D6 held for two seconds over A#4 A4 A#4 C5 D5: D6 is beyond reach of A#4 (16
    // semitones), so it is released, but F5 and A#5 stay down. With A#5 on 3 no finger reaches
    // A4 (13 below, minPrac(3, 1) = -12), so the chord must put 4 or 5 on A#5. The holds are three
    // to seven steps back, beyond the decoder's view.
    const rows = [
      ...chord(['F5', 'A#5', 'D6'], 0, 0, 2),
      ...['A#4', 'A4', 'A#4', 'C5', 'D5'].map((p, k) =>
        line(3 + k, 0.5 + 0.25 * k, 0.75 + 0.25 * k, p, 0),
      ),
    ];
    const { score } = parsePig(H + rows.join('\n') + '\n');
    const { assignment, hands } = solveFingering(score, { hands: ['R'] });
    expect(lintFingering(score, assignment).errors).toBe(0);
    expect(hands[0]!.relaxed).toBe(false);
    expect(hands[0]!.cost).toBeLessThan(1000);
    expect([4, 5]).toContain(assignment[score.notes[1]!.id]!.finger);
  });
  it('solver and lint walk the same holds: a hold released beyond reach frees its finger for good', () => {
    // C4 notated 0-3 s on the thumb; E5 at 1 s is 16 semitones away, beyond any hand, so the hold
    // is a pedal or a release from then on (lint: one L07 warning). G4 at 2 s may then take the
    // thumb: before the walk was shared the solver re-tested reach per pair (G4 is 7 semitones
    // from C4) and charged the held-note penalty.
    const rows = [line(0, 0, 3, 'C4', 0), line(1, 1, 1.5, 'E5', 0), line(2, 2, 2.5, 'G4', 0)];
    const { score } = parsePig(H + rows.join('\n') + '\n');
    const [c4, , g4] = score.notes.map((n) => n.id);
    const pins = {
      [c4!]: { finger: 1 as const, source: 'user' as const, pinned: true },
      [g4!]: { finger: 1 as const, source: 'user' as const, pinned: true },
    };
    const { assignment, explanations, hands } = solveFingering(score, { hands: ['R'], pins });
    expect(hands[0]!.cost).toBeLessThan(1000);
    expect(explanations[g4!]!.heldBy).toBeUndefined();
    const lint = lintFingering(score, assignment);
    expect(lint.errors).toBe(0);
    expect(lint.counts.L07).toBe(1);
    // A repeated key under a legato overlap is no hold (lint skips it): the same finger may play it
    // again, at no held-note penalty.
    const rep = parsePig(
      H + [line(0, 0, 0.6, 'E4', 0), line(1, 0.5, 1, 'E4', 0)].join('\n') + '\n',
    );
    const r = solveFingering(rep.score, { hands: ['R'] });
    const fr = fingersIn(rep.score, r.assignment);
    expect(fr[1]).toBe(fr[0]);
    expect(r.hands[0]!.cost).toBeLessThan(1000);
  });
  it('a chord with no legal configuration gets one that breaks the fewest pairs', () => {
    // G#3 G4 G#5: no fingering keeps all three pairs (1-5 over two octaves). 1 3 5 breaks two
    // (3-5 over 13 semitones, and 1-5), 1 2 5 three (1-2 over 11 too); chordBeyondPractical alone,
    // which counts the semitones beyond the spans (13 against 15), took 1 2 5.
    const { score } = parsePig(H + chord(['G#3', 'G4', 'G#5'], 0).join('\n') + '\n');
    const { assignment, hands } = solveFingering(score, { hands: ['R'] });
    expect(fingersIn(score, assignment)).toEqual([1, 3, 5]);
    expect(hands[0]!.infeasibleSlices).toHaveLength(1);
    expect(lintFingering(score, assignment).counts.L05).toBe(2);
    const once = solveFingering(score, { hands: ['R'], maxChordIterations: 1 });
    expect(fingersIn(score, once.assignment)).toEqual([1, 2, 5]);
  });
  it('a forbidden three-note window never charges a pair of fingers that shares its code', () => {
    // E4 F4 G4 A4 as one slice. Forbidding 1 3 4 5 charges its window 1 3 4 (code 13) at G4; the
    // pair 3 4 has code 13 too, and before the window codes were kept apart by width it made the
    // legal 2 3 4 5 cost +Infinity.
    const { score } = parsePig(H + chord(['E4', 'F4', 'G4', 'A4'], 0).join('\n') + '\n');
    const seq = buildHandSequence(score, 'R');
    const ctx = makeContext(HAND_PROFILES.large);
    const solve = (forbidden: Finger[][], pinned: Map<number, Finger>) =>
      solveHand(seq, ctx, {
        pinned,
        forbidden: new Map(),
        forbiddenConfigs: new Map([[0, forbidden]]),
        soft: false,
      });
    const pinnedTwo = solve([[1, 3, 4, 5]], new Map([[0, 2]]));
    expect(pinnedTwo.fingers).toEqual([2, 3, 4, 5]);
    expect(Number.isFinite(pinnedTwo.cost)).toBe(true);
    const thumbless = solve(
      [
        [1, 2, 3, 4],
        [1, 2, 3, 5],
        [1, 2, 4, 5],
        [1, 3, 4, 5],
      ],
      new Map(),
    );
    expect(thumbless.fingers).toEqual([2, 3, 4, 5]);
    expect(Number.isFinite(thumbless.cost)).toBe(true);
  });
  it('a six-note chord costs exactly its weighted terms: the double is the named rule doubledFinger', () => {
    // The M3 identity (solver cost = weights x path features) on a slice of more than five notes:
    // the doubled finger used to be an unweighted constant (50, or 100 off the thumb) in solve.ts.
    const { score } = parsePig(
      H + chord(['C4', 'D4', 'E4', 'F4', 'G4', 'A4'], 0).join('\n') + '\n',
    );
    const { assignment, hands } = solveFingering(score, { hands: ['R'] });
    const ctx = makeContext(HAND_PROFILES.large);
    const v = buildHandSequence(score, 'R').notes;
    const f = v.map((n) => assignment[n.noteId]!.finger);
    expect(f).toEqual([1, 1, 2, 3, 4, 5]);
    let sum = 0;
    for (let i = 0; i < v.length; i++) {
      sum += weightedSum(ctx, unaryTerms(ctx, v[i]!, f[i]!, v[i - 1], v[i + 1]));
      if (i >= 1) sum += weightedSum(ctx, pairTerms(ctx, v[i - 1]!, f[i - 1]!, v[i]!, f[i]!));
      if (i >= 2)
        sum += weightedSum(
          ctx,
          tripleTerms(ctx, v[i - 2]!, f[i - 2]!, v[i - 1]!, f[i - 1]!, v[i]!, f[i]!),
        );
    }
    expect(hands[0]!.cost).toBeCloseTo(sum, 9);
    expect(pairTerms(ctx, v[0]!, 1, v[1]!, 1)).toContainEqual({ rule: 'doubledFinger', points: 1 });
    expect(pairTerms(ctx, v[1]!, 2, v[2]!, 2)).toContainEqual({ rule: 'doubledFinger', points: 2 });
  });
});
