import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { expectReviewGrandStaff, expectScoreGrandStaff } from './helpers/grandStaff.js';
import { inOrder, mockService, PNG, recordService } from './helpers/scan.js';

// The owner's phone drew a three-page scan with one staff per system (issue 156). These are the
// three pages as the recogniser returned them (apps/web/fixtures/scan): two of one piano part with
// two staves, and a short last page of two one-staff parts, a treble and a bass, which the join
// merges into the piano layout (issue 152). Joined, reviewed and fingered, they must draw a grand
// staff. The project's own viewport decides the device: a phone at 360 px, and a PC window.
const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/scan/${name}.musicxml`, import.meta.url), 'utf8');
const pages = [1, 2, 3].map((n) => fixture(`owner-page-${n}`));
/** The bars of a recognition's first part: all of them for a piano part, half for a split page. */
const bars = (xml: string) => (xml.split('<part id=')[1]!.match(/<measure /g) ?? []).length;

test('scan: three recognised pages draw a grand staff in the review and in the score view', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const calls = recordService(page);
  await mockService(page, inOrder(pages));
  await page.goto('/');
  // Named as the camera names its photos, in the order they were taken; each has its own bytes.
  const photos = ['10.00.01', '10.00.12', '10.00.23'].map((time, index) => ({
    name: `photo ${time}.png`,
    mimeType: 'image/png',
    buffer: Buffer.concat([PNG, Buffer.from(`page ${index + 1}`)]),
  }));
  await page.locator('input[type=file]').first().setInputFiles(photos);
  await expect(page.getByRole('heading', { name: 'From paper to piano' })).toBeVisible();
  await expect(page.locator('.scan-page-list li')).toHaveCount(3);
  // The camera renames the photos it takes (photo 10.00.01.png, or (2) in the same second), so the
  // first page's name is read from the list; the score's heading is that name as MusicXML.
  const label = await page
    .getByRole('button', { name: /^Select page 1: / })
    .getAttribute('aria-label');
  const first = label!.replace(/^Select page 1: /, '');
  expect(first).toMatch(/^photo .+\.png$/);

  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible({
    timeout: 30_000,
  });
  const review = await expectReviewGrandStaff(page);
  console.log(`review: ${JSON.stringify(review)}`);
  // Every bar of the three pages is there once, in two staves.
  expect(review.measures).toBe(pages.reduce((sum, xml) => sum + bars(xml), 0));
  expect(calls.filter((call) => call === 'POST /v1/recognize')).toHaveLength(3);
  await expect(page.locator('.scan-review g.fing')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('review.png'), fullPage: true });

  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  await page.getByRole('button', { name: 'Use for fingerings' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    first.replace(/\.[^.]+$/, '') + '.musicxml',
  );
  const score = await expectScoreGrandStaff(page);
  console.log(`score view: ${JSON.stringify(score)}`);
  expect(score.measures).toBe(review.measures);
  await page.screenshot({ path: testInfo.outputPath('score.png'), fullPage: true });
});
