import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { expectOneRed } from './helpers/red.js';

// Light and dark (T7): the page follows the system's color scheme until the reader chooses a
// theme with the switch; the choice is kept per browser and on the page before the app runs. In
// the dark the engraving turns with the ink, the on-screen keys stay a real keyboard's, and a
// print is ink on paper whatever the theme. Every state's one-red and axe check also runs in the
// dark (states.spec.ts). Desktop project.

const STORAGE_KEY = 'digitus2.theme';
const LIGHT_PAPER = 'rgb(255, 255, 255)';
const LIGHT_INK = 'rgb(0, 0, 0)';
const DARK_PAPER = 'rgb(17, 17, 17)';
/** The engraving's ink in the dark: softer than the text's, so a page of notes does not glare. */
const DARK_SCORE_INK = 'rgb(212, 212, 212)';
const DARK_KEY_WHITE = 'rgb(218, 218, 218)';
const TWINKLE = '/#/piece/twinkle-twinkle-little-star';

const paper = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
const kept = (page: Page) => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
const toggle = (page: Page) => page.getByRole('button', { name: 'Dark theme' });

async function openTwinkle(page: Page): Promise<void> {
  await page.goto(TWINKLE);
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
}

/** The colors the score sheet and the keyboard are drawn in. */
function scoreColors(page: Page) {
  return page.evaluate(() => {
    const sheet = document.querySelector('.score-sheet svg')!;
    const fill = (sel: string) => getComputedStyle(document.querySelector(sel)!).fill;
    return {
      notehead: getComputedStyle(sheet.querySelector('g.notehead use')!).fill,
      staffLine: getComputedStyle(sheet.querySelector('g.staff > path')!).stroke,
      digit: getComputedStyle(sheet.querySelector('g.fing text')!).fill,
      whiteKey: fill('.key.is-white rect'),
      blackKey: fill('.key.is-black rect'),
    };
  });
}

test.describe('with the system in dark', () => {
  test.use({ colorScheme: 'dark' });

  test('the page follows the system and the switch shows it pressed', async ({ page }) => {
    await page.goto('/');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await paper(page)).toBe(DARK_PAPER);
  });

  test('the engraving turns with the ink and the keys stay a real keyboard', async ({ page }) => {
    await openTwinkle(page);
    expect(await scoreColors(page)).toEqual({
      notehead: DARK_SCORE_INK,
      staffLine: DARK_SCORE_INK,
      digit: DARK_SCORE_INK,
      whiteKey: DARK_KEY_WHITE,
      blackKey: DARK_PAPER,
    });
    const roots = await expectOneRed(page, 'the score in the dark');
    expect(roots[0]!.tag).toBe('button');
    await expectNoSeriousA11y(page, 'the score in the dark');
  });

  test('a print is ink on paper', async ({ page }) => {
    await openTwinkle(page);
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
    expect(await paper(page)).toBe(LIGHT_PAPER);
    const colors = await scoreColors(page);
    expect([colors.notehead, colors.staffLine, colors.digit]).toEqual([
      LIGHT_INK,
      LIGHT_INK,
      LIGHT_INK,
    ]);
  });
});

test('the switch overrides the system, is kept, and gives the page back to the system', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  expect(await paper(page)).toBe(LIGHT_PAPER);

  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await paper(page)).toBe(DARK_PAPER);
  expect(await kept(page)).toBe('dark');
  const roots = await expectOneRed(page, 'the library after the switch');
  expect(roots[0]!.tag).toBe('button');

  // Kept: a reload and another view open dark.
  await page.reload();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await paper(page)).toBe(DARK_PAPER);
  await page.getByRole('button', { name: /^Open Twinkle/ }).click();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await paper(page)).toBe(DARK_PAPER);

  // Back to the system's theme: nothing is kept, so the page follows the system again.
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  expect(await paper(page)).toBe(LIGHT_PAPER);
  expect(await kept(page)).toBeNull();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await paper(page)).toBe(DARK_PAPER);
});

/**
 * Clicks the switch and returns the cross-fade the browser runs for it: each view-transition
 * animation's pseudo-element, length and easing, and whether the controls' own transitions were
 * held meanwhile. Empty when the page simply changed.
 */
async function switchAndWatch(page: Page) {
  await expect(toggle(page)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open Twinkle/ })).toBeVisible();
  return page.evaluate(async () => {
    const root = document.documentElement;
    document.querySelector<HTMLButtonElement>('.theme-toggle')!.click();
    const held = root.classList.contains('theme-changing');
    // A button other than the switch: one of the library's own.
    const button = document.querySelector('button:not(.theme-toggle)')!;
    const buttonDuration = getComputedStyle(button).transitionDuration;
    for (let frame = 0; frame < 30; frame++) {
      const fades = document
        .getAnimations()
        .map((a) => a.effect as KeyframeEffect)
        .filter((effect) => effect.pseudoElement?.startsWith('::view-transition'))
        .map((effect) => ({
          pseudo: effect.pseudoElement,
          duration: effect.getTiming().duration,
          // A CSS animation keeps its timing function on its keyframes, not on the effect.
          easing: getComputedStyle(root, effect.pseudoElement).animationTimingFunction,
        }));
      if (fades.length) return { held, buttonDuration, fades };
      await new Promise(requestAnimationFrame);
    }
    return { held, buttonDuration, fades: [] };
  });
}

test('the switch cross-fades the whole page, in the motion of the icon', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const watched = await switchAndWatch(page);
  expect(watched.held).toBe(true);
  expect([...new Set(watched.fades.map((f) => f.pseudo))].sort()).toEqual([
    '::view-transition-group(root)',
    '::view-transition-new(root)',
    '::view-transition-old(root)',
  ]);
  for (const fade of watched.fades) {
    expect(fade.duration).toBe(200);
    expect(fade.easing).toBe('cubic-bezier(0.2, 0, 0, 1)');
  }
  // While it fades, a button's own color transition is held so it does not lag behind the paper.
  expect(watched.buttonDuration).toBe('0s');
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await paper(page)).toBe(DARK_PAPER);
  // Once it has faded the controls' transitions come back.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('theme-changing')))
    .toBe(false);
});

test('under reduced motion the page simply changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/');
  const watched = await switchAndWatch(page);
  for (const fade of watched.fades) expect(fade.duration).toBe(0);
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await paper(page)).toBe(DARK_PAPER);
});

test('a kept theme is on the page before the app runs', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript((key) => localStorage.setItem(key, 'dark'), STORAGE_KEY);
  // No application JavaScript at all: only index.html's own script and the stylesheet.
  await page.route(/\/assets\/.*\.js$/, (route) => route.abort());
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
    'dark',
  );
  expect(await paper(page)).toBe(DARK_PAPER);
});

test('the switch sits at the top right, clear of the heading, at 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const url of ['/', TWINKLE, '/#/about']) {
    await page.goto(url);
    const box = (await toggle(page).boundingBox())!;
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box.width, url).toBe(44);
    expect(box.height, url).toBe(44);
    expect(Math.abs(width - 16 - (box.x + box.width)), url).toBeLessThanOrEqual(0.5);
    expect(box.y, url).toBeCloseTo(16, 0);
    // The heading's text never runs under the switch.
    const text = await page.getByRole('heading', { level: 1 }).evaluate((h) => {
      const range = document.createRange();
      range.selectNodeContents(h);
      return [...range.getClientRects()].map((r) => ({ top: r.top, right: r.right }));
    });
    for (const line of text) {
      const beside = line.top < box.y + box.height;
      if (beside) expect(line.right, `${url} heading line at ${line.top}`).toBeLessThan(box.x);
    }
    expect(heading.y, url).toBeGreaterThanOrEqual(0);
  }
});
