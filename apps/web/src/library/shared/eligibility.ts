import { SCAN_LOAD, type EngineClient } from '../../engine/client.js';
import { applyCorrections } from '../../scan/corrections.js';
import type { LocalScoreRecord } from '../local/records.js';
import { SHAREABLE_FILE } from './payload.js';

export interface Shareable {
  /** The MusicXML text as the app plays it (an `.mxl` unpacked, a scan with its corrections). */
  xml: string;
  kind: 'scan' | 'file';
}

/** A row the engine has not read yet could be shared: a recognised scan, or a MusicXML file. */
export function candidate(record: LocalScoreRecord): boolean {
  return record.kind === 'scan' ? !!record.session.xml : SHAREABLE_FILE.test(record.name);
}

/**
 * The score a row would share, or null when it cannot be: the same import that enables Use for
 * fingerings (a scan, with its corrections, read as a scan is) or that opens the file, with notes
 * in it. A MIDI file, an image-only scan and a MusicXML the importer refuses give null.
 */
export async function shareableOf(
  record: LocalScoreRecord,
  engine: Pick<EngineClient, 'load'>,
): Promise<Shareable | null> {
  if (!candidate(record)) return null;
  try {
    if (record.kind === 'scan') {
      const raw = record.session.xml!;
      const xml = applyCorrections(raw, record.session.corrections ?? []).xml;
      const loaded = await engine.load(xml, 'scan.musicxml', SCAN_LOAD);
      return loaded.score.notes.length ? { xml: loaded.xml, kind: 'scan' } : null;
    }
    const bytes = new Uint8Array(await record.blob.arrayBuffer());
    const loaded = await engine.load(bytes, record.name);
    return loaded.score.notes.length ? { xml: loaded.xml, kind: 'file' } : null;
  } catch {
    return null;
  }
}
