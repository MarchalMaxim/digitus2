import { readFileSync } from 'node:fs';
import { parseMusicXml, type Score } from '@digitus2/engine';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import type * as InstrumentExports from '../audio/instrument.js';
import { Transport } from '../audio/transport.js';
import { usePlayback } from './usePlayback.js';

// Playback for the play-along (issue 182): a cue and a finish in performance seconds. The pieces
// are the engine's form fixtures, whole notes at 120 qpm in 4/4, two seconds a bar.
// A path held in a variable stays a file URL (Vite rewrites a literal one into an asset URL).
const fixturePath = (name: string) => `../../../../packages/engine/fixtures/${name}.musicxml`;
const form = (name: string): Score =>
  parseMusicXml(readFileSync(new URL(fixturePath(name), import.meta.url), 'utf8')).score;
const repeat = form('form-repeat'); // bars 1 2 | 1 2: perf 0-2, 2-4, 4-6, 6-8; written 0-4
const voltas = form('form-voltas'); // bars 1 2 3 | 1 2 | 4: 12 s, bars 3 and 4 not heard in a row

vi.mock('../audio/instrument.js', async (importOriginal) => ({
  ...(await importOriginal<typeof InstrumentExports>()),
  instrumentFromLocation: () => ({
    load: () => Promise.resolve(),
    start: () => {},
    stopAll: () => {},
  }),
}));

beforeEach(() => {
  vi.stubGlobal(
    'AudioContext',
    class {
      currentTime = 100;
      state = 'running';
      close() {
        return Promise.resolve();
      }
    },
  );
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, countIn: false, metronome: false } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function playAndPause(result: { current: ReturnType<typeof usePlayback> }) {
  act(() => result.current.play());
  await waitFor(() => expect(result.current.playing).toBe(true));
  act(() => result.current.pause());
}

it('cues the very start without rewinding: cue 0, not at the start', () => {
  const { result } = renderHook(() => usePlayback(repeat));
  act(() => result.current.cueAt(0));
  expect(result.current.cue).toBe(0);
  expect(result.current.atStart).toBe(false);
  expect(result.current.ended).toBe(0);
  expect(result.current.positionSec()).toBe(0);
  expect(result.current.startPerformanceSec()).toBe(0);
  // A seek to 0 is a Rewind: it clears the cue and puts Play back at the start.
  act(() => result.current.seek(0));
  expect(result.current.cue).toBeNull();
  expect(result.current.atStart).toBe(true);
});

it('keeps the hearing of a cue made before the first Play: the second time a bar is heard', async () => {
  const seekPerformance = vi.spyOn(Transport.prototype, 'seekPerformance');
  const seek = vi.spyOn(Transport.prototype, 'seek');
  const { result } = renderHook(() => usePlayback(repeat));
  act(() => result.current.cueAt(5)); // one second into the second hearing of bar 1
  expect(result.current.positionSec()).toBeCloseTo(1, 6); // written
  expect(result.current.startSec()).toBeCloseTo(1, 6);
  expect(result.current.startPerformanceSec()).toBeCloseTo(5, 6);
  expect(result.current.cue).toBeCloseTo(1, 6);
  expect(result.current.atStart).toBe(false);

  await playAndPause(result);
  expect(seekPerformance).toHaveBeenCalledWith(5);
  expect(seek).not.toHaveBeenCalled();
  // The stopped clock holds the position at the start of the music: Play started on the second
  // hearing (a written seek would have taken the first, perf 1).
  expect(result.current.startPerformanceSec()).toBeCloseTo(5, 6);
  expect(result.current.positionSec()).toBeCloseTo(1, 6);
});

it('cues again on a transport that exists, stopped: Play starts at the new hearing', async () => {
  const seekPerformance = vi.spyOn(Transport.prototype, 'seekPerformance');
  const { result } = renderHook(() => usePlayback(repeat));
  await playAndPause(result);
  act(() => result.current.cueAt(6)); // the start of the second hearing of bar 2
  expect(seekPerformance).toHaveBeenLastCalledWith(6);
  expect(result.current.startPerformanceSec()).toBeCloseTo(6, 6);
  expect(result.current.startSec()).toBeCloseTo(2, 6);
  expect(result.current.positionSec()).toBeCloseTo(2, 6);
  expect(result.current.cue).toBeCloseTo(2, 6);
  expect(result.current.atStart).toBe(false);
});

it('does nothing while the transport plays', async () => {
  const seekPerformance = vi.spyOn(Transport.prototype, 'seekPerformance');
  const { result } = renderHook(() => usePlayback(repeat));
  act(() => result.current.cueAt(5));
  act(() => result.current.play());
  await waitFor(() => expect(result.current.playing).toBe(true));
  const calls = seekPerformance.mock.calls.length;
  const cue = result.current.cue;
  const position = result.current.positionSec();
  act(() => result.current.cueAt(2));
  expect(seekPerformance.mock.calls.length).toBe(calls);
  expect(result.current.cue).toBe(cue);
  expect(result.current.positionSec()).toBe(position);
  expect(result.current.playing).toBe(true);
});

it('changes nothing when it is cued to where it already is', () => {
  const { result } = renderHook(() => usePlayback(repeat));
  act(() => result.current.cueAt(5));
  const before = result.current;
  act(() => result.current.cueAt(5));
  expect(result.current).toBe(before); // no state changed: React did not render again
});

it.each([
  [
    'Rewind',
    (pb: ReturnType<typeof usePlayback>) => pb.rewind(),
    { position: 0, startPerf: 0, cue: null },
  ],
  [
    'finish',
    (pb: ReturnType<typeof usePlayback>) => pb.finish(),
    { position: 0, startPerf: 0, cue: null },
  ],
])('a pending cue is dropped by %s', (_what, move, want) => {
  const { result } = renderHook(() => usePlayback(repeat));
  act(() => result.current.cueAt(5));
  act(() => move(result.current));
  expect(result.current.positionSec()).toBeCloseTo(want.position, 6);
  expect(result.current.startPerformanceSec()).toBeCloseTo(want.startPerf, 6);
  expect(result.current.startSec()).toBeCloseTo(want.position, 6);
  if (want.cue === null) expect(result.current.cue).toBeNull();
  else expect(result.current.cue).toBeCloseTo(want.cue, 6);
});

it('a pending cue is dropped by a new score', () => {
  const { result, rerender } = renderHook(({ shown }) => usePlayback(shown), {
    initialProps: { shown: repeat },
  });
  act(() => result.current.cueAt(5));
  rerender({ shown: voltas });
  expect(result.current.cue).toBeNull();
  expect(result.current.atStart).toBe(true);
  expect(result.current.positionSec()).toBe(0);
  expect(result.current.startPerformanceSec()).toBe(0);
});

it('finish is the transport’s end: the top, no cue, at the start, one more finish', async () => {
  const { result } = renderHook(() => usePlayback(repeat));
  act(() => result.current.cueAt(5));
  act(() => result.current.finish());
  expect(result.current.ended).toBe(1);
  expect(result.current.atStart).toBe(true);
  expect(result.current.cue).toBeNull();
  expect(result.current.playing).toBe(false);
  expect(result.current.positionSec()).toBe(0);

  // With a transport that was played and paused, finish rewinds it as the end does.
  await playAndPause(result);
  act(() => result.current.cueAt(6));
  act(() => result.current.finish());
  expect(result.current.ended).toBe(2);
  expect(result.current.positionSec()).toBe(0);
  expect(result.current.startPerformanceSec()).toBe(0);
  expect(result.current.atStart).toBe(true);
  expect(result.current.cue).toBeNull();
});

it('finish does nothing while the transport plays', async () => {
  const { result } = renderHook(() => usePlayback(repeat));
  act(() => result.current.play());
  await waitFor(() => expect(result.current.playing).toBe(true));
  act(() => result.current.finish());
  expect(result.current.ended).toBe(0);
  expect(result.current.playing).toBe(true);
  expect(result.current.atStart).toBe(false);
});

it('regression: a written seek before the first Play still lands on the first hearing', async () => {
  const seekPerformance = vi.spyOn(Transport.prototype, 'seekPerformance');
  const seek = vi.spyOn(Transport.prototype, 'seek');
  const { result } = renderHook(() => usePlayback(repeat));
  act(() => result.current.seek(2)); // bar 2, written
  expect(result.current.positionSec()).toBeCloseTo(2, 6);
  expect(result.current.startPerformanceSec()).toBeCloseTo(2, 6); // the first hearing
  expect(result.current.cue).toBeCloseTo(2, 6);
  await playAndPause(result);
  expect(seek).toHaveBeenCalledWith(2); // the written seek, which enters the first hearing
  expect(seekPerformance.mock.calls.map(([sec]) => sec)).toEqual([2]); // never the second hearing
  expect(result.current.startPerformanceSec()).toBeCloseTo(2, 6);
});

it('a seek after a cue made before the first Play stays in the hearing the cue is in', async () => {
  const seekPerformance = vi.spyOn(Transport.prototype, 'seekPerformance');
  const seek = vi.spyOn(Transport.prototype, 'seek');
  const { result } = renderHook(() => usePlayback(repeat));
  act(() => result.current.cueAt(4)); // the second hearing of bar 1 (written 0)
  act(() => result.current.seek(2)); // bar 2: the next bar of this hearing, perf 6, not perf 2
  expect(result.current.positionSec()).toBeCloseTo(2, 6);
  expect(result.current.startSec()).toBeCloseTo(2, 6);
  expect(result.current.startPerformanceSec()).toBeCloseTo(6, 6);
  expect(result.current.cue).toBeCloseTo(2, 6);
  expect(result.current.atStart).toBe(false);

  await playAndPause(result);
  expect(seekPerformance).toHaveBeenCalledWith(6);
  expect(seek).not.toHaveBeenCalled();
  expect(result.current.startPerformanceSec()).toBeCloseTo(6, 6);
});

it('a seek back, after a cue made before the first Play, enters the bar at the hearing before', () => {
  const { result } = renderHook(() => usePlayback(repeat));
  act(() => result.current.cueAt(6)); // the second hearing of bar 2 (written 2)
  act(() => result.current.seek(1)); // written 1: going back, it is the second hearing of bar 1
  expect(result.current.positionSec()).toBeCloseTo(1, 6);
  expect(result.current.startPerformanceSec()).toBeCloseTo(5, 6);
});

it('a cue replaces a written seek before the first Play, and a written seek keeps a cue’s hearing', () => {
  const { result } = renderHook(() => usePlayback(repeat));
  act(() => result.current.seek(2));
  act(() => result.current.cueAt(6));
  expect(result.current.startPerformanceSec()).toBeCloseTo(6, 6);
  // As with a transport (Transport.seek), a seek goes to the bar nearest the hearing Play is at:
  // written 1 from the second hearing of bar 2 is the second hearing of bar 1, perf 5.
  act(() => result.current.seek(1));
  expect(result.current.startPerformanceSec()).toBeCloseTo(5, 6);
  expect(result.current.positionSec()).toBeCloseTo(1, 6);
});

it('a written seek after a written seek, with no cue, is as it always was: the first hearing', () => {
  const { result } = renderHook(() => usePlayback(repeat));
  act(() => result.current.seek(2));
  act(() => result.current.seek(1));
  expect(result.current.startPerformanceSec()).toBeCloseTo(1, 6);
  expect(result.current.positionSec()).toBeCloseTo(1, 6);
});

it('reads the loop in performance seconds, before the first Play and after', async () => {
  const { result } = renderHook(() => usePlayback(repeat));
  expect(result.current.performanceLoop()).toBeNull();
  act(() => result.current.cueAt(5));
  act(() => result.current.setLoop({ from: 0, to: 1 }));
  // Two stretches (perf 0-4 and 4-8): the one that holds the cue.
  expect(result.current.performanceLoop()).toEqual({ from: 4, to: 8 });
  expect(result.current.startPerformanceSec()).toBeCloseTo(5, 6);
  expect(result.current.startSec()).toBeCloseTo(1, 6);

  await playAndPause(result);
  expect(result.current.performanceLoop()).toEqual({ from: 4, to: 8 }); // the transport's own
  act(() => result.current.setLoop(null));
  expect(result.current.performanceLoop()).toBeNull();
});

it('starts a cue that lies outside the loop at the loop’s start', async () => {
  // Bars 3 and 4 of the voltas piece are not heard in a row: the loop runs from perf 4 to 12.
  const { result } = renderHook(() => usePlayback(voltas));
  act(() => result.current.cueAt(2));
  act(() => result.current.setLoop({ from: 2, to: 3 }));
  expect(result.current.performanceLoop()).toEqual({ from: 4, to: 12 });
  expect(result.current.startPerformanceSec()).toBe(4);
  expect(result.current.startSec()).toBeCloseTo(4, 6);
  expect(result.current.positionSec()).toBeCloseTo(2, 6); // the cue itself is kept
  act(() => result.current.setLoop(null));
  expect(result.current.startPerformanceSec()).toBeCloseTo(2, 6);
  expect(result.current.startSec()).toBeCloseTo(2, 6);
});

it('does nothing without a score', () => {
  const { result } = renderHook(() => usePlayback(null));
  act(() => result.current.cueAt(5));
  act(() => result.current.finish());
  expect(result.current.cue).toBeNull();
  expect(result.current.ended).toBe(0);
  expect(result.current.startPerformanceSec()).toBe(0);
  expect(result.current.performanceLoop()).toBeNull();
});
