import { describe, expect, it } from 'vitest';
import { applyCarry, captureCarry } from './carry.js';
import type { LoopRange, Playback } from './usePlayback.js';

/** Four bars of 2.4 s (Twinkle's 4/4 at 100 qpm). */
const BAR_STARTS = [0, 2.4, 4.8, 7.2];

/** A playback that is where it is told to be, and records every call it gets, in order. */
function fakePlayback(
  over: { playing?: boolean; atStart?: boolean; at?: number; loop?: LoopRange | null } = {},
): Playback & { calls: string[] } {
  const calls: string[] = [];
  const at = over.at ?? 0;
  return {
    calls,
    playing: over.playing ?? false,
    loading: false,
    countIn: null,
    waiting: false,
    atStart: over.atStart ?? true,
    cue: null,
    loop: over.loop ?? null,
    play: () => calls.push('play()'),
    pause: () => calls.push('pause()'),
    rewind: () => calls.push('rewind()'),
    seek: (sec) => calls.push(`seek(${sec})`),
    // Playing, the position is the time heard; stopped, the time Play starts from.
    positionSec: () => ((over.playing ?? false) ? at : 0),
    startSec: () => ((over.playing ?? false) ? 0 : at),
    leadingIn: () => false,
    leadInRemainingSec: () => null,
    setLoop: (r) => calls.push(`setLoop(${JSON.stringify(r)})`),
  };
}

describe('captureCarry', () => {
  it('takes the bar of the position while playing', () => {
    const pb = fakePlayback({ playing: true, atStart: false, at: 5.0 });
    expect(captureCarry(pb, BAR_STARTS)).toEqual({
      bar: 2,
      loop: null,
      playing: true,
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
      cued: false,
    });
  });

  it('keeps the loop', () => {
    const pb = fakePlayback({ loop: { from: 1, to: 3 } });
    expect(captureCarry(pb, BAR_STARTS).loop).toEqual({ from: 1, to: 3 });
  });
});

describe('applyCarry', () => {
  it('sets the loop, then seeks to the bar start, then plays', () => {
    const pb = fakePlayback();
    applyCarry({ bar: 2, loop: { from: 1, to: 3 }, playing: true, cued: true }, pb, BAR_STARTS);
    expect(pb.calls).toEqual(['setLoop({"from":1,"to":3})', 'seek(4.8)', 'play()']);
  });

  it('calls nothing for a reader stopped at the start with no loop', () => {
    const pb = fakePlayback();
    applyCarry({ bar: 0, loop: null, playing: false, cued: false }, pb, BAR_STARTS);
    expect(pb.calls).toEqual([]);
  });

  it('cues the bar while stopped, without playing', () => {
    const pb = fakePlayback();
    applyCarry({ bar: 1, loop: null, playing: false, cued: true }, pb, BAR_STARTS);
    expect(pb.calls).toEqual(['seek(2.4)']);
  });

  it('rewinds and plays on from the first bar', () => {
    const pb = fakePlayback();
    applyCarry({ bar: 0, loop: null, playing: true, cued: true }, pb, BAR_STARTS);
    expect(pb.calls).toEqual(['rewind()', 'play()']);
  });

  it('leaves a reader paused inside the first bar at the start', () => {
    const pb = fakePlayback();
    applyCarry({ bar: 0, loop: null, playing: false, cued: true }, pb, BAR_STARTS);
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
    expect(after.calls).toEqual(['setLoop({"from":1,"to":2})', 'seek(4.8)', 'play()']);
  });
});
