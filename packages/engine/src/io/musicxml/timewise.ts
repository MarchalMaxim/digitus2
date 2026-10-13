import { childElements, parseXml } from './dom.js';
import type { Document, Element } from './dom.js';

export function timewiseToPartwise(doc: Document): Document {
  const root = doc.documentElement;
  if (!root) throw new Error('empty document');
  if (root.tagName === 'score-partwise') return doc;
  if (root.tagName !== 'score-timewise') throw new Error(`not a MusicXML score: <${root.tagName}>`);

  const out = parseXml('<?xml version="1.0" encoding="UTF-8"?><score-partwise/>');
  const outRoot = out.documentElement!;
  for (const attr of Array.from(root.attributes)) outRoot.setAttribute(attr.name, attr.value);

  const partsById = new Map<string, Element>();
  for (const child of childElements(root)) {
    if (child.tagName !== 'measure') {
      outRoot.appendChild(out.importNode(child, true));
      continue;
    }
    for (const part of childElements(child, 'part')) {
      const id = part.getAttribute('id') ?? '';
      let outPart = partsById.get(id);
      if (!outPart) {
        outPart = out.createElement('part');
        outPart.setAttribute('id', id);
        partsById.set(id, outPart);
        outRoot.appendChild(outPart);
      }
      const measure = out.createElement('measure');
      for (const attr of Array.from(child.attributes)) measure.setAttribute(attr.name, attr.value);
      for (const node of Array.from(part.childNodes))
        measure.appendChild(out.importNode(node, true));
      outPart.appendChild(measure);
    }
  }
  return out;
}
