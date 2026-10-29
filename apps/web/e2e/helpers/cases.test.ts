import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  agreementOf,
  barsCell,
  caseFacts,
  decide,
  normalizeExpect,
  readCase,
  readingOf,
  retakeAsked,
  type CaseScreen,
  type PageReading,
} from './cases.js';

// The row contract the scan validation gate writes into report.json (issue 233), checked without
// a browser or a case: what a recognition reads, the truth of expect.json, and how far they agree.

/** A MusicXML of the given parts, each `{ staves?, measures, opening? }`, as homr shapes it. */
function score(
  parts: { staves?: number; measures: number; opening?: string; name?: string }[],
): string {
  const list = parts
    .map(
      (p, i) =>
        `<score-part id="P${i + 1}"><part-name>${p.name ?? 'Piano'}</part-name></score-part>`,
    )
    .join('');
  const body = parts
    .map((p, i) => {
      const measures = Array.from({ length: p.measures }, (_, m) => {
        const opening =
          m === 0
            ? (p.opening ??
              `<attributes><divisions>1</divisions>${p.staves ? `<staves>${p.staves}</staves>` : ''}</attributes><attributes><key><fifths>-2</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes>`)
            : '';
        return `<measure number="${m + 1}">${opening}<note><rest/></note></measure>`;
      }).join('');
      return `<part id="P${i + 1}">${measures}</part>`;
    })
    .join('');
  return `<score-partwise><part-list>${list}</part-list>${body}</score-partwise>`;
}

const refused: PageReading = {
  bars: null,
  staves: null,
  fifths: null,
  time: null,
  parts: null,
  joins: false,
  refused: { status: 422 },
};

test('a recognition of one grand-staff part: its bars, staves, and the key and time of its opening attributes', () => {
  expect(readingOf(score([{ staves: 2, measures: 19 }]))).toEqual({
    bars: 19,
    staves: 2,
    fifths: -2,
    time: '3/4',
    parts: 1,
    joins: false,
  });
  // `<measure-style>` and `<part-name>` are no measure and no part.
  const styled = score([{ staves: 2, measures: 3 }]).replace(
    '<attributes><divisions>',
    '<attributes><measure-style><slash/></measure-style><divisions>',
  );
  expect(readingOf(styled).bars).toBe(3);
});

test('two parts: a pair the app joins into a grand staff, and pairs it does not', () => {
  // A treble part and a bass part of one staff each and as many bars: the app joins them.
  const pair = readingOf(score([{ measures: 12 }, { measures: 12 }]));
  expect(pair).toMatchObject({ bars: 12, staves: 2, parts: 2, joins: true });
  // The same with unequal lengths: the join refuses them.
  expect(readingOf(score([{ measures: 12 }, { measures: 10 }]))).toMatchObject({
    parts: 2,
    joins: false,
  });
  // Piano on two staves and a voice: two staves in the first part, but no grand staff of the page.
  const voice = readingOf(
    score([
      { staves: 2, measures: 17 },
      { measures: 19, name: 'Voice' },
    ]),
  );
  expect(voice).toMatchObject({ bars: 17, staves: 2, parts: 2, joins: false });
});

test('the truth: one photo or several pages, a missing fact null, an entry that is no page kept in its place', () => {
  expect(
    normalizeExpect({ photo: 'x', bars: 24, staves: 2, fifths: 1, time: '3/4', cutOff: true }),
  ).toEqual({
    pages: [{ bars: 24, staves: 2, fifths: 1, time: '3/4', cutOff: true }],
  });
  expect(
    normalizeExpect({
      pages: [{ bars: 19, staves: 2, fifths: 0, time: '4/4' }, null, { bars: 20 }],
    }),
  ).toEqual({
    pages: [
      { bars: 19, staves: 2, fifths: 0, time: '4/4' },
      { bars: null, staves: null, fifths: null, time: null },
      { bars: 20, staves: null, fifths: null, time: null },
    ],
  });
  expect(normalizeExpect([])).toBeNull();
  expect(normalizeExpect({ pages: [] })).toBeNull();
});

test('agreement: a fact the truth leaves out agrees on every page; a refused page agrees on nothing the truth gives', () => {
  const truth = normalizeExpect({ pages: [{ bars: 19 }, { bars: 24 }] });
  const read19 = readingOf(score([{ staves: 2, measures: 19 }]));
  const read24 = readingOf(score([{ staves: 2, measures: 24 }]));
  const before = agreementOf([read19, refused], truth);
  const after = agreementOf([read19, read24], truth);
  expect(before).toEqual({ bars: 1, staves: 2, fifths: 2, time: 2, of: 2 });
  expect(after).toEqual({ bars: 2, staves: 2, fifths: 2, time: 2, of: 2 });
  // With the facts given, a refused page and a missing page agree on none of them.
  const full = normalizeExpect({
    pages: [
      { bars: 19, staves: 2, fifths: -2, time: '3/4' },
      { bars: 24, staves: 2, fifths: -2, time: '3/4' },
    ],
  });
  expect(agreementOf([read19, refused], full)).toEqual({
    bars: 1,
    staves: 1,
    fifths: 1,
    time: 1,
    of: 2,
  });
  expect(agreementOf([read19], full)).toEqual({ bars: 1, staves: 1, fifths: 1, time: 1, of: 2 });
  expect(agreementOf([read19], null)).toBeNull();
});

test('agreement on staves: one part with the staves of the page, or a pair the app joins', () => {
  const two = normalizeExpect({ bars: 17, staves: 2 });
  const voice = readingOf(
    score([
      { staves: 2, measures: 17 },
      { measures: 19, name: 'Voice' },
    ]),
  );
  expect(agreementOf([voice], two)?.staves).toBe(0);
  expect(agreementOf([readingOf(score([{ measures: 17 }, { measures: 17 }]))], two)?.staves).toBe(
    1,
  );
  expect(agreementOf([readingOf(score([{ measures: 17 }, { measures: 15 }]))], two)?.staves).toBe(
    0,
  );
  expect(agreementOf([readingOf(score([{ staves: 2, measures: 17 }]))], two)?.staves).toBe(1);
  expect(agreementOf([readingOf(score([{ measures: 17 }]))], two)?.staves).toBe(0);
});

test('the bars cell of report.md: page by page against the truth, in the notation of report.mjs', () => {
  const read19 = readingOf(score([{ staves: 2, measures: 19 }]));
  const read20 = readingOf(score([{ staves: 2, measures: 20 }]));
  expect(
    barsCell({
      pages: [read19, refused, read20],
      expect: normalizeExpect({ pages: [{ bars: 19 }, { bars: 24 }, { bars: 24 }] }),
    }),
  ).toBe('19/19, refused/24, 20/24');
  expect(
    barsCell({ pages: [read19], expect: normalizeExpect({ pages: [{ bars: 19 }, { bars: 24 }] }) }),
  ).toBe('19/19, absent/24');
  expect(barsCell({ pages: [read19, read20], expect: null })).toBe('19, 20');
});

const screen = (over: Partial<CaseScreen> = {}): CaseScreen => ({
  settled: true,
  verdict: '',
  blocking: false,
  alerts: [],
  pageErrors: [],
  technical: [],
  places: [],
  usable: false,
  retake: false,
  fixAll: false,
  showBar: false,
  ...over,
});

test('a retake is asked by its button, or by each sentence of the review that says to photograph a page again', () => {
  expect(retakeAsked(screen({ retake: true }))).toBe(true);
  for (const sentence of [
    'The pages did not join into one score: each is shown on its own and can be downloaded under Files. Replace the page that differs and scan again.',
    'Page 2 could not be combined with the other pages. Photograph it again, flat and with the whole page in view.',
    'Page 2 was read as one staff: the hands are mixed. Replace that photo and scan again.',
    'Pages 2 and 3 were read as one staff: the hands are mixed. Replace those photos and scan again.',
    'Part of a line on page 2 was not read, so bars are missing or added. Replace that photo and scan again.',
    'Page 2 could not be read clearly. Photograph it again: flat, evenly lit, the whole page in the frame.',
    'Pages 2 and 3 could not be read clearly. Photograph them again: flat, evenly lit, each whole page in the frame.',
  ]) {
    expect(retakeAsked(screen({ verdict: sentence })), sentence).toBe(true);
    expect(retakeAsked(screen({ alerts: [sentence] })), sentence).toBe(true);
  }
  expect(retakeAsked(screen({ verdict: '2 pages · 41 bars · both hands' }))).toBe(false);
});

test('a case: its pages and refusals in order, its truth, and an expect.json that cannot be read fails it', () => {
  const root = mkdtempSync(join(tmpdir(), 'd2-cases-'));
  try {
    const dir = join(root, 'case-x');
    mkdirSync(dir);
    writeFileSync(join(dir, 'page-1.jpg'), 'photo one');
    writeFileSync(join(dir, 'page-1-recognized.musicxml'), score([{ staves: 2, measures: 19 }]));
    writeFileSync(join(dir, 'page-2.jpg'), 'photo two');
    writeFileSync(
      join(dir, 'recognition-failed.json'),
      JSON.stringify({ pages: [{ page: 2, status: 504, answer: { state: 'failed' } }] }),
    );
    writeFileSync(
      join(dir, 'expect.json'),
      JSON.stringify({ pages: [{ bars: 19 }, { bars: 24 }] }),
    );
    const scan = readCase(root, 'case-x');
    expect(scan.expectProblem).toBeUndefined();
    const facts = caseFacts(scan);
    expect(facts.refusedPages).toEqual([2]);
    expect(facts.pages[1]).toEqual({ ...refused, refused: { status: 504 } });
    expect(facts.agree).toEqual({ bars: 1, staves: 2, fifths: 2, time: 2, of: 2 });

    const usable = screen({ usable: true });
    expect(decide(usable, 40, 2, facts.pages).outcome).toBe('usable');
    writeFileSync(join(dir, 'expect.json'), '{ "pages": [');
    const broken = readCase(root, 'case-x');
    expect(broken.expect).toBeNull();
    expect(broken.expectProblem).toMatch(/expect\.json is not JSON/);
    const decided = decide(usable, 40, 2, caseFacts(broken).pages, broken.expectProblem);
    expect(decided.outcome).toBe('failed');
    expect(decided.why).toMatch(
      /^the scanner refused page 2 \(504\); expect\.json is not JSON \(SyntaxError.*\); Use for fingerings drew fingerings$/,
    );
    writeFileSync(join(dir, 'expect.json'), '[]');
    expect(readCase(root, 'case-x').expectProblem).toMatch(/expect\.json holds no page/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
