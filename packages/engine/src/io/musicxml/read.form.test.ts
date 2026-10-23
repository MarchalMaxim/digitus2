import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { embellishMusicXml } from '../../embellish/embellish.js';
import { performanceOrder } from '../../score/form.js';
import { parseMusicXml } from './read.js';

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../fixtures/${name}.musicxml`, import.meta.url)),
    'utf8',
  );
const library = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../../../content/scores/${name}.musicxml`, import.meta.url)),
    'utf8',
  );

function read(source: string) {
  const { score } = parseMusicXml(source);
  return {
    forms: score.measures.map((m) => m.form),
    order: performanceOrder(score.measures),
    bars: score.measures.length,
  };
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('repeats and jumps read from MusicXML', () => {
  it('reads a backward repeat as a section played twice', () => {
    const { forms, order } = read(fixture('form-repeat'));
    expect(forms).toEqual([undefined, { repeatEnd: 2 }]);
    expect(order).toEqual([0, 1, 0, 1]);
  });

  it('reads a forward repeat and first and second endings', () => {
    const { forms, order } = read(fixture('form-voltas'));
    expect(forms).toEqual([
      { repeatStart: true },
      undefined,
      { ending: [1], repeatEnd: 2 },
      { ending: [2] },
    ]);
    expect(order).toEqual([0, 1, 2, 0, 1, 3]);
  });

  it('reads D.C. al Fine from the sound attributes, and from the words alone', () => {
    expect(read(fixture('form-dc-al-fine')).order).toEqual([0, 1, 2, 3, 0, 1]);
    const wordsOnly = fixture('form-dc-al-fine').replace(/<sound (?!tempo)[^>]*\/>/g, '');
    expect(wordsOnly).not.toContain('dacapo');
    expect(read(wordsOnly).order).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('reads D.S. al Coda with its segno, To Coda and coda', () => {
    expect(read(fixture('form-ds-al-coda')).order).toEqual([0, 1, 2, 3, 1, 2, 4, 5]);
  });

  it('reads the symbols of a segno and a coda that carry no sound attribute', () => {
    const noSound = fixture('form-ds-al-coda').replace(/<sound (?!tempo)[^>]*\/>/g, '');
    expect(read(noSound).order).toEqual([0, 1, 2, 3, 1, 2, 4, 5]);
  });

  it('reads one volta that names several passes', () => {
    const source = fixture('form-voltas').replace(
      'number="1" type="start"',
      'number="1, 2" type="start"',
    );
    expect(read(source).forms[2]?.ending).toEqual([1, 2]);
  });

  it('reads the repeat count of a backward repeat', () => {
    const source = fixture('form-repeat').replace(
      '<repeat direction="backward"/>',
      '<repeat direction="backward" times="3"/>',
    );
    expect(read(source).order).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('gives a piece with no signs no form at all', () => {
    const { forms } = read(fixture('two-staff'));
    expect(forms.every((f) => f === undefined)).toBe(true);
  });
});

describe('the library in performance order', () => {
  it('unfolds a piece with two repeats', () => {
    const { order, bars } = read(library('bach-applicatio-c-major-bwv-994'));
    expect(bars).toBe(8);
    expect(order).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 6, 7, 4, 5, 6, 7].slice(0, 16));
  });

  it('plays the second ending of a minuet only on the second pass', () => {
    const { order, bars } = read(library('handel-aylesford-minuet-d-minor'));
    expect(bars).toBe(17);
    expect(order).toEqual([...range(0, 7), ...range(0, 7), ...range(8, 15), ...range(8, 14), 16]);
  });

  it('plays a Burgmuller study through its D.C. al Fine', () => {
    const { order, bars } = read(library('burgmuller-op100-no6-progres'));
    expect(bars).toBe(16);
    expect(order).toEqual([...range(0, 7), ...range(0, 7), ...range(8, 15), ...range(0, 7)]);
  });

  it('keeps the order when notes are added between', () => {
    const source = library('bach-minuet-g-major-bwv-anh-114');
    const embellished = embellishMusicXml(source);
    expect(embellished.inserted.length).toBeGreaterThan(0);
    const before = read(source);
    const after = read(embellished.xml);
    expect(before.order.length).toBeGreaterThan(before.bars);
    expect(after.forms).toEqual(before.forms);
    expect(after.order).toEqual(before.order);
  });

  it.each(['burgmuller-op100-no7-le-courant-limpide', 'burgmuller-op100-no8-la-gracieuse'])(
    'plays %s through its D.C. al Fine like No. 6',
    (name) => {
      const { order } = read(library(name));
      expect(order).toEqual([...range(0, 7), ...range(0, 7), ...range(8, 15), ...range(0, 7)]);
    },
  );

  it('plays the whole of a piece that ends on a D.C. with the last endings after it', () => {
    const { order, bars } = read(library('bulk-turpint-turpinhar-turpinhar-ly'));
    expect(bars).toBe(115);
    expect(order).toEqual([
      ...range(0, 19),
      ...range(4, 18),
      ...range(20, 36),
      ...range(21, 34),
      ...range(37, 114),
      ...range(0, 18),
      ...range(20, 34),
      ...range(37, 114),
    ]);
  });

  it('takes the repeats of a piece with a D.C. written in a first ending, never the D.C. (La Styrienne)', () => {
    const { order, bars } = read(library('burgmuller-op100-no14-la-styrienne'));
    expect(bars).toBe(40);
    expect(order).toEqual([
      ...range(0, 12),
      ...range(4, 29),
      ...range(13, 38),
      ...range(30, 37),
      39,
    ]);
  });

  it('plays a Fine with no D.C. in the order written, and a piece cut at a Fine as engraved', () => {
    expect(read(library('pleyel-minuet-c-major')).order).toEqual([
      ...range(0, 7),
      ...range(0, 15),
      ...range(8, 15),
    ]);
    const wanhal = read(library('wanhal-rondo-op42-no1'));
    expect(wanhal.order).toEqual(range(0, wanhal.bars - 1));
  });
});
