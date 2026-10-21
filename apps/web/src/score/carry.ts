/**
 * "Add notes between" (issue #67) swaps the score under the reader: a new score halts playback
 * and drops the loop (usePlayback.ts). The score view records where the reader is and puts it
 * back once the new score is in. Both versions start their bars at the same seconds (the added
 * notes only split notes in two), so a bar index means the same place in either.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { barIndexAt } from './bars.js';
import type { LoopRange, Playback } from './usePlayback.js';
import type { ScoreDocument } from './useScoreDocument.js';

/** Where the reader is, kept across a switch between the plain and the embellished score. */
export interface Carry {
  /** The bar (0-based) of the position heard, paused or requested before Play. */
  bar: number;
  loop: LoopRange | null;
  /** Playing, or Play still loading the samples (review S1): playing goes on after the switch. */
  playing: boolean;
  /**
   * The music was being heard: it goes on as it was, without a count-in. A Play still loading
   * its samples, or still counting in, starts as a new Play does.
   */
  resume: boolean;
  /** Away from the start: playing, paused, or cued on a bar (T13). */
  cued: boolean;
}

/** Keep the requested position, even when a loop makes Play start somewhere else. */
export function captureCarry(playback: Playback, barStarts: readonly number[]): Carry {
  const at = playback.positionSec();
  return {
    bar: barIndexAt(barStarts, at),
    loop: playback.loop ? { from: playback.loop.from, to: playback.loop.to } : null,
    playing: playback.playing || playback.loading,
    resume: playback.playing && playback.countIn === null,
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
  if (carry.playing) {
    if (carry.resume) playback.play({ resume: true });
    else playback.play();
  }
}

type Version = ScoreDocument['shownVersion'];

/** A carry recorded at a switch, waiting for the version asked for to be on screen. */
export interface PendingCarry<S> {
  carry: Carry;
  /** The version asked for. */
  to: Version;
  /** The score on screen when the switch was asked for. */
  from: S;
}

/**
 * What to do with a recorded carry, on every change the score view watches (review S4):
 * - `drop`: the switch is no longer offered (a version refused or failed, a reopen), forget it;
 * - `wait`: the other version is still on screen;
 * - `clear`: the version asked for is on screen with the score that was there (switched back
 *   before the new version came in): nothing was halted, so nothing is put back;
 * - `apply`: the version asked for is on screen with its new score: put the reader back.
 */
export function carryStep<S>(
  pending: PendingCarry<S>,
  now: { score: S; embellish: ScoreDocument['embellish']; shownVersion: Version },
): 'wait' | 'drop' | 'apply' | 'clear' {
  if (now.embellish !== 'offered') return 'drop';
  if (now.shownVersion !== pending.to) return 'wait';
  if (now.score === pending.from) return 'clear';
  return 'apply';
}

/**
 * The switch with its carry, for the score view: returns what the tick box calls. The carry is
 * recorded at the click and put back once the version asked for is on screen (`shownVersion`,
 * not `embellished`, which turns before the new pages are in). Called after usePlayback, so its
 * halt for the new score has run before the carry is applied.
 */
export function useEmbellishCarry<S>(
  doc: Pick<ScoreDocument, 'embellish' | 'shownVersion' | 'setEmbellished'>,
  score: S,
  playback: Playback,
  barStarts: readonly number[],
): (on: boolean) => void {
  const pendingRef = useRef<PendingCarry<S> | null>(null);
  const { embellish, shownVersion, setEmbellished } = doc;
  const toggle = useCallback(
    (on: boolean) => {
      pendingRef.current = {
        carry: captureCarry(playback, barStarts),
        to: on ? 'embellished' : 'plain',
        from: score,
      };
      setEmbellished(on);
    },
    [playback, barStarts, score, setEmbellished],
  );
  // Review S2: a switch that needs a fresh layout leaves the old score playing until its pages
  // land, and a Pause or a seek meanwhile is the reader's last word. While a carry waits, every
  // commit records it again from the state it leaves; a layout cleanup runs in the commit,
  // before usePlayback's passive halt for a new score, so the last one before the swap still
  // reads the old score's transport and its last committed state.
  useLayoutEffect(
    () => () => {
      const pending = pendingRef.current;
      if (pending && pending.from === score) pending.carry = captureCarry(playback, barStarts);
    },
    [score, playback, barStarts],
  );
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    const step = carryStep(pending, { score, embellish, shownVersion });
    if (step === 'wait') return;
    pendingRef.current = null;
    if (step === 'apply') applyCarry(pending.carry, playback, barStarts);
  }, [score, embellish, shownVersion, playback, barStarts]);
  return toggle;
}
