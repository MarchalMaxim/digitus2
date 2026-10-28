// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { Accompanist } from './accompanist.js';
import { createSilentInstrument, type AccNote, type NoteEvent } from './instrument.js';

// The other hand (issue 184): a just-in-time queue over the instrument, with a fake clock and
// timers the test turns by hand.

let ctx: { currentTime: number };
let instrument: ReturnType<typeof createSilentInstrument>;
let timers: Map<number, () => void>;
let nextTimer: number;

function make(
  opts: { lookAheadSec?: number; tickMs?: number } = {},
  onDrop?: (e: NoteEvent) => void,
): Accompanist {
  return new Accompanist(
    {
      ctx,
      instrument,
      onDrop,
      setInterval: ((fn: () => void) => {
        timers.set(++nextTimer, fn);
        return nextTimer;
      }) as never,
      clearInterval: ((id: number) => {
        timers.delete(id);
      }) as never,
    },
    opts,
  );
}

/** A note after the press, a quarter second long unless said. */
function note(offsetSec: number, midi = 48, durationSec = 0.25): AccNote {
  return { offsetSec, durationSec, midi, velocity: 80, hand: 'L' };
}

/** Moves the clock and runs the timer's tick, as the scheduler's interval would. */
function advance(sec: number): void {
  ctx.currentTime += sec;
  for (const fn of [...timers.values()]) fn();
}

beforeEach(() => {
  ctx = { currentTime: 100 };
  instrument = createSilentInstrument();
  timers = new Map();
  nextTimer = 0;
});

describe('play', () => {
  it('hands over only the notes within 150 ms, and keeps the rest queued', () => {
    const acc = make();
    acc.play([note(0, 48), note(0.1, 50), note(0.2, 52), note(0.5, 53)], 1);
    expect(instrument.events.map((e) => e.midi)).toEqual([48, 50]);
    expect(instrument.events.map((e) => e.time)).toEqual([100, 100.1]);
    expect(acc.pending()).toBe(2);
    expect(timers.size).toBe(1);
  });

  it('hands over the rest as time advances, each at base plus offset, for its duration', () => {
    const acc = make();
    acc.play([note(0, 48, 0.3), note(0.2, 52, 0.4), note(0.5, 53, 0.1)], 1);
    expect(instrument.events).toHaveLength(1);
    advance(0.025); // 100.025: the horizon is 100.175, 100.2 is not due
    expect(instrument.events).toHaveLength(1);
    advance(0.03); // 100.055: the horizon is 100.205
    expect(instrument.events.map((e) => e.midi)).toEqual([48, 52]);
    advance(0.25); // 100.305: the horizon is 100.455, 100.5 is not due
    expect(instrument.events).toHaveLength(2);
    advance(0.05); // 100.355: the horizon is 100.505
    expect(instrument.events.map((e) => [e.midi, e.time, e.duration, e.velocity, e.hand])).toEqual([
      [48, 100, 0.3, 80, 'L'],
      [52, 100.2, 0.4, 80, 'L'],
      [53, 100.5, 0.1, 80, 'L'],
    ]);
    expect(acc.pending()).toBe(0);
  });

  it('divides the offsets and the durations by the tempo factor', () => {
    const acc = make();
    acc.play([note(0, 48, 0.2), note(0.1, 50, 0.2)], 0.5);
    expect(instrument.events.map((e) => [e.time, e.duration])).toEqual([[100, 0.4]]);
    advance(0.06); // 100.06: the horizon is 100.21
    expect(instrument.events.map((e) => [e.time, e.duration])).toEqual([
      [100, 0.4],
      [100.2, 0.4],
    ]);
  });

  it('keeps the order of simultaneous notes and sorts unordered ones by time', () => {
    const acc = make();
    acc.play([note(0.1, 55), note(0, 48), note(0, 52)], 1);
    expect(instrument.events.map((e) => e.midi)).toEqual([48, 52, 55]);
  });

  it('a second play clears the queue and cancels the handed notes that have not started', () => {
    const acc = make();
    acc.play([note(0, 48), note(0.1, 50), note(0.9, 60)], 1);
    expect(instrument.events.map((e) => e.midi)).toEqual([48, 50]);
    ctx.currentTime = 100.05; // 48 sounds, 50 has not started
    acc.play([note(0, 40)], 1);
    expect(instrument.cancelled.map((e) => e.midi)).toEqual([50]);
    expect(acc.pending()).toBe(0);
    expect(instrument.events.at(-1)).toMatchObject({ midi: 40, time: 100.05 });
    advance(1); // the old queue's 60 never enters the instrument
    expect(instrument.events.map((e) => e.midi)).toEqual([48, 50, 40]);
  });

  it('cancels with the note’s own stop, so a same-pitch note that sounds is not touched', () => {
    const acc = make();
    acc.play([note(0, 36, 1), note(0.1, 36, 1)], 1); // the same bass pitch, twice
    ctx.currentTime = 100.05;
    acc.play([], 1);
    expect(instrument.cancelled).toEqual([instrument.events[1]]);
  });

  it('with no notes, clears the queue and starts no timer', () => {
    const acc = make();
    acc.play([note(0.5)], 1);
    expect(timers.size).toBe(1);
    acc.play([], 1);
    expect(acc.pending()).toBe(0);
    expect(timers.size).toBe(0);
  });

  it('a note handed over late (the tick slipped) still starts', () => {
    const acc = make();
    acc.play([note(0.3, 55)], 1);
    ctx.currentTime = 100.6;
    acc.step();
    expect(instrument.events).toMatchObject([{ midi: 55, time: 100.3 }]);
  });
});

describe('the timer', () => {
  it('runs only while the queue holds notes', () => {
    const acc = make();
    acc.play([note(0), note(0.05)], 1);
    expect(timers.size).toBe(0); // everything is within the look-ahead: nothing to wait for
    acc.play([note(0), note(0.4)], 1);
    expect(timers.size).toBe(1);
    advance(0.3);
    expect(timers.size).toBe(0);
    expect(instrument.events.at(-1)).toMatchObject({ time: 100.4 });
  });

  it('is one timer through several plays', () => {
    const acc = make();
    acc.play([note(0.5)], 1);
    acc.play([note(0.6)], 1);
    acc.play([note(0.7)], 1);
    expect(timers.size).toBe(1);
  });

  it('uses the tick and the look-ahead it is given', () => {
    const intervals: number[] = [];
    const acc = new Accompanist(
      {
        ctx,
        instrument,
        setInterval: ((fn: () => void, ms: number) => {
          intervals.push(ms);
          timers.set(++nextTimer, fn);
          return nextTimer;
        }) as never,
        clearInterval: (() => {}) as never,
      },
      { lookAheadSec: 0.3, tickMs: 10 },
    );
    acc.play([note(0.25), note(0.35)], 1);
    expect(instrument.events.map((e) => e.time)).toEqual([100.25]);
    expect(intervals).toEqual([10]);
  });
});

describe('stop', () => {
  it('clears the queue, cancels what has not started and releases what sounds', () => {
    const acc = make();
    acc.play([note(0, 48, 1), note(0.1, 50, 1), note(0.9, 60, 1)], 1);
    ctx.currentTime = 100.05; // 48 sounds; 50 is handed, not started; 60 waits in the queue
    acc.stop();
    expect(instrument.cancelled.map((e) => e.midi)).toEqual([48, 50]);
    expect(acc.pending()).toBe(0);
    expect(timers.size).toBe(0);
    advance(2); // 60 never enters the instrument
    expect(instrument.events.map((e) => e.midi)).toEqual([48, 50]);
  });

  it('leaves a note that has finished alone', () => {
    const acc = make();
    acc.play([note(0, 48, 0.2), note(0, 50, 1)], 1);
    ctx.currentTime = 100.5; // 48 ended at 100.2
    acc.stop();
    expect(instrument.cancelled.map((e) => e.midi)).toEqual([50]);
  });

  it('is harmless twice, and before any play', () => {
    const acc = make();
    acc.stop();
    acc.play([note(0, 48, 1)], 1);
    acc.stop();
    acc.stop();
    expect(instrument.cancelled).toHaveLength(1);
  });

  it('is what a play after it starts clean from', () => {
    const acc = make();
    acc.play([note(0, 48, 1)], 1);
    acc.stop();
    acc.play([note(0, 50, 1)], 1);
    expect(instrument.cancelled.map((e) => e.midi)).toEqual([48]);
    expect(instrument.events.map((e) => e.midi)).toEqual([48, 50]);
  });

  it('never calls stopAll, which would cut the transport’s notes and a struck key', () => {
    const acc = make();
    acc.play([note(0, 48, 1), note(0.1, 50, 1), note(0.9, 60, 1)], 1);
    acc.play([note(0, 40, 1)], 1);
    acc.stop();
    acc.dispose();
    expect(instrument.stopAllCalls).toBe(0);
  });
});

describe('onDrop', () => {
  it('names each queued note that a second play or a stop drops, and no handed one', () => {
    const dropped: NoteEvent[] = [];
    const acc = make({}, (e) => dropped.push(e));
    acc.play([note(0, 48), note(0.4, 50), note(0.9, 60)], 1); // 48 is handed over, 50 and 60 wait
    expect(dropped).toEqual([]);
    acc.play([note(0.5, 40)], 1);
    expect(dropped.map((e) => [e.midi, e.time])).toEqual([
      [50, 100.4],
      [60, 100.9],
    ]);
    acc.stop();
    expect(dropped.map((e) => e.midi)).toEqual([50, 60, 40]);
    acc.stop(); // the queue is empty: nothing more
    expect(dropped).toHaveLength(3);
  });

  it('is not called for a note that was handed over, or for a queue that ran out', () => {
    const dropped: NoteEvent[] = [];
    const acc = make({}, (e) => dropped.push(e));
    acc.play([note(0, 48), note(0.2, 50)], 1);
    advance(0.1); // 50 is handed over
    acc.stop();
    expect(dropped).toEqual([]);
  });
});

describe('dispose', () => {
  it('stops, and leaves no timer', () => {
    const acc = make();
    acc.play([note(0, 48, 1), note(0.9, 60, 1)], 1);
    expect(timers.size).toBe(1);
    acc.dispose();
    expect(timers.size).toBe(0);
    expect(acc.pending()).toBe(0);
    expect(instrument.cancelled.map((e) => e.midi)).toEqual([48]);
  });
});
