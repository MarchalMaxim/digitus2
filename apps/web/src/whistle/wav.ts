/**
 * The recording as a file (issue 237): a mono 16-bit PCM WAV at 16 kHz, small enough to keep with
 * the score in My scores (about 2 MB for the longest recording) and read by every browser's
 * audio player. Pure, no DOM.
 */

/** The rate the recording is kept at and the pitch is tracked at: a whistle tops out near 3 kHz. */
export const KEPT_RATE = 16000;

/**
 * `samples` at a lower rate, each output sample the mean of the stretch of input it replaces (the
 * stretch may start and end between two input samples). The mean is a low-pass that keeps a
 * whistle's level, about 4 % down at 2.5 kHz from 48 kHz.
 */
export function downsample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const ratio = from / to;
  const total = new Float64Array(samples.length + 1);
  for (let i = 0; i < samples.length; i++) total[i + 1] = total[i]! + samples[i]!;
  // The running total at a position between samples, by interpolation.
  const at = (position: number) => {
    const whole = Math.min(samples.length - 1, Math.floor(position));
    return total[whole]! + (position - whole) * samples[whole]!;
  };
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) out[i] = (at((i + 1) * ratio) - at(i * ratio)) / ratio;
  return out;
}

const HEADER = 44;

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(HEADER + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(HEADER + i * 2, Math.round(x < 0 ? x * 32768 : x * 32767), true);
  }
  return bytes;
}

/** Reads back a file `encodeWav` wrote; anything else is refused. */
export function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  if (
    bytes.length < HEADER ||
    text(0, 4) !== 'RIFF' ||
    text(8, 8) !== 'WAVEfmt ' ||
    text(36, 4) !== 'data' ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint16(34, true) !== 16
  )
    throw new Error('expected a mono 16-bit PCM WAV');
  const count = Math.min(view.getUint32(40, true), bytes.length - HEADER) >> 1;
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = view.getInt16(HEADER + i * 2, true);
    samples[i] = x < 0 ? x / 32768 : x / 32767;
  }
  return { samples, sampleRate: view.getUint32(24, true) };
}
