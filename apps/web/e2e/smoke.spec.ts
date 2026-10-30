import { expect, test } from '@playwright/test';

test('the page loads with the wordmark and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // The shared library's store is out of reach in every spec (playwright.config.ts), so the
    // shelf's request fails by design, whenever the browser reports it.
    if (m.location().url.startsWith('https://firestore.googleapis.com/')) return;
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page).toHaveTitle(/digitus2/);
  await expect(page.getByRole('heading', { level: 1, name: 'digitus2' })).toBeVisible();
  expect(errors).toEqual([]);
});
