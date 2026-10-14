/**
 * The messages between the main thread and the engine worker. Parsing, solving and writing the
 * fingered MusicXML all run in the worker (spec section 4); every request carries an id that its
 * response echoes, so the client can match answers that arrive out of order.
 */
import type { Assignment, Score } from '@digitus2/engine';
import type { HandSize } from '../app/store.js';

export type EngineRequest =
  | { id: number; type: 'load'; input: string | Uint8Array; source: string }
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
    }
  | { id: number; ok: true; type: 'solve'; assignment: Assignment; ms: number }
  | { id: number; ok: true; type: 'fingeredXml'; xml: string }
  | { id: number; ok: false; error: string };
