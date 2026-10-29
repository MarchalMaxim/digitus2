/**
 * The engine worker's request handler, kept pure so it runs under Node in tests. It never
 * throws: every failure becomes `{ ok: false, error }` with the request's id.
 */
import {
  guardEmbellishment,
  importMidi,
  injectFingerings,
  parseMusicXml,
  RECOMMENDED_WEIGHT_SET,
  solveFingering,
  unpackMusicXml,
} from '@digitus2/engine';
import type { EngineRequest, EngineResponse } from './protocol.js';

/** 'folder/Twinkle.mid' -> 'Twinkle': the title of a MIDI import. */
function titleOf(source: string): string {
  return source.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
}

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
        if (req.kind === 'midi') {
          // The generated MusicXML is what the renderer draws and the exporter saves; the score
          // was read back from it, so its ids are the `id` attributes of the <note> elements.
          if (typeof req.input === 'string') throw new Error('a MIDI file must be passed as bytes');
          const { xml, score, info } = importMidi(req.input, {
            title: titleOf(req.source),
            ...(req.splitMidi !== undefined ? { splitMidi: req.splitMidi } : {}),
          });
          return {
            id: req.id,
            ok: true,
            type: 'load',
            score,
            editorial: {},
            warnings: info.warnings,
            tieRepairs: [],
            xml,
            midiInfo: info,
          };
        }
        // Plain text for the renderer and the exporter: an .mxl archive or a UTF-16 file is
        // decoded once here, and parseMusicXml then reads the same text, which declares UTF-8.
        const xml = declareUtf8(unpackMusicXml(req.input));
        const { score, editorial, warnings, tieRepairs } = parseMusicXml(xml, {
          source: req.source,
          ...(req.preserveNotation ? { preserveNotation: true } : {}),
          ...(req.tolerateScanTies ? { tolerateScanTies: true } : {}),
        });
        return {
          id: req.id,
          ok: true,
          type: 'load',
          score,
          editorial,
          warnings,
          tieRepairs,
          xml,
          midiInfo: null,
        };
      }
      case 'solve': {
        const t0 = performance.now();
        // The app fingers with the shipped learned set (M3), like the CLI and the benchmark gate.
        const options = { profile: req.profile, weightSet: RECOMMENDED_WEIGHT_SET };
        const { assignment } = solveFingering(
          req.score,
          req.pins ? { ...options, pins: req.pins } : options,
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
      case 'embellish': {
        // The guard solves and lints at every hand size with the app's weight set, so the
        // switch never vanishes on a hand-size change. Only five of its fields cross over.
        const t0 = performance.now();
        const { offered: o, reason } = guardEmbellishment(req.xml, {
          weightSet: RECOMMENDED_WEIGHT_SET,
        });
        return {
          id: req.id,
          ok: true,
          type: 'embellish',
          offered: o
            ? {
                xml: o.xml,
                score: o.score,
                editorial: o.editorial,
                assignments: o.assignments,
                figures: o.figures,
              }
            : null,
          reason,
          ms: performance.now() - t0,
        };
      }
    }
  } catch (e) {
    return { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
