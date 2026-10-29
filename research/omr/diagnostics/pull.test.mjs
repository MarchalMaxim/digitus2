import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseFolder, groupCases, parseListing, planCase } from './pull.mjs';

const ID = '0123456789abcdef0123456789abcdef';
const AT = `gs://digitus2-scan-cases/cases/2026-10-28/${ID}`;

/** A listing line: size, creation time (minutes after 21:00), object name in the kept scan. */
const line = (size, minute, name) =>
  `${String(size).padStart(10)}  2026-10-28T21:${String(minute).padStart(2, '0')}:00Z  ${AT}/${name}`;

/** The plan of one kept scan, from its listing lines. */
const plan = (...lines) =>
  planCase(groupCases(parseListing(lines.join('\n'))).get(`2026-10-28/${ID}`));

/** What the plan copies, as [name in the case, object name]. */
const copies = (p) => p.files.map((f) => [f.name, f.url.split('/').pop()]).sort();

test('a listing groups into kept scans by folder', () => {
  const objects = parseListing(`
    825249  2026-10-28T21:58:40Z  ${AT}/page-1.jpg
     91319  2026-10-28T21:58:47Z  ${AT}/page-1-recognized.musicxml
        10  2026-10-28T22:05:30Z  ${AT}/../../evil.json
        10  2026-10-28T22:05:30Z  gs://digitus2-scan-cases/cases/notes.txt
TOTAL: 4 objects, 916588 bytes (895.11KiB)
`);
  assert.equal(objects.length, 4);
  const cases = groupCases(objects);
  assert.deepEqual([...cases.keys()], [`2026-10-28/${ID}`]);
  assert.equal(
    caseFolder(`2026-10-28/${ID}`, cases.get(`2026-10-28/${ID}`)),
    'kept-2026-10-28-01234567',
  );
});

test("the service's layout: each page's photo, recognition and record, and the reviews", () => {
  const p = plan(
    line(825249, 1, 'page-1.jpg'),
    line(91319, 2, 'page-1-recognized.musicxml'),
    line(812, 2, 'page-1-recognition.json'),
    line(993966, 3, 'page-2.jpg'),
    line(146505, 4, 'page-2-recognized.musicxml'),
    line(2048, 5, 'review-1.json'),
  );
  assert.equal(p.problem, undefined);
  assert.equal(p.pages, 2);
  assert.deepEqual(copies(p), [
    ['page-1-recognition.json', 'page-1-recognition.json'],
    ['page-1-recognized.musicxml', 'page-1-recognized.musicxml'],
    ['page-1.jpg', 'page-1.jpg'],
    ['page-2-recognized.musicxml', 'page-2-recognized.musicxml'],
    ['page-2.jpg', 'page-2.jpg'],
    ['review-1.json', 'review-1.json'],
  ]);
});

test('Retry failed pages: the page sent again keeps its place in the scan', () => {
  // Page 2 of 3 failed (a photo, no recognition) and arrived again as the fourth page.
  const p = plan(
    line(100, 1, 'page-1.jpg'),
    line(1, 2, 'page-1-recognized.musicxml'),
    line(200, 3, 'page-2.jpg'),
    line(300, 4, 'page-3.jpg'),
    line(3, 5, 'page-3-recognized.musicxml'),
    line(200, 6, 'page-4.jpg'),
    line(4, 7, 'page-4-recognized.musicxml'),
    line(40, 7, 'page-4-recognition.json'),
    line(9, 8, 'review-1.json'),
  );
  assert.equal(p.problem, undefined);
  assert.equal(p.pages, 3);
  assert.deepEqual(copies(p), [
    ['page-1-recognized.musicxml', 'page-1-recognized.musicxml'],
    ['page-1.jpg', 'page-1.jpg'],
    ['page-2-recognition.json', 'page-4-recognition.json'],
    ['page-2-recognized.musicxml', 'page-4-recognized.musicxml'],
    ['page-2.jpg', 'page-4.jpg'],
    ['page-3-recognized.musicxml', 'page-3-recognized.musicxml'],
    ['page-3.jpg', 'page-3.jpg'],
    ['review-1.json', 'review-1.json'],
  ]);
});

test('Scan again after the review: the same pages, their last recognitions', () => {
  const p = plan(
    line(100, 1, 'page-1.jpg'),
    line(1, 2, 'page-1-recognized.musicxml'),
    line(200, 3, 'page-2.jpg'),
    line(2, 4, 'page-2-recognized.musicxml'),
    line(9, 5, 'review-1.json'),
    line(100, 6, 'page-3.jpg'),
    line(3, 7, 'page-3-recognized.musicxml'),
    line(200, 8, 'page-4.jpg'),
    line(4, 9, 'page-4-recognized.musicxml'),
    line(9, 10, 'review-2.json'),
  );
  assert.equal(p.problem, undefined);
  assert.equal(p.pages, 2);
  assert.deepEqual(
    copies(p).filter(([name]) => name.startsWith('page-')),
    [
      ['page-1-recognized.musicxml', 'page-3-recognized.musicxml'],
      ['page-1.jpg', 'page-3.jpg'],
      ['page-2-recognized.musicxml', 'page-4-recognized.musicxml'],
      ['page-2.jpg', 'page-4.jpg'],
    ],
  );
});

test('a new photo after the review is not made a case: which page it replaced is not known', () => {
  const p = plan(
    line(100, 1, 'page-1.jpg'),
    line(1, 2, 'page-1-recognized.musicxml'),
    line(200, 3, 'page-2.jpg'),
    line(2, 4, 'page-2-recognized.musicxml'),
    line(9, 5, 'review-1.json'),
    line(250, 6, 'page-3.jpg'),
    line(3, 7, 'page-3-recognized.musicxml'),
  );
  assert.match(p.problem, /photo 3 is new since the review/);
  assert.deepEqual(p.files, []);
});

test('a page whose last attempt has no recognition is not made a case', () => {
  const p = plan(
    line(100, 1, 'page-1.jpg'),
    line(1, 2, 'page-1-recognized.musicxml'),
    line(200, 3, 'page-2.jpg'),
  );
  assert.equal(p.problem, 'page 2 has no recognition');
  assert.deepEqual(p.files, []);
});

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccccccccccccccccccc';

/** A listing line in a visit folder of the kept scan. */
const visitLine = (visit, size, minute, name) => line(size, minute, `${visit}/${name}`);

test("a scan's visits are one case, its reviews numbered again across them", () => {
  const cases = groupCases(
    parseListing(
      [
        visitLine(1761685200000, 100, 1, 'page-1.jpg'),
        visitLine(1761685200000, 10, 2, 'page-1-recognized.musicxml'),
        visitLine(1761685200000, 5, 3, 'review-1.json'),
        visitLine(1761692400000, 5, 59, 'review-1.json'),
      ].join('\n'),
    ),
  );
  assert.deepEqual([...cases.keys()], [`2026-10-28/${ID}`]);
  const p = planCase(cases.get(`2026-10-28/${ID}`));
  assert.equal(p.pages, 1);
  assert.deepEqual(
    p.files.filter((f) => f.name.startsWith('review')).map((f) => [f.name, f.url.split('/').at(-2)]),
    [
      ['review-1.json', '1761685200000'],
      ['review-2.json', '1761692400000'],
    ],
  );
});

test("the review's pages place each kept photo by its id: a retake, a move and a removal", () => {
  const texts = new Map();
  const at = (visit, name) => `${AT}/${visit}/${name}`;
  const v1 = 1761685200000;
  const v2 = 1761692400000;
  texts.set(at(v1, 'page-1-id.json'), JSON.stringify({ page: A }));
  texts.set(at(v1, 'page-2-id.json'), JSON.stringify({ page: B }));
  texts.set(at(v1, 'page-3-id.json'), JSON.stringify({ page: C }));
  // Page B photographed again, a day's visit later, at the same size as page A.
  texts.set(at(v2, 'page-1-id.json'), JSON.stringify({ page: B }));
  // The latest review: B before A, C removed.
  texts.set(at(v2, 'review-1.json'), JSON.stringify({ pages: [B, A] }));
  const objects = groupCases(
    parseListing(
      [
        visitLine(v1, 100, 1, 'page-1.jpg'),
        visitLine(v1, 10, 1, 'page-1-recognized.musicxml'),
        visitLine(v1, 1, 1, 'page-1-id.json'),
        visitLine(v1, 200, 2, 'page-2.jpg'),
        visitLine(v1, 20, 2, 'page-2-recognized.musicxml'),
        visitLine(v1, 1, 2, 'page-2-id.json'),
        visitLine(v1, 300, 3, 'page-3.png'),
        visitLine(v1, 30, 3, 'page-3-recognized.musicxml'),
        visitLine(v1, 1, 3, 'page-3-id.json'),
        visitLine(v1, 5, 4, 'review-1.json'),
        visitLine(v2, 100, 50, 'page-1.jpg'),
        visitLine(v2, 11, 51, 'page-1-recognized.musicxml'),
        visitLine(v2, 1, 50, 'page-1-id.json'),
        visitLine(v2, 5, 52, 'review-1.json'),
      ].join('\n'),
    ),
  ).get(`2026-10-28/${ID}`);
  const p = planCase(objects, (url) => texts.get(url));
  assert.equal(p.problem, undefined);
  assert.equal(p.pages, 2);
  const from = (name) => {
    const url = p.files.find((f) => f.name === name)?.url ?? '';
    return url.split('/').slice(-2).join('/');
  };
  assert.equal(from('page-1.jpg'), `${v2}/page-1.jpg`);
  assert.equal(from('page-1-recognized.musicxml'), `${v2}/page-1-recognized.musicxml`);
  assert.equal(from('page-2.jpg'), `${v1}/page-1.jpg`);
  assert.equal(p.files.some((f) => f.name.startsWith('page-3')), false);
});

test('a page the review lists that was never kept is named', () => {
  const texts = new Map([
    [`${AT}/page-1-id.json`, JSON.stringify({ page: A })],
    [`${AT}/review-1.json`, JSON.stringify({ pages: [A, B] })],
  ]);
  const objects = groupCases(
    parseListing(
      [
        line(100, 1, 'page-1.jpg'),
        line(10, 2, 'page-1-recognized.musicxml'),
        line(1, 2, 'page-1-id.json'),
        line(5, 3, 'review-1.json'),
      ].join('\n'),
    ),
  ).get(`2026-10-28/${ID}`);
  const p = planCase(objects, (url) => texts.get(url));
  assert.equal(p.problem, 'page 2 was not kept');
});
