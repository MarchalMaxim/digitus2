import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { expectOneRed } from './helpers/red.js';
import { LIBRARY_COUNT } from './helpers/library.js';

const twinkle = fileURLToPath(new URL('../fixtures/twinkle.mid', import.meta.url));
const counts = /^Right hand: \d+ notes · left hand: \d+ notes$/;

async function openTwinkleMidi(page: Page) {
  await page.goto('/');
  await page.getByLabel('choose a file').setInputFiles(twinkle);
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
}

/**
 * A hand split change opens the file again while the previous import stays on screen, so its
 * digits are there all along. To see the new import land, the pages on screen are marked before
 * the change; the new layout replaces them.
 */
async function markPages(page: Page) {
  await page
    .locator('.score-sheet svg')
    .evaluateAll((els) => els.forEach((e) => e.setAttribute('data-previous', '')));
}
async function reimported(page: Page) {
  await expect(page.locator('.score-sheet svg[data-previous]')).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
}

test('a dropped MIDI file opens with a finger on every note, the import facts and one red element', async ({
  page,
}) => {
  await openTwinkleMidi(page);
  await expect(page.getByRole('heading', { level: 1, name: 'twinkle' })).toBeVisible();
  await expect(
    page.getByText(
      'Imported from MIDI: notes quantized to a 16th-note grid; 0 % moved more than a 64th note',
    ),
  ).toBeVisible();
  await expect(page.getByText(counts)).toBeVisible();
  await expect(page.getByLabel('Hand split')).toHaveValue('auto');
  await expectOneRed(page, 'score from MIDI');
  await expectNoSeriousA11y(page, 'score from MIDI');
});

test('the hand split re-imports with a fixed split and Automatic restores the separation', async ({
  page,
}) => {
  await openTwinkleMidi(page);
  const automatic = (await page.getByText(counts).textContent())!;
  await markPages(page);
  await page.getByLabel('Hand split').selectOption({ label: 'C4' });
  await expect(page.getByText('Right hand: 42 notes · left hand: 22 notes')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  await reimported(page);
  await markPages(page);
  await page.getByLabel('Hand split').selectOption({ label: 'G4' });
  await expect(page.getByText('Right hand: 14 notes · left hand: 50 notes')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  await reimported(page);
  await expect(page.getByLabel('Hand split')).toHaveValue('67');
  await expectOneRed(page, 'score from MIDI with a fixed split');
  await markPages(page);
  await page.getByLabel('Hand split').selectOption('auto');
  await expect(page.getByText(automatic, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Hand split')).toHaveValue('auto');
  await reimported(page);
});

test('export of a MIDI source downloads the generated MusicXML with a fingering on every note', async ({
  page,
}) => {
  await openTwinkleMidi(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export MusicXML' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('twinkle.fingered.musicxml');
  const text = await readFile((await download.path())!, 'utf8');
  expect(text.match(/<fingering/g)).toHaveLength(64);
  expect(text).toContain('<work-title>twinkle</work-title>');
});

test('a broken MIDI file shows the error state with a way back', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('choose a file')
    .setInputFiles({ name: 'broken.mid', mimeType: 'audio/midi', buffer: Buffer.from('MThd') });
  // The error state says which file failed in its alert and gives the engine's reason as the
  // detail below it (M4's error layout).
  await expect(page.getByRole('alert')).toContainText('Could not open broken.mid.');
  await expect(page.getByText(/^Details: not a MIDI file/)).toBeVisible();
  await expectOneRed(page, 'broken MIDI');
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(LIBRARY_COUNT);
});
