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
