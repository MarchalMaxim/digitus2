/**
 * A note in the score and its key on the on-screen keyboard (issue #96): hovering a note presses
 * its key with its finger number, so a beginner's silent question "which key is this note" is
 * answered without a control. These are the pure parts: the key a note presses, the hand a key
 * belongs to (for the velocity a clicked key sounds at), and where each note of a page is drawn,
 * for the hit test under the pointer.
 */
import type { Assignment, Hand, Note, Score } from '@digitus2/engine';
import { UNMARKED_VELOCITY } from '@digitus2/engine/score-build';
import type { PressedKey } from './Keyboard.js';
import { HALO_CLASS } from './render/halo.js';

/** The key a note presses: its pitch, the finger on screen for it (none is fine), its hand. */
export function keyForNote(note: Note, assignment: Assignment | null): PressedKey {
  return { midi: note.midi, finger: assignment?.[note.id]?.finger ?? null, hand: note.hand };
}

/**
 * The hand a key belongs to: the one that plays that pitch in the piece (its first note at that
 * pitch), else the right hand. A clicked key sounds at that hand's unmarked velocity
 * (`UNMARKED_VELOCITY`), the one its notes play at when nothing is marked.
 */
export function handOfKey(score: Pick<Score, 'notes'>, midi: number): Hand {
  return score.notes.find((n) => n.midi === midi)?.hand ?? 'R';
}

/** The velocity a key clicked on the keyboard sounds at: the hand's unmarked one. */
export function keyVelocity(hand: Hand): number {
  return UNMARKED_VELOCITY[hand];
}

/** A note as drawn, in pixels from the host's top left corner, padded by `pad` on every side. */
export interface NoteBox {
  /** The note's id (the engine's, injected into the SVG). */
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The note's box, without a halo among its children: the union of the other children's boxes. */
function boxOfNote(
  note: Element,
): Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'> | null {
  const children = Array.from(note.children);
  if (!children.some((c) => c.classList.contains(HALO_CLASS))) return note.getBoundingClientRect();
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const child of children) {
    if (child.classList.contains(HALO_CLASS)) continue;
    const c = child.getBoundingClientRect();
    if (!(c.width > 0) || !(c.height > 0)) continue;
    left = Math.min(left, c.left);
    top = Math.min(top, c.top);
    right = Math.max(right, c.right);
    bottom = Math.max(bottom, c.bottom);
  }
  if (left === Infinity) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/**
 * Where each note of `page` (an SVG in `host`) is drawn, from the top left corner of `host`, each
 * box widened by `pad` pixels on every side so a notehead a few pixels wide is not hard to hit.
 * A note without an id, or drawn nowhere, is left out. Read from layout, which draws the page
 * if it was not drawn: call it once per page and layout, for a page the pointer is over, never
 * per pointer move (a long piece has dozens of pages, issue #79). A halo inside a note (issue 204)
 * is left out of its box.
 */
export function noteBoxes(host: Element, page: Element, pad: number): NoteBox[] {
  const origin = host.getBoundingClientRect();
  const out: NoteBox[] = [];
  for (const note of page.querySelectorAll('g.note')) {
    if (!note.id) continue;
    const r = boxOfNote(note);
    if (!r || !(r.width > 0) || !(r.height > 0)) continue;
    out.push({
      id: note.id,
      left: r.left - origin.left - pad,
      top: r.top - origin.top - pad,
      right: r.right - origin.left + pad,
      bottom: r.bottom - origin.top + pad,
    });
  }
  return out;
}

/** The note drawn at (x, y), in pixels from the host's top left corner; null when none is. */
export function noteAt(boxes: readonly NoteBox[], x: number, y: number): NoteBox | null {
  for (const b of boxes) {
    if (x >= b.left && x < b.right && y >= b.top && y < b.bottom) return b;
  }
  return null;
}
