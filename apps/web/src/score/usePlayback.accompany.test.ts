import { parseMusicXml, type Score } from '@digitus2/engine';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import type * as InstrumentExports from '../audio/instrument.js';
import type { AccNote } from '../audio/instrument.js';
import { SAMPLES_FAILED_NOTICE, usePlayback } from './usePlayback.js';

// The other hand of the play-along (issue 184) in the playback hook: `prepare` loads the samples
// under `preparing` and never `loading`, `accompany` sounds the other hand through an Accompanist
// once the samples cover the score and the context runs, and `soundWaits` says the browser holds
// the context until a click.

const instrument = vi.hoisted(() => ({
  /** `start36` for a note started, `stop36` for its own stop being called, in order. */
  log: [] as string[],
  load: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  start: vi.fn((e: { midi: number }) => {
    instrument.log.push(`start${e.midi}`);
    return () => {
      instrument.log.push(`stop${e.midi}`);
    };
  }),
  stopAll: vi.fn(),
  strike: vi.fn(() => () => undefined),
  fromLocation: vi.fn((_ctx: unknown, _search: string) => instrument),
}));
vi.mock('../audio/instrument.js', async (importOriginal) => ({
  ...(await importOriginal<typeof InstrumentExports>()),
  instrumentFromLocation: (ctx: unknown, search: string) => instrument.fromLocation(ctx, search),
}));

const ONE_NOTE =
  '<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';
const OTHER_NOTE = ONE_NOTE.replace('<step>C</step>', '<step>E</step>');

/** An AudioContext the test drives: its state, and a resume the browser has not granted. */
class FakeContext {
  currentTime = 100;
  state: AudioContextState = initialState;
  onstatechange: (() => void) | null = null;
  resume = vi.fn(() => new Promise<void>(() => undefined)); // pending, as without a gesture
  constructor() {
    contexts.push(this);
  }
  close() {
    return Promise.resolve();
  }
  setState(state: AudioContextState) {
    this.state = state;
    this.onstatechange?.();
  }
}
let initialState: AudioContextState;
let contexts: FakeContext[];

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A note of the other hand: 36 is no pitch of the piece, so it tells the accompaniment apart. */
const note = (offsetSec: number, midi = 36, durationSec = 1): AccNote => ({
  offsetSec,
  durationSec,
  midi,
  velocity: 70,
  hand: 'L',
});

type Hook = ReturnType<typeof renderHook<ReturnType<typeof usePlayback>, unknown>>['result'];

/** prepare(), and wait until the samples have arrived. */
async function prepared(result: Hook): Promise<void> {
  await act(async () => {
    result.current.prepare();
  });
  await waitFor(() => expect(result.current.preparing).toBe(false));
}

function setUserActivation(hasBeenActive: boolean | undefined): void {
  Object.defineProperty(navigator, 'userActivation', {
    configurable: true,
    value: hasBeenActive === undefined ? undefined : { hasBeenActive },
  });
}

interface Keys {
  accompanied(): { midi: number; hand: string; time: number; duration: number; velocity: number }[];
  accompCancelled(): { midi: number; time: number }[];
  audioState(): string;
  strikes(): number[];
}
const keysHook = () => (window as unknown as { __digitus2Keys?: Keys }).__digitus2Keys;

beforeEach(() => {
  initialState = 'running';
  contexts = [];
  instrument.log.length = 0;
  instrument.load.mockImplementation(() => Promise.resolve());
  vi.stubGlobal('AudioContext', FakeContext);
  setUserActivation(undefined);
  window.history.replaceState({}, '', '/');
  useAppStore.setState({
    view: { name: 'score', source: { kind: 'library', slug: 'twinkle-twinkle-little-star' } },
    settings: { ...DEFAULT_SETTINGS, countIn: false, metronome: false },
    notice: null,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setUserActivation(undefined);
  window.history.replaceState({}, '', '/');
});

describe('prepare', () => {
  it('makes the context and loads the samples under preparing, never loading, once', async () => {
    const load = deferred();
    instrument.load.mockImplementation(() => load.promise);
    const { score } = parseMusicXml(ONE_NOTE);
    let everLoading = false;
    const { result } = renderHook(() => {
      const playback = usePlayback(score);
      everLoading ||= playback.loading;
      return playback;
    });
    expect(contexts).toHaveLength(0);
    expect(result.current.preparing).toBe(false);

    act(() => result.current.prepare());
    expect(contexts).toHaveLength(1);
    expect(result.current.preparing).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(instrument.load).toHaveBeenCalledWith([60], [96]);

    act(() => result.current.prepare()); // its own load is running: nothing more
    expect(instrument.load).toHaveBeenCalledTimes(1);

    await act(async () => {
      load.resolve();
      await load.promise;
    });
    expect(result.current.preparing).toBe(false);
    act(() => result.current.prepare()); // the samples cover the score: nothing more
    expect(instrument.load).toHaveBeenCalledTimes(1);
    expect(everLoading).toBe(false);
    expect(useAppStore.getState().notice).toBeNull();
  });

  it('leaves the samples to a Play that is loading them', async () => {
    const load = deferred();
    instrument.load.mockImplementation(() => load.promise);
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    act(() => result.current.play());
    expect(result.current.loading).toBe(true);
    act(() => result.current.prepare());
    expect(instrument.load).toHaveBeenCalledTimes(1); // a second load would make the piano drop Play's
    expect(result.current.preparing).toBe(false);
    await act(async () => {
      load.resolve();
      await load.promise;
    });
    await waitFor(() => expect(result.current.playing).toBe(true));
  });

  it('a Play that comes after wins the load; prepare only clears preparing', async () => {
    const first = deferred();
    const second = deferred();
    instrument.load
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    act(() => result.current.prepare());
    act(() => result.current.play());
    expect(instrument.load).toHaveBeenCalledTimes(2);
    expect(result.current.preparing).toBe(true);
    expect(result.current.loading).toBe(true);

    await act(async () => {
      first.resolve();
      await first.promise;
    });
    expect(result.current.preparing).toBe(false); // cleared when its load settles
    expect(result.current.loading).toBe(true); // Play's load is the one that counts
    act(() => result.current.accompany([note(0)]));
    expect(instrument.start).not.toHaveBeenCalled(); // the prepare's samples were not taken up

    await act(async () => {
      second.resolve();
      await second.promise;
    });
    await waitFor(() => expect(result.current.playing).toBe(true));
    expect(result.current.loading).toBe(false);
  });

  it('tells a failed load once, and does not try again for that score', async () => {
    instrument.load.mockImplementation(() => Promise.reject(new Error('offline')));
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    await act(async () => {
      result.current.prepare();
    });
    await waitFor(() => expect(result.current.preparing).toBe(false));
    expect(useAppStore.getState().notice).toBe(SAMPLES_FAILED_NOTICE);
    expect(result.current.loading).toBe(false);

    useAppStore.getState().setNotice(null);
    await act(async () => {
      result.current.prepare();
    });
    expect(instrument.load).toHaveBeenCalledTimes(1);
    expect(result.current.preparing).toBe(false);
    expect(useAppStore.getState().notice).toBeNull();

    // A later Play loads again, as it always has.
    instrument.load.mockImplementation(() => Promise.resolve());
    act(() => result.current.play());
    expect(instrument.load).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.playing).toBe(true));
  });

  it('is tried for another score after one failed', async () => {
    instrument.load.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    const first = parseMusicXml(ONE_NOTE).score;
    const second = parseMusicXml(OTHER_NOTE).score;
    const { result, rerender } = renderHook(({ s }: { s: Score }) => usePlayback(s), {
      initialProps: { s: first },
    });
    await act(async () => {
      result.current.prepare();
    });
    await waitFor(() => expect(result.current.preparing).toBe(false));
    rerender({ s: second });
    await prepared(result);
    expect(instrument.load).toHaveBeenCalledTimes(2);
    expect(instrument.load).toHaveBeenLastCalledWith([64], [96]);
  });

  it('leaves the walk working, without sound, where there is no Web Audio', () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('no audio here');
        }
      },
    );
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    expect(() => act(() => result.current.prepare())).not.toThrow();
    expect(result.current.preparing).toBe(false);
    expect(instrument.load).not.toHaveBeenCalled();
    act(() => result.current.accompany([note(0)]));
    expect(instrument.start).not.toHaveBeenCalled();
  });

  it('does nothing without a score', () => {
    const { result } = renderHook(() => usePlayback(null));
    act(() => result.current.prepare());
    expect(contexts).toHaveLength(0);
    expect(instrument.load).not.toHaveBeenCalled();
  });
});

describe('accompany', () => {
  it('does nothing before the samples arrive', async () => {
    const load = deferred();
    instrument.load.mockImplementation(() => load.promise);
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    act(() => result.current.prepare());
    act(() => result.current.accompany([note(0)]));
    expect(instrument.start).not.toHaveBeenCalled();
    await act(async () => {
      load.resolve();
      await load.promise;
    });
    act(() => result.current.accompany([note(0)]));
    expect(instrument.start).toHaveBeenCalledTimes(1);
  });

  it('never makes the context itself', () => {
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    act(() => result.current.accompany([note(0)]));
    expect(contexts).toHaveLength(0);
    expect(instrument.start).not.toHaveBeenCalled();
  });

  it('does nothing while the context is suspended, and plays once it runs', async () => {
    initialState = 'suspended';
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    await prepared(result);
    act(() => result.current.accompany([note(0)]));
    expect(instrument.start).not.toHaveBeenCalled();
    act(() => contexts[0]!.setState('running'));
    act(() => result.current.accompany([note(0)]));
    expect(instrument.start).toHaveBeenCalledTimes(1);
  });

  /** Lets the Accompanist's own 25 ms timer tick a few times (it is a real timer here). */
  const ticks = () => new Promise<void>((resolve) => setTimeout(resolve, 90));

  it('stops the last stretch when the context is held, so none of it sounds out of step after', async () => {
    window.history.replaceState({}, '', '/?hooks=1');
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    await prepared(result);
    act(() => result.current.accompany([note(0, 36), note(2, 38)]));
    expect(instrument.log).toEqual(['start36']); // 38 waits in the queue, two seconds away

    const ctx = contexts[0]!;
    act(() => ctx.setState('suspended')); // a backgrounded tab, Safari's interruption
    expect(keysHook()!.accompCancelled()).toEqual([
      { midi: 38, time: 102 },
      { midi: 36, time: 100 },
    ]);

    ctx.currentTime = 103;
    act(() => ctx.setState('running'));
    await act(async () => {
      await ticks();
    });
    expect(instrument.log).toEqual(['start36', 'stop36']); // 38 never starts
  });

  it('a press while the context is held stops what the last stretch left queued', async () => {
    window.history.replaceState({}, '', '/?hooks=1');
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    await prepared(result);
    act(() => result.current.accompany([note(0, 36), note(2, 38)]));

    // The browser holds the context without telling the page (no state change event reaches us).
    const ctx = contexts[0]!;
    ctx.state = 'suspended';
    act(() => result.current.accompany([note(0, 40)]));
    expect(instrument.log).toEqual(['start36', 'stop36']); // 40 is not handed over
    expect(keysHook()!.accompCancelled()).toEqual([
      { midi: 38, time: 102 },
      { midi: 36, time: 100 },
    ]);

    ctx.currentTime = 103;
    ctx.state = 'running';
    await act(async () => {
      await ticks();
    });
    expect(instrument.log).toEqual(['start36', 'stop36']); // nothing starts out of step
  });

  it('starts the notes from now, at the Practice tempo', async () => {
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    await prepared(result);
    act(() => result.current.accompany([note(0, 36, 1), note(0.5, 38, 1)]));
    expect(instrument.start).toHaveBeenCalledTimes(1); // 0.5 s is beyond the look-ahead
    expect(instrument.start).toHaveBeenLastCalledWith({
      midi: 36,
      time: 100,
      duration: 1,
      velocity: 70,
      hand: 'L',
    });

    useAppStore.getState().setTempoFactor(0.5);
    act(() => result.current.accompany([note(0.05, 40, 1)]));
    expect(instrument.start).toHaveBeenLastCalledWith({
      midi: 40,
      time: 100.1,
      duration: 2,
      velocity: 70,
      hand: 'L',
    });
  });

  it('a new pass cancels the notes of the last that have not started', async () => {
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    await prepared(result);
    act(() => result.current.accompany([note(0.1, 36)]));
    act(() => result.current.accompany([note(0.1, 38)]));
    expect(instrument.log).toEqual(['start36', 'stop36', 'start38']);
  });
});

describe('stopAccompaniment', () => {
  it('is harmless before anything played', () => {
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    act(() => result.current.stopAccompaniment());
    expect(instrument.stopAll).not.toHaveBeenCalled();
  });

  it('cancels and releases the other hand without touching the rest of the instrument', async () => {
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    await prepared(result);
    act(() => result.current.accompany([note(0, 36), note(0.1, 38)]));
    act(() => result.current.stopAccompaniment());
    act(() => result.current.stopAccompaniment());
    expect(instrument.log).toEqual(['start36', 'start38', 'stop36', 'stop38']);
    expect(instrument.stopAll).not.toHaveBeenCalled();
  });

  it('is done by play() in the click, before the transport schedules anything', async () => {
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    await prepared(result);
    act(() => result.current.accompany([note(0.1, 36)]));
    // A resumed play: no count-in and no flight of the red, so the note is scheduled at once.
    act(() => result.current.play({ resume: true }));
    await waitFor(() => expect(result.current.playing).toBe(true));
    expect(instrument.log).toEqual(['start36', 'stop36', 'start60']); // 60 is the piece's own C4
  });

  it('is done by a new score', async () => {
    const first = parseMusicXml(ONE_NOTE).score;
    const second = parseMusicXml(OTHER_NOTE).score;
    const { result, rerender } = renderHook(({ s }: { s: Score }) => usePlayback(s), {
      initialProps: { s: first },
    });
    await prepared(result);
    act(() => result.current.accompany([note(0.1, 36)]));
    rerender({ s: second });
    expect(instrument.log).toEqual(['start36', 'stop36']);
  });

  it('is done when the view is left', async () => {
    const { score } = parseMusicXml(ONE_NOTE);
    const { result, unmount } = renderHook(() => usePlayback(score));
    await prepared(result);
    act(() => result.current.accompany([note(0.1, 36)]));
    unmount();
    expect(instrument.log).toEqual(['start36', 'stop36']);
  });
});

describe('soundWaits, and the listener that resumes the context', () => {
  it('follows the context state and the page’s user activation', async () => {
    initialState = 'suspended';
    setUserActivation(false);
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    expect(result.current.soundWaits).toBe(false); // no context yet
    await prepared(result);
    expect(result.current.soundWaits).toBe(true);

    act(() => contexts[0]!.setState('running'));
    expect(result.current.soundWaits).toBe(false);

    // Held again with the page already active (a browser interruption): nothing to click for.
    setUserActivation(true);
    act(() => contexts[0]!.setState('suspended'));
    expect(result.current.soundWaits).toBe(false);

    // A browser without the API counts as not active.
    setUserActivation(undefined);
    act(() => contexts[0]!.setState('running'));
    act(() => contexts[0]!.setState('suspended'));
    expect(result.current.soundWaits).toBe(true);
  });

  it('does not ask for a click once the samples have failed to load: nothing would sound', async () => {
    initialState = 'suspended';
    setUserActivation(false);
    instrument.load.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    const first = parseMusicXml(ONE_NOTE).score;
    const second = parseMusicXml(OTHER_NOTE).score;
    const { result, rerender } = renderHook(({ s }: { s: Score }) => usePlayback(s), {
      initialProps: { s: first },
    });
    await act(async () => {
      result.current.prepare();
    });
    await waitFor(() => expect(result.current.preparing).toBe(false));
    expect(useAppStore.getState().notice).toBe(SAMPLES_FAILED_NOTICE);
    expect(result.current.soundWaits).toBe(false);

    // Another piece loads its samples again, and a click helps there.
    rerender({ s: second });
    expect(result.current.soundWaits).toBe(true);
    await prepared(result);
    expect(result.current.soundWaits).toBe(true);
  });

  it('listens for a click or a key while the context is suspended, and resumes it', async () => {
    initialState = 'suspended';
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    await prepared(result);
    const ctx = contexts[0]!;
    // The one made without a gesture asks to resume once on its own; the listener is on top of it.
    ctx.resume.mockClear();

    act(() => {
      document.dispatchEvent(new Event('pointerdown'));
    });
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    act(() => {
      document.dispatchEvent(new Event('pointerup'));
      document.dispatchEvent(new Event('keydown'));
    });
    expect(ctx.resume).toHaveBeenCalledTimes(3);

    act(() => ctx.setState('running'));
    act(() => {
      document.dispatchEvent(new Event('pointerdown'));
    });
    expect(ctx.resume).toHaveBeenCalledTimes(3); // the listener went with the state
  });

  it('listens in the capture phase, and also when the page has been active', async () => {
    initialState = 'suspended';
    setUserActivation(true);
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { score } = parseMusicXml(ONE_NOTE);
    const { result, unmount } = renderHook(() => usePlayback(score));
    await prepared(result);
    const ours = (spy: typeof add) =>
      spy.mock.calls.filter(([type]) => ['pointerdown', 'pointerup', 'keydown'].includes(type));
    expect(ours(add).map(([type]) => type)).toEqual(['pointerdown', 'pointerup', 'keydown']);
    expect(ours(add).every(([, , capture]) => capture === true)).toBe(true);
    expect(result.current.soundWaits).toBe(false);

    unmount();
    expect(ours(remove).map(([type]) => type)).toEqual(['pointerdown', 'pointerup', 'keydown']);
    add.mockRestore();
    remove.mockRestore();
  });

  it('goes with the hook on unmount, and a click after it resumes nothing', async () => {
    initialState = 'suspended';
    const { score } = parseMusicXml(ONE_NOTE);
    const { result, unmount } = renderHook(() => usePlayback(score));
    await prepared(result);
    const ctx = contexts[0]!;
    ctx.resume.mockClear();
    unmount();
    document.dispatchEvent(new Event('pointerdown'));
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it('puts up no listener while the context runs', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    await prepared(result);
    expect(add.mock.calls.filter(([type]) => type === 'pointerdown')).toEqual([]);
    add.mockRestore();
  });
});

describe('the test hooks', () => {
  it('are there with ?hooks=1, which keeps the real instrument', async () => {
    window.history.replaceState({}, '', '/?hooks=1');
    const { score } = parseMusicXml(ONE_NOTE);
    const { result, unmount } = renderHook(() => usePlayback(score));
    const keys = keysHook();
    expect(keys).toBeDefined();
    expect(keys!.audioState()).toBe('none');
    await prepared(result);
    expect(keys!.audioState()).toBe('running');
    expect(instrument.fromLocation).toHaveBeenCalledWith(expect.anything(), '?hooks=1');
    unmount();
    expect(keysHook()).toBeUndefined();
  });

  it('are there with ?audio=silent, and absent otherwise', () => {
    const { score } = parseMusicXml(ONE_NOTE);
    const plain = renderHook(() => usePlayback(score));
    expect(keysHook()).toBeUndefined();
    plain.unmount();
    window.history.replaceState({}, '', '/?audio=silent');
    renderHook(() => usePlayback(score));
    expect(keysHook()).toBeDefined();
    expect(keysHook()!.strikes()).toEqual([]);
  });

  it('accompanied() holds what the accompaniment handed over, and none of Play’s notes', async () => {
    window.history.replaceState({}, '', '/?hooks=1');
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    await prepared(result);
    act(() => result.current.accompany([note(0, 36), note(0.1, 38)]));
    const keys = keysHook()!;
    expect(keys.accompanied()).toEqual([
      { midi: 36, hand: 'L', time: 100, duration: 1, velocity: 70 },
      { midi: 38, hand: 'L', time: 100.1, duration: 1, velocity: 70 },
    ]);
    expect(keys.accompCancelled()).toEqual([]);

    act(() => result.current.play({ resume: true }));
    await waitFor(() => expect(result.current.playing).toBe(true));
    expect(instrument.log).toContain('start60'); // Play sounded its own note
    expect(keys.accompanied().map((n) => n.midi)).toEqual([36, 38]);
    // Play stopped the accompaniment first: both were cancelled or released, once each.
    expect(keys.accompCancelled()).toEqual([
      { midi: 36, time: 100 },
      { midi: 38, time: 100.1 },
    ]);
  });
  it('accompCancelled() also holds the notes dropped from the queue before they were handed over', async () => {
    window.history.replaceState({}, '', '/?hooks=1');
    const { score } = parseMusicXml(ONE_NOTE);
    const { result } = renderHook(() => usePlayback(score));
    await prepared(result);
    act(() => result.current.accompany([note(0, 36), note(0.6, 38), note(1.2, 40)]));
    const keys = keysHook()!;
    expect(keys.accompanied().map((n) => n.midi)).toEqual([36]); // 38 and 40 wait in the queue
    // A new stretch: the two queued notes are dropped; the handed one sounds (the clock is at
    // its time), so it is not cancelled.
    act(() => result.current.accompany([note(0, 42)]));
    expect(keys.accompCancelled()).toEqual([
      { midi: 38, time: 100.6 },
      { midi: 40, time: 101.2 },
    ]);
    // A stop drops what waits and releases what sounds.
    act(() => result.current.accompany([note(0.6, 44)]));
    act(() => result.current.stopAccompaniment());
    expect(keys.accompCancelled().slice(2)).toEqual([
      { midi: 44, time: 100.6 },
      { midi: 36, time: 100 },
      { midi: 42, time: 100 },
    ]);
  });
});
