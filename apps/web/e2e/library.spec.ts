import { expect, test } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { expectOneRed } from './helpers/red.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __lcp: number }).__lcp = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        (window as unknown as { __lcp: number }).__lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
});

test('library: 30 pieces, one red element, no serious a11y issues, LCP under 2 s', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(30);
  await expectOneRed(page, 'library');
  await expectNoSeriousA11y(page, 'library');
  const lcp = await page.evaluate(() => (window as unknown as { __lcp: number }).__lcp);
  expect(lcp, `LCP ${lcp} ms`).toBeLessThan(2000);
});

test('library: a refused MIDI drop shows a notice and keeps one red element', async ({ page }) => {
  await page.goto('/');
  // The drop zone sits at the bottom of a long page; the notice must still land on screen there.
  await page.getByTestId('drop-zone').scrollIntoViewIfNeeded();
  await page
    .getByLabel('choose a file')
    .setInputFiles({ name: 'x.mid', mimeType: 'audio/midi', buffer: Buffer.from('MThd') });
  await expect(page.getByRole('status')).toBeInViewport();
  await expect(
    page.getByText('MIDI import arrives in a later version. MusicXML files work today.'),
  ).toBeVisible();
  await expectOneRed(page, 'library with notice');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByText(/MIDI import arrives/)).toHaveCount(0);
});

test('library: the layout has no horizontal overflow', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
