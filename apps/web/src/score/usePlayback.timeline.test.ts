import { readFileSync } from 'node:fs';
import { parseMusicXml, type Score } from '@digitus2/engine';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import type * as InstrumentExports from '../audio/instrument.js';
import { Transport } from '../audio/transport.js';
import { usePlayback } from './usePlayback.js';

// The timeline the play-along's timing reads through playback (issue 192): `heardAt` and
// `runPasses` hand the transport's over, and the test hook reports the output latency.
// A path held in a variable stays a file URL (Vite rewrites a literal one into an asset URL).
const fixturePath = (name: string) => `../../../../packages/engine/fixtures/${name}.musicxml`;
const repeat: Score = parseMusicXml(
  readFileSync(new URL(fixturePath('form-repeat'), import.meta.url), 'utf8'),
).score;

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
      outputLatency = 0.04;
      close() {
        return Promise.resolve();
      }
    },
  );
  window.history.replaceState({}, '', '/');
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, countIn: false, metronome: false } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

it('heardAt is null before Play and while stopped, and the transport answer while playing', async () => {
  const heardAt = vi.spyOn(Transport.prototype, 'heardAt');
  const { result } = renderHook(() => usePlayback(repeat));
  expect(result.current.heardAt!()).toBeNull();
  expect(result.current.heardAt!(1234)).toBeNull();

  act(() => result.current.play());
  await waitFor(() => expect(result.current.playing).toBe(true));
  const at = result.current.heardAt!(1234);
  expect(heardAt).toHaveBeenLastCalledWith(1234);
  expect(at).toEqual(heardAt.mock.results.at(-1)!.value);
  expect(at).toEqual({
    pass: result.current.runPasses!()[0]!.pass,
    perfSec: expect.any(Number),
    factor: 1,
  });

  act(() => result.current.pause());
  expect(result.current.heardAt!()).toBeNull();
});

it('runPasses is empty before the first Play, then the transport log, kept after a Pause', async () => {
  const runPasses = vi.spyOn(Transport.prototype, 'runPasses');
  const { result } = renderHook(() => usePlayback(repeat));
  expect(result.current.runPasses!()).toEqual([]);

  act(() => result.current.play());
  await waitFor(() => expect(result.current.playing).toBe(true));
  act(() => result.current.pause());
  const passes = result.current.runPasses!();
  expect(passes).toEqual(runPasses.mock.results.at(-1)!.value);
  // The clock stood still in the lead before the first note: one pass, empty.
  expect(passes).toEqual([
    { pass: expect.any(Number), fromSec: 0, toSec: 0, wrapped: false, countedIn: false },
  ]);

  // A new score drops the transport, and with it the log.
  const { result: other, rerender } = renderHook(({ s }) => usePlayback(s), {
    initialProps: { s: repeat },
  });
  act(() => other.current.play());
  await waitFor(() => expect(other.current.playing).toBe(true));
  act(() => other.current.pause());
  expect(other.current.runPasses!()).toHaveLength(1);
  rerender({
    s: parseMusicXml(readFileSync(new URL(fixturePath('form-repeat'), import.meta.url), 'utf8'))
      .score,
  });
  expect(other.current.runPasses!()).toEqual([]);
});

it('playId changes at every start, also when a carried play starts again with a new score', async () => {
  // As useEmbellishCarry does: after the new score's halt, play on in the same commit.
  let carry = false;
  const seen: boolean[] = [];
  const { result, rerender } = renderHook(
    ({ s }: { s: Score }) => {
      const playback = usePlayback(s);
      seen.push(playback.playing);
      const { play } = playback;
      useEffect(() => {
        if (carry) play({ resume: true });
      }, [s, play]);
      return playback;
    },
    { initialProps: { s: repeat } },
  );
  const ids = [result.current.playId];
  act(() => result.current.play());
  await waitFor(() => expect(result.current.playing).toBe(true));
  ids.push(result.current.playId);
  act(() => result.current.pause());
  act(() => result.current.play());
  expect(result.current.playing).toBe(true);
  ids.push(result.current.playId);
  const firstPass = result.current.runPasses!()[0]!.pass;

  carry = true;
  seen.length = 0;
  const swapped = parseMusicXml(
    readFileSync(new URL(fixturePath('form-repeat'), import.meta.url), 'utf8'),
  ).score;
  act(() => rerender({ s: swapped }));
  carry = false;
  // Playing all along, so only playId says a new run began, with a new first pass.
  expect(seen).not.toContain(false);
  expect(result.current.playing).toBe(true);
  ids.push(result.current.playId);
  expect(new Set(ids).size).toBe(ids.length);
  expect(result.current.runPasses!()[0]!.pass).toBeGreaterThan(firstPass);
  act(() => result.current.pause());
});

it('the test hook reports the output latency of the audio context, null before there is one', async () => {
  window.history.replaceState({}, '', '/?hooks=1');
  const hook = () =>
    (window as unknown as { __digitus2Keys?: { outputLatency(): number | null } }).__digitus2Keys;
  const { result, unmount } = renderHook(() => usePlayback(repeat));
  expect(hook()!.outputLatency()).toBeNull();
  act(() => result.current.play());
  await waitFor(() => expect(result.current.playing).toBe(true));
  expect(hook()!.outputLatency()).toBe(0.04);
  unmount();
  expect(hook()).toBeUndefined();
});
