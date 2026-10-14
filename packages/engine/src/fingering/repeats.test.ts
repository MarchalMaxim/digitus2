import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../io/musicxml/read.js';
import { parsePig } from '../io/pig/read.js';
import type { Finger } from '../score/types.js';
import {
  barPositions,
  findRepeats,
  identicalPassages,
  MIN_REPEAT_EVENTS,
  pairConsistency,
  repeatConsistency,
  repeatPairs,
} from './repeats.js';
import { buildHandSequence } from './sequence.js';

const H = '//Version: PianoFingering_v170101\n';
/** A right-hand melody: one row per note, `[onset, offset, pitch]`, or a chord as several rows. */
function seqOf(rows: Array<[number, number, string]>) {
  const text =
    H + rows.map(([on, off, p], i) => `${i}\t${on}\t${off}\t${p}\t80\t80\t0\t0`).join('\n') + '\n';
  return buildHandSequence(parsePig(text).score, 'R');
}
const LIBRARY = fileURLToPath(new URL('../../../../content/scores/', import.meta.url));
const libraryScore = (slug: string) =>
  parseMusicXml(readFileSync(`${LIBRARY}${slug}.musicxml`)).score;
/** The PIG text of a right-hand melody of quarter notes at 0.5 s. */
const pigText = (pitches: string[]) =>
  H +
  pitches.map((p, i) => `${i}\t${i * 0.5}\t${i * 0.5 + 0.5}\t${p}\t80\t80\t0\t0`).join('\n') +
  '\n';
/** Quarter notes at 0.5 s, back to back. */
const melody = (pitches: string[]) =>
  seqOf(pitches.map((p, k) => [k * 0.5, k * 0.5 + 0.5, p] as [number, number, string]));
/** Notes of `[pitch, beats]` at 0.5 s a beat, back to back. */
const tune = (notes: Array<[string, number]>) => {
  let beat = 0;
  return seqOf(
    notes.map(([p, d]) => {
      const row: [number, number, string] = [beat * 0.5, (beat + d) * 0.5, p];
      beat += d;
      return row;
    }),
  );
};
/**
 * The Ode to Joy shape: P (12 quarter-note events) on its own before ending 1, then twice as the
 * start of a 15-event passage (P and ending 2) that repeats as a whole, with a bridge between.
 * Sequence indices: P at 0, 15 and 47; the long passage at 15 and 47.
 */
function odeShape() {
  const q = (p: string): [string, number] => [p, 1];
  const P = ['E4', 'E4', 'F4', 'G4', 'G4', 'F4', 'E4', 'D4', 'C4', 'C4', 'D4', 'E4'].map(q);
  const end1: Array<[string, number]> = [
    ['E4', 1.5],
    ['D4', 0.5],
    ['D4', 2],
  ];
  const end2: Array<[string, number]> = [
    ['D4', 1.5],
    ['C4', 0.5],
    ['C4', 2],
  ];
  const bridge: Array<[string, number]> = [
    ...['D4', 'D4', 'E4', 'C4', 'D4'].map(q),
    ['E4', 0.5],
    ['F4', 0.5],
    ...['E4', 'C4', 'D4'].map(q),
    ['E4', 0.5],
    ['F4', 0.5],
    ...['E4', 'D4', 'C4', 'D4'].map(q),
    ['G3', 2],
  ];
  return tune([...P, ...end1, ...P, ...end2, ...bridge, ...P, ...end2]);
}

describe('findRepeats (M3 Task 7, H4)', () => {
  it('finds two copies of an identical passage of four events in different contexts', () => {
    const s = melody(['C4', 'F4', 'C4', 'C5', 'C4', 'A4', 'F4', 'E4', 'C4', 'C5', 'C4', 'A4']);
    expect(MIN_REPEAT_EVENTS).toBe(4);
    expect(findRepeats(s)).toEqual([{ starts: [2, 8], length: 4, events: 4 }]);
  });
  it('needs four events, the same keys, the same rhythm and the same durations', () => {
    // Three events repeated: too short.
    expect(findRepeats(melody(['C4', 'D4', 'E4', 'G4', 'C4', 'D4', 'E4']))).toEqual([]);
    // A transposed copy is not an identical passage: C D E F and G A B C have the same steps and
    // key colours, and a scale fingers them differently.
    expect(findRepeats(melody(['C4', 'D4', 'E4', 'F4', 'A3', 'G4', 'A4', 'B4', 'C5']))).toEqual([]);
    // The same melody untransposed is found.
    expect(findRepeats(melody(['C4', 'D4', 'E4', 'F4', 'A3', 'C4', 'D4', 'E4', 'F4']))).toEqual([
      { starts: [0, 5], length: 4, events: 4 },
    ]);
    // The same keys with another rhythm (the second copy twice as slow).
    const slow = seqOf([
      ...['C4', 'D4', 'E4', 'F4'].map(
        (p, k) => [k * 0.5, k * 0.5 + 0.5, p] as [number, number, string],
      ),
      [2, 2.5, 'A4'],
      ...['C4', 'D4', 'E4', 'F4'].map(
        (p, k) => [3 + k, 3 + k + 0.5, p] as [number, number, string],
      ),
    ]);
    expect(findRepeats(slow)).toEqual([]);
    // The same keys and onsets, one note held longer in the second copy.
    const held = seqOf([
      ...['C4', 'D4', 'E4', 'F4'].map(
        (p, k) => [k * 0.5, k * 0.5 + 0.5, p] as [number, number, string],
      ),
      [2, 2.5, 'A4'],
      [2.5, 3, 'C4'],
      [3, 3.5, 'D4'],
      [3.5, 4.5, 'E4'],
      [4, 4.5, 'F4'],
    ]);
    expect(findRepeats(held)).toEqual([]);
  });
  it('counts a chord as one event and finds every copy of a passage repeated back to back', () => {
    // C4 E4 G4 + C5 (a chord) then two single notes, four times in a row: one group of four copies.
    const rows: Array<[number, number, string]> = [];
    for (let c = 0; c < 4; c++) {
      const t = c * 2;
      rows.push([t, t + 0.5, 'C4'], [t, t + 0.5, 'E4'], [t, t + 0.5, 'G4']);
      rows.push([t + 0.5, t + 1, 'C5'], [t + 1, t + 1.5, 'B4'], [t + 1.5, t + 2, 'G4']);
    }
    const s = seqOf(rows);
    expect(findRepeats(s)).toEqual([{ starts: [0, 6, 12, 18], length: 6, events: 4 }]);
  });
  it('identicalPassages keeps every copy of a passage, also inside a longer repeated passage', () => {
    const s = odeShape();
    // Five events of the bridge recur in it (D E/F/ E C D and D E/F/ E D C share D E F E): a third
    // passage.
    expect(identicalPassages(s)).toEqual([
      { starts: [0, 15, 47], length: 12, events: 12 },
      { starts: [15, 47], length: 15, events: 15 },
      { starts: [32, 37], length: 5, events: 5 },
    ]);
    // The reporting grouping gives every event one group, so the first P belongs to none.
    expect(findRepeats(s)).toEqual([
      { starts: [15, 47], length: 15, events: 15 },
      { starts: [32, 37], length: 5, events: 5 },
    ]);
    // Back to back: every period is a copy, and so is every second period (two copies of eight).
    const rows: Array<[number, number, string]> = [];
    for (let c = 0; c < 4; c++) {
      const t = c * 2;
      rows.push([t, t + 0.5, 'C4'], [t, t + 0.5, 'E4'], [t, t + 0.5, 'G4']);
      rows.push([t + 0.5, t + 1, 'C5'], [t + 1, t + 1.5, 'B4'], [t + 1.5, t + 2, 'G4']);
    }
    expect(identicalPassages(seqOf(rows))).toEqual([
      { starts: [0, 6, 12, 18], length: 6, events: 4 },
      { starts: [0, 12], length: 12, events: 8 },
    ]);
    expect(identicalPassages(melody(['C4', 'D4', 'E4', 'G4', 'C4', 'D4', 'E4']))).toEqual([]);
  });
  it('repeatPairs lists every pair of identical passages, whatever any grouping keeps', () => {
    // The Ode to Joy shape: P with each copy of the long passage, the long passage with itself,
    // and the bridge's five events.
    expect(repeatPairs(odeShape())).toEqual([
      { a: 32, b: 37, length: 5, events: 5 },
      { a: 0, b: 15, length: 12, events: 12 },
      { a: 15, b: 47, length: 15, events: 15 },
      { a: 0, b: 47, length: 12, events: 12 },
    ]);
    // Four copies back to back: one pair per distance, each the non-overlapping part of the run
    // (copy 1 against copy 2, at distance 4 events, at 8 events copies 1-2 against 3-4, at 12
    // events copy 1 against copy 4).
    const rows: Array<[number, number, string]> = [];
    for (let c = 0; c < 4; c++) {
      const t = c * 2;
      rows.push([t, t + 0.5, 'C4'], [t, t + 0.5, 'E4'], [t, t + 0.5, 'G4']);
      rows.push([t + 0.5, t + 1, 'C5'], [t + 1, t + 1.5, 'B4'], [t + 1.5, t + 2, 'G4']);
    }
    expect(repeatPairs(seqOf(rows))).toEqual([
      { a: 0, b: 6, length: 6, events: 4 },
      { a: 0, b: 12, length: 12, events: 8 },
      { a: 0, b: 18, length: 6, events: 4 },
    ]);
    // A run of repeated notes overlapping itself: only parts of at least four events count.
    expect(repeatPairs(melody(['C4', 'C4', 'C4', 'C4', 'C4', 'C4', 'C4']))).toEqual([]);
    expect(repeatPairs(melody(['C4', 'D4', 'E4', 'G4', 'C4', 'D4', 'E4']))).toEqual([]);
  });
  it('with bar positions, a passage that recurs on another beat is not a repeat', () => {
    // Twinkle: F F E E fills bar 3 (and 11) and recurs from beat 3 of bar 5 to beat 2 of bar 6
    // (and 7-8). Tying those would carry bar 3's fingering into bars 5 to 8.
    const score = libraryScore('twinkle-twinkle-little-star');
    const seq = buildHandSequence(score, 'R');
    const positions = barPositions(score, seq);
    const first = (bar: string, k = 0) =>
      seq.notes.findIndex(
        (n) =>
          score.measures[score.notes.find((x) => x.id === n.noteId)!.measureIndex]!.number === bar,
      ) + k;
    const bar3 = first('3');
    const bar5beat3 = first('5', 2);
    const across = (p: { a: number; b: number }) => p.a === bar3 && p.b === bar5beat3;
    expect(repeatPairs(seq).some(across)).toBe(true);
    expect(repeatPairs(seq, { positions }).some(across)).toBe(false);
    // Bars 1 to 4 against 9 to 12 and bars 5-6 against 7-8 stay repeats.
    expect(repeatPairs(seq, { positions })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ a: first('1'), b: first('9') }),
        expect.objectContaining({ a: first('5'), b: first('7') }),
      ]),
    );
    // A score without bars (a PIG file) has no positions: every place matches.
    const pig = melody(['C4', 'D4', 'E4', 'F4']);
    expect(barPositions(parsePig(pigText(['C4', 'D4', 'E4', 'F4'])).score, pig)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
  it('barPositions counts a pickup bar from its end', () => {
    // Happy Birthday (3/4) starts on beat 3 with a pickup; its first two notes sit where the same
    // notes sit in bar 2.
    const score = libraryScore('happy-birthday');
    const seq = buildHandSequence(score, 'R');
    const positions = barPositions(score, seq);
    const bar = (i: number) =>
      score.measures[score.notes.find((x) => x.id === seq.notes[i]!.noteId)!.measureIndex]!;
    expect(bar(0).number).toBe('0');
    const quarter = score.measures[1]!.lengthTicks / 3;
    expect(positions.slice(0, 2)).toEqual([2 * quarter, 2 * quarter + quarter * 0.75]);
    const again = seq.notes.findIndex(
      (_, i) => i > 1 && bar(i).number === '2' && positions[i] === 2 * quarter,
    );
    expect(again).toBeGreaterThan(1);
    expect(seq.notes[again]!.pitch).toBe(seq.notes[0]!.pitch);
  });
  it('pairConsistency counts the pairs whose two copies take the same fingers', () => {
    const s = melody(['C4', 'F4', 'C4', 'C5', 'C4', 'A4', 'F4', 'E4', 'C4', 'C5', 'C4', 'A4']);
    const pairs = repeatPairs(s);
    expect(pairs).toEqual([{ a: 2, b: 8, length: 4, events: 4 }]);
    const f = (x: string) => [...x].map(Number) as Finger[];
    expect(pairConsistency(pairs, f('121515321515'))).toEqual({ pairs: 1, alike: 1 });
    expect(pairConsistency(pairs, f('121515321514'))).toEqual({ pairs: 1, alike: 0 });
    expect(pairConsistency([], [])).toEqual({ pairs: 0, alike: 0 });
  });
  it('repeatConsistency counts the groups whose copies all take the same fingers', () => {
    const s = melody(['C4', 'F4', 'C4', 'C5', 'C4', 'A4', 'F4', 'E4', 'C4', 'C5', 'C4', 'A4']);
    const groups = findRepeats(s);
    const f = (x: string) => [...x].map(Number) as Finger[];
    expect(repeatConsistency(groups, f('121515321515'))).toEqual({ groups: 1, consistent: 1 });
    expect(repeatConsistency(groups, f('121515321514'))).toEqual({ groups: 1, consistent: 0 });
    expect(repeatConsistency([], [])).toEqual({ groups: 0, consistent: 0 });
  });
});
