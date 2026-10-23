// @vitest-environment node
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en/index.js';
import { messages as fr } from '../i18n/fr/index.js';
import { messages as nl } from '../i18n/nl/index.js';
import { messages as es } from '../i18n/es/index.js';
import { messages as pt } from '../i18n/pt/index.js';
import { GRAND_STAFF_WARNING, PARTLY_READ_WARNING } from './client.js';
import { findProblems } from './corrections.js';
import { joinScanPages } from './join.js';
import { parseScanXml, readScanScore } from './notes.js';
import { verdict, verdictText, type VerdictFacts } from './verdict.js';

// The join and the note reader use the browser's parser; in Node happy-dom supplies it.
const dom = new Window();
Object.assign(globalThis, { DOMParser: dom.DOMParser, XMLSerializer: dom.XMLSerializer });

/** The owner's three pages as homr wrote them; happy-dom parses a double-quoted XML declaration. */
const fixture = (n: number) =>
  readFileSync(new URL(`../../fixtures/scan/owner-page-${n}.musicxml`, import.meta.url), 'utf8')
    .replace(/^<\?xml[^>]*\?>/, '<?xml version="1.0" encoding="utf-8"?>')
    .trim();

/** The measures of the first part, counted in the text itself, not by the note reader. */
const measuresOfFirstPart = (xml: string) => {
  const part = /<part id="[^"]*">([\s\S]*?)<\/part>/.exec(xml)![1]!;
  return part.match(/<measure[ >]/g)!.length;
};
const partsOf = (xml: string) => xml.match(/<part id=/g)!.length;
const scoreOf = (xml: string) => readScanScore(parseScanXml(xml));

const pages = [1, 2, 3].map(fixture);
const barsOf = pages.map(measuresOfFirstPart);

const facts = (over: Partial<VerdictFacts> = {}): VerdictFacts => ({
  warnings: [],
  joined: true,
  problems: 0,
  ...over,
});

describe('the owner pages', () => {
  it('count their bars independently of the note reader', () => {
    // Page 3 is a treble part and a bass part: its bars are one part's, not both.
    expect(partsOf(pages[2]!)).toBe(2);
    expect(barsOf.every((n) => n > 0)).toBe(true);
  });

  it('read as three pages, the summed bars, both hands', () => {
    const joined = joinScanPages(pages);
    expect(partsOf(joined)).toBe(1);
    const v = verdict(facts({ pages: [{}, {}, {}], score: scoreOf(joined) }));
    expect(v).toEqual({
      kind: 'read',
      pages: 3,
      bars: barsOf[0]! + barsOf[1]! + barsOf[2]!,
      hands: 'both',
      places: 0,
    });
    expect(verdictText(en, v)).toBe(
      `3 pages · ${v.kind === 'read' ? v.bars : 0} bars · both hands`,
    );
  });

  it.each([
    ['the split page first', [3, 1, 2]],
    ['the split page last', [1, 2, 3]],
  ])('say both hands with %s', (_name, order) => {
    const v = verdict(
      facts({ pages: order.map(() => ({})), score: scoreOf(joinScanPages(order.map(fixture))) }),
    );
    expect(v).toMatchObject({ kind: 'read', pages: 3, hands: 'both' });
  });

  it('the owner scan, end to end', () => {
    expect(barsOf).toEqual([12, 10, 3]);
    const score = scoreOf(joinScanPages(pages));
    const v = verdict(facts({ pages: [{}, {}, {}], score, problems: findProblems(score).length }));
    expect(verdictText(en, v)).toBe('3 pages · 25 bars · both hands');
  });

  it('read one page: one page, its bars, both hands', () => {
    const v = verdict(facts({ pages: [{}], score: scoreOf(pages[0]!) }));
    expect(verdictText(en, v)).toBe(`1 page · ${barsOf[0]} bars · both hands`);
  });

  it('count the bars of a split page once, and say nothing of its hands', () => {
    // Two one-staff parts: the bars are the page's, and "both hands" is not claimed.
    const v = verdict(facts({ pages: [{}], score: scoreOf(pages[2]!) }));
    expect(v).toEqual({ kind: 'read', pages: 1, bars: barsOf[2], hands: undefined, places: 0 });
    expect(verdictText(en, v)).toBe(`1 page · ${barsOf[2]} bars`);
  });
});

describe('the line of facts', () => {
  const score = scoreOf(joinScanPages(pages));
  const bars = barsOf[0]! + barsOf[1]! + barsOf[2]!;

  it('counts the places to check, and says nothing when there are none', () => {
    expect(verdictText(en, verdict(facts({ pages: [{}, {}, {}], score, problems: 2 })))).toBe(
      `3 pages · ${bars} bars · both hands · 2 places to check`,
    );
    expect(verdictText(en, verdict(facts({ pages: [{}, {}, {}], score, problems: 1 })))).toBe(
      `3 pages · ${bars} bars · both hands · 1 place to check`,
    );
  });

  it('leaves the pages out for a PDF, whose page count the scan does not know', () => {
    expect(verdictText(en, verdict(facts({ score })))).toBe(`${bars} bars · both hands`);
  });

  it('says one staff for a one-staff score', () => {
    const one = pages[0]!.replace(/<staves>2<\/staves>/, '');
    expect(verdictText(en, verdict(facts({ pages: [{}], score: scoreOf(one) })))).toMatch(
      /^1 page · \d+ bars · one staff$/,
    );
  });

  it('is only the pages when the score cannot be read', () => {
    expect(verdictText(en, verdict(facts({ pages: [{}, {}] })))).toBe('2 pages');
    expect(verdictText(en, verdict(facts({ pages: [{}, {}], problems: 1 })))).toBe(
      '2 pages · 1 place to check',
    );
  });
});

describe('a verdict that blocks', () => {
  const score = scoreOf(pages[0]!);

  it('names the page read as one staff, and the action', () => {
    const v = verdict(
      facts({
        pages: [{}, { warnings: [GRAND_STAFF_WARNING] }],
        warnings: [GRAND_STAFF_WARNING],
        score,
      }),
    );
    expect(v).toEqual({ kind: 'oneStaff', pages: [2] });
    expect(verdictText(en, v)).toBe(
      'Page 2 was read as one staff: the hands are mixed. Replace that photo and scan again.',
    );
  });

  it('names every page that was read as one staff', () => {
    const v = verdict(
      facts({
        pages: [{ warnings: [GRAND_STAFF_WARNING] }, {}, { warnings: [GRAND_STAFF_WARNING] }],
        warnings: [GRAND_STAFF_WARNING],
        score,
      }),
    );
    expect(verdictText(en, v)).toBe(
      'Pages 1 and 3 were read as one staff: the hands are mixed. Replace those photos and scan again.',
    );
  });

  it('does not name a page the scanner did not name', () => {
    const v = verdict(facts({ pages: [{}], warnings: [GRAND_STAFF_WARNING], score }));
    expect(v).toEqual({ kind: 'oneStaff', pages: [] });
    expect(verdictText(en, v)).toMatch(/^A page was read as one staff/);
  });

  it('says a line read only in part, after the hands, and ahead of the facts', () => {
    const partly = facts({
      pages: [{ warnings: [PARTLY_READ_WARNING] }, {}],
      warnings: [PARTLY_READ_WARNING],
      score,
      problems: 3,
    });
    expect(verdict(partly)).toEqual({ kind: 'partlyRead', pages: [1] });
    expect(verdictText(en, verdict(partly))).toBe(
      'Part of a line on page 1 was not read, so bars are missing or added. Replace that photo and scan again.',
    );
    expect(verdict({ ...partly, warnings: [GRAND_STAFF_WARNING, PARTLY_READ_WARNING] }).kind).toBe(
      'oneStaff',
    );
  });

  it('says the pages did not join, whatever else was found', () => {
    const v = verdict(
      facts({ pages: [{}, {}], joined: false, warnings: [GRAND_STAFF_WARNING], problems: 2 }),
    );
    expect(v).toEqual({ kind: 'notJoined' });
    expect(verdictText(en, v)).toBe(
      'The pages did not join into one score: each is shown on its own and can be downloaded under Files. Replace the page that differs and scan again.',
    );
  });

  it('blocks only when it is not a plain reading', () => {
    expect(verdict(facts({ pages: [{}], score })).kind).toBe('read');
  });
});

describe('in every language', () => {
  const v = verdict(
    facts({ pages: [{}, {}, {}], score: scoreOf(joinScanPages(pages)), problems: 2 }),
  );
  const bars = barsOf[0]! + barsOf[1]! + barsOf[2]!;
  it.each([
    ['fr', fr, `3 pages · ${bars} mesures · deux mains · 2 endroits à vérifier`],
    ['nl', nl, `3 pagina’s · ${bars} maten · beide handen · 2 plekken om te controleren`],
    ['es', es, `3 páginas · ${bars} compases · ambas manos · 2 puntos que revisar`],
    ['pt', pt, `3 páginas · ${bars} compassos · ambas as mãos · 2 pontos para conferir`],
  ] as const)('writes the facts in %s', (_locale, messages, line) => {
    expect(verdictText(messages, v)).toBe(line);
  });

  it.each([
    ['en', en],
    ['fr', fr],
    ['nl', nl],
    ['es', es],
    ['pt', pt],
  ] as const)('writes every blocking verdict in %s, with no leftover placeholder', (_l, m) => {
    for (const pagesList of [[], [2], [1, 3]])
      for (const kind of ['oneStaff', 'partlyRead'] as const) {
        const text = verdictText(m, { kind, pages: pagesList });
        expect(text.length).toBeGreaterThan(10);
        expect(text).not.toMatch(/undefined|NaN|\[object|\$\{/);
        if (pagesList.length) expect(text).toContain(String(pagesList[0]));
      }
    expect(verdictText(m, { kind: 'notJoined' }).length).toBeGreaterThan(10);
  });
});
