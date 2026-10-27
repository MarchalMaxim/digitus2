import { readFileSync } from 'node:fs';
import { midiToSpelling, parseMusicXml, type Hand, type Note, type Score } from '@digitus2/engine';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import type * as InstrumentExports from '../audio/instrument.js';
import { performanceFor } from '../audio/performance.js';
import { DUR_SLOW_FALLBACK_MS } from '../design/motion.js';
import { askForPiano, resetPianoForTests, turnOffPiano } from '../midi/piano.js';
import type { AccessEvents, OpenedAccess } from '../midi/types.js';
import { PianoKeyboard } from './PianoKeyboard.js';
import type { Halo } from './halo.js';
import { alongSteps, type PerfRange } from './playAlong.js';
import { usePlayAlong, type PlayAlongOptions, type WalkTimingEvent } from './usePlayAlong.js';
import { usePlayback, type Playback } from './usePlayback.js';

// The play-along's glue (issue 182): the piano store drives the hook through a fake lazy chunk,
// the playback is a fake with a position of its own, and every test runs under StrictMode.
//
// The clock is fake: the levels and the halo run on it. A step passes at the press (issue 204).
// Only the timers and `performance` are faked; microtasks stay real, so the piano connects as it
// does in the app.

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
 * the left hand muted: [60], [62], [64], [60], [60] at the same seconds. Every step is a quarter
 * at 120 qpm, 500 ms (the gap to the next step, and the note's length), and the bass 48 sounds
 * 2000 ms, four beats.
 */
const score = scoreOf([
  { midi: 48, tick: 0, hand: 'L', ticks: 4 },
  { midi: 60, tick: 0 },
  { midi: 62, tick: 1 },
  { midi: 64, tick: 2 },
  { midi: 60, tick: 3 },
  { midi: 60, tick: 4 },
]);

/**
 * Steps [60]@0 (a half note), [62]@1, [64]@1.5, [65]@2 (a half note and a half), with a 0.5 s beat:
 * the first step rings the second with a halo, the quarters ring nothing (issue 204).
 */
const halfScore = scoreOf([
  { midi: 60, tick: 0, ticks: 2 },
  { midi: 62, tick: 2 },
  { midi: 64, tick: 3 },
  { midi: 65, tick: 4, ticks: 4 },
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
  /** Lets `ms` go by, then renders with the fake's state. */
  wait(ms: number): void;
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
    wait: (ms) => {
      elapse(ms);
      refresh();
    },
    cues: () => fake.cueAt.mock.calls.map(([sec]) => sec),
  };
}

/** The hook's result without its store: what the walk shows. */
function seen(h: { active: boolean; atFirst: boolean; hint: unknown }) {
  return { active: h.active, atFirst: h.atFirst, hint: h.hint };
}

/** Lets `ms` of the fake clock go by: the timers due in it fire. */
function elapse(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** One animation frame: what the align waits for when the red flies home. */
const frame = () =>
  act(() => {
    vi.advanceTimersToNextFrame();
  });

const initialView = useAppStore.getState().view;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
  localStorage.clear();
  useAppStore.setState({ view: initialView, settings: { ...DEFAULT_SETTINGS } });
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
  vi.useRealTimers();
});

describe('connecting', () => {
  it('cues the first step once the piano connects, and says what to play', async () => {
    const s = setup();
    expect(seen(s.hook.result.current)).toEqual({
      active: false,
      atFirst: false,
      hint: null,
    });
    expect(s.cues()).toEqual([]);
    await connect();
    s.refresh();
    expect(s.cues()).toEqual([0]);
    expect(seen(s.hook.result.current)).toEqual({
      active: true,
      atFirst: true,
      hint: { count: 2 },
    });
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
  it('moves on at the press of every pitch of the step, and sets no timer', async () => {
    await connect();
    const s = setup();
    s.press(60);
    expect(s.cues()).toEqual([0]); // a chord of two: one key is not the step
    expect(vi.getTimerCount()).toBe(0);
    s.press(48);
    expect(s.cues()).toEqual([0, 0.5]);
    expect(vi.getTimerCount()).toBe(0);
    s.press(62);
    expect(s.cues()).toEqual([0, 0.5, 1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('advances once for one note', async () => {
    await connect();
    const s = setup();
    s.press(48, 60);
    s.wait(500);
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
    s.wait(1000);
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
    s.wait(1000);
    expect(s.cues()).toEqual([0]);
    s.press(48);
    expect(s.cues()).toEqual([0, 0.5]);
  });

  it('chains an early press: one cue to where the chain ends, at the last press', async () => {
    await connect();
    const s = setup();
    s.press(62, 64); // the next two steps, pressed before the first
    expect(s.cues()).toEqual([0]);
    s.press(48);
    expect(s.cues()).toEqual([0]);
    s.press(60);
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
    expect(s.hook.result.current.hint).toEqual({ count: 1 });
    s.press(48);
    s.wait(1000);
    expect(s.cues()).toEqual([0]);
    s.press(60);
    expect(s.cues()).toEqual([0, 0.5]);
  });

  it('shows the hint until the first step is played, and not again', async () => {
    await connect();
    const s = setup();
    expect(s.hook.result.current.hint).toEqual({ count: 2 });
    s.press(48);
    expect(s.hook.result.current.hint).toEqual({ count: 2 }); // one key of two: not played yet
    s.press(60);
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
    s.press(48);
    expect(s.hook.result.current.atFirst).toBe(true);
    s.press(60);
    expect(s.hook.result.current.atFirst).toBe(false);
    expect(s.hook.result.current.active).toBe(true);
  });

  it('never keeps a key that was let go where the walk had no step', async () => {
    await connect();
    const s = setup({}, (f) => {
      f.stretch = { from: 2.5, to: 3.5 }; // the hands played have no step here
      f.start = 2.5;
    });
    expect(s.cues()).toEqual([]);
    s.press(60);
    s.release(60);
    expect(s.hook.result.current.levels.get().size).toBe(0);
    s.fake.stretch = null;
    s.fake.start = 0;
    s.refresh();
    expect(s.cues()).toEqual([0]);
    s.press(48);
    s.wait(500);
    expect(s.cues()).toEqual([0]); // the C let go is not still held
    s.press(60);
    s.wait(500);
    expect(s.cues()).toEqual([0, 0.5]);
  });

  it('never keeps a key that was let go while the playback plays now', async () => {
    await connect();
    const s = setup();
    s.press(60);
    // The playback plays now, before any render shows it: the note is read synchronously.
    s.fake.playing = true;
    down.delete(60);
    act(() => link.events!.note({ on: false, midi: 60 }, heldNow()));
    s.fake.playing = false;
    s.press(48);
    s.wait(500);
    expect(s.cues()).toEqual([0]); // 60 is not still held: the chord is not complete
    s.press(60);
    s.wait(500);
    expect(s.cues()).toEqual([0, 0.5]);
  });
});

// The keys fill over their note's length (issue 185): the store PianoKeyboard reads.
describe('the levels of the held keys', () => {
  it("gives each key of the step its note's length, from its own press", async () => {
    await connect();
    const s = setup();
    const t0 = performance.now();
    s.press(48, 60);
    const levels = s.hook.result.current.levels.get();
    expect(levels.get(48)).toMatchObject({ atMs: t0, lengthMs: 2000, beats: 4, upMs: null });
    expect(levels.get(60)).toMatchObject({ atMs: t0, lengthMs: 500, beats: 1, upMs: null });
    expect(levels.size).toBe(2);
  });

  it('scales the length by the tempo', async () => {
    useAppStore.setState({
      view: { name: 'score', source: { kind: 'library', slug: 'fast' } },
      settings: { ...DEFAULT_SETTINGS, tempoByPiece: { 'piece:fast': 1.5 } },
    });
    await connect();
    const s = setup();
    s.press(60);
    expect(s.hook.result.current.levels.get().get(60)?.lengthMs).toBeCloseTo(500 / 1.5);
  });

  it('gives none to a wrong note, nor to a pitch of the hand left out', async () => {
    await connect();
    const s = setup({ mutedHands: ['L'] });
    s.press(61, 72, 48);
    expect(s.hook.result.current.levels.get().size).toBe(0);
    s.press(60);
    expect([...s.hook.result.current.levels.get().keys()]).toEqual([60]);
  });

  it("gives the next step's pitch its own length when it is pressed early", async () => {
    await connect();
    const s = setup();
    s.wait(120);
    const t = performance.now();
    s.press(62, 64);
    const levels = s.hook.result.current.levels.get();
    expect(levels.get(62)).toMatchObject({ atMs: t, lengthMs: 500, beats: 1 });
    expect(levels.has(64)).toBe(false); // two steps ahead
  });

  it("counts each key's level from its own press, also for a step the chain passes over", async () => {
    await connect();
    const s = setup();
    s.press(48);
    s.wait(100);
    const t = performance.now();
    s.press(64); // two steps ahead: no level yet
    expect(s.hook.result.current.levels.get().has(64)).toBe(false);
    s.wait(100);
    const t2 = performance.now();
    s.press(62); // the next step: its level starts now
    expect(s.hook.result.current.levels.get().get(62)).toMatchObject({ atMs: t2, lengthMs: 500 });
    s.press(60); // the chain passes steps 0, 1 and 2 at once: 64 fills from its own press
    expect(s.cues()).toEqual([0, 1.5]);
    expect(s.hook.result.current.levels.get().get(64)).toMatchObject({ atMs: t, lengthMs: 500 });
  });

  it('keeps the bass filling after the red moves on', async () => {
    await connect();
    const s = setup();
    s.press(48, 60);
    s.wait(500);
    expect(s.cues()).toEqual([0, 0.5]);
    expect(s.hook.result.current.levels.get().has(48)).toBe(true);
    expect(s.hook.result.current.levels.get().has(60)).toBe(true);
  });

  it('drains a key let go before it is full, and drops it after the drain', async () => {
    await connect();
    const s = setup();
    s.press(48, 60);
    s.wait(1000);
    s.release(48); // half of its four beats
    const draining = s.hook.result.current.levels.get().get(48);
    expect(draining?.upMs).not.toBeNull();
    expect(draining?.fromLevel).toBeCloseTo(0.5);
    elapse(DUR_SLOW_FALLBACK_MS - 1);
    expect(s.hook.result.current.levels.get().has(48)).toBe(true);
    elapse(1);
    expect(s.hook.result.current.levels.get().has(48)).toBe(false);
  });

  it('drops it at once under reduced motion', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    await connect();
    const s = setup();
    s.press(48, 60);
    s.wait(1000);
    s.release(48);
    expect(s.hook.result.current.levels.get().has(48)).toBe(false);
  });

  it('drops a full key when it is let go', async () => {
    await connect();
    const s = setup();
    s.press(48, 60);
    s.wait(500);
    s.release(60);
    expect(s.hook.result.current.levels.get().has(60)).toBe(false);
    expect(s.hook.result.current.levels.get().has(48)).toBe(true);
  });

  it('draws a level again from a press during the drain', async () => {
    await connect();
    const s = setup();
    s.press(48);
    s.wait(200);
    s.release(48);
    s.wait(50);
    const t = performance.now();
    s.press(48);
    expect(s.hook.result.current.levels.get().get(48)).toMatchObject({ atMs: t, upMs: null });
  });

  it('clears every level on a seek, and when Play starts', async () => {
    await connect();
    const s = setup();
    s.press(48, 60);
    expect(s.hook.result.current.levels.get().size).toBe(2);
    s.fake.cue = 1; // a seek (bar click) past the step the walk cued
    s.fake.start = 1;
    s.refresh();
    expect(s.hook.result.current.levels.get().size).toBe(0);
    s.fake.cue = 0;
    s.fake.start = 0;
    s.refresh();
    s.release(48, 60);
    s.press(48, 60);
    expect(s.hook.result.current.levels.get().size).toBe(2);
    s.fake.playing = true;
    s.refresh();
    expect(s.hook.result.current.levels.get().size).toBe(0);
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
    frame();
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
    frame();
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
    frame();
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
    frame();
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
    s.press(48, 60); // pressed during the flight: passes once it lands, counted from then
    s.wait(500);
    expect(s.cues()).toEqual([0, 0.5, 1, 1.5, 2]);
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
    expect(seen(s.hook.result.current)).toEqual({
      active: false,
      atFirst: false,
      hint: null,
    });
    s.press(48, 60);
    s.wait(1000);
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
    s.wait(1000);
    expect(s.cues()).toEqual([0]);
  });

  it('does not move the red when the playback plays now, whatever the last render said', async () => {
    await connect();
    const s = setup();
    s.fake.playing = true; // read synchronously by the note, before any render shows it
    s.press(48, 60);
    s.wait(1000);
    expect(s.cues()).toEqual([0]);
  });

  it('keeps a press made during a flight and counts it once the flight lands', async () => {
    await connect();
    const s = setup();
    s.fake.flight = true;
    s.refresh();
    s.press(48, 60);
    s.wait(500);
    expect(s.cues()).toEqual([0]);
    s.fake.flight = false;
    s.refresh();
    expect(s.cues()).toEqual([0, 0.5]);
  });

  it('uses up the keys held through Play and Pause: they are not presses for the next step', async () => {
    await connect();
    const s = setup();
    s.press(48, 60, 62); // waiting on step 3 now
    expect(s.cues()).toEqual([0, 0.5, 1]);
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
    s.wait(1000);
    expect(s.cues()).toEqual([0, 0.5, 1, 1]);
    s.release(64);
    s.press(64);
    expect(s.cues()).toEqual([0, 0.5, 1, 1, 1.5]);
  });

  it('keeps the cue when the piano goes, and picks the walk up where it was when it returns', async () => {
    await connect();
    const s = setup();
    s.press(48, 60);
    s.wait(500);
    expect(s.cues()).toEqual([0, 0.5]);
    s.release(48, 60);
    act(() => link.events!.inputs([]));
    s.refresh();
    expect(seen(s.hook.result.current)).toEqual({
      active: false,
      atFirst: false,
      hint: null,
    });
    expect(s.fake.cue).toBe(0.5);
    act(() => link.events!.inputs(['GO:PIANO']));
    s.refresh();
    expect(s.cues()).toEqual([0, 0.5]);
    s.press(62);
    s.wait(500);
    expect(s.cues()).toEqual([0, 0.5, 1]);
  });

  it('is off after Turn off, with the cue where it was', async () => {
    await connect();
    const s = setup();
    s.press(48, 60);
    s.wait(500);
    act(() => turnOffPiano());
    s.refresh();
    expect(s.hook.result.current.active).toBe(false);
    expect(s.fake.cue).toBe(0.5);
    expect(s.cues()).toEqual([0, 0.5]);
  });

  it('sets no timer, and leaves no level, when the piano goes with a key held', async () => {
    await connect();
    const s = setup();
    s.press(48);
    expect(vi.getTimerCount()).toBe(0);
    act(() => turnOffPiano());
    s.refresh();
    expect(vi.getTimerCount()).toBe(0);
    s.wait(1000);
    expect(s.cues()).toEqual([0]);
    expect(s.hook.result.current.levels.get().size).toBe(0);
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
    s.wait(500);
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
    s.wait(1000);
    expect(s.cues()).toEqual([0]);
    s.release(62);
    s.press(62);
    s.wait(500);
    expect(s.cues()).toEqual([0, 1]);
  });

  it('spends the held keys when the hands change', async () => {
    await connect();
    const s = setup();
    s.press(60); // half of the first chord
    s.refresh({ mutedHands: ['L'] }); // the first step is now the single 60
    s.wait(1000);
    expect(s.cues()).toEqual([0]);
    s.release(60);
    s.press(60);
    s.wait(500);
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
    s.wait(1000);
    expect(s.cues()).toEqual([0, 0.5]); // 62 is the loop's first step, but its press is used up
    s.release(62);
    s.press(62);
    s.wait(500);
    expect(s.cues()).toEqual([0, 0.5, 1]);
  });
});

describe('a hop to another bar', () => {
  it('does not call the red the first step, nor name its pitches, while the hop is on screen', async () => {
    await connect();
    const s = setup();
    expect(seen(s.hook.result.current)).toEqual({
      active: true,
      atFirst: true,
      hint: { count: 2 },
    });
    // A click on a later bar: the playback is cued there, and the red hops (the walk waits).
    s.fake.cue = 1;
    s.fake.start = 1;
    s.fake.flight = true;
    s.refresh();
    expect(seen(s.hook.result.current)).toEqual({
      active: true,
      atFirst: false,
      hint: null,
    });
    s.fake.flight = false;
    s.refresh();
    expect(seen(s.hook.result.current)).toEqual({
      active: true,
      atFirst: false,
      hint: { count: 1 },
    });
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
    s.wait(500);
    expect(s.cues()).toEqual([1]);
    s.press(64);
    s.wait(500);
    expect(s.cues()).toEqual([1, 0.5]);
    s.release(62, 64);
    s.press(62);
    s.wait(500);
    expect(s.cues()).toEqual([1, 0.5, 1]);
    expect(s.fake.finish).not.toHaveBeenCalled();
  });

  it("is at the first step on the loop's first step, and again after the wrap (issue 196)", async () => {
    await connect();
    const s = setup({}, (f) => {
      f.stretch = { from: 0.5, to: 1.5 }; // the steps at 0.5 and 1 are the loop's
      f.cue = 0.5;
      f.atStart = false;
      f.start = 0.5;
    });
    expect(s.hook.result.current.atFirst).toBe(true); // the piece's first step is at 0, outside
    s.press(62);
    s.wait(500);
    expect(s.cues()).toEqual([1]);
    expect(s.hook.result.current.atFirst).toBe(false);
    s.press(64);
    s.wait(500);
    expect(s.cues()).toEqual([1, 0.5]);
    expect(s.hook.result.current.atFirst).toBe(true);
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
    expect(s.hook.result.current.atFirst).toBe(false);
  });
});

describe('the Playwright check', () => {
  type Check = { target(): number[]; index(): number; halo(): number };
  const check = () => (window as unknown as { __digitus2Along?: Check }).__digitus2Along;

  it('names the step the red waits on, only in a silent run', async () => {
    await connect();
    const plain = setup();
    expect(check()).toBeUndefined();
    plain.hook.unmount();
    window.history.replaceState(null, '', '/?audio=silent');
    const s = setup();
    expect(check()?.target()).toEqual([48, 60]);
    expect(check()?.index()).toBe(0);
    expect(check()?.halo()).toBe(0);
    s.press(48, 60);
    expect(check()?.target()).toEqual([62]);
    expect(check()?.index()).toBe(1);
    expect(check()?.halo()).toBe(0);
    s.fake.playing = true;
    s.refresh();
    expect(check()?.target()).toEqual([]);
    expect(check()?.halo()).toBe(0);
    s.hook.unmount();
    expect(check()).toBeUndefined();
  });

  it("reports the halo's length at the Practice tempo, 0 when it is over", async () => {
    useAppStore.setState({
      view: { name: 'score', source: { kind: 'library', slug: 'fast' } },
      settings: { ...DEFAULT_SETTINGS, tempoByPiece: { 'piece:fast': 1.5 } },
    });
    await connect();
    window.history.replaceState(null, '', '/?audio=silent');
    const s = setup({ score: halfScore });
    expect(check()?.halo()).toBe(0);
    s.press(60); // the half note: the halo rings the next step for its gap, 1 s at 150 %
    expect(check()?.halo()).toBeCloseTo(1000 / 1.5, 2);
    s.wait(700);
    expect(check()?.halo()).toBe(0);
  });

  it('names a step only while the playback is cued at it', async () => {
    await connect();
    window.history.replaceState(null, '', '/?audio=silent');
    const s = setup();
    s.press(48, 60);
    expect(check()?.target()).toEqual([62]);
    // A seek the walk has not looked at yet: the index still names the step of before.
    s.fake.start = 2;
    s.fake.cue = 2;
    expect(check()?.index()).toBe(1);
    expect(check()?.target()).toEqual([]);
    expect(check()?.halo()).toBe(0);
    // The align looks at the new position and the step it calls for is named.
    s.refresh();
    expect(check()?.index()).toBe(4);
    expect(check()?.target()).toEqual([60]);
    // A cue the playback lost (the finish, a halt) names nothing.
    s.fake.cue = null;
    expect(check()?.target()).toEqual([]);
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

  // The levels (issue 185) are drawn by the keyboard from the hook's store: a press, a level
  // starting and a level rising render the score view's part (the Parent) not at all; only the
  // red moving does.
  it('fills a held key without re-rendering the view: only the red moving does', async () => {
    await connect();
    const fake = makeFake();
    let renders = 0;
    function Parent() {
      renders++;
      const along = usePlayAlong({
        score,
        ready: true,
        playable: true,
        mutedHands: [],
        playback: fake.view(),
        currentGroup: fake.group ?? (fake.cue === null ? -1 : 0),
        flightShown: fake.flight,
      });
      return <PianoKeyboard lowMidi={48} highMidi={72} pressed={[]} levels={along.levels} />;
    }
    const { container } = render(<Parent />);
    const press = (midi: number) => {
      down.add(midi);
      act(() => link.events!.note({ on: true, midi }, heldNow()));
    };
    expect(fake.cueAt).toHaveBeenCalledWith(0);
    const before = renders;
    press(50); // a wrong note: its bar appears, nothing is asked of it
    expect(container.querySelectorAll('rect.key-held')).toHaveLength(1);
    expect(container.querySelectorAll('rect.key-level')).toHaveLength(0);
    expect(renders).toBe(before);
    press(48); // a key of the step: its level appears
    expect(container.querySelectorAll('rect.key-level')).toHaveLength(1);
    expect(renders).toBe(before);
    for (let i = 0; i < 10; i++) frame(); // rising
    expect(container.querySelectorAll('rect.key-level')).toHaveLength(1);
    expect(renders).toBe(before);
    press(60); // every pitch of the step is down: the red moves
    expect(fake.cueAt).toHaveBeenLastCalledWith(0.5);
    expect(renders).toBeGreaterThan(before);
    expect(container.querySelector('.is-red')).toBeNull();
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
  /** Lets the lazy transport chunk and the (silent) samples load: real I/O, not fake time. */
  const settled = () =>
    act(async () => {
      await vi.dynamicImportSettled();
    });

  it('cues the first step and leaves it there', async () => {
    await connect();
    const { result, rerender } = real();
    expect(result.current.pb.cue).toBe(0);
    expect(result.current.pb.atStart).toBe(false);
    expect(result.current.pb.startPerformanceSec()).toBe(0);
    expect(seen(result.current.along)).toEqual({
      active: true,
      atFirst: true,
      hint: { count: 2 },
    });
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
    for (let i = 0; i < 50 && !result.current.pb.playing; i++) await settled();
    expect(result.current.pb.playing).toBe(true);
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
    elapse(1000);
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
    frame();
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
    /** Keys pressed in the same task, before any render. */
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
      frame();
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
      frame();
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
      frame();
      key(false, 60);
      key(true, 60);
      expect(result.current.pb.ended).toBe(2);
    });
  });
});

// The piano going away, a key pressed under a flight, and a tempo change (issue 185).
describe('lost keys, late levels and a faster tempo', () => {
  it('a lost key leaves the books and drains, and moves nothing', async () => {
    await connect();
    const s = setup();
    s.press(48); // one key of a two-key step
    expect(s.hook.result.current.levels.get().has(48)).toBe(true);
    down.delete(48);
    act(() => link.events!.inputs([]));
    s.refresh();
    expect(s.cues()).toEqual([0]);
    expect(s.hook.result.current.levels.get().size).toBe(0);
    act(() => link.events!.inputs(['GO:PIANO']));
    s.refresh();
    s.press(60); // the other key, after the piano is back: 48 is not still held
    expect(s.cues()).toEqual([0]);
    expect(s.hook.result.current.hint).toEqual({ count: 2 });
  });

  it('a key pressed under a flight longer than its step gets its level when the step passes on landing', async () => {
    await connect();
    const s = setup();
    s.fake.flight = true;
    s.refresh();
    const t0 = performance.now();
    s.press(48, 60);
    s.wait(600);
    s.fake.flight = false;
    s.refresh();
    expect(s.cues()).toEqual([0, 0.5]); // the step passes at the landing
    const levels = s.hook.result.current.levels.get();
    expect(levels.get(48)).toMatchObject({ atMs: t0, lengthMs: 2000, beats: 4, upMs: null });
    expect(levels.get(60)).toMatchObject({ atMs: t0, lengthMs: 500, beats: 1, upMs: null });
  });

  it('at 200 % a hop longer than the note: the keys pressed under it fill from their press', async () => {
    useAppStore.setState({
      view: { name: 'score', source: { kind: 'library', slug: 'double' } },
      settings: { ...DEFAULT_SETTINGS, tempoByPiece: { 'piece:double': 2 } },
    });
    await connect();
    const s = setup();
    s.fake.flight = true;
    s.refresh();
    const t0 = performance.now();
    s.press(48, 60);
    s.wait(300); // longer than the 250 ms note
    s.fake.flight = false;
    s.refresh();
    expect(s.cues()).toEqual([0, 0.5]);
    const levels = s.hook.result.current.levels.get();
    expect(levels.get(48)).toMatchObject({ atMs: t0, lengthMs: 1000, beats: 4 });
    expect(levels.get(60)).toMatchObject({ atMs: t0, lengthMs: 250, beats: 1 });
  });

  it('a key pressed early that a chain passes over gets its level', async () => {
    await connect();
    const s = setup();
    const t0 = performance.now();
    s.press(62, 64);
    s.press(48, 60);
    s.wait(500);
    expect(s.cues()).toEqual([0, 1.5]);
    const levels = s.hook.result.current.levels.get();
    expect(levels.get(62)).toMatchObject({ atMs: t0, lengthMs: 500, beats: 1 });
    expect(levels.get(64)).toMatchObject({ atMs: t0, lengthMs: 500, beats: 1 });
  });

  it('a tempo change sets no timer and moves nothing', async () => {
    useAppStore.setState({
      view: { name: 'score', source: { kind: 'library', slug: 'fast' } },
      settings: { ...DEFAULT_SETTINGS, tempoByPiece: {} },
    });
    await connect();
    const s = setup();
    s.press(48);
    s.wait(100);
    act(() =>
      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, tempoByPiece: { 'piece:fast': 2 } },
      }),
    );
    s.refresh();
    expect(vi.getTimerCount()).toBe(0);
    s.wait(1000);
    expect(s.cues()).toEqual([0]);
  });

  it('spends no key for a tempo change: a key of the step held through it still counts with its partner', async () => {
    useAppStore.setState({
      view: { name: 'score', source: { kind: 'library', slug: 'fast' } },
      settings: { ...DEFAULT_SETTINGS, tempoByPiece: {} },
    });
    await connect();
    const s = setup();
    s.press(48);
    s.wait(100);
    act(() =>
      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, tempoByPiece: { 'piece:fast': 0.5 } },
      }),
    );
    s.refresh();
    s.wait(500);
    expect(s.cues()).toEqual([0]);
    s.press(60);
    expect(s.cues()).toEqual([0, 0.5]);
  });
});

// Practice mode (issue 191): off, the walk is "no piano" and nothing else. The piano stays
// connected (`pianoConnected`), and the one gate is the inactive path of `decide`.
describe('Practice mode (issue 191)', () => {
  const practice = (on: boolean) =>
    act(() => useAppStore.getState().setSettings({ practiceMode: on }));

  it('starts inactive when it is off at mount, with the piano still connected', async () => {
    practice(false);
    await connect();
    const s = setup();
    expect(s.hook.result.current.active).toBe(false);
    expect(s.hook.result.current.pianoConnected).toBe(true);
    expect(s.cues()).toEqual([]);
    expect(s.hook.result.current.hint).toBeNull();
    expect(s.hook.result.current.atFirst).toBe(false);
  });

  it('says the piano is connected only when it is, whatever Practice mode says', async () => {
    const s = setup();
    expect(s.hook.result.current.pianoConnected).toBe(false);
    await connect();
    s.refresh();
    expect(s.hook.result.current.pianoConnected).toBe(true);
    practice(false);
    s.refresh();
    expect(s.hook.result.current.pianoConnected).toBe(true);
    act(() => turnOffPiano());
    s.refresh();
    expect(s.hook.result.current.pianoConnected).toBe(false);
  });

  it('ends the walk when it goes off: the cue stays, no level, no halo', async () => {
    await connect();
    const s = setup();
    s.press(48);
    expect(s.hook.result.current.levels.get().size).toBe(1);
    practice(false);
    s.refresh();
    expect(s.hook.result.current.active).toBe(false);
    expect(s.fake.cue).toBe(0);
    expect(s.hook.result.current.levels.get().size).toBe(0);
    expect(s.hook.result.current.halo).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    s.wait(1000);
    expect(s.cues()).toEqual([0]); // time going by makes no cue
  });

  it('resumes at the red step when it comes on again, and a key held through the switch passes nothing', async () => {
    await connect();
    const s = setup();
    s.press(48); // one key of the first step, held through the switch
    practice(false);
    s.refresh();
    practice(true);
    s.refresh();
    expect(s.hook.result.current.active).toBe(true);
    expect(s.cues()).toEqual([0]); // the red stands on the first step: nothing is cued again
    s.press(60);
    expect(s.cues()).toEqual([0]); // 48 was held through the switch: it is spent
    s.release(48);
    s.press(48);
    expect(s.cues()).toEqual([0, 0.5]); // a fresh press passes
  });

  it('does not count a key pressed while it was off', async () => {
    await connect();
    const s = setup();
    s.press(48, 60);
    s.wait(500);
    practice(false);
    s.refresh();
    s.press(62);
    s.wait(1000);
    expect(s.cues()).toEqual([0, 0.5]);
    practice(true);
    s.refresh();
    s.wait(1000);
    expect(s.cues()).toEqual([0, 0.5]);
    s.release(62);
    s.press(62);
    s.wait(500);
    expect(s.cues()).toEqual([0, 0.5, 1]);
  });

  it('resumes at the paused group after Play then Pause while it was off', async () => {
    practice(false);
    await connect();
    const s = setup();
    s.fake.playing = true;
    s.refresh();
    s.fake.playing = false; // Pause: after the note at 1 s was heard, the cursor marks that group
    s.fake.atStart = false;
    s.fake.start = 1;
    s.fake.group = 2;
    s.refresh();
    expect(s.cues()).toEqual([]);
    practice(true);
    s.refresh();
    expect(s.hook.result.current.active).toBe(true);
    expect(s.cues()).toEqual([1]);
    s.press(64);
    s.wait(500);
    expect(s.cues()).toEqual([1, 1.5]);
  });

  it('names no step to the Playwright check while it is off', async () => {
    window.history.replaceState(null, '', '/?audio=silent');
    const hook = () =>
      (window as unknown as { __digitus2Along?: { target(): number[] } }).__digitus2Along;
    await connect();
    const s = setup();
    expect(hook()?.target()).toEqual([48, 60]);
    practice(false);
    s.refresh();
    expect(hook()?.target()).toEqual([]);
    practice(true);
    s.refresh();
    expect(hook()?.target()).toEqual([48, 60]);
  });
});

// The tap for the walk's timing (issue 192, useWalkTiming.ts): the walk tells what it passed, from
// the press that started each run, and where its own sequence broke. StrictMode doubles the align
// on a mount, which adds `break` calls, so each test clears the mock right before its action and
// counts exactly after it.
describe('the timing tap (issue 192)', () => {
  type Told = Extract<WalkTimingEvent, { kind: 'settled' }>;
  const tapOf = () => vi.fn<(e: WalkTimingEvent) => void>();
  type TapMock = ReturnType<typeof tapOf>;
  const told = (tap: TapMock): WalkTimingEvent[] => tap.mock.calls.map(([e]) => e);
  const passes = (tap: TapMock): Told[] => told(tap).filter((e): e is Told => e.kind === 'settled');
  const breaks = (tap: TapMock): number => told(tap).filter((e) => e.kind === 'break').length;
  const onlyBreaks = (tap: TapMock): boolean => told(tap).every((e) => e.kind === 'break');

  it('tells the steps a look passed, from the press that started the run', async () => {
    await connect();
    const onTiming = tapOf();
    const s = setup({ onTiming });
    onTiming.mockClear();
    const t = performance.now();
    s.press(48, 60);
    expect(told(onTiming)).toEqual([
      { kind: 'settled', runs: [{ index: 0, sinceMs: t }], at: 1, finished: false },
    ]);
  });

  it('tells nothing for a release, a wrong key or a look that passes no step', async () => {
    await connect();
    const onTiming = tapOf();
    const s = setup({ onTiming });
    onTiming.mockClear();
    s.press(48);
    s.press(70);
    s.release(48);
    s.refresh();
    expect(told(onTiming)).toEqual([]);
  });

  it('makes no break while the walk walks: one tell for each pass', async () => {
    await connect();
    const onTiming = tapOf();
    const s = setup({ onTiming });
    onTiming.mockClear();
    const keys = [[48, 60], [62], [64], [60]];
    keys.forEach((midis) => {
      s.press(...midis);
      s.wait(500);
      s.release(...midis);
    });
    expect(breaks(onTiming)).toBe(0);
    expect(passes(onTiming).map((e) => e.runs.map((r) => r.index))).toEqual([[0], [1], [2], [3]]);
    expect(passes(onTiming).map((e) => e.at)).toEqual([1, 2, 3, 4]);
  });

  it('breaks once on a seek', async () => {
    await connect();
    const onTiming = tapOf();
    const s = setup({ onTiming });
    onTiming.mockClear();
    s.fake.cue = 0.5; // a seek (bar click) to the second step
    s.fake.start = 0.5;
    s.refresh();
    expect(told(onTiming)).toEqual([{ kind: 'break' }]);
  });

  it('breaks while Play plays, and once more when Pause gives the walk back', async () => {
    await connect();
    const onTiming = tapOf();
    const s = setup({ onTiming });
    onTiming.mockClear();
    s.fake.playing = true;
    s.refresh();
    expect(told(onTiming).length).toBeGreaterThan(0);
    expect(onlyBreaks(onTiming)).toBe(true);
    onTiming.mockClear();
    s.fake.playing = false;
    s.refresh();
    expect(told(onTiming)).toEqual([{ kind: 'break' }]);
  });

  it('breaks once on a hands change, and once on a loop being set', async () => {
    await connect();
    const onTiming = tapOf();
    const s = setup({ onTiming });
    onTiming.mockClear();
    s.refresh({ mutedHands: ['L'] });
    expect(told(onTiming)).toEqual([{ kind: 'break' }]);
    onTiming.mockClear();
    s.fake.stretch = { from: 0.5, to: 1.5 };
    s.fake.start = 0.5;
    s.fake.pos = 0;
    s.refresh();
    expect(told(onTiming)).toEqual([{ kind: 'break' }]);
  });

  it('breaks when Practice mode goes off and when the piano is turned off', async () => {
    await connect();
    const onTiming = tapOf();
    const s = setup({ onTiming });
    onTiming.mockClear();
    act(() => useAppStore.getState().setSettings({ practiceMode: false }));
    s.refresh();
    expect(told(onTiming).length).toBeGreaterThan(0);
    expect(onlyBreaks(onTiming)).toBe(true);
    act(() => useAppStore.getState().setSettings({ practiceMode: true }));
    s.refresh();
    onTiming.mockClear();
    act(() => turnOffPiano());
    s.refresh();
    expect(told(onTiming).length).toBeGreaterThan(0);
    expect(onlyBreaks(onTiming)).toBe(true);
  });

  it("tells a loop's wrap as a pass, with no break before the next pass", async () => {
    await connect();
    const onTiming = tapOf();
    const s = setup({ onTiming }, (f) => {
      f.stretch = { from: 0.5, to: 1.5 }; // the steps at 0.5 and 1: indices 1 and 2
      f.cue = 0.5;
      f.atStart = false;
      f.start = 0.5;
    });
    onTiming.mockClear();
    s.press(62);
    s.wait(500);
    const t = performance.now();
    s.press(64);
    s.wait(500);
    s.release(62, 64);
    s.press(62);
    s.wait(500);
    expect(breaks(onTiming)).toBe(0);
    const [first, wrap, again] = passes(onTiming);
    expect(first).toMatchObject({ runs: [{ index: 1 }], at: 2, finished: false });
    expect(wrap).toEqual({
      kind: 'settled',
      runs: [{ index: 2, sinceMs: t }],
      at: 1,
      finished: false,
    });
    expect(again).toMatchObject({ runs: [{ index: 1 }], at: 2, finished: false });
    expect(passes(onTiming)).toHaveLength(3);
  });

  it('tells the finish: the last pass has finished set and the red nowhere', async () => {
    await connect();
    const onTiming = tapOf();
    const s = setup({ onTiming });
    onTiming.mockClear();
    s.press(48, 60, 62, 64);
    s.release(60);
    s.press(60);
    s.release(60);
    s.wait(500);
    const t = performance.now();
    s.press(60);
    expect(s.fake.finish).toHaveBeenCalledTimes(1);
    const all = passes(onTiming);
    expect(all.map((e) => e.runs.map((r) => r.index))).toEqual([[0], [1], [2], [3], [4]]);
    expect(all.map((e) => e.finished)).toEqual([false, false, false, false, true]);
    expect(all.at(-1)).toEqual({
      kind: 'settled',
      runs: [{ index: 4, sinceMs: t }],
      at: -1,
      finished: true,
    });
    expect(breaks(onTiming)).toBe(0);
  });

  it('breaks once when the view unmounts', async () => {
    await connect();
    const onTiming = tapOf();
    const s = setup({ onTiming });
    onTiming.mockClear();
    s.hook.unmount();
    expect(told(onTiming)).toEqual([{ kind: 'break' }]);
  });

  it('tells nothing for a press under a flight, and the press time at the landing', async () => {
    await connect();
    const onTiming = tapOf();
    const s = setup({ onTiming });
    s.fake.flight = true;
    s.refresh();
    onTiming.mockClear();
    const t = performance.now();
    s.press(48, 60);
    s.wait(500);
    s.wait(300);
    expect(told(onTiming)).toEqual([]);
    s.fake.flight = false;
    s.refresh();
    expect(told(onTiming)).toEqual([
      { kind: 'settled', runs: [{ index: 0, sinceMs: t }], at: 1, finished: false },
    ]);
  });
});

// The halo (issue 204): a pass whose gap to the next step is longer than a felt beat makes a ring
// around the next step. The render hands it to the drawing only while the playback is cued there.
describe('the halo (issue 204)', () => {
  const halo = (s: Setup) => s.hook.result.current.halo;
  const fastView = () =>
    useAppStore.setState({
      view: { name: 'score', source: { kind: 'library', slug: 'half' } },
      settings: { ...DEFAULT_SETTINGS, tempoByPiece: {} },
    });
  const tempo = (factor: number) =>
    act(() =>
      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, tempoByPiece: { 'piece:half': factor } },
      }),
    );

  it('rings the step after a half note, from the press, for the gap at the Practice tempo', async () => {
    await connect();
    const s = setup({ score: halfScore });
    expect(halo(s)).toBeNull();
    s.wait(120);
    const t = performance.now();
    s.press(60);
    expect(halo(s)).toEqual({ index: 1, startMs: t, ms: 1000, beats: 2 });
    expect(s.cues()).toEqual([0, 1]);
  });

  it('rings nothing after a quarter', async () => {
    await connect();
    const s = setup({ score: halfScore });
    s.press(60);
    expect(halo(s)).not.toBeNull();
    s.press(62);
    expect(halo(s)).toBeNull();
    s.press(64);
    expect(halo(s)).toBeNull();
  });

  it('is twice as long at half the Practice tempo', async () => {
    fastView();
    tempo(0.5);
    await connect();
    const s = setup({ score: halfScore });
    s.press(60);
    expect(halo(s)).toMatchObject({ index: 1, ms: 2000, beats: 2 });
  });

  it('rings nothing at the finish', async () => {
    await connect();
    const s = setup({ score: halfScore });
    s.press(60, 62, 64);
    expect(halo(s)).toBeNull(); // the quarter before the last step
    s.press(65);
    expect(s.fake.finish).toHaveBeenCalledTimes(1);
    expect(halo(s)).toBeNull();
  });

  it("stays through a wrong key, a release and the align's second look", async () => {
    await connect();
    const s = setup({ score: halfScore });
    s.press(60);
    const first = halo(s);
    expect(first).not.toBeNull();
    s.press(70);
    s.release(60);
    s.refresh();
    s.refresh();
    expect(halo(s)).toBe(first);
  });

  it('goes in the render that moves the cue, before the align', async () => {
    await connect();
    const fake = makeFake();
    const log: Array<Halo | null> = [];
    const options = (): PlayAlongOptions => ({
      score: halfScore,
      ready: true,
      playable: true,
      mutedHands: [],
      playback: fake.view(),
      currentGroup: fake.group ?? (fake.cue === null ? -1 : 0),
      flightShown: fake.flight,
    });
    const hook = renderHook(
      (o: PlayAlongOptions) => {
        const along = usePlayAlong(o);
        log.push(along.halo);
        return along;
      },
      { initialProps: options(), wrapper: StrictMode },
    );
    down.add(60);
    act(() => link.events!.note({ on: true, midi: 60 }, heldNow()));
    hook.rerender(options());
    expect(log.at(-1)).not.toBeNull();
    log.length = 0;
    fake.start = 2; // a seek to the last step: the cue is no longer where the halo was made for
    fake.cue = 2;
    hook.rerender(options());
    expect(log.length).toBeGreaterThan(0);
    expect(log[0]).toBeNull(); // the first render after the change, before the align ran
    expect(hook.result.current.halo).toBeNull();
  });

  it('is left as it is by a change of the Practice tempo', async () => {
    fastView();
    await connect();
    const s = setup({ score: halfScore });
    s.press(60);
    const first = halo(s);
    expect(first).toMatchObject({ ms: 1000 });
    tempo(2);
    s.refresh();
    expect(halo(s)).toBe(first);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is ended by a hop to the step the red already waits on', async () => {
    await connect();
    const s = setup({ score: halfScore });
    s.press(60);
    expect(halo(s)).not.toBeNull();
    s.fake.flight = true;
    s.refresh();
    expect(halo(s)).toBeNull();
    s.fake.flight = false;
    s.refresh();
    expect(halo(s)).toBeNull();
  });

  const endings: Array<[string, (s: Setup) => void]> = [
    ['a hands change', (s) => s.refresh({ mutedHands: ['L'] })],
    [
      'a loop change',
      (s) => {
        s.fake.stretch = { from: 1, to: 2 };
        s.fake.start = 1;
        s.fake.pos = 0;
        s.refresh();
      },
    ],
    [
      'Practice mode off',
      (s) => {
        act(() => useAppStore.getState().setSettings({ practiceMode: false }));
        s.refresh();
      },
    ],
    [
      'the piano unplugged',
      (s) => {
        down.clear();
        act(() => link.events!.inputs([]));
        s.refresh();
      },
    ],
    [
      'Play',
      (s) => {
        s.fake.playing = true;
        s.refresh();
      },
    ],
  ];
  for (const [name, end] of endings) {
    it(`goes on ${name}`, async () => {
      await connect();
      const s = setup({ score: halfScore });
      s.press(60);
      expect(halo(s)).not.toBeNull();
      end(s);
      expect(halo(s)).toBeNull();
    });
  }

  it('passes a press made under a hop at the landing, with its halo from the landing', async () => {
    await connect();
    const s = setup({ score: halfScore });
    s.fake.flight = true;
    s.refresh();
    s.press(60);
    expect(halo(s)).toBeNull();
    expect(s.cues()).toEqual([0]); // the mount's align cued the first step
    s.wait(300);
    const landed = performance.now();
    s.fake.flight = false;
    s.refresh();
    expect(s.cues()).toEqual([0, 1]);
    const first = halo(s);
    expect(first).toMatchObject({ index: 1, startMs: landed, ms: 1000 });
    s.refresh();
    expect(halo(s)).toBe(first);
  });

  it("rings the loop's first step from the loop's last, to the loop's end", async () => {
    await connect();
    const s = setup({ score: halfScore }, (f) => {
      f.stretch = { from: 0, to: 3 }; // all four steps; the last is the half note and a half at 2 s
    });
    s.press(60);
    s.press(62);
    s.press(64);
    expect(halo(s)).toBeNull();
    s.press(65);
    expect(halo(s)).toMatchObject({ index: 0, ms: 1000, beats: 2 }); // the gap is 3 - 2 = 1 s
    expect(s.cues()).toEqual([0, 1, 1.5, 2, 0]);
    expect(s.fake.finish).not.toHaveBeenCalled();
  });
});
