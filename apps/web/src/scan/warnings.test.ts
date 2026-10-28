import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en/index.js';
import { messages as nl } from '../i18n/nl/index.js';
import { GRAND_STAFF_WARNING, PARTLY_READ_WARNING, UNKNOWN_WARNING } from './client.js';
import { GRAPHIC_SPAN_WARNING, PAIRED_STAVES_WARNING } from './join.js';
import { reviewWarnings } from './warnings.js';

// The scanner's sentences as the worker writes them (research/omr/prototypes/local-worker:
// homr.py and normalize_export.py), kept in a saved scan as they came.
const EXPERIMENTAL =
  'Photo recognition is experimental. Compare the recognized notes with the source before using fingerings.';
const METER =
  'Missing key or time signatures may be inferred. Confirm them against the complete score.';
const normalized = (done: string) =>
  `The worker adjusted the export without changing any note: ${done}.`;
const regions = (omitted: number, masked: number) =>
  `Recognition excluded ${omitted} possible auxiliary staff regions and masked ${masked} nearby staff regions. Check the source for any music that should be retained.`;

describe('the recognition details in the language on screen (issue 230)', () => {
  it('leaves the scanner’s disclaimers out', () => {
    expect(reviewWarnings(en, [EXPERIMENTAL, METER])).toEqual([]);
  });

  it('adds the export notes of every page up to one line each', () => {
    const lines = reviewWarnings(en, [
      normalized('4 slurs joining one pitch to its continuation were read as ties'),
      normalized(
        '1 empty measure joined its neighbour; 8 slurs joining one pitch to its continuation were read as ties',
      ),
      normalized('1 slur joining one pitch to its continuation was read as a tie'),
      regions(1, 2),
    ]);
    expect(lines).toEqual([
      '13 slurs between a note and its repetition were read as ties.',
      '1 empty bar was joined to its neighbour.',
      '3 small extra staves were left out of the reading.',
    ]);
    expect(reviewWarnings(nl, [normalized('1 empty measure joined its neighbour')])).toEqual([
      nl.scan.review.emptyBarsJoined(1),
    ]);
  });

  it('writes the app’s own markers in the language on screen and keeps an unknown sentence', () => {
    expect(
      reviewWarnings(nl, [
        GRAPHIC_SPAN_WARNING,
        UNKNOWN_WARNING,
        GRAND_STAFF_WARNING,
        PAIRED_STAVES_WARNING,
        PARTLY_READ_WARNING,
        'Something new the scanner says.',
      ]),
    ).toEqual([
      nl.scan.review.graphicSpanWarning,
      nl.scan.review.unknownWarning,
      nl.scan.review.grandStaffWarning,
      nl.scan.review.pairedStavesNote,
      nl.scan.review.partlyReadWarning,
      'Something new the scanner says.',
    ]);
  });
});
