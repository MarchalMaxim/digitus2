// Finding the melody (the right hand's top voice) and the piece-level refusals: the port of
// research/embellish/tests/test_melody.py.
import { describe, expect, it } from 'vitest';
import { analyseMusicXml, single } from './analyse.js';
import { embellishMusicXml } from './embellish.js';
import { fixtureScore } from './testing/score.js';
import type { Bar } from './testing/score.js';

const tradingXml = () =>
  fixtureScore(
    [
      [
        ['C5', 1],
        ['C4', 1],
        ['C5', 1],
        ['C4', 1],
      ],
      [
        ['C5', 1],
        ['C4', 1],
        ['C5', 1],
        ['C4', 1],
      ],
      [['C4', 4]],
    ],
    { rh2: [[['E4', 4]], [['E4', 4]], [['E5', 4]]] },
  );

const fewChordsXml = () =>
  fixtureScore([
    [
      ['C4', 1],
      ['E4', 1],
      [['C4', 'G4'], 1],
      ['E4', 1],
    ],
    [
      ['C4', 1],
      ['E4', 1],
      ['G4', 2],
    ],
    [['C4', 4]],
  ]);

describe('melody', () => {
  it('a single-voice right hand is the melody', () => {
    const piece = analyseMusicXml(
      fixtureScore([
        [
          ['C4', 1],
          ['E4', 1],
          ['G4', 2],
        ],
        [['C4', 4]],
      ]),
    );
    expect(piece.refusal).toBeNull();
    expect(piece.melodyVoice).toBe('1');
  });

  it('the upper of two right-hand voices is the melody', () => {
    const piece = analyseMusicXml(
      fixtureScore(
        [
          [
            ['E5', 1],
            ['G5', 1],
            ['F5', 2],
          ],
          [['E5', 4]],
        ],
        { rh2: [[['C5', 4]], [['C5', 4]]] },
      ),
    );
    expect(piece.refusal).toBeNull();
    expect(piece.melodyVoice).toBe('1');
  });

  it('two voices that trade the top line are refused', () => {
    const piece = analyseMusicXml(tradingXml());
    expect(piece.refusal).toContain('top line');
    expect(piece.melodyVoice).toBeNull();
    expect(piece.melody).toEqual([]);
  });

  it('two voices that trade the top line: embellishMusicXml gives the same refusal, no insertion and the input unchanged', () => {
    const input = tradingXml();
    const res = embellishMusicXml(input);
    expect(res.refusal).toBe(analyseMusicXml(input).refusal);
    expect(res.refusal).toContain('top line');
    expect(res.inserted).toEqual([]);
    expect(res.xml).toBe(input);
    expect(res.melodyVoice).toBeNull();
    expect(res.skipped).toEqual({});
  });

  it('a chordal right hand is refused', () => {
    const chord = ['C4', 'E4', 'G4'] as const;
    const bars: Bar[] = [
      [
        [chord, 1],
        [chord, 1],
        [chord, 1],
        ['E4', 1],
      ],
      [[chord, 4]],
    ];
    const piece = analyseMusicXml(fixtureScore(bars));
    expect(piece.refusal).toContain('chord');
  });

  it('a single-staff score is refused', () => {
    const piece = analyseMusicXml(
      fixtureScore(
        [
          [
            ['C4', 1],
            ['E4', 1],
            ['G4', 2],
          ],
        ],
        { staves: 1 },
      ),
    );
    expect(piece.refusal).toContain('staff');
  });

  it('a melody with a few chords is kept', () => {
    const piece = analyseMusicXml(fewChordsXml());
    expect(piece.refusal).toBeNull();
    expect(piece.melody.filter((g) => !single(g)).map((g) => g.notes[0]!.onset.toString())).toEqual(
      ['2'],
    );
  });

  it('a melody with a few chords is kept and the chords are left alone: no insertion at onset 2, skipped.chord 1', () => {
    const res = embellishMusicXml(fewChordsXml());
    expect(res.refusal).toBeNull();
    expect(res.inserted.map((i) => i.onset)).not.toContain('2');
    expect(res.skipped.chord).toBe(1);
  });
});
