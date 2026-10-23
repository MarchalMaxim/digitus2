import { readFileSync } from 'node:fs';
import { parseMusicXml, type Score } from '@digitus2/engine';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import type * as PlaybackModule from './usePlayback.js';
import type { Playback } from './usePlayback.js';
import type * as DocumentModule from './useScoreDocument.js';
import type { ScoreDocument } from './useScoreDocument.js';

// What the score view hands to the status line (issue 184): the player's `preparing`, the
// samples loading for the other hand, reaches the dock as `Loading the piano…`. The ranking of
// the lines is ScoreView.test.ts; this renders the view on Happy Birthday with a stand-in
// document and player, to guard the wiring between them.

// A path held in a variable stays a file URL (Vite rewrites a literal one into an asset URL).
const path = '../../../../content/scores/happy-birthday.musicxml';
const score: Score = parseMusicXml(readFileSync(new URL(path, import.meta.url), 'utf8')).score;

const doc: ScoreDocument = {
  status: 'ready',
  error: null,
  score,
  xml: null,
  assignment: null,
  editorial: null,
  pages: [],
  solveMs: null,
  renderMs: null,
  title: 'Happy Birthday',
  composer: '',
  warnings: [],
  digitChanges: null,
  midiInfo: null,
  splitMidi: null,
  embellish: 'none',
  embellished: false,
  shownVersion: 'plain',
  plain: null,
  setEmbellished: () => {},
};

vi.mock('./useScoreDocument.js', async (importOriginal) => ({
  ...(await importOriginal<typeof DocumentModule>()),
  useScoreDocument: () => ({ ...doc, setSplitMidi: () => {} }),
}));

const playback: Playback = {
  playing: false,
  loading: false,
  countIn: null,
  waiting: false,
  atStart: true,
  ended: 0,
  cue: null,
  play: () => {},
  pause: () => {},
  rewind: () => {},
  seek: () => {},
  cueAt: () => {},
  finish: () => {},
  positionSec: () => 0,
  startSec: () => 0,
  startPerformanceSec: () => 0,
  performanceLoop: () => null,
  leadingIn: () => false,
  playingNow: () => false,
  leadInRemainingSec: () => null,
  loop: null,
  setLoop: () => {},
  strike: () => () => undefined,
  prepare: () => {},
  preparing: false,
  soundWaits: false,
  accompany: () => {},
  stopAccompaniment: () => {},
};

vi.mock('./usePlayback.js', async (importOriginal) => ({
  ...(await importOriginal<typeof PlaybackModule>()),
  usePlayback: () => playback,
}));

const { ScoreView } = await import('./ScoreView.js');

beforeEach(() => {
  playback.loading = false;
  playback.preparing = false;
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
    libraryScrollY: 0,
  });
});
afterEach(cleanup);

/** The dock's status line after the first frames. */
async function dockStatus(): Promise<string> {
  const { container } = render(<ScoreView source={{ kind: 'library', slug: 'happy-birthday' }} />);
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  return container.querySelector('.dock [role="status"]')?.textContent?.trim() ?? '';
}

describe('the status line in the score view', () => {
  it('says nothing for a ready score at rest', async () => {
    expect(await dockStatus()).toBe('');
  });

  it('says Loading the piano… while the player prepares the samples for the other hand', async () => {
    playback.preparing = true;
    expect(await dockStatus()).toBe('Loading the piano…');
  });

  it('says Loading the piano… while the first Play loads them', async () => {
    playback.loading = true;
    expect(await dockStatus()).toBe('Loading the piano…');
  });
});
