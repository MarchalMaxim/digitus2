import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';
import {
  SHELVES,
  TIERS,
  TIER_NAMES,
  shelfOfGenre,
  tierOf,
  type GenreId,
  type Grade,
  type ShelfId,
  type Tier,
} from '../../src/library/levels.js';
import { searchPieces } from '../../src/library/search.js';

/** The built-in library's full entries (content/manifest.json), so the flows follow its growth. */
const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../content/manifest.json', import.meta.url)),
    'utf8',
  ),
) as Array<{
  slug: string;
  title: string;
  composer: string;
  collection: string;
  collectionId: string;
  genre: GenreId;
  level: Grade;
  approxDurationSec: number;
  source?: { license?: string; name?: string };
}>;

export const LIBRARY_COUNT = manifest.length;

/**
 * A MuseScore archive piece of one grade (collection ids pdmx-*), the first one in the list that
 * names its composer: its score is a gzip file, which the app must read whichever way a server sends it.
 */
export function archiveSample(grade: number): { slug: string; title: string } {
  const piece = manifest.find(
    (p) => p.collectionId.startsWith('pdmx-') && p.level === grade && p.composer !== 'Unknown',
  );
  if (!piece) throw new Error(`no archive piece at grade ${grade}`);
  return piece;
}

/** How many pieces a search finds, by the app's own matching (src/library/search.ts), so a count follows the library. */
export function searchCount(query: string): number {
  return searchPieces(manifest, query).length;
}

/** The rows search results show before any section is opened: the first 7 of each level. */
export function searchRows(query: string): number {
  const found = searchPieces(manifest, query);
  return TIERS.reduce(
    (n, t) => n + Math.min(7, found.filter((p) => tierOf(p.level) === t).length),
    0,
  );
}

/** The pieces the About table lists: the MuseScore archive pieces are counted in a sentence instead. */
export const CURATED_COUNT = manifest.filter(
  (p) => !(p.source?.name ?? '').startsWith('MuseScore'),
).length;

/** Engravings that owe a credit: share-alike (CC BY-SA) and attribution-only (CC BY), as the About page counts them. */
export const LICENSE_COUNTS = {
  shareAlike: manifest.filter((p) => (p.source?.license ?? '').startsWith('CC-BY-SA')).length,
  attributionOnly: manifest.filter((p) => /^CC-BY-\d/.test(p.source?.license ?? '')).length,
};

/** The shelves a level holds, in the page's order, with their piece counts. */
export function shelvesOf(
  tier: Tier,
): Array<{ id: ShelfId; name: string; noun: string; count: number }> {
  return SHELVES.map((s) => ({
    id: s.id,
    name: s.name,
    noun: s.noun,
    count: manifest.filter((p) => tierOf(p.level) === tier && shelfOfGenre(p.genre) === s.id)
      .length,
  })).filter((s) => s.count > 0);
}

/** The rows the arrival page of a level shows: at most 5 per shelf, whatever the day's samples. */
export function arrivalRows(tier: Tier): number {
  return shelvesOf(tier).reduce((n, s) => n + Math.min(5, s.count), 0);
}

/** The library page is showing: its heading and its red button. */
export async function libraryReady(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'digitus2' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Start|Continue) with / })).toBeVisible();
}

/** The level pill of a tier. */
export function tierPill(page: Page, tier: Tier): Locator {
  return page.getByRole('radio', { name: TIER_NAMES[tier], exact: true });
}

/** The tier and shelf of a library piece. */
export function placeOf(slug: string): { tier: Tier; shelf: ShelfId } {
  const piece = manifest.find((p) => p.slug === slug);
  if (!piece) throw new Error(`no library piece ${slug}`);
  return { tier: tierOf(piece.level), shelf: shelfOfGenre(piece.genre) };
}

/** The `All {n} …` button that opens a shelf. */
export function shelfButton(page: Page, shelf: ShelfId): Locator {
  const { noun } = SHELVES.find((s) => s.id === shelf)!;
  return page.getByRole('button', { name: new RegExp(`^All [\\d,]+ ${noun}$`) });
}

/** `Show 40 more` or `Show the last 17`. */
export function showMoreButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Show (\d+ more|the last \d+)$/ });
}

/**
 * Brings the row of `slug` onto the page and returns it: the level pill of its tier, its shelf
 * opened in place, pages shown until the row is there (a row already on the arrival page is used
 * as it is). A row seen on arrival could be a day's sample, so tests never rely on one.
 */
export async function showPiece(page: Page, slug: string): Promise<Locator> {
  const piece = manifest.find((p) => p.slug === slug)!;
  const { tier, shelf } = placeOf(slug);
  const row = page.getByRole('button', {
    name: `Open ${piece.title} by ${piece.composer}`,
    exact: true,
  });
  if (await row.count()) return row;
  const pill = tierPill(page, tier);
  if (!(await pill.isChecked())) await pill.check();
  await expect(pill).toBeChecked();
  if (await row.count()) return row;
  await shelfButton(page, shelf).click();
  const more = showMoreButton(page);
  for (let pages = 0; pages < 40; pages++) {
    await expect(row.or(more).first()).toBeVisible();
    if (await row.count()) return row;
    await more.click();
  }
  throw new Error(`${slug} is not on its shelf`);
}

/** Opens a library piece from the library page, whichever level and shelf it sits on. */
export async function openLibraryPiece(page: Page, slug: string): Promise<void> {
  await (await showPiece(page, slug)).click();
}
