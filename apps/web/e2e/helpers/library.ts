import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { LEVEL_NAMES, type Level } from '../../src/library/levels.js';

/** Pieces in the built-in library (content/manifest.json), so the flows follow its growth. */
const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../content/manifest.json', import.meta.url)),
    'utf8',
  ),
) as Array<{ source?: { license?: string } }>;

export const LIBRARY_COUNT = manifest.length;

/** Engravings that owe a credit: share-alike (CC BY-SA) and attribution-only (CC BY), as the About page counts them. */
export const LICENSE_COUNTS = {
  shareAlike: manifest.filter((p) => (p.source?.license ?? '').startsWith('CC-BY-SA')).length,
  attributionOnly: manifest.filter((p) => /^CC-BY-\d/.test(p.source?.license ?? '')).length,
};

const entries = manifest as unknown as Array<{ slug: string; level: Level }>;

/** Pieces per level in the built-in library. */
export const LEVEL_COUNTS: Record<number, number> = entries.reduce<Record<number, number>>(
  (acc, e) => ({ ...acc, [e.level]: (acc[e.level] ?? 0) + 1 }),
  {},
);

/** The library page is showing: its heading and its red button. */
export async function libraryReady(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'digitus2' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Start|Continue) with / })).toBeVisible();
}

/** Chooses the level pill of the level that holds `slug`, so its row is in the list. */
export async function showLevelOf(page: Page, slug: string): Promise<void> {
  const level = entries.find((e) => e.slug === slug)!.level;
  const pill = page.getByRole('radio', { name: LEVEL_NAMES[level], exact: true });
  if (!(await pill.isChecked())) await pill.check();
  await expect(pill).toBeChecked();
}
