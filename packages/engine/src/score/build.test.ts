import { describe, expect, it } from 'vitest';
import {
  assignChordIds,
  finalizeScore,
  handEvents,
  sortNotes,
  tickSeconds,
  ticksToSeconds,
  validateScore,
} from './build.js';
import type { Note, Score, TempoEvent } from './types.js';

function note(p: Partial<Note> & { id: string; midi: number; onsetTick: number }): Note {
  return {
    offsetTick: p.onsetTick + 480,
    onsetSec: 0,
    offsetSec: 0,
    spelling: { step: 'C', alter: 0, octave: 4 },
    hand: 'R',
    staff: 1,
    voice: 1,
    measureIndex: 0,
    isGrace: false,
    chordId: '',
    sourceIndices: [],
    ...p,
  };
}

const base: Omit<Score, 'notes'> = {
  meta: {},
  divisions: 480,
  tempoMap: [{ tick: 0, qpm: 120 }],
  timeSignatures: [],
  keySignatures: [],
  measures: [{ index: 0, startTick: 0, lengthTicks: 1920, number: '1' }],
};

describe('ticksToSeconds', () => {
  it('uses a single tempo', () => {
    expect(ticksToSeconds([{ tick: 0, qpm: 120 }], 480, 480)).toBeCloseTo(0.5);
    expect(ticksToSeconds([{ tick: 0, qpm: 60 }], 480, 960)).toBeCloseTo(2);
  });
  it('integrates across tempo changes', () => {
    const map = [
      { tick: 0, qpm: 120 },
      { tick: 960, qpm: 60 },
    ];
    expect(ticksToSeconds(map, 480, 960)).toBeCloseTo(1);
    expect(ticksToSeconds(map, 480, 1440)).toBeCloseTo(2);
  });
  it('falls back to 120 qpm when the map is empty', () => {
    expect(ticksToSeconds([], 480, 480)).toBeCloseTo(0.5);
  });
});

/**
 * The converter as it was before `tickSeconds`: a copy, a sort and a walk of the whole map on
 * every call. The reference the single implementation must match to the last bit.
 */
function referenceSeconds(tempoMap: TempoEvent[], divisions: number, tick: number): number {
  const map =
    tempoMap.length > 0 ? [...tempoMap].sort((a, b) => a.tick - b.tick) : [{ tick: 0, qpm: 120 }];
  let seconds = 0;
  let cursor = 0;
  let qpm = map[0]!.tick <= 0 ? map[0]!.qpm : 120;
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

/** A small seeded generator (mulberry32), so a failing map can be replayed. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('tickSeconds', () => {
  const maps: Record<string, TempoEvent[]> = {
    'an empty map': [],
    'one event at 0': [{ tick: 0, qpm: 90 }],
    'a first event after tick 0': [
      { tick: 100, qpm: 60 },
      { tick: 700, qpm: 200 },
    ],
    'events at the same tick': [
      { tick: 0, qpm: 120 },
      { tick: 480, qpm: 90 },
      { tick: 480, qpm: 60 },
      { tick: 480, qpm: 75 },
      { tick: 960, qpm: 150 },
    ],
    'unsorted events': [
      { tick: 960, qpm: 60 },
      { tick: 0, qpm: 100 },
      { tick: 480.5, qpm: 133.3 },
      { tick: 240, qpm: 80 },
    ],
  };
  const random = seeded(203);
  for (let m = 0; m < 40; m++) {
    const n = 1 + Math.floor(random() * 30);
    maps[`random map ${m}`] = Array.from({ length: n }, () => ({
      // Whole ticks, with repeats, and now and then a fractional one.
      tick: random() < 0.15 ? Math.floor(random() * 4000) + 0.25 : Math.floor(random() * 4000),
      qpm: 20 + random() * 280,
    }));
  }

  /** Ticks to ask each map: the edges, fractions, every event's tick, and random ones. */
  function ticksFor(map: TempoEvent[]): number[] {
    const ticks = [0, -1, -480.5, 0.5, 479.999, 480.25, 1e6, Infinity];
    for (const ev of map) ticks.push(ev.tick, ev.tick - 1e-9, ev.tick + 1e-9, ev.tick + 0.5);
    for (let i = 0; i < 20; i++) ticks.push(random() * 5000);
    return ticks;
  }

  for (const divisions of [1, 4, 12, 480, 960]) {
    it(`gives the seconds of the walk it replaces, to the last bit (divisions ${divisions})`, () => {
      let compared = 0;
      for (const [name, map] of Object.entries(maps)) {
        const before = JSON.stringify(map);
        const secAt = tickSeconds(map, divisions);
        for (const tick of ticksFor(map)) {
          const expected = referenceSeconds(map, divisions, tick);
          expect(secAt(tick), `${name} at ${tick}`).toBe(expected);
          expect(ticksToSeconds(map, divisions, tick), `${name} at ${tick}`).toBe(expected);
          compared++;
        }
        expect(JSON.stringify(map), `${name} is left as it was`).toBe(before);
      }
      expect(compared).toBeGreaterThan(2000);
    });
  }

  it('can be asked about many ticks in any order', () => {
    const map = maps['unsorted events']!;
    const secAt = tickSeconds(map, 480);
    expect(secAt(1500)).toBe(referenceSeconds(map, 480, 1500));
    expect(secAt(10)).toBe(referenceSeconds(map, 480, 10));
    expect(secAt(1500)).toBe(referenceSeconds(map, 480, 1500));
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
    const bad = finalizeScore({
      ...base,
      notes: [note({ id: 'a', midi: 20, onsetTick: 0 }), note({ id: 'a', midi: 60, onsetTick: 0 })],
    });
    const problems = validateScore(bad);
    expect(problems.some((p) => p.includes('midi'))).toBe(true);
    expect(problems.some((p) => p.includes('duplicate'))).toBe(true);
  });
  it('rejects a non-integer or non-numeric midi', () => {
    for (const midi of [60.5, Number.NaN]) {
      const bad = finalizeScore({ ...base, notes: [note({ id: 'a', midi, onsetTick: 0 })] });
      expect(
        validateScore(bad).some((p) => p.includes('integer')),
        String(midi),
      ).toBe(true);
    }
  });
  it('rejects offsets before onsets for non-grace notes', () => {
    const bad = finalizeScore({
      ...base,
      notes: [note({ id: 'a', midi: 60, onsetTick: 480, offsetTick: 240 })],
    });
    expect(validateScore(bad).some((p) => p.includes('offset'))).toBe(true);
  });
});
