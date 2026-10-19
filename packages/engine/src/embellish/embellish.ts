// `embellishMusicXml`: light diminution of a library melody, a pure function from MusicXML text to
// MusicXML text plus the record of inserted notes. The port of `core.embellish` at light density,
// held to research/embellish/light_reference.py by packages/engine/fixtures/embellish-light-golden.json.
import { parseXml } from '../io/musicxml/dom.js';
import { analyseDocument, beatQ } from './analyse.js';
import { fmtBeat, frac } from './frac.js';
import { divisionsFactorLight, findCandidates, pitchName, selectLight } from './rules.js';
import type { EmbellishRole, EmbellishRule } from './rules.js';
import { insertNewNote, scaleDivisions, serialise, setLength } from './write.js';

export type { EmbellishRule } from './rules.js';

export interface InsertedNote {
  /** 0-based measure index (document order), the bar the figure is in. */
  measureIndex: number;
  /** The measure's `number` attribute. */
  bar: string;
  /** 1-based beat of the new note's onset, `fmtBeat` (a pickup bar counts from its end). */
  beat: string;
  /** Onset in quarters from the start of the score, exact (`Frac.toString()`, e.g. "9/2"). */
  onset: string;
  /** Spelled from the key signature in force, e.g. "F#4", "Bb4". */
  pitch: string;
  midi: number;
  rule: EmbellishRule;
  role: EmbellishRole;
  /** Length in quarters, `fmtBeat` ("0.5", "1"). */
  length: string;
}

export interface EmbellishOptions {
  /** Only 'light' is built; anything else throws. */
  density?: 'light';
  /** Measure indices whose chosen figures are removed after selection (the guard's retry). */
  dropBars?: Iterable<number>;
}

export interface EmbellishResult {
  /** The embellished text; the input text itself when refused or when nothing is added. */
  xml: string;
  inserted: InsertedNote[];
  refusal: string | null;
  /** Why each melody note got no light candidate, by reason, one reason per note. */
  skipped: Record<string, number>;
  melodyVoice: string | null;
}

/**
 * Splits some melody notes of a partwise piano score in place: passing notes that fill a third,
 * and an upper neighbour a whole step above a repeated note, at most one figure per bar and never
 * in two neighbouring bars. A refused piece comes back unchanged with the reason. Unreadable input
 * (a `<pitch>` without `<octave>`, a non-numeric `<duration>` to scale) throws.
 */
export function embellishMusicXml(text: string, opts: EmbellishOptions = {}): EmbellishResult {
  const density = opts.density ?? 'light';
  if (density !== 'light')
    throw new Error(`density must be light (the only one built), not ${JSON.stringify(density)}`);
  const skipped: Record<string, number> = {};
  const doc = parseXml(text);
  let piece = analyseDocument(doc);
  if (piece.refusal)
    return { xml: text, inserted: [], refusal: piece.refusal, skipped, melodyVoice: null };
  const factor = divisionsFactorLight(piece);
  if (factor > 1) {
    scaleDivisions(piece.root, factor);
    piece = analyseDocument(doc);
  }
  const chosen = selectLight(findCandidates(piece, skipped), opts.dropBars);
  const inserted: InsertedNote[] = [];
  for (const c of chosen) {
    const { a } = c;
    const m = a.measure;
    setLength(a.el, c.parts[0]!.length, a.divisions);
    let t = a.onset.add(c.parts[0]!.length);
    for (const part of c.parts.slice(1)) {
      const midi = part.pitch!;
      insertNewNote(a, midi, part.length, a.fifths);
      const metric = t.sub(m.start).add(m.offset);
      inserted.push({
        measureIndex: m.idx,
        bar: m.number,
        beat: fmtBeat(metric.div(beatQ(m)).add(frac(1))),
        onset: t.toString(),
        pitch: pitchName(midi, a.fifths),
        midi,
        rule: c.rule,
        role: part.role as EmbellishRole,
        length: fmtBeat(part.length),
      });
      t = t.add(part.length);
    }
  }
  return {
    xml: inserted.length ? serialise(text, piece.root) : text,
    inserted,
    refusal: null,
    skipped,
    melodyVoice: piece.melodyVoice,
  };
}
