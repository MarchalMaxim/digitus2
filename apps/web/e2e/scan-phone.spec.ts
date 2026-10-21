import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { expectOneRed } from './helpers/red.js';
import { mockService, PNG } from './helpers/scan.js';
import { horizontalOverflow } from './helpers/overflow.js';

// A phone: touch only, 360 px. It photographs pages with the camera and scans them with the
// same one button as a PC, through the same scan service.
test.skip(({ isMobile }) => !isMobile, 'the phone path is checked on the mobile project');

const capture = (page: Page) => page.locator('input[type=file][capture]');
const photo = (tag: string) => ({
  name: 'image',
  mimeType: 'image/png',
  buffer: Buffer.concat([PNG, Buffer.from(tag)]),
});
const page1 = (step: string) =>
  `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note></measure></part></score-partwise>`;

test('scan on a phone: camera pages, thumb-sized tools, reading order and one Scan button', async ({
  page,
}, testInfo) => {
  const uploads: Buffer[] = [];
  await mockService(page, () => page1(uploads.length === 1 ? 'C' : 'D'), {
    onRecognize: async (request) => {
      uploads.push(request.postDataBuffer()!);
    },
  });
  await page.goto('/');
  // The library offers the camera only on a touch-only device.
  await expect(page.getByText('Photograph a printed score', { exact: true })).toBeVisible();
  await capture(page).setInputFiles(photo('first'));
  await expect(page.getByRole('heading', { name: 'From paper to piano' })).toBeVisible();
  await capture(page).setInputFiles(photo('second'));
  await expect(page.locator('.scan-page-list li')).toHaveCount(2);
  await expect(page.locator('.scan-page-caption').first()).toContainText(/^photo \d\d\.\d\d\.\d\d/);

  // No PC and no hand-off: the phone scans where it is.
  await expect(page.getByRole('button', { name: 'Connect to this PC' })).toHaveCount(0);
  await expect(page.getByText('Send photos', { exact: false })).toHaveCount(0);
  await expect(
    page.getByText(
      'Recognition runs on the project’s scanner on Google Cloud (Netherlands). Your page is sent there, recognized and then deleted.',
    ),
  ).toBeVisible();
  await expect(page.getByText('select a page, then move it', { exact: false })).toBeVisible();

  // The second photo is the first page: move it with the toolbar.
  await page.getByRole('button', { name: /^Select page 2: photo/ }).click();
  await page.getByRole('button', { name: 'Move page 2 earlier' }).click();
  for (const name of [
    'Rotate 90° clockwise',
    'Move page 1 earlier',
    'Move page 1 later',
    'Remove page 1',
  ]) {
    const box = (await page.getByRole('button', { name }).boundingBox())!;
    expect(box.width, name).toBeGreaterThanOrEqual(44);
    expect(box.height, name).toBeGreaterThanOrEqual(44);
  }
  await expectOneRed(page, 'phone pages');
  await expectNoSeriousA11y(page, 'phone pages');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('phone-pages.png'), fullPage: true });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expectOneRed(page, 'phone pages, dark');
  await expectNoSeriousA11y(page, 'phone pages, dark');
  await page.emulateMedia({ colorScheme: 'light' });

  // The pages go to the scanner in reading order: the moved second photo first.
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  await expect(page.locator('.scan-review svg').first()).toBeVisible();
  expect(uploads).toEqual([photo('second').buffer, photo('first').buffer]);
  await expectOneRed(page, 'phone review');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});
