import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import {
  askForPiano,
  bluetoothFlag,
  heldPitches,
  midiPermission,
  midiSupported,
  HEAL_FIRST_MS,
  HEAL_MAX_MS,
  pianoSnapshot,
  reconnectPiano,
  resetPianoForTests,
  resumePiano,
  SEARCHING_AFTER_MS,
  subscribeNotes,
  turnOffPiano,
  useHeldPitches,
  usePianoHealer,
  usePianoSnapshot,
} from './piano.js';
import { MIDI_LOG_MAX, midiLog, readMidiLog } from './blackBox.js';
import type { AccessEvents, NoteMessage, OpenedAccess } from './types.js';

// The lazy chunk (access.ts, with parse.ts) is replaced by a fake that the tests drive; the
// factory runs once per module registry, so `access.imports` counts the times it was reached.
const access = vi.hoisted(() => ({
  imports: 0,
  open: vi.fn<(events: AccessEvents) => Promise<OpenedAccess>>(),
}));
vi.mock('./access.js', () => {
  access.imports++;
  return { openMidiAccess: (events: AccessEvents) => access.open(events) };
});

const settings = () => useAppStore.getState().settings;
const status = () => pianoSnapshot().status;

function setNavigator(name: string, value: unknown): void {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
}
function clearNavigator(name: string): void {
  delete (navigator as unknown as Record<string, unknown>)[name];
}
/** What `navigator.permissions.query({ name: 'midi' })` answers. */
function permission(state: PermissionState | 'throws'): void {
  setNavigator('permissions', {
    query:
      state === 'throws'
        ? () => Promise.reject(new TypeError('midi'))
        : () => Promise.resolve({ state }),
  });
}

/** A fake access module: remembers the events it was given and what it was told to close. */
function connectWith(...names: string[]) {
  const link = { events: null as AccessEvents | null, closes: 0 };
  access.open.mockImplementation((events) => {
    link.events = events;
    events.inputs(names);
    return Promise.resolve({
      close: () => {
        link.closes++;
      },
    });
  });
  return link;
}
function deferredOpen() {
  const link = { events: null as AccessEvents | null, closes: 0 };
  let resolve!: (opened: OpenedAccess) => void;
  let reject!: (reason: unknown) => void;
  access.open.mockImplementation((events) => {
    link.events = events;
    return new Promise<OpenedAccess>((yes, no) => {
      resolve = yes;
      reject = no;
    });
  });
  const opened: OpenedAccess = {
    close: () => {
      link.closes++;
    },
  };
  return { link, opened, resolve: (o = opened) => resolve(o), reject: (r: unknown) => reject(r) };
}

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  access.open.mockReset();
  resetPianoForTests();
  setNavigator('requestMIDIAccess', () => Promise.reject(new Error('the store never calls this')));
  permission('prompt');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  clearNavigator('requestMIDIAccess');
  clearNavigator('permissions');
  resetPianoForTests();
});

describe('what the browser has', () => {
  it('has no Web MIDI without requestMIDIAccess', () => {
    expect(midiSupported({} as Navigator)).toBe(false);
    expect(midiSupported({ requestMIDIAccess: 'yes' } as unknown as Navigator)).toBe(false);
    expect(midiSupported({ requestMIDIAccess: () => {} } as unknown as Navigator)).toBe(true);
  });
  it('starts unsupported without the API, and off with it', () => {
    clearNavigator('requestMIDIAccess');
    resetPianoForTests();
    expect(pianoSnapshot()).toEqual({ status: 'unsupported', names: [] });
    setNavigator('requestMIDIAccess', () => Promise.resolve());
    resetPianoForTests();
    expect(pianoSnapshot()).toEqual({ status: 'off', names: [] });
  });
  it('asks nothing of a browser without the API', async () => {
    clearNavigator('requestMIDIAccess');
    resetPianoForTests();
    await askForPiano();
    expect(status()).toBe('unsupported');
    expect(access.open).not.toHaveBeenCalled();
  });
  it('answers the permission as the query says, and prompt when it cannot ask', async () => {
    const answer = (state: unknown) =>
      midiPermission({
        permissions: { query: () => Promise.resolve({ state }) },
      } as unknown as Navigator);
    expect(await answer('granted')).toBe('granted');
    expect(await answer('denied')).toBe('denied');
    expect(await answer('prompt')).toBe('prompt');
    expect(await answer('something else')).toBe('prompt');
    const throwing = {
      permissions: {
        query: () => {
          throw new TypeError('not a permission name');
        },
      },
    } as unknown as Navigator;
    expect(await midiPermission(throwing)).toBe('prompt');
    const rejecting = {
      permissions: { query: () => Promise.reject(new TypeError('midi')) },
    } as unknown as Navigator;
    expect(await midiPermission(rejecting)).toBe('prompt');
    expect(await midiPermission({} as Navigator)).toBe('prompt');
  });
});

describe('the press', () => {
  it('goes through asking to connected, and sets the setting only once access resolved', async () => {
    const open = deferredOpen();
    const pressed = askForPiano();
    expect(status()).toBe('asking');
    expect(settings().playAlong).toBe(false);
    await vi.waitFor(() => expect(access.open).toHaveBeenCalledTimes(1));
    open.link.events!.inputs(['GO:PIANO MIDI 1']);
    open.resolve();
    await pressed;
    expect(pianoSnapshot()).toEqual({ status: 'connected', names: ['GO:PIANO MIDI 1'] });
    expect(settings().playAlong).toBe(true);
    expect(JSON.parse(localStorage.getItem('digitus2.settings.v1')!).state.settings.playAlong).toBe(
      true,
    );
  });
  it('shares one request between presses', async () => {
    const open = deferredOpen();
    const first = askForPiano();
    const second = askForPiano();
    await vi.waitFor(() => expect(access.open).toHaveBeenCalledTimes(1));
    open.link.events!.inputs(['A']);
    open.resolve();
    await Promise.all([first, second]);
    expect(access.open).toHaveBeenCalledTimes(1);
    await askForPiano();
    expect(access.open).toHaveBeenCalledTimes(1);
  });
  it('is connected as soon as access resolved even when no input list came', async () => {
    const link = { closes: 0 };
    access.open.mockResolvedValue({ close: () => void link.closes++ });
    await askForPiano();
    expect(pianoSnapshot()).toEqual({ status: 'none', names: [] });
    expect(settings().playAlong).toBe(true);
  });
  it('moves between connected and none as pianos come and go, with no reload', async () => {
    const link = connectWith('GO:PIANO MIDI 1');
    await askForPiano();
    expect(status()).toBe('connected');
    link.events!.inputs([]);
    expect(pianoSnapshot()).toEqual({ status: 'none', names: [] });
    link.events!.inputs(['Yamaha P-45', 'Other']);
    expect(pianoSnapshot()).toEqual({ status: 'connected', names: ['Yamaha P-45', 'Other'] });
    expect(settings().playAlong).toBe(true);
  });
  it('keeps the same snapshot while nothing changed', async () => {
    const link = connectWith('A');
    await askForPiano();
    const before = pianoSnapshot();
    link.events!.inputs(['A']);
    expect(pianoSnapshot()).toBe(before);
  });
  it('leaves off after a dismissal, and keeps the setting off', async () => {
    access.open.mockRejectedValue('dismissed');
    await askForPiano();
    expect(pianoSnapshot()).toEqual({ status: 'off', names: [] });
    expect(settings().playAlong).toBe(false);
  });
  it('turns a stored setting off after a dismissal, as after a denial', async () => {
    // The permission went back to `prompt` (the reader reset it) while the setting stayed on.
    useAppStore.getState().setSettings({ playAlong: true });
    access.open.mockRejectedValue('dismissed');
    await askForPiano();
    expect(pianoSnapshot()).toEqual({ status: 'off', names: [] });
    expect(settings().playAlong).toBe(false);
  });
  it('shows denied after a refusal, and turns a stored setting off', async () => {
    useAppStore.getState().setSettings({ playAlong: true });
    access.open.mockRejectedValue('denied');
    await askForPiano();
    expect(pianoSnapshot()).toEqual({ status: 'denied', names: [] });
    expect(settings().playAlong).toBe(false);
  });
  it('can be pressed again after a denial', async () => {
    access.open.mockRejectedValueOnce('denied');
    await askForPiano();
    expect(status()).toBe('denied');
    connectWith('A');
    await askForPiano();
    expect(status()).toBe('connected');
  });
  it('goes back to off when the access chunk cannot be fetched, leaving the setting alone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useAppStore.getState().setSettings({ playAlong: true });
    access.open.mockRejectedValue(new TypeError('Failed to fetch dynamically imported module'));
    await askForPiano();
    expect(status()).toBe('off');
    expect(settings().playAlong).toBe(true);
  });
});

describe('the keys', () => {
  it('holds what the access says is held, and tells every listener each note, in order', async () => {
    const link = connectWith('A');
    await askForPiano();
    const heard: NoteMessage[] = [];
    const held: (readonly number[])[] = [];
    const stop = subscribeNotes((e) => {
      heard.push(e);
      held.push(heldPitches());
    });
    expect(heldPitches()).toEqual([]);
    link.events!.note({ on: true, midi: 60 }, [60]);
    link.events!.note({ on: true, midi: 64 }, [60, 64]);
    link.events!.note({ on: false, midi: 60 }, [64]);
    expect(heard).toEqual([
      { on: true, midi: 60 },
      { on: true, midi: 64 },
      { on: false, midi: 60 },
    ]);
    // The held pitches are already updated when a listener hears the note.
    expect(held).toEqual([[60], [60, 64], [64]]);
    stop();
    link.events!.note({ on: false, midi: 64 }, []);
    expect(heard).toHaveLength(3);
    expect(heldPitches()).toEqual([]);
  });
  it('tells a second note-on of a held key and keeps the same held array', async () => {
    const link = connectWith('A');
    await askForPiano();
    const heard: NoteMessage[] = [];
    subscribeNotes((e) => void heard.push(e));
    const keys = [60] as const;
    link.events!.note({ on: true, midi: 60 }, keys);
    const first = heldPitches();
    link.events!.note({ on: true, midi: 60 }, keys);
    expect(heldPitches()).toBe(first);
    expect(heard).toHaveLength(2);
  });
  it('keeps hearing the other listeners when one throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const link = connectWith('A');
    await askForPiano();
    const heard: NoteMessage[] = [];
    subscribeNotes(() => {
      throw new Error('a listener');
    });
    subscribeNotes((e) => void heard.push(e));
    link.events!.note({ on: true, midi: 60 }, [60]);
    expect(heard).toEqual([{ on: true, midi: 60 }]);
  });
  it('re-renders a reader of the held pitches on a change only', async () => {
    const link = connectWith('A');
    await askForPiano();
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useHeldPitches();
    });
    expect(result.current).toEqual([]);
    const initial = renders;
    act(() => link.events!.note({ on: true, midi: 62 }, [62]));
    expect(result.current).toEqual([62]);
    const afterOne = renders;
    expect(afterOne).toBeGreaterThan(initial);
    // The same pitches in a new array are no change.
    act(() => link.events!.note({ on: true, midi: 62 }, [62]));
    expect(renders).toBe(afterOne);
    act(() => link.events!.note({ on: false, midi: 62 }, []));
    expect(result.current).toEqual([]);
  });
  it('releases the keys of a piano that left, when the access had not', async () => {
    const link = connectWith('A');
    await askForPiano();
    link.events!.note({ on: true, midi: 60 }, [60]);
    const heard: NoteMessage[] = [];
    subscribeNotes((e) => void heard.push(e));
    link.events!.inputs([]);
    expect(status()).toBe('none');
    expect(heldPitches()).toEqual([]);
    expect(heard).toEqual([{ on: false, midi: 60, lost: true }]);
  });
  it("marks only the note-offs it makes itself as lost (issue 185): the reader's own are plain", async () => {
    const link = connectWith('A');
    await askForPiano();
    link.events!.note({ on: true, midi: 60 }, [60]);
    link.events!.note({ on: true, midi: 64 }, [60, 64]);
    const heard: NoteMessage[] = [];
    subscribeNotes((e) => void heard.push(e));
    link.events!.note({ on: false, midi: 60 }, [64]);
    link.events!.inputs([]);
    expect(heard).toEqual([
      { on: false, midi: 60 },
      { on: false, midi: 64, lost: true },
    ]);
  });
});

describe('Turn off', () => {
  it('closes the access, releases the keys with their note-offs and clears the setting', async () => {
    const link = connectWith('A');
    await askForPiano();
    link.events!.note({ on: true, midi: 60 }, [60]);
    link.events!.note({ on: true, midi: 67 }, [60, 67]);
    const heard: NoteMessage[] = [];
    subscribeNotes((e) => void heard.push(e));
    turnOffPiano();
    expect(link.closes).toBe(1);
    expect(heard).toEqual([
      { on: false, midi: 60, lost: true },
      { on: false, midi: 67, lost: true },
    ]);
    expect(heldPitches()).toEqual([]);
    expect(pianoSnapshot()).toEqual({ status: 'off', names: [] });
    expect(settings().playAlong).toBe(false);
  });
  it('ignores the old access afterwards', async () => {
    const link = connectWith('A');
    await askForPiano();
    turnOffPiano();
    const heard: NoteMessage[] = [];
    subscribeNotes((e) => void heard.push(e));
    link.events!.note({ on: true, midi: 60 }, [60]);
    link.events!.inputs(['A']);
    expect(heard).toEqual([]);
    expect(heldPitches()).toEqual([]);
    expect(status()).toBe('off');
  });
  it('turns off once even when the access also reports the offs on close', async () => {
    const link = connectWith('A');
    access.open.mockImplementation((events) => {
      link.events = events;
      events.inputs(['A']);
      return Promise.resolve({ close: () => events.note({ on: false, midi: 60 }, []) });
    });
    await askForPiano();
    link.events!.note({ on: true, midi: 60 }, [60]);
    const heard: NoteMessage[] = [];
    subscribeNotes((e) => void heard.push(e));
    turnOffPiano();
    expect(heard).toEqual([{ on: false, midi: 60, lost: true }]);
  });
  it('discards an access that was still being asked for', async () => {
    const open = deferredOpen();
    const pressed = askForPiano();
    await vi.waitFor(() => expect(access.open).toHaveBeenCalledTimes(1));
    turnOffPiano();
    expect(status()).toBe('off');
    open.resolve();
    await pressed;
    expect(open.link.closes).toBe(1);
    expect(status()).toBe('off');
    expect(settings().playAlong).toBe(false);
  });
  it('lets a press after it open a new access', async () => {
    connectWith('A');
    await askForPiano();
    turnOffPiano();
    const link = connectWith('B');
    await askForPiano();
    expect(pianoSnapshot()).toEqual({ status: 'connected', names: ['B'] });
    expect(link.closes).toBe(0);
    expect(access.open).toHaveBeenCalledTimes(2);
  });
});

describe('a later visit', () => {
  /**
   * A page of its own: the modules are reset and the lazy chunk is mocked anew, so `access.imports`
   * counts whether this page reached it at all.
   */
  async function freshPage() {
    vi.resetModules();
    access.imports = 0;
    vi.doMock('./access.js', () => {
      access.imports++;
      return { openMidiAccess: (events: AccessEvents) => access.open(events) };
    });
    const piano = await import('./piano.js');
    const { useAppStore: store } = await import('../app/store.js');
    store.setState({ settings: { ...DEFAULT_SETTINGS } });
    return { piano, store };
  }

  it('opens silently when the setting is on and the permission is granted', async () => {
    permission('granted');
    connectWith('GO:PIANO MIDI 1');
    const { piano, store } = await freshPage();
    store.getState().setSettings({ playAlong: true });
    const seen: string[] = [];
    const resumed = piano.resumePiano();
    seen.push(piano.pianoSnapshot().status);
    await resumed;
    seen.push(piano.pianoSnapshot().status);
    // The browser is never asked, so the line never says that it is.
    expect(seen).toEqual(['off', 'connected']);
    console.log('imports', access.imports, access.open.mock.calls.length);
    expect(access.open).toHaveBeenCalledTimes(1);
    expect(store.getState().settings.playAlong).toBe(true);
  });
  it('never reaches the access module with the permission still to be asked', async () => {
    permission('prompt');
    const { piano, store } = await freshPage();
    store.getState().setSettings({ playAlong: true });
    await piano.resumePiano();
    expect(access.imports).toBe(0);
    expect(access.open).not.toHaveBeenCalled();
    expect(piano.pianoSnapshot().status).toBe('off');
    expect(store.getState().settings.playAlong).toBe(true);
  });
  it('counts a permission query that throws as prompt', async () => {
    permission('throws');
    const { piano, store } = await freshPage();
    store.getState().setSettings({ playAlong: true });
    await piano.resumePiano();
    expect(access.imports).toBe(0);
    expect(piano.pianoSnapshot().status).toBe('off');
  });
  it('does nothing with a denied permission', async () => {
    permission('denied');
    const { piano, store } = await freshPage();
    store.getState().setSettings({ playAlong: true });
    await piano.resumePiano();
    expect(access.imports).toBe(0);
    expect(piano.pianoSnapshot().status).toBe('off');
  });
  it('does nothing with the setting off, whatever the permission', async () => {
    permission('granted');
    const { piano } = await freshPage();
    await piano.resumePiano();
    expect(access.imports).toBe(0);
    expect(piano.pianoSnapshot().status).toBe('off');
  });
  it('does nothing in a browser without Web MIDI', async () => {
    permission('granted');
    clearNavigator('requestMIDIAccess');
    const { piano, store } = await freshPage();
    store.getState().setSettings({ playAlong: true });
    await piano.resumePiano();
    expect(access.imports).toBe(0);
    expect(piano.pianoSnapshot().status).toBe('unsupported');
  });
  it('opens once per page', async () => {
    permission('granted');
    connectWith('A');
    const { piano, store } = await freshPage();
    store.getState().setSettings({ playAlong: true });
    await piano.resumePiano();
    await piano.resumePiano();
    expect(access.open).toHaveBeenCalledTimes(1);
  });
  it('skips the open when the reader turned it off while the permission was asked', async () => {
    permission('granted');
    connectWith('A');
    const { piano, store } = await freshPage();
    store.getState().setSettings({ playAlong: true });
    const resumed = piano.resumePiano();
    store.getState().setSettings({ playAlong: false });
    await resumed;
    expect(access.open).not.toHaveBeenCalled();
    expect(piano.pianoSnapshot().status).toBe('off');
  });
  it('shows denied when a silent open is refused after all', async () => {
    permission('granted');
    access.open.mockRejectedValue('denied');
    const { piano, store } = await freshPage();
    store.getState().setSettings({ playAlong: true });
    await piano.resumePiano();
    expect(piano.pianoSnapshot().status).toBe('denied');
    expect(store.getState().settings.playAlong).toBe(false);
  });
  it('is started by the first reader of the snapshot anywhere, once', async () => {
    permission('granted');
    connectWith('GO:PIANO MIDI 1');
    useAppStore.getState().setSettings({ playAlong: true });
    const first = renderHook(() => usePianoSnapshot());
    expect(first.result.current.status).toBe('off');
    await waitFor(() => expect(first.result.current.status).toBe('connected'));
    const second = renderHook(() => usePianoSnapshot());
    expect(second.result.current.names).toEqual(['GO:PIANO MIDI 1']);
    await act(async () => {
      await resumePiano();
    });
    expect(access.open).toHaveBeenCalledTimes(1);
  });
  it('is not started by a reader with the setting off', async () => {
    permission('granted');
    renderHook(() => usePianoSnapshot());
    await act(async () => {
      await resumePiano();
    });
    expect(access.open).not.toHaveBeenCalled();
  });
});

describe('while Windows looks for the piano', () => {
  // Chrome's WinRT backend leaves requestMIDIAccess pending for 20 s or more while a Bluetooth
  // piano is off (issue 182). Every wait here is a fake timer: the watcher is a timer, not a clock.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    resetPianoForTests();
    vi.useRealTimers();
  });

  /** Lets the lazy import and the permission query settle without moving the clock noticeably. */
  const settle = () => vi.advanceTimersByTimeAsync(1);

  it('waits two seconds before it says so', () => {
    expect(SEARCHING_AFTER_MS).toBe(2000);
  });

  it('moves a granted press that stays pending from asking to searching after 2000 ms', async () => {
    permission('granted');
    deferredOpen();
    void askForPiano();
    await settle();
    expect(status()).toBe('asking');
    await vi.advanceTimersByTimeAsync(SEARCHING_AFTER_MS - 100);
    expect(status()).toBe('asking');
    await vi.advanceTimersByTimeAsync(200);
    expect(status()).toBe('searching');
    expect(pianoSnapshot().names).toEqual([]);
    // Nothing is polled any more once the line says so.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps asking while the prompt is open, and searches on the next poll once it is allowed', async () => {
    permission('prompt');
    const open = deferredOpen();
    void askForPiano();
    await settle();
    await vi.advanceTimersByTimeAsync(4100);
    expect(status()).toBe('asking');
    expect(vi.getTimerCount()).toBe(1); // the watcher polls every second
    // The reader allows; the request then hangs.
    permission('granted');
    await vi.advanceTimersByTimeAsync(900);
    expect(status()).toBe('searching');
    open.link.events!.inputs(['GO:PIANO MIDI 1']);
    open.resolve();
    await vi.advanceTimersByTimeAsync(1);
    expect(status()).toBe('connected');
  });

  it('polls every second after the first two, not faster', async () => {
    const query = vi.fn(() => Promise.resolve({ state: 'prompt' as PermissionState }));
    setNavigator('permissions', { query });
    deferredOpen();
    void askForPiano();
    await settle();
    await vi.advanceTimersByTimeAsync(1900);
    expect(query).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(800); // 2.9 s
    expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300); // 3.2 s: the second poll came at 3 s
    expect(query).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000); // 6.2 s: polls at 4, 5 and 6 s
    expect(query).toHaveBeenCalledTimes(5);
    expect(status()).toBe('asking');
  });

  it('moves a silent resume that stays pending from off to searching after 2000 ms', async () => {
    permission('granted');
    useAppStore.getState().setSettings({ playAlong: true });
    const open = deferredOpen();
    void resumePiano();
    await settle();
    expect(access.open).toHaveBeenCalledTimes(1);
    expect(status()).toBe('off'); // nothing is asked, so the line never says asking
    await vi.advanceTimersByTimeAsync(1500);
    expect(status()).toBe('off');
    await vi.advanceTimersByTimeAsync(600);
    expect(status()).toBe('searching');
    // The piano is turned on at last.
    open.link.events!.inputs(['GO:PIANO MIDI 1']);
    open.resolve();
    await vi.advanceTimersByTimeAsync(1);
    expect(pianoSnapshot()).toEqual({ status: 'connected', names: ['GO:PIANO MIDI 1'] });
    expect(settings().playAlong).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('goes to searching at once on a press during a pending resume, sharing its request', async () => {
    permission('granted');
    useAppStore.getState().setSettings({ playAlong: true });
    deferredOpen();
    void resumePiano();
    await settle();
    expect(status()).toBe('off');
    void askForPiano();
    expect(status()).toBe('searching');
    await vi.advanceTimersByTimeAsync(3000);
    expect(status()).toBe('searching');
    expect(access.open).toHaveBeenCalledTimes(1);
  });

  it('leaves a second press during asking alone', async () => {
    permission('prompt');
    deferredOpen();
    void askForPiano();
    await settle();
    void askForPiano();
    expect(status()).toBe('asking');
    expect(access.open).toHaveBeenCalledTimes(1);
  });

  it('gives connected, or none, when the request resolves from searching', async () => {
    permission('granted');
    const first = deferredOpen();
    void askForPiano();
    await vi.advanceTimersByTimeAsync(2100);
    expect(status()).toBe('searching');
    first.link.events!.inputs(['Yamaha P-45']);
    first.resolve();
    await vi.advanceTimersByTimeAsync(1);
    expect(pianoSnapshot()).toEqual({ status: 'connected', names: ['Yamaha P-45'] });
    expect(settings().playAlong).toBe(true);

    turnOffPiano();
    const second = deferredOpen();
    void askForPiano();
    await vi.advanceTimersByTimeAsync(2100);
    expect(status()).toBe('searching');
    second.resolve(); // access, but no input list
    await vi.advanceTimersByTimeAsync(1);
    expect(pianoSnapshot()).toEqual({ status: 'none', names: [] });
    expect(settings().playAlong).toBe(true);
  });

  it('turns off while searching: off, the setting false, and a late answer is closed unused', async () => {
    permission('granted');
    const open = deferredOpen();
    void askForPiano();
    await vi.advanceTimersByTimeAsync(2100);
    expect(status()).toBe('searching');
    turnOffPiano();
    expect(pianoSnapshot()).toEqual({ status: 'off', names: [] });
    expect(settings().playAlong).toBe(false);
    // The piano is turned on much later: the answer is closed and the line stays plain.
    open.link.events!.inputs(['GO:PIANO MIDI 1']);
    open.resolve();
    await vi.advanceTimersByTimeAsync(1);
    expect(open.link.closes).toBe(1);
    expect(pianoSnapshot()).toEqual({ status: 'off', names: [] });
    expect(settings().playAlong).toBe(false);
  });

  it('shows denied when the pending request is refused after all', async () => {
    permission('granted');
    const open = deferredOpen();
    void askForPiano();
    await vi.advanceTimersByTimeAsync(2100);
    expect(status()).toBe('searching');
    open.reject('denied');
    await vi.advanceTimersByTimeAsync(1);
    expect(status()).toBe('denied');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer after the request settles, at any moment', async () => {
    permission('prompt');
    const open = deferredOpen();
    void askForPiano();
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    open.link.events!.inputs(['A']);
    open.resolve();
    await vi.advanceTimersByTimeAsync(1);
    expect(status()).toBe('connected');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(status()).toBe('connected');
  });

  it('leaves no timer after a dismissal', async () => {
    permission('prompt');
    const open = deferredOpen();
    void askForPiano();
    await vi.advanceTimersByTimeAsync(2500);
    open.reject('dismissed');
    await vi.advanceTimersByTimeAsync(1);
    expect(status()).toBe('off');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer after Turn off, and the old watcher does nothing to a new request', async () => {
    permission('granted');
    deferredOpen();
    void askForPiano();
    await vi.advanceTimersByTimeAsync(1500);
    turnOffPiano();
    expect(vi.getTimerCount()).toBe(0);
    // A new press 1.5 s after the first: its watcher counts from its own start.
    deferredOpen();
    void askForPiano();
    await settle();
    expect(status()).toBe('asking');
    await vi.advanceTimersByTimeAsync(1000); // 2.5 s after the first press, 1 s after the second
    expect(status()).toBe('asking');
    await vi.advanceTimersByTimeAsync(1200);
    expect(status()).toBe('searching');
  });

  it('leaves no timer after resetPianoForTests, and nothing happens to the new store', async () => {
    permission('granted');
    deferredOpen();
    void askForPiano();
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    resetPianoForTests();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(status()).toBe('off');
  });

  it('does not search once a piano is already there, or in a browser without Web MIDI', async () => {
    permission('granted');
    connectWith('A');
    await askForPiano();
    expect(status()).toBe('connected');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(status()).toBe('connected');
    clearNavigator('requestMIDIAccess');
    resetPianoForTests();
    await askForPiano();
    expect(vi.getTimerCount()).toBe(0);
    expect(status()).toBe('unsupported');
  });
});

describe('the snapshot in a component', () => {
  it('follows the press, the hot-plug and Turn off', async () => {
    const { result } = renderHook(() => usePianoSnapshot());
    expect(result.current.status).toBe('off');
    const open = deferredOpen();
    let pressed!: Promise<void>;
    act(() => {
      pressed = askForPiano();
    });
    expect(result.current.status).toBe('asking');
    await vi.waitFor(() => expect(access.open).toHaveBeenCalledTimes(1));
    await act(async () => {
      open.link.events!.inputs(['GO:PIANO MIDI 1']);
      open.resolve();
      await pressed;
    });
    expect(result.current).toEqual({ status: 'connected', names: ['GO:PIANO MIDI 1'] });
    act(() => open.link.events!.inputs([]));
    expect(result.current.status).toBe('none');
    act(() => turnOffPiano());
    expect(result.current.status).toBe('off');
  });
});

describe('the Bluetooth flag', () => {
  const chromeUa =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const edgeUa = `${chromeUa} Edg/130.0.0.0`;
  const nav = (o: { userAgent: string; platform?: string; brands?: string[] }): Navigator =>
    ({
      userAgent: o.userAgent,
      userAgentData:
        o.platform === undefined
          ? undefined
          : { platform: o.platform, brands: (o.brands ?? []).map((brand) => ({ brand })) },
    }) as unknown as Navigator;

  it('names the chrome flag on Windows Chrome and the edge flag on Windows Edge', () => {
    expect(bluetoothFlag(nav({ userAgent: chromeUa }))).toBe('chrome://flags/#use-winrt-midi-api');
    expect(bluetoothFlag(nav({ userAgent: edgeUa }))).toBe('edge://flags/#use-winrt-midi-api');
    expect(
      bluetoothFlag(
        nav({ userAgent: chromeUa, platform: 'Windows', brands: ['Chromium', 'Google Chrome'] }),
      ),
    ).toBe('chrome://flags/#use-winrt-midi-api');
    expect(
      bluetoothFlag(
        nav({ userAgent: chromeUa, platform: 'Windows', brands: ['Chromium', 'Microsoft Edge'] }),
      ),
    ).toBe('edge://flags/#use-winrt-midi-api');
  });
  it('names none elsewhere: other systems, Firefox and Opera', () => {
    const linux =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';
    const mac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0';
    const firefox =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0';
    expect(bluetoothFlag(nav({ userAgent: linux }))).toBeNull();
    expect(bluetoothFlag(nav({ userAgent: mac }))).toBeNull();
    expect(bluetoothFlag(nav({ userAgent: firefox }))).toBeNull();
    expect(
      bluetoothFlag(nav({ userAgent: chromeUa, platform: 'Linux', brands: ['Chromium'] })),
    ).toBeNull();
    expect(
      bluetoothFlag(nav({ userAgent: chromeUa, platform: 'macOS', brands: ['Chromium'] })),
    ).toBeNull();
    expect(bluetoothFlag(nav({ userAgent: `${chromeUa} OPR/115.0.0.0` }))).toBeNull();
    expect(bluetoothFlag(nav({ userAgent: '' }))).toBeNull();
  });
  it('trusts the platform of the client hints over the user agent', () => {
    expect(
      bluetoothFlag(nav({ userAgent: chromeUa, platform: 'Linux', brands: ['Chromium'] })),
    ).toBeNull();
  });
});

describe('the lazy chunk', () => {
  const here = dirname(fileURLToPath(import.meta.url));

  it('is reached only through import(), never a static import', () => {
    const source = readFileSync(join(here, 'piano.ts'), 'utf8');
    expect(source).toMatch(/import\(\s*['"]\.\/access\.js['"]\s*\)/);
    expect(source).not.toMatch(/^\s*import\s[^;]*\sfrom\s*['"]\.\/(access|parse)(\.js)?['"]/m);
    expect(source).not.toMatch(/^\s*import\s*['"]\.\/(access|parse)(\.js)?['"]/m);
    expect(source).not.toMatch(/^\s*export\s[^;]*\sfrom\s*['"]\.\/(access|parse)(\.js)?['"]/m);
  });

  /** Every source file of the app but the tests. */
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  /** The modules a file imports or re-exports statically (not `import()`), as written. */
  function staticImports(source: string): string[] {
    const found: string[] = [];
    for (const m of source.matchAll(/^\s*(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]/gm)) {
      found.push(m[1]!);
    }
    for (const m of source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) found.push(m[1]!);
    return found;
  }

  it('is reached by no file of the app but through import(): the first load never holds it', () => {
    const src = join(here, '..');
    const lazy = [join(here, 'access'), join(here, 'parse')];
    const offenders: string[] = [];
    for (const file of sources(src)) {
      for (const spec of staticImports(readFileSync(file, 'utf8'))) {
        if (!spec.startsWith('.')) continue;
        const target = resolve(dirname(file), spec).replace(/\.js$/, '');
        if (!lazy.includes(target)) continue;
        // The byte parser belongs to the access module: the one static import that stays in the chunk.
        const chunkInternal = file === join(here, 'access.ts') && target === join(here, 'parse');
        if (!chunkInternal) offenders.push(`${relative(src, file)} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('knows a static import when it sees one', () => {
    expect(
      staticImports(`import { a } from '../midi/parse.js';
export * from './access.js';`),
    ).toEqual(['../midi/parse.js', './access.js']);
    expect(staticImports(`import './access.js';`)).toEqual(['./access.js']);
    expect(
      staticImports(`import {
  a,
  b,
} from './parse.js';`),
    ).toEqual(['./parse.js']);
    expect(staticImports(`const m = await import('./access.js');`)).toEqual([]);
  });
});

describe('the healer: a connection that stays silent is opened again', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const events = () => readMidiLog().map((e) => e.event);

  it('reopens a connection that heard nothing, silently, and keeps the piano connected', async () => {
    const link = connectWith('GO:PIANO MIDI 1');
    await askForPiano();
    renderHook(() => usePianoHealer(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEAL_FIRST_MS - 1000);
    });
    expect(access.open).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(access.open).toHaveBeenCalledTimes(2);
    expect(link.closes).toBe(1);
    expect(status()).toBe('connected');
    expect(settings().playAlong).toBe(true);
    // The new access is the one heard: a note on it reaches the listeners, one on the old does not.
    const heard: number[] = [];
    subscribeNotes((e) => heard.push(e.midi));
    link.events!.note({ on: true, midi: 60 }, [60]);
    expect(heard).toEqual([60]);
    expect(events()).toEqual(['connect', 'opened', 'reconnect', 'connect', 'opened', 'first note']);
  });

  it('counts the silence from when the score is ready, not from the page load', async () => {
    connectWith('GO:PIANO MIDI 1');
    await askForPiano();
    // The port opened at page load; the score takes longer than the healer's wait to be ready.
    const hook = renderHook(({ on }) => usePianoHealer(on), { initialProps: { on: false } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEAL_FIRST_MS * 2);
    });
    hook.rerender({ on: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEAL_FIRST_MS - 1000);
    });
    expect(access.open).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(access.open).toHaveBeenCalledTimes(2);
  });

  it('leaves a connection alone once a note came', async () => {
    const link = connectWith('A');
    await askForPiano();
    renderHook(() => usePianoHealer(true));
    link.events!.note({ on: true, midi: 60 }, [60]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEAL_MAX_MS * 3);
    });
    expect(access.open).toHaveBeenCalledTimes(1);
  });

  it('waits twice as long after each reopen, up to the most', async () => {
    connectWith('A');
    await askForPiano();
    renderHook(() => usePianoHealer(true));
    const opensAfter = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
      return access.open.mock.calls.length;
    };
    expect(await opensAfter(HEAL_FIRST_MS + 1000)).toBe(2);
    expect(await opensAfter(HEAL_FIRST_MS * 2 - 1500)).toBe(2);
    expect(await opensAfter(1500)).toBe(3);
    expect(await opensAfter(HEAL_MAX_MS + 1000)).toBe(4);
    expect(await opensAfter(HEAL_MAX_MS + 1000)).toBe(5);
  });

  it('does nothing while off, or without a connection', async () => {
    connectWith('A');
    renderHook(() => usePianoHealer(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEAL_MAX_MS * 2);
    });
    expect(access.open).not.toHaveBeenCalled();
    await askForPiano();
    cleanup();
    renderHook(() => usePianoHealer(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEAL_MAX_MS * 2);
    });
    expect(access.open).toHaveBeenCalledTimes(1);
  });

  it('releases the keys held on the old connection, marked lost', async () => {
    const link = connectWith('A');
    await askForPiano();
    link.events!.note({ on: true, midi: 60 }, [60]);
    const offs: NoteMessage[] = [];
    subscribeNotes((e) => offs.push(e));
    reconnectPiano('test');
    expect(offs).toEqual([{ on: false, midi: 60, lost: true }]);
    expect(heldPitches()).toEqual([]);
  });
});

describe('the black box', () => {
  it('logs the opens, the ports, the first note and Turn off, and no notes', async () => {
    const link = connectWith('A');
    await askForPiano();
    link.events!.ports?.([{ id: 'p1', name: 'A', state: 'connected', connection: 'open' }]);
    link.events!.note({ on: true, midi: 60 }, [60]);
    link.events!.note({ on: false, midi: 60 }, []);
    turnOffPiano();
    const log = readMidiLog();
    expect(log.map((e) => e.event)).toEqual([
      'connect',
      'opened',
      'ports',
      'first note',
      'turn off',
    ]);
    expect(log[0]).toMatchObject({ reason: 'press' });
    expect(log[2]).toMatchObject({ ports: [{ id: 'p1', state: 'connected', connection: 'open' }] });
    expect(log[4]).toMatchObject({ heard: 2 });
  });

  it('keeps the newest entries only', () => {
    for (let i = 0; i < MIDI_LOG_MAX + 20; i++) midiLog('e', { i });
    const log = readMidiLog();
    expect(log).toHaveLength(MIDI_LOG_MAX);
    expect(log.at(-1)).toMatchObject({ i: MIDI_LOG_MAX + 19 });
  });
});
