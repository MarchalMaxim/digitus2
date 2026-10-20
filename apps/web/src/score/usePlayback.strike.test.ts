import { parseMusicXml } from '@digitus2/engine';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import type * as InstrumentExports from '../audio/instrument.js';
import { SAMPLES_FAILED_NOTICE, usePlayback } from './usePlayback.js';

// A key clicked on the on-screen keyboard (issue #96): the note sounds at the hand's unmarked
// velocity, held until the release, two seconds at most. Before the first Play the samples load
// first, through the same `loading` the status line shows, and the note sounds when they arrive.

const instrument = vi.hoisted(() => ({
  load: vi.fn(() => Promise.resolve()),
  start: vi.fn(),
  stopAll: vi.fn(),
  strike: vi.fn(() => instrument.release),
  release: vi.fn(),
}));
vi.mock('../audio/instrument.js', async (importOriginal) => ({
  ...(await importOriginal<typeof InstrumentExports>()),
  instrumentFromLocation: () => instrument,
}));

const ONE_NOTE =
  '<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';

function stubAudio(): void {
  instrument.load.mockImplementation(() => Promise.resolve());
  instrument.strike.mockImplementation(() => instrument.release);
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
  useAppStore.setState({
    settings: { ...DEFAULT_SETTINGS, countIn: false, metronome: false },
    notice: null,
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('loads the piano on the first key press, then sounds the key at its hand’s velocity until released', async () => {
  stubAudio();
  const { score } = parseMusicXml(ONE_NOTE);
  const { result } = renderHook(() => usePlayback(score));
  let release: () => void = () => undefined;
  act(() => {
    release = result.current.strike(64, 'L');
  });
  expect(result.current.loading).toBe(true);
  expect(instrument.load).toHaveBeenCalledWith([60], [96]);
  expect(instrument.strike).not.toHaveBeenCalled();
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(instrument.strike).toHaveBeenCalledWith(64, 88, 2);
  expect(result.current.playing).toBe(false);
  expect(result.current.atStart).toBe(true);
  act(() => release());
  expect(instrument.release).toHaveBeenCalledTimes(1);

  // The samples are at hand: the next key sounds in the press itself, right hand at 96.
  act(() => {
    release = result.current.strike(67, 'R');
  });
  expect(result.current.loading).toBe(false);
  expect(instrument.load).toHaveBeenCalledTimes(1);
  expect(instrument.strike).toHaveBeenLastCalledWith(67, 96, 2);
});

it('tells the reader when the samples could not be loaded, and sounds nothing', async () => {
  stubAudio();
  instrument.load.mockImplementation(() => Promise.reject(new Error('offline')));
  const { score } = parseMusicXml(ONE_NOTE);
  const { result } = renderHook(() => usePlayback(score));
  act(() => {
    result.current.strike(60, 'R');
  });
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(useAppStore.getState().notice).toBe(SAMPLES_FAILED_NOTICE);
  expect(instrument.strike).not.toHaveBeenCalled();
});

it('does nothing without a score', () => {
  stubAudio();
  const { result } = renderHook(() => usePlayback(null));
  act(() => {
    result.current.strike(60, 'R')();
  });
  expect(instrument.load).not.toHaveBeenCalled();
  expect(instrument.strike).not.toHaveBeenCalled();
});
