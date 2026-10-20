import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { closePractice, embellishDecided, openPractice } from './helpers/practice.js';
import { expectOneRed } from './helpers/red.js';
import { delayPianoSamples, PIANO_SAMPLES } from './helpers/samples.js';

// The keyboard answers (issue #96): hover a note in the score and its key goes down on the
// keyboard with its finger number; press a key on the keyboard and it sounds. No control for
// either, pressed and hovered keys gray, one red element throughout.

const TWINKLE = 'twinkle-twinkle-little-star';
const TWINKLE_NOTES = 64;
const LOADING_THE_PIANO = 'Loading the piano…';

/** The strikes the silent instrument recorded (`?audio=silent`, usePlayback.ts). */
function strikes(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    (window as unknown as { __digitus2Keys: { strikes(): number[] } }).__digitus2Keys.strikes(),
  );
}

async function twinkle(page: Page, search = '?audio=silent'): Promise<void> {
  await page.goto(`/${search}#/piece/${TWINKLE}`);
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(TWINKLE_NOTES, {
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  await embellishDecided(page, 'offered');
}

/** The middle of a drawn element, in viewport pixels. */
async function middle(el: Locator): Promise<{ x: number; y: number }> {
  await el.scrollIntoViewIfNeeded();
  const box = (await el.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The keys down on the keyboard: each key's pitch and the digit it shows, in order. */
function pressedKeys(page: Page): Promise<[string, string][]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.keyboard .key.is-pressed')].map((k) => [
      k.getAttribute('data-midi') ?? '',
      k.querySelector('text')?.textContent ?? '',
    ]),
  );
}

test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, 'the keyboard answers the mouse; a tap on a phone cues a bar already');
});

test('hovering a note presses its key with its finger, and the key lifts when the pointer leaves', async ({
  page,
}) => {
  await twinkle(page);
  // Twinkle's first note: C4 in the right hand, whose digit stands in its own `g.fing`.
  const note = page.locator('.score-sheet g.note').first();
  const id = await note.getAttribute('id');
  const digit = await page
    .locator(`.score-sheet g.fing[data-startid="#${id}"] text`)
    .evaluate((t) => (t.textContent ?? '').trim());
  expect(digit).toMatch(/^[1-5]$/);
  expect(await pressedKeys(page)).toEqual([]);

  const at = await middle(note);
  await page.mouse.move(at.x, at.y);
  await expect.poll(() => pressedKeys(page)).toEqual([['60', digit]]);
  // Gray, never red: Play stays the one red element while a key is hovered.
  const red = await expectOneRed(page, 'hovering a note');
  expect(red[0]!.tag).toBe('button');
  await expect(page.locator('.keyboard .key.is-pressed rect')).toHaveCSS(
    'fill',
    'rgb(204, 204, 204)',
  );
  await expectNoSeriousA11y(page, 'hovering a note');
  // The bar's tint is unchanged by the hover (BarSeek.tsx); nothing else is marked.
  await expect(page.locator('.score-sheet .is-red')).toHaveCount(0);

  // The pointer leaves the note: the key lifts.
  await page.mouse.move(at.x, at.y - 120);
  await expect.poll(() => pressedKeys(page)).toEqual([]);
  await page.mouse.move(at.x, at.y);
  await expect.poll(() => pressedKeys(page)).toEqual([['60', digit]]);
  // ... and leaves the score altogether.
  await page.mouse.move(5, 5);
  await expect.poll(() => pressedKeys(page)).toEqual([]);
});

test('hovering presses nothing while playing: the keyboard belongs to the cursor', async ({
  page,
}) => {
  await twinkle(page);
  await openPractice(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).check();
  await page.getByRole('slider', { name: 'Tempo' }).fill('50');
  await closePractice(page);
  const note = page.locator('.score-sheet g.note').first();
  const at = await middle(note);
  await page.mouse.move(at.x, at.y);
  await expect.poll(() => pressedKeys(page)).toHaveLength(1);
  await page.getByRole('button', { name: 'Play' }).click();
  // The count-in: no note is heard yet, so no key is down, hovered or not.
  await expect(page.getByRole('status')).toHaveText('1');
  await page.mouse.move(at.x + 1, at.y);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(300);
  expect(await pressedKeys(page)).toEqual([]);
  await expectOneRed(page, 'hovering in the count-in');
  // Paused, the hover answers again (the paused cursor's keys stay; hovering one of them changes nothing).
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.mouse.move(at.x + 1, at.y);
  await page.mouse.move(at.x, at.y);
  await expect.poll(() => pressedKeys(page)).toHaveLength(1);
});

test('a key pressed on the keyboard goes down and sounds until it is released; the transport is untouched', async ({
  page,
}) => {
  await twinkle(page);
  const key = page.locator('.keyboard .key[data-midi="64"]');
  const at = await middle(key.locator('rect'));
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect(key).toHaveClass(/is-pressed/);
  await expect(key.locator('text')).toHaveCount(0); // no finger for a key the reader pressed
  await expect.poll(() => strikes(page)).toEqual([64]);
  // Nothing on the transport: Play is still the one red element, the score unmarked.
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  const red = await expectOneRed(page, 'a key pressed');
  expect(red[0]!.tag).toBe('button');
  await expect(page.locator('.score-sheet .is-red')).toHaveCount(0);
  await expectNoSeriousA11y(page, 'a key pressed');
  await page.mouse.up();
  await expect(key).not.toHaveClass(/is-pressed/);
  // A click on a key is handled: no notes rise from it.
  await expect(page.locator('.note-burst')).toHaveCount(0);

  // Playing, a key still sounds and does nothing to the transport.
  await openPractice(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  await closePractice(page);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.score-sheet .is-red').first()).toBeVisible({ timeout: 10_000 });
  await key.locator('rect').click();
  await expect.poll(() => strikes(page)).toEqual([64, 64]);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.locator('.score-sheet .is-red').first()).toBeVisible();
});

test('the first key pressed loads the piano, says so, and sounds when the samples arrive', async ({
  page,
}) => {
  const requested = await delayPianoSamples(page, 600);
  await twinkle(page, '');
  const status = page.getByRole('status');
  await expect(status).toBeEmpty();
  const key = page.locator('.keyboard .key[data-midi="60"]');
  const at = await middle(key.locator('rect'));
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect(key).toHaveClass(/is-pressed/);
  await expect(status).toHaveText(LOADING_THE_PIANO);
  // Play stays the one red element, busy and unavailable, while the samples load.
  await expect(page.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-busy', 'true');
  const loading = await expectOneRed(page, 'loading the piano from a key');
  expect(loading[0]!.tag).toBe('button');
  await expectNoSeriousA11y(page, 'loading the piano from a key');
  await expect(status).toBeEmpty({ timeout: 15_000 });
  expect(requested.length, 'piano samples requested').toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Play' })).not.toHaveAttribute('aria-busy');
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  await page.mouse.up();
  await expect(key).not.toHaveClass(/is-pressed/);
  // The samples are at hand: Play starts without loading again.
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
});

test('offline, a key pressed says the piano sounds could not be loaded', async ({ page }) => {
  await page.route(PIANO_SAMPLES, (route) => route.abort('internetdisconnected'));
  await twinkle(page, '');
  const key = page.locator('.keyboard .key[data-midi="60"]');
  await key.locator('rect').click();
  await expect(page.getByText(/piano sounds could not be loaded/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  await expect(key).not.toHaveClass(/is-pressed/);
  await expectOneRed(page, 'the piano could not be loaded');
});
