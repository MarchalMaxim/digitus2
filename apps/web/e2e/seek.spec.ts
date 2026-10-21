import { expect, test, type Page } from '@playwright/test';
import { closePractice, embellishDecided, openPractice, setLoopBars } from './helpers/practice.js';
import { expectOneRed } from './helpers/red.js';
import { positionSec, redBars, redSettled, seekBar } from './helpers/seek.js';

// T13 (issue #23): the score is the timeline. A click or tap anywhere in a bar goes there; Left
// and Right step a bar, Shift four, Home rewinds. The red hops to the bar sought and, playing,
// the music comes in as it lands. Seeks stay inside a loop.

const TWINKLE = 'twinkle-twinkle-little-star';
const TWINKLE_NOTES = 64;

async function twinkle(page: Page): Promise<void> {
  await page.goto(`/?audio=silent#/piece/${TWINKLE}`);
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_NOTES, {
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  // "Add notes between" is offered on Twinkle: its row is in the Practice panel before a click.
  await embellishDecided(page, 'offered');
}

async function noCountIn(page: Page): Promise<void> {
  await openPractice(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  await closePractice(page);
}

// The mouse and keyboard flows run at desktop width; the phone flow is the tap below.
test.beforeEach(({ isMobile }, info) => {
  test.skip(isMobile !== info.title.startsWith('on a phone'), 'another width');
});

/** Samples the screen's red elements on every frame for `ms`: exactly one red throughout. */
async function oneRedFor(page: Page, ms: number, label: string): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) await expectOneRed(page, label);
}

test('a click on a bar while stopped cues it: the red hops there and Play starts there', async ({
  page,
}) => {
  await twinkle(page);
  await noCountIn(page);
  await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/is-red/);
  await seekBar(page, 2);
  // The red is on its way, or has landed: never two at once.
  await expectOneRed(page, 'hopping to bar 3');
  await redSettled(page);
  expect(await redBars(page)).toEqual([2]);
  await expectOneRed(page, 'cued on bar 3');
  await expect(page.getByRole('button', { name: 'Play' })).not.toHaveClass(/is-red/);
  // A click on the score is handled: no notes rise from it.
  await expect(page.locator('.note-burst')).toHaveCount(0);

  const cue = await positionSec(page);
  expect(cue).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => positionSec(page)).toBeGreaterThan(cue);
  expect(await redBars(page)).toEqual([2]);
});

test('Left and Right step a bar, Shift four bars, Home rewinds', async ({ page }) => {
  await twinkle(page);
  await page.locator('body').click({ position: { x: 5, y: 5 } }); // nothing focused
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await redSettled(page);
  expect(await redBars(page)).toEqual([2]);
  await page.keyboard.press('Shift+ArrowRight');
  await redSettled(page);
  expect(await redBars(page)).toEqual([6]);
  await page.keyboard.press('ArrowLeft');
  await redSettled(page);
  expect(await redBars(page)).toEqual([5]);
  await expectOneRed(page, 'cued by the arrow keys');

  await page.keyboard.press('Home');
  await redSettled(page);
  expect(await redBars(page)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/is-red/);
});

test('the arrow keys stay with a focused slider', async ({ page }) => {
  await twinkle(page);
  await openPractice(page);
  const tempo = page.getByRole('slider', { name: 'Tempo' });
  await tempo.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tempo).toHaveValue('105');
  expect(await redBars(page)).toEqual([]);
});

test('playing, Left goes back a bar and the music goes on from there, one red throughout', async ({
  page,
}) => {
  await twinkle(page);
  await noCountIn(page);
  await page.getByRole('button', { name: 'Play' }).click();
  // Into the third bar.
  await expect.poll(() => redBars(page), { timeout: 10_000 }).toEqual([2]);
  await page.keyboard.press('ArrowLeft');
  await oneRedFor(page, 400, 'hopping back while playing');
  await redSettled(page);
  await expect.poll(() => redBars(page)).toEqual([1]);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  // A click on a later bar while playing: the music goes on from there.
  await seekBar(page, 5);
  await oneRedFor(page, 400, 'hopping forward while playing');
  await expect.poll(() => redBars(page)).toEqual([5]);
});

test('a seek stays inside the loop', async ({ page }) => {
  await twinkle(page);
  await setLoopBars(page, '3', '4');
  await closePractice(page);
  await seekBar(page, 0); // outside the loop: nothing happens
  await page.waitForTimeout(400);
  expect(await redBars(page)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/is-red/);
  await seekBar(page, 3);
  await redSettled(page);
  expect(await redBars(page)).toEqual([3]);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Shift+ArrowRight');
  await redSettled(page);
  expect(await redBars(page)).toEqual([3]); // the loop's last bar
  await page.keyboard.press('Shift+ArrowLeft');
  await redSettled(page);
  expect(await redBars(page)).toEqual([2]); // its first
});

for (const prefix of ['', 'on a phone, ']) {
  test(`${prefix}a loop before first Play clears an excluded cue and removal restores it`, async ({
    page,
    isMobile,
  }) => {
    await twinkle(page);
    await noCountIn(page);
    await seekBar(page, 2, isMobile);
    await redSettled(page);
    expect(await redBars(page)).toEqual([2]);
    const cue = await positionSec(page);

    // A loop that includes the cued bar keeps its notes and keys marked.
    await setLoopBars(page, '3', '4');
    await expect.poll(() => redBars(page)).toEqual([2]);
    await expect(page.locator('.keyboard-svg .is-pressed')).not.toHaveCount(0);

    // Moving the loop elsewhere changes the next start, without overwriting the seek.
    await setLoopBars(page, '6', '7');
    await expect.poll(() => redBars(page)).toEqual([]);
    await expect(page.locator('.keyboard-svg .is-pressed')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/is-red/);
    await expectOneRed(page, 'excluded cue before first Play');
    expect(await positionSec(page)).toBe(cue);

    await page.getByRole('checkbox', { name: 'Loop bars' }).uncheck();
    await expect.poll(() => redBars(page)).toEqual([2]);
    await expectOneRed(page, 'restored cue after removing the loop');

    await setLoopBars(page, '6', '7');
    await closePractice(page);
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => redBars(page)).toEqual([5]);
    expect(await positionSec(page)).toBeGreaterThan(cue);
    await expectOneRed(page, 'first playback at the loop start');
  });
}

test('on a phone, a tap on a bar cues it, and the Practice panel says so', async ({ page }) => {
  await twinkle(page);
  await seekBar(page, 1, true);
  await redSettled(page);
  expect(await redBars(page)).toEqual([1]);
  await expectOneRed(page, 'cued by a tap');
  await openPractice(page);
  await expect(page.getByText('Tap a bar to go there.')).toBeVisible();
});
