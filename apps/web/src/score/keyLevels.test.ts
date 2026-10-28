// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NO_LEVELS,
  createLevelStore,
  levelAt,
  levelRect,
  moving,
  type KeyLevel,
  type LevelStore,
} from './keyLevels.js';

/** A level rising from t = 1000 over 2000 ms (a whole note of 4 beats at 120 qpm). */
const rising = (over: Partial<KeyLevel> = {}): KeyLevel => ({
  atMs: 1000,
  lengthMs: 2000,
  beats: 4,
  upMs: null,
  fromLevel: 0,
  drainMs: 0,
  ...over,
});

/** A level let go at t = 5000 from 0.5, draining over 200 ms. */
const draining = (over: Partial<KeyLevel> = {}): KeyLevel =>
  rising({ upMs: 5000, fromLevel: 0.5, drainMs: 200, ...over });

describe('levelAt', () => {
  it('rises linearly: 0 at the press, 0.5 halfway, 1 at the length and after', () => {
    const l = rising();
    expect(levelAt(l, 1000, false)).toBe(0);
    expect(levelAt(l, 1500, false)).toBeCloseTo(0.25, 12);
    expect(levelAt(l, 2000, false)).toBeCloseTo(0.5, 12);
    expect(levelAt(l, 3000, false)).toBe(1);
    expect(levelAt(l, 9000, false)).toBe(1);
  });

  it('is 0 before the press and 1 for a note of no length', () => {
    expect(levelAt(rising(), 400, false)).toBe(0);
    expect(levelAt(rising({ lengthMs: 0, beats: 0 }), 1000, false)).toBe(1);
  });

  it('steps by the beat under reduced motion: a whole note of 4 beats', () => {
    const l = rising();
    const at = (ms: number) => levelAt(l, ms, true);
    expect(at(1000)).toBe(0);
    expect(at(1499)).toBe(0);
    expect(at(1500)).toBe(0.25);
    expect(at(1999)).toBe(0.25);
    expect(at(2000)).toBe(0.5);
    expect(at(2500)).toBe(0.75);
    expect(at(2999)).toBe(0.75);
    expect(at(3000)).toBe(1);
  });

  it('steps a dotted quarter of 1.5 beats from 0 to 2/3 to 1', () => {
    const l = rising({ atMs: 0, lengthMs: 750, beats: 1.5 });
    const at = (ms: number) => levelAt(l, ms, true);
    expect(at(0)).toBe(0);
    expect(at(499)).toBe(0);
    expect(at(500)).toBeCloseTo(2 / 3, 12);
    expect(at(749)).toBeCloseTo(2 / 3, 12);
    expect(at(750)).toBe(1);
  });

  it('shows nothing until the end for a note of one beat or less, then full', () => {
    const quarter = rising({ atMs: 0, lengthMs: 500, beats: 1 });
    expect(levelAt(quarter, 0, true)).toBe(0);
    expect(levelAt(quarter, 250, true)).toBe(0);
    expect(levelAt(quarter, 499, true)).toBe(0);
    expect(levelAt(quarter, 500, true)).toBe(1);
    const eighth = rising({ atMs: 0, lengthMs: 250, beats: 0.5 });
    expect(levelAt(eighth, 249, true)).toBe(0);
    expect(levelAt(eighth, 250, true)).toBe(1);
  });

  it('drains linearly from the level reached to nothing over drainMs', () => {
    const l = draining();
    expect(levelAt(l, 5000, false)).toBe(0.5);
    expect(levelAt(l, 5100, false)).toBeCloseTo(0.25, 12);
    expect(levelAt(l, 5200, false)).toBe(0);
    expect(levelAt(l, 6000, false)).toBe(0);
  });

  it('holds the level reached until the drain starts', () => {
    expect(levelAt(draining(), 4000, false)).toBe(0.5);
  });
});

describe('moving', () => {
  it('is true while rising below 1', () => {
    expect(moving(rising(), 1000, false)).toBe(true);
    expect(moving(rising(), 2000, false)).toBe(true);
    expect(moving(rising(), 2999, false)).toBe(true);
  });

  it('is false once full and held', () => {
    expect(moving(rising(), 3000, false)).toBe(false);
    expect(moving(rising(), 9000, false)).toBe(false);
  });

  it('is false for a note of no length', () => {
    expect(moving(rising({ lengthMs: 0, beats: 0 }), 1000, false)).toBe(false);
  });

  it('is true until the end under reduced motion, and false once full', () => {
    expect(moving(rising(), 1000, true)).toBe(true);
    expect(moving(rising(), 2999, true)).toBe(true);
    expect(moving(rising(), 3000, true)).toBe(false);
    const quarter = rising({ atMs: 0, lengthMs: 500, beats: 1 });
    expect(moving(quarter, 250, true)).toBe(true);
    expect(moving(quarter, 500, true)).toBe(false);
  });

  it('is true while draining, and false after', () => {
    expect(moving(draining(), 5000, false)).toBe(true);
    expect(moving(draining(), 5199, false)).toBe(true);
    expect(moving(draining(), 5200, false)).toBe(false);
    expect(moving(draining(), 6000, false)).toBe(false);
  });
});

describe('levelRect', () => {
  const whiteBar = { x: 3, y: 92, width: 18, height: 5 };
  const blackBar = { x: 2, y: 56, width: 10, height: 4 };

  it('has no height at level 0, on the bottom edge of the bar', () => {
    const r = levelRect(false, whiteBar, 0);
    expect(r.height).toBe(0);
    expect(r.y).toBe(97);
  });

  it('is the bar itself for a tiny level', () => {
    const r = levelRect(false, whiteBar, 1e-9);
    expect(r.height).toBeCloseTo(5, 6);
    expect(r.y).toBeCloseTo(92, 6);
  });

  it('grows from the bar to the top inset of the key on a white key', () => {
    const half = levelRect(false, whiteBar, 0.5);
    expect(half.height).toBeCloseTo(49.5, 12);
    expect(half.y).toBeCloseTo(47.5, 12);
    const full = levelRect(false, whiteBar, 1);
    expect(full.height).toBeCloseTo(94, 12);
    expect(full.y).toBeCloseTo(3, 12);
  });

  it('is y 2 and height 58 when full on a black key', () => {
    const full = levelRect(true, blackBar, 1);
    expect(full.y).toBeCloseTo(2, 12);
    expect(full.height).toBeCloseTo(58, 12);
  });

  it('keeps the bottom on the bottom edge of the bar, whatever the level', () => {
    for (const level of [0, 0.1, 0.5, 1]) {
      const w = levelRect(false, whiteBar, level);
      expect(w.y + w.height).toBeCloseTo(97, 12);
      const b = levelRect(true, blackBar, level);
      expect(b.y + b.height).toBeCloseTo(60, 12);
    }
  });

  it('takes the x, width and rx of the bar', () => {
    const w = levelRect(false, whiteBar, 0.5);
    expect([w.x, w.width, w.rx]).toEqual([3, 18, 1]);
    const b = levelRect(true, blackBar, 0.5);
    expect([b.x, b.width, b.rx]).toEqual([2, 10, 1]);
  });

  it('clamps a level outside 0 to 1', () => {
    expect(levelRect(false, whiteBar, -1)).toEqual(levelRect(false, whiteBar, 0));
    expect(levelRect(false, whiteBar, 2)).toEqual(levelRect(false, whiteBar, 1));
  });
});

describe('the level store', () => {
  let store: LevelStore;
  let reduced = false;
  let drainMs = 200;
  let heard: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    reduced = false;
    drainMs = 200;
    store = createLevelStore({ drainMs: () => drainMs, reduced: () => reduced });
    heard = vi.fn<() => void>();
    store.subscribe(heard);
  });
  afterEach(() => {
    store.dispose();
    vi.useRealTimers();
  });

  const start = (midi = 60, atMs = 1000) => store.start(midi, { atMs, lengthMs: 2000, beats: 4 });

  it('is the empty map to begin with, and the same map until a change', () => {
    expect(store.get()).toBe(NO_LEVELS);
    expect(store.get()).toBe(store.get());
    const before = store.get();
    start();
    expect(store.get()).not.toBe(before);
    const after = store.get();
    expect(store.get()).toBe(after);
    expect(before.size).toBe(0);
  });

  it('start adds a rising level and notifies', () => {
    start(60, 1000);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.get().get(60)).toMatchObject({
      atMs: 1000,
      lengthMs: 2000,
      beats: 4,
      upMs: null,
    });
  });

  it('stops notifying a listener that unsubscribed', () => {
    const other = vi.fn();
    const off = store.subscribe(other);
    start();
    off();
    start(62);
    expect(other).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('release of a full level deletes it at once, with no timer', () => {
    start(60, 1000);
    heard.mockClear();
    store.release(60, 4000);
    expect(store.get().has(60)).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('release at half drains from there, then deletes after drainMs', () => {
    start(60, 1000);
    heard.mockClear();
    store.release(60, 2000);
    expect(store.get().get(60)).toMatchObject({ upMs: 2000, drainMs: 200 });
    expect(store.get().get(60)?.fromLevel).toBeCloseTo(0.5, 12);
    expect(heard).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(199);
    expect(store.get().has(60)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(store.get().has(60)).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('release at four fifths of the note or later ends the level at once, with no drain', () => {
    start(60, 1000); // 2000 ms long: four fifths is at 2600
    heard.mockClear();
    store.release(60, 2600);
    expect(store.get().has(60)).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    start(62, 1000);
    store.release(62, 3500);
    expect(store.get().has(62)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('release just before four fifths still drains from where it was', () => {
    start(60, 1000);
    store.release(60, 2599);
    expect(store.get().get(60)).toMatchObject({ upMs: 2599, drainMs: 200 });
    expect(store.get().get(60)?.fromLevel).toBeCloseTo(0.7995, 6);
    vi.advanceTimersByTime(200);
    expect(store.get().has(60)).toBe(false);
  });

  it('forgives by real elapsed time, not the stepped level of reduced motion', () => {
    reduced = true;
    start(60, 1000); // 4 beats: at 0.85 the stepped level is 0.75, the real fraction 0.85
    store.release(60, 2700);
    expect(store.get().has(60)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends every key of a chord lifted a few ms apart once each is past four fifths', () => {
    start(60, 1000);
    start(64, 1000);
    start(67, 1000);
    store.release(60, 2650);
    store.release(64, 2655);
    store.release(67, 2661);
    expect(store.get().size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('release counts the stepped level under reduced motion', () => {
    reduced = true;
    start(60, 1000);
    store.release(60, 1700);
    expect(store.get().get(60)?.fromLevel).toBe(0.25);
  });

  it('release deletes at once when drainMs is 0', () => {
    drainMs = 0;
    start(60, 1000);
    store.release(60, 2000);
    expect(store.get().has(60)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('release deletes at once a level that has shown nothing yet', () => {
    start(60, 1000);
    store.release(60, 1000);
    expect(store.get().has(60)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('release of a key with no level changes nothing', () => {
    start(60, 1000);
    const before = store.get();
    heard.mockClear();
    store.release(62, 2000);
    expect(store.get()).toBe(before);
    expect(heard).not.toHaveBeenCalled();
  });

  it('release of a key already draining leaves the drain where it is', () => {
    start(60, 1000);
    store.release(60, 2000);
    vi.advanceTimersByTime(100);
    store.release(60, 2100);
    expect(store.get().get(60)?.upMs).toBe(2000);
    vi.advanceTimersByTime(100);
    expect(store.get().has(60)).toBe(false);
  });

  it('start during a drain replaces the level and cancels the deletion', () => {
    start(60, 1000);
    store.release(60, 2000);
    vi.advanceTimersByTime(100);
    expect(vi.getTimerCount()).toBe(1);
    store.start(60, { atMs: 2100, lengthMs: 500, beats: 1 });
    expect(vi.getTimerCount()).toBe(0);
    expect(store.get().get(60)).toMatchObject({ atMs: 2100, lengthMs: 500, upMs: null });
    vi.advanceTimersByTime(1000);
    expect(store.get().has(60)).toBe(true);
  });

  it('keeps one key draining while another rises', () => {
    start(60, 1000);
    start(62, 1000);
    store.release(60, 2000);
    vi.advanceTimersByTime(200);
    expect(store.get().has(60)).toBe(false);
    expect(store.get().get(62)?.upMs).toBeNull();
  });

  it('clear deletes every level at once, draining ones too, and cancels their timers', () => {
    start(60, 1000);
    start(62, 1000);
    store.release(62, 2000);
    expect(vi.getTimerCount()).toBe(1);
    heard.mockClear();
    store.clear();
    expect(store.get()).toBe(NO_LEVELS);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clear of an empty store changes and tells nobody', () => {
    store.clear();
    expect(store.get()).toBe(NO_LEVELS);
    expect(heard).not.toHaveBeenCalled();
  });

  it('dispose cancels the drain timers, so nothing is heard later', () => {
    start(60, 1000);
    store.release(60, 2000);
    expect(vi.getTimerCount()).toBe(1);
    heard.mockClear();
    store.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(heard).not.toHaveBeenCalled();
  });

  it('hands out methods that work unbound, as useSyncExternalStore calls them', () => {
    const { get, start: begin, subscribe } = store;
    const other = vi.fn();
    const off = subscribe(other);
    begin(64, { atMs: 0, lengthMs: 100, beats: 1 });
    expect(get().has(64)).toBe(true);
    expect(other).toHaveBeenCalledTimes(1);
    off();
  });
});
