/**
 * Seeking by bar (T13): the score is the timeline. A click or tap anywhere in a bar goes to that
 * bar's start; Left and Right step one bar, Shift four; Home is Rewind. These helpers hold the
 * pure parts: when each bar starts, which bar a time lies in, where a step lands (inside a loop
 * when one is set), which keys seek, and where each bar is drawn in the rendered pages.
 */
import type { Score } from '@digitus2/engine';
import { ticksToSeconds } from '@digitus2/engine/score-build';
import { groupIndexAt } from './onsetGroups.js';
import type { LoopRange } from './usePlayback.js';

/** Bars Shift with Left or Right moves: a four-bar phrase. */
export const BAR_LEAP = 4;

/** The score time each bar starts at, in seconds, in bar order (the transport's own reading). */
export function barStartSecs(score: Score): number[] {
  return score.measures.map((m) => ticksToSeconds(score.tempoMap, score.divisions, m.startTick));
}

/** The bar `sec` lies in (0-based): the last one starting at or before it, the first before it. */
export function barIndexAt(starts: readonly number[], sec: number): number {
  return Math.max(
    0,
    groupIndexAt(
      starts.map((s) => ({ sec: s })),
      sec + 1e-9,
    ),
  );
}

/**
 * Where a seek to bar `bar` lands: the bar itself, within the piece, and inside the loop when one
 * is set (a seek never leaves the bars being practised: the transport would only jump back to the
 * loop's start).
 */
export function clampBar(bar: number, barCount: number, loop: LoopRange | null): number {
  let lo = 0;
  let hi = barCount - 1;
  if (loop && loop.from <= loop.to) {
    lo = Math.min(Math.max(lo, loop.from), hi);
    hi = Math.min(Math.max(lo, loop.to), hi);
  }
  return Math.min(hi, Math.max(lo, Math.trunc(bar)));
}

/**
 * The focused elements that keep the arrow keys and Home for themselves: fields move their caret,
 * sliders, radios and lists move their value. Anywhere else the keys seek.
 */
const TAKES_ARROWS = [
  'input',
  'textarea',
  'select',
  "[contenteditable]:not([contenteditable='false'])",
  ...[
    'slider',
    'spinbutton',
    'radio',
    'radiogroup',
    'textbox',
    'searchbox',
    'combobox',
    'listbox',
    'option',
    'menu',
    'menuitem',
    'tab',
    'tablist',
    'grid',
    'tree',
  ].map((role) => `[role='${role}']`),
].join(', ');

/** What a key press asks of the bar seek: a step of some bars, the start, or nothing. */
export type SeekKey = { kind: 'step'; bars: number } | { kind: 'start' } | null;

/**
 * The seek a key press asks for: Left and Right one bar back or forward, with Shift four
 * (BAR_LEAP), Home the start. Nothing with Ctrl, Alt or Meta (the browser's own shortcuts), while
 * composing text, when already handled, or when the focus is in a control that takes the key
 * (TAKES_ARROWS).
 */
export function seekKey(
  e: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'defaultPrevented' | 'isComposing'
  > & { target: EventTarget | null },
): SeekKey {
  if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home') return null;
  if (e.target instanceof Element && e.target.closest(TAKES_ARROWS) !== null) return null;
  if (e.key === 'Home') return e.shiftKey ? null : { kind: 'start' };
  const size = e.shiftKey ? BAR_LEAP : 1;
  return { kind: 'step', bars: e.key === 'ArrowLeft' ? -size : size };
}

/** A bar as drawn, in pixels from the host's top left corner. */
export interface BarBox {
  /** The bar (0-based), its place among the drawn bars. */
  bar: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One page of the score (an SVG in the host) and its bars. */
export interface PageBars {
  page: Element;
  /** Its top and bottom, in pixels from the host's top. */
  top: number;
  bottom: number;
  /** The number of its first bar among the bars of every page. */
  first: number;
  measures: Element[];
}

/**
 * The pages inside `host` (its children) with their bars, numbered across the pages in document
 * order, which is the score's bar order (the pages are laid out from the score's own MusicXML),
 * and where each page lies. One box per page: the bars themselves are not measured, so a page that
 * is not rendered (base.css, `content-visibility`) costs nothing here. Call it once per layout.
 */
export function pageBars(host: Element): PageBars[] {
  const origin = host.getBoundingClientRect();
  let first = 0;
  return Array.from(host.children).map((page) => {
    const r = page.getBoundingClientRect();
    const measures = Array.from(page.querySelectorAll('g.measure'));
    const out = { page, top: r.top - origin.top, bottom: r.bottom - origin.top, first, measures };
    first += measures.length;
    return out;
  });
}

/**
 * Where each bar of `page` is drawn, in pixels from the top left corner of `host`: from its first
 * staff's top to its last staff's bottom (both hands), between its bar lines, padded above and
 * below by `pad` times the height of a staff, so the digits over and under the staves count too.
 * A bar drawn nowhere (no staff) is left out. Read from layout, which draws the page if it was
 * not drawn: call it once per page and layout, for a page that is needed (a long piece has dozens,
 * issue #79), not per pointer move.
 */
export function barBoxes(host: Element, pad: number, page: PageBars): BarBox[] {
  const origin = host.getBoundingClientRect();
  const out: BarBox[] = [];
  page.measures.forEach((measure, i) => {
    const bar = page.first + i;
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    let staffHeight = 0;
    for (const staff of measure.querySelectorAll(':scope > g.staff')) {
      // The staff lines alone (its own paths, one per line), not the notes, whose ledger lines
      // and stems reach out of the staff: neighbouring bars and systems must not overlap.
      let staffTop = Infinity;
      let staffBottom = -Infinity;
      for (const line of staff.querySelectorAll(':scope > path')) {
        const r = line.getBoundingClientRect();
        if (r.width === 0) continue;
        left = Math.min(left, r.left);
        right = Math.max(right, r.right);
        staffTop = Math.min(staffTop, r.top);
        staffBottom = Math.max(staffBottom, r.bottom);
      }
      if (!(staffBottom >= staffTop)) continue;
      top = Math.min(top, staffTop);
      bottom = Math.max(bottom, staffBottom);
      staffHeight = Math.max(staffHeight, staffBottom - staffTop);
    }
    if (!(right > left)) return;
    out.push({
      bar,
      left: left - origin.left,
      right: right - origin.left,
      top: top - origin.top - pad * staffHeight,
      bottom: bottom - origin.top + pad * staffHeight,
    });
  });
  return out;
}

/** The bar drawn at (x, y), in pixels from the host's top left corner; null when none is. */
export function barAt(boxes: readonly BarBox[], x: number, y: number): BarBox | null {
  for (const b of boxes) {
    if (x >= b.left && x < b.right && y >= b.top && y < b.bottom) return b;
  }
  return null;
}
