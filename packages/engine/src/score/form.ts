import type { MeasureForm, MeasureInfo } from './types.js';

/** The most passes one backward repeat plays; a score that names more is read as this many. */
const MAX_PASSES = 100;

/**
 * The bars in the order they are heard, as indices into `measures`: repeat signs and volta
 * endings expanded, then D.C., D.S., Fine and To Coda followed. The engraving stays as written;
 * this order is for playback (the product spec, section 6).
 *
 * - A backward repeat returns to the last forward repeat, else to the bar after the previous
 *   repeat, else to the top. It plays `repeatEnd` times in all, and at least once more than the
 *   highest ending number on its own bar.
 * - A bar with `ending` plays on the passes its numbers name. After a repeat's last pass the
 *   endings that follow keep that pass number, so a second ending after a backward repeat plays.
 *   A bracket that closes one bar before its backward repeat leaves the section open, so the
 *   repeat returns to the section's start.
 * - A D.C. or D.S. is taken once (D.S. to the last segno at or before it, else the top). After it
 *   no repeat is taken, a volta bar plays on the last ending only, a Fine ends the piece and a To
 *   Coda goes to the next coda. `jumps: false` leaves the jumps out and keeps the repeats.
 *
 * The order always ends: a bar moves it back only at a backward repeat, which returns at most
 * `times - 1` times (and `times` is read as at most MAX_PASSES), and at the single D.C. or D.S.;
 * everything else moves forward. A pass is never cut partway through.
 */
export function performanceOrder(
  measures: readonly MeasureInfo[],
  opts: { jumps?: boolean } = {},
): number[] {
  const n = measures.length;
  const form = (i: number): MeasureForm => measures[i]?.form ?? {};
  const out: number[] = [];
  if (!measures.some((m) => m.form)) {
    for (let i = 0; i < n; i++) out.push(i);
    return out;
  }
  const taken = new Map<number, number>();
  let sectionStart = 0;
  let pass = 1;
  let jumped = false;
  /** After a repeat's last pass: its pass number still names the endings that follow it. */
  let afterRepeat = false;
  let i = 0;
  while (i < n) {
    const f = form(i);
    if (afterRepeat && !f.ending) {
      afterRepeat = false;
      pass = 1;
    }
    if (f.ending && !f.ending.includes(jumped ? lastEnding(measures, i) : pass)) {
      i++;
      continue;
    }
    if (f.repeatStart && i !== sectionStart) {
      // A forward repeat on a volta bar (a MuseScore layout) opens a section but keeps the pass.
      sectionStart = i;
      if (!f.ending) pass = 1;
    }
    out.push(i);
    if (jumped && f.fine) break;
    if (jumped && f.toCoda) {
      let c = i + 1;
      while (c < n && !form(c).coda) c++;
      if (c < n) {
        i = c;
        continue;
      }
    }
    if (!jumped && f.repeatEnd) {
      const times = Math.min(
        MAX_PASSES,
        Math.max(f.repeatEnd, f.ending ? Math.max(...f.ending) + 1 : 2),
      );
      const done = taken.get(i) ?? 0;
      if (done + 1 < times) {
        taken.set(i, done + 1);
        pass++;
        i = sectionStart;
        continue;
      }
      sectionStart = i + 1;
      afterRepeat = true;
    } else if (f.ending && !form(i + 1).ending && !repeatEndsAfterEnding(measures, i)) {
      sectionStart = i + 1;
      pass = 1;
    }
    if (opts.jumps !== false && !jumped && (f.daCapo || f.dalSegno)) {
      jumped = true;
      i = f.dalSegno ? lastSegno(measures, i) : 0;
      sectionStart = i;
      continue;
    }
    i++;
  }
  return out;
}

/**
 * Whether the volta bracket that ends at bar `i` closes one bar before its backward repeat: no bar
 * of the bracket carries the repeat sign, and one follows before the next forward repeat. The
 * section then stays open, so that repeat returns to the section's start.
 */
function repeatEndsAfterEnding(measures: readonly MeasureInfo[], i: number): boolean {
  let first = i;
  while (first > 0 && measures[first - 1]?.form?.ending) first--;
  for (let k = first; k <= i; k++) if (measures[k]?.form?.repeatEnd) return false;
  for (let k = i + 1; k < measures.length; k++) {
    const f = measures[k]?.form;
    if (f?.repeatStart) return false;
    if (f?.repeatEnd) return true;
  }
  return false;
}

/** The highest volta number in the run of bars with an ending around bar `i`. */
function lastEnding(measures: readonly MeasureInfo[], i: number): number {
  let first = i;
  while (first > 0 && measures[first - 1]?.form?.ending) first--;
  let best = 0;
  for (let k = first; k < measures.length && measures[k]?.form?.ending; k++) {
    for (const e of measures[k]!.form!.ending!) best = Math.max(best, e);
  }
  return best;
}

/** The last bar at or before `i` with a segno, or the top when there is none. */
function lastSegno(measures: readonly MeasureInfo[], i: number): number {
  for (let k = i; k >= 0; k--) if (measures[k]?.form?.segno) return k;
  return 0;
}
