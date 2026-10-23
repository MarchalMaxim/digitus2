import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { expectOneRed } from './helpers/red.js';
import {
  mockService,
  openFiles,
  RECOGNITION_MISREAD_METER,
  RECOGNITION_WITH_ERRORS,
  scanOnePage,
} from './helpers/scan.js';
import { redBars, seekBar } from './helpers/seek.js';
import { horizontalOverflow } from './helpers/overflow.js';

// Correcting needs a recognition: these flows run as a PC window (mouse, no camera), also at
// 360 px in the mobile project (the touch phone's camera and page tools are scan-phone.spec.ts).
test.use({ hasTouch: false, isMobile: false });

const sheetNote = (page: Page, ordinal: number) => page.locator(`.scan-sheet [id="s${ordinal}"]`);
/**
 * A tap on a note as a reader makes it: at the note's centre, whatever lies on top there (a staff
 * line often does), which the review resolves to the nearest note.
 */
async function tap(page: Page, ordinal: number, timeout?: number) {
  // Wait for the notation of the latest correction before reaching into it.
  await expect(page.locator('.scan-sheet')).toHaveAttribute(
    'aria-busy',
    'false',
    timeout === undefined ? {} : { timeout },
  );
  await sheetNote(page, ordinal).click({ force: true });
}
const editor = (page: Page) => page.getByRole('region', { name: 'Correct the selected note' });
async function downloaded(page: Page, name: string): Promise<string> {
  await openFiles(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name }).click();
  const download = await pending;
  return readFileSync((await download.path())!, 'utf8');
}
async function noOverflow(page: Page) {
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
}

test('scan edit: the late bar-2 tie is found, corrected explicitly, undone, reset and exported', async ({
  page,
}, testInfo) => {
  await mockService(page, RECOGNITION_WITH_ERRORS);
  await scanOnePage(page);
  // The strict import refuses the late tie; the raw result stays visible and downloadable.
  await expect(page.getByRole('alert').first()).toContainText('cannot be used for fingerings');
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeDisabled();
  await expect(page.getByText('Select a note to correct it.')).toBeVisible();
  await expect(editor(page)).toHaveCount(0);
  await expectOneRed(page, 'refused recognition before editing');

  // The place to check points at the tie and explains it.
  // Refused, the places to check open by themselves and the first one carries the red.
  await expect(page.locator('details.scan-problems')).toHaveAttribute('open', '');
  await page
    .getByRole('button', {
      name: 'Bar 1, right hand: the tied A4 ends 1 beat before the next A4 begins. Check the note lengths.',
    })
    .click();
  await expect(editor(page)).toContainText('Bar 1 · right hand · A4 quarter note · tied');
  await expect(sheetNote(page, 2)).toHaveClass(/is-red/);
  await expectOneRed(page, 'note selected');
  await expectNoSeriousA11y(page, 'note selected');
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('edit-selected.png'), fullPage: true });

  // Tying it again is refused with the reason: nothing of that pitch starts where it ends.
  await page.getByRole('button', { name: 'Tied to next' }).click();
  await page.getByRole('button', { name: 'Tied to next' }).click();
  await expect(editor(page)).toContainText('No A4 starts where this note ends');
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: 'Tied to next' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // The stray quarter rest in bar 2 goes; the left hand does not move.
  await tap(page, 4);
  await expect(editor(page)).toContainText('Bar 2 · right hand · quarter rest');
  await editor(page).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('1 correction', { exact: true })).toBeVisible();
  // Bar 2's right hand is now a beat short: the hands disagree, and the place to check says so.
  await expect(page.locator('.scan-problems summary')).toHaveText('1 place to check');
  await tap(page, 6);
  await expect(editor(page)).toContainText('Bar 2: right hand 2 beats, left hand 3 beats, in 3/4.');
  await editor(page).getByRole('button', { name: 'Half', exact: true }).click();
  // Once the hands agree the bar's timing is no longer said.
  await expect(editor(page)).not.toContainText('Bar 2: right hand');
  await expect(page.locator('.scan-problems')).toHaveCount(0);

  // The misread D5 in bar 3 is raised a step from the keyboard; Escape closes the editor.
  await tap(page, 9);
  await page.locator('.scan-sheet').focus();
  await page.keyboard.press('ArrowUp');
  await expect(editor(page)).toContainText('Bar 3 · right hand · E5 quarter note');
  await page.keyboard.press('ArrowRight');
  await expect(editor(page)).toContainText('Bar 3 · right hand · C5 quarter note');
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);

  // Revalidated: the corrected copy imports, and the red is back on Use for fingerings.
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  await expect(page.getByText('3 corrections', { exact: true })).toBeVisible();
  await page.getByText('Review corrections', { exact: true }).click();
  await expect(page.locator('.scan-corrections ol li')).toHaveText([
    'Bar 2, right hand: quarter rest removed',
    'Bar 2, right hand: B4 quarter note → half note',
    'Bar 3, right hand: D5 → E5',
  ]);
  await expectOneRed(page, 'corrected review');
  await expectNoSeriousA11y(page, 'corrected review');
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('edit-corrected.png'), fullPage: true });

  // Both copies download: the raw one byte for byte, the corrected one with the changes.
  expect(await downloaded(page, 'Download raw MusicXML')).toBe(RECOGNITION_WITH_ERRORS);
  const corrected = await downloaded(page, 'Download corrected MusicXML');
  expect(corrected).not.toContain('<rest/>');
  expect(corrected).toContain('<step>E</step><octave>5</octave>');
  expect(corrected).not.toContain('data-scan-note');

  // Undo one, reset all, and undo the reset.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('2 corrections', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset to recognition' }).click();
  await expect(page.locator('.scan-result p[aria-hidden="true"]')).toContainText(
    'All corrections removed.',
  );
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Download corrected MusicXML' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('2 corrections', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
});

test('scan edit: the corrected copy plays, notes there still seek, and My scores keeps both copies', async ({
  page,
}) => {
  await mockService(page, RECOGNITION_WITH_ERRORS);
  await scanOnePage(page, 'tie-page.png');
  await tap(page, 4);
  await editor(page).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('1 correction', { exact: true })).toBeVisible();
  await editor(page).getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  await page.getByRole('button', { name: 'Use for fingerings' }).click();
  await expect(page.locator('.score-sheet g.fing').first()).toBeVisible();
  // In the score view a click on a note still seeks to its bar; it never opens the editor.
  await seekBar(page, 2);
  await expect.poll(() => redBars(page)).toEqual([2]);
  await expect(page.getByRole('region', { name: 'Correct the selected note' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Scan source and recognition' }).click();
  await expect(page.getByText('1 correction', { exact: true })).toBeVisible();

  // After a reload, My scores reopens the raw recognition with its corrections.
  await page.reload();
  await page.getByText('My scores', { exact: true }).click();
  await expect(page.getByText('Corrected recognition', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open saved tie-page.png' }).click();
  await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible();
  await expect(page.getByText('1 correction', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  expect(await downloaded(page, 'Download raw MusicXML')).toBe(RECOGNITION_WITH_ERRORS);
});

test('scan edit: the editor speaks the screen language and stays clear of horizontal scroll in dark', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await mockService(page, RECOGNITION_WITH_ERRORS);
  await scanOnePage(page);
  await tap(page, 0);
  await expect(editor(page)).toContainText('Bar 1 · right hand · C5 quarter note');
  await expectOneRed(page, 'dark editor');
  await expectNoSeriousA11y(page, 'dark editor');
  await noOverflow(page);
});

test('scan edit: a misread 4/4 is set to 9/8 from its place to check, and no note moves', async ({
  page,
}, testInfo) => {
  await mockService(page, RECOGNITION_MISREAD_METER);
  await scanOnePage(page, 'nine-eight.png');
  // The bars import, so Use for fingerings keeps the red; the places to check stay folded.
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  await expect(page.locator('.scan-problems summary')).toHaveText('3 places to check');
  await page.locator('.scan-problems summary').click();
  await expect(
    page.getByRole('button', {
      name: 'The bar is longer than its time signature. Bar 1: right hand 4.5 beats, left hand 4.5 beats, in 4/4.',
    }),
  ).toBeVisible();
  // Offered once, under the first of the bars, never as a standing control.
  const offer = page.getByRole('button', { name: /^Set .* time from bar/ });
  await expect(offer).toHaveCount(1);
  await expect(offer).toHaveText('Set 9/8 time from bar 1');
  await expectOneRed(page, 'meter offered');
  await expectNoSeriousA11y(page, 'meter offered');
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('meter-offered.png'), fullPage: true });

  await offer.click();
  await expect(page.locator('.scan-problems')).toHaveCount(0);
  await expect(page.getByText('1 correction', { exact: true })).toBeVisible();
  await expect(page.locator('.scan-result p[aria-hidden="true"]')).toHaveText(
    'From bar 1: time signature 4/4 → 9/8.',
  );
  await page.getByText('Review corrections', { exact: true }).click();
  await expect(page.locator('.scan-corrections ol li')).toHaveText([
    'From bar 1: time signature 4/4 → 9/8',
  ]);
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  await expectOneRed(page, 'meter set');
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('meter-set.png'), fullPage: true });

  // Only the time signature changed: every note is the raw recognition's, byte for byte.
  const corrected = await downloaded(page, 'Download corrected MusicXML');
  expect(corrected).toContain('<time><beats>9</beats><beat-type>8</beat-type></time>');
  const notes = (xml: string) => xml.match(/<note>.*?<\/note>/g);
  expect(notes(corrected)).toEqual(notes(RECOGNITION_MISREAD_METER));

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.scan-problems summary')).toHaveText('3 places to check');
});

// Issue 161: homr says where in the photo it saw each note, and the review draws the photo there.
test('scan edit: a selected note shows the photo at its place', async ({ page }, testInfo) => {
  // The owner's page has 284 notes: its notation takes a loaded machine a while to draw.
  test.setTimeout(120_000);
  const owner = readFileSync(
    new URL('../fixtures/scan/owner-page-1.musicxml', import.meta.url),
    'utf8',
  );
  // Note 1 of the owner's first page, as homr placed it in the 1800 x 2200 photo it was given.
  const [x, y] = [...owner.matchAll(/<!-- imgpos: (\d+(?:\.\d+)?), (\d+(?:\.\d+)?) -->/g)][1]!
    .slice(1, 3)
    .map(Number) as [number, number];
  await page.goto('/');
  // A white photo with a black disc exactly where homr placed the note.
  const dataUrl = await page.evaluate(
    ({ x, y }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1800;
      canvas.height = 2200;
      const context = canvas.getContext('2d')!;
      context.fillStyle = 'white';
      context.fillRect(0, 0, 1800, 2200);
      context.fillStyle = 'black';
      context.beginPath();
      context.arc(x, y, 8, 0, 2 * Math.PI);
      context.fill();
      return canvas.toDataURL('image/png');
    },
    { x, y },
  );
  await mockService(page, owner);
  await scanOnePage(page, 'owner.png', Buffer.from(dataUrl.split(',')[1]!, 'base64'), 30_000);
  await tap(page, 1, 30_000);
  const crop = editor(page).getByRole('img', { name: 'Bar 1 in the photo' });
  await expect(crop).toBeVisible({ timeout: 30_000 });
  const centres = await crop.evaluate(async (el) => {
    const canvas = el.querySelector('canvas')!;
    const context = canvas.getContext('2d')!;
    // The disc is drawn once the photo is decoded: wait for dark pixels.
    let dark = { x: 0, y: 0, count: 0 };
    for (let attempt = 0; attempt < 50 && !dark.count; attempt++) {
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
      dark = { x: 0, y: 0, count: 0 };
      for (let row = 0; row < height; row++)
        for (let column = 0; column < width; column++) {
          const i = (row * width + column) * 4;
          if (0.3 * data[i]! + 0.59 * data[i + 1]! + 0.11 * data[i + 2]! < 100) {
            dark.x += column;
            dark.y += row;
            dark.count++;
          }
        }
      if (!dark.count) await new Promise((done) => setTimeout(done, 50));
    }
    const box = canvas.getBoundingClientRect();
    const frame = el.querySelector('.note-crop-frame')!.getBoundingClientRect();
    return {
      size: [canvas.width, canvas.height],
      dark: [dark.x / dark.count, dark.y / dark.count],
      frame: [frame.left + frame.width / 2 - box.left, frame.top + frame.height / 2 - box.top],
      box: [box.width, box.height],
    };
  });
  expect(Math.abs(centres.dark[0]! - centres.size[0]! / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(centres.dark[1]! - centres.size[1]! / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(centres.frame[0]! - centres.box[0]! / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(centres.frame[1]! - centres.box[1]! / 2)).toBeLessThanOrEqual(1);
  // A note stepped to stays clear of the editor docked below it: the margin the sheet keeps below
  // a note holds the editor, its photo included.
  const { editorHeight, margin } = await page.evaluate((id) => {
    const panel = document.querySelector('.note-editor')!;
    const note = document.getElementById(id)!;
    return {
      editorHeight: panel.getBoundingClientRect().height,
      margin: parseFloat(getComputedStyle(note).scrollMarginBottom),
    };
  }, 's1');
  expect(editorHeight).toBeLessThanOrEqual(margin);
  await expectOneRed(page, 'crop shown');
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('crop-selected.png'), fullPage: true });
});

// Issue 161: every place to check shows the photo at its note: above its text on a phone, beside it on a PC.
test('scan edit: a place to check shows the photo at its note, above its text on a phone and beside it on a PC', async ({
  page,
}, testInfo) => {
  let placed = 0;
  const xml = RECOGNITION_WITH_ERRORS.replace(
    /<note>/g,
    () => `<note><!-- imgpos: ${200 + 60 * placed++}, 400 -->`,
  );
  await page.goto('/');
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white';
    context.fillRect(0, 0, 1200, 1600);
    return canvas.toDataURL('image/png');
  });
  await mockService(page, xml);
  await scanOnePage(page, 'places.png', Buffer.from(dataUrl.split(',')[1]!, 'base64'));
  // Refused, the places to check open by themselves and the first one carries the red.
  const entry = page.locator('.scan-problems li').first();
  const crop = entry.locator('.note-crop-small');
  await expect(crop).toBeVisible();
  const text = entry.locator('.scan-problem-body');
  await expect(text.locator('.is-red')).toBeVisible();
  const [photo, body] = await Promise.all([crop.boundingBox(), text.boundingBox()]);
  expect(photo!.width).toBeGreaterThan(0);
  if ((page.viewportSize()?.width ?? 1280) <= 600) {
    // Above the text, inside the screen.
    expect(photo!.y + photo!.height).toBeLessThanOrEqual(body!.y + 1);
    expect(photo!.x + photo!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  } else {
    // Beside the text.
    expect(photo!.x + photo!.width).toBeLessThanOrEqual(body!.x + 1);
  }
  await expectOneRed(page, 'places to check with their photos');
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('places-crops.png'), fullPage: true });
});
