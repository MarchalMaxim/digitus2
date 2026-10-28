import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { HEALTH, mockService } from './helpers/scan.js';

// Issue 230: the owner's three phone photos of Boëllmann's Improvisation Op. 28 No. 1, as the
// scanner read them (apps/web/fixtures/scan/boellmann-op28-no1-page-*.musicxml). Page 1 carries a
// first-ending bracket that is not on the page, the only repeat mark of the scan, which used to
// make the join refuse the whole score. Page 2 was read as a piano part of 17 bars plus a second
// instrument of 19 bars (the lower staff of some systems not grouped with its system), which no
// join can fit to the other pages: the review must say so, name the page, and offer the photo.
const fixture = (n: number) =>
  readFileSync(
    new URL(`../fixtures/scan/boellmann-op28-no1-page-${n}.musicxml`, import.meta.url),
    'utf8',
  );
/** What the scanner said about each page, as it said it: the disclaimers go, the rest is translated. */
const WARNINGS = [
  {
    code: 'recognition-experimental',
    message:
      'Photo recognition is experimental. Compare the recognized notes with the source before using fingerings.',
  },
  {
    code: 'recognition-meter-unverified',
    message:
      'Missing key or time signatures may be inferred. Confirm them against the complete score.',
  },
  {
    code: 'recognition-export-normalized',
    message:
      'The worker adjusted the export without changing any note: 4 slurs joining one pitch to its continuation were read as ties.',
  },
];

async function scanPages(page: Page, answers: readonly string[]) {
  let calls = 0;
  await mockService(page, '', {
    onRecognize: async () => ({
      json: {
        state: 'ready',
        ...HEALTH,
        warnings: WARNINGS,
        xml: answers[Math.min(calls++, answers.length - 1)]!,
      },
    }),
  });
  await page.goto('/');
  // Blank pages the size of the owner's photos, so the places to check can show their crops.
  const blank = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white';
    context.fillRect(0, 0, 1200, 1600);
    return canvas.toDataURL('image/png');
  });
  const photos = answers.map((_, index) => ({
    name: `photo 10.00.0${index + 1}.png`,
    mimeType: 'image/png',
    // Each page has its own bytes: a trailing comment the decoder ignores.
    buffer: Buffer.concat([
      Buffer.from(blank.split(',')[1]!, 'base64'),
      Buffer.from(`page ${index + 1}`),
    ]),
  }));
  await page.locator('input[type=file]').first().setInputFiles(photos);
  await expect(page.locator('.scan-page-list li')).toHaveCount(answers.length);
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible({
    timeout: 30_000,
  });
}

test('scan: a stray first-ending bracket is a place to check with its removal, not a refusal', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await scanPages(page, [fixture(1), fixture(3)]);
  // The pages join; the verdict counts them.
  await expect(page.locator('.scan-verdict')).toContainText('2 pages');
  await expect(page.locator('.scan-verdict')).toContainText('both hands');
  const problems = page.locator('details.scan-problems');
  await expect(problems).toBeVisible();
  if ((await problems.getAttribute('open')) === null) await problems.locator('summary').click();
  const entry = problems.locator('li', {
    hasText: 'Bar 2: a repeat ending was read here, but the score has no repeat sign.',
  });
  await expect(entry).toHaveCount(1);
  // The bar is shown on the photo beside the entry.
  await expect(entry.locator('.note-crop-small')).toBeVisible();
  const before = await problems.locator('li').count();
  await page.screenshot({ path: testInfo.outputPath('bracket-listed.png'), fullPage: true });

  await entry.getByRole('button', { name: 'Remove the repeat ending' }).click();
  await expect(
    page.locator('details.scan-problems li', { hasText: 'a repeat ending was read here' }),
  ).toHaveCount(0);
  if (before > 1) await expect(problems.locator('li')).toHaveCount(before - 1);
  else await expect(page.locator('details.scan-problems')).toHaveCount(0);
  await expect(page.getByText('Bar 2: repeat marks removed').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('bracket-removed.png'), fullPage: true });

  // Undo brings the bracket back, and with it the entry.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(
    page.locator('details.scan-problems li', { hasText: 'a repeat ending was read here' }),
  ).toHaveCount(1);

  // Recognition details: the scanner's export note in the reader's words, no disclaimer.
  await page.getByText('Recognition details').click();
  await expect(
    page.getByText('4 slurs between a note and its repetition were read as ties.'),
  ).toBeVisible();
  await expect(page.getByText('Photo recognition is experimental', { exact: false })).toHaveCount(
    0,
  );
  await expect(page.getByText('The worker adjusted the export', { exact: false })).toHaveCount(0);
});

test('scan: a page read as two instruments is named on the verdict line, with its photo to take again', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await scanPages(page, [fixture(1), fixture(2), fixture(3)]);
  await expect(page.locator('.scan-verdict')).toHaveText(
    'Page 2 could not be combined with the other pages: it was read as 2 parts with 17 and 19 bars. Photograph it again, flat and with the whole page in view.',
  );
  // The action is on that page, and carries the red.
  const retake = page.getByRole('button', { name: 'Replace page 2 with a new photo' });
  await expect(retake).toBeVisible();
  await expect(retake).toHaveClass('is-red');
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeDisabled();
  await page.getByText('Recognition details').click();
  await expect(
    page.getByText(
      'Technical reason: Page 2 cannot be combined with the other pages: it was read as 2 parts with 17 and 19 bars.',
    ),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('page-named.png'), fullPage: true });
});
