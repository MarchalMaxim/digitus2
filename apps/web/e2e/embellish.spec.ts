import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { libraryScore } from './helpers/files.js';
import { embellishDecided, openPractice, setLoopBars } from './helpers/practice.js';
import { expectOneRed } from './helpers/red.js';
import { mockWorker, scanOnePage } from './helpers/scan.js';
import { positionSec, redBars, redSettled, seekBar } from './helpers/seek.js';

// "Add notes between" (issue #67): a piece the guard offers gets one more tick box in the
// Practice panel. Ticked, the sheet, the red cursor and playback use the embellished score;
// unticked, the plain one comes back at the same bar. The box is absent on a piece with fewer
// than three figures, on a piece the guard refuses and on a scan import. No step waits a fixed
// time: the panel's `data-embellish` says when the decision is made. Desktop and phone alike.

const TWINKLE = 'twinkle-twinkle-little-star';
const TWINKLE_NOTES = 64;
/** Six upper neighbours, in bars 1, 3, 5, 7, 9 and 11. */
const TWINKLE_EMBELLISHED_NOTES = 70;
/** Twinkle at 100 qpm in 4/4: each bar lasts 2.4 s. */
const BAR_SEC = 2.4;
/** The added D4 in bar 1, on beat 1.5 (between the two Cs). */
const ADDED_NOTE_SEC = 0.3;
/** Its onset, in the score's ticks (10080 a quarter): what the cursor marks on its notes. */
const ADDED_NOTE_TICK = '5040';
const SCORE_TIMEOUT = 20_000;

/** The Practice panel, which says through `data-embellish` whether the switch is decided. */
function panel(page: Page): Locator {
  return page.locator('.practice-panel');
}

/** The switch, inside the Practice panel. */
function addNotes(page: Page): Locator {
  return panel(page).getByRole('checkbox', { name: 'Add notes between' });
}

function digits(page: Page): Locator {
  return page.locator('.score-sheet g.fing');
}

/** Twinkle ready with its 64 digits, the switch offered (the panel may still be closed). */
async function twinkle(page: Page): Promise<void> {
  await page.goto(`/?audio=silent#/piece/${TWINKLE}`);
  await expect(digits(page)).toHaveCount(TWINKLE_NOTES, { timeout: SCORE_TIMEOUT });
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  await embellishDecided(page, 'offered');
}

/**
 * Waits, on every frame, until the transport's position lies in [from, to): a window of a few
 * tenths of a second, which a poll at its default intervals can miss pass after pass.
 */
async function positionWithin(page: Page, from: number, to: number): Promise<void> {
  await page.waitForFunction(
    ([lo, hi]) => {
      const hook = (window as unknown as { __digitus2: { positionSec(): number } }).__digitus2;
      const p = hook.positionSec();
      return p >= lo! && p < hi!;
    },
    [from, to],
    { polling: 'raf', timeout: 10_000 },
  );
}

/** Ticks the switch and waits for the embellished score's 70 digits. */
async function switchOn(page: Page): Promise<void> {
  await openPractice(page);
  await addNotes(page).check();
  await expect(digits(page)).toHaveCount(TWINKLE_EMBELLISHED_NOTES);
}

test('the switch appears on Twinkle, adds notes and keeps one red', async ({ page }) => {
  await page.goto(`/?audio=silent#/piece/${TWINKLE}`);
  await expect(digits(page)).toHaveCount(TWINKLE_NOTES, { timeout: SCORE_TIMEOUT });
  await openPractice(page);
  await embellishDecided(page, 'offered');
  await expect(addNotes(page)).toBeVisible();
  await expect(addNotes(page)).not.toBeChecked();
  await expectOneRed(page, 'offered');

  await addNotes(page).check();
  await expect(digits(page)).toHaveCount(TWINKLE_EMBELLISHED_NOTES);
  await expect(page.locator('.score-sheet g.note')).toHaveCount(TWINKLE_EMBELLISHED_NOTES);
  await expect(addNotes(page)).toBeChecked();
  const roots = await expectOneRed(page, 'notes added');
  expect(roots[0]!.tag).toBe('button');
});

test('the red follows an added note', async ({ page }) => {
  await twinkle(page);
  await switchOn(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  await page.getByRole('button', { name: 'Play' }).click();
  // The cursor marks the group at 0.3 s, which only the embellished score has, and the score's
  // red is on that note in the same frame: the added note lasts 0.3 s only.
  await page.waitForFunction(
    ([sec, tick]) => {
      const hook = (window as unknown as { __digitus2?: { cursorSec(): number } }).__digitus2;
      if (hook === undefined || Math.abs(hook.cursorSec() - Number(sec)) >= 1e-6) return false;
      const red = [...document.querySelectorAll('.score-sheet .is-red')];
      return red.length > 0 && red.every((el) => el.getAttribute('data-onset-tick') === tick);
    },
    [ADDED_NOTE_SEC, ADDED_NOTE_TICK] as const,
    { polling: 'raf', timeout: 10_000 },
  );
  await expectOneRed(page, 'added note');
});

test('switching back restores the plain score and the bar', async ({ page, isMobile }) => {
  await twinkle(page);
  // Cued on bar 3 while stopped (a tap on a phone), before the Practice panel opens over the
  // music.
  await seekBar(page, 2, isMobile);
  await redSettled(page);
  await expect.poll(() => redBars(page)).toEqual([2]);

  await switchOn(page);
  await expect.poll(() => redBars(page)).toEqual([2]);
  await expectOneRed(page, 'switched on at bar 3');

  await addNotes(page).uncheck();
  await expect(digits(page)).toHaveCount(TWINKLE_NOTES);
  await expect(page.locator('.score-sheet g.note')).toHaveCount(TWINKLE_NOTES);
  await expect.poll(() => redBars(page)).toEqual([2]);
  await expectOneRed(page, 'switched off at bar 3');
});

// Review Focus 3: the loop stays, playback goes on from the same bar's start, one red. The loop
// is proved by its wrap after the switch (review S3): the controls' own state would survive a
// dropped loop, and so would a position read once.
test('switching while playing in a loop', async ({ page }) => {
  const bar3 = 2 * BAR_SEC;
  const bar5 = 4 * BAR_SEC;
  await twinkle(page);
  await openPractice(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  await setLoopBars(page, '3', '4');
  await switchOn(page);
  await expect(page.getByRole('checkbox', { name: 'Loop bars' })).toBeChecked();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => positionSec(page)).toBeGreaterThan(bar3);
  await expectOneRed(page, 'playing the loop, notes added');

  await addNotes(page).uncheck();
  await expect(panel(page)).toHaveAttribute('data-embellish', 'offered');
  await expect(digits(page)).toHaveCount(TWINKLE_NOTES);
  await expectOneRed(page, 'switched off while playing');
  // Playback goes on from bar 3's start, inside the loop.
  await expect.poll(() => positionSec(page)).toBeGreaterThan(bar3 + 0.6);
  expect(await positionSec(page)).toBeLessThan(bar5);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Loop bars' })).toBeChecked();
  await expect(page.getByLabel('Loop from bar')).toHaveValue('3');
  await expect(page.getByLabel('Loop to bar')).toHaveValue('4');
  await expectOneRed(page, 'playing on in the loop');
  // The loop's end (bar 5's start, 9.6 s), then back to its first bar: the loop came across.
  // Without it the music would play on to the end of the piece and stop at 0.
  await positionWithin(page, bar5 - 0.5, bar5);
  await positionWithin(page, bar3, bar3 + 0.6);
  await expectOneRed(page, 'looped once after the switch');
});

// Review Focus 5: every export stays the plain score's.
test('export writes the plain score while notes are added', async ({ page }) => {
  await twinkle(page);
  await switchOn(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export MusicXML' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`${TWINKLE}.fingered.musicxml`);
  const text = await readFile((await download.path())!, 'utf8');
  const plain = libraryScore(TWINKLE).toString('utf8');
  const pitches = (xml: string) => (xml.match(/<pitch>/g) ?? []).length;
  expect(pitches(plain)).toBe(TWINKLE_NOTES);
  expect(pitches(text)).toBe(pitches(plain));
  expect(text.match(/<fingering/g)).toHaveLength(TWINKLE_NOTES);
});

test('the switch is absent on a piece with fewer than three figures', async ({ page }) => {
  await page.goto('/?audio=silent#/piece/mary-had-a-little-lamb');
  await openPractice(page);
  // 'none', not merely "not pending": an error would leave 'pending' and fail here.
  await embellishDecided(page, 'none');
  await expect(addNotes(page)).toHaveCount(0);
  await expectOneRed(page, 'Mary, no switch');
});

// Ruling 7's non-eligible import: Twinkle's own text, which would be offered were it eligible.
// The scan goes through the PC's worker, as in scan.spec: without touch, also at a phone's width
// (a touch phone takes the phone path, which scan-phone.spec covers).
test.describe('a scan import', () => {
  test.use({ hasTouch: false, isMobile: false });

  test('the switch is absent on a scan import', async ({ page }) => {
    await mockWorker(page, libraryScore(TWINKLE).toString('utf8'));
    await scanOnePage(page);
    await page.getByRole('button', { name: 'Use for fingerings' }).click();
    await expect(page.locator('.score-sheet g.fing').first()).toBeVisible({
      timeout: SCORE_TIMEOUT,
    });
    await openPractice(page);
    await embellishDecided(page, 'none');
    await expect(addNotes(page)).toHaveCount(0);
  });
});

test('the switch is absent on a refused import', async ({ page }) => {
  await page.goto('/?audio=silent');
  // The right hand plays chords: the guard refuses the piece.
  await page.getByLabel('Open your own score').setInputFiles({
    name: 'aylesford.musicxml',
    mimeType: 'application/xml',
    buffer: libraryScore('handel-aylesford-minuet-d-minor'),
  });
  await expect(page.locator('.score-sheet g.fing').first()).toBeVisible({
    timeout: SCORE_TIMEOUT,
  });
  await openPractice(page);
  await embellishDecided(page, 'none');
  await expect(addNotes(page)).toHaveCount(0);
});
