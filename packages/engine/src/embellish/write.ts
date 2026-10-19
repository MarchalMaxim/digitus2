// The embellisher's writer: the divisions scale-up, the split of a melody note, the new note and
// the serialiser. A port of research/embellish/core.py (scale_divisions, _set_length, _new_note,
// serialise) over @xmldom/xmldom. ElementTree's `.text` is the character data before an element's
// first child, and its `.tail` the character data after it; both are mirrored here.
import { XMLSerializer } from '@xmldom/xmldom';
import { childElements, firstChild } from '../io/musicxml/dom.js';
import type { Document, Element, Node } from '../io/musicxml/dom.js';
import { text } from './analyse.js';
import type { EmbNote } from './analyse.js';
import { frac, parsePyFraction } from './frac.js';
import type { Frac } from './frac.js';
import { spell, TYPE_OF } from './rules.js';

const isCharData = (n: Node | null): boolean => !!n && (n.nodeType === 3 || n.nodeType === 4);
const isBlank = (n: Node | null): boolean =>
  !!n && n.nodeType === 3 && !/\S/.test(n.nodeValue ?? '');

/** ElementTree's `el.text = s`: the character data before the first child becomes `s`. */
function setText(el: Element, s: string): void {
  while (isCharData(el.firstChild)) el.removeChild(el.firstChild!);
  el.insertBefore(el.ownerDocument!.createTextNode(s), el.firstChild);
}

function textElement(doc: Document, name: string, s: string): Element {
  const el = doc.createElement(name);
  if (s) el.appendChild(doc.createTextNode(s));
  return el;
}

/** `el.remove(child)` in ElementTree: the child goes, and its whitespace tail with it. */
function removeWithTail(el: Element, child: Element): void {
  const tail = child.nextSibling;
  if (isBlank(tail)) el.removeChild(tail!);
  el.removeChild(child);
}

function insertAfter(ref: Element, el: Node): void {
  ref.parentNode!.insertBefore(el, ref.nextSibling);
}

/** `str(v.numerator)` for an integer, else the float, as core.py writes a scaled value. */
function formatScaled(v: Frac): string {
  return v.isInteger() ? String(v.n) : String(v.n / v.d);
}

/**
 * `core.scale_divisions`: multiplies every `<divisions>`, `<duration>` and `<offset>`, and each
 * note's `attack` and `release`, by `factor`: the same music in finer units.
 */
export function scaleDivisions(root: Element, factor: number): void {
  const f = frac(factor);
  const visit = (el: Element): void => {
    const tag = el.tagName;
    if (tag === 'divisions' || tag === 'duration' || tag === 'offset') {
      const s = text(el);
      if (s.trim()) setText(el, formatScaled(parsePyFraction(s.trim()).mul(f)));
    }
    if (tag === 'note') {
      for (const attr of ['attack', 'release']) {
        const v = el.getAttribute(attr);
        if (v) el.setAttribute(attr, formatScaled(parsePyFraction(v).mul(f)));
      }
    }
    for (const c of childElements(el)) visit(c);
  };
  visit(root);
}

function typeOf(length: Frac): readonly [string, number] {
  const t = TYPE_OF.get(length.toString());
  if (!t) throw new Error(`no note type for ${length.toString()} quarters`);
  return t;
}

/**
 * `core._set_length`: the split note keeps `length` quarters. Its `<dot>`s and `<beam>`s go; a
 * missing `<type>` is added in schema order, after `<voice>`, else after `<duration>` and the
 * `<tie>`s that follow it (core.py appends it at the end when there is no `<voice>`).
 */
export function setLength(el: Element, length: Frac, divisions: number): void {
  const duration = firstChild(el, 'duration');
  if (!duration) throw new Error('MusicXML: a melody note without <duration>');
  setText(duration, String(length.mul(frac(divisions)).n));
  const [typ, dots] = typeOf(length);
  for (const d of childElements(el, 'dot')) removeWithTail(el, d);
  for (const b of childElements(el, 'beam')) removeWithTail(el, b);
  let t = firstChild(el, 'type');
  if (!t) {
    t = el.ownerDocument!.createElement('type');
    let ref = firstChild(el, 'voice');
    if (!ref) {
      ref = duration;
      for (let s = ref.nextSibling; s; s = s.nextSibling) {
        if (s.nodeType !== 1) continue;
        if ((s as Element).tagName !== 'tie') break;
        ref = s as Element;
      }
    }
    insertAfter(ref, t);
  }
  setText(t, typ);
  let at = t;
  for (let k = 0; k < dots; k++) {
    const dot = el.ownerDocument!.createElement('dot');
    insertAfter(at, dot);
    at = dot;
  }
}

/**
 * `core._new_note`: a note of `midi`, spelled from the key signature, `length` quarters long, in
 * A's voice, with A's stem and staff when A has them. It goes right after `after` (A by default;
 * pass the previously inserted note to add several in order); when that element is followed by
 * whitespace, a copy of that whitespace goes before the new note, as ElementTree's tail does.
 */
export function insertNewNote(
  a: EmbNote,
  midi: number,
  length: Frac,
  fifths: number,
  after: Element = a.el,
): Element {
  const doc = a.el.ownerDocument!;
  const n = doc.createElement('note');
  const [step, alter, octave] = spell(midi, fifths);
  const p = doc.createElement('pitch');
  p.appendChild(textElement(doc, 'step', step));
  if (alter) p.appendChild(textElement(doc, 'alter', String(alter)));
  p.appendChild(textElement(doc, 'octave', String(octave)));
  n.appendChild(p);
  n.appendChild(textElement(doc, 'duration', String(length.mul(frac(a.divisions)).n)));
  n.appendChild(textElement(doc, 'voice', a.voice));
  const [typ, dots] = typeOf(length);
  n.appendChild(textElement(doc, 'type', typ));
  for (let k = 0; k < dots; k++) n.appendChild(doc.createElement('dot'));
  const stem = firstChild(a.el, 'stem');
  if (stem) n.appendChild(textElement(doc, 'stem', text(stem)));
  if (firstChild(a.el, 'staff')) n.appendChild(textElement(doc, 'staff', a.staff));
  const parent = after.parentNode!;
  const next = after.nextSibling;
  if (isBlank(next)) parent.insertBefore(next!.cloneNode(false), next);
  parent.insertBefore(n, next);
  return n;
}

/**
 * `core.serialise`: the input up to `<score-partwise` (its declaration, DOCTYPE and anything before
 * the root), the serialised root, and the input after the last `</score-partwise>`.
 */
export function serialise(original: string, root: Element): string {
  const start = /<score-partwise\b/.exec(original);
  const end = original.lastIndexOf('</score-partwise>');
  const head = start ? original.slice(0, start.index) : '<?xml version="1.0" encoding="UTF-8"?>\n';
  const tail = end >= 0 ? original.slice(end + '</score-partwise>'.length) : '\n';
  return head + new XMLSerializer().serializeToString(root) + tail;
}
