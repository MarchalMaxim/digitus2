import { expect, type Page } from '@playwright/test';

/**
 * The digits (`g.fing`) of the whole piece. On a piece of six pages or more only the pages near
 * the screen are in the DOM (issue 99), so the sheet is walked a window and a half at a time, each
 * page's digits counted while it is built, and the scroll position put back. A shorter piece has
 * every page in the DOM and is counted at once.
 */
export function digitCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const slots = () => [...document.querySelectorAll('.score-sheet > svg')];
    const count = (el: Element) => el.querySelectorAll('g.fing').length;
    if (!slots().some((s) => s.hasAttribute('data-first-bar'))) {
      return document.querySelectorAll('.score-sheet g.fing').length;
    }
    const from = window.scrollY;
    const perPage = new Map<number, number>();
    const height = document.documentElement.scrollHeight;
    for (let y = 0; y < height; y += window.innerHeight * 1.5) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((resolve) => setTimeout(resolve, 120));
      slots().forEach((s, i) => {
        if (s.childElementCount > 0) perPage.set(i, count(s));
      });
    }
    window.scrollTo({ top: from, behavior: 'instant' });
    await new Promise((resolve) => setTimeout(resolve, 120));
    return [...perPage.values()].reduce((a, b) => a + b, 0);
  });
}

/** The piece has `count` digits in all, whichever pages are in the DOM. */
export async function expectDigits(page: Page, count: number, timeout = 20_000): Promise<void> {
  await expect.poll(() => digitCount(page), { timeout }).toBe(count);
}
