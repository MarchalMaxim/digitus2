import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { openPractice } from './practice.js';
import { holdPianoSamples } from './samples.js';

/**
 * The application states the design brief is checked in (M4 plan, Task 10): each a name, a way
 * to reach it from a fresh page, and the kind of element that must be the screen's one red.
 * Shared by `states.spec.ts` (one red, axe, no horizontal overflow, desktop and mobile) and
 * `visual.spec.ts` (screenshot baselines); Playwright forbids one spec importing another.
 */
export interface AppState {
  name: string;
  go: (page: Page) => Promise<void>;
  /** 'button': a single red button. 'cursor': the playback cursor's note groups in the sheet. */
  expectTag: 'button' | 'cursor';
}

const TWINKLE = 'twinkle-twinkle-little-star';
const TWINKLE_NOTES = 64;
const ARABESQUE = 'burgmuller-op100-no2-arabesque';
const ARABESQUE_EDITORIAL_DIGITS = 26;
/** Schumann's Melody: the engine's reader warns about two duplicate notes. */
const MELODY = 'schumann-op68-no1-melody';
const SCORE_TIMEOUT = 20_000;
/** The library's Twinkle as a two-track MIDI file (M6), dropped through the file chooser. */
const TWINKLE_MIDI = fileURLToPath(new URL('../../fixtures/twinkle.mid', import.meta.url));

async function library(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(30);
}

/** Twinkle with every note fingered; `query` adds e.g. `?audio=silent` before the hash. */
async function twinkleReady(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}#/piece/${TWINKLE}`);
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_NOTES, {
    timeout: SCORE_TIMEOUT,
  });
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
}

/** The engine's digits as printed, in document order (to see a re-solve land). */
function digits(page: Page): Promise<string> {
  return page
    .locator('.score-sheet g.fing')
    .evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? '').join(','));
}

async function playing(page: Page): Promise<void> {
  await twinkleReady(page, '?audio=silent');
  // The count-in holds the first red note back (playback.spec covers it); play through.
  await openPractice(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.score-sheet .is-red').first()).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(800);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
}

export const STATES: AppState[] = [
  { name: 'library', go: library, expectTag: 'button' },
  {
    name: 'library-notice',
    go: async (page) => {
      await library(page);
      await page
        .getByLabel('choose a file')
        .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
      await expect(
        page.getByText(
          'That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).',
        ),
      ).toBeVisible();
    },
    expectTag: 'button',
  },
  {
    name: 'about',
    go: async (page) => {
      await page.goto('/#/about');
      await expect(page.getByRole('heading', { level: 1, name: 'About digitus2' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Back to the library' })).toBeVisible();
    },
    expectTag: 'button',
  },
  { name: 'score-ready', go: (page) => twinkleReady(page), expectTag: 'button' },
  {
    name: 'score-small-hand',
    go: async (page) => {
      await twinkleReady(page);
      const before = await digits(page);
      const timing = page.getByText(/Fingered in \d+ ms/);
      const timingBefore = await timing.textContent();
      await page.getByLabel('Hand size').selectOption('child');
      await expect(page.getByLabel('Hand size')).toHaveValue('child');
      // The re-solve has landed when the digits or the timing line change; Twinkle is short, so
      // either happens within a few frames of the worker's answer.
      await expect
        .poll(
          async () =>
            (await digits(page)) !== before || (await timing.textContent()) !== timingBefore,
          {
            timeout: 5_000,
          },
        )
        .toBe(true);
      await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_NOTES);
    },
    expectTag: 'button',
  },
  {
    name: 'score-editorial',
    go: async (page) => {
      await page.goto(`/#/piece/${ARABESQUE}`);
      await expect(page.locator('.score-sheet svg').first()).toBeVisible({
        timeout: SCORE_TIMEOUT,
      });
      await page.getByLabel("Show the editor's fingering").check();
      await expect(page.locator('.score-sheet g.fing')).toHaveCount(ARABESQUE_EDITORIAL_DIGITS, {
        timeout: SCORE_TIMEOUT,
      });
      // The line above the score says whose digits these are (polish plan, Task 5).
      await expect(page.getByText("Showing the editor's fingering", { exact: true })).toBeVisible();
    },
    expectTag: 'button',
  },
  {
    // The side panel's Details open: the solve and layout timings and the reader's warnings,
    // hidden by default (polish plan, Task 5). Melody has two warnings, long lines at 360 px.
    name: 'score-details',
    go: async (page) => {
      await page.goto(`/#/piece/${MELODY}`);
      await expect(page.locator('.score-sheet svg').first()).toBeVisible({
        timeout: SCORE_TIMEOUT,
      });
      const details = page.locator('.side-panel details');
      await details.locator('summary').click();
      await expect(details).toHaveAttribute('open', '');
      await expect(page.getByText(/^Fingered in \d+ ms · laid out in \d+ ms$/)).toBeVisible();
      await expect(details.getByText(/^note \d+: duplicate of note \d+/)).toHaveCount(2);
    },
    expectTag: 'button',
  },
  {
    // The first Play with the real instrument, its samples held back: Play stays red and busy,
    // and the status line in the dock says what is happening (polish plan, Task 3).
    name: 'score-loading-piano',
    go: async (page) => {
      await holdPianoSamples(page);
      await twinkleReady(page);
      await page.getByRole('button', { name: 'Play' }).click();
      await expect(page.getByRole('status')).toHaveText('Loading the piano…');
      await expect(page.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-busy', 'true');
    },
    expectTag: 'button',
  },
  {
    // The count-in: Pause is the red element and the status line counts; no note is red until
    // the first one sounds (polish plan, Task 3). At 50 % Twinkle counts four beats of 1.2 s,
    // which leaves the checks time to run inside the count-in.
    name: 'score-count-in',
    go: async (page) => {
      await twinkleReady(page, '?audio=silent');
      await openPractice(page);
      await expect(page.getByRole('checkbox', { name: 'Count-in' })).toBeChecked();
      await page.getByRole('slider', { name: 'Tempo' }).fill('50');
      await page.getByRole('button', { name: 'Play' }).click();
      await expect(page.getByRole('status')).toHaveText('1');
      await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
      await expect(page.locator('.score-sheet .is-red')).toHaveCount(0);
    },
    expectTag: 'button',
  },
  { name: 'score-playing', go: playing, expectTag: 'cursor' },
  {
    name: 'score-paused',
    go: async (page) => {
      await playing(page);
      await page.getByRole('button', { name: 'Pause' }).click();
      await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
      await expect(page.locator('.score-sheet .is-red')).toHaveCount(0);
      await expect(page.locator('.keyboard .is-pressed')).toHaveCount(0);
    },
    expectTag: 'button',
  },
  {
    name: 'score-loop',
    go: async (page) => {
      await twinkleReady(page);
      await openPractice(page);
      await page.getByLabel('Loop from bar').fill('2');
      await page.getByLabel('Loop to bar').fill('3');
      await expect(page.getByRole('button', { name: 'Clear loop' })).toBeEnabled();
    },
    expectTag: 'button',
  },
  {
    name: 'score-error',
    go: async (page) => {
      await library(page);
      await page.getByLabel('choose a file').setInputFiles({
        name: 'bad.musicxml',
        mimeType: 'application/xml',
        buffer: Buffer.from('<nope/>'),
      });
      await expect(page.getByRole('alert')).toContainText(/could not open/i);
      await expect(page.getByRole('button', { name: 'Back to the library' })).toBeVisible();
    },
    expectTag: 'button',
  },
  {
    name: 'score-midi',
    go: async (page) => {
      await page.goto('/');
      await page.getByLabel('choose a file').setInputFiles(TWINKLE_MIDI);
      await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_NOTES, {
        timeout: SCORE_TIMEOUT,
      });
    },
    expectTag: 'button',
  },
];
