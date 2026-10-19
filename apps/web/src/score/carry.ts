/**
 * "Add notes between" (issue #67) swaps the score under the reader: a new score halts playback
 * and drops the loop (usePlayback.ts). The score view records where the reader is before the
 * switch and puts it back once the new score is in. Both versions start their bars at the same
 * seconds (the added notes only split notes in two), so a bar index means the same place in
 * either.
 */
import { barIndexAt } from './bars.js';
import type { LoopRange, Playback } from './usePlayback.js';

/** Where the reader is, kept across a switch between the plain and the embellished score. */
export interface Carry {
  /** The bar (0-based) of the position (playing) or of where Play starts (stopped). */
  bar: number;
  loop: LoopRange | null;
  playing: boolean;
  /** Away from the start: playing, paused, or cued on a bar (T13). */
  cued: boolean;
}

/** Where the reader is: the bar of the position (playing) or of where Play starts (stopped). */
export function captureCarry(playback: Playback, barStarts: readonly number[]): Carry {
  const at = playback.playing ? playback.positionSec() : playback.startSec();
  return {
    bar: barIndexAt(barStarts, at),
    loop: playback.loop ? { from: playback.loop.from, to: playback.loop.to } : null,
    playing: playback.playing,
    cued: !playback.atStart,
  };
}

/**
 * After the new score is in: the loop again, the same bar's start, and playing on if it was.
 * Stopped at the start, it stays at the start; away from it, Play starts at that bar's start.
 */
export function applyCarry(carry: Carry, playback: Playback, barStarts: readonly number[]): void {
  // Set first: stopped, the loop only says where Play starts, and play() hands it over.
  if (carry.loop) playback.setLoop(carry.loop);
  if (carry.playing || carry.cued) {
    const sec = barStarts[carry.bar] ?? 0;
    if (sec > 0) playback.seek(sec);
    else if (carry.playing) playback.rewind();
  }
  if (carry.playing) playback.play();
}
