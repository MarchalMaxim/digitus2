import { separateHands } from '../io/midi/handSeparation.js';
import type { HandMotionParams } from '../io/midi/motion.js';
import { quantize } from '../io/midi/quantize.js';
import type { MidiData } from '../io/midi/read.js';
import type { Score } from '../score/types.js';

/**
 * A staff- or channel-labelled score as MIDI-like data: ppq = divisions, the score's tempo map in
 * microseconds per quarter, every note on channel 0 of track 0 (PIG scores have 480 divisions at
 * 120 quarter notes per minute).
 */
export function scoreToMidiData(score: Score): MidiData {
  return {
    ppq: score.divisions,
    tempos: score.tempoMap.map((t) => ({ tick: t.tick, usPerQuarter: Math.round(60e6 / t.qpm) })),
    timeSignatures:
      score.timeSignatures.length > 0
        ? score.timeSignatures.map((t) => ({ tick: t.tick, beats: t.beats, beatType: t.beatType }))
        : [{ tick: 0, beats: 4, beatType: 4 }],
    notes: score.notes.map((n) => ({
      tick: n.onsetTick,
      endTick: n.offsetTick,
      midi: n.midi,
      velocity: n.velocity ?? 64,
      channel: 0,
      track: 0,
    })),
    warnings: [],
  };
}

export interface HandEval {
  notes: number;
  correct: number;
  /** Percent 0..100. */
  accuracy: number;
}

/**
 * Quantizes the score as MIDI, separates the hands and counts, for every source note, whether its
 * quantized note got the note's true hand.
 */
export function evaluateHands(score: Score, opts: { params?: HandMotionParams } = {}): HandEval {
  const quantized = quantize(scoreToMidiData(score));
  const hands = separateHands(quantized.notes, opts.params ? { params: opts.params } : {});
  let correct = 0;
  quantized.notes.forEach((n, i) => {
    for (const s of n.sources) if (score.notes[s]!.hand === hands[i]) correct++;
  });
  const total = score.notes.length;
  return { notes: total, correct, accuracy: total === 0 ? 0 : (100 * correct) / total };
}
