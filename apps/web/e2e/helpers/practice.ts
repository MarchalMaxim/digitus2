import { expect, type Page } from '@playwright/test';

/**
 * The practice controls (tempo, hands, metronome, count-in and the loop) sit above the score.
 * Below 480 px they fold into a closed "Practice" disclosure; wider, they stand open and there is
 * no disclosure. Opens the disclosure when there is one, so a flow can use the controls at any
 * width. Call it once the score view is showing.
 */
export async function openPractice(page: Page): Promise<void> {
  const practice = page.locator('details.practice');
  if ((await practice.count()) === 0) return;
  if (await practice.evaluate((el) => (el as HTMLDetailsElement).open)) return;
  await practice.locator('summary').click();
  await expect(practice).toHaveAttribute('open', '');
}
