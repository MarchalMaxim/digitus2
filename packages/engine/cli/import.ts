import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { importMidi } from '../src/io/midi/import.js';
import { keyName } from '../src/io/midi/key.js';
import { formatPigPitch, midiToSpelling } from '../src/score/pitch.js';

export interface ImportOptions {
  file: string;
  out?: string;
  split?: number;
  title?: string;
}

export function importFile(o: ImportOptions): { xml: string; summary: string; warnings: string[] } {
  const bytes = new Uint8Array(readFileSync(o.file));
  const title = o.title ?? basename(o.file, extname(o.file));
  const { xml, score, info } = importMidi(bytes, {
    title,
    ...(o.split !== undefined ? { splitMidi: o.split } : {}),
  });
  if (o.out) writeFileSync(o.out, xml);
  const right = score.notes.filter((n) => n.hand === 'R').length;
  const key = score.keySignatures[0] ?? { tick: 0, fifths: 0 };
  const summary =
    `imported ${basename(o.file)}: ${score.notes.length} notes (${right} right, ${score.notes.length - right} left), ` +
    `${score.measures.length} measures, key ${keyName(key)}; ` +
    `${Math.round(info.quantizedMovedShare * 100)} % of notes moved more than a 64th note` +
    (info.splitMidi !== null
      ? `; hand split at ${formatPigPitch(midiToSpelling(info.splitMidi))}`
      : '');
  return { xml, summary, warnings: info.warnings };
}
