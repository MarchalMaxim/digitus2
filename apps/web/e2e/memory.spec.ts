import { expect, test, type Page } from '@playwright/test';

// docs/research/ram-usage.md. After a piece of 2,000 notes or more (`HEAVY_NOTES`) both workers
// go: the engine worker once it has idled for 2 s (reading and writing a long piece's MusicXML
// leaves some 40 bytes of garbage per byte of text in it), the layout worker (Verovio, 128 MB of
// WASM heap and its code) as soon as its layout is delivered. The next call or layout starts a
// fresh one, and the library warms the layout worker up again for the next piece, which keeps it.
const LONG = 'bulk-beethovenlv-o79-lvb-sonate-79-1-lvb-sonate-79-1-ly'; // 2,075 notes
const SHORT = 'twinkle-twinkle-little-star';

const workers = (page: Page, name: string) =>
  page.workers().filter((w) => new URL(w.url()).pathname.includes(`${name}.worker`)).length;

test('both workers go after a long piece, and come back for a new width, a hand size and the next piece', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?audio=silent#/piece/${LONG}`);
  const digits = page.locator('.score-sheet g.fing');
  const firstPage = page.locator('.score-sheet > svg').first();
  await expect(digits.first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => workers(page, 'verovio'), { timeout: 10_000 }).toBe(0);
  await expect.poll(() => workers(page, 'engine'), { timeout: 10_000 }).toBe(0);

  // A width in another bucket lays the piece out again, in a fresh layout worker that goes too.
  const wide = await firstPage.getAttribute('viewBox');
  await page.setViewportSize({ width: 900, height: 900 });
  await expect.poll(() => firstPage.getAttribute('viewBox'), { timeout: 20_000 }).not.toBe(wide);
  await expect.poll(() => workers(page, 'verovio'), { timeout: 10_000 }).toBe(0);

  // A hand size change fingers it again in a fresh engine worker.
  const before = (await digits.allTextContents()).join();
  await page.getByLabel('Hand size').selectOption('child');
  await expect
    .poll(async () => (await digits.allTextContents()).join(), { timeout: 20_000 })
    .not.toBe(before);

  // The library warms a layout worker up for the next piece, and a short piece keeps it.
  await page.evaluate(() => (location.hash = '#/'));
  await expect.poll(() => workers(page, 'verovio'), { timeout: 10_000 }).toBe(1);
  await page.evaluate((slug) => (location.hash = `#/piece/${slug}`), SHORT);
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  await page.waitForTimeout(500);
  expect(workers(page, 'verovio')).toBe(1);
  expect(errors).toEqual([]);
});
