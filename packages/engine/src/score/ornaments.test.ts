import { describe, expect, it } from 'vitest';
import type { Note, Ornament } from './types.js';
import { ornamentAttacks } from './ornaments.js';

function principal(ornament: Partial<Ornament> = {}): Note {
  return {
    id: 'n0',
    midi: 60,
    spelling: { step: 'C', octave: 4, alter: 0 },
    hand: 'R',
    staff: 1,
    voice: 1,
    measureIndex: 0,
    sourceIndices: [0],
    chordId: 'R@0',
    isGrace: false,
    onsetTick: 0,
    offsetTick: 24,
    onsetSec: 2,
    offsetSec: 5,
    ornament: {
      kind: 'inverted-mordent',
      long: false,
      upperMidi: 62,
      lowerMidi: 59,
      startNote: 'main',
      endTick: 24,
      endSec: 5,
      ...ornament,
    },
  };
}

describe('default ornament realization', () => {
  it.each([
    ['inverted-mordent', false, [60, 62, 60]],
    ['inverted-mordent', true, [60, 62, 60, 62, 60]],
    ['mordent', false, [60, 59, 60]],
    ['mordent', true, [60, 59, 60, 59, 60]],
  ] as const)('realizes %s long=%s then holds the written principal', (kind, long, pitches) => {
    const n = principal({ kind, long });
    const before = structuredClone(n);
    const events = ornamentAttacks(n);
    expect(events.map((e) => e.midi)).toEqual(pitches);
    expect(events[0]?.onsetSec).toBe(2);
    expect(events.at(-1)?.offsetSec).toBe(5);
    expect(events.at(-1)!.onsetSec).toBeLessThan(2.4);
    events.forEach((e, i) => {
      expect(e.offsetSec).toBeGreaterThan(e.onsetSec);
      if (i) expect(e.onsetSec).toBe(events[i - 1]!.offsetSec);
    });
    expect(n).toEqual(before);
  });

  it('alternates trills through the whole first written duration and lands on the principal', () => {
    const events = ornamentAttacks(principal({ kind: 'trill-mark', endSec: 3 }));
    expect(events).toHaveLength(9);
    expect(events.map((e) => e.midi)).toEqual([60, 62, 60, 62, 60, 62, 60, 62, 60]);
    expect(events.at(-1)?.onsetSec).toBeLessThan(3);
    expect(events.at(-1)?.offsetSec).toBe(5); // tied continuation holds without more ornaments
  });

  it('honors explicit attack count and upper start', () => {
    expect(
      ornamentAttacks(principal({ kind: 'trill-mark', startNote: 'upper', beats: 6 })).map(
        (e) => e.midi,
      ),
    ).toEqual([62, 60, 62, 60, 62, 60]);
  });
  it('honors a lower starting note without changing the trill alternating pitch', () => {
    expect(
      ornamentAttacks(principal({ kind: 'trill-mark', startNote: 'below', beats: 4 })).map(
        (e) => e.midi,
      ),
    ).toEqual([59, 60, 62, 60]);
  });

  it('fits very short notes and ignores an out-of-piano auxiliary safely', () => {
    const n = principal({ long: true, endSec: 2.01 });
    n.offsetSec = 2.01;
    expect(
      ornamentAttacks(n).every(
        (e) => e.onsetSec >= 2 && e.offsetSec <= 2.01 && e.offsetSec > e.onsetSec,
      ),
    ).toBe(true);
    const edge = principal({ upperMidi: 109 });
    expect(ornamentAttacks(edge)).toEqual([{ midi: 60, onsetSec: 2, offsetSec: 5 }]);
  });

  it('keeps ordinary notes as one event', () => {
    const n = principal();
    delete n.ornament;
    expect(ornamentAttacks(n)).toEqual([{ midi: 60, onsetSec: 2, offsetSec: 5 }]);
  });
});
