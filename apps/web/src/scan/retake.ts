/**
 * One page of a batch photographed again (issue 130). Only that page is recognised anew and the
 * pages are joined again, so every note after it can change its ordinal, the name corrections use
 * (notes.ts). The reader's corrections on the other pages are carried over to the same notes:
 * a note is found again by its page, its part and its place among that page's notes of the part,
 * and kept only when it still reads the same. Corrections on the retaken page go with it.
 */
import type { Correction } from './corrections.js';
import type { ScanNote, ScanScore } from './notes.js';

/** Where a note sits, independent of the other pages: page, part and its place on that page. */
const placeKey = (n: ScanNote, place: number) => `${n.page}|${n.part}|${place}`;

/** What a note reads as on its page: enough to tell a different note at the same place. */
const reading = (n: ScanNote) =>
  [n.rest, n.chord, n.grace, n.step, n.alter, n.octave, n.type, n.dots, n.staff, n.voice].join('|');

function places(score: ScanScore) {
  const counts = new Map<string, number>();
  const byOrdinal = new Map<number, string>();
  const byPlace = new Map<string, ScanNote>();
  for (const n of score.notes) {
    const group = `${n.page}|${n.part}`;
    const place = counts.get(group) ?? 0;
    counts.set(group, place + 1);
    byOrdinal.set(n.ordinal, placeKey(n, place));
    byPlace.set(placeKey(n, place), n);
  }
  return { byOrdinal, byPlace };
}

/** A bar's page and its place among the bars of that page and part, from the notes in it. */
function barPlaces(score: ScanScore) {
  const pageOf = new Map<string, number>();
  for (const n of score.notes) pageOf.set(`${n.part}|${n.measure}`, n.page);
  const counts = new Map<string, number>();
  const byIndex = new Map<string, string>();
  const byPlace = new Map<string, number>();
  for (const bar of score.bars) {
    const page = pageOf.get(`${bar.part}|${bar.index}`);
    if (page === undefined) continue;
    const group = `${page}|${bar.part}`;
    const place = counts.get(group) ?? 0;
    counts.set(group, place + 1);
    byIndex.set(`${bar.part}|${bar.index}`, `${group}|${place}`);
    byPlace.set(`${group}|${place}`, bar.index);
  }
  return { byIndex, byPlace };
}

/**
 * The corrections of `before` (the raw recognition they were made on) that still apply after page
 * `replaced` was recognised again, renamed for `after`. Order is kept; a meter correction is
 * named by a bar of the first part, as corrections.ts reads it.
 */
export function carryCorrections(
  before: ScanScore,
  after: ScanScore,
  corrections: readonly Correction[],
  replaced: number,
): Correction[] {
  const old = places(before);
  const fresh = places(after);
  const oldBars = barPlaces(before);
  const freshBars = barPlaces(after);
  const oldNotes = new Map(before.notes.map((n) => [n.ordinal, n]));
  const out: Correction[] = [];
  for (const c of corrections) {
    if (c.kind === 'meter') {
      const place = oldBars.byIndex.get(`0|${c.bar}`);
      if (!place || place.startsWith(`${replaced}|`)) continue;
      const bar = freshBars.byPlace.get(place);
      if (bar !== undefined) out.push({ ...c, bar });
      continue;
    }
    const note = oldNotes.get(c.note);
    const place = old.byOrdinal.get(c.note);
    if (!note || !place || note.page === replaced) continue;
    const same = fresh.byPlace.get(place);
    if (!same || reading(same) !== reading(note)) continue;
    out.push({ ...c, note: same.ordinal });
  }
  return out;
}
