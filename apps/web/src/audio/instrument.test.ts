import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPiano,
  createSilentInstrument,
  instrumentFromLocation,
  PIANO_SOFTEST,
} from './instrument.js';

const smplr = vi.hoisted(() => {
  const piano = {
    ready: Promise.resolve(),
    start: vi.fn(() => piano.stop),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
  return { piano, SplendidGrandPiano: vi.fn(() => piano) };
});
vi.mock('smplr', () => ({ SplendidGrandPiano: smplr.SplendidGrandPiano }));

afterEach(() => vi.clearAllMocks());

const NOTE = { midi: 60, time: 10, duration: 1, velocity: 80, hand: 'R' as const };

describe('start (a scheduled note keeps its own stop, issue 184)', () => {
  it('gives every start its own stopId, so a stop touches that voice alone', async () => {
    const piano = createPiano({} as AudioContext);
    expect(piano.start(NOTE)).toBeTypeOf('function'); // before load: silent, harmless
    expect(smplr.piano.start).not.toHaveBeenCalled();
    await piano.load([60], [80]);
    const stops = [vi.fn(), vi.fn()];
    smplr.piano.start.mockReturnValueOnce(stops[0]!).mockReturnValueOnce(stops[1]!);
    const first = piano.start(NOTE);
    const second = piano.start({ ...NOTE, time: 11 }); // the same pitch, later
    const calls = smplr.piano.start.mock.calls as unknown as [Record<string, unknown>][];
    expect(calls[0]![0]).toEqual({
      note: 60,
      velocity: 80,
      time: 10,
      duration: 1,
      stopId: expect.any(String),
    });
    expect(calls[1]![0].stopId).not.toBe(calls[0]![0].stopId);
    second();
    expect(stops[1]).toHaveBeenCalledTimes(1);
    expect(stops[0]).not.toHaveBeenCalled();
    first();
    expect(stops[0]).toHaveBeenCalledTimes(1);
  });

  it('floors the velocity, as before', async () => {
    const piano = createPiano({} as AudioContext);
    await piano.load([60], [80]);
    piano.start({ ...NOTE, velocity: 10 });
    const calls = smplr.piano.start.mock.calls as unknown as [Record<string, unknown>][];
    expect(calls[0]![0].velocity).toBe(PIANO_SOFTEST);
  });

  it('records, in the silent instrument, each event whose stop was called, once', () => {
    const silent = createSilentInstrument();
    const a = silent.start(NOTE);
    const b = silent.start({ ...NOTE, time: 11 });
    expect(silent.events).toHaveLength(2);
    expect(silent.cancelled).toEqual([]);
    b();
    b();
    expect(silent.cancelled).toEqual([silent.events[1]]);
    a();
    expect(silent.cancelled).toEqual([silent.events[1], silent.events[0]]);
  });
});

describe('strike (a key clicked on the on-screen keyboard)', () => {
  it('starts the note now, at the velocity floor at least, for at most the hold, and stops it on release', async () => {
    const piano = createPiano({} as AudioContext);
    expect(piano.strike(60, 96, 2)).toBeTypeOf('function'); // before load: silent, harmless
    expect(smplr.piano.start).not.toHaveBeenCalled();
    await piano.load([60], [96]);
    const release = piano.strike(60, 20, 2);
    // No stopId: a struck key stops by its pitch, as before.
    expect(smplr.piano.start).toHaveBeenCalledWith({
      note: 60,
      velocity: PIANO_SOFTEST,
      duration: 2,
    });
    expect(smplr.piano.stop).not.toHaveBeenCalled();
    release();
    expect(smplr.piano.stop).toHaveBeenCalledTimes(1);
  });

  it('is recorded by the silent instrument', () => {
    const silent = createSilentInstrument();
    const release = silent.strike(64, 88, 2);
    expect(silent.strikes).toEqual([{ midi: 64, velocity: 88, maxSec: 2 }]);
    expect(silent.released).toEqual([]);
    release();
    expect(silent.released).toEqual([64]);
  });
});

describe('instrumentFromLocation', () => {
  it('is silent with ?audio=silent, and the sampled piano otherwise, ?hooks=1 included', () => {
    const ctx = {} as AudioContext;
    expect(instrumentFromLocation(ctx, '?audio=silent')).toHaveProperty('events');
    expect(instrumentFromLocation(ctx, '?hooks=1')).not.toHaveProperty('events');
    expect(instrumentFromLocation(ctx, '')).not.toHaveProperty('events');
  });
});
