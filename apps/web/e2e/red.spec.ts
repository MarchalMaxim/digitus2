import { expect, test } from '@playwright/test';
import { libraryReady } from './helpers/library.js';
import { expectOneRed } from './helpers/red.js';

test('the start page has exactly one red element', async ({ page }) => {
  await page.goto('/');
  // the page renders once the library list has loaded (main.tsx)
  await libraryReady(page);
  await expectOneRed(page);
});

test('while a score loads, the loader is the one red and Play is plain; then Play takes it', async ({
  page,
}) => {
  // Hold the score's file back, so the view stays on "Loading the score…".
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/scores/twinkle-twinkle-little-star.musicxml*', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/#/piece/twinkle-twinkle-little-star');
  await expect(page.getByRole('status')).toHaveText('Loading the score…');
  await expect(page.locator('.score-loader svg.loader.is-scale')).toBeVisible();
  const roots = await expectOneRed(page, 'loading');
  expect(roots[0]!.className).toContain('loader-red');
  await expect(page.getByRole('button', { name: 'Play' })).not.toHaveClass(/is-red/);

  release();
  await expect(page.locator('.score-sheet g.fing').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.score-loader')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/is-red/);
  await expectOneRed(page, 'ready');
});
