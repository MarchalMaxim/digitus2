import type { NoteMessage } from './types.js';

/** One note message read from the bytes of a MIDI input (issue 182). */
export interface ParsedNote {
  on: boolean;
  /** 0..15 */
  channel: number;
  midi: number;
  /** 1..127 on a note on; 0 on a note off (0x8n, or 0x9n at velocity 0). */
  velocity: number;
}

/**
 * The oldest event time taken, in ms before now (issue 192). A busy main thread can hold a message
 * for tens to hundreds of milliseconds, which is when the event time matters; more than a second
 * means another time base (some backends report 0 or an epoch time).
 */
export const EVENT_MAX_AGE_MS = 1000;

/**
 * The time of a key in performance.now() ms (issue 192): the event's `timeStamp` when it is
 * plausible (finite, positive, not ahead of `nowMs` by more than a millisecond, and at most
 * EVENT_MAX_AGE_MS old), else `nowMs`, the arrival.
 */
export function eventTimeMs(timeStamp: number | undefined, nowMs: number): number {
  if (
    typeof timeStamp === 'number' &&
    Number.isFinite(timeStamp) &&
    timeStamp > 0 &&
    timeStamp <= nowMs + 1 &&
    nowMs - timeStamp <= EVENT_MAX_AGE_MS
  ) {
    return timeStamp;
  }
  return nowMs;
}

/** The first byte of a realtime message; they run from here to 0xFF. */
const REALTIME = 0xf8;
const SYSEX_START = 0xf0;

/** How many data bytes follow a channel status byte (0x80..0xEF). */
function channelDataLength(status: number): number {
  const kind = status & 0xf0;
  return kind === 0xc0 || kind === 0xd0 ? 1 : 2;
}

/**
 * A byte parser for one input (issue 182).
 * - Running status is kept across calls.
 * - Realtime bytes (0xF8..0xFF) are dropped wherever they appear, without touching running status
 *   or a partial message.
 * - SysEx (0xF0 .. 0xF7) is skipped whole, across calls too, and clears running status. Any other
 *   status byte also ends it, so one lost 0xF7 cannot swallow the notes that follow.
 * - System common (0xF1..0xF6) is skipped with its data bytes and clears running status.
 * - Data bytes with no status are ignored.
 * - Channel messages have known lengths: 0x8n, 0x9n, 0xAn, 0xBn and 0xEn take 2 data bytes;
 *   0xCn and 0xDn take 1.
 * - Only note on and note off produce output (velocity 0 is off).
 * - An incomplete message completes on the next call.
 */
export function createMidiParser(): (data: ArrayLike<number>) => ParsedNote[] {
  /** The running status: a channel status byte, or 0 when there is none. */
  let status = 0;
  /** The data bytes of the message being read. */
  const data: number[] = [];
  let inSysex = false;

  return (bytes) => {
    const out: ParsedNote[] = [];
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i]!;
      if (byte >= REALTIME) continue;
      if (byte >= 0x80) {
        // A status byte ends a SysEx and abandons a message that was cut off.
        inSysex = false;
        data.length = 0;
        if (byte === SYSEX_START) {
          inSysex = true;
          status = 0;
        } else if (byte >= 0xf0) {
          // 0xF1..0xF6 and a stray 0xF7: system common. Their data bytes arrive with no running
          // status and fall away below.
          status = 0;
        } else {
          status = byte;
        }
        continue;
      }
      if (inSysex || status === 0) continue;
      data.push(byte);
      if (data.length < channelDataLength(status)) continue;
      const kind = status & 0xf0;
      const midi = data[0]!;
      const velocity = data[1]!;
      data.length = 0;
      if (kind === 0x90) out.push({ on: velocity > 0, channel: status & 0x0f, midi, velocity });
      else if (kind === 0x80) out.push({ on: false, channel: status & 0x0f, midi, velocity: 0 });
    }
    return out;
  };
}

/** A note-off, with the key's time when there is one (issue 192). */
function off(midi: number, atMs: number | undefined): NoteMessage {
  return atMs === undefined ? { on: false, midi } : { on: false, midi, atMs };
}

/** Keys held per input and channel; a pitch is held while any of them holds it. */
export class HeldKeys {
  /** Each held pitch with the holds on it, as `channel:inputId` (so one hold per input and channel). */
  private readonly holds = new Map<number, Set<string>>();
  private cache: readonly number[] = [];

  /**
   * A note from `inputId`: the merged message to report, or null (an off for a key still held
   * elsewhere, or not down). A note-on always reports `on`, also when already held. Given the
   * key's time `atMs` (issue 192), the message carries it, and a note-on its velocity too; without
   * it the message is `{ on, midi }` alone.
   */
  apply(inputId: string, n: ParsedNote, atMs?: number): NoteMessage | null {
    const hold = `${n.channel}:${inputId}`;
    if (n.on) {
      const set = this.holds.get(n.midi);
      if (set) set.add(hold);
      else {
        this.holds.set(n.midi, new Set([hold]));
        this.changed();
      }
      if (atMs === undefined) return { on: true, midi: n.midi };
      return { on: true, midi: n.midi, atMs, ...(n.velocity > 0 ? { velocity: n.velocity } : {}) };
    }
    const set = this.holds.get(n.midi);
    if (!set || !set.delete(hold)) return null;
    if (set.size > 0) return null;
    this.holds.delete(n.midi);
    this.changed();
    return off(n.midi, atMs);
  }

  /** That input went away: the note-offs of the pitches no longer held, at `atMs` when given. */
  dropInput(inputId: string, atMs?: number): NoteMessage[] {
    const offs: NoteMessage[] = [];
    for (const [midi, set] of this.holds) {
      for (const hold of set) {
        if (hold.slice(hold.indexOf(':') + 1) === inputId) set.delete(hold);
      }
      if (set.size === 0) {
        this.holds.delete(midi);
        offs.push(off(midi, atMs));
      }
    }
    if (offs.length === 0) return offs;
    offs.sort((a, b) => a.midi - b.midi);
    this.changed();
    return offs;
  }

  /** Turned off: a note-off for every held pitch, at `atMs` when given. */
  clear(atMs?: number): NoteMessage[] {
    const offs = this.cache.map((midi) => off(midi, atMs));
    this.holds.clear();
    if (offs.length > 0) this.changed();
    return offs;
  }

  /** The held pitches, ascending; the same array until they change. */
  held(): readonly number[] {
    return this.cache;
  }

  /** The set of held pitches changed: the next `held()` is a new array. */
  private changed(): void {
    this.cache = [...this.holds.keys()].sort((a, b) => a - b);
  }
}
