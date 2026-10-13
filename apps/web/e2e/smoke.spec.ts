import { expect, test } from '@playwright/test';

test('the page loads with the wordmark and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page).toHaveTitle(/digitus2/);
  await expect(page.getByRole('heading', { level: 1, name: 'digitus2' })).toBeVisible();
  expect(errors).toEqual([]);
});
