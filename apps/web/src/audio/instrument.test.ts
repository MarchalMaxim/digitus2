import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPiano, createSilentInstrument, PIANO_SOFTEST } from './instrument.js';

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

describe('strike (a key clicked on the on-screen keyboard)', () => {
  it('starts the note now, at the velocity floor at least, for at most the hold, and stops it on release', async () => {
    const piano = createPiano({} as AudioContext);
    expect(piano.strike(60, 96, 2)).toBeTypeOf('function'); // before load: silent, harmless
    expect(smplr.piano.start).not.toHaveBeenCalled();
    await piano.load([60], [96]);
    const release = piano.strike(60, 20, 2);
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
