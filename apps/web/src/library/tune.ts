/**
 * The tune on the deal control (issue 228): four notes on a five-line staff, which leap to a new
 * tune on each press. A tune is a pure function of the deal count, so the notes are the same
 * after a reload of the same visit's state and nothing random is drawn while rendering.
 */
import { randomFrom, seedOf } from './model.js';

/**
 * The staff's pitches as a note's y in the control's 44 by 26 box: the five lines are at 5, 9, 13,
 * 17 and 21, the spaces and the places just above and below between and beside them.
 */
export const PITCHES: readonly number[] = [5, 7, 9, 11, 13, 15, 17, 19, 21];

/** Four notes' y positions. */
export type Tune = readonly [number, number, number, number];

/** The first tune, before any press: up the staff a little and back. */
const FIRST: Tune = [17, 15, 13, 15];

/** The steps, in places on the staff, a note may take from the one before: mostly by step. */
const STEPS = [-2, -1, 1, 2, 3] as const;

function draw(deal: number, attempt: number): Tune {
  const random = randomFrom(seedOf(`tune|${deal}|${attempt}`));
  const last = PITCHES.length - 1;
  let at = 2 + Math.floor(random() * 5);
  const tune = [PITCHES[at]!];
  for (let i = 1; i < 4; i++) {
    at = Math.min(last, Math.max(0, at + STEPS[Math.floor(random() * STEPS.length)]!));
    tune.push(PITCHES[at]!);
  }
  return tune as unknown as Tune;
}

const same = (a: Tune, b: Tune): boolean => a.every((y, i) => y === b[i]);

/** The tune of a deal: a singable contour that always differs from the deal before it. */
export function tuneFor(deal: number): Tune {
  let tune = FIRST;
  for (let d = 1; d <= deal; d++) {
    let attempt = 0;
    let next = draw(d, attempt);
    while (same(next, tune)) next = draw(d, ++attempt);
    tune = next;
  }
  return tune;
}
