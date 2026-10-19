import { expect, test, type Page } from '@playwright/test';
import { embellishDecided, openPractice } from './helpers/practice.js';
import { expectOneRed } from './helpers/red.js';

const position = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __digitus2: { positionSec(): number } }).__digitus2.positionSec(),
  );
const keyboard = (page: Page) =>
  page.evaluate(() => ({
    pressed: document.querySelectorAll('.keyboard .key.is-pressed').length,
    letters: [...document.querySelectorAll('.keyboard .key-hand')].map((t) => t.textContent),
  }));

async function playSilently(page: Page, slug: string, tempoPercent = '100'): Promise<void> {
  await page.goto(`/?audio=silent#/piece/${slug}`);
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled({ timeout: 20_000 });
  await openPractice(page);
  await embellishDecided(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  if (tempoPercent !== '100') await page.getByRole('slider', { name: 'Tempo' }).fill(tempoPercent);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.keyboard .key.is-pressed').first()).toBeVisible({ timeout: 5_000 });
}

// T11 (spec 15): "Only when the L and R notes are close to each other". The rule reads the score
// alone, so this holds on the mobile project too, where the keyboard scrolls and one hand can be
// out of view (rule 5: no phone exception). The whole piece is sampled at 150 %: a per-onset phone
// exception would have lettered single onsets at 14.25 s, 16.50 s and 18.00 s (bars 7 and 8).
test('Amazing Grace: the hands never come within a fifth, so no key shows a hand letter, to the last bar', async ({
  page,
}) => {
  await playSilently(page, 'amazing-grace', '150');
  let furthest = 0;
  let withKeys = 0;
  for (let i = 0; i < 400 && (await page.getByRole('button', { name: 'Pause' }).isVisible()); i++) {
    const k = await keyboard(page);
    furthest = Math.max(furthest, await position(page));
    if (k.pressed > 0) withKeys++;
    expect(k.letters, `at ${furthest.toFixed(2)} s`).toEqual([]);
    await page.waitForTimeout(100);
  }
  expect(furthest, 'sampled through bars 7 and 8').toBeGreaterThan(19);
  expect(withKeys, 'samples with keys down').toBeGreaterThan(50);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible(); // the piece ended
});

test('Twinkle: no letters in bars 1 to 3; L and R together from bar 4, where the hands come close', async ({
  page,
}) => {
  await playSilently(page, 'twinkle-twinkle-little-star');
  // 100 qpm in 4/4: bar 4 (measure index 3) starts at 7.2 s.
  while ((await position(page)) < 6.9) {
    const k = await keyboard(page);
    if (k.pressed > 0) expect(k.letters).toEqual([]);
    await page.waitForTimeout(150);
  }
  await expect.poll(() => position(page), { timeout: 5_000 }).toBeGreaterThan(7.4);
  const k = await keyboard(page);
  expect(new Set(k.letters)).toEqual(new Set(['L', 'R']));
  expect(k.letters).toHaveLength(k.pressed);
  await expectOneRed(page, 'Twinkle bar 4');
});

// T10 and T11: paused, the pressed keys keep their finger numbers. In bar 1 the hands are an
// octave apart, so the third note's keys carry their digits alone, without L or R.
test('Twinkle paused in bar 1: the pressed keys carry their finger numbers, no hand letters', async ({
  page,
}) => {
  await playSilently(page, 'twinkle-twinkle-little-star', '50');
  // The third note sounds from 1.2 s to 1.8 s of the score: at 50 %, 1.2 s of the clock to pause in.
  await expect
    .poll(() => position(page), { timeout: 10_000, intervals: [50] })
    .toBeGreaterThan(1.25);
  await page.getByRole('button', { name: 'Pause' }).click();
  const pressed = page.locator('.keyboard-svg .key.is-pressed');
  expect(
    await pressed.evaluateAll((keys) => keys.map((key) => Number(key.getAttribute('data-midi')))),
  ).toEqual([48, 67]);
  await expect(pressed.locator('text')).toHaveText(['5', '4']);
  await expect(page.locator('.keyboard-svg .key-hand')).toHaveCount(0);
});
