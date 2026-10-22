import type { Spelling } from './pitch.js';

export type Hand = 'L' | 'R';
export type Finger = 1 | 2 | 3 | 4 | 5;

export interface TempoEvent {
  tick: number;
  qpm: number;
}
export interface TimeSigEvent {
  tick: number;
  beats: number;
  beatType: number;
}
export interface KeySigEvent {
  tick: number;
  fifths: number;
  mode?: 'major' | 'minor';
}
export interface MeasureInfo {
  index: number;
  startTick: number;
  lengthTicks: number;
  number: string;
}

/** Playback interpretation of a source sign; the written note remains the solver's input. */
export interface Ornament {
  kind: 'trill-mark' | 'mordent' | 'inverted-mordent';
  long: boolean;
  upperMidi: number;
  lowerMidi: number;
  startNote: 'main' | 'upper' | 'below';
  beats?: number;
  /** End of the first written segment, before any tied continuation. */
  endTick: number;
  endSec: number;
}

/** A rolled chord's mark (`<arpeggiate>`): playback only; the written onset stays. */
export interface Arpeggio {
  direction: 'up' | 'down';
  number?: number;
}

/** A damper-pedal mark: down (start, resume, damper-pedal yes or above 0), up (stop, discontinue, no or 0), change. */
export interface PedalEvent {
  tick: number;
  sec: number;
  type: 'down' | 'up' | 'change';
}

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
  /** MIDI velocity 0..127 when the source carries one (PIG, MIDI, MusicXML dynamics marks). */
  velocity?: number;
  ornament?: Ornament;
  arpeggio?: Arpeggio;
}

export interface Score {
  meta: { title?: string; composer?: string; source?: string };
  divisions: number;
  tempoMap: TempoEvent[];
  timeSignatures: TimeSigEvent[];
  keySignatures: KeySigEvent[];
  measures: MeasureInfo[];
  notes: Note[];
  /** Damper-pedal marks in time order, for the whole score; absent when the source has none. */
  pedals?: PedalEvent[];
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

export interface HandEvent {
  onsetTick: number;
  notes: Note[];
}
