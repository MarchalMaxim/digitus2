import { describe, expect, it } from 'vitest';
import { parsePig } from '../io/pig/read.js';
import { lintFingering } from '../lint/index.js';
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
    const noLoop = solveFingering(score, { hands: ['R'], maxHeldIterations: 1 });
    expect(reuses(noLoop.assignment)).toBeGreaterThan(0); // the fixture really needs the loop
    const { assignment, hands } = solveFingering(score, { hands: ['R'] });
    expect(reuses(assignment)).toBe(0);
    expect(hands[0]!.iterations).toBeGreaterThan(1);
    expect(hands[0]!.relaxed).toBe(false);
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
