import type { Hand } from '../../score/types.js';
import { QUANT_DIVISIONS, type QuantizedNote } from './quantize.js';

/** The bars at the start of a piece that the detector reads. */
export const PICKUP_OPENING_BARS = 8;
/** Rule B needs at least this many notes crossing the unshifted barlines ... */
const MIN_CROSSINGS = 6;
/** ... and a shifted grid that cuts them to this fraction or less. */
const CROSSING_RATIO = 6;
/** Rule A: the bass must sound this much longer on the shifted downbeats. */
const BASS_GAIN = 1.5;
/** A pickup is shorter than this fraction of a bar: a longer one cannot be told from a rest. */
const MAX_PICKUP_FRACTION = 1 / 2;
/** The last note must end within this many ticks (a sixteenth at 480) of the shifted barline. */
const END_TOLERANCE_DIVISIONS = 1 / 4;
/** Rule B: the last note must start within this many ticks (a 32nd at 480) of a shifted downbeat. */
const LAST_ONSET_TOLERANCE_DIVISIONS = 1 / 8;

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * The length in ticks of a pickup (anacrusis) bar at the start of a piece, 0 for none. A MIDI
 * file has no barlines, so the first bar is assumed to be full unless the opening bars and the
 * ending say otherwise; a missed pickup is much better than a false one, so the rules are strict.
 * Only a pickup that begins at tick 0 is handled: a file that opens with silence is left alone.
 *
 * Rule A: the melody plays alone, then the left hand enters on a beat of the first bar, and the
 * bars counted from that beat cut fewer notes in two across a barline, or carry a longer bass.
 * Rule B: notes keep sounding across the barlines of the unshifted bars, and a grid shifted by a
 * half-beat multiple cuts those crossings by a factor of six.
 *
 * The opening alone cannot settle it: a piece that opens on beat 1 with a left hand that rests on
 * beat 1, or a melody tied over every barline, looks like a pickup. So a length proposed by a
 * rule stands only when the pickup is shorter than half a bar and the last note ends where a full
 * last bar of the shifted grid ends; a length from Rule B also needs the last note to start on a
 * downbeat of the shifted grid. When the two rules stand with different lengths, the answer is
 * none. Docs: experiments.md, Pickup bar of MIDI input.
 */
export function detectPickup(
  notes: readonly Pick<QuantizedNote, 'onset' | 'offset' | 'midi'>[],
  hands: readonly Hand[],
  time: { beats: number; beatType: number },
  divisions = QUANT_DIVISIONS,
): number {
  const D = divisions;
  const L = (time.beats * 4 * D) / time.beatType;
  if (!Number.isInteger(L) || L <= 0 || notes.length === 0) return 0;
  const beat = time.beatType <= 4 ? D : (4 * D) / time.beatType;
  let first = Infinity;
  for (const n of notes) if (n.onset < first) first = n.onset;
  if (first !== 0) return 0;

  const windowEnd = PICKUP_OPENING_BARS * L;
  const local: Array<{ onset: number; offset: number; midi: number; hand: Hand }> = [];
  let firstLeft = Infinity;
  let lastOnset = 0;
  let lastOffset = 0;
  notes.forEach((n, i) => {
    const hand = hands[i]!;
    if (hand === 'L' && n.onset < firstLeft) firstLeft = n.onset;
    if (n.onset > lastOnset) lastOnset = n.onset;
    if (n.offset > lastOffset) lastOffset = n.offset;
    if (n.onset < windowEnd) local.push({ onset: n.onset, offset: n.offset, midi: n.midi, hand });
  });

  /** Ticks from `tick` to the nearest barline when the bars begin at `p`. */
  const away = (tick: number, p: number) => {
    const rel = mod(tick - p, L);
    return Math.min(rel, L - rel);
  };
  /** The ending agrees with a pickup of `p` ticks: it is short and a full last bar closes the piece. */
  const endingAgrees = (p: number) =>
    p < MAX_PICKUP_FRACTION * L && away(lastOffset, p) <= END_TOLERANCE_DIVISIONS * D;

  /** Notes sounding across a barline when the bars begin at `p`. */
  const cross = (p: number): number => {
    let c = 0;
    for (const n of local) {
      const rel = mod(n.onset - p, L);
      if (rel !== 0 && n.offset > n.onset + (L - rel)) c++;
    }
    return c;
  };
  /** The length of the lowest left-hand note on each downbeat when the bars begin at `p`. */
  const bass = (p: number): number => {
    const lowest = new Map<number, { midi: number; length: number }>();
    for (const n of local) {
      if (n.hand !== 'L' || mod(n.onset - p, L) !== 0) continue;
      const cur = lowest.get(n.onset);
      if (!cur || n.midi < cur.midi)
        lowest.set(n.onset, { midi: n.midi, length: n.offset - n.onset });
    }
    let sum = 0;
    for (const v of lowest.values()) sum += v.length;
    return sum;
  };

  const c0 = cross(0);
  let proposalA = 0;
  if (firstLeft > 0 && firstLeft < L && firstLeft % beat === 0) {
    const ce = cross(firstLeft);
    // The bass gain needs a bass to gain from: against no bass on the downbeats it always holds.
    const b0 = bass(0);
    if (ce <= c0 && (ce < c0 || (b0 > 0 && bass(firstLeft) >= BASS_GAIN * b0)))
      proposalA = firstLeft;
  }

  let proposalB = 0;
  const step = D / 4;
  if (Number.isInteger(step) && step > 0 && c0 >= MIN_CROSSINGS) {
    let best = 0;
    let bestCross = c0;
    for (let p = step; p < L; p += step) {
      const c = cross(p);
      if (c < bestCross) {
        bestCross = c;
        best = p;
      }
    }
    if (best > 0 && best % (D / 2) === 0 && bestCross * CROSSING_RATIO <= c0) proposalB = best;
  }

  if (proposalA !== 0 && proposalA === proposalB && proposalA < MAX_PICKUP_FRACTION * L)
    return proposalA;
  // A last note that starts on a barline of the unshifted grid and ends on the next shifted one is
  // a closing chord of a beat or so: the unshifted reading explains it as well as the shifted one.
  const ruleA =
    proposalA !== 0 && endingAgrees(proposalA) && mod(lastOnset, L) !== 0 ? proposalA : 0;
  const ruleB =
    proposalB !== 0 &&
    endingAgrees(proposalB) &&
    away(lastOnset, proposalB) <= LAST_ONSET_TOLERANCE_DIVISIONS * D
      ? proposalB
      : 0;
  return ruleA !== 0 && ruleB !== 0 && ruleA !== ruleB ? 0 : ruleA || ruleB;
}
