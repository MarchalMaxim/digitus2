import { readFileSync } from 'node:fs';
import { midiToSpelling, parseMusicXml, type Hand, type Note, type Score } from '@digitus2/engine';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import type * as InstrumentExports from '../audio/instrument.js';
import { performanceFor } from '../audio/performance.js';
import { askForPiano, resetPianoForTests, turnOffPiano } from '../midi/piano.js';
import type { AccessEvents, OpenedAccess } from '../midi/types.js';
import { PianoKeyboard } from './PianoKeyboard.js';
import { alongSteps, type PerfRange } from './playAlong.js';
import { usePlayAlong, type PlayAlongOptions } from './usePlayAlong.js';
import { usePlayback, type Playback } from './usePlayback.js';

// The play-along's glue (issue 182): the piano store drives the hook through a fake lazy chunk,
// the playback is a fake with a position of its own, and every test runs under StrictMode.

// The lazy chunk (access.ts, with parse.ts) is replaced by a fake that the tests drive.
const access = vi.hoisted(() => ({
  open: vi.fn<(events: AccessEvents) => Promise<OpenedAccess>>(),
}));
vi.mock('../midi/access.js', () => ({
  openMidiAccess: (events: AccessEvents) => access.open(events),
}));

// The real playback, for the tests that put the walk's own cues to its getters: a silent
// instrument and an audio context that does not move.
vi.mock('../audio/instrument.js', async (importOriginal) => ({
  ...(await importOriginal<typeof InstrumentExports>()),
  instrumentFromLocation: () => ({
    load: () => Promise.resolve(),
    start: () => {},
    stopAll: () => {},
  }),
}));

/** Bars of four quarter notes: divisions 1 and 120 qpm, so a tick is half a second. */
const BAR_TICKS = 4;
const TICK_SEC = 0.5;

interface NoteSpec {
  midi: number;
  tick: number;
  hand?: Hand;
  ticks?: number;
}

let nextId = 0;
function note(spec: NoteSpec): Note {
  const onsetSec = spec.tick * TICK_SEC;
  const ticks = spec.ticks ?? 1;
  return {
    id: `n${nextId++}`,
    onsetTick: spec.tick,
    offsetTick: spec.tick + ticks,
    onsetSec,
    offsetSec: onsetSec + ticks * TICK_SEC,
    midi: spec.midi,
    spelling: midiToSpelling(spec.midi),
    hand: spec.hand ?? 'R',
    staff: spec.hand === 'L' ? 2 : 1,
    voice: 1,
    measureIndex: Math.floor(spec.tick / BAR_TICKS),
    isGrace: false,
    chordId: `c${nextId}`,
    sourceIndices: [nextId],
  };
}

function scoreOf(specs: NoteSpec[], bars = 2): Score {
  return {
    meta: {},
    divisions: 1,
    tempoMap: [{ tick: 0, qpm: 120 }],
    timeSignatures: [{ tick: 0, beats: 4, beatType: 4 }],
    keySignatures: [],
    measures: Array.from({ length: bars }, (_, i) => ({
      index: i,
      startTick: i * BAR_TICKS,
      lengthTicks: BAR_TICKS,
      number: String(i + 1),
    })),
    notes: specs.map(note),
  };
}

/**
 * Steps (both hands): [48 60] at 0, [62] at 0.5, [64] at 1, [60] at 1.5, [60] at 2 seconds. With
 * the left hand muted: [60], [62], [64], [60], [60] at the same seconds.
 */
const score = scoreOf([
  { midi: 48, tick: 0, hand: 'L', ticks: 4 },
  { midi: 60, tick: 0 },
  { midi: 62, tick: 1 },
  { midi: 64, tick: 2 },
  { midi: 60, tick: 3 },
  { midi: 60, tick: 4 },
]);

/** The bars a loop state names; the walk reads the stretch in seconds from `performanceLoop`. */
const LOOP_BARS = { from: 1, to: 1 };

/** A playback with a position of its own: `cueAt` and `finish` move it as the real ones do. */
function makeFake() {
  const f = {
    playing: false,
    loading: false,
    atStart: true,
    cue: null as number | null,
    start: 0,
    /** The position when it is not where Play starts (a loop moved the start); null: the same. */
    pos: null as number | null,
    stretch: null as PerfRange | null,
    /** The group the cursor marks; by default it marks the cue. */
    group: null as number | null,
    flight: false,
    /** The finish plans the red's flight home, which shows from the next render on. */
    flightOnFinish: false,
    cueAt: vi.fn((perfSec: number) => {
      f.cue = perfSec;
      f.atStart = false;
      f.start = perfSec;
      f.pos = null;
    }),
    finish: vi.fn(() => {
      f.cue = null;
      f.atStart = true;
      f.start = 0;
      f.pos = null;
      if (f.flightOnFinish) f.flight = true;
    }),
    /**
     * A fresh object per call, as the real hook hands out a new one when a state changes. Its
     * state fields read the fake as it is now: the walk looks at the playback in the same commit
     * that its own cue was made in, and the fake has no render of its own to wait for.
     */
    view(): Playback {
      return {
        get playing() {
          return f.playing;
        },
        get loading() {
          return f.loading;
        },
        countIn: null,
        waiting: false,
        get atStart() {
          return f.atStart;
        },
        ended: 0,
        get cue() {
          return f.cue;
        },
        play: () => {},
        pause: () => {},
        rewind: () => {},
        seek: () => {},
        cueAt: f.cueAt,
        finish: f.finish,
        positionSec: () => f.pos ?? f.start,
        startSec: () => f.start,
        startPerformanceSec: () => f.start,
        performanceLoop: () => (f.stretch ? { ...f.stretch } : null),
        leadingIn: () => false,
        playingNow: () => f.playing,
        leadInRemainingSec: () => null,
        get loop() {
          return f.stretch ? LOOP_BARS : null;
        },
        setLoop: () => {},
        strike: () => () => undefined,
      };
    },
  };
  return f;
}
type Fake = ReturnType<typeof makeFake>;

/** The fake lazy chunk: remembers the events it was given. */
const link = { events: null as AccessEvents | null };
const down = new Set<number>();

function connectWith(...names: string[]) {
  access.open.mockImplementation((events) => {
    link.events = events;
    events.inputs(names);
    return Promise.resolve({ close: () => {} });
  });
}
const heldNow = () => [...down].sort((a, b) => a - b);

/** The piano connects, as a press of the home line does. */
async function connect(...names: string[]) {
  connectWith(...(names.length > 0 ? names : ['GO:PIANO']));
  await act(() => askForPiano());
}

function setNavigator(name: string, value: unknown): void {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
}

interface Setup {
  fake: Fake;
  hook: ReturnType<typeof renderHook<ReturnType<typeof usePlayAlong>, PlayAlongOptions>>;
  /** Renders again with the fake's present state, as the real hook does after a state change. */
  refresh(over?: Partial<PlayAlongOptions>): void;
  press(...midis: number[]): void;
  release(...midis: number[]): void;
  /** The seconds `cueAt` was called with, in order. */
  cues(): number[];
}

function setup(over: Partial<PlayAlongOptions> = {}, prepare?: (f: Fake) => void): Setup {
  const fake = makeFake();
  prepare?.(fake);
  let extra = over;
  const options = (): PlayAlongOptions => ({
    score,
    ready: true,
    playable: true,
    mutedHands: [],
    ...extra,
    playback: fake.view(),
    currentGroup: fake.group ?? (fake.cue === null ? -1 : 0),
    flightShown: fake.flight,
  });
  const hook = renderHook((o: PlayAlongOptions) => usePlayAlong(o), {
    initialProps: options(),
    wrapper: StrictMode,
  });
  const refresh = (next?: Partial<PlayAlongOptions>) => {
    if (next) extra = { ...extra, ...next };
    hook.rerender(options());
  };
  const send = (on: boolean, midis: number[]) => {
    for (const midi of midis) {
      if (on) down.add(midi);
      else down.delete(midi);
      act(() => link.events!.note({ on, midi }, heldNow()));
      refresh();
    }
  };
  return {
    fake,
    hook,
    refresh,
    press: (...midis) => send(true, midis),
    release: (...midis) => send(false, midis),
    cues: () => fake.cueAt.mock.calls.map(([sec]) => sec),
  };
}

/** One animation frame: what the align waits for when the red flies home. */
const frame = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  access.open.mockReset();
  down.clear();
  link.events = null;
  setNavigator('requestMIDIAccess', () => Promise.reject(new Error('the store never calls this')));
  setNavigator('permissions', { query: () => Promise.resolve({ state: 'prompt' }) });
  resetPianoForTests();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (navigator as unknown as Record<string, unknown>).requestMIDIAccess;
  delete (navigator as unknown as Record<string, unknown>).permissions;
  window.history.replaceState(null, '', '/');
  resetPianoForTests();
});

describe('connecting', () => {
  it('cues the first step once the piano connects, and says what to play', async () => {
    const s = setup();
    expect(s.hook.result.current).toEqual({ active: false, atFirst: false, hint: null });
    expect(s.cues()).toEqual([]);
    await connect();
    s.refresh();
    expect(s.cues()).toEqual([0]);
    expect(s.hook.result.current).toEqual({ active: true, atFirst: true, hint: 2 });
  });

  it('cues the first step once when it mounts connected: running the align twice calls once', async () => {
    await connect();
    const s = setup();
    expect(s.cues()).toEqual([0]);
    s.refresh();
    s.refresh();
    expect(s.cues()).toEqual([0]);
  });

  it('does nothing without a piano', () => {
    const s = setup();
    s.refresh();
    expect(s.cues()).toEqual([]);
    expect(s.fake.finish).not.toHaveBeenCalled();
    expect(s.hook.result.current.active).toBe(false);
  });

  it('does nothing for a score that is not ready or has nothing to play', async () => {
    await connect();
    const s = setup({ ready: false });
    expect(s.cues()).toEqual([]);
    s.refresh({ ready: true, playable: false });
    expect(s.cues()).toEqual([]);
    expect(s.hook.result.current.active).toBe(false);
    s.refresh({ playable: true });
    expect(s.cues()).toEqual([0]);
  });

  it('is off when the setting is off, whatever the status', async () => {
    await connect();
    useAppStore.getState().setSettings({ playAlong: false });
    const s = setup();
    expect(s.hook.result.current.active).toBe(false);
    expect(s.cues()).toEqual([]);
  });
});

describe('the walk', () => {
  it('moves on when every pitch of the step is held, and not before', async () => {
    await connect();
    const s = setup();
    s.press(60);
    expect(s.cues()).toEqual([0]); // a chord of two: one key is not the step
    s.press(48);
    expect(s.cues()).toEqual([0, 0.5]);
    s.press(62);
    expect(s.cues()).toEqual([0, 0.5, 1]);
  });

  it('advances once for one note', async () => {
    await connect();
    const s = setup();
    s.press(48, 60);
    expect(s.cues()).toEqual([0, 0.5]);
    s.release(48, 60);
    s.refresh();
    expect(s.cues()).toEqual([0, 0.5]);
  });

  it('ignores a wrong note: the red stays', async () => {
    await connect();
    const s = setup();
    s.press(61);
    s.press(72);
    expect(s.cues()).toEqual([0]);
    s.press(48, 60);
    expect(s.cues()).toEqual([0, 0.5]);
  });

  it('counts a chord played apart while held, and not one let go before the last key', async () => {
    await connect();
    const s = setup();
    s.press(48);
    s.release(48);
    s.press(60);
    expect(s.cues()).toEqual([0]);
    s.press(48);
    expect(s.cues()).toEqual([0, 0.5]);
  });

  it('chains an early press: one cue to where the chain ends', async () => {
    await connect();
    const s = setup();
    s.press(62, 64); // the next two steps, pressed before the first
    expect(s.cues()).toEqual([0]);
    s.press(48, 60);
    expect(s.cues()).toEqual([0, 1.5]);
  });

  it('needs a fresh press for a repeated pitch', async () => {
    await connect();
    const s = setup();
    s.press(48, 60, 62, 64);
    // The C held since the first chord is used: it is not the press the first of the two Cs asks for.
    expect(s.cues()).toEqual([0, 0.5, 1, 1.5]);
    s.release(60);
    s.press(60);
    expect(s.cues()).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(s.fake.finish).not.toHaveBeenCalled();
    s.release(60);
    s.press(60);
    expect(s.fake.finish).toHaveBeenCalledTimes(1);
  });

  it('counts a second note-on of a key already down as a fresh press', async () => {
    await connect();
    const s = setup();
    s.press(48, 60, 62, 64);
    expect(s.cues()).toEqual([0, 0.5, 1, 1.5]);
    s.press(60); // two inputs, or a keyboard that sent no note-off
    expect(s.cues()).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('reads the hands played: the left hand never moves the red with it muted', async () => {
    await connect();
    const s = setup({ mutedHands: ['L'] });
    expect(s.cues()).toEqual([0]);
    expect(s.hook.result.current.hint).toBe(1);
    s.press(48);
    expect(s.cues()).toEqual([0]);
    s.press(60);
    expect(s.cues()).toEqual([0, 0.5]);
  });

  it('shows the hint until the first step is played, and not again', async () => {
    await connect();
    const s = setup();
    expect(s.hook.result.current.hint).toBe(2);
    s.press(48, 60);
    expect(s.hook.result.current.hint).toBeNull();
    s.release(62);
    s.refresh({ mutedHands: ['L'] });
    s.release(48, 60);
    expect(s.hook.result.current.hint).toBeNull();
  });

  it('knows when the red waits on the first step', async () => {
    await connect();
    const s = setup();
    s.refresh();
    expect(s.hook.result.current.atFirst).toBe(true);
    s.press(48, 60);
    expect(s.hook.result.current.atFirst).toBe(false);
    expect(s.hook.result.current.active).toBe(true);
  });
});

describe('the end', () => {
  /** Plays every step: the last C needs its own release and press. */
  function playThrough(s: Setup) {
    s.press(48, 60, 62, 64);
    s.release(60);
    s.press(60);
    s.release(60);
    s.press(60);
  }

  it('finishes with the transport end, and cues the first step again once the flight is over', async () => {
    await connect();
    const s = setup();
    s.fake.flightOnFinish = true;
    playThrough(s);
    expect(s.fake.finish).toHaveBeenCalledTimes(1);
    expect(s.hook.result.current.active).toBe(true);
    expect(s.hook.result.current.atFirst).toBe(false);
    // The flight home is on screen: there is no cue under it.
    await frame();
    expect(s.cues()).toEqual([0, 0.5, 1, 1.5, 2]);
    s.fake.flight = false;
    s.refresh();
    expect(s.cues()).toEqual([0, 0.5, 1, 1.5, 2, 0]);
    s.refresh();
    expect(s.hook.result.current.atFirst).toBe(true);
  });

  it('cues the first step again at once when no flight is planned (reduced motion)', async () => {
    await connect();
    const s = setup();
    playThrough(s);
    expect(s.fake.finish).toHaveBeenCalledTimes(1);
    await frame();
    expect(s.cues()).toEqual([0, 0.5, 1, 1.5, 2, 0]);
    s.refresh();
    expect(s.hook.result.current.atFirst).toBe(true);
  });

  it('looks again a frame after the position went home, for the flight that is not planned yet', async () => {
    await connect();
    const s = setup();
    s.press(48, 60, 62);
    expect(s.cues()).toEqual([0, 0.5, 1]);
    // Rewind: the position goes home and `atStart` turns true; the flight home is planned in a
    // layout effect of this commit and shows in the next render.
    s.fake.cue = null;
    s.fake.atStart = true;
    s.fake.start = 0;
    s.refresh();
    expect(s.cues()).toEqual([0, 0.5, 1]);
    await frame();
    expect(s.cues()).toEqual([0, 0.5, 1, 0]);
  });

  it('does not wait a frame for the flight when it is already shown', async () => {
    await connect();
    const s = setup();
    s.press(48, 60, 62);
    s.fake.cue = null;
    s.fake.atStart = true;
    s.fake.start = 0;
    s.fake.flight = true;
    s.refresh();
    await frame();
    expect(s.cues()).toEqual([0, 0.5, 1]);
    s.fake.flight = false;
    s.refresh();
    expect(s.cues()).toEqual([0, 0.5, 1, 0]);
  });

  it('counts the first step played after the finish from the fresh presses only', async () => {
    await connect();
    const s = setup();
    s.fake.flightOnFinish = true;
    playThrough(s);
    s.press(48, 60); // pressed during the flight: counts once it lands
    s.fake.flight = false;
    s.refresh();
    expect(s.cues()).toEqual([0, 0.5, 1, 1.5, 2, 0.5]);
  });
});

describe('when the walk does not move', () => {
  it('does nothing while playing', async () => {
    await connect();
    const s = setup();
    s.fake.playing = true;
    s.refresh();
    expect(s.hook.result.current).toEqual({ active: false, atFirst: false, hint: null });
    s.press(48, 60);
    expect(s.cues()).toEqual([0]);
    expect(s.fake.finish).not.toHaveBeenCalled();
  });

  it('does nothing while the samples load', async () => {
    await connect();
    const s = setup();
    s.fake.loading = true;
    s.refresh();
    expect(s.hook.result.current.active).toBe(false);
    s.press(48, 60);
    expect(s.cues()).toEqual([0]);
  });

  it('does not move the red when the playback plays now, whatever the last render said', async () => {
    await connect();
    const s = setup();
    s.fake.playing = true; // read synchronously by the note, before any render shows it
    s.press(48, 60);
    expect(s.cues()).toEqual([0]);
  });

  it('keeps a press made during a flight and counts it once the flight lands', async () => {
    await connect();
    const s = setup();
    s.fake.flight = true;
    s.refresh();
    s.press(48, 60);
    expect(s.cues()).toEqual([0]);
    s.fake.flight = false;
    s.refresh();
    expect(s.cues()).toEqual([0, 0.5]);
  });

  it('uses up the keys held through Play and Pause: they are not presses for the next step', async () => {
    await connect();
    const s = setup();
    s.press(48, 60, 62); // waiting on step 3 now
    s.fake.playing = true;
    s.refresh();
    s.press(64);
    s.fake.playing = false;
    s.fake.cue = null; // paused after a note: the cursor marks the group heard
    s.fake.atStart = false;
    s.fake.start = 1.2;
    s.fake.group = 2;
    s.refresh();
    expect(s.cues()).toEqual([0, 0.5, 1, 1]); // the marked step becomes the cue, nothing moves on
    s.release(64);
    s.press(64);
    expect(s.cues()).toEqual([0, 0.5, 1, 1, 1.5]);
  });

  it('keeps the cue when the piano goes, and picks the walk up where it was when it returns', async () => {
    await connect();
    const s = setup();
    s.press(48, 60);
    expect(s.cues()).toEqual([0, 0.5]);
    s.release(48, 60);
    act(() => link.events!.inputs([]));
    s.refresh();
    expect(s.hook.result.current).toEqual({ active: false, atFirst: false, hint: null });
    expect(s.fake.cue).toBe(0.5);
    act(() => link.events!.inputs(['GO:PIANO']));
    s.refresh();
    expect(s.cues()).toEqual([0, 0.5]);
    s.press(62);
    expect(s.cues()).toEqual([0, 0.5, 1]);
  });

  it('is off after Turn off, with the cue where it was', async () => {
    await connect();
    const s = setup();
    s.press(48, 60);
    act(() => turnOffPiano());
    s.refresh();
    expect(s.hook.result.current.active).toBe(false);
    expect(s.fake.cue).toBe(0.5);
    expect(s.cues()).toEqual([0, 0.5]);
  });
});

describe('moves the walk did not make', () => {
  it('marks the step of a paused cursor, and moves nothing else', async () => {
    await connect();
    const s = setup({}, (f) => {
      f.atStart = false;
      f.start = 0.7; // paused in the second step's note
      f.group = 1;
    });
    expect(s.cues()).toEqual([0.5]);
    expect(s.fake.finish).not.toHaveBeenCalled();
    s.press(62); // the marked step is the one the reader plays
    expect(s.cues()).toEqual([0.5, 1]);
  });

  it('starts at the step after a bar that begins with a rest', async () => {
    await connect();
    const s = setup({}, (f) => {
      f.cue = 1.25; // a seek to a bar start before the note at 1.5
      f.atStart = false;
      f.start = 1.25;
    });
    expect(s.cues()).toEqual([1.5]);
  });

  it('spends the held keys on a seek: they must be pressed again', async () => {
    await connect();
    const s = setup();
    s.press(62); // wrong now, held and fresh
    s.fake.cue = 0.5; // a seek (bar click) to the second step
    s.fake.start = 0.5;
    s.refresh();
    expect(s.cues()).toEqual([0]);
    s.release(62);
    s.press(62);
    expect(s.cues()).toEqual([0, 1]);
  });

  it('spends the held keys when the hands change', async () => {
    await connect();
    const s = setup();
    s.press(60); // half of the first chord
    s.refresh({ mutedHands: ['L'] }); // the first step is now the single 60
    expect(s.cues()).toEqual([0]);
    s.release(60);
    s.press(60);
    expect(s.cues()).toEqual([0, 0.5]);
  });

  it('spends the held keys when a loop is set, and cues the loop first step', async () => {
    await connect();
    const s = setup();
    s.press(62); // not the step in front of the reader, held and fresh
    s.fake.stretch = { from: 0.5, to: 1.5 }; // a loop: Play would start at 0.5, not at the cue
    s.fake.start = 0.5;
    s.fake.pos = 0;
    s.refresh();
    expect(s.cues()).toEqual([0, 0.5]); // 62 is the loop's first step, but its press is used up
    s.release(62);
    s.press(62);
    expect(s.cues()).toEqual([0, 0.5, 1]);
  });
});

describe('a hop to another bar', () => {
  it('does not call the red the first step, nor name its pitches, while the hop is on screen', async () => {
    await connect();
    const s = setup();
    expect(s.hook.result.current).toEqual({ active: true, atFirst: true, hint: 2 });
    // A click on a later bar: the playback is cued there, and the red hops (the walk waits).
    s.fake.cue = 1;
    s.fake.start = 1;
    s.fake.flight = true;
    s.refresh();
    expect(s.hook.result.current).toEqual({ active: true, atFirst: false, hint: null });
    s.fake.flight = false;
    s.refresh();
    expect(s.hook.result.current).toEqual({ active: true, atFirst: false, hint: 1 });
    expect(s.cues()).toEqual([0]); // the walk found the playback cued on that step already
  });
});

describe('a loop', () => {
  it('wraps to the loop first step after its last, and never finishes', async () => {
    await connect();
    const s = setup({}, (f) => {
      f.stretch = { from: 0.5, to: 1.5 }; // the steps at 0.5 and 1
      f.cue = 0.5;
      f.atStart = false;
      f.start = 0.5;
    });
    expect(s.cues()).toEqual([]);
    s.press(62);
    expect(s.cues()).toEqual([1]);
    s.press(64);
    expect(s.cues()).toEqual([1, 0.5]);
    s.release(62, 64);
    s.press(62);
    expect(s.cues()).toEqual([1, 0.5, 1]);
    expect(s.fake.finish).not.toHaveBeenCalled();
  });

  it('puts the red on the loop first step when Play would start outside the loop', async () => {
    await connect();
    const s = setup({}, (f) => {
      f.stretch = { from: 1, to: 2 };
      f.start = 1; // the transport's start: the loop's start
    });
    expect(s.cues()).toEqual([1]);
  });

  it('does nothing where the hands played have no step in the loop', async () => {
    await connect();
    const s = setup({}, (f) => {
      f.stretch = { from: 2.5, to: 3.5 };
      f.start = 2.5;
    });
    expect(s.cues()).toEqual([]);
    expect(s.hook.result.current.hint).toBeNull();
  });
});

describe('the Playwright check', () => {
  it('names the step the red waits on, only in a silent run', async () => {
    await connect();
    const w = window as unknown as { __digitus2Along?: { target(): number[]; index(): number } };
    const plain = setup();
    expect(w.__digitus2Along).toBeUndefined();
    plain.hook.unmount();
    window.history.replaceState(null, '', '/?audio=silent');
    const s = setup();
    expect(w.__digitus2Along?.target()).toEqual([48, 60]);
    expect(w.__digitus2Along?.index()).toBe(0);
    s.press(48, 60);
    expect(w.__digitus2Along?.target()).toEqual([62]);
    expect(w.__digitus2Along?.index()).toBe(1);
    s.fake.playing = true;
    s.refresh();
    expect(w.__digitus2Along?.target()).toEqual([]);
    s.hook.unmount();
    expect(w.__digitus2Along).toBeUndefined();
  });

  it('names a step only while the playback is cued at it', async () => {
    await connect();
    window.history.replaceState(null, '', '/?audio=silent');
    const s = setup();
    const w = window as unknown as { __digitus2Along?: { target(): number[]; index(): number } };
    s.press(48, 60);
    expect(w.__digitus2Along?.target()).toEqual([62]);
    // A seek the walk has not looked at yet: the index still names the step of before.
    s.fake.start = 2;
    s.fake.cue = 2;
    expect(w.__digitus2Along?.index()).toBe(1);
    expect(w.__digitus2Along?.target()).toEqual([]);
    // The align looks at the new position and the step it calls for is named.
    s.refresh();
    expect(w.__digitus2Along?.index()).toBe(4);
    expect(w.__digitus2Along?.target()).toEqual([60]);
    // A cue the playback lost (the finish, a halt) names nothing.
    s.fake.cue = null;
    expect(w.__digitus2Along?.target()).toEqual([]);
  });
});

describe('the keys on the keyboard', () => {
  it('shows each held pitch as a gray bar, and re-renders the keyboard alone', async () => {
    await connect();
    let renders = 0;
    function Parent() {
      renders++;
      return <PianoKeyboard lowMidi={48} highMidi={72} pressed={[]} />;
    }
    const { container } = render(<Parent />);
    expect(container.querySelectorAll('rect.key-held')).toHaveLength(0);
    const before = renders;
    act(() => link.events!.note({ on: true, midi: 60 }, [60]));
    expect(container.querySelectorAll('rect.key-held')).toHaveLength(1);
    act(() => link.events!.note({ on: true, midi: 61 }, [60, 61]));
    act(() => link.events!.note({ on: true, midi: 100 }, [60, 61, 100])); // out of the drawn range
    expect(container.querySelectorAll('rect.key-held')).toHaveLength(2);
    expect(container.querySelector('.is-red')).toBeNull();
    act(() => link.events!.note({ on: false, midi: 60 }, [61, 100]));
    expect(container.querySelectorAll('rect.key-held')).toHaveLength(1);
    expect(renders).toBe(before);
  });
});

// The tests above run against a playback that agrees with itself. These put the walk's own cues
// to the real one: its getters must agree to the walk's slack right after a `cueAt`, or every
// step would count as a move the walk did not make and spend the keys held.
describe('with the real playback', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'AudioContext',
      class {
        currentTime = 100;
        state = 'running';
        close() {
          return Promise.resolve();
        }
      },
    );
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, countIn: false, metronome: false } });
  });
  afterEach(() => vi.unstubAllGlobals());

  function real(shown: Score = score) {
    return renderHook(
      () => {
        const pb = usePlayback(shown);
        const along = usePlayAlong({
          score: shown,
          ready: true,
          playable: true,
          playback: pb,
          mutedHands: [],
          currentGroup: pb.cue !== null ? 0 : -1,
          flightShown: false,
        });
        return { pb, along };
      },
      { wrapper: StrictMode },
    );
  }
  const key = (on: boolean, ...midis: number[]) => {
    for (const midi of midis) {
      if (on) down.add(midi);
      else down.delete(midi);
      act(() => link.events!.note({ on, midi }, heldNow()));
    }
  };

  it('cues the first step and leaves it there', async () => {
    await connect();
    const { result, rerender } = real();
    expect(result.current.pb.cue).toBe(0);
    expect(result.current.pb.atStart).toBe(false);
    expect(result.current.pb.startPerformanceSec()).toBe(0);
    expect(result.current.along).toEqual({ active: true, atFirst: true, hint: 2 });
    rerender();
    rerender();
    expect(result.current.pb.cue).toBe(0);
    expect(result.current.pb.positionSec()).toBe(0);
  });

  it('takes its own cues for its own: an early press still chains', async () => {
    await connect();
    const { result } = real();
    key(true, 62, 64); // the next two steps, before the first
    expect(result.current.pb.cue).toBe(0);
    key(true, 48, 60);
    expect(result.current.pb.startPerformanceSec()).toBe(1.5);
    expect(result.current.pb.cue).toBe(1.5);
    expect(result.current.pb.positionSec()).toBe(1.5);
    expect(result.current.along.hint).toBeNull();
  });

  it('walks on after Play and Pause, with a transport, and uses up what was held through them', async () => {
    await connect();
    const { result } = real();
    key(true, 48, 60);
    expect(result.current.pb.startPerformanceSec()).toBe(0.5);
    act(() => result.current.pb.play());
    await waitFor(() => expect(result.current.pb.playing).toBe(true));
    expect(result.current.along.active).toBe(false);
    key(true, 62); // played while the music plays: not a press for the step Pause leaves
    act(() => result.current.pb.pause());
    expect(result.current.along.active).toBe(true);
    expect(result.current.pb.startPerformanceSec()).toBe(0.5);
    key(false, 62);
    key(true, 62);
    expect(result.current.pb.startPerformanceSec()).toBe(1);
    expect(result.current.pb.cue).toBe(1);
    expect(result.current.pb.positionSec()).toBe(1);
    key(true, 64);
    expect(result.current.pb.startPerformanceSec()).toBe(1.5);
  });

  it('keeps to a loop: the first step of the loop, and round again after its last', async () => {
    await connect();
    const { result } = real();
    act(() => result.current.pb.setLoop({ from: 1, to: 1 })); // the second bar: 2 s to 4 s
    expect(result.current.pb.startPerformanceSec()).toBe(2);
    expect(result.current.pb.cue).toBe(2);
    expect(result.current.pb.positionSec()).toBe(2);
    key(true, 60); // the bar's only step: a one-step loop, round again
    expect(result.current.pb.startPerformanceSec()).toBe(2);
    expect(result.current.pb.ended).toBe(0);
    key(false, 60);
    key(true, 60);
    expect(result.current.pb.ended).toBe(0);
    expect(result.current.pb.cue).toBe(2);
    act(() => result.current.pb.setLoop(null));
    expect(result.current.pb.startPerformanceSec()).toBe(2);
    expect(result.current.along.active).toBe(true);
  });

  it('finishes with the transport end: the top, no cue, one more finish', async () => {
    await connect();
    const { result } = real();
    key(true, 48, 60, 62, 64);
    key(false, 60);
    key(true, 60);
    key(false, 60);
    key(true, 60);
    expect(result.current.pb.ended).toBe(1);
    expect(result.current.pb.atStart).toBe(true);
    // No flight in this view: the red comes back on the first step a frame later.
    await frame();
    expect(result.current.pb.cue).toBe(0);
    expect(result.current.along.atFirst).toBe(true);
  });

  it('stays in the hearing it is in when a seek moves it, before any Play: the arrow key in a repeat', async () => {
    // A path held in a variable stays a file URL (Vite rewrites a literal one into an asset URL).
    const path = '../../../../packages/engine/fixtures/form-repeat.musicxml';
    const repeat = parseMusicXml(readFileSync(new URL(path, import.meta.url), 'utf8')).score;
    const steps = alongSteps(performanceFor(repeat), []); // bars 1 2 | 1 2, a step a bar
    expect(steps.map((step) => step.perfSec)).toEqual([0, 2, 4, 6]);
    await connect();
    const { result } = real(repeat);
    for (const step of steps.slice(0, 2)) {
      key(true, ...step.pitches);
      key(false, ...step.pitches);
    }
    // The red waits on the second hearing of bar 1.
    expect(result.current.pb.startPerformanceSec()).toBe(4);
    expect(result.current.pb.cue).toBe(0);
    // The arrow key and a click on bar 2 are a `seek` to its start: bar 2 of this hearing, the one
    // after the red, not the first hearing of bar 2 (which would send the reader round again).
    act(() => result.current.pb.seek(2));
    expect(result.current.pb.startPerformanceSec()).toBe(6);
    expect(result.current.pb.cue).toBe(2);
    expect(result.current.pb.positionSec()).toBe(2);
    expect(result.current.along.atFirst).toBe(false);
    // The walk stands on that step, and the last step of the piece finishes it.
    expect(result.current.pb.ended).toBe(0);
    key(true, ...steps[3]!.pitches);
    expect(result.current.pb.ended).toBe(1);
  });

  describe('a note between the last step and the render that shows the finish', () => {
    // Bar 1 starts with a rest: the first step is at 0.5 s, not at the top, so the position the
    // finish leaves is not where the first step is cued.
    const pickup = scoreOf([
      { midi: 60, tick: 1 },
      { midi: 62, tick: 2 },
      { midi: 64, tick: 4 },
    ]);
    const burst = (...midis: number[]) =>
      act(() => {
        for (const midi of midis) {
          down.add(midi);
          link.events!.note({ on: true, midi }, heldNow());
        }
      });

    it('does not cue the first step under the finish: the red flies home first', async () => {
      await connect();
      const { result } = real(pickup);
      expect(result.current.pb.cue).toBe(0.5);
      key(true, 60);
      key(true, 62);
      expect(result.current.pb.cue).toBe(2);
      // The last step, and an extra key in the same burst (two MIDI tasks before React renders).
      burst(64, 67);
      expect(result.current.pb.ended).toBe(1);
      expect(result.current.pb.atStart).toBe(true);
      expect(result.current.pb.cue).toBeNull();
      expect(result.current.along.active).toBe(true);
      // A frame later, the red is on the first step, and the extra key was no press for it.
      await frame();
      expect(result.current.pb.cue).toBe(0.5);
      expect(result.current.along.atFirst).toBe(true);
    });

    it('counts a key pressed in that gap for the first step once the red is there', async () => {
      await connect();
      const { result } = real(pickup);
      key(true, 60);
      key(true, 62);
      burst(64, 48);
      expect(result.current.pb.atStart).toBe(true);
      key(false, 64);
      await frame();
      expect(result.current.pb.cue).toBe(0.5);
      expect(result.current.pb.ended).toBe(1);
    });

    it('does not hold the walk when the finish was made from the very start', async () => {
      // One step, played from a playback that is already at the start: nothing changes in
      // `atStart`, so the flag of the finish must not wait for it.
      const one = scoreOf([{ midi: 60, tick: 1 }]);
      await connect();
      const { result } = real(one);
      key(true, 60);
      expect(result.current.pb.ended).toBe(1);
      await frame();
      key(false, 60);
      key(true, 60);
      expect(result.current.pb.ended).toBe(2);
    });
  });
});
