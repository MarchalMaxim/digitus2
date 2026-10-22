import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { scan } from '../src/i18n/en/scan.js';
import { expectCameraReady, installPhotoCamera } from './helpers/camera.js';

// Chromium's own fake camera (issue 143): navigator.mediaDevices is NOT replaced, so the app's
// real getUserMedia constraints (device.ts: the back camera, ideally 4032 x 3024) go through
// Chromium's capture stack, permission included. The flags replace the config's launch args,
// so its two are repeated here.
const FLAGS = [
  '--autoplay-policy=no-user-gesture-required',
  '--mute-audio',
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
];
test.use({
  isMobile: true,
  hasTouch: true,
  permissions: ['camera'],
  launchOptions: { args: FLAGS },
});
const t = scan.camera;
const dialog = (page: Page) => page.getByRole('dialog', { name: t.title });
const shutter = (page: Page) => dialog(page).getByRole('button', { name: t.capture, exact: true });
const status = (page: Page) => dialog(page).getByRole('status');
const video = (page: Page) => dialog(page).locator('video');

async function openCamera(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: scan.phone.takePhoto, exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(shutter(page)).toBeEnabled({ timeout: 15_000 });
  await expect(dialog(page).getByRole('alert')).toHaveCount(0);
  // Keep the stream, to check after closing that its tracks really ended.
  await video(page).evaluate((element: HTMLVideoElement) => {
    const kept = window as unknown as { cameraStream: MediaStream; cameraVideo: HTMLVideoElement };
    kept.cameraStream = element.srcObject as MediaStream;
    kept.cameraVideo = element;
  });
}

/** What Chromium chose for the app's constraints, and what its device reports. */
function track(page: Page) {
  return video(page).evaluate((element: HTMLVideoElement) => {
    const stream = element.srcObject as MediaStream;
    const videoTrack = stream.getVideoTracks()[0]!;
    const settings = videoTrack.getSettings();
    const capabilities = videoTrack.getCapabilities() as MediaTrackCapabilities & {
      torch?: boolean;
    };
    return {
      videoWidth: element.videoWidth,
      videoHeight: element.videoHeight,
      settings: { width: settings.width, height: settings.height, frameRate: settings.frameRate },
      label: videoTrack.label,
      torch: capabilities.torch === true,
      maxWidth: capabilities.width?.max,
      maxHeight: capabilities.height?.max,
      decoded: element.getVideoPlaybackQuality().totalVideoFrames,
      time: element.currentTime,
    };
  });
}

/** Every text the status line shows from now on, in order. */
async function recordStatus(page: Page) {
  await status(page).evaluate((element) => {
    const seen = [element.textContent ?? ''];
    (window as unknown as { statusSeen: string[] }).statusSeen = seen;
    new MutationObserver(() => {
      if (seen.at(-1) !== element.textContent) seen.push(element.textContent ?? '');
    }).observe(element, { subtree: true, characterData: true, childList: true });
  });
  return () => page.evaluate(() => (window as unknown as { statusSeen: string[] }).statusSeen);
}

interface BurstEvidence {
  /** Frames Chromium presented to the video between the press and 1.2 s after it. */
  frames: number;
  /** Main-thread time blocked by long tasks in that window, in milliseconds. */
  blocked: number;
}

/**
 * From now on, each video frame's presentation time and Chromium's count of presented frames,
 * the main thread's long tasks, and when the shutter was pressed: the evidence that decides
 * whether a "camera stopped" verdict after a press was true.
 */
async function recordFrames(page: Page): Promise<() => Promise<BurstEvidence>> {
  await video(page).evaluate((element: HTMLVideoElement) => {
    const frames: [number, number][] = [];
    const tasks: [number, number][] = [];
    const kept = window as unknown as {
      burst: { frames: typeof frames; tasks: typeof tasks; pressedAt?: number };
    };
    kept.burst = { frames, tasks };
    const next = () =>
      element.requestVideoFrameCallback((_, metadata) => {
        frames.push([metadata.presentationTime, metadata.presentedFrames]);
        next();
      });
    next();
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push([entry.startTime, entry.duration]);
    }).observe({ type: 'longtask' });
    document.addEventListener(
      'click',
      (event) => {
        if ((event.target as Element).closest?.('.camera-shutter'))
          kept.burst.pressedAt = performance.now();
      },
      { capture: true },
    );
  });
  return () =>
    page.evaluate(() => {
      const { frames, tasks, pressedAt } = (
        window as unknown as {
          burst: { frames: [number, number][]; tasks: [number, number][]; pressedAt: number };
        }
      ).burst;
      const end = pressedAt + 1200;
      // A frame callback can run late, and then reports the newest frame: count by presentation
      // time and by Chromium's counter, never by when the callback ran.
      const before =
        frames.filter(([time]) => time <= pressedAt).at(-1)?.[1] ?? frames[0]?.[1] ?? 0;
      const after = frames.find(([time]) => time >= end)?.[1] ?? frames.at(-1)?.[1] ?? before;
      const blocked = tasks.reduce(
        (sum, [start, duration]) =>
          sum + Math.max(0, Math.min(end, start + duration) - Math.max(pressedAt, start)),
        0,
      );
      return { frames: after - before, blocked: Math.round(blocked) };
    });
}

async function closeAndExpectReleased(page: Page) {
  await dialog(page).getByRole('button', { name: t.close, exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  const released = await page.evaluate(() => {
    const kept = window as unknown as { cameraStream: MediaStream; cameraVideo: HTMLVideoElement };
    return {
      cleared: kept.cameraVideo.srcObject === null,
      tracks: kept.cameraStream.getTracks().map((track) => track.readyState),
    };
  });
  expect(released.cleared).toBe(true);
  expect(released.tracks.length).toBeGreaterThan(0);
  expect(released.tracks.every((state) => state === 'ended')).toBe(true);
}

test("camera, Chromium's fake device: the real capture stack starts, frames flow, the shutter answers and closing ends the tracks", async ({
  page,
}, testInfo) => {
  await openCamera(page);
  const first = await track(page);
  await testInfo.attach('track', {
    body: JSON.stringify(first, null, 2),
    contentType: 'application/json',
  });
  // The video's intrinsic size is what the track says Chromium chose for the app's constraints,
  // a size the device offers.
  expect(first.videoWidth).toBeGreaterThan(0);
  expect(first.videoWidth).toBe(first.settings.width);
  expect(first.videoHeight).toBe(first.settings.height);
  expect(first.videoWidth).toBeLessThanOrEqual(first.maxWidth!);
  expect(first.videoHeight).toBeLessThanOrEqual(first.maxHeight!);
  // Frames really flow through the element (decoded frames and media time advance).
  await expect
    .poll(async () => {
      const now = await track(page);
      return now.decoded > first.decoded + 10 && now.time > first.time;
    })
    .toBe(true);
  // The status line has left 'Starting camera…' for advice about the live picture.
  await expect(status(page)).not.toHaveText(t.starting);
  expect([t.aim, t.blurry, t.dark, t.darkNoLight]).toContain(await status(page).textContent());
  // The light button shows exactly when the device reports a torch.
  await expect(dialog(page).getByRole('button', { name: t.light, exact: true })).toHaveCount(
    first.torch ? 1 : 0,
  );
  // A press is always answered: 'Hold still…' at once, then the second photo or a reason.
  // Chromium's default picture is a moving test card, so either outcome is acceptable.
  const seen = await recordStatus(page);
  const burstFrames = await recordFrames(page);
  const stopped = dialog(page).getByRole('alert').filter({ hasText: t.interrupted });
  await shutter(page).click();
  await expect
    .poll(async () => (await seen()).slice(1), { timeout: 10_000 })
    .toEqual(expect.arrayContaining([t.hold]));
  const answers = [t.sweep(4), t.retryBlurry, t.blurry, t.processing, t.review];
  await expect
    .poll(async () => {
      const texts = await seen();
      const answered = texts
        .slice(texts.indexOf(t.hold) + 1)
        .some((text) => answers.includes(text));
      return answered || (await stopped.count()) > 0;
    })
    .toBe(true);
  // The app may say the camera stopped only when no frame really arrived during the burst
  // (under heavy load a 2560 x 1920 software camera can stall); otherwise that is a false alarm.
  const evidence = await burstFrames();
  await testInfo.attach('burst', {
    body: JSON.stringify(evidence),
    contentType: 'application/json',
  });
  if (await stopped.count())
    expect(evidence, 'the app said the camera stopped, but frames kept arriving').toMatchObject({
      frames: 0,
    });
  await testInfo.attach('status line', {
    body: JSON.stringify(await seen()),
    contentType: 'application/json',
  });
  await closeAndExpectReleased(page);
});

/** YUV 4:2:0 (limited range BT.601) from RGBA, as a y4m frame body. */
function i420(rgba: Buffer, width: number, height: number): Buffer {
  const out = Buffer.alloc((width * height * 3) / 2);
  const u = width * height;
  const v = u + (width * height) / 4;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[y * width + x] = Math.round(
        16 + (65.481 * rgba[i]! + 128.553 * rgba[i + 1]! + 24.966 * rgba[i + 2]!) / 255,
      );
    }
  for (let y = 0; y < height; y += 2)
    for (let x = 0; x < width; x += 2) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const i = ((y + dy) * width + x + dx) * 4;
        r += rgba[i]! / 4;
        g += rgba[i + 1]! / 4;
        b += rgba[i + 2]! / 4;
      }
      const j = (y / 2) * (width / 2) + x / 2;
      out[u + j] = Math.round(128 + (-37.797 * r - 74.203 * g + 112 * b) / 255);
      out[v + j] = Math.round(128 + (112 * r - 93.786 * g - 18.214 * b) / 255);
    }
  return out;
}

test("camera, Chromium's fake device playing a filmed page: the outline is found and the reference photo is taken", async ({
  page,
  browser: own,
}, testInfo) => {
  test.setTimeout(120_000);
  // Film the photographed page on a table with the test camera, in a blank same-origin page.
  const width = 480;
  const height = 640;
  const frames = 12;
  await page.route('**/__score-camera/blank.html', (route) =>
    route.fulfill({ body: '<!doctype html><title>camera</title>', contentType: 'text/html' }),
  );
  await installPhotoCamera(page, { width, height });
  await page.goto('/__score-camera/blank.html');
  await expectCameraReady(page);
  const header = `YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`;
  const parts: Buffer[] = [Buffer.from(header, 'ascii')];
  for (let frame = 0; frame < frames; frame++) {
    const rgba = await page.evaluate(async () => {
      // Two animation frames: a newly drawn picture, with its own tremor and noise.
      for (let k = 0; k < 2; k++) await new Promise((resolve) => requestAnimationFrame(resolve));
      const canvas = window.scoreCamera.canvas;
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let text = '';
      for (let i = 0; i < data.length; i += 0x8000)
        text += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return btoa(text);
    });
    parts.push(Buffer.from('FRAME\n', 'ascii'), i420(Buffer.from(rgba, 'base64'), width, height));
  }
  // Chromium cannot open a capture file past Windows' 260-character path limit (the camera
  // then fails to start): a deep output folder writes it to the system temp folder instead.
  const output = testInfo.outputPath('filmed-page.y4m');
  const file =
    output.length < 200
      ? output
      : join(tmpdir(), `digitus2-${testInfo.testId}-${testInfo.repeatEachIndex}.y4m`);
  writeFileSync(file, Buffer.concat(parts));

  // Chromium's device now plays that file to the app, through its real capture stack.
  const browser = await own.browserType().launch({
    args: [...FLAGS, `--use-file-for-fake-video-capture=${file}`],
  });
  try {
    const use = testInfo.project.use;
    const context = await browser.newContext({
      baseURL: use.baseURL!,
      viewport: use.viewport ?? null,
      deviceScaleFactor: use.deviceScaleFactor ?? 1,
      ...(use.userAgent ? { userAgent: use.userAgent } : {}),
      isMobile: true,
      hasTouch: true,
      permissions: ['camera'],
      serviceWorkers: 'block',
    });
    const filmed = await context.newPage();
    await openCamera(filmed);
    const settings = await track(filmed);
    await testInfo.attach('track', {
      body: JSON.stringify(settings, null, 2),
      contentType: 'application/json',
    });
    expect({ width: settings.videoWidth, height: settings.videoHeight }).toEqual({ width, height });
    // Real notation on a real table: the page is outlined, the advice is to take the photo,
    // and the press takes the reference.
    await expect(dialog(filmed).locator('polygon[data-camera-page]')).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(status(filmed)).toHaveText(t.aim);
    await shutter(filmed).click();
    await expect(dialog(filmed).getByText(t.step(2, 5), { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(status(filmed)).toHaveText(t.sweep(4));
    await closeAndExpectReleased(filmed);
    await context.close();
  } finally {
    await browser.close();
    if (file !== output) rmSync(file, { force: true });
  }
});
