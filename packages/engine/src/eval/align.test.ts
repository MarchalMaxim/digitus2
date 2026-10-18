import { describe, expect, it } from 'vitest';
import { parsePig } from '../io/pig/read.js';
import { alignScores, fingerSeq, metricsForScores } from './align.js';

const gold = `//Version: PianoFingering_v170101
0\t0\t0.5\tC4\t80\t80\t0\t1
1\t0.5\t1\tD4\t80\t80\t0\t2
2\t0\t1\tC3\t80\t80\t1\t-5
`;

describe('alignScores', () => {
  it('pairs notes by id when ids match', () => {
    const g = parsePig(gold);
    const p = parsePig(gold.replace('\t1\n', '\t3\n'));
    expect(alignScores(p.score, g.score)).toEqual([
      ['0', '0'],
      ['2', '2'],
      ['1', '1'],
    ]);
  });
  it('falls back to onset, hand and pitch order when ids differ', () => {
    const g = parsePig(gold);
    const p = parsePig(gold.replace(/^(\d)\t/gm, (_m, d: string) => `${Number(d) + 10}\t`));
    expect(alignScores(p.score, g.score)).toEqual([
      ['10', '0'],
      ['12', '2'],
      ['11', '1'],
    ]);
  });
  it('pairs shuffled simultaneous notes of both hands by position and returns them in gold order', () => {
    const file = (rows: Array<[string, number, string, 0 | 1]>) =>
      parsePig(
        '//Version: PianoFingering_v170101\n' +
          rows
            .map(([id, on, name, hand]) => `${id}\t${on}\t${on + 0.5}\t${name}\t80\t80\t${hand}\t1`)
            .join('\n') +
          '\n',
      );
    // Gold file order differs from position order (onset, right hand first, pitch).
    const g = file([
      ['g0', 0.5, 'D4', 0],
      ['g1', 0, 'C4', 0],
      ['g2', 0, 'C3', 1],
      ['g3', 0, 'E4', 0],
    ]);
    const p = file([
      ['p0', 0, 'C3', 1],
      ['p1', 0.5, 'D4', 0],
      ['p2', 0, 'E4', 0],
      ['p3', 0, 'C4', 0],
    ]);
    // parsePig sorts notes by position; put both note lists in file order instead.
    const inFileOrder = (f: ReturnType<typeof file>, ids: string[]) => ({
      ...f.score,
      notes: ids.map((id) => f.score.notes.find((n) => n.id === id)!),
    });
    const gold = inFileOrder(g, ['g0', 'g1', 'g2', 'g3']);
    const pred = inFileOrder(p, ['p0', 'p1', 'p2', 'p3']);
    expect(alignScores(pred, gold)).toEqual([
      ['p1', 'g0'],
      ['p3', 'g1'],
      ['p0', 'g2'],
      ['p2', 'g3'],
    ]);
  });
  it('throws when note counts differ', () => {
    const g = parsePig(gold);
    const p = parsePig(gold.split('\n').slice(0, 3).join('\n') + '\n');
    expect(() => alignScores(p.score, g.score)).toThrow(/count/);
  });
});

describe('metricsForScores', () => {
  it('scores a prediction against several annotators', () => {
    const g1 = parsePig(gold);
    const g2 = parsePig(gold.replace('\t2\n', '\t3\n'));
    const pred = parsePig(gold.replace('\t2\n', '\t3\n'));
    const m = metricsForScores(pred, [g1, g2]);
    expect(m.high).toBe(1);
    expect(m.gen).toBeCloseTo((2 / 3 + 1) / 2);
    expect(m.soft).toBe(1);
    expect(fingerSeq(pred.score, pred.assignment)).toEqual([1, 5, 3]);
  });
  it('recombines in the gold file order within a chord', () => {
    // The chord at 0.5 s is written G4 then E4. Annotator A is right up to the chord, B after it,
    // and they agree on E4, the chord's last note in file order, so A..A,B,B costs one switch:
    // rec = 4/5. In pitch order (E4 before G4) the switch would need agreement on G4, which
    // they lack, and rec would be 3/5.
    const piece = (f: number[]) =>
      parsePig(
        [
          '//Version: PianoFingering_v170101',
          `0\t0\t0.5\tC4\t80\t80\t0\t${f[0]}`,
          `1\t0.5\t1\tG4\t80\t80\t0\t${f[1]}`,
          `2\t0.5\t1\tE4\t80\t80\t0\t${f[2]}`,
          `3\t1\t1.5\tF4\t80\t80\t0\t${f[3]}`,
          `4\t1.5\t2\tG4\t80\t80\t0\t${f[4]}`,
          '',
        ].join('\n'),
      );
    const m = metricsForScores(piece([1, 5, 3, 4, 5]), [
      piece([1, 5, 3, 2, 2]),
      piece([2, 4, 3, 4, 5]),
    ]);
    expect(m.high).toBe(0.6);
    expect(m.rec).toBe(0.8);
  });
  it('counts a gold note played by the other hand as a mismatch', () => {
    // PIG annotators sometimes move a note to the other hand; R2 and L2 are different fingerings.
    const pred = parsePig(gold);
    const other = parsePig(
      gold.replace('1\t0.5\t1\tD4\t80\t80\t0\t2', '1\t0.5\t1\tD4\t80\t80\t1\t-2'),
    );
    const m = metricsForScores(pred, [other]);
    expect(m.gen).toBeCloseTo(2 / 3);
    expect(m.soft).toBeCloseTo(2 / 3);
    expect(m.high).toBeCloseTo(2 / 3);
    expect(m.rec).toBeCloseTo(2 / 3);
    expect(metricsForScores(pred, [parsePig(gold), other]).gen).toBeCloseTo(5 / 6);
  });
});
