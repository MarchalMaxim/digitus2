import { describe, expect, it } from 'vitest';
import { notesOf } from './notes.js';
import { pitchTrack } from './pitch.js';
import {
  C_MAJOR_SCALE,
  ODE_TO_JOY,
  perform,
  synthesize,
  TWINKLE,
  type Melody,
  type PerformOptions,
  type SynthOptions,
} from './testing/synth.js';

const RATE = 16000;

/** A melody whistled, tracked and cut into notes: the whole path but the rhythm. */
function heard(melody: Melody, signal: SynthOptions = {}, played: PerformOptions = {}) {
  const { tones, written } = perform(melody, played);
  const samples = synthesize(tones, { sampleRate: RATE, ...signal });
  return { notes: notesOf(pitchTrack(samples, RATE)), tones, written };
}

const conditions: [string, SynthOptions][] = [
  ['clean', {}],
  ['vibrato of 30 cents at 5 Hz', { vibratoCents: 30 }],
  ['a glide of 80 ms into each note', { glideMs: 80 }],
  ['noise at -25 dB', { noiseDb: -25 }],
  ['all of them', { vibratoCents: 30, glideMs: 80, noiseDb: -25 }],
];

describe('notesOf', () => {
  for (const melody of [C_MAJOR_SCALE, ODE_TO_JOY, TWINKLE]) {
    for (const [name, signal] of conditions) {
      it(`${melody.name} comes back with its pitches under ${name}`, () => {
        const { notes, written } = heard(melody, signal);
        expect(notes.map((n) => n.midi)).toEqual(written.map((w) => w.midi));
      });
    }
  }

  it('places each onset within 30 ms of where the note began', () => {
    const { notes, tones } = heard(ODE_TO_JOY, { vibratoCents: 30, glideMs: 80, noiseDb: -25 });
    notes.forEach((n, i) => expect(Math.abs(n.start - tones[i]!.start)).toBeLessThan(0.03));
  });

  it('counts a repeated note with a breath between as two notes', () => {
    const { notes } = heard({
      name: 'repeat',
      bpm: 100,
      notes: [
        { midi: 64, beats: 1 },
        { midi: 64, beats: 1 },
      ],
    });
    expect(notes.map((n) => n.midi)).toEqual([64, 64]);
  });

  it('keeps one note that wavers inside a semitone', () => {
    const { notes } = heard(
      { name: 'one', bpm: 60, notes: [{ midi: 67, beats: 3 }] },
      { vibratoCents: 45, vibratoHz: 6 },
    );
    expect(notes.map((n) => n.midi)).toEqual([67]);
  });

  it('folds the melody by whole octaves into the treble staff, whichever octave was whistled', () => {
    for (const octaves of [1, 2, 3]) {
      const { notes, written } = heard(ODE_TO_JOY, {}, { octaves });
      expect(notes.map((n) => n.midi)).toEqual(written.map((w) => w.midi));
    }
  });

  it('reads a person who whistles consistently sharp as the same notes', () => {
    const { tones, written } = perform(ODE_TO_JOY);
    const sharp = tones.map((t) => ({ ...t, midi: t.midi + 0.4 }));
    const notes = notesOf(pitchTrack(synthesize(sharp, { sampleRate: RATE }), RATE));
    expect(notes.map((n) => n.midi)).toEqual(written.map((w) => w.midi));
  });

  it('leaves out a click shorter than 70 ms', () => {
    const { tones } = perform(C_MAJOR_SCALE);
    const click = { midi: 100, start: 0.1, end: 0.15 };
    const notes = notesOf(pitchTrack(synthesize([click, ...tones], { sampleRate: RATE }), RATE));
    expect(notes).toHaveLength(8);
  });

  it('finds nothing in silence or in noise', () => {
    expect(notesOf(pitchTrack(new Float32Array(RATE * 2), RATE))).toEqual([]);
    const hiss = synthesize([], { sampleRate: RATE, length: 2, noiseDb: 0 });
    expect(notesOf(pitchTrack(hiss, RATE))).toEqual([]);
  });

  it('comes to an end on a wavering pitch that leaves its note for one frame and settles back', () => {
    // A real whistle drifting by about a semitone: at the frame of 74.3 the pitch is off its note,
    // and from that very frame it settles where the note was. Reading it once hung the page on
    // "Writing the notes" (issue 237).
    const wavering = [
      76, 76.2, 76.1, 76.2, 76.3, 75.5, 75.6, 75.1, 75.4, 75.2, 74.3, 75.7, 75.6, 76.3, 75.6, 75.6,
      75.6, 75.6, 75.5, 75.5, 75.6, 74.3, 74.1, 74, 74.1, 73.9, 73.9, 74, 73.9, 74.6, 75, 74.8,
    ];
    const frames = wavering.map((m, i) => ({
      t: i * 0.01,
      hz: 440 * 2 ** ((m - 69) / 12),
      clarity: 0.9,
      rms: 0.1,
    }));
    expect(notesOf(frames).length).toBeGreaterThan(0);
  }, 2000);
});
