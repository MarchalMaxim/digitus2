/**
 * Pitch of a whistle or a hum, frame by frame (issue 237): the YIN estimator of de Cheveigné and
 * Kahan, "YIN, a fundamental frequency estimator for speech and music", JASA 111 (2002),
 * https://doi.org/10.1121/1.1458024. Pure, no DOM.
 */

export interface YinOptions {
  /** The lowest and highest pitch looked for, in Hz. */
  minHz?: number;
  maxHz?: number;
  /** The dip of the normalised difference that counts as a period (the paper's 0.1 to 0.15). */
  threshold?: number;
}

export interface Pitch {
  /** The pitch in Hz, or null when the frame has none (silence, noise, out of range). */
  hz: number | null;
  /** 1 for a pure periodic tone, near 0 for noise. */
  clarity: number;
}

const DEFAULTS = { minHz: 150, maxHz: 3000, threshold: 0.12 };

/** The pitch of one frame; the frame holds at least two periods of the lowest pitch asked for. */
export function yin(frame: Float32Array, sampleRate: number, options: YinOptions = {}): Pitch {
  const { minHz, maxHz, threshold } = { ...DEFAULTS, ...options };
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(Math.ceil(sampleRate / minHz), Math.floor(frame.length / 2));
  const span = frame.length - tauMax;
  if (tauMax <= tauMin + 1 || span < tauMax) return { hz: null, clarity: 0 };
  let energy = 0;
  for (let i = 0; i < frame.length; i++) energy += frame[i]! * frame[i]!;
  if (energy / frame.length < 1e-10) return { hz: null, clarity: 0 };

  // The cumulative mean normalised difference function (steps 2 and 3 of the paper).
  const diff = new Float64Array(tauMax + 1);
  const cm = new Float64Array(tauMax + 1);
  cm[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < span; j++) {
      const delta = frame[j]! - frame[j + tau]!;
      sum += delta * delta;
    }
    diff[tau] = sum;
    running += sum;
    cm[tau] = running > 0 ? (sum * tau) / running : 1;
  }

  // The first dip below the threshold, followed down to its bottom (step 4).
  let tau = -1;
  for (let t = tauMin; t < tauMax; t++) {
    if (cm[t]! < threshold) {
      while (t + 1 < tauMax && cm[t + 1]! < cm[t]!) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    let best = 1;
    for (let t = tauMin; t <= tauMax; t++) best = Math.min(best, cm[t]!);
    return { hz: null, clarity: Math.max(0, 1 - best) };
  }

  // Interpolation around the bottom (step 5). The difference of a tone is 1 - cos(w (lag - period)),
  // which three lags fix exactly; a parabola is up to 16 cents off for a period of 6 samples. A
  // flat or inverted bottom (not a tone) stays at the whole lag.
  const left = diff[tau - 1]!;
  const middle = diff[tau]!;
  const right = diff[tau + 1]!;
  const bend = left + right - 2 * middle;
  const omega = (2 * Math.PI) / tau;
  const shift =
    bend > 1e-12 ? -Math.atan(((right - left) / bend) * Math.tan(omega / 2)) / omega : 0;
  const period = tau + Math.max(-1, Math.min(1, shift));
  return { hz: sampleRate / period, clarity: Math.max(0, 1 - cm[tau]!) };
}

export interface PitchFrame extends Pitch {
  /** The middle of the frame's window, in seconds. */
  t: number;
  /** The level over the 20 ms around `t`, so a breath between two notes shows as quiet frames. */
  rms: number;
}

export const HOP_S = 0.01;
const FRAME_S = 0.046;
const LEVEL_S = 0.02;

/** Every 10 ms, the pitch of the 46 ms around it. */
export function pitchTrack(
  samples: Float32Array,
  sampleRate: number,
  options: YinOptions = {},
): PitchFrame[] {
  const hop = Math.round(HOP_S * sampleRate);
  const size = Math.round(FRAME_S * sampleRate);
  const level = Math.round(LEVEL_S * sampleRate);
  const frames: PitchFrame[] = [];
  for (let start = 0; start + size <= samples.length; start += hop) {
    const middle = start + size / 2;
    let sum = 0;
    const from = Math.round(middle - level / 2);
    for (let i = from; i < from + level; i++) sum += samples[i]! * samples[i]!;
    frames.push({
      ...yin(samples.subarray(start, start + size), sampleRate, options),
      t: middle / sampleRate,
      rms: Math.sqrt(sum / level),
    });
  }
  return frames;
}
