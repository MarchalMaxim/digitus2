import { expect, type Page } from '@playwright/test';

/**
 * A point inside bar `bar` (0-based, the score's bar order) as drawn: halfway along it, on its
 * upper staff. A click or tap there goes to the bar (T13, BarSeek.tsx).
 */
export async function barPoint(page: Page, bar: number): Promise<{ x: number; y: number }> {
  const measure = page.locator('.score-sheet g.measure').nth(bar);
  await measure.scrollIntoViewIfNeeded();
  return measure.evaluate((m) => {
    const lines = [...m.querySelectorAll(':scope > g.staff')][0]!.querySelectorAll(':scope > path');
    const top = lines[0]!.getBoundingClientRect();
    const bottom = lines[lines.length - 1]!.getBoundingClientRect();
    return { x: top.left + top.width / 2, y: (top.top + bottom.bottom) / 2 };
  });
}

/** Clicks (or, with `tap`, taps) bar `bar`. */
export async function seekBar(page: Page, bar: number, tap = false): Promise<void> {
  const { x, y } = await barPoint(page, bar);
  if (tap) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** The bars (0-based) holding the cursor's red notes, in order. */
export function redBars(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const bars = [...document.querySelectorAll('.score-sheet g.measure')];
    const marked = [...document.querySelectorAll('.score-sheet .is-red')];
    return [...new Set(marked.map((el) => bars.indexOf(el.closest('g.measure')!)))].sort(
      (a, b) => a - b,
    );
  });
}

/** The red's hop or flight is over: no shape on its way. */
export async function redSettled(page: Page): Promise<void> {
  await expect(page.locator('.red-ghost')).toHaveCount(0);
}

/** The transport's position, through the hook the app installs with `?audio=silent`. */
export function positionSec(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as { __digitus2: { positionSec(): number } }).__digitus2.positionSec(),
  );
}
