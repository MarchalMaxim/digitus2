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

// The play-along's other hand (issue 184): at every pass (the press that plays every pitch of a
// step, issue 204) the walk hands the playback the notes digitus plays, from that moment, and stops
// them on every move it did not make. The piano store is driven through a fake lazy chunk and the
// playback is a fake with a position of its own (usePlayAlong.test.tsx has the same); the five
// members of issue 184 are spies. Every test runs under StrictMode.

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
  /** Lets `ms` go by, then renders with the fake's state. */
  wait(ms: number): void;
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
    wait: (ms) => {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
      refresh();
    },
    played: () =>
      fake.accompany.mock.calls.map(([notes]) =>
        notes.map((n): [number, number, Hand] => [n.midi, n.offsetSec, n.hand]),
      ),
  };
}

/** One animation frame: what the align waits for when the red flies home. */
const frame = () =>
  act(() => {
    vi.advanceTimersToNextFrame();
  });

/** Forgets the calls made so far: the mount's own (StrictMode runs an effect twice) and the cue's. */
function forget(f: Fake) {
  f.accompany.mockClear();
  f.stopAccompaniment.mockClear();
  f.prepare.mockClear();
}

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
  vi.useRealTimers();
});

describe('what digitus plays from the press that passes a step', () => {
  it('hands the left hand notes of the stretch to the next step, from the press', async () => {
    await connect();
    const s = setup();
    forget(s.fake);
    s.press(60); // step 0 at 0 s passes: the stretch is [0, 0.5), handed over at the press
    expect(s.played()).toEqual([[[48, 0, 'L']]]);
    expect(s.fake.accompany.mock.calls[0]![0][0]!.durationSec).toBeCloseTo(1, 6); // a half note rings on
    s.wait(500); // time going by hands nothing more over
    expect(s.fake.accompany).toHaveBeenCalledTimes(1);
    s.press(62); // step 1: [0.5, 1)
    expect(s.played()).toEqual([[[48, 0, 'L']], [[43, 0, 'L']]]);
  });

  it('hands the notes over once, at the press, which is the pass', async () => {
    await connect();
    const s = setup();
    forget(s.fake);
    const cuesBefore = s.fake.cueAt.mock.calls.length;
    s.press(60);
    expect(s.fake.accompany).toHaveBeenCalledTimes(1);
    expect(s.fake.cueAt.mock.calls.length).toBe(cuesBefore + 1); // the step passed at the press
    s.wait(500);
    expect(s.fake.cueAt.mock.calls.length).toBe(cuesBefore + 1);
    expect(s.fake.accompany).toHaveBeenCalledTimes(1);
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
  });

  it('keeps playing when the reader lets go: a release stops nothing and hands nothing over', async () => {
    await connect();
    const s = setup();
    forget(s.fake);
    s.press(60);
    s.wait(100);
    s.release(60);
    expect(s.fake.accompany).toHaveBeenCalledTimes(1);
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
    s.wait(50);
    s.refresh();
    expect(s.fake.accompany).toHaveBeenCalledTimes(1);
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
  });

  it("the next step's press drops the notes not started and hands its own stretch over from that press", async () => {
    await connect();
    const s = setup();
    forget(s.fake);
    s.press(60);
    s.wait(100);
    s.press(62); // step 1 passes at this press: its stretch [0.5, 1) starts now
    expect(s.played()).toEqual([[[48, 0, 'L']], [[43, 0, 'L']]]);
    expect(s.fake.accompany).toHaveBeenCalledTimes(2);
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
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
    s.press(60);
    s.wait(500);
    s.press(62);
    s.wait(500);
    s.press(64); // the third step, at 1 s: its stretch [1, 1.5) holds the left hand's 64 and 50
    expect(s.played().at(-1)).toEqual([[50, 0, 'L']]); // the 64 is the reader's own
  });

  it('hands over the last step of a chain that passes in one look, from its pass', async () => {
    await connect();
    const s = setup();
    forget(s.fake);
    s.press(62); // the next step, pressed before the first: nothing passes
    expect(s.fake.accompany).not.toHaveBeenCalled();
    s.press(60); // steps 0 and 1 pass in one look; the red waits on step 2
    // One hand-over, from the last step passed (step 1, at 0.5 s) to step 2, at offset 0.
    expect(s.played()).toEqual([[[43, 0, 'L']]]);
    expect(s.fake.accompany).toHaveBeenCalledTimes(1);
  });

  it('calls accompany before the walk cues, and for a step that does not run not at all', async () => {
    await connect();
    const s = setup();
    forget(s.fake);
    s.press(61); // a wrong note
    s.press(72); // another
    s.wait(1000);
    expect(s.fake.accompany).not.toHaveBeenCalled();
    const cuesBefore = s.fake.cueAt.mock.calls.length;
    s.press(60);
    expect(s.fake.accompany).toHaveBeenCalledTimes(1);
    expect(s.fake.cueAt.mock.calls.length).toBe(cuesBefore + 1);
    s.wait(500);
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
    s.wait(500);
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
    for (const midi of [60, 62, 64, 65, 67, 69, 71]) s.press(midi);
    forget(s.fake);
    s.press(72); // the last step, at 3.5 s: the piece finishes at the press, and the tail goes on
    expect(s.played()).toEqual([[[55, 0, 'L']]]);
    expect(s.fake.finish).toHaveBeenCalledTimes(1);
    expect(s.fake.accompany).toHaveBeenCalledTimes(1);
    // The tail rings to the end of the performance and not past it.
    expect(END_SEC).toBeGreaterThan(3.5);
    expect(s.fake.accompany.mock.invocationCallOrder[0]!).toBeLessThan(
      s.fake.finish.mock.invocationCallOrder[0]!,
    );
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
    // The flight home, then the first step is cued again: the walk's own move.
    frame();
    s.fake.flight = false;
    s.refresh();
    expect(s.fake.cueAt.mock.calls.at(-1)![0]).toBe(0);
    s.refresh();
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
    expect(s.hook.result.current.atFirst).toBe(true);
    // Pressing the first step again during the tail starts its stretch at once: a new stretch.
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
    for (const midi of [60, 62, 64]) {
      s.press(midi);
      s.wait(500);
    }
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

/** The notes of each call as [midi, offsetSec], to the millisecond. */
const rounded = (calls: Array<Array<[number, number, Hand]>>): number[][][] =>
  calls.map((notes) => notes.map(([midi, offset]) => [midi, Math.round(offset * 1000) / 1000]));

describe('a press under a flight', () => {
  it('is handed over once, at the landing, at offset 0', async () => {
    await connect();
    const s = setup();
    s.fake.flight = true;
    s.refresh();
    forget(s.fake);
    s.press(60); // under the flight: kept, nothing passes
    expect(s.fake.accompany).not.toHaveBeenCalled();
    s.wait(300);
    expect(s.fake.accompany).not.toHaveBeenCalled();
    s.fake.flight = false; // it lands: the step passes now
    s.refresh();
    expect(s.played()).toEqual([[[48, 0, 'L']]]);
    expect(s.fake.cueAt.mock.calls.map((c) => c[0])).toContain(0.5);
    s.refresh();
    s.refresh();
    expect(s.fake.accompany).toHaveBeenCalledTimes(1);
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
  });

  it("hands nothing over at the align's second look, nor for a hop that lands on the same step", async () => {
    await connect();
    const s = setup();
    s.press(60);
    forget(s.fake);
    s.refresh();
    s.refresh();
    s.fake.flight = true; // e.g. a hop to the bar the red already waits on
    s.refresh();
    s.wait(100);
    s.fake.flight = false;
    s.refresh();
    expect(s.fake.accompany).not.toHaveBeenCalled();
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
  });

  it('hands a one-step loop over at each pass, and the wrap to the same step nothing more', async () => {
    await connect();
    const s = setup({}, (f) => {
      f.stretch = { from: 1, to: 1.5 };
      f.cue = 1;
      f.atStart = false;
      f.start = 1;
    });
    forget(s.fake);
    s.press(64);
    expect(s.fake.accompany).toHaveBeenCalledTimes(1);
    s.wait(500);
    expect(s.fake.accompany).toHaveBeenCalledTimes(1);
    s.release(64);
    s.press(64);
    expect(s.fake.accompany).toHaveBeenCalledTimes(2);
  });
});

describe('a change of the Practice tempo', () => {
  const initialView = useAppStore.getState().view;
  afterEach(() => useAppStore.setState({ view: initialView }));

  /**
   * Step 0's stretch [0, 0.5) has the 48, the 50 at 0.25 s and the 52 at 0.45 s; step 1's stretch
   * [0.5, 1) has the 43 at its start.
   */
  const RUN = scoreOf([
    ...[60, 62, 64].map((midi, tick) => ({ midi, tick })),
    { midi: 48, tick: 0, hand: 'L' },
    { midi: 50, tick: 0.5, hand: 'L' },
    { midi: 52, tick: 0.9, hand: 'L' },
    { midi: 43, tick: 1, hand: 'L' },
  ]);
  const open = () =>
    useAppStore.setState({
      view: { name: 'score', source: { kind: 'library', slug: 'fast' } },
      settings: { ...DEFAULT_SETTINGS, tempoByPiece: {} },
    });
  const tempo = (factor: number) =>
    act(() =>
      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, tempoByPiece: { 'piece:fast': factor } },
      }),
    );

  it('hands nothing over again; the next pass plays at the new tempo', async () => {
    open();
    await connect();
    const s = setup({ score: RUN });
    forget(s.fake);
    s.press(60);
    expect(rounded(s.played())).toEqual([
      [
        [48, 0],
        [50, 0.25],
        [52, 0.45],
      ],
    ]);
    s.wait(100);
    tempo(2);
    s.refresh();
    expect(s.fake.accompany).toHaveBeenCalledTimes(1);
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
    s.press(62); // the next pass hands its own stretch over, from now; the playback runs it at the tempo
    expect(rounded(s.played()).at(-1)).toEqual([[43, 0]]);
    expect(s.fake.accompany).toHaveBeenCalledTimes(2);
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
  });
});

describe('Practice mode (issue 191)', () => {
  const practice = (on: boolean) =>
    act(() => useAppStore.getState().setSettings({ practiceMode: on }));

  it('stops the other hand once when it goes off, and prepares nothing while it is off', async () => {
    await connect();
    const s = setup();
    s.press(60);
    expect(s.fake.accompany).toHaveBeenCalled();
    forget(s.fake);
    practice(false);
    s.refresh();
    expect(s.hook.result.current.active).toBe(false);
    expect(s.fake.stopAccompaniment).toHaveBeenCalledTimes(1);
    s.refresh();
    s.wait(1000);
    expect(s.fake.stopAccompaniment).toHaveBeenCalledTimes(1);
    expect(s.fake.prepare).not.toHaveBeenCalled();
    expect(s.fake.accompany).not.toHaveBeenCalled();
  });

  it('does not stop it for its own first cue when it comes on again', async () => {
    await connect();
    const s = setup();
    s.press(60);
    practice(false);
    s.refresh();
    forget(s.fake);
    practice(true);
    s.refresh();
    expect(s.hook.result.current.active).toBe(true);
    expect(s.fake.stopAccompaniment).not.toHaveBeenCalled();
  });
});
