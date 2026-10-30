import { describe, expect, it } from 'vitest';
import {
  barAt,
  CEILING,
  EASED,
  expectedBatchMs,
  expectedMs,
  pdfPageCount,
  EXPECTED_PDF_SECONDS,
  EXPECTED_PHOTO_SECONDS,
  progressAt,
  secondsLeft,
  WARMUP_SECONDS,
} from './progress.js';

const photo = { file: new File([''], 'a.jpg', { type: 'image/jpeg' }) };
const pdf = { file: new File([''], 'a.pdf', { type: 'application/pdf' }) };

describe('the scan bar', () => {
  const expected = 35_000;
  it('starts empty and eases to about 90 percent over the expected time', () => {
    expect(progressAt(0, expected)).toBe(0);
    expect(progressAt(-500, expected)).toBe(0);
    expect(progressAt(expected, expected)).toBeCloseTo(EASED);
    // Ease-out: the first half covers three quarters of the way.
    expect(progressAt(expected / 2, expected)).toBeCloseTo(EASED * 0.75);
  });
  it('only ever moves forward', () => {
    let last = 0;
    for (let ms = 0; ms <= expected * 6; ms += 250) {
      const value = progressAt(ms, expected);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });
  it('creeps on past the expected time and never fills before the answer', () => {
    expect(progressAt(expected * 1.5, expected)).toBeGreaterThan(EASED);
    // Ten times the expected photo time is past the client's 200 s ceiling.
    expect(progressAt(expected * 10, expected)).toBeLessThan(CEILING);
    expect(CEILING).toBeLessThan(1);
    for (const ms of [0, 1_000, expected, expected * 3, expected * 100])
      expect(progressAt(ms, expected)).toBeLessThan(1);
  });
  it('says the seconds left in steps of five, and nothing once the expected time is past', () => {
    expect(secondsLeft(0, expected)).toBe(35);
    expect(secondsLeft(1_000, expected)).toBe(35);
    expect(secondsLeft(5_000, expected)).toBe(30);
    expect(secondsLeft(5_001, expected)).toBe(30);
    expect(secondsLeft(33_000, expected)).toBe(5);
    expect(secondsLeft(expected, expected)).toBeNull();
    expect(secondsLeft(-2_000, expected)).toBe(35);
  });
});

describe('the bar across a batch', () => {
  it('starts each page where the last one left it and never fills before the last answer', () => {
    // Three photos: a 105 s stretch, then, a page later, a 70 s one from where the bar stood.
    const first = { since: 0, expected: 105_000, own: 35_000, base: 0 };
    const atPageTwo = barAt(first, 40_000);
    const second = { since: 40_000, expected: 70_000, own: 70_000, base: atPageTwo };
    // The new stretch begins exactly where the old one was: the bar does not jump or move back.
    expect(barAt(second, 40_000)).toBeCloseTo(atPageTwo);
    let last = 0;
    for (let ms = 0; ms <= 600_000; ms += 500) {
      const value = barAt(second, 40_000 + ms);
      expect(value).toBeGreaterThanOrEqual(last);
      expect(value).toBeLessThan(1);
      last = value;
    }
    // Slow pages do not pin the bar: it stays below the ceiling of every stretch.
    expect(barAt(first, 100 * 105_000)).toBeLessThan(1);
  });
  it('leaves room for the pages after one that runs far past its own time', () => {
    // Three photos; the first takes 120 s and the second 70 s, each past its own 35 s.
    const one = { since: 0, expected: 105_000, own: 35_000, base: 0 };
    const afterOne = barAt(one, 120_000);
    const two = { since: 120_000, expected: 70_000, own: 35_000, base: afterOne };
    expect(barAt(two, 120_000)).toBeCloseTo(afterOne);
    const afterTwo = barAt(two, 190_000);
    expect(afterOne).toBeGreaterThan(barAt(one, 35_000));
    expect(afterTwo).toBeGreaterThan(afterOne);
    expect(afterTwo).toBeLessThan(0.95);
    // The last page then starts well below the full bar and fills it only slowly.
    const three = { since: 190_000, expected: 35_000, own: 35_000, base: afterTwo };
    expect(barAt(three, 190_000)).toBeCloseTo(afterTwo);
    expect(barAt(three, 190_000)).toBeLessThan(0.95);
    expect(barAt(three, 190_000 + 1_000_000)).toBeLessThan(1);
  });
  it('stays below 0.99 after a stretch overdue by three times followed by a fresh one', () => {
    const overdue = { since: 0, expected: 105_000, own: 35_000, base: 0 };
    const base = barAt(overdue, 3 * 105_000);
    expect(base).toBeLessThan(0.75);
    const fresh = { since: 0, expected: 70_000, own: 35_000, base };
    for (let ms = 0; ms <= 1_000_000; ms += 5_000) expect(barAt(fresh, ms)).toBeLessThan(0.99);
  });
  it('is not slowed down while a page takes its usual time', () => {
    const stretch = { since: 0, expected: 105_000, own: 35_000, base: 0 };
    for (let ms = 0; ms <= 35_000; ms += 5_000)
      expect(barAt(stretch, ms)).toBeCloseTo(progressAt(ms, 105_000));
  });
});

describe('the time a scan is expected to take', () => {
  it('is the deployed service’s warm figure by kind: a photo 35 s, a PDF page 30 s', () => {
    expect(EXPECTED_PHOTO_SECONDS).toBe(35);
    expect(EXPECTED_PDF_SECONDS).toBe(30);
    expect(expectedMs(photo)).toBe(35_000);
    expect(expectedMs({ file: new File([''], 'a.png', { type: 'image/png' }) })).toBe(35_000);
    expect(expectedMs(pdf)).toBe(30_000);
  });
  it('errs long on a PDF page: the slowest page rate times the spread of the PDF runs', () => {
    // docs/scan-service.md (Timings): the two-page PDF in the service log took 24.8 s a page, and
    // the one-page PDF's 90th percentile (19.6 s) is 1.11 times its median (17.7 s).
    const margin = 19.6 / 17.7;
    expect(EXPECTED_PDF_SECONDS).toBeGreaterThanOrEqual(24.8 * margin);
    expect(expectedMs({ ...pdf, pdfPages: 2 })).toBeGreaterThanOrEqual(49_500 * margin);
    expect(secondsLeft(0, expectedBatchMs([{ ...pdf, pdfPages: 2 }], false))).toBe(60);
    // Amazing Grace's single page needs 19.6 s at the 90th percentile.
    expect(expectedMs(pdf)).toBeGreaterThanOrEqual(19_600);
  });
  it('charges a PDF 30 s for each of its pages, because one request reads them all', () => {
    expect(expectedMs({ ...pdf, pdfPages: 6 })).toBe(180_000);
    expect(expectedMs({ ...pdf, pdfPages: 0 })).toBe(30_000);
    expect(expectedMs({ ...photo, pdfPages: 6 })).toBe(35_000);
    expect(expectedBatchMs([{ ...pdf, pdfPages: 3 }, photo], false)).toBe(125_000);
    expect(secondsLeft(0, expectedBatchMs([{ ...pdf, pdfPages: 6 }], false))).toBe(180);
  });
  it('counts the pages of a PDF from its page objects, and says one when it cannot see them', async () => {
    const bytes = (text: string) => new Blob([text]);
    const three =
      '<< /Type /Pages /Count 3 >> << /Type /Page >> << /Type/Page >> << /Type /Page /Parent 1 0 R >>';
    expect(await pdfPageCount(bytes(three))).toBe(3);
    expect(await pdfPageCount(bytes('%PDF-1.5 stream'))).toBe(1);
    expect(await pdfPageCount(bytes(''))).toBe(1);
  });
  it('adds up the pages still to scan, and six seconds while the warm-up has not answered', () => {
    expect(expectedBatchMs([], false)).toBe(0);
    expect(expectedBatchMs([photo, photo], false)).toBe(70_000);
    expect(expectedBatchMs([pdf], false)).toBe(30_000);
    expect(expectedBatchMs([photo], true)).toBe((35 + WARMUP_SECONDS) * 1000);
    expect(WARMUP_SECONDS).toBe(6);
    // The slowest start in the service log took 6.3 s, the 90th percentile 5.4 s.
    expect(WARMUP_SECONDS * 1000).toBeGreaterThanOrEqual(5_400);
    // The line under the bar reads "About 70 seconds" for two photos, and 45 for one while warming up (35 + 6 s, rounded up).
    expect(secondsLeft(0, expectedBatchMs([photo, photo], false))).toBe(70);
    expect(secondsLeft(0, expectedBatchMs([photo], true))).toBe(45);
  });
});
