import { describe, expect, it } from 'vitest';
import { notesOf } from './notes.js';
import { pitchTrack } from './pitch.js';
import { keyOf, quantise } from './rhythm.js';
import {
  C_MAJOR_SCALE,
  ODE_TO_JOY,
  perform,
  SIXTEENTHS,
  synthesize,
  TWINKLE,
  WITH_REST,
  type Melody,
  type PerformOptions,
} from './testing/synth.js';

const RATE = 16000;

function rhythmOf(melody: Melody, played: PerformOptions = {}) {
  const { tones, written } = perform(melody, played);
  const samples = synthesize(tones, { sampleRate: RATE, vibratoCents: 25, noiseDb: -30 });
  return { rhythm: quantise(notesOf(pitchTrack(samples, RATE))), written };
}

/** What a perfect reading gives, in sixteenths. */
const expected = (written: { midi: number; beat: number; beats: number }[]) =>
  written.map((w) => ({ midi: w.midi, start: w.beat * 4, length: w.beats * 4 }));

describe('quantise', () => {
  for (const melody of [ODE_TO_JOY, TWINKLE, C_MAJOR_SCALE, WITH_REST, SIXTEENTHS]) {
    // A sixteenth is a quarter of a beat: a stray of 8 % of a beat is a third of its length.
    const stray = melody === SIXTEENTHS ? 0.03 : 0.08;
    for (const [name, played] of [
      ['steady', {}],
      ['slightly rubato', { rubato: stray }],
    ] as const) {
      it(`${melody.name}, ${name}, comes back in its written rhythm and tempo`, () => {
        const { rhythm, written } = rhythmOf(melody, played);
        expect(rhythm.notes).toEqual(expected(written));
        expect(Math.abs(rhythm.bpm - melody.bpm) / melody.bpm).toBeLessThan(0.06);
      });
    }
  }

  it('drops the silence before the first note', () => {
    const { rhythm } = rhythmOf(ODE_TO_JOY, { lead: 1.7 });
    expect(rhythm.notes[0]!.start).toBe(0);
  });

  it('keeps the tempo in 60 to 140 beats a minute, where the grid fits as well', () => {
    for (const bpm of [64, 88, 132]) {
      const { rhythm, written } = rhythmOf(TWINKLE, { bpm });
      expect(rhythm.notes).toEqual(expected(written));
      expect(Math.abs(rhythm.bpm - bpm) / bpm).toBeLessThan(0.06);
    }
  });

  it('gives a single note a length and the default tempo', () => {
    const { rhythm } = rhythmOf({ name: 'one', bpm: 100, notes: [{ midi: 67, beats: 2 }] });
    expect(rhythm.notes).toHaveLength(1);
    expect(rhythm.notes[0]!.start).toBe(0);
    expect(rhythm.notes[0]!.length).toBeGreaterThan(0);
  });

  it('gives nothing for no notes', () => {
    expect(quantise([]).notes).toEqual([]);
  });

  it('never lets two notes share a place', () => {
    const rhythm = quantise([
      { midi: 60, start: 0, end: 0.1 },
      { midi: 62, start: 0.11, end: 0.2 },
      { midi: 64, start: 0.22, end: 0.3 },
    ]);
    const starts = rhythm.notes.map((n) => n.start);
    expect(new Set(starts).size).toBe(3);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});

describe('keyOf', () => {
  const tune = (pitches: number[]) => pitches.map((midi) => ({ midi, start: 0, length: 4 }));

  it('reads C major from a C major scale and Twinkle', () => {
    expect(keyOf(tune([60, 62, 64, 65, 67, 69, 71, 72]))).toEqual({ fifths: 0, mode: 'major' });
    const twinkle = rhythmOf(TWINKLE).rhythm;
    expect(twinkle.key).toEqual({ fifths: 0, mode: 'major' });
  });

  it('reads the first two bars of Ode to Joy in C major, with no sharp in the signature', () => {
    // E E F G G F E D: the notes fit G major's scale less well than C major's (F is not F sharp).
    expect(keyOf(tune([64, 64, 65, 67, 67, 65, 64, 62]))).toEqual({ fifths: 0, mode: 'major' });
  });

  it('reads G major from a tune with F sharp', () => {
    expect(keyOf(tune([67, 69, 71, 72, 74, 76, 78, 79, 74, 71, 67]))).toEqual({
      fifths: 1,
      mode: 'major',
    });
  });

  it('reads F major from a tune with B flat', () => {
    expect(keyOf(tune([65, 67, 69, 70, 72, 70, 69, 67, 65, 69, 72, 65]))).toEqual({
      fifths: -1,
      mode: 'major',
    });
  });

  it('reads A minor from a tune that settles on A with a G sharp', () => {
    expect(keyOf(tune([69, 71, 72, 71, 69, 64, 68, 69, 76, 72, 71, 68, 69]))).toEqual({
      fifths: 0,
      mode: 'minor',
    });
  });

  it('gives C major for no notes', () => {
    expect(keyOf([])).toEqual({ fifths: 0, mode: 'major' });
  });
});
