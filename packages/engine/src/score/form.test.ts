import { describe, expect, it } from 'vitest';
import { performanceOrder } from './form.js';
import type { MeasureForm, MeasureInfo } from './types.js';

/** Bars with the given forms (undefined: a plain bar). */
function bars(forms: (MeasureForm | undefined)[]): MeasureInfo[] {
  return forms.map((form, i) => ({
    index: i,
    startTick: i * 4,
    lengthTicks: 4,
    number: String(i + 1),
    ...(form ? { form } : {}),
  }));
}

const order = (forms: (MeasureForm | undefined)[], opts?: { jumps?: boolean }): number[] =>
  performanceOrder(bars(forms), opts);

describe('performanceOrder', () => {
  it('is document order for a score with no signs', () => {
    expect(order([undefined, undefined, undefined])).toEqual([0, 1, 2]);
    expect(order([])).toEqual([]);
  });

  it('repeats from the top at a backward repeat with no forward one', () => {
    expect(order([undefined, { repeatEnd: 2 }])).toEqual([0, 1, 0, 1]);
  });

  it('repeats the section after the previous repeat', () => {
    expect(order([{ repeatEnd: 2 }, { repeatEnd: 2 }])).toEqual([0, 0, 1, 1]);
  });

  it('returns to the last forward repeat and plays a repeat of three times', () => {
    expect(order([undefined, { repeatEnd: 2 }, { repeatStart: true }, { repeatEnd: 3 }])).toEqual([
      0, 1, 0, 1, 2, 3, 2, 3, 2, 3,
    ]);
  });

  it('plays a first and a second ending on their passes', () => {
    expect(
      order([{ repeatStart: true }, undefined, { ending: [1], repeatEnd: 2 }, { ending: [2] }]),
    ).toEqual([0, 1, 2, 0, 1, 3]);
  });

  it('repeats as often as the endings need when a volta names several passes', () => {
    expect(order([undefined, { ending: [1, 2], repeatEnd: 2 }, { ending: [3] }])).toEqual([
      0, 1, 0, 1, 0, 2,
    ]);
  });

  it('plays D.C. al Fine to the Fine', () => {
    expect(order([undefined, { fine: true }, undefined, { daCapo: true }])).toEqual([
      0, 1, 2, 3, 0, 1,
    ]);
  });

  it('plays D.S. al Coda from the segno, jumping to the coda at To Coda', () => {
    expect(
      order([
        undefined,
        { segno: true },
        { toCoda: true },
        { dalSegno: true },
        { coda: true },
        undefined,
      ]),
    ).toEqual([0, 1, 2, 3, 1, 2, 4, 5]);
  });

  it('plays a repeat before a Fine once and ends at the Fine after the D.C.', () => {
    expect(order([{ repeatEnd: 2, fine: true }, { daCapo: true }])).toEqual([0, 0, 1, 0]);
  });

  it('takes no repeat after a jump, plays the last ending and goes on to the end of the score', () => {
    expect(
      order([
        { repeatStart: true },
        { ending: [1], repeatEnd: 2 },
        { ending: [2] },
        { daCapo: true },
      ]),
    ).toEqual([0, 1, 0, 2, 3, 0, 2, 3]);
  });

  it('ignores a Fine that no D.C. leads back to', () => {
    expect(order([{ fine: true }, undefined])).toEqual([0, 1]);
  });

  it('leaves the jumps out on request, repeats stay', () => {
    expect(
      order([undefined, { fine: true }, undefined, { daCapo: true }], { jumps: false }),
    ).toEqual([0, 1, 2, 3]);
    expect(order([undefined, { repeatEnd: 2 }, { daCapo: true }], { jumps: false })).toEqual([
      0, 1, 0, 1, 2,
    ]);
  });

  it('plays a repeat of many passes whole, never cutting a pass short', () => {
    // A 30-bar piece repeated ten times from the top, bar 29 carrying the sign (Hanon).
    const hanon = Array.from({ length: 30 }, (_, i) =>
      i === 28 ? { repeatEnd: 10 } : undefined,
    ) as (MeasureForm | undefined)[];
    const o = order(hanon);
    expect(o).toHaveLength(29 * 10 + 1);
    expect(o.at(-1)).toBe(29);
    expect(o.slice(0, 29)).toEqual(Array.from({ length: 29 }, (_, i) => i));
  });

  it('reads a runaway repeat count as a hundred passes', () => {
    expect(order([{ repeatEnd: 1000 }])).toHaveLength(100);
    expect(order([undefined, { repeatEnd: 100000 }, undefined])).toHaveLength(100 * 2 + 1);
  });

  it('returns to the top of a section when its first ending closes one bar before the repeat sign', () => {
    // MuseScore layout: |: 1 2 [1. 3] 4 :| [2. 5]: the volta covers bar 3, the sign sits on bar 4.
    expect(
      order([{ repeatStart: true }, undefined, { ending: [1] }, { repeatEnd: 2 }, { ending: [2] }]),
    ).toEqual([0, 1, 2, 3, 0, 1, 3, 4]);
  });

  it('plays the second ending after a backward repeat that has no first ending', () => {
    expect(order([undefined, { repeatEnd: 2 }, { ending: [2] }, undefined])).toEqual([
      0, 1, 0, 1, 2, 3,
    ]);
  });

  it('plays a second ending that sits on a bar with a forward repeat', () => {
    // Bar 3 closes the repeat as its ending 2 and also carries the forward sign of the next one.
    expect(
      order([
        { repeatStart: true },
        { ending: [1], repeatEnd: 2 },
        { ending: [2], repeatStart: true },
        { repeatStart: true },
        { repeatEnd: 2 },
      ]),
    ).toEqual([0, 1, 0, 2, 3, 4, 3, 4]);
  });

  it('keeps a bar in a later section with the passes of its own repeat', () => {
    // Two repeats in a row, the second with a first ending: its ending 2 is played on its pass 2.
    expect(
      order([
        { repeatEnd: 2 },
        { repeatStart: true },
        { ending: [1], repeatEnd: 2 },
        { ending: [2] },
      ]),
    ).toEqual([0, 0, 1, 2, 1, 3]);
  });

  it('goes to the top for a D.S. with no segno', () => {
    expect(order([undefined, { dalSegno: true }])).toEqual([0, 1, 0, 1]);
  });
});
