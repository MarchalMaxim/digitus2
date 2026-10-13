import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export async function expectNoSeriousA11y(page: Page, label = ''): Promise<void> {
  const results = await new AxeBuilder({ page }).exclude('.score-sheet svg').analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious,
    `${label} axe: ${serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`).join('; ')}`,
  ).toEqual([]);
}
