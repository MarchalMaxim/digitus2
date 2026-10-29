import { describe, expect, it } from 'vitest';
import { yin } from './pitch.js';
import { synthesize } from './testing/synth.js';
import { decodeWav, downsample, encodeWav } from './wav.js';

describe('encodeWav', () => {
  it('writes a mono 16-bit PCM file the length of its samples', () => {
    const bytes = encodeWav(Float32Array.from([0, 0.5, -0.5, 1]), 16000);
    const text = (from: number, to: number) => new TextDecoder().decode(bytes.subarray(from, to));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(bytes.length).toBe(44 + 8);
    expect(text(0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(text(8, 16)).toBe('WAVEfmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36, 40)).toBe('data');
    expect(view.getUint32(40, true)).toBe(8);
  });

  it('reads back what it wrote, to the nearest 16-bit step, and clips what is too loud', () => {
    const samples = Float32Array.from([0, 0.25, -0.25, 0.999, -0.999, 1.5, -1.5]);
    const back = decodeWav(encodeWav(samples, 22050));
    expect(back.sampleRate).toBe(22050);
    expect(back.samples).toHaveLength(samples.length);
    samples.forEach((x, i) => expect(back.samples[i]).toBeCloseTo(Math.max(-1, Math.min(1, x)), 3));
  });
});

describe('decodeWav', () => {
  it('refuses a file that is not a WAV', () => {
    expect(() => decodeWav(new TextEncoder().encode('not audio at all, not at all'))).toThrow();
  });
});

describe('downsample', () => {
  it('leaves a signal at its own rate alone', () => {
    const samples = Float32Array.from([0.1, 0.2, 0.3]);
    expect(downsample(samples, 16000, 16000)).toEqual(samples);
  });

  it('brings 48 kHz to 16 kHz with the pitch and the level of a whistle kept', () => {
    const loud = synthesize([{ midi: 88, start: 0, end: 0.5 }], { sampleRate: 48000, length: 0.5 });
    const small = downsample(loud, 48000, 16000);
    expect(small.length).toBe(Math.floor(loud.length / 3));
    const found = yin(small.subarray(2000, 2736), 16000);
    expect(1200 * Math.abs(Math.log2(found.hz! / 1318.5))).toBeLessThan(10);
    const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak(small)).toBeGreaterThan(0.8 * peak(loud));
  });

  it('works from a rate that is not a multiple', () => {
    const tone = synthesize([{ midi: 81, start: 0, end: 0.5 }], { sampleRate: 44100, length: 0.5 });
    const small = downsample(tone, 44100, 16000);
    expect(small.length).toBe(Math.floor((tone.length * 16000) / 44100));
    const found = yin(small.subarray(2000, 2736), 16000);
    expect(1200 * Math.abs(Math.log2(found.hz! / 880))).toBeLessThan(10);
  });
});
