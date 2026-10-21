import { expect, test, type Page } from '@playwright/test';
import { scan } from '../src/i18n/en/scan.js';
import { expectNoSeriousA11y } from './helpers/axe.js';
import {
  expectCameraStopped,
  installScoreCamera,
  moveScore,
  type CameraOptions,
} from './helpers/camera.js';
import { horizontalOverflow } from './helpers/overflow.js';
import { expectOneRed } from './helpers/red.js';
import { mockService, PNG } from './helpers/scan.js';

// The entry is intentionally touch-only. Exercise it at both the desktop and phone widths.
test.use({ isMobile: true, hasTouch: true });
const t = scan.camera;
const dialog = (page: Page) => page.getByRole('dialog', { name: t.title });
const shutter = (page: Page) => dialog(page).getByRole('button', { name: t.capture, exact: true });
const status = (page: Page) => dialog(page).getByRole('status');
const step = (page: Page, n: number) => dialog(page).getByText(t.step(n, 5), { exact: true });

async function openCamera(page: Page, options?: CameraOptions) {
  await installScoreCamera(page, options);
  await page.goto('/');
  await page.getByRole('button', { name: scan.phone.takePhoto, exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(shutter(page)).toBeEnabled();
}

async function beginPage(page: Page, score: number) {
  await moveScore(page, 0, 0, score);
  await shutter(page).click();
  await expect(step(page, 2)).toBeVisible();
  await expect(status(page)).toHaveText(t.align);
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
    if (index < 3) await expect(step(page, index + 3)).toBeVisible({ timeout: 15_000 });
  }
  await expect(dialog(page).getByText(t.review, { exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

const xml = (step: string) =>
  `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note></measure></part></score-partwise>`;

test('camera: the entry has its own line, under the file chooser', async ({ page }) => {
  await installScoreCamera(page);
  await page.goto('/');
  const open = (await page.getByText('Open your own score', { exact: true }).boundingBox())!;
  const camera = page.getByRole('button', { name: scan.phone.takePhoto, exact: true });
  const box = (await camera.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(open.y + open.height);
  expect(box.height).toBeGreaterThanOrEqual(44);
  // The camera symbol, so it does not read as a second file link.
  await expect(camera.locator('svg')).toHaveCount(1);
});

test('camera: stationary video cannot complete a view; cancel releases its real track', async ({
  page,
}) => {
  await mockService(page, xml('C'));
  await openCamera(page);
  await expect(status(page)).toHaveText(t.aim);
  await expect(dialog(page).getByText(t.intro, { exact: true })).toBeVisible();
  await expectOneRed(page, 'camera viewfinder');
  await beginPage(page, 1);
  const initialFrames = await page.evaluate(() => window.scoreCamera.frames);
  // Wait for actual camera frames, not an application timer or mocked registration result.
  await expect
    .poll(() => page.evaluate((before) => window.scoreCamera.frames - before, initialFrames))
    .toBeGreaterThan(90);
  await expect(step(page, 2)).toBeVisible();
  // No manual shutter while tracking: the red element is the dot to reach.
  await expect(shutter(page)).toHaveCount(0);
  await expect(dialog(page).locator('[data-camera-target="1"]')).toHaveClass(/is-red/);
  await expect(dialog(page).getByText(t.review, { exact: true })).toHaveCount(0);
  await expectOneRed(page, 'stationary guided camera');
  await expectNoSeriousA11y(page, 'stationary guided camera');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await dialog(page).getByRole('button', { name: t.close, exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectCameraStopped(page);
  await expect(page.getByRole('button', { name: scan.phone.takePhoto, exact: true })).toBeFocused();
  await expect(page.locator('.scan-page-list li')).toHaveCount(0);
});

test('camera: a frozen aligned video cannot count as a steady hold', async ({ page }) => {
  await mockService(page, xml('C'));
  await openCamera(page);
  await beginPage(page, 1);
  // Freeze inside the page the moment the ring starts to fill (issue 140): no Playwright round
  // trip may fall inside the hold, which a slow runner can outlast.
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[data-camera-reticle][data-holding="true"]')) return;
      window.scoreCamera.freeze(true);
      (window as unknown as { frozeAt: number }).frozeAt = performance.now();
      observer.disconnect();
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-holding'],
    });
    window.scoreCamera.move(81, 108);
  });
  const frozeAt = () =>
    page.evaluate(() => (window as unknown as { frozeAt?: number }).frozeAt ?? null);
  await expect.poll(frozeAt, { timeout: 15_000 }).not.toBeNull();
  await expect
    .poll(() => page.evaluate(() => performance.now()))
    .toBeGreaterThan((await frozeAt())! + 1_200);
  await expect(step(page, 2)).toBeVisible();
  await page.evaluate(() => window.scoreCamera.freeze(false));
  await expect(step(page, 3)).toBeVisible({ timeout: 15_000 });
  await dialog(page).getByRole('button', { name: t.close, exact: true }).click();
  await expectCameraStopped(page);
});

test('camera: a dark page asks for the light, and the torch brightens it', async ({ page }) => {
  await openCamera(page, { torch: true, light: 0.12 });
  await expect(status(page)).toHaveText(t.dark, { timeout: 10_000 });
  const light = dialog(page).getByRole('button', { name: t.light, exact: true });
  await expect(light).toHaveAttribute('aria-pressed', 'false');
  await expect(light).toHaveAttribute('data-attention', 'true');
  await expectOneRed(page, 'dark camera');
  await light.click();
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await expect(status(page)).toHaveText(t.aim, { timeout: 10_000 });
  await expect(light).not.toHaveAttribute('data-attention', 'true');
  await dialog(page).getByRole('button', { name: t.close, exact: true }).click();
  await expectCameraStopped(page);
  // The light goes off before the camera stops.
  expect(await page.evaluate(() => window.scoreCamera.log)).toEqual([true, false, 'stop']);
});

test('camera: without a torch there is no light button, and the advice says so', async ({
  page,
}) => {
  await openCamera(page, { light: 0.12 });
  await expect(status(page)).toHaveText(t.darkNoLight, { timeout: 10_000 });
  await expect(dialog(page).getByRole('button', { name: t.light })).toHaveCount(0);
});

test('camera: a shaky picture says hold still, and a press always answers', async ({ page }) => {
  await openCamera(page);
  await page.evaluate(() => window.scoreCamera.blur(4));
  await expect(status(page)).toHaveText(t.blurry, { timeout: 10_000 });
  await shutter(page).click();
  // The press is answered at once, then explained: never a silent button.
  await expect(status(page)).toHaveText(t.hold);
  await expect(status(page)).toHaveText(t.retryBlurry, { timeout: 5_000 });
  await expectOneRed(page, 'blurry press');
  await page.evaluate(() => window.scoreCamera.blur(0));
  await expect(status(page)).toHaveText(t.aim, { timeout: 10_000 });
  await shutter(page).click();
  await expect(step(page, 2)).toBeVisible();
});

test('camera: a page on a contrasting table is outlined before the photo', async ({ page }) => {
  await openCamera(page, { table: true });
  await expect(dialog(page).locator('[data-camera-page]')).toHaveCount(1, { timeout: 10_000 });
  await expectOneRed(page, 'outlined page');
});

test('camera: denied permission explains the device-camera fallback and imports its photo', async ({
  page,
}) => {
  await installScoreCamera(page, 'denied');
  await mockService(page, xml('C'));
  await page.goto('/');
  await page.getByRole('button', { name: scan.phone.takePhoto, exact: true }).click();
  await expect(dialog(page)).toContainText('Camera access is blocked.');
  await expectOneRed(page, 'denied camera');
  await expectNoSeriousA11y(page, 'denied camera');
  const choosing = page.waitForEvent('filechooser');
  await dialog(page).getByText(t.fallback, { exact: true }).click();
  await (await choosing).setFiles({ name: 'device.png', mimeType: 'image/png', buffer: PNG });
  await expect(dialog(page).getByRole('img', { name: t.review, exact: true })).toBeVisible();
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
  await expect(step(page, 2)).toBeVisible();
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
  // Corners are adjusted in the review now, and the page is prepared again from them.
  await dialog(page).getByRole('button', { name: t.adjust, exact: true }).click();
  await expect(dialog(page).getByRole('button', { name: t.cornerLabel(1) })).toBeVisible();
  await dialog(page).getByRole('button', { name: t.useCorners, exact: true }).click();
  await expect(dialog(page).getByText(t.review, { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await dialog(page).getByRole('button', { name: t.retake, exact: true }).click();
  await beginPage(page, 2);
  await finishViews(page);
  await dialog(page).getByRole('button', { name: t.keep, exact: true }).click();
  await expect(dialog(page).getByText('1 page kept', { exact: true })).toBeVisible();
  await dialog(page).getByRole('button', { name: t.nextPage }).click();
  await beginPage(page, 3);
  await finishViews(page);
  await dialog(page).getByRole('button', { name: t.keep, exact: true }).click();
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
