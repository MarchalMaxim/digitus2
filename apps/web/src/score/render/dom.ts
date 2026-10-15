/**
 * Main-thread helpers over the Verovio SVG: the playback cursor (the `.is-red` class on the
 * notes that start at one instant), the hand left out of one-hand practice (`.is-muted`),
 * in-place digit patching, and hit testing. The SVG ids are
 * the engine's note ids (see injectIds.ts), and each `g.fing` carries `data-startid="#<noteId>"`.
 */

const RED = 'is-red';
const ONSET = 'data-onset-tick';
const MUTED = 'is-muted';

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

/** Removes every cursor mark inside `host`. */
export function clearCurrent(host: Element): void {
  for (const el of Array.from(host.querySelectorAll(`.${RED}, [${ONSET}]`))) {
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
 * `.is-muted`, after clearing any earlier dimming; an empty set only clears. Verovio draws a bar
 * as `g.measure > g.staff > g.layer` (one voice), and the layer holds the notes, their beams and
 * the rests. A staff place (the left hand's staff, say) whose notes are all dimmed, across the
 * pages, has every layer dimmed, rests alone included; any other layer whose notes are all
 * dimmed is dimmed whole, beams and rests with it; otherwise each dimmed note is dimmed on its
 * own, or its `g.chord` when the whole chord is. The staff lines, clefs and bar lines stay, and
 * so do slurs, ties and dynamics. A digit (`g.fing`, in its bar) is dimmed by `data-startid`.
 * Nothing is dimmed twice over (no dimmed element inside another). Returns how many elements
 * were dimmed.
 */
export function dimNotes(host: Element, mutedIds: ReadonlySet<string>): number {
  for (const el of Array.from(host.querySelectorAll(`.${MUTED}`))) el.classList.remove(MUTED);
  if (mutedIds.size === 0) return 0;
  let count = 0;
  const dim = (el: Element) => {
    el.classList.add(MUTED);
    count++;
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
  return count;
}

/**
 * Staggers a hand switch: each of `elements` (what one-hand practice dimmed or undimmed) gets a
 * `--sweep` delay in proportion to where its bar stands in its system, from 0 for the first bar to
 * `spreadMs` for the last, so the hand fades out (or back in) from left to right
 * (base.css, `.score-sheet svg` opacity transition). Read from the markup alone (each bar's place
 * among its system's bars), never from layout, so it adds no style or layout pass between the
 * class change and its transition. `spreadMs` 0 clears the delays. Returns how many it set.
 */
export function sweepDimming(elements: Iterable<Element>, spreadMs: number): number {
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
    const measure = el.closest('g.measure');
    const at = measure && spreadMs > 0 ? placeOf(measure) : 0;
    (el as SVGElement).style.setProperty('--sweep', `${Math.round(at * spreadMs)}ms`);
    count++;
  }
  return count;
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
