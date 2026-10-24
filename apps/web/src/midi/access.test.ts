// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openMidiAccess } from './access.js';
import type { AccessEvents, AccessRefusal, NoteMessage } from './types.js';

/** `performance.now()` while a test runs: every message without a usable event time gets it. */
let now: number;
const NOW = 20_000;

/** A MIDIInput as the browser keeps it: it stays in the map when the piano is unplugged. */
class FakeInput {
  connection: 'open' | 'closed' = 'closed';
  onmidimessage: ((e: { data: Uint8Array | null; timeStamp?: number }) => void) | null = null;
  closed = 0;
  constructor(
    readonly id: string,
    readonly name: string | null,
    public state: 'connected' | 'disconnected' = 'connected',
  ) {}
  close(): Promise<FakeInput> {
    this.closed++;
    return Promise.resolve(this);
  }
  /** Sends bytes the way the browser does: to whatever handler is set now. */
  send(...bytes: number[]): void {
    this.onmidimessage?.({ data: new Uint8Array(bytes) });
  }
  /** `send`, with the event's `timeStamp` (performance.now() ms of the key). */
  sendAt(timeStamp: number, ...bytes: number[]): void {
    this.onmidimessage?.({ data: new Uint8Array(bytes), timeStamp });
  }
}

/** The merged note-on the access reports when the message carries no usable time. */
const keyOn = (midi: number, velocity: number): NoteMessage => ({
  on: true,
  midi,
  atMs: NOW,
  velocity,
});
const keyOff = (midi: number): NoteMessage => ({ on: false, midi, atMs: NOW });

class FakeAccess {
  readonly inputs = new Map<string, FakeInput>();
  onstatechange: (() => void) | null = null;
  constructor(...inputs: FakeInput[]) {
    for (const input of inputs) this.inputs.set(input.id, input);
  }
  /** A piano plugged in (or switched on) after the access was granted. */
  plug(input: FakeInput): void {
    input.state = 'connected';
    this.inputs.set(input.id, input);
    this.onstatechange?.();
  }
  /** Chrome keeps the port in the map and marks it disconnected. */
  unplug(id: string): void {
    this.inputs.get(id)!.state = 'disconnected';
    this.onstatechange?.();
  }
  /** Some browsers drop the port from the map instead. */
  remove(id: string): void {
    this.inputs.delete(id);
    this.onstatechange?.();
  }
}

interface Recorder extends AccessEvents {
  names: string[][];
  notes: Array<[NoteMessage, readonly number[]]>;
}

function recorder(): Recorder {
  const names: string[][] = [];
  const notes: Array<[NoteMessage, readonly number[]]> = [];
  return {
    names,
    notes,
    inputs: (n) => names.push([...n]),
    note: (e, held) => notes.push([e, held]),
  };
}

const asAccess = (a: FakeAccess) => Promise.resolve(a as unknown as MIDIAccess);

async function open(access: FakeAccess, events: AccessEvents = recorder()) {
  const request = vi.fn((_opts: { sysex: false }) => asAccess(access));
  const opened = await openMidiAccess(events, { request, queryPermission: async () => 'prompt' });
  return { opened, request };
}

const piano = () => new FakeInput('p1', 'GO:PIANO MIDI 1');

beforeEach(() => {
  now = NOW;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('openMidiAccess', () => {
  it('asks the browser for access without SysEx', async () => {
    const { request } = await open(new FakeAccess(piano()));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ sysex: false });
  });

  it('reports the names of the connected inputs once, before it resolves', async () => {
    const events = recorder();
    const access = new FakeAccess(piano(), new FakeInput('p2', 'Other keys'));
    const reported = vi.fn();
    const pending = openMidiAccess(events, {
      request: () => asAccess(access),
      queryPermission: async () => 'prompt',
    }).then((o) => {
      reported(events.names.length);
      return o;
    });
    await pending;
    expect(events.names).toEqual([['GO:PIANO MIDI 1', 'Other keys']]);
    expect(reported).toHaveBeenCalledWith(1);
  });

  it('reports an empty list when no input is connected', async () => {
    const events = recorder();
    await open(new FakeAccess(), events);
    expect(events.names).toEqual([[]]);
  });

  it('leaves Midi Through out, and an input that is not connected', async () => {
    const events = recorder();
    const access = new FakeAccess(
      new FakeInput('t0', 'Midi Through Port-0'),
      new FakeInput('t1', 'MIDI THROUGH:Midi Through Port-0 14:0'),
      new FakeInput('g', 'Gone', 'disconnected'),
      piano(),
    );
    await open(access, events);
    expect(events.names).toEqual([['GO:PIANO MIDI 1']]);
    // A piano whose name only starts like a through port word is kept.
    const throughput = new FakeAccess(new FakeInput('x', 'Midi Throughput Deluxe'));
    const other = recorder();
    await open(throughput, other);
    expect(other.names).toEqual([['Midi Throughput Deluxe']]);
  });

  it('gives an input with no name an empty name', async () => {
    const events = recorder();
    await open(new FakeAccess(new FakeInput('n', null)), events);
    expect(events.names).toEqual([['']]);
  });

  it('turns a note on into one note event, with the pitches held after it', async () => {
    const events = recorder();
    const input = piano();
    await open(new FakeAccess(input), events);
    input.send(0x90, 60, 100);
    expect(events.notes).toEqual([[keyOn(60, 100), [60]]]);
    input.send(0x90, 64, 90);
    expect(events.notes[1]).toEqual([keyOn(64, 90), [60, 64]]);
    input.send(0x80, 60, 0);
    expect(events.notes[2]).toEqual([keyOff(60), [64]]);
  });

  describe('the time of a key (issue 192)', () => {
    it("takes the event's timeStamp when it is plausible", async () => {
      const events = recorder();
      const input = piano();
      await open(new FakeAccess(input), events);
      now = 1010;
      input.sendAt(1000, 0x90, 60, 100);
      input.sendAt(1005, 0x80, 60, 0);
      expect(events.notes).toEqual([
        [{ on: true, midi: 60, atMs: 1000, velocity: 100 }, [60]],
        [{ on: false, midi: 60, atMs: 1005 }, []],
      ]);
    });

    it('takes the arrival time when the event has no timeStamp, or 0', async () => {
      const events = recorder();
      const input = piano();
      await open(new FakeAccess(input), events);
      now = 1010;
      input.send(0x90, 60, 100);
      input.sendAt(0, 0x90, 64, 80);
      expect(events.notes.map(([e]) => e.atMs)).toEqual([1010, 1010]);
    });

    it('gives every note of one message the same time', async () => {
      const events = recorder();
      const input = piano();
      await open(new FakeAccess(input), events);
      now = 3000;
      input.sendAt(2990, 0x90, 60, 100, 64, 90, 67, 80);
      expect(events.notes.map(([e]) => [e.midi, e.atMs, e.velocity])).toEqual([
        [60, 2990, 100],
        [64, 2990, 90],
        [67, 2990, 80],
      ]);
    });
  });

  it('reads running status, a velocity 0 off and active sensing', async () => {
    const events = recorder();
    const input = piano();
    await open(new FakeAccess(input), events);
    input.send(0xfe);
    input.send(0x90, 60, 100, 0xfe, 62, 100);
    input.send(0xfe);
    input.send(60, 0, 62, 0);
    expect(events.notes.map(([e]) => [e.on, e.midi])).toEqual([
      [true, 60],
      [true, 62],
      [false, 60],
      [false, 62],
    ]);
  });

  it('merges channels and inputs: a pitch is held while any of them holds it', async () => {
    const events = recorder();
    const a = new FakeInput('a', 'A');
    const b = new FakeInput('b', 'B');
    await open(new FakeAccess(a, b), events);
    a.send(0x90, 60, 90);
    a.send(0x91, 60, 90);
    b.send(0x90, 60, 90);
    a.send(0x80, 60, 0);
    a.send(0x81, 60, 0);
    b.send(0x80, 60, 0);
    // Three note-ons are reported as they come; the one note-off comes when the last lets go.
    expect(events.notes.map(([e]) => e.on)).toEqual([true, true, true, false]);
    expect(events.notes[3]![1]).toEqual([]);
  });

  it('ignores a message with no data', async () => {
    const events = recorder();
    const input = piano();
    await open(new FakeAccess(input), events);
    input.onmidimessage!({ data: null });
    expect(events.notes).toEqual([]);
  });

  it('attaches an input plugged in later and reports it', async () => {
    const events = recorder();
    const access = new FakeAccess();
    await open(access, events);
    const input = piano();
    access.plug(input);
    expect(events.names).toEqual([[], ['GO:PIANO MIDI 1']]);
    input.send(0x90, 67, 80);
    expect(events.notes).toEqual([[keyOn(67, 80), [67]]]);
  });

  it('does not report Midi Through plugged in later', async () => {
    const events = recorder();
    const access = new FakeAccess(piano());
    await open(access, events);
    const through = new FakeInput('t', 'Midi Through Port-0');
    access.plug(through);
    expect(events.names).toEqual([['GO:PIANO MIDI 1']]);
    expect(through.onmidimessage).toBeNull();
  });

  it('does not report again when the state changes but the inputs do not', async () => {
    const events = recorder();
    const access = new FakeAccess(piano());
    await open(access, events);
    // A port opening fires a state change with the same inputs.
    access.onstatechange!();
    access.onstatechange!();
    expect(events.names).toEqual([['GO:PIANO MIDI 1']]);
  });

  it('keeps one handler per input however often the state changes', async () => {
    const events = recorder();
    const input = piano();
    const access = new FakeAccess(input);
    await open(access, events);
    const handler = input.onmidimessage;
    access.onstatechange!();
    expect(input.onmidimessage).toBe(handler);
    input.send(0x90, 60, 90);
    expect(events.notes).toHaveLength(1);
  });

  it('detaches an input that is unplugged and releases its keys', async () => {
    const events = recorder();
    const input = piano();
    const access = new FakeAccess(input);
    await open(access, events);
    input.send(0x90, 60, 90);
    input.send(0x90, 64, 90);
    events.notes.length = 0;
    now = NOW + 500;
    access.unplug('p1');
    expect(input.onmidimessage).toBeNull();
    // The offs carry the time the port went away.
    expect(events.notes).toEqual([
      [{ on: false, midi: 60, atMs: NOW + 500 }, [64]],
      [{ on: false, midi: 64, atMs: NOW + 500 }, []],
    ]);
    expect(events.names).toEqual([['GO:PIANO MIDI 1'], []]);
  });

  it('keeps the other input pitches when one input goes away', async () => {
    const events = recorder();
    const a = new FakeInput('a', 'A');
    const b = new FakeInput('b', 'B');
    const access = new FakeAccess(a, b);
    await open(access, events);
    a.send(0x90, 60, 90);
    b.send(0x90, 60, 90);
    b.send(0x90, 62, 90);
    events.notes.length = 0;
    access.unplug('b');
    // 60 is still held by a; only 62 is released.
    expect(events.notes).toEqual([[keyOff(62), [60]]]);
    expect(events.names.at(-1)).toEqual(['A']);
  });

  it('detaches an input a browser drops from the map', async () => {
    const events = recorder();
    const input = piano();
    const access = new FakeAccess(input);
    await open(access, events);
    input.send(0x90, 60, 90);
    events.notes.length = 0;
    access.remove('p1');
    expect(input.onmidimessage).toBeNull();
    expect(events.notes).toEqual([[keyOff(60), []]]);
    expect(events.names.at(-1)).toEqual([]);
  });

  it('attaches a piano again when it comes back, with a fresh parser', async () => {
    const events = recorder();
    const input = piano();
    const access = new FakeAccess(input);
    await open(access, events);
    // A message cut off by the unplug must not complete after the replug.
    input.send(0x90, 60);
    access.unplug('p1');
    access.plug(input);
    expect(input.onmidimessage).not.toBeNull();
    input.send(64, 90);
    expect(events.notes).toEqual([]);
    input.send(0x90, 64, 90);
    expect(events.notes).toEqual([[keyOn(64, 90), [64]]]);
    expect(events.names).toEqual([['GO:PIANO MIDI 1'], [], ['GO:PIANO MIDI 1']]);
  });

  it('close detaches every handler and the state change, and closes the ports', async () => {
    const events = recorder();
    const a = new FakeInput('a', 'A');
    const b = new FakeInput('b', 'B');
    const access = new FakeAccess(a, b);
    const { opened } = await open(access, events);
    const handler = a.onmidimessage!;
    opened.close();
    expect(a.onmidimessage).toBeNull();
    expect(b.onmidimessage).toBeNull();
    expect(access.onstatechange).toBeNull();
    expect(a.closed).toBe(1);
    expect(b.closed).toBe(1);
    // A message already on its way to the old handler is ignored.
    handler({ data: new Uint8Array([0x90, 60, 90]) });
    expect(events.notes).toEqual([]);
  });

  it('ignores a plug after close', async () => {
    const events = recorder();
    const access = new FakeAccess();
    const { opened } = await open(access, events);
    const onstatechange = access.onstatechange!;
    opened.close();
    access.inputs.set('p1', piano());
    onstatechange();
    expect(events.names).toEqual([[]]);
    expect(access.inputs.get('p1')!.onmidimessage).toBeNull();
  });

  it('closes twice without trouble, and survives a port that refuses to close', async () => {
    const input = piano();
    input.close = () => Promise.reject(new Error('already gone'));
    const { opened } = await open(new FakeAccess(input));
    expect(() => {
      opened.close();
      opened.close();
    }).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  describe('when the browser refuses', () => {
    const refuse = async (permission: () => Promise<PermissionState>): Promise<AccessRefusal> => {
      const events = recorder();
      try {
        await openMidiAccess(events, {
          request: () => Promise.reject(new Error('SecurityError')),
          queryPermission: permission,
        });
      } catch (e) {
        expect(events.names).toEqual([]);
        return e as AccessRefusal;
      }
      throw new Error('opened');
    };

    it("rejects with 'denied' when the permission now says denied", async () => {
      expect(await refuse(async () => 'denied')).toBe('denied');
    });

    it("rejects with 'dismissed' when it says prompt or granted", async () => {
      expect(await refuse(async () => 'prompt')).toBe('dismissed');
      expect(await refuse(async () => 'granted')).toBe('dismissed');
    });

    it("rejects with 'dismissed' when the permission query itself throws", async () => {
      expect(
        await refuse(() => {
          throw new Error('no midi permission name');
        }),
      ).toBe('dismissed');
      expect(await refuse(() => Promise.reject(new TypeError('unknown name')))).toBe('dismissed');
    });
  });

  describe('with the browser itself', () => {
    it('requests access and queries the permission through navigator', async () => {
      const access = new FakeAccess(piano());
      const requestMIDIAccess = vi.fn((_opts: { sysex: false }) => asAccess(access));
      vi.stubGlobal('navigator', { requestMIDIAccess });
      const events = recorder();
      const opened = await openMidiAccess(events);
      expect(requestMIDIAccess).toHaveBeenCalledWith({ sysex: false });
      expect(events.names).toEqual([['GO:PIANO MIDI 1']]);
      opened.close();
    });

    it("reads the 'midi' permission when the request is rejected", async () => {
      const query = vi.fn(async (_d: { name: string }) => ({ state: 'denied' }));
      vi.stubGlobal('navigator', {
        requestMIDIAccess: () => Promise.reject(new Error('blocked')),
        permissions: { query },
      });
      await expect(openMidiAccess(recorder())).rejects.toBe('denied');
      expect(query).toHaveBeenCalledWith({ name: 'midi' });
    });

    it("rejects with 'dismissed' when the browser has no Web MIDI or no permissions API", async () => {
      vi.stubGlobal('navigator', {});
      await expect(openMidiAccess(recorder())).rejects.toBe('dismissed');
    });
  });
});
