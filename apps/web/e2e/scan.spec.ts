import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { SCAN_SERVICE } from '../src/scan/service.js';
import {
  blockService,
  mockService,
  openFiles,
  RECOGNITION_WITH_ERRORS,
  recordService,
  serviceCall,
} from './helpers/scan.js';
import { libraryScore } from './helpers/files.js';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { expectOneRed } from './helpers/red.js';
import { horizontalOverflow } from './helpers/overflow.js';

// These flows run as a PC window (mouse, no camera), also at 360 px in the mobile project. A
// touch phone scans the same way; its camera and thumb-sized page tools are scan-phone.spec.ts.
test.use({ hasTouch: false, isMobile: false });

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
  'base64',
);
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
  let secondAttempts = 0;
  const xml = (step: string) =>
    `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note id="n1"><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note></measure></part></score-partwise>`;
  await mockService(
    page,
    (request) => xml(request.postDataBuffer()!.equals(firstPhoto) ? 'C' : 'D'),
    {
      onRecognize: async (request) => {
        const upload = request.postDataBuffer()!;
        uploads.push(upload);
        // The second photo fails once, then succeeds on the retry.
        if (upload.equals(secondPhoto) && ++secondAttempts === 1)
          return {
            status: 422,
            json: {
              state: 'failed',
              failure: { code: 'not-recognized', message: 'Page too blurry.' },
            },
          };
      },
    },
  );
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
  await openFiles(page);
  await page.getByRole('button', { name: 'Download combined MusicXML' }).click();
  const download = await downloading;
  const content = readFileSync((await download.path())!, 'utf8');
  expect(content.match(/<measure /g) ?? []).toHaveLength(2);
  expect(content.indexOf('<step>C</step>')).toBeLessThan(content.indexOf('<step>D</step>'));
  await expectOneRed(page, 'combined scan review');
  await expectNoSeriousA11y(page, 'combined scan review');
  await page.screenshot({ path: testInfo.outputPath('combined-review.png'), fullPage: true });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('scan: the warm-up happens on arrival, the page goes only on Scan', async ({
  page,
}, testInfo) => {
  const calls = recordService(page);
  let uploaded: Buffer | null = null;
  let headers: Record<string, string> = {};
  await mockService(page, libraryScore('twinkle-twinkle-little-star').toString('utf8'), {
    onRecognize: async (request) => {
      uploaded = request.postDataBuffer();
      headers = await request.allHeaders();
    },
  });
  await choose(page);
  // Exactly one request on arrival, the health warm-up: the page itself is not sent yet.
  await expect.poll(() => calls).toEqual(['GET /v1/health']);
  await expect(page.getByRole('button', { name: 'Connect to this PC' })).toHaveCount(0);
  await expect(
    page.getByText(
      'Recognition runs on the project’s scanner on Google Cloud (Netherlands). Your page is sent there, recognized and then deleted.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'How scanning works' })).toBeVisible();
  await expectOneRed(page, 'scan intro');
  expect(calls).toEqual(['GET /v1/health']);
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.locator('.scan-review svg').first()).toBeVisible();
  expect(calls).toEqual(['GET /v1/health', 'POST /v1/recognize']);
  expect(uploaded).toEqual(png);
  expect(headers['x-digitus2-client']).toBe('1');
  expect(headers['x-digitus2-job']).toMatch(/^[a-f0-9]{32}$/);
  expect(headers['content-type']).toBe('image/png');
  await expect(page.locator('.scan-review g.fing')).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  if (testInfo.project.name === 'desktop')
    await page.screenshot({
      path: '../../research/omr/results/multi-image/review-without-checkbox.png',
      fullPage: true,
    });
  const downloading = page.waitForEvent('download');
  await openFiles(page);
  await page.getByRole('button', { name: 'Download raw MusicXML' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('printed-score-recognized.musicxml');
  await expectOneRed(page, 'scan review');
  await expectNoSeriousA11y(page, 'scan review');
  await page.getByRole('button', { name: 'Use for fingerings' }).click();
  await expect(page.locator('.score-sheet g.fing').first()).toBeVisible();
  const serviceCalls = calls.length;
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  expect(calls).toHaveLength(serviceCalls);
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  await page.getByRole('button', { name: 'Use for fingerings' }).click();
  await expect(page.locator('.score-sheet g.fing').first()).toBeVisible();
  await page.getByRole('button', { name: 'Scan source and recognition' }).click();
  await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  await openFiles(page);
  await expect(page.getByRole('button', { name: 'Download raw MusicXML' })).toBeVisible();
  expect(calls).toHaveLength(serviceCalls);
});

test('scan: a scanner that does not answer is reported and the scan can be retried', async ({
  page,
}) => {
  // Google's answers in front of the service (billing off, its 429 and 5xx) carry no CORS
  // header: the page sees a failed request while the device is online.
  await blockService(page);
  await choose(page);
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'The scanner could not answer. Try again later.',
  );
  await expect(page.getByRole('button', { name: 'Scan this score' })).toBeEnabled();
});

test('scan: an offline device is told to check its connection', async ({ page }) => {
  await blockService(page);
  await choose(page);
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Could not reach the scanner. Check your connection and try again.',
  );
  await expect(page.getByRole('button', { name: 'Scan this score' })).toBeEnabled();
  await page.context().setOffline(false);
});

test('scan: a scanner busy past the wait says so and keeps the button', async ({ page }) => {
  await mockService(page, '', {
    onRecognize: async () => ({ status: 429, json: { error: 'busy' } }),
  });
  // The app waits up to three minutes for a busy scanner; the page's clock skips them.
  await page.clock.install();
  await choose(page);
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByText(/Another score is being scanned/)).toBeVisible();
  // Each offer is a real round trip: step the clock until the app gives up.
  await expect(async () => {
    await page.clock.runFor(5_000);
    await expect(page.getByRole('alert')).toContainText('busy', { timeout: 250 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByText(/Another score is being scanned/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Scan this score' })).toBeEnabled();
});

test('scan: a scanner busy with another score is waited for, then the bar runs', async ({
  page,
}) => {
  // The first offer finds the scanner busy; the second is taken and held until the bar is seen.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const jobs: string[] = [];
  await mockService(page, RECOGNITION_WITH_ERRORS, {
    onRecognize: async (request) => {
      jobs.push((await request.allHeaders())['x-digitus2-job']!);
      if (jobs.length === 1) return { status: 429, json: { error: 'busy' } };
      await held;
    },
  });
  await choose(page);
  await page.getByRole('button', { name: 'Scan this score' }).click();
  const waiting = page.getByText(
    'Another score is being scanned. Yours starts as soon as it finishes.',
  );
  await expect(waiting).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel scan' })).toBeEnabled();
  await expectOneRed(page, 'waiting for the scanner');
  // The same job is offered again a few seconds later; once taken, the bar replaces the line.
  const bar = page.getByRole('progressbar', { name: 'Recognition progress' });
  await expect(bar).toBeVisible({ timeout: 15_000 });
  await expect(waiting).toHaveCount(0);
  expect(jobs).toHaveLength(2);
  expect(jobs[1]).toBe(jobs[0]);
  await expect(page.getByText(/^About \d+ seconds$/)).toBeVisible();
  // The loader keeps the one red; the bar is ink.
  await expectOneRed(page, 'the scan bar');
  await expectNoSeriousA11y(page, 'the scan bar');
  release();
  await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  await expect(bar).toHaveCount(0);
});

test('scan: importer refusal retains raw output and blocks fingering use', async ({ page }) => {
  await mockService(
    page,
    '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><tie type="stop"/></note></measure></part></score-partwise>',
  );
  await choose(page);
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByRole('alert')).toContainText('cannot be used');
  await openFiles(page);
  await expect(page.getByRole('button', { name: 'Download raw MusicXML' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeDisabled();
});

test('scan: cancellation deletes the job and returns to retry', async ({ page }) => {
  // The service holds the recognition until the cancel arrives, then answers it as cancelled.
  await mockService(page, '', {
    onRecognize: async () => {
      await page.waitForRequest((request) => request.method() === 'DELETE');
      return { status: 409, json: { state: 'cancelled' } };
    },
  });
  await choose(page);
  const posting = page.waitForRequest((request) => serviceCall(request) === 'POST /v1/recognize');
  await page.getByRole('button', { name: 'Scan this score' }).click();
  const job = (await (await posting).allHeaders())['x-digitus2-job'];
  expect(job).toMatch(/^[a-f0-9]{32}$/);
  const deleting = page.waitForRequest((request) => request.method() === 'DELETE');
  await page.getByRole('button', { name: 'Cancel scan' }).click();
  expect((await deleting).url()).toBe(`${SCAN_SERVICE}/v1/jobs/${job}`);
  await expect(page.getByRole('button', { name: 'Scan this score' })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
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
  await mockService(page, xml.toString('utf8'), {
    onRecognize: async (request) => {
      uploaded = request.postDataBuffer();
    },
  });
  await page.goto('/');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'original.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByRole('img', { name: 'Original PDF, page 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Next original page' }).click();
  await expect(page.getByRole('img', { name: 'Original PDF, page 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  expect(uploaded).toEqual(pdf);
  const pending = page.waitForEvent('download');
  await openFiles(page);
  await page.getByRole('button', { name: 'Download raw MusicXML' }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(readFileSync(path!)).toEqual(xml);
  await expectOneRed(page, 'PDF raw review');
  await expectNoSeriousA11y(page, 'PDF raw review');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('scan: known native resolution failure explains the actual cause and stays retryable', async ({
  page,
}) => {
  await mockService(page, '', {
    onRecognize: async () => ({
      status: 422,
      json: {
        state: 'failed',
        failure: {
          code: 'staff-resolution-too-low',
          message:
            'The staff lines are only 6 pixels apart. Use the full-resolution original photo or the original PDF.',
          details: { interlinePixels: 6 },
        },
      },
    }),
  });
  await choose(page);
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByRole('alert')).toContainText('6 pixels');
  await expect(page.getByRole('alert')).toContainText('full-resolution');
  await expect(page.getByRole('button', { name: 'Scan this score' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download raw MusicXML' })).toHaveCount(0);
});
