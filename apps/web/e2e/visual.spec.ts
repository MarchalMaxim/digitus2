import { expect, test } from '@playwright/test';
import { STATES } from './helpers/states.js';

// Screenshot baselines for every state except playback (its screenshot changes every frame).
// Local only: the `visual` project is not defined under CI, because fonts and antialiasing
// differ between machines. Update after an intended change with
//   pnpm --filter @digitus2/web exec playwright test --project=visual --update-snapshots
// and review the new PNGs in apps/web/e2e/visual.spec.ts-snapshots/ before committing them.

/** The solve and layout timings in the side panel differ on every run; hide them (keeps layout). */
const HIDE_TIMINGS = '.side-panel p.small { visibility: hidden; }';

for (const s of STATES.filter((x) => x.name !== 'score-playing')) {
  test(`visual ${s.name}`, async ({ page }) => {
    await s.go(page);
    await page.addStyleTag({ content: HIDE_TIMINGS });
    await expect(page).toHaveScreenshot(`${s.name}.png`, {
      fullPage: true,
      animations: 'disabled',
    });
  });
}
