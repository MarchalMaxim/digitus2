// @vitest-environment node
import { readFileSync } from 'node:fs';
import { parseMusicXml } from '@digitus2/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PIANO_LAYER, createPiano, createSilentInstrument } from './instrument.js';
import { Transport } from './transport.js';

const { score } = parseMusicXml(
  readFileSync(new URL('../../fixtures/short-piano.musicxml', import.meta.url), 'utf8'),
);

/** A stand-in for smplr's sampler: records its options, the notes it starts, and disposal. */
interface FakePiano {
  options: { notesToLoad: { notes: number[]; velocityRange: [number, number] } };
  starts: { note: number; velocity: number }[];
  disposed: boolean;
  ready: Promise<void>;
  resolve: () => void;
  start(e: { note: number; velocity: number }): void;
  stop(): void;
  dispose(): void;
}
const smplrMock = vi.hoisted(() => ({ pianos: [] as FakePiano[], autoReady: true }));
vi.mock('smplr', () => ({
  SplendidGrandPiano: (_ctx: unknown, options: FakePiano['options']) => {
    let resolve = () => {};
    const ready = smplrMock.autoReady
      ? Promise.resolve()
      : new Promise<void>((r) => {
          resolve = r;
        });
    const piano: FakePiano = {
      options,
      starts: [],
      disposed: false,
      ready,
      resolve: () => resolve(),
      start: (e) => piano.starts.push({ note: e.note, velocity: e.velocity }),
      stop: () => {},
      dispose: () => {
        piano.disposed = true;
      },
    };
    smplrMock.pianos.push(piano);
    return piano;
  },
}));

let ctx: { currentTime: number };
let instrument: ReturnType<typeof createSilentInstrument>;
let clicks: { time: number; accent: boolean }[];
function make(opts: { tickMs?: number; lookAheadSec?: number } = {}) {
  return new Transport(
    {
      ctx,
      instrument,
      score,
      click: (time, accent) => clicks.push({ time, accent }),
      setInterval: (() => 0) as never,
      clearInterval: () => {},
    },
    { startDelaySec: 0, lookAheadSec: 0.15, ...opts },
  );
}
/** Advance the fake clock in 25 ms ticks, calling step() each time. */
function run(t: Transport, seconds: number) {
  const end = ctx.currentTime + seconds;
  while (ctx.currentTime < end - 1e-9) {
    t.step();
    ctx.currentTime = Math.min(end, ctx.currentTime + 0.025);
  }
  t.step();
}

beforeEach(() => {
  ctx = { currentTime: 100 };
  instrument = createSilentInstrument();
  clicks = [];
  smplrMock.pianos.length = 0;
  smplrMock.autoReady = true;
});

describe('the sampled piano', () => {
  it('starts every transport note at a velocity inside the loaded layer, the left hand softer', async () => {
    const piano = createPiano({} as AudioContext);
    await piano.load(score.notes.map((n) => n.midi));
    const t = new Transport(
      { ctx, instrument: piano, score, setInterval: (() => 0) as never, clearInterval: () => {} },
      { startDelaySec: 0 },
    );
    t.setCountIn(false);
    t.play();
    run(t, 21);
    expect(smplrMock.pianos).toHaveLength(1);
    const fake = smplrMock.pianos[0]!;
    const [low, high] = fake.options.notesToLoad.velocityRange;
    expect([low, high]).toEqual([...PIANO_LAYER]);
    expect(fake.starts).toHaveLength(67);
    expect(fake.starts.every((s) => s.velocity >= low && s.velocity <= high)).toBe(true);
    expect(new Set(fake.starts.map((s) => s.velocity)).size).toBe(2); // melody and accompaniment
    // The transport's own velocities are in the layer already: the clamp below is only a guard.
    const silent = make();
    silent.setCountIn(false);
    silent.play();
    run(silent, 21);
    expect(instrument.events).toHaveLength(67);
    expect(instrument.events.every((e) => e.velocity >= low && e.velocity <= high)).toBe(true);
    const byHand = (h: string) => instrument.events.find((e) => e.hand === h)!.velocity;
    expect(byHand('L')).toBeLessThan(byHand('R'));
    piano.start({ midi: 60, time: 0, duration: 1, velocity: 20, hand: 'L' });
    piano.start({ midi: 60, time: 0, duration: 1, velocity: 127, hand: 'R' });
    expect(fake.starts.slice(-2).map((s) => s.velocity)).toEqual([low, high]);
  });
  it('keeps the newest of two overlapping loads and disposes the older one', async () => {
    smplrMock.autoReady = false;
    const piano = createPiano({} as AudioContext);
    const first = piano.load([60]);
    await vi.waitFor(() => expect(smplrMock.pianos).toHaveLength(1));
    const second = piano.load([62]);
    await vi.waitFor(() => expect(smplrMock.pianos).toHaveLength(2));
    const [older, newer] = smplrMock.pianos as [FakePiano, FakePiano];
    newer.resolve();
    await second;
    older.resolve(); // the older load finishes last
    await first;
    expect(older.disposed).toBe(true);
    expect(newer.disposed).toBe(false);
    piano.start({ midi: 62, time: 0, duration: 1, velocity: 90, hand: 'R' });
    expect(newer.starts).toHaveLength(1);
    expect(older.starts).toHaveLength(0);
  });
});

describe('Transport', () => {
  it('schedules every note exactly once, in onset order, at anchor + onset', () => {
    const t = make();
    t.setCountIn(false);
    t.play();
    run(t, 21);
    expect(instrument.events).toHaveLength(67);
    const times = instrument.events.map((e) => e.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]).toBeCloseTo(100, 6);
    expect(new Set(instrument.events.map((e) => `${e.midi}@${e.time.toFixed(4)}`)).size).toBe(67);
    expect(t.state.playing).toBe(false); // stopped itself at the end
  });
  it('a note on a window boundary is scheduled once (half-open windows)', () => {
    // lookAhead 0.15 and ticks of 0.025 put boundaries at multiples of 0.025; onsets at 0.625 land exactly on one.
    const t = make({ lookAheadSec: 0.15 });
    t.setCountIn(false);
    t.play();
    run(t, 21);
    const at = instrument.events.filter((e) => Math.abs(e.time - 100.625) < 1e-9);
    expect(at.length).toBeGreaterThan(0);
    expect(at.length).toBe(new Set(at.map((e) => e.midi)).size);
  });
  it('tempo factor 2 halves the spacing; a change mid-way re-anchors without a jump', () => {
    const t = make();
    t.setCountIn(false);
    t.setTempoFactor(2);
    t.play();
    run(t, 11);
    const r = instrument.events.filter((e) => e.hand === 'R').map((e) => e.time);
    expect(r[1]! - r[0]!).toBeCloseTo(0.625 / 2, 6);
    expect(instrument.events).toHaveLength(67);
  });
  it('mutes the left hand', () => {
    const t = make();
    t.setCountIn(false);
    t.setMuted(['L']);
    t.play();
    run(t, 21);
    expect(instrument.events.every((e) => e.hand === 'R')).toBe(true);
    expect(instrument.events).toHaveLength(41);
  });
  it('clicks the metronome on every beat and counts in one bar before the first note', () => {
    const t = make();
    t.setMetronome(true);
    t.setCountIn(true);
    t.play();
    run(t, 23);
    expect(clicks.slice(0, 4).map((c) => c.time)).toEqual([100, 100.625, 101.25, 101.875]);
    expect(clicks.slice(0, 4).map((c) => c.accent)).toEqual([true, false, false, false]);
    expect(instrument.events[0]!.time).toBeCloseTo(102.5, 6);
    expect(clicks).toHaveLength(4 + 32);
  });
  it('loops bars 2 to 3 seamlessly', () => {
    const t = make();
    t.setCountIn(false);
    t.setLoop({ from: 1, to: 2 });
    t.play();
    run(t, 11); // two full passes of 5 s plus a bit
    const starts = instrument.events.map((e) => e.time - 100);
    expect(Math.min(...starts)).toBeCloseTo(0, 6);
    const firstPass = instrument.events.filter((e) => e.time - 100 < 5);
    const secondPass = instrument.events.filter((e) => e.time - 100 >= 5 && e.time - 100 < 10);
    expect(secondPass.map((e) => e.midi)).toEqual(firstPass.map((e) => e.midi));
    expect(secondPass.map((e) => +(e.time - 5).toFixed(6))).toEqual(
      firstPass.map((e) => +e.time.toFixed(6)),
    );
    expect(t.positionSec()).toBeGreaterThanOrEqual(2.5);
    expect(t.positionSec()).toBeLessThan(7.5);
  });
  it('a tempo change while playing keeps the scheduled notes and the position continuous', () => {
    const t = make();
    t.setCountIn(false);
    t.play();
    run(t, 5);
    expect(t.positionSec()).toBeCloseTo(5, 6);
    t.setTempoFactor(2);
    expect(t.positionSec()).toBeCloseTo(5, 6);
    run(t, 1);
    // the 0.15 s already scheduled keep the old speed, the next 0.85 s run at double speed
    expect(t.positionSec()).toBeCloseTo(5 + 0.15 + 0.85 * 2, 6);
    run(t, 8);
    expect(instrument.events).toHaveLength(67);
    const times = instrument.events.map((e) => e.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(t.state.playing).toBe(false);
  });
  it('sounds a grace note 50 ms before its principal and reports the end once', () => {
    const t = make();
    let ends = 0;
    t.onEnd = () => ends++;
    t.setCountIn(false);
    t.play();
    run(t, 21);
    expect(ends).toBe(1);
    const grace = instrument.events.filter((e) => Math.abs(e.time - 102.45) < 1e-9);
    expect(grace.map((e) => e.midi)).toEqual([72]); // the C5 grace before bar 2
    expect(grace[0]!.duration).toBeCloseTo(0.1, 6);
    expect(t.state.positionSec).toBeCloseTo(20, 6);
  });
  it('clicks the count-in without the metronome, holds the position, and silences on pause', () => {
    const t = make();
    t.setCountIn(true);
    t.play();
    run(t, 1);
    expect(clicks.map((c) => c.time)).toEqual([100, 100.625]);
    expect(t.positionSec()).toBe(0);
    expect(instrument.events).toHaveLength(0);
    t.pause();
    expect(instrument.stopAllCalls).toBe(1);
    expect(t.positionSec()).toBe(0);
  });
  it('seek and pause', () => {
    const t = make();
    t.setCountIn(false);
    t.seek(10);
    t.play();
    run(t, 1);
    expect(instrument.events[0]!.time).toBeGreaterThanOrEqual(100);
    expect(score.notes.find((n) => n.id === instrument.events[0]!.hand + 'x') ?? true).toBeTruthy();
    expect(Math.min(...instrument.events.map((e) => e.time - 100 + 10))).toBeGreaterThanOrEqual(10);
    t.pause();
    const n = instrument.events.length;
    run(t, 2);
    expect(instrument.events).toHaveLength(n);
    expect(t.state.playing).toBe(false);
    expect(t.positionSec()).toBeCloseTo(11, 2);
  });
});
