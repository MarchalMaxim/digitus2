import type { Assignment, Score } from '../../score/types.js';
import { childElements, firstChild, parseXml, serializeXml } from './dom.js';
import type { Document, Element } from './dom.js';
import { timewiseToPartwise } from './timewise.js';
import { unpackMusicXml } from './unpack.js';

const AFTER_NOTATIONS = new Set(['lyric', 'play', 'listen']);

export function injectFingerings(
  xml: string | Uint8Array,
  score: Score,
  assignment: Assignment,
  opts: { replace?: boolean } = {},
): string {
  const replace = opts.replace ?? true;
  const text = unpackMusicXml(xml);
  const doc = timewiseToPartwise(parseXml(text));
  const byIndex = new Map<number, string>();
  for (const n of score.notes) {
    const first = n.sourceIndices[0];
    if (first !== undefined && assignment[n.id]) byIndex.set(first, n.id);
  }
  const noteEls = doc.getElementsByTagName('note');
  for (let i = 0; i < noteEls.length; i++) {
    const id = byIndex.get(i);
    if (id === undefined) continue;
    const a = assignment[id]!;
    const note = score.notes.find((n) => n.id === id)!;
    const el = noteEls.item(i) as Element;
    const technical = ensureTechnical(doc, el);
    if (replace) {
      for (const f of childElements(technical, 'fingering')) technical.removeChild(f);
    }
    const placement = note.hand === 'L' ? 'below' : 'above';
    technical.appendChild(fingeringEl(doc, a.finger, placement));
    if (a.substitution !== undefined) {
      const sub = fingeringEl(doc, a.substitution, placement);
      sub.setAttribute('substitution', 'yes');
      technical.appendChild(sub);
    }
  }
  let out = serializeXml(doc);
  const decl = /^<\?xml[^>]*\?>/.exec(text)?.[0];
  if (decl && !out.startsWith('<?xml')) out = `${decl}\n${out}`;
  return out;
}

function fingeringEl(doc: Document, finger: number, placement: string): Element {
  const f = doc.createElement('fingering');
  f.setAttribute('placement', placement);
  f.appendChild(doc.createTextNode(String(finger)));
  return f;
}

function ensureTechnical(doc: Document, noteEl: Element): Element {
  let notations = firstChild(noteEl, 'notations');
  if (!notations) {
    notations = doc.createElement('notations');
    const before = childElements(noteEl).find((c) => AFTER_NOTATIONS.has(c.tagName));
    if (before) noteEl.insertBefore(notations, before);
    else noteEl.appendChild(notations);
  }
  let technical = firstChild(notations, 'technical');
  if (!technical) {
    technical = doc.createElement('technical');
    notations.appendChild(technical);
  }
  return technical;
}
