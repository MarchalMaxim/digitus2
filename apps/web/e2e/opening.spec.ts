import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { OPENING_STATES } from './helpers/states.js';

const TWINKLE_XML = fileURLToPath(
  new URL('../../../content/scores/twinkle-twinkle-little-star.musicxml', import.meta.url),
);

// The loader of a score on its way in (issues 240, 242): one red element, axe and overflow are
// checked for these states by states.spec.ts at both widths; here the words for a screen reader
// are checked, and that the reader sees one loader in one place from the choice to the score.
for (const s of OPENING_STATES) {
  test(`state ${s.name}: a live region that was in the page says the score is loading`, async ({
    page,
  }) => {
    // What the region held the moment it entered the page (an observer sees it before any later
    // update): a region that appears with its words inside is skipped by some screen readers.
    await page.addInitScript(() => {
      const seen: string[] = [];
      Object.assign(window, { seen });
      const look = (node: Node) => {
        if (!(node instanceof Element)) return;
        const region = node.matches('[data-testid="opening-announcement"]')
          ? node
          : node.querySelector('[data-testid="opening-announcement"]');
        if (region) seen.push(region.textContent ?? '');
      };
      new MutationObserver((records) => {
        for (const record of records) record.addedNodes.forEach(look);
      }).observe(document, { childList: true, subtree: true });
    });
    await s.go(page);
    const region = page.getByTestId('opening-announcement');
    await expect(region).toHaveText('Loading the score…');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((text) => text === '')).toBe(true);
  });
}

for (const [width, height] of [
  [1280, 900],
  [360, 740],
] as const) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500 });

    test('while the score view is on its way the loader stays clear of the header and the dock', async ({
      page,
    }) => {
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      // The library's score is a build asset (hashed name): hold that request.
      await page.route('**/assets/twinkle-twinkle-little-star-*.musicxml', async (route) => {
        await held;
        await route.continue();
      });
      await page.goto('/#/piece/twinkle-twinkle-little-star');
      await expect(page.locator('.score-loader svg.loader')).toBeVisible();
      const boxes = await page.evaluate(() => {
        const box = (selector: string) => {
          const r = document.querySelector(selector)!.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom };
        };
        return {
          loader: box('.score-loader svg.loader'),
          header: box('.score-view header'),
          dock: box('.dock'),
        };
      });
      expect(boxes.loader.top, 'below the header').toBeGreaterThanOrEqual(boxes.header.bottom);
      expect(boxes.loader.bottom, 'above the dock').toBeLessThanOrEqual(boxes.dock.top);
      release();
      await expect(page.locator('.score-sheet svg').first()).toBeVisible();
    });

    for (const locale of ['en-US', 'pt-BR']) {
      test.describe(locale, () => {
        test.use({ locale });

        test('a long title keeps the loader clear of the header', async ({ page }) => {
          let release: () => void = () => undefined;
          const held = new Promise<void>((resolve) => (release = resolve));
          await page.route(
            '**/assets/pdmx-chris-h-lsbeck-1968-turrican-ii-the-fina-24eecccd.musicxml-*',
            async (route) => {
              await held;
              await route.continue();
            },
          );
          await page.goto('/#/piece/pdmx-chris-h-lsbeck-1968-turrican-ii-the-fina-24eecccd');
          await expect(page.locator('.score-loader svg.loader')).toBeVisible();
          const boxes = await page.evaluate(() => {
            const box = (selector: string) => {
              const r = document.querySelector(selector)!.getBoundingClientRect();
              return { top: r.top, bottom: r.bottom };
            };
            return { loader: box('.score-loader svg.loader'), header: box('.score-view header') };
          });
          expect(boxes.loader.top, 'below the header').toBeGreaterThanOrEqual(boxes.header.bottom);
          release();
        });
      });
    }

    test('a chosen file shows one loader, in one place at one size, from the choice to the score', async ({
      page,
    }) => {
      await page.goto('/');
      await expect(page.getByRole('button', { name: /^(Start|Continue) with / })).toBeVisible();
      // Every frame from the choice to the score: where the loaders are, and how big.
      await page.evaluate(() => {
        const frames: string[][] = [];
        Object.assign(window, { frames });
        const tick = () => {
          frames.push(
            Array.from(document.querySelectorAll('.loader')).map((el) => {
              const r = el.getBoundingClientRect();
              return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 2) / 2).join(',');
            }),
          );
          requestAnimationFrame(tick);
        };
        tick();
      });
      await page.getByLabel('Open your own score').setInputFiles({
        name: 'one-loader.musicxml',
        mimeType: 'application/xml',
        buffer: readFileSync(TWINKLE_XML),
      });
      await expect(page.locator('.score-sheet svg').first()).toBeVisible();
      const frames = await page.evaluate(
        () => (window as unknown as { frames: string[][] }).frames,
      );
      const shown = frames.filter((loaders) => loaders.length > 0);
      expect(shown.length).toBeGreaterThan(3);
      expect(shown.every((loaders) => loaders.length === 1)).toBe(true);
      expect([...new Set(shown.map((loaders) => loaders[0]))]).toHaveLength(1);
    });
  });
}
