import { readFileSync } from 'node:fs';
import { parseMusicXml, type Score } from '@digitus2/engine';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAppStore } from '../app/store.js';
import { en } from '../i18n/en/index.js';
import { messages as fr } from '../i18n/fr/index.js';
import type { StatusInputs } from './ScoreView.js';
import type * as PlaybackModule from './usePlayback.js';
import type { Playback } from './usePlayback.js';
import type * as DocumentModule from './useScoreDocument.js';
import type { ScoreDocument } from './useScoreDocument.js';
import type { TimingSummary } from './useTimingRun.js';

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

const { ScoreView, scoreStatusLine, summaryLifetime, NO_SUMMARY_LIFE } =
  await import('./ScoreView.js');

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

// The timing summary after a run of Play with the piano (issue 192): its sentence, where it ranks
// on the line, and how long it keeps the line.
describe('the timing summary on the status line', () => {
  const ready: StatusInputs = {
    docStatus: 'ready',
    playable: true,
    hands: 'both',
    loading: false,
    countIn: null,
    alongHint: null,
    alongSound: null,
  };
  const summary = (onTime: number, total: number, belowFullTempo = false): TimingSummary => ({
    onTime,
    total,
    belowFullTempo,
  });
  const line = (inputs: Partial<StatusInputs>, t = en) =>
    scoreStatusLine({ ...ready, ...inputs }, t)?.text ?? null;

  it('counts the notes on time and names the rings, one or several', () => {
    expect(line({ timing: summary(15, 16) })).toBe(
      '15 of 16 notes on time. The ring shows the other.',
    );
    expect(line({ timing: summary(12, 16) })).toBe(
      '12 of 16 notes on time. The rings show the others.',
    );
    expect(scoreStatusLine({ ...ready, timing: summary(12, 16) })?.kind).toBe('info');
  });

  it('says every note was on time, and below 100 % asks for a little faster', () => {
    expect(line({ timing: summary(16, 16) })).toBe('Every note on time.');
    expect(line({ timing: summary(16, 16, true) })).toBe(
      'Every note on time. Try it a little faster.',
    );
  });

  it('beats the play hint; the hold hint, the count-in and loading beat it', () => {
    const timing = summary(12, 16);
    expect(line({ timing, alongHint: { kind: 'play', count: 2 } })).toBe(
      '12 of 16 notes on time. The rings show the others.',
    );
    expect(line({ timing, alongHint: { kind: 'hold', count: 2 } })).toBe(
      'Hold the red notes a little longer.',
    );
    expect(line({ timing, countIn: { beat: 0, beats: 4, beatInBar: 1 } })).toBe('1');
    expect(line({ timing, loading: true })).toBe('Loading the piano…');
    expect(line({ timing, docStatus: 'rendering' })).toBe('Preparing the score…');
    expect(line({ timing, playable: false })).toBe(en.score.view.noNotes);
  });

  it('is written in the language on screen', () => {
    expect(line({ timing: summary(12, 16) }, fr)).toBe(
      '12 notes sur 16 en rythme. Les cercles montrent les autres.',
    );
    expect(line({ timing: summary(16, 16, true) }, fr)).toBe(
      'Toutes les notes en rythme. Essayez un peu plus vite.',
    );
  });
});

describe('summaryLifetime', () => {
  type Input = Parameters<typeof summaryLifetime>[1];
  const s1 = { onTime: 12, total: 16, belowFullTempo: false };
  const base: Input = {
    summary: null,
    higherLine: false,
    currentGroup: 5,
    playing: false,
    flyingHome: false,
  };
  /** Feeds the inputs in turn and returns what the line shows after each. */
  function run(inputs: Partial<Input>[]) {
    let life = NO_SUMMARY_LIFE;
    return inputs.map((over) => {
      const next = summaryLifetime(life, { ...base, ...over });
      // Fed the same input again (a second render), nothing changes.
      expect(summaryLifetime(next, { ...base, ...over })).toBe(next);
      life = next;
      return life.shown;
    });
  }

  it('shows the summary from the moment it arrives', () => {
    expect(run([{}, { summary: s1 }, { summary: s1 }])).toEqual([null, s1, s1]);
  });

  it('leaves for good when a hold hint takes the line: after it, the line is empty', () => {
    expect(
      run([
        { summary: s1 },
        { summary: s1, higherLine: true }, // the hold hint
        { summary: s1, currentGroup: 6 }, // the walk passed the step: the hint went
        { summary: s1, currentGroup: 6 },
      ]),
    ).toEqual([s1, null, null, null]);
  });

  it('leaves for good when the red moves while stopped (a walk pass or a seek)', () => {
    expect(
      run([{ summary: s1 }, { summary: s1, currentGroup: 6 }, { summary: s1, currentGroup: 5 }]),
    ).toEqual([s1, null, null]);
  });

  it('leaves when Play is pressed, before the run clears it', () => {
    expect(run([{ summary: s1 }, { summary: s1, playing: true }])).toEqual([s1, null]);
  });

  it('at the end of the piece the flight home and the first-step cue are not a move', () => {
    expect(
      run([
        { summary: s1, currentGroup: -1, flyingHome: true }, // the red flies home
        { summary: s1, currentGroup: -1 }, // landed: the walk cues a frame later
        { summary: s1, currentGroup: 0 }, // the first step is cued: the baseline
        { summary: s1, currentGroup: 0 },
        { summary: s1, currentGroup: 1 }, // the reader plays it: a move
      ]),
    ).toEqual([s1, s1, s1, s1, null]);
  });

  it('a group of -1 is never a move', () => {
    expect(
      run([{ summary: s1 }, { summary: s1, currentGroup: -1 }, { summary: s1, currentGroup: 5 }]),
    ).toEqual([s1, s1, s1]);
  });

  it('a new summary object shows again; a cleared one goes', () => {
    const s2 = { ...s1, onTime: 13 };
    expect(
      run([
        { summary: s1 },
        { summary: s1, currentGroup: 6 },
        { summary: s2, currentGroup: 6 },
        { summary: null, currentGroup: 6 },
      ]),
    ).toEqual([s1, null, s2, null]);
  });
});
