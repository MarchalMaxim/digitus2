import { readdirSync, statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import { STATES } from './helpers/states.js';

// Screenshot baselines for every state except the two that change over time: playing (its
// screenshot changes every frame) and the count-in (its number changes every beat). The piano
// loading has one: the walk never answers the sample requests, so Play stays busy and the dock
// says "Loading the piano…" for as long as the page lives. Local only: the `visual` project is
// not defined under CI, because fonts and antialiasing differ between machines. Update after an
// intended change with
//   pnpm --filter @digitus2/web exec playwright test --project=visual --update-snapshots
// and review the new PNGs in apps/web/e2e/visual.spec.ts-snapshots/ before committing them.

/**
 * The solve and layout timings in the side panel differ on every run; take them out of the layout.
 * Hiding them in place would not do: in the 16rem panel "Fingered in NN ms · laid out in NNN ms"
 * wraps to two lines or fits on one depending on the digit counts, so the reader warnings below it
 * would move by a line with the machine's speed. They sit behind the panel's Details toggle, so
 * only a state that opens it (score-details) shows them.
 */
const HIDE_TIMINGS = '.side-panel .timings { display: none; }';

/** The states whose screenshot changes while it is taken. */
const PLAYBACK_STATES = new Set(['score-count-in', 'score-playing']);

/** The states with a baseline. */
const SCREENSHOT_STATES = STATES.filter((x) => !PLAYBACK_STATES.has(x.name));

/** The baselines are committed, so each stays under 300 KB (M4 plan Task 10, polish plan Task 7). */
const BASELINE_MAX_BYTES = 300 * 1024;

for (const s of SCREENSHOT_STATES) {
  test(`visual ${s.name}`, async ({ page }) => {
    await s.go(page);
    await page.addStyleTag({ content: HIDE_TIMINGS });
    await expect(page).toHaveScreenshot(`${s.name}.png`, {
      fullPage: true,
      animations: 'disabled',
    });
  });
}

// What is committed for this platform: one baseline per state screenshotted, none for a state
// that is gone, and each under 300 KB. A run that rewrites the baselines writes them while this
// test would read them, so it is skipped there; the next plain run checks what was written.
test('visual baselines: one per state, none left over, each under 300 KB', () => {
  const info = test.info();
  test.skip(
    info.config.updateSnapshots === 'all' || info.config.updateSnapshots === 'changed',
    'the baselines are being rewritten in this run',
  );
  const expected = SCREENSHOT_STATES.map((s) =>
    info.snapshotPath(`${s.name}.png`, { kind: 'screenshot' }),
  );
  const dir = dirname(expected[0]!);
  // `<state>-visual-win32.png` on Windows: the suffix after the state's name names the platform.
  const suffix = basename(expected[0]!).slice(SCREENSHOT_STATES[0]!.name.length);
  const committed = readdirSync(dir).filter((f) => f.endsWith(suffix));
  expect(committed.sort()).toEqual(expected.map((p) => basename(p)).sort());
  for (const path of expected)
    expect(statSync(path).size, `${basename(path)} in bytes`).toBeLessThan(BASELINE_MAX_BYTES);
});
