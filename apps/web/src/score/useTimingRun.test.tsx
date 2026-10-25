import { midiToSpelling, type Hand, type Note, type Score } from '@digitus2/engine';
import { act, cleanup, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { performanceFor } from '../audio/performance.js';
import type { HeardAt, PassSpan } from '../audio/timeline.js';
import { askForPiano, resetPianoForTests, turnOffPiano } from '../midi/piano.js';
import type { AccessEvents, NoteMessage, OpenedAccess } from '../midi/types.js';
import { judgeRun, timingSteps, type RunJudgement, type TimedPress } from './timing.js';
import type { Playback } from './usePlayback.js';
import { useTimingRun, type TimingHook, type TimingRunOptions } from './useTimingRun.js';

// The timing run's recorder (issue 192): the piano store drives it through a fake lazy chunk, as
// in usePlayAlong.test.tsx, and the playback is a fake whose `playing`, `playingNow`, `heardAt`
// and `runPasses` the test sets. Every test runs under StrictMode. The judge itself is
// timing.test.ts; here the recorder must hand it the right input, at the right moments.

const access = vi.hoisted(() => ({
  open: vi.fn<(events: AccessEvents) => Promise<OpenedAccess>>(),
}));
vi.mock('../midi/access.js', () => ({
  openMidiAccess: (events: AccessEvents) => access.open(events),
}));

/** Bars of four quarter notes: divisions 1 and 120 qpm, so a tick is half a second. */
const BAR_TICKS = 4;
const TICK_SEC = 0.5;

let nextId = 0;
function note(midi: number, tick: number, hand: Hand = 'R'): Note {
  const onsetSec = tick * TICK_SEC;
  return {
    id: `n${nextId++}`,
    onsetTick: tick,
    offsetTick: tick + 1,
    onsetSec,
    offsetSec: onsetSec + TICK_SEC,
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

const PITCHES = [60, 62, 64, 65, 67];

/** Eight right-hand quarters over two bars, the pitches cycling so neighbours differ. */
function makeScore(): Score {
  return {
    meta: {},
    divisions: 1,
    tempoMap: [{ tick: 0, qpm: 120 }],
    timeSignatures: [{ tick: 0, beats: 4, beatType: 4 }],
    keySignatures: [],
    measures: [0, 1].map((i) => ({
      index: i,
      startTick: i * BAR_TICKS,
      lengthTicks: BAR_TICKS,
      number: String(i + 1),
    })),
    notes: Array.from({ length: 8 }, (_, i) => note(PITCHES[i % PITCHES.length]!, i)),
  };
}

const score = makeScore();
const STEPS = timingSteps(performanceFor(score), []);

/** The run's one pass: the whole piece, closed at its end, counted in. */
const PASS = 7;
const RUN: PassSpan[] = [{ pass: PASS, fromSec: 0, toSec: 4, wrapped: false, countedIn: true }];

/** A playback whose run the test plays: `heardAt(atMs)` reads atMs as performance milliseconds. */
function makeFake() {
  const f = {
    playing: false,
    /** What `playingNow()` says; follows `playing` unless set. */
    now: null as boolean | null,
    ended: 0,
    /** usePlayback's `playId`: bumped by `play()`, as every start of the transport does. */
    playId: 0,
    pass: PASS,
    /** The factor `heardAt` reports for the segment in force. */
    factor: 1,
    passes: [] as PassSpan[],
    heardAt: vi.fn((atMs?: number): HeardAt | null =>
      f.playing ? { pass: f.pass, perfSec: (atMs ?? 0) / 1000, factor: f.factor } : null,
    ),
    view(): Playback {
      return {
        playing: f.playing,
        loading: false,
        countIn: null,
        waiting: false,
        atStart: !f.playing,
        ended: f.ended,
        cue: null,
        play: () => {},
        pause: () => {},
        rewind: () => {},
        seek: () => {},
        cueAt: () => {},
        finish: () => {},
        positionSec: () => 0,
        startSec: () => 0,
        startPerformanceSec: () => 0,
        performanceLoop: () => null,
        leadingIn: () => false,
        playingNow: () => f.now ?? f.playing,
        leadInRemainingSec: () => null,
        loop: null,
        setLoop: () => {},
        strike: () => () => undefined,
        prepare: () => {},
        preparing: false,
        soundWaits: false,
        accompany: () => {},
        stopAccompaniment: () => {},
        heardAt: f.heardAt,
        runPasses: () => f.passes.map((p) => ({ ...p })),
        playId: f.playId,
      };
    },
  };
  return f;
}
type Fake = ReturnType<typeof makeFake>;

/** The fake lazy chunk: remembers the events it was given. */
const link = { events: null as AccessEvents | null };

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

interface Setup {
  fake: Fake;
  result: () => ReturnType<typeof useTimingRun>;
  refresh(over?: Partial<TimingRunOptions>): void;
  /** Play: the transport plays, its log is the run's passes. */
  play(passes?: PassSpan[]): void;
  /** The run stops (Pause, the end with `ended`). */
  stop(o?: { ended?: boolean }): void;
  /** A note-on at `perfSec` (heard there), with its message's `atMs`. */
  press(midi: number, perfSec: number): void;
  send(e: NoteMessage): void;
  unmount(): void;
}

function setup(over: Partial<TimingRunOptions> = {}): Setup {
  const fake = makeFake();
  let extra = over;
  const options = (): TimingRunOptions => ({
    score,
    ready: true,
    playable: true,
    mutedHands: [],
    ...extra,
    playback: fake.view(),
  });
  const hook = renderHook((o: TimingRunOptions) => useTimingRun(o), {
    initialProps: options(),
    wrapper: StrictMode,
  });
  const refresh = (next?: Partial<TimingRunOptions>) => {
    if (next) extra = { ...extra, ...next };
    act(() => hook.rerender(options()));
  };
  const send = (e: NoteMessage) => act(() => link.events!.note(e, []));
  return {
    fake,
    result: () => hook.result.current,
    refresh,
    play: (passes = RUN) => {
      fake.playing = true;
      fake.playId++;
      fake.passes = passes.map((p) => ({ ...p, toSec: null }));
      refresh();
      // The transport's log once the run is over (closed by the stop).
      fake.passes = passes.map((p) => ({ ...p }));
    },
    stop: (o = {}) => {
      fake.playing = false;
      if (o.ended) fake.ended++;
      refresh();
    },
    press: (midi, perfSec) => send({ on: true, midi, atMs: perfSec * 1000, velocity: 90 }),
    send,
    unmount: () => hook.unmount(),
  };
}

/** Presses every step at its onset plus `offsets[i]` seconds; null skips the step. */
function pressAll(s: Setup, offsets: (number | null)[] = []): TimedPress[] {
  const out: TimedPress[] = [];
  STEPS.forEach((step, i) => {
    const off = offsets[i] === undefined ? 0 : offsets[i];
    if (off === null) return;
    for (const midi of step.pitches) {
      s.press(midi, step.perfSec + off);
      out.push({ pass: s.fake.pass, perfSec: step.perfSec + off, midi, factor: s.fake.factor });
    }
  });
  return out;
}

/** The marks a judgement gives: the units that were not on time. */
function marksOf(j: RunJudgement) {
  const marks = j.verdicts
    .filter((v) => v.verdict !== 'onTime')
    .map((v) => ({
      ids: v.ids,
      verdict: v.verdict,
      offsetSec: v.offsetSec,
      prev: v.prev,
      next: v.next,
    }));
  return marks.length > 0 ? marks : null;
}

function hook(): TimingHook | undefined {
  return (window as unknown as { __digitus2Timing?: TimingHook }).__digitus2Timing;
}

/** The open piece and its Practice tempo, which `tempoFactorOf` reads as the run's end factor. */
function openAtTempo(factor: number): void {
  useAppStore.setState((s) => ({
    view: { name: 'score', source: { kind: 'library', slug: 'timing-test' } },
    settings: { ...s.settings, tempoByPiece: { 'piece:timing-test': factor } },
  }));
}

/** A run late on step 3 (+0.2 s) and silent on step 5: one `late`, one `missed`. */
const MIXED: (number | null)[] = [0, 0, 0, 0.2, 0, null, 0, 0];

const initialView = useAppStore.getState().view;

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ view: initialView, settings: { ...DEFAULT_SETTINGS } });
  access.open.mockReset();
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

describe('not armed', () => {
  const cases: [string, Partial<TimingRunOptions>, () => Promise<void>][] = [
    ['no piano', {}, async () => {}],
    [
      'Practice mode off',
      {},
      async () => {
        await connect();
        useAppStore.getState().setSettings({ practiceMode: false });
      },
    ],
    ['the document not ready', { ready: false }, connect],
    ['nothing to play', { playable: false }, connect],
  ];
  for (const [name, over, arrange] of cases) {
    it(`records and judges nothing: ${name}`, async () => {
      await arrange();
      const s = setup(over);
      s.play();
      if (link.events) pressAll(s);
      s.stop();
      expect(s.fake.heardAt).not.toHaveBeenCalled();
      expect(s.result()).toEqual({ marks: null, summary: null });
    });
  }
});

describe('a run', () => {
  it('maps each press with heardAt at its own time, and judges the run at its stop', async () => {
    window.history.replaceState(null, '', '/?hooks=1');
    await connect();
    const s = setup();
    s.fake.factor = 0.8; // the segment in force reports 0.8: each offset converts with it
    s.play();
    const presses = pressAll(s, MIXED);
    expect(s.fake.heardAt.mock.calls.map(([atMs]) => atMs)).toEqual(
      presses.map((p) => p.perfSec * 1000),
    );
    // Nothing shows during the run.
    expect(s.result()).toEqual({ marks: null, summary: null });
    s.stop();
    const expected = judgeRun({ steps: STEPS, passes: RUN, presses, factor: 1 })!;
    expect(expected.verdicts.map((v) => v.verdict)).toContain('late');
    expect(expected.verdicts.map((v) => v.verdict)).toContain('missed');
    expect(hook()!.judgement()).toEqual(expected);
    expect(s.result().marks).toEqual(marksOf(expected));
    expect(s.result().summary).toEqual({
      onTime: expected.onTime,
      total: expected.total,
      belowFullTempo: false,
    });
  });

  it('all on time: the summary says so and there are no rings; below 100 % it says so too', async () => {
    await connect();
    openAtTempo(0.75);
    const s = setup();
    s.play();
    pressAll(s);
    s.stop({ ended: true });
    const { summary, marks } = s.result();
    expect(summary).not.toBeNull();
    expect(summary!.onTime).toBe(summary!.total);
    expect(summary!.belowFullTempo).toBe(true);
    expect(marks).toBeNull();

    openAtTempo(1);
    s.play();
    pressAll(s);
    s.stop();
    expect(s.result().summary!.belowFullTempo).toBe(false);
  });

  it('barely played shows nothing', async () => {
    await connect();
    const s = setup();
    s.play();
    pressAll(s, [0, null, null, 0, null, null, 0, null]);
    s.stop();
    expect(s.result()).toEqual({ marks: null, summary: null });
  });

  it('the next Play clears the rings and the summary at once', async () => {
    await connect();
    const s = setup();
    s.play();
    pressAll(s, MIXED);
    s.stop();
    expect(s.result().marks).not.toBeNull();
    expect(s.result().summary).not.toBeNull();
    s.play([{ ...RUN[0]!, pass: PASS + 1 }]);
    expect(s.result()).toEqual({ marks: null, summary: null });
  });

  it('a lost off and a note-off are no presses; a note-on while stopped is logged with no pass', async () => {
    window.history.replaceState(null, '', '/?hooks=1');
    await connect();
    const s = setup();
    s.send({ on: true, midi: 60, atMs: 10 });
    expect(hook()!.presses()).toEqual([
      expect.objectContaining({ midi: 60, atMs: 10, pass: null, perfSec: null, factor: null }),
    ]);
    s.play();
    s.send({ on: false, midi: 60, atMs: 20 });
    s.send({ on: false, midi: 62, lost: true });
    expect(s.fake.heardAt).not.toHaveBeenCalled();
    // The transport is between the end and the render that says so: not playing now.
    s.fake.now = false;
    s.press(64, 1);
    expect(s.fake.heardAt).not.toHaveBeenCalled();
    expect(
      hook()!
        .presses()
        .map((p) => p.pass),
    ).toEqual([null, null]);
    s.fake.now = null;
    s.stop();
    expect(s.result()).toEqual({ marks: null, summary: null });
  });
});

describe('discard and clear', () => {
  /** A run shown, then `change`: the rings and the line go; then a run during which it happens. */
  async function clearsAndDiscards(
    change: (s: Setup) => void | Promise<void>,
    restore: (s: Setup) => void | Promise<void>,
  ) {
    await connect();
    const s = setup();
    s.play();
    pressAll(s, MIXED);
    s.stop();
    expect(s.result().summary).not.toBeNull();
    await change(s);
    expect(s.result()).toEqual({ marks: null, summary: null });
    await restore(s);

    // A run in progress is discarded: its stop judges nothing, armed again or not.
    s.play([{ ...RUN[0]!, pass: PASS + 1 }]);
    s.fake.pass = PASS + 1;
    pressAll(s, MIXED);
    await change(s);
    await restore(s);
    s.stop();
    expect(s.result()).toEqual({ marks: null, summary: null });
  }

  it('a new score', async () => {
    await clearsAndDiscards(
      (s) => s.refresh({ score: { ...score } }),
      () => {},
    );
  });

  it('a change of the hands played', async () => {
    await clearsAndDiscards(
      (s) => s.refresh({ mutedHands: ['L'] }),
      (s) => s.refresh({ mutedHands: [] }),
    );
  });

  it('Practice mode off', async () => {
    await clearsAndDiscards(
      (s) => {
        act(() => useAppStore.getState().setSettings({ practiceMode: false }));
        s.refresh();
      },
      (s) => {
        act(() => useAppStore.getState().setSettings({ practiceMode: true }));
        s.refresh();
      },
    );
  });

  it('the piano gone', async () => {
    await clearsAndDiscards(
      (s) => {
        act(() => turnOffPiano());
        s.refresh();
      },
      async (s) => {
        await connect();
        s.refresh();
      },
    );
  });

  it('the document leaving ready', async () => {
    await clearsAndDiscards(
      (s) => s.refresh({ ready: false }),
      (s) => s.refresh({ ready: true }),
    );
  });

  it('a play carried across "Add notes between" is a new run, judged at its stop', async () => {
    await connect();
    const s = setup();
    s.play();
    pressAll(s, MIXED);
    // The swap: usePlayback halts the old transport and the carry starts a new one in the same
    // commit, so `playing` never turns false; the new run has its own first pass and playId.
    const carried = { ...score };
    const passes: PassSpan[] = [{ ...RUN[0]!, pass: PASS + 1, countedIn: false }];
    s.fake.pass = PASS + 1;
    s.fake.playId++;
    s.fake.passes = passes.map((p) => ({ ...p, toSec: null }));
    s.refresh({ score: carried });
    expect(s.result()).toEqual({ marks: null, summary: null });
    const presses = pressAll(s, MIXED);
    s.fake.passes = passes;
    s.stop();
    const steps = timingSteps(performanceFor(carried), []);
    const expected = judgeRun({ steps, passes, presses, factor: 1 })!;
    expect(expected).not.toBeNull();
    expect(s.result().marks).toEqual(marksOf(expected));
    expect(s.result().summary).toEqual({
      onTime: expected.onTime,
      total: expected.total,
      belowFullTempo: false,
    });
  });

  it('a key between the new score and the carried start counts for the carried run', async () => {
    await connect();
    const s = setup();
    s.play();
    pressAll(s, MIXED);
    // In the app the swap takes two commits: the new score first (the discard; `playing` still
    // true, the same playId), while the new transport already plays its first pass; then the
    // render with the new playId. A key can land between them, heard in the new pass.
    const carried = { ...score };
    const passes: PassSpan[] = [{ ...RUN[0]!, pass: PASS + 1, countedIn: false }];
    s.fake.pass = PASS + 1;
    s.fake.passes = passes.map((p) => ({ ...p, toSec: null }));
    s.refresh({ score: carried });
    const between = pressAll(
      s,
      STEPS.map((_, i) => (i === 0 ? 0 : null)),
    );
    s.fake.playId++;
    s.refresh();
    const rest = pressAll(
      s,
      MIXED.map((off, i) => (i === 0 ? null : off)),
    );
    s.fake.passes = passes;
    s.stop();
    const steps = timingSteps(performanceFor(carried), []);
    const expected = judgeRun({ steps, passes, presses: [...between, ...rest], factor: 1 })!;
    const without = judgeRun({ steps, passes, presses: rest, factor: 1 })!;
    expect(expected.total).not.toBe(without.total);
    expect(s.result().summary).toEqual({
      onTime: expected.onTime,
      total: expected.total,
      belowFullTempo: false,
    });
    expect(s.result().marks).toEqual(marksOf(expected));
  });

  it('Practice mode turned on mid-run does not judge that run', async () => {
    await connect();
    useAppStore.getState().setSettings({ practiceMode: false });
    const s = setup();
    s.play();
    act(() => useAppStore.getState().setSettings({ practiceMode: true }));
    s.refresh();
    pressAll(s);
    s.stop();
    expect(s.result()).toEqual({ marks: null, summary: null });
  });
});

describe('no leak between runs', () => {
  it('a discarded run leaves no presses, and a judged run spends its own', async () => {
    await connect();
    const s = setup();
    // A run discarded by a new score: its presses are gone, even for a log that named its pass.
    s.play();
    pressAll(s);
    s.refresh({ score: { ...score } });
    s.stop();
    s.play();
    s.stop();
    expect(s.result()).toEqual({ marks: null, summary: null });

    // A judged run: its presses are spent, so a later run whose log named the same pass (which
    // the transport never does) has nothing to judge.
    s.play();
    pressAll(s);
    s.stop();
    expect(s.result().summary).not.toBeNull();
    s.play();
    s.stop();
    expect(s.result()).toEqual({ marks: null, summary: null });
  });
});

describe('the test hook', () => {
  it('reads presses, passes, steps, the heard position and the judgement; gone on unmount', async () => {
    window.history.replaceState(null, '', '/?hooks=1');
    await connect();
    const s = setup();
    const h = hook()!;
    expect(h.judgement()).toBeNull();
    expect(h.heardNow()).toBeNull();
    expect(h.steps()).toEqual(
      STEPS.map((step) => ({
        perfSec: step.perfSec,
        pitches: [...step.pitches],
        parts: step.parts.map((p) => ({ hand: p.hand, pitches: [...p.pitches], key: p.key })),
      })),
    );
    s.play();
    expect(h.heardNow()).toEqual(expect.objectContaining({ pass: PASS }));
    pressAll(s);
    expect(h.presses()).toHaveLength(STEPS.length);
    expect(h.presses()[0]).toEqual(
      expect.objectContaining({ midi: 60, atMs: 0, pass: PASS, perfSec: 0, factor: 1 }),
    );
    for (const p of h.presses()) expect(p.arrivalMs).toBeGreaterThan(0);
    s.stop();
    expect(h.passes()).toEqual(RUN);
    expect(h.judgement()).not.toBeNull();
    s.unmount();
    expect(hook()).toBeUndefined();
  });
});
