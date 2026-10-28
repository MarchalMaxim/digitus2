import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectOneRed } from './helpers/red.js';
import {
  inOrder,
  mockService,
  recordService,
  RECOGNITION_WITH_ERRORS,
  scanOnePage,
} from './helpers/scan.js';

// The photo and the notation are linked (issue 130). A real page photo (1308 x 1600), and a
// recognition that places each note on it as homr does (`<!-- imgpos: x, y -->`): the late tie
// of bar 2 is a place to check, ringed in both views; pointing at a note in one view frames it in
// the other; a click on the photo selects the note there.
test.use({ hasTouch: false, isMobile: false });

const PHOTO = readFileSync(
  new URL('../../../research/omr/photos/boellmann-op28-page2-flat.jpeg', import.meta.url),
);
const WIDTH = 1308;
const HEIGHT = 1600;
/** Each note at its own place on the photo: a row of notes 60 px apart, staff by staff. */
function placed(xml: string): { xml: string; at: Array<{ x: number; y: number }> } {
  const at: Array<{ x: number; y: number }> = [];
  const out = xml.replace(/<note>([\s\S]*?)<\/note>/g, (_, body: string) => {
    const bass = body.includes('<staff>2</staff>');
    const p = { x: 200 + 60 * at.length, y: bass ? 500 : 400 };
    at.push(p);
    return `<note>${body}<!-- imgpos: ${p.x}, ${p.y} --></note>`;
  });
  return { xml: out, at };
}

/** The point of the photo element over the photo pixel `p`, scrolled into view (at 360 px the photo comes after the notation). */
async function onPhoto(photo: Locator, p: { x: number; y: number }, scroll = true) {
  if (scroll) await photo.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const box = (await photo.boundingBox())!;
  return { x: box.x + (p.x / WIDTH) * box.width, y: box.y + (p.y / HEIGHT) * box.height };
}
const photo = (page: Page) => page.locator('.scan-photo .scan-original-image');
/**
 * The centre of a note in the notation, scrolled into view: WebKit's Playwright refuses to hover or
 * click an SVG group as outside the viewport, so the mouse goes to the point instead.
 */
async function centreOf(note: Locator) {
  await note.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  return note.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
}

test('scan linked: places to check are ringed on the photo and in the notation, and each view points into the other', async ({
  page,
}, testInfo) => {
  const { xml, at } = placed(RECOGNITION_WITH_ERRORS);
  await mockService(page, xml);
  await scanOnePage(page, 'printed-score.jpeg', PHOTO);
  await expect(page.locator('.scan-sheet')).toHaveAttribute('aria-busy', 'false');

  // Rings: the same notes in both views.
  const sheetRings = page.locator('.scan-sheet circle.scan-mark');
  const photoRings = page.locator('.scan-photo-marks circle.scan-photo-mark');
  await expect(sheetRings.first()).toBeAttached();
  const rings = await sheetRings.count();
  expect(rings).toBeGreaterThan(0);
  await expect(photoRings).toHaveCount(rings);
  // Gray, not the accent.
  const stroke = await photoRings.first().evaluate((el) => getComputedStyle(el).stroke);
  expect(stroke).not.toMatch(/rgb\((2[0-9]{2}), [0-9]{1,2}, [0-9]{1,2}\)/);
  await expectOneRed(page, 'linked review before pointing');
  await page.screenshot({ path: testInfo.outputPath('linked.png'), fullPage: true });

  // Pointing at a note on the photo frames it in the notation.
  const third = await onPhoto(photo(page), at[2]!);
  await page.mouse.move(third.x, third.y);
  await expect(page.locator('.scan-hover-box')).toHaveCount(1);
  await page.mouse.move(0, 0);
  await expect(page.locator('.scan-hover-box')).toHaveCount(0);

  // Pointing at a note in the notation frames it on the photo.
  const s1 = await centreOf(page.locator('.scan-sheet [id="s1"]'));
  await page.mouse.move(s1.x, s1.y);
  await expect(page.locator('.scan-photo-focus')).toHaveCount(1);
  const frame = await page.locator('.scan-photo-focus').boundingBox();
  // Measured where the photo is now, wherever the hover scrolled the page.
  const second = await onPhoto(photo(page), at[1]!, false);
  expect(Math.abs(frame!.x + frame!.width / 2 - second.x)).toBeLessThan(4);
  expect(Math.abs(frame!.y + frame!.height / 2 - second.y)).toBeLessThan(4);

  // A click on the photo selects the note there: the editor opens on it, the red on it.
  // Measured again: hovering the notation may have scrolled the page.
  const target = await onPhoto(photo(page), at[2]!);
  await page.mouse.click(target.x, target.y);
  const editor = page.getByRole('region', { name: 'Correct the selected note' });
  await expect(editor).toBeVisible();
  await expect(page.locator('.scan-sheet [id="s2"]')).toHaveClass(/is-red/);
  await expectOneRed(page, 'a note selected from the photo');
  await page.screenshot({ path: testInfo.outputPath('selected-from-photo.png'), fullPage: true });
});

// Only one page of a batch is photographed again (issue 130): it alone goes to the scanner, and
// the correction made on another page stays on its note.
test('scan linked: one page of three is photographed again, alone, and the other pages keep their corrections', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = (n: number) =>
    readFileSync(new URL(`../fixtures/scan/owner-page-${n}.musicxml`, import.meta.url), 'utf8');
  const answers = [fixture(1), fixture(2), fixture(3), fixture(1)];
  const calls = recordService(page);
  await mockService(page, inOrder(answers));
  await page.goto('/');
  const photos = [1, 2, 3].map((n) => ({
    name: `page ${n}.jpeg`,
    mimeType: 'image/jpeg',
    buffer: Buffer.concat([PHOTO, Buffer.from(`page ${n}`)]),
  }));
  await page.locator('input[type=file]').first().setInputFiles(photos);
  await page.getByRole('button', { name: 'Scan this score' }).click();
  await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('.scan-sheet')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30_000,
  });
  const verdict = await page.locator('.scan-verdict').textContent();

  // A correction on the last page: its last note one step higher.
  const last = page.locator('.scan-sheet g.note').last();
  const id = await last.getAttribute('id');
  const at = await centreOf(last);
  await page.mouse.click(at.x, at.y);
  await page.getByRole('button', { name: 'Higher' }).click();
  await expect(page.getByText('Review corrections')).toBeVisible();

  // Page 2 alone, then a new photo of it.
  await page.getByRole('button', { name: /^Select page 2: / }).click();
  await page
    .getByLabel('Replace page 2 with a new photo')
    .setInputFiles({ name: 'page 2 again.jpeg', mimeType: 'image/jpeg', buffer: PHOTO });
  await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('.scan-sheet')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30_000,
  });
  expect(calls.filter((c) => c === 'POST /v1/recognize')).toHaveLength(4);
  // Page 2 now reads as page 1 did: the score changed, and the correction is still there.
  expect(await page.locator('.scan-verdict').textContent()).not.toBe(verdict);
  await page.getByText('Review corrections').click();
  await expect(page.locator('.scan-corrections ol li')).toHaveCount(1);
  expect(id).toMatch(/^s\d+$/);
});
