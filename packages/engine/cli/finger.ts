import { readFileSync, writeFileSync } from 'node:fs';
import { solveFingering } from '../src/fingering/solve.js';
import type { HandProfileId } from '../src/fingering/spans.js';
import { parseMusicXml } from '../src/io/musicxml/read.js';
import { injectFingerings } from '../src/io/musicxml/write.js';
import { parsePig } from '../src/io/pig/read.js';
import { writePig } from '../src/io/pig/write.js';
import type { Hand } from '../src/score/types.js';

export interface FingerOptions {
  file: string;
  out?: string;
  format?: 'pig' | 'musicxml';
  profile?: HandProfileId;
  hand?: 'R' | 'L' | 'both';
  editorial?: boolean;
}

/**
 * Solves a MusicXML (`.musicxml`, `.xml`, `.mxl`) or PIG (`.txt`) file and returns the fingered
 * text: PIG for PIG input, MusicXML with injected fingerings for MusicXML input, unless `format`
 * says otherwise. With `editorial`, the file's own fingerings are pins. Writes to `out` when given.
 */
export function fingerFile(o: FingerOptions): string {
  const isPig = /\.txt$/i.test(o.file);
  const hands: Hand[] = o.hand === 'R' ? ['R'] : o.hand === 'L' ? ['L'] : ['R', 'L'];
  const solveOpts = {
    hands,
    ...(o.profile ? { profile: o.profile } : {}),
    respectEditorial: o.editorial ?? false,
  };
  let text: string;
  if (isPig) {
    if ((o.format ?? 'pig') !== 'pig') throw new Error('musicxml output needs MusicXML input');
    const { score, assignment: editorial } = parsePig(readFileSync(o.file, 'utf8'), {
      source: o.file,
    });
    const { assignment } = solveFingering(score, { ...solveOpts, pins: editorial });
    text = writePig(score, assignment);
  } else {
    const bytes = readFileSync(o.file);
    const { score, editorial } = parseMusicXml(bytes, { source: o.file });
    const { assignment } = solveFingering(score, { ...solveOpts, pins: editorial });
    text =
      (o.format ?? 'musicxml') === 'pig'
        ? writePig(score, assignment)
        : injectFingerings(bytes, score, assignment);
  }
  if (o.out) writeFileSync(o.out, text);
  return text;
}
