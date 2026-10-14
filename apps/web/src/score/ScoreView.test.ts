import type { Assignment } from '@digitus2/engine';
import { describe, expect, it } from 'vitest';
import {
  EDITORIAL_SHOWN_TEXT,
  LOADING_PIANO_TEXT,
  scoreStatusLine,
  showsEditorial,
  type StatusInputs,
} from './ScoreView.js';

/** A ready score, playable, with the player idle (or playing, past any count-in). */
const ready: StatusInputs = {
  docStatus: 'ready',
  playable: true,
  hands: 'both',
  loading: false,
  countIn: null,
};

const info = (text: string) => ({ text, kind: 'info' });

// The status line in the dock (polish plan Task 3, review S3): it says what the score or the
// player is busy with, so a Play that loads the piano or counts in never looks stuck.
describe('the status line', () => {
  it('says nothing while the score is ready and the player is idle or playing', () => {
    expect(scoreStatusLine(ready)).toBeNull();
  });

  it('says "Loading the piano…" while the first Play loads the samples', () => {
    expect(LOADING_PIANO_TEXT).toBe('Loading the piano…');
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
});

// Polish plan Task 5, review S12: the jump from 254 engine digits to the editor's 27 looked like
// a bug when nothing said whose digits were shown. The line above the score follows the pages:
// it shows while they carry the editor's fingering, not merely while the setting is on.
describe("the editor's fingering line", () => {
  const engine: Assignment = { n1: { finger: 1, source: 'engine' } };
  const editorial: Assignment = { n1: { finger: 2, source: 'editorial' } };

  it('reads "Showing the editor\'s fingering"', () => {
    expect(EDITORIAL_SHOWN_TEXT).toBe("Showing the editor's fingering");
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
