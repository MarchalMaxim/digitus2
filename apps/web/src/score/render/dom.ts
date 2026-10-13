/**
 * Main-thread helpers over the Verovio SVG: the playback cursor (the `.is-red` class on the
 * notes that start at one instant), in-place digit patching, and hit testing. The SVG ids are
 * the engine's note ids (see injectIds.ts), and each `g.fing` carries `data-startid="#<noteId>"`.
 */

const RED = 'is-red';
const ONSET = 'data-onset-tick';

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
