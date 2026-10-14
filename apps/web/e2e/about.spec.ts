import { expect, test } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { expectOneRed } from './helpers/red.js';

test('about: attributions, one red element, no serious a11y issues, back works', async ({
  page,
}) => {
  await page.goto('/#/about');
  await expect(page.getByRole('heading', { level: 1, name: 'About digitus2' })).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(31);
  // He engraved two of the CC BY-SA pieces, so the name is in two rows.
  await expect(page.getByText('Philippe Hézaine').first()).toBeVisible();
  await expectOneRed(page, 'about');
  await expectNoSeriousA11y(page, 'about');
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await expect(page).toHaveURL(/#\/$/);
});
