import { expect, type Page } from '@playwright/test';
import { scan } from '../../src/i18n/en/scan.js';
import type { Point } from '../../src/scan/camera/vision.js';
import { expectCameraReady, glideScore, installPhotoCamera } from './camera.js';
import { expectOneRed } from './red.js';

// The reader's sweep over a printed page, as scan-camera-real.spec.ts drives it (issues 143, 149):
// the same behaviour, shared with scan-camera-loop.spec.ts. scan-camera-real.spec.ts keeps its own
// copies of these functions until it is next changed.
//
// Only what the camera shows in every version is relied on: the header 'Photo n of 5' (read from
// its own element: the status line says 'Photo n of 5 taken.' for a moment after a photo, which
// holds the same words), the shutter, and the end of the sweep ('Combining your photos…', then
// 'Check your page').
export const t = scan.camera;
export const dialog = (page: Page) => page.getByRole('dialog', { name: t.title });
export const shutter = (page: Page) =>
  dialog(page).getByRole('button', { name: t.capture, exact: true });
const step = (page: Page, n: number) => dialog(page).getByText(t.step(n, 5), { exact: true });
const review = (page: Page) => dialog(page).getByText(t.review, { exact: true });

/** The camera on a real photo of a printed page, opened from the library, ready for the first photo. */
export async function openPhotoCamera(page: Page) {
  await installPhotoCamera(page);
  await page.goto('/');
  await expectCameraReady(page);
  await page.getByRole('button', { name: scan.phone.takePhoto, exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(shutter(page)).toBeEnabled({ timeout: 20_000 });
}

export interface Viewfinder {
  /** The header, e.g. 'Photo 3 of 5'; it stays through the combining of the fifth photo, and is
   * null once the review opens. */
  photo: string | null;
  /** The dialog's text: what the status line (and any alert) says, and the rest of the camera. */
  said: string;
  /** Tracking has lost the page (the circle dims). */
  lost: boolean;
  camera: Point;
}
export const viewfinder = (page: Page) =>
  page.evaluate((): Viewfinder => ({
    photo: document.querySelector('.camera-step')?.textContent ?? null,
    said: document.querySelector('[role=dialog]')?.textContent ?? '',
    lost: !!document.querySelector('svg.camera-tracking.is-lost'),
    camera: { x: window.scoreCamera.x, y: window.scoreCamera.y },
  }));

/**
 * Where the hand pauses while it sweeps (issue 149), in camera pixels from where the first photo
 * was taken: around it, a sixth of the picture's width away, in no order the app chose. The app
 * asks for about 72 camera pixels between views here.
 */
const STOPS = [
  { x: 120, y: 0 },
  { x: 0, y: 120 },
  { x: -120, y: 0 },
  { x: 0, y: -120 },
  { x: 85, y: 85 },
  { x: -85, y: -85 },
] as const;

/**
 * Photo `n` of 5 (2 to 5): sweep the phone to the next stop, then hold it there, as a person
 * pauses, until the view is taken or a few seconds pass; a stop that already has its view leads on
 * to the next one. Returns the number of stops it took.
 */
export async function sweepView(page: Page, n: number, next: { stop: number }, timeout: number) {
  const deadline = Date.now() + timeout;
  const waiting = t.step(n, 5);
  let stops = 0;
  let lostSince: number | null = null;
  let pausedSince: number | null = null;
  while (Date.now() < deadline) {
    const view = await viewfinder(page);
    // The fifth photo leaves the header and its dots on screen while the page is combined (issue
    // 156), so only the words under the picture tell that it was taken.
    const combining = n === 5 && [t.processing, t.review].some((text) => view.said.includes(text));
    if (view.photo !== waiting || combining) {
      // Taken: the next photo, or the page being combined. Anything else is a reset or a failure.
      const advanced = n < 5 ? view.photo === t.step(n + 1, 5) : combining;
      if (!advanced) throw new Error(`Photo ${n} of 5 led to '${view.photo}': ${view.said}`);
      return stops;
    }
    if (view.lost) {
      // Lost: drift back toward where the page was photographed, as a person would.
      lostSince ??= Date.now();
      if (Date.now() - lostSince > 2_000) {
        await glideScore(page, view.camera.x * 0.7, view.camera.y * 0.7, 400);
        lostSince = Date.now();
      } else await page.waitForTimeout(100);
      continue;
    }
    lostSince = null;
    if (pausedSince !== null && Date.now() - pausedSince < 3_000) {
      await page.waitForTimeout(100);
      continue;
    }
    const stop = STOPS[next.stop++ % STOPS.length]!;
    stops++;
    await glideScore(
      page,
      stop.x,
      stop.y,
      Math.min(900, Math.max(300, Math.hypot(stop.x - view.camera.x, stop.y - view.camera.y) * 3)),
    );
    pausedSince = Date.now();
  }
  throw new Error(`Photo ${n} of 5 was not taken in ${timeout} ms (${stops} stops)`);
}

/** The reference photo, then the four swept views; resolves on the review. */
export async function photographPage(page: Page, slow = 1) {
  // Only a sharp, lit page earns the press; its outline shows the page was found.
  await expect(dialog(page).locator('polygon[data-camera-page]')).toHaveCount(1, {
    timeout: 10_000 * slow,
  });
  await expectOneRed(page, 'real camera viewfinder');
  await shutter(page).click();
  await expect(step(page, 2)).toBeVisible({ timeout: 10_000 * slow });
  await expectOneRed(page, 'real camera sweep');
  const stops: number[] = [];
  const next = { stop: 0 };
  for (let n = 2; n <= 5; n++) {
    stops.push(await sweepView(page, n, next, 30_000 * slow));
    // Each view advances the header by exactly one, and the last one leads to the review.
    if (n < 5) await expect(step(page, n + 1)).toBeVisible();
  }
  const combining = Date.now();
  await expect(review(page)).toBeVisible({ timeout: 60_000 * slow });
  return { stops, combining: Date.now() - combining };
}
