// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ClickLevel } from './beats.js';
import { CLICK_SOUND, scheduleClick } from './metronome.js';

const LEVELS: ClickLevel[] = ['bar', 'beat', 'sub'];

/** What a stand-in AudioContext recorded of the one click scheduled on it. */
interface Recorded {
  hz: number | undefined;
  /** `setValueAtTime` calls on the gain: its level and the context time. */
  set: [number, number][];
  /** `exponentialRampToValueAtTime` calls on the gain: its level and the context time. */
  ramp: [number, number][];
  started: number[];
  /** Each `stop` of the oscillator, with its time (undefined for a stop at once). */
  stopped: (number | undefined)[];
  /** How often the oscillator and the gain were disconnected. */
  disconnected: { osc: number; gain: number };
  /** The oscillator's `onended`, which the audio clock calls once a click has ended. */
  ended: () => void;
}

/** An AudioContext stand-in that records the oscillator and the gain a click sets up. */
function fakeContext(): { ctx: AudioContext; recorded: Recorded } {
  const recorded: Recorded = {
    hz: undefined,
    set: [],
    ramp: [],
    started: [],
    stopped: [],
    disconnected: { osc: 0, gain: 0 },
    ended: () => {},
  };
  const destination = {};
  const ctx = {
    destination,
    createOscillator: () => {
      const osc = {
        frequency: {
          set value(v: number) {
            recorded.hz = v;
          },
        },
        onended: null as (() => void) | null,
        connect: <T>(node: T): T => node,
        disconnect: () => recorded.disconnected.osc++,
        start: (t: number) => recorded.started.push(t),
        stop: (t?: number) => recorded.stopped.push(t),
      };
      recorded.ended = () => osc.onended?.();
      return osc;
    },
    createGain: () => ({
      gain: {
        setValueAtTime: (v: number, t: number) => recorded.set.push([v, t]),
        exponentialRampToValueAtTime: (v: number, t: number) => recorded.ramp.push([v, t]),
      },
      connect: <T>(node: T): T => node,
      disconnect: () => recorded.disconnected.gain++,
    }),
  };
  return { ctx: ctx as unknown as AudioContext, recorded };
}

// The three clicks of the metronome (issue 203): the bar's first beat, another beat, a sub-beat.
describe('the click ladder', () => {
  it('keeps the clicks a beat had: 1500 Hz on a bar, 1000 Hz on a beat, 30 ms at gain 0.2', () => {
    expect(CLICK_SOUND.bar).toEqual({ hz: 1500, sec: 0.03, gain: 0.2 });
    expect(CLICK_SOUND.beat).toEqual({ hz: 1000, sec: 0.03, gain: 0.2 });
  });

  it('steps down in pitch, level and length: bar, beat, sub-beat', () => {
    const { bar, beat, sub } = CLICK_SOUND;
    expect(bar.hz).toBeGreaterThan(beat.hz);
    expect(beat.hz).toBeGreaterThan(sub.hz);
    expect(bar.gain).toBeGreaterThanOrEqual(beat.gain);
    expect(beat.gain / sub.gain).toBeGreaterThanOrEqual(3); // about 10 dB under a beat
    expect(sub.sec).toBeLessThan(beat.sec);
  });

  it('makes a sub-beat 800 Hz, 15 ms at gain 0.06', () => {
    expect(CLICK_SOUND.sub).toEqual({ hz: 800, sec: 0.015, gain: 0.06 });
  });

  it.each(LEVELS)('sounds its %s from the table: pitch, gain, start and length', (level) => {
    const { ctx, recorded } = fakeContext();
    scheduleClick(ctx, 5, level);
    const sound = CLICK_SOUND[level];
    expect(recorded.hz).toBe(sound.hz);
    expect(recorded.set).toEqual([[sound.gain, 5]]);
    expect(recorded.ramp).toHaveLength(1);
    expect(recorded.ramp[0]![0]).toBe(0.0001);
    expect(recorded.ramp[0]![1]).toBeCloseTo(5 + sound.sec, 9);
    expect(recorded.started).toEqual([5]);
    expect(recorded.stopped).toHaveLength(1);
    expect(recorded.stopped[0]).toBeCloseTo(5 + sound.sec, 9);
  });

  describe('the stop it returns', () => {
    it('stops the click at once and disconnects it', () => {
      const { ctx, recorded } = fakeContext();
      const stop = scheduleClick(ctx, 5, 'beat');
      expect(recorded.stopped).toHaveLength(1); // the scheduled end
      stop();
      expect(recorded.stopped).toHaveLength(2);
      expect(recorded.stopped[1]).toBeUndefined(); // at once
      expect(recorded.disconnected).toEqual({ osc: 1, gain: 1 });
    });

    it('is safe to call twice', () => {
      const { ctx, recorded } = fakeContext();
      const stop = scheduleClick(ctx, 5, 'sub');
      stop();
      stop();
      expect(recorded.stopped).toHaveLength(2);
      expect(recorded.disconnected).toEqual({ osc: 1, gain: 1 });
    });

    it('does nothing once the click has ended', () => {
      const { ctx, recorded } = fakeContext();
      const stop = scheduleClick(ctx, 5, 'bar');
      recorded.ended();
      expect(recorded.disconnected).toEqual({ osc: 1, gain: 1 }); // the end releases the nodes
      stop();
      expect(recorded.stopped).toHaveLength(1);
      expect(recorded.disconnected).toEqual({ osc: 1, gain: 1 });
    });

    it('lets the end follow a stop without releasing the nodes twice', () => {
      const { ctx, recorded } = fakeContext();
      const stop = scheduleClick(ctx, 5, 'bar');
      stop();
      recorded.ended();
      expect(recorded.disconnected).toEqual({ osc: 1, gain: 1 });
    });
  });
});
