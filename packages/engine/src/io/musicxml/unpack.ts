import { unzipSync } from 'fflate';

const decoder = new TextDecoder('utf-8');

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function unpackMusicXml(input: string | Uint8Array): string {
  if (typeof input === 'string') return stripBom(input);
  if (input.length >= 2 && input[0] === 0x50 && input[1] === 0x4b)
    return stripBom(unpackMxl(input));
  return stripBom(decoder.decode(input));
}

function unpackMxl(bytes: Uint8Array): string {
  const entries = unzipSync(bytes);
  const container = entries['META-INF/container.xml'];
  if (container) {
    const m = /<rootfile[^>]*full-path="([^"]+)"/.exec(decoder.decode(container));
    const path = m?.[1];
    if (path && entries[path]) return decoder.decode(entries[path]);
  }
  const candidate = Object.keys(entries).find(
    (name) => !name.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(name),
  );
  if (!candidate) throw new Error('mxl archive contains no MusicXML rootfile');
  return decoder.decode(entries[candidate]!);
}
