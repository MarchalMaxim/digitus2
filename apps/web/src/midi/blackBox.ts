/**
 * The piano connection's black box: a short log in the browser's own storage of what the
 * connection did and what the browser said about the piano's ports (opened, reconnected, the ports'
 * state and connection, the first note heard after each open, turned off). It holds no notes and
 * nothing about the reader beyond that, and shows nowhere in the page. When playing along goes
 * deaf on a reader's machine, it says what happened. Storage that cannot be written loses the
 * entry and nothing else.
 */

export const MIDI_LOG_KEY = 'digitus2.midi.log';
/** The entries kept, newest last. */
export const MIDI_LOG_MAX = 300;

export interface MidiLogEntry {
  at: string;
  event: string;
  [key: string]: unknown;
}

export function readMidiLog(): MidiLogEntry[] {
  try {
    const raw = localStorage.getItem(MIDI_LOG_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as MidiLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function midiLog(event: string, data: Record<string, unknown> = {}): void {
  try {
    const list = readMidiLog();
    list.push({ at: new Date().toISOString(), event, ...data });
    localStorage.setItem(MIDI_LOG_KEY, JSON.stringify(list.slice(-MIDI_LOG_MAX)));
  } catch {
    // No storage here (a private window, blocked site data): the entry is lost.
  }
}
