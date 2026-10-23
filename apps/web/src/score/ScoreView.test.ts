import type { Assignment } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en/index.js';
import { messages as es } from '../i18n/es/index.js';
import { messages as fr } from '../i18n/fr/index.js';
import { messages as nl } from '../i18n/nl/index.js';
import { messages as pt } from '../i18n/pt/index.js';
import { loaderTune, scoreStatusLine, showsEditorial, type StatusInputs } from './ScoreView.js';

/** A ready score, playable, with the player idle (or playing, past any count-in). */
const ready: StatusInputs = {
  docStatus: 'ready',
  playable: true,
  hands: 'both',
  loading: false,
  countIn: null,
  alongHint: null,
  alongSound: null,
};

const info = (text: string) => ({ text, kind: 'info' });

// The status line in the dock (polish plan Task 3, review S3): it says what the score or the
// player is busy with, so a Play that loads the piano or counts in never looks stuck.
describe('the status line', () => {
  it('says nothing while the score is ready and the player is idle or playing', () => {
    expect(scoreStatusLine(ready)).toBeNull();
  });

  it('says "Loading the piano…" while the first Play loads the samples', () => {
    expect(en.score.view.loadingPiano).toBe('Loading the piano…');
    expect(scoreStatusLine({ ...ready, loading: true })).toEqual(info('Loading the piano…'));
  });

  it('counts the count-in: 1, 2, 3, 4, as a count (set in ink, the cue to get ready)', () => {
    const beats = [0, 1, 2, 3].map((beat) =>
      scoreStatusLine({ ...ready, countIn: { beat, beats: 4, beatInBar: beat + 1 } }),
    );
    expect(beats).toEqual(['1', '2', '3', '4'].map((text) => ({ text, kind: 'count' })));
    expect(scoreStatusLine({ ...ready, countIn: { beat: 2, beats: 3, beatInBar: 3 } })).toEqual({
      text: '3',
      kind: 'count',
    });
  });

  // Polish plan Task 3 review: the count runs on the bar grid. Before a three-beat pickup in 4/4
  // a whole bar comes first, then the one beat before the pickup: "1 2 3 4 1", never "5".
  it('shows each click by its beat in the bar', () => {
    const clicks = [1, 2, 3, 4, 1].map((beatInBar, beat) =>
      scoreStatusLine({ ...ready, countIn: { beat, beats: 5, beatInBar } }),
    );
    expect(clicks.map((c) => c?.text)).toEqual(['1', '2', '3', '4', '1']);
  });

  it('puts what the score is doing first, then why Play is unavailable, then the player', () => {
    expect(scoreStatusLine({ ...ready, docStatus: 'loading' })).toEqual(info('Loading the score…'));
    expect(scoreStatusLine({ ...ready, docStatus: 'fingering' })).toEqual(info('Fingering…'));
    // A count-in under a status of the score is not a count: the line says what the score does.
    expect(
      scoreStatusLine({
        ...ready,
        docStatus: 'rendering',
        countIn: { beat: 0, beats: 4, beatInBar: 1 },
      }),
    ).toEqual(info('Preparing the score…'));
    expect(scoreStatusLine({ ...ready, playable: false, hands: 'L', loading: true })).toEqual(
      info('This piece has no notes for the left hand.'),
    );
    expect(
      scoreStatusLine({
        ...ready,
        playable: false,
        hands: 'R',
        countIn: { beat: 1, beats: 4, beatInBar: 2 },
      }),
    ).toEqual(info('This piece has no notes for the right hand.'));
    expect(scoreStatusLine({ ...ready, docStatus: 'error', loading: true })).toBeNull();
  });

  // The click the browser asks for before digitus can sound the other hand (issue 184): it ranks
  // under the count-in and over the hint.
  describe('the click the browser asks for', () => {
    it('says click on a computer and tap on a touch screen', () => {
      expect(en.score.view.playAlongSound.click).toBe(
        'Click the page once to hear the other hand.',
      );
      expect(en.score.view.playAlongSound.tap).toBe('Tap the page once to hear the other hand.');
      expect(scoreStatusLine({ ...ready, alongSound: 'click' })).toEqual(
        info('Click the page once to hear the other hand.'),
      );
      expect(scoreStatusLine({ ...ready, alongSound: 'tap' })).toEqual(
        info('Tap the page once to hear the other hand.'),
      );
    });

    it('is in every language, click and tap, each its own', () => {
      const lines = [en, es, fr, nl, pt].flatMap((m) => [
        m.score.view.playAlongSound.click,
        m.score.view.playAlongSound.tap,
      ]);
      expect(lines.every((line) => line.trim() !== '')).toBe(true);
      expect(new Set(lines).size).toBe(lines.length);
    });

    it('goes over the hint and under the count-in, the piano loading and the rest', () => {
      const both = { ...ready, alongSound: 'click' as const, alongHint: 1 };
      expect(scoreStatusLine(both)).toEqual(info('Click the page once to hear the other hand.'));
      expect(scoreStatusLine({ ...both, countIn: { beat: 0, beats: 4, beatInBar: 1 } })).toEqual({
        text: '1',
        kind: 'count',
      });
      expect(scoreStatusLine({ ...both, loading: true })).toEqual(info('Loading the piano…'));
      expect(scoreStatusLine({ ...both, playable: false, hands: 'L' })).toEqual(
        info('This piece has no notes for the left hand.'),
      );
      expect(scoreStatusLine({ ...both, docStatus: 'fingering' })).toEqual(info('Fingering…'));
      expect(scoreStatusLine({ ...both, docStatus: 'error' })).toBeNull();
    });

    it('ranks Loading the piano… over the tap sentence and the hint', () => {
      // That usePlayback's `preparing` reaches the line as `loading` is ScoreView.status.test.tsx.
      expect(scoreStatusLine({ ...ready, loading: true, alongSound: 'tap', alongHint: 2 })).toEqual(
        info('Loading the piano…'),
      );
    });
  });

  // The play-along's hint (issue 182) is the lowest line of all: it never covers a line that
  // tells the reader what the score or the player is busy with.
  describe('the play-along hint', () => {
    it('says nothing while there is no hint', () => {
      expect(scoreStatusLine({ ...ready, alongHint: null })).toBeNull();
    });

    it('asks for the red note, or the red notes when the step has more than one pitch', () => {
      expect(en.score.view.playAlongHint(1)).toBe('Play the red note on your piano.');
      expect(en.score.view.playAlongHint(2)).toBe('Play the red notes on your piano.');
      expect(scoreStatusLine({ ...ready, alongHint: 1 })).toEqual(
        info('Play the red note on your piano.'),
      );
      expect(scoreStatusLine({ ...ready, alongHint: 3 })).toEqual(
        info('Play the red notes on your piano.'),
      );
    });

    it('is in every language, singular and plural, each its own', () => {
      const lines = [en, es, fr, nl, pt].flatMap((m) => [
        m.score.view.playAlongHint(1),
        m.score.view.playAlongHint(2),
      ]);
      expect(lines.every((line) => line.trim() !== '')).toBe(true);
      expect(new Set(lines).size).toBe(lines.length);
    });

    it('comes after what the score is busy with, why Play is unavailable, and the player', () => {
      const hint = { ...ready, alongHint: 1 };
      expect(scoreStatusLine({ ...hint, docStatus: 'loading' })).toEqual(
        info('Loading the score…'),
      );
      expect(scoreStatusLine({ ...hint, docStatus: 'fingering' })).toEqual(info('Fingering…'));
      expect(scoreStatusLine({ ...hint, docStatus: 'rendering' })).toEqual(
        info('Preparing the score…'),
      );
      expect(scoreStatusLine({ ...hint, playable: false, hands: 'L' })).toEqual(
        info('This piece has no notes for the left hand.'),
      );
      expect(scoreStatusLine({ ...hint, loading: true })).toEqual(info('Loading the piano…'));
      expect(scoreStatusLine({ ...hint, countIn: { beat: 0, beats: 4, beatInBar: 1 } })).toEqual({
        text: '1',
        kind: 'count',
      });
      expect(scoreStatusLine({ ...hint, docStatus: 'error' })).toBeNull();
    });
  });
});

// Polish plan Task 5, review S12: the jump from 254 engine digits to the editor's 27 looked like
// a bug when nothing said whose digits were shown. The line above the score follows the pages:
// it shows while they carry the editor's fingering, not merely while the setting is on.
describe("the editor's fingering line", () => {
  const engine: Assignment = { n1: { finger: 1, source: 'engine' } };
  const editorial: Assignment = { n1: { finger: 2, source: 'editorial' } };

  it('has a line in every language, each its own', () => {
    const lines = [en, es, fr, nl, pt].map((m) => m.score.view.editorialShown);
    expect(lines.every((line) => line.trim() !== '')).toBe(true);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("shows while the pages carry the editor's fingering", () => {
    expect(showsEditorial({ assignment: editorial, editorial })).toBe(true);
  });

  it("hides while the engine's fingering is shown, or nothing yet", () => {
    expect(showsEditorial({ assignment: engine, editorial })).toBe(false);
    // The setting is on but its layout has not landed: the engine's digits are still on screen.
    expect(showsEditorial({ assignment: engine, editorial: null })).toBe(false);
    expect(showsEditorial({ assignment: null, editorial: null })).toBe(false);
    expect(showsEditorial({ assignment: null, editorial })).toBe(false);
    // Equal digits are not the same fingering: only the editorial assignment itself counts.
    expect(showsEditorial({ assignment: { ...editorial }, editorial })).toBe(false);
  });
});

// The loader (issue #28) stands where the music will be while there is none yet.
describe('the loader', () => {
  it('plays the scale while loading, writes the fingering while fingering, chords while laying out', () => {
    expect(loaderTune('idle', 0)).toBe('scale');
    expect(loaderTune('loading', 0)).toBe('scale');
    expect(loaderTune('fingering', 0)).toBe('fingering');
    expect(loaderTune('rendering', 0)).toBe('chords');
  });

  it('goes once the score is ready, and never shows over pages already on screen', () => {
    expect(loaderTune('ready', 1)).toBeNull();
    expect(loaderTune('error', 0)).toBeNull();
    expect(loaderTune('loading', 2)).toBeNull();
  });
});
