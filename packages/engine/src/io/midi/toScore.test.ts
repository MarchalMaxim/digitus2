import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatPigPitch } from '../../score/pitch.js';
import type { Hand } from '../../score/types.js';
import { quantize } from './quantize.js';
import { parseMidiFile, type MidiData } from './read.js';
import { midiToScore } from './toScore.js';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url))),
  );

function data(notes: Array<[number, number, number]>, extra: Partial<MidiData> = {}): MidiData {
  return {
    ppq: 480,
    tempos: [{ tick: 0, usPerQuarter: 500_000 }],
    timeSignatures: [{ tick: 0, beats: 4, beatType: 4 }],
    notes: notes.map(([tick, endTick, midi]) => ({
      tick,
      endTick,
      midi,
      velocity: 70,
      channel: 0,
      track: 0,
    })),
    warnings: [],
    ...extra,
  };
}
/** Hands by pitch (below 54 = left), so these tests do not depend on the separation DP. */
function build(d: MidiData) {
  const q = quantize(d);
  return midiToScore(
    d,
    q,
    q.notes.map((n) => (n.midi < 54 ? 'L' : 'R')),
    { title: 'test' },
  );
}

describe('midiToScore', () => {
  it('builds Twinkle from the MIDI fixture: 64 notes, 12 measures, the file key and tempo, one voice per hand', () => {
    const d = parseMidiFile(fixture('twinkle.mid'));
    const q = quantize(d);
    const truth: Hand[] = q.notes.map((n) => (d.notes[n.sources[0]!]!.track === 1 ? 'R' : 'L'));
    const { score, warnings } = midiToScore(d, q, truth, { title: 'twinkle' });
    expect(score.notes).toHaveLength(64);
    expect(score.divisions).toBe(480);
    expect(score.measures).toHaveLength(12);
    expect(score.measures.every((m) => m.lengthTicks === 1920)).toBe(true);
    expect(score.timeSignatures).toEqual([{ tick: 0, beats: 4, beatType: 4 }]);
    expect(score.keySignatures).toEqual([{ tick: 0, fifths: 0, mode: 'major' }]);
    expect(score.tempoMap).toEqual([{ tick: 0, qpm: 100 }]);
    expect(score.notes.map((n) => n.id)).toEqual(score.notes.map((_, i) => `m${i}`));
    expect(score.notes.filter((n) => n.hand === 'R').map((n) => [n.staff, n.voice])).toEqual(
      Array(42).fill([1, 1]),
    );
    expect(score.notes.filter((n) => n.hand === 'L').map((n) => [n.staff, n.voice])).toEqual(
      Array(22).fill([2, 5]),
    );
    expect(score.notes[score.notes.length - 1]!.offsetSec).toBeCloseTo(28.8, 9);
    expect(score.notes.every((n) => n.velocity === 80 && !n.isGrace)).toBe(true);
    expect(score.meta.title).toBe('twinkle');
    expect(warnings).toEqual([]);
  });
  it("shortens a held note of one hand at that hand's next onset and says so", () => {
    const { score, warnings } = build(
      data([
        [0, 1920, 48],
        [960, 1440, 52],
        [0, 480, 72],
      ]),
    );
    expect(score.notes.map((n) => [n.hand, n.midi, n.onsetTick, n.offsetTick])).toEqual([
      ['R', 72, 0, 480],
      ['L', 48, 0, 960],
      ['L', 52, 960, 1440],
    ]);
    expect(warnings).toEqual(['1 note was shortened so each hand has one voice']);
  });
  it('gives the notes of one hand that start together one common end', () => {
    const { score, warnings } = build(
      data([
        [0, 1920, 43],
        [0, 480, 50],
        [960, 1920, 47],
      ]),
    );
    expect(score.notes.map((n) => [n.midi, n.offsetTick])).toEqual([
      [43, 960],
      [50, 960],
      [47, 1920],
    ]);
    expect(warnings).toEqual(['1 note was shortened so each hand has one voice']);
  });
  it('warns about six notes in one hand at one time', () => {
    const { warnings } = build(
      data([60, 62, 64, 65, 67, 69].map((m) => [0, 480, m] as [number, number, number])),
    );
    expect(warnings).toEqual(['measure 1: 6 notes in the right hand at one time']);
  });
  it('warns about a hand stretched beyond 17 semitones', () => {
    const { warnings } = build(
      data([
        [0, 480, 60],
        [0, 480, 79],
      ]),
    );
    expect(warnings).toEqual(['measure 1: the right hand spans 19 semitones at one time']);
  });
  it('estimates the key when the file has none and spells with it', () => {
    const q = 480;
    const { score } = build(
      data([
        [0, 4 * q, 57],
        [4 * q, 6 * q, 60],
        [6 * q, 8 * q, 64],
        [8 * q, 9 * q, 56],
        [9 * q, 10 * q, 59],
        [10 * q, 11 * q, 62],
        [11 * q, 12 * q, 65],
        [12 * q, 14 * q, 69],
        [0, 4 * q, 45],
      ]),
    );
    expect(score.keySignatures).toEqual([{ tick: 0, fifths: 0, mode: 'minor' }]);
    expect(formatPigPitch(score.notes.find((n) => n.midi === 56)!.spelling)).toBe('G#3');
  });
  it('uses the key signature of the file when there is one', () => {
    const { score } = build(
      data(
        [
          [0, 480, 63],
          [480, 960, 68],
        ],
        { keySignature: { fifths: -3, mode: 'major' } },
      ),
    );
    expect(score.keySignatures).toEqual([{ tick: 0, fifths: -3, mode: 'major' }]);
    expect(score.notes.map((n) => formatPigPitch(n.spelling))).toEqual(['Eb4', 'Ab4']);
  });
  it('moves a time signature change that falls inside a measure to the next barline', () => {
    const { score, warnings } = build(
      data(
        [
          [0, 480, 60],
          [4800, 5280, 62],
        ],
        {
          timeSignatures: [
            { tick: 0, beats: 4, beatType: 4 },
            { tick: 2400, beats: 3, beatType: 4 },
          ],
        },
      ),
    );
    expect(score.measures.map((m) => [m.startTick, m.lengthTicks])).toEqual([
      [0, 1920],
      [1920, 1920],
      [3840, 1440],
    ]);
    expect(score.timeSignatures).toEqual([
      { tick: 0, beats: 4, beatType: 4 },
      { tick: 3840, beats: 3, beatType: 4 },
    ]);
    expect(warnings).toEqual(['1 time signature change moved to the next barline']);
  });
  it('snaps tempo changes to the nearest 32nd note and keeps the seconds of the tempo map', () => {
    const { score } = build(
      data(
        [
          [0, 480, 60],
          [960, 1440, 62],
        ],
        {
          tempos: [
            { tick: 0, usPerQuarter: 500_000 },
            { tick: 470, usPerQuarter: 1_000_000 },
          ],
        },
      ),
    );
    expect(score.tempoMap).toEqual([
      { tick: 0, qpm: 120 },
      { tick: 480, qpm: 60 },
    ]);
    expect(score.notes[1]!.onsetSec).toBeCloseTo(1.5, 9);
  });
  it('covers the last note with whole measures that start at tick 0', () => {
    const { score } = build(data([[960, 2000, 60]]));
    expect(score.measures.map((m) => m.startTick)).toEqual([0, 1920]);
    expect(score.notes[0]!.measureIndex).toBe(0);
    expect(score.notes[0]!.offsetTick).toBe(2040);
  });
  it('ignores a time signature that gives a measure no length instead of looping forever', () => {
    // midi-file reads the denominator as 1 << byte: a byte of 31 gives a negative beat type.
    const { score, warnings } = build(
      data(
        [
          [0, 480, 60],
          [1920, 2400, 62],
        ],
        {
          timeSignatures: [
            { tick: 0, beats: 0, beatType: 4 },
            { tick: 1920, beats: 3, beatType: 1 << 31 },
          ],
        },
      ),
    );
    expect(score.measures.map((m) => [m.startTick, m.lengthTicks])).toEqual([
      [0, 1920],
      [1920, 1920],
    ]);
    expect(score.timeSignatures).toEqual([{ tick: 0, beats: 4, beatType: 4 }]);
    expect(warnings).toEqual(['ignored 2 unusable time signatures']);
  });
  it('builds a score from more notes than one function call takes as arguments', () => {
    const n = 200_000;
    const q = quantize(data([]));
    q.notes = Array.from({ length: n }, (_, i) => ({
      onset: i * 120,
      offset: i * 120 + 120,
      onsetSec: i / 8,
      midi: 60 + (i % 12),
      velocity: 64,
      channel: 0,
      track: 0,
      sources: [i],
    }));
    const { score } = midiToScore(
      data([]),
      q,
      q.notes.map(() => 'R'),
    );
    expect(score.notes).toHaveLength(n);
    expect(score.measures).toHaveLength((n * 120) / 1920);
  });
});
