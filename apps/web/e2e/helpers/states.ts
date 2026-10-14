import { expect, type Page } from '@playwright/test';

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
const SCORE_TIMEOUT = 20_000;

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
  // The count-in holds the cursor on the first notes (playback.spec covers it); play through.
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
        .setInputFiles({ name: 'x.mid', mimeType: 'audio/midi', buffer: Buffer.from('MThd') });
      await expect(
        page.getByText('MIDI import arrives in a later version. MusicXML files work today.'),
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
];
