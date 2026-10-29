/**
 * The messages between the main thread and the engine worker. Parsing, solving and writing the
 * fingered MusicXML all run in the worker (spec section 4); every request carries an id that its
 * response echoes, so the client can match answers that arrive out of order.
 */
import type { Assignment, MidiInfo, Score, TieRepair } from '@digitus2/engine';
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
      /** A scan's ties that cannot be joined become separate presses, listed in `tieRepairs`. */
      tolerateScanTies?: boolean;
    }
  | { id: number; type: 'solve'; score: Score; profile: HandSize; pins?: Assignment }
  | { id: number; type: 'fingeredXml'; xml: string; score: Score; assignment: Assignment }
  /** "Add notes between": the guarded light embellishment of a plain MusicXML text. */
  | { id: number; type: 'embellish'; xml: string };

export type EngineResponse =
  | {
      id: number;
      ok: true;
      type: 'load';
      score: Score;
      editorial: Assignment;
      warnings: string[];
      /** The ties a scan import read as separate presses (`tolerateScanTies`); else empty. */
      tieRepairs: TieRepair[];
      xml: string;
      /** The import facts of a MIDI file; null for MusicXML. */
      midiInfo: MidiInfo | null;
    }
  | { id: number; ok: true; type: 'solve'; assignment: Assignment; ms: number }
  | { id: number; ok: true; type: 'fingeredXml'; xml: string }
  | {
      id: number;
      ok: true;
      type: 'embellish';
      /**
       * The embellished version, or null when the guard refused it (`reason` says why): its
       * MusicXML text, its score, the file's own fingering (on original notes only) and the
       * guarded fingering at every hand size, solved as the app solves the plain score.
       */
      offered: {
        xml: string;
        score: Score;
        editorial: Assignment;
        assignments: Record<HandSize, Assignment>;
        figures: number;
      } | null;
      reason: string | null;
      ms: number;
    }
  | { id: number; ok: false; error: string };

/** The embellished version the worker offers. */
export type EmbellishedDoc = NonNullable<
  Extract<EngineResponse, { type: 'embellish'; ok: true }>['offered']
>;
