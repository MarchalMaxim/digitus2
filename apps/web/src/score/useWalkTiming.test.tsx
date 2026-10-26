import { midiToSpelling, type Hand, type Note, type Score } from '@digitus2/engine';
import { act, cleanup, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { askForPiano, resetPianoForTests, turnOffPiano } from '../midi/piano.js';
import type { AccessEvents, OpenedAccess } from '../midi/types.js';
import type { PerfRange } from './playAlong.js';
import { usePlayAlong, type WalkTimingEvent } from './usePlayAlong.js';
import type { Playback } from './usePlayback.js';
import { useWalkTiming, type WalkTimingHook, type WalkTimingOptions } from './useWalkTiming.js';
import type * as WalkTimingModule from './walkTiming.js';

// The timing of the waiting walk (issue 192): the hook's listener, bar by bar. The judge itself is
// walkTiming.test.ts; here the hook must hand it the right onsets at the right moments, keep the
// rings and the explanation as section 1.3 and 1.4 of the plan say, and clear them when it must.
// The piano store drives it through a fake lazy chunk, as in usePlayAlong.test.tsx; the clock is
// fake, and every test runs under StrictMode.

const access = vi.hoisted(() => ({
  open: vi.fn<(events: AccessEvents) => Promise<OpenedAccess>>(),
}));
vi.mock('../midi/access.js', () => ({
  openMidiAccess: (events: AccessEvents) => access.open(events),
}));

/** The judge as it is, unless a test makes it throw: for the fault the hook must keep to itself. */
const fault = vi.hoisted(() => ({ judge: false }));
vi.mock('./walkTiming.js', async (importOriginal) => {
  const actual = await importOriginal<typeof WalkTimingModule>();
  return {
    ...actual,
    judgeBar: (...args: Parameters<typeof actual.judgeBar>) => {
      if (fault.judge) throw new Error('judge fault');
      return actual.judgeBar(...args);
    },
  };
});

/** Bars of four quarter notes: divisions 1 and 120 qpm, so a tick is half a second. */
const BAR_TICKS = 4;
const TICK_SEC = 0.5;

let nextId = 0;
function note(midi: number, tick: number, hand: Hand = 'R', ticks = 1): Note {
  const onsetSec = tick * TICK_SEC;
  return {
    id: `n${nextId++}`,
    onsetTick: tick,
    offsetTick: tick + ticks,
    onsetSec,
    offsetSec: onsetSec + ticks * TICK_SEC,
    midi,
    spelling: midiToSpelling(midi),
    hand,
    staff: hand === 'L' ? 2 : 1,
    voice: 1,
    measureIndex: Math.floor(tick / BAR_TICKS),
    isGrace: false,
    chordId: `c${nextId}`,
    sourceIndices: [nextId],
  };
}

function scoreOf(notes: Note[], bars: number): Score {
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
    notes,
  };
}

/**
 * The right hand's quarters, one step each, five bars: 60 62 64 65 | 67 65 64 62 | 60 62 64 65 |
 * 67 65 64 62 | 60 62 64 65.
 */
const MELODY = [60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65];

/** `steps` right-hand quarters over `steps / 4` bars (8, 12 or 20). */
function melody(steps: number): Score {
  return scoreOf(
    MELODY.slice(0, steps).map((midi, tick) => note(midi, tick)),
    steps / BAR_TICKS,
  );
}

/** A fake playback, a new view of it per call; `playing` is the one thing the hook alone reads. */
function makeFake() {
  const f = {
    playing: false,
    /** The piano's samples are loading. */
    loading: false,
    atStart: true,
    cue: null as number | null,
    start: 0,
    cueAt: vi.fn((perfSec: number) => {
      f.cue = perfSec;
      f.atStart = false;
      f.start = perfSec;
    }),
    finish: vi.fn(() => {
      f.cue = null;
      f.atStart = true;
      f.start = 0;
    }),
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
        positionSec: () => f.start,
        startSec: () => f.start,
        startPerformanceSec: () => f.start,
        performanceLoop: (): PerfRange | null => null,
        leadingIn: () => false,
        playingNow: () => f.playing,
        leadInRemainingSec: () => null,
        loop: null,
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

async function connect() {
  access.open.mockImplementation((events) => {
    link.events = events;
    events.inputs(['GO:PIANO']);
    return Promise.resolve({ close: () => {} });
  });
  await act(() => askForPiano());
}

function setNavigator(name: string, value: unknown): void {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
}

function hook(): WalkTimingHook | undefined {
  return (window as unknown as { __digitus2Timing?: WalkTimingHook }).__digitus2Timing;
}

/** The fake clock goes to `ms` (performance.now), the timers due on the way firing. */
function goTo(ms: number): void {
  const now = performance.now();
  if (ms > now) act(() => void vi.advanceTimersByTime(ms - now));
}

/** A key goes down (or up) now: the piano store hears it, with the event time `atMs`. */
function send(on: boolean, midi: number, atMs?: number): void {
  if (on) down.add(midi);
  else down.delete(midi);
  const keys = [...down].sort((a, b) => a - b);
  act(() => link.events!.note({ on, midi, ...(atMs === undefined ? {} : { atMs }) }, keys));
}

/** The first step's time in the scripts below: past zero, so an event time can lead it. */
const BASE = 1000;

interface Setup {
  fake: Fake;
  result: () => ReturnType<typeof useWalkTiming>;
  /** Each render's score and marks, to see what a commit drew. */
  log: { score: Score | null; marks: unknown }[];
  renders: () => number;
  rerender(over?: Partial<WalkTimingOptions>): void;
  /** Where this run's script starts: step i is due at `origin + i * 1000`. */
  restart(): void;
  /**
   * Presses the step's pitch at its time in the script (+ `offsets[i]`; the note's event time is
   * `lag` earlier), then tells the tap it passed, as the walk does at the press.
   */
  walk(indices: number[], o?: { offsets?: Record<number, number>; lag?: number }): void;
  tap(e: WalkTimingEvent): void;
  /** Presses a step's pitch at its time and returns the arrival time, without a tap. */
  press(index: number, offset?: number, lag?: number): number;
  unmount(): void;
}

function setup(over: Partial<WalkTimingOptions> = {}): Setup {
  const fake = makeFake();
  const shown = over.score ?? melody(8);
  let extra: Partial<WalkTimingOptions> = { ...over, score: shown };
  const options = (): WalkTimingOptions => ({
    score: shown,
    ready: true,
    mutedHands: [],
    ...extra,
    playback: fake.view(),
  });
  const log: Setup['log'] = [];
  let renders = 0;
  const rendered = renderHook(
    (o: WalkTimingOptions) => {
      const timing = useWalkTiming(o);
      renders++;
      log.push({ score: o.score, marks: timing.marks });
      return timing;
    },
    { initialProps: options(), wrapper: StrictMode },
  );
  let origin = performance.now() + BASE;
  const press = (index: number, offset = 0, lag = 0): number => {
    goTo(origin + index * 1000 + offset);
    send(true, MELODY[index]!, performance.now() - lag);
    return performance.now();
  };
  const tap = (e: WalkTimingEvent) => act(() => rendered.result.current.tap(e));
  return {
    fake,
    result: () => rendered.result.current,
    log,
    renders: () => renders,
    rerender: (next) => {
      if (next) extra = { ...extra, ...next };
      rendered.rerender(options());
    },
    restart: () => {
      origin = performance.now() + 1000;
    },
    walk: (indices, o = {}) => {
      for (const index of indices) {
        const sinceMs = press(index, o.offsets?.[index] ?? 0, o.lag ?? 0);
        const last = index === shown.notes.length - 1;
        tap({
          kind: 'settled',
          runs: [{ index, sinceMs }],
          at: last ? -1 : index + 1,
          finished: last,
        });
      }
    },
    tap,
    press,
    unmount: () => rendered.unmount(),
  };
}

/** The pieces a rushed bar leaves: one tap of the walk with step 2 sent 400 ms early. */
const RUSH = { 2: -400 };

const initialView = useAppStore.getState().view;

/** The open piece and its Practice tempo, which `tempoFactorOf` reads. */
function openAtTempo(factor: number): void {
  useAppStore.setState((s) => ({
    view: { name: 'score', source: { kind: 'library', slug: 'walk-timing-test' } },
    settings: { ...s.settings, tempoByPiece: { 'piece:walk-timing-test': factor } },
  }));
}

beforeEach(() => {
  fault.judge = false;
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
  window.history.replaceState(null, '', '/?hooks=1');
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

/** The ids of step `i` of a score built by `melody`: its one note's id. */
const idOf = (shown: Score, i: number): string => shown.notes[i]!.id;

describe('the judgement, bar by bar', () => {
  it('judges an even walk of both bars and rings nothing', async () => {
    await connect();
    const s = setup();
    s.walk([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(s.result().marks).toBeNull();
    expect(s.result().explain).toBe(false);
    const judged = hook()!.judged();
    expect(judged.filter((j) => j.bar === 0).map((j) => j.index)).toEqual([2, 3]);
    expect(judged.filter((j) => j.bar === 1).map((j) => j.index)).toEqual([4, 5, 6, 7]);
    expect(judged.every((j) => j.verdict === 'onTime')).toBe(true);
    expect(hook()!.markCount()).toBe(0);
  });

  it('rings a rushed note once the walk has left its bar, and explains the ring', async () => {
    await connect();
    const shown = melody(8);
    const s = setup({ score: shown });
    s.walk([0, 1, 2], { offsets: RUSH });
    expect(s.result().marks).toBeNull(); // the walk is still in bar 0
    expect(s.result().explain).toBe(false);
    s.walk([3], { offsets: RUSH }); // at: 4, the first step of bar 1
    const { marks } = s.result();
    expect(marks).toHaveLength(1);
    expect(marks![0]).toMatchObject({ verdict: 'early', ids: [idOf(shown, 2)] });
    expect(s.result().explain).toBe(true);
    expect(hook()!.markCount()).toBe(1);
    const early = hook()!
      .judged()
      .find((j) => j.verdict === 'early')!;
    expect(early).toMatchObject({ bar: 0, index: 2, tolMs: 250 });
    expect(early.offsetMs).toBeCloseTo(-400, 0);
  });

  it('gives a bar with two early notes one ring, and still reports both', async () => {
    await connect();
    const shown = melody(8);
    const s = setup({ score: shown });
    s.walk([0, 1, 2, 3, 4, 5, 6, 7], { offsets: { 5: -400, 7: -300 } });
    const { marks } = s.result();
    expect(marks).toHaveLength(1);
    expect(marks![0]!.ids).toEqual([idOf(shown, 5)]);
    expect(
      hook()!
        .judged()
        .filter((j) => j.verdict === 'early')
        .map((j) => j.index),
    ).toEqual([5, 7]);
  });

  it('judges a bar the settle crosses from its own onsets, and keeps the next bar open', async () => {
    await connect();
    const shown = melody(8);
    const s = setup({ score: shown });
    s.walk([0, 1]);
    const runs = [2, 3, 4].map((index) => ({
      index,
      sinceMs: s.press(index, index === 2 ? -400 : 0),
    }));
    s.tap({ kind: 'settled', runs, at: 5, finished: false });
    const judged = hook()!.judged();
    expect(judged.map((j) => [j.bar, j.index])).toEqual([
      [0, 2],
      [0, 3],
    ]);
    expect(s.result().marks).toHaveLength(1);
    expect(s.result().marks![0]).toMatchObject({ verdict: 'early', ids: [idOf(shown, 2)] });
    // Bar 1 is open: step 4 is its first onset, and the finish judges the whole bar.
    s.walk([5, 6, 7]);
    expect(
      hook()!
        .judged()
        .filter((j) => j.bar === 1)
        .map((j) => j.index),
    ).toEqual([4, 5, 6, 7]);
  });

  it('keeps the rings of a legato wrap of a one-bar loop', async () => {
    await connect();
    const s = setup();
    s.walk([0, 1, 2], { offsets: RUSH });
    const runs = [3, 0].map((index) => ({ index, sinceMs: s.press(index, 0) }));
    s.tap({ kind: 'settled', runs, at: 1, finished: false });
    expect(s.result().marks).toHaveLength(1);
    expect(s.result().explain).toBe(true);
  });

  it('judges the bar at a loop wrap and starts a new chain', async () => {
    await connect();
    const s = setup();
    s.walk([0, 1, 2], { offsets: RUSH });
    const sinceMs = s.press(3);
    s.tap({
      kind: 'settled',
      runs: [{ index: 3, sinceMs }],
      at: 0,
      finished: false,
    });
    expect(hook()!.judged().length).toBeGreaterThan(0);
    expect(s.result().marks).toHaveLength(1);
    s.restart();
    s.walk([0]);
    const chains = hook()!
      .onsets()
      .map((o) => o.chain);
    expect(chains.at(-1)).toBe(chains[0]! + 1);
  });

  it('judges the last bar at the finish', async () => {
    await connect();
    const s = setup();
    s.walk([0, 1, 2, 3, 4, 5, 6]);
    expect(
      hook()!
        .judged()
        .some((j) => j.bar === 1),
    ).toBe(false);
    s.walk([7]); // finished: true, at: -1
    expect(
      hook()!
        .judged()
        .filter((j) => j.bar === 1)
        .map((j) => j.index),
    ).toEqual([4, 5, 6, 7]);
  });

  it('drops late at the finish: a written rit. is not the reader dragging', async () => {
    await connect();
    const s = setup();
    s.walk([0, 1, 2, 3, 4, 5, 6, 7], { offsets: { 7: 300 } });
    expect(
      hook()!
        .judged()
        .some((j) => j.verdict === 'late'),
    ).toBe(false);
    expect(s.result().marks).toBeNull();
  });

  describe("the piece's last bar at a loop's wrap", () => {
    // A loop over the ending never finishes: the walk wraps from the last step to the loop's
    // first (here step 4), and the last bar is judged at the wrap as it is at the finish.
    const lates = () =>
      hook()!
        .judged()
        .filter((j) => j.verdict === 'late');

    it('drops late: a written rit. is not the reader dragging', async () => {
      await connect();
      const s = setup({ score: melody(12) });
      s.walk([4, 5, 6, 7, 8, 9, 10]);
      const sinceMs = s.press(11, 300);
      s.tap({
        kind: 'settled',
        runs: [{ index: 11, sinceMs }],
        at: 4,
        finished: false,
      });
      expect(
        hook()!
          .judged()
          .filter((j) => j.bar === 2)
          .map((j) => j.index),
      ).toEqual([8, 9, 10]);
      expect(lates()).toEqual([]);
      expect(s.result().marks).toBeNull();
    });

    it('drops late for a legato wrap, which settles the last step and the first together', async () => {
      await connect();
      const s = setup({ score: melody(12) });
      s.walk([4, 5, 6, 7, 8, 9, 10]);
      const runs = [11, 4].map((index) => ({
        index,
        sinceMs: s.press(index, index === 11 ? 300 : 0),
      }));
      s.tap({ kind: 'settled', runs, at: 5, finished: false });
      expect(lates()).toEqual([]);
      expect(s.result().marks).toBeNull();
    });

    it('still rings an early note', async () => {
      await connect();
      const shown = melody(12);
      const s = setup({ score: shown });
      s.walk([4, 5, 6, 7, 8, 9, 10], { offsets: { 9: -400 } });
      const sinceMs = s.press(11, 0);
      s.tap({
        kind: 'settled',
        runs: [{ index: 11, sinceMs }],
        at: 4,
        finished: false,
      });
      expect(s.result().marks).toHaveLength(1);
      expect(s.result().marks![0]).toMatchObject({ verdict: 'early', ids: [idOf(shown, 9)] });
    });

    it('keeps late in a bar that is not one of the last two', async () => {
      await connect();
      const s = setup({ score: melody(20) });
      // A loop over bars 1 and 2 of five wraps at step 7, the end of bar 1.
      s.walk([4, 5, 6]);
      const sinceMs = s.press(7, 300);
      s.tap({
        kind: 'settled',
        runs: [{ index: 7, sinceMs }],
        at: 4,
        finished: false,
      });
      expect(lates().map((j) => j.index)).toEqual([7]);
    });

    it('drops late in the bar before the last, which a loop over the ending wraps at its end', async () => {
      await connect();
      const s = setup({ score: melody(12) });
      // A loop over bars 1 and 2 of three wraps at step 7, the end of bar 1: the last bar but one.
      s.walk([4, 5, 6]);
      const sinceMs = s.press(7, 300);
      s.tap({
        kind: 'settled',
        runs: [{ index: 7, sinceMs }],
        at: 4,
        finished: false,
      });
      expect(
        hook()!
          .judged()
          .filter((j) => j.bar === 1)
          .map((j) => j.index),
      ).toEqual([6]);
      expect(lates()).toEqual([]);
      expect(s.result().marks).toBeNull();
    });
  });

  describe('the last two bars of the piece', () => {
    // A written rit. or rall. slows the end and the tempo map does not carry it, so a reader who
    // slows down as written must not get a late ring in the last bar or the one before it. Five
    // bars of four steps: bar 4 is the last, bar 3 the one before it, bar 2 the third from the end.
    const lates = () =>
      hook()!
        .judged()
        .filter((j) => j.verdict === 'late');
    const through = (last: number): number[] => Array.from({ length: last + 1 }, (_, i) => i);

    it('drops late in the bar before the last', async () => {
      await connect();
      const s = setup({ score: melody(20) });
      s.walk(through(15), { offsets: { 15: 300 } }); // the tap for step 15 leaves bar 3
      expect(
        hook()!
          .judged()
          .filter((j) => j.bar === 3)
          .map((j) => j.index),
      ).toEqual([12, 13, 14]);
      expect(lates()).toEqual([]);
      expect(s.result().marks).toBeNull();
      expect(hook()!.markCount()).toBe(0);
    });

    it('still rings an early note in the bar before the last', async () => {
      await connect();
      const shown = melody(20);
      const s = setup({ score: shown });
      s.walk(through(15), { offsets: { 14: -400 } });
      expect(s.result().marks).toHaveLength(1);
      expect(s.result().marks![0]).toMatchObject({ verdict: 'early', ids: [idOf(shown, 14)] });
    });

    it('still rings a late note in the third bar from the end', async () => {
      await connect();
      const shown = melody(20);
      const s = setup({ score: shown });
      s.walk(through(11), { offsets: { 11: 300 } }); // the tap for step 11 leaves bar 2
      expect(lates().map((j) => [j.bar, j.index])).toEqual([[2, 11]]);
      expect(s.result().marks).toHaveLength(1);
      expect(s.result().marks![0]).toMatchObject({ verdict: 'late', ids: [idOf(shown, 11)] });
    });

    describe('in a repeated piece', () => {
      // The bars as heard: A B | A B | C, the second bar repeating back to the top, so written bar
      // 1 is heard in passes 1 and 3 and the last two passes are 3 and 4. The steps are
      // MELODY's twenty, the first twelve of them written.
      const repeated = (): Score => {
        const written = melody(12);
        return {
          ...written,
          measures: written.measures.map((m, i) =>
            i === 1 ? { ...m, form: { repeatEnd: 2 } } : m,
          ),
        };
      };
      /** The tap for each step from 0 to `last`, in order heard (`walk` takes the written notes for the whole piece). */
      const heard = (s: Setup, last: number, offsets: Record<number, number>) => {
        for (let index = 0; index <= last; index++) {
          const sinceMs = s.press(index, offsets[index] ?? 0);
          s.tap({
            kind: 'settled',
            runs: [{ index, sinceMs }],
            at: index + 1,
            finished: false,
          });
        }
      };

      it('counts the last passes in the order heard', async () => {
        await connect();
        const s = setup({ score: repeated() });
        expect(
          hook()!
            .steps()
            .map((step) => step.bar),
        ).toEqual(Array.from({ length: 20 }, (_, i) => i >> 2));
        heard(s, 15, { 15: 300 }); // pass 3, the second hearing of written bar 1
        expect(
          hook()!
            .judged()
            .filter((j) => j.bar === 3)
            .map((j) => j.index),
        ).toEqual([12, 13, 14]);
        expect(lates()).toEqual([]);
        expect(s.result().marks).toBeNull();
      });

      it('still rings a late note in the first hearing of the same written bar', async () => {
        await connect();
        const shown = repeated();
        const s = setup({ score: shown });
        heard(s, 7, { 7: 300 }); // pass 1: the third from the end
        expect(lates().map((j) => [j.bar, j.index])).toEqual([[1, 7]]);
        expect(s.result().marks).toHaveLength(1);
        expect(s.result().marks![0]).toMatchObject({ verdict: 'late', ids: [idOf(shown, 7)] });
      });
    });
  });

  it('skips a run start that is not finite and starts a new chain after it', async () => {
    await connect();
    const s = setup();
    s.walk([0, 1, 2]);
    s.tap({
      kind: 'settled',
      runs: [{ index: 3, sinceMs: -Infinity }],
      at: 4,
      finished: false,
    });
    s.walk([4]);
    const onsets = hook()!.onsets();
    expect(onsets.map((o) => o.index)).toEqual([0, 1, 2, 4]);
    expect(onsets[3]!.chain).toBe(onsets[2]!.chain + 1);
  });

  it('keeps a fault in the judge in the hook: the walk goes on judging', async () => {
    await connect();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const s = setup();
    fault.judge = true;
    // Leaving bar 0 judges it, and the judge throws.
    expect(() => s.walk([0, 1, 2, 3])).not.toThrow();
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ message: 'judge fault' }));
    expect(hook()!.judged()).toEqual([]);
    fault.judge = false;
    s.restart();
    s.walk([0, 1, 2, 3, 4, 5, 6, 7], { offsets: RUSH });
    expect(hook()!.judged().length).toBeGreaterThan(0);
    expect(s.result().marks).toHaveLength(1);
  });
});

describe('the time of an onset', () => {
  it("is the decisive key's event time", async () => {
    await connect();
    const s = setup();
    const sent: number[] = [];
    for (const index of [0, 1, 2, 3]) {
      const arrival = s.press(index, 0, 40);
      sent.push(arrival - 40);
      s.tap({
        kind: 'settled',
        runs: [{ index, sinceMs: arrival }],
        at: index + 1,
        finished: false,
      });
    }
    expect(
      hook()!
        .onsets()
        .map((o) => o.ms),
    ).toEqual(sent);
  });

  it('is the arrival time when the log has no note-on for it', async () => {
    await connect();
    const s = setup();
    goTo(BASE);
    s.tap({
      kind: 'settled',
      runs: [{ index: 0, sinceMs: performance.now() }],
      at: 1,
      finished: false,
    });
    expect(hook()!.onsets()[0]!.ms).toBe(BASE);
  });

  it('is the last key of a rolled chord for a step of two pitches', async () => {
    await connect();
    const shown = scoreOf([note(60, 0), note(64, 0), ...melody(8).notes.slice(1)], 2);
    const s = setup({ score: shown });
    goTo(BASE);
    send(true, 60, performance.now() - 30);
    goTo(BASE + 12);
    send(true, 64, performance.now() - 30);
    s.tap({
      kind: 'settled',
      runs: [{ index: 0, sinceMs: performance.now() }],
      at: 1,
      finished: false,
    });
    expect(hook()!.onsets()[0]!.ms).toBe(BASE + 12 - 30);
  });
});

describe('the explanation', () => {
  /** A three-bar walk with step 2 rushed: the explanation shows at bar 0's exit. */
  async function rushed() {
    await connect();
    const s = setup({ score: melody(12) });
    s.walk([0, 1, 2, 3], { offsets: RUSH });
    return s;
  }

  it('leaves after two more bars are judged', async () => {
    const s = await rushed();
    expect(s.result().explain).toBe(true);
    s.walk([4, 5, 6, 7]); // the tap for step 7 leaves bar 1: one bar judged since it appeared
    expect(s.result().explain).toBe(true);
    s.walk([8, 9, 10]);
    expect(s.result().explain).toBe(true);
    s.walk([11]); // the finish judges bar 2: two bars
    expect(s.result().explain).toBe(false);
    expect(s.result().marks).toHaveLength(1); // bar 0's ring stays
  });

  it('does not come back for a later rushed bar in the same view', async () => {
    const s = await rushed();
    s.walk([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(s.result().explain).toBe(false);
    s.tap({ kind: 'break' });
    s.restart();
    s.walk([0, 1, 2, 3], { offsets: RUSH });
    expect(s.result().marks).not.toBeNull();
    expect(s.result().explain).toBe(false);
  });

  it('goes with a break, and the rings stay', async () => {
    const s = await rushed();
    s.tap({ kind: 'break' });
    expect(s.result().explain).toBe(false);
    expect(hook()!.markCount()).toBe(1);
    expect(s.result().marks).toHaveLength(1);
  });

  it("clears a bar's rings at its first step passed when it is played again", async () => {
    const s = await rushed();
    s.tap({ kind: 'break' });
    s.restart();
    s.walk([0]);
    expect(s.result().marks).toBeNull();
    expect(hook()!.markCount()).toBe(0);
  });

  it('is said again in a new view, which has not explained it yet', async () => {
    const s = await rushed();
    expect(s.result().explain).toBe(true);
    s.unmount();
    const fresh = setup({ score: melody(12) });
    fresh.walk([0, 1, 2, 3], { offsets: RUSH });
    expect(fresh.result().explain).toBe(true);
  });

  describe('under a line that ranks above it on the status line', () => {
    // The piano loading ranks above the explanation: bars judged while it holds the line are not
    // bars the reader read it in.
    async function held() {
      await connect();
      const s = setup({ score: melody(12) });
      s.fake.loading = true;
      s.rerender();
      return s;
    }
    const free = (s: Awaited<ReturnType<typeof held>>) => {
      s.fake.loading = false;
      s.rerender();
    };

    it('is not spent while the piano loading holds the line', async () => {
      const s = await held();
      s.walk([0, 1, 2, 3], { offsets: RUSH });
      expect(s.result().explain).toBe(true);
      s.walk([4, 5, 6, 7, 8, 9, 10, 11]); // two bars judged, and the line never showed it
      expect(s.result().explain).toBe(true);
      free(s);
      expect(s.result().explain).toBe(true); // it shows now
    });

    it('leaves after two bars judged since the line showed it', async () => {
      const s = await held();
      s.walk([0, 1, 2, 3], { offsets: RUSH });
      s.walk([4, 5, 6, 7]); // judged while the piano loading holds the line
      free(s);
      s.walk([8, 9, 10]);
      expect(s.result().explain).toBe(true);
      s.walk([11]); // the finish judges bar 2: one bar since it showed
      expect(s.result().explain).toBe(true);
      s.restart();
      s.walk([0, 1, 2, 3]); // bar 0 judged: two
      expect(s.result().explain).toBe(false);
    });

    it('is said again after a break that came before it was on the line', async () => {
      const s = await held();
      s.walk([0, 1, 2, 3], { offsets: RUSH });
      expect(s.result().explain).toBe(true);
      s.tap({ kind: 'break' }); // a click on a bar seeks
      free(s);
      expect(s.result().explain).toBe(false);
      s.restart();
      s.walk([0, 1, 2, 3], { offsets: RUSH });
      expect(s.result().explain).toBe(true);
    });

    it('is said again after a clear that came before it was on the line', async () => {
      const s = await held();
      s.walk([0, 1, 2, 3], { offsets: RUSH });
      s.rerender({ mutedHands: ['L', 'R'] }); // a hands change clears
      s.rerender({ mutedHands: ['L'] });
      free(s);
      expect(s.result().explain).toBe(false);
      s.restart();
      s.walk([0, 1, 2, 3], { offsets: RUSH });
      expect(s.result().explain).toBe(true);
    });

    it('is not said again once it has been on the line', async () => {
      await connect();
      const s = setup({ score: melody(12) });
      s.walk([0, 1, 2, 3], { offsets: RUSH });
      s.tap({ kind: 'break' });
      s.restart();
      s.walk([0, 1, 2, 3], { offsets: RUSH });
      expect(s.result().marks).not.toBeNull();
      expect(s.result().explain).toBe(false);
    });
  });
});

describe('the clears', () => {
  it('Play clears the rings, the explanation and the judgements, and the explanation stays gone', async () => {
    await connect();
    const s = setup();
    s.walk([0, 1, 2, 3], { offsets: RUSH });
    expect(s.result().marks).toHaveLength(1);
    s.fake.playing = true;
    s.rerender();
    expect(s.result().marks).toBeNull();
    expect(s.result().explain).toBe(false);
    expect(hook()!.judged()).toEqual([]);
    s.fake.playing = false;
    s.rerender();
    s.restart();
    s.walk([0, 1, 2, 3], { offsets: RUSH });
    expect(s.result().marks).toHaveLength(1);
    expect(s.result().explain).toBe(false);
  });

  it('a new score clears the rings in the very render that brings it', async () => {
    await connect();
    const s = setup();
    s.walk([0, 1, 2, 3], { offsets: RUSH });
    expect(s.result().marks).toHaveLength(1);
    const other = melody(8);
    s.rerender({ score: other });
    const first = s.log.find((entry) => entry.score === other);
    expect(first).toBeDefined();
    expect(first!.marks).toBeNull();
    expect(s.result().marks).toBeNull();
  });

  it('the score leaving ready clears', async () => {
    await connect();
    const s = setup();
    s.walk([0, 1, 2, 3], { offsets: RUSH });
    s.rerender({ ready: false });
    expect(s.result().marks).toBeNull();
    expect(hook()!.judged()).toEqual([]);
  });

  it('Practice mode off clears', async () => {
    await connect();
    const s = setup();
    s.walk([0, 1, 2, 3], { offsets: RUSH });
    act(() => useAppStore.getState().setSettings({ practiceMode: false }));
    expect(s.result().marks).toBeNull();
    expect(hook()!.markCount()).toBe(0);
  });

  it('the setting off clears', async () => {
    await connect();
    const s = setup();
    s.walk([0, 1, 2, 3], { offsets: RUSH });
    act(() => useAppStore.getState().setSettings({ playAlong: false }));
    expect(s.result().marks).toBeNull();
  });

  it('the piano turned off clears', async () => {
    await connect();
    const s = setup();
    s.walk([0, 1, 2, 3], { offsets: RUSH });
    act(() => turnOffPiano());
    expect(s.result().marks).toBeNull();
  });

  it('a hands change clears', async () => {
    await connect();
    const s = setup();
    s.walk([0, 1, 2, 3], { offsets: RUSH });
    s.rerender({ mutedHands: ['L'] });
    expect(s.result().marks).toBeNull();
  });

  it('a seek does not clear', async () => {
    await connect();
    const s = setup();
    s.walk([0, 1, 2, 3], { offsets: RUSH });
    s.tap({ kind: 'break' });
    expect(s.result().marks).toHaveLength(1);
  });
});

describe('the hook around the walk', () => {
  it('renders nothing for a MIDI message', async () => {
    await connect();
    const s = setup();
    s.walk([0, 1]);
    const before = s.renders();
    for (let i = 0; i < 20; i++) send(true, 60 + (i % 5), performance.now());
    expect(s.renders()).toBe(before);
  });

  it('names its steps for the Playwright check, with the hold at the Practice tempo', async () => {
    await connect();
    openAtTempo(0.5);
    const shown = melody(8);
    setup({ score: shown });
    const steps = hook()!.steps();
    expect(steps).toHaveLength(8);
    expect(steps[0]).toEqual({
      perfSec: 0,
      pitches: [60],
      bar: 0,
      writtenBar: 0,
      ids: [idOf(shown, 0)],
      holdMs: 1000,
    });
    expect(steps.map((step) => step.bar)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it('is told nothing, and installs no hook, without ?hooks=1', async () => {
    window.history.replaceState(null, '', '/');
    await connect();
    setup();
    expect(hook()).toBeUndefined();
  });
});

// The walk and its timing together: the hook before usePlayAlong, so its note listener hears each
// key first, and the walk's own taps drive it.
describe('the walk and its timing together', () => {
  /** Eight steps, the first a chord (48 with the left hand played, 60 alone without). */
  const together = scoreOf([note(48, 0, 'L', 4), ...melody(8).notes], 2);

  type Moment = { at: number; on: boolean; midi: number };

  async function walkIt(mutedHands: Hand[]) {
    await connect();
    const fake = makeFake();
    const rendered = renderHook(
      (o: { mutedHands: Hand[] }) => {
        const timing = useWalkTiming({
          score: together,
          ready: true,
          playback: fake.view(),
          mutedHands: o.mutedHands,
        });
        usePlayAlong({
          score: together,
          ready: true,
          playable: true,
          playback: fake.view(),
          mutedHands: o.mutedHands,
          currentGroup: fake.cue === null ? -1 : 0,
          flightShown: false,
          onTiming: timing.tap,
        });
        return timing;
      },
      { initialProps: { mutedHands }, wrapper: StrictMode },
    );
    const refresh = () => rendered.rerender({ mutedHands });
    refresh();
    // The script: step i is pressed 1000 ms after the one before and let go 900 ms after its press;
    // step 2 comes 400 ms ahead, and step 1 is let go after step 2's press (legato).
    const first = mutedHands.length === 0 ? [48, 60] : [60];
    const pitchesOf = (i: number) => (i === 0 ? first : [MELODY[i]!]);
    const press = (i: number) => BASE + i * 1000 + (i === 2 ? -400 : 0);
    const moments: Moment[] = [];
    const decisive: number[] = [];
    for (let i = 0; i < 8; i++) {
      pitchesOf(i).forEach((midi, k) => {
        moments.push({ at: press(i) + k * 10, on: true, midi });
        decisive[i] = press(i) + k * 10 - 30;
      });
      const release = i === 1 ? BASE + 1650 : press(i) + 900;
      for (const midi of pitchesOf(i)) moments.push({ at: release, on: false, midi });
    }
    moments.sort((a, b) => a.at - b.at || Number(a.on) - Number(b.on));
    /** Plays every moment up to `until`, then lets the clock reach it. */
    const run = (until: number) => {
      while (moments.length > 0 && moments[0]!.at <= until) {
        const m = moments.shift()!;
        goTo(m.at);
        send(m.on, m.midi, m.on ? m.at - 30 : undefined);
        refresh();
      }
      goTo(until);
      refresh();
    };
    return { run, result: () => rendered.result.current, decisive, fake };
  }

  it.each([
    ['both hands', [] as Hand[]],
    ['the left hand muted', ['L'] as Hand[]],
  ])('judges both bars from the keys it heard, with %s', async (_name, muted) => {
    const w = await walkIt(muted);
    w.run(BASE + 2999);
    expect(w.result().explain).toBe(false);
    expect(w.result().marks).toBeNull();
    w.run(BASE + 3001); // step 3 passed at its press: the walk left bar 0
    expect(w.result().explain).toBe(true);
    expect(w.result().marks).toHaveLength(1);
    w.run(BASE + 12000);
    const judged = hook()!.judged();
    expect(new Set(judged.map((j) => j.bar))).toEqual(new Set([0, 1]));
    const marks = w.result().marks!;
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({
      verdict: 'early',
      ids: [together.notes.find((n) => n.hand === 'R' && n.onsetTick === 2)!.id],
    });
    const onsets = hook()!.onsets();
    expect(onsets.map((o) => o.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(onsets.map((o) => o.ms)).toEqual(w.decisive);
  });
});
