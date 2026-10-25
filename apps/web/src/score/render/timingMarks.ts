/**
 * The timing rings of the waiting walk (issue 192), over the Verovio SVG: a thin gray ring about
 * the size of a notehead beside each judged note that came clearly early or late. The ring sits
 * beside the note on the side the key went down (left is earlier on the sheet), as far as the
 * local spacing of the music says and always clear of the note's own head, red or not. A ring is
 * the last child of its `g.staff`, outside every `g.layer`, `g.note` and `g.chord`, so neither
 * the dimmed hand (`.is-muted`) nor the accent (`.is-red`) reaches it; its stroke is base.css's
 * (`.timing-mark`). The geometry is `ringFor` (pure), the shape is `markShape` alone, and this
 * file never builds a page (no `ensureNotes`).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export type MarkVerdict = 'early' | 'late';

/** The shape of walkTiming.ts's neighbours, declared here so this file stands alone. */
export interface MarkNeighbour {
  ids: readonly string[];
  dSec: number;
}

export interface TimingMark {
  ids: readonly string[];
  verdict: MarkVerdict;
  /** Signed offset in performance seconds (negative early). */
  offsetSec: number;
  prev: MarkNeighbour | null;
  next: MarkNeighbour | null;
}

export const MARK_CLASS = 'timing-mark';

/** A ring's radius in noteheads: one notehead across for a chord too. */
export const RING_SCALE = 0.6;

/** The red notehead's scale, as base.css's `.is-red .notehead` draws it (about its centre). */
export const RED_HEAD_SCALE = 1.4;

/** The clear gap, in noteheads, between an early or late ring and the red head of its note. */
export const RING_CLEARANCE = 0.25;

/**
 * The least a ring moves from its note, in noteheads: half the red head, the
 * ring's radius and the clear gap, so the ring never touches its own notehead, red or not.
 */
export const RING_MIN_SHIFT = RED_HEAD_SCALE / 2 + RING_SCALE + RING_CLEARANCE;

export interface RingInput {
  /** Middle of the unit's noteheads on this staff, and one notehead's width. */
  cx0: number;
  cy: number;
  w: number;
  verdict: MarkVerdict;
  offsetSec: number;
  /** Middle x of the neighbours' noteheads on this staff, when usable (same system, right side). */
  prev: { x: number; dSec: number } | null;
  next: { x: number; dSec: number } | null;
}

export interface Ring {
  cx: number;
  cy: number;
  r: number;
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * Where the ring of one staff goes. It moves left or right by the offset on the local time scale:
 * the distance to the neighbouring onset on that side (else the other side) over its time apart.
 * It moves at least `RING_MIN_SHIFT` noteheads, so it clears its own notehead even when the red
 * lands there and the side always shows, and at most half the gap to the neighbour on its side,
 * so it stays nearer its own note; when the two cross, the least shift wins. With no neighbour it
 * moves the least shift.
 */
export function ringFor(input: RingInput): Ring {
  const { cx0, cy, w, verdict, offsetSec } = input;
  const r = RING_SCALE * w;
  const least = RING_MIN_SHIFT * w;
  const early = verdict === 'early';
  const near = early ? input.prev : input.next;
  const scaleFrom = near ?? (early ? input.next : input.prev);
  const scale =
    scaleFrom && scaleFrom.dSec > 0 ? Math.abs(cx0 - scaleFrom.x) / scaleFrom.dSec : null;
  const shift = scale !== null ? Math.abs(offsetSec) * scale : least;
  const ceiling = near ? Math.abs(cx0 - near.x) / 2 : Infinity;
  const d = Math.max(least, Math.min(shift, ceiling));
  return { cx: early ? cx0 - d : cx0 + d, cy, r };
}

/** A number for an SVG attribute, to a hundredth of a user unit. */
function num(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** The one place that knows the mark is a ring: swap this to change the shape. */
export function markShape(doc: Document, ring: Ring): SVGElement {
  const g = doc.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', MARK_CLASS);
  g.setAttribute('aria-hidden', 'true');
  const circle = doc.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', num(ring.cx));
  circle.setAttribute('cy', num(ring.cy));
  circle.setAttribute('r', num(ring.r));
  g.appendChild(circle);
  return g;
}

function byId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return `#${CSS.escape(id)}`;
  return `[id="${id.replace(/["\\]/g, '\\$&')}"]`;
}

/** The place of a `g.staff` among the staves of its bar (0 for the top one). */
function staffPlace(staff: Element): number {
  let place = 0;
  for (let s = staff.previousElementSibling; s; s = s.previousElementSibling) {
    if (s.matches('g.staff')) place++;
  }
  return place;
}

interface Head {
  el: Element;
  staff: Element;
}

/** The noteheads of the notes `ids` drawn in `root`, each with its `g.staff`. */
function headsOf(root: Element, ids: readonly string[]): Head[] {
  const out: Head[] = [];
  for (const id of ids) {
    const note = root.querySelector(byId(id));
    const el = note?.querySelector('g.notehead');
    const staff = note?.closest('g.staff');
    if (el && staff) out.push({ el, staff });
  }
  return out;
}

/** The middle of the union of `boxes` (at least one). */
function middle(boxes: readonly Box[]): { x: number; y: number } {
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const top = Math.min(...boxes.map((b) => b.y));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/**
 * Draws a ring for each of `marks` on the pages built in `root`, one per `g.staff` the mark's
 * notes are in, measured with `boxOf` (`getBBox()`, in the staff's user units: Verovio puts no
 * transform between a page's systems and its noteheads). A neighbour counts only when drawn in
 * the same `g.system` (on the same staff when it can be), on its side of the note. Draws on top
 * of what is there: clear first (`clearTimingMarks`) to redraw. Returns how many rings it drew;
 * notes not on these pages are skipped.
 */
export function drawTimingMarks(
  root: Element,
  marks: readonly TimingMark[],
  boxOf: (el: SVGGraphicsElement) => DOMRect | Box = (el) => el.getBBox(),
): number {
  const measure = (heads: readonly Head[]): Box[] => {
    const out: Box[] = [];
    for (const { el } of heads) {
      try {
        const box = boxOf(el as SVGGraphicsElement);
        if (box.width > 0) out.push(box);
      } catch {
        // A page that is not laid out has no boxes (Firefox throws): no ring there.
      }
    }
    return out;
  };
  const neighbourX = (n: MarkNeighbour | null, system: Element | null, place: number) => {
    if (!n || !(n.dSec > 0) || !system) return null;
    const inSystem = headsOf(root, n.ids).filter((h) => h.staff.closest('g.system') === system);
    const onStaff = inSystem.filter((h) => staffPlace(h.staff) === place);
    const boxes = measure(onStaff.length > 0 ? onStaff : inSystem);
    return boxes.length > 0 ? { x: middle(boxes).x, dSec: n.dSec } : null;
  };

  let drawn = 0;
  for (const mark of marks) {
    const staves = new Map<Element, Head[]>();
    for (const head of headsOf(root, mark.ids)) {
      const list = staves.get(head.staff);
      if (list) list.push(head);
      else staves.set(head.staff, [head]);
    }
    for (const [staff, heads] of staves) {
      const boxes = measure(heads);
      if (boxes.length === 0) continue;
      const { x: cx0, y: cy } = middle(boxes);
      const system = staff.closest('g.system');
      const place = staffPlace(staff);
      const prev = neighbourX(mark.prev, system, place);
      const next = neighbourX(mark.next, system, place);
      const ring = ringFor({
        cx0,
        cy,
        w: boxes[0]!.width,
        verdict: mark.verdict,
        offsetSec: mark.offsetSec,
        prev: prev && prev.x < cx0 ? prev : null,
        next: next && next.x > cx0 ? next : null,
      });
      const el = markShape(staff.ownerDocument, ring);
      el.setAttribute('data-timing', mark.verdict);
      staff.appendChild(el);
      drawn++;
    }
  }
  return drawn;
}

/** Removes every timing ring inside `root`. */
export function clearTimingMarks(root: Element): void {
  for (const el of Array.from(root.querySelectorAll(`.${MARK_CLASS}`))) el.remove();
}
