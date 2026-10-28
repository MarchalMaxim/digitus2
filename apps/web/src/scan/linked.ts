/**
 * The notation's half of the linked review (issue 130), over the rendered sheet: a thin gray ring
 * around the notehead of each note to check, and a gray frame on the note pointed at in the photo.
 * A ring is a child of its note's `g.note`, so the selected note's red reaches it and it stays one
 * accent element; its stroke is scan.css's (`.scan-mark`), the same as the photo's rings.
 */
import { useLayoutEffect } from 'react';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const MARK_CLASS = 'scan-mark';
/** A ring's radius in noteheads: clear of the head, close enough to belong to it. */
export const MARK_SCALE = 0.95;

/** Rings the notes `ordinals` in the rendered sheet; returns a function that takes them away. */
export function drawMarks(host: ParentNode, ordinals: Iterable<number>): () => void {
  const drawn: Element[] = [];
  for (const ordinal of ordinals) {
    const note = host.querySelector(`[id="s${ordinal}"]`);
    const head = note?.querySelector('.notehead') ?? note;
    if (!note || !head || typeof (head as SVGGraphicsElement).getBBox !== 'function') continue;
    const box = (head as SVGGraphicsElement).getBBox();
    if (!box.width && !box.height) continue;
    const ring = document.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('class', MARK_CLASS);
    ring.setAttribute('cx', String(box.x + box.width / 2));
    ring.setAttribute('cy', String(box.y + box.height / 2));
    ring.setAttribute('r', String(MARK_SCALE * Math.max(box.width, box.height)));
    // In the head's own coordinates: a head drawn with a transform carries it to the ring.
    const transform = head.getAttribute('transform');
    if (transform && head !== note) ring.setAttribute('transform', transform);
    (head === note ? note : head.parentNode!).appendChild(ring);
    drawn.push(ring);
  }
  return () => drawn.forEach((ring) => ring.remove());
}

/** Rings the notes to check, again after every render of the sheet. */
export function useScanMarks(
  host: HTMLElement | null,
  ordinals: readonly number[],
  pages: string[],
) {
  const key = ordinals.join(',');
  useLayoutEffect(() => {
    if (!host || !ordinals.length) return;
    return drawMarks(host, ordinals);
    // The ordinals are compared by value: a new array of the same notes draws nothing new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, key, pages]);
}

/** A gray frame on the note pointed at in the photo, as the selection's ink frame is drawn. */
export function useHoverMark(host: HTMLElement | null, ordinal: number | null, pages: string[]) {
  useLayoutEffect(() => {
    if (!host || ordinal === null) return;
    const element = host.querySelector(`[id="s${ordinal}"]`);
    const frame = host.parentElement;
    if (!element || !frame) return;
    const outer = frame.getBoundingClientRect();
    const inner = element.getBoundingClientRect();
    const box = frame.appendChild(document.createElement('div'));
    box.className = 'scan-hover-box';
    box.setAttribute('aria-hidden', 'true');
    Object.assign(box.style, {
      left: `${inner.left - outer.left - 4}px`,
      top: `${inner.top - outer.top - 4}px`,
      width: `${inner.width + 8}px`,
      height: `${inner.height + 8}px`,
    });
    // Never scrolled to: scrolling would move the photo under the pointer. A click selects it.
    return () => box.remove();
  }, [host, ordinal, pages]);
}
