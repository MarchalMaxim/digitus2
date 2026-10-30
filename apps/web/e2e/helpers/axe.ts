import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Waits for the page's running transitions and animations to end. Axe reads the colour a node has
 * at that moment, and a fade in progress blends text toward its background (a gray that passes at
 * full opacity reads 4.47:1 at 95 %).
 */
async function animationsEnded(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity,
        )
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

export async function expectNoSeriousA11y(page: Page, label = ''): Promise<void> {
  await animationsEnded(page);
  const results = await new AxeBuilder({ page }).exclude('.score-sheet svg').analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious,
    `${label} axe: ${serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`).join('; ')}`,
  ).toEqual([]);
}
