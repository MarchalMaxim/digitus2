import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { libraryReady } from './helpers/library.js';
import { expectOneRed } from './helpers/red.js';
import { mockService } from './helpers/scan.js';

test('the start page has exactly one red element', async ({ page }) => {
  await page.goto('/');
  // the page renders once the library list has loaded (main.tsx)
  await libraryReady(page);
  await expectOneRed(page);
});

test('while a score loads, the loader is the one red and Play is plain; then Play takes it', async ({
  page,
}) => {
  // Hold the score's file back, so the view stays on "Loading the score…".
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/scores/twinkle-twinkle-little-star.musicxml*', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/#/piece/twinkle-twinkle-little-star');
  await expect(page.getByRole('status')).toHaveText('Loading the score…');
  await expect(page.locator('.score-loader svg.loader.is-scale')).toBeVisible();
  const roots = await expectOneRed(page, 'loading');
  expect(roots[0]!.className).toContain('loader-red');
  await expect(page.getByRole('button', { name: 'Play' })).not.toHaveClass(/is-red/);

  release();
  await expect(page.locator('.score-sheet g.fing').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.score-loader')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/is-red/);
  await expectOneRed(page, 'ready');
});

const TWINKLE_PAGE = fileURLToPath(new URL('../fixtures/twinkle-page.png', import.meta.url));
const TWINKLE_XML = fileURLToPath(
  new URL('../../../content/scores/twinkle-twinkle-little-star.musicxml', import.meta.url),
);

interface Frame {
  t: number;
  roots: Array<{ tag: string; className: string }>;
}

/**
 * Records, on every animation frame from now on, the elements that are reddish: any colour whose
 * red channel leads the others by more than 40. The exact-accent check of `redRoots` misses a red
 * that is fading in or out, which is what two reds on screen for a moment look like.
 */
async function recordReddish(page: Page): Promise<void> {
  await page.evaluate(() => {
    const props = [
      'color',
      'background-color',
      'border-top-color',
      'border-right-color',
      'border-bottom-color',
      'border-left-color',
      'outline-color',
      'fill',
      'stroke',
    ];
    const reddish = (value: string): boolean => {
      const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(value);
      if (!m) return false;
      const alpha = m[4] === undefined ? 1 : Number(m[4]);
      return alpha > 0 && Number(m[1]) - Math.max(Number(m[2]), Number(m[3])) > 40;
    };
    const frames: Frame[] = [];
    const start = performance.now();
    const roots = (): Frame['roots'] => {
      const out: Frame['roots'] = [];
      const walk = (el: Element) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
        if (props.some((p) => reddish(cs.getPropertyValue(p)))) {
          out.push({
            tag: el.tagName.toLowerCase(),
            className:
              typeof el.className === 'string' ? el.className : (el.getAttribute('class') ?? ''),
          });
          return;
        }
        for (const child of Array.from(el.children)) walk(child);
      };
      walk(document.documentElement);
      return out;
    };
    const w = window as unknown as {
      __reddish: Frame[];
      __reddishStop: boolean;
      __reddishClick: number;
    };
    w.__reddish = frames;
    w.__reddishStop = false;
    w.__reddishClick = Infinity;
    // Frames before the click show Scan this score, the red then; only those from it on count.
    document.addEventListener(
      'click',
      () => (w.__reddishClick = Math.round(performance.now() - start)),
      { capture: true, once: true },
    );
    const tick = () => {
      frames.push({ t: Math.round(performance.now() - start), roots: roots() });
      if (!w.__reddishStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** The frames from the click on. */
async function stopReddish(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __reddish: Frame[];
      __reddishStop: boolean;
      __reddishClick: number;
    };
    w.__reddishStop = true;
    return w.__reddish
      .filter((f) => f.t >= w.__reddishClick)
      .map((f) => ({ ...f, t: f.t - w.__reddishClick }));
  });
}

// The mobile project does not run this file, so the phone is set here.
const SETUPS = [
  { name: 'PC', viewport: { width: 1280, height: 900 }, phone: false },
  { name: 'phone', viewport: { width: 360, height: 740 }, phone: true },
] as const;
for (const setup of SETUPS)
  for (const colorScheme of ['light', 'dark'] as const)
    test.describe(`scanning, ${setup.name}, ${colorScheme}`, () => {
      test.use({
        viewport: setup.viewport,
        isMobile: setup.phone,
        hasTouch: setup.phone,
        colorScheme,
      });

      test('the loader is the one red from the click on, never two for a moment', async ({
        page,
      }) => {
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        await mockService(page, readFileSync(TWINKLE_XML, 'utf8'), {
          onRecognize: async () => {
            await held;
          },
        });
        await page.goto('/');
        await libraryReady(page);
        await page.getByLabel('Open your own score').setInputFiles(TWINKLE_PAGE);
        await expect(page.getByRole('heading', { name: 'From paper to piano' })).toBeVisible();
        await expect(page.locator('.scan-original-image')).toHaveJSProperty('complete', true);
        // Nothing is fading any more when the recording starts.
        await page.waitForTimeout(500);
        const scan = page.getByRole('button', { name: 'Scan this score' });
        await expect(scan).toHaveClass(/is-red/);
        await recordReddish(page);
        await scan.click();
        await expect(page.locator('.scan-loader svg.loader.is-scale')).toBeVisible();
        await page.waitForTimeout(600);
        const frames = await stopReddish(page);

        expect(frames.length).toBeGreaterThan(10);
        // A button that is reddish (fading out of Scan this score, or Cancel scan) is a second red.
        const bad = frames.filter(
          (f) => f.roots.length > 1 || f.roots.some((r) => r.tag === 'button'),
        );
        expect(bad.slice(0, 3), `${bad.length} frames with two reds or a red button`).toEqual([]);
        const late = frames.filter((f) => f.t > 300);
        for (const f of late) {
          expect(f.roots).toHaveLength(1);
          expect(f.roots[0]!.className).toContain('loader-red');
        }

        // The steady state.
        const roots = await expectOneRed(page, 'scanning');
        expect(roots[0]!.className).toContain('loader-red');
        await expect(page.getByRole('button', { name: 'Cancel scan' })).not.toHaveClass(/is-red/);

        release();
        await expect(page.getByRole('heading', { name: 'Review the recognition' })).toBeVisible();
      });
    });
