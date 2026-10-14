import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Score files built inside the tests, for the drop and export flows that must handle more than
 * plain UTF-8 MusicXML (M4 plan, Review Focus 1): a compressed `.mxl` archive and a UTF-16 file.
 */

const contentScores = new URL('../../../../content/scores/', import.meta.url);

/** The bytes of a library score, as the content folder holds it. */
export function libraryScore(slug: string): Buffer {
  return readFileSync(new URL(`${slug}.musicxml`, contentScores));
}

// fflate is the engine's own zip library (it reads `.mxl` with it); the app does not depend on
// it, so it is loaded from the engine package.
const fflate = createRequire(new URL('../../../../packages/engine/package.json', import.meta.url))(
  'fflate',
) as { zipSync(files: Record<string, Uint8Array>): Uint8Array };

/**
 * A compressed MusicXML archive as MuseScore writes one: `META-INF/container.xml` names the
 * rootfile, which sits in a folder of its own.
 */
export function mxlOf(musicXml: Buffer, rootfile = 'score/score.musicxml'): Buffer {
  const container =
    '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles>' +
    `<rootfile full-path="${rootfile}" media-type="application/vnd.recordare.musicxml+xml"/>` +
    '</rootfiles></container>';
  return Buffer.from(
    fflate.zipSync({
      'META-INF/container.xml': new TextEncoder().encode(container),
      [rootfile]: new Uint8Array(musicXml),
    }),
  );
}

/** The same score as UTF-16 little-endian with a byte-order mark, declaring UTF-16. */
export function utf16leOf(musicXml: Buffer): Buffer {
  const text = musicXml.toString('utf8').replace(/encoding="UTF-8"/i, 'encoding="UTF-16"');
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}
