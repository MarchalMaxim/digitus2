// THROWAWAY spike code: DOMParser adapter. Works with the browser's DOMParser (main thread only)
// or with @xmldom/xmldom's DOMParser (Node, Web Workers) — pass it in.
import type { XNode } from './xnode';

type DomParserCtor = new () => { parseFromString(xml: string, type: string): Document };

export function fromDom(xml: string, Parser: DomParserCtor = globalThis.DOMParser as unknown as DomParserCtor): XNode {
  const doc = new Parser().parseFromString(xml, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('XML parse error: ' + err.textContent);
  const conv = (el: Element): XNode => {
    const attrs: Record<string, string> = {};
    for (let i = 0; i < el.attributes.length; i++) attrs[el.attributes[i].name] = el.attributes[i].value;
    const children: XNode[] = [];
    let text = '';
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) children.push(conv(c as Element));
      else if (c.nodeType === 3 || c.nodeType === 4) text += c.nodeValue;
    }
    return { name: el.tagName, attrs, children, text };
  };
  return conv(doc.documentElement);
}
