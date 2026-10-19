// The independent checker: the port of research/embellish/check.py's `verify`, reading both scores
// with the engine's MusicXML reader. Cases from test_rules.py and test_tools.py.
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../io/musicxml/read.js';
import { checkEmbellishment } from './check.js';
import { embellishMusicXml } from './embellish.js';
import type { EmbellishResult } from './embellish.js';
import { fixtureScore } from './testing/score.js';
import type { Bar } from './testing/score.js';

const CEEC: Bar = [
  ['C4', 1],
  ['E4', 1],
  ['E4', 1],
  ['C4', 1],
];

function check(plain: string, res: EmbellishResult) {
  expect(res.melodyVoice).not.toBeNull();
  return checkEmbellishment(plain, res.xml, res.inserted, res.melodyVoice!);
}

describe('checkEmbellishment', () => {
  it('the left hand is untouched and the checker agrees', () => {
    const plain = fixtureScore(
      [
        CEEC,
        [
          ['D4', 2],
          ['F4', 2],
        ],
        [['C4', 4]],
      ],
      {
        lh: [
          [
            ['C3', 2],
            ['G3', 2],
          ],
          [['G2', 4]],
          [['C3', 4]],
        ],
      },
    );
    const res = embellishMusicXml(plain);
    expect(res.inserted).toHaveLength(1);
    const rep = check(plain, res);
    expect(rep.problems).toEqual([]);
    expect(rep.ok).toBe(true);
    expect(rep.strongTotal).toBe(6);
    expect(rep.strongKept).toBe(6);
  });

  it('catches a moved left-hand note and a displaced strong beat', () => {
    const plain = fixtureScore([
      [
        ['C4', 1],
        ['E4', 1],
        ['D4', 1],
        ['C4', 1],
      ],
      [['C4', 4]],
    ]);
    const res = embellishMusicXml(plain);
    expect(res.inserted.length).toBeGreaterThan(0);
    const broken = res.xml.replace(
      '<step>C</step><octave>3</octave>',
      '<step>D</step><octave>3</octave>',
    );
    expect(broken).not.toBe(res.xml);
    const moved = checkEmbellishment(plain, broken, res.inserted, '1');
    expect(moved.ok).toBe(false);
    expect(moved.problems.some((p) => p.startsWith('non-melody notes changed'))).toBe(true);

    const bad = fixtureScore([
      [
        ['D4', 1],
        ['E4', 1],
        ['D4', 1],
        ['C4', 1],
      ],
      [['C4', 4]],
    ]);
    const rep = checkEmbellishment(plain, bad, [], '1');
    expect(rep.ok).toBe(false);
    expect(rep.strongKept).toBeLessThan(rep.strongTotal);
  });

  it('rejects a new note that sounds through a strong position', () => {
    const plain = fixtureScore([
      [
        ['G4', 1 / 2],
        ['C4', 2],
        ['E4', 1],
        ['D4', 1 / 2],
      ],
      [['C4', 4]],
    ]);
    const bad = fixtureScore([
      [
        ['G4', 1 / 2],
        ['C4', 1],
        ['D4', 1],
        ['E4', 1],
        ['D4', 1 / 2],
      ],
      [['C4', 4]],
    ]);
    const rep = checkEmbellishment(plain, bad, [{ onset: '3/2', midi: 62, length: '1' }], '1');
    expect(rep.ok).toBe(false);
    expect(rep.problems.some((p) => p.includes('sounds through a strong position'))).toBe(true);
    expect(rep.problems).toContain(
      'an inserted note sounds through a strong position (3/2 to 5/2)',
    );
  });

  it('rejects an unrecorded insertion', () => {
    const plain = fixtureScore([
      [
        ['C4', 1],
        ['E4', 1],
        ['D4', 2],
      ],
      [['C4', 4]],
    ]);
    const res = embellishMusicXml(plain);
    expect(res.inserted).toHaveLength(1);
    const rep = checkEmbellishment(plain, res.xml, [], '1');
    expect(rep.ok).toBe(false);
    expect(rep.problems.some((p) => p.startsWith('unrecorded or missing insertions'))).toBe(true);
    // The same file with its record passes.
    expect(check(plain, res).ok).toBe(true);
  });

  it('reads a decimal length as check.py reads it with Fraction', () => {
    // A light record writes lengths with fmtBeat ("0.5"), not as a fraction.
    const plain = fixtureScore([CEEC, [['C4', 4]]]);
    const res = embellishMusicXml(plain);
    expect(res.inserted.map((i) => i.length)).toContain('0.5');
    expect(check(plain, res).ok).toBe(true);
  });

  it('the pickup and coarse-divisions fixtures check out', () => {
    const pickup = fixtureScore(
      [
        [['C4', 1]],
        [
          ['E4', 2],
          ['D4', 1],
        ],
        [['C4', 3]],
      ],
      { lh: [[['r', 1]], [['C3', 3]], [['C3', 3]]], time: [3, 4], pickup: true },
    );
    const a = embellishMusicXml(pickup);
    expect(a.inserted.length).toBeGreaterThan(0);
    const ra = check(pickup, a);
    expect(ra.problems).toEqual([]);
    expect(ra.ok).toBe(true);

    const coarse = fixtureScore(
      [
        [
          ['C4', 1],
          ['E4', 1],
          ['D4', 2],
        ],
        [['C4', 4]],
      ],
      {
        lh: [
          [
            ['C3', 2],
            ['G3', 2],
          ],
          [['C3', 4]],
        ],
        divisions: 1,
      },
    );
    const b = embellishMusicXml(coarse);
    expect(b.xml).toContain('<divisions>2</divisions>');
    const rb = check(coarse, b);
    expect(rb.problems).toEqual([]);
    expect(rb.ok).toBe(true);
  });

  it('a strong position in a pickup bar is counted from the end of the bar', () => {
    // 3/4 with a one-beat pickup: the pickup has no downbeat; the bars after it have one each.
    const plain = fixtureScore(
      [
        [['C4', 1]],
        [
          ['E4', 2],
          ['D4', 1],
        ],
        [['C4', 3]],
      ],
      { lh: [[['r', 1]], [['C3', 3]], [['C3', 3]]], time: [3, 4], pickup: true },
    );
    const rep = checkEmbellishment(plain, plain, [], '1');
    expect(rep.ok).toBe(true);
    // Downbeats at 1 and 4: the E4 struck on 1 and the C4 on 4.
    expect(rep.strongTotal).toBe(2);
    expect(rep.strongKept).toBe(2);
  });

  it('ignores warnings that differ only in their note indices', () => {
    const plain = fixtureScore(
      [
        [
          ['C4', 1],
          ['E4', 1],
          ['D4', 2],
        ],
        [['C4', 4]],
      ],
      { lh: [[['C3', 4]], [[['C3', 'C3'], 4]]] },
    );
    const before = parseMusicXml(plain).warnings;
    expect(before.some((w) => /^note \d+: duplicate of note \d+ /.test(w))).toBe(true);
    const res = embellishMusicXml(plain);
    expect(res.inserted).toHaveLength(1);
    const after = parseMusicXml(res.xml).warnings;
    expect(after).not.toEqual(before);
    const rep = check(plain, res);
    expect(rep.problems).toEqual([]);
    expect(rep.ok).toBe(true);
  });
});
