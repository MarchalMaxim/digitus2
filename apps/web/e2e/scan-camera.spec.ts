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
import { expectOneRed, redRoots } from './helpers/red.js';
import { mockService, PNG } from './helpers/scan.js';

// The entry is intentionally touch-only. Exercise it at both the desktop and phone widths.
test.use({ isMobile: true, hasTouch: true });
const t = scan.camera;
const dialog = (page: Page) => page.getByRole('dialog', { name: t.title });
const shutter = (page: Page) => dialog(page).getByRole('button', { name: t.capture, exact: true });
const status = (page: Page) => dialog(page).getByRole('status');
const step = (page: Page, n: number) => dialog(page).getByText(t.step(n, 5), { exact: true });
/** The filled progress dots under the count: the photos taken so far, the reference included. */
const filled = (page: Page) => dialog(page).locator('[data-camera-progress] [data-taken="true"]');
/** A status line that says one of these, exactly. */
const oneOf = (...texts: string[]) =>
  new RegExp(`^(?:${texts.map((text) => text.replace(/\W/g, '\\$&')).join('|')})$`);
/** CPU slowdown for the slow-phone test; DIGITUS2_E2E_CPU overrides it to find a breaking rate. */
const SLOW_PHONE = Number(process.env.DIGITUS2_E2E_CPU ?? 6);

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
  // The reference photo is confirmed in words for a moment (issue 156), then the sweep sentence.
  await expect(status(page)).toHaveText(oneOf(t.taken(1, 5), t.sweep(4)));
  await expect(status(page)).toHaveText(t.sweep(4));
}

async function finishViews(page: Page, { view = 15_000, review = 20_000 } = {}) {
  // Sweep the phone and pause four times (issue 149): the page lands this far from where the
  // first photo was taken, in the 360 x 480 camera source pixels, in no order the app chose.
  const translations = [
    [81, 108],
    [-81, 108],
    [-81, -108],
    [81, -108],
  ] as const;
  for (const [index, [x, y]] of translations.entries()) {
    await moveScore(page, x, y);
    if (index < 3) await expect(step(page, index + 3)).toBeVisible({ timeout: view });
  }
  await expect(dialog(page).getByText(t.review, { exact: true })).toBeVisible({
    timeout: review,
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
  // Wait for actual camera frames, not an application timer or mocked registration result. WebKit
  // in a container draws them more slowly: the count matters, not the time.
  await expect
    .poll(() => page.evaluate((before) => window.scoreCamera.frames - before, initialFrames), {
      timeout: 20_000,
    })
    .toBeGreaterThan(90);
  await expect(step(page, 2)).toBeVisible();
  // No manual shutter while tracking: the red element is the circle the reader sweeps.
  await expect(shutter(page)).toHaveCount(0);
  await expect(dialog(page).locator('[data-camera-reticle]')).toHaveClass(/is-red/);
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

test('camera: a frozen video cannot count as a pause', async ({ page }) => {
  await mockService(page, xml('C'));
  await openCamera(page);
  await beginPage(page, 1);
  // Move somewhere new and freeze once the first picture of it is drawn (issue 140): no
  // Playwright round trip may fall inside the pause, which a slow runner can outlast. Freezing at
  // the camera, not when the app shows the pause, keeps the analysis's own lag (real pictures of
  // the new place, already on their way) from counting as the frozen time.
  await page.evaluate(() => {
    const before = window.scoreCamera.frames;
    const watch = () => {
      if (window.scoreCamera.frames <= before) {
        requestAnimationFrame(watch);
        return;
      }
      window.scoreCamera.freeze(true);
      (window as unknown as { frozeAt: number }).frozeAt = performance.now();
    };
    window.scoreCamera.move(81, 108);
    requestAnimationFrame(watch);
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

// A mid-range Android phone is four to six times slower than the desktop running these tests.
// DevTools slows the page's main thread only, not the tracker's worker, so the second test also
// keeps the worker from starting: every frame is then analysed on the slowed main thread, at
// least as slowly as a phone's worker would, and the views must still be taken (issue 143).
test.describe('slow phone', () => {
  // Each saturates a CPU core for most of a minute: one after the other, never side by side.
  test.describe.configure({ mode: 'serial' });
  for (const worker of [true, false])
    test(`camera: a slow phone (a CPU ${SLOW_PHONE} times slower) still takes all five photographs${
      worker ? '' : ', without a worker'
    }`, async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'CPU throttling is a Chromium DevTools feature');
      test.setTimeout(300_000);
      if (!worker)
        await page.addInitScript(() => {
          const Native = window.Worker;
          window.Worker = class extends Native {
            constructor(url: string | URL, options?: WorkerOptions) {
              if (String(url).includes('tracker')) {
                (window as unknown as { trackerRefused: boolean }).trackerRefused = true;
                throw new Error('No module workers here');
              }
              super(url, options);
            }
          };
        });
      await mockService(page, xml('C'));
      await openCamera(page);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW_PHONE });
      try {
        await moveScore(page, 0, 0, 1);
        await shutter(page).click();
        await expect(step(page, 2)).toBeVisible({ timeout: 20_000 });
        await finishViews(page, { view: 30_000, review: 150_000 });
        await expectOneRed(page, 'slow phone review');
        // The variant without a worker really analysed every frame on the slowed main thread.
        expect(
          await page.evaluate(
            () => (window as unknown as { trackerRefused?: boolean }).trackerRefused ?? false,
          ),
        ).toBe(!worker);
      } finally {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      }
    });
});

test('camera: a dark page asks for the light, and the torch brightens it', async ({ page }) => {
  await openCamera(page, { torch: true, light: 0.12 });
  await expect(status(page)).toHaveText(t.dark, { timeout: 10_000 });
  const light = dialog(page).getByRole('button', { name: t.light, exact: true });
  await expect(light).toHaveAttribute('aria-pressed', 'false');
  await expect(light).toHaveAttribute('data-attention', 'true');
  // The red moves to the light with the usual 120 ms colour fade: judge it once that has settled.
  await expect.poll(async () => (await redRoots(page)).length).toBe(1);
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

test('camera: a press is photographed even when no analysis comes back in time', async ({
  page,
}) => {
  // Issue 145: an iPhone said the camera stopped when its analysis lagged behind the press. Here
  // the tracker's worker answers every frame 3.5 s late, and with nothing usable.
  await page.addInitScript(() => {
    const Native = window.Worker;
    window.Worker = function (url: string | URL, options?: WorkerOptions) {
      if (!String(url).includes('tracker')) return new Native(url, options);
      const worker = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        onerror: null,
        onmessageerror: null,
        terminate() {},
        postMessage(message: { type: string; id: number; frame: unknown }) {
          if (message.type === 'reference') return;
          setTimeout(
            () =>
              worker.onmessage?.({
                data: { type: 'failed', id: message.id, frame: message.frame },
              }),
            3_500,
          );
        },
      };
      return worker;
    } as unknown as typeof Worker;
  });
  await openCamera(page);
  await moveScore(page, 0, 0, 1);
  await shutter(page).click();
  await expect(step(page, 2)).toBeVisible({ timeout: 5_000 });
  await expect(dialog(page).getByRole('alert')).toHaveCount(0);
  await expectOneRed(page, 'press without analysis');
});

/** Record every haptic tick: vibrations where the browser has them, the iPhone's switch ticks. */
async function recordTicks(page: Page) {
  await page.addInitScript(() => {
    const ticks: (number | 'switch')[] = [];
    (window as unknown as { ticks: typeof ticks }).ticks = ticks;
    if ('vibrate' in navigator)
      navigator.vibrate = ((pattern: number) => {
        ticks.push(Number(pattern));
        return true;
      }) as Navigator['vibrate'];
    const click = HTMLLabelElement.prototype.click;
    HTMLLabelElement.prototype.click = function (this: HTMLLabelElement) {
      if (this.querySelector('input[switch]')) ticks.push('switch');
      return click.call(this);
    };
  });
}
const ticks = (page: Page) =>
  page.evaluate(() => (window as unknown as { ticks: (number | 'switch')[] }).ticks);

test('camera: a shaking hand still takes every view, and each photo is felt', async ({ page }) => {
  // Issue 147: the page lands up to 10 camera pixels off in every frame, as a hand holds a phone.
  // The dot hold of issue 143 could not take one view from 8 pixels on; the sweep takes all four.
  await recordTicks(page);
  await mockService(page, xml('C'));
  await openCamera(page, { shake: 10 });
  await beginPage(page, 1);
  await finishViews(page);
  await expectOneRed(page, 'shaky review');
  // A firm tick as each photo is taken, and nothing else to feel.
  const felt = await ticks(page);
  if (felt.includes('switch')) expect(felt).toHaveLength(5);
  else expect(felt).toEqual([22, 22, 22, 22, 22]);
});

test('camera: a page with music only at its top is swept and combined', async ({ page }) => {
  // Issue 147: one system, the rest of the page blank paper, as on the owner's page. The reader
  // sweeps over the music, never off it, and the views combine (issue 149).
  await mockService(page, xml('C'));
  await openCamera(page, { systems: 1 });
  await beginPage(page, 1);
  // Music from about 35 to 80 of 480 camera pixels: moving the page down keeps all of it.
  const stops = [
    [50, 30],
    [-50, 30],
    [-50, 100],
    [50, 100],
  ] as const;
  for (const [index, [x, y]] of stops.entries()) {
    await moveScore(page, x, y);
    const taken =
      index < 3 ? step(page, index + 3) : dialog(page).getByText(t.review, { exact: true });
    await expect(taken).toBeVisible({ timeout: 15_000 });
  }
  await expect(dialog(page).getByRole('alert')).toHaveCount(0);
  await expectOneRed(page, 'partly blank page review');
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
  // The red button opens the file input, which carries the same name for screen readers.
  await dialog(page).locator('button', { hasText: t.fallback }).click();
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
  browserName,
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
  // Vision follows the pixels in the video. The reference photo is taken: one dot is filled
  // (issue 156). Every sentence the status line says from here on is recorded.
  await expect(filled(page)).toHaveCount(1);
  await page.evaluate(() => {
    const said: string[] = [];
    (window as unknown as { said: string[] }).said = said;
    const watch = () => {
      const text = document.querySelector('.guided-camera [role=status]')?.textContent;
      if (text && said.at(-1) !== text) said.push(text);
    };
    watch();
    new MutationObserver(watch).observe(document.querySelector('.guided-camera')!, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await moveScore(page, 81, 108);
  await expect(step(page, 3)).toBeVisible({ timeout: 15_000 });
  // The first view is taken: a second dot, a flash, and the status line says so for a moment
  // before the sweep sentence is back.
  await expect(filled(page)).toHaveCount(2);
  await expect(dialog(page).locator('[data-camera-flash]')).toHaveAttribute(
    'data-camera-flash',
    '2',
  );
  await expect(status(page)).toHaveText(oneOf(t.taken(2, 5), t.sweep(3)));
  await expect(status(page)).toHaveText(t.sweep(3));
  const said = await page.evaluate(() => (window as unknown as { said: string[] }).said);
  expect(said.indexOf(t.taken(2, 5))).toBeGreaterThan(-1);
  expect(said.indexOf(t.taken(2, 5))).toBeLessThan(said.lastIndexOf(t.sweep(3)));
  await moveScore(page, 0, 0);
  // Back where the first photo was taken: no view there, however long the pause.
  await page.waitForTimeout(1_500);
  await expect(step(page, 3)).toBeVisible();
  await expect(filled(page)).toHaveCount(2);
  await moveScore(page, -81, 108);
  await expect(step(page, 4)).toBeVisible({ timeout: 15_000 });
  await moveScore(page, -81, -108);
  await expect(step(page, 5)).toBeVisible({ timeout: 15_000 });
  await moveScore(page, 81, -108);
  await expect(dialog(page).getByText(t.review, { exact: true })).toBeVisible({ timeout: 20_000 });
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
  // WebKit gives Playwright no body for an uploaded File: there the two uploads are counted.
  if (browserName === 'webkit') expect(uploads).toHaveLength(2);
  else expect(uploads).toEqual([Buffer.from(originals[1]!), Buffer.from(originals[0]!)]);
});
