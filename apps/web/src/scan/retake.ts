/**
 * One page of a batch photographed again (issue 130). Only that page is recognised anew and the
 * pages are joined again, so every note after it can change its ordinal, the name corrections use
 * (notes.ts). The reader's corrections on the other pages are carried over to the same notes:
 * a note is found again by its page, its part and its place among that page's notes of the part,
 * and kept only when it still reads the same. Corrections on the retaken page go with it.
 */
import type { Correction } from './corrections.js';
import { parseScanXml, readScanScore, type ScanNote, type ScanScore } from './notes.js';
import { tryCorrection } from './ScanEditor.js';

/** Where a note sits, independent of the other pages: page, part and its place on that page. */
const placeKey = (n: ScanNote, place: number) => `${n.page}|${n.part}|${place}`;

/** What a note reads as on its page: enough to tell a different note at the same place. */
const reading = (n: ScanNote) =>
  [
    n.rest,
    n.chord,
    n.grace,
    n.step,
    n.alter,
    n.octave,
    n.type,
    n.dots,
    n.staff,
    n.staves,
    n.voice,
  ].join('|');

/**
 * The parts and staves of each page's notes. When the join pairs the staves of a page differently
 * (join.ts), the parts and staves are laid out another way and a place no longer names the same note.
 */
function layouts(score: ScanScore) {
  const sets = new Map<number, Set<string>>();
  for (const n of score.notes) {
    const set = sets.get(n.page) ?? new Set<string>();
    set.add(`${n.part}/${n.staves}`);
    sets.set(n.page, set);
  }
  return new Map([...sets].map(([page, set]) => [page, [...set].sort().join(',')]));
}

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
 * `replaced` (one page, or every page photographed again so far) was recognised again, renamed for
 * `after`. Order is kept; a meter correction is named by a bar of the first part, as corrections.ts
 * reads it. A page whose parts and staves are laid out differently after the join carries nothing.
 */
export function carryCorrections(
  before: ScanScore,
  after: ScanScore,
  corrections: readonly Correction[],
  replaced: number | readonly number[],
): Correction[] {
  const gone = new Set(typeof replaced === 'number' ? [replaced] : replaced);
  const layout = layouts(before);
  const freshLayout = layouts(after);
  const sameLayout = (page: number) => layout.get(page) === freshLayout.get(page);
  const old = places(before);
  const fresh = places(after);
  const oldBars = barPlaces(before);
  const freshBars = barPlaces(after);
  const oldNotes = new Map(before.notes.map((n) => [n.ordinal, n]));
  const out: Correction[] = [];
  for (const c of corrections) {
    if (c.kind === 'meter' || c.kind === 'barline') {
      const place = oldBars.byIndex.get(`0|${c.bar}`);
      const page = place ? Number(place.split('|')[0]) : undefined;
      if (!place || page === undefined || gone.has(page) || !sameLayout(page)) continue;
      const bar = freshBars.byPlace.get(place);
      if (bar !== undefined) out.push({ ...c, bar });
      continue;
    }
    const note = oldNotes.get(c.note);
    const place = old.byOrdinal.get(c.note);
    if (!note || !place || gone.has(note.page) || !sameLayout(note.page)) continue;
    const same = fresh.byPlace.get(place);
    if (!same || reading(same) !== reading(note)) continue;
    out.push({ ...c, note: same.ordinal });
  }
  return out;
}

/**
 * The corrections to keep on the new combined recognition `after`: those of `carryCorrections`
 * that still apply, each checked one at a time on the ones kept before it. A refused correction (a
 * tie to a note the new page no longer has) is dropped alone, so it cannot cut off the later ones.
 */
export function carryOver(
  before: string,
  after: string,
  corrections: readonly Correction[],
  replaced: number | readonly number[],
): Correction[] {
  const carried = carryCorrections(
    readScanScore(parseScanXml(before)),
    readScanScore(parseScanXml(after)),
    corrections,
    replaced,
  );
  const kept: Correction[] = [];
  for (const c of carried) {
    try {
      if (tryCorrection(after, kept, c) === null) kept.push(c);
    } catch {
      // Not a refusal the editor words: the correction does not apply either.
    }
  }
  return kept;
}
