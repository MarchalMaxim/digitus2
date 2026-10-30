import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { libraryReady } from './helpers/library.js';
import { expectOneRed, recordRedFrames, redFrames, waitForRedFrames } from './helpers/red.js';
import { mockService } from './helpers/scan.js';

test('the start page has exactly one red element', async ({ page }) => {
  await page.goto('/');
  // the page renders once the library list has loaded (main.tsx)
  await libraryReady(page);
  await expectOneRed(page);
});

test('while a score loads, the loader is the one red and Play is plain; then Play takes it', async ({
  page,
}) => {
  // Hold the score's file back, so the view stays on "Loading the score…".
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/scores/twinkle-twinkle-little-star.musicxml*', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/#/piece/twinkle-twinkle-little-star');
  await expect(page.getByRole('status')).toHaveText('Loading the score…');
  await expect(page.locator('.score-loader svg.loader.is-scale')).toBeVisible();
  const roots = await expectOneRed(page, 'loading');
  expect(roots[0]!.className).toContain('loader-red');
  await expect(page.getByRole('button', { name: 'Play' })).not.toHaveClass(/is-red/);

  release();
  await expect(page.locator('.score-sheet g.fing').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.score-loader')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/is-red/);
  await expectOneRed(page, 'ready');
});

const TWINKLE_PAGE = fileURLToPath(new URL('../fixtures/twinkle-page.png', import.meta.url));
const TWINKLE_XML = fileURLToPath(
  new URL('../../../content/scores/twinkle-twinkle-little-star.musicxml', import.meta.url),
);

/** The scan page with the Twinkle page chosen, before Scan this score is pressed. */
async function openScanPage(page: Page): Promise<void> {
  await page.goto('/');
  await libraryReady(page);
  await page.getByLabel('Open your own score').setInputFiles(TWINKLE_PAGE);
  await expect(page.getByRole('heading', { name: 'From paper to piano' })).toBeVisible();
  await expect(page.locator('.scan-original-image')).toHaveJSProperty('complete', true);
}

// The mobile project does not run this file, so the phone is set here.
const SETUPS = [
  { name: 'PC', viewport: { width: 1280, height: 900 }, phone: false },
  { name: 'phone', viewport: { width: 360, height: 740 }, phone: true },
] as const;
for (const setup of SETUPS)
  for (const colorScheme of ['light', 'dark'] as const)
    test.describe(`scanning, ${setup.name}, ${colorScheme}`, () => {
      test.use({
        viewport: setup.viewport,
        isMobile: setup.phone,
        hasTouch: setup.phone,
        colorScheme,
      });

      test('the loader is the one red from the click on, never two for a moment', async ({
        page,
      }) => {
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        await mockService(page, readFileSync(TWINKLE_XML, 'utf8'), {
          onRecognize: async () => {
            await held;
          },
        });
        await openScanPage(page);
        // Nothing is fading any more when the recording starts.
        await page.waitForTimeout(500);
        const scan = page.getByRole('button', { name: 'Scan this score' });
        await expect(scan).toHaveClass(/is-red/);
        // Frames before the click show Scan this score, the red then; only those from it on count.
        await recordRedFrames(page, { reddish: true });
        await scan.click();
        await expect(page.locator('.scan-loader svg.loader.is-scale')).toBeVisible();
        // Counted in frames, not in time: a loaded machine draws few of them a second.
        await waitForRedFrames(page, { frames: 11, late: 3, afterMs: 300 });
        const frames = (await redFrames(page)).filter((f) => f.sinceClick !== null);

        expect(frames.length).toBeGreaterThan(10);
        // A button that is reddish (fading out of Scan this score, or Cancel scan) is a second red.
        const bad = frames.filter((f) => f.roots > 1 || f.found.some((r) => r.tag === 'button'));
        expect(bad.slice(0, 3), `${bad.length} frames with two reds or a red button`).toEqual([]);
        const late = frames.filter((f) => f.sinceClick! > 300);
        expect(late.length).toBeGreaterThan(0);
        for (const f of late) {
          expect(f.found).toHaveLength(1);
          expect(f.found[0]!.className).toContain('loader-red');
        }

        // The steady state.
        const roots = await expectOneRed(page, 'scanning');
        expect(roots[0]!.className).toContain('loader-red');
        await expect(page.getByRole('button', { name: 'Cancel scan' })).not.toHaveClass(/is-red/);

        release();
        await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible();
      });
    });

test('after Cancel scan the focus is on Scan this score, which returns in its place', async ({
  page,
}) => {
  // The scanner holds the page until the cancel arrives, then answers it as cancelled.
  await mockService(page, '', {
    onRecognize: async () => {
      await page.waitForRequest((request) => request.method() === 'DELETE');
      return { status: 409, json: { state: 'cancelled' } };
    },
  });
  await openScanPage(page);
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await page.getByRole('button', { name: 'Cancel scan' }).click();
  const scan = page.getByRole('button', { name: 'Scan this score' });
  await expect(scan).toBeEnabled();
  await expect(scan).toBeFocused();
});
