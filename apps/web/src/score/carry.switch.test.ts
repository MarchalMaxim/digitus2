import { readFileSync } from 'node:fs';
import { parseMusicXml, type Score } from '@digitus2/engine';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useMemo } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import type * as InstrumentExports from '../audio/instrument.js';
import { Transport } from '../audio/transport.js';
import { barStartSecs } from './bars.js';
import { useEmbellishCarry } from './carry.js';
import { usePlayback } from './usePlayback.js';
import type { ScoreDocument } from './useScoreDocument.js';

// "Add notes between" (issue #67) with the real player: the carry across a switch, as the score
// view composes it (usePlayback first, then the carry), on two score objects of the same music,
// which is what a switch between the plain and the embellished version looks like to the player.

const instrument = vi.hoisted(() => ({
  load: vi.fn(() => Promise.resolve()),
  start: vi.fn(),
  stopAll: vi.fn(),
}));
vi.mock('../audio/instrument.js', async (importOriginal) => ({
  ...(await importOriginal<typeof InstrumentExports>()),
  instrumentFromLocation: () => instrument,
}));

// A path held in a variable stays a file URL (Vite rewrites a literal one into an asset URL).
const path = '../../fixtures/short-piano.musicxml';
const XML = readFileSync(new URL(path, import.meta.url), 'utf8');
const plainScore = parseMusicXml(XML).score;
const embellishedScore = parseMusicXml(XML).score;

interface Props {
  score: Score;
  shownVersion: ScoreDocument['shownVersion'];
}

const setEmbellished = vi.fn();

function renderView() {
  return renderHook(
    ({ score, shownVersion }: Props) => {
      const playback = usePlayback(score);
      const barStarts = useMemo(() => barStartSecs(score), [score]);
      const toggle = useEmbellishCarry(
        { embellish: 'offered', shownVersion, setEmbellished },
        score,
        playback,
        barStarts,
      );
      return { playback, toggle };
    },
    { initialProps: { score: plainScore, shownVersion: 'plain' } as Props },
  );
}

/** Lets every pending promise and effect run, so a Play that should not come has had its chance. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await act(async () => {});
}

beforeEach(() => {
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// Review S2: the new pages can take a layout to come in; a Pause meanwhile is the reader's last
// word, and the music must not start again by itself when the switch lands.
it('keeps a Pause made after the switch was asked for and before it landed', async () => {
  const { result, rerender } = renderView();
  act(() => result.current.playback.play());
  await waitFor(() => expect(result.current.playback.playing).toBe(true));

  act(() => result.current.toggle(true));
  expect(setEmbellished).toHaveBeenCalledWith(true);
  act(() => result.current.playback.pause());
  expect(result.current.playback.playing).toBe(false);

  rerender({ score: embellishedScore, shownVersion: 'embellished' });
  await settle();
  expect(result.current.playback.playing).toBe(false);
  expect(result.current.playback.loading).toBe(false);
});

// The other way round: stopped at the click, Play pressed before the switch lands plays on.
it('plays on after the switch when Play was pressed before it landed', async () => {
  const { result, rerender } = renderView();
  act(() => result.current.toggle(true));
  act(() => result.current.playback.play());
  await waitFor(() => expect(result.current.playback.playing).toBe(true));

  rerender({ score: embellishedScore, shownVersion: 'embellished' });
  await settle();
  expect(result.current.playback.playing).toBe(true);
});

// A carried play goes on as the music did: no reload of the samples the piano already holds
// (no "Loading the piano…"), and no count-in, which only starts a Play.
it('plays on across the switch at once, without loading the samples again or counting in', async () => {
  const play = vi.spyOn(Transport.prototype, 'play');
  const { result, rerender } = renderView();
  act(() => result.current.playback.play());
  await waitFor(() => expect(result.current.playback.playing).toBe(true));
  expect(instrument.load).toHaveBeenCalledTimes(1);
  // Count-in on from here: a new Play would count in.
  act(() => useAppStore.getState().setSettings({ countIn: true }));

  act(() => result.current.toggle(true));
  rerender({ score: embellishedScore, shownVersion: 'embellished' });
  // In the same render as the new score: the samples at hand, the transport started at once.
  expect(result.current.playback.playing).toBe(true);
  expect(result.current.playback.loading).toBe(false);
  await settle();
  expect(result.current.playback.playing).toBe(true);
  expect(result.current.playback.countIn).toBeNull();
  expect(instrument.load).toHaveBeenCalledTimes(1);
  expect(play).toHaveBeenCalledTimes(2);
  expect(play.mock.calls[1]![0]).toEqual({ countIn: false });
});
