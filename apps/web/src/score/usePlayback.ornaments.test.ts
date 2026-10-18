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
  vi.clearAllMocks();
});

it('loads the auxiliary sample before first Play even when the pitch never occurs as a written note', async () => {
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
  const { score } = parseMusicXml(
    '<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type><notations><ornaments><trill-mark/></ornaments></notations></note></measure></part></score-partwise>',
  );
  const { result } = renderHook(() => usePlayback(score));
  act(() => result.current.play());
  await waitFor(() => expect(result.current.playing).toBe(true));
  expect(instrument.load).toHaveBeenCalledWith([60, 62], [96]);
});

// The first Play of a one-note piece, with the real transport watched: what Play hands it.
function stubAudio(): void {
  instrument.load.mockImplementation(() => Promise.resolve()); // a cleared mock returns nothing
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
}
const ONE_NOTE =
  '<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';

// One score object for the hook's whole life: a new score would stop the playback.
function renderOneNote() {
  const { score } = parseMusicXml(ONE_NOTE);
  return renderHook(() => usePlayback(score));
}

it('is at the start until Play, and not after it', async () => {
  stubAudio();
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, countIn: false, metronome: false } });
  const { result } = renderOneNote();
  expect(result.current.atStart).toBe(true);
  act(() => result.current.play());
  await waitFor(() => expect(result.current.playing).toBe(true));
  expect(result.current.atStart).toBe(false);
});

it('ignores Play while it is already playing: nothing restarts, nothing reloads', async () => {
  stubAudio();
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, countIn: false, metronome: false } });
  const play = vi.spyOn(Transport.prototype, 'play');
  const { result } = renderOneNote();
  act(() => result.current.play());
  await waitFor(() => expect(result.current.playing).toBe(true));
  act(() => result.current.play());
  expect(play).toHaveBeenCalledTimes(1);
  expect(instrument.load).toHaveBeenCalledTimes(1);
  play.mockRestore();
});

it('holds the first note back (in seconds) only for a Play from the start with no count-in', async () => {
  stubAudio();
  const play = vi.spyOn(Transport.prototype, 'play');
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, countIn: false, metronome: false } });
  const { result } = renderOneNote();
  act(() => result.current.play());
  await waitFor(() => expect(result.current.playing).toBe(true));
  const lead = (play.mock.calls[0]![0] as { leadSec?: number }).leadSec;
  // A short flight of the red, in seconds (not milliseconds).
  expect(lead).toBeGreaterThan(0);
  expect(lead).toBeLessThan(5);
  // Resuming after a pause: the red does not travel from the start, so no lead.
  act(() => result.current.pause());
  act(() => result.current.play());
  await waitFor(() => expect(result.current.playing).toBe(true));
  expect(play).toHaveBeenCalledTimes(2);
  expect(play.mock.calls[1]![0]).toEqual({});
  play.mockRestore();
});

it('asks for no lead when a count-in leads the Play from the start', async () => {
  stubAudio();
  const play = vi.spyOn(Transport.prototype, 'play').mockImplementation(() => undefined); // the count-in needs a fuller audio context
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, countIn: true, metronome: false } });
  const { result } = renderOneNote();
  act(() => result.current.play());
  await waitFor(() => expect(result.current.playing).toBe(true));
  expect(play.mock.calls[0]![0]).toEqual({});
  play.mockRestore();
});
