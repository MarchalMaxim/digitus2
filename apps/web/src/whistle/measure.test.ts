import { describe, expect, it } from 'vitest';
import { measure } from './testing/measure.js';
import {
  C_MAJOR_SCALE,
  ODE_TO_JOY,
  SIXTEENTHS,
  TWINKLE,
  WITH_REST,
  type Melody,
  type PerformOptions,
  type SynthOptions,
} from './testing/synth.js';

/**
 * The transcription on synthetic whistles, melodies by conditions (docs/whistle.md has the table).
 * A change to the transcription must not make a cell worse: every melody, under every condition,
 * comes back with all its pitches, its onsets within 30 ms and no correction needed, but for the
 * conditions named below.
 */

const melodies: Melody[] = [C_MAJOR_SCALE, ODE_TO_JOY, TWINKLE, WITH_REST, SIXTEENTHS];

/** A glide of 80 ms is most of a sixteenth, so the sixteenths slide for 30 ms and a stray is smaller. */
const glide = (m: Melody) => (m === SIXTEENTHS ? 30 : 80);

const conditions: {
  name: string;
  signal: (m: Melody) => SynthOptions;
  played: (m: Melody) => PerformOptions;
}[] = [
  { name: 'clean', signal: () => ({}), played: () => ({}) },
  { name: 'vibrato 30 cents', signal: () => ({ vibratoCents: 30 }), played: () => ({}) },
  { name: 'glide', signal: (m) => ({ glideMs: glide(m) }), played: () => ({}) },
  { name: 'noise -25 dB', signal: () => ({ noiseDb: -25 }), played: () => ({}) },
  {
    name: 'rubato',
    signal: () => ({}),
    played: (m) => ({ rubato: m === SIXTEENTHS ? 0.03 : 0.08 }),
  },
  {
    name: 'all together',
    signal: (m) => ({ vibratoCents: 30, glideMs: glide(m), noiseDb: -25 }),
    played: (m) => ({ rubato: m === SIXTEENTHS ? 0.03 : 0.08 }),
  },
];

describe('the transcription of synthetic whistles', () => {
  const rows: string[] = [];
  for (const condition of conditions)
    for (const melody of melodies)
      it(`${melody.name}, ${condition.name}`, () => {
        const got = measure(melody, condition.signal(melody), condition.played(melody));
        rows.push(
          `| ${melody.name} | ${condition.name} | ${(100 * got.pitch).toFixed(0)} % | ${got.onsetMs.toFixed(0)} ms | ${got.corrections} | ${got.tempoError.toFixed(1)} % |`,
        );
        expect(got.pitch).toBe(1);
        expect(got.onsetMs).toBeLessThan(30);
        expect(got.corrections).toBe(0);
        expect(got.tempoError).toBeLessThan(6);
      });

  it.skipIf(!process.env.DIGITUS2_WHISTLE_TABLE)('prints the table', () => {
    console.log(
      [
        '| Melody | Condition | Pitches right | Onset error | Corrections | Tempo error |',
        '|---|---|---|---|---|---|',
        ...rows,
      ].join('\n'),
    );
  });
});

/**
 * Where it stops: the same measurement under conditions the transcription does not meet. No cell
 * is asserted; they are printed for docs/whistle.md, and say what a reader will meet and correct.
 */
const limits: { name: string; melody: Melody; signal: SynthOptions; played: PerformOptions }[] = [
  { name: 'noise -15 dB', melody: ODE_TO_JOY, signal: { noiseDb: -15 }, played: {} },
  { name: 'noise -6 dB', melody: ODE_TO_JOY, signal: { noiseDb: -6 }, played: {} },
  { name: 'no breath between notes', melody: ODE_TO_JOY, signal: {}, played: { breath: 0 } },
  { name: 'fast: 160 beats a minute', melody: ODE_TO_JOY, signal: {}, played: { bpm: 160 } },
  { name: 'slow: 50 beats a minute', melody: ODE_TO_JOY, signal: {}, played: { bpm: 50 } },
  { name: 'rubato of 20 %', melody: ODE_TO_JOY, signal: {}, played: { rubato: 0.2 } },
  {
    name: 'a hum: low, rich in harmonics, wide vibrato',
    melody: TWINKLE,
    signal: { harmonic: 0.6, vibratoCents: 45, noiseDb: -25 },
    played: { octaves: 0 },
  },
  { name: 'whistled one octave up', melody: ODE_TO_JOY, signal: {}, played: { octaves: 1 } },
  { name: 'whistled three octaves up', melody: ODE_TO_JOY, signal: {}, played: { octaves: 3 } },
];

describe('where the transcription stops', () => {
  const rows: string[] = [];
  for (const row of limits)
    it(row.name, () => {
      const got = measure(row.melody, row.signal, row.played);
      rows.push(
        `| ${row.melody.name} | ${row.name} | ${(100 * got.pitch).toFixed(0)} % | ${got.onsetMs.toFixed(0)} ms | ${got.corrections} | ${got.tempoError.toFixed(1)} % |`,
      );
      expect(got.written).toBeGreaterThan(0);
    });

  it.skipIf(!process.env.DIGITUS2_WHISTLE_TABLE)('prints the table', () => {
    console.log(
      [
        '| Melody | Condition | Pitches right | Onset error | Corrections | Tempo error |',
        '|---|---|---|---|---|---|',
        ...rows,
      ].join('\n'),
    );
  });
});
