import { test } from '@playwright/test';
import { libraryReady } from './helpers/library.js';
import { expectOneRed } from './helpers/red.js';

test('the start page has exactly one red element', async ({ page }) => {
  await page.goto('/');
  // the page renders once the library list has loaded (main.tsx)
  await libraryReady(page);
  await expectOneRed(page);
});
