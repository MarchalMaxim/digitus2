import { expect, test } from '@playwright/test';

// The easter egg (NoteBurst.tsx, motion study 10): a click on nothing in particular lets a few
// notes rise at their full size (T18: the global `svg { max-width: 100% }` rule once squeezed
// them to 6 px wide), and a drag across the page, as when selecting text, adds none.
test('a click on nothing lets full-size notes rise; a drag adds none', async ({ page }) => {
  await page.goto('/#/piece/twinkle-twinkle-little-star');
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  const title = await page.getByRole('heading', { level: 1 }).boundingBox();
  expect(title).not.toBeNull();
  // Blank space to the right of the title.
  const x = title!.x + title!.width + 120;
  const y = title!.y + title!.height / 2;

  await page.mouse.click(x, y);
  const notes = page.locator('.note-burst-note svg');
  await expect(notes.first()).toBeAttached();
  const size = await notes.first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return [cs.width, cs.height];
  });
  expect(size).toEqual(['25px', '28px']);
  const bursts = await page.locator('.note-burst').count();
  expect(bursts).toBe(1);

  await page.mouse.move(x - 100, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect(await page.locator('.note-burst').count()).toBe(1);
});
