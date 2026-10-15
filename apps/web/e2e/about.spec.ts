import { expect, test } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { LIBRARY_COUNT, LICENSE_COUNTS } from './helpers/library.js';
import { expectOneRed } from './helpers/red.js';

test('about: attributions, one red element, no serious a11y issues, back works', async ({
  page,
}) => {
  await page.goto('/#/about');
  await expect(page.getByRole('heading', { level: 1, name: 'About digitus2' })).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(LIBRARY_COUNT + 1);
  // He engraved the CC BY-SA Schumann pieces, so the name is in several rows.
  await expect(page.getByText('Philippe Hézaine').first()).toBeVisible();
  await expectOneRed(page, 'about');
  await expectNoSeriousA11y(page, 'about');
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await expect(page).toHaveURL(/#\/$/);
});

// Polish plan Task 5: the finger numbers are explained on the library and the score view; the
// about page keeps its text as it was.
test('about: keeps its text', async ({ page }) => {
  await page.goto('/#/about');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'What this is',
    'How the fingerings are chosen',
    'Who made it',
    'Licences',
    'The built-in pieces',
  ]);
  await expect(
    page.getByText(
      'digitus2 writes finger numbers on piano music for beginning and intermediate players. Everything runs in your browser; nothing you open leaves your computer.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /^The engine scores every possible fingering with ergonomic rules from the piano-fingering literature \(finger spans, thumb crossings, weak fingers, black keys, hand position changes\) and picks the cheapest one for the whole piece with an exact search\. Your hand size changes the spans it allows\. The engine version is \S+\.$/,
    ),
  ).toBeVisible();
  // The credit sentence counts the CC BY-SA and CC BY engravings of the manifest (the unit test
  // pins the exact number words); the form with CC BY appears once the library has such a piece.
  const credit =
    LICENSE_COUNTS.attributionOnly > 0
      ? /^The pieces use public-domain or Creative Commons editions\. \S+ engravings are shared under CC BY-SA and \S+ under CC BY; all are credited here and on their score pages\.$/
      : /^The pieces use public-domain or Creative Commons editions\. \S+ engravings are shared under CC BY-SA and are credited here and on their score pages\.$/;
  await expect(page.getByText(credit)).toBeVisible();
  await expectOneRed(page, 'about');
  await expectNoSeriousA11y(page, 'about');
});
