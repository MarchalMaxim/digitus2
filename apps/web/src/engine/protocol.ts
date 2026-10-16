/**
 * The messages between the main thread and the engine worker. Parsing, solving and writing the
 * fingered MusicXML all run in the worker (spec section 4); every request carries an id that its
 * response echoes, so the client can match answers that arrive out of order.
 */
import type { Assignment, MidiInfo, Score } from '@digitus2/engine';
import type { HandSize } from '../app/store.js';

/** What a loaded file is: MusicXML (plain or `.mxl`) or a Standard MIDI File. */
export type SourceKind = 'musicxml' | 'midi';

/** The single place that decides MIDI versus MusicXML: `.mid` or `.midi`, in any case, is MIDI. */
export function sourceKind(name: string): SourceKind {
  return /\.midi?$/i.test(name) ? 'midi' : 'musicxml';
}

export type EngineRequest =
  | {
      id: number;
      type: 'load';
      kind: SourceKind;
      input: string | Uint8Array;
      source: string;
      /** MIDI only: every note at or above this pitch goes to the right hand. */
      splitMidi?: number;
      /** Scan imports must not repair invalid recognition silently. */
      preserveNotation?: boolean;
    }
  | { id: number; type: 'solve'; score: Score; profile: HandSize; pins?: Assignment }
  | { id: number; type: 'fingeredXml'; xml: string; score: Score; assignment: Assignment };

export type EngineResponse =
  | {
      id: number;
      ok: true;
      type: 'load';
      score: Score;
      editorial: Assignment;
      warnings: string[];
      xml: string;
      /** The import facts of a MIDI file; null for MusicXML. */
      midiInfo: MidiInfo | null;
    }
  | { id: number; ok: true; type: 'solve'; assignment: Assignment; ms: number }
  | { id: number; ok: true; type: 'fingeredXml'; xml: string }
  | { id: number; ok: false; error: string };
