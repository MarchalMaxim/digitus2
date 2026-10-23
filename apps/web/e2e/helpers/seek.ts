import { expect, type Page } from '@playwright/test';

/**
 * A point inside bar `bar` (0-based, the score's bar order) as drawn: halfway along it, on its
 * upper staff. A click or tap there goes to the bar (T13, BarSeek.tsx). On a long piece only the
 * pages near the screen are built (issue 99), so the bar is found by its page's `data-first-bar`
 * and its place in that page, and the page is scrolled to first.
 */
export async function barPoint(page: Page, bar: number): Promise<{ x: number; y: number }> {
  const at = await page.evaluate((bar) => {
    const slots = [...document.querySelectorAll('.score-sheet > svg')];
    if (slots.length === 0 || !slots.every((s) => s.hasAttribute('data-first-bar'))) return null;
    for (let i = slots.length - 1; i >= 0; i--) {
      const first = Number(slots[i]!.getAttribute('data-first-bar'));
      if (bar >= first) return { page: i, within: bar - first };
    }
    return null;
  }, bar);
  let measure = page.locator('.score-sheet g.measure').nth(bar);
  if (at) {
    const slot = page.locator('.score-sheet > svg').nth(at.page);
    await slot.scrollIntoViewIfNeeded();
    measure = slot.locator('g.measure').nth(at.within);
    await measure.waitFor({ state: 'attached' });
  }
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

/**
 * The bars (0-based) holding the cursor's red notes, in order. The red's page is always built
 * (issue 99); a bar is numbered by its page's `data-first-bar` when the sheet is windowed.
 */
export function redBars(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll('.score-sheet g.measure')];
    const marked = [...document.querySelectorAll('.score-sheet .is-red')];
    const barOf = (el: Element): number => {
      const measure = el.closest('g.measure')!;
      const slot = measure.closest('.score-sheet > svg');
      const first = slot?.getAttribute('data-first-bar');
      if (!slot || first == null) return all.indexOf(measure);
      return Number(first) + [...slot.querySelectorAll('g.measure')].indexOf(measure);
    };
    return [...new Set(marked.map(barOf))].sort((a, b) => a - b);
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
