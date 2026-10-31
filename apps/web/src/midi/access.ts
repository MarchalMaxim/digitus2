// The lazy chunk (with parse.ts): reached only through `import('./access.js')` from piano.ts.
import { createMidiParser, eventTimeMs, HeldKeys } from './parse.js';
import type { AccessEvents, AccessRefusal, OpenedAccess, PortReport } from './types.js';

export interface OpenOptions {
  /** Default `(o) => navigator.requestMIDIAccess(o)`. */
  request?: (opts: { sysex: false }) => Promise<MIDIAccess>;
  /** Default `navigator.permissions.query({ name: 'midi' })`, guarded. */
  queryPermission?: () => Promise<PermissionState>;
}

/** Linux lists a loopback port as an input; it is not a piano. */
const MIDI_THROUGH = /^midi through\b/i;

async function queryMidiPermission(): Promise<PermissionState> {
  const status = await navigator.permissions.query({ name: 'midi' as PermissionName });
  return status.state;
}

/** One attached input: the port, and the parser that keeps its running status. */
interface Attached {
  input: MIDIInput;
  parse: ReturnType<typeof createMidiParser>;
}

/**
 * Calls `request({ sysex: false })`, attaches to every connected input but Midi Through, and
 * follows `onstatechange`. Resolves the connection, or rejects with an `AccessRefusal` string.
 *
 * `events.inputs` is called once before the promise resolves, then whenever the connected
 * inputs' names change. `events.heard` is called for every message an attached input sends. `events.note` is called for every merged note, each after the held
 * pitches were updated; the offs of an input that goes away follow one by one, each with the
 * pitches still held at that point. `close()` stops all events and does not report offs: the
 * keys still down are the caller's to release.
 */
export async function openMidiAccess(
  events: AccessEvents,
  opts: OpenOptions = {},
): Promise<OpenedAccess> {
  const request = opts.request ?? ((o) => navigator.requestMIDIAccess(o));
  const queryPermission = opts.queryPermission ?? queryMidiPermission;

  let access: MIDIAccess;
  try {
    access = await request({ sysex: false });
  } catch {
    let state: PermissionState = 'prompt';
    try {
      state = await queryPermission();
    } catch {
      // A browser without a 'midi' permission name: the refusal was a dismissal.
    }
    const refusal: AccessRefusal = state === 'denied' ? 'denied' : 'dismissed';
    throw refusal;
  }

  const held = new HeldKeys();
  const attached = new Map<string, Attached>();
  let closed = false;
  /** The names last reported, as one string; null before the first report. */
  let reported: string | null = null;

  /** The inputs that are connected now, Midi Through left out, in MIDIAccess order. */
  function connectedInputs(): MIDIInput[] {
    const found: MIDIInput[] = [];
    access.inputs.forEach((input) => {
      if (input.state === 'connected' && !MIDI_THROUGH.test(input.name ?? '')) found.push(input);
    });
    return found;
  }

  function attach(input: MIDIInput): void {
    const entry: Attached = { input, parse: createMidiParser() };
    attached.set(input.id, entry);
    // By property assignment: assigning again would replace the handler, never add a second.
    input.onmidimessage = (e) => {
      if (closed || !e.data || attached.get(input.id) !== entry) return;
      events.heard?.();
      // The key's time (issue 192): the event's, read once for every note in the message.
      const atMs = eventTimeMs(e.timeStamp, performance.now());
      for (const n of entry.parse(e.data)) {
        const message = held.apply(input.id, n, atMs);
        if (message) events.note(message, held.held());
      }
    };
  }

  function detachHandler(input: MIDIInput): void {
    input.onmidimessage = null;
  }

  /** Reports the offs of an input that went away, each with the pitches still held after it. */
  function release(id: string): void {
    const offs = held.dropInput(id, performance.now());
    const still = held.held();
    offs.forEach((off, i) => {
      const rest = offs.slice(i + 1).map((o) => o.midi);
      events.note(off, rest.length === 0 ? still : [...still, ...rest].sort((a, b) => a - b));
    });
  }

  function sync(): void {
    if (closed) return;
    const now = connectedInputs();
    const present = new Map(now.map((input) => [input.id, input]));
    for (const [id, entry] of attached) {
      const current = present.get(id);
      if (current === entry.input) continue;
      // The port left, or came back as another object under the same id.
      detachHandler(entry.input);
      attached.delete(id);
      release(id);
    }
    // A listener may have closed the access while it was told of the offs.
    if (closed) return;
    for (const input of now) if (!attached.has(input.id)) attach(input);
    if (events.ports) {
      const ports: PortReport[] = [];
      access.inputs.forEach((input) =>
        ports.push({
          id: input.id,
          name: input.name ?? '',
          state: input.state,
          connection: input.connection,
        }),
      );
      events.ports(ports);
    }
    const names = now.map((input) => input.name ?? '');
    const key = JSON.stringify(names);
    if (key === reported) return;
    reported = key;
    events.inputs(names);
  }

  access.onstatechange = sync;
  sync();

  return {
    close(): void {
      if (closed) return;
      closed = true;
      access.onstatechange = null;
      for (const { input } of attached.values()) {
        detachHandler(input);
        try {
          // close() answers with a promise that may reject; a port that is gone is already closed.
          void Promise.resolve(input.close()).catch(() => {});
        } catch {
          // Closing is best effort.
        }
      }
      attached.clear();
    },
  };
}
