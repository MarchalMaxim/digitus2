import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { libraryScore } from './helpers/files.js';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { expectOneRed } from './helpers/red.js';

// Recognition needs the PC worker, which a phone cannot reach: these flows run as a PC window,
// at 360 px in the mobile project. The phone's own path is scan-phone.spec.ts.
test.use({ hasTouch: false, isMobile: false });

const id = 'a'.repeat(32);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
  'base64',
);
const health = {
  protocol: 'digitus2-scan-v1',
  recognizer: 'test recognizer',
  capabilities: { textModelConfigured: true },
};
async function choose(page: Page) {
  await page.goto('/');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'printed-score.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('heading', { name: 'From paper to piano' })).toBeVisible();
}

test('scan: ordered image pages, accessible moves, partial retry and combined review', async ({
  page,
}, testInfo) => {
  const uploads: Buffer[] = [];
  const firstPhoto = Buffer.concat([png, Buffer.from('first')]);
  const secondPhoto = Buffer.concat([png, Buffer.from('second')]);
  const firstId = 'b'.repeat(32);
  const secondId = 'c'.repeat(32);
  let secondAttempts = 0;
  const xml = (step: string) =>
    `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note id="n1"><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note></measure></part></score-partwise>`;
  await page.route('http://127.0.0.1:8996/**', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.endsWith('/health')) await route.fulfill({ json: health });
    else if (request.method() === 'POST') {
      uploads.push(request.postDataBuffer()!);
      const next = uploads.length === 1 ? firstId : secondId;
      if (next === secondId) secondAttempts++;
      await route.fulfill({ status: 202, json: { id: next } });
    } else if (url.endsWith('/result'))
      await route.fulfill({ body: xml(url.includes(firstId) ? 'C' : 'D') });
    else if (request.method() === 'DELETE') await route.fulfill({ json: { state: 'cancelled' } });
    else if (url.endsWith(secondId) && secondAttempts === 1)
      await route.fulfill({ json: { state: 'failed', failure: { message: 'Page too blurry.' } } });
    else await route.fulfill({ json: { state: 'ready', ...health } });
  });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles([
    { name: 'second.png', mimeType: 'image/png', buffer: secondPhoto },
    { name: 'first.png', mimeType: 'image/png', buffer: firstPhoto },
  ]);
  await page
    .getByLabel('Add page images')
    .setInputFiles({ name: 'extra.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.scan-page-list li')).toHaveCount(3);
  await page.getByRole('button', { name: 'Select page 3: extra.png' }).click();
  await page.getByRole('button', { name: 'Remove page 3' }).click();
  await expect(page.locator('.scan-page-list li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Select page 2: first.png' }).click();
  await page.getByRole('button', { name: 'Move page 2 earlier' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.scan-page-list li').first()).toContainText('first.png');
  if (testInfo.project.name === 'desktop') {
    await page
      .locator('.scan-page-list li')
      .first()
      .dragTo(page.locator('.scan-page-list li').nth(1));
    await expect(page.locator('.scan-page-list li').first()).toContainText('second.png');
    await page.getByRole('button', { name: 'Move page 2 earlier' }).click();
  }
  await expectOneRed(page, 'image page ordering');
  await expectNoSeriousA11y(page, 'image page ordering');
  await page.screenshot({ path: testInfo.outputPath('image-ordering.png'), fullPage: true });
  await page.getByRole('button', { name: 'Connect to this PC' }).click();
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByText('Page too blurry.', { exact: false })).toBeVisible();
  await expect(page.locator('.scan-page-list li').first()).toContainText('Recognized');
  await expect(page.getByRole('button', { name: 'Retry failed pages' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry failed pages' }).click();
  await expect(page.locator('.scan-review svg').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  expect(uploads).toEqual([firstPhoto, secondPhoto, secondPhoto]);
  await page.getByRole('button', { name: 'Select page 1: first.png' }).click();
  await page.getByRole('button', { name: 'Select page 2: second.png' }).click();
  await expect(page.getByRole('img', { name: 'Original printed score, page 2' })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download combined MusicXML' }).click();
  const download = await downloading;
  const content = readFileSync((await download.path())!, 'utf8');
  expect(content.match(/<measure /g) ?? []).toHaveLength(2);
  expect(content.indexOf('<step>C</step>')).toBeLessThan(content.indexOf('<step>D</step>'));
  await expectOneRed(page, 'combined scan review');
  await expectNoSeriousA11y(page, 'combined scan review');
  await page.screenshot({ path: testInfo.outputPath('combined-review.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test('scan: deliberate connection, raw review, explicit use and retained provenance', async ({
  page,
}, testInfo) => {
  let requests = 0;
  let uploaded: Buffer | null = null;
  await page.route('http://127.0.0.1:8996/**', async (route) => {
    requests++;
    const request = route.request();
    if (request.url().endsWith('/health')) await route.fulfill({ json: health });
    else if (request.method() === 'POST') {
      uploaded = request.postDataBuffer();
      await route.fulfill({ status: 202, json: { id, state: 'running' } });
    } else if (request.url().endsWith('/result'))
      await route.fulfill({
        contentType: 'application/vnd.recordare.musicxml+xml',
        body: libraryScore('twinkle-twinkle-little-star'),
      });
    else await route.fulfill({ json: { state: 'ready', ...health } });
  });
  await choose(page);
  expect(requests).toBe(0);
  await expectOneRed(page, 'scan connection');
  await page.getByRole('button', { name: 'Connect to this PC' }).click();
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.locator('.scan-review svg').first()).toBeVisible();
  expect(uploaded).toEqual(png);
  await expect(page.locator('.scan-review g.fing')).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  if (testInfo.project.name === 'desktop')
    await page.screenshot({
      path: '../../research/omr/results/multi-image/review-without-checkbox.png',
      fullPage: true,
    });
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download raw MusicXML' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('printed-score-recognized.musicxml');
  await expectOneRed(page, 'scan review');
  await expectNoSeriousA11y(page, 'scan review');
  await page.getByRole('button', { name: 'Use for fingerings' }).click();
  await expect(page.locator('.score-sheet g.fing').first()).toBeVisible();
  const workerRequests = requests;
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  expect(requests).toBe(workerRequests);
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  await page.getByRole('button', { name: 'Use for fingerings' }).click();
  await expect(page.locator('.score-sheet g.fing').first()).toBeVisible();
  await page.getByRole('button', { name: 'Scan source and recognition' }).click();
  await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download raw MusicXML' })).toBeVisible();
});

test('scan: unavailable worker is recoverable and has on-demand setup', async ({ page }) => {
  await page.route('http://127.0.0.1:8996/**', (route) => route.abort());
  await choose(page);
  await expect(page.getByText('Keep that terminal open.', { exact: false })).not.toBeVisible();
  await page.getByRole('button', { name: 'Connect to this PC' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not connect');
  await expect(page.getByRole('button', { name: 'Connect to this PC' })).toBeEnabled();
  await page.getByText('Set up the PC worker', { exact: true }).click();
  await expect(page.locator('pre').first()).toBeVisible();
});

test('scan: importer refusal retains raw output and blocks fingering use', async ({ page }) => {
  await page.route('http://127.0.0.1:8996/**', async (route) => {
    const request = route.request();
    if (request.url().endsWith('/health'))
      await route.fulfill({
        json: {
          ...health,
          warnings: [
            { code: 'ocr-language-not-configured', message: 'English OCR is not configured.' },
          ],
        },
      });
    else if (request.method() === 'POST') await route.fulfill({ status: 202, json: { id } });
    else if (request.url().endsWith('/result'))
      await route.fulfill({
        body: '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><tie type="stop"/></note></measure></part></score-partwise>',
        contentType: 'application/xml',
      });
    else await route.fulfill({ json: { ...health, state: 'ready' } });
  });
  await choose(page);
  await page.getByRole('button', { name: 'Connect to this PC' }).click();
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByRole('alert')).toContainText('cannot be used');
  await expect(page.getByRole('button', { name: 'Download raw MusicXML' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeDisabled();
});

test('scan: cancellation deletes the job and returns to retry', async ({ page }) => {
  let deleted = false;
  await page.route('http://127.0.0.1:8996/**', async (route) => {
    if (route.request().method() === 'DELETE') {
      deleted = true;
      await route.fulfill({ json: { state: 'cancelling' } });
    } else if (route.request().url().endsWith('/health')) await route.fulfill({ json: health });
    else if (route.request().method() === 'POST')
      await route.fulfill({ status: 202, json: { id } });
    else await route.fulfill({ json: { state: 'running' } });
  });
  await choose(page);
  await page.getByRole('button', { name: 'Connect to this PC' }).click();
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await page.waitForRequest((request) => request.url().endsWith(id));
  await page.getByRole('button', { name: 'Cancel scan' }).click();
  await expect(page.getByRole('button', { name: 'Scan this score' })).toBeVisible();
  expect(deleted).toBe(true);
});

/** Tiny two-page vector PDF: local preview/pagination/upload boundary, not an accuracy fixture. */
function originalPdf(): Buffer {
  const drawing = '0 0 0 rg 20 20 80 80 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Contents 4 0 R >>',
    `<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Contents 6 0 R >>',
    `<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`,
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
    .join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

test('scan: local multipage PDF preview, original upload and exact raw export', async ({
  page,
}) => {
  const pdf = originalPdf();
  const xml = libraryScore('twinkle-twinkle-little-star');
  let uploaded: Buffer | null = null;
  await page.route('http://127.0.0.1:8996/**', async (route) => {
    const request = route.request();
    if (request.url().endsWith('/health')) await route.fulfill({ json: health });
    else if (request.method() === 'POST') {
      uploaded = request.postDataBuffer();
      await route.fulfill({ status: 202, json: { id } });
    } else if (request.url().endsWith('/result')) await route.fulfill({ body: xml });
    else await route.fulfill({ json: { ...health, state: 'ready' } });
  });
  await page.goto('/');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'original.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByRole('img', { name: 'Original PDF, page 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Next original page' }).click();
  await expect(page.getByRole('img', { name: 'Original PDF, page 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Connect to this PC' }).click();
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  expect(uploaded).toEqual(pdf);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download raw MusicXML' }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(readFileSync(path!)).toEqual(xml);
  await expectOneRed(page, 'PDF raw review');
  await expectNoSeriousA11y(page, 'PDF raw review');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test('scan: known native resolution failure explains the actual cause and stays retryable', async ({
  page,
}) => {
  await page.route('http://127.0.0.1:8996/**', async (route) => {
    if (route.request().url().endsWith('/health')) await route.fulfill({ json: health });
    else if (route.request().method() === 'POST')
      await route.fulfill({ status: 202, json: { id } });
    else
      await route.fulfill({
        json: {
          state: 'failed',
          failure: {
            code: 'staff-resolution-too-low',
            message:
              'The staff lines are only 6 pixels apart. Use the full-resolution original photo or the original PDF.',
            details: { interlinePixels: 6 },
          },
        },
      });
  });
  await choose(page);
  await page.getByRole('button', { name: 'Connect to this PC' }).click();
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByRole('alert')).toContainText('6 pixels');
  await expect(page.getByRole('alert')).toContainText('full-resolution');
  await expect(page.getByRole('button', { name: 'Scan this score' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download raw MusicXML' })).toHaveCount(0);
});
