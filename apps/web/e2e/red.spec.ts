import { test } from '@playwright/test';
import { expectOneRed } from './helpers/red.js';

test('the start page has exactly one red element', async ({ page }) => {
  await page.goto('/');
  await expectOneRed(page);
});
