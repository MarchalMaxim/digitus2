import { transcribe } from '../transcribe.js';
import {
  perform,
  synthesize,
  type Melody,
  type PerformOptions,
  type SynthOptions,
} from './synth.js';

/**
 * How well a synthetic whistle is transcribed (issue 237, docs/whistle.md): the pitches that come
 * back right, how far the onsets stray from where the notes began, and how many corrections the
 * reader would make in the review to reach the written tune. Not imported by the app.
 */

export interface Measurement {
  /** Notes written. */
  written: number;
  /** Share of the written notes whose pitch was found, in an alignment that allows missing and extra notes. */
  pitch: number;
  /** Mean distance, in milliseconds, of a found note's onset from the note it matches. */
  onsetMs: number;
  /** Notes to change, add or remove, and notes whose place or length is wrong, to reach the written tune. */
  corrections: number;
  /** Beats a minute found against the beats a minute played, in per cent. */
  tempoError: number;
}

export function measure(
  melody: Melody,
  signal: SynthOptions,
  played: PerformOptions = {},
): Measurement {
  const { tones, written } = perform(melody, played);
  const rate = 48000;
  const heard = transcribe(synthesize(tones, { sampleRate: rate, ...signal }), rate);
  const found = heard?.rhythm.notes ?? [];
  const onsets = heard?.notes ?? [];

  // Edit distance on pitch, with the alignment kept: matches are the notes that line up.
  const n = written.length;
  const m = found.length;
  const cost = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      cost[i]![j] = Math.min(
        cost[i - 1]![j - 1]! + (written[i - 1]!.midi === found[j - 1]!.midi ? 0 : 1),
        cost[i - 1]![j]! + 1,
        cost[i]![j - 1]! + 1,
      );
  let i = n;
  let j = m;
  let right = 0;
  let wrongPlace = 0;
  let onsetError = 0;
  let matched = 0;
  while (i > 0 && j > 0) {
    const same = written[i - 1]!.midi === found[j - 1]!.midi;
    if (cost[i]![j] === cost[i - 1]![j - 1]! + (same ? 0 : 1)) {
      if (same) {
        right++;
        const w = written[i - 1]!;
        const f = found[j - 1]!;
        if (f.start !== w.beat * 4 || f.length !== w.beats * 4) wrongPlace++;
        onsetError += Math.abs(onsets[j - 1]!.start - tones[i - 1]!.start) * 1000;
        matched++;
      }
      i--;
      j--;
    } else if (cost[i]![j] === cost[i - 1]![j]! + 1) i--;
    else j--;
  }
  const bpm = played.bpm ?? melody.bpm;
  return {
    written: n,
    pitch: n ? right / n : 0,
    onsetMs: matched ? onsetError / matched : NaN,
    corrections: cost[n]![m]! + wrongPlace,
    tempoError: heard ? (100 * Math.abs(heard.rhythm.bpm - bpm)) / bpm : 100,
  };
}
