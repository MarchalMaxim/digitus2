import { expect, test } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { horizontalOverflow } from './helpers/overflow.js';
import { expectOneRed } from './helpers/red.js';
import { OPENING_STATES } from './helpers/states.js';

// The loader of a score on its way in (issues 240, 242): one red element (the loader), no serious
// a11y issue and no horizontal scroll, on the desktop and the 360 px project, in both schemes.
for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    for (const s of OPENING_STATES) {
      test(`state ${s.name} (${scheme}): one red element and no serious a11y issues`, async ({
        page,
      }) => {
        await s.go(page);
        const roots = await expectOneRed(page, s.name);
        expect(roots[0]!.className).toContain('loader-red');
        await expectNoSeriousA11y(page, s.name);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
        await expect(page.locator('.opening [role="status"]')).toHaveText('Loading the score…');
      });
    }
  });
}
