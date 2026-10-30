import type { Score } from '../../score/types.js';
import { parseMusicXml } from '../musicxml/read.js';
import { scoreToMusicXml } from './engrave.js';
import { separateHands } from './handSeparation.js';
import type { HandMotionParams } from './motion.js';
import { quantize, type GridKind } from './quantize.js';
import { detectPickup } from './pickup.js';
import { parseMidiFile } from './read.js';
import { cleanFileTitle, isGenericName } from './title.js';
import { midiToScore } from './toScore.js';

export interface MidiImportOptions {
  splitMidi?: number;
  /** Wins over every other title. */
  title?: string;
  /**
   * The file name without its extension; titles the piece, made readable, when the file's own
   * sequence name is missing or generic.
   */
  fallbackTitle?: string;
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
  const separate = (splitMidi: number | undefined) =>
    separateHands(quantized.notes, {
      ...(splitMidi !== undefined ? { splitMidi } : {}),
      ...(opts.params ? { params: opts.params } : {}),
    });
  const hands = separate(opts.splitMidi);
  // The bars never depend on the Hand split: a pickup is looked for with the automatic hands.
  const pickupTicks = detectPickup(
    quantized.notes,
    opts.splitMidi === undefined ? hands : separate(undefined),
    data.timeSignatures[0]!,
    quantized.divisions,
  );
  const title = pickTitle(opts, data.sequenceName);

  const engrave = (pickup: number) => {
    const built = midiToScore(data, quantized, hands, {
      ...(title !== undefined ? { title } : {}),
      ...(opts.composer !== undefined ? { composer: opts.composer } : {}),
      ...(pickup > 0 ? { pickupTicks: pickup } : {}),
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
    return { built, xml, parsed };
  };
  // A pickup is a guess about a file that has no barlines: it never turns a file that imports
  // with full bars into an error.
  let result: ReturnType<typeof engrave>;
  if (pickupTicks > 0) {
    try {
      result = engrave(pickupTicks);
    } catch {
      result = engrave(0);
    }
  } else result = engrave(0);
  const { built, xml, parsed } = result;
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

/** The explicit title, else the file's own name when it names a piece, else the file name. */
function pickTitle(opts: MidiImportOptions, sequenceName: string | undefined): string | undefined {
  if (opts.title !== undefined) return opts.title;
  if (sequenceName !== undefined && !isGenericName(sequenceName)) return sequenceName;
  const fromFile = opts.fallbackTitle !== undefined ? cleanFileTitle(opts.fallbackTitle) : '';
  return fromFile === '' ? undefined : fromFile;
}
