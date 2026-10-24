// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createMidiParser,
  EVENT_MAX_AGE_MS,
  eventTimeMs,
  HeldKeys,
  type ParsedNote,
} from './parse.js';

const on = (midi: number, channel = 0, velocity = 90): ParsedNote => ({
  on: true,
  channel,
  midi,
  velocity,
});
const off = (midi: number, channel = 0): ParsedNote => ({ on: false, channel, midi, velocity: 0 });

describe('eventTimeMs (issue 192)', () => {
  const NOW = 50_000;

  it('keeps a plausible event time', () => {
    expect(eventTimeMs(NOW - 12.5, NOW)).toBe(NOW - 12.5);
    expect(eventTimeMs(NOW, NOW)).toBe(NOW);
    // Up to a millisecond ahead of now: the two clocks are read apart.
    expect(eventTimeMs(NOW + 1, NOW)).toBe(NOW + 1);
    expect(eventTimeMs(NOW - EVENT_MAX_AGE_MS, NOW)).toBe(NOW - EVENT_MAX_AGE_MS);
  });

  it.each([
    ['0', 0],
    ['NaN', Number.NaN],
    ['undefined', undefined],
    ['negative', -5],
    ['in the future', NOW + 1.5],
    ['older than a second', NOW - EVENT_MAX_AGE_MS - 1],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('falls back to now for a stamp that is %s', (_, stamp) => {
    expect(eventTimeMs(stamp, NOW)).toBe(NOW);
  });
});

describe('createMidiParser', () => {
  it('reads note on and note off on all 16 channels', () => {
    const parse = createMidiParser();
    for (let channel = 0; channel < 16; channel++) {
      expect(parse([0x90 | channel, 60, 100])).toEqual([on(60, channel, 100)]);
      expect(parse([0x80 | channel, 60, 64])).toEqual([off(60, channel)]);
    }
  });

  it('reports the velocity of a note on, and 0 for either kind of note off (issue 192)', () => {
    const parse = createMidiParser();
    expect(parse([0x90, 0x3c, 0x64])).toEqual([{ on: true, channel: 0, midi: 60, velocity: 100 }]);
    expect(parse([0x80, 0x3c, 0x40])).toEqual([{ on: false, channel: 0, midi: 60, velocity: 0 }]);
    expect(parse([0x90, 0x3c, 0x00])).toEqual([{ on: false, channel: 0, midi: 60, velocity: 0 }]);
  });

  it('reads a note on at velocity 0 as an off', () => {
    const parse = createMidiParser();
    expect(parse([0x93, 61, 0])).toEqual([off(61, 3)]);
  });

  it('reads a velocity 0 under running status as an off', () => {
    const parse = createMidiParser();
    expect(parse([0x90, 60, 90, 60, 0, 62, 70, 62, 0])).toEqual([
      on(60),
      off(60),
      on(62, 0, 70),
      off(62),
    ]);
  });

  it('keeps running status within one call', () => {
    const parse = createMidiParser();
    expect(parse([0x90, 60, 90, 64, 90, 67, 90])).toEqual([on(60), on(64), on(67)]);
  });

  it('keeps running status across two calls', () => {
    const parse = createMidiParser();
    expect(parse([0x92, 60, 90])).toEqual([on(60, 2)]);
    expect(parse([64, 90])).toEqual([on(64, 2)]);
    expect(parse([64, 0])).toEqual([off(64, 2)]);
  });

  it('completes an incomplete message on the next call', () => {
    const parse = createMidiParser();
    expect(parse([0x90])).toEqual([]);
    expect(parse([60])).toEqual([]);
    expect(parse([90])).toEqual([on(60)]);
    expect(parse([0x80, 62])).toEqual([]);
    expect(parse([40])).toEqual([off(62)]);
  });

  it('drops a message cut off by a new status byte', () => {
    const parse = createMidiParser();
    expect(parse([0x90, 60, 0x91, 62, 80])).toEqual([on(62, 1, 80)]);
  });

  it.each([0xf8, 0xfa, 0xfe, 0xff])(
    'ignores the realtime byte %s inside a message and keeps running status',
    (rt) => {
      const parse = createMidiParser();
      expect(parse([0x90, rt, 60, rt, 90])).toEqual([on(60)]);
      // Running status survives a realtime byte between messages.
      expect(parse([rt, 62, rt, 90])).toEqual([on(62)]);
      // And a realtime byte on its own produces nothing.
      expect(parse([rt])).toEqual([]);
    },
  );

  it('ignores every realtime byte 0xF8 to 0xFF', () => {
    const parse = createMidiParser();
    const rt = [0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff];
    expect(parse(rt)).toEqual([]);
    expect(parse([0x90, 60, 90, ...rt])).toEqual([on(60)]);
  });

  it('skips a SysEx whole, then reads the notes that follow', () => {
    const parse = createMidiParser();
    expect(parse([0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7, 0x90, 60, 90])).toEqual([on(60)]);
  });

  it('skips a SysEx across calls', () => {
    const parse = createMidiParser();
    expect(parse([0xf0, 0x41, 0x10])).toEqual([]);
    expect(parse([0x42, 0x12, 0x40])).toEqual([]);
    expect(parse([0x00, 0xf7, 0x90, 64, 80])).toEqual([on(64, 0, 80)]);
  });

  it('does not read data bytes inside a SysEx as notes, even ones that look like running status', () => {
    const parse = createMidiParser();
    expect(parse([0x90, 60, 90])).toEqual([on(60)]);
    expect(parse([0xf0, 61, 90, 62, 90, 0xf7])).toEqual([]);
  });

  it('clears running status at a SysEx', () => {
    const parse = createMidiParser();
    expect(parse([0x90, 60, 90])).toEqual([on(60)]);
    expect(parse([0xf0, 0x01, 0xf7])).toEqual([]);
    expect(parse([62, 90])).toEqual([]);
    expect(parse([0x90, 62, 90])).toEqual([on(62)]);
  });

  it('ends a SysEx at the next status byte when its F7 was lost', () => {
    const parse = createMidiParser();
    expect(parse([0xf0, 0x01, 0x02, 0x90, 60, 90])).toEqual([on(60)]);
  });

  it('ignores realtime bytes inside a SysEx without ending it', () => {
    const parse = createMidiParser();
    expect(parse([0xf0, 0x01, 0xfe, 0x02, 0xf8, 0xf7, 0x90, 60, 90])).toEqual([on(60)]);
    expect(parse([0xf0, 0x01, 0xfe, 61, 90, 0xf7])).toEqual([]);
  });

  it.each([
    ['F1 (time code)', [0xf1, 0x10]],
    ['F2 (song position)', [0xf2, 0x01, 0x02]],
    ['F3 (song select)', [0xf3, 0x05]],
    ['F4', [0xf4]],
    ['F5', [0xf5]],
    ['F6 (tune request)', [0xf6]],
    ['F7 (stray end of SysEx)', [0xf7]],
  ])('clears running status at %s and skips its data', (_, common) => {
    const parse = createMidiParser();
    expect(parse([0x90, 60, 90])).toEqual([on(60)]);
    expect(parse(common)).toEqual([]);
    // Running status is gone: bare data bytes are ignored.
    expect(parse([62, 90])).toEqual([]);
    // A fresh status works again.
    expect(parse([0x90, 62, 90])).toEqual([on(62)]);
  });

  it('skips the data bytes of a system common message inside one call', () => {
    const parse = createMidiParser();
    expect(parse([0xf2, 0x7f, 0x7f, 0x90, 60, 90])).toEqual([on(60)]);
  });

  it('ignores data bytes with no status', () => {
    const parse = createMidiParser();
    expect(parse([60, 90, 64, 90])).toEqual([]);
    expect(parse([0x90, 60, 90])).toEqual([on(60)]);
  });

  it('gives no output for controllers, program change, pitch bend and aftertouch', () => {
    const parse = createMidiParser();
    // CC 64 (pedal) down and up, then a note: the pedal gives nothing and does not eat the note.
    expect(parse([0xb0, 64, 127, 0xb0, 64, 0, 0x90, 60, 90])).toEqual([on(60)]);
    // Program change takes one data byte.
    expect(parse([0xc0, 5, 0x90, 62, 90])).toEqual([on(62)]);
    // Pitch bend takes two.
    expect(parse([0xe0, 0x00, 0x40, 0x90, 64, 90])).toEqual([on(64)]);
    // Channel pressure takes one, polyphonic key pressure two.
    expect(parse([0xd0, 70, 0x90, 65, 90])).toEqual([on(65)]);
    expect(parse([0xa0, 60, 50, 0x90, 67, 90])).toEqual([on(67)]);
  });

  it('keeps the length of a message right under running status of a one-byte message', () => {
    const parse = createMidiParser();
    // Program change twice under running status, then a note.
    expect(parse([0xc1, 1, 2, 3, 0x91, 60, 90])).toEqual([on(60, 1)]);
    // Channel pressure under running status.
    expect(parse([0xd2, 10, 20, 0x92, 61, 90])).toEqual([on(61, 2)]);
  });

  it('keeps each parser independent', () => {
    const a = createMidiParser();
    const b = createMidiParser();
    expect(a([0x90, 60])).toEqual([]);
    expect(b([0x91, 62, 80])).toEqual([on(62, 1, 80)]);
    expect(a([90])).toEqual([on(60)]);
  });

  it('reads a typed array', () => {
    const parse = createMidiParser();
    expect(parse(new Uint8Array([0x90, 60, 90, 0x80, 60, 0]))).toEqual([on(60), off(60)]);
  });
});

describe('HeldKeys', () => {
  it('reports a note on and the off that ends it', () => {
    const keys = new HeldKeys();
    expect(keys.apply('a', on(60))).toEqual({ on: true, midi: 60 });
    expect(keys.held()).toEqual([60]);
    expect(keys.apply('a', off(60))).toEqual({ on: false, midi: 60 });
    expect(keys.held()).toEqual([]);
  });

  it('holds a pitch on two channels until the last lets go', () => {
    const keys = new HeldKeys();
    expect(keys.apply('a', on(60, 0))).toEqual({ on: true, midi: 60 });
    expect(keys.apply('a', on(60, 1))).toEqual({ on: true, midi: 60 });
    expect(keys.apply('a', off(60, 0))).toBeNull();
    expect(keys.held()).toEqual([60]);
    expect(keys.apply('a', off(60, 1))).toEqual({ on: false, midi: 60 });
    expect(keys.held()).toEqual([]);
  });

  it('holds a pitch on two inputs until the last lets go', () => {
    const keys = new HeldKeys();
    keys.apply('a', on(64));
    keys.apply('b', on(64));
    expect(keys.apply('b', off(64))).toBeNull();
    expect(keys.held()).toEqual([64]);
    expect(keys.apply('a', off(64))).toEqual({ on: false, midi: 64 });
  });

  it('reports on again for a second note on of a held pitch', () => {
    const keys = new HeldKeys();
    expect(keys.apply('a', on(60))).toEqual({ on: true, midi: 60 });
    expect(keys.apply('a', on(60))).toEqual({ on: true, midi: 60 });
    // One off releases it: a double note on from one input and channel is one hold.
    expect(keys.apply('a', off(60))).toEqual({ on: false, midi: 60 });
    expect(keys.held()).toEqual([]);
  });

  it('reports no off for a key that is not down', () => {
    const keys = new HeldKeys();
    expect(keys.apply('a', off(60))).toBeNull();
    keys.apply('b', on(60));
    // Input a never pressed it: its off does not release input b's hold.
    expect(keys.apply('a', off(60))).toBeNull();
    expect(keys.held()).toEqual([60]);
  });

  it('keeps the held pitches ascending', () => {
    const keys = new HeldKeys();
    for (const midi of [67, 60, 64]) keys.apply('a', on(midi));
    expect(keys.held()).toEqual([60, 64, 67]);
    keys.apply('a', off(64));
    expect(keys.held()).toEqual([60, 67]);
  });

  it('gives the same array until the held pitches change', () => {
    const keys = new HeldKeys();
    keys.apply('a', on(60));
    const first = keys.held();
    expect(keys.held()).toBe(first);
    // A second hold on the same pitch changes nothing.
    keys.apply('b', on(60));
    expect(keys.held()).toBe(first);
    keys.apply('a', on(60));
    expect(keys.held()).toBe(first);
    // An off that leaves it held elsewhere changes nothing either.
    keys.apply('b', off(60));
    expect(keys.held()).toBe(first);
    keys.apply('a', on(62));
    const second = keys.held();
    expect(second).not.toBe(first);
    expect(second).toEqual([60, 62]);
  });

  it('gives the same empty array while nothing is held', () => {
    const keys = new HeldKeys();
    const empty = keys.held();
    expect(empty).toEqual([]);
    keys.apply('a', off(60));
    expect(keys.held()).toBe(empty);
  });

  it('reports the offs of the pitches an input held alone when it goes away', () => {
    const keys = new HeldKeys();
    keys.apply('a', on(60));
    keys.apply('a', on(64, 5));
    keys.apply('b', on(64));
    keys.apply('b', on(67));
    // 60 is a's alone, 64 is held by b too, 67 is b's.
    expect(keys.dropInput('a')).toEqual([{ on: false, midi: 60 }]);
    expect(keys.held()).toEqual([64, 67]);
    expect(keys.dropInput('b')).toEqual([
      { on: false, midi: 64 },
      { on: false, midi: 67 },
    ]);
    expect(keys.held()).toEqual([]);
  });

  it('reports nothing when an input that holds nothing goes away', () => {
    const keys = new HeldKeys();
    keys.apply('a', on(60));
    const before = keys.held();
    expect(keys.dropInput('gone')).toEqual([]);
    expect(keys.held()).toBe(before);
  });

  it('reports an off for every held pitch on clear, ascending', () => {
    const keys = new HeldKeys();
    keys.apply('a', on(67));
    keys.apply('b', on(60));
    keys.apply('a', on(60, 3));
    expect(keys.clear()).toEqual([
      { on: false, midi: 60 },
      { on: false, midi: 67 },
    ]);
    expect(keys.held()).toEqual([]);
    expect(keys.clear()).toEqual([]);
  });

  it('holds a pitch again after it was cleared', () => {
    const keys = new HeldKeys();
    keys.apply('a', on(60));
    keys.clear();
    expect(keys.apply('a', off(60))).toBeNull();
    expect(keys.apply('a', on(60))).toEqual({ on: true, midi: 60 });
    expect(keys.held()).toEqual([60]);
  });

  describe('with the key time (issue 192)', () => {
    it('adds the time to a note on, with its velocity, and to the off that ends it', () => {
      const keys = new HeldKeys();
      expect(keys.apply('a', on(60, 0, 100), 1234.5)).toEqual({
        on: true,
        midi: 60,
        atMs: 1234.5,
        velocity: 100,
      });
      expect(keys.apply('a', off(60), 1400)).toEqual({ on: false, midi: 60, atMs: 1400 });
    });

    it('adds no velocity to a note on that has none', () => {
      const keys = new HeldKeys();
      expect(keys.apply('a', { on: true, channel: 0, midi: 62, velocity: 0 }, 10)).toEqual({
        on: true,
        midi: 62,
        atMs: 10,
      });
    });

    it('gives a key still held elsewhere no off, with or without the time', () => {
      const keys = new HeldKeys();
      keys.apply('a', on(64), 1);
      keys.apply('b', on(64), 2);
      expect(keys.apply('a', off(64), 3)).toBeNull();
      expect(keys.apply('b', off(64), 4)).toEqual({ on: false, midi: 64, atMs: 4 });
    });

    it('adds the time to the offs of an input that went away, and to those of a clear', () => {
      const keys = new HeldKeys();
      keys.apply('a', on(60));
      keys.apply('a', on(67));
      keys.apply('b', on(72));
      expect(keys.dropInput('a', 900)).toEqual([
        { on: false, midi: 60, atMs: 900 },
        { on: false, midi: 67, atMs: 900 },
      ]);
      expect(keys.clear(950)).toEqual([{ on: false, midi: 72, atMs: 950 }]);
    });
  });
});
