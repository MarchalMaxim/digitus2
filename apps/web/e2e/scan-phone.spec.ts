import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { expectOneRed } from './helpers/red.js';
import { PNG } from './helpers/scan.js';

// A phone: touch only, 360 px. Its 127.0.0.1 is the phone itself, so it never reaches the PC
// worker; it photographs pages and hands them to the reader for the PC.
test.skip(({ isMobile }) => !isMobile, 'the phone path is checked on the mobile project');

const capture = (page: Page) => page.locator('input[type=file][capture]');
const photo = (tag: string) => ({ name: 'image', mimeType: 'image/png', buffer: Buffer.concat([PNG, Buffer.from(tag)]) });

async function photographTwoPages(page: Page) {
  let connections = 0;
  await page.route('http://127.0.0.1:8996/**', (route) => {
    connections++;
    return route.abort();
  });
  await page.goto('/');
  // The library offers the camera only on a touch-only device.
  await expect(page.getByText('Take a photo', { exact: true })).toBeVisible();
  await capture(page).setInputFiles(photo('first'));
  await expect(page.getByRole('heading', { name: 'From paper to piano' })).toBeVisible();
  await capture(page).setInputFiles(photo('second'));
  await expect(page.locator('.scan-page-list li')).toHaveCount(2);
  await expect(page.locator('.scan-page-caption').first()).toContainText(/^photo \d\d\.\d\d\.\d\d/);
  return () => connections;
}

test('scan on a phone: camera pages, thumb-sized tools, and an honest hand-off with no PC connection', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    // Without a share sheet the photos are saved as files.
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
  const connections = await photographTwoPages(page);
  await expect(page.getByRole('button', { name: 'Connect to this PC' })).toHaveCount(0);
  await expect(page.getByText('a phone cannot reach it', { exact: false })).toBeVisible();
  await expect(page.getByText('select a page, then move it', { exact: false })).toBeVisible();

  // The second photo is the first page: move it with the toolbar.
  await page.getByRole('button', { name: /^Select page 2: photo/ }).click();
  await page.getByRole('button', { name: 'Move page 2 earlier' }).click();
  for (const name of ['Rotate 90° clockwise', 'Move page 1 earlier', 'Move page 1 later', 'Remove page 1']) {
    const box = (await page.getByRole('button', { name }).boundingBox())!;
    expect(box.width, name).toBeGreaterThanOrEqual(44);
    expect(box.height, name).toBeGreaterThanOrEqual(44);
  }
  await expectOneRed(page, 'phone pages');
  await expectNoSeriousA11y(page, 'phone pages');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('phone-pages.png'), fullPage: true });

  const names: string[] = [];
  page.on('download', (download) => names.push(download.suggestedFilename()));
  await page.getByRole('button', { name: 'Save photos' }).click();
  await expect(page.getByText('Photos saved to this device.', { exact: false })).toBeVisible();
  await expect.poll(() => names.length).toBe(2);
  expect(names[0]).toMatch(/^page-01-photo .*\.png$/);
  expect(names[1]).toMatch(/^page-02-photo .*\.png$/);
  expect(connections()).toBe(0);

  await page.emulateMedia({ colorScheme: 'dark' });
  await expectOneRed(page, 'phone pages, dark');
  await expectNoSeriousA11y(page, 'phone pages, dark');
});

test('scan on a phone: the share sheet receives the pages in reading order', async ({ page }) => {
  await page.addInitScript(() => {
    const shared: string[][] = [];
    (window as unknown as { shared: string[][] }).shared = shared;
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      value: (data: ShareData) => {
        shared.push((data.files ?? []).map((file) => file.name));
        return Promise.resolve();
      },
      configurable: true,
    });
  });
  await photographTwoPages(page);
  await page.getByRole('button', { name: 'Send photos to your PC' }).click();
  await expect(page.getByText('Photos handed over.', { exact: false })).toBeVisible();
  const shared = await page.evaluate(() => (window as unknown as { shared: string[][] }).shared);
  expect(shared).toHaveLength(1);
  expect(shared[0]!.map((name) => name.slice(0, 8))).toEqual(['page-01-', 'page-02-']);
});
