import { readFileSync } from 'node:fs';
import { parseMusicXml, type Score } from '@digitus2/engine';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore, type HandsMode } from '../app/store.js';
import { buildOnsetGroups } from './onsetGroups.js';
import type * as PlaybackModule from './usePlayback.js';
import type { Playback } from './usePlayback.js';
import type * as DocumentModule from './useScoreDocument.js';
import type { ScoreDocument } from './useScoreDocument.js';

// T11 (spec 15, rule 3): the letters are decided from the score with both hands, whatever is
// muted. The cursor works from the groups of the hands played; if the score view handed those to
// the letter rule, one-hand practice would never letter a bar. This renders the score view on
// Happy Birthday (lettered bars 2 and 3, 0-based) with a stand-in document and player.

// A path held in a variable stays a file URL (Vite rewrites a literal one into an asset URL).
const path = '../../../../content/scores/happy-birthday.musicxml';
const score: Score = parseMusicXml(readFileSync(new URL(path, import.meta.url), 'utf8')).score;
const groups = buildOnsetGroups(score);

/** The score time the fake player reports. */
let heard = 0;

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
  playing: true,
  loading: false,
  countIn: null,
  waiting: false,
  atStart: false,
  cue: null,
  play: () => {},
  pause: () => {},
  rewind: () => {},
  seek: () => {},
  positionSec: () => heard,
  startSec: () => heard,
  leadingIn: () => false,
  leadInRemainingSec: () => null,
  loop: null,
  setLoop: () => {},
};

vi.mock('./usePlayback.js', async (importOriginal) => ({
  ...(await importOriginal<typeof PlaybackModule>()),
  usePlayback: () => playback,
}));

const { ScoreView } = await import('./ScoreView.js');

beforeEach(() =>
  useAppStore.setState({
    view: { name: 'library' },
    settings: { ...DEFAULT_SETTINGS },
    notice: null,
    libraryScrollY: 0,
  }),
);
afterEach(cleanup);

/** The score time just after the first onset of bar `bar` (0-based) of the hand `hand`. */
function inBar(bar: number, hand: 'L' | 'R'): number {
  const g = groups.find((x) => x.notes.some((n) => n.measureIndex === bar && n.hand === hand));
  return g!.sec + 0.01;
}

async function lettersAt(hands: HandsMode, sec: number) {
  heard = sec;
  useAppStore.getState().setSettings({ hands });
  const { container } = render(<ScoreView source={{ kind: 'library', slug: 'happy-birthday' }} />);
  // The cursor's frame loop runs on requestAnimationFrame.
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  const keyboard = container.querySelector('.keyboard')!;
  return {
    pressed: keyboard.querySelectorAll('.key.is-pressed').length,
    dimmed: keyboard.querySelectorAll('.key.is-muted').length,
    letters: [...keyboard.querySelectorAll('.key-hand')].map((t) => t.textContent),
  };
}

describe('the hand letters in the score view (T11)', () => {
  it('none in bar 2, where the hands are far apart', async () => {
    const k = await lettersAt('both', inBar(1, 'L'));
    expect(k.pressed).toBeGreaterThan(0);
    expect(k.letters).toEqual([]);
  });

  it('both hands lettered in bar 3, where they come close', async () => {
    const k = await lettersAt('both', inBar(2, 'L'));
    expect(k.pressed).toBeGreaterThan(0);
    expect(k.letters).toHaveLength(k.pressed);
    expect(new Set(k.letters)).toEqual(new Set(['L', 'R']));
  });

  it('the same bar is lettered with the left hand muted: the rule reads both hands', async () => {
    const k = await lettersAt('R', inBar(2, 'R'));
    expect(k.pressed).toBeGreaterThan(0);
    expect(k.dimmed).toBeGreaterThan(0);
    expect(k.letters).toHaveLength(k.pressed + k.dimmed);
    expect(new Set(k.letters)).toEqual(new Set(['L', 'R']));
  });
});
