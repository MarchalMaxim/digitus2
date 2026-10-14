import type { Score } from '../../score/types.js';
import { parseMusicXml } from '../musicxml/read.js';
import { scoreToMusicXml } from './engrave.js';
import { separateHands } from './handSeparation.js';
import type { HandMotionParams } from './motion.js';
import { quantize, type GridKind } from './quantize.js';
import { parseMidiFile } from './read.js';
import { midiToScore } from './toScore.js';

export interface MidiImportOptions {
  splitMidi?: number;
  title?: string;
  composer?: string;
  params?: HandMotionParams;
}
export interface MidiInfo {
  quantizedMovedShare: number;
  grids: Record<GridKind, number>;
  splitMidi: number | null;
  warnings: string[];
}
export interface MidiImport {
  xml: string;
  score: Score;
  info: MidiInfo;
}

export function importMidi(bytes: Uint8Array, opts: MidiImportOptions = {}): MidiImport {
  const data = parseMidiFile(bytes);
  if (data.notes.length === 0) throw new Error('the MIDI file contains no notes');
  const quantized = quantize(data);
  const hands = separateHands(quantized.notes, {
    ...(opts.splitMidi !== undefined ? { splitMidi: opts.splitMidi } : {}),
    ...(opts.params ? { params: opts.params } : {}),
  });
  const built = midiToScore(data, quantized, hands, {
    ...(opts.title !== undefined ? { title: opts.title } : {}),
    ...(opts.composer !== undefined ? { composer: opts.composer } : {}),
  });
  const xml = scoreToMusicXml(built.score);
  // Read our own MusicXML back so sourceIndices point at its <note> elements (injectFingerings
  // needs them), then give every note the id written in its id attribute and its MIDI velocity.
  const parsed = parseMusicXml(xml).score;
  if (parsed.notes.length !== built.score.notes.length)
    throw new Error(
      `engraving lost notes (${built.score.notes.length} written, ${parsed.notes.length} read)`,
    );
  const byKey = new Map(built.score.notes.map((n) => [`${n.hand}:${n.onsetTick}:${n.midi}`, n]));
  for (const n of parsed.notes) {
    const original = byKey.get(`${n.hand}:${n.onsetTick}:${n.midi}`);
    if (!original)
      throw new Error(`engraving moved a note (${n.hand} ${n.midi} at tick ${n.onsetTick})`);
    n.id = original.id;
    if (original.velocity !== undefined) n.velocity = original.velocity;
  }
  return {
    xml,
    score: { ...parsed, meta: built.score.meta },
    info: {
      quantizedMovedShare: quantized.movedShare,
      grids: quantized.grids,
      splitMidi: opts.splitMidi ?? null,
      warnings: [...data.warnings, ...quantized.warnings, ...built.warnings],
    },
  };
}
