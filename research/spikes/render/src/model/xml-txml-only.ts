// THROWAWAY spike code: txml adapter (tiny, fast, works in Web Workers and Node).
// txml does NOT decode entities and treats HTML void tags (link, meta, ...) as self-closing unless told not to.
import { parse as txmlParse, type TNode } from 'txml/txml';
import { type XNode, decodeEntities } from './xnode';

export function fromTxml(xml: string): XNode {
  const nodes = txmlParse(xml, { selfClosingTags: [] });
  const conv = (n: TNode): XNode => {
    const attrs: Record<string, string> = {};
    for (const k in n.attributes) attrs[k] = decodeEntities(n.attributes[k] ?? '');
    const children: XNode[] = [];
    let text = '';
    for (const c of n.children) typeof c === 'string' ? (text += decodeEntities(c)) : children.push(conv(c));
    return { name: n.tagName, attrs, children, text };
  };
  const root = nodes.find((n): n is TNode => typeof n !== 'string' && !n.tagName.startsWith('?') && !n.tagName.startsWith('!'));
  if (!root) throw new Error('no root element');
  return conv(root);
}
