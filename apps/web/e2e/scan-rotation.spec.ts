import { expect, test, type Page } from '@playwright/test';
import { mockService } from './helpers/scan.js';

// These flows run as a PC window (mouse, no camera), also at 360 px in the mobile project. A
// touch phone scans the same way; its camera and page tools are scan-phone.spec.ts.
test.use({ hasTouch: false, isMobile: false });

async function imageBytes(page: Page, jpeg = false) {
  return Buffer.from(
    await page.evaluate((jpeg) => {
      const canvas = document.createElement('canvas');
      canvas.width = jpeg ? 60 : 6;
      canvas.height = jpeg ? 40 : 4;
      const context = canvas.getContext('2d')!;
      for (const [index, shade] of [0, 80, 160, 240].entries()) {
        context.fillStyle = `rgb(${shade},${shade},${shade})`;
        context.fillRect(
          ((index % 2) * canvas.width) / 2,
          (Math.floor(index / 2) * canvas.height) / 2,
          canvas.width / 2,
          canvas.height / 2,
        );
      }
      return Array.from(
        Uint8Array.from(
          atob(canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 1).split(',')[1]!),
          (c) => c.charCodeAt(0),
        ),
      );
    }, jpeg),
  );
}
async function pixels(page: Page, bytes?: Buffer) {
  if (!bytes) await page.locator('.scan-original-image').waitFor({ state: 'visible' });
  return page.evaluate(
    async (encoded) => {
      const source = encoded
        ? await createImageBitmap(new Blob([new Uint8Array(encoded)], { type: 'image/png' }))
        : document.querySelector<HTMLImageElement>('.scan-original-image')!;
      if (source instanceof HTMLImageElement) await source.decode();
      const canvas = document.createElement('canvas');
      canvas.width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
      canvas.height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(source, 0, 0);
      if (source instanceof ImageBitmap) source.close();
      return {
        width: canvas.width,
        height: canvas.height,
        corners: [
          [0, 0],
          [canvas.width - 1, 0],
          [0, canvas.height - 1],
          [canvas.width - 1, canvas.height - 1],
        ].map(([x, y]) => context.getImageData(x!, y!, 1, 1).data[0]),
      };
    },
    bytes ? Array.from(bytes) : undefined,
  );
}

test('scan rotation changes actual preview and upload pixels; four turns restore exact bytes', async ({
  page,
}) => {
  const uploads: Buffer[] = [];
  await mockService(page, '', {
    onRecognize: async (request) => {
      uploads.push(request.postDataBuffer()!);
      return {
        status: 422,
        json: { state: 'failed', failure: { code: 'test', message: 'Rotation test only.' } },
      };
    },
  });
  await page.goto('/');
  const original = await imageBytes(page);
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'sideways.png', mimeType: 'image/png', buffer: original });
  await expect(page.getByRole('heading', { name: 'From paper to piano' })).toBeVisible();
  await page.getByRole('button', { name: 'Rotate 90° clockwise' }).click();
  await expect(page.getByRole('button', { name: 'Rotate 90° clockwise' })).toBeEnabled();
  await expect
    .poll(() => pixels(page))
    .toEqual({ width: 4, height: 6, corners: [160, 0, 240, 80] });
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByRole('alert')).toContainText('Rotation test only.');
  expect(await pixels(page, uploads[0])).toEqual({
    width: 4,
    height: 6,
    corners: [160, 0, 240, 80],
  });
  for (let turn = 0; turn < 3; turn++) {
    await page.getByRole('button', { name: 'Rotate 90° clockwise' }).click();
    await expect(page.getByRole('button', { name: 'Rotate 90° clockwise' })).toBeEnabled();
  }
  await expect
    .poll(() => pixels(page))
    .toEqual({ width: 6, height: 4, corners: [0, 80, 160, 240] });
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect.poll(() => uploads.length).toBe(2);
  expect(uploads[1]).toEqual(original);
});

test('scan rotation honors JPEG EXIF orientation and only changes the selected page', async ({
  page,
}) => {
  const uploads: Buffer[] = [];
  await mockService(page, '', {
    onRecognize: async (request) => {
      uploads.push(request.postDataBuffer()!);
      return {
        status: 422,
        json: { state: 'failed', failure: { code: 'test', message: 'Rotation test only.' } },
      };
    },
  });
  await page.goto('/');
  const original = await imageBytes(page);
  const jpeg = await imageBytes(page, true);
  // EXIF orientation 6: the camera pixels display 90° clockwise before a user turn.
  const exif = Buffer.from(
    'ffe1002245786966000049492a0008000000010012010300010000000600000000000000',
    'hex',
  );
  const phonePhoto = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
  await page.locator('input[type=file]').setInputFiles([
    { name: 'first.png', mimeType: 'image/png', buffer: original },
    { name: 'phone.jpg', mimeType: 'image/jpeg', buffer: phonePhoto },
  ]);
  await page.getByRole('button', { name: 'Select page 2: phone.jpg' }).click();
  await expect.poll(() => pixels(page).then((p) => [p.width, p.height])).toEqual([40, 60]);
  await page.getByRole('button', { name: 'Rotate 90° clockwise' }).click();
  await expect(page.getByRole('button', { name: 'Rotate 90° clockwise' })).toBeEnabled();
  await expect.poll(() => pixels(page).then((p) => [p.width, p.height])).toEqual([60, 40]);
  const turned = await pixels(page);
  for (const [index, expected] of [240, 160, 80, 0].entries())
    expect(Math.abs(turned.corners[index]! - expected)).toBeLessThan(8);
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect.poll(() => uploads.length).toBe(2);
  expect(uploads[0]).toEqual(original);
  expect(await pixels(page, uploads[1])).toEqual(turned);
  await expect(page.locator('.scan-page-list li').nth(1)).toContainText('phone.jpg');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test('scan rotation encoding failures keep the current image usable', async ({ page }) => {
  await page.goto('/');
  const original = await imageBytes(page);
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'source.png', mimeType: 'image/png', buffer: original });
  const before = await pixels(page);
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      callback(null);
    };
  });
  await page.getByRole('button', { name: 'Rotate 90° clockwise' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be rotated');
  expect(await pixels(page)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Scan this score' })).toBeEnabled();
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      callback(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]));
    };
  });
  await page.getByRole('button', { name: 'Rotate 90° clockwise' }).click();
  await expect(page.getByRole('alert')).toContainText('exceeds 10 MB');
  expect(await pixels(page)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Rotate 90° clockwise' })).toBeEnabled();
});
