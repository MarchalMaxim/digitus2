import type { Assignment, Finger, Hand, Score } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { repeatedChordIds } from './repeatedChords.js';

type Spec = [id: string, bar: number, tick: number, midi: number, finger: Finger, hand?: Hand];

function piece(specs: Spec[], grace: string[] = []) {
  const score = {
    notes: specs.map(([id, measureIndex, onsetTick, midi, , hand = 'R']) => ({
      id,
      measureIndex,
      onsetTick,
      midi,
      hand,
      isGrace: grace.includes(id),
    })),
  } as unknown as Score;
  const assignment: Assignment = {};
  for (const [id, , , , finger] of specs) assignment[id] = { finger, source: 'engine' };
  return { score, assignment };
}

/** C-E-G with 1-3-5 in the right hand at `tick`, ids `<p>c`, `<p>e`, `<p>g`. */
const cMajor = (p: string, bar: number, tick: number): Spec[] => [
  [`${p}c`, bar, tick, 60, 1],
  [`${p}e`, bar, tick, 64, 3],
  [`${p}g`, bar, tick, 67, 5],
];

describe('repeatedChordIds', () => {
  it('leaves the repeats of a chord bare and keeps the first', () => {
    const { score, assignment } = piece([
      ...cMajor('a', 0, 0),
      ...cMajor('b', 0, 4),
      ...cMajor('c', 0, 8),
    ]);
    expect([...repeatedChordIds(score, assignment)].sort()).toEqual([
      'bc',
      'be',
      'bg',
      'cc',
      'ce',
      'cg',
    ]);
  });
  it('keeps a repeat fingered differently', () => {
    const { score, assignment } = piece([...cMajor('a', 0, 0), ...cMajor('b', 0, 4)]);
    assignment['bg'] = { finger: 4, source: 'engine' };
    expect(repeatedChordIds(score, assignment).size).toBe(0);
  });
  it('fingers the first chord of every bar', () => {
    const { score, assignment } = piece([...cMajor('a', 0, 0), ...cMajor('b', 1, 16)]);
    expect(repeatedChordIds(score, assignment).size).toBe(0);
  });
  it('leaves a chord bare that came earlier in the bar, with another chord between', () => {
    const { score, assignment } = piece([
      ...cMajor('a', 0, 0),
      ['bd', 0, 4, 62, 1],
      ['bf', 0, 4, 65, 2],
      ['ba', 0, 4, 69, 4],
      ...cMajor('c', 0, 8),
    ]);
    expect([...repeatedChordIds(score, assignment)].sort()).toEqual(['cc', 'ce', 'cg']);
  });
  it('compares a hand only with itself, and a chord only with a whole chord', () => {
    const { score, assignment } = piece([
      ...cMajor('a', 0, 0),
      ['lc', 0, 4, 60, 1, 'L'],
      ['le', 0, 4, 64, 3, 'L'],
      ['lg', 0, 4, 67, 5, 'L'],
      ['bc', 0, 8, 60, 1],
      ['be', 0, 8, 64, 3],
    ]);
    expect(repeatedChordIds(score, assignment).size).toBe(0);
  });
  it('leaves single notes and grace notes alone', () => {
    const { score, assignment } = piece(
      [
        ['a', 0, 0, 60, 1],
        ['b', 0, 4, 60, 1],
        ...cMajor('c', 0, 8),
        ['gc', 0, 12, 60, 1],
        ['ge', 0, 12, 64, 3],
        ['gg', 0, 12, 67, 5],
      ],
      ['gc', 'ge', 'gg'],
    );
    expect(repeatedChordIds(score, assignment).size).toBe(0);
  });
  it('reads the bar in time order, whatever the order of the notes', () => {
    const { score, assignment } = piece([...cMajor('b', 0, 4), ...cMajor('a', 0, 0)]);
    expect([...repeatedChordIds(score, assignment)].sort()).toEqual(['bc', 'be', 'bg']);
  });
  it('keeps a repeat whose substitution differs', () => {
    const { score, assignment } = piece([...cMajor('a', 0, 0), ...cMajor('b', 0, 4)]);
    assignment['bg'] = { finger: 5, substitution: 4, source: 'engine' };
    expect(repeatedChordIds(score, assignment).size).toBe(0);
  });
});
