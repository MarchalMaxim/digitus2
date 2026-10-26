/**
 * The halo of the waiting walk (issue 204), over the Verovio SVG: one thin circle in the `g.note` of
 * the topmost notehead the cue marks, so the accent reaches it only through the `.is-red` rules and
 * it is part of the one red root. Its look is base.css's (`.along-halo`). This file never builds a
 * page.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export const HALO_CLASS = 'along-halo';

type Box = { x: number; y: number; width: number; height: number };

/** Where a halo goes: the note it is drawn in, the notehead's centre and width, in SVG user units. */
export interface HaloAnchor {
  note: Element;
  cx: number;
  cy: number;
  w: number;
}

/** A number for an SVG attribute, to a hundredth of a user unit. */
function num(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/**
 * The topmost of the noteheads the cue marks (`.is-red .notehead` in `host`), by the smallest box
 * `y`, measured with `boxOf` (`getBBox()`: the user units of the notehead's SVG, which ignore the
 * marked notehead's CSS scale). Null when none is marked, when none has a box wider than 0 (a page
 * not laid out; a throw counts as none), or when the notehead has no `g.note` ancestor.
 */
export function haloAnchor(
  host: Element,
  boxOf: (el: SVGGraphicsElement) => DOMRect | Box = (el) => el.getBBox(),
): HaloAnchor | null {
  let best: { head: Element; box: DOMRect | Box } | null = null;
  for (const head of host.querySelectorAll('.is-red .notehead')) {
    let box: DOMRect | Box;
    try {
      box = boxOf(head as SVGGraphicsElement);
    } catch {
      continue;
    }
    if (!(box.width > 0)) continue;
    if (!best || box.y < best.box.y) best = { head, box };
  }
  if (!best) return null;
  const note = best.head.closest('.note');
  if (!note) return null;
  const { x, y, width, height } = best.box;
  return { note, cx: x + width / 2, cy: y + height / 2, w: width };
}

/** Appends the halo, an SVG `circle.along-halo` with `aria-hidden="true"`, as the note's last child. */
export function drawHalo(anchor: HaloAnchor, r: number): SVGCircleElement {
  const circle = anchor.note.ownerDocument.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('class', HALO_CLASS);
  circle.setAttribute('aria-hidden', 'true');
  circle.setAttribute('cx', num(anchor.cx));
  circle.setAttribute('cy', num(anchor.cy));
  circle.setAttribute('r', num(r));
  anchor.note.appendChild(circle);
  return circle;
}

/** Sets the circle's radius, to a hundredth of a user unit (written only when it changes). */
export function setHaloRadius(circle: SVGCircleElement, r: number): void {
  const value = num(r);
  if (circle.getAttribute('r') !== value) circle.setAttribute('r', value);
}

/** Removes every halo inside `root`. */
export function clearHalos(root: Element): void {
  for (const circle of root.querySelectorAll(`.${HALO_CLASS}`)) circle.remove();
}
