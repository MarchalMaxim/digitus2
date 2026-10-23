import { parseMusicXml } from '@digitus2/engine';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Transport } from '../audio/transport.js';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import type * as InstrumentExports from '../audio/instrument.js';
import { usePlayback } from './usePlayback.js';

const instrument = vi.hoisted(() => ({
  load: vi.fn(() => Promise.resolve()),
  start: vi.fn(),
  stopAll: vi.fn(),
}));
vi.mock('../audio/instrument.js', async (importOriginal) => ({
  ...(await importOriginal<typeof InstrumentExports>()),
  instrumentFromLocation: () => instrument,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const TWO_BARS =
  '<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure><measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';

/**
 * Plays a two-bar piece with the transport's own play held back (the audio context is a stub),
 * and hands back `end`, which reports the end as the transport's scheduler would.
 */
async function playTwoBars({ play = true }: { play?: boolean } = {}) {
  instrument.load.mockImplementation(() => Promise.resolve());
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
  let end: () => void = () => {};
  // The stub keeps the transport's own `playing` flag as the real one does: set by play, cleared
  // by the end before `onEnd` reports it, so `state.playing` is the live fact `playingNow` reads.
  const flag = (t: Transport) => t as unknown as { playing: boolean };
  vi.spyOn(Transport.prototype, 'play').mockImplementation(function (this: Transport) {
    flag(this).playing = true;
    end = () => {
      flag(this).playing = false;
      this.onEnd?.();
    };
  });
  const { score } = parseMusicXml(TWO_BARS);
  const hook = renderHook(() => usePlayback(score));
  if (play) {
    act(() => hook.result.current.play());
    await waitFor(() => expect(hook.result.current.playing).toBe(true));
  }
  return { ...hook, end: () => end() };
}

// Issue #97: the end of the piece is the one transition the finish (EndBurst.tsx) answers.
it('counts the end of the piece, once per play-through', async () => {
  const { result, end } = await playTwoBars();
  expect(result.current.ended).toBe(0);
  act(() => end());
  expect(result.current.ended).toBe(1);
  expect(result.current.playing).toBe(false);
  expect(result.current.atStart).toBe(true);
  act(() => result.current.play());
  await waitFor(() => expect(result.current.playing).toBe(true));
  expect(result.current.ended).toBe(1); // nothing until the next end
  act(() => end());
  expect(result.current.ended).toBe(2);
});

it('reads the transport stopped at the end, before the render that sets playing false', async () => {
  const { result, end } = await playTwoBars({ play: false });
  expect(result.current.playingNow()).toBe(false); // before the first Play
  act(() => result.current.play());
  await waitFor(() => expect(result.current.playing).toBe(true));
  expect(result.current.playingNow()).toBe(true);
  // The end clears the transport's flag, then reports it: `playing` follows in React's render.
  // A frame between the two reads the transport, not the stale `playing`.
  let atEnd: boolean | null = null;
  act(() => {
    end();
    atEnd = result.current.playingNow();
  });
  expect(atEnd).toBe(false);
  expect(result.current.playing).toBe(false);
});

it('counts nothing on Pause, Rewind, a seek, a loop or a change of score', async () => {
  const { result, rerender } = await playTwoBars();
  act(() => result.current.pause());
  expect(result.current.ended).toBe(0);
  act(() => result.current.rewind()); // stopped: back to the start, as the end leaves it
  expect(result.current.atStart).toBe(true);
  expect(result.current.ended).toBe(0);
  act(() => result.current.seek(2));
  expect(result.current.ended).toBe(0);
  act(() => result.current.setLoop({ from: 0, to: 1 }));
  act(() => result.current.setLoop(null));
  expect(result.current.ended).toBe(0);
  rerender(); // a re-render of the same score changes nothing
  expect(result.current.ended).toBe(0);
});
