/**
 * Main-thread helpers over the Verovio SVG: the playback cursor (the `.is-red` class on the
 * notes that start at one instant), the hand left out of one-hand practice (`.is-muted`),
 * in-place digit patching, and hit testing. The SVG ids are
 * the engine's note ids (see injectIds.ts), and each `g.fing` carries `data-startid="#<noteId>"`.
 */

import { pageWindowOf } from './pageWindow.js';

const RED = 'is-red';
const ONSET = 'data-onset-tick';
const MUTED = 'is-muted';
const SWEEPING = 'is-sweeping';
const RETURNING = 'is-returning';
const SPARE = 'is-spare';
const OPEN = 'is-open';
const CLOSING = 'is-closing';

function escapeId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return `#${CSS.escape(id)}`;
  return `[id="${attrValue(id)}"]`;
}

function attrValue(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

/**
 * Marks the notes `noteIds` as current: a note inside a `g.chord` marks the whole chord once,
 * otherwise the `g.note` itself. Every marked element gets `.is-red` and `data-onset-tick`.
 * Returns the marked elements in the order first met. Does not clear the previous marks.
 */
export function setCurrent(host: Element, noteIds: string[], onsetTick: number): Element[] {
  // A windowed sheet builds the pages the notes are on first (issue 99).
  pageWindowOf(host)?.ensureNotes(noteIds);
  const marked: Element[] = [];
  const seen = new Set<Element>();
  for (const id of noteIds) {
    const note = host.querySelector(escapeId(id));
    if (!note) continue;
    const el = note.closest('g.chord') ?? note;
    if (seen.has(el)) continue;
    seen.add(el);
    el.classList.add(RED);
    el.setAttribute(ONSET, String(onsetTick));
    marked.push(el);
  }
  return marked;
}

/**
 * Removes every cursor mark inside `host`. The marks are found by their class alone: `setCurrent`
 * sets the class and the tick together, and one class is the browser's fast query, where a list of
 * two selectors walks a long piece's 100,000 elements the slow way on every hand switch.
 */
export function clearCurrent(host: Element): void {
  for (const el of Array.from(host.querySelectorAll(`.${RED}`))) {
    el.classList.remove(RED);
    el.removeAttribute(ONSET);
  }
}

/** The place of a `g.staff` among the staves of its bar (0 for the top one). */
function staffPlace(staff: Element): number {
  let place = 0;
  for (let s = staff.previousElementSibling; s; s = s.previousElementSibling) {
    if (s.matches('g.staff')) place++;
  }
  return place;
}

/**
 * Dims the notes `mutedIds` (the hand left out of one-hand practice) and their digits with
 * `.is-muted`, after clearing any earlier dimming; an empty set only clears. What is dimmed is
 * `mutedElements`. Returns how many elements were dimmed.
 */
export function dimNotes(host: Element, mutedIds: ReadonlySet<string>): number {
  const from = Array.from(host.querySelectorAll(`.${MUTED}`));
  const to = mutedElements(host, mutedIds);
  redim(from, to);
  return to.length;
}

/**
 * Moves the dimming from the elements `from` to the elements `to` (each a `mutedElements` list, or
 * empty), touching nothing else: a hand switch costs the elements it changes, not the piece.
 */
export function redim(from: readonly Element[], to: readonly Element[]): void {
  for (const el of from) el.classList.remove(MUTED);
  for (const el of to) el.classList.add(MUTED);
}

/**
 * What dims the notes `mutedIds` (the hand left out of one-hand practice) and their digits, read
 * from the markup alone, changing nothing; none for an empty set. Verovio draws a bar as
 * `g.measure > g.staff > g.layer` (one voice), and the layer holds the notes, their beams and the
 * rests. A staff place (the left hand's staff, say) whose notes are all dimmed, across the pages,
 * has every layer dimmed, rests alone included; any other layer whose notes are all dimmed is
 * dimmed whole, beams and rests with it; otherwise each dimmed note is dimmed on its own, or its
 * `g.chord` when the whole chord is. The staff lines, clefs and bar lines stay, and so do slurs,
 * ties and dynamics. A digit (`g.fing`, in its bar) is dimmed by `data-startid`. Nothing is
 * dimmed twice over (no dimmed element inside another). It walks the pages in the DOM. On a
 * windowed sheet (issue 99) that is some of the pages: `quiet` then says the staff places whose
 * notes are all dimmed across every page (`quietPlaces`), which the pages in the DOM cannot tell.
 */
export function mutedElements(
  host: Element,
  mutedIds: ReadonlySet<string>,
  quiet?: ReadonlySet<number>,
): Element[] {
  const out: Element[] = [];
  if (mutedIds.size === 0) return out;
  const dim = (el: Element) => {
    out.push(el);
  };
  const muted = (note: Element) => mutedIds.has(note.id);

  const staves = Array.from(host.querySelectorAll('g.measure > g.staff')).map((staff) => ({
    staff,
    place: staffPlace(staff),
    notes: Array.from(staff.querySelectorAll('g.note')),
  }));
  /** The staff places that have notes, all of them dimmed. */
  let quietPlaces = quiet;
  if (!quietPlaces) {
    const known = new Map<number, boolean>();
    for (const { place, notes } of staves) {
      if (notes.length > 0) known.set(place, (known.get(place) ?? true) && notes.every(muted));
    }
    quietPlaces = new Set([...known].filter(([, all]) => all).map(([place]) => place));
  }
  for (const { staff, place } of staves) {
    const wholeStaff = quietPlaces.has(place);
    for (const layer of Array.from(staff.querySelectorAll('g.layer'))) {
      const notes = Array.from(layer.querySelectorAll('g.note'));
      if (wholeStaff || (notes.length > 0 && notes.every(muted))) {
        dim(layer);
        continue;
      }
      const chords = new Set<Element>();
      for (const note of notes.filter(muted)) {
        const chord = note.closest('g.chord');
        if (chord) chords.add(chord);
        else dim(note);
      }
      for (const chord of chords) {
        const own = Array.from(chord.querySelectorAll('g.note'));
        if (own.every(muted)) dim(chord);
        else own.filter(muted).forEach(dim);
      }
    }
  }
  for (const fing of Array.from(host.querySelectorAll('g.fing'))) {
    const id = fing.getAttribute('data-startid')?.replace(/^#/, '');
    if (id && mutedIds.has(id)) dim(fing);
  }
  return out;
}

/**
 * The systems (`g.system`) of the pages in `host` that meet the window (`viewportHeight` tall):
 * one box per page, then one per system of the pages on screen only, so the cost stays a screen's
 * worth however long the piece. Read before a hand switch changes any class, when layout is clean.
 */
export function systemsOnScreen(host: Element, viewportHeight = window.innerHeight): Set<Element> {
  const meets = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < viewportHeight;
  };
  const out = new Set<Element>();
  for (const page of Array.from(host.children)) {
    if (!meets(page)) continue;
    for (const system of Array.from(page.querySelectorAll('g.system'))) {
      if (meets(system)) out.add(system);
    }
  }
  return out;
}

/**
 * Staggers a hand switch: each of `elements` (what one-hand practice dimmed or undimmed) inside
 * one of `systems` (the systems on screen, `systemsOnScreen`) gets `.is-sweeping`, the one class
 * the fade is declared on (base.css), and a `--sweep` delay in proportion to where its bar stands
 * in its system, from 0 for the first bar to `spreadMs` for the last, so the hand fades out (or
 * back in) from left to right. Everything else changes at once: off screen nobody sees a fade, and
 * fading a whole long piece (8,818 transitions on 780 bars) stalled the page (issue #79). Clears
 * the previous switch's marks first. Read from the markup alone (each bar's place among its
 * system's bars), never from layout, so it adds no style or layout pass between the class change
 * and its transition. A digit brought back that was dimmed at rest, drawn through its group
 * opacity, also gets `.is-returning`, its fade in from that gray (base.css); one still fading from
 * the switch before (a quick toggle) turns back from where its fade is instead. `spreadMs` 0
 * (reduced motion) marks nothing. Returns how many it marked.
 */
export function sweepDimming(
  host: Element,
  elements: Iterable<Element>,
  spreadMs: number,
  systems: ReadonlySet<Element>,
): number {
  const fading = new Set(host.querySelectorAll(`.${SWEEPING}`));
  for (const el of fading) unmark(el);
  if (spreadMs <= 0) return 0;
  const place = new Map<Element, number>();
  const placeOf = (measure: Element): number => {
    const known = place.get(measure);
    if (known !== undefined) return known;
    const system = measure.closest('g.system');
    const bars = system ? [...system.querySelectorAll('g.measure')] : [measure];
    bars.forEach((bar, i) => place.set(bar, bars.length > 1 ? i / (bars.length - 1) : 0));
    return place.get(measure) ?? 0;
  };
  let count = 0;
  for (const el of elements) {
    const system = el.closest('g.system');
    if (!system || !systems.has(system)) continue;
    const measure = el.closest('g.measure');
    // A spare digit in a bar that is not open is hidden whatever the hand does: nothing sweeps it
    // or brings it back, so a hand switch never flashes the digits the edition leaves out.
    if (el.classList.contains(SPARE) && !measure?.classList.contains(OPEN)) continue;
    const at = measure ? placeOf(measure) : 0;
    el.classList.add(SWEEPING);
    if (el.matches('g.fing') && !el.classList.contains(MUTED) && !fading.has(el)) {
      el.classList.add(RETURNING);
    }
    (el as SVGElement).style.setProperty('--sweep', `${Math.round(at * spreadMs)}ms`);
    count++;
  }
  return count;
}

function unmark(el: Element): void {
  el.classList.remove(SWEEPING, RETURNING);
  (el as SVGElement).style.removeProperty('--sweep');
}

/**
 * Ends the sweep of `target` when it is an element `sweepDimming` marked (called as its fade ends,
 * from the transition or animation's end event): it settles into its resting look, which for a
 * dimmed digit is drawn differently from its fade (base.css). Anything else is left alone.
 */
export function settleSweep(target: EventTarget | null): void {
  if (target instanceof Element && target.classList.contains(SWEEPING)) unmark(target);
}

/**
 * Ends the sweep of every element of `host` marked that has no fade to run: one whose look did
 * not change (a switch undone within a frame, before any style was worked out) starts no fade, so
 * no end event will ever come. `getAnimations` works out the pending style change first, the one
 * the next frame would, so call it right after `sweepDimming`.
 */
export function settleStill(host: Element, doc: Document = host.ownerDocument): void {
  const fading = new Set(
    (doc.getAnimations?.() ?? []).map((a) => (a.effect as KeyframeEffect | null)?.target),
  );
  for (const el of Array.from(host.querySelectorAll(`.${SWEEPING}`))) {
    if (!fading.has(el)) unmark(el);
  }
}

/**
 * Ends the sweep of `target` after one of its fades was cancelled (the next switch came during
 * it), which fires no end event, once none of its fades still runs.
 */
export function settleCancelled(target: EventTarget | null): void {
  if (target instanceof Element && (target.getAnimations?.() ?? []).length === 0) {
    settleSweep(target);
  }
}

/**
 * Writes the digits `changes` (note id -> digit text) into the existing `g.fing` elements and
 * calls `flashFn` on each one whose text changed. Unknown ids and unchanged digits are skipped.
 * Returns how many digits changed.
 */
export function setDigits(
  host: Element,
  changes: Map<string, string>,
  flashFn?: (el: Element) => void,
): number {
  let changed = 0;
  for (const [id, digit] of changes) {
    const g = host.querySelector(`g.fing[data-startid="#${attrValue(id)}"]`);
    const t = g?.querySelector('tspan tspan') ?? g?.querySelector('text');
    if (!g || !t || t.textContent === digit) continue;
    t.textContent = digit;
    changed++;
    flashFn?.(g);
  }
  return changed;
}

/** The id of the `g.note` under an event target, or null when the target is not in a note. */
export function noteIdAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest('g.note')?.id || null;
}

/**
 * Marks the digits the edition leaves out (issue 94): every `g.fing` whose note (`data-startid`)
 * is not in `printed` gets `.is-spare`, the others lose it; null (the editor's fingering is shown,
 * which is an edition already) removes the mark everywhere. The digits stay in the SVG: base.css
 * hides a spare digit outside an open bar, so the bar played, cued or under the pointer shows all.
 * Returns how many digits are spare.
 */
export function markSpare(host: Element, printed: ReadonlySet<string> | null): number {
  let spare = 0;
  for (const fing of Array.from(host.querySelectorAll('g.fing'))) {
    const id = fing.getAttribute('data-startid')?.replace(/^#/, '');
    const isSpare = printed !== null && id !== undefined && !printed.has(id);
    if (isSpare) spare++;
    if (fing.classList.contains(SPARE) !== isSpare) fing.classList.toggle(SPARE, isSpare);
  }
  return spare;
}

/**
 * The first bar and the number of bars of page `page` of `host`, counted across the pages as the
 * bar seek counts them: a windowed sheet states them on every page (`data-first-bar`, `data-bars`)
 * whether the page is built or not, any other sheet has every page built and they are counted.
 */
function pageBarRange(
  host: Element,
  upTo?: Element,
): { page: Element; first: number; count: number }[] {
  const out: { page: Element; first: number; count: number }[] = [];
  let first = 0;
  for (const page of Array.from(host.children)) {
    const stated = page.getAttribute('data-first-bar');
    const f = stated !== null ? Number(stated) : first;
    const count =
      page.getAttribute('data-bars') !== null
        ? Number(page.getAttribute('data-bars'))
        : page.querySelectorAll('g.measure').length;
    out.push({ page, first: f, count });
    first = f + count;
    if (page === upTo) break;
  }
  return out;
}

/** The drawn bar (`g.measure`) with ordinal `bar` among the pages in `host`; null when its page is not built. */
export function barElement(host: Element, bar: number): Element | null {
  for (const { page, first, count } of pageBarRange(host)) {
    if (bar < first || bar >= first + count) continue;
    return page.querySelectorAll('g.measure')[bar - first] ?? null;
  }
  return null;
}

/** The ordinal of the drawn bar holding `el` among the bars of every page; null outside a bar. */
export function barOrdinal(host: Element, el: Element): number | null {
  const measure = el.closest('g.measure');
  if (!measure) return null;
  let page: Element | null = measure;
  while (page && page.parentElement !== host) page = page.parentElement;
  if (!page) return null;
  const range = pageBarRange(host, page).find((r) => r.page === page);
  if (!range) return null;
  const i = Array.from(page.querySelectorAll('g.measure')).indexOf(measure);
  return i < 0 ? null : range.first + i;
}

/** Opens the bars `bars` (ordinals) and closes the ones that were open and are not: see `useOpenBars`. */
export function setOpenBars(
  host: Element,
  was: ReadonlySet<number>,
  now: ReadonlySet<number>,
  fade: boolean,
): Element[] {
  const closing: Element[] = [];
  for (const bar of was) {
    if (now.has(bar)) continue;
    const el = barElement(host, bar);
    if (!el) continue;
    el.classList.remove(OPEN);
    if (fade) {
      el.classList.add(CLOSING);
      closing.push(el);
    }
  }
  for (const bar of now) {
    if (was.has(bar)) continue;
    const el = barElement(host, bar);
    if (!el) continue;
    el.classList.remove(CLOSING);
    el.classList.add(OPEN);
  }
  return closing;
}

/** Ends the short fade-out of bars closed by `setOpenBars`. */
export function settleClosing(els: Iterable<Element>): void {
  for (const el of els) el.classList.remove(CLOSING);
}

/** The ordinal of the drawn bar holding note `id`, building its page first on a windowed sheet. */
export function barOfNote(host: Element, id: string): number | null {
  // The page is built directly: `ensureNotes` would also move the window's red page and schedule
  // a window update at every onset group.
  const pw = pageWindowOf(host);
  const page = pw?.index.pageOfNote.get(id);
  if (pw && page !== undefined) pw.ensurePage(page);
  const note = host.querySelector(escapeId(id));
  return note ? barOrdinal(host, note) : null;
}
