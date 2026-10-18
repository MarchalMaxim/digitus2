import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { normalizeTextbookEntries } from '../eval/textbook.js';
import type { TextbookEntry } from '../eval/textbook.js';
import { parsePig } from '../io/pig/read.js';
import type { Hand } from '../score/types.js';
import { solveFingering } from './solve.js';
import type { SolveOptions } from './solve.js';
import { buildHandSequence } from './sequence.js';
import type { HandSequence } from './sequence.js';
import { detectRuns, matchTemplates, templateFingerAt, TEXTBOOK_TEMPLATES } from './templates.js';
import type { Run } from './templates.js';

const H = '//Version: PianoFingering_v170101\n';
const melody = (pitches: string[], ch: number, dur = 0.5) =>
  H +
  pitches.map((p, i) => `${i}\t${i * dur}\t${(i + 1) * dur}\t${p}\t80\t80\t${ch}\t0`).join('\n') +
  '\n';
const fingersOf = (pitches: string[], ch: number, opts: SolveOptions = {}, dur = 0.5) => {
  const { score } = parsePig(melody(pitches, ch, dur));
  const { assignment } = solveFingering(score, { hands: [ch === 0 ? 'R' : 'L'], ...opts });
  return score.notes.map((n) => assignment[n.id]!.finger);
};
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const pitchName = (m: number) => `${NAMES[m % 12]!}${Math.floor(m / 12) - 1}`;
/** Fingers for a single-note melody given as midi numbers (right hand on channel 0, left on 1). */
const fingersOfMidi = (midi: number[], hand: Hand, dur: number, opts: SolveOptions = {}) =>
  fingersOf(midi.map(pitchName), hand === 'R' ? 0 : 1, opts, dur);
/** A right-hand sequence of single notes, one slice each; `grace` marks indices as grace notes. */
const seqOf = (midi: number[], grace: number[] = []): HandSequence => ({
  hand: 'R',
  sliceCount: midi.length,
  notes: midi.map((m, i) => ({
    index: i,
    noteId: `n${i}`,
    midi: m,
    pitch: m,
    black: false,
    onsetSec: i * 0.5,
    offsetSec: (i + 1) * 0.5,
    slice: i,
    restBefore: false,
    ioi: i === 0 ? 0 : 0.5,
    isGrace: grace.includes(i),
  })),
});
/** [start, end, entryId, fingers] of every match on the runs `detectRuns` finds. */
const matchesOf = (seq: HandSequence, entries: TextbookEntry[] = TEXTBOOK_TEMPLATES[seq.hand]) =>
  matchTemplates(seq, detectRuns(seq), entries).map((m) => [m.start, m.end, m.entryId, m.fingers]);
const SIXTEENTH = 0.125;
const TEMPOS = [0.5, SIXTEENTH];
const BB_MAJOR = ['Bb4', 'C5', 'D5', 'Eb5', 'F5', 'G5', 'A5', 'Bb5'];
const RH_C_MAJOR = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
/** C major one octave up and back down: the two runs share the top C. */
const RH_C_MAJOR_UP_DOWN = [...RH_C_MAJOR, ...RH_C_MAJOR.slice(0, -1).reverse()];

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
  it('breaks runs at grace notes, repeated notes and leaps wider than five semitones', () => {
    const kinds = (s: HandSequence) => detectRuns(s).map((r) => [r.kind, r.start, r.end]);
    // C D E F G with a grace note on E: no four consecutive plain notes remain.
    expect(kinds(seqOf([60, 62, 64, 65, 67], [2]))).toEqual([]);
    // C D E E F G A: the repeated E splits C D E (too short) from E F G A (a scale).
    expect(kinds(seqOf([60, 62, 64, 64, 65, 67, 69]))).toEqual([['scale', 3, 6]]);
    // C D E F, a leap of a sixth, then A B C D.
    expect(kinds(seqOf([60, 62, 64, 65, 74, 76, 77, 79]))).toEqual([
      ['scale', 0, 3],
      ['scale', 4, 7],
    ]);
  });
});

describe('matchTemplates', () => {
  it('matches a B-flat major scale in the right hand at any octave', () => {
    expect(TEXTBOOK_TEMPLATES.R.length).toBeGreaterThan(0);
    const { score } = parsePig(melody(BB_MAJOR, 0));
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
  it('matches left-hand entries on the unmirrored pitches', () => {
    const { score } = parsePig(melody(['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4'], 1));
    expect(matchesOf(buildHandSequence(score, 'L'))).toEqual([
      [0, 7, 'scale.major.C.lh.asc.1oct', [5, 4, 3, 2, 1, 3, 2, 1]],
    ]);
  });
  // Deviation from the plan (Task 8 review): every run took a template, and a five-note scale run or
  // a broken triad then took the middle of a textbook fingering, often from another key, with a
  // thumb crossing. At weight 2 that broke 15 of the 62 five-finger positions (of 96) that the rules
  // alone keep, and 65 of the 112 broken triads (of 192) the rules alone finger 1 3 5 / 5 3 1; the
  // textbook oracle gained nothing from those short matches.
  it('gives no template to runs that fit in one hand position', () => {
    const spans = (midi: number[]) => matchesOf(seqOf(midi)).map(([start, end]) => [start, end]);
    // G A B C D took C major's 2 3 4 1 2; one note more is a run that leaves the position.
    expect(spans([67, 69, 71, 72, 74])).toEqual([]);
    expect(spans([67, 69, 71, 72, 74, 76])).toEqual([[0, 5]]);
    expect(spans([60, 61, 62, 63, 64])).toEqual([]);
    expect(spans([60, 61, 62, 63, 64, 65])).toEqual([[0, 5]]);
    // A C E took A minor's 1 2 3 from the two-octave arpeggio; C E G C is a broken chord.
    expect(spans([57, 60, 64])).toEqual([]);
    expect(spans([60, 64, 67, 72])).toEqual([[0, 3]]);
  });
  // Literature 6.6 item 2 aligns the template to the run's start note and key. Entries start on
  // their tonic (or chord root), so the entry's first note stands for the key.
  it('prefers an entry whose tonic starts the run, then one whose tonic ends it, then file order', () => {
    const first = (midi: number[]) => matchesOf(seqOf(midi))[0];
    // A B C D E F: C major comes first in the files and would give 3 4 1 2 3 1.
    expect(first([57, 59, 60, 62, 64, 65])).toEqual([
      0,
      5,
      'scale.harmonic_minor.A.rh.asc.1oct',
      [1, 2, 3, 1, 2, 3],
    ]);
    // G F E D C B A: no matching entry has the tonic G; A natural minor (the descending melodic
    // minor) ends on A, where C major would give 2 1 3 2 1 4 3.
    expect(first([67, 65, 64, 62, 60, 59, 57])).toEqual([
      0,
      6,
      'scale.melodic_minor.A.rh.desc.1oct',
      [4, 3, 2, 1, 3, 2, 1],
    ]);
    // E F G A B C D: neither E nor D is the tonic of a matching entry, so file order picks C major.
    expect(first([64, 65, 67, 69, 71, 72, 74])).toEqual([
      0,
      6,
      'scale.major.C.rh.asc.2oct',
      [3, 1, 2, 3, 4, 1, 2],
    ]);
  });
  // Deviation from the plan (Task 8 review): the plan dropped a later match that shared any index
  // with an earlier one, so a scale up and back down had a template on its first half only.
  it('trims the shared turning note from the later of two runs', () => {
    const { score } = parsePig(melody(RH_C_MAJOR_UP_DOWN, 0));
    expect(matchesOf(buildHandSequence(score, 'R'))).toEqual([
      [0, 7, 'scale.major.C.rh.asc.1oct', [1, 2, 3, 1, 2, 3, 4, 5]],
      [8, 14, 'scale.major.C.rh.desc.1oct', [4, 3, 2, 1, 3, 2, 1]],
    ]);
  });
  it('a later run never overrides fingers already assigned by an earlier, longer match', () => {
    // C major up two octaves, with overlapping runs given by hand. G4..A5 (9 notes) goes first and
    // keeps all its fingers; C4..C5 keeps C4..F4 only; D4..B4 lies inside both and is dropped.
    const seq = seqOf([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84]);
    const run = (start: number, end: number): Run => ({ start, end, kind: 'scale', direction: 1 });
    const m = matchTemplates(seq, [run(0, 7), run(4, 12), run(1, 6)], TEXTBOOK_TEMPLATES.R);
    expect(m.map((x) => [x.start, x.end, x.entryId, x.fingers])).toEqual([
      [0, 3, 'scale.major.C.rh.asc.1oct', [1, 2, 3, 1]],
      [4, 12, 'scale.major.C.rh.asc.2oct', [2, 3, 4, 1, 2, 3, 1, 2, 3]],
    ]);
  });
  it('gives no template outside every match or for runs found in no entry', () => {
    const seq = seqOf([60, 62, 64, 65, 67, 69, 71, 72]);
    const m = matchTemplates(seq, detectRuns(seq), TEXTBOOK_TEMPLATES.R);
    expect(templateFingerAt(m, 0)).toBe(1);
    expect(templateFingerAt(m, 8)).toBeUndefined();
    expect(templateFingerAt([], 0)).toBeUndefined();
    // C D E F# G# A#: a whole-tone run is in no textbook entry.
    const whole = seqOf([60, 62, 64, 66, 68, 70]);
    expect(detectRuns(whole)).toHaveLength(1);
    expect(matchTemplates(whole, detectRuns(whole), TEXTBOOK_TEMPLATES.R)).toEqual([]);
  });
  it('skips entries whose fingers are not 1..5', () => {
    const midi = [60, 62, 64, 65, 67, 69, 71, 72];
    const base = { family: 'scale', hand: 'R' as const, direction: 'ascending', midi };
    const bad = { ...base, id: 'bad', fingers: [1, 2, 3, 1, 2, 3, 4, 9] };
    const good = { ...base, id: 'good', fingers: [1, 2, 3, 1, 2, 3, 4, 5] };
    expect(matchesOf(seqOf(midi), [bad, good])).toEqual([[0, 7, 'good', good.fingers]]);
  });
});

describe('solver with templates', () => {
  // KNOWN GAP, kept visible: under the planned template weight 2 the textbook path is not the
  // optimum at IOI 0.5 s. Per-rule breakdown (solver explanations): 1 1 2 3 1 2 3 4 costs 11.5 =
  // Bb4 thumbOnBlack 3; C5 hop 1.5 + handPositionShift 1.5 - template 2; D5, Eb5 (handPositionShift
  // 0.5), F5 (largeSpan 5, handPositionShift 3.5), G5 (positionChangeCount 2, positionChangeSize 5),
  // A5 and Bb5 (weakFinger 1, threeToFour 1, fourOnBlack 1, handPositionShift 0.5) as below. The
  // textbook 2 1 2 3 1 2 3 4 costs 16: it earns one more bonus (Bb4, -2) but pays C5 largeSpan 3 +
  // handPositionShift 2.5 and D5 positionChangeCount 2 + positionChangeSize 4 + sameFingerPivot 1
  // (12.5) instead of 6 for the thumb hop (Bb4 thumbOnBlack 3, C5 hop 1.5 + handPositionShift 1.5).
  // It needs a weight above 6.5 here; in sixteenths (hop 6) the two paths tie at 16 at weight 2 and
  // the lexicographic tie-break keeps 1 1 2 3 ... (weight 3 suffices). Since short runs take no
  // template, the five-finger sweep below no longer depends on the weight (62 of 96 at weights 0, 2,
  // 3, 4, 6 and 7); the weight stays at the planned 2 until M3 fits it.
  // Closed by the M2 review hop rule (hop weight 10, 2 points for a hop within a perfect fourth at
  // any tempo): the thumb hop Bb4-C5 now costs 20 instead of 1.5, so 1 1 2 3 1 2 3 4 costs 30
  // against 16 for the textbook path, which wins (the rules alone, without the template bonus,
  // give 1 2 3 1 2 3 4 5 at 31).
  it('fingers the B-flat major scale like the textbook at IOI 0.5 s (former known gap)', () => {
    expect(fingersOf(BB_MAJOR, 0)).toEqual([2, 1, 2, 3, 1, 2, 3, 4]);
  });
  it('can be switched off, and the bonus never raises the optimum', () => {
    const { score } = parsePig(melody(BB_MAJOR, 0));
    const on = solveFingering(score, { hands: ['R'] });
    const off = solveFingering(score, { hands: ['R'], templates: false });
    expect(off.hands[0]!.cost).toBeGreaterThanOrEqual(on.hands[0]!.cost);
    const templateTerms = (r: typeof on) =>
      score.notes.flatMap((n) => r.explanations[n.id]!.terms.filter((t) => t.rule === 'template'));
    expect(templateTerms(off)).toEqual([]);
    expect(templateTerms(on).length).toBeGreaterThan(0);
    const c5 = on.explanations[score.notes[1]!.id]!;
    expect(c5.terms).toContainEqual({ rule: 'template', points: -1, weighted: -2 });
    // The explanations, bonus included, add up to the decoded cost.
    for (const r of [on, off]) {
      const total = score.notes.reduce((s, n) => s + r.explanations[n.id]!.total, 0);
      expect(total).toBeCloseTo(r.hands[0]!.cost, 9);
    }
    // A zero weight switches the bonus off as well. Like any rule of weight 0, the template term
    // still shows where the finger agrees, weighted 0 (not -0).
    const zero = solveFingering(score, { hands: ['R'], weights: { template: 0 } });
    expect(zero.hands[0]!.cost).toBe(off.hands[0]!.cost);
    // Without the bonus the rules now finger B-flat major 1 2 3 1 2 3 4 5, which agrees with the
    // template on no note; C major agrees on every note, so it carries the zero-weight check.
    const c = parsePig(melody(RH_C_MAJOR, 0)).score;
    const cZero = solveFingering(c, { hands: ['R'], weights: { template: 0 } });
    const cTerms = c.notes.flatMap((n) =>
      cZero.explanations[n.id]!.terms.filter((t) => t.rule === 'template'),
    );
    expect(cTerms.length).toBeGreaterThan(0);
    for (const t of [...templateTerms(zero), ...cTerms])
      expect(Object.is(t.weighted, 0)).toBe(true);
  });
  // Planned: the rules alone gave 1 2 2 1 1 2 3 4 here (cost 12, two slow hops at 1.5) and the
  // template closed the gap. Since the M2 review hop rule each of those hops costs 20 (cost 49), so
  // the rules alone already give the textbook path (cost 18) and the template keeps it.
  it('closes the right-hand C major gap at IOI 0.5 s (the slow thumb hop loses)', () => {
    expect(fingersOf(RH_C_MAJOR, 0)).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
    expect(fingersOf(RH_C_MAJOR, 0, { templates: false })).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
  });
  it('fingers a scale up and back down with both templates at IOI 0.5 s', () => {
    expect(fingersOf(RH_C_MAJOR_UP_DOWN, 0)).toEqual([1, 2, 3, 1, 2, 3, 4, 5, 4, 3, 2, 1, 3, 2, 1]);
  });
  // Sweeps over every root, major and minor, both hands, IOI 0.5 s and 0.125 s. The rules alone
  // keep 62 of the 96 five-finger melodies in position and finger 112 of the 192 broken triads
  // 1 3 5 / 5 3 1 (the rest is a rule gap, not a template one); templates must never undo either.
  it('never moves a five-finger melody out of its position', () => {
    const moved: string[] = [];
    let kept = 0;
    for (const shape of [
      [0, 2, 4, 5, 7],
      [0, 2, 3, 5, 7],
    ])
      for (const hand of ['R', 'L'] as const)
        for (let root = 0; root < 12; root++)
          for (const dur of TEMPOS) {
            const up = shape.map((s) => (hand === 'R' ? 60 : 48) + root + s);
            const midi = [...up, ...up.slice(0, -1).reverse()];
            const want = hand === 'R' ? [1, 2, 3, 4, 5, 4, 3, 2, 1] : [5, 4, 3, 2, 1, 2, 3, 4, 5];
            const off = fingersOfMidi(midi, hand, dur, { templates: false });
            if (off.join() !== want.join()) continue;
            kept++;
            const on = fingersOfMidi(midi, hand, dur);
            if (on.join() !== want.join())
              moved.push(`${hand} ${midi.map(pitchName).join(' ')} at ${dur} s: ${on.join(' ')}`);
          }
    expect(moved).toEqual([]);
    expect(kept).toBeGreaterThan(0);
  });
  it('keeps a broken triad on 1 3 5 / 5 3 1 wherever the rules alone give it', () => {
    const moved: string[] = [];
    let kept = 0;
    for (const shape of [
      [0, 4, 7],
      [0, 3, 7],
    ])
      for (const hand of ['R', 'L'] as const)
        for (let root = 0; root < 12; root++)
          for (const dur of TEMPOS) {
            const up = shape.map((s) => (hand === 'R' ? 60 : 48) + root + s);
            for (const midi of [up, [...up, up[1]!, up[0]!]]) {
              const want = (hand === 'R' ? [1, 3, 5, 3, 1] : [5, 3, 1, 3, 5]).slice(0, midi.length);
              const off = fingersOfMidi(midi, hand, dur, { templates: false });
              if (off.join() !== want.join()) continue;
              kept++;
              const on = fingersOfMidi(midi, hand, dur);
              if (on.join() !== want.join())
                moved.push(`${hand} ${midi.map(pitchName).join(' ')} at ${dur} s: ${on.join(' ')}`);
            }
          }
    expect(moved).toEqual([]);
    expect(kept).toBeGreaterThan(0);
  });
});

describe('textbook template files', () => {
  const src = fileURLToPath(new URL('../../../../benchmarks/textbook/', import.meta.url));
  const copy = fileURLToPath(new URL('./params/textbook/', import.meta.url));
  const FILES = ['scales.json', 'arpeggios.json', 'chromatic.json'];
  it('load only entries of at most two octaves, for both hands', () => {
    for (const hand of ['R', 'L'] as const) {
      const entries = TEXTBOOK_TEMPLATES[hand];
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((e) => e.hand === hand && (e.octaves ?? 1) <= 2)).toBe(true);
    }
    // 288 scales (1 and 2 octaves), 192 arpeggios and 48 chromatic scales, split by hand.
    expect(TEXTBOOK_TEMPLATES.R.length + TEXTBOOK_TEMPLATES.L.length).toBe(528);
  });
  // templates.ts reads the copies with its own strict reader (a value import from eval/textbook.ts
  // would close an import cycle through the solver); it must keep exactly what the oracle's
  // normalization keeps, so no entry is dropped for a finger outside 1..5.
  it('read the same entries as normalizeTextbookEntries', () => {
    const expected = FILES.flatMap(
      (f) => normalizeTextbookEntries(JSON.parse(readFileSync(join(copy, f), 'utf8'))).entries,
    )
      .filter((e) => (e.octaves ?? 1) <= 2)
      .map(({ id, family, key, mode, hand, direction, octaves, midi, fingers }) => ({
        id,
        family,
        key,
        mode,
        hand,
        direction,
        octaves,
        midi,
        fingers,
      }));
    expect([...TEXTBOOK_TEMPLATES.R, ...TEXTBOOK_TEMPLATES.L]).toEqual([
      ...expected.filter((e) => e.hand === 'R'),
      ...expected.filter((e) => e.hand === 'L'),
    ]);
  });
  // The copies are prettier-formatted, so their bytes differ from the oracle's; their content must
  // not. A regenerated oracle that was not copied again turns this red instead of silently
  // matching runs against stale templates.
  it.skipIf(!existsSync(src))('hold the same content as benchmarks/textbook', () => {
    for (const f of FILES) {
      const read = (dir: string): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8'));
      expect(read(copy), f).toEqual(read(src));
    }
  });
});

describe('textbook template reader', () => {
  it('drops an entry whose midi holds a NaN or an infinite number, and keeps a clean one', async () => {
    const entry = (id: string, midi: number[]) => ({
      id,
      family: 'scale',
      hand: 'rh',
      direction: 'asc',
      midi,
      fingers: midi.map(() => 1),
    });
    const entries = [
      entry('clean', [60, 62]),
      entry('nan', [60, Number.NaN]),
      entry('infinite', [60, Number.POSITIVE_INFINITY]),
    ];
    vi.resetModules();
    vi.doMock('./params/textbook/scales.json', () => ({ default: { entries } }));
    vi.doMock('./params/textbook/arpeggios.json', () => ({ default: { entries: [] } }));
    vi.doMock('./params/textbook/chromatic.json', () => ({ default: { entries: [] } }));
    try {
      const fresh = await import('./templates.js');
      expect(fresh.TEXTBOOK_TEMPLATES.R.map((e) => e.id)).toEqual(['clean']);
    } finally {
      vi.doUnmock('./params/textbook/scales.json');
      vi.doUnmock('./params/textbook/arpeggios.json');
      vi.doUnmock('./params/textbook/chromatic.json');
      vi.resetModules();
    }
  });
});
