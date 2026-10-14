import { expect, type Page } from '@playwright/test';

/** Opens the dock's Practice panel (closed on every page load), so a flow can use its controls. */
export async function openPractice(page: Page): Promise<void> {
  const toggle = page.locator('.dock .practice-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'true') return;
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** Ticks "Loop bars" (when it is not) and types the two bars. */
export async function setLoopBars(page: Page, from: string, to: string): Promise<void> {
  await openPractice(page);
  const loop = page.getByRole('checkbox', { name: 'Loop bars' });
  if (!(await loop.isChecked())) await loop.check();
  await page.getByLabel('Loop from bar').fill(from);
  await page.getByLabel('Loop to bar').fill(to);
}

/**
 * Closes the dock's Practice panel, so the dock is its short self again: on a phone the open
 * panel takes about half the window, and a flow about the music wants the music's room back.
 */
export async function closePractice(page: Page): Promise<void> {
  const toggle = page.locator('.dock .practice-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') return;
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
}
