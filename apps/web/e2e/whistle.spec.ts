import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { libraryReady } from './helpers/library.js';
import { horizontalOverflow } from './helpers/overflow.js';
import { expectOneRed } from './helpers/red.js';
import { openFiles } from './helpers/scan.js';
import { expectDigits } from './helpers/sheet.js';
import { fakeMicrophone, ODE_PITCHES, pitchNames, traceInk } from './helpers/whistle.js';

// Whistle a tune (issue 237) with a fake microphone: Chromium plays a synthetic whistle of the
// first two bars of Ode to Joy as its microphone, and the page opens it for real. The browser's
// launch arguments are per worker, so this spec has a browser of its own.
test.use({ launchOptions: { args: fakeMicrophone() }, hasTouch: false, isMobile: false });

const start = (page: Page) => page.getByRole('button', { name: 'Whistle a tune' });
const recording = (page: Page) => page.getByRole('group', { name: 'Recording' });
const stop = (page: Page) => recording(page).getByRole('button', { name: 'Stop' });
const sheetNote = (page: Page, ordinal: number) => page.locator(`.scan-sheet [id="s${ordinal}"]`);
const editor = (page: Page) => page.getByRole('region', { name: 'Correct the selected note' });

/**
 * The microphone plays 1 s of silence, 4.8 s of notes and silence to 7 s, and loops: Stop is
 * pressed on the way through it, once the clock shows six seconds, before the second pass.
 */
async function whistleThrough(page: Page) {
  await expect(recording(page)).toContainText('0:06', { timeout: 20_000 });
  await stop(page).click();
  await expect(page.getByRole('heading', { name: 'Recording' })).toBeVisible({ timeout: 20_000 });
}

/** Keeps every stream the page opens, to see that they are all released. */
async function watchStreams(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __streams: MediaStream[] };
    w.__streams = [];
    const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await open(constraints);
      w.__streams.push(stream);
      return stream;
    };
  });
}
const live = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) =>
        s.getTracks().filter((t) => t.readyState === 'live'),
      ).length,
  );

async function downloaded(page: Page, name: string): Promise<string> {
  await openFiles(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name }).click();
  return readFileSync((await (await pending).path())!, 'utf8');
}

test('whistling the first bars of Ode to Joy: notes to review, correct, finger and keep', async ({
  page,
}, testInfo) => {
  await watchStreams(page);
  await page.goto('/');
  await libraryReady(page);
  await expect(start(page)).toBeVisible();
  await expectOneRed(page, 'library with the whistle line');
  await expectNoSeriousA11y(page, 'library with the whistle line');
  expect(await live(page)).toBe(0);

  // The line becomes the recording: a live trace in ink, the time and Stop. Still one red.
  await start(page).click();
  await expect(recording(page)).toBeVisible();
  await expect(stop(page)).toBeFocused();
  await expect(recording(page)).toContainText('Whistle or hum, then press Stop.');
  await expect(start(page)).toHaveCount(0);
  await expect.poll(() => traceInk(page), { timeout: 20_000 }).toBeGreaterThan(0);
  expect(await live(page)).toBe(1);
  await expectOneRed(page, 'recording');
  await expectNoSeriousA11y(page, 'recording');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('recording.png') });
  await whistleThrough(page);
  await expect.poll(() => live(page)).toBe(0);

  // The review: the recording beside the notes, where a scan shows its photo.
  await expect(page.locator('.scan-filename')).toHaveText(/^Whistled tune \d\d\.\d\d\.\d\d\.wav$/);
  const player = page.locator('audio[controls]');
  await expect(player).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan again' })).toHaveCount(0);
  await expect(page.getByText('Experimental scan')).toHaveCount(0);
  await expect(page.locator('.scan-verdict')).toHaveText('2 bars · one staff');
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
  await expectOneRed(page, 'review of a recording');
  await expectNoSeriousA11y(page, 'review of a recording');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('review.png'), fullPage: true });

  // The recording is a real WAV the browser can play, as long as the sound it kept.
  const duration = await player.evaluate(
    (el: HTMLAudioElement) =>
      new Promise<number>((resolve) => {
        if (el.readyState >= 1) resolve(el.duration);
        else el.addEventListener('loadedmetadata', () => resolve(el.duration), { once: true });
      }),
  );
  expect(duration).toBeGreaterThan(5.5);

  // The notes are Ode to Joy's, brought down to the staff from the whistle's octave.
  expect(pitchNames(await downloaded(page, 'Download raw MusicXML'))).toEqual(ODE_PITCHES);

  // A correction works as on a scan: the last D is raised a step.
  await expect(page.locator('.scan-sheet')).toHaveAttribute('aria-busy', 'false');
  await sheetNote(page, 7).click({ force: true });
  await expect(editor(page)).toContainText('D4');
  await page.locator('.scan-sheet').focus();
  await page.keyboard.press('ArrowUp');
  await expect(editor(page)).toContainText('E4');
  await expect(page.getByText('1 correction', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(pitchNames(await downloaded(page, 'Download corrected MusicXML'))).toEqual([
    ...ODE_PITCHES.slice(0, 7),
    'E4',
  ]);

  // Use for fingerings: the score opens with a digit on every note.
  await page.getByRole('button', { name: 'Use for fingerings' }).click();
  await expectDigits(page, 8);

  // Back in the library, My scores keeps the recording under its name, corrections and all: it
  // is still there after the page is loaded anew, from the browser's own storage.
  await page.getByRole('button', { name: /^Back to (the )?library$/ }).click();
  await libraryReady(page);
  await page.getByText('My scores', { exact: true }).click();
  await expect(page.getByRole('button', { name: /^Open saved Whistled tune / })).toBeVisible();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await libraryReady(page);
  await page.getByText('My scores', { exact: true }).click();
  await page.getByRole('button', { name: /^Open saved Whistled tune / }).click();
  await expect(page.getByRole('heading', { name: 'Recording' })).toBeVisible();
  await expect(page.locator('audio[controls]')).toBeVisible();
  await expect(page.getByText('1 correction', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use for fingerings' })).toBeEnabled();
});

test('Escape cancels the recording, releases the microphone and puts the line back', async ({
  page,
}) => {
  await watchStreams(page);
  await page.goto('/');
  await libraryReady(page);
  await start(page).click();
  await expect(recording(page)).toBeVisible();
  expect(await live(page)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(recording(page)).toHaveCount(0);
  await expect(start(page)).toBeFocused();
  await expect.poll(() => live(page)).toBe(0);
  await expect(page.getByRole('heading', { name: 'Recording' })).toHaveCount(0);
});

test('Whistle again goes back to the library and records anew; the first stays in My scores', async ({
  page,
}) => {
  await watchStreams(page);
  await page.goto('/');
  await libraryReady(page);
  await start(page).click();
  await expect(recording(page)).toBeVisible();
  await whistleThrough(page);
  await page.getByRole('button', { name: 'Whistle again' }).click();
  await expect(recording(page)).toBeVisible();
  await expect(stop(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect.poll(() => live(page)).toBe(0);
  await page.getByText('My scores', { exact: true }).click();
  await expect(page.getByRole('button', { name: /^Open saved Whistled tune / })).toHaveCount(1);
});

test.describe('at 360 px', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('the line, the recording and the review fit the screen', async ({ page }) => {
    await page.goto('/');
    await libraryReady(page);
    await expect(start(page)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await start(page).click();
    await expect(recording(page)).toBeVisible();
    await expect.poll(() => traceInk(page), { timeout: 20_000 }).toBeGreaterThan(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectOneRed(page, 'recording at 360 px');
    await whistleThrough(page);
    await expect(page.locator('audio[controls]')).toBeVisible();
    const audio = await page.locator('audio[controls]').boundingBox();
    expect(audio!.x + audio!.width).toBeLessThanOrEqual(360);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectOneRed(page, 'review at 360 px');
  });
});
