import { expect, test } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { expectOneRed } from './helpers/red.js';
import { STATES } from './helpers/states.js';

// The design brief and accessibility in every application state (verification spec 3.9): one
// red element (or one playback cursor), zero serious or critical axe violations, and no
// horizontal page scroll. Runs on the desktop and the 360 px mobile project.
for (const s of STATES) {
  test(`state ${s.name}: one red element and no serious a11y issues`, async ({ page }) => {
    await s.go(page);
    const roots = await expectOneRed(page, s.name);
    if (s.expectTag === 'cursor') expect(roots.every((r) => r.inSheet)).toBe(true);
    else expect(roots[0]!.tag).toBe('button');
    await expectNoSeriousA11y(page, s.name);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${s.name} horizontal overflow`).toBeLessThanOrEqual(0);
  });
}
