/**
 * Main-thread helpers over the Verovio SVG: the playback cursor (the `.is-red` class on the
 * notes that start at one instant), the hand left out of one-hand practice (`.is-muted`),
 * in-place digit patching, and hit testing. The SVG ids are
 * the engine's note ids (see injectIds.ts), and each `g.fing` carries `data-startid="#<noteId>"`.
 */

const RED = 'is-red';
const ONSET = 'data-onset-tick';
const MUTED = 'is-muted';
const SWEEPING = 'is-sweeping';

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
 * dimmed twice over (no dimmed element inside another). It walks every page: a long piece has
 * some 100,000 elements, so the score view finds each selection's list once per layout.
 */
export function mutedElements(host: Element, mutedIds: ReadonlySet<string>): Element[] {
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
  /** Per staff place, whether it has notes and all of them are dimmed. */
  const quiet = new Map<number, boolean>();
  for (const { place, notes } of staves) {
    if (notes.length > 0) quiet.set(place, (quiet.get(place) ?? true) && notes.every(muted));
  }
  for (const { staff, place } of staves) {
    const wholeStaff = quiet.get(place) === true;
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
 * and its transition. `spreadMs` 0 (reduced motion) marks nothing. Returns how many it marked.
 */
export function sweepDimming(
  host: Element,
  elements: Iterable<Element>,
  spreadMs: number,
  systems: ReadonlySet<Element>,
): number {
  for (const el of Array.from(host.querySelectorAll(`.${SWEEPING}`))) unmark(el);
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
    const at = measure ? placeOf(measure) : 0;
    el.classList.add(SWEEPING);
    (el as SVGElement).style.setProperty('--sweep', `${Math.round(at * spreadMs)}ms`);
    count++;
  }
  return count;
}

function unmark(el: Element): void {
  el.classList.remove(SWEEPING);
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
