// THROWAWAY spike code. Hub for the XML adapters so the MusicXML -> model builder can run on top of
// different XML parsers (DOMParser on the main thread; pure-JS parsers in Web Workers / Node tests).
// Each adapter also lives in its own module so bundle sizes can be measured in isolation.
import { parseXml, XmlElement, XmlText } from '@rgrove/parse-xml';
import { XMLParser } from 'fast-xml-parser';
import { DOMParser as XmldomParser } from '@xmldom/xmldom';
import type { XNode } from './xnode';
import { fromDom as fromDomWith } from './xml-dom-only';

export { type XNode, decodeEntities, kid, kids, txt } from './xnode';
export { fromTxml } from './xml-txml-only';

/** browser DOMParser (main thread only; not available in Web Workers or Node) */
export const fromDom = (xml: string) => fromDomWith(xml);
/** @xmldom/xmldom DOMParser (what packages/engine uses per the M1 plan; Node + Workers + browser) */
export const fromXmldom = (xml: string) => fromDomWith(xml, XmldomParser as never);

// ---- @rgrove/parse-xml (spec-compliant, decodes entities, ignores DOCTYPE) ----
export function fromRgrove(xml: string): XNode {
  const doc = parseXml(xml);
  const conv = (el: XmlElement): XNode => {
    const children: XNode[] = [];
    let text = '';
    for (const c of el.children) {
      if (c instanceof XmlElement) children.push(conv(c));
      else if (c instanceof XmlText) text += c.text;
    }
    return { name: el.name, attrs: { ...el.attributes }, children, text };
  };
  return conv(doc.root!);
}

// ---- fast-xml-parser (needs preserveOrder:true because MusicXML is order-sensitive: note/backup/forward) ----
let fxp: XMLParser | undefined;
export function fromFastXmlParser(xml: string): XNode {
  fxp ??= new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false, parseAttributeValue: false, trimValues: false, processEntities: true });
  type Ord = Record<string, unknown>;
  const conv = (name: string, body: Ord[], attrs: Record<string, string>): XNode => {
    const children: XNode[] = [];
    let text = '';
    for (const item of body) {
      for (const k of Object.keys(item)) {
        if (k === ':@') continue;
        if (k === '#text') text += String(item[k]);
        else children.push(conv(k, item[k] as Ord[], (item[':@'] as Record<string, string>) ?? {}));
      }
    }
    return { name, attrs, children, text };
  };
  const top = fxp.parse(xml) as Ord[];
  const rootItem = top.find((it) => Object.keys(it).some((k) => !k.startsWith('?') && !k.startsWith('!') && k !== ':@' && k !== '#text'))!;
  const name = Object.keys(rootItem).find((k) => k !== ':@')!;
  return conv(name, rootItem[name] as Ord[], (rootItem[':@'] as Record<string, string>) ?? {});
}
