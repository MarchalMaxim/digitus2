import { readdirSync, statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openPractice } from './helpers/practice.js';
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

/**
 * The baselines are committed, so each stays under 900 KB (M4 plan Task 10, polish plan Task 7:
 * 300 KB with 30 pieces; the full-page library baseline grew to about 500 KB with L1's 149 rows).
 */
const BASELINE_MAX_BYTES = 900 * 1024;

/**
 * The main states again with the system in dark (T7): the library, the score ready and paused,
 * and the about page. Every state's one red and contrast are checked in the dark by states.spec.ts.
 */
const DARK_STATE_NAMES = new Set(['library', 'score-ready', 'score-paused', 'about']);
const DARK_STATES = SCREENSHOT_STATES.filter((x) => DARK_STATE_NAMES.has(x.name));

for (const [s, dark] of [
  ...SCREENSHOT_STATES.map((x) => [x, false] as const),
  ...DARK_STATES.map((x) => [x, true] as const),
]) {
  const name = dark ? `${s.name}-dark` : s.name;
  test(`visual ${name}`, async ({ page }) => {
    if (dark) await page.emulateMedia({ colorScheme: 'dark' });
    await s.go(page);
    await page.addStyleTag({ content: HIDE_TIMINGS });
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      animations: 'disabled',
    });
  });
}

/** Paused at a known score time with the tempo at 50 %, so the pause lands inside one onset group. */
async function pausedTwinkleAt(page: Page, sec: number): Promise<void> {
  await page.goto('/?audio=silent#/piece/twinkle-twinkle-little-star');
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  await openPractice(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  await page.getByRole('slider', { name: 'Tempo' }).fill('50');
  await page.locator('.dock .practice-toggle').click(); // closed again: only the keyboard is shot
  await page.getByRole('button', { name: 'Play' }).click();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as unknown as { __digitus2: { positionSec(): number } }).__digitus2.positionSec(),
        ),
      { timeout: 30_000, intervals: [50] },
    )
    .toBeGreaterThan(sec);
  await page.getByRole('button', { name: 'Pause' }).click();
}

/**
 * Two crops of the dock's keyboard, paused (T10) in Twinkle (T11): where the hands are an octave
 * apart the pressed keys carry their finger numbers alone; where they come within a fifth, every
 * pressed key also carries its L or R.
 */
const KEYBOARD_CROPS = [
  { name: 'keyboard-unlettered', sec: 1.25, dark: false }, // bar 1, the third note: hands an octave apart
  { name: 'keyboard-lettered', sec: 7.25, dark: false }, // bar 4, its first group: hands within a fifth
  // The same keys in the dark (T7): a real keyboard's colors, pressed keys and letters readable.
  { name: 'keyboard-lettered-dark', sec: 7.25, dark: true },
];

for (const crop of KEYBOARD_CROPS) {
  test(`visual ${crop.name}`, async ({ page }) => {
    if (crop.dark) await page.emulateMedia({ colorScheme: 'dark' });
    await pausedTwinkleAt(page, crop.sec);
    await expect(page.locator('.dock .keyboard')).toHaveScreenshot(`${crop.name}.png`, {
      animations: 'disabled',
    });
  });
}

// What is committed for this platform: one baseline per state screenshotted, none for a state
// that is gone, and each under 900 KB. A run that rewrites the baselines writes them while this
// test would read them, so it is skipped there; the next plain run checks what was written.
test('visual baselines: one per state, none left over, each under 900 KB', () => {
  const info = test.info();
  test.skip(
    info.config.updateSnapshots === 'all' || info.config.updateSnapshots === 'changed',
    'the baselines are being rewritten in this run',
  );
  const expected = [
    ...SCREENSHOT_STATES.map((s) => s.name),
    ...DARK_STATES.map((s) => `${s.name}-dark`),
    ...KEYBOARD_CROPS.map((c) => c.name),
  ].map((n) => info.snapshotPath(`${n}.png`, { kind: 'screenshot' }));
  const dir = dirname(expected[0]!);
  // `<state>-visual-win32.png` on Windows: the suffix after the state's name names the platform.
  const suffix = basename(expected[0]!).slice(SCREENSHOT_STATES[0]!.name.length);
  const committed = readdirSync(dir).filter((f) => f.endsWith(suffix));
  expect(committed.sort()).toEqual(expected.map((p) => basename(p)).sort());
  for (const path of expected)
    expect(statSync(path).size, `${basename(path)} in bytes`).toBeLessThan(BASELINE_MAX_BYTES);
});
