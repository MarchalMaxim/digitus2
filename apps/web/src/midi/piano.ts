import { useEffect, useSyncExternalStore } from 'react';
import { useAppStore } from '../app/store.js';
import { midiLog } from './blackBox.js';
import type { NoteMessage, OpenedAccess, PianoSnapshot, PianoStatus, PortReport } from './types.js';

/**
 * The reader's own piano over Web MIDI, input only (issue 182): the store of the connection, the
 * keys held on the piano and the listeners of its notes, with their React hooks. This module is
 * static and small: it makes no Web MIDI call but the feature test and the permission query, and
 * reaches the byte parser and `MIDIAccess` (access.ts and parse.ts, one lazy chunk) only through
 * `import()`, in the press of the home line or on a later visit that is already allowed. The app
 * makes no sound for these notes.
 */

const NO_NAMES: readonly string[] = [];
const NO_KEYS: readonly number[] = [];

/** True where the browser has Web MIDI at all (Chromium and Firefox; not Safari or iOS). */
export function midiSupported(nav: Navigator | undefined = globalThis.navigator): boolean {
  return typeof nav?.requestMIDIAccess === 'function';
}

/**
 * The browser's MIDI permission for this site. Asking the query never prompts. A browser without
 * the query, or one that throws on the name `midi`, counts as `prompt`.
 */
export async function midiPermission(
  nav: Navigator | undefined = globalThis.navigator,
): Promise<PermissionState> {
  try {
    const status = await nav?.permissions?.query({ name: 'midi' });
    const state = status?.state;
    return state === 'granted' || state === 'denied' ? state : 'prompt';
  } catch {
    return 'prompt';
  }
}

/** The part of the client hints this module reads (`navigator.userAgentData` is not in lib.dom). */
interface ClientHints {
  platform?: string;
  brands?: readonly { brand: string }[];
}

/**
 * Windows Chromium's flag for a Bluetooth piano, as the text to show: Windows needs the WinRT MIDI
 * API switched on in Chrome and Edge. Null on any other system and in any other browser (Firefox,
 * Opera). Plain text, not a link: a page cannot navigate to these schemes.
 */
export function bluetoothFlag(nav: Navigator | undefined = globalThis.navigator): string | null {
  if (!nav) return null;
  const hints = (nav as Navigator & { userAgentData?: ClientHints }).userAgentData;
  const agent = nav.userAgent ?? '';
  const windows = hints?.platform ? hints.platform === 'Windows' : /Windows/.test(agent);
  if (!windows) return null;
  const brands = (hints?.brands ?? []).map((b) => b.brand);
  if (brands.includes('Opera') || /OPR\//.test(agent)) return null;
  if (brands.some((b) => /Edge/.test(b)) || /Edg\//.test(agent))
    return 'edge://flags/#use-winrt-midi-api';
  if (brands.some((b) => /Chrom/.test(b)) || /Chrome\//.test(agent))
    return 'chrome://flags/#use-winrt-midi-api';
  return null;
}

/** How long a granted request may stay pending before the line says it is looking for the piano. */
export const SEARCHING_AFTER_MS = 2000;
/** How often the watcher asks the permission again while the first answer was not `granted`. */
const SEARCHING_POLL_MS = 1000;

let snapshot: PianoSnapshot | null = null;
let held: readonly number[] = NO_KEYS;
/** The lazy connection: null until access resolved, and again after Turn off. */
let connection: OpenedAccess | null = null;
/** The request in flight, shared by every press. */
let pending: Promise<void> | null = null;
/**
 * Counts the connections made and turned off. The events of a connection that is no longer the
 * live one (turned off, or replaced) are dropped, so a late note never sticks a key.
 */
let generation = 0;
let resumed = false;
/** Notes heard on the live connection since it opened: none means it may be deaf. */
let heard = 0;
/** When the live connection opened, or was last asked to prove itself, in performance.now() ms. */
let openedAtMs = 0;
/** How long the healer lets a silent connection be before it reopens it (`usePianoHealer`). */
let healAfterMs = 0;

/** A silent connection is reopened after this long, then after twice that, up to the most. */
export const HEAL_FIRST_MS = 4000;
export const HEAL_MAX_MS = 30000;
/** The watcher's one timer (null when none runs): see `watchForSearching`. */
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const snapshotListeners = new Set<() => void>();
const heldListeners = new Set<() => void>();
const noteListeners = new Set<(e: NoteMessage) => void>();

function notify(listeners: ReadonlySet<() => void>): void {
  for (const listener of [...listeners]) listener();
}

function subscribeTo(listeners: Set<() => void>) {
  return (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
}
const subscribeSnapshot = subscribeTo(snapshotListeners);
const subscribeHeld = subscribeTo(heldListeners);

/** The first read decides between `unsupported` and `off`, so a test can set up the browser first. */
export function pianoSnapshot(): PianoSnapshot {
  snapshot ??= { status: midiSupported() ? 'off' : 'unsupported', names: NO_NAMES };
  return snapshot;
}

/** Replaces the snapshot, and tells the readers only when the status or the names changed. */
function setSnapshot(status: PianoStatus, names: readonly string[] = NO_NAMES): void {
  const now = pianoSnapshot();
  const sameNames = now.names.length === names.length && now.names.every((n, i) => n === names[i]);
  if (now.status === status && sameNames) return;
  snapshot = { status, names: names.length === 0 ? NO_NAMES : names };
  notify(snapshotListeners);
}

/** The piano's state in a component. The first reader anywhere starts the silent resume. */
export function usePianoSnapshot(): PianoSnapshot {
  useEffect(() => {
    void resumePiano();
  }, []);
  return useSyncExternalStore(subscribeSnapshot, pianoSnapshot, pianoSnapshot);
}

/** The pitches held on the piano now, ascending; the same array until they change. */
export function heldPitches(): readonly number[] {
  return held;
}

/** The held pitches in a component: a MIDI message re-renders only the readers of this. */
export function useHeldPitches(): readonly number[] {
  return useSyncExternalStore(subscribeHeld, heldPitches, heldPitches);
}

/**
 * Every merged note-on and note-off, synchronously as the messages arrive, with `heldPitches()`
 * already up to date. A listener that throws does not keep the others from hearing the note.
 * Returns the unsubscribe.
 */
export function subscribeNotes(listener: (e: NoteMessage) => void): () => void {
  noteListeners.add(listener);
  return () => void noteListeners.delete(listener);
}

function emitNote(e: NoteMessage): void {
  for (const listener of [...noteListeners]) {
    try {
      listener(e);
    } catch (error) {
      console.error(error);
    }
  }
}

function setHeld(next: readonly number[]): void {
  // The access hands over the same array until the pitches change; equal pitches count as that too.
  if (next === held || (next.length === held.length && next.every((m, i) => m === held[i]))) return;
  held = next;
  notify(heldListeners);
}

/** Lets go of every held key, so the listeners get their note-offs, marked `lost` (issue 185). */
function releaseAll(): void {
  const keys = held;
  if (keys.length === 0) return;
  setHeld(NO_KEYS);
  for (const midi of keys) emitNote({ on: false, midi, lost: true });
}

/** The connected inputs changed. No input is the status `none`, and then no key can still be down. */
function applyInputs(names: readonly string[]): void {
  if (names.length === 0) {
    setSnapshot('none');
    releaseAll();
  } else setSnapshot('connected', names);
}

function applyNote(e: NoteMessage, keys: readonly number[]): void {
  setHeld(keys);
  emitNote(e);
}

/** The refusal rejects with a string (access.ts); anything else is a failure to even try. */
function isRefusal(error: unknown): error is 'denied' | 'dismissed' {
  return error === 'denied' || error === 'dismissed';
}

function stopWatching(): void {
  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = null;
}

/**
 * Started with each request, from a press or the silent resume. A request that stays pending
 * after `SEARCHING_AFTER_MS` while the permission is already `granted` is the browser looking for
 * a piano, not asking (Chrome's WinRT backend leaves it pending for 20 s or more while a Bluetooth
 * piano is off), and the line says so (`searching`). With the prompt open the query says `prompt`,
 * so the line keeps asking; the watcher then asks again every second, as the reader may allow it
 * and the request then hang. It stops at the first `granted`, and when the request settles, is
 * turned off or replaced (`mine` is no longer the generation). One timer at most.
 */
function watchForSearching(mine: number): void {
  const poll = (afterMs: number) => {
    searchTimer = setTimeout(() => {
      searchTimer = null;
      void check();
    }, afterMs);
  };
  const stale = () => mine !== generation || pending === null;
  const check = async () => {
    if (stale()) return;
    const permission = await midiPermission();
    if (stale()) return;
    if (permission !== 'granted') {
      poll(SEARCHING_POLL_MS);
      return;
    }
    const { status } = pianoSnapshot();
    if (status === 'asking' || status === 'off') setSnapshot('searching');
  };
  stopWatching();
  poll(SEARCHING_AFTER_MS);
}

function connect(asking: boolean, reason: string): Promise<void> {
  if (pending) {
    // A resume is pending (the permission is granted) and the reader presses: it is not asking.
    if (pianoSnapshot().status === 'off') setSnapshot('searching');
    return pending;
  }
  if (connection || !midiSupported()) return Promise.resolve();
  const mine = ++generation;
  const live = () => mine === generation;
  if (asking) setSnapshot('asking');
  midiLog('connect', { reason });
  watchForSearching(mine);
  const events = {
    inputs: (names: readonly string[]) => {
      if (live()) applyInputs(names);
    },
    note: (e: NoteMessage, keys: readonly number[]) => {
      if (!live()) return;
      if (heard === 0)
        midiLog('first note', { afterMs: Math.round(performance.now() - openedAtMs) });
      heard++;
      applyNote(e, keys);
    },
    ports: (ports: readonly PortReport[]) => {
      if (live()) midiLog('ports', { ports });
    },
  };
  pending = (async () => {
    try {
      const { openMidiAccess } = await import('./access.js');
      const opened = await openMidiAccess(events);
      if (!live()) {
        // Turned off while the browser was still asking: the answer comes too late to matter.
        opened.close();
        return;
      }
      connection = opened;
      heard = 0;
      openedAtMs = performance.now();
      midiLog('opened', { reason });
      // Access without an input list yet is access without a piano.
      const { status } = pianoSnapshot();
      if (status === 'asking' || status === 'searching' || status === 'off') applyInputs([]);
      useAppStore.getState().setSettings({ playAlong: true });
    } catch (error) {
      if (!live()) return;
      midiLog('refused', { reason, error: String(error) });
      if (isRefusal(error)) {
        setSnapshot(error === 'denied' ? 'denied' : 'off');
        useAppStore.getState().setSettings({ playAlong: false });
      } else {
        // The lazy chunk could not be fetched, or the browser failed in some other way: the line
        // goes back to its plain button, and the reader's setting is left as it was.
        console.error(error);
        setSnapshot('off');
      }
    } finally {
      if (live()) {
        pending = null;
        stopWatching();
      }
    }
  })();
  return pending;
}

/**
 * The press of the home line (the reader's consent): the status goes to `asking`, then the lazy
 * chunk opens `MIDIAccess`, which is where the browser asks. On success `settings.playAlong` is
 * set; a refusal leaves `denied` (the permission now says so) or `off` (the prompt was dismissed).
 * A request the browser leaves pending with the permission granted turns the status to `searching`
 * (`watchForSearching`).
 */
export async function askForPiano(): Promise<void> {
  await connect(true, 'press');
}

/**
 * Turn off: the access is closed (its handlers detached), the held keys are released so the
 * listeners hear their note-offs, the status goes to `off` and the setting is cleared. The
 * browser's permission is left as it is.
 */
export function turnOffPiano(): void {
  midiLog('turn off', { heard });
  generation++;
  pending = null;
  stopWatching();
  const closing = connection;
  connection = null;
  try {
    closing?.close();
  } catch (error) {
    console.error(error);
  }
  releaseAll();
  setSnapshot('off');
  useAppStore.getState().setSettings({ playAlong: false });
}

/**
 * Once per page: with `settings.playAlong` on and the permission already `granted`, opens MIDI
 * without a press and without the status ever saying `asking`, as nothing is asked. With the
 * permission still to be asked (or denied) the lazy chunk is not even fetched.
 */
export async function resumePiano(): Promise<void> {
  if (resumed) return;
  resumed = true;
  if (!midiSupported() || !useAppStore.getState().settings.playAlong) return;
  if ((await midiPermission()) !== 'granted') return;
  // The reader may have pressed or turned it off while the permission was queried.
  if (!useAppStore.getState().settings.playAlong || pianoSnapshot().status !== 'off') return;
  await connect(false, 'page load');
}

/**
 * Opens the connection again, silently: the old access is closed (its held keys released, marked
 * `lost`) and a new one asked for, as a Turn off and a press would, with no prompt (the permission
 * is granted) and the setting left on. The status stays `connected` meanwhile unless the new access
 * lists no piano. A browser can hand a page an access whose piano port stays silent although the
 * piano plays (Chrome on Windows over Bluetooth MIDI): a new access hears it. Does nothing without a
 * live connection or while one is being opened.
 */
export function reconnectPiano(reason: string): void {
  if (!connection || pending) return;
  midiLog('reconnect', { reason, heard });
  generation++;
  const closing = connection;
  connection = null;
  try {
    closing.close();
  } catch (error) {
    console.error(error);
  }
  releaseAll();
  void connect(false, reason);
}

/**
 * While `on` (a score is open and the piano connected), a connection that has heard no note for
 * `HEAL_FIRST_MS` since it opened is reopened (`reconnectPiano`), then again after twice as long,
 * up to `HEAL_MAX_MS`, until a note comes. The page shown again after being hidden (a sleep, another
 * tab) asks the connection to prove itself the same way. Nothing shows: a reader who is not playing
 * loses nothing by a reopen, and one whose keys go unheard is heard after the next.
 */
export function usePianoHealer(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    healAfterMs = HEAL_FIRST_MS;
    const tick = setInterval(() => {
      if (!connection || pending || heard > 0 || document.hidden) return;
      if (performance.now() - openedAtMs < healAfterMs) return;
      healAfterMs = Math.min(healAfterMs * 2, HEAL_MAX_MS);
      reconnectPiano('silent');
    }, 1000);
    const shown = () => {
      if (document.hidden || !connection) return;
      heard = 0;
      openedAtMs = performance.now();
      healAfterMs = HEAL_FIRST_MS;
      midiLog('shown again');
    };
    document.addEventListener('visibilitychange', shown);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', shown);
    };
  }, [on]);
}

/**
 * Tests only: forgets the connection, the store, the note listeners and the resume. The readers of
 * the snapshot and the held pitches stay subscribed and read the empty store again.
 */
export function resetPianoForTests(): void {
  generation++;
  pending = null;
  stopWatching();
  try {
    connection?.close();
  } catch {
    // A fake that cannot close is nothing to report here.
  }
  connection = null;
  resumed = false;
  heard = 0;
  openedAtMs = 0;
  snapshot = null;
  held = NO_KEYS;
  noteListeners.clear();
  notify(snapshotListeners);
  notify(heldListeners);
}
