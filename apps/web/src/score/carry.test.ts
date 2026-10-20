import { describe, expect, it } from 'vitest';
import { applyCarry, captureCarry, carryStep, type Carry, type PendingCarry } from './carry.js';
import type { LoopRange, Playback } from './usePlayback.js';

/** Four bars of 2.4 s (Twinkle's 4/4 at 100 qpm). */
const BAR_STARTS = [0, 2.4, 4.8, 7.2];

/** A playback that is where it is told to be, and records every call it gets, in order. */
function fakePlayback(
  over: {
    playing?: boolean;
    loading?: boolean;
    countIn?: Playback['countIn'];
    atStart?: boolean;
    at?: number;
    loop?: LoopRange | null;
  } = {},
): Playback & { calls: string[] } {
  const calls: string[] = [];
  const at = over.at ?? 0;
  return {
    calls,
    playing: over.playing ?? false,
    loading: over.loading ?? false,
    countIn: over.countIn ?? null,
    waiting: false,
    atStart: over.atStart ?? true,
    ended: 0,
    cue: null,
    loop: over.loop ?? null,
    play: (opts) => calls.push(opts ? `play(${JSON.stringify(opts)})` : 'play()'),
    pause: () => calls.push('pause()'),
    rewind: () => calls.push('rewind()'),
    seek: (sec) => calls.push(`seek(${sec})`),
    // Playing, the position is the time heard; stopped, the time Play starts from.
    positionSec: () => ((over.playing ?? false) ? at : 0),
    startSec: () => ((over.playing ?? false) ? 0 : at),
    leadingIn: () => false,
    leadInRemainingSec: () => null,
    setLoop: (r) => calls.push(`setLoop(${JSON.stringify(r)})`),
    strike: () => () => undefined,
  };
}

describe('captureCarry', () => {
  it('takes the bar of the position while playing', () => {
    const pb = fakePlayback({ playing: true, atStart: false, at: 5.0 });
    expect(captureCarry(pb, BAR_STARTS)).toEqual({
      bar: 2,
      loop: null,
      playing: true,
      resume: true,
      cued: true,
    });
    expect(pb.calls).toEqual([]);
  });

  it('takes the bar Play starts from while stopped and cued', () => {
    const pb = fakePlayback({ atStart: false, at: 2.4 });
    expect(captureCarry(pb, BAR_STARTS)).toMatchObject({ bar: 1, playing: false, cued: true });
  });

  it('is not cued at the start', () => {
    const pb = fakePlayback();
    expect(captureCarry(pb, BAR_STARTS)).toEqual({
      bar: 0,
      loop: null,
      playing: false,
      resume: false,
      cued: false,
    });
  });

  it('keeps the loop', () => {
    const pb = fakePlayback({ loop: { from: 1, to: 3 } });
    expect(captureCarry(pb, BAR_STARTS).loop).toEqual({ from: 1, to: 3 });
  });

  // Review S1: Play still loading its samples is a Play; the switch must not lose it.
  it('counts a Play still loading its samples as playing, not yet heard', () => {
    const pb = fakePlayback({ loading: true, atStart: false, at: 5.0 });
    expect(captureCarry(pb, BAR_STARTS)).toEqual({
      bar: 2,
      loop: null,
      playing: true,
      resume: false,
      cued: true,
    });
  });

  // A Play still counting in has not been heard: it counts in again after the switch.
  it('does not resume a Play that is still counting in', () => {
    const pb = fakePlayback({
      playing: true,
      atStart: false,
      countIn: { beat: 1, beats: 4, beatInBar: 2 },
    });
    expect(captureCarry(pb, BAR_STARTS)).toMatchObject({ playing: true, resume: false });
  });
});

describe('applyCarry', () => {
  it('sets the loop, then seeks to the bar start, then plays on', () => {
    const pb = fakePlayback();
    applyCarry(
      { bar: 2, loop: { from: 1, to: 3 }, playing: true, resume: true, cued: true },
      pb,
      BAR_STARTS,
    );
    expect(pb.calls).toEqual(['setLoop({"from":1,"to":3})', 'seek(4.8)', 'play({"resume":true})']);
  });

  it('calls nothing for a reader stopped at the start with no loop', () => {
    const pb = fakePlayback();
    applyCarry({ bar: 0, loop: null, playing: false, resume: false, cued: false }, pb, BAR_STARTS);
    expect(pb.calls).toEqual([]);
  });

  it('cues the bar while stopped, without playing', () => {
    const pb = fakePlayback();
    applyCarry({ bar: 1, loop: null, playing: false, resume: false, cued: true }, pb, BAR_STARTS);
    expect(pb.calls).toEqual(['seek(2.4)']);
  });

  it('rewinds and plays on from the first bar', () => {
    const pb = fakePlayback();
    applyCarry({ bar: 0, loop: null, playing: true, resume: true, cued: true }, pb, BAR_STARTS);
    expect(pb.calls).toEqual(['rewind()', 'play({"resume":true})']);
  });

  it('leaves a reader paused inside the first bar at the start', () => {
    const pb = fakePlayback();
    applyCarry({ bar: 0, loop: null, playing: false, resume: false, cued: true }, pb, BAR_STARTS);
    expect(pb.calls).toEqual([]);
  });

  // Review Focus 3: switching while playing with a loop on.
  it('carry keeps the loop, the bar and the play state', () => {
    const before = fakePlayback({
      playing: true,
      atStart: false,
      at: 5.0,
      loop: { from: 1, to: 2 },
    });
    const carry = captureCarry(before, BAR_STARTS);
    const after = fakePlayback();
    applyCarry(carry, after, BAR_STARTS);
    expect(after.calls).toEqual([
      'setLoop({"from":1,"to":2})',
      'seek(4.8)',
      'play({"resume":true})',
    ]);
  });

  // Review S1: the Play that was loading starts as a new Play does, at the same bar.
  it('starts a Play that was still loading as a new Play, at the bar', () => {
    const before = fakePlayback({ loading: true, atStart: false, at: 5.0 });
    const after = fakePlayback();
    applyCarry(captureCarry(before, BAR_STARTS), after, BAR_STARTS);
    expect(after.calls).toEqual(['seek(4.8)', 'play()']);
  });
});

// Review S4: what the score view does with a recorded carry, on every change it watches.
describe('carryStep', () => {
  const plain = { id: 'plain' };
  const embellished = { id: 'embellished' };
  const carry: Carry = { bar: 1, loop: null, playing: true, resume: true, cued: true };
  const pending: PendingCarry<object> = { carry, to: 'embellished', from: plain };

  it('drops the carry when the switch is no longer offered (refused, withdrawn)', () => {
    expect(carryStep(pending, { score: plain, embellish: 'none', shownVersion: 'plain' })).toBe(
      'drop',
    );
    expect(carryStep(pending, { score: plain, embellish: 'pending', shownVersion: 'plain' })).toBe(
      'drop',
    );
  });

  it('waits while the other version is still on screen', () => {
    expect(carryStep(pending, { score: plain, embellish: 'offered', shownVersion: 'plain' })).toBe(
      'wait',
    );
  });

  it('clears it without applying when the version asked for shows the same score', () => {
    // Switched on and off again before the embellished pages came in: nothing was halted.
    const back: PendingCarry<object> = { carry, to: 'plain', from: plain };
    expect(carryStep(back, { score: plain, embellish: 'offered', shownVersion: 'plain' })).toBe(
      'clear',
    );
  });

  it('applies it once the version asked for is on screen with its new score', () => {
    expect(
      carryStep(pending, {
        score: embellished,
        embellish: 'offered',
        shownVersion: 'embellished',
      }),
    ).toBe('apply');
  });
});
