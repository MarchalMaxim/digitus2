import { unzipSync } from 'fflate';

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Returns MusicXML text from a string, from the bytes of a plain MusicXML file, or from the
 * bytes of an `.mxl` archive (the rootfile named by `META-INF/container.xml`, else the first
 * `.xml`/`.musicxml` entry outside `META-INF/`). Bytes are decoded by their byte-order mark,
 * else by the encoding named in the XML declaration, else as UTF-8. A leading BOM is removed.
 */
export function unpackMusicXml(input: string | Uint8Array): string {
  if (typeof input === 'string') return stripBom(input);
  if (input.length >= 2 && input[0] === 0x50 && input[1] === 0x4b) return unpackMxl(input);
  return decodeXml(input);
}

function unpackMxl(bytes: Uint8Array): string {
  const entries = unzipSync(bytes);
  const container = entries['META-INF/container.xml'];
  if (container) {
    const m = /<rootfile[^>]*full-path="([^"]+)"/.exec(decodeXml(container));
    const path = m?.[1];
    if (path && entries[path]) return decodeXml(entries[path]);
  }
  const candidate = Object.keys(entries).find(
    (name) => !name.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(name),
  );
  if (!candidate) throw new Error('mxl archive contains no MusicXML rootfile');
  return decodeXml(entries[candidate]!);
}

function decodeXml(bytes: Uint8Array): string {
  return stripBom(new TextDecoder(sniffEncoding(bytes)).decode(bytes));
}

/** XML 1.0 appendix F: byte-order mark first, then the first bytes, then the declaration. */
function sniffEncoding(b: Uint8Array): string {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return 'utf-8';
  if (b[0] === 0xff && b[1] === 0xfe) return 'utf-16le';
  if (b[0] === 0xfe && b[1] === 0xff) return 'utf-16be';
  // UTF-16 without a BOM still starts with '<' as one 16-bit code unit.
  if (b[0] === 0x3c && b[1] === 0x00) return 'utf-16le';
  if (b[0] === 0x00 && b[1] === 0x3c) return 'utf-16be';
  // Otherwise the file is ASCII-compatible up to the declaration, so read it byte by byte.
  const head = String.fromCharCode(...b.subarray(0, 256));
  const declared = /^\s*<\?xml[^>]*?\sencoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/.exec(head)?.[1];
  // An ASCII-compatible file cannot be UTF-16, whatever its declaration says.
  if (!declared || /^utf-?16/i.test(declared)) return 'utf-8';
  return isKnownEncoding(declared) ? declared : 'utf-8';
}

function isKnownEncoding(label: string): boolean {
  try {
    new TextDecoder(label);
    return true;
  } catch {
    return false;
  }
}
