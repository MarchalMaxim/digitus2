// THROWAWAY spike code: load MusicXML from .musicxml/.xml or compressed .mxl (zip) with fflate.
import { unzipSync, strFromU8 } from 'fflate';

export const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b; // "PK"

export function mxlToXml(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => !f.name.endsWith('/') && !f.name.startsWith('__MACOSX') });
  const container = files['META-INF/container.xml'];
  let path = container ? /full-path\s*=\s*"([^"]+)"/.exec(strFromU8(container))?.[1] : undefined;
  // fallback: first .musicxml/.xml that is not inside META-INF
  path ??= Object.keys(files).find((n) => !n.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(n));
  if (!path || !files[path]) throw new Error('no MusicXML rootfile in .mxl');
  return decodeXmlBytes(files[path]);
}

export function decodeXmlBytes(bytes: Uint8Array): string {
  // MusicXML is sometimes UTF-16 with BOM (older Finale exports)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

export async function loadScoreText(url: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  return isZip(bytes) ? mxlToXml(bytes) : decodeXmlBytes(bytes);
}
