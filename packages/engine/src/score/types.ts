import type { Spelling } from './pitch.js';

export type Hand = 'L' | 'R';
export type Finger = 1 | 2 | 3 | 4 | 5;

export interface TempoEvent { tick: number; qpm: number }
export interface TimeSigEvent { tick: number; beats: number; beatType: number }
export interface KeySigEvent { tick: number; fifths: number; mode?: 'major' | 'minor' }
export interface MeasureInfo { index: number; startTick: number; lengthTicks: number; number: string }

export interface Note {
  id: string;
  onsetTick: number;
  offsetTick: number;
  onsetSec: number;
  offsetSec: number;
  midi: number;
  spelling: Spelling;
  hand: Hand;
  staff: number;
  voice: number;
  measureIndex: number;
  isGrace: boolean;
  chordId: string;
  /** Document-order indices of the source elements merged into this sounding note (tie start first). */
  sourceIndices: number[];
  /** MIDI velocity 0..127 when the source carries one (PIG, MIDI). */
  velocity?: number;
}

export interface Score {
  meta: { title?: string; composer?: string; source?: string };
  divisions: number;
  tempoMap: TempoEvent[];
  timeSignatures: TimeSigEvent[];
  keySignatures: KeySigEvent[];
  measures: MeasureInfo[];
  notes: Note[];
}

export interface FingerAssignment {
  finger: Finger;
  substitution?: Finger;
  confidence?: number;
  alternatives?: Array<{ finger: Finger; cost: number }>;
  pinned?: boolean;
  source: 'engine' | 'user' | 'editorial';
}
export type Assignment = Record<string, FingerAssignment>;

export interface HandEvent { onsetTick: number; notes: Note[] }
