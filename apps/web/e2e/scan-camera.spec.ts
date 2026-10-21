import { expect, test, type Page } from '@playwright/test';
import { scan } from '../src/i18n/en/scan.js';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { expectCameraStopped, installScoreCamera, moveScore } from './helpers/camera.js';
import { horizontalOverflow } from './helpers/overflow.js';
import { expectOneRed } from './helpers/red.js';
import { mockService, PNG } from './helpers/scan.js';

// The entry is intentionally touch-only. Exercise it at both the desktop and phone widths.
test.use({ isMobile: true, hasTouch: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Photograph your score' });

async function openCamera(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Take a photo', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Take the first photo' })).toBeEnabled();
}

async function beginPage(page: Page, score: number) {
  await moveScore(page, 0, 0, score);
  await dialog(page).getByRole('button', { name: 'Take the first photo' }).click();
  await dialog(page).getByRole('button', { name: scan.camera.useCorners }).click();
  await expect(dialog(page).getByText(/^View 1 of 4 /)).toBeVisible();
}

async function finishViews(page: Page) {
  // Translate the printed page itself to each real page-anchored target. These are 25/75%
  // of the default 5%-inset page, measured in the 360 x 480 camera source pixels.
  const translations = [
    [81, 108],
    [-81, 108],
    [-81, -108],
    [81, -108],
  ] as const;
  for (const [index, [x, y]] of translations.entries()) {
    await moveScore(page, x, y);
    if (index < 3)
      await expect(dialog(page).getByText(new RegExp(`^View ${index + 2} of 4 `))).toBeVisible({
        timeout: 15_000,
      });
  }
  await expect(dialog(page).getByText('Check your page', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

const xml = (step: string) =>
  `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note></measure></part></score-partwise>`;

test('camera: stationary video cannot complete a view; cancel releases its real track', async ({
  page,
}) => {
  await installScoreCamera(page);
  await mockService(page, xml('C'));
  await openCamera(page);
  await beginPage(page, 1);
  const initialFrames = await page.evaluate(() => window.scoreCamera.frames);
  // Wait for actual camera frames, not an application timer or mocked registration result.
  await expect
    .poll(() => page.evaluate((before) => window.scoreCamera.frames - before, initialFrames))
    .toBeGreaterThan(90);
  await expect(dialog(page).getByText(/^View 1 of 4 /)).toBeVisible();
  await expect(
    dialog(page).getByRole('button', { name: 'Take photo', exact: true }),
  ).toBeDisabled();
  await expect(dialog(page).getByText('Check your page', { exact: true })).toHaveCount(0);
  await expectOneRed(page, 'stationary guided camera');
  await expectNoSeriousA11y(page, 'stationary guided camera');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await dialog(page).getByRole('button', { name: 'Close camera', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectCameraStopped(page);
  await expect(page.getByRole('button', { name: 'Take a photo', exact: true })).toBeFocused();
  await expect(page.locator('.scan-page-list li')).toHaveCount(0);
});

test('camera: a frozen aligned video cannot count as a steady hold', async ({ page }) => {
  await installScoreCamera(page);
  await mockService(page, xml('C'));
  await openCamera(page);
  await beginPage(page, 1);
  await moveScore(page, 81, 108);
  const capture = dialog(page).getByRole('button', { name: 'Take photo', exact: true });
  await expect(capture).toBeEnabled({ timeout: 15_000 });
  await page.evaluate(() => window.scoreCamera.freeze(true));
  const stoppedAt = await page.evaluate(() => performance.now());
  await expect
    .poll(() => page.evaluate(() => performance.now()))
    .toBeGreaterThan(stoppedAt + 1_200);
  await expect(dialog(page).getByText(/^View 1 of 4 /)).toBeVisible();
  await expect(capture).toBeDisabled();
  await page.evaluate(() => window.scoreCamera.freeze(false));
  await expect(dialog(page).getByText(/^View 2 of 4 /)).toBeVisible({ timeout: 15_000 });
  await dialog(page).getByRole('button', { name: 'Close camera', exact: true }).click();
  await expectCameraStopped(page);
});
test('camera: denied permission explains the device-camera fallback and imports its photo', async ({
  page,
}) => {
  await installScoreCamera(page, 'denied');
  await mockService(page, xml('C'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Take a photo', exact: true }).click();
  await expect(dialog(page)).toContainText('Camera access is blocked.');
  await expectOneRed(page, 'denied camera');
  await expectNoSeriousA11y(page, 'denied camera');
  const choosing = page.waitForEvent('filechooser');
  await dialog(page).getByText('Use device camera', { exact: true }).click();
  await (await choosing).setFiles({ name: 'device.png', mimeType: 'image/png', buffer: PNG });
  await expect(
    dialog(page).getByRole('img', { name: 'Check your page', exact: true }),
  ).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Use 1 page', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'From paper to piano' })).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Original printed score', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.scoreCamera.created)).toBe(0);
});

test('camera: real tracked views, retake and two kept pages enter ordered recognition', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await installScoreCamera(page);
  const uploads: Buffer[] = [];
  await mockService(page, () => xml(uploads.length === 1 ? 'D' : 'C'), {
    onRecognize: async (request) => {
      uploads.push(request.postDataBuffer()!);
    },
  });
  await openCamera(page);
  await beginPage(page, 1);
  const target = dialog(page).locator('[data-camera-target="1"]');
  const initialX = Number(await target.getAttribute('cx'));
  await moveScore(page, 40, 30);
  // Vision must move the page-anchored dot in response to the pixels in the video.
  await expect
    .poll(async () => Number(await target.getAttribute('cx')) - initialX)
    .toBeGreaterThan(15);
  await expect(dialog(page).getByText(/^View 1 of 4 /)).toBeVisible();
  await finishViews(page);
  const previewRatio = await dialog(page)
    .locator('canvas.camera-still')
    .evaluate((canvas: HTMLCanvasElement) => {
      const bounds = canvas.getBoundingClientRect();
      return { pixels: canvas.width / canvas.height, displayed: bounds.width / bounds.height };
    });
  expect(previewRatio.displayed).toBeCloseTo(previewRatio.pixels, 2);
  await expectOneRed(page, 'camera page review');
  await expectNoSeriousA11y(page, 'camera page review');
  await page.screenshot({ path: testInfo.outputPath('camera-page-review.png') });
  await dialog(page).getByRole('button', { name: 'Retake', exact: true }).click();
  await beginPage(page, 2);
  await finishViews(page);
  await dialog(page).getByRole('button', { name: 'Keep page', exact: true }).click();
  await expect(dialog(page).getByText('1 page kept', { exact: true })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Photograph another page' }).click();
  await beginPage(page, 3);
  await finishViews(page);
  await dialog(page).getByRole('button', { name: 'Keep page', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Use 2 pages', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectCameraStopped(page);
  await expect(page.locator('.scan-page-list li')).toHaveCount(2);
  expect(uploads).toHaveLength(0);
  const originals = await page
    .locator('.scan-page-list img')
    .evaluateAll(async (images) =>
      Promise.all(
        images.map(async (image) =>
          Array.from(
            new Uint8Array(await (await fetch((image as HTMLImageElement).src)).arrayBuffer()),
          ),
        ),
      ),
    );
  expect(originals[0]).not.toEqual(originals[1]);
  await page.getByRole('button', { name: /^Select page 2:/ }).click();
  await page.getByRole('button', { name: 'Move page 2 earlier', exact: true }).click();
  await expectOneRed(page, 'camera batch');
  await expectNoSeriousA11y(page, 'camera batch');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Scan this score', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review the recognition', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.scan-review svg').first()).toBeVisible();
  expect(uploads).toEqual([Buffer.from(originals[1]!), Buffer.from(originals[0]!)]);
});
