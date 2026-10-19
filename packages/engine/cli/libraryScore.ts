import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { unpackMusicXml } from '../src/io/musicxml/unpack.js';

/**
 * The MusicXML text of a library score: the file's bytes, gunzipped when they start with the gzip
 * magic `1f 8b`, then decoded by `unpackMusicXml`. The one place that reads a library score for the
 * embellisher's golden test, level test and gate.
 */
export function readLibraryScore(path: string): string {
  let bytes: Uint8Array = readFileSync(path);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  return unpackMusicXml(bytes);
}
