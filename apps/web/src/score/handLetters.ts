/**
 * When the keyboard letters the hands (T11, spec section 15): only in bars where the reader could
 * confuse them. Decided from the score once per piece, both hands, whatever is muted.
 */
import type { Hand, Note } from '@digitus2/engine';
import type { Messages } from '../i18n/messages.js';
import type { OnsetGroup } from './onsetGroups.js';

/** Hands this many semitones apart or closer are close: a perfect fifth, about four white keys. */
export const CLOSE_SEMITONES = 7;

/** The lowest right-hand key minus the highest left-hand key; null unless both hands sound. */
export function handGap(sounding: readonly { midi: number; hand: Hand }[]): number | null {
  let highL = -Infinity;
  let lowR = Infinity;
  for (const n of sounding) {
    if (n.hand === 'L') highL = Math.max(highL, n.midi);
    else lowR = Math.min(lowR, n.midi);
  }
  return Number.isFinite(highL) && Number.isFinite(lowR) ? lowR - highL : null;
}

/**
 * The measure indices to letter: every bar with an onset where the hands' sounding keys (struck
 * there, or held from earlier) are within CLOSE_SEMITONES or interleave, plus a lone bar between
 * two such bars, so the letters do not leave for one bar and come back.
 */
export function letteredBars(groups: readonly OnsetGroup[]): Set<number> {
  const close = new Set<number>();
  let held: Note[] = [];
  for (const g of groups) {
    held = held.filter((n) => n.offsetTick > g.tick);
    const gap = handGap([...g.notes, ...held]);
    if (gap !== null && gap <= CLOSE_SEMITONES) close.add(g.notes[0]!.measureIndex);
    held = held.concat(g.notes);
  }
  const out = new Set(close);
  for (const bar of close) if (!close.has(bar + 1) && close.has(bar + 2)) out.add(bar + 1);
  return out;
}

/** Whether the cursor's group (playing, or paused under T10) sits in a lettered bar. */
export function lettersShown(
  groups: readonly OnsetGroup[],
  currentGroup: number,
  bars: ReadonlySet<number>,
): boolean {
  const g = currentGroup >= 0 ? groups[currentGroup] : undefined;
  return g !== undefined && bars.has(g.notes[0]!.measureIndex);
}

/** The letter that names a hand on the keyboard, in the language of `t`: L and R, G and D, I and D. */
export function handLetter(hand: Hand, t: Messages): string {
  return t.score.keyboard.hands[hand];
}
