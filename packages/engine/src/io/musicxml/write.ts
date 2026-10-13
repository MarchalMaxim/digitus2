import type { Assignment, Note, Score } from '../../score/types.js';
import { childElements, firstChild, parseXml, serializeXml } from './dom.js';
import type { Document, Element } from './dom.js';
import { timewiseToPartwise } from './timewise.js';
import { unpackMusicXml } from './unpack.js';

const AFTER_NOTATIONS = new Set(['lyric', 'play', 'listen']);

/**
 * Writes `assignment` into the MusicXML as `<technical><fingering>` elements and returns the
 * new MusicXML text. Each fingering goes on the `<note>` element that starts the sounding note
 * (`sourceIndices[0]`, so a tied note is fingered once), placed above for the right hand and
 * below for the left; a substitution becomes a second `<fingering substitution="yes">`.
 * Existing fingerings on those notes are replaced unless `opts.replace` is false. Everything
 * else in the document is kept.
 *
 * Two inputs do not come back in their original form: a `score-timewise` document is written
 * back as `score-partwise` (it is converted with `timewiseToPartwise` before the fingerings are
 * placed), and an `.mxl` archive comes back as plain MusicXML text, not as a new archive.
 */
export function injectFingerings(
  xml: string | Uint8Array,
  score: Score,
  assignment: Assignment,
  opts: { replace?: boolean } = {},
): string {
  const replace = opts.replace ?? true;
  const text = unpackMusicXml(xml);
  const doc = timewiseToPartwise(parseXml(text));
  // Document-order index of a sounding note's first <note> element -> that note.
  const byIndex = new Map<number, Note>();
  for (const n of score.notes) {
    const first = n.sourceIndices[0];
    if (first !== undefined && assignment[n.id]) byIndex.set(first, n);
  }
  const noteEls = doc.getElementsByTagName('note');
  for (let i = 0; i < noteEls.length; i++) {
    const note = byIndex.get(i);
    if (note === undefined) continue;
    const a = assignment[note.id]!;
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
