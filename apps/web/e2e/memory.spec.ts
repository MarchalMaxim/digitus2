import { expect, test, type Page } from '@playwright/test';

// docs/research/ram-usage.md: reading and writing a long piece's MusicXML leaves some 40 bytes of
// garbage in the engine worker per byte of text, which V8 collects only some 20 s after the worker
// goes idle (about 200 MB on Beethoven's Ninth). The engine client releases its worker once it has
// idled after a piece of 2,000 notes or more (`HEAVY_NOTES`), and the next call starts a fresh one.
// The layout worker stays: its heap did not grow on a piece this size.
const LONG = 'bulk-beethovenlv-o79-lvb-sonate-79-1-lvb-sonate-79-1-ly'; // 2,075 notes

const workers = (page: Page, name: string) =>
  page.workers().filter((w) => new URL(w.url()).pathname.includes(`${name}.worker`)).length;

test('the engine worker is released after a long piece, and a hand size change still re-fingers', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?audio=silent#/piece/${LONG}`);
  const digits = page.locator('.score-sheet g.fing');
  await expect(digits.first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => workers(page, 'engine'), { timeout: 10_000 }).toBe(0);
  expect(workers(page, 'verovio')).toBe(1);

  const before = (await digits.allTextContents()).join();
  await page.getByLabel('Hand size').selectOption('child');
  await expect
    .poll(async () => (await digits.allTextContents()).join(), { timeout: 20_000 })
    .not.toBe(before);
  expect(errors).toEqual([]);
});
