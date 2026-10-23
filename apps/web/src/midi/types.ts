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
}

export interface OpenedAccess {
  close(): void;
}

/** Why opening failed: `denied` (the permission now says denied) or `dismissed`. */
export type AccessRefusal = 'denied' | 'dismissed';
