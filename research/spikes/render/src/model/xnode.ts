// THROWAWAY spike code: parser-independent XML tree used by the MusicXML -> model builder.
export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string; // concatenated direct text content
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decodeEntities = (s: string) =>
  s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m);

export const kid = (n: XNode | undefined, name: string) => n?.children.find((c) => c.name === name);
export const kids = (n: XNode | undefined, name: string) => (n ? n.children.filter((c) => c.name === name) : []);
export const txt = (n: XNode | undefined, name: string) => kid(n, name)?.text.trim();
