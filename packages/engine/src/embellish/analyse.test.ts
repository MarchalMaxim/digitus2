// The timeline of core.py's analyse(): refusals, key and time changes, pickup bars. The expected
// values were read from research/embellish/core.py on the same fixtures.
import { describe, expect, it } from 'vitest';
import {
  analyseMusicXml,
  compound,
  isStrong,
  nominal,
  soundsThroughStrong,
  top,
} from './analyse.js';
import { frac } from './frac.js';
import { fixtureScore } from './testing/score.js';

/** Insert `xml` before the third `<note>` of `score`, as test_rules.py does. */
function beforeThirdNote(score: string, xml: string): string {
  const at = score.indexOf('<note>', score.indexOf('<note>', score.indexOf('<note>') + 1) + 1);
  return score.slice(0, at) + xml + score.slice(at);
}

const PART =
  '<measure number="1"><attributes><divisions>1</divisions><staves>2</staves></attributes>' +
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice>' +
  '<staff>1</staff></note></measure>';

describe('analyse refusals', () => {
  it('a timewise score is refused', () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?><score-timewise version="4.0"><part-list>' +
      '<score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
      '<measure number="1"><part id="P1"/></measure></score-timewise>';
    const piece = analyseMusicXml(xml);
    expect(piece.refusal?.startsWith('not a partwise score (score-timewise)')).toBe(true);
  });

  it('two parts are refused', () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list>' +
      '<score-part id="P1"><part-name>A</part-name></score-part>' +
      '<score-part id="P2"><part-name>B</part-name></score-part></part-list>' +
      `<part id="P1">${PART}</part><part id="P2">${PART}</part></score-partwise>`;
    const piece = analyseMusicXml(xml);
    expect(piece.refusal).toBe('2 parts: the hands are not one piano part');
    expect(piece.parts).toBe(2);
  });

  it('the refusal texts are core.py’s', () => {
    const chord = ['C4', 'E4', 'G4'] as const;
    expect(
      analyseMusicXml(
        fixtureScore([
          [
            [chord, 1],
            [chord, 1],
            [chord, 1],
            ['E4', 1],
          ],
          [[chord, 4]],
        ]),
      ).refusal,
    ).toBe('the melody voice plays chords at 80% of its onsets (at most 25%)');
    const trading = analyseMusicXml(
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
      ),
    );
    expect(trading.refusal).toBe(
      "no voice owns the right hand's top line: voice 2 has it at 56% of the onsets (needs 90%)",
    );
    expect(trading.ownerShare).toBeCloseTo(5 / 9, 12);
    expect(
      analyseMusicXml(
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
      ).refusal,
    ).toBe('1 staff/staves: the right hand is not a staff of its own');
  });
});

describe('analyse timeline', () => {
  it('a key change inside a bar applies from its onset', () => {
    const xml = beforeThirdNote(
      fixtureScore(
        [
          [
            ['C4', 1],
            ['D4', 1],
            ['E4', 1],
            ['G4', 1],
          ],
          [['A4', 4]],
        ],
        { lh: [[['r', 4]], [['D3', 4]]] },
      ),
      '<attributes><key><fifths>1</fifths></key></attributes>',
    );
    const piece = analyseMusicXml(xml);
    expect(piece.refusal).toBeNull();
    expect(piece.melody.map((g) => top(g).fifths)).toEqual([0, 0, 1, 1, 1]);
    expect(piece.measures.map((m) => m.fifths)).toEqual([0, 1]);
  });

  it('a time change inside a bar marks that bar', () => {
    const xml = beforeThirdNote(
      fixtureScore([
        [
          ['C4', 1],
          ['E4', 1],
          ['C4', 1],
          ['E4', 1],
        ],
        [
          ['C4', 1],
          ['E4', 1],
          ['G4', 2],
        ],
        [['C4', 4]],
      ]),
      '<attributes><time><beats>2</beats><beat-type>4</beat-type></time></attributes>',
    );
    const piece = analyseMusicXml(xml);
    expect(piece.measures.map((m) => m.innerTimeChange)).toEqual([true, false, false]);
    expect(piece.measures.map((m) => m.time)).toEqual([
      [4, 4],
      [2, 4],
      [2, 4],
    ]);
    expect(piece.measures.map((m) => m.start.toString())).toEqual(['0', '4', '8']);
  });

  it('a pickup bar counts from its end', () => {
    const piece = analyseMusicXml(
      fixtureScore(
        [
          [['C4', 1]],
          [
            ['E4', 2],
            ['D4', 1],
          ],
          [['C4', 3]],
        ],
        { lh: [[['r', 1]], [['C3', 3]], [['C3', 3]]], time: [3, 4], pickup: true },
      ),
    );
    const m0 = piece.measures[0]!;
    expect(m0.number).toBe('0');
    expect(m0.offset.toString()).toBe('2');
    expect(m0.length.toString()).toBe('1');
    expect(piece.measures.map((m) => m.offset.toString())).toEqual(['2', '0', '0']);
    expect(piece.measures.map((m) => m.start.toString())).toEqual(['0', '1', '4']);
  });

  it('strong positions are the downbeat and, in 4/4 and 6/8, the middle of the bar', () => {
    const piece = analyseMusicXml(
      fixtureScore(
        [
          [
            ['C4', 1],
            ['E4', 1],
            ['G4', 2],
          ],
          [['C4', 4]],
        ],
        {},
      ),
    );
    const m = piece.measures[0]!;
    expect(nominal(m)?.toString()).toBe('4');
    expect(compound(m)).toBe(false);
    expect(isStrong(m, frac(0))).toBe(true);
    expect(isStrong(m, frac(2))).toBe(true);
    expect(isStrong(m, frac(1))).toBe(false);
    expect(soundsThroughStrong(m, frac(1), frac(3))).toBe(true);
    expect(soundsThroughStrong(m, frac(2), frac(3))).toBe(false);
    expect(soundsThroughStrong(m, frac(3), frac(5))).toBe(true);
  });
});
