import { midiToSpelling, type Hand, type Note, type Score } from '@digitus2/engine';
import { act, cleanup, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import type { AccNote } from '../audio/instrument.js';
import { performanceFor, scoreEndSec } from '../audio/performance.js';
import { askForPiano, resetPianoForTests, turnOffPiano } from '../midi/piano.js';
import type { AccessEvents, OpenedAccess } from '../midi/types.js';
import type { PerfRange } from './playAlong.js';
import { usePlayAlong, type PlayAlongOptions } from './usePlayAlong.js';
import type { Playback } from './usePlayback.js';

// The play-along's other hand (issue 184): after each pass the walk hands the playback the notes
// digitus plays, and stops them on every move it did not make. The piano store is driven through a
// fake lazy chunk and the playback is a fake with a position of its own (usePlayAlong.test.tsx
// has the same); the five members of issue 184 are spies. Every test runs under StrictMode.

const access = vi.hoisted(() => ({
  open: vi.fn<(events: AccessEvents) => Promise<OpenedAccess>>(),
}));
vi.mock('../midi/access.js', () => ({
  openMidiAccess: (events: AccessEvents) => access.open(events),
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
 * Two bars. The right hand has one note a tick (a half second): 60 62 64 65 67 69 71 72, so with
 * the left hand left out its steps are those eight, at 0, 0.5, ... 3.5 seconds. The left hand has
 * 48 (a half note), 43, 64 and 50 together, 45, 41, 47, 52 and 55, one tick each from the first.
 * The 64 is the right hand's own pitch at the same instant: a unison, which digitus leaves out.
 */
const RIGHT = [60, 62, 64, 65, 67, 69, 71, 72];
const piece = scoreOf([
  ...RIGHT.map((midi, tick) => ({ midi, tick })),
  { midi: 48, tick: 0, hand: 'L', ticks: 2 },
  { midi: 43, tick: 1, hand: 'L' },
  { midi: 64, tick: 2, hand: 'L' },
  { midi: 50, tick: 2, hand: 'L' },
  { midi: 45, tick: 3, hand: 'L' },
  { midi: 41, tick: 4, hand: 'L' },
  { midi: 47, tick: 5, hand: 'L' },
  { midi: 52, tick: 6, hand: 'L' },
  { midi: 55, tick: 7, hand: 'L' },
]);
const END_SEC = scoreEndSec(performanceFor(piece).score);

/** The bars a loop state names; the walk reads the stretch in seconds from `performanceLoop`. */
const LOOP_BARS = { from: 0, to: 0 };

/** A playback with a position of its own: `cueAt` and `finish` move it as the real ones do. */
function makeFake() {
  const f = {
    playing: false,
    loading: false,
    atStart: true,
    cue: null as number | null,
    start: 0,
    pos: null as number | null,
    stretch: null as PerfRange | null,
    flight: false,
    flightOnFinish: false,
    soundWaits: false,
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
    prepare: vi.fn<() => void>(),
    accompany: vi.fn<(notes: readonly AccNote[]) => void>(),
    stopAccompaniment: vi.fn<() => void>(),
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
        prepare: f.prepare,
        preparing: false,
        get soundWaits() {
          return f.soundWaits;
        },
        accompany: f.accompany,
        stopAccompaniment: f.stopAccompaniment,
      };
    },
  };
  return f;
}
type Fake = ReturnType<typeof makeFake>;

const link = { events: null as AccessEvents | null };
const down = new Set<number>();
const heldNow = () => [...down].sort((a, b) => a - b);

/** The piano connects, as a press of the home line does. */
async function connect() {
  access.open.mockImplementation((events) => {
    link.events = events;
    events.inputs(['GO:PIANO']);
    return Promise.resolve({ close: () => {} });
  });
  await act(() => askForPiano());
}

interface Setup {
  fake: Fake;
  hook: ReturnType<typeof renderHook<ReturnType<typeof usePlayAlong>, PlayAlongOptions>>;
  refresh(over?: Partial<PlayAlongOptions>): void;
  press(...midis: number[]): void;
  release(...midis: number[]): void;
  /** The notes of each `accompany` call, as [midi, offsetSec, hand]. */
  played(): Array<Array<[number, number, Hand]>>;
}

/** Left hand left out by default: digitus plays it. */
function setup(over: Partial<PlayAlongOptions> = {}, prepare?: (f: Fake) => void): Setup {
  const fake = makeFake();
  prepare?.(fake);
  let extra: Partial<PlayAlongOptions> = { mutedHands: ['L'], ...over };
  const options = (): PlayAlongOptions => ({
    score: piece,
    ready: true,
    playable: true,
    mutedHands: [],
    ...extra,
    playback: fake.view(),
    currentGroup: fake.cue === null ? -1 : 0,
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
    played: () =>
      fake.accompany.mock.calls.map(([notes]) =>
        notes.map((n): [number, number, Hand] => [n.midi, n.offsetSec, n.hand]),
      ),
  };
}

/** One animation frame: what the align waits for when the red flies home. */
const frame = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

/** Forgets the calls made so far: the mount's own (StrictMode runs an effect twice) and the cue's. */
function forget(f: Fake) {
  f.accompany.mockClear();
  f.stopAccompaniment.mockClear();
  f.prepare.mockClear();
}

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  access.open.mockReset();
  down.clear();
  link.events = null;
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    value: () => Promise.reject(new Error('the store never calls this')),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, 'permissions', {
    value: { query: () => Promise.resolve({ state: 'prompt' }) },
    configurable: true,
    writable: true,
  });
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

describe('what digitus plays after a pass', () => {
  it('hands the left hand notes of the stretch to the next step, counted from the press', async () => {
    await connect();
    const s = setup();
    forget(s.fake);
    s.press(60); // step 0 at 0 s: the stretch is [0, 0.5)
    expect(s.played()).toEqual([[[48, 0, 'L']]]);
    expect(s.fake.accompany.mock.calls[0]![0][0]!.durationSec).toBeCloseTo(1, 6); // a half note rings on
    s.press(62); // step 1: [0.5, 1)
    expect(s.played()).toEqual([[[48, 0, 'L']], [[43, 0, 'L']]]);
  });

  it('plays only the hand left out, and the right hand never', async () => {
    await connect();
    const s = setup({ mutedHands: ['R'] });
    forget(s.fake);
    // With the right hand left out the reader plays the left: its first step is [48].
    s.press(48);
    const first = s.played()[0]!;
    expect(first.length).toBeGreaterThan(0);
    expect(first.every(([, , hand]) => hand === 'R')).toBe(true);
    expect(first[0]![0]).toBe(60);
  });

  it('plays nothing, and prepares nothing, when the reader plays both hands', async () => {
    await connect();
    const s = setup({ mutedHands: [] });
    forget(s.fake);
    s.press(60, 48, 62, 64);
    expect(s.hook.result.current.active).toBe(true);
    expect(s.fake.cueAt).toHaveBeenCalled(); // the walk walks
    expect(s.fake.accompany).not.toHaveBeenCalled();
    expect(s.fake.prepare).not.toHaveBeenCalled();
    expect(s.hook.result.current.soundWaits).toBe(false);
  });

  it('leaves out the notes the reader plays: a left hand note in unison with the right hand', async () => {
    await connect();
    const s = setup();
    forget(s.fake);
    s.press(60, 62, 64); // the third step, at 1 s: its stretch [1, 1.5) holds the left hand's 64 and 50
    expect(s.played().at(-1)).toEqual([[50, 0, 'L']]); // the 64 is the reader's own
  });

  it('calls accompany once for a chain, from the last step of it', async () => {
    await connect();
    const s = setup();
    forget(s.fake);
    s.press(62, 64); // the next two steps, pressed before the first: nothing passes
    expect(s.fake.accompany).not.toHaveBeenCalled();
    s.press(60); // steps 0, 1 and 2 pass in one decision; the red waits on step 3
    expect(s.fake.accompany).toHaveBeenCalledTimes(1);
    // From step 2 (1 s) to step 3 (1.5 s): the left hand's 64 is the right hand's own, left out.
    expect(s.played()).toEqual([[[50, 0, 'L']]]);
  });

  it('calls accompany before the walk cues, and for a step that did not pass not at all', async () => {
    await connect();
    const s = setup();
    forget(s.fake);
    s.press(61); // a wrong note
    s.press(72); // another
    expect(s.fake.accompany).not.toHaveBeenCalled();
    const cuesBefore = s.fake.cueAt.mock.calls.length;
    s.press(60);
    expect(s.fake.accompany).toHaveBeenCalledTimes(1);
    expect(s.fake.cueAt.mock.calls.length).toBe(cuesBefore + 1);
    expect(s.fake.accompany.mock.invocationCallOrder[0]!).toBeLessThan(
      s.fake.cueAt.mock.invocationCallOrder.at(-1)!,
    );
  });

  it('runs the align twice and calls nothing twice', async () => {
    await connect();
    const s = setup();
    s.press(60);
    forget(s.fake);
    s.refresh();
    s.refresh();
    expect(s.fake.accompany).not.toHaveBeenCalled();
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
  });
});

describe('a loop', () => {
  it("plays to the loop's end and no further, and nothing of the loop's opening", async () => {
    await connect();
    const s = setup({}, (f) => {
      f.stretch = { from: 1, to: 2 }; // the steps at 1 and 1.5 s
      f.cue = 1;
      f.atStart = false;
      f.start = 1;
    });
    forget(s.fake);
    s.press(64); // step at 1 s: the stretch [1, 1.5)
    expect(s.played()).toEqual([[[50, 0, 'L']]]);
    s.press(65); // the loop's last step wraps to its first: [1.5, 2), then digitus waits
    expect(s.played()).toEqual([[[50, 0, 'L']], [[45, 0, 'L']]]);
    // The 45 starts at 1.5 s and is clipped at the loop's end (2 s): half a second at most.
    expect(s.fake.accompany.mock.calls[1]![0][0]!.durationSec).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(s.fake.finish).not.toHaveBeenCalled();
  });
});

describe('the end', () => {
  it('plays the tail with the finish, and the re-cue of the first step does not stop it', async () => {
    await connect();
    const s = setup();
    s.fake.flightOnFinish = true;
    s.press(60, 62, 64, 65, 67, 69, 71);
    forget(s.fake);
    s.press(72); // the last step, at 3.5 s
    expect(s.fake.finish).toHaveBeenCalledTimes(1);
    expect(s.played()).toEqual([[[55, 0, 'L']]]);
    // The tail rings to the end of the performance and not past it.
    expect(END_SEC).toBeGreaterThan(3.5);
    expect(s.fake.accompany.mock.invocationCallOrder[0]!).toBeLessThan(
      s.fake.finish.mock.invocationCallOrder[0]!,
    );
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
    // The flight home, then the first step is cued again: the walk's own move.
    await frame();
    s.fake.flight = false;
    s.refresh();
    expect(s.fake.cueAt.mock.calls.at(-1)![0]).toBe(0);
    s.refresh();
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
    expect(s.hook.result.current.atFirst).toBe(true);
    // Pressing the first step again during the tail is an early arrival: a new stretch.
    s.press(60);
    expect(s.fake.accompany).toHaveBeenCalledTimes(2);
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
  });
});

describe('what stops it', () => {
  it('stops on a seek, and only once', async () => {
    await connect();
    const s = setup();
    s.press(60);
    forget(s.fake);
    s.fake.cue = 2; // a click on a later bar
    s.fake.start = 2;
    s.refresh();
    expect(s.fake.stopAccompaniment).toHaveBeenCalledTimes(1);
    s.refresh();
    expect(s.fake.stopAccompaniment).toHaveBeenCalledTimes(1);
  });

  it('stops when the hands change', async () => {
    await connect();
    const s = setup();
    s.press(60);
    forget(s.fake);
    s.refresh({ mutedHands: ['R'] });
    expect(s.fake.stopAccompaniment).toHaveBeenCalledTimes(1);
  });

  it('stops when a loop is set or changed', async () => {
    await connect();
    const s = setup();
    s.press(60);
    forget(s.fake);
    s.fake.stretch = { from: 0.5, to: 1.5 };
    s.fake.start = 0.5;
    s.fake.pos = 0;
    s.refresh();
    expect(s.fake.stopAccompaniment).toHaveBeenCalledTimes(1);
    s.fake.stretch = null; // and cleared
    s.refresh();
    expect(s.fake.stopAccompaniment).toHaveBeenCalledTimes(2);
  });

  it('stops when the walk goes inactive after it played, and an idle walk stops nothing', async () => {
    await connect();
    const idle = setup();
    forget(idle.fake);
    idle.fake.playing = true;
    idle.refresh();
    idle.fake.playing = false;
    idle.refresh();
    expect(idle.fake.stopAccompaniment).not.toHaveBeenCalled();
    idle.hook.unmount();
    // (The unmount stops whatever sounds, below.)

    const s = setup();
    s.press(60);
    forget(s.fake);
    s.fake.playing = true; // Play
    s.refresh();
    expect(s.hook.result.current.active).toBe(false);
    expect(s.fake.stopAccompaniment).toHaveBeenCalledTimes(1);
    s.refresh();
    expect(s.fake.stopAccompaniment).toHaveBeenCalledTimes(1);
  });

  it('stops when the piano goes, and when Turn off is pressed', async () => {
    await connect();
    const s = setup();
    s.press(60);
    forget(s.fake);
    act(() => link.events!.inputs([]));
    s.refresh();
    expect(s.hook.result.current.active).toBe(false);
    expect(s.fake.stopAccompaniment).toHaveBeenCalledTimes(1);

    act(() => link.events!.inputs(['GO:PIANO']));
    s.refresh();
    s.press(62); // the red waits on the second step
    expect(s.fake.accompany).toHaveBeenCalled();
    forget(s.fake);
    act(() => turnOffPiano());
    s.refresh();
    expect(s.fake.stopAccompaniment).toHaveBeenCalledTimes(1);
  });

  it('stops when the view is left', async () => {
    await connect();
    const s = setup();
    s.press(60);
    forget(s.fake);
    s.hook.unmount();
    expect(s.fake.stopAccompaniment).toHaveBeenCalledTimes(1);
  });

  it('does not stop when it becomes active, nor for its own first cue', async () => {
    const s = setup();
    forget(s.fake);
    await connect(); // the walk starts: the first step is cued
    s.refresh();
    expect(s.fake.cueAt).toHaveBeenCalledWith(0);
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
  });

  it("does not stop for the walk's own cue", async () => {
    await connect();
    const s = setup();
    forget(s.fake);
    s.press(60, 62, 64);
    s.release(60, 62, 64);
    s.refresh();
    expect(s.fake.cueAt.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
  });
});

describe('the samples', () => {
  it('are prepared while the walk is active with a hand left out, and not otherwise', async () => {
    const s = setup();
    expect(s.fake.prepare).not.toHaveBeenCalled(); // no piano yet
    await connect();
    s.refresh();
    expect(s.fake.prepare).toHaveBeenCalled();
    forget(s.fake);
    s.refresh();
    s.refresh();
    expect(s.fake.prepare).not.toHaveBeenCalled(); // the effect looks again only when something changes

    s.fake.playing = true;
    s.refresh();
    expect(s.fake.prepare).not.toHaveBeenCalled();
    s.refresh({ mutedHands: [] });
    s.fake.playing = false;
    s.refresh();
    expect(s.fake.prepare).not.toHaveBeenCalled(); // both hands: nothing to load for
  });
});

describe('the click the browser asks for', () => {
  it('follows the playback only while the walk is active with a hand to play', async () => {
    await connect();
    const s = setup();
    expect(s.hook.result.current.soundWaits).toBe(false);
    s.fake.soundWaits = true;
    s.refresh();
    expect(s.hook.result.current.soundWaits).toBe(true);
    s.fake.playing = true;
    s.refresh();
    expect(s.hook.result.current.soundWaits).toBe(false);
    s.fake.playing = false;
    s.refresh();
    expect(s.hook.result.current.soundWaits).toBe(true);
    s.refresh({ mutedHands: [] });
    expect(s.hook.result.current.soundWaits).toBe(false);
    s.refresh({ mutedHands: ['L'] });
    expect(s.hook.result.current.soundWaits).toBe(true);
    s.fake.soundWaits = false;
    s.refresh();
    expect(s.hook.result.current.soundWaits).toBe(false);
  });

  it('is false with no piano connected', () => {
    const s = setup();
    s.fake.soundWaits = true;
    s.refresh();
    expect(s.hook.result.current.soundWaits).toBe(false);
  });
});

describe('the Playwright check', () => {
  it('is installed with ?hooks=1 as it is with ?audio=silent', async () => {
    await connect();
    const w = window as unknown as { __digitus2Along?: { target(): number[]; index(): number } };
    window.history.replaceState(null, '', '/?hooks=1');
    const s = setup();
    expect(w.__digitus2Along?.target()).toEqual([60]);
    s.press(60);
    expect(w.__digitus2Along?.target()).toEqual([62]);
    s.hook.unmount();
    expect(w.__digitus2Along).toBeUndefined();
  });
});
