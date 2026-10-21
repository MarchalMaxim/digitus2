import { parseMusicXml } from '@digitus2/engine';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import type * as InstrumentExports from '../audio/instrument.js';
import { usePlayback } from './usePlayback.js';

// Four bars at 100 bpm: a one-beat pickup, then three complete 3/4 bars.
// Their starts are 0, 0.6, 2.4 and 4.2 seconds; the piece ends at 6 seconds.
const { score } = parseMusicXml(
  '<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P">' +
    [1, 3, 3, 3]
      .map(
        (duration, i) =>
          `<measure number="${i + 1}">${i === 0 ? '<attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="100"/></direction>' : ''}<note><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration></note></measure>`,
      )
      .join('') +
    '</part></score-partwise>',
);

vi.mock('../audio/instrument.js', async (importOriginal) => ({
  ...(await importOriginal<typeof InstrumentExports>()),
  instrumentFromLocation: () => ({
    load: () => Promise.resolve(),
    start: () => {},
    stopAll: () => {},
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('uses a loop excluding the pending cue without losing that cue when the loop is removed', () => {
  const { result } = renderHook(() => usePlayback(score));
  act(() => result.current.seek(0.6));
  act(() => result.current.setLoop({ from: 2, to: 3 }));
  expect(result.current.startSec()).toBeCloseTo(2.4);
  expect(result.current.positionSec()).toBeCloseTo(0.6);
  expect(result.current.cue).toBeCloseTo(0.6);
  act(() => result.current.setLoop(null));
  expect(result.current.startSec()).toBeCloseTo(0.6);
  expect(result.current.cue).toBeCloseTo(0.6);
});

it.each([
  { label: 'inclusive start', cue: 0.6, from: 1, to: 2, want: 0.6 },
  { label: 'inside', cue: 2.4, from: 1, to: 2, want: 2.4 },
  { label: 'exclusive end', cue: 4.2, from: 1, to: 2, want: 0.6 },
  { label: 'pickup end', cue: 0.6, from: 0, to: 0, want: 0 },
  { label: 'fractional indices', cue: 0.6, from: 2.9, to: 3.9, want: 2.4 },
  { label: 'clamped high indices', cue: 0.6, from: 20, to: 30, want: 4.2 },
  { label: 'clamped low indices', cue: 0.6, from: -2, to: -1, want: 0 },
  { label: 'reversed range', cue: 0.6, from: 3, to: 1, want: 0.6 },
])('normalizes the pre-play loop at $label', ({ cue, from, to, want }) => {
  const { result } = renderHook(() => usePlayback(score));
  act(() => result.current.seek(cue));
  act(() => result.current.setLoop({ from, to }));
  expect(result.current.startSec()).toBeCloseTo(want);
});

it('advertises the loop start before any seek or playback', () => {
  const { result } = renderHook(() => usePlayback(score));
  act(() => result.current.setLoop({ from: 2, to: 3 }));
  expect(result.current.startSec()).toBeCloseTo(2.4);
  expect(result.current.positionSec()).toBe(0);
  expect(result.current.cue).toBeNull();
});

it.each(['no measures', 'empty measure'])('ignores a loop with $s', (kind) => {
  const emptyScore = {
    ...score,
    measures:
      kind === 'no measures'
        ? []
        : score.measures.map((measure) => ({ ...measure, lengthTicks: 0 })),
  };
  const { result } = renderHook(() => usePlayback(emptyScore));
  act(() => result.current.seek(0.6));
  act(() => result.current.setLoop({ from: 2, to: 2 }));
  expect(result.current.startSec()).toBeCloseTo(0.6);
});

it('starts the first playback at the advertised loop boundary after a pickup', async () => {
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
  const { result } = renderHook(() => usePlayback(score));
  act(() => result.current.seek(0.6));
  act(() => result.current.setLoop({ from: 2, to: 3 }));
  expect(result.current.startSec()).toBeCloseTo(2.4);
  act(() => result.current.play());
  await waitFor(() => expect(result.current.playing).toBe(true));
  expect(result.current.positionSec()).toBeCloseTo(2.4);
});
