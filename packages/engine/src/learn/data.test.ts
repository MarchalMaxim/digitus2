import { describe, expect, it } from 'vitest';
import { parsePig } from '../io/pig/read.js';
import { annotationOn, fingeredCount, toHandExamples } from './data.js';

const H = '//Version: PianoFingering_v170101\n';
const text =
  H +
  [
    '0\t0\t0.5\tC4\t80\t80\t0\t1',
    '1\t0.5\t1\tD4\t80\t80\t0\t0',
    '2\t0\t1\tC3\t80\t80\t1\t-5',
    '3\t0.5\t1\tE3\t80\t80\t1\t-3',
  ].join('\n') +
  '\n';

describe('toHandExamples', () => {
  it('splits a piece into hands with aligned gold arrays and 0 for unfingered notes', () => {
    const a = parsePig(text);
    // a second annotation that fingers D4 with 2 (the plan's `'\t0\t1\n'` matched the C4 line)
    const b = parsePig(text.replace('D4\t80\t80\t0\t0\n', 'D4\t80\t80\t0\t2\n'));
    const ex = toHandExamples({
      corpus: 'pig',
      id: 'x',
      score: a.score,
      annotations: [a.assignment, b.assignment],
    });
    expect(ex.map((e) => e.seq.hand)).toEqual(['R', 'L']);
    expect(ex.map((e) => e.id)).toEqual(['pig:x:R', 'pig:x:L']);
    const r = ex[0]!;
    expect(r.golds).toEqual([
      [1, 0],
      [1, 2],
    ]);
    expect(r.weight).toBe(1);
    expect(fingeredCount(r)).toBe(2);
    expect(ex[1]!.golds).toEqual([
      [5, 3],
      [5, 3],
    ]);
  });
  it('drops an annotation that fingers nothing in a hand', () => {
    const a = parsePig(text);
    const empty = { ...a.assignment };
    for (const n of a.score.notes) if (n.hand === 'R') delete empty[n.id];
    const ex = toHandExamples({ corpus: 'mutopia', id: 'y', score: a.score, annotations: [empty] });
    expect(ex.find((e) => e.seq.hand === 'R')).toBeUndefined();
    expect(ex.find((e) => e.seq.hand === 'L')!.golds).toHaveLength(1);
  });
  it('makes no example for a hand without notes', () => {
    const rh = parsePig(H + '0\t0\t0.5\tC4\t80\t80\t0\t1\n');
    const ex = toHandExamples({
      corpus: 'textbook',
      id: 'z',
      score: rh.score,
      annotations: [rh.assignment],
    });
    expect(ex.map((e) => e.id)).toEqual(['textbook:z:R']);
    expect(fingeredCount(ex[0]!)).toBe(1);
  });
  it('counts a note as fingered when any annotation fingers it', () => {
    const a = parsePig(text);
    const b = parsePig(
      text
        .replace('C4\t80\t80\t0\t1\n', 'C4\t80\t80\t0\t0\n')
        .replace('D4\t80\t80\t0\t0\n', 'D4\t80\t80\t0\t2\n'),
    );
    const [r] = toHandExamples({
      corpus: 'pig',
      id: 'w',
      score: a.score,
      annotations: [b.assignment, a.assignment],
    });
    expect(r!.golds).toEqual([
      [0, 2],
      [1, 0],
    ]);
    expect(fingeredCount(r!)).toBe(2);
  });
});

describe('annotationOn', () => {
  it('aligns a second annotation by file line onto the first one note ids', () => {
    const base = parsePig(text);
    const other = parsePig(
      text
        .replace(/^(\d)\t/gm, (_m, d: string) => `${Number(d) + 10}\t`)
        .replace('D4\t80\t80\t0\t0\n', 'D4\t80\t80\t0\t4\n'),
    );
    const a = annotationOn(base.score, other);
    expect(Object.keys(a).sort()).toEqual(['0', '1', '2', '3']);
    expect(a['1']!.finger).toBe(4);
    expect(a['2']!.finger).toBe(5);
  });
  it('gives no finger to a note the annotation puts in the other hand', () => {
    // Annotation 2 plays E3 with the right hand (channel 0, finger 1): gold 0 for the left-hand
    // sequence of annotation 2, never a copied right-hand finger (learning prototype section 3).
    const base = parsePig(text);
    const other = parsePig(text.replace('E3\t80\t80\t1\t-3\n', 'E3\t80\t80\t0\t1\n'));
    const a = annotationOn(base.score, other);
    expect(a['3']).toBeUndefined();
    expect(a['2']!.finger).toBe(5);
    const ex = toHandExamples({
      corpus: 'pig',
      id: 'v',
      score: base.score,
      annotations: [base.assignment, a],
    });
    expect(ex.find((e) => e.seq.hand === 'L')!.golds).toEqual([
      [5, 3],
      [5, 0],
    ]);
    // The right hand of annotation 2 does not gain E3: only the base's right-hand notes count.
    expect(ex.find((e) => e.seq.hand === 'R')!.golds).toEqual([
      [1, 0],
      [1, 0],
    ]);
  });
  it('throws when the annotations do not have the same notes', () => {
    const base = parsePig(text);
    expect(() => annotationOn(base.score, parsePig(text.replace('D4', 'E4')), 'k2')).toThrow(
      /k2.*note line 1/,
    );
    const shorter = parsePig(H + '0\t0\t0.5\tC4\t80\t80\t0\t1\n');
    expect(() => annotationOn(base.score, shorter)).toThrow(/4 notes.*1/);
  });
});
