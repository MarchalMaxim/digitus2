import { expect, test } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { libraryScore, mxlOf, utf16leOf } from './helpers/files.js';
import { expectOneRed } from './helpers/red.js';
import { archiveSample, libraryReady, openLibraryPiece, showPiece } from './helpers/library.js';

test('opens Twinkle from the library: every note gets a digit, one red element, hash set', async ({
  page,
}) => {
  await page.goto('/');
  await openLibraryPiece(page, 'twinkle-twinkle-little-star');
  await expect(page).toHaveURL(/#\/piece\/twinkle-twinkle-little-star$/);
  await expect(page.locator('.score-sheet svg').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Twinkle, Twinkle, Little Star' }),
  ).toBeVisible();
  const roots = await expectOneRed(page, 'score ready');
  expect(roots[0]!.tag).toBe('button');
  await expectNoSeriousA11y(page, 'score ready');
});

// MuseScore archive pieces are stored as gzip (`.musicxml.gz`). A server may send such a file with
// Content-Encoding: gzip (the browser then hands over plain XML) or without it (the app gunzips): this
// opens one piece from three levels through the production build, whichever the server does.
for (const level of [1, 4, 6]) {
  test(`an archive piece of level ${level} opens with its fingerings, its credit and no error`, async ({
    page,
  }) => {
    const piece = archiveSample(level);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(`/#/piece/${piece.slug}`);
    await expect(page.locator('.score-sheet g.fing').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(piece.title);
    await expect(page.getByText('MuseScore, via the PDMX dataset')).toBeVisible();
    await expectOneRed(page, `archive piece of level ${level}`);
    expect(errors).toEqual([]);
  });
}

test('hand size change re-solves in place and keeps one red element', async ({ page }) => {
  await page.goto('/#/piece/twinkle-twinkle-little-star');
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  await page.getByLabel('Hand size').selectOption('child');
  // The timing line lives behind the side panel's Details toggle (polish plan Task 5).
  await page
    .locator('.side-panel summary')
    .filter({ hasText: /^Details$/ })
    .click();
  await expect(page.getByText(/Fingered in \d+ ms/)).toBeVisible();
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64);
  await expectOneRed(page, 'score after re-solve');
});

// Polish plan Task 6, review S9: the hand sizes had no word on what they change, and "Child"
// can read as an easier mode. One line under the select says it, and describes the select.
test('the hand size says what it changes, right under the select', async ({ page }) => {
  const HELP =
    'Hand size changes the stretches the fingering allows. Choose child or small for small hands.';
  await page.goto('/#/piece/twinkle-twinkle-little-star');
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  const select = page.getByLabel('Hand size');
  const help = page.locator('.side-panel').getByText(HELP, { exact: true });
  await expect(help).toBeVisible();
  await expect(select).toHaveAccessibleDescription(HELP);
  const s = (await select.boundingBox())!;
  const h = (await help.boundingBox())!;
  expect(h.y, 'under the select').toBeGreaterThanOrEqual(s.y + s.height);
  expect(h.y - (s.y + s.height), 'right under it').toBeLessThan(16);
  const roots = await expectOneRed(page, 'score with the hand size help');
  expect(roots[0]!.tag).toBe('button');
  await expectNoSeriousA11y(page, 'score with the hand size help');
});

test("editor's fingering toggle shows the editorial digits for a piece that has them", async ({
  page,
}) => {
  await page.goto('/#/piece/burgmuller-op100-no2-arabesque');
  await expect(page.locator('.score-sheet svg').first()).toBeVisible({ timeout: 20_000 });
  const engineCount = await page.locator('.score-sheet g.fing').count();
  await page.getByLabel("Show the editor's fingering").check();
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(26, { timeout: 20_000 });
  await page.getByLabel("Show the editor's fingering").uncheck();
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(engineCount, { timeout: 20_000 });
});

// Polish plan Task 5 (review S4, S7 and S12): the score view says what the numbers mean, keeps the
// developer text out of the way, and says whose fingering the score shows.
const FINGER_LEGEND =
  'Finger numbers: 1 is the thumb and 5 the little finger, in both hands. The upper staff is the right hand, the lower staff the left.';
const EDITORIAL_LINE = "Showing the editor's fingering";
const MELODY = 'schumann-op68-no1-melody';
/** Melody's reader warnings: two duplicates the engine's reader drops (the review saw them). */
const MELODY_WARNING = /^note \d+: duplicate of note \d+ \(same hand, onset and pitch\), dropped$/;

test('the side panel explains the finger numbers and keeps timings and reader warnings behind Details', async ({
  page,
}) => {
  await page.goto(`/#/piece/${MELODY}`);
  await expect(page.locator('.score-sheet svg').first()).toBeVisible({ timeout: 20_000 });
  const panel = page.locator('.side-panel');
  await expect(panel.getByText(FINGER_LEGEND, { exact: true })).toBeVisible();

  // Closed by default: the toggle is there, the timing line and the warnings are not shown.
  const details = panel.locator('details');
  const summary = details.locator('summary');
  await expect(summary).toHaveText('Details');
  await expect(summary).toBeVisible();
  await expect(details).not.toHaveAttribute('open');
  const timing = panel.getByText(/^Fingered in \d+ ms · laid out in \d+ ms$/);
  const warnings = panel.getByText(MELODY_WARNING);
  await expect(timing).toHaveCount(1);
  await expect(timing).toBeHidden();
  await expect(warnings).toHaveCount(2);
  for (const w of await warnings.all()) await expect(w).toBeHidden();
  let roots = await expectOneRed(page, 'score with Details closed');
  expect(roots[0]!.tag).toBe('button');
  await expectNoSeriousA11y(page, 'score with Details closed');

  // Opened: both show, inside the disclosure.
  await summary.click();
  await expect(details).toHaveAttribute('open', '');
  await expect(timing).toBeVisible();
  for (const w of await warnings.all()) await expect(w).toBeVisible();
  roots = await expectOneRed(page, 'score with Details open');
  expect(roots[0]!.tag).toBe('button');
  await expectNoSeriousA11y(page, 'score with Details open');

  // And closed again.
  await summary.click();
  await expect(details).not.toHaveAttribute('open');
  await expect(timing).toBeHidden();
});

test("a line above the score says when the editor's fingering is shown, and only then", async ({
  page,
}) => {
  await page.goto('/#/piece/burgmuller-op100-no2-arabesque');
  await expect(page.locator('.score-sheet svg').first()).toBeVisible({ timeout: 20_000 });
  const digits = page.locator('.score-sheet g.fing');
  const engineCount = await digits.count();
  expect(engineCount).toBeGreaterThan(26);
  const line = page.getByText(EDITORIAL_LINE, { exact: true });
  await expect(line).toHaveCount(0);

  await page.getByLabel("Show the editor's fingering").check();
  await expect(line).toBeVisible({ timeout: 20_000 });
  // It follows the pages, not the checkbox: when it shows, the editor's 26 digits are on screen.
  expect(await digits.count()).toBe(26);
  // Above the score: in the score column, right before the sheet, wholly above it.
  const place = await page.evaluate((text) => {
    const el = [...document.querySelectorAll('.score-main p')].find((p) => p.textContent === text)!;
    const sheet = document.querySelector('.score-sheet')!;
    return {
      beforeSheet: el.nextElementSibling === sheet,
      bottom: el.getBoundingClientRect().bottom,
      sheetTop: sheet.getBoundingClientRect().top,
    };
  }, EDITORIAL_LINE);
  expect(place.beforeSheet).toBe(true);
  expect(place.bottom).toBeLessThanOrEqual(place.sheetTop);
  const roots = await expectOneRed(page, "editor's fingering shown");
  expect(roots[0]!.tag).toBe('button');
  await expectNoSeriousA11y(page, "editor's fingering shown");

  // Switched off, it goes with the editor's digits.
  await page.getByLabel("Show the editor's fingering").uncheck();
  await expect(line).toHaveCount(0, { timeout: 20_000 });
  expect(await digits.count()).toBe(engineCount);

  // The setting is kept across pieces; a piece without an editor's fingering shows the engine's
  // digits, and the line does not claim otherwise.
  await page.getByLabel("Show the editor's fingering").check();
  await expect(line).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await openLibraryPiece(page, 'twinkle-twinkle-little-star');
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  await expect(page.getByLabel("Show the editor's fingering")).toHaveCount(0);
  await expect(line).toHaveCount(0);
});

test('opens K.545: status appears first, score within 8 s', async ({ page }) => {
  await page.goto('/');
  const t0 = Date.now();
  await openLibraryPiece(page, 'mozart-sonata-k545-mvt1');
  await expect(page.getByRole('status')).toContainText(/Loading|Fingering|Preparing/);
  await expect(page.locator('.score-sheet svg').first()).toBeVisible({ timeout: 8_000 });
  expect(Date.now() - t0).toBeLessThan(8_000);
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(1288);
});

test('shows an error state with a way back when the file is not a score', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Open your own score').setInputFiles({
    name: 'bad.musicxml',
    mimeType: 'application/xml',
    buffer: Buffer.from('<nope/>'),
  });
  await expect(page.getByRole('alert')).toContainText(/could not open/i);
  await expectOneRed(page, 'score error');
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await libraryReady(page);
});

// Review Focus 1: what MuseScore and other editors export must open as well as plain MusicXML.
const ODE_NOTES = 83;
const TWINKLE_NOTES = 64;

test('opens a compressed .mxl archive chosen from the library: a digit on every note', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Open your own score').setInputFiles({
    name: 'ode-to-joy.mxl',
    mimeType: 'application/vnd.recordare.musicxml',
    buffer: mxlOf(libraryScore('ode-to-joy')),
  });
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(ODE_NOTES, { timeout: 20_000 });
  const roots = await expectOneRed(page, 'dropped .mxl ready');
  expect(roots[0]!.tag).toBe('button');
});

test('opens a UTF-16 MusicXML file with a byte-order mark: a digit on every note', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Open your own score').setInputFiles({
    name: 'twinkle-utf16.musicxml',
    mimeType: 'application/xml',
    buffer: utf16leOf(libraryScore('twinkle-twinkle-little-star')),
  });
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_NOTES, {
    timeout: 20_000,
  });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Twinkle, Twinkle, Little Star');
  const roots = await expectOneRed(page, 'dropped UTF-16 file ready');
  expect(roots[0]!.tag).toBe('button');
});

test('the focus follows the view: the heading of a piece opened with Enter, then the library', async ({
  page,
}) => {
  await page.goto('/');
  const heading = () => page.evaluate(() => document.activeElement?.closest('h1')?.textContent);
  await (await showPiece(page, 'twinkle-twinkle-little-star')).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/piece\/twinkle-twinkle-little-star$/);
  await expect.poll(heading).toBe('Twinkle, Twinkle, Little Star');
  // The next Tab starts inside the score view, not at the top of the document.
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_NOTES, {
    timeout: 20_000,
  });
  await page.keyboard.press('Tab');
  const afterHeading = await page.evaluate(() => {
    const h1 = document.querySelector('h1')!;
    const active = document.activeElement;
    return (
      active !== null &&
      active !== document.body &&
      (h1.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    );
  });
  expect(afterHeading).toBe(true);
  await page.getByRole('button', { name: 'Back to the library' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/$/);
  await expect.poll(heading).toBe('digitus2');
});

test('back to the library and browser back both work', async ({ page }) => {
  await page.goto('/');
  await openLibraryPiece(page, 'ode-to-joy');
  await expect(page.locator('.score-sheet svg').first()).toBeVisible({ timeout: 20_000 });
  await page.goBack();
  await libraryReady(page);
  await page.goForward();
  await expect(page.locator('.score-sheet svg').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await expect(page).toHaveURL(/#\/$/);
});
