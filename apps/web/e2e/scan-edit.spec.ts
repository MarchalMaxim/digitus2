import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { expectOneRed } from './helpers/red.js';
import { mockWorker, openFiles, RECOGNITION_WITH_ERRORS, scanOnePage } from './helpers/scan.js';
import { redBars, seekBar } from './helpers/seek.js';

// Correcting needs a recognition, and recognition needs the PC: these flows run as a PC window,
// at 360 px in the mobile project (the phone itself is scan-phone.spec.ts).
test.use({ hasTouch: false, isMobile: false });

const sheetNote = (page: Page, ordinal: number) => page.locator(`.scan-sheet [id="s${ordinal}"]`);
/**
 * A tap on a note as a reader makes it: at the note's centre, whatever lies on top there (a staff
 * line often does), which the review resolves to the nearest note.
 */
async function tap(page: Page, ordinal: number) {
  // Wait for the notation of the latest correction before reaching into it.
  await expect(page.locator('.scan-sheet')).toHaveAttribute('aria-busy', 'false');
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
}

test('scan edit: the late bar-2 tie is found, corrected explicitly, undone, reset and exported', async ({
  page,
}, testInfo) => {
  await mockWorker(page, RECOGNITION_WITH_ERRORS);
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
  await mockWorker(page, RECOGNITION_WITH_ERRORS);
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
  await mockWorker(page, RECOGNITION_WITH_ERRORS);
  await scanOnePage(page);
  await tap(page, 0);
  await expect(editor(page)).toContainText('Bar 1 · right hand · C5 quarter note');
  await expectOneRed(page, 'dark editor');
  await expectNoSeriousA11y(page, 'dark editor');
  await noOverflow(page);
});
