import { expect, test } from '@playwright/test';
import { libraryReady } from './helpers/library.js';
import { expectOneRed } from './helpers/red.js';

// Playing along (issue 182) needs Web MIDI, which Safari and every browser on an iPhone lack.
// This runs on Safari's engine (the `iphone` project: Playwright's WebKit on Linux and macOS in
// CI, or `node scripts/e2e-webkit.mjs` in Docker on a Windows host) with nothing faked: the
// library page is the same without the line, and nothing asks for MIDI.
test('the library shows no piano line without Web MIDI', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', "Chromium has Web MIDI; the line's absence is WebKit's");
  await page.goto('/');
  await libraryReady(page);
  expect(await page.evaluate(() => typeof navigator.requestMIDIAccess)).toBe('undefined');
  await expect(page.locator('.piano-line')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play along on your piano' })).toHaveCount(0);
  // The end line is there without it: the file chooser stays the last row.
  await expect(page.getByLabel('Open your own score')).toBeAttached();
  const roots = await expectOneRed(page, 'the library without Web MIDI');
  expect(roots[0]!.tag).toBe('button');
});
