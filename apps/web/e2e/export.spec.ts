import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { libraryScore, utf16leOf } from './helpers/files.js';

test('export downloads the fingered MusicXML with one fingering per note', async ({ page }) => {
  await page.goto('/#/piece/twinkle-twinkle-little-star');
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export MusicXML' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('twinkle-twinkle-little-star.fingered.musicxml');
  const path = await download.path();
  const text = (await import('node:fs/promises')).readFile(path!, 'utf8');
  expect((await text).match(/<fingering/g)).toHaveLength(64);
});

test('a dropped UTF-16 file exports as UTF-8 text that says so', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('choose a file').setInputFiles({
    name: 'twinkle-utf16.musicxml',
    mimeType: 'application/xml',
    buffer: utf16leOf(libraryScore('twinkle-twinkle-little-star')),
  });
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export MusicXML' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('twinkle-utf16.fingered.musicxml');
  const bytes = await readFile((await download.path())!);
  // UTF-8 bytes (no UTF-16 byte-order mark, no NUL bytes), declared as UTF-8.
  expect([bytes[0], bytes[1]]).toEqual([0x3c, 0x3f]);
  const text = bytes.toString('utf8');
  expect(text).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"/);
  expect(text).not.toMatch(/UTF-16/i);
  expect(text.match(/<fingering/g)).toHaveLength(64);
});

test('the print stylesheet hides the controls and keeps the score', async ({ page }) => {
  await page.goto('/#/piece/twinkle-twinkle-little-star');
  await expect(page.locator('.score-sheet svg').first()).toBeVisible({ timeout: 20_000 });
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('toolbar', { name: 'Playback' })).toBeHidden();
  await expect(page.locator('.keyboard')).toBeHidden();
  await expect(page.locator('.score-sheet svg').first()).toBeVisible();
  const red = await page
    .locator('.is-red')
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(red.every((c) => c !== 'rgb(227, 0, 15)')).toBe(true);
});
