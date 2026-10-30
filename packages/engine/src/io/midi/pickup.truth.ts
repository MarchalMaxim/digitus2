import type { Score } from '../../score/types.js';
import { separateHands } from './handSeparation.js';
import { detectPickup } from './pickup.js';
import type { QuantizedNote } from './quantize.js';

/** The tick resolution a MIDI file delivers to the detector in these measurements. */
export const TICKS_PER_QUARTER = 480;

export interface PickupTrial {
  /** The first measure's length in ticks when it is short, 0 when the piece opens on a full bar. */
  truth: number;
  /** What `detectPickup` says with the hands of the automatic separation. */
  got: number;
}

/**
 * A MusicXML score as the pickup detector would meet it in a MIDI file (a 480-tick quarter,
 * notes sorted by onset, hands from the automatic separation), and the score's own first measure
 * as the truth. Null when the piece is out of play: no time signature, fewer than 8 notes, or a
 * first note after tick 0 (a file that opens with silence is left alone).
 */
export function pickupTrial(score: Score): PickupTrial | null {
  const time = score.timeSignatures[0];
  if (!time) return null;
  const k = TICKS_PER_QUARTER / score.divisions;
  const notes = score.notes
    .filter((n) => !n.isGrace && n.offsetTick > n.onsetTick)
    .map((n) => ({ onset: n.onsetTick * k, offset: n.offsetTick * k, midi: n.midi }))
    .filter((n) => Number.isInteger(n.onset) && Number.isInteger(n.offset))
    .sort((a, b) => a.onset - b.onset || a.midi - b.midi);
  if (notes.length < 8 || notes[0]!.onset !== 0) return null;
  const nominal = (time.beats * 4 * score.divisions) / time.beatType;
  const first = score.measures[0]!;
  const truth = first.lengthTicks < nominal ? first.lengthTicks * k : 0;
  const quantized: QuantizedNote[] = notes.map((n, i) => ({
    ...n,
    onsetSec: 0,
    velocity: 80,
    channel: 0,
    track: 0,
    sources: [i],
  }));
  return {
    truth,
    got: detectPickup(notes, separateHands(quantized), time, TICKS_PER_QUARTER),
  };
}
