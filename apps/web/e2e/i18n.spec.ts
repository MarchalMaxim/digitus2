import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { en } from '../src/i18n/en/index.js';
import { messages as es } from '../src/i18n/es/index.js';
import { messages as fr } from '../src/i18n/fr/index.js';
import { messages as nl } from '../src/i18n/nl/index.js';
import { messages as pt } from '../src/i18n/pt/index.js';
import { LOCALE_STORAGE_KEY, type Locale } from '../src/i18n/locales.js';
import type { Messages } from '../src/i18n/messages.js';
import { expectNoSeriousA11y } from './helpers/axe.js';
import { libraryReady } from './helpers/library.js';

// Languages (issue #6): the page speaks the browser's language from the first paint, and the line
// at the foot of the library switches it and keeps the pick. One smoke test per language, with
// axe, on the library, a score and the about page. Desktop project.

const TWINKLE = '/#/piece/twinkle-twinkle-little-star';
const DICTIONARIES: [Locale, string, Messages][] = [
  ['nl', 'nl-NL', nl],
  ['fr', 'fr-FR', fr],
  ['es', 'es-ES', es],
  ['pt', 'pt-BR', pt],
];

/** Every English sentence of three words or more, with its translation in `t`. */
function sentences(source: unknown, target: unknown): [string, string][] {
  if (typeof source === 'string')
    return source.split(/\s+/).length >= 3 ? [[source, String(target)]] : [];
  if (source && typeof source === 'object' && typeof source !== 'function')
    return Object.entries(source).flatMap(([key, child]) =>
      sentences(child, (target as Record<string, unknown>)[key]),
    );
  return [];
}

/** No English sentence of the dictionary is on screen where the language has its own. */
async function expectNoEnglish(page: Page, t: Messages, label: string): Promise<void> {
  const text = await page.locator('body').innerText();
  const left = sentences(en, t)
    .filter(([english, translated]) => english !== translated && text.includes(english))
    .map(([english]) => english);
  expect(left, `${label}: English left on screen`).toEqual([]);
}

const kept = (page: Page) => page.evaluate((key) => localStorage.getItem(key), LOCALE_STORAGE_KEY);

/** Match both Vite's source module and its manifest-named production chunk. */
function localeModule(locale: Locale): (url: URL) => boolean {
  const source = `src/i18n/${locale}/index.ts`;
  const manifestUrl = new URL('../dist/.vite/manifest.json', import.meta.url);
  const manifest = existsSync(manifestUrl)
    ? (JSON.parse(readFileSync(manifestUrl, 'utf8')) as Record<string, { file: string }>)
    : {};
  const built = manifest[source]?.file;
  return (url) =>
    url.pathname.endsWith(`/${source}`) || !!(built && url.pathname.endsWith(`/${built}`));
}

test.describe('when translation loading fails', () => {
  test.use({ locale: 'fr-FR' });

  test('failed French startup agrees on English text, selection and document language', async ({
    page,
  }) => {
    let refused = false;
    await page.route(localeModule('fr'), async (route) => {
      refused = true;
      await route.abort('failed');
    });

    await page.goto('/');
    await libraryReady(page);

    expect(refused).toBe(true);
    await expect(page.getByText(en.library.tiers.easy).first()).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: en.common.language }).locator('[aria-current="true"]'),
    ).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('failed later Spanish switch keeps healthy French text, selection and metadata', async ({
    page,
  }) => {
    let refused = false;
    await page.route(localeModule('es'), async (route) => {
      refused = true;
      await route.abort('failed');
    });
    await page.goto('/');
    await expect(page.getByText(fr.library.tiers.easy).first()).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

    await page.getByRole('button', { name: 'Español', exact: true }).click();
    await expect.poll(() => refused).toBe(true);

    await expect(page.getByText(fr.library.tiers.easy).first()).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: fr.common.language }).locator('[aria-current="true"]'),
    ).toHaveAttribute('lang', 'fr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  });
});

for (const [locale, browser, t] of DICTIONARIES) {
  test.describe(`in a ${browser} browser`, () => {
    test.use({ locale: browser });

    test(`the page speaks ${locale} on its own and passes axe`, async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'digitus2' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      const line = page.getByRole('navigation', { name: t.common.language });
      await expect(line.locator('[aria-current="true"]')).toHaveAttribute('lang', locale);
      await expect(page.getByText(t.library.tiers.easy).first()).toBeVisible();
      await expectNoEnglish(page, t, 'library');
      await expectNoSeriousA11y(page, `${locale} library`);
      expect(await kept(page)).toBeNull();

      await page.goto(TWINKLE);
      await expect(page.locator('.score-sheet g.fing')).toHaveCount(64, { timeout: 20_000 });
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expectNoEnglish(page, t, 'score');
      await expectNoSeriousA11y(page, `${locale} score`);

      await page.goto('/#/about');
      await expect(page.locator('main')).toBeVisible();
      await expectNoEnglish(page, t, 'about');
      await expectNoSeriousA11y(page, `${locale} about`);
    });
  });
}

test.describe('in an en-US browser', () => {
  test.use({ locale: 'en-US' });

  test('the language line switches the page and keeps the pick across a reload', async ({
    page,
  }) => {
    await page.goto('/');
    await libraryReady(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByRole('button', { name: 'Français', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByRole('navigation', { name: fr.common.language })).toBeVisible();
    expect(await kept(page)).toBe('fr');

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'digitus2' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByText(fr.library.tiers.easy).first()).toBeVisible();

    // Picking the browser's own language forgets the pick.
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await kept(page)).toBeNull();
  });
});
