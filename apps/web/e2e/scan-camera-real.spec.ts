import { writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { scan } from '../src/i18n/en/scan.js';
import type { Point } from '../src/scan/camera/vision.js';
import {
  expectCameraReady,
  expectCameraStopped,
  glideScore,
  installPhotoCamera,
  PAGE_PHOTO_SIZE,
  PAGE_PHOTO_URL,
} from './helpers/camera.js';
import { expectOneRed } from './helpers/red.js';

// Real texture, realistic motion (issue 143). The camera films a real phone photo of a printed
// page lying on a wooden table, through a tilted pinhole camera (true perspective, rendered by
// WebGL) with hand tremor, motion blur while moving and sensor noise, at 720 x 960, so the
// tracking runs on downscaled frames. The reader's hand sweeps the phone over the page and pauses
// now and then, as a person does (issue 149).
test.use({ isMobile: true, hasTouch: true });
const t = scan.camera;
const dialog = (page: Page) => page.getByRole('dialog', { name: t.title });
const shutter = (page: Page) => dialog(page).getByRole('button', { name: t.capture, exact: true });
const status = (page: Page) => dialog(page).getByRole('status');
const step = (page: Page, n: number) => dialog(page).getByText(t.step(n, 5), { exact: true });
const review = (page: Page) => dialog(page).getByText(t.review, { exact: true });

/** How the page really samples the camera while the reader sweeps (photos 2 to 5). */
interface Timing {
  /** Milliseconds between the callbacks that tracked a frame. */
  interval: { median: number; p90: number; max: number };
  /** Milliseconds each of those callbacks took on the main thread. */
  work: { median: number; p90: number; max: number };
  samples: number;
}

async function openPhotoCamera(page: Page) {
  await page.addInitScript(() => {
    const ticks: [number, number, boolean][] = [];
    (window as unknown as { ticks: typeof ticks }).ticks = ticks;
    const prototype = HTMLVideoElement.prototype;
    const original = prototype.requestVideoFrameCallback;
    prototype.requestVideoFrameCallback = function (callback) {
      return original.call(this, (now, metadata) => {
        const start = performance.now();
        try {
          callback(now, metadata);
        } finally {
          const tracking = !!document.querySelector('circle[data-camera-reticle]');
          ticks.push([start, performance.now() - start, tracking]);
        }
      });
    };
  });
  await installPhotoCamera(page);
  await page.goto('/');
  await expectCameraReady(page);
  await page.getByRole('button', { name: scan.phone.takePhoto, exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(shutter(page)).toBeEnabled({ timeout: 20_000 });
}

async function timing(page: Page): Promise<Timing> {
  const ticks = await page.evaluate(
    () => (window as unknown as { ticks: [number, number, boolean][] }).ticks,
  );
  // A callback that only rescheduled (under 120 ms since the last sample) takes well under 2 ms.
  const work = ticks.filter(([, duration, tracking]) => duration > 2 && tracking);
  // Only the tracking stage counts: the reference burst and the combining are not sampling.
  const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q: number) => Math.round(sorted[Math.floor(q * (sorted.length - 1))] ?? 0);
    return { median: at(0.5), p90: at(0.9), max: at(1) };
  };
  return {
    interval: stats(work.slice(1).map(([start], index) => start - work[index]![0])),
    work: stats(work.map(([, duration]) => duration)),
    samples: work.length,
  };
}

interface Viewfinder {
  /** The header, e.g. 'Photo 3 of 5'; null once the page is being combined or reviewed. */
  photo: string | null;
  /** What the status line (and any alert) says. */
  said: string;
  /** Tracking has lost the page (the circle dims). */
  lost: boolean;
  camera: Point;
}
const viewfinder = (page: Page) =>
  page.evaluate((): Viewfinder => ({
    photo: document.querySelector('.camera-step')?.textContent ?? null,
    said: [
      ...document.querySelectorAll('.guided-camera [role=status], .guided-camera [role=alert]'),
    ]
      .map((element) => element.textContent)
      .join(' / '),
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
async function sweepView(page: Page, n: number, next: { stop: number }, timeout: number) {
  const deadline = Date.now() + timeout;
  const waiting = t.step(n, 5);
  let stops = 0;
  let lostSince: number | null = null;
  let pausedSince: number | null = null;
  while (Date.now() < deadline) {
    const view = await viewfinder(page);
    // The fifth photo leaves the count and its dots on screen while the page is combined (issue
    // 156), so only the status line tells that it was taken.
    const combining =
      n === 5 && [t.processing, t.review].some((text) => view.said.startsWith(text));
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
async function photographPage(page: Page, slow = 1) {
  // Only a sharp, lit page earns the press; its outline shows the page was found (the status
  // reads the same whether or not it was).
  await expect(dialog(page).locator('polygon[data-camera-page]')).toHaveCount(1, {
    timeout: 10_000 * slow,
  });
  await expect(status(page)).toHaveText(t.aim);
  await expectOneRed(page, 'real camera viewfinder');
  await shutter(page).click();
  await expect(step(page, 2)).toBeVisible({ timeout: 10_000 * slow });
  // The reference photo is confirmed in words for a moment (issue 156), then the sweep sentence.
  await expect(status(page)).toHaveText(t.sweep(4));
  await expectOneRed(page, 'real camera sweep');
  const stops: number[] = [];
  const next = { stop: 0 };
  for (let n = 2; n <= 5; n++) {
    stops.push(await sweepView(page, n, next, 30_000 * slow));
    // Each view advances the header by exactly one, and the last one leads to the review.
    if (n < 5) await expect(step(page, n + 1)).toBeVisible();
  }
  const combining = Date.now();
  await expect(review(page)).toBeVisible({ timeout: 120_000 * slow });
  return { stops, combining: Date.now() - combining };
}

interface PageMeasure {
  /** Lines per staff found by a horizontal projection: a sharp page has groups of five. */
  staves: number[];
  /** Staff-line spacing in pixels. */
  spacing: number;
  /** Mean darkness of the staff lines below the paper, 0..255. */
  depth: number;
  /** Mean squared gradient over the squared ink contrast: edge crispness, independent of level. */
  crisp: number;
  /** Median high-pass amplitude over blank paper: sensor noise (reported, not asserted). */
  grain: number;
}
interface Comparison {
  size: { width: number; height: number };
  fused: PageMeasure;
  single: PageMeasure;
  truth: PageMeasure;
  /** Correlation of each with the photographed page, resampled to the same size. */
  fusedTruth: number;
  singleTruth: number;
  fusedSingle: number;
}

/**
 * Measure the fused page against the reference photo of the same page: the reference frame
 * (shown while the corners are adjusted) is rectified here through the same corners, so both
 * pages cover the same paper pixel for pixel, and the source photo is the ground truth.
 */
async function comparePages(page: Page, photo: string): Promise<Comparison> {
  const still = dialog(page).locator('canvas.camera-still');
  await still.evaluate((canvas: HTMLCanvasElement) => {
    (window as unknown as { fusedPage: ImageData }).fusedPage = canvas
      .getContext('2d')!
      .getImageData(0, 0, canvas.width, canvas.height);
  });
  await dialog(page).getByRole('button', { name: t.adjust, exact: true }).click();
  await expect(dialog(page).getByRole('button', { name: t.cornerLabel(1) })).toBeVisible();
  return page.evaluate(async (photo): Promise<Comparison> => {
    const fusedImage = (window as unknown as { fusedPage: ImageData }).fusedPage;
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.camera-still')!;
    const reference = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const corners = Array.from(document.querySelectorAll<HTMLElement>('.camera-corner')).map(
      (button) => ({
        x: (parseFloat(button.style.left) / 100) * reference.width,
        y: (parseFloat(button.style.top) / 100) * reference.height,
      }),
    );
    const width = fusedImage.width;
    const height = fusedImage.height;
    const gray = (image: ImageData) => {
      const out = new Float32Array(image.width * image.height);
      for (let i = 0; i < out.length; i++)
        out[i] =
          image.data[i * 4]! * 0.299 +
          image.data[i * 4 + 1]! * 0.587 +
          image.data[i * 4 + 2]! * 0.114;
      return out;
    };
    // The unit square onto the corner quad (Heckbert), as the app maps its page.
    const [a, b, c, d] = corners as [Point, Point, Point, Point];
    const sx = a.x - b.x + c.x - d.x;
    const sy = a.y - b.y + c.y - d.y;
    const det = (b.x - c.x) * (d.y - c.y) - (d.x - c.x) * (b.y - c.y);
    const g = (sx * (d.y - c.y) - (d.x - c.x) * sy) / det;
    const h = ((b.x - c.x) * sy - sx * (b.y - c.y)) / det;
    const m = [
      b.x - a.x + g * b.x,
      d.x - a.x + h * d.x,
      a.x,
      b.y - a.y + g * b.y,
      d.y - a.y + h * d.y,
      a.y,
      g,
      h,
      1,
    ];
    const source = gray(reference);
    const single = new Float32Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1);
        const v = y / (height - 1);
        const w = m[6]! * u + m[7]! * v + m[8]!;
        const px = Math.max(
          0,
          Math.min(reference.width - 1.001, (m[0]! * u + m[1]! * v + m[2]!) / w),
        );
        const py = Math.max(
          0,
          Math.min(reference.height - 1.001, (m[3]! * u + m[4]! * v + m[5]!) / w),
        );
        const ix = Math.floor(px);
        const iy = Math.floor(py);
        const fx = px - ix;
        const fy = py - iy;
        const i = iy * reference.width + ix;
        single[y * width + x] =
          (source[i]! * (1 - fx) + source[i + 1]! * fx) * (1 - fy) +
          (source[i + reference.width]! * (1 - fx) + source[i + reference.width + 1]! * fx) * fy;
      }
    const bitmap = await createImageBitmap(await (await fetch(photo)).blob());
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const context = scratch.getContext('2d')!;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    const truth = gray(context.getImageData(0, 0, width, height));
    const fused = gray(fusedImage);

    const quantile = (values: ArrayLike<number>, q: number) => {
      const sorted = Float32Array.from(values).sort();
      return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
    };
    const measure = (image: Float32Array): PageMeasure => {
      // Staff lines run across the page: a row is a line where most of 24 narrow bands across
      // the staves are dark in it (or a row beside it, for residual skew). Noteheads, beams,
      // slurs and text darken only a few bands.
      const bands = 24;
      const band = Math.max(3, Math.round(width * 0.02));
      const dark = new Uint8Array(height * bands);
      const level = new Float32Array(height * bands);
      for (let k = 0; k < bands; k++) {
        const left = Math.round(width * (0.15 + (0.7 * k) / (bands - 1))) - (band >> 1);
        const column = new Float32Array(height);
        for (let y = 0; y < height; y++) {
          let sum = 0;
          for (let x = left; x < left + band; x++) sum += image[y * width + x]!;
          column[y] = sum / band;
          level[y * bands + k] = column[y]!;
        }
        const paper = quantile(column, 0.9);
        const ink = quantile(column, 0.01);
        for (let y = 0; y < height; y++)
          dark[y * bands + k] = paper - column[y]! > 0.35 * (paper - ink) ? 1 : 0;
      }
      const isLine = (y: number) => {
        let covered = 0;
        for (let k = 0; k < bands; k++)
          if (dark[y * bands + k] || dark[(y - 1) * bands + k] || dark[(y + 1) * bands + k])
            covered++;
        return covered >= bands * 0.6;
      };
      // Each run of line rows is one staff line, at the run's darkest row.
      const lines: { y: number; depth: number }[] = [];
      const paperLevel = quantile(level, 0.9);
      for (let y = 1; y < height - 1; y++) {
        if (!isLine(y)) continue;
        const row = level.slice(y * bands, (y + 1) * bands).sort();
        const depth = paperLevel - row[bands >> 1]!;
        const previous = lines.at(-1);
        if (previous && y - previous.y <= 2) {
          if (depth > previous.depth) lines[lines.length - 1] = { y, depth };
        } else lines.push({ y, depth });
      }
      const gaps = lines.slice(1).map((line, i) => line.y - lines[i]!.y);
      const spacing = gaps.length ? quantile(gaps, 0.25) : 0;
      const staves: number[] = [];
      let depth = 0;
      let counted = 0;
      let run: typeof lines = [];
      const close = () => {
        if (!run.length) return;
        staves.push(run.length);
        if (run.length === 5)
          for (const line of run) {
            depth += line.depth;
            counted++;
          }
      };
      for (let i = 0; i < lines.length; i++) {
        if (i && gaps[i - 1]! > spacing * 1.6) {
          close();
          run = [];
        }
        run.push(lines[i]!);
      }
      close();
      // Crispness over the interior, away from the paper's edges.
      let energy = 0;
      let count = 0;
      const x0 = Math.round(width * 0.08);
      const y0 = Math.round(height * 0.06);
      for (let y = y0; y < height - y0; y++)
        for (let x = x0; x < width - x0; x++) {
          const i = y * width + x;
          energy += (image[i + 1]! - image[i]!) ** 2 + (image[i + width]! - image[i]!) ** 2;
          count++;
        }
      const contrast = quantile(image, 0.95) - quantile(image, 0.02);
      // Grain: the spread of the 3 x 3 high-pass over blank paper (every pixel of a 5 x 5 patch
      // near the paper level). Sensor noise differs from frame to frame, so a fusion that really
      // used its views averages it down; ink and paper texture are the same in every view.
      const blankLevel = quantile(image, 0.7);
      const grain: number[] = [];
      for (let y = y0; y < height - y0; y += 2)
        for (let x = x0; x < width - x0; x += 2) {
          let blank = true;
          for (let dy = -2; dy <= 2 && blank; dy++)
            for (let dx = -2; dx <= 2; dx++)
              if (image[(y + dy) * width + x + dx]! < blankLevel - 12) {
                blank = false;
                break;
              }
          if (!blank) continue;
          let mean = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) mean += image[(y + dy) * width + x + dx]!;
          grain.push(Math.abs(image[y * width + x]! - mean / 9));
        }
      return {
        staves,
        spacing,
        depth: counted ? depth / counted : 0,
        crisp: energy / count / contrast ** 2,
        grain: quantile(grain, 0.5),
      };
    };
    const correlation = (p: Float32Array, q: Float32Array) => {
      const x0 = Math.round(width * 0.06);
      const y0 = Math.round(height * 0.04);
      let sp = 0;
      let sq = 0;
      let n = 0;
      for (let y = y0; y < height - y0; y++)
        for (let x = x0; x < width - x0; x++) {
          sp += p[y * width + x]!;
          sq += q[y * width + x]!;
          n++;
        }
      const mp = sp / n;
      const mq = sq / n;
      let pq = 0;
      let pp = 0;
      let qq = 0;
      for (let y = y0; y < height - y0; y++)
        for (let x = x0; x < width - x0; x++) {
          const dp = p[y * width + x]! - mp;
          const dq = q[y * width + x]! - mq;
          pq += dp * dq;
          pp += dp * dp;
          qq += dq * dq;
        }
      return pq / Math.sqrt(pp * qq);
    };
    return {
      size: { width, height },
      fused: measure(fused),
      single: measure(single),
      truth: measure(truth),
      fusedTruth: correlation(fused, truth),
      singleTruth: correlation(single, truth),
      fusedSingle: correlation(fused, single),
    };
  }, photo);
}

/** The whole capture on the real page, and what the fused page must show. */
async function scanRealPage(page: Page, testInfo: TestInfo, slow: number) {
  const { stops, combining } = await photographPage(page, slow);
  const sampling = await timing(page);
  const still = dialog(page).locator('canvas.camera-still');
  const size = await still.evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width,
    height: canvas.height,
    displayed: canvas.getBoundingClientRect().width / canvas.getBoundingClientRect().height,
  }));
  await testInfo.attach('fused page', {
    body: Buffer.from(
      (await still.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).split(',')[1]!,
      'base64',
    ),
    contentType: 'image/png',
  });
  const pages = await comparePages(page, PAGE_PHOTO_URL);
  const measurements = testInfo.outputPath('measurements.json');
  writeFileSync(measurements, JSON.stringify({ stops, combining, sampling, size, pages }, null, 2));
  await testInfo.attach('measurements', { path: measurements, contentType: 'application/json' });
  // The page's own proportions (the photo is 1308 x 1600): the outline was found, since the
  // fallback inset frame would read 0.75, and the review shows the page undistorted.
  const ratio = size.width / size.height;
  expect(ratio).toBeGreaterThan((PAGE_PHOTO_SIZE.width / PAGE_PHOTO_SIZE.height) * 0.97);
  expect(ratio).toBeLessThan((PAGE_PHOTO_SIZE.width / PAGE_PHOTO_SIZE.height) * 1.03);
  expect(size.displayed).toBeCloseTo(ratio, 2);
  // Not worse than the first photo alone: the same paper, as crisp, its staff lines as dark,
  // and no staff doubled by a misregistered view. A doubled staff reads as 8 to 10 lines, or
  // as a correlation well below 1 with the single photo; a beam or ledger line beside a staff
  // can add one line, in the single photo as much as in the fused page. At 720 x 960 the
  // staff lines are only about 4.5 pixels apart, and the far (top) systems do not resolve.
  const five = (staves: number[]) => staves.filter((lines) => lines === 5).length;
  const long = (staves: number[]) => staves.filter((lines) => lines > 5).length;
  expect(pages.fusedSingle).toBeGreaterThan(0.95);
  expect(pages.fused.crisp).toBeGreaterThan(pages.single.crisp * 0.9);
  expect(pages.fused.depth).toBeGreaterThan(pages.single.depth * 0.9);
  expect(five(pages.fused.staves)).toBeGreaterThanOrEqual(
    Math.max(5, five(pages.single.staves) - 1),
  );
  expect(Math.max(...pages.fused.staves)).toBeLessThan(8);
  expect(long(pages.fused.staves)).toBeLessThanOrEqual(long(pages.single.staves) + 1);
  // The measure itself reads the real page: the photo's own staves come out as fives.
  expect(five(pages.truth.staves)).toBeGreaterThanOrEqual(10);
  await dialog(page).getByRole('button', { name: t.close, exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectCameraStopped(page);
  return sampling;
}

test('camera, real photo: five tracked photos of a printed page fuse into one page at least as sharp as the first', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await openPhotoCamera(page);
  // The sampling intervals are attached with the measurements, not asserted: they depend on
  // the machine's load, and the capture completing is what matters.
  await scanRealPage(page, testInfo, 1);
});

test('camera, real photo: the capture still completes on a phone-speed CPU (4x throttled)', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'CPU throttling is a Chromium DevTools feature');
  test.slow();
  test.setTimeout(600_000);
  await openPhotoCamera(page);
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await scanRealPage(page, testInfo, 3);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});
