import { describe, expect, it } from 'vitest';
import { pitchTrack, yin } from './pitch.js';
import { hzOfMidi, seeded, synthesize } from './testing/synth.js';

const cents = (hz: number, reference: number) => 1200 * Math.log2(hz / reference);

function tone(hz: number, sampleRate: number, length: number, harmonic = 0): Float32Array {
  return Float32Array.from(
    { length },
    (_, i) =>
      0.5 *
      (Math.sin((2 * Math.PI * hz * i) / sampleRate) +
        harmonic * Math.sin((4 * Math.PI * hz * i) / sampleRate)),
  );
}

describe('yin', () => {
  for (const sampleRate of [16000, 24000, 48000]) {
    const frame = Math.round(sampleRate * 0.046);
    for (const hz of [200, 330, 523, 880, 1320, 2000, 2500]) {
      it(`reads a pure ${hz} Hz tone at ${sampleRate} Hz within 5 cents`, () => {
        const found = yin(tone(hz, sampleRate, frame), sampleRate);
        expect(found.hz).not.toBeNull();
        expect(Math.abs(cents(found.hz!, hz))).toBeLessThan(5);
        expect(found.clarity).toBeGreaterThan(0.9);
      });
    }
  }

  it('reads the fundamental of a tone with a second harmonic, not the octave', () => {
    const found = yin(tone(880, 16000, 736, 0.3), 16000);
    expect(Math.abs(cents(found.hz!, 880))).toBeLessThan(5);
  });

  it('gives no pitch for silence', () => {
    expect(yin(new Float32Array(736), 16000)).toEqual({ hz: null, clarity: 0 });
  });

  it('gives no pitch for white noise', () => {
    const random = seeded(3);
    const noise = Float32Array.from({ length: 736 }, () => (random() - 0.5) * 0.6);
    expect(yin(noise, 16000).hz).toBeNull();
  });

  it('gives no pitch below the range it is asked for', () => {
    expect(yin(tone(100, 16000, 1200), 16000, { minHz: 150 }).hz).toBeNull();
  });
});

describe('pitchTrack', () => {
  const sampleRate = 16000;
  const samples = synthesize([{ midi: 81, start: 0.3, end: 0.9 }], { sampleRate, length: 1.2 });
  const frames = pitchTrack(samples, sampleRate);

  it('steps by 10 ms and stamps each frame at the middle of its window', () => {
    expect(frames[1]!.t - frames[0]!.t).toBeCloseTo(0.01, 6);
    expect(frames[0]!.t).toBeCloseTo(0.023, 3);
    expect(frames.at(-1)!.t).toBeLessThanOrEqual(1.2 - 0.023 + 1e-6);
  });

  it('finds the pitch while the tone sounds and none in the silence', () => {
    const during = frames.filter((f) => f.t > 0.4 && f.t < 0.8);
    expect(during.every((f) => f.hz !== null)).toBe(true);
    expect(during.every((f) => Math.abs(cents(f.hz!, hzOfMidi(81))) < 10)).toBe(true);
    const before = frames.filter((f) => f.t < 0.2);
    expect(before.every((f) => f.hz === null && f.rms < 1e-3)).toBe(true);
    expect(during[0]!.rms).toBeGreaterThan(0.1);
  });

  it('measures the level over a short stretch, so a gap of 60 ms shows as silent frames', () => {
    const gap = synthesize(
      [
        { midi: 81, start: 0.1, end: 0.5 },
        { midi: 81, start: 0.56, end: 1.0 },
      ],
      { sampleRate, length: 1.2 },
    );
    const quiet = pitchTrack(gap, sampleRate).filter(
      (f) => f.t > 0.5 && f.t < 0.56 && f.rms < 0.02,
    );
    expect(quiet.length).toBeGreaterThanOrEqual(2);
  });
});
