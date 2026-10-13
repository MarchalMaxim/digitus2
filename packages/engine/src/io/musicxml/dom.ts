import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Document, Element, Node } from '@xmldom/xmldom';

export type { Document, Element, Node };

export function parseXml(text: string): Document {
  const errors: string[] = [];
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level === 'error' || level === 'fatalError') errors.push(message);
    },
  });
  const doc = parser.parseFromString(text, 'text/xml');
  if (errors.length > 0 || !doc.documentElement)
    throw new Error(`XML parse error: ${errors[0] ?? 'no document element'}`);
  return doc;
}

export function serializeXml(doc: Document): string {
  return new XMLSerializer().serializeToString(doc);
}

export function childElements(el: Element, name?: string): Element[] {
  const out: Element[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && (name === undefined || (c as Element).tagName === name))
      out.push(c as Element);
  }
  return out;
}

export function firstChild(el: Element, name: string): Element | undefined {
  return childElements(el, name)[0];
}

export function childText(el: Element, name: string): string | undefined {
  const c = firstChild(el, name);
  return c ? (c.textContent ?? '').trim() : undefined;
}
