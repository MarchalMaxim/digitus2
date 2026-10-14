/**
 * The engine worker's request handler, kept pure so it runs under Node in tests. It never
 * throws: every failure becomes `{ ok: false, error }` with the request's id.
 */
import { injectFingerings, parseMusicXml, solveFingering, unpackMusicXml } from '@digitus2/engine';
import type { EngineRequest, EngineResponse } from './protocol.js';

const DECLARED_ENCODING = /^(<\?xml[^>]*?\sencoding\s*=\s*)(["'])[^"']*\2/;

/**
 * Makes the XML declaration name UTF-8. The text has been decoded already (a UTF-16 or Latin-1
 * file is a JavaScript string now), and everything downstream sees it as text: the export is
 * saved as UTF-8 bytes, and a strict reader rejects UTF-8 bytes under `encoding="UTF-16"`.
 */
export function declareUtf8(xml: string): string {
  return xml.replace(DECLARED_ENCODING, '$1$2UTF-8$2');
}

export function handle(req: EngineRequest): EngineResponse {
  try {
    switch (req.type) {
      case 'load': {
        // Plain text for the renderer and the exporter: an .mxl archive or a UTF-16 file is
        // decoded once here, and parseMusicXml then reads the same text, which declares UTF-8.
        const xml = declareUtf8(unpackMusicXml(req.input));
        const { score, editorial, warnings } = parseMusicXml(xml, { source: req.source });
        return { id: req.id, ok: true, type: 'load', score, editorial, warnings, xml };
      }
      case 'solve': {
        const t0 = performance.now();
        const { assignment } = solveFingering(
          req.score,
          req.pins ? { profile: req.profile, pins: req.pins } : { profile: req.profile },
        );
        return { id: req.id, ok: true, type: 'solve', assignment, ms: performance.now() - t0 };
      }
      case 'fingeredXml':
        return {
          id: req.id,
          ok: true,
          type: 'fingeredXml',
          xml: injectFingerings(req.xml, req.score, req.assignment),
        };
    }
  } catch (e) {
    return { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
