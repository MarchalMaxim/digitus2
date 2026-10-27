// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ScanNote } from './notes.js';
import { pitchSuggestions, SUGGESTION_FLOOR, SUGGESTIONS } from './suggestions.js';

const note = (over: Partial<ScanNote>): ScanNote =>
  ({ rest: false, step: 'F', alter: 0, octave: 4, midi: 65, ...over }) as ScanNote;

describe("homr's other readings of a pitch (issue 130)", () => {
  it('offers the most probable other pitches, sounding as homr reads them', () => {
    const n = note({
      confidence: {
        pitch: [
          ['F4', 0.7],
          ['G4', 0.25],
          ['E4', 0.05],
        ],
        lift: [
          ['_', 0.6],
          ['#', 0.4],
        ],
      },
    });
    const s = pitchSuggestions(n);
    // F4 natural is the reading; F sharp (0.28), then G natural (0.15).
    expect(s.map((x) => `${x.step}${x.alter}${x.octave}`)).toEqual(['F14', 'G04']);
    expect(s.length).toBeLessThanOrEqual(SUGGESTIONS);
  });

  it('offers nothing under the floor, for a rest, or without homr’s confidence', () => {
    expect(
      pitchSuggestions(
        note({
          confidence: {
            pitch: [
              ['F4', 1 - SUGGESTION_FLOOR / 10],
              ['G4', SUGGESTION_FLOOR / 10],
            ],
            lift: [['_', 1]],
          },
        }),
      ),
    ).toEqual([]);
    expect(pitchSuggestions(note({ rest: true, step: undefined, confidence: {} }))).toEqual([]);
    expect(pitchSuggestions(note({}))).toEqual([]);
  });

  it('leaves out the pitch the note has now, after a correction too', () => {
    const n = note({
      step: 'G',
      octave: 4,
      midi: 67,
      confidence: {
        pitch: [
          ['F4', 0.6],
          ['G4', 0.4],
        ],
        lift: [['_', 1]],
      },
    });
    expect(pitchSuggestions(n).map((x) => `${x.step}${x.octave}`)).toEqual(['F4']);
  });
});
