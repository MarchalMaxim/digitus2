// THROWAWAY spike snippet: add or change the fingering of one note in a MusicXML document (by note id),
// keeping MusicXML element order valid. Works in Node, Workers and browsers (@xmldom/xmldom).
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

// children of <note> that must come AFTER <notations> (MusicXML 4.0 note content model)
const AFTER_NOTATIONS = new Set(['lyric', 'play', 'listen']);

export function setFingering(xml: string, noteId: string, finger: string, placement?: 'above' | 'below'): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const note = Array.from(doc.getElementsByTagName('note')).find((n) => n.getAttribute('id') === noteId);
  if (!note) throw new Error('no <note id="' + noteId + '">');
  const child = (parent: Element, name: string) => Array.from(parent.childNodes).find((c) => c.nodeName === name) as Element | undefined;
  let notations = child(note as unknown as Element, 'notations');
  if (!notations) {
    notations = doc.createElement('notations') as unknown as Element;
    const before = Array.from(note.childNodes).find((c) => AFTER_NOTATIONS.has(c.nodeName));
    note.insertBefore(notations as never, (before ?? null) as never);
  }
  let technical = child(notations, 'technical');
  if (!technical) { technical = doc.createElement('technical') as unknown as Element; notations.appendChild(technical); }
  let fingering = Array.from(technical.childNodes).find((c) => c.nodeName === 'fingering' && (c as Element).getAttribute('substitution') !== 'yes') as Element | undefined;
  if (!fingering) { fingering = doc.createElement('fingering') as unknown as Element; technical.appendChild(fingering); }
  fingering.textContent = finger;
  if (placement) fingering.setAttribute('placement', placement);
  return new XMLSerializer().serializeToString(doc);
}
