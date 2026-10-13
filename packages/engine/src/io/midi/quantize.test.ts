import { describe, expect, it } from 'vitest';
import type { MidiData } from './read.js';
import { chooseGrid, QUANT_DIVISIONS, quantize } from './quantize.js';

function data(notes: Array<[number, number, number]>, ppq = 480): MidiData {
  return {
    ppq,
    tempos: [{ tick: 0, usPerQuarter: 500_000 }],
    timeSignatures: [{ tick: 0, beats: 4, beatType: 4 }],
    notes: notes.map(([tick, endTick, midi], i) => ({
      tick,
      endTick,
      midi,
      velocity: 80,
      channel: 0,
      track: i % 2,
    })),
    warnings: [],
  };
}

describe('quantize', () => {
  it('snaps 16th notes played with up to 20 ms of jitter back onto the grid', () => {
    // ticks at 480 per quarter and 120 quarter notes per minute: 19 ticks = 19.8 ms
    const jitter = [19, -19, 12, -7, 0, 15, -15, 5, -19, 19, 3, -3, 10, -10, 18, -18];
    const q = quantize(data(jitter.map((j, k) => [k * 120 + j, k * 120 + j + 100, 60 + (k % 5)])));
    expect(q.divisions).toBe(QUANT_DIVISIONS);
    expect(q.notes.map((n) => n.onset)).toEqual(jitter.map((_, k) => k * 120));
    expect(q.notes.map((n) => n.offset - n.onset)).toEqual(jitter.map(() => 120));
    expect(q.beatGrids.map((b) => b.grid)).toEqual(['16th', '16th', '16th', '16th']);
    expect(q.grids).toEqual({ '16th': 4, '16th-triplet': 0, '32nd': 0 });
    expect(q.movedShare).toBe(0);
    expect(q.displacementMs.max).toBeGreaterThan(19);
    expect(q.displacementMs.max).toBeLessThanOrEqual(20);
    expect(q.warnings).toEqual([]);
  });
  it('detects a triplet beat next to a straight one', () => {
    const q = quantize(
      data([
        [0, 230, 60],
        [240, 470, 62],
        [486, 636, 64],
        [634, 784, 65],
        [803, 953, 67],
      ]),
    );
    expect(q.notes.map((n) => n.onset)).toEqual([0, 240, 480, 640, 800]);
    expect(q.notes.map((n) => n.offset)).toEqual([240, 480, 640, 800, 960]);
    expect(q.beatGrids).toEqual([
      { beat: 0, grid: '16th' },
      { beat: 1, grid: '16th-triplet' },
    ]);
    expect(q.grids).toEqual({ '16th': 1, '16th-triplet': 1, '32nd': 0 });
  });
  it('chooses the grid a beat really uses', () => {
    expect(chooseGrid([0, 60, 120, 180])).toBe('32nd');
    expect(chooseGrid([0, 120, 240, 360])).toBe('16th');
    expect(chooseGrid([0, 160, 320])).toBe('16th-triplet');
    expect(chooseGrid([0, 60, 120, 180], ['16th'])).toBe('16th');
  });
  it('keeps a quarter note played 40 ticks late on its beat and counts it as moved', () => {
    const q = quantize(
      data([
        [0, 470, 60],
        [520, 950, 62],
        [960, 1430, 64],
        [1440, 1910, 65],
      ]),
    );
    expect(q.notes.map((n) => n.onset)).toEqual([0, 480, 960, 1440]);
    expect(q.movedShare).toBe(0.25);
    expect(q.displacementMs.max).toBeCloseTo((40 * 500) / 480, 6);
  });
  it('merges simultaneous notes on one key and shortens a note that overlaps the next on its key', () => {
    const q = quantize(
      data([
        [0, 470, 60],
        [5, 200, 60],
        [960, 1440, 62],
        [1200, 1680, 62],
      ]),
    );
    expect(q.notes.map((n) => [n.onset, n.offset, n.midi, n.sources])).toEqual([
      [0, 480, 60, [0, 1]],
      [960, 1200, 62, [2]],
      [1200, 1680, 62, [3]],
    ]);
    for (const n of q.notes) expect(n.offset).toBeGreaterThan(n.onset);
    expect(q.warnings).toEqual([
      'merged 1 duplicate note',
      'shortened 1 note that overlapped the next note on the same key',
    ]);
  });
  it('gives a note shorter than the grid one grid unit', () => {
    expect(quantize(data([[480, 490, 60]])).notes[0]).toMatchObject({ onset: 480, offset: 600 });
  });
  it('converts other resolutions and computes seconds through the tempo map', () => {
    const d = data(
      [
        [24, 48, 60],
        [96, 192, 62],
      ],
      96,
    );
    d.tempos = [
      { tick: 0, usPerQuarter: 500_000 },
      { tick: 96, usPerQuarter: 1_000_000 },
    ];
    const q = quantize(d);
    expect(q.notes.map((n) => [n.onset, n.offset])).toEqual([
      [120, 240],
      [480, 960],
    ]);
    expect(q.notes.map((n) => n.onsetSec)).toEqual([0.125, 0.5]);
  });
  it('handles an empty file', () => {
    const q = quantize(data([]));
    expect(q.notes).toEqual([]);
    expect(q.movedShare).toBe(0);
    expect(q.displacementMs).toEqual({ mean: 0, p95: 0, max: 0 });
    expect(q.grids).toEqual({ '16th': 0, '16th-triplet': 0, '32nd': 0 });
  });
});
