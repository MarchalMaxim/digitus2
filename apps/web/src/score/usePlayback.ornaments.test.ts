import { parseMusicXml } from '@digitus2/engine';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { usePlayback } from './usePlayback.js';

const instrument = vi.hoisted(() => ({
  load: vi.fn(() => Promise.resolve()),
  start: vi.fn(),
  stopAll: vi.fn(),
}));
vi.mock('../audio/instrument.js', () => ({ instrumentFromLocation: () => instrument }));

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
  expect(instrument.load).toHaveBeenCalledWith([60, 62]);
});
