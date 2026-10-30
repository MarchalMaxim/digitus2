/** Shared types of the piano connection (issue 182). */

/** One key going down (`on`) or up, merged over every input and channel. */
export interface NoteMessage {
  on: boolean;
  midi: number;
  /**
   * Set on the note-offs the store makes when the piano goes away (unplugged, or Turn off): the
   * key was not let go by the reader, so no reader of the notes may judge it as a release.
   */
  lost?: true;
  /** The key's time in performance.now() ms: the event time when plausible, else arrival (issue 192). */
  atMs?: number;
  /** 1..127, on a note-on from the piano (issue 192). */
  velocity?: number;
}

/**
 * Where the piano connection stands. `searching`: access is granted but the browser has not
 * answered yet (Chrome's WinRT backend while a Bluetooth piano is off).
 */
export type PianoStatus =
  'unsupported' | 'off' | 'asking' | 'searching' | 'connected' | 'none' | 'denied';

export interface PianoSnapshot {
  status: PianoStatus;
  /** The connected inputs' names, in MIDIAccess order (Midi Through left out); empty unless connected. */
  names: readonly string[];
}

/** What the lazy access module reports to the static store. */
export interface AccessEvents {
  /** The connected inputs changed (also once right after opening). */
  inputs(names: readonly string[]): void;
  /** A merged note-on or note-off, after `held` was updated. */
  note(e: NoteMessage, held: readonly number[]): void;
  /**
   * Any MIDI message from a connected input, notes or not (a pedal, active sensing), before it is
   * read: proof that the port receives (issue 252).
   */
  heard?(): void;
  /**
   * Every input the browser lists, with its state and connection, at the open and at each state
   * change (the black box, blackBox.ts).
   */
  ports?(ports: readonly PortReport[]): void;
}

/** One input as the browser reports it. */
export interface PortReport {
  id: string;
  name: string;
  state: string;
  connection: string;
}

export interface OpenedAccess {
  close(): void;
}

/** Why opening failed: `denied` (the permission now says denied) or `dismissed`. */
export type AccessRefusal = 'denied' | 'dismissed';
